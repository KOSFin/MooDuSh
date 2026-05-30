(function (root) {
    const VERSION = 'openedu-parser-v2.0.0';
    const QUESTION_SELECTOR = '.wrapper-problem-response, .xblock-student_view-multiengine .problem, .xblock-student_view-problem .problem, [data-problem-id], fieldset, .choicegroup, [id^="problem_"]';
    const INPUT_SELECTOR = 'input[type="radio"], input[type="checkbox"], input[type="text"], textarea, select';
    const LABEL_SELECTOR = 'label.response-label, label.field-label, .choicegroup label[for], label[for], label';
    const SYSTEM_TEXT_RE = /(MooDuSh|Вставить правильн|Вставить популярн|Нет статистики|Проверить|Отправить|Сохранить|Show answer|Ответы в задаче отмечены)/i;
    const PROMPT_NOISE_RE = /\b(Выберите\s+((один|несколько|все|\d+|правильн)[^.:\n]*)|Дополните|Набрано\s+баллов:\s*\d+\s*из\s*\d+|Вопрос\s+\d+|Show answer|Save|Сохранить|Проверить|Отправить|Ответы в задаче отмечены|None)\b/gi;

    const shared = root.ParamExtOpeneduShared || {};

    function collapseWhitespace(value) {
        if (typeof shared.collapseWhitespace === 'function') {
            return shared.collapseWhitespace(value);
        }
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    function sanitizePrompt(value, answers) {
        if (typeof shared.sanitizeQuestionPrompt === 'function') {
            return shared.sanitizeQuestionPrompt(value, answers);
        }
        return cleanPromptText(value);
    }

    function sanitizeAnswer(value) {
        if (typeof shared.sanitizeAnswerText === 'function') {
            return shared.sanitizeAnswerText(value);
        }
        return collapseWhitespace(value);
    }

    function hashText(value) {
        let hash = 2166136261;
        const text = String(value || '');
        for (let i = 0; i < text.length; i += 1) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, '0');
    }

    function decodeHtml(value) {
        const text = String(value || '');
        if (!/[<&][a-z#]/i.test(text) && !/&lt;|&#34;|&quot;|&#39;|&amp;/i.test(text)) {
            return text;
        }
        if (typeof document !== 'undefined') {
            const textarea = document.createElement('textarea');
            textarea.innerHTML = text;
            return textarea.value;
        }
        return text
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;|&#34;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&amp;/g, '&');
    }

    function cleanPromptText(value) {
        return collapseWhitespace(String(value || '')
            .replace(PROMPT_NOISE_RE, ' ')
            .replace(/\s+([?.!,;:])/g, '$1'));
    }

    function fingerprintQuestion(prompt, answers) {
        if (typeof shared.buildQuestionFingerprint === 'function') {
            return shared.buildQuestionFingerprint(prompt, answers);
        }
        return hashText(JSON.stringify({
            prompt: collapseWhitespace(prompt).toLowerCase(),
            answers: (answers || []).map((item) => collapseWhitespace(item).toLowerCase()).sort()
        }));
    }

    function parseHtml(html, sourceUrl) {
        if (typeof DOMParser === 'undefined') {
            return [];
        }
        const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
        doc.__PARAMEXT_SOURCE_PATH = sourceUrl || '';
        return parseDocumentTree(doc, { sourceUrl });
    }

    function textOf(node) {
        if (!node) {
            return '';
        }
        const clone = node.cloneNode(true);
        clone.querySelectorAll('script, style, button, .moodush-openedu-inline-menu').forEach((item) => item.remove());
        return collapseWhitespace(clone.textContent || '');
    }

    function mediaToken(node) {
        const img = node.querySelector('img');
        if (img) {
            const src = img.getAttribute('src') || '';
            const clean = src.split('?')[0].split('/').filter(Boolean).pop() || hashText(src);
            return 'img:' + clean;
        }
        const svg = node.querySelector('svg');
        if (svg) {
            return 'svg:' + hashText(svg.outerHTML || textOf(svg));
        }
        return '';
    }

    function deriveAnswerText(input, root) {
        const inputType = String(input.type || input.tagName || '').toLowerCase();
        if (inputType === 'text' || input.tagName.toLowerCase() === 'textarea') {
            if (input.hidden || input.getAttribute('hidden') !== null) {
                return '';
            }
            return sanitizeAnswer(input.value || '');
        }
        const id = input.getAttribute('id') || '';
        const label = id ? root.querySelector('label[for="' + cssEscape(id) + '"]') : input.closest('label');
        const text = sanitizeAnswer(textOf(label) || mediaToken(label || input) || input.getAttribute('value') || '');
        return text;
    }

    function cssEscape(value) {
        if (root.CSS && typeof root.CSS.escape === 'function') {
            return root.CSS.escape(String(value || ''));
        }
        return String(value || '').replace(/"/g, '\\"');
    }

    function getQuestionType(inputs) {
        const types = new Set(inputs.map((input) => input.type || input.tagName.toLowerCase()));
        if (types.has('checkbox')) {
            return 'multiple_choice';
        }
        if (types.has('radio')) {
            return 'single_choice';
        }
        if (types.has('text') || types.has('textarea')) {
            return 'text_input';
        }
        if (types.has('select-one') || types.has('select')) {
            return 'select';
        }
        return 'unknown';
    }

    function parseEmbeddedDocuments(doc) {
        const embedded = [];
        doc.querySelectorAll('[data-content]').forEach((node) => {
            const raw = node.getAttribute('data-content') || '';
            const decoded = decodeHtml(raw);
            if (!decoded.includes('<input') && !decoded.includes('<textarea') && !decoded.includes('wrapper-problem-response')) {
                return;
            }
            const child = doc.implementation.createHTMLDocument('openedu-frame');
            child.body.innerHTML = decoded;
            child.__PARAMEXT_SOURCE_PATH = node.getAttribute('data-usage-id') || node.getAttribute('data-id') || doc.__PARAMEXT_SOURCE_PATH || '';
            embedded.push(child);
        });
        return embedded;
    }

    function getQuestionBlocks(doc) {
        const wrappers = Array.from(doc.querySelectorAll('.wrapper-problem-response'));
        const multiengine = Array.from(doc.querySelectorAll('.xblock-student_view-multiengine .problem'))
            .filter((node) => node.querySelector('textarea.answer, textarea[name="answer"]'));
        if (wrappers.length || multiengine.length) {
            return wrappers.concat(multiengine);
        }
        return Array.from(doc.querySelectorAll(QUESTION_SELECTOR));
    }

    function nearbyPrompt(block) {
        const chunks = [];
        let current = block.previousElementSibling;
        for (let i = 0; current && i < 5; i += 1, current = current.previousElementSibling) {
            if (current.matches?.('.problem-progress, script, style')) {
                continue;
            }
            const text = cleanPromptText(textOf(current));
            if (text && !SYSTEM_TEXT_RE.test(text)) {
                chunks.unshift(text);
            }
        }
        const header = block.closest('.xblock-student_view-problem, .xblock-student_view-multiengine')?.querySelector('.problem-header, h2, h3');
        const headerText = cleanPromptText(textOf(header));
        return collapseWhitespace([headerText, ...chunks].filter(Boolean).join(' '));
    }

    function extractPrompt(block, answerTexts) {
        const directPrompt = Array.from(block.querySelectorAll('.field-group-hd, legend, .problem-group-label, .problem-header, h2.problem-header, h3.problem-header'))
            .map((node) => cleanPromptText(textOf(node)))
            .find((text) => text && !SYSTEM_TEXT_RE.test(text) && !/^выберите/i.test(text));
        if (directPrompt) {
            return sanitizePrompt(directPrompt, answerTexts);
        }

        const clone = block.cloneNode(true);
        clone.querySelectorAll([
            'script',
            'style',
            'button',
            'input',
            'textarea',
            'select',
            'label',
            '.choicegroup',
            '.capa_inputtype',
            '.problem-progress',
            '.notification',
            '.notification-message',
            '.status',
            '.status-icon',
            '.submit-attempt-container'
        ].join(',')).forEach((node) => node.remove());
        let prompt = cleanPromptText(clone.textContent || '');
        if (!prompt || prompt.length < 8 || SYSTEM_TEXT_RE.test(prompt)) {
            prompt = nearbyPrompt(block);
        }
        return sanitizePrompt(prompt, answerTexts);
    }

    function confidenceFor(question) {
        if (!question.prompt || question.prompt.length < 8 || SYSTEM_TEXT_RE.test(question.prompt)) {
            return 0.25;
        }
        let score = 0;
        score += 0.45;
        if (question.answers.length > 0 || question.questionType === 'text_input') {
            score += 0.35;
        }
        if (question.problemId || question.questionFingerprint) {
            score += 0.15;
        }
        if (question.questionType !== 'unknown') {
            score += 0.05;
        }
        return Math.min(1, Number(score.toFixed(2)));
    }

    function parseDocument(doc, options) {
        const roots = getQuestionBlocks(doc);
        const seen = new Set();
        const questions = [];

        roots.forEach((block, index) => {
            const inputs = Array.from(block.querySelectorAll(INPUT_SELECTOR))
                .filter((input) => !input.disabled && input.type !== 'hidden');
            const hiddenTextInputs = Array.from(block.querySelectorAll('textarea.answer[hidden], textarea[name="answer"][hidden]'));
            const effectiveInputs = inputs.length ? inputs : hiddenTextInputs;
            if (effectiveInputs.length === 0) {
                return;
            }

            const answers = effectiveInputs.map((input, answerIndex) => {
                const answerText = deriveAnswerText(input, block);
                const answerKey = input.name || input.id || ('answer_' + answerIndex);
                return {
                    answerKey,
                    answerText,
                    inputType: input.type || input.tagName.toLowerCase(),
                    selected: Boolean(input.checked || (input.value && input.type === 'text')),
                    correct: /\b(correct|choicegroup_correct)\b/i.test(input.className || ''),
                    incorrect: /\b(incorrect|choicegroup_incorrect)\b/i.test(input.className || ''),
                    answerFingerprint: hashText(answerText || answerKey)
                };
            });
            const visibleAnswers = answers.map((item) => item.answerText).filter(Boolean);
            const prompt = extractPrompt(block, visibleAnswers);
            const questionType = getQuestionType(effectiveInputs);
            const problemId = block.getAttribute('data-problem-id') || block.id || '';
            const questionFingerprint = fingerprintQuestion(prompt, visibleAnswers);
            const key = questionFingerprint || hashText(problemId + '|' + index);
            if (seen.has(key)) {
                return;
            }
            seen.add(key);

            const question = {
                questionKey: 'qv2_' + key,
                prompt,
                questionType,
                questionFingerprint,
                parserSource: 'openedu_parser_dom',
                parseConfidence: 0,
                rawType: block.className || block.tagName.toLowerCase(),
                problemId,
                answers,
                sourceFrame: options?.sourceUrl || doc.__PARAMEXT_SOURCE_PATH || ''
            };
            question.parseConfidence = confidenceFor(question);
            questions.push(question);
        });

        return questions;
    }

    function parseDocumentTree(doc, options) {
        const allQuestions = [];
        const seen = new Set();
        [doc, ...parseEmbeddedDocuments(doc)].forEach((sourceDoc) => {
            parseDocument(sourceDoc, options).forEach((question) => {
                const key = question.questionFingerprint || question.questionKey;
                if (seen.has(key)) {
                    return;
                }
                seen.add(key);
                allQuestions.push(question);
            });
        });
        return allQuestions;
    }

    root.ParamExtOpeneduParser = {
        VERSION,
        parseHtml,
        parseDocument,
        parseDocumentTree,
        confidenceFor,
        fingerprintQuestion
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = root.ParamExtOpeneduParser;
    }
})(typeof globalThis !== 'undefined' ? globalThis : window);
