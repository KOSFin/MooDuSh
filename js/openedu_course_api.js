(function (root) {
    const COURSE_ID_RE = /course-v1:[^/?#\s]+/;
    const BLOCK_ID_RE = /block-v1:[^/?#\s]+/;

    function findCourseId(url) {
        const value = String(url || root.location?.href || '');
        const match = value.match(COURSE_ID_RE);
        return match ? match[0] : '';
    }

    function blockKind(blockId) {
        const value = String(blockId || '');
        const match = value.match(/type@([^+]+)/);
        return match ? match[1] : '';
    }

    function extractBlockId(urlOrText) {
        const match = String(urlOrText || '').match(BLOCK_ID_RE);
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

        return verticals.map((vertical) => {
            const sequential = parentOf(vertical, 'sequential');
            const chapter = parentOf(vertical, 'chapter');
            return {
                courseId: course.id || findCourseId(vertical.id),
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
        const url = 'https://apps.openedu.ru/api/courses/v2/blocks/?course_id=' + encodeURIComponent(courseId) + '&all_blocks=true&depth=all';
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
        buildVerticalXBlockUrl,
        buildCourseMap,
        fetchVerticalHtml,
        discoverCurrentCourse,
        discoverCurrentCourseFrames
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = root.ParamExtOpeneduCourseApi;
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
