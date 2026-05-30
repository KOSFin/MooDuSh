(function () {
    const HOST_RE = /(^|\.)openedu\.ru$/i;
    const STICK_ID = 'moodush-openedu-stick';
    const WAND_TOGGLE_ID = 'moodush-openedu-wand-toggle';
    const QUESTION_KEY_ATTR = 'data-moodush-openedu-question-key';
    const INLINE_WAND_ATTR = 'data-moodush-openedu-inline-wand';
    const INLINE_MENU_CLASS = 'moodush-openedu-inline-menu';
    const WAND_VISIBILITY_KEY = 'paramExtOpeneduWandsHidden';
    const QUESTION_INPUT_SELECTOR = 'input[type="radio"], input[type="checkbox"], input[type="text"], input[type="hidden"], select, textarea.answer, textarea[name="answer"]';
    const QUESTION_ROOT_SELECTOR = '[data-problem-id], .problem, .xblock-student_view-problem, .problems-wrapper, .wrapper-problem-response, fieldset, [role="group"], .choicegroup, [id^="problem_"]';
    const QUESTION_GROUP_SELECTOR = 'fieldset, .question, .subquestion, .problem-question, .wrapper-problem-response, .choicegroup, .answers, .options, .response, .answer';
    const OPTION_LABEL_SELECTOR = 'label.response-label, label.field-label, .choicegroup label[for], label[for], label';
    const PARAMEXT_WIDGET_SELECTOR = [
        '.moodush-openedu-inline-menu',
        '.moodush-openedu-inline-popover',
        '.moodush-openedu-wand-toggle',
        '.moodush-openedu-stick',
        '[' + INLINE_WAND_ATTR + ']'
    ].join(', ');
    const MAX_ANSWERS_PER_QUESTION = 50;
    const RETRY_DELAYS_MS = [0, 350, 900];
    const MIN_CYCLE_GAP_MS = 10000;
    const MAX_CONSECUTIVE_FAILURES = 7;
    const AUTH_FAILURE_COOLDOWN_MS = 120000;
    const QUERY_COOLDOWN_MS = 25000;
    const PUSH_COOLDOWN_MS = 15000;
    const API_SYNC_MIN_GAP_MS = 8000;
    const ACTIVE_TAB_REFRESH_MIN_GAP_MS = 45000;
    const ACTIVE_TAB_EMPTY_REFRESH_MIN_GAP_MS = 5000;
    const ACTIVE_TAB_REFRESH_AFTER_SUBMIT_WINDOW_MS = 15000;
    const BACKEND_LOG_THROTTLE_MS = 30000;
    const CONTENT_FALLBACK_BLOCK_MS = 90000;
    const TRANSIENT_EMPTY_QUESTIONS_GRACE_MS = 9000;
    const AUTO_SUBMIT_COOLDOWN_MS = 8000;
    const MISSING_ANSWER_ACTION_COOLDOWN_MS = 12000;
    const BOOTSTRAP_SYNC_DELAYS_MS = [1800, 5200];
    const POST_SUBMIT_SYNC_DELAYS_MS = [2500, 6500];
    const AUTO_ADVANCE_PARSE_WAIT_MS = 9000;
    const AUTO_ADVANCE_MIN_POST_NAV_SYNC_MS = 1200;
    const AUTO_ADVANCE_FORCE_SYNC_MIN_GAP_MS = 1200;
    const AUTO_ADVANCE_FORCE_SYNC_DELAYS_MS = [250, 1200, 2800, 5200];
    const AUTO_ADVANCE_WAIT_LOG_COOLDOWN_MS = 1600;
    const ACTIVE_TAB_POST_SUBMIT_REFRESH_DELAYS_MS = [3000, 8000, 18000];
    const MESSAGE_TRIGGER_THROTTLE_MS = 3000;
    const MUTATION_TRIGGER_THROTTLE_MS = 3000;
    const DEBUG_SYNC_STORAGE_KEY = 'paramExtOpeneduDebug';
    const PARTICIPANT_KEY_STORAGE = 'paramExtOpeneduParticipantKey';
    const OPENEDU_TOKEN_REQUIRED_TITLE = 'Нужен токен OpenEdu';
    const OPENEDU_TOKEN_REQUIRED_TEXT = 'Чтобы синхронизировать ответы и статистику OpenEdu, укажите Bearer токен в настройках расширения: API OpenEdu.';
    const OPENEDU_PARSER_VERSION = window.ParamExtOpeneduParser?.VERSION || 'openedu-parser-v2.0.0';

    const NEGATIVE_MARK_RE = /(choicegroup_incorrect|[✗✘✕❌×]|(^|[^a-zа-яё])(incorrect|wrong|false|неверн|неправильн|ошиб)([^a-zа-яё]|$))/i;
    const POSITIVE_MARK_RE = /(choicegroup_correct|[✓✔✅☑]|(^|[^a-zа-яё])(correct|right|true|верн|правильн)([^a-zа-яё]|$))/i;
    const NEGATIVE_ICON_MARK_RE = /(^|[\s_-])(fa-times|fa-remove|fa-close|fa-xmark|times|xmark|x-mark|cross|remove|close|cancel|wrong|incorrect|error)(?=$|[\s_-])/i;
    const POSITIVE_ICON_MARK_RE = /(^|[\s_-])(fa-check|fa-check-circle|check|check-circle|done|success|right|correct)(?=$|[\s_-])/i;
    const STATUS_MARKER_SELECTOR = [
        '.status',
        '.status-icon',
        '.icon',
        '.fa',
        '.fa-check',
        '.fa-check-circle',
        '.fa-times',
        '.fa-remove',
        '.fa-close',
        '.fa-xmark',
        '[data-icon]',
        '[data-correct]',
        '[data-state]'
    ].join(', ');

    if (!HOST_RE.test(location.hostname)) {
        return;
    }

    if (!window.ParamExtSettings) {
        return;
    }

    if (window.ParamExtTelemetry) {
        window.ParamExtTelemetry.installGlobalHandlers('openedu-content');
    }

    const isTopFrame = window === window.top;
    const localOpeneduShared = buildLocalOpeneduSharedApi();
    const openeduShared = window.ParamExtOpeneduShared || localOpeneduShared;
    const DEBUG_SYNC_ENABLED = (() => {
        try {
            const raw = localStorage.getItem(DEBUG_SYNC_STORAGE_KEY);
            if (raw === null || raw === '') {
                return false;
            }
            return /^(1|true|on|yes)$/i.test(String(raw).trim());
        } catch (_) {
            return false;
        }
    })();

    let settings = null;
    let stickRoot = null;
    let stickBody = null;
    let wandToggle = null;
    let statusDot = null;
    let statusText = null;
    let lastAutoAdvanceAt = 0;
    let lastActiveTabRefreshAt = 0;
    let lastSubmitActionAt = 0;
    let cycleInFlight = false;
    let lastCycleAt = 0;
    let consecutiveCycleFailures = 0;
    let cyclesStopped = false;
    let panelVisible = false;
    let wandsHidden = false;
    let syncBlockedUntil = 0;
    let syncBlockedReason = '';
    let lastBackendIssueAt = 0;
    let lastBackendIssueSignature = '';
    let lastAttemptPayloadHash = '';
    let lastAttemptPushAt = 0;
    let lastNetworkSyncAt = 0;
    let lastStatsQuerySignature = '';
    let lastStatsQueryAt = 0;
    let lastStatsResponse = null;
    let scheduledCycleTimer = 0;
    let scheduledCycleForce = false;
    let scheduledCycleAllowNetwork = false;
    let lastAutoSubmitByProblem = new Map();
    let lastAutoCheckByProblem = new Map();
    let lastMissingAnswerActionAt = 0;
    let lastMissingAnswerSignature = '';
    let pendingManualAnswerQuestion = null;
    let pendingManualAnswerTimer = 0;
    let manualAnswerContinuationInFlight = false;
    let manualAnswerSoundPlayed = false;
    let contentFallbackBlockedUntil = 0;
    let contentFallbackBlockedReason = '';
    let participantKeyCache = '';
    let lastMergedStatsByQuestion = null;
    let lastRenderedQuestions = [];
    let lastParsedQuestionCount = 0;
    let lastMessageTriggerAt = 0;
    let lastMutationTriggerAt = 0;
    let lastMeaningfulQuestionsAt = 0;
    let lastSequenceNavigationAt = Date.now();
    let lastSequenceNavigationGeneration = 0;
    let lastSequenceTabKey = '';
    let lastSequenceForceSyncAt = 0;
    let lastAutoAdvanceWaitLogAt = 0;
    let activeTabPostSubmitRefreshGeneration = 0;
    let activeTabPostSubmitSoundGeneration = 0;
    let lastEmptySectionRefreshKey = '';
    let lastCourseDiscoveryAt = 0;
    let openeduCourseVerticals = [];

    let iframeQuestionsCache = [];
    let topFrameIframeQuestions = null;
    let topFrameIframeStats = null;
    let topFrameIframeSyncAt = 0;
    let topFrameIframeSnapshotSeq = 0;
    const topFrameIframeSourceIds = new Map();
    const topFrameIframeSnapshots = new Map();
    let topFrameOnlineState = { online: false, text: 'Wait...' };
    window.__PARAMEXT_TOPFRAME_ONLINE_STATE = topFrameOnlineState;
    let _topContextPromise = null;
    const virtualContentDocsByHost = new WeakMap();
    const frameSyncId = isTopFrame
        ? 'top'
        : ('frame-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36));

    function buildLocalOpeneduSharedApi() {
        let fingerprintPunctRe = null;
        try {
            fingerprintPunctRe = new RegExp('[^\\p{L}\\p{N}_\\s]', 'gu');
        } catch (_) {
            fingerprintPunctRe = /[^\w\s]/g;
        }

        const FNV64_OFFSET_A = 0xcbf29ce484222325n;
        const FNV64_OFFSET_B = 0x84222325cbf29ce4n;
        const FNV64_PRIME = 0x100000001b3n;

        function collapseWhitespaceLocal(value) {
            return String(value || '').replace(/\s+/g, ' ').trim();
        }

        function normalizeTexMathTextLocal(value) {
            return collapseWhitespaceLocal(String(value || '')
                .replace(/\\\(([\s\S]*?)\\\)/g, '$1')
                .replace(/\\\[([\s\S]*?)\\\]/g, '$1')
                .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
                .replace(/(^|[^\w$])\$([^$\n]+)\$/g, '$1$2')
                .replace(/\\Omega\b/g, 'Ω')
                .replace(/\\omega\b/g, 'ω')
                .replace(/\\([A-Za-z]+)\b/g, '$1')
                .replace(/\\([{}()[\],.;:+\-*/=])/g, '$1'));
        }

        function normalizeTextLocal(value) {
            return collapseWhitespaceLocal(value).toLowerCase();
        }

        function normalizeFingerprintTextLocal(value) {
            return collapseWhitespaceLocal(normalizeTexMathTextLocal(value).replace(fingerprintPunctRe, '')).toLowerCase();
        }

        function hashHex64Local(input, offset) {
            let hashValue = offset;
            const source = String(input || '');
            for (let i = 0; i < source.length; i += 1) {
                hashValue ^= BigInt(source.charCodeAt(i));
                hashValue = BigInt.asUintN(64, hashValue * FNV64_PRIME);
            }
            return hashValue.toString(16).padStart(16, '0');
        }

        function hashHex128Local(input) {
            const source = String(input || '');
            return hashHex64Local('a|' + source, FNV64_OFFSET_A) + hashHex64Local('b|' + source, FNV64_OFFSET_B);
        }

        function normalizeMediaSourceLocal(raw) {
            const value = collapseWhitespaceLocal(raw);
            if (!value) {
                return '';
            }

            try {
                const parsed = new URL(value, 'https://openedu.ru');
                return collapseWhitespaceLocal(parsed.pathname + (parsed.search || ''));
            } catch (_) {
                return value.replace(/^https?:\/\/[^/]+/i, '');
            }
        }

        function getMediaFileNameLocal(path) {
            const normalized = collapseWhitespaceLocal(path);
            if (!normalized) {
                return '';
            }

            const parts = normalized.split('/');
            return collapseWhitespaceLocal(parts[parts.length - 1] || '');
        }

        function buildMediaTokenLocal(item, index) {
            const kind = normalizeTextLocal(item?.kind || item?.tag || 'media') || 'media';
            const source = normalizeMediaSourceLocal(item?.src || item?.href || '');
            const title = collapseWhitespaceLocal(item?.title || item?.ariaLabel || item?.alt || '');
            const signature = collapseWhitespaceLocal(item?.signature || item?.fingerprint || '');
            const fileName = getMediaFileNameLocal(source);
            const primary = fileName || source || signature || title || ('item-' + String(index + 1));
            return title && title !== primary
                ? (kind + ':' + primary + ' | ' + title)
                : (kind + ':' + primary);
        }

        function deriveOptionAnswerTextLocal(payload) {
            const text = normalizeTexMathTextLocal(payload?.text || '');
            if (text) {
                return text;
            }

            const labelled = normalizeTexMathTextLocal(payload?.ariaLabel || payload?.title || '');
            if (labelled) {
                return labelled;
            }

            const mediaDescriptors = Array.isArray(payload?.mediaDescriptors) ? payload.mediaDescriptors : [];
            if (mediaDescriptors.length > 0) {
                return mediaDescriptors.map((item, index) => buildMediaTokenLocal(item, index)).join(' + ');
            }

            const inputValue = collapseWhitespaceLocal(payload?.inputValue || '');
            if (inputValue) {
                return inputValue;
            }

            return '';
        }

        function normalizeOptionListLocal(options) {
            if (!Array.isArray(options)) {
                return [];
            }

            return options
                .map((option) => normalizeTextLocal(option?.answerText || ''))
                .filter(Boolean)
                .sort();
        }

        function buildQuestionFingerprintLocal(prompt, answerTexts) {
            const promptNorm = normalizeFingerprintTextLocal(prompt);
            const normalizedAnswers = [];
            const seen = new Set();

            (Array.isArray(answerTexts) ? answerTexts : []).forEach((answerText) => {
                const answerNorm = normalizeFingerprintTextLocal(answerText);
                if (!answerNorm || seen.has(answerNorm)) {
                    return;
                }
                seen.add(answerNorm);
                normalizedAnswers.push(answerNorm);
            });

            normalizedAnswers.sort();
            if (!promptNorm && normalizedAnswers.length === 0) {
                return '';
            }

            return hashHex128Local(JSON.stringify({
                prompt: promptNorm,
                answers: normalizedAnswers
            }));
        }

        function buildStableQuestionKeyBaseLocal(payload) {
            const prompt = String(payload?.prompt || '');
            const answerTexts = Array.isArray(payload?.answerTexts) ? payload.answerTexts : [];
            const choiceCount = Math.max(0, Number(payload?.choiceCount || 0));
            const textInputCount = Math.max(0, Number(payload?.textInputCount || 0));
            const allowsMultipleAnswers = Boolean(payload?.allowsMultipleAnswers);

            return 'q2_' + hashHex128Local(JSON.stringify({
                promptNorm: normalizeFingerprintTextLocal(prompt),
                questionFingerprint: buildQuestionFingerprintLocal(prompt, answerTexts),
                choiceCount,
                textInputCount,
                allowsMultipleAnswers
            }));
        }

        function matchesQuestionReferenceLocal(candidate, reference) {
            if (!candidate || !reference) {
                return false;
            }

            const candidateKey = collapseWhitespaceLocal(candidate.questionKey);
            const referenceKey = collapseWhitespaceLocal(reference.questionKey);
            if (candidateKey && referenceKey && candidateKey === referenceKey) {
                return true;
            }

            const candidateDomId = collapseWhitespaceLocal(candidate.domId);
            const referenceDomId = collapseWhitespaceLocal(reference.domId);
            if (candidateDomId && referenceDomId && candidateDomId === referenceDomId) {
                return true;
            }

            const candidatePrompt = normalizeTextLocal(candidate.prompt);
            const referencePrompt = normalizeTextLocal(reference.prompt);
            if (!candidatePrompt || !referencePrompt || candidatePrompt !== referencePrompt) {
                return false;
            }

            const candidateOptions = normalizeOptionListLocal(candidate.options);
            const referenceOptions = normalizeOptionListLocal(reference.options);
            if (candidateOptions.length === 0 || referenceOptions.length === 0) {
                return true;
            }

            return candidateOptions.join('|') === referenceOptions.join('|');
        }

        return {
            collapseWhitespace: collapseWhitespaceLocal,
            normalizeText: normalizeTextLocal,
            sanitizeQuestionPrompt: (value) => collapseWhitespaceLocal(value),
            sanitizeAnswerText: (value) => collapseWhitespaceLocal(value),
            deriveOptionAnswerText: deriveOptionAnswerTextLocal,
            buildStableQuestionKeyBase: buildStableQuestionKeyBaseLocal,
            matchesQuestionReference: matchesQuestionReferenceLocal
        };
    }

    function debugSync(event, payload) {
        if (!DEBUG_SYNC_ENABLED) {
            return;
        }

        try {
            console.log('[MooDuSh OpenEdu][' + (isTopFrame ? 'top' : 'iframe') + '] ' + event, payload || {});
        } catch (_) {
            // Ignore console errors.
        }
    }

    function summarizeQuestionsForDebug(questions) {
        return (Array.isArray(questions) ? questions : []).map((question) => ({
            questionKey: question.questionKey,
            prompt: String(question.prompt || '').slice(0, 160),
            isCorrect: Boolean(question.correct),
            hasVerifiedAnswer: Boolean(question.hasVerifiedAnswer),
            selectedAnswers: (Array.isArray(question.options) ? question.options : [])
                .filter((option) => option.selected)
                .map((option) => ({
                    answerKey: option.answerKey,
                    answerText: option.answerText,
                    selected: Boolean(option.selected),
                    markedCorrect: Boolean(option.correct),
                    markedIncorrect: Boolean(option.incorrect)
                })),
            markedCorrectAnswers: (Array.isArray(question.options) ? question.options : [])
                .filter((option) => option.correct)
                .map((option) => ({
                    answerKey: option.answerKey,
                    answerText: option.answerText
                })),
            markedIncorrectAnswers: (Array.isArray(question.options) ? question.options : [])
                .filter((option) => option.incorrect)
                .map((option) => ({
                    answerKey: option.answerKey,
                    answerText: option.answerText
                }))
        }));
    }

    function requestTopContext() {
        if (isTopFrame) return Promise.resolve(null);
        if (window.__PARAMEXT_TOP_CONTEXT) return Promise.resolve(window.__PARAMEXT_TOP_CONTEXT);
        if (_topContextPromise) return _topContextPromise;
        _topContextPromise = new Promise(resolve => {
            let handled = false;
            const listener = (event) => {
                if (event.data && event.data.type === 'PARAMEXT_OPENEDU_CONTEXT_REPLY') {
                    window.removeEventListener('message', listener);
                    window.__PARAMEXT_TOP_CONTEXT = event.data.context;
                    handled = true;
                    resolve(event.data.context);
                }
            };
            window.addEventListener('message', listener);
            try { window.top.postMessage({ type: 'PARAMEXT_OPENEDU_CONTEXT_REQUEST' }, '*'); } catch (e) {}
            setTimeout(() => {
                if (!handled) {
                    window.removeEventListener('message', listener);
                    resolve(null);
                }
            }, 1500);
        });
        return _topContextPromise;
    }

    window.addEventListener('message', (event) => {
        if (!event.data || typeof event.data.type !== 'string') return;

        if (isTopFrame) {
            if (event.data.type === 'PARAMEXT_OPENEDU_CONTEXT_REQUEST') {
                try {
                    event.source.postMessage({
                        type: 'PARAMEXT_OPENEDU_CONTEXT_REPLY',
                        context: Object.assign({}, getCourseContext(true), {
                            courseVerticals: openeduCourseVerticals
                        })
                    }, '*');
                } catch (e) {}
            } else if (event.data.type === 'PARAMEXT_OPENEDU_QUESTIONS_SYNC') {
                updateTopFrameIframeSnapshot(event);
                debugSync('top_received_iframe_sync', {
                    questionCount: Array.isArray(topFrameIframeQuestions) ? topFrameIframeQuestions.length : 0,
                    statKeys: topFrameIframeStats && typeof topFrameIframeStats === 'object' ? Object.keys(topFrameIframeStats).length : 0,
                    msSinceSequenceNavigation: lastSequenceNavigationAt > 0 ? topFrameIframeSyncAt - lastSequenceNavigationAt : 0,
                    frameCount: topFrameIframeSnapshots.size
                });
                renderStick(topFrameIframeStats, topFrameIframeQuestions);
            } else if (event.data.type === 'PARAMEXT_OPENEDU_STICK_ONLINE') {
                topFrameOnlineState = { online: Boolean(event.data.online), text: String(event.data.text || '') };
                window.__PARAMEXT_TOPFRAME_ONLINE_STATE = topFrameOnlineState;
                debugSync('top_received_iframe_online', topFrameOnlineState);
                setStickOnline(topFrameOnlineState.online, topFrameOnlineState.text);
            } else if (event.data.type === 'PARAMEXT_OPENEDU_NEXT_REQUEST') {
                if (isAutoAdvanceEnabled()) {
                    requestNextSequencePage();
                }
            } else if (event.data.type === 'PARAMEXT_OPENEDU_REFRESH_ACTIVE_TAB_REQUEST') {
                scheduleActiveTabPostSubmitRefresh(String(event.data.source || 'iframe-request'));
            }
        } else if (event.data.type === 'PARAMEXT_OPENEDU_FORCE_SYNC') {
            if (!settings) {
                setTimeout(() => {
                    if (settings) {
                        scheduleCycle(true, String(event.data.source || 'top-force-sync'), { allowNetwork: true });
                    }
                }, 500);
                return;
            }
            scheduleCycle(true, String(event.data.source || 'top-force-sync'), { allowNetwork: true });
        } else if (event.data.type === 'PARAMEXT_OPENEDU_SCROLL_QUESTION') {
            const reference = event.data.question || {
                questionKey: event.data.questionKey,
                domId: event.data.domId || '',
                prompt: event.data.prompt || ''
            };
            let question = findQuestionByReference(iframeQuestionsCache, reference);
            if (!question) {
                iframeQuestionsCache = parseQuestions();
                question = findQuestionByReference(iframeQuestionsCache, reference);
            }
            if (question) {
                scrollToQuestion(question);
            }
        } else if (event.data.type === 'PARAMEXT_APPLY_ANSWERS' || event.data.type === 'PARAMEXT_APPLY_ANSWER') {
            const reference = event.data.question || {
                questionKey: event.data.questionKey,
                domId: event.data.domId || '',
                prompt: event.data.prompt || ''
            };
            const answers = event.data.type === 'PARAMEXT_APPLY_ANSWER'
                ? [event.data.answer]
                : (Array.isArray(event.data.answers) ? event.data.answers : []);
            const mode = typeof event.data.mode === 'string' ? event.data.mode : 'add';

            debugSync('iframe_apply_answers_command', {
                questionKey: reference?.questionKey || '',
                answerCount: answers.length,
                mode
            });

            let question = findQuestionByReference(iframeQuestionsCache, reference);
            if (!question) {
                iframeQuestionsCache = parseQuestions();
                question = findQuestionByReference(iframeQuestionsCache, reference);
            }

            if (question) {
                applyAnswersToQuestion(question, answers, mode);
                return;
            }

            broadcastApplyMessageToChildFrames(event.data);
        }
    });

    function textOf(node) {
        if (!node) {
            return '';
        }

        if (node instanceof Element) {
            const clone = node.cloneNode(true);
            clone.querySelectorAll([
                PARAMEXT_WIDGET_SELECTOR,
                'script',
                'style',
                'noscript',
                'template',
                'link',
                'meta',
                'button',
                '[hidden]',
                '[aria-hidden="true"]',
                '.moodush-openedu-inline-menu',
                '.MathJax_Preview',
                '.MJX_Assistive_MathML',
                'mjx-assistive-mml'
            ].join(',')).forEach((item) => item.remove());
            return (clone.textContent || '').replace(/\s+/g, ' ').trim();
        }

        return (node.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function collapseWhitespace(value) {
        if (typeof openeduShared.collapseWhitespace === 'function') {
            return openeduShared.collapseWhitespace(value);
        }
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function normalizeText(value) {
        if (typeof openeduShared.normalizeText === 'function') {
            return openeduShared.normalizeText(value);
        }
        return collapseWhitespace(value).toLowerCase();
    }

    function collectPromptMediaTokens(node) {
        if (!(node instanceof Element)) {
            return [];
        }

        const tokens = [];
        const seen = new Set();
        node.querySelectorAll('img, svg, canvas, object, embed').forEach((mediaNode) => {
            if (!(mediaNode instanceof Element)) {
                return;
            }

            const tag = mediaNode.tagName.toLowerCase();
            const label = collapseWhitespace(
                mediaNode.getAttribute('alt')
                || mediaNode.getAttribute('title')
                || mediaNode.getAttribute('aria-label')
                || ''
            );
            const rawSrc = collapseWhitespace(
                mediaNode.getAttribute('src')
                || mediaNode.getAttribute('data-src')
                || mediaNode.getAttribute('href')
                || mediaNode.getAttribute('xlink:href')
                || mediaNode.getAttribute('data')
                || ''
            );

            let token = label;
            if (!token && rawSrc) {
                const cleanSrc = rawSrc.split('#')[0].split('?')[0];
                const parts = cleanSrc.split('/').filter(Boolean);
                token = parts[parts.length - 1] || cleanSrc;
            }
            if (!token && (tag === 'svg' || tag === 'canvas')) {
                token = buildMediaNodeSignature(mediaNode) || tag;
            }

            if (token) {
                const full = tag + ':' + token;
                if (!seen.has(full)) {
                    seen.add(full);
                    tokens.push(full);
                }
            }
        });

        return tokens;
    }

    function promptTextOf(node) {
        const text = textOf(node);
        const tokens = collectPromptMediaTokens(node);
        if (!text && tokens.length === 0) {
            return '';
        }
        return collapseWhitespace([text, ...tokens].filter(Boolean).join(' '));
    }

    function sanitizeQuestionPromptText(value, answerTexts) {
        if (typeof openeduShared.sanitizeQuestionPrompt === 'function') {
            return openeduShared.sanitizeQuestionPrompt(value, answerTexts);
        }
        return collapseWhitespace(value);
    }

    function sanitizeAnswerText(value) {
        if (typeof openeduShared.sanitizeAnswerText === 'function') {
            return openeduShared.sanitizeAnswerText(value);
        }
        return collapseWhitespace(value);
    }

    function hash(input) {
        let value = 0;
        const source = String(input || '');
        for (let i = 0; i < source.length; i += 1) {
            value = ((value << 5) - value) + source.charCodeAt(i);
            value |= 0;
        }
        return String(Math.abs(value));
    }

    function hashStableToken(input) {
        try {
            let value = 0xcbf29ce484222325n;
            const prime = 0x100000001b3n;
            const source = String(input || '');
            for (let i = 0; i < source.length; i += 1) {
                value ^= BigInt(source.charCodeAt(i));
                value = BigInt.asUintN(64, value * prime);
            }
            return value.toString(16).padStart(16, '0');
        } catch (_) {
            return hash(input);
        }
    }

    function buildStableQuestionKeyBase(payload) {
        if (typeof openeduShared.buildStableQuestionKeyBase === 'function') {
            return openeduShared.buildStableQuestionKeyBase(payload);
        }
        return localOpeneduShared.buildStableQuestionKeyBase(payload);
    }

    function delay(ms) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }

    function getParticipantKey() {
        if (participantKeyCache) {
            return participantKeyCache;
        }

        try {
            const existing = String(localStorage.getItem(PARTICIPANT_KEY_STORAGE) || '').trim();
            if (existing) {
                participantKeyCache = existing;
                return participantKeyCache;
            }

            const generated = 'p_' + hash(
                location.host + '|' +
                (navigator.userAgent || '') + '|' +
                String(Date.now()) + '|' +
                String(Math.random())
            );
            localStorage.setItem(PARTICIPANT_KEY_STORAGE, generated);
            participantKeyCache = generated;
            return participantKeyCache;
        } catch (_) {
            participantKeyCache = 'p_' + hash(location.host + '|' + String(Date.now()));
            return participantKeyCache;
        }
    }

    function canUseContentFallback() {
        return Date.now() >= contentFallbackBlockedUntil;
    }

    function blockContentFallback(reason) {
        contentFallbackBlockedUntil = Date.now() + CONTENT_FALLBACK_BLOCK_MS;
        contentFallbackBlockedReason = String(reason || 'content_fallback_blocked');
        debugSync('content_fallback_blocked', {
            reason: contentFallbackBlockedReason,
            blockedUntil: contentFallbackBlockedUntil
        });
    }

    function escapeSelector(value) {
        const raw = String(value || '');
        if (globalThis.CSS && typeof globalThis.CSS.escape === 'function') {
            return globalThis.CSS.escape(raw);
        }
        return raw.replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~\s])/g, '\\$1');
    }

    function normalizeApiBaseUrl() {
        const raw = settings?.backend?.openedu?.apiBaseUrl || settings?.backend?.apiBaseUrl;
        if (typeof raw !== 'string') {
            return '';
        }
        return raw.trim().replace(/\/$/, '');
    }

    function openeduApiPrefix() {
        return settings?.openedu?.backendVersion === 'v1' ? '/v1' : '/v2';
    }

    function getAuthHeaders(withJsonContentType) {
        const token = settings?.backend?.openedu?.apiToken || settings?.backend?.apiToken || '';
        const headers = {};
        if (withJsonContentType) {
            headers['Content-Type'] = 'application/json';
        }
        if (token.length > 0) {
            headers.Authorization = 'Bearer ' + token;
            headers['X-API-Token'] = token;
        }
        return headers;
    }

    function getOpeneduApiToken() {
        return collapseWhitespace(settings?.backend?.openedu?.apiToken || settings?.backend?.apiToken || '');
    }

    function hasOpeneduApiToken() {
        return getOpeneduApiToken().length > 0;
    }

    function getClientId() {
        try {
            let value = localStorage.getItem('paramExtClientId') || '';
            if (!value) {
                value = 'client_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
                localStorage.setItem('paramExtClientId', value);
            }
            return value;
        } catch (_) {
            return 'client_ephemeral';
        }
    }

    function getClientMeta() {
        const buildConfig = window.ParamExtBuildConfig || {};
        return {
            platform: 'openedu',
            extensionVersion: chrome.runtime?.getManifest?.().version || 'unknown',
            buildId: String(buildConfig.buildId || 'local-dev'),
            parserVersion: OPENEDU_PARSER_VERSION,
            clientId: getClientId(),
            sessionId: frameSyncId,
            channel: String(buildConfig.buildChannel || 'local')
        };
    }

    function isDebugOverlayEnabled() {
        return Boolean(settings?.diagnostics?.openeduDebugOverlay);
    }

    async function refreshCourseDiscovery(force) {
        if (!isTopFrame || !window.ParamExtOpeneduCourseApi || typeof window.ParamExtOpeneduCourseApi.discoverCurrentCourse !== 'function') {
            return;
        }
        const now = Date.now();
        if (!force && openeduCourseVerticals.length > 0 && now - lastCourseDiscoveryAt < 120000) {
            return;
        }
        try {
            const result = await window.ParamExtOpeneduCourseApi.discoverCurrentCourse();
            openeduCourseVerticals = Array.isArray(result?.verticals) ? result.verticals : [];
            lastCourseDiscoveryAt = now;
            debugSync('course_discovery_complete', {
                courseId: result?.courseId || '',
                verticalCount: openeduCourseVerticals.length
            });
        } catch (error) {
            debugSync('course_discovery_failed', {
                error: error && error.message ? String(error.message) : 'unknown'
            });
        }
    }

    function decodeUrlTextSafe(value) {
        const raw = String(value || '');
        try {
            return decodeURIComponent(raw);
        } catch (_) {
            return raw;
        }
    }

    function extractOpeneduBlockId(value) {
        const courseApi = window.ParamExtOpeneduCourseApi || {};
        if (typeof courseApi.extractBlockId !== 'function') {
            return '';
        }
        const raw = String(value || '');
        return courseApi.extractBlockId(raw) || courseApi.extractBlockId(decodeUrlTextSafe(raw));
    }

    function findOpeneduCourseId(value) {
        const courseApi = window.ParamExtOpeneduCourseApi || {};
        if (typeof courseApi.findCourseId !== 'function') {
            return '';
        }
        const raw = String(value || '');
        return courseApi.findCourseId(raw) || courseApi.findCourseId(decodeUrlTextSafe(raw));
    }

    function courseIdFromBlockId(blockId) {
        const match = String(blockId || '').match(/^block-v1:([^+]+)\+([^+]+)\+([^+]+)\+/);
        return match ? ('course-v1:' + match[1] + '+' + match[2] + '+' + match[3]) : '';
    }

    function getCourseRefForQuestion(question) {
        const source = String(question?.sourcePath || location.href || '');
        const verticalId = extractOpeneduBlockId(source)
            || extractOpeneduBlockId(location.href)
            || extractOpeneduBlockId(document.referrer || '');
        const courseId = findOpeneduCourseId(location.href)
            || findOpeneduCourseId(source)
            || findOpeneduCourseId(document.referrer || '')
            || courseIdFromBlockId(verticalId);
        const topContextVerticals = Array.isArray(window.__PARAMEXT_TOP_CONTEXT?.courseVerticals)
            ? window.__PARAMEXT_TOP_CONTEXT.courseVerticals
            : [];
        const knownVerticals = openeduCourseVerticals.length > 0 ? openeduCourseVerticals : topContextVerticals;
        const matched = knownVerticals.find((item) => item.verticalId === verticalId)
            || {};
        const courseMatch = matched.courseId
            ? matched
            : (knownVerticals.find((item) => item.courseId === courseId) || {});
        return {
            courseId: matched.courseId || courseId,
            courseTitle: matched.courseTitle || courseMatch.courseTitle || document.title || '',
            chapterId: matched.chapterId || '',
            chapterTitle: matched.chapterTitle || '',
            sequentialId: matched.sequentialId || '',
            sequentialTitle: matched.sequentialTitle || '',
            verticalId: matched.verticalId || verticalId,
            verticalTitle: matched.verticalTitle || '',
            problemId: question?.domId || '',
            frameUrl: source
        };
    }

    function enrichQuestionForV2(question) {
        const answers = Array.isArray(question?.options) ? question.options : [];
        const stableAnswers = answers
            .filter((option) => option.inputType !== 'text')
            .map((option) => sanitizeAnswerText(option.answerText))
            .filter(Boolean);
        const prompt = sanitizeQuestionPromptText(question?.prompt || '', stableAnswers);
        const hasText = answers.some((option) => option.inputType === 'text');
        const hasCheckbox = answers.some((option) => option.inputType === 'checkbox');
        const hasRadio = answers.some((option) => option.inputType === 'radio');
        const hasDragTable = answers.some((option) => option.inputType === 'drag-table' || option.inputType === 'matching-table');
        const hasDragOrder = answers.some((option) => option.inputType === 'drag-order');
        const hasSelect = answers.some((option) => option.inputType === 'select');
        const questionType = hasDragOrder
            ? 'drag_order'
            : (hasDragTable
                ? 'drag_table'
                : (hasCheckbox
                    ? 'multiple_choice'
                    : (hasRadio ? 'single_choice' : (hasText ? 'text_input' : (hasSelect ? 'select' : 'unknown')))));
        const questionFingerprint = typeof openeduShared.buildQuestionFingerprint === 'function'
            ? openeduShared.buildQuestionFingerprint(prompt, stableAnswers)
            : '';
        const parseConfidence = prompt && questionType !== 'unknown'
            ? Math.min(1, 0.55 + (stableAnswers.length > 0 || hasText ? 0.35 : 0))
            : 0.25;
        return {
            questionType,
            questionFingerprint,
            parserSource: question?.fromVirtualContent ? 'virtual_dom' : 'live_dom',
            parseConfidence,
            rawType: '',
            course: getCourseRefForQuestion(question)
        };
    }

    function maybeLogBackendIssue(kind, payload) {
        if (!window.ParamExtTelemetry || typeof window.ParamExtTelemetry.push !== 'function') {
            return;
        }

        const signature = kind + '|' + String(payload?.path || '') + '|' + String(payload?.status || 0) + '|' + String(payload?.error || '');
        const now = Date.now();
        if (signature === lastBackendIssueSignature && now - lastBackendIssueAt < BACKEND_LOG_THROTTLE_MS) {
            return;
        }

        lastBackendIssueSignature = signature;
        lastBackendIssueAt = now;
        window.ParamExtTelemetry.push(kind, payload, 'openedu-content');
    }

    function errorMessageFromPayload(raw) {
        if (!raw) {
            return '';
        }

        if (typeof raw === 'string') {
            return raw;
        }

        if (typeof raw.detail === 'string') {
            return raw.detail;
        }

        if (typeof raw.message === 'string') {
            return raw.message;
        }

        return '';
    }

    async function requestViaBackground(request) {
        return await new Promise((resolve) => {
            try {
                if (!chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
                    resolve(null);
                    return;
                }
            } catch (_) {
                resolve(null);
                return;
            }

            chrome.runtime.sendMessage({
                type: 'PARAMEXT_HTTP',
                request
            }, (response) => {
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                    resolve(null);
                    return;
                }
                resolve(response || null);
            });
        });
    }

    async function requestJson(method, path, body, logErrors) {
        const baseUrl = normalizeApiBaseUrl();
        if (!baseUrl) {
            debugSync('http_skip_no_api_base_url', { method, path });
            return {
                ok: false,
                status: 0,
                error: 'api_base_url_missing',
                data: null
            };
        }

        const timeoutMs = Number(settings?.backend?.openedu?.requestTimeoutMs || settings?.backend?.requestTimeoutMs || 4000);
        const request = {
            url: baseUrl + path,
            method,
            headers: getAuthHeaders(body !== null),
            timeoutMs
        };

        if (body !== null) {
            request.body = JSON.stringify(body);
        }

        debugSync('http_request', {
            method,
            path,
            url: request.url,
            timeoutMs,
            hasBody: body !== null,
            bodyBytes: request.body ? request.body.length : 0
        });

        let bgStatus0Hint = '';
        const bgResponse = await requestViaBackground(request);
        if (bgResponse) {
            if (!bgResponse.ok) {
                const bgError = String(bgResponse.error || errorMessageFromPayload(bgResponse.json) || bgResponse.text || ('http_' + String(bgResponse.status || 0))).trim();
                const result = {
                    ok: false,
                    status: Number(bgResponse.status || 0),
                    error: bgError || 'request_failed',
                    data: null
                };

                if (result.status === 0) {
                    bgStatus0Hint = result.error || String(bgResponse.responseType || 'status_0');
                    debugSync('http_background_status_0_fallback', {
                        method,
                        path,
                        status: result.status,
                        error: result.error,
                        responseType: bgResponse.responseType || '',
                        errorName: bgResponse.errorName || '',
                        isTimeout: Boolean(bgResponse.isTimeout)
                    });

                    if (!canUseContentFallback()) {
                        return {
                            ok: false,
                            status: 0,
                            error: 'background_status_0: ' + bgStatus0Hint + ' | content_blocked=' + contentFallbackBlockedReason,
                            data: null
                        };
                    }
                } else {
                    if (logErrors) {
                        maybeLogBackendIssue('openedu_backend_error', {
                            method,
                            path,
                            status: result.status,
                            error: result.error,
                            via: 'background'
                        });
                    }
                    debugSync('http_response', {
                        method,
                        path,
                        via: 'background',
                        ok: false,
                        status: result.status,
                        error: result.error
                    });
                    return result;
                }
            }

            if (bgResponse.ok) {
                debugSync('http_response', {
                    method,
                    path,
                    via: 'background',
                    ok: true,
                    status: Number(bgResponse.status || 200)
                });
                return {
                    ok: true,
                    status: Number(bgResponse.status || 200),
                    error: '',
                    data: bgResponse.json && typeof bgResponse.json === 'object' ? bgResponse.json : null
                };
            }
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(baseUrl + path, {
                method,
                headers: getAuthHeaders(body !== null),
                body: body !== null ? JSON.stringify(body) : undefined,
                signal: controller.signal
            });

            let text = '';
            try {
                text = await response.text();
            } catch (_) {
                text = '';
            }

            let data = null;
            if (text) {
                try {
                    data = JSON.parse(text);
                } catch (_) {
                    data = null;
                }
            }

            if (!response.ok) {
                let contentError = errorMessageFromPayload(data) || text || ('http_' + String(response.status || 0));
                if (Number(response.status || 0) === 0 && bgStatus0Hint) {
                    contentError = 'status_0_content | bg=' + bgStatus0Hint;
                }

                const result = {
                    ok: false,
                    status: Number(response.status || 0),
                    error: contentError,
                    data: null
                };

                if (logErrors) {
                    maybeLogBackendIssue('openedu_backend_error', {
                        method,
                        path,
                        status: result.status,
                        error: result.error,
                        via: 'content'
                    });
                }
                debugSync('http_response', {
                    method,
                    path,
                    via: 'content',
                    ok: false,
                    status: result.status,
                    error: result.error,
                    backgroundHint: bgStatus0Hint
                });

                if (result.status === 0 && bgStatus0Hint) {
                    blockContentFallback(result.error || bgStatus0Hint);
                }
                return result;
            }

            debugSync('http_response', {
                method,
                path,
                via: 'content',
                ok: true,
                status: Number(response.status || 200)
            });
            contentFallbackBlockedUntil = 0;
            contentFallbackBlockedReason = '';
            return {
                ok: true,
                status: Number(response.status || 200),
                error: '',
                data
            };
        } catch (error) {
            const rawMessage = error && error.message ? String(error.message) : '';
            const fallbackMessage = controller.signal.aborted ? 'request_timeout' : 'network_error';
            const message = rawMessage || fallbackMessage;
            const combinedMessage = bgStatus0Hint ? (message + ' | bg=' + bgStatus0Hint) : message;
            const result = {
                ok: false,
                status: 0,
                error: combinedMessage,
                data: null
            };

            if (logErrors) {
                maybeLogBackendIssue('openedu_backend_error', {
                    method,
                    path,
                    status: 0,
                    error: combinedMessage,
                    via: 'content'
                });
            }

            debugSync('http_response', {
                method,
                path,
                via: 'content',
                ok: false,
                status: 0,
                error: combinedMessage,
                backgroundHint: bgStatus0Hint
            });

            if (bgStatus0Hint) {
                blockContentFallback(combinedMessage || bgStatus0Hint);
            }

            return result;
        } finally {
            clearTimeout(timer);
        }
    }

    async function postWithRetry(path, body, retries) {
        let last = {
            ok: false,
            status: 0,
            error: 'request_failed',
            data: null
        };

        if (isSyncBlocked()) {
            return {
                ok: false,
                status: 0,
                error: syncBlockedReason || 'sync_blocked',
                data: null
            };
        }

        for (let attempt = 0; attempt <= retries; attempt += 1) {
            if (attempt > 0) {
                const delayMs = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)] || 300;
                await delay(delayMs);
            }

            last = await requestJson('POST', path, body, true);
            if (last.ok) {
                return last;
            }

            if (last.status === 401 || last.status === 403) {
                blockSync('auth_' + String(last.status), AUTH_FAILURE_COOLDOWN_MS);
                break;
            }

            if (last.status === 0 && String(last.error || '').includes('background_status_0')) {
                // Persistent background transport failures are not fixed by immediate retries.
                break;
            }

            if (last.status >= 400 && last.status < 500 && last.status !== 429) {
                break;
            }
        }

        return last;
    }

    function blockSync(reason, durationMs) {
        syncBlockedReason = String(reason || 'sync_blocked');
        syncBlockedUntil = Date.now() + Math.max(5000, Number(durationMs || AUTH_FAILURE_COOLDOWN_MS));
    }

    function clearSyncBlock() {
        syncBlockedUntil = 0;
        syncBlockedReason = '';
    }

    function isSyncBlocked() {
        return syncBlockedUntil > Date.now();
    }

    function applyWandsVisibilityToDocument(doc, visible) {
        if (!doc || !doc.documentElement) {
            return;
        }
        doc.documentElement.classList.toggle('moodush-openedu-hide-wands', !visible);
    }

    async function persistWandsVisibility(value) {
        try {
            await chrome.storage.local.set({ [WAND_VISIBILITY_KEY]: Boolean(value) });
        } catch (_) {
            // Ignore persistence errors.
        }
    }

    function setWandsHidden(hidden, persist) {
        wandsHidden = Boolean(hidden);
        const visible = !wandsHidden;

        const docs = getSearchDocuments();
        docs.forEach((doc) => {
            applyWandsVisibilityToDocument(doc, visible);
        });
        applyWandsVisibilityToDocument(document, visible);

        if (!visible) {
            panelVisible = false;
            if (stickRoot) {
                stickRoot.classList.add('hidden');
            }
            if (wandToggle) {
                wandToggle.classList.remove('active');
            }
        }

        if (persist) {
            persistWandsVisibility(wandsHidden);
        }
    }

    async function loadWandsHiddenState() {
        try {
            const payload = await chrome.storage.local.get(WAND_VISIBILITY_KEY);
            return Boolean(payload && payload[WAND_VISIBILITY_KEY]);
        } catch (_) {
            return false;
        }
    }

    function scheduleCycle(force, source, options) {
        const allowNetwork = options?.allowNetwork !== false;
        if (cyclesStopped || scheduledCycleTimer) {
            scheduledCycleForce = scheduledCycleForce || Boolean(force);
            scheduledCycleAllowNetwork = scheduledCycleAllowNetwork || allowNetwork;
            return;
        }

        const now = Date.now();
        const reason = String(source || 'generic');
        if (!force) {
            if (reason === 'message') {
                if (now - lastMessageTriggerAt < MESSAGE_TRIGGER_THROTTLE_MS) {
                    return;
                }
                lastMessageTriggerAt = now;
            }

            if (reason === 'mutation') {
                if (now - lastMutationTriggerAt < MUTATION_TRIGGER_THROTTLE_MS) {
                    return;
                }
                lastMutationTriggerAt = now;
            }
        }

        scheduledCycleForce = scheduledCycleForce || Boolean(force);
        scheduledCycleAllowNetwork = scheduledCycleAllowNetwork || allowNetwork;

        scheduledCycleTimer = setTimeout(() => {
            scheduledCycleTimer = 0;
            const runForce = scheduledCycleForce;
            const runAllowNetwork = scheduledCycleAllowNetwork;
            scheduledCycleForce = false;
            scheduledCycleAllowNetwork = false;
            runStickCycle(Boolean(runForce), { source: reason, allowNetwork: runAllowNetwork });
        }, 350);
    }

    function quickRerender() {
        if (!lastMergedStatsByQuestion) {
            return;
        }
        const questions = parseQuestions();
        if (questions.length === 0) {
            return;
        }
        iframeQuestionsCache = questions;
        const mergedStatsByQuestion = mergeStatsByQuestion(
            null,
            null,
            questions,
            lastMergedStatsByQuestion,
            lastRenderedQuestions,
        );
        renderInlineWands(mergedStatsByQuestion, questions);
        lastMergedStatsByQuestion = mergedStatsByQuestion;
        lastRenderedQuestions = snapshotQuestionReferences(questions);
    }

    function shouldHandleDomRefreshTrigger() {
        const now = Date.now();
        return lastMeaningfulQuestionsAt === 0
            || (now - lastMeaningfulQuestionsAt) <= TRANSIENT_EMPTY_QUESTIONS_GRACE_MS
            || (now - lastSubmitActionAt) <= ACTIVE_TAB_REFRESH_AFTER_SUBMIT_WINDOW_MS;
    }

    function scheduleBootstrapSyncs() {
        BOOTSTRAP_SYNC_DELAYS_MS.forEach((delayMs) => {
            setTimeout(() => {
                if (cyclesStopped) {
                    return;
                }

                if (lastMeaningfulQuestionsAt === 0 || !lastStatsResponse) {
                    scheduleCycle(true, 'bootstrap', { allowNetwork: true });
                }
            }, delayMs);
        });
    }

    function schedulePostSubmitSyncs() {
        POST_SUBMIT_SYNC_DELAYS_MS.forEach((delayMs) => {
            setTimeout(() => {
                scheduleCycle(true, 'submit-delay', { allowNetwork: true });
            }, delayMs);
        });
    }

    function describeRequestError(result) {
        if (!result || result.ok) {
            return '';
        }

        if (result.error === 'auth_401' || result.error === 'auth_403') {
            return result.error === 'auth_401' ? '401 (токен)' : '403 (доступ)';
        }

        if (result.error === 'sync_blocked') {
            return 'sync блокирован';
        }

        if (result.error === 'api_base_url_missing') {
            return 'не указан API URL';
        }

        if (result.status === 401) {
            return '401 (токен)';
        }

        if (result.status === 403) {
            return '403 (доступ)';
        }

        if (result.status === 404) {
            return '404 (роут)';
        }

        if (result.status > 0) {
            return String(result.status);
        }

        return String(result.error || 'network');
    }

    async function probeBackendOnline() {
        const baseUrl = normalizeApiBaseUrl();
        if (!baseUrl) {
            return false;
        }

        const probePaths = ['/healthz', '/health', openeduApiPrefix() + '/status'];
        let hasHttpResponse = false;

        for (const path of probePaths) {
            const result = await requestJson('GET', path, null, false);
            if (result.ok) {
                return true;
            }

            if (result.status > 0) {
                hasHttpResponse = true;
                if (result.status !== 404) {
                    return true;
                }
            }
        }

        return hasHttpResponse;
    }

    function getCourseContext(forceTop = false) {
        if (!forceTop && !isTopFrame && window.__PARAMEXT_TOP_CONTEXT) {
            return window.__PARAMEXT_TOP_CONTEXT;
        }

        let path = location.pathname;
        let fullUrl = location.href;

        if (document.referrer && !extractOpeneduBlockId(location.href)) {
            try {
                const ref = new URL(document.referrer);
                if (HOST_RE.test(ref.hostname)) {
                    path = ref.pathname;
                    fullUrl = ref.href;
                }
            } catch (_) {
                // Keep current frame URL.
            }
        }

        const titleNode = document.querySelector('h1, h2, h3');
        const title = textOf(titleNode) || document.title;

        return {
            host: location.host,
            path,
            fullUrl,
            title,
            testKey: hash(location.host + '|' + path),
            participantKey: getParticipantKey()
        };
    }

    function collectSameOriginDocuments(rootDoc, out, seen) {
        if (!rootDoc || seen.has(rootDoc)) {
            return;
        }
        seen.add(rootDoc);
        out.push(rootDoc);

        const frames = rootDoc.querySelectorAll('iframe, frame');
        frames.forEach((frame) => {
            let childDoc = null;
            try {
                childDoc = frame.contentDocument;
            } catch (_) {
                childDoc = null;
            }

            if (childDoc) {
                collectSameOriginDocuments(childDoc, out, seen);
            }
        });
    }

    function getProblemContentHosts(rootDoc) {
        if (!rootDoc || typeof rootDoc.querySelectorAll !== 'function') {
            return [];
        }
        return Array.from(rootDoc.querySelectorAll('[data-content]'))
            .filter((node) => node instanceof HTMLElement);
    }

    function hasLiveProblemContent(host) {
        if (!(host instanceof HTMLElement)) {
            return false;
        }
        return Boolean(host.querySelector(
            QUESTION_INPUT_SELECTOR
            + ', .adv-app[data-initial-data]'
            + ', .wrapper-problem-response'
        ));
    }

    function getVirtualContentDocument(host) {
        if (!(host instanceof HTMLElement) || hasLiveProblemContent(host)) {
            return null;
        }

        const rawContent = host.getAttribute('data-content') || '';
        const decodedContent = decodeHtmlEntities(rawContent);
        if (!decodedContent || decodedContent.indexOf('<') === -1) {
            return null;
        }

        const cached = virtualContentDocsByHost.get(host);
        if (cached && cached.rawContent === rawContent) {
            return cached.doc;
        }

        let parsedDoc = null;
        try {
            parsedDoc = new DOMParser().parseFromString(decodedContent, 'text/html');
        } catch (_) {
            parsedDoc = null;
        }
        if (!parsedDoc || !parsedDoc.body) {
            return null;
        }

        parsedDoc.__PARAMEXT_VIRTUAL_CONTENT = true;
        parsedDoc.__PARAMEXT_SOURCE_PATH = host.ownerDocument?.location?.pathname || location.pathname;
        parsedDoc.__PARAMEXT_HOST_PROBLEM_ID = host.getAttribute('data-problem-id') || host.id || '';
        virtualContentDocsByHost.set(host, { rawContent, doc: parsedDoc });
        return parsedDoc;
    }

    function collectVirtualContentDocuments(rootDoc, out, seen) {
        getProblemContentHosts(rootDoc).forEach((host) => {
            const virtualDoc = getVirtualContentDocument(host);
            if (virtualDoc && !seen.has(virtualDoc)) {
                seen.add(virtualDoc);
                out.push(virtualDoc);
            }
        });
    }

    function getSearchDocuments() {
        const seen = new Set([document]);
        const docs = [document];
        collectVirtualContentDocuments(document, docs, seen);

        if (!isTopFrame) {
            return docs;
        }

        return docs;
    }

    function isQuestionRootCandidate(root) {
        if (!(root instanceof HTMLElement)) {
            return false;
        }

        if (root.matches('table.drag-table, table.answerPlaceStudent') || root.querySelector('table.drag-table, table.answerPlaceStudent .dragAnswer, .dragAnswer')) {
            return true;
        }

        const controlCount = root.querySelectorAll(QUESTION_INPUT_SELECTOR).length;
        if (controlCount === 0) {
            return false;
        }

        if (root.matches('table') || root.querySelector('table')) {
            return true;
        }

        if (root.querySelector('legend, .problem-header, .problem-group-label, .problem-title, .question-title, .choicegroup, .wrapper-problem-response')) {
            return true;
        }

        return root.querySelectorAll(OPTION_LABEL_SELECTOR).length > 0;
    }

    function looksLikeMatchingTableAnswerValue(value) {
        const decoded = decodeHtmlEntities(String(value || ''));
        return /[{\[]/.test(decoded)
            && /["']?answer["']?\s*:/.test(decoded)
            && /\{/.test(decoded);
    }

    function findMatchingTableProblemRoot(control) {
        if (!(control instanceof HTMLInputElement)) {
            return null;
        }
        if (!looksLikeMatchingTableAnswerValue(control.value || '')) {
            return null;
        }

        let current = control.parentElement;
        while (current && current !== current.ownerDocument.documentElement) {
            if (
                current instanceof HTMLElement
                && getMatchingTableApp(current)
            ) {
                return current;
            }
            current = current.parentElement;
        }

        const container = control.closest('[data-problem-id], .problem, .xblock-student_view-problem, .problems-wrapper');
        return container instanceof HTMLElement ? container : null;
    }

    function findTableQuestionRoot(control) {
        if (!(control instanceof Element)) {
            return null;
        }

        const table = control.closest('table');
        if (!(table instanceof HTMLElement)) {
            return null;
        }

        const container = table.closest('.wrapper-problem-response, fieldset, [role="group"], [data-problem-id], .problem, .xblock-student_view-problem, .problems-wrapper');
        if (container instanceof HTMLElement && container.querySelectorAll(QUESTION_INPUT_SELECTOR).length <= 80) {
            return container;
        }

        return table;
    }

    function findDragMatchingTableProblemRoot(element) {
        if (!(element instanceof Element)) {
            return null;
        }

        const table = element.matches('table.drag-table, table.answerPlaceStudent')
            ? element
            : element.closest('table.drag-table, table.answerPlaceStudent');
        const anchor = table instanceof HTMLElement ? table : element;
        const container = anchor.closest('.xblock-student_view-problem, [data-problem-id], .problems-wrapper')
            || anchor.closest('.problem, .vert');
        if (container instanceof HTMLElement && container.querySelector('table.drag-table, table.answerPlaceStudent .dragAnswer, .dragAnswer')) {
            return container;
        }

        return table instanceof HTMLElement ? table : null;
    }

    function findQuestionRoot(control) {
        if (!(control instanceof Element)) {
            return null;
        }

        const dragTableRoot = findDragMatchingTableProblemRoot(control);
        if (dragTableRoot) {
            return dragTableRoot;
        }

        const matchingTableRoot = findMatchingTableProblemRoot(control);
        if (matchingTableRoot) {
            return matchingTableRoot;
        }

        const tableRoot = findTableQuestionRoot(control);
        if (tableRoot) {
            return tableRoot;
        }

        let current = control;
        while (current && current !== current.ownerDocument.documentElement) {
            if (current instanceof HTMLElement && current.matches(QUESTION_ROOT_SELECTOR) && isQuestionRootCandidate(current)) {
                return current;
            }
            current = current.parentElement;
        }

        return null;
    }

    function buildMediaNodeSignature(node) {
        if (!(node instanceof Element)) {
            return '';
        }

        const markup = String(node.outerHTML || '').trim();
        if (!markup) {
            return '';
        }

        const normalized = collapseWhitespace(markup
            .replace(/\s(?:id|class|style|tabindex|role|focusable|aria-[\w-]+|data-[\w-]+)=(?:"[^"]*"|'[^']*')/gi, ''));

        return normalized ? ('h' + hashStableToken(normalized)) : '';
    }

    function collectOptionMediaDescriptors(node) {
        if (!(node instanceof Element)) {
            return [];
        }

        const descriptors = [];
        const mediaNodes = node.querySelectorAll('img, source, video, audio, svg, canvas, object, embed');
        mediaNodes.forEach((mediaNode) => {
            if (!(mediaNode instanceof Element)) {
                return;
            }

            const tag = mediaNode.tagName.toLowerCase();
            const source = collapseWhitespace(
                mediaNode.getAttribute('src')
                || mediaNode.getAttribute('srcset')
                || mediaNode.getAttribute('data-src')
                || mediaNode.getAttribute('poster')
                || mediaNode.getAttribute('data')
                || mediaNode.getAttribute('href')
                || mediaNode.getAttribute('xlink:href')
                || ''
            );
            const needsStructuralSignature = !source || tag === 'svg' || tag === 'canvas';

            descriptors.push({
                kind: tag,
                src: source,
                alt: collapseWhitespace(mediaNode.getAttribute('alt') || ''),
                title: collapseWhitespace(mediaNode.getAttribute('title') || ''),
                ariaLabel: collapseWhitespace(mediaNode.getAttribute('aria-label') || ''),
                signature: needsStructuralSignature ? buildMediaNodeSignature(mediaNode) : ''
            });
        });

        return descriptors;
    }

    function addOptionAlias(aliases, seen, value) {
        const raw = collapseWhitespace(value);
        if (!raw) {
            return;
        }

        const normalized = normalizeText(raw);
        if (!normalized || seen.has(normalized)) {
            return;
        }

        seen.add(normalized);
        aliases.push(raw);
    }

    function getOptionAnswerAliases(label, input, mediaDescriptors, answerText) {
        const aliases = [];
        const seen = new Set();
        const normalizedAnswerText = normalizeText(answerText || '');
        if (normalizedAnswerText) {
            seen.add(normalizedAnswerText);
        }

        addOptionAlias(aliases, seen, label?.getAttribute?.('aria-label') || '');
        addOptionAlias(aliases, seen, label?.getAttribute?.('title') || '');
        if (input instanceof HTMLInputElement) {
            addOptionAlias(aliases, seen, input.value || '');
        }

        const descriptors = Array.isArray(mediaDescriptors) ? mediaDescriptors : [];
        descriptors.forEach((descriptor) => {
            addOptionAlias(aliases, seen, descriptor?.alt || '');
            addOptionAlias(aliases, seen, descriptor?.title || '');
            addOptionAlias(aliases, seen, descriptor?.ariaLabel || '');
        });

        return aliases;
    }

    function getOptionAnswerText(label, input, mediaDescriptors) {
        const rawText = label instanceof HTMLElement ? textOf(label) : '';
        const cleanRawText = normalizeQuestionOptionText(rawText);
        const descriptors = Array.isArray(mediaDescriptors)
            ? mediaDescriptors
            : collectOptionMediaDescriptors(label);
        if (typeof openeduShared.deriveOptionAnswerText === 'function') {
            return openeduShared.deriveOptionAnswerText({
                text: cleanRawText,
                ariaLabel: collapseWhitespace(label?.getAttribute?.('aria-label') || ''),
                title: collapseWhitespace(label?.getAttribute?.('title') || ''),
                inputValue: input instanceof HTMLInputElement ? collapseWhitespace(input.value || '') : '',
                mediaDescriptors: descriptors
            });
        }

        return cleanRawText;
    }

    function decodeHtmlEntities(source) {
        let value = String(source || '');
        for (let i = 0; i < 2; i += 1) {
            const next = value
                .replace(/&quot;/g, '"')
                .replace(/&#34;/g, '"')
                .replace(/&apos;/g, "'")
                .replace(/&#39;/g, "'")
                .replace(/&amp;/g, '&');
            if (next === value) {
                break;
            }
            value = next;
        }
        return value;
    }

    function parseOpenEduDataLiteral(raw) {
        const decoded = decodeHtmlEntities(String(raw || ''));
        if (typeof openeduShared.parsePythonishDataLiteral === 'function') {
            return openeduShared.parsePythonishDataLiteral(decoded);
        }

        try {
            return JSON.parse(decoded);
        } catch (_) {
            return null;
        }
    }

    function getMatchingTableApp(root) {
        if (!(root instanceof HTMLElement)) {
            return null;
        }

        const apps = root.querySelectorAll('.adv-app[data-initial-data]');
        for (const app of apps) {
            if (!(app instanceof HTMLElement)) {
                continue;
            }
            const initialData = parseOpenEduDataLiteral(app.getAttribute('data-initial-data') || '');
            if (
                initialData
                && typeof initialData === 'object'
                && Array.isArray(initialData.table)
                && Array.isArray(initialData.answers)
            ) {
                return app;
            }
        }

        const container = root.closest('[data-problem-id], .problem, .xblock-student_view-problem, .problems-wrapper');
        if (container instanceof HTMLElement && container !== root) {
            const scopedApps = container.querySelectorAll('.adv-app[data-initial-data]');
            for (const scopedApp of scopedApps) {
                if (!(scopedApp instanceof HTMLElement)) {
                    continue;
                }
                const initialData = parseOpenEduDataLiteral(scopedApp.getAttribute('data-initial-data') || '');
                if (
                    initialData
                    && typeof initialData === 'object'
                    && Array.isArray(initialData.table)
                    && Array.isArray(initialData.answers)
                ) {
                    return scopedApp;
                }
            }
        }

        return null;
    }

    function getMatchingTableInput(root) {
        if (!(root instanceof HTMLElement)) {
            return null;
        }
        if (!getMatchingTableApp(root)) {
            return null;
        }

        const textInputs = root.querySelectorAll('input[type="text"], input[type="hidden"]');
        for (const input of textInputs) {
            if (!(input instanceof HTMLInputElement)) {
                continue;
            }
            const parsed = parseOpenEduDataLiteral(input.value || '');
            if (parsed && typeof parsed === 'object' && parsed.answer && typeof parsed.answer === 'object') {
                return input;
            }
        }

        const doc = root.ownerDocument || document;
        const container = root.closest('[data-problem-id], .problem, .xblock-student_view-problem, .problems-wrapper');
        const scope = container instanceof HTMLElement ? container : doc;
        const docInputs = scope.querySelectorAll('input[type="text"], input[type="hidden"]');
        for (const input of docInputs) {
            if (!(input instanceof HTMLInputElement)) {
                continue;
            }
            const parsed = parseOpenEduDataLiteral(input.value || '');
            if (parsed && typeof parsed === 'object' && parsed.answer && typeof parsed.answer === 'object') {
                return input;
            }
        }

        for (const input of docInputs) {
            if (!(input instanceof HTMLInputElement)) {
                continue;
            }
            const type = String(input.type || '').toLowerCase();
            if (type !== 'text' && type !== 'hidden') {
                continue;
            }
            const name = String(input.name || '').trim();
            const id = String(input.id || '').trim();
            if (normalizeText(name) === 'problem_id' || normalizeText(id) === 'problem_id') {
                continue;
            }
            if (name || id || input.closest('.textline, .capa_inputtype, .wrapper-problem-response')) {
                return input;
            }
        }

        return null;
    }

    function getMatchingTableData(root) {
        const app = getMatchingTableApp(root);
        if (!app) {
            return null;
        }

        const initialData = parseOpenEduDataLiteral(app.getAttribute('data-initial-data') || '');
        if (!initialData || typeof initialData !== 'object') {
            return null;
        }

        const input = getMatchingTableInput(root);
        if (!(input instanceof HTMLInputElement)) {
            return null;
        }

        return { app, input, initialData };
    }

    function buildMatchingTableOptions(root) {
        const matchingData = getMatchingTableData(root);
        if (!matchingData || typeof openeduShared.buildMatchingTablePairs !== 'function') {
            return [];
        }

        const candidatePairs = openeduShared.buildMatchingTablePairs(
            matchingData.initialData,
            {},
            true,
        );
        const selectedPairs = openeduShared.buildMatchingTablePairs(
            matchingData.initialData,
            matchingData.input.value || '',
            true,
        );
        const selectedKeys = new Set(selectedPairs
            .filter((pair) => pair.selected)
            .map((pair) => String(pair.cellId || '').trim() + '|' + String(pair.answerId || '').trim()));
        const options = [];
        const seen = new Set();
        const inputName = String(matchingData.input.name || '').trim();
        const inputPath = buildElementPath(root, matchingData.input);

        candidatePairs.forEach((pair, idx) => {
            const answerText = normalizeQuestionOptionText(pair.answerText) || String(pair.answerText || '').trim();
            const cellId = String(pair.cellId || '').trim();
            const answerId = String(pair.answerId || '').trim();
            if (!answerText || !cellId || !answerId) {
                return;
            }

            const dedupeKey = cellId + '|' + answerId;
            if (seen.has(dedupeKey)) {
                return;
            }
            seen.add(dedupeKey);

            options.push({
                answerKey: 'match:' + cellId + ':' + answerId,
                answerText,
                selected: selectedKeys.has(dedupeKey),
                correct: selectedKeys.has(dedupeKey) && isQuestionCorrect(root),
                answerAliases: [pair.answerTitle, pair.cellLabel].filter(Boolean),
                inputId: matchingData.input.id || '',
                inputName,
                groupKey: inputName ? ('matching:' + inputName) : 'matching',
                groupPath: '',
                inputPath,
                inputType: 'matching-table',
                matchingCellId: cellId,
                matchingAnswerId: answerId
            });
        });

        return options;
    }

    function getMatchingTablePrompt(root) {
        const matchingData = getMatchingTableData(root);
        if (!matchingData) {
            return '';
        }

        const content = matchingData.initialData?.content;
        if (!content || typeof content !== 'object') {
            return '';
        }

        return normalizePromptCandidateText(content.body)
            || normalizePromptCandidateText(content.title)
            || normalizePromptLikeText(collapseWhitespace(content.body || content.title || ''));
    }

    function getDragMatchingTableData(root) {
        if (!(root instanceof HTMLElement)) {
            return null;
        }

        const table = root.matches('table.drag-table, table.answerPlaceStudent')
            ? root
            : root.querySelector('table.drag-table, table.answerPlaceStudent');
        if (!(table instanceof HTMLTableElement) || !table.querySelector('td.cell, th.cell')) {
            return null;
        }

        const container = table.closest('.xblock-student_view-problem, [data-problem-id], .problems-wrapper')
            || table.closest('.problem, .vert')
            || root;
        if (!(container instanceof HTMLElement)) {
            return null;
        }

        const cells = Array.from(table.querySelectorAll('td.cell[id], th.cell[id]'))
            .filter((cell) => cell instanceof HTMLTableCellElement);
        const answers = Array.from(container.querySelectorAll('.dragAnswer[id]'))
            .filter((answer) => answer instanceof HTMLElement);
        if (cells.length === 0 || answers.length === 0) {
            return null;
        }

        const answerBank = Array.from(container.querySelectorAll('.answerPlaceStudent'))
            .find((node) => node instanceof HTMLElement && !node.matches('table') && node.querySelector('.dragAnswer'));
        const textarea = container.querySelector('textarea.answer[name="answer"], textarea[name="answer"], textarea.answer');

        return {
            table,
            container,
            cells,
            answers,
            answerBank: answerBank instanceof HTMLElement ? answerBank : null,
            textarea: textarea instanceof HTMLTextAreaElement ? textarea : null
        };
    }

    function getDragMatchingCellLabel(cell) {
        if (!(cell instanceof HTMLTableCellElement)) {
            return '';
        }

        const row = cell.parentElement;
        const cellIndex = getTableCellIndex(cell);
        const rowText = getTableRowHeaderText(row, cellIndex);
        if (rowText) {
            return rowText;
        }

        const table = cell.closest('table');
        return getTableColumnHeaderText(table, row, cellIndex);
    }

    function getDragMatchingAnswerTitle(answerElement) {
        if (!(answerElement instanceof HTMLElement)) {
            return '';
        }
        return normalizeQuestionOptionText(textOf(answerElement));
    }

    function buildDragMatchingAnswerKey(cellId, answerId) {
        return 'drag:' + String(cellId || '') + ':' + String(answerId || '');
    }

    function buildDragMatchingTableOptions(root) {
        const dragData = getDragMatchingTableData(root);
        if (!dragData) {
            return [];
        }

        const options = [];
        const seen = new Set();
        const tablePath = buildElementPath(root, dragData.table);
        const groupKey = 'drag-table:' + (dragData.table.id || tablePath || 'table');
        const wholeTableCorrect = isQuestionCorrect(dragData.container);

        dragData.cells.forEach((cell) => {
            const cellId = String(cell.id || '').trim();
            const cellLabel = getDragMatchingCellLabel(cell);
            if (!cellId) {
                return;
            }

            dragData.answers.forEach((answerElement) => {
                const answerId = String(answerElement.id || '').trim();
                const answerTitle = getDragMatchingAnswerTitle(answerElement);
                if (!answerId || !answerTitle) {
                    return;
                }

                const answerText = normalizeQuestionOptionText(cellLabel ? (cellLabel + ': ' + answerTitle) : answerTitle);
                if (!answerText) {
                    return;
                }

                const dedupeKey = cellId + '|' + answerId;
                if (seen.has(dedupeKey)) {
                    return;
                }
                seen.add(dedupeKey);

                const selected = cell.contains(answerElement);
                options.push({
                    answerKey: buildDragMatchingAnswerKey(cellId, answerId),
                    answerText,
                    selected,
                    correct: selected && wholeTableCorrect,
                    incorrect: false,
                    answerAliases: [answerTitle, cellLabel].filter(Boolean),
                    inputId: answerId,
                    inputName: '',
                    groupKey: cellLabel ? groupKey : (groupKey + ':order'),
                    groupPath: '',
                    inputPath: buildElementPath(root, answerElement),
                    inputType: cellLabel ? 'drag-table' : 'drag-order',
                    dragCellId: cellId,
                    dragAnswerId: answerId,
                    dragCellPath: buildElementPath(root, cell),
                    dragAnswerPath: buildElementPath(root, answerElement)
                });
            });
        });

        return options;
    }

    function isQuestionControl(node) {
        if (node instanceof HTMLSelectElement) {
            return true;
        }

        if (node instanceof HTMLTextAreaElement) {
            return node.matches('textarea.answer, textarea[name="answer"]');
        }

        if (!(node instanceof HTMLInputElement)) {
            return false;
        }

        const type = String(node.type || '').toLowerCase();
        if (type === 'radio' || type === 'checkbox' || type === 'text') {
            return true;
        }

        return type === 'hidden' && looksLikeMatchingTableAnswerValue(node.value || '');
    }

    function getQuestionBlocks() {
        const seen = new WeakSet();
        const result = [];
        const docs = getSearchDocuments();

        docs.forEach((doc) => {
            doc.querySelectorAll('table.drag-table, table.answerPlaceStudent').forEach((table) => {
                const root = findDragMatchingTableProblemRoot(table);
                if (!(root instanceof HTMLElement) || seen.has(root)) {
                    return;
                }
                seen.add(root);
                result.push(root);
            });

            const controls = doc.querySelectorAll(QUESTION_INPUT_SELECTOR);
            controls.forEach((control) => {
                if (!isQuestionControl(control)) {
                    return;
                }

                const root = findQuestionRoot(control);
                if (!(root instanceof HTMLElement) || seen.has(root)) {
                    return;
                }

                if (!root.querySelector(OPTION_LABEL_SELECTOR + ', ' + QUESTION_INPUT_SELECTOR)) {
                    return;
                }

                seen.add(root);
                result.push(root);
            });
        });

        return result;
    }

    const PROMPT_NOISE_RE = /^(?:набран\w*\s+баллов|использован\w*\s+попыток|вы\s+использовали\s+\d+\s*из\s*\d+\s*попыток|разместите\s+ответ\s+здесь|перетащите\s+(?:ответ(?:ы)?|элемент(?:ы)?))\b/i;
    const CSS_DECLARATION_RE = /\b(?:align-items|animation|background(?:-color)?|border(?:-(?:color|radius|top-color))?|box-sizing|color|display|font(?:-size|-weight)?|height|justify-content|line-height|margin(?:-(?:bottom|left|right|top))?|max-width|min-height|opacity|overflow|padding(?:-(?:bottom|left|right|top))?|pointer-events|position|text-align|transform|transition|width|z-index)\s*:/ig;
    const CSS_SELECTOR_RE = /(^|\s)[.#][a-z_-][\w-]*(?:[.#][a-z_-][\w-]*)?(?=\s|[,{:.#])/i;
    const OPENEDU_CSS_MARKER_RE = /\b(?:answerPlaceStudent|allAnswers|loadingspinner|ui-sortable|btn-brand|submit-attempt-container|problem-action-buttons-wrapper)\b/i;

    function looksLikeCssNoiseText(value) {
        const text = collapseWhitespace(value);
        if (!text) {
            return false;
        }

        const declarations = text.match(CSS_DECLARATION_RE) || [];
        CSS_DECLARATION_RE.lastIndex = 0;
        if (declarations.length === 0) {
            return false;
        }

        const hasCssSyntax = /[{};]/.test(text) || /!important\b/i.test(text);
        if (OPENEDU_CSS_MARKER_RE.test(text) && (hasCssSyntax || declarations.length >= 1)) {
            return true;
        }
        if (CSS_SELECTOR_RE.test(text) && (hasCssSyntax || declarations.length >= 2)) {
            return true;
        }
        return declarations.length >= 3 && hasCssSyntax;
    }

    function isGenericQuestionInstructionText(value) {
        const text = normalizeText(String(value || '').replace(/[.!?:;…]+$/g, ''));
        if (!text) {
            return true;
        }

        return /^(?:выберите|отметьте)\s+(?:один\s+|все\s+|несколько\s+)?(?:правильн\w+|верн\w+)\s+вариант(?:ы)?(?:\s+ответ(?:а|ов)?)?$/i.test(text)
            || /^выберите\s+(?:правильный|верный)\s+ответ$/i.test(text)
            || /^выберите\s+ответ$/i.test(text)
            || /^дополните(?:\s+(?:предложение|фразу|текст|утверждение))?$/i.test(text)
            || /^(?:впишите|введите)\s+(?:ответ|слово|значение)$/i.test(text)
            || /^заполните\s+(?:пропуск|пустое\s+поле)$/i.test(text);
    }

    function isPromptNoiseText(value) {
        const text = normalizeText(String(value || '').replace(/[.!?:;…]+$/g, ''));
        if (!text) {
            return true;
        }
        return PROMPT_NOISE_RE.test(text) || looksLikeCssNoiseText(text);
    }

    function getFirstPromptCandidate(root, selectorGroups) {
        if (!(root instanceof HTMLElement)) {
            return '';
        }

        for (const selector of selectorGroups) {
            if (root.matches(selector)) {
                const prompt = normalizePromptCandidateText(promptTextOf(root));
                if (prompt) {
                    return prompt;
                }
            }

            const nodes = root.querySelectorAll(selector);
            for (const node of nodes) {
                const prompt = normalizePromptCandidateText(promptTextOf(node));
                if (prompt) {
                    return prompt;
                }
            }
        }

        return '';
    }

    function getAdjacentOpeneduContextPrompt(root) {
        if (!(root instanceof HTMLElement)) {
            return '';
        }

        const currentVert = root.closest('.vert');
        if (!(currentVert instanceof HTMLElement)) {
            return '';
        }

        let previous = currentVert.previousElementSibling;
        for (let i = 0; previous && i < 6; i += 1, previous = previous.previousElementSibling) {
            if (!(previous instanceof HTMLElement) || !previous.matches('.vert')) {
                continue;
            }
            if (previous.querySelector(QUESTION_INPUT_SELECTOR + ', table.drag-table, table.answerPlaceStudent, .dragAnswer[id]')) {
                break;
            }
            if (!previous.querySelector('.xblock-student_view-html, [data-block-type="html"], img, svg, canvas')) {
                continue;
            }

            const prompt = normalizePromptCandidateText(promptTextOf(previous));
            if (prompt) {
                return prompt;
            }
        }

        return '';
    }

    function shouldMergeAdjacentOpeneduContext(root, localPrompt) {
        if (!(root instanceof HTMLElement)) {
            return false;
        }
        if (root.querySelector('table.drag-table, table.answerPlaceStudent, .dragAnswer[id]')) {
            return true;
        }
        const text = normalizeText(localPrompt || '');
        return /^укажите\s+порядок\b/.test(text)
            || /^на\s+чертеже\b/.test(text);
    }

    function mergePromptWithAdjacentContext(root, localPrompt) {
        const base = normalizePromptCandidateText(localPrompt);
        if (!base) {
            return '';
        }

        const context = shouldMergeAdjacentOpeneduContext(root, base)
            ? getAdjacentOpeneduContextPrompt(root)
            : '';
        if (!context) {
            return base;
        }

        const baseNorm = normalizeText(base);
        const contextNorm = normalizeText(context);
        if (contextNorm.includes(baseNorm)) {
            return context;
        }
        if (baseNorm.includes(contextNorm)) {
            return base;
        }
        return collapseWhitespace([context, base].join(' '));
    }

    function getQuestionPrompt(root) {
        const localPrompt = getFirstPromptCandidate(root, [
            '.problem-group-label',
            'legend',
            '.problem-header',
            '.problem-title',
            '.question-title',
            'h2, h3, h4',
            '.wrapper-problem-response > p',
            'p'
        ]);
        if (localPrompt) {
            return mergePromptWithAdjacentContext(root, localPrompt);
        }

        const problemContainer = root.closest('.xblock-student_view-problem, [data-problem-id], .problems-wrapper, .vert');
        if (problemContainer instanceof HTMLElement && problemContainer !== root) {
            const containerPrompt = getFirstPromptCandidate(problemContainer, [
                '.problem-group-label',
                'legend',
                '.problem-header',
                '.problem-title',
                '.question-title',
                'h2, h3, h4'
            ]);
            return mergePromptWithAdjacentContext(root, containerPrompt);
        }

        return '';
    }

    function normalizePromptLikeText(value) {
        let text = sanitizeQuestionPromptText(value);
        if (!text) {
            return '';
        }

        text = text
            .replace(/\b(верно|неверно|правильно|неправильно|correct|incorrect|true|false)\s*:\s*/ig, '')
            .replace(/\s*\b(верно|неверно|правильно|неправильно|correct|incorrect|true|false)\b\s*$/ig, '')
            .replace(/\s+/g, ' ')
            .trim();

        return text;
    }

    function normalizePromptCandidateText(value) {
        const text = normalizePromptLikeText(value);
        if (!text || isGenericQuestionInstructionText(text) || isPromptNoiseText(text)) {
            return '';
        }
        return text;
    }

    function normalizeQuestionOptionText(value) {
        return normalizePromptLikeText(value);
    }

    function isSelectPlaceholderOption(option) {
        if (!(option instanceof HTMLOptionElement)) {
            return false;
        }

        const value = normalizeText(option.value || '');
        const text = normalizeText(textOf(option) || option.label || '');
        if (option.disabled) {
            return true;
        }
        if (!text && !value) {
            return true;
        }
        if ((value === '' || /dummy|placeholder|default/.test(value)) && /(выберите|choose|select)/.test(text)) {
            return true;
        }

        return false;
    }

    function getSelectOptionAnswerText(option) {
        if (!(option instanceof HTMLOptionElement)) {
            return '';
        }

        const rawText = collapseWhitespace(textOf(option) || option.label || '');
        const fallback = collapseWhitespace(option.value || '');
        const baseText = rawText || fallback;
        return normalizeQuestionOptionText(baseText);
    }

    function textOfTableCell(cell) {
        if (!(cell instanceof Element)) {
            return '';
        }

        const clone = cell.cloneNode(true);
        clone.querySelectorAll(
            PARAMEXT_WIDGET_SELECTOR
            + ', script, style, noscript, template, link, meta'
            + ', input, select, option, button'
            + ', .status, .status-icon, .indicator-container, .sr'
        ).forEach((node) => node.remove());
        return normalizeQuestionOptionText(clone.textContent || '');
    }

    function getTableCellIndex(cell) {
        if (!(cell instanceof HTMLTableCellElement)) {
            return -1;
        }
        const row = cell.parentElement;
        if (!(row instanceof HTMLTableRowElement)) {
            return -1;
        }
        return Array.from(row.cells || []).indexOf(cell);
    }

    function getTableColumnHeaderText(table, row, cellIndex) {
        if (!(table instanceof HTMLTableElement) || !(row instanceof HTMLTableRowElement) || cellIndex < 0) {
            return '';
        }

        const rows = Array.from(table.rows || []);
        const rowIndex = rows.indexOf(row);
        for (let ridx = Math.max(0, rowIndex - 1); ridx >= 0; ridx -= 1) {
            const candidate = rows[ridx]?.cells?.[cellIndex];
            if (!(candidate instanceof HTMLTableCellElement)) {
                continue;
            }
            if (candidate.tagName.toLowerCase() !== 'th' && !candidate.getAttribute('scope')) {
                continue;
            }
            const text = textOfTableCell(candidate);
            if (text) {
                return text;
            }
        }

        const firstRow = rows[0];
        const firstCell = firstRow?.cells?.[cellIndex];
        return firstCell instanceof HTMLTableCellElement && firstCell !== row.cells[cellIndex]
            ? textOfTableCell(firstCell)
            : '';
    }

    function getTableRowHeaderText(row, cellIndex) {
        if (!(row instanceof HTMLTableRowElement)) {
            return '';
        }

        for (let idx = Math.min(cellIndex - 1, row.cells.length - 1); idx >= 0; idx -= 1) {
            const cell = row.cells[idx];
            if (!(cell instanceof HTMLTableCellElement)) {
                continue;
            }
            const text = textOfTableCell(cell);
            if (text) {
                return text;
            }
        }

        return '';
    }

    function getTableControlAnswerText(root, control, fallbackIndex) {
        const doc = root?.ownerDocument || document;
        const inputId = control instanceof Element ? String(control.id || '').trim() : '';
        const label = inputId ? doc.querySelector('label[for="' + escapeSelector(inputId) + '"]') : control.closest('label');
        if (label instanceof HTMLElement) {
            const labelText = getOptionAnswerText(label, control, collectOptionMediaDescriptors(label));
            if (labelText) {
                return labelText;
            }
        }

        const cell = control.closest('td, th');
        const row = control.closest('tr');
        const table = control.closest('table');
        const cellText = textOfTableCell(cell);
        if (cellText) {
            return cellText;
        }

        const cellIndex = getTableCellIndex(cell);
        const rowText = getTableRowHeaderText(row, cellIndex);
        const colText = getTableColumnHeaderText(table, row, cellIndex);
        const joined = [rowText, colText].filter(Boolean).join(' / ');
        if (joined) {
            return joined;
        }

        if (control instanceof HTMLInputElement) {
            return collapseWhitespace(control.value || control.name || control.id || ('option-' + String(fallbackIndex + 1)));
        }

        if (control instanceof HTMLSelectElement) {
            return collapseWhitespace(control.name || control.id || ('select-' + String(fallbackIndex + 1)));
        }

        return '';
    }

    function buildTabularInputOptions(root, usedKeys) {
        if (!(root instanceof HTMLElement)) {
            return [];
        }
        if (getMatchingTableData(root)) {
            return [];
        }
        if (!root.matches('table') && !root.querySelector('table')) {
            return [];
        }

        const options = [];
        const localUsedKeys = usedKeys instanceof Set ? usedKeys : new Set();
        const controls = root.querySelectorAll('table input[type="radio"], table input[type="checkbox"]');
        controls.forEach((input, idx) => {
            if (!(input instanceof HTMLInputElement)) {
                return;
            }

            const answerText = getTableControlAnswerText(root, input, idx);
            if (!answerText) {
                return;
            }

            const inputId = input.id || '';
            const inputName = String(input.name || '').trim();
            const groupKey = inputName
                ? ('table:' + inputName)
                : ('table:' + buildElementPath(root, input.closest('table') || root));
            const dedupeKey = groupKey + '|' + (inputId || answerText);
            if (localUsedKeys.has(dedupeKey)) {
                return;
            }
            localUsedKeys.add(dedupeKey);

            const label = inputId
                ? (input.ownerDocument || document).querySelector('label[for="' + escapeSelector(inputId) + '"]')
                : input.closest('label');
            const markedState = getOptionMarkedState(label, input);

            options.push({
                answerKey: buildAnswerKey(answerText, input, idx),
                answerText,
                selected: Boolean(input.checked),
                correct: markedState === true,
                incorrect: markedState === false,
                answerAliases: [input.value || ''].filter(Boolean),
                inputId,
                inputName,
                groupKey,
                groupPath: '',
                inputPath: buildElementPath(root, input),
                inputType: input.type === 'checkbox' ? 'checkbox' : 'radio'
            });
        });

        return options;
    }

    function getMarkerText(label, input) {
        const pieces = [
            String(label?.className || ''),
            String(input?.className || ''),
            String(label?.getAttribute?.('aria-label') || ''),
            String(input?.getAttribute?.('aria-label') || ''),
            String(label?.getAttribute?.('data-correct') || ''),
            String(input?.getAttribute?.('data-correct') || ''),
            String(label?.getAttribute?.('data-state') || ''),
            String(input?.getAttribute?.('data-state') || '')
        ];

        const host = label?.closest?.('li, .answer, .option, .response, .correct, .incorrect')
            || input?.closest?.('li, .answer, .option, .response, .correct, .incorrect');
        if (host) {
            pieces.push(String(host.className || ''));
            pieces.push(String(host.getAttribute('aria-label') || ''));
            pieces.push(String(host.getAttribute('title') || ''));
            pieces.push(String(host.getAttribute('data-tooltip') || ''));
            pieces.push(String(host.getAttribute('data-state') || ''));
            pieces.push(String(host.getAttribute('data-correct') || ''));
        }

        return pieces.join(' ').toLowerCase();
    }

    function getOwnMarkerText(node, includeText) {
        if (!(node instanceof Element)) {
            return '';
        }

        const pieces = [
            node.getAttribute('class') || '',
            node.getAttribute('aria-label') || '',
            node.getAttribute('title') || '',
            node.getAttribute('data-tooltip') || '',
            node.getAttribute('data-icon') || '',
            node.getAttribute('data-state') || '',
            node.getAttribute('data-correct') || ''
        ];

        if (includeText) {
            pieces.push(textOf(node));
        }

        return pieces.join(' ').toLowerCase();
    }

    function markerStateFromText(value, includeIconMarkers) {
        const text = String(value || '').toLowerCase();
        if (!text) {
            return null;
        }

        if (NEGATIVE_MARK_RE.test(text) || (includeIconMarkers && NEGATIVE_ICON_MARK_RE.test(text))) {
            return false;
        }
        if (POSITIVE_MARK_RE.test(text) || (includeIconMarkers && POSITIVE_ICON_MARK_RE.test(text))) {
            return true;
        }

        return null;
    }

    function markerStateFromNode(node, includeDescendants) {
        if (!(node instanceof Element)) {
            return null;
        }

        const ownState = markerStateFromText(getOwnMarkerText(node, true), true);
        if (ownState !== null) {
            return ownState;
        }

        if (!includeDescendants) {
            return null;
        }

        const markers = node.querySelectorAll(STATUS_MARKER_SELECTOR);
        for (const marker of markers) {
            const markerState = markerStateFromText(getOwnMarkerText(marker, true), true);
            if (markerState !== null) {
                return markerState;
            }
        }

        return null;
    }

    function getExplicitStatusNode(label, input) {
        const statusRef = String(label?.getAttribute?.('aria-describedby') || input?.getAttribute?.('aria-describedby') || '').trim();
        if (!statusRef) {
            return null;
        }

        const ownerDocument = input?.ownerDocument || label?.ownerDocument || document;
        return ownerDocument.getElementById(statusRef);
    }

    function findNearbyStatusMarker(label, input) {
        const explicitStatus = getExplicitStatusNode(label, input);
        if (explicitStatus) {
            return explicitStatus;
        }

        const start = input instanceof Element ? input : (label instanceof Element ? label : null);
        const ownerDocument = start?.ownerDocument || label?.ownerDocument || document;
        let current = start?.parentElement || null;

        while (current && current !== ownerDocument.documentElement) {
            const state = markerStateFromText(getOwnMarkerText(current, false), false);
            if (state !== null) {
                return current;
            }

            const marker = current.querySelector(STATUS_MARKER_SELECTOR);
            if (marker instanceof Element) {
                return marker;
            }

            if (current.matches(QUESTION_ROOT_SELECTOR)) {
                break;
            }

            current = current.parentElement;
        }

        return null;
    }

    function isOptionMarkedCorrect(label, input) {
        return getOptionMarkedState(label, input) === true;
    }

    function isOptionMarkedIncorrect(label, input) {
        return getOptionMarkedState(label, input) === false;
    }

    function getOptionMarkedState(label, input) {
        const markerText = getMarkerText(label, input);

        // Check negative markers first — choicegroup_incorrect on labels, or
        // standalone "incorrect"/"wrong" etc. in class names / attributes.
        const directMarkerState = markerStateFromText(markerText, false);
        if (directMarkerState === false) {
            return false;
        }

        // Check explicit aria-describedby first, then nearby status/icon nodes.
        // In edX/OpenEdu choice labels can share a single status span, while
        // text inputs may only have a sibling icon/check container.
        const statusNode = findNearbyStatusMarker(label, input);
        if (statusNode) {
            const statusState = markerStateFromNode(statusNode, true);
            if (statusState === false) {
                if (input instanceof HTMLInputElement && input.type !== 'text' && !input.checked) {
                    return null;
                }
                return false;
            }
            if (statusState === true) {
                // For shared status: only the selected option counts as correct.
                if (input instanceof HTMLInputElement && input.type !== 'text' && !input.checked) {
                    return null;
                }
                return true;
            }
        }

        // Check explicit data-correct attributes.
        const explicit = normalizeText(
            String(label?.getAttribute?.('data-correct') || '') + ' ' +
            String(input?.getAttribute?.('data-correct') || '')
        );
        if (explicit.includes('false') || explicit.includes('0') || explicit.includes('no')) {
            return false;
        }
        if (explicit.includes('true') || explicit.includes('1') || explicit.includes('yes')) {
            return true;
        }

        // Final fallback: check positive markers in class names / attributes
        // (e.g. choicegroup_correct on the label itself).
        if (directMarkerState === true) {
            return true;
        }

        return null;
    }

    function buildAnswerKey(answerText, input, fallbackIndex) {
        const controlName = input instanceof HTMLInputElement ? input.name || '' : '';
        const controlValue = input instanceof HTMLInputElement ? input.value || '' : '';
        const controlId = input instanceof HTMLInputElement ? input.id || '' : '';
        return hash(controlName + '|' + controlValue + '|' + controlId + '|' + answerText + '|' + String(fallbackIndex));
    }

    function buildSelectAnswerKey(answerText, select, optionValue, fallbackIndex) {
        const controlName = select instanceof HTMLSelectElement ? select.name || '' : '';
        const controlValue = collapseWhitespace(optionValue || '');
        const controlId = select instanceof HTMLSelectElement ? select.id || '' : '';
        return hash(controlName + '|' + controlValue + '|' + controlId + '|' + answerText + '|' + String(fallbackIndex));
    }

    function buildElementPath(root, element) {
        if (!(root instanceof Element) || !(element instanceof Element)) {
            return '';
        }

        const parts = [];
        let current = element;
        while (current && current !== root) {
            const parent = current.parentElement;
            if (!parent) {
                break;
            }
            const index = Array.prototype.indexOf.call(parent.children, current);
            parts.push(String(index));
            current = parent;
        }

        return current === root ? parts.reverse().join('.') : '';
    }

    function getElementByPath(root, path) {
        if (!(root instanceof Element) || !path) {
            return root instanceof HTMLElement ? root : null;
        }

        let current = root;
        const parts = String(path).split('.');
        for (let i = 0; i < parts.length; i += 1) {
            const idx = Number(parts[i]);
            if (!Number.isInteger(idx) || idx < 0 || idx >= current.children.length) {
                return null;
            }
            current = current.children[idx];
        }

        return current instanceof HTMLElement ? current : null;
    }

    function isTopQuestionWrapper(node) {
        if (!(node instanceof Element)) {
            return false;
        }
        return node.matches(QUESTION_ROOT_SELECTOR);
    }

    function getInputGroupContainer(root, input) {
        if (!(root instanceof HTMLElement) || !(input instanceof Element)) {
            return root;
        }

        let current = input.parentElement;
        while (current && current !== root) {
            if (
                !isTopQuestionWrapper(current)
                && current.matches(QUESTION_GROUP_SELECTOR)
            ) {
                return current;
            }
            current = current.parentElement;
        }

        return root;
    }

    function findPromptBeforeNode(root, node) {
        if (!(root instanceof HTMLElement) || !(node instanceof Element)) {
            return '';
        }

        const pendingMediaTokens = [];
        const seenMediaTokens = new Set();

        function rememberMediaTokens(candidate) {
            if (!(candidate instanceof Element)) {
                return;
            }
            const candidateText = collapseWhitespace(textOf(candidate));
            if (candidateText) {
                return;
            }
            collectPromptMediaTokens(candidate).forEach((token) => {
                if (!seenMediaTokens.has(token)) {
                    seenMediaTokens.add(token);
                    pendingMediaTokens.push(token);
                }
            });
        }

        function withPendingMedia(prompt) {
            const base = normalizePromptCandidateText(prompt);
            if (!base) {
                return '';
            }
            if (pendingMediaTokens.length === 0) {
                return base;
            }
            return collapseWhitespace([base, ...pendingMediaTokens].join(' '));
        }

        let cursor = node;
        while (cursor && cursor !== root) {
            let previous = cursor.previousElementSibling;
            while (previous) {
                const direct = withPendingMedia(promptTextOf(previous));
                if (direct && direct.length >= 8) {
                    return direct;
                }

                const nestedPromptNode = previous.querySelector('h1, h2, h3, h4, legend, .problem-title, .question-title, .problem-header, p');
                const nested = withPendingMedia(promptTextOf(nestedPromptNode));
                if (nested && nested.length >= 8) {
                    return nested;
                }

                rememberMediaTokens(previous);
                previous = previous.previousElementSibling;
            }
            cursor = cursor.parentElement;
        }

        return '';
    }

    function resolveGroupRootByInput(root, inputPath, inputName, expectedCount) {
        if (!(root instanceof HTMLElement)) {
            return root;
        }

        const input = getElementByPath(root, inputPath);
        if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLSelectElement)) {
            return root;
        }

        let current = input.parentElement;
        while (current && current !== root) {
            const allInputs = current.querySelectorAll(QUESTION_INPUT_SELECTOR).length;
            if (allInputs < expectedCount) {
                current = current.parentElement;
                continue;
            }

            if (inputName) {
                const scopedSameName = current.querySelectorAll(
                    'input[name="' + escapeSelector(inputName) + '"]'
                    + ', select[name="' + escapeSelector(inputName) + '"]'
                ).length;
                if (scopedSameName === expectedCount) {
                    return current;
                }
            }

            if (allInputs === expectedCount) {
                return current;
            }

            current = current.parentElement;
        }

        return root;
    }

    function getAnswerOptions(root) {
        const options = [];
        const matchingOptions = buildMatchingTableOptions(root);
        if (matchingOptions.length > 0) {
            return matchingOptions;
        }

        const dragMatchingOptions = buildDragMatchingTableOptions(root);
        if (dragMatchingOptions.length > 0) {
            return dragMatchingOptions;
        }

        const usedKeys = new Set();

        const selects = root.querySelectorAll('select');
        selects.forEach((select, sidx) => {
            if (!(select instanceof HTMLSelectElement)) {
                return;
            }

            const inputId = select.id || '';
            const inputName = String(select.name || '').trim();
            const groupContainer = getInputGroupContainer(root, select);
            const groupPath = groupContainer && groupContainer !== root ? buildElementPath(root, groupContainer) : '';
            const groupKey = groupPath
                ? ('c:' + groupPath)
                : (inputName ? ('s:' + inputName) : ('s:' + String(sidx)));
            const inputPath = buildElementPath(root, select);

            const statusRef = String(select.getAttribute('aria-describedby') || '').trim();
            const statusNode = statusRef
                ? (select.ownerDocument || document).getElementById(statusRef)
                : null;
            const selectStatus = statusNode instanceof Element
                ? markerStateFromNode(statusNode, true)
                : null;

            Array.from(select.options || []).forEach((optionNode, oidx) => {
                if (!(optionNode instanceof HTMLOptionElement)) {
                    return;
                }
                if (isSelectPlaceholderOption(optionNode)) {
                    return;
                }

                const answerText = getSelectOptionAnswerText(optionNode);
                if (!answerText) {
                    return;
                }

                const optionValue = collapseWhitespace(optionNode.value || '');
                const dedupeKey = groupKey + '|' + (optionValue || answerText);
                if (usedKeys.has(dedupeKey)) {
                    return;
                }
                usedKeys.add(dedupeKey);

                const answerAliases = [];
                const aliasSeen = new Set();
                const normalizedAnswerText = normalizeText(answerText);
                if (normalizedAnswerText) {
                    aliasSeen.add(normalizedAnswerText);
                }
                addOptionAlias(answerAliases, aliasSeen, optionNode.label || '');
                addOptionAlias(answerAliases, aliasSeen, optionNode.value || '');
                addOptionAlias(answerAliases, aliasSeen, optionNode.getAttribute('aria-label') || '');
                addOptionAlias(answerAliases, aliasSeen, optionNode.getAttribute('title') || '');

                const markedState = optionNode.selected ? selectStatus : null;

                options.push({
                    answerKey: buildSelectAnswerKey(answerText, select, optionValue, oidx),
                    answerText,
                    selected: Boolean(optionNode.selected),
                    correct: markedState === true,
                    incorrect: markedState === false,
                    answerAliases,
                    inputId,
                    inputName,
                    inputValue: optionValue,
                    groupKey,
                    groupPath,
                    inputPath,
                    inputType: 'select'
                });
            });
        });

        buildTabularInputOptions(root, usedKeys).forEach((option) => {
            options.push(option);
        });

        const labels = root.querySelectorAll(OPTION_LABEL_SELECTOR);

        labels.forEach((label, idx) => {
            const inputId = label.getAttribute('for') || '';
            const input = inputId
                ? root.querySelector('#' + escapeSelector(inputId))
                : label.querySelector('input[type="radio"], input[type="checkbox"]');

            if (input instanceof HTMLSelectElement) {
                return;
            }

            // Skip labels paired with text inputs — handled separately below.
            if (input instanceof HTMLInputElement && input.type === 'text') {
                return;
            }

            const groupContainer = getInputGroupContainer(root, input);
            const groupPath = groupContainer && groupContainer !== root ? buildElementPath(root, groupContainer) : '';
            const inputName = input instanceof HTMLInputElement ? String(input.name || '').trim() : '';
            const groupKey = groupPath
                ? ('c:' + groupPath)
                : (inputName ? ('n:' + inputName) : ('i:' + String(idx)));

            const mediaDescriptors = collectOptionMediaDescriptors(label);
            const answerText = getOptionAnswerText(label, input, mediaDescriptors);
            if (!answerText) {
                return;
            }
            const answerAliases = getOptionAnswerAliases(label, input, mediaDescriptors, answerText);

            const dedupeKey = groupKey + '|' + (inputId || answerText);
            if (usedKeys.has(dedupeKey)) {
                return;
            }
            usedKeys.add(dedupeKey);
            const markedState = getOptionMarkedState(label, input);

            options.push({
                answerKey: buildAnswerKey(answerText, input, idx),
                answerText,
                selected: Boolean(input && input.checked),
                correct: markedState === true,
                incorrect: markedState === false,
                answerAliases,
                inputId,
                inputName,
                groupKey,
                groupPath,
                inputPath: input instanceof HTMLInputElement ? buildElementPath(root, input) : '',
                inputType: input instanceof HTMLInputElement ? (input.type || 'radio') : 'label'
            });
        });

        // Text inputs: each input produces one option with the typed value.
        const textInputs = root.querySelectorAll('input[type="text"]');
        textInputs.forEach((input, tidx) => {
            if (!(input instanceof HTMLInputElement)) {
                return;
            }

            const inputId = input.id || '';
            const inputName = String(input.name || '').trim();

            // Skip if already captured by the label loop.
            const alreadyCaptured = options.some((o) => o.inputId === inputId && inputId);
            if (alreadyCaptured) {
                return;
            }

            const label = inputId
                ? root.querySelector('label[for="' + escapeSelector(inputId) + '"]')
                : null;

            const answerText = input.value.trim();
            const answerAliases = getOptionAnswerAliases(label, input, [], answerText);
            const groupContainer = getInputGroupContainer(root, input);
            const groupPath = groupContainer && groupContainer !== root ? buildElementPath(root, groupContainer) : '';
            const groupKey = groupPath
                ? ('c:' + groupPath)
                : (inputName ? ('n:' + inputName) : ('t:' + String(tidx)));

            const dedupeKey = groupKey + '|' + inputId;
            if (usedKeys.has(dedupeKey)) {
                return;
            }
            usedKeys.add(dedupeKey);
            const markedState = getOptionMarkedState(label, input);

            options.push({
                answerKey: buildAnswerKey(answerText, input, tidx),
                answerText,
                selected: answerText.length > 0,
                correct: markedState === true,
                incorrect: markedState === false,
                answerAliases,
                inputId,
                inputName,
                groupKey,
                groupPath,
                inputPath: buildElementPath(root, input),
                inputType: 'text'
            });
        });

        if (options.length === 0) {
            const inputs = root.querySelectorAll('input[type="radio"], input[type="checkbox"]');
            inputs.forEach((input, idx) => {
                if (!(input instanceof HTMLInputElement)) {
                    return;
                }

                const inputId = input.id || '';
                const label = inputId
                    ? root.querySelector('label[for="' + escapeSelector(inputId) + '"]')
                    : input.closest('label');
                const groupContainer = getInputGroupContainer(root, input);
                const groupPath = groupContainer && groupContainer !== root ? buildElementPath(root, groupContainer) : '';
                const inputName = String(input.name || '').trim();
                const groupKey = groupPath
                    ? ('c:' + groupPath)
                    : (inputName ? ('n:' + inputName) : ('i:' + String(idx)));
                const mediaDescriptors = collectOptionMediaDescriptors(label);
                const answerText = getOptionAnswerText(label, input, mediaDescriptors);
                if (!answerText) {
                    return;
                }
                const answerAliases = getOptionAnswerAliases(label, input, mediaDescriptors, answerText);
                const markedState = getOptionMarkedState(label, input);

                options.push({
                    answerKey: buildAnswerKey(answerText, input, idx),
                    answerText,
                    selected: Boolean(input.checked),
                    correct: markedState === true,
                    incorrect: markedState === false,
                    answerAliases,
                    inputId,
                    inputName,
                    groupKey,
                    groupPath,
                    inputPath: buildElementPath(root, input)
                });
            });
        }

        return options;
    }

    function isFullScoreText(value) {
        const text = normalizeText(value);
        const match = text.match(/([0-9]+(?:[.,][0-9]+)?)\s*(?:из|\/)\s*([0-9]+(?:[.,][0-9]+)?)/i);
        if (!match) {
            return false;
        }

        const earned = Number(match[1].replace(',', '.'));
        const total = Number(match[2].replace(',', '.'));
        return Number.isFinite(earned) && Number.isFinite(total) && total > 0 && earned >= total;
    }

    function isQuestionCorrect(root) {
        const exact = root.querySelector(
            '.status.correct, .feedback-hint-correct, .message .feedback-hint-correct, .problem-status-correct, [data-correct="true"]'
        );
        if (exact) {
            return true;
        }

        const statusNode = root.querySelector('.status, .message, .problem-progress, .notification, .feedback, .problem-results')
            || root.closest('.xblock-student_view-problem, [data-problem-id], .problems-wrapper, .vert')
                ?.querySelector('.status, .message, .problem-progress, .notification, .feedback, .problem-results');
        const statusTextRaw = normalizeText(textOf(statusNode));
        if (!statusTextRaw) {
            return false;
        }

        if (isFullScoreText(statusTextRaw)) {
            return true;
        }

        if (NEGATIVE_MARK_RE.test(statusTextRaw)) {
            return false;
        }

        return POSITIVE_MARK_RE.test(statusTextRaw);
    }

    function createEmptyStatsEntry() {
        return {
            completedCount: 0,
            verifiedAnswers: [],
            incorrectAnswers: [],
            fallbackAnswers: []
        };
    }

    function normalizeAnswerStatsList(items) {
        if (!Array.isArray(items)) {
            return [];
        }

        const normalized = [];
        items.forEach((item) => {
            const answerText = sanitizeAnswerText(item?.answerText || '');
            if (!answerText) {
                return;
            }

            normalized.push({
                answerKey: typeof item?.answerKey === 'string' ? item.answerKey : '',
                answerText,
                count: Math.max(0, Number(item?.count || 0))
            });
        });

        normalized.sort((a, b) => {
            if (b.count !== a.count) {
                return b.count - a.count;
            }
            return a.answerText.localeCompare(b.answerText);
        });

        return normalized.slice(0, MAX_ANSWERS_PER_QUESTION);
    }

    function mergeAnswerStatsLists(primary, extra) {
        const map = new Map();

        [primary, extra].forEach((items) => {
            (Array.isArray(items) ? items : []).forEach((item) => {
                const answerText = String(item?.answerText || '').trim();
                if (!answerText) {
                    return;
                }

                const answerKey = typeof item?.answerKey === 'string' ? item.answerKey : '';
                const sig = answerKey + '|' + normalizeText(answerText);
                const count = Math.max(0, Number(item?.count || 0));
                const previous = map.get(sig);
                if (previous) {
                    previous.count = Math.max(previous.count, count);
                    return;
                }

                map.set(sig, {
                    answerKey,
                    answerText,
                    count
                });
            });
        });

        return normalizeAnswerStatsList(Array.from(map.values()));
    }

    function buildLocalFallbackStats(questions) {
        const local = {};

        questions.forEach((question) => {
            const selectedOptions = question.options
                .filter((option) => option.selected)
                .slice(0, MAX_ANSWERS_PER_QUESTION);
            const selected = selectedOptions.map((option) => ({
                answerKey: option.answerKey,
                answerText: option.answerText,
                count: 1
            }));
            const verified = selectedOptions
                .filter((option) => option.correct)
                .map((option) => ({
                    answerKey: option.answerKey,
                    answerText: option.answerText,
                    count: 1
                }));
            const incorrect = selectedOptions
                .filter((option) => option.incorrect)
                .map((option) => ({
                    answerKey: option.answerKey,
                    answerText: option.answerText,
                    count: 1
                }));

            if (selected.length === 0) {
                return;
            }

            local[question.questionKey] = {
                completedCount: 0,
                verifiedAnswers: verified,
                incorrectAnswers: incorrect,
                fallbackAnswers: selected,
                localOnly: true
            };
        });

        return local;
    }

    function snapshotQuestionReferences(questions) {
        if (!Array.isArray(questions)) {
            return [];
        }

        return questions.map((question) => ({
            questionKey: String(question?.questionKey || ''),
            domId: String(question?.domId || ''),
            prompt: sanitizeQuestionPromptText(
                question?.prompt || '',
                Array.isArray(question?.options) ? question.options.map((option) => option?.answerText || '') : [],
            ),
            options: Array.isArray(question?.options)
                ? question.options.map((option) => ({
                    answerText: sanitizeAnswerText(option?.answerText || '')
                }))
                : []
        }));
    }

    function buildMergedStatsEntry(source, localOnly) {
        return {
            completedCount: Math.max(0, Number(source?.completedCount || 0)),
            verifiedAnswers: normalizeAnswerStatsList(source?.verifiedAnswers),
            incorrectAnswers: normalizeAnswerStatsList(source?.incorrectAnswers),
            fallbackAnswers: normalizeAnswerStatsList(source?.fallbackAnswers),
            localOnly: Boolean(localOnly),
            similarMatch: Boolean(source?.similarMatch),
            matchedBy: typeof source?.matchedBy === 'string'
                ? source.matchedBy
                : (Boolean(source?.similarMatch) ? 'similar' : 'exact'),
            matchedQuestionKey: typeof source?.matchedQuestionKey === 'string' ? source.matchedQuestionKey : '',
            matchedScore: Math.max(0, Number(source?.matchedScore || 0))
        };
    }

    function getQuestionPresentationState(stats) {
        const verifiedAnswers = normalizeAnswerStatsList(stats?.verifiedAnswers);
        const incorrectAnswers = normalizeAnswerStatsList(stats?.incorrectAnswers);
        const fallbackAnswers = normalizeAnswerStatsList(stats?.fallbackAnswers);
        const hasAnswers = verifiedAnswers.length > 0 || incorrectAnswers.length > 0 || fallbackAnswers.length > 0;
        const matchKind = String(stats?.matchedBy || (stats?.similarMatch ? 'similar' : 'exact'));

        return {
            verifiedAnswers,
            incorrectAnswers,
            fallbackAnswers,
            hasAnswers,
            matchKind,
            isSimilar: matchKind === 'similar',
            isContentMatch: matchKind === 'content'
        };
    }

    function findPreservedStatsEntry(question, previousStatsByQuestion, previousQuestions) {
        if (!question || !previousStatsByQuestion || !Array.isArray(previousQuestions) || previousQuestions.length === 0) {
            return null;
        }

        const previousQuestion = findQuestionByReference(previousQuestions, question);
        if (!previousQuestion) {
            return null;
        }

        const previousEntry = previousStatsByQuestion[previousQuestion.questionKey];
        if (!previousEntry) {
            return null;
        }

        const preserved = buildMergedStatsEntry(previousEntry, Boolean(previousEntry.localOnly));
        if (preserved.verifiedAnswers.length === 0 && preserved.incorrectAnswers.length === 0 && preserved.fallbackAnswers.length === 0) {
            return null;
        }

        return preserved;
    }

    function mergeStatsByQuestion(remoteStatsByQuestion, localStatsByQuestion, questions, previousStatsByQuestion, previousQuestions) {
        const merged = {};

        questions.forEach((question) => {
            const key = question.questionKey;
            const remote = remoteStatsByQuestion && remoteStatsByQuestion[key]
                ? remoteStatsByQuestion[key]
                : createEmptyStatsEntry();
            const local = localStatsByQuestion && localStatsByQuestion[key]
                ? localStatsByQuestion[key]
                : null;

            const remoteVerified = normalizeAnswerStatsList(remote.verifiedAnswers);
            const remoteIncorrect = normalizeAnswerStatsList(remote.incorrectAnswers);
            const remoteFallback = normalizeAnswerStatsList(remote.fallbackAnswers);
            const localVerified = normalizeAnswerStatsList(local?.verifiedAnswers);
            const localIncorrect = normalizeAnswerStatsList(local?.incorrectAnswers);
            const hasRemoteAnswers = remoteVerified.length > 0 || remoteIncorrect.length > 0 || remoteFallback.length > 0;

            if (hasRemoteAnswers || !local) {
                if (hasRemoteAnswers) {
                    const verifiedAnswers = mergeAnswerStatsLists(remoteVerified, localVerified);
                    const incorrectAnswers = mergeAnswerStatsLists(remoteIncorrect, localIncorrect);
                    const hasLocalVerified = localVerified.length > 0;
                    merged[key] = {
                        completedCount: Number(remote.completedCount || 0),
                        verifiedAnswers,
                        incorrectAnswers,
                        fallbackAnswers: remoteFallback,
                        localOnly: false,
                        similarMatch: hasLocalVerified ? false : Boolean(remote.similarMatch),
                        matchedBy: hasLocalVerified
                            ? 'local'
                            : (typeof remote.matchedBy === 'string'
                            ? remote.matchedBy
                            : (Boolean(remote.similarMatch) ? 'similar' : 'exact')),
                        matchedQuestionKey: hasLocalVerified
                            ? ''
                            : (typeof remote.matchedQuestionKey === 'string' ? remote.matchedQuestionKey : ''),
                        matchedScore: hasLocalVerified ? 0 : Math.max(0, Number(remote.matchedScore || 0))
                    };
                    return;
                }

                const preserved = findPreservedStatsEntry(question, previousStatsByQuestion, previousQuestions);
                if (preserved) {
                    merged[key] = preserved;
                    return;
                }

                merged[key] = buildMergedStatsEntry(remote, false);
                return;
            }

            merged[key] = {
                completedCount: 0,
                verifiedAnswers: normalizeAnswerStatsList(local.verifiedAnswers),
                incorrectAnswers: normalizeAnswerStatsList(local.incorrectAnswers),
                fallbackAnswers: normalizeAnswerStatsList(local.fallbackAnswers),
                localOnly: true,
                similarMatch: false,
                matchedBy: 'local',
                matchedQuestionKey: '',
                matchedScore: 0
            };
        });

        return merged;
    }

    function resetRemoteStatsState(reason) {
        debugSync('remote_state_reset', {
            reason: String(reason || 'manual')
        });
        lastAttemptPayloadHash = '';
        lastAttemptPushAt = 0;
        lastNetworkSyncAt = 0;
        lastStatsQuerySignature = '';
        lastStatsQueryAt = 0;
        lastStatsResponse = null;
        lastMergedStatsByQuestion = null;
        lastRenderedQuestions = [];
        contentFallbackBlockedUntil = 0;
        contentFallbackBlockedReason = '';
    }

    function getNodeDepth(node) {
        let depth = 0;
        let current = node;
        while (current && current.parentElement) {
            depth += 1;
            current = current.parentElement;
        }
        return depth;
    }

    function buildQuestionSignature(sourcePath, prompt, options, locationBucket, groupIdentity) {
        const normalizedPrompt = normalizeQuestionOptionText(prompt) || normalizeText(prompt);
        const optionSignature = options
            .map((option) => normalizeQuestionOptionText(option.answerText) || normalizeText(option.answerText))
            .filter(Boolean)
            .sort()
            .join('|');

        return sourcePath + '|' + String(locationBucket) + '|' + String(groupIdentity || '') + '|' + normalizedPrompt + '|' + optionSignature;
    }

    function getQuestionSourcePath(doc) {
        return doc?.__PARAMEXT_SOURCE_PATH
            || doc?.location?.pathname
            || location.pathname;
    }

    function parseQuestions() {
        const blocks = getQuestionBlocks();

        const rawQuestions = [];

        blocks.forEach((root, idx) => {
            const options = getAnswerOptions(root);
            if (options.length === 0) {
                return;
            }

            const ownerDoc = root.ownerDocument || document;
            const sourcePath = getQuestionSourcePath(ownerDoc);
            const virtualProblemId = ownerDoc.__PARAMEXT_HOST_PROBLEM_ID || '';
            const baseDomId = root.getAttribute('data-problem-id') || root.getAttribute('id') || virtualProblemId || ('question-' + idx);
            const matchingPrompt = getMatchingTablePrompt(root);
            const fallbackPrompt = matchingPrompt || getQuestionPrompt(root);

            const grouped = new Map();
            options.forEach((option, optionIndex) => {
                const key = option.groupKey || ('g:' + String(optionIndex));
                if (!grouped.has(key)) {
                    grouped.set(key, []);
                }
                grouped.get(key).push(option);
            });

            const groups = Array.from(grouped.entries());
            groups.forEach(([groupId, groupOptions], groupIndex) => {
                const first = groupOptions[0] || null;
                let groupRoot = first?.groupPath
                    ? (getElementByPath(root, first.groupPath) || root)
                    : root;
                if (groupRoot === root && groups.length > 1) {
                    groupRoot = resolveGroupRootByInput(
                        root,
                        first?.inputPath || '',
                        first?.inputName || '',
                        groupOptions.length,
                    );
                }
                const promptAnchor = getElementByPath(root, first?.inputPath || first?.dragAnswerPath || first?.dragCellPath || '')
                    || groupRoot;
                const promptAnswerTexts = groupOptions
                    .map((option) => sanitizeAnswerText(option.answerText))
                    .filter(Boolean);
                const nearPrompt = findPromptBeforeNode(root, promptAnchor);
                const contextualNearPrompt = nearPrompt ? mergePromptWithAdjacentContext(root, nearPrompt) : '';
                const prompt = sanitizeQuestionPromptText(
                    (getMatchingTableData(groupRoot) ? getMatchingTablePrompt(groupRoot) : '')
                        || contextualNearPrompt
                        || getQuestionPrompt(groupRoot)
                        || fallbackPrompt,
                    promptAnswerTexts,
                );

                const scopedDomId = baseDomId + '::' + String(groupId || groupIndex);
                const locationBucket = Math.round(((groupRoot.getBoundingClientRect().top || root.getBoundingClientRect().top || 0)) / 12);
                const signature = buildQuestionSignature(sourcePath, prompt, groupOptions, locationBucket, groupId);
                const nodeSize = groupRoot.querySelectorAll('*').length;
                const nodeDepth = getNodeDepth(groupRoot);
                const allowsMultipleAnswers = questionAllowsMultipleAnswers(groupRoot);
                const stableAnswerTexts = groupOptions
                    .filter((option) => option.inputType !== 'text')
                    .map((option) => sanitizeAnswerText(normalizeQuestionOptionText(option.answerText) || String(option.answerText || '').trim()))
                    .filter(Boolean);
                const textInputCount = groupOptions.filter((option) => option.inputType === 'text').length;
                const questionKeyBase = buildStableQuestionKeyBase({
                    sourcePath,
                    prompt: normalizeQuestionOptionText(prompt) || prompt,
                    answerTexts: stableAnswerTexts,
                    choiceCount: groupOptions.length,
                    textInputCount,
                    allowsMultipleAnswers
                });

                const byStatus = isQuestionCorrect(groupRoot);
                const byOptions = groupOptions.some((item) => item.correct);
                const normalizedGroupOptions = groupOptions.map((option) => Object.assign({}, option, {
                    correct: Boolean(option.correct || (byStatus && option.selected)),
                    incorrect: Boolean(option.incorrect)
                }));

                rawQuestions.push({
                    questionKey: '',
                    questionKeyBase,
                    domId: scopedDomId,
                    domSelector: '',
                    ownerDocument: groupRoot.ownerDocument || document,
                    root: groupRoot,
                    prompt,
                    correct: byStatus || byOptions,
                    options: normalizedGroupOptions,
                    allowsMultipleAnswers,
                    hasVerifiedAnswer: byStatus || byOptions,
                    fromVirtualContent: Boolean(ownerDoc.__PARAMEXT_VIRTUAL_CONTENT),
                    signature,
                    nodeSize,
                    nodeDepth,
                    sourcePath,
                    orderIndex: (idx * 100) + groupIndex
                });
            });
        });

        const dedupedBySignature = new Map();
        rawQuestions.forEach((question) => {
            const previous = dedupedBySignature.get(question.signature);
            if (!previous) {
                dedupedBySignature.set(question.signature, question);
                return;
            }

            // Prefer the most specific (deeper and smaller) node to avoid nested duplicate wrappers.
            const currentScore = (question.nodeDepth * 100000) - question.nodeSize;
            const previousScore = (previous.nodeDepth * 100000) - previous.nodeSize;
            if (currentScore > previousScore) {
                dedupedBySignature.set(question.signature, question);
            }
        });

        const deduped = Array.from(dedupedBySignature.values());
        deduped.sort((a, b) => a.orderIndex - b.orderIndex);
        const duplicateIndexByBase = new Map();

        deduped.forEach((item) => {
            const occurrenceIndex = duplicateIndexByBase.get(item.questionKeyBase) || 0;
            duplicateIndexByBase.set(item.questionKeyBase, occurrenceIndex + 1);

            item.questionKey = occurrenceIndex === 0
                ? item.questionKeyBase
                : (item.questionKeyBase + '_' + String(occurrenceIndex + 1));
            item.domSelector = '[' + QUESTION_KEY_ATTR + '="' + item.questionKey + '"]';

            if (item.root instanceof Element) {
                item.root.setAttribute(QUESTION_KEY_ATTR, item.questionKey);
            }
        });

        return deduped.map((item) => {
            const question = {
                questionKey: item.questionKey,
                domId: item.domId,
                domSelector: item.domSelector,
                ownerDocument: item.ownerDocument,
                root: item.root,
                prompt: item.prompt,
                correct: item.correct,
                options: item.options,
                allowsMultipleAnswers: item.allowsMultipleAnswers,
                hasVerifiedAnswer: item.hasVerifiedAnswer,
                fromVirtualContent: Boolean(item.fromVirtualContent),
                sourcePath: item.sourcePath,
                orderIndex: item.orderIndex
            };
            return Object.assign(question, enrichQuestionForV2(question));
        });
    }

    function isWholePageCompleted(questions) {
        if (questions.length === 0) {
            return false;
        }
        return questions.every((question) => question.correct);
    }

    async function pushAttemptSnapshot(questions) {
        const context = getCourseContext();
        const payload = {
            source: 'extension',
            context,
            client: getClientMeta(),
            completed: isWholePageCompleted(questions),
            questions: questions.map((question) => {
                const answerTexts = question.options.map((option) => sanitizeAnswerText(option.answerText));
                const prompt = sanitizeQuestionPromptText(question.prompt, answerTexts);
                return {
                    questionKey: question.questionKey,
                    prompt,
                    questionType: question.questionType || 'unknown',
                    questionFingerprint: question.questionFingerprint || '',
                    parserSource: question.parserSource || 'live_dom',
                    parseConfidence: Number(question.parseConfidence || 0),
                    rawType: question.rawType || '',
                    course: question.course || getCourseRefForQuestion(question),
                    verified: question.hasVerifiedAnswer,
                    isCorrect: question.correct,
                    answers: question.options.map((option) => ({
                        answerKey: option.answerKey,
                        answerText: sanitizeAnswerText(option.answerText),
                        selected: option.selected,
                        correct: option.correct,
                        incorrect: option.incorrect,
                        inputType: option.inputType || '',
                        answerFingerprint: hash(sanitizeAnswerText(option.answerText) || option.answerKey)
                    }))
                };
            })
        };

        debugSync('push_attempt_snapshot_payload', {
            context,
            completed: payload.completed,
            questionCount: payload.questions.length,
            questions: summarizeQuestionsForDebug(questions)
        });

        const result = await postWithRetry(openeduApiPrefix() + '/openedu/attempts', payload, 2);
        debugSync('push_attempt_snapshot_result', {
            ok: result.ok,
            status: result.status,
            error: result.error || ''
        });
        return result;
    }

    async function pullStatistics(questions) {
        const context = getCourseContext();
        const queryPayload = {
            context,
            client: getClientMeta(),
            questionKeys: questions.map((question) => question.questionKey),
            questions: questions.map((question) => {
                const answers = question.options
                    .filter((option) => option.inputType !== 'text')
                    .map((option) => sanitizeAnswerText(option.answerText))
                    .filter(Boolean);
                return {
                    questionKey: question.questionKey,
                    prompt: sanitizeQuestionPromptText(question.prompt, answers),
                    answers,
                    questionType: question.questionType || 'unknown',
                    questionFingerprint: question.questionFingerprint || '',
                    parserSource: question.parserSource || 'live_dom',
                    parseConfidence: Number(question.parseConfidence || 0),
                    course: question.course || getCourseRefForQuestion(question)
                };
            })
        };

        debugSync('pull_statistics_payload', {
            context,
            questionCount: queryPayload.questionKeys.length,
            questionKeys: queryPayload.questionKeys
        });

        const result = await postWithRetry(openeduApiPrefix() + '/openedu/solutions/query', queryPayload, 1);
        const statsByQuestion = result?.data?.statsByQuestion;
        const statsKeys = statsByQuestion && typeof statsByQuestion === 'object' ? Object.keys(statsByQuestion) : [];
        const nonEmptyStatsKeys = statsKeys.filter((key) => {
            const entry = statsByQuestion?.[key];
            const verifiedCount = Array.isArray(entry?.verifiedAnswers) ? entry.verifiedAnswers.length : 0;
            const incorrectCount = Array.isArray(entry?.incorrectAnswers) ? entry.incorrectAnswers.length : 0;
            const fallbackCount = Array.isArray(entry?.fallbackAnswers) ? entry.fallbackAnswers.length : 0;
            return verifiedCount > 0 || incorrectCount > 0 || fallbackCount > 0;
        });
        debugSync('pull_statistics_result', {
            ok: result.ok,
            status: result.status,
            error: result.error || '',
            statsKeys: statsKeys.length,
            nonEmptyStatsKeys: nonEmptyStatsKeys.length
        });
        return result;
    }

    function locateQuestionBlock(question) {
        if (question.root instanceof HTMLElement && question.root.isConnected) {
            return question.root;
        }

        const doc = question.ownerDocument || document;

        const byKey = question.domSelector ? doc.querySelector(question.domSelector) : null;
        if (byKey instanceof HTMLElement) {
            return byKey;
        }

        if (question.domId) {
            const byDataId = doc.querySelector('[data-problem-id="' + question.domId.replace(/"/g, '\\"') + '"]');
            if (byDataId instanceof HTMLElement) {
                return byDataId;
            }

            const byId = doc.getElementById(question.domId);
            if (byId instanceof HTMLElement) {
                return byId;
            }
        }

        return null;
    }

    function matchesQuestionReference(candidate, reference) {
        if (typeof openeduShared.matchesQuestionReference === 'function') {
            return openeduShared.matchesQuestionReference(candidate, reference);
        }

        return String(candidate?.questionKey || '') === String(reference?.questionKey || '');
    }

    function findQuestionByReference(questions, reference) {
        const list = Array.isArray(questions) ? questions : [];
        return list.find((question) => matchesQuestionReference(question, reference)) || null;
    }

    function getTopFrameIframeSourceKey(event) {
        const explicitFrameId = collapseWhitespace(event?.data?.frameId || '');
        if (explicitFrameId) {
            return explicitFrameId;
        }

        const source = event?.source;
        if (source && (typeof source === 'object' || typeof source === 'function')) {
            if (!topFrameIframeSourceIds.has(source)) {
                topFrameIframeSnapshotSeq += 1;
                topFrameIframeSourceIds.set(source, 'frame-source-' + String(topFrameIframeSnapshotSeq));
            }
            return topFrameIframeSourceIds.get(source);
        }

        topFrameIframeSnapshotSeq += 1;
        return 'frame-unknown-' + String(topFrameIframeSnapshotSeq);
    }

    function mergeStatsEntryForIframeAggregate(previous, next) {
        if (!previous) {
            return buildMergedStatsEntry(next, Boolean(next?.localOnly));
        }

        return {
            completedCount: Math.max(
                Number(previous.completedCount || 0),
                Number(next?.completedCount || 0)
            ),
            verifiedAnswers: mergeAnswerStatsLists(previous.verifiedAnswers, next?.verifiedAnswers),
            incorrectAnswers: mergeAnswerStatsLists(previous.incorrectAnswers, next?.incorrectAnswers),
            fallbackAnswers: mergeAnswerStatsLists(previous.fallbackAnswers, next?.fallbackAnswers),
            localOnly: Boolean(previous.localOnly) && Boolean(next?.localOnly),
            similarMatch: Boolean(previous.similarMatch) || Boolean(next?.similarMatch),
            matchedBy: previous.matchedBy || next?.matchedBy || '',
            matchedQuestionKey: previous.matchedQuestionKey || next?.matchedQuestionKey || '',
            matchedScore: Math.max(Number(previous.matchedScore || 0), Number(next?.matchedScore || 0))
        };
    }

    function rebuildTopFrameIframeAggregate(now) {
        const currentTime = Number(now || Date.now());
        const maxAgeMs = 180000;
        const questions = [];
        const stats = {};
        let latestSyncAt = 0;

        for (const [key, snapshot] of topFrameIframeSnapshots.entries()) {
            const updatedAt = Number(snapshot?.updatedAt || 0);
            if (updatedAt > 0 && currentTime - updatedAt > maxAgeMs) {
                topFrameIframeSnapshots.delete(key);
                continue;
            }

            latestSyncAt = Math.max(latestSyncAt, updatedAt);
            (Array.isArray(snapshot?.questions) ? snapshot.questions : []).forEach((question) => {
                questions.push(question);
            });

            const snapshotStats = snapshot?.stats && typeof snapshot.stats === 'object'
                ? snapshot.stats
                : {};
            Object.keys(snapshotStats).forEach((questionKey) => {
                stats[questionKey] = mergeStatsEntryForIframeAggregate(stats[questionKey], snapshotStats[questionKey]);
            });
        }

        topFrameIframeQuestions = questions;
        topFrameIframeStats = stats;
        topFrameIframeSyncAt = latestSyncAt;
    }

    function updateTopFrameIframeSnapshot(event) {
        const now = Date.now();
        const sourceKey = getTopFrameIframeSourceKey(event);
        topFrameIframeSnapshots.set(sourceKey, {
            updatedAt: now,
            stats: event?.data?.stats && typeof event.data.stats === 'object' ? event.data.stats : {},
            questions: Array.isArray(event?.data?.questions) ? event.data.questions : []
        });
        rebuildTopFrameIframeAggregate(now);
    }

    function clearTopFrameIframeSnapshots(source) {
        if (!isTopFrame) {
            return;
        }

        topFrameIframeSnapshots.clear();
        topFrameIframeQuestions = null;
        topFrameIframeStats = null;
        topFrameIframeSyncAt = 0;
        debugSync('top_iframe_snapshots_cleared', {
            source: String(source || 'unknown')
        });
    }

    function broadcastOpeneduMessageToChildFrames(payload) {
        let posted = false;
        const frames = document.querySelectorAll('iframe, frame');
        frames.forEach((frame) => {
            try {
                if (frame.contentWindow) {
                    frame.contentWindow.postMessage(payload, '*');
                    posted = true;
                }
            } catch (_) {
                // Ignore inaccessible child frames.
            }
        });
        return posted;
    }

    function broadcastApplyMessageToChildFrames(payload) {
        return broadcastOpeneduMessageToChildFrames(payload);
    }

    function requestApplyAnswers(question, answers, mode) {
        if (!question) {
            return false;
        }

        if (question.fromVirtualContent) {
            return isTopFrame
                ? broadcastApplyMessageToChildFrames({
                    type: 'PARAMEXT_APPLY_ANSWERS',
                    question: {
                        questionKey: question.questionKey,
                        domId: question.domId,
                        prompt: question.prompt,
                        options: Array.isArray(question.options) ? question.options : []
                    },
                    answers: Array.isArray(answers) ? answers : [],
                    mode: typeof mode === 'string' ? mode : 'add'
                })
                : false;
        }

        if (isTopFrame && question.fromIframe) {
            return broadcastApplyMessageToChildFrames({
                type: 'PARAMEXT_APPLY_ANSWERS',
                question: {
                    questionKey: question.questionKey,
                    domId: question.domId,
                    prompt: question.prompt,
                    options: Array.isArray(question.options) ? question.options : []
                },
                answers: Array.isArray(answers) ? answers : [],
                mode: typeof mode === 'string' ? mode : 'add'
            });
        }

        return applyAnswersToQuestion(question, answers, mode);
    }

    function findInputForOption(block, option) {
        if (option.inputPath) {
            const byPath = getElementByPath(block, option.inputPath);
            if (byPath instanceof HTMLInputElement) {
                return byPath;
            }
        }

        if (option.inputId) {
            const direct = block.querySelector('#' + escapeSelector(option.inputId));
            if (direct instanceof HTMLInputElement) {
                return direct;
            }
        }

        // For text inputs, label-text matching doesn't apply
        // (the label is the prompt, not the answer text).
        if (option.inputType === 'text') {
            if (option.inputName) {
                const byName = block.querySelector('input[type="text"][name="' + escapeSelector(option.inputName) + '"]');
                if (byName instanceof HTMLInputElement) {
                    return byName;
                }
            }
            return null;
        }

        const expectedText = normalizeText(option.answerText);
        if (!expectedText) {
            return null;
        }

        const labels = block.querySelectorAll(OPTION_LABEL_SELECTOR);
        for (const label of labels) {
            const normalized = normalizeText(getOptionAnswerText(label, null));
            if (normalized !== expectedText) {
                continue;
            }

            const inputId = label.getAttribute('for') || '';
            if (inputId) {
                const byId = block.querySelector('#' + escapeSelector(inputId));
                if (byId instanceof HTMLInputElement) {
                    return byId;
                }
            }

            const nested = label.querySelector('input[type="radio"], input[type="checkbox"]');
            if (nested instanceof HTMLInputElement) {
                return nested;
            }
        }

        return null;
    }

    function findSelectForOption(block, option) {
        if (option.inputPath) {
            const byPath = getElementByPath(block, option.inputPath);
            if (byPath instanceof HTMLSelectElement) {
                return byPath;
            }
        }

        if (option.inputId) {
            const direct = block.querySelector('#' + escapeSelector(option.inputId));
            if (direct instanceof HTMLSelectElement) {
                return direct;
            }
        }

        if (option.inputName) {
            const byName = block.querySelector('select[name="' + escapeSelector(option.inputName) + '"]');
            if (byName instanceof HTMLSelectElement) {
                return byName;
            }
        }

        return null;
    }

    function questionAllowsMultipleAnswers(block) {
        if (getMatchingTableData(block)) {
            return true;
        }
        if (getDragMatchingTableData(block)) {
            return true;
        }
        const multiSelects = block.querySelectorAll('select[multiple]');
        if (multiSelects.length > 0) {
            return true;
        }
        const checkboxes = block.querySelectorAll('input[type="checkbox"]');
        const radios = block.querySelectorAll('input[type="radio"]');
        return checkboxes.length > 0 && radios.length === 0;
    }

    function dispatchInputState(input, checked) {
        if (!(input instanceof HTMLInputElement)) {
            return;
        }

        if (input.checked === checked) {
            return;
        }

        input.checked = checked;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function dispatchAnswerMutationEvents(element) {
        if (!(element instanceof EventTarget)) {
            return;
        }

        ['input', 'change', 'keyup', 'blur'].forEach((eventName) => {
            try {
                element.dispatchEvent(new Event(eventName, { bubbles: true }));
            } catch (_) {
                // Some synthetic targets do not support every event type.
            }
        });
    }

    function notifyQuestionAnswerChanged(block, primaryControl) {
        if (!(block instanceof HTMLElement)) {
            return;
        }

        dispatchAnswerMutationEvents(primaryControl);
        const form = block.closest('form');
        dispatchAnswerMutationEvents(form);
        dispatchAnswerMutationEvents(block);

        setTimeout(() => {
            dispatchAnswerMutationEvents(primaryControl);
            dispatchAnswerMutationEvents(form);
        }, 60);
    }

    function highlightQuestionBlock(block) {
        if (wandsHidden) {
            return;
        }
        block.classList.add('moodush-openedu-highlight');
        setTimeout(() => {
            block.classList.remove('moodush-openedu-highlight');
        }, 1600);
    }

    function resolveTargetOptions(options, targetAnswers) {
        const targets = Array.isArray(targetAnswers) ? targetAnswers : [];
        const resolved = [];
        const seen = new Set();

        function optionMatchesText(option, expectedText) {
            if (!expectedText) {
                return false;
            }

            if (normalizeText(option?.answerText || '') === expectedText) {
                return true;
            }

            return (Array.isArray(option?.answerAliases) ? option.answerAliases : [])
                .some((alias) => normalizeText(alias) === expectedText);
        }

        targets.forEach((target) => {
            const expectedKey = String(target?.answerKey || '').trim();
            const expectedText = normalizeText(target?.answerText || target || '');

            let matched = null;
            if (expectedKey) {
                matched = options.find((option) => option.answerKey === expectedKey) || null;
            }
            if (!matched && expectedText) {
                matched = options.find((option) => optionMatchesText(option, expectedText)) || null;
            }
            if (!matched) {
                return;
            }

            const key = matched.answerKey + '|' + normalizeText(matched.answerText);
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            resolved.push(matched);
        });

        return resolved;
    }

    function setNativeInputValue(input, value) {
        const proto = input instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) {
            nativeSetter.call(input, value);
        } else {
            input.value = value;
        }
    }

    function normalizeMatchingTargetKey(value) {
        const decoded = decodeHtmlEntities(String(value || ''));
        const normalized = typeof openeduShared.normalizeMatchingText === 'function'
            ? openeduShared.normalizeMatchingText(decoded)
            : normalizeText(decoded);
        return normalizeText(String(normalized || '').replace(/\s*[:/|]\s*/g, ': '));
    }

    function getMatchingCellInfo(initialData, cellId) {
        const table = Array.isArray(initialData?.table) ? initialData.table : [];
        const targetId = String(cellId || '').trim();
        if (!targetId) {
            return null;
        }

        for (let rowIndex = 0; rowIndex < table.length; rowIndex += 1) {
            const row = table[rowIndex];
            if (!Array.isArray(row)) {
                continue;
            }

            for (let colIndex = 0; colIndex < row.length; colIndex += 1) {
                const cell = row[colIndex];
                if (!cell || typeof cell !== 'object' || String(cell.id || '') !== targetId) {
                    continue;
                }

                const rowFixedTexts = row
                    .filter((candidate) => candidate && candidate.isFixed)
                    .map((candidate) => {
                        const values = Array.isArray(candidate.value) ? candidate.value : [];
                        const raw = values.join(' ');
                        return typeof openeduShared.normalizeMatchingText === 'function'
                            ? openeduShared.normalizeMatchingText(raw)
                            : normalizeQuestionOptionText(raw);
                    })
                    .filter(Boolean);

                return {
                    cellId: targetId,
                    rowIndex,
                    colIndex,
                    rowFixedText: rowFixedTexts[0] || '',
                    rowFixedTexts
                };
            }
        }

        return null;
    }

    function isElementVisibleEnough(element) {
        if (!(element instanceof Element)) {
            return false;
        }

        const style = element.ownerDocument?.defaultView?.getComputedStyle
            ? element.ownerDocument.defaultView.getComputedStyle(element)
            : null;
        if (style && (style.display === 'none' || style.visibility === 'hidden')) {
            return false;
        }

        const rect = typeof element.getBoundingClientRect === 'function'
            ? element.getBoundingClientRect()
            : null;
        return !rect || rect.width > 0 || rect.height > 0 || Boolean(element.offsetParent);
    }

    function findMatchingElementById(root, id, attrNames) {
        if (!(root instanceof Element)) {
            return null;
        }

        const normalizedId = String(id || '').trim();
        if (!normalizedId) {
            return null;
        }

        const escaped = escapeSelector(normalizedId);
        const selectors = ['#' + escaped]
            .concat((Array.isArray(attrNames) ? attrNames : []).map((attr) => '[' + attr + '="' + escaped + '"]'));

        for (const selector of selectors) {
            const found = root.querySelector(selector);
            if (found instanceof HTMLElement && isElementVisibleEnough(found)) {
                return found;
            }
        }

        return null;
    }

    function getSmallestExactTextElement(root, text) {
        if (!(root instanceof Element)) {
            return null;
        }

        const expected = normalizeMatchingTargetKey(text);
        if (!expected) {
            return null;
        }

        const candidates = Array.from(root.querySelectorAll('*'))
            .filter((node) => node instanceof HTMLElement)
            .filter((node) => !node.matches(PARAMEXT_WIDGET_SELECTOR))
            .filter((node) => isElementVisibleEnough(node))
            .filter((node) => normalizeMatchingTargetKey(textOf(node)) === expected);

        candidates.sort((a, b) => {
            const aChildren = a.children.length;
            const bChildren = b.children.length;
            if (aChildren !== bChildren) {
                return aChildren - bChildren;
            }
            return textOf(a).length - textOf(b).length;
        });

        return candidates[0] || null;
    }

    function getMatchingAnswerMoveElement(answerElement) {
        if (!(answerElement instanceof HTMLElement)) {
            return null;
        }

        let current = answerElement;
        while (current.parentElement && current.parentElement instanceof HTMLElement) {
            const parent = current.parentElement;
            const parentText = normalizeMatchingTargetKey(textOf(parent));
            const currentText = normalizeMatchingTargetKey(textOf(current));
            if (parentText !== currentText || parent.matches('td, th, tr, table, tbody, .adv-app')) {
                break;
            }
            current = parent;
        }

        return current;
    }

    function findMatchingTableRowContainer(labelElement, rowText) {
        if (!(labelElement instanceof HTMLElement)) {
            return null;
        }

        const tableRow = labelElement.closest('tr');
        if (tableRow instanceof HTMLElement) {
            return tableRow;
        }

        let current = labelElement;
        const expected = normalizeMatchingTargetKey(rowText);
        while (current && current.parentElement) {
            const parent = current.parentElement;
            if (!(parent instanceof HTMLElement) || parent.matches('.adv-app')) {
                break;
            }

            const children = Array.from(parent.children).filter((child) => child instanceof HTMLElement);
            const hasLabelChild = children.some((child) => normalizeMatchingTargetKey(textOf(child)).includes(expected));
            if (children.length >= 2 && hasLabelChild) {
                return parent;
            }

            current = parent;
        }

        return null;
    }

    function findMatchingTableTargetCell(matchingData, target) {
        const app = matchingData?.app;
        if (!(app instanceof HTMLElement)) {
            return null;
        }

        const direct = findMatchingElementById(app, target?.cellId, [
            'data-id',
            'data-cell-id',
            'data-target-id',
            'data-value'
        ]);
        if (direct instanceof HTMLElement) {
            return direct;
        }

        const cellInfo = getMatchingCellInfo(matchingData.initialData, target?.cellId);
        const rowText = cellInfo?.rowFixedText || String(target?.cellLabel || '').split('/')[0] || '';
        const labelElement = getSmallestExactTextElement(app, rowText);
        const rowContainer = findMatchingTableRowContainer(labelElement, rowText);
        if (!(rowContainer instanceof HTMLElement)) {
            return null;
        }

        const rowCells = Array.from(rowContainer.children).filter((child) => child instanceof HTMLElement);
        if (cellInfo && rowCells[cellInfo.colIndex] instanceof HTMLElement) {
            return rowCells[cellInfo.colIndex];
        }

        const labelIndex = rowCells.findIndex((child) => child.contains(labelElement));
        const fallback = labelIndex >= 0 ? rowCells[labelIndex + 1] : null;
        return fallback instanceof HTMLElement ? fallback : null;
    }

    function findMatchingTableAnswerElement(matchingData, target) {
        const app = matchingData?.app;
        if (!(app instanceof HTMLElement)) {
            return null;
        }

        const direct = findMatchingElementById(app, target?.answerId, [
            'data-id',
            'data-answer-id',
            'data-source-id',
            'data-value'
        ]);
        if (direct instanceof HTMLElement) {
            return getMatchingAnswerMoveElement(direct);
        }

        const byText = getSmallestExactTextElement(app, target?.answerTitle || '');
        return getMatchingAnswerMoveElement(byText);
    }

    function syncMatchingTableVisualAnswers(matchingData, targets) {
        if (!matchingData?.app || !Array.isArray(targets) || targets.length === 0) {
            return false;
        }

        let movedCount = 0;
        targets.forEach((target) => {
            const cell = findMatchingTableTargetCell(matchingData, target);
            const answerElement = findMatchingTableAnswerElement(matchingData, target);
            if (!(cell instanceof HTMLElement) || !(answerElement instanceof HTMLElement)) {
                return;
            }
            if (cell.contains(answerElement)) {
                movedCount += 1;
                return;
            }

            cell.appendChild(answerElement);
            movedCount += 1;
        });

        return movedCount > 0;
    }

    function resolveMatchingTargets(block, answers) {
        const matchingData = getMatchingTableData(block);
        if (!matchingData || typeof openeduShared.buildMatchingTablePairs !== 'function') {
            return [];
        }

        const candidates = openeduShared.buildMatchingTablePairs(matchingData.initialData, {}, true);
        const byKey = new Map();
        const byText = new Map();

        candidates.forEach((candidate) => {
            const cellId = String(candidate.cellId || '').trim();
            const answerId = String(candidate.answerId || '').trim();
            const answerText = String(candidate.answerText || '').trim();
            if (!cellId || !answerId || !answerText) {
                return;
            }

            const item = { cellId, answerId, answerText };
            item.answerTitle = String(candidate.answerTitle || '').trim();
            item.cellLabel = String(candidate.cellLabel || '').trim();
            byKey.set('match:' + cellId + ':' + answerId, item);
            byText.set(normalizeMatchingTargetKey(answerText), item);
        });

        const resolved = [];
        const seenCells = new Set();
        (Array.isArray(answers) ? answers : []).forEach((answer) => {
            const rawKey = String(answer?.answerKey || '').trim();
            const rawText = String(answer?.answerText || answer || '').trim();
            const match = byKey.get(rawKey) || byText.get(normalizeMatchingTargetKey(rawText));
            if (!match || seenCells.has(match.cellId)) {
                return;
            }
            seenCells.add(match.cellId);
            resolved.push(match);
        });

        return resolved;
    }

    function applyMatchingTableAnswers(block, question, answers, mode) {
        const matchingData = getMatchingTableData(block);
        if (!matchingData) {
            return false;
        }

        const targets = resolveMatchingTargets(block, answers);
        if (targets.length === 0) {
            debugSync('apply_answers_failed', {
                reason: 'matching_targets_not_resolved',
                questionKey: question?.questionKey || ''
            });
            return false;
        }

        const current = parseOpenEduDataLiteral(matchingData.input.value || '') || {};
        const currentAnswer = current && typeof current.answer === 'object' ? current.answer : {};
        const nextAnswer = mode === 'set-all' ? {} : { ...currentAnswer };
        targets.forEach((target) => {
            nextAnswer[target.cellId] = [target.answerId];
        });

        setNativeInputValue(matchingData.input, JSON.stringify({ answer: nextAnswer }));
        matchingData.input.dispatchEvent(new Event('input', { bubbles: true }));
        matchingData.input.dispatchEvent(new Event('change', { bubbles: true }));
        const visualSynced = syncMatchingTableVisualAnswers(matchingData, targets);
        notifyQuestionAnswerChanged(block, matchingData.input);
        highlightQuestionBlock(block);
        debugSync('apply_answers_success', {
            questionKey: question?.questionKey || '',
            mode: 'matching-table',
            visualSynced,
            selected: targets.map((item) => ({
                answerText: item.answerText,
                answerKey: 'match:' + item.cellId + ':' + item.answerId
            }))
        });
        return true;
    }

    function updateDragMatchingTextarea(dragData) {
        if (!dragData?.textarea) {
            return;
        }

        const answer = {};
        dragData.cells.forEach((cell) => {
            if (!(cell instanceof HTMLElement) || !cell.id) {
                return;
            }
            const ids = Array.from(cell.querySelectorAll('.dragAnswer[id]'))
                .map((node) => String(node.id || '').trim())
                .filter(Boolean);
            if (ids.length > 0) {
                answer[cell.id] = ids;
            }
        });

        setNativeInputValue(dragData.textarea, JSON.stringify({ answer }));
        dragData.textarea.dispatchEvent(new Event('input', { bubbles: true }));
        dragData.textarea.dispatchEvent(new Event('change', { bubbles: true }));
        notifyQuestionAnswerChanged(dragData.container, dragData.textarea);
    }

    function dispatchDragMatchingChange(target) {
        if (!(target instanceof HTMLElement)) {
            return;
        }
        target.dispatchEvent(new Event('input', { bubbles: true }));
        target.dispatchEvent(new Event('change', { bubbles: true }));
        target.dispatchEvent(new Event('sortupdate', { bubbles: true }));
        target.dispatchEvent(new Event('sortreceive', { bubbles: true }));
    }

    function applyDragMatchingTableAnswers(block, question, answers, mode) {
        const dragData = getDragMatchingTableData(block);
        if (!dragData) {
            return false;
        }

        const targets = resolveDragMatchingTargets(block, answers);
        if (targets.length === 0) {
            debugSync('apply_answers_failed', {
                reason: 'drag_matching_targets_not_resolved',
                questionKey: question?.questionKey || ''
            });
            return false;
        }

        const targetCellIds = new Set(targets.map((target) => target.cellId));
        const targetAnswerIds = new Set(targets.map((target) => target.answerId));
        const modeName = typeof mode === 'string' ? mode : 'add';
        if (modeName === 'set-all' && dragData.answerBank instanceof HTMLElement) {
            dragData.cells.forEach((cell) => {
                Array.from(cell.querySelectorAll('.dragAnswer[id]')).forEach((answerElement) => {
                    if (!(answerElement instanceof HTMLElement) || targetAnswerIds.has(answerElement.id)) {
                        return;
                    }
                    dragData.answerBank.appendChild(answerElement);
                });
            });
        }

        let movedCount = 0;
        targets.forEach((target) => {
            const cell = dragData.container.querySelector('#' + escapeSelector(target.cellId));
            const answerElement = dragData.container.querySelector('#' + escapeSelector(target.answerId));
            if (!(cell instanceof HTMLElement) || !(answerElement instanceof HTMLElement)) {
                return;
            }

            if (modeName === 'set-all') {
                Array.from(cell.querySelectorAll('.dragAnswer[id]')).forEach((existing) => {
                    if (!(existing instanceof HTMLElement) || existing.id === target.answerId || !(dragData.answerBank instanceof HTMLElement)) {
                        return;
                    }
                    dragData.answerBank.appendChild(existing);
                });
            }

            if (!cell.contains(answerElement)) {
                cell.appendChild(answerElement);
                movedCount += 1;
            }
            dispatchDragMatchingChange(cell);
            dispatchDragMatchingChange(answerElement);
        });

        updateDragMatchingTextarea(dragData);
        highlightQuestionBlock(block);
        debugSync('apply_answers_success', {
            questionKey: question?.questionKey || '',
            mode: 'drag-table',
            movedCount,
            clearedCells: Array.from(targetCellIds),
            selected: targets.map((item) => ({
                answerText: item.answerText,
                answerKey: item.answerKey
            }))
        });
        return true;
    }

    function applySelectAnswers(block, question, answers, mode) {
        const options = getAnswerOptions(block);
        const targets = resolveTargetOptions(options, answers);
        if (targets.length === 0) {
            debugSync('apply_answers_failed', {
                reason: 'select_targets_not_resolved',
                questionKey: question?.questionKey || ''
            });
            return false;
        }

        const select = findSelectForOption(block, targets[0]);
        if (!(select instanceof HTMLSelectElement)) {
            debugSync('apply_answers_failed', {
                reason: 'select_not_found',
                questionKey: question?.questionKey || ''
            });
            return false;
        }

        const modeName = typeof mode === 'string' ? mode : 'add';
        const targetValues = new Set();
        const targetTexts = new Set();
        targets.forEach((target) => {
            const value = normalizeText(target?.inputValue || '');
            const text = normalizeText(target?.answerText || '');
            if (value) {
                targetValues.add(value);
            }
            if (text) {
                targetTexts.add(text);
            }
        });

        const optionNodes = Array.from(select.options || []).filter((item) => item instanceof HTMLOptionElement);
        const shouldSelectOption = (optionNode) => {
            if (isSelectPlaceholderOption(optionNode)) {
                return false;
            }
            const optionValue = normalizeText(optionNode.value || '');
            const optionText = normalizeText(getSelectOptionAnswerText(optionNode));
            return targetValues.has(optionValue) || targetTexts.has(optionText);
        };

        if (select.multiple && modeName !== 'set-all') {
            optionNodes.forEach((optionNode) => {
                if (shouldSelectOption(optionNode)) {
                    optionNode.selected = true;
                }
            });
        } else if (select.multiple || modeName === 'set-all') {
            optionNodes.forEach((optionNode) => {
                optionNode.selected = shouldSelectOption(optionNode);
            });
        } else {
            const selectedOption = optionNodes.find((optionNode) => shouldSelectOption(optionNode)) || null;
            if (!selectedOption) {
                debugSync('apply_answers_failed', {
                    reason: 'select_option_not_found',
                    questionKey: question?.questionKey || ''
                });
                return false;
            }
            select.value = selectedOption.value;
            selectedOption.selected = true;
        }

        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        notifyQuestionAnswerChanged(block, select);
        highlightQuestionBlock(block);
        debugSync('apply_answers_success', {
            questionKey: question?.questionKey || '',
            mode: 'select',
            selected: targets.map((item) => ({
                answerKey: item.answerKey,
                answerText: item.answerText
            }))
        });
        return true;
    }

    function applyAnswersToQuestion(question, answers, mode) {
        const block = locateQuestionBlock(question);
        if (!block) {
            debugSync('apply_answers_failed', {
                reason: 'question_block_not_found',
                questionKey: question?.questionKey || ''
            });
            return false;
        }

        if (getMatchingTableData(block)) {
            return applyMatchingTableAnswers(block, question, answers, mode);
        }

        if (getDragMatchingTableData(block)) {
            return applyDragMatchingTableAnswers(block, question, answers, mode);
        }

        // Text input questions: fill the field directly instead of
        // going through the radio/checkbox resolve logic.
        const textInput = block.querySelector('input[type="text"]');
        if (textInput instanceof HTMLInputElement) {
            const targetText = String(
                (Array.isArray(answers) ? answers[0] : answers)?.answerText
                || (Array.isArray(answers) ? answers[0] : answers)
                || ''
            ).trim();
            if (!targetText) {
                debugSync('apply_answers_failed', {
                    reason: 'text_input_empty_target',
                    questionKey: question?.questionKey || ''
                });
                return false;
            }

            setNativeInputValue(textInput, targetText);
            textInput.dispatchEvent(new Event('input', { bubbles: true }));
            textInput.dispatchEvent(new Event('change', { bubbles: true }));
            notifyQuestionAnswerChanged(block, textInput);
            highlightQuestionBlock(block);
            debugSync('apply_answers_success', {
                questionKey: question?.questionKey || '',
                mode: 'text',
                answerText: targetText
            });
            return true;
        }

        const hasSelectOption = Array.isArray(question?.options)
            && question.options.some((option) => option.inputType === 'select');
        if (hasSelectOption) {
            return applySelectAnswers(block, question, answers, mode);
        }

        const options = getAnswerOptions(block);
        const targets = resolveTargetOptions(options, answers);
        if (targets.length === 0) {
            debugSync('apply_answers_failed', {
                reason: 'target_answers_not_resolved',
                questionKey: question?.questionKey || '',
                requestedAnswers: Array.isArray(answers) ? answers.map((item) => ({
                    answerKey: item?.answerKey || '',
                    answerText: item?.answerText || item || ''
                })) : []
            });
            return false;
        }

        const multi = questionAllowsMultipleAnswers(block);
        if (!multi) {
            const input = findInputForOption(block, targets[0]);
            if (!(input instanceof HTMLInputElement)) {
                debugSync('apply_answers_failed', {
                    reason: 'input_not_found_single',
                    questionKey: question?.questionKey || '',
                    target: {
                        answerKey: targets[0]?.answerKey || '',
                        answerText: targets[0]?.answerText || ''
                    }
                });
                return false;
            }

            input.click();
            input.dispatchEvent(new Event('change', { bubbles: true }));
            notifyQuestionAnswerChanged(block, input);
            highlightQuestionBlock(block);
            debugSync('apply_answers_success', {
                questionKey: question?.questionKey || '',
                mode: 'single',
                selected: [{
                    answerKey: targets[0]?.answerKey || '',
                    answerText: targets[0]?.answerText || ''
                }]
            });
            return true;
        }

        const selectedInputs = new Set();
        targets.forEach((target) => {
            const input = findInputForOption(block, target);
            if (input instanceof HTMLInputElement && input.type === 'checkbox') {
                selectedInputs.add(input);
            }
        });

        if (selectedInputs.size === 0) {
            debugSync('apply_answers_failed', {
                reason: 'no_checkbox_inputs_resolved',
                questionKey: question?.questionKey || ''
            });
            return false;
        }

        const modeName = typeof mode === 'string' ? mode : 'add';
        if (modeName === 'set-all') {
            const allCheckboxes = block.querySelectorAll('input[type="checkbox"]');
            allCheckboxes.forEach((input) => {
                if (input instanceof HTMLInputElement) {
                    dispatchInputState(input, selectedInputs.has(input));
                }
            });
        } else {
            selectedInputs.forEach((input) => {
                dispatchInputState(input, true);
            });
        }

        notifyQuestionAnswerChanged(block, selectedInputs.values().next().value || null);
        highlightQuestionBlock(block);
        debugSync('apply_answers_success', {
            questionKey: question?.questionKey || '',
            mode: modeName,
            selected: targets.map((item) => ({
                answerKey: item.answerKey,
                answerText: item.answerText
            }))
        });
        return true;
    }

    function applyAnswerToQuestion(question, answer) {
        return applyAnswersToQuestion(question, [answer], 'set-all');
    }

    function isOpeneduAutoInsertMode() {
        const mode = settings?.openedu?.mode;
        return mode === 'assist' || mode === 'autoSolve' || mode === 'autoInsert';
    }

    function isOpeneduAutoSolveMode() {
        return settings?.openedu?.mode === 'autoSolve';
    }

    function isOpeneduAutoCheckMode() {
        return settings?.openedu?.mode === 'assist' && Boolean(settings?.openedu?.autoCheckAnswers);
    }

    function getAutoAnswerCandidates(stats) {
        const presentation = getQuestionPresentationState(stats);
        const canUseSimilar = Boolean(settings?.openedu?.autoUseSimilarAnswers);
        const canUseFallback = Boolean(settings?.openedu?.autoUseFallbackAnswers);
        if (presentation.isSimilar && !canUseSimilar) {
            return [];
        }

        if (presentation.verifiedAnswers.length > 0) {
            return presentation.verifiedAnswers;
        }

        if (canUseFallback) {
            return presentation.fallbackAnswers;
        }

        return [];
    }

    function getMissingAnswerAction() {
        const action = settings?.openedu?.missingAnswerAction;
        return action === 'alert' || action === 'advance' ? action : 'stop';
    }

    function getQuestionProblemContainer(question) {
        const block = locateQuestionBlock(question);
        if (!(block instanceof HTMLElement)) {
            return null;
        }

        const problem = block.closest('[data-problem-id], .problem, .xblock-student_view-problem, .problems-wrapper');
        return problem instanceof HTMLElement ? problem : block;
    }

    function getProblemAutoKey(question) {
        const container = getQuestionProblemContainer(question);
        if (!(container instanceof HTMLElement)) {
            return question?.questionKey || question?.domId || '';
        }

        const identity = container.getAttribute('data-problem-id')
            || container.getAttribute('id')
            || buildElementPath(container.ownerDocument?.body || document.body, container)
            || question?.domId
            || question?.questionKey
            || '';
        const sourcePath = container.ownerDocument?.location?.pathname || location.pathname;
        return sourcePath + '|' + identity;
    }

    function isVisibleActionElement(element) {
        if (!(element instanceof HTMLElement)) {
            return false;
        }

        if (element.closest(PARAMEXT_WIDGET_SELECTOR)) {
            return false;
        }

        const disabled = element instanceof HTMLButtonElement || element instanceof HTMLInputElement
            ? element.disabled
            : element.getAttribute('aria-disabled') === 'true';
        if (disabled) {
            return false;
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function getActionElementLabel(element) {
        if (!(element instanceof HTMLElement)) {
            return '';
        }

        const parts = [];
        ['data-value', 'aria-label', 'title', 'value'].forEach((attr) => {
            const value = element.getAttribute(attr);
            if (value) {
                parts.push(value);
            }
        });
        if (element instanceof HTMLInputElement && element.value) {
            parts.push(element.value);
        }
        parts.push(textOf(element));
        return normalizeText(parts.join(' '));
    }

    function isPassiveProblemActionLabel(label) {
        return /(сохран|save|show answer|показ.*ответ|hint|подсказ|reset|сброс)/.test(label);
    }

    function isCheckProblemActionElement(element) {
        const label = getActionElementLabel(element);
        return /(провер|check)/.test(label)
            && !/(отправ|submit)/.test(label)
            && !isPassiveProblemActionLabel(label);
    }

    function isSubmitProblemActionElement(element) {
        const label = getActionElementLabel(element);
        if (isPassiveProblemActionLabel(label)) {
            return false;
        }

        return /(провер|check|отправ|submit)/.test(label) || element.matches('button.submit, input[type="submit"]');
    }

    function findCheckButtonForQuestion(question) {
        const container = getQuestionProblemContainer(question);
        if (!(container instanceof HTMLElement)) {
            return null;
        }

        const candidates = container.querySelectorAll([
            '.problem-action-buttons button',
            '.problem-action-buttons-wrapper button',
            '.action button',
            'button',
            'input[type="button"]',
            'input[type="submit"]'
        ].join(', '));
        for (const candidate of candidates) {
            if (isVisibleActionElement(candidate) && isCheckProblemActionElement(candidate)) {
                return candidate;
            }
        }

        return null;
    }

    function findSubmitButtonForQuestion(question) {
        const container = getQuestionProblemContainer(question);
        if (!(container instanceof HTMLElement)) {
            return null;
        }

        const strictCandidates = container.querySelectorAll([
            'button.submit',
            'button.submit.btn-brand',
            'button[type="submit"]',
            'input[type="submit"]'
        ].join(', '));
        for (const candidate of strictCandidates) {
            if (isVisibleActionElement(candidate) && isSubmitProblemActionElement(candidate)) {
                return candidate;
            }
        }

        const textCandidates = container.querySelectorAll('button, input[type="button"], input[type="submit"]');
        for (const candidate of textCandidates) {
            if (!isVisibleActionElement(candidate)) {
                continue;
            }

            if (isSubmitProblemActionElement(candidate)) {
                return candidate;
            }
        }

        return null;
    }

    function getActiveSequenceTabKey(tabsHost, activeTab) {
        if (!(tabsHost instanceof Element) || !(activeTab instanceof Element)) {
            return '';
        }

        const tabs = Array.from(tabsHost.querySelectorAll('button, a, [role="tab"]'));
        const index = tabs.indexOf(activeTab);
        const identity = activeTab.getAttribute('data-id')
            || activeTab.getAttribute('data-element')
            || activeTab.getAttribute('aria-controls')
            || activeTab.getAttribute('href')
            || activeTab.id
            || normalizeText(textOf(activeTab))
            || 'tab';
        return String(index >= 0 ? index : 0) + ':' + String(identity);
    }

    function requestSequenceFrameSync(source, now) {
        if (!isTopFrame) {
            return;
        }

        const currentTime = Number(now || Date.now());
        if (currentTime - lastSequenceForceSyncAt < AUTO_ADVANCE_FORCE_SYNC_MIN_GAP_MS) {
            return;
        }

        lastSequenceForceSyncAt = currentTime;
        broadcastOpeneduMessageToChildFrames({
            type: 'PARAMEXT_OPENEDU_FORCE_SYNC',
            source: String(source || 'sequence-sync'),
            navigationAt: lastSequenceNavigationAt
        });
    }

    function markSequenceNavigation(source, activeTabKey) {
        if (!isTopFrame) {
            return;
        }

        const now = Date.now();
        lastSequenceNavigationAt = now;
        lastSequenceNavigationGeneration += 1;
        clearTopFrameIframeSnapshots(source);
        if (activeTabKey) {
            lastSequenceTabKey = activeTabKey;
        }

        debugSync('sequence_navigation_marked', {
            source: String(source || 'sequence-navigation'),
            generation: lastSequenceNavigationGeneration,
            activeTabKey: lastSequenceTabKey
        });

        AUTO_ADVANCE_FORCE_SYNC_DELAYS_MS.forEach((delayMs) => {
            setTimeout(() => {
                requestSequenceFrameSync('sequence-navigation-' + String(source || 'unknown'), Date.now());
            }, delayMs);
        });
    }

    function getStatsAnswerEvidenceCount(stats) {
        if (!stats || typeof stats !== 'object') {
            return 0;
        }

        return ['verifiedAnswers', 'incorrectAnswers', 'fallbackAnswers'].reduce((count, key) => {
            return count + (Array.isArray(stats[key]) ? stats[key].length : 0);
        }, 0);
    }

    function questionHasParsedAnswerEvidence(question, statsByQuestion) {
        const options = Array.isArray(question?.options) ? question.options : [];
        const optionEvidence = options.some((option) => {
            return Boolean(option?.selected || option?.correct || option?.incorrect);
        });
        if (optionEvidence) {
            return true;
        }

        const stats = statsByQuestion?.[question?.questionKey] || null;
        return getStatsAnswerEvidenceCount(stats) > 0;
    }

    function getAutoAdvanceParsingState(now) {
        const questions = Array.isArray(topFrameIframeQuestions) ? topFrameIframeQuestions : [];
        const questionCount = questions.length;
        const answerEvidenceCount = questions.reduce((count, question) => {
            return count + (questionHasParsedAnswerEvidence(question, topFrameIframeStats) ? 1 : 0);
        }, 0);

        const navigationAt = Math.max(0, Number(lastSequenceNavigationAt || 0));
        const minSyncDelay = lastSequenceNavigationGeneration > 0 ? AUTO_ADVANCE_MIN_POST_NAV_SYNC_MS : 0;
        const syncedAfterNavigation = topFrameIframeSyncAt > 0
            && topFrameIframeSyncAt >= navigationAt + minSyncDelay;

        return {
            waitMs: AUTO_ADVANCE_PARSE_WAIT_MS,
            elapsedMs: navigationAt > 0 ? Math.max(0, Number(now || Date.now()) - navigationAt) : AUTO_ADVANCE_PARSE_WAIT_MS,
            syncedAfterNavigation,
            questionCount,
            answerEvidenceCount,
            syncAgeMs: topFrameIframeSyncAt > 0 ? Math.max(0, Number(now || Date.now()) - topFrameIframeSyncAt) : 0
        };
    }

    function shouldDelayAutoAdvanceForParsing(state) {
        if (typeof openeduShared.shouldDelayAutoAdvanceForParsing === 'function') {
            return openeduShared.shouldDelayAutoAdvanceForParsing(state);
        }

        if (Number(state?.elapsedMs || 0) >= Number(state?.waitMs || 0)) {
            return false;
        }
        if (!state?.syncedAfterNavigation) {
            return true;
        }
        const questionCount = Math.max(0, Number(state?.questionCount || 0));
        return questionCount > 0 && Math.max(0, Number(state?.answerEvidenceCount || 0)) < questionCount;
    }

    function shouldWaitBeforeAutoAdvance(now) {
        const state = getAutoAdvanceParsingState(now);
        const shouldWait = shouldDelayAutoAdvanceForParsing(state);
        if (!shouldWait) {
            return false;
        }

        requestSequenceFrameSync('auto-advance-wait', now);
        if (now - lastAutoAdvanceWaitLogAt >= AUTO_ADVANCE_WAIT_LOG_COOLDOWN_MS) {
            lastAutoAdvanceWaitLogAt = now;
            debugSync('auto_advance_wait_for_parse', state);
        }
        return true;
    }

    function findNextSequenceButton() {
        if (!isTopFrame) {
            return null;
        }

        const candidates = document.querySelectorAll('.next-btn, .next-button, button');
        for (const candidate of candidates) {
            if (!isVisibleActionElement(candidate)) {
                continue;
            }

            if (candidate.matches('.next-btn, .next-button')) {
                return candidate;
            }

            const text = normalizeText(textOf(candidate));
            if (/^(далее|следующ|next)/.test(text)) {
                return candidate;
            }
        }

        return null;
    }

    function requestNextSequencePage() {
        if (!isTopFrame) {
            try {
                window.top.postMessage({ type: 'PARAMEXT_OPENEDU_NEXT_REQUEST' }, '*');
            } catch (_) {
                // Ignore postMessage failures.
            }
            return false;
        }

        const nextButton = findNextSequenceButton();
        if (!nextButton) {
            return false;
        }

        lastAutoAdvanceAt = Date.now();
        nextButton.click();
        markSequenceNavigation('request-next');
        return true;
    }

    function playMissingAnswerSound() {
        try {
            const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextCtor) {
                return;
            }

            const audioContext = new AudioContextCtor();
            const oscillator = audioContext.createOscillator();
            const gain = audioContext.createGain();
            oscillator.type = 'sine';
            oscillator.frequency.value = 880;
            gain.gain.setValueAtTime(0.001, audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.12, audioContext.currentTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.45);
            oscillator.connect(gain);
            gain.connect(audioContext.destination);
            oscillator.start();
            oscillator.stop(audioContext.currentTime + 0.48);
            setTimeout(() => {
                audioContext.close();
            }, 650);
        } catch (_) {
            // Browsers can block audio before a user gesture. Scrolling/highlight still works.
        }
    }

    function scrollToQuestion(question) {
        const block = locateQuestionBlock(question);
        if (!(block instanceof HTMLElement)) {
            return false;
        }

        try {
            block.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } catch (_) {
            block.scrollIntoView();
        }
        highlightQuestionBlock(block);
        return true;
    }

    function requestScrollToQuestion(question) {
        if (!question) {
            return false;
        }

        if (isTopFrame && question.fromIframe) {
            return broadcastApplyMessageToChildFrames({
                type: 'PARAMEXT_OPENEDU_SCROLL_QUESTION',
                question: {
                    questionKey: question.questionKey,
                    domId: question.domId,
                    prompt: question.prompt,
                    options: Array.isArray(question.options) ? question.options : []
                }
            });
        }

        return scrollToQuestion(question);
    }

    function selectHasMeaningfulAnswer(select) {
        if (!(select instanceof HTMLSelectElement)) {
            return false;
        }

        const selected = Array.from(select.options || []).filter((option) => option.selected);
        if (selected.length === 0) {
            return false;
        }

        return selected.some((option) => !isSelectPlaceholderOption(option));
    }

    function questionHasAnyUserAnswer(question) {
        const block = locateQuestionBlock(question);
        if (!(block instanceof HTMLElement)) {
            return false;
        }

        if (block.querySelector('input[type="radio"]:checked, input[type="checkbox"]:checked')) {
            return true;
        }

        const selectAnswered = Array.from(block.querySelectorAll('select')).some((select) => selectHasMeaningfulAnswer(select));
        if (selectAnswered) {
            return true;
        }

        if (block.querySelector('table.drag-table td.cell .dragAnswer, table.answerPlaceStudent td.cell .dragAnswer')) {
            return true;
        }

        return Array.from(block.querySelectorAll('input[type="text"], textarea')).some((input) => {
            if (!(input instanceof HTMLInputElement) && !(input instanceof HTMLTextAreaElement)) {
                return false;
            }
            return input.value.trim().length > 0;
        });
    }

    function findNextManualQuestion(questions, currentQuestion) {
        const missingQuestions = (Array.isArray(questions) ? questions : [])
            .filter((question) => question && !question.correct)
            .filter((question) => !questionHasAnyUserAnswer(question))
            .sort((a, b) => Number(a?.orderIndex || 0) - Number(b?.orderIndex || 0));
        if (missingQuestions.length === 0) {
            return null;
        }

        const currentOrder = Number(currentQuestion?.orderIndex || -1);
        const afterCurrent = missingQuestions.find((question) => Number(question?.orderIndex || 0) > currentOrder);
        return afterCurrent || missingQuestions[0] || null;
    }

    function alertManualQuestion(question, source, missingCount) {
        if (!question) {
            return;
        }

        if (
            pendingManualAnswerQuestion
            && matchesQuestionReference(pendingManualAnswerQuestion, question)
            && !questionHasAnyUserAnswer(pendingManualAnswerQuestion)
        ) {
            return;
        }

        pendingManualAnswerQuestion = question;
        lastMissingAnswerSignature = question.questionKey || question.domId || '';
        lastMissingAnswerActionAt = Date.now();
        const shouldPlaySound = source !== 'manual-answer-next' && !manualAnswerSoundPlayed;
        if (shouldPlaySound) {
            playMissingAnswerSound();
            manualAnswerSoundPlayed = true;
        }
        scrollToQuestion(question);
        debugSync('missing_answer_action', {
            action: 'alert',
            source: String(source || 'missing-answer'),
            missingCount: Math.max(1, Number(missingCount || 1)),
            questionKey: question?.questionKey || '',
            sound: shouldPlaySound
        });
    }

    function isEventInsideQuestion(event, question) {
        const target = event?.target instanceof Element ? event.target : null;
        const block = locateQuestionBlock(question);
        return Boolean(target && block instanceof HTMLElement && block.contains(target));
    }

    function scheduleContinueAfterManualAnswer(reason) {
        if (manualAnswerContinuationInFlight || !pendingManualAnswerQuestion || getMissingAnswerAction() !== 'alert') {
            return;
        }

        if (!questionHasAnyUserAnswer(pendingManualAnswerQuestion)) {
            return;
        }

        if (pendingManualAnswerTimer) {
            clearTimeout(pendingManualAnswerTimer);
        }

        pendingManualAnswerTimer = setTimeout(() => {
            pendingManualAnswerTimer = 0;
            manualAnswerContinuationInFlight = true;
            const question = pendingManualAnswerQuestion;
            pendingManualAnswerQuestion = null;

            const delayMs = Math.min(900, Math.max(350, Number(settings?.openedu?.autoAdvanceDelayMs || 700)));
            setTimeout(() => {
                const refreshedQuestions = parseQuestions()
                    .filter((item) => item?.ownerDocument === document);
                if (refreshedQuestions.length > 0) {
                    iframeQuestionsCache = refreshedQuestions;
                }

                const nextManualQuestion = findNextManualQuestion(
                    refreshedQuestions.length > 0 ? refreshedQuestions : [question],
                    question
                );
                if (nextManualQuestion) {
                    manualAnswerContinuationInFlight = false;
                    alertManualQuestion(nextManualQuestion, 'manual-answer-next', 1);
                    return;
                }

                manualAnswerContinuationInFlight = false;
                if (isOpeneduAutoSolveMode() && isAutoAdvanceEnabled() && !requestNextSequencePage()) {
                    scheduleCycle(true, 'manual-answer-complete', { allowNetwork: true });
                } else if (!isOpeneduAutoSolveMode()) {
                    maybeAutoCheckInsertedAnswers(
                        refreshedQuestions.length > 0 ? refreshedQuestions : [question],
                        lastMergedStatsByQuestion || {}
                    );
                    scheduleCycle(true, 'manual-answer-queue-complete', { allowNetwork: true });
                }
            }, delayMs);

            debugSync('manual_missing_answer_continue', {
                reason: String(reason || 'manual-answer'),
                clickedSubmit: false,
                questionKey: question?.questionKey || ''
            });
        }, 550);
    }

    function areMatchingAnswersApplied(block, answers) {
        const matchingData = getMatchingTableData(block);
        if (!matchingData) {
            return false;
        }

        const targets = resolveMatchingTargets(block, answers);
        if (targets.length === 0) {
            return false;
        }

        const current = parseOpenEduDataLiteral(matchingData.input.value || '') || {};
        const currentAnswer = current && typeof current.answer === 'object' ? current.answer : {};
        return targets.every((target) => {
            const selected = Array.isArray(currentAnswer[target.cellId]) ? currentAnswer[target.cellId] : [];
            return selected.includes(target.answerId);
        });
    }

    function resolveDragMatchingTargets(block, answers) {
        const options = buildDragMatchingTableOptions(block);
        if (options.length === 0) {
            return [];
        }

        const byKey = new Map();
        const byText = new Map();
        options.forEach((option) => {
            const cellId = String(option.dragCellId || '').trim();
            const answerId = String(option.dragAnswerId || '').trim();
            if (!cellId || !answerId) {
                return;
            }
            const target = {
                cellId,
                answerId,
                answerText: String(option.answerText || '').trim(),
                answerKey: String(option.answerKey || '').trim()
            };
            byKey.set(target.answerKey, target);
            byText.set(normalizeMatchingTargetKey(target.answerText), target);
        });

        const resolved = [];
        const seenCells = new Set();
        (Array.isArray(answers) ? answers : []).forEach((answer) => {
            const rawKey = String(answer?.answerKey || '').trim();
            const rawText = String(answer?.answerText || answer || '').trim();
            const target = byKey.get(rawKey) || byText.get(normalizeMatchingTargetKey(rawText));
            if (!target || seenCells.has(target.cellId)) {
                return;
            }
            seenCells.add(target.cellId);
            resolved.push(target);
        });

        return resolved;
    }

    function areDragMatchingAnswersApplied(block, answers) {
        const dragData = getDragMatchingTableData(block);
        if (!dragData) {
            return false;
        }

        const targets = resolveDragMatchingTargets(block, answers);
        if (targets.length === 0) {
            return false;
        }

        return targets.every((target) => {
            const cell = dragData.container.querySelector('#' + escapeSelector(target.cellId));
            const answer = dragData.container.querySelector('#' + escapeSelector(target.answerId));
            return cell instanceof HTMLElement && answer instanceof HTMLElement && cell.contains(answer);
        });
    }

    function areTextAnswersApplied(block, answers) {
        if (getMatchingTableData(block)) {
            return false;
        }

        const textInput = block.querySelector('input[type="text"]');
        if (!(textInput instanceof HTMLInputElement)) {
            return false;
        }

        const targetText = String(
            (Array.isArray(answers) ? answers[0] : answers)?.answerText
            || (Array.isArray(answers) ? answers[0] : answers)
            || ''
        ).trim();
        return Boolean(targetText) && textInput.value.trim() === targetText;
    }

    function areSelectAnswersApplied(block, answers) {
        const options = getAnswerOptions(block);
        const targets = resolveTargetOptions(options, answers);
        if (targets.length === 0) {
            return false;
        }

        const select = findSelectForOption(block, targets[0]);
        if (!(select instanceof HTMLSelectElement)) {
            return false;
        }

        const selectedValues = new Set(
            Array.from(select.options || [])
                .filter((option) => option instanceof HTMLOptionElement && option.selected)
                .map((option) => normalizeText(option.value || ''))
        );
        const selectedTexts = new Set(
            Array.from(select.options || [])
                .filter((option) => option instanceof HTMLOptionElement && option.selected)
                .map((option) => normalizeText(getSelectOptionAnswerText(option)))
        );

        return targets.every((target) => {
            const value = normalizeText(target?.inputValue || '');
            const text = normalizeText(target?.answerText || '');
            return (value && selectedValues.has(value)) || (text && selectedTexts.has(text));
        });
    }

    function areChoiceAnswersApplied(block, answers) {
        const options = getAnswerOptions(block);
        const targets = resolveTargetOptions(options, answers);
        if (targets.length === 0) {
            return false;
        }

        const multi = questionAllowsMultipleAnswers(block);
        if (!multi) {
            const input = findInputForOption(block, targets[0]);
            return input instanceof HTMLInputElement && input.checked;
        }

        const targetInputs = new Set();
        targets.forEach((target) => {
            const input = findInputForOption(block, target);
            if (input instanceof HTMLInputElement && input.type === 'checkbox') {
                targetInputs.add(input);
            }
        });
        if (targetInputs.size === 0) {
            return false;
        }

        const allCheckboxes = block.querySelectorAll('input[type="checkbox"]');
        for (const input of allCheckboxes) {
            if (!(input instanceof HTMLInputElement)) {
                continue;
            }
            if (input.checked !== targetInputs.has(input)) {
                return false;
            }
        }
        return true;
    }

    function areAnswersAppliedToQuestion(question, answers) {
        const block = locateQuestionBlock(question);
        if (!(block instanceof HTMLElement)) {
            return false;
        }

        if (getMatchingTableData(block)) {
            return areMatchingAnswersApplied(block, answers);
        }

        if (getDragMatchingTableData(block)) {
            return areDragMatchingAnswersApplied(block, answers);
        }

        if (block.querySelector('select') instanceof HTMLSelectElement) {
            return areSelectAnswersApplied(block, answers);
        }

        if (block.querySelector('input[type="text"]') instanceof HTMLInputElement) {
            return areTextAnswersApplied(block, answers);
        }

        return areChoiceAnswersApplied(block, answers);
    }

    function maybeAutoApplyVerifiedAnswers(questions, statsByQuestion) {
        if (!isOpeneduAutoInsertMode()) {
            return { appliedCount: 0, readyCount: 0, knownCount: 0 };
        }

        let appliedCount = 0;
        let readyCount = 0;
        let knownCount = 0;

        (Array.isArray(questions) ? questions : []).forEach((question) => {
            if (!question || question.correct) {
                return;
            }

            const stats = statsByQuestion?.[question.questionKey] || null;
            const answerCandidates = getAutoAnswerCandidates(stats);
            if (answerCandidates.length === 0) {
                return;
            }

            const block = locateQuestionBlock(question);
            if (!(block instanceof HTMLElement)) {
                return;
            }

            knownCount += 1;
            const isMulti = questionAllowsMultipleAnswers(block);
            const payload = isMulti
                ? answerCandidates
                : [answerCandidates[0]];
            const mode = isMulti ? 'set-all' : 'add';

            if (areAnswersAppliedToQuestion(question, payload)) {
                readyCount += 1;
                return;
            }

            const applied = requestApplyAnswers(question, payload, mode);
            if (applied) {
                appliedCount += 1;
                readyCount += 1;
            } else {
                maybeLogBackendIssue('openedu_auto_apply_failed', {
                    questionKey: question.questionKey,
                    mode,
                    source: 'verified'
                });
            }
        });

        if (appliedCount > 0 || knownCount > 0) {
            debugSync('auto_apply_verified_answers', {
                appliedCount,
                readyCount,
                knownCount,
                mode: settings?.openedu?.mode || ''
            });
        }

        return { appliedCount, readyCount, knownCount };
    }

    function maybeAutoSubmitSolvedQuestions(questions, statsByQuestion) {
        if (!isOpeneduAutoSolveMode()) {
            return 0;
        }

        const grouped = new Map();
        (Array.isArray(questions) ? questions : []).forEach((question) => {
            const key = getProblemAutoKey(question);
            if (!key) {
                return;
            }
            if (!grouped.has(key)) {
                grouped.set(key, []);
            }
            grouped.get(key).push(question);
        });

        const now = Date.now();
        let submittedCount = 0;
        grouped.forEach((groupQuestions, problemKey) => {
            if (groupQuestions.every((question) => question.correct)) {
                return;
            }

            const ready = groupQuestions.every((question) => {
                if (question.correct) {
                    return true;
                }

                const stats = statsByQuestion?.[question.questionKey] || null;
                const answerCandidates = getAutoAnswerCandidates(stats);
                if (answerCandidates.length === 0) {
                    return false;
                }

                const block = locateQuestionBlock(question);
                if (!(block instanceof HTMLElement)) {
                    return false;
                }

                const payload = questionAllowsMultipleAnswers(block)
                    ? answerCandidates
                    : [answerCandidates[0]];
                return areAnswersAppliedToQuestion(question, payload);
            });
            if (!ready) {
                return;
            }

            const lastSubmitAt = Number(lastAutoSubmitByProblem.get(problemKey) || 0);
            if (now - lastSubmitAt < AUTO_SUBMIT_COOLDOWN_MS) {
                return;
            }

            const submitButton = findSubmitButtonForQuestion(groupQuestions[0]);
            if (!submitButton) {
                debugSync('auto_submit_skipped', {
                    reason: 'submit_button_not_found',
                    problemKey,
                    questionKeys: groupQuestions.map((question) => question.questionKey)
                });
                return;
            }

            lastAutoSubmitByProblem.set(problemKey, now);
            lastSubmitActionAt = now;
            submitButton.click();
            requestActiveTabPostSubmitRefresh('auto-submit');
            submittedCount += 1;
            debugSync('auto_submit_clicked', {
                problemKey,
                questionKeys: groupQuestions.map((question) => question.questionKey)
            });
        });

        return submittedCount;
    }

    function maybeAutoCheckInsertedAnswers(questions, statsByQuestion) {
        if (!isOpeneduAutoCheckMode()) {
            return 0;
        }

        const grouped = new Map();
        (Array.isArray(questions) ? questions : []).forEach((question) => {
            const key = getProblemAutoKey(question);
            if (!key) {
                return;
            }
            if (!grouped.has(key)) {
                grouped.set(key, []);
            }
            grouped.get(key).push(question);
        });

        const now = Date.now();
        let checkedCount = 0;
        grouped.forEach((groupQuestions, problemKey) => {
            if (groupQuestions.every((question) => question.correct)) {
                return;
            }

            const ready = groupQuestions.every((question) => {
                if (question.correct) {
                    return true;
                }

                const stats = statsByQuestion?.[question.questionKey] || null;
                const answerCandidates = getAutoAnswerCandidates(stats);
                const block = locateQuestionBlock(question);
                if (!(block instanceof HTMLElement)) {
                    return false;
                }

                if (answerCandidates.length > 0) {
                    const payload = questionAllowsMultipleAnswers(block)
                        ? answerCandidates
                        : [answerCandidates[0]];
                    return areAnswersAppliedToQuestion(question, payload);
                }

                return questionHasAnyUserAnswer(question);
            });
            if (!ready) {
                return;
            }

            const lastCheckAt = Number(lastAutoCheckByProblem.get(problemKey) || 0);
            if (now - lastCheckAt < AUTO_SUBMIT_COOLDOWN_MS) {
                return;
            }

            const checkButton = findCheckButtonForQuestion(groupQuestions[0]);
            if (!checkButton) {
                debugSync('auto_check_skipped', {
                    reason: 'check_button_not_found',
                    problemKey,
                    questionKeys: groupQuestions.map((question) => question.questionKey)
                });
                return;
            }

            lastAutoCheckByProblem.set(problemKey, now);
            lastSubmitActionAt = now;
            checkButton.click();
            requestActiveTabPostSubmitRefresh('auto-check');
            checkedCount += 1;
            debugSync('auto_check_clicked', {
                problemKey,
                questionKeys: groupQuestions.map((question) => question.questionKey),
                label: getActionElementLabel(checkButton)
            });
        });

        return checkedCount;
    }

    function findMissingAutoAnswerQuestions(questions, statsByQuestion) {
        if (!isOpeneduAutoInsertMode()) {
            return [];
        }

        return (Array.isArray(questions) ? questions : []).filter((question) => {
            if (!question || question.correct) {
                return false;
            }
            if (questionHasAnyUserAnswer(question)) {
                return false;
            }

            const stats = statsByQuestion?.[question.questionKey] || null;
            return getAutoAnswerCandidates(stats).length === 0;
        });
    }

    function handleMissingAutoAnswers(questions, statsByQuestion) {
        const action = getMissingAnswerAction();
        if (manualAnswerContinuationInFlight) {
            return;
        }

        if (action === 'stop') {
            pendingManualAnswerQuestion = null;
            return;
        }

        const missingQuestions = findMissingAutoAnswerQuestions(questions, statsByQuestion);
        if (missingQuestions.length === 0) {
            pendingManualAnswerQuestion = null;
            return;
        }

        if (
            pendingManualAnswerQuestion
            && !questionHasAnyUserAnswer(pendingManualAnswerQuestion)
            && missingQuestions.some((question) => matchesQuestionReference(question, pendingManualAnswerQuestion))
        ) {
            return;
        }

        const signature = missingQuestions
            .map((question) => question.questionKey || question.domId || '')
            .filter(Boolean)
            .join('|');
        const now = Date.now();
        if (signature === lastMissingAnswerSignature && now - lastMissingAnswerActionAt < MISSING_ANSWER_ACTION_COOLDOWN_MS) {
            return;
        }

        lastMissingAnswerSignature = signature;
        lastMissingAnswerActionAt = now;

        if (action === 'advance') {
            pendingManualAnswerQuestion = null;
            if (!isOpeneduAutoSolveMode() || !isAutoAdvanceEnabled()) {
                debugSync('missing_answer_action', {
                    action,
                    missingCount: missingQuestions.length,
                    clickedNext: false,
                    reason: 'auto_insert_mode'
                });
                return;
            }

            const clickedNext = requestNextSequencePage();
            if (clickedNext) {
                debugSync('missing_answer_action', {
                    action,
                    missingCount: missingQuestions.length,
                    clickedNext: true
                });
            } else {
                debugSync('missing_answer_action', {
                    action,
                    missingCount: missingQuestions.length,
                    clickedNext: false
                });
            }
            return;
        }

        if (action === 'alert') {
            alertManualQuestion(missingQuestions[0], 'auto-cycle', missingQuestions.length);
        }
    }

    function runOpeneduAutoActions(questions, statsByQuestion) {
        const localQuestions = (Array.isArray(questions) ? questions : [])
            .filter((question) => question?.ownerDocument === document);
        if (localQuestions.length === 0) {
            return;
        }

        const autoApply = maybeAutoApplyVerifiedAnswers(localQuestions, statsByQuestion);
        if (autoApply.appliedCount > 0 && !isOpeneduAutoSolveMode()) {
            setTimeout(() => {
                quickRerender();
                const refreshedQuestions = parseQuestions()
                    .filter((question) => question?.ownerDocument === document);
                if (refreshedQuestions.length > 0) {
                    iframeQuestionsCache = refreshedQuestions;
                }
                const nextQuestions = refreshedQuestions.length > 0 ? refreshedQuestions : localQuestions;
                const nextStats = lastMergedStatsByQuestion || statsByQuestion;
                maybeAutoCheckInsertedAnswers(nextQuestions, nextStats);
                handleMissingAutoAnswers(nextQuestions, nextStats);
            }, 250);
            return;
        }

        if (!isOpeneduAutoSolveMode()) {
            maybeAutoCheckInsertedAnswers(localQuestions, statsByQuestion);
            handleMissingAutoAnswers(localQuestions, statsByQuestion);
            return;
        }

        const submitDelay = autoApply.appliedCount > 0 ? 650 : 0;
        setTimeout(() => {
            const refreshedQuestions = parseQuestions();
            const refreshedLocalQuestions = refreshedQuestions
                .filter((question) => question?.ownerDocument === document);
            if (refreshedQuestions.length > 0) {
                iframeQuestionsCache = refreshedQuestions;
            }

            maybeAutoSubmitSolvedQuestions(
                refreshedLocalQuestions.length > 0 ? refreshedLocalQuestions : localQuestions,
                lastMergedStatsByQuestion || statsByQuestion,
            );
            handleMissingAutoAnswers(
                refreshedLocalQuestions.length > 0 ? refreshedLocalQuestions : localQuestions,
                lastMergedStatsByQuestion || statsByQuestion,
            );
        }, submitDelay);
    }

    function mergeAndSortAnswers(verifiedAnswers, incorrectAnswers, fallbackAnswers) {
        const map = new Map();

        (verifiedAnswers || []).forEach((ans) => {
            const sig = ans.answerKey + '|' + normalizeText(ans.answerText);
            map.set(sig, {
                answerKey: ans.answerKey,
                answerText: ans.answerText,
                verifiedCount: ans.count || 0,
                incorrectCount: 0,
                fallbackCount: 0,
                isVerified: true
            });
        });

        (incorrectAnswers || []).forEach((ans) => {
            const sig = ans.answerKey + '|' + normalizeText(ans.answerText);
            if (map.has(sig)) {
                map.get(sig).incorrectCount = ans.count || 0;
            } else {
                map.set(sig, {
                    answerKey: ans.answerKey,
                    answerText: ans.answerText,
                    verifiedCount: 0,
                    incorrectCount: ans.count || 0,
                    fallbackCount: 0,
                    isVerified: false
                });
            }
        });

        (fallbackAnswers || []).forEach((ans) => {
            const sig = ans.answerKey + '|' + normalizeText(ans.answerText);
            if (map.has(sig)) {
                map.get(sig).fallbackCount = ans.count || 0;
            } else {
                map.set(sig, {
                    answerKey: ans.answerKey,
                    answerText: ans.answerText,
                    verifiedCount: 0,
                    incorrectCount: 0,
                    fallbackCount: ans.count || 0,
                    isVerified: false
                });
            }
        });

        const merged = Array.from(map.values());
        merged.sort((a, b) => {
            if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
            if (b.incorrectCount !== a.incorrectCount) return b.incorrectCount - a.incorrectCount;
            if (b.fallbackCount !== a.fallbackCount) return b.fallbackCount - a.fallbackCount;
            if (b.verifiedCount !== a.verifiedCount) return b.verifiedCount - a.verifiedCount;
            return a.answerText.localeCompare(b.answerText);
        });
        return merged;
    }

    function renderInlineWands(statsByQuestion, questions) {
        const activeKeys = new Set();

        const docsForCleanup = getSearchDocuments();
        docsForCleanup.forEach((doc) => {
            const legacyButtons = doc.querySelectorAll('button[' + INLINE_WAND_ATTR + ']');
            legacyButtons.forEach((button) => {
                if (!button.closest('.' + INLINE_MENU_CLASS)) {
                    button.remove();
                }
            });
        });

        if (!hasOpeneduApiToken()) {
            docsForCleanup.forEach((doc) => {
                doc.querySelectorAll('.' + INLINE_MENU_CLASS + '[' + INLINE_WAND_ATTR + ']').forEach((node) => node.remove());
            });
            return;
        }

        questions.forEach((question) => {
            if (question?.fromVirtualContent) {
                return;
            }

            const block = locateQuestionBlock(question);
            if (!block) {
                return;
            }

            const stats = statsByQuestion?.[question.questionKey] || createEmptyStatsEntry();
            const presentation = getQuestionPresentationState(stats);
            const verifiedAnswers = presentation.verifiedAnswers;
            const incorrectAnswers = presentation.incorrectAnswers;
            const fallbackAnswers = presentation.fallbackAnswers;
            const isMulti = questionAllowsMultipleAnswers(block);
            const hasAnswers = presentation.hasAnswers;
            const isSimilar = presentation.isSimilar;
            const isContentMatch = presentation.isContentMatch;

            let menu = block.querySelector('.' + INLINE_MENU_CLASS + '[' + INLINE_WAND_ATTR + '="' + question.questionKey + '"]');
            if (!(menu instanceof HTMLElement)) {
                menu = document.createElement('span');
                menu.className = INLINE_MENU_CLASS;
                menu.setAttribute(INLINE_WAND_ATTR, question.questionKey);
                menu.setAttribute('data-moodush-extension', 'openedu-inline-menu');

                const anchor = block.querySelector('.problem-header, .problem-title, .question-title, legend, h3') || block;
                if (anchor.firstChild) {
                    anchor.insertBefore(menu, anchor.firstChild);
                } else {
                    anchor.appendChild(menu);
                }
            }

            menu.innerHTML = '';

            const trigger = document.createElement('button');
            trigger.type = 'button';
            trigger.className = 'moodush-openedu-inline-wand'
                + (isSimilar ? ' moodush-openedu-inline-wand--similar' : '')
                + (!hasAnswers ? ' moodush-openedu-inline-wand--empty' : '')
                + (isContentMatch ? ' moodush-openedu-inline-wand--content' : '');
            trigger.textContent = hasAnswers
                ? (isSimilar ? '|*~' : '|*')
                : '|*';
            if (!hasAnswers) {
                trigger.title = isSimilar
                    ? 'Для этого вопроса нет точных ответов, только похожие данные'
                    : 'Для этого вопроса пока нет ответов';
            } else if (isSimilar) {
                trigger.title = isContentMatch
                    ? 'Статистика получена по содержанию вопроса'
                    : 'Статистика получена из похожего вопроса';
            } else {
                trigger.title = 'Открыть список проверенных ответов и статистики';
            }

            const popover = document.createElement('div');
            popover.className = 'moodush-openedu-inline-popover';

            const popTitle = document.createElement('div');
            popTitle.className = 'moodush-openedu-inline-title';
            popTitle.textContent = 'MooDuSh';
            popover.appendChild(popTitle);

            let actionsHost = popover;
            if (isSimilar) {
                const similarNotice = document.createElement('div');
                similarNotice.className = 'moodush-openedu-inline-similar-notice';
                similarNotice.textContent = 'Точный ответ для этого вопроса не найден. Показаны данные похожего вопроса.';
                popover.appendChild(similarNotice);

                const tabs = document.createElement('div');
                tabs.className = 'moodush-openedu-inline-tabs';

                const thisQuestionTab = document.createElement('button');
                thisQuestionTab.type = 'button';
                thisQuestionTab.className = 'moodush-openedu-inline-tab';
                thisQuestionTab.textContent = 'Этот вопрос';

                const similarQuestionTab = document.createElement('button');
                similarQuestionTab.type = 'button';
                similarQuestionTab.className = 'moodush-openedu-inline-tab active';
                similarQuestionTab.textContent = 'Похожий вопрос';

                tabs.appendChild(thisQuestionTab);
                tabs.appendChild(similarQuestionTab);
                popover.appendChild(tabs);

                const thisPane = document.createElement('div');
                thisPane.className = 'moodush-openedu-inline-tab-pane';
                thisPane.classList.add('hidden');
                thisPane.textContent = 'Для этого вопроса пока нет своей статистики.';

                const similarPane = document.createElement('div');
                similarPane.className = 'moodush-openedu-inline-tab-pane';

                thisQuestionTab.addEventListener('click', () => {
                    thisQuestionTab.classList.add('active');
                    similarQuestionTab.classList.remove('active');
                    thisPane.classList.remove('hidden');
                    similarPane.classList.add('hidden');
                });

                similarQuestionTab.addEventListener('click', () => {
                    similarQuestionTab.classList.add('active');
                    thisQuestionTab.classList.remove('active');
                    similarPane.classList.remove('hidden');
                    thisPane.classList.add('hidden');
                });

                popover.appendChild(thisPane);
                popover.appendChild(similarPane);
                actionsHost = similarPane;
            }

            const applyVerified = document.createElement('button');
            applyVerified.type = 'button';
            applyVerified.className = 'moodush-openedu-inline-action';
            applyVerified.textContent = isMulti
                ? (isSimilar ? 'Вставить ответы похожего вопроса' : 'Вставить правильные ответы')
                : (isSimilar ? 'Вставить ответ похожего вопроса' : 'Вставить правильный ответ');
            applyVerified.disabled = verifiedAnswers.length === 0;
            applyVerified.addEventListener('click', () => {
                const payload = isMulti ? verifiedAnswers : [verifiedAnswers[0]];
                const mode = 'set-all';
                const applied = applyAnswersToQuestion(question, payload, mode);
                if (!applied) {
                    maybeLogBackendIssue('openedu_apply_failed', {
                        questionKey: question.questionKey,
                        mode,
                        source: 'verified'
                    });
                }
            });
            actionsHost.appendChild(applyVerified);

            if (settings.openedu.showFallbackStats) {
                const applyFallback = document.createElement('button');
                applyFallback.type = 'button';
                applyFallback.className = 'moodush-openedu-inline-action fallback';
                applyFallback.textContent = isMulti
                    ? (isSimilar ? 'Вставить популярные ответы похожего вопроса' : 'Вставить популярные ответы')
                    : (isSimilar ? 'Вставить популярный ответ похожего вопроса' : 'Вставить популярный ответ');
                applyFallback.disabled = fallbackAnswers.length === 0;
                applyFallback.addEventListener('click', () => {
                    const payload = isMulti ? fallbackAnswers : [fallbackAnswers[0]];
                    const mode = 'set-all';
                    const applied = applyAnswersToQuestion(question, payload, mode);
                    if (!applied) {
                        maybeLogBackendIssue('openedu_apply_failed', {
                            questionKey: question.questionKey,
                            mode,
                            source: 'fallback'
                        });
                    }
                });
                actionsHost.appendChild(applyFallback);
            }

            const list = document.createElement('ul');
            list.className = 'moodush-openedu-inline-stats';

            const allAnswers = mergeAndSortAnswers(verifiedAnswers, incorrectAnswers, fallbackAnswers);

            if (allAnswers.length === 0) {
                const empty = document.createElement('li');
                empty.className = 'moodush-openedu-inline-empty';
                empty.textContent = isSimilar ? 'Нет точных ответов, только похожие данные.' : 'Нет статистики по этому вопросу.';
                list.appendChild(empty);
            } else {
                const sectionHeader = document.createElement('li');
                sectionHeader.className = 'moodush-openedu-inline-section';
                sectionHeader.textContent = 'Ответы';
                list.appendChild(sectionHeader);

                allAnswers.forEach((answer) => {
                    const row = document.createElement('li');
                    row.className = 'moodush-openedu-inline-row';

                    const answerBtn = document.createElement('button');
                    answerBtn.type = 'button';
                    answerBtn.className = 'moodush-openedu-inline-answer';
                    answerBtn.className += answer.incorrectCount > 0 && !answer.isVerified
                        ? ' moodush-openedu-inline-answer--incorrect'
                        : '';
                    answerBtn.textContent = answer.isVerified
                        ? (answer.answerText + ' ✓')
                        : (answer.incorrectCount > 0 ? (answer.answerText + ' ✕') : answer.answerText);
                    answerBtn.title = 'Вставить этот вариант';
                    answerBtn.addEventListener('click', () => {
                        const applied = applyAnswersToQuestion(question, [answer], 'set-all');
                        if (!applied) {
                            maybeLogBackendIssue('openedu_apply_failed', {
                                questionKey: question.questionKey,
                                answerText: answer.answerText,
                                answerKey: answer.answerKey || ''
                            });
                        }
                    });
                    
                    row.appendChild(answerBtn);

                    const countsContainer = document.createElement('div');
                    countsContainer.className = 'moodush-openedu-inline-counts';

                    if (answer.isVerified) {
                        const vCount = document.createElement('span');
                        vCount.className = 'moodush-openedu-inline-count verified';
                        vCount.textContent = answer.verifiedCount > 0 ? answer.verifiedCount : '✓';
                        vCount.title = answer.verifiedCount > 0
                            ? 'Подтверждено платформой: ' + answer.verifiedCount + ' раз'
                            : 'Ответ подтверждён платформой';
                        countsContainer.appendChild(vCount);
                    }

                    if (answer.incorrectCount > 0) {
                        const iCount = document.createElement('span');
                        iCount.className = 'moodush-openedu-inline-count incorrect';
                        iCount.textContent = answer.incorrectCount;
                        iCount.title = 'Платформа отметила как неверный: ' + answer.incorrectCount + ' раз';
                        countsContainer.appendChild(iCount);
                    }

                    const fCount = document.createElement('span');
                    fCount.className = 'moodush-openedu-inline-count fallback';
                    fCount.textContent = answer.fallbackCount;
                    fCount.title = 'Выбирали: ' + answer.fallbackCount + ' раз';
                    countsContainer.appendChild(fCount);

                    row.appendChild(countsContainer);
                    list.appendChild(row);
                });
            }

            actionsHost.appendChild(list);

            menu.appendChild(trigger);
            if (isSimilar) {
                const sourceMark = document.createElement('span');
                sourceMark.className = 'moodush-openedu-inline-source-mark';
                sourceMark.textContent = 'похож.';
                sourceMark.title = 'Данные не из этого вопроса, а из похожего';
                menu.appendChild(sourceMark);
            }
            menu.appendChild(popover);

            activeKeys.add(question.questionKey);
        });

        const docs = getSearchDocuments();
        docs.forEach((doc) => {
            const stale = doc.querySelectorAll('.' + INLINE_MENU_CLASS + '[' + INLINE_WAND_ATTR + ']');
            stale.forEach((node) => {
                const key = node.getAttribute(INLINE_WAND_ATTR) || '';
                if (!activeKeys.has(key)) {
                    node.remove();
                }
            });
        });
    }

    function setStickOnline(isOnline, detail) {
        if (!statusDot || !statusText) {
            return;
        }

        statusDot.classList.toggle('online', isOnline);
        statusText.textContent = detail || (isOnline ? 'API доступен' : 'API недоступен');
    }

    function getQuestionStatsKind(stats) {
        const presentation = getQuestionPresentationState(stats);
        if (!presentation.hasAnswers) {
            return 'missing';
        }
        if (presentation.isSimilar) {
            return 'similar';
        }
        if (presentation.isContentMatch) {
            return 'content';
        }
        if (presentation.verifiedAnswers.length > 0) {
            return 'verified';
        }
        if (presentation.incorrectAnswers.length > 0) {
            return 'incorrect';
        }
        if (stats?.localOnly) {
            return 'local';
        }
        return 'fallback';
    }

    function buildQuestionStatusLabel(stats) {
        const kind = getQuestionStatsKind(stats);
        const completedCount = Number(stats?.completedCount || 0);
        if (kind === 'missing') {
            return 'нет ответа';
        }
        if (kind === 'similar') {
            const score = Math.round(Math.max(0, Number(stats?.matchedScore || 0)) * 100);
            return score > 0 ? ('похожий ' + score + '%') : 'похожий';
        }
        if (kind === 'content') {
            return completedCount > 0 ? ('по содержанию · ' + completedCount) : 'по содержанию';
        }
        if (kind === 'verified') {
            return completedCount > 0 ? ('правильный · ' + completedCount) : 'правильный';
        }
        if (kind === 'incorrect') {
            return 'есть неверные';
        }
        if (kind === 'local') {
            return 'локально';
        }
        return completedCount > 0 ? ('популярный · ' + completedCount) : 'популярный';
    }

    function buildQuestionCard(question, index, stats) {
        const card = document.createElement('div');
        card.className = 'moodush-question-card';
        card.dataset.answerState = getQuestionStatsKind(stats);

        const head = document.createElement('div');
        head.className = 'moodush-question-head';

        const title = document.createElement('p');
        title.className = 'moodush-question-name';
        title.textContent = 'Вопрос ' + (index + 1);

        const meta = document.createElement('p');
        meta.className = 'moodush-question-meta moodush-question-meta--' + getQuestionStatsKind(stats);
        meta.textContent = buildQuestionStatusLabel(stats);

        head.appendChild(title);
        head.appendChild(meta);
        card.appendChild(head);

        const prompt = document.createElement('p');
        prompt.className = 'moodush-question-prompt';
        prompt.textContent = collapseWhitespace(question?.prompt || '') || 'Без текста вопроса';
        card.appendChild(prompt);

        const list = document.createElement('ul');
        list.className = 'moodush-answer-list';

        const verifiedAnswers = normalizeAnswerStatsList(stats.verifiedAnswers);
        const incorrectAnswers = normalizeAnswerStatsList(stats.incorrectAnswers);
        const selectedAnswers = normalizeAnswerStatsList(stats.fallbackAnswers);
        const allAnswers = mergeAndSortAnswers(verifiedAnswers, incorrectAnswers, selectedAnswers);

        if (allAnswers.length === 0) {
            const emptyItem = document.createElement('li');
            emptyItem.className = 'moodush-answer-item moodush-answer-item--empty';
            emptyItem.textContent = 'Ответов пока нет';
            list.appendChild(emptyItem);
        }

        allAnswers.slice(0, 6).forEach((answer) => {
            const item = document.createElement('li');
            item.className = 'moodush-answer-item';

            const text = document.createElement('span');
            text.className = 'moodush-answer-text';
            if (answer.incorrectCount > 0 && !answer.isVerified) {
                item.classList.add('moodush-answer-item--incorrect');
            }
            text.textContent = answer.isVerified
                ? (answer.answerText + ' ✓')
                : (answer.incorrectCount > 0 ? (answer.answerText + ' ✕') : answer.answerText);
            item.appendChild(text);

            const countsContainer = document.createElement('div');
            countsContainer.className = 'moodush-answer-counts';

            if (answer.isVerified) {
                const vCount = document.createElement('span');
                vCount.className = 'moodush-answer-count verified';
                vCount.textContent = answer.verifiedCount > 0
                    ? answer.verifiedCount + ' подтв.'
                    : 'подтв.';
                countsContainer.appendChild(vCount);
            }

            if (answer.incorrectCount > 0) {
                const iCount = document.createElement('span');
                iCount.className = 'moodush-answer-count incorrect';
                iCount.textContent = answer.incorrectCount + ' неверн.';
                countsContainer.appendChild(iCount);
            }

            const fCount = document.createElement('span');
            fCount.className = 'moodush-answer-count fallback';
            fCount.textContent = answer.fallbackCount + ' отв.';
            countsContainer.appendChild(fCount);

            item.appendChild(countsContainer);
            list.appendChild(item);
        });

        if (allAnswers.length > 6) {
            const moreItem = document.createElement('li');
            moreItem.className = 'moodush-answer-more';
            moreItem.textContent = 'Еще ' + String(allAnswers.length - 6);
            list.appendChild(moreItem);
        }

        card.appendChild(list);

        const topAnswer = allAnswers[0] || null;
        const isMulti = Boolean(question?.allowsMultipleAnswers);
        const controls = document.createElement('div');
        controls.className = 'moodush-question-controls';

        const focusBtn = document.createElement('button');
        focusBtn.className = 'moodush-focus-btn';
        focusBtn.type = 'button';
        focusBtn.textContent = 'К вопросу';
        focusBtn.addEventListener('click', () => {
            requestScrollToQuestion(question);
        });
        controls.appendChild(focusBtn);

        const applyBtn = document.createElement('button');
        applyBtn.className = 'moodush-apply-btn';
        applyBtn.textContent = isMulti
            ? ((topAnswer && topAnswer.isVerified) ? 'Применить правильные' : 'Применить популярные')
            : ((topAnswer && topAnswer.isVerified) ? 'Применить правильный' : 'Применить популярный');
        applyBtn.disabled = !topAnswer;
        applyBtn.addEventListener('click', () => {
            if (!topAnswer) {
                return;
            }

            const payload = isMulti
                ? (topAnswer.isVerified ? verifiedAnswers : selectedAnswers)
                : [topAnswer];
            const mode = isMulti ? 'set-all' : 'add';
            const applied = requestApplyAnswers(question, payload, mode);
            if (!applied) {
                maybeLogBackendIssue('openedu_apply_failed', {
                    questionKey: question.questionKey,
                    answerText: topAnswer.answerText,
                    answerKey: topAnswer.answerKey || '',
                    mode
                });
            }
        });
        controls.appendChild(applyBtn);
        card.appendChild(controls);

        return card;
    }

    function renderStick(statsByQuestion, questions) {
        if (!stickBody) {
            return;
        }

        stickBody.innerHTML = '';

        if (!hasOpeneduApiToken()) {
            if (wandToggle) {
                wandToggle.textContent = '!';
                wandToggle.title = OPENEDU_TOKEN_REQUIRED_TEXT;
                wandToggle.classList.add('moodush-openedu-wand-toggle--token-required');
            }

            const tokenState = document.createElement('div');
            tokenState.className = 'moodush-stick-token-required';

            const title = document.createElement('div');
            title.className = 'moodush-stick-token-title';
            title.textContent = OPENEDU_TOKEN_REQUIRED_TITLE;

            const text = document.createElement('p');
            text.className = 'moodush-stick-token-text';
            text.textContent = OPENEDU_TOKEN_REQUIRED_TEXT;

            tokenState.appendChild(title);
            tokenState.appendChild(text);
            stickBody.appendChild(tokenState);
            return;
        }

        if (wandToggle) {
            wandToggle.textContent = '|*';
            wandToggle.title = 'Открыть MooDuSh OpenEdu';
            wandToggle.classList.remove('moodush-openedu-wand-toggle--token-required');
        }

        if (!Array.isArray(questions) || questions.length === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'moodush-stick-empty';
            emptyState.textContent = 'Вопросы на странице пока не найдены.';
            stickBody.appendChild(emptyState);
            return;
        }

        const items = questions.map((question, index) => {
            const stats = statsByQuestion?.[question.questionKey] || createEmptyStatsEntry();
            return { question, index, stats, kind: getQuestionStatsKind(stats) };
        });

        const answerCount = items.filter((item) => item.kind !== 'missing').length;
        const missingCount = items.length - answerCount;
        const similarCount = items.filter((item) => item.kind === 'similar').length;

        const summary = document.createElement('div');
        summary.className = 'moodush-stick-summary';
        summary.textContent = 'Вопросов: ' + String(items.length)
            + ' · с ответами: ' + String(answerCount)
            + ' · без ответа: ' + String(missingCount);
        stickBody.appendChild(summary);

        const filters = document.createElement('div');
        filters.className = 'moodush-stick-tabs';
        const list = document.createElement('div');
        list.className = 'moodush-stick-question-list';

        const filterDefs = [
            { id: 'all', label: 'Все', count: items.length },
            { id: 'answered', label: 'С ответом', count: answerCount },
            { id: 'missing', label: 'Нет ответа', count: missingCount },
            { id: 'similar', label: 'Похожие', count: similarCount }
        ];
        const filterButtons = [];

        function applyFilter(filterId) {
            filterButtons.forEach((button) => {
                button.classList.toggle('active', button.dataset.filterId === filterId);
            });
            list.querySelectorAll('.moodush-question-card').forEach((card) => {
                const state = card.getAttribute('data-answer-state') || '';
                const visible = filterId === 'all'
                    || (filterId === 'answered' && state !== 'missing')
                    || (filterId === 'missing' && state === 'missing')
                    || (filterId === 'similar' && state === 'similar');
                card.classList.toggle('hidden', !visible);
            });
        }

        filterDefs.forEach((filter) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'moodush-stick-tab' + (filter.id === 'all' ? ' active' : '');
            button.dataset.filterId = filter.id;
            button.textContent = filter.label + ' ' + String(filter.count);
            button.disabled = filter.count === 0;
            button.addEventListener('click', () => {
                applyFilter(filter.id);
            });
            filterButtons.push(button);
            filters.appendChild(button);
        });

        items.forEach((item) => {
            list.appendChild(buildQuestionCard(item.question, item.index, item.stats));
        });

        stickBody.appendChild(filters);
        stickBody.appendChild(list);
    }

    function toggleStick(forceState) {
        if (!stickRoot || !wandToggle) {
            return;
        }

        if (wandsHidden) {
            return;
        }

        if (typeof forceState === 'boolean') {
            panelVisible = forceState;
        } else {
            panelVisible = !panelVisible;
        }

        stickRoot.classList.toggle('hidden', !panelVisible);
        wandToggle.classList.toggle('active', panelVisible);
    }

    function ensureStickUi() {
        if (!isTopFrame) {
            return;
        }

        if (stickRoot && wandToggle) {
            return;
        }

        const staleStick = document.getElementById(STICK_ID);
        if (staleStick) {
            staleStick.remove();
        }

        const staleToggle = document.getElementById(WAND_TOGGLE_ID);
        if (staleToggle) {
            staleToggle.remove();
        }

        wandToggle = document.createElement('button');
        wandToggle.id = WAND_TOGGLE_ID;
        wandToggle.type = 'button';
        wandToggle.className = 'moodush-openedu-wand-toggle';
        wandToggle.setAttribute('data-moodush-extension', 'openedu-wand-toggle');
        wandToggle.textContent = '|*';
        wandToggle.title = 'MooDuSh OpenEdu: показать статистику';
        wandToggle.addEventListener('click', () => {
            toggleStick();
        });

        stickRoot = document.createElement('aside');
        stickRoot.id = STICK_ID;
        stickRoot.className = 'moodush-openedu-stick hidden';
        stickRoot.setAttribute('data-moodush-extension', 'openedu-stick');

        const header = document.createElement('div');
        header.className = 'moodush-stick-header';

        const left = document.createElement('div');
        const title = document.createElement('div');
        title.className = 'moodush-stick-title';
        title.textContent = 'MooDuSh OpenEdu';
        const subtitle = document.createElement('div');
        subtitle.className = 'moodush-stick-subtitle';
        subtitle.textContent = 'Палочка и проверенные ответы';
        left.appendChild(title);
        left.appendChild(subtitle);

        const actions = document.createElement('div');
        actions.className = 'moodush-stick-actions';

        statusDot = document.createElement('span');
        statusDot.className = 'moodush-stick-status';

        statusText = document.createElement('span');
        statusText.className = 'moodush-stick-subtitle';
        statusText.textContent = 'API недоступен';

        const hideButton = document.createElement('button');
        hideButton.className = 'moodush-stick-button';
        hideButton.type = 'button';
        hideButton.textContent = 'Скрыть';
        hideButton.addEventListener('click', () => {
            toggleStick(false);
        });

        actions.appendChild(statusDot);
        actions.appendChild(statusText);
        actions.appendChild(hideButton);

        header.appendChild(left);
        header.appendChild(actions);

        stickBody = document.createElement('div');
        stickBody.className = 'moodush-stick-content';

        stickRoot.appendChild(header);
        stickRoot.appendChild(stickBody);

        document.documentElement.appendChild(wandToggle);
        document.documentElement.appendChild(stickRoot);
    }

    function syncIframeStateToTop(statsByQuestion, questions, onlineState) {
        if (isTopFrame) {
            return;
        }

        try {
            const simplifiedQuestions = (Array.isArray(questions) ? questions : []).map((question) => ({
                questionKey: question.questionKey,
                domId: question.domId,
                correct: question.correct,
                hasVerifiedAnswer: question.hasVerifiedAnswer,
                allowsMultipleAnswers: Boolean(question.allowsMultipleAnswers),
                orderIndex: question.orderIndex,
                prompt: sanitizeQuestionPromptText(
                    question.prompt,
                    Array.isArray(question.options) ? question.options.map((option) => option.answerText) : [],
                ),
                fromIframe: true,
                fromVirtualContent: Boolean(question.fromVirtualContent),
                course: question.course || getCourseRefForQuestion(question),
                options: (Array.isArray(question.options) ? question.options : []).map((option) => ({
                    answerKey: option.answerKey,
                    answerText: sanitizeAnswerText(option.answerText),
                    selected: option.selected,
                    correct: option.correct,
                    incorrect: option.incorrect,
                    inputType: option.inputType || '',
                    inputId: option.inputId || '',
                    inputName: option.inputName || '',
                    matchingCellId: option.matchingCellId || '',
                    matchingAnswerId: option.matchingAnswerId || ''
                }))
            }));

            window.top.postMessage({
                type: 'PARAMEXT_OPENEDU_QUESTIONS_SYNC',
                frameId: frameSyncId,
                stats: statsByQuestion,
                questions: simplifiedQuestions
            }, '*');
            window.top.postMessage({
                type: 'PARAMEXT_OPENEDU_STICK_ONLINE',
                online: Boolean(onlineState?.online),
                text: String(onlineState?.text || '')
            }, '*');
            debugSync('iframe_posted_sync_to_top', {
                questionCount: simplifiedQuestions.length,
                mergedKeys: statsByQuestion && typeof statsByQuestion === 'object'
                    ? Object.keys(statsByQuestion).length
                    : 0,
                onlineState
            });
        } catch (_) {
            // Ignore postMessage failures.
        }
    }

    async function runStickCycle(force, options) {
        const allowNetwork = options?.allowNetwork !== false;
        const source = String(options?.source || 'generic');

        if (cyclesStopped) {
            return;
        }

        const now = Date.now();
        if (!Boolean(force) && (now - lastCycleAt) < MIN_CYCLE_GAP_MS) {
            return;
        }

        if (cycleInFlight) {
            return;
        }

        lastCycleAt = now;
        cycleInFlight = true;
        try {
            if (allowNetwork) {
                await refreshCourseDiscovery(false);
            }
            const questions = parseQuestions();
            iframeQuestionsCache = questions;
            lastParsedQuestionCount = questions.length;
            const debugOverlayEnabled = isDebugOverlayEnabled();
            if (window.ParamExtOpeneduDebugOverlay) {
                window.ParamExtOpeneduDebugOverlay.render(questions, debugOverlayEnabled);
            }
            if (debugOverlayEnabled && allowNetwork) {
                allowNetwork = false;
                debugSync('cycle_network_disabled_for_debug_overlay', {
                    source,
                    questionCount: questions.length
                });
            }
            if (questions.length > 0) {
                lastMeaningfulQuestionsAt = now;
            }

            debugSync('cycle_parsed_questions', {
                force: Boolean(force),
                allowNetwork,
                source,
                questionCount: questions.length,
                questions: summarizeQuestionsForDebug(questions)
            });

            if (questions.length === 0) {
                const retainRenderedAnswers = typeof openeduShared.shouldRetainRenderedAnswers === 'function'
                    ? openeduShared.shouldRetainRenderedAnswers({
                        questionCount: 0,
                        hadRenderedAnswers: Boolean(lastMergedStatsByQuestion && Object.keys(lastMergedStatsByQuestion).length > 0),
                        msSinceLastMeaningfulQuestions: now - lastMeaningfulQuestionsAt,
                        msSinceLastSubmit: now - lastSubmitActionAt,
                        transientGraceMs: TRANSIENT_EMPTY_QUESTIONS_GRACE_MS,
                        submitGraceMs: ACTIVE_TAB_REFRESH_AFTER_SUBMIT_WINDOW_MS
                    })
                    : false;

                debugSync('cycle_no_questions', {
                    retainRenderedAnswers,
                    usingTopIframeCache: Boolean(isTopFrame && topFrameIframeQuestions && topFrameIframeQuestions.length > 0)
                });

                if (isTopFrame && !hasTopFrameIframeQuestions()) {
                    refreshActiveSequenceTabForEmptySection('cycle-no-questions');
                }

                if (retainRenderedAnswers) {
                    return;
                }

                renderInlineWands({}, []);
                lastMergedStatsByQuestion = null;
                lastRenderedQuestions = [];

                if (isTopFrame) {
                    if (topFrameIframeQuestions && topFrameIframeQuestions.length > 0) {
                        const iframeOnlineState = (typeof topFrameOnlineState !== 'undefined' && topFrameOnlineState)
                            || window.__PARAMEXT_TOPFRAME_ONLINE_STATE
                            || { online: false, text: 'API недоступен' };
                        setStickOnline(Boolean(iframeOnlineState.online), String(iframeOnlineState.text || 'API недоступен'));
                        renderStick(topFrameIframeStats, topFrameIframeQuestions);
                    } else {
                        setStickOnline(false, 'Ожидание данных из iframe');
                        renderStick({}, []);
                    }
                } else {
                    syncIframeStateToTop({}, [], topFrameOnlineState);
                }
                return;
            }

            if (!isTopFrame) {
                await requestTopContext();
            }

            if (!hasOpeneduApiToken()) {
                debugSync('cycle_missing_openedu_token', {
                    questionCount: questions.length,
                    source
                });

                renderInlineWands({}, []);
                lastMergedStatsByQuestion = null;
                lastRenderedQuestions = snapshotQuestionReferences(questions);

                onlineState = { online: false, text: OPENEDU_TOKEN_REQUIRED_TITLE };
                topFrameOnlineState = onlineState;
                window.__PARAMEXT_TOPFRAME_ONLINE_STATE = topFrameOnlineState;

                if (isTopFrame) {
                    setStickOnline(false, onlineState.text);
                    renderStick({}, questions);
                } else {
                    syncIframeStateToTop({}, questions, onlineState);
                }
                return;
            }

            const localStatsByQuestion = buildLocalFallbackStats(questions);
            let onlineState = {
                online: Boolean(topFrameOnlineState?.online),
                text: String(topFrameOnlineState?.text || 'API недоступен')
            };

            if (isSyncBlocked()) {
                const reason = syncBlockedReason === 'auth_401'
                    ? '401 токен'
                    : (syncBlockedReason === 'auth_403'
                        ? '403 доступ'
                        : (syncBlockedReason === 'network_0' ? 'network 0 (пауза)' : syncBlockedReason || 'blocked'));

                debugSync('cycle_sync_blocked', {
                    reason,
                    syncBlockedReason,
                    syncBlockedUntil
                });

                const cachedStats = lastStatsResponse && typeof lastStatsResponse === 'object'
                    ? lastStatsResponse.statsByQuestion || null
                    : null;
                const mergedStatsByQuestion = mergeStatsByQuestion(
                    cachedStats,
                    localStatsByQuestion,
                    questions,
                    lastMergedStatsByQuestion,
                    lastRenderedQuestions,
                );
                renderInlineWands(mergedStatsByQuestion, questions);
                lastMergedStatsByQuestion = mergedStatsByQuestion;
                lastRenderedQuestions = snapshotQuestionReferences(questions);
                runOpeneduAutoActions(questions, mergedStatsByQuestion);

                onlineState = { online: false, text: 'Sync пауза: ' + reason };
                topFrameOnlineState = onlineState;
                window.__PARAMEXT_TOPFRAME_ONLINE_STATE = topFrameOnlineState;

                if (isTopFrame) {
                    setStickOnline(false, onlineState.text);
                    renderStick(mergedStatsByQuestion, questions);
                } else {
                    syncIframeStateToTop(mergedStatsByQuestion, questions, onlineState);
                }
                return;
            }

            let pushResult = {
                ok: true,
                status: 204,
                error: allowNetwork ? 'not_changed' : 'skipped_no_network',
                data: null
            };
            let statsResult = {
                ok: true,
                status: 200,
                error: allowNetwork ? 'cached' : 'skipped_no_network',
                data: lastStatsResponse || { statsByQuestion: null }
            };
            let didPushUpdate = false;

            if (allowNetwork) {
                const context = getCourseContext();
                const normalizedQuestions = questions.map((question) => ({
                    questionKey: String(question.questionKey || ''),
                    correct: Boolean(question.correct),
                    verified: Boolean(question.hasVerifiedAnswer),
                    answers: (Array.isArray(question.options) ? question.options : [])
                        .map((option) => ({
                            answerKey: String(option.answerKey || ''),
                            selected: Boolean(option.selected),
                            correct: Boolean(option.correct),
                            incorrect: Boolean(option.incorrect),
                            answerText: String(option.answerText || ''),
                            inputType: String(option.inputType || '')
                        }))
                        .sort((a, b) => {
                            const keyCmp = a.answerKey.localeCompare(b.answerKey);
                            if (keyCmp !== 0) {
                                return keyCmp;
                            }
                            return a.answerText.localeCompare(b.answerText);
                        })
                })).sort((a, b) => a.questionKey.localeCompare(b.questionKey));

                const attemptFingerprint = hash(JSON.stringify({
                    context: {
                        testKey: context.testKey,
                        path: context.path
                    },
                    questions: normalizedQuestions
                }));

                const questionSignature = hash(JSON.stringify(normalizedQuestions.map((item) => item.questionKey)));
                const nowMs = Date.now();
                const pushCooldownActive = !Boolean(force) && (nowMs - lastAttemptPushAt) < PUSH_COOLDOWN_MS;

                if (attemptFingerprint !== lastAttemptPayloadHash && !pushCooldownActive) {
                    pushResult = await pushAttemptSnapshot(questions);
                    if (pushResult.ok) {
                        lastAttemptPayloadHash = attemptFingerprint;
                        lastAttemptPushAt = Date.now();
                        lastNetworkSyncAt = lastAttemptPushAt;
                        didPushUpdate = true;
                        clearSyncBlock();
                    }
                } else if (attemptFingerprint !== lastAttemptPayloadHash && pushCooldownActive) {
                    debugSync('push_attempt_snapshot_skipped', {
                        reason: 'push_cooldown',
                        sinceLastPushMs: nowMs - lastAttemptPushAt,
                        cooldownMs: PUSH_COOLDOWN_MS
                    });
                } else {
                    debugSync('push_attempt_snapshot_skipped', {
                        reason: 'same_attempt_fingerprint'
                    });
                }

                const networkCooldownActive = !Boolean(force) && !didPushUpdate && (Date.now() - lastNetworkSyncAt) < API_SYNC_MIN_GAP_MS;
                const shouldQueryBase =
                    Boolean(force) ||
                    didPushUpdate ||
                    questionSignature !== lastStatsQuerySignature ||
                    !lastStatsResponse;
                const shouldRespectCooldown = !didPushUpdate && !Boolean(force);
                const shouldQuery = !networkCooldownActive && shouldQueryBase && (!shouldRespectCooldown || (Date.now() - lastStatsQueryAt) >= QUERY_COOLDOWN_MS);

                if (shouldQuery) {
                    statsResult = await pullStatistics(questions);
                    if (statsResult.ok) {
                        lastStatsQuerySignature = questionSignature;
                        lastStatsQueryAt = Date.now();
                        lastNetworkSyncAt = lastStatsQueryAt;
                        lastStatsResponse = statsResult.data || { statsByQuestion: null };
                        clearSyncBlock();
                    }
                } else {
                    debugSync('pull_statistics_skipped', {
                        reason: networkCooldownActive ? 'api_sync_min_gap' : 'cooldown_or_signature_not_changed',
                        sinceLastMs: Date.now() - lastStatsQueryAt,
                        sinceLastNetworkSyncMs: Date.now() - lastNetworkSyncAt
                    });
                }

                if (!pushResult.ok && !statsResult.ok && Number(pushResult.status || 0) === 0 && Number(statsResult.status || 0) === 0) {
                    blockSync('network_0', 45000);
                    debugSync('cycle_network_backoff', {
                        pushError: pushResult.error || '',
                        statsError: statsResult.error || '',
                        syncBlockedUntil
                    });
                }
            } else {
                debugSync('cycle_network_skipped', {
                    source,
                    reason: 'ui_refresh_only'
                });
            }

            const effectiveStatsResponse = (statsResult.ok && statsResult.data && typeof statsResult.data === 'object')
                ? statsResult.data
                : (lastStatsResponse && typeof lastStatsResponse === 'object'
                    ? lastStatsResponse
                    : { statsByQuestion: null });
            const statsByQuestion = effectiveStatsResponse && typeof effectiveStatsResponse === 'object'
                ? effectiveStatsResponse.statsByQuestion || null
                : null;

            const mergedStatsByQuestion = mergeStatsByQuestion(
                statsByQuestion,
                localStatsByQuestion,
                questions,
                lastMergedStatsByQuestion,
                lastRenderedQuestions,
            );
            debugSync('cycle_stats_merged', {
                pushOk: pushResult.ok,
                pushStatus: pushResult.status,
                pushError: pushResult.error || '',
                statsOk: statsResult.ok,
                statsStatus: statsResult.status,
                statsError: statsResult.error || '',
                allowNetwork,
                mergedKeys: mergedStatsByQuestion && typeof mergedStatsByQuestion === 'object'
                    ? Object.keys(mergedStatsByQuestion).length
                    : 0
            });

            renderInlineWands(mergedStatsByQuestion, questions);
            lastMergedStatsByQuestion = mergedStatsByQuestion;
            lastRenderedQuestions = snapshotQuestionReferences(questions);
            runOpeneduAutoActions(questions, mergedStatsByQuestion);

            const pushActuallyFailed = allowNetwork && !pushResult.ok && pushResult.error !== 'not_changed';
            const statsActuallyFailed = allowNetwork && !statsResult.ok && statsResult.error !== 'cached';
            const anyCallAttempted = allowNetwork && (
                pushActuallyFailed || statsActuallyFailed ||
                (pushResult.ok && pushResult.error !== 'not_changed') ||
                (statsResult.ok && statsResult.error !== 'cached')
            );

            if (allowNetwork) {
                onlineState = { online: true, text: 'API доступен' };
                if (pushActuallyFailed && statsActuallyFailed) {
                    const pushErr = describeRequestError(pushResult);
                    const statsErr = describeRequestError(statsResult);
                    const errText = [pushErr, statsErr].filter(Boolean).join(' / ');
                    onlineState = { online: false, text: 'API недоступен: ' + (errText || 'network') };
                }
            }

            if (anyCallAttempted) {
                if (!onlineState.online) {
                    consecutiveCycleFailures += 1;
                    if (consecutiveCycleFailures >= MAX_CONSECUTIVE_FAILURES) {
                        cyclesStopped = true;
                        onlineState = { online: false, text: 'Ошибка синхронизации (' + consecutiveCycleFailures + '/' + MAX_CONSECUTIVE_FAILURES + '). Обновите страницу.' };
                        debugSync('cycle_stopped_max_failures', { consecutiveCycleFailures });
                    }
                } else {
                    consecutiveCycleFailures = 0;
                }
            }

            topFrameOnlineState = onlineState;
            window.__PARAMEXT_TOPFRAME_ONLINE_STATE = topFrameOnlineState;

            if (isTopFrame) {
                setStickOnline(onlineState.online, onlineState.text);
                renderStick(mergedStatsByQuestion, questions);
            } else {
                syncIframeStateToTop(mergedStatsByQuestion, questions, onlineState);
            }
        } finally {
            cycleInFlight = false;
        }
    }

    function isAutoAdvanceEnabled() {
        return Boolean(settings?.openedu?.autoAdvanceEnabled);
    }

    function isActiveTabPostSubmitRefreshEnabled() {
        return Boolean(settings?.openedu?.activeTabPostSubmitRefreshEnabled || settings?.openedu?.activeTabRefreshEnabled);
    }

    function requestActiveTabPostSubmitRefresh(source) {
        if (!isActiveTabPostSubmitRefreshEnabled()) {
            return;
        }

        if (!isTopFrame) {
            try {
                window.top.postMessage({
                    type: 'PARAMEXT_OPENEDU_REFRESH_ACTIVE_TAB_REQUEST',
                    source: String(source || 'post-submit')
                }, '*');
            } catch (_) {
                // Ignore postMessage failures.
            }
            return;
        }

        scheduleActiveTabPostSubmitRefresh(source);
    }

    function findActiveSequenceTab() {
        if (!isTopFrame) {
            return null;
        }

        const tabsHost = document.querySelector('.sequence-navigation-tabs');
        if (!tabsHost) {
            return null;
        }

        const activeTab = tabsHost.querySelector('button.active, [role="tab"].active, a.active');
        return activeTab instanceof HTMLElement ? activeTab : null;
    }

    function isSequenceTabComplete(tab) {
        if (!(tab instanceof HTMLElement)) {
            return false;
        }

        if (tab.classList.contains('complete')) {
            return true;
        }

        return Boolean(tab.querySelector('.text-success, .fa-check, [data-icon="check"]'));
    }

    function hasTopFrameIframeQuestions() {
        return Array.isArray(topFrameIframeQuestions) && topFrameIframeQuestions.length > 0;
    }

    function refreshActiveSequenceTabForEmptySection(source) {
        if (!isTopFrame || !settings?.openedu?.activeTabRefreshEnabled) {
            return false;
        }

        const activeTab = findActiveSequenceTab();
        if (!(activeTab instanceof HTMLElement)) {
            return false;
        }

        const tabsHost = activeTab.closest('.sequence-navigation-tabs') || activeTab.parentElement;
        const activeTabKey = getActiveSequenceTabKey(tabsHost, activeTab);
        const now = Date.now();

        if (isSequenceTabComplete(activeTab)) {
            if (isAutoAdvanceEnabled()) {
                setTimeout(() => maybeClickNextOnSequencePage(), 250);
            }
            return false;
        }

        if (
            activeTabKey === lastEmptySectionRefreshKey
            && now - lastActiveTabRefreshAt < ACTIVE_TAB_EMPTY_REFRESH_MIN_GAP_MS
        ) {
            return false;
        }

        lastEmptySectionRefreshKey = activeTabKey;
        lastActiveTabRefreshAt = now;
        activeTab.click();
        markSequenceNavigation(source || 'empty-section-refresh', activeTabKey);
        requestSequenceFrameSync(source || 'empty-section-refresh', now);

        setTimeout(() => {
            const refreshedTab = findActiveSequenceTab();
            if (isSequenceTabComplete(refreshedTab) && isAutoAdvanceEnabled()) {
                maybeClickNextOnSequencePage();
            }
        }, 1400);

        setTimeout(() => {
            scheduleCycle(false, 'empty-section-refresh', { allowNetwork: false });
        }, 1800);

        debugSync('empty_section_active_tab_refresh_clicked', {
            source: String(source || 'empty-section-refresh'),
            activeTabKey,
            title: activeTab.getAttribute('title') || ''
        });
        return true;
    }

    function scheduleActiveTabPostSubmitRefresh(source) {
        if (!isTopFrame || !isActiveTabPostSubmitRefreshEnabled()) {
            return;
        }

        const generation = activeTabPostSubmitRefreshGeneration + 1;
        activeTabPostSubmitRefreshGeneration = generation;
        const sourceText = String(source || 'post-submit');

        debugSync('active_tab_post_submit_refresh_scheduled', {
            source: sourceText,
            generation,
            delays: ACTIVE_TAB_POST_SUBMIT_REFRESH_DELAYS_MS
        });

        ACTIVE_TAB_POST_SUBMIT_REFRESH_DELAYS_MS.forEach((delayMs, index) => {
            setTimeout(() => {
                if (generation !== activeTabPostSubmitRefreshGeneration || !isActiveTabPostSubmitRefreshEnabled()) {
                    return;
                }

                const activeTab = findActiveSequenceTab();
                if (!(activeTab instanceof HTMLElement)) {
                    debugSync('active_tab_post_submit_refresh_skipped', {
                        reason: 'active_tab_not_found',
                        generation,
                        attempt: index + 1
                    });
                    return;
                }

                if (isSequenceTabComplete(activeTab) && index > 0) {
                    debugSync('active_tab_post_submit_refresh_complete', {
                        generation,
                        attempt: index + 1
                    });
                    if (isAutoAdvanceEnabled()) {
                        setTimeout(() => maybeClickNextOnSequencePage(), 300);
                    }
                    return;
                }

                lastActiveTabRefreshAt = Date.now();
                activeTab.click();
                markSequenceNavigation('active-tab-post-submit-refresh', getActiveSequenceTabKey(activeTab.parentElement, activeTab));
                requestSequenceFrameSync('active-tab-post-submit-refresh', Date.now());
                debugSync('active_tab_post_submit_refresh_clicked', {
                    generation,
                    attempt: index + 1,
                    title: activeTab.getAttribute('title') || ''
                });

                setTimeout(() => {
                    if (generation !== activeTabPostSubmitRefreshGeneration) {
                        return;
                    }
                    const refreshedTab = findActiveSequenceTab();
                    if (!isSequenceTabComplete(refreshedTab)) {
                        return;
                    }
                    activeTabPostSubmitRefreshGeneration += 1;
                    debugSync('active_tab_post_submit_refresh_complete_after_click', {
                        generation,
                        attempt: index + 1
                    });
                    if (isAutoAdvanceEnabled()) {
                        maybeClickNextOnSequencePage();
                    }
                }, 1600);

                if (index === ACTIVE_TAB_POST_SUBMIT_REFRESH_DELAYS_MS.length - 1) {
                    setTimeout(() => {
                        if (generation !== activeTabPostSubmitRefreshGeneration) {
                            return;
                        }
                        const refreshedTab = findActiveSequenceTab();
                        if (isSequenceTabComplete(refreshedTab)) {
                            if (isAutoAdvanceEnabled()) {
                                maybeClickNextOnSequencePage();
                            }
                            return;
                        }
                        if (activeTabPostSubmitSoundGeneration !== generation) {
                            activeTabPostSubmitSoundGeneration = generation;
                            playMissingAnswerSound();
                            debugSync('active_tab_post_submit_refresh_failed', {
                                generation,
                                attempts: ACTIVE_TAB_POST_SUBMIT_REFRESH_DELAYS_MS.length
                            });
                        }
                    }, 1600);
                }
            }, delayMs);
        });
    }

    function maybeClickNextOnSequencePage() {
        if (!isTopFrame) {
            return;
        }

        const tabsHost = document.querySelector('.sequence-navigation-tabs');
        if (!tabsHost) {
            return;
        }

        const activeTab = tabsHost.querySelector('button.active');
        if (!activeTab) {
            return;
        }

        const now = Date.now();
        const activeTabKey = getActiveSequenceTabKey(tabsHost, activeTab);
        if (!lastSequenceTabKey) {
            lastSequenceTabKey = activeTabKey;
        } else if (activeTabKey && activeTabKey !== lastSequenceTabKey) {
            markSequenceNavigation('active-tab-changed', activeTabKey);
        }

        const isComplete = isSequenceTabComplete(activeTab);
        if (!isComplete && settings.openedu.activeTabRefreshEnabled) {
            const noQuestionsOnCurrentSection = lastParsedQuestionCount === 0 && !hasTopFrameIframeQuestions();
            const refreshGapMs = noQuestionsOnCurrentSection
                ? ACTIVE_TAB_EMPTY_REFRESH_MIN_GAP_MS
                : ACTIVE_TAB_REFRESH_MIN_GAP_MS;
            const canRefreshActiveTab =
                ((now - lastSubmitActionAt) <= ACTIVE_TAB_REFRESH_AFTER_SUBMIT_WINDOW_MS || noQuestionsOnCurrentSection) &&
                (now - lastActiveTabRefreshAt) >= refreshGapMs;

            if (canRefreshActiveTab) {
                lastActiveTabRefreshAt = now;
                activeTab.click();
                markSequenceNavigation(
                    noQuestionsOnCurrentSection ? 'auto-next-empty-section-refresh' : 'auto-next-active-tab-refresh',
                    activeTabKey
                );
                requestSequenceFrameSync('auto-next-active-tab-refresh', now);
            }
            return;
        }

        if (!isComplete && settings.openedu.requiredCompletionOnly) {
            return;
        }

        const delayMs = Number(settings.openedu.autoAdvanceDelayMs || 1800);
        if (now - lastAutoAdvanceAt < delayMs) {
            return;
        }

        if (shouldWaitBeforeAutoAdvance(now)) {
            return;
        }

        const nextButton = document.querySelector('.next-btn:not([disabled]), .next-button:not([disabled])');
        if (!nextButton) {
            return;
        }

        lastAutoAdvanceAt = now;
        nextButton.click();
        markSequenceNavigation('auto-next');
    }

    function installPageMonitors() {
        const handleManualAnswerInput = (event) => {
            if (!pendingManualAnswerQuestion || !isEventInsideQuestion(event, pendingManualAnswerQuestion)) {
                return;
            }
            scheduleContinueAfterManualAnswer(event.type);
        };

        document.addEventListener('input', handleManualAnswerInput, true);
        document.addEventListener('change', handleManualAnswerInput, true);

        document.addEventListener('click', (event) => {
            const source = event.target instanceof Element ? event.target : null;
            if (!source) {
                return;
            }

            const actionable = source.closest('.submit, .submit.btn-brand, .problem button, .sequence-navigation-tabs button, .next-btn, .next-button');
            if (!actionable) {
                return;
            }

            if (isTopFrame && actionable.matches('.sequence-navigation-tabs button, .next-btn, .next-button')) {
                markSequenceNavigation('navigation-click');
            }

            if (isTopFrame && isAutoAdvanceEnabled() && actionable.matches('.sequence-navigation-tabs button, .next-btn, .next-button')) {
                setTimeout(() => {
                    maybeClickNextOnSequencePage();
                }, 180);
            }

            const actionText = normalizeText(textOf(actionable));
            const isSubmit = actionable.matches('.submit, .submit.btn-brand, .problem button[type="submit"]')
                || (actionable.matches('.problem button') && /(провер|submit|check|save|отправ|answer)/.test(actionText));
            if (isSubmit) {
                lastSubmitActionAt = Date.now();
                requestActiveTabPostSubmitRefresh('manual-submit');
                let rerenderAttempts = 0;
                const tryRerender = () => {
                    rerenderAttempts++;
                    quickRerender();
                    if (rerenderAttempts < 8) {
                        setTimeout(tryRerender, 150);
                    }
                };
                setTimeout(tryRerender, 200);
                scheduleCycle(false, 'submit-preview', { allowNetwork: false });
                schedulePostSubmitSyncs();
                return;
            }

            if (shouldHandleDomRefreshTrigger()) {
                setTimeout(() => {
                    scheduleCycle(false, 'click', { allowNetwork: false });
                }, 250);
            }
        }, true);

        window.addEventListener('message', (event) => {
            const data = event.data;
            if (!data) {
                return;
            }

            if (typeof data === 'object' && Object.keys(data).length === 1 && Object.prototype.hasOwnProperty.call(data, 'offset')) {
                return;
            }

            if (typeof data === 'object' && typeof data.type === 'string' && data.type.startsWith('PARAMEXT_')) {
                return;
            }

            let text = '';
            if (typeof data === 'string') {
                text = data.toLowerCase();
            } else {
                const typeValue = typeof data?.type === 'string' ? data.type.toLowerCase() : '';
                const eventValue = typeof data?.event === 'string' ? data.event.toLowerCase() : '';
                const actionValue = typeof data?.action === 'string' ? data.action.toLowerCase() : '';
                text = [typeValue, eventValue, actionValue].filter(Boolean).join('|');
            }

            if (!text) {
                return;
            }

            if (/(problem|submission|submitted|grade|correct|incorrect|capa)/.test(text)) {
                if (shouldHandleDomRefreshTrigger()) {
                    scheduleCycle(false, 'message', { allowNetwork: false });
                }
            }
        });

        const isRelevantMutationNode = (node) => {
            if (!(node instanceof Element)) {
                return false;
            }

            const selector = QUESTION_ROOT_SELECTOR + ', .response-label, .status, .message, .feedback, .sequence-navigation-tabs';
            if (node.matches(selector)) {
                return true;
            }

            if (node.closest(selector)) {
                return true;
            }

            return Boolean(node.querySelector(selector));
        };

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === 'attributes') {
                    const node = mutation.target;
                    if (node instanceof Element && node.matches('.status, .message, .feedback, .choicegroup, .response-label, .sequence-navigation-tabs button, [data-problem-id]')) {
                        if (shouldHandleDomRefreshTrigger()) {
                            scheduleCycle(false, 'mutation', { allowNetwork: false });
                        }
                        return;
                    }
                }

                if (mutation.type === 'childList' && (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0)) {
                    const changedNodes = [];
                    mutation.addedNodes.forEach((node) => changedNodes.push(node));
                    mutation.removedNodes.forEach((node) => changedNodes.push(node));

                    if (changedNodes.some((node) => isRelevantMutationNode(node))) {
                        if (shouldHandleDomRefreshTrigger()) {
                            scheduleCycle(false, 'mutation', { allowNetwork: false });
                        }
                        return;
                    }
                }
            }
        });

        observer.observe(document.documentElement || document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class', 'aria-label', 'data-tooltip']
        });
    }

    function installKeyboardToggle() {
        document.addEventListener('keydown', (event) => {
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
                return;
            }

            if (window.ParamExtSettings.hotkeyMatches(event, settings.openedu.stickHotkey)) {
                event.preventDefault();
                setWandsHidden(!wandsHidden, true);
                if (!wandsHidden && isTopFrame) {
                    toggleStick(false);
                }
            }
        });
    }

    function installStorageSync() {
        chrome.storage.onChanged.addListener(async (changes, areaName) => {
            if (areaName !== 'local') {
                return;
            }

            const hasSettingsChange = Object.prototype.hasOwnProperty.call(changes, window.ParamExtSettings.STORAGE_KEY);
            const hasWandVisibilityChange = Object.prototype.hasOwnProperty.call(changes, WAND_VISIBILITY_KEY);
            if (!hasSettingsChange && !hasWandVisibilityChange) {
                return;
            }

            if (hasSettingsChange) {
                const previousSettings = settings;
                settings = await window.ParamExtSettings.getSettings();
                const backendChanged =
                    String(previousSettings?.backend?.openedu?.apiBaseUrl || '') !== String(settings?.backend?.openedu?.apiBaseUrl || '')
                    || String(previousSettings?.backend?.openedu?.apiToken || '') !== String(settings?.backend?.openedu?.apiToken || '')
                    || String(previousSettings?.openedu?.backendVersion || 'v2') !== String(settings?.openedu?.backendVersion || 'v2');
                if (backendChanged) {
                    resetRemoteStatsState('backend_settings_changed');
                }
                clearSyncBlock();
                consecutiveCycleFailures = 0;
                cyclesStopped = false;
                runStickCycle(true, { source: 'settings', allowNetwork: true });
            }

            if (hasWandVisibilityChange) {
                const hidden = Boolean(changes[WAND_VISIBILITY_KEY]?.newValue);
                setWandsHidden(hidden, false);
            }
        });
    }

    async function boot() {
        settings = await window.ParamExtSettings.getSettings();
        wandsHidden = await loadWandsHiddenState();

        if (window.ParamExtTelemetry) {
            window.ParamExtTelemetry.push('system_state', {
                activePlatform: settings.activePlatform,
                mode: settings.openedu.mode,
                autoAdvanceEnabled: settings.openedu.autoAdvanceEnabled,
                locationHost: location.host,
                frame: isTopFrame ? 'top' : 'iframe'
            }, 'openedu-content');
        }

        ensureStickUi();
        setWandsHidden(wandsHidden, false);
        installKeyboardToggle();
        installPageMonitors();
        installStorageSync();

        if (isTopFrame) {
            if (!hasOpeneduApiToken()) {
                setStickOnline(false, OPENEDU_TOKEN_REQUIRED_TITLE);
            } else if (!normalizeApiBaseUrl()) {
                setStickOnline(false, 'Не указан API URL');
            } else {
                setStickOnline(false, 'Ожидание данных из iframe');
            }
        }

        runStickCycle(true, { source: 'boot', allowNetwork: true });
        scheduleBootstrapSyncs();

        if (isTopFrame) {
            setInterval(() => {
                if (isAutoAdvanceEnabled()) {
                    maybeClickNextOnSequencePage();
                }
            }, 3000);
        }
    }

    boot();
})();
