(function (root) {
    const VERSION = 'openedu-parser-v2.0.0';
    const QUESTION_SELECTOR = '.wrapper-problem-response, .xblock-student_view-multiengine .problem, .xblock-student_view-problem .problem, [data-problem-id], fieldset, .choicegroup, [id^="problem_"]';
    const INPUT_SELECTOR = 'input[type="radio"], input[type="checkbox"], input[type="text"], textarea, select';
    const LABEL_SELECTOR = 'label.response-label, label.field-label, .choicegroup label[for], label[for], label';
    const SYSTEM_TEXT_RE = /(MooDuSh|Вставить правильн|Вставить популярн|Нет статистики|Проверить|Отправить|Сохранить|Show answer|Ответы в задаче отмечены|Набрано\s+баллов|Использовано\s+попыток|Вы\s+использовали|Разместите\s+ответ\s+здесь)/i;
    const PROMPT_NOISE_RE = /\b(Выберите\s+((один|несколько|все|\d+|правильн)[^.:\n]*)|Дополните|Набрано\s+баллов:\s*\d+\s*из\s*\d+|Использовано\s+попыток:\s*\d+\s*из\s*\d+|Вы\s+использовали\s+\d+\s*из\s*\d+\s*попыток|Разместите\s+ответ\s+здесь|Вопрос\s+\d+|Show answer|Save|Сохранить|Проверить|Отправить|Ответы в задаче отмечены|None)\b/gi;
    const CSS_DECLARATION_RE = /\b(?:align-items|animation|background(?:-color)?|border(?:-(?:color|radius|top-color))?|box-sizing|color|display|font(?:-size|-weight)?|height|justify-content|line-height|margin(?:-(?:bottom|left|right|top))?|max-width|min-height|opacity|overflow|padding(?:-(?:bottom|left|right|top))?|pointer-events|position|text-align|transform|transition|width|z-index)\s*:/ig;
    const CSS_SELECTOR_RE = /(^|\s)[.#][a-z_-][\w-]*(?:[.#][a-z_-][\w-]*)?(?=\s|[,{:.#])/i;
    const OPENEDU_CSS_MARKER_RE = /\b(?:answerPlaceStudent|allAnswers|loadingspinner|ui-sortable|btn-brand|submit-attempt-container|problem-action-buttons-wrapper)\b/i;

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

    function parseDataLiteral(value) {
        const raw = decodeHtml(String(value || '').trim());
        if (!raw) {
            return null;
        }
        if (typeof shared.parsePythonishDataLiteral === 'function') {
            return shared.parsePythonishDataLiteral(raw);
        }

        try {
            return JSON.parse(raw);
        } catch (_) {
            // Continue with a small Python-literal fallback for OpenEdu configs.
        }

        try {
            const jsonish = raw
                .replace(/'/g, '"')
                .replace(/\bTrue\b/g, 'true')
                .replace(/\bFalse\b/g, 'false')
                .replace(/\bNone\b/g, 'null');
            return JSON.parse(jsonish);
        } catch (_) {
            return null;
        }
    }

    function findBalancedObjectLiteral(source, startIndex) {
        const text = String(source || '');
        const start = text.indexOf('{', Math.max(0, Number(startIndex || 0)));
        if (start < 0) {
            return '';
        }

        let depth = 0;
        let quote = '';
        let escaped = false;
        for (let index = start; index < text.length; index += 1) {
            const ch = text[index];
            if (quote) {
                if (escaped) {
                    escaped = false;
                } else if (ch === '\\') {
                    escaped = true;
                } else if (ch === quote) {
                    quote = '';
                }
                continue;
            }

            if (ch === '"' || ch === "'") {
                quote = ch;
                continue;
            }
            if (ch === '{') {
                depth += 1;
            } else if (ch === '}') {
                depth -= 1;
                if (depth === 0) {
                    return text.slice(start, index + 1);
                }
            }
        }
        return '';
    }

    function cleanPromptText(value) {
        const text = collapseWhitespace(String(value || '')
            .replace(PROMPT_NOISE_RE, ' ')
            .replace(/\s+([?.!,;:])/g, '$1'));
        return looksLikeCssNoiseText(text) ? '' : text;
    }

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
        clone.querySelectorAll('script, style, noscript, template, link, meta, button, [hidden], [aria-hidden="true"], [data-moodush-extension], [data-moodush-openedu-debug], .moodush-openedu-debug-label, .moodush-openedu-inline-menu, .moodush-openedu-inline-popover, .moodush-openedu-wand-toggle, .moodush-openedu-stick, .MathJax_Preview, .MJX_Assistive_MathML, mjx-assistive-mml').forEach((item) => item.remove());
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

    function adjacentHtmlContext(root) {
        const currentVert = root.closest?.('.vert');
        if (!currentVert) {
            return { text: '', node: null };
        }

        let previous = currentVert.previousElementSibling;
        for (let i = 0; previous && i < 6; i += 1, previous = previous.previousElementSibling) {
            if (!previous.matches?.('.vert')) {
                continue;
            }
            if (previous.querySelector(INPUT_SELECTOR + ', table.drag-table, table.answerPlaceStudent, .dragAnswer[id]')) {
                break;
            }
            if (!previous.querySelector('.xblock-student_view-html, [data-block-type="html"], img, svg, canvas')) {
                continue;
            }

            const text = cleanPromptText(textOf(previous));
            const media = mediaToken(previous);
            const candidate = collapseWhitespace([text, media].filter(Boolean).join(' '));
            if (candidate && !SYSTEM_TEXT_RE.test(candidate)) {
                return { text: candidate, node: previous };
            }
        }

        return { text: '', node: null };
    }

    function adjacentHtmlContextPrompt(root) {
        return adjacentHtmlContext(root).text;
    }

    function deriveAnswerText(input, root) {
        const inputType = String(input.type || input.tagName || '').toLowerCase();
        if (inputType === 'text' || input.tagName.toLowerCase() === 'textarea') {
            if (input.hidden || input.getAttribute('hidden') !== null) {
                return '';
            }
            return sanitizeAnswer(input.value || '');
        }
        if (input.tagName.toLowerCase() === 'select') {
            return selectedOptionText(input);
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

    function isSelectPlaceholderOption(option) {
        if (!option) {
            return false;
        }
        const value = collapseWhitespace(option.getAttribute?.('value') || option.value || '').toLowerCase();
        const text = collapseWhitespace(textOf(option) || option.label || '').toLowerCase();
        if (option.disabled) {
            return true;
        }
        if (!text && !value) {
            return true;
        }
        return (value === '' || /dummy|placeholder|default/.test(value)) && /(выберите|choose|select)/.test(text);
    }

    function selectedOptionText(select) {
        const selected = Array.from(select.options || [])
            .filter((option) => option && option.selected && !isSelectPlaceholderOption(option))
            .map((option) => sanitizeAnswer(textOf(option) || option.label || option.value || ''))
            .filter(Boolean);
        return selected.join(' / ');
    }

    function isInputSelected(input) {
        const tag = String(input.tagName || '').toLowerCase();
        const type = String(input.type || '').toLowerCase();
        if (tag === 'select') {
            return Boolean(selectedOptionText(input));
        }
        return Boolean(input.checked || (input.value && type === 'text'));
    }

    function getQuestionType(inputs) {
        const types = new Set(inputs.map((input) => input.type || input.tagName.toLowerCase()));
        if (types.has('drag-order')) {
            return 'drag_order';
        }
        if (types.has('drag-table')) {
            return 'drag_table';
        }
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

    function buildDragQuestions(doc, options) {
        const questions = [];
        const roots = Array.from(doc.querySelectorAll('.problem, .xblock-student_view-problem, [data-problem-id]'))
            .filter((root) => {
                if (!root.querySelector('table.drag-table, table.answerPlaceStudent') || !root.querySelector('.dragAnswer[id]')) {
                    return false;
                }
                const nestedProblem = root.querySelector('.problem');
                return !(nestedProblem && nestedProblem !== root && nestedProblem.querySelector('table.drag-table, table.answerPlaceStudent'));
            });

        roots.forEach((root, index) => {
            const table = root.querySelector('table.drag-table, table.answerPlaceStudent');
            const cells = Array.from(table?.querySelectorAll('td.cell[id], th.cell[id]') || []);
            const answers = Array.from(root.querySelectorAll('.dragAnswer[id]'));
            if (!cells.length || !answers.length) {
                return;
            }

            const answerItems = answers.map((answer, answerIndex) => {
                const answerText = sanitizeAnswer(textOf(answer));
                return {
                    answerKey: answer.getAttribute('id') || ('drag_' + answerIndex),
                    answerText,
                    inputType: cells.length === 1 ? 'drag-order' : 'drag-table',
                    selected: Boolean(cells.some((cell) => cell.contains(answer))),
                    correct: false,
                    incorrect: false,
                    answerFingerprint: hashText(answerText || answer.getAttribute('id') || '')
                };
            }).filter((item) => item.answerText);

            if (!answerItems.length) {
                return;
            }

            const answerTexts = answerItems.map((item) => item.answerText);
            const context = adjacentHtmlContext(root);
            const prompt = extractDragPrompt(root, answerTexts, context.text) || extractPrompt(root, answerTexts);
            const questionType = cells.length === 1 ? 'drag_order' : 'drag_table';
            const questionFingerprint = fingerprintQuestion(prompt, answerItems.map((item) => item.answerText));
            const question = {
                questionKey: 'qv2_' + questionFingerprint,
                prompt,
                questionType,
                questionFingerprint,
                parserSource: 'openedu_parser_dom',
                parseConfidence: 0,
                rawType: root.className || root.tagName.toLowerCase(),
                problemId: root.getAttribute('data-problem-id') || root.id || '',
                answers: answerItems,
                sourceFrame: options?.sourceUrl || doc.__PARAMEXT_SOURCE_PATH || '',
                root,
                contextRoot: context.node || null,
                visualRoot: root.closest?.('.xblock-student_view-multiengine, .xblock-student_view-problem, [data-problem-id], .vert') || root
            };
            question.parseConfidence = confidenceFor(question);
            questions.push(question);
        });

        return questions;
    }

    function extractDragPrompt(root, answerTexts, knownContextText) {
        const container = root.closest?.('.xblock-student_view-problem, [data-problem-id], .problems-wrapper, .vert') || root;
        const header = container.querySelector?.('.problem-header, .problem-title, .question-title, h2, h3, h4, legend');
        const headerText = cleanPromptText(textOf(header));
        const contextText = typeof knownContextText === 'string' ? knownContextText : adjacentHtmlContextPrompt(root);
        if (headerText && !SYSTEM_TEXT_RE.test(headerText)) {
            return sanitizePrompt(collapseWhitespace([contextText, headerText].filter(Boolean).join(' ')), answerTexts);
        }
        return sanitizePrompt(contextText || nearbyPrompt(root), answerTexts);
    }

    function naturalQuestionIdCompare(a, b) {
        const left = String(a || '');
        const right = String(b || '');
        const leftMatch = left.match(/(\d+)$/);
        const rightMatch = right.match(/(\d+)$/);
        if (leftMatch && rightMatch) {
            const numeric = Number(leftMatch[1]) - Number(rightMatch[1]);
            if (numeric !== 0) {
                return numeric;
            }
        }
        return left.localeCompare(right);
    }

    function getPhilosophyTestConfig(root) {
        const scripts = Array.from(root.querySelectorAll?.('script') || [])
            .map((script) => String(script.textContent || ''))
            .filter((text) => /new\s+PhilosophyTest\s*\(/.test(text) && /\bquestions\s*:/.test(text));
        const scriptText = scripts[0] || '';
        if (!scriptText) {
            return null;
        }

        const questionsIndex = scriptText.search(/\bquestions\s*:/);
        const questionsLiteral = findBalancedObjectLiteral(scriptText, questionsIndex);
        const questions = parseDataLiteral(questionsLiteral);
        if (!questions || typeof questions !== 'object') {
            return null;
        }

        const typeMatch = scriptText.match(/\btype\s*:\s*["']([^"']+)["']/);
        const inputSelectorMatch = scriptText.match(/\binput\s*:\s*document\.querySelector\(\s*["']([^"']+)["']\s*\)/);
        return {
            questions,
            inputType: collapseWhitespace(typeMatch?.[1] || 'checkbox').toLowerCase() === 'radio' ? 'radio' : 'checkbox',
            inputSelector: inputSelectorMatch?.[1] || ''
        };
    }

    function getPhilosophyTestSelectedAnswers(root, config) {
        const selected = {};
        const doc = root.ownerDocument || document;
        let inputHost = null;
        if (config?.inputSelector && doc?.querySelector) {
            try {
                inputHost = doc.querySelector(config.inputSelector);
            } catch (_) {
                inputHost = null;
            }
        }
        if (!inputHost || typeof inputHost.querySelector !== 'function') {
            inputHost = root.querySelector?.('[id^="philosophy_test_input_"]') || null;
        }

        const input = inputHost?.querySelector?.('input[type="text"], input[type="hidden"], textarea')
            || root.querySelector?.('[id^="philosophy_test_input_"] input[type="text"], [id^="philosophy_test_input_"] input[type="hidden"], [id^="philosophy_test_input_"] textarea');
        const rawValue = (input?.value && input.value !== '{' ? input.value : '')
            || input?.textContent
            || extractPhilosophyTestInputValueFromRawContent(doc, config);
        const parsed = parseDataLiteral(rawValue);
        const answers = parsed?.answer?.answers;
        if (!answers || typeof answers !== 'object') {
            return selected;
        }

        Object.keys(answers).forEach((questionId) => {
            const values = Array.isArray(answers[questionId]) ? answers[questionId] : [answers[questionId]];
            selected[questionId] = new Set(values.map((item) => String(item || '').trim()).filter(Boolean));
        });
        return selected;
    }

    function extractPhilosophyTestInputValueFromRawContent(doc, config) {
        const raw = String(doc?.__PARAMEXT_RAW_CONTENT || '');
        if (!raw) {
            return '';
        }

        const hostId = String(config?.inputSelector || '').match(/^#([\w-]+)$/)?.[1] || '';
        const escapedHostId = hostId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const hostMatch = escapedHostId
            ? raw.match(new RegExp('id=(?:"|&#34;|&quot;)' + escapedHostId + '(?:"|&#34;|&quot;)', 'i'))
            : null;
        const search = hostMatch ? raw.slice(hostMatch.index || 0) : raw;
        const valueMatch = search.match(/(?:<|&lt;)input\b[\s\S]*?\bvalue=(?:"([^"]*)"|&#34;([\s\S]*?)&#34;|&quot;([\s\S]*?)&quot;)/i);
        return decodeHtml(valueMatch?.[1] || valueMatch?.[2] || valueMatch?.[3] || '');
    }

    function isPhilosophyTestInputBlock(root) {
        return Boolean(root?.closest?.('[id^="philosophy_test_input_"]'))
            || Boolean(root?.querySelector?.('[id^="philosophy_test_input_"]'));
    }

    function buildPhilosophyTestQuestions(doc, options) {
        const result = [];
        const roots = Array.from(doc.querySelectorAll('[data-problem-id], .problems-wrapper, .xblock-student_view-problem, body'));
        const seenFingerprints = new Set();

        roots.forEach((root) => {
            const config = getPhilosophyTestConfig(root);
            if (!config) {
                return;
            }

            const selectedByQuestion = getPhilosophyTestSelectedAnswers(root, config);
            const sourceFrame = options?.sourceUrl || doc.__PARAMEXT_SOURCE_PATH || '';
            const problemId = root.getAttribute('data-problem-id') || root.id || '';

            Object.keys(config.questions).sort(naturalQuestionIdCompare).forEach((questionId) => {
                const sourceQuestion = config.questions[questionId];
                const prompt = sanitizePrompt(sourceQuestion?.text || questionId, []);
                const answers = (Array.isArray(sourceQuestion?.answers) ? sourceQuestion.answers : [])
                    .map((answer, answerIndex) => {
                        const letter = collapseWhitespace(answer?.let || answer?.letter || answer?.value || '');
                        const answerText = sanitizeAnswer(answer?.text || letter || ('answer_' + String(answerIndex + 1)));
                        return {
                            answerKey: 'philosophy:' + questionId + ':' + (letter || String(answerIndex + 1)),
                            answerText,
                            inputType: config.inputType,
                            selected: Boolean(selectedByQuestion[questionId]?.has(letter)),
                            correct: false,
                            incorrect: false,
                            answerFingerprint: hashText(answerText || letter || String(answerIndex + 1))
                        };
                    })
                    .filter((answer) => answer.answerText);
                const answerTexts = answers.map((answer) => answer.answerText);
                const questionFingerprint = fingerprintQuestion(prompt, answerTexts);
                if (!prompt || answers.length === 0 || seenFingerprints.has(questionFingerprint)) {
                    return;
                }
                seenFingerprints.add(questionFingerprint);

                const question = {
                    questionKey: 'qv2_' + questionFingerprint,
                    prompt,
                    questionType: config.inputType === 'radio' ? 'single_choice' : 'multiple_choice',
                    questionFingerprint,
                    parserSource: 'openedu_parser_philosophy_test',
                    parseConfidence: 0,
                    rawType: 'philosophy_test',
                    problemId,
                    answers,
                    sourceFrame
                };
                question.parseConfidence = confidenceFor(question);
                result.push(question);
            });
        });

        return result;
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
            child.__PARAMEXT_RAW_CONTENT = raw;
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
        clone.querySelectorAll('input[type="text"], textarea, select').forEach((node) => {
            node.replaceWith((clone.ownerDocument || document).createTextNode(' ____ '));
        });
        clone.querySelectorAll([
            'script',
            'style',
            'button',
            '[data-moodush-extension]',
            '[data-moodush-openedu-debug]',
            '.moodush-openedu-debug-label',
            '.moodush-openedu-inline-menu',
            '.moodush-openedu-inline-popover',
            '.moodush-openedu-wand-toggle',
            '.moodush-openedu-stick',
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
        const questions = buildDragQuestions(doc, options);
        buildPhilosophyTestQuestions(doc, options).forEach((question) => {
            questions.push(question);
        });
        questions.forEach((question) => {
            seen.add(question.questionFingerprint || question.questionKey);
        });

        roots.forEach((block, index) => {
            if (block.querySelector('table.drag-table, table.answerPlaceStudent') && block.querySelector('.dragAnswer[id]')) {
                return;
            }
            if (isPhilosophyTestInputBlock(block)) {
                return;
            }
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
                    selected: isInputSelected(input),
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
