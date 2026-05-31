(function (root) {
    const COURSE_ID_RE = /course-v1:[^/?#\s]+/;
    const BLOCK_ID_RE = /block-v1:[^/?#\s]+/;

    function courseIdFromBlockId(blockId) {
        const match = String(blockId || '').match(/^block-v1:([^+]+)\+([^+]+)\+([^+]+)\+/);
        return match ? ('course-v1:' + match[1] + '+' + match[2] + '+' + match[3]) : '';
    }

    function decodeUrlTextSafe(value) {
        const raw = String(value || '');
        try {
            return decodeURIComponent(raw);
        } catch (_) {
            return raw;
        }
    }

    function findCourseId(url) {
        const raw = String(url || root.location?.href || '');
        const value = raw + ' ' + decodeUrlTextSafe(raw);
        const match = value.match(COURSE_ID_RE);
        if (match) {
            return match[0];
        }
        const blockMatch = value.match(BLOCK_ID_RE);
        return blockMatch ? courseIdFromBlockId(blockMatch[0]) : '';
    }

    function blockKind(blockId) {
        const value = String(blockId || '');
        const match = value.match(/type@([^+]+)/);
        return match ? match[1] : '';
    }

    function extractBlockId(urlOrText) {
        const raw = String(urlOrText || '');
        const match = (raw + ' ' + decodeUrlTextSafe(raw)).match(BLOCK_ID_RE);
        return match ? match[0] : '';
    }

    function buildVerticalXBlockUrl(verticalId) {
        const id = String(verticalId || '').trim();
        if (!id) {
            return '';
        }
        return 'https://courses.openedu.ru/xblock/' + encodeURIComponent(id)
            + '?show_title=0&show_bookmark_button=0&recheck_access=1&view=student_view';
    }

    function normalizeBlock(block, parent) {
        const id = String(block?.id || block?.block_id || block?.usage_key || '');
        return {
            id,
            type: String(block?.type || blockKind(id) || ''),
            title: String(block?.display_name || block?.title || ''),
            graded: Boolean(block?.graded),
            parentId: parent?.id || '',
            children: Array.isArray(block?.children) ? block.children : []
        };
    }

    function flattenBlocks(blocks) {
        const source = blocks?.blocks && typeof blocks.blocks === 'object'
            ? Object.values(blocks.blocks)
            : (Array.isArray(blocks) ? blocks : []);
        const byId = new Map();
        source.forEach((block) => {
            const normalized = normalizeBlock(block, null);
            if (normalized.id) {
                byId.set(normalized.id, normalized);
            }
        });
        for (const block of byId.values()) {
            block.children.forEach((childId) => {
                const child = byId.get(childId);
                if (child) {
                    child.parentId = block.id;
                }
            });
        }
        return Array.from(byId.values());
    }

    function buildCourseMap(blocksPayload) {
        const blocks = flattenBlocks(blocksPayload);
        const byId = new Map(blocks.map((block) => [block.id, block]));
        const verticals = blocks.filter((block) => block.type === 'vertical');
        const course = blocks.find((block) => block.type === 'course') || blocks[0] || {};

        function parentOf(block, type) {
            let current = block;
            for (let i = 0; i < 8; i += 1) {
                current = byId.get(current?.parentId || '');
                if (!current) {
                    return {};
                }
                if (current.type === type) {
                    return current;
                }
            }
            return {};
        }

        const courseId = findCourseId(course.id) || course.id || '';
        return verticals.map((vertical) => {
            const sequential = parentOf(vertical, 'sequential');
            const chapter = parentOf(vertical, 'chapter');
            return {
                courseId: courseId || findCourseId(vertical.id),
                courseTitle: course.title || '',
                chapterId: chapter.id || '',
                chapterTitle: chapter.title || '',
                sequentialId: sequential.id || '',
                sequentialTitle: sequential.title || '',
                verticalId: vertical.id,
                verticalTitle: vertical.title || '',
                graded: Boolean(vertical.graded)
            };
        });
    }

    function extractCourseMetadataFromCapturedPayload(url, payload) {
        const isCourseEndpoint = /\/api\/courseware\/course\//.test(String(url || ''));
        const courseTitle = String(payload?.name || payload?.display_name || payload?.title || payload?.course_name || '');
        if (!isCourseEndpoint && !courseTitle) {
            return null;
        }
        const courseId = String(payload?.id || payload?.course_id || findCourseId(url) || '').trim();
        if (!courseId || !/^course-v1:/.test(courseId)) {
            return null;
        }
        return {
            courseId,
            courseTitle
        };
    }

    function stableSyntheticId(prefix, value) {
        const text = String(value || '').replace(/\s+/g, ' ').trim();
        if (!text) {
            return '';
        }
        let hash = 2166136261;
        for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return prefix + '@' + (hash >>> 0).toString(16);
    }

    function buildSequenceMap(sequencePayload, courseId) {
        const items = Array.isArray(sequencePayload?.items) ? sequencePayload.items : [];
        const sequentialId = String(sequencePayload?.item_id || sequencePayload?.element_id || '');
        const sequentialTitle = String(sequencePayload?.sequence_name || sequencePayload?.display_name || '');
        return items
            .filter((item) => item?.id && blockKind(item.id) === 'vertical')
            .map((item) => {
                const parts = String(item.path || '').split('>').map((part) => part.trim()).filter(Boolean);
                const chapterTitle = parts.length > 2 ? parts[0] : '';
                return {
                    courseId: courseId || findCourseId(item.id),
                    courseTitle: '',
                    chapterId: stableSyntheticId('chapter', chapterTitle),
                    chapterTitle,
                    sequentialId,
                    sequentialTitle,
                    verticalId: String(item.id || ''),
                    verticalTitle: String(item.page_title || item.display_name || ''),
                    graded: Boolean(item.graded)
                };
            });
    }

    function mergeCourseMaps(primary, secondary) {
        function isSyntheticId(value) {
            return /^(chapter|sequential|vertical)@/i.test(String(value || '').trim());
        }

        function shouldPreferPreviousId(key, incoming, previous) {
            if (!/(chapterId|sequentialId|verticalId)$/.test(String(key || ''))) {
                return false;
            }
            return previous && !isSyntheticId(previous) && isSyntheticId(incoming);
        }

        function mergeValue(incoming, previous) {
            return incoming === '' || incoming === null || typeof incoming === 'undefined'
                ? previous
                : incoming;
        }

        function mergeItem(previous, incoming) {
            const result = Object.assign({}, previous);
            Object.keys(incoming || {}).forEach((key) => {
                if (shouldPreferPreviousId(key, incoming[key], result[key])) {
                    return;
                }
                result[key] = mergeValue(incoming[key], result[key]);
            });
            return result;
        }

        const byVertical = new Map();
        const courseMetaById = new Map();

        function rememberCourseMeta(item) {
            const courseId = String(item?.courseId || '').trim();
            if (!courseId || !item?.courseTitle) {
                return;
            }
            courseMetaById.set(courseId, String(item.courseTitle || ''));
        }

        function applyCourseMeta(item) {
            const result = Object.assign({}, item);
            if (!result.courseTitle && courseMetaById.has(result.courseId)) {
                result.courseTitle = courseMetaById.get(result.courseId);
            }
            return result;
        }

        (Array.isArray(primary) ? primary : []).forEach(rememberCourseMeta);
        (Array.isArray(secondary) ? secondary : []).forEach(rememberCourseMeta);

        (Array.isArray(primary) ? primary : []).forEach((item) => {
            if (item?.verticalId) {
                byVertical.set(item.verticalId, applyCourseMeta(item));
            }
        });
        (Array.isArray(secondary) ? secondary : []).forEach((item) => {
            if (!item?.verticalId) {
                return;
            }
            const previous = byVertical.get(item.verticalId) || {};
            byVertical.set(item.verticalId, applyCourseMeta(mergeItem(previous, item)));
        });
        return Array.from(byVertical.values());
    }

    function buildCourseMapFromCapturedPayload(url, payload) {
        if (payload?.blocks && typeof payload.blocks === 'object') {
            return buildCourseMap(payload);
        }
        if (Array.isArray(payload?.items)) {
            return buildSequenceMap(payload, findCourseId(url));
        }
        const courseMeta = extractCourseMetadataFromCapturedPayload(url, payload);
        if (courseMeta) {
            return [courseMeta];
        }
        return [];
    }

    async function fetchJson(url, options) {
        const response = await fetch(url, Object.assign({ credentials: 'include' }, options || {}));
        if (!response.ok) {
            throw new Error('openedu_api_' + response.status);
        }
        return await response.json();
    }

    async function discoverCurrentCourse() {
        const courseId = findCourseId(root.location?.href || '');
        if (!courseId) {
            return { courseId: '', verticals: [] };
        }
        const url = 'https://courses.openedu.ru/api/courses/v2/blocks/?course_id=' + encodeURIComponent(courseId) + '&all_blocks=true&depth=all';
        const payload = await fetchJson(url);
        return { courseId, verticals: buildCourseMap(payload), raw: payload };
    }

    async function fetchVerticalHtml(verticalId) {
        const url = buildVerticalXBlockUrl(verticalId);
        if (!url) {
            return { verticalId, url: '', html: '' };
        }
        const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) {
            throw new Error('openedu_xblock_' + response.status);
        }
        return { verticalId, url, html: await response.text() };
    }

    async function discoverCurrentCourseFrames(options) {
        const course = await discoverCurrentCourse();
        const limit = Math.max(1, Number(options?.limit || 30));
        const onlyGraded = options?.onlyGraded !== false;
        const verticals = course.verticals
            .filter((item) => !onlyGraded || item.graded)
            .slice(0, limit);
        const frames = [];
        for (const vertical of verticals) {
            try {
                const frame = await fetchVerticalHtml(vertical.verticalId);
                frames.push(Object.assign({}, vertical, frame));
            } catch (error) {
                frames.push(Object.assign({}, vertical, {
                    url: buildVerticalXBlockUrl(vertical.verticalId),
                    html: '',
                    error: error && error.message ? String(error.message) : 'openedu_xblock_failed'
                }));
            }
        }
        return { courseId: course.courseId, verticals: course.verticals, frames };
    }

    root.ParamExtOpeneduCourseApi = {
        findCourseId,
        extractBlockId,
        courseIdFromBlockId,
        buildVerticalXBlockUrl,
        buildCourseMap,
        buildSequenceMap,
        mergeCourseMaps,
        buildCourseMapFromCapturedPayload,
        extractCourseMetadataFromCapturedPayload,
        fetchVerticalHtml,
        discoverCurrentCourse,
        discoverCurrentCourseFrames
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = root.ParamExtOpeneduCourseApi;
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
