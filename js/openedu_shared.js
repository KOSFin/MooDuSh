(function (root) {
    let fingerprintPunctRe = null;
    try {
        fingerprintPunctRe = new RegExp('[^\\p{L}\\p{N}_\\s]', 'gu');
    } catch (_) {
        fingerprintPunctRe = /[^\w\s]/g;
    }

    const FNV64_OFFSET_A = 0xcbf29ce484222325n;
    const FNV64_OFFSET_B = 0x84222325cbf29ce4n;
    const FNV64_PRIME = 0x100000001b3n;

    function collapseWhitespace(value) {
        return String(value || '').replace(/\s+/g, ' ').trim();
    }

    const TEX_COMMANDS = {
        Alpha: 'Α',
        Beta: 'Β',
        Gamma: 'Γ',
        Delta: 'Δ',
        Epsilon: 'Ε',
        Zeta: 'Ζ',
        Eta: 'Η',
        Theta: 'Θ',
        Iota: 'Ι',
        Kappa: 'Κ',
        Lambda: 'Λ',
        Mu: 'Μ',
        Nu: 'Ν',
        Xi: 'Ξ',
        Omicron: 'Ο',
        Pi: 'Π',
        Rho: 'Ρ',
        Sigma: 'Σ',
        Tau: 'Τ',
        Upsilon: 'Υ',
        Phi: 'Φ',
        Chi: 'Χ',
        Psi: 'Ψ',
        Omega: 'Ω',
        alpha: 'α',
        beta: 'β',
        gamma: 'γ',
        delta: 'δ',
        epsilon: 'ε',
        varepsilon: 'ε',
        zeta: 'ζ',
        eta: 'η',
        theta: 'θ',
        vartheta: 'θ',
        iota: 'ι',
        kappa: 'κ',
        lambda: 'λ',
        mu: 'μ',
        nu: 'ν',
        xi: 'ξ',
        omicron: 'ο',
        pi: 'π',
        rho: 'ρ',
        sigma: 'σ',
        tau: 'τ',
        upsilon: 'υ',
        phi: 'φ',
        varphi: 'φ',
        chi: 'χ',
        psi: 'ψ',
        omega: 'ω',
        times: '×',
        cdot: '·',
        le: '≤',
        leq: '≤',
        ge: '≥',
        geq: '≥',
        neq: '≠',
        ne: '≠',
        pm: '±',
        infty: '∞'
    };

    function stripTexDelimiters(value) {
        let text = String(value || '');
        for (let i = 0; i < 3; i += 1) {
            const next = text
                .replace(/\\\(([\s\S]*?)\\\)/g, '$1')
                .replace(/\\\[([\s\S]*?)\\\]/g, '$1')
                .replace(/\$\$([\s\S]*?)\$\$/g, '$1')
                .replace(/(^|[^\w$])\$([^$\n]+)\$/g, '$1$2');
            if (next === text) {
                break;
            }
            text = next;
        }
        return text;
    }

    function unwrapTexCommandArguments(value) {
        let text = String(value || '');
        for (let i = 0; i < 4; i += 1) {
            const next = text
                .replace(/\\(?:text|mathrm|mathbf|mathit|mathsf|textrm)\s*\{([^{}]*)\}/g, '$1')
                .replace(/\{([^{}]*)\}/g, '$1');
            if (next === text) {
                break;
            }
            text = next;
        }
        return text;
    }

    function normalizeTexMathText(value) {
        let text = stripTexDelimiters(value);
        text = unwrapTexCommandArguments(text);
        text = text
            .replace(/\\[,;:! ]/g, ' ')
            .replace(/\\([A-Za-z]+)\b/g, (match, command) => TEX_COMMANDS[command] || command)
            .replace(/\\([{}()[\],.;:+\-*/=])/g, '$1')
            .replace(/\s+([)\],.;:])/g, '$1')
            .replace(/([([])\s+/g, '$1');
        return collapseWhitespace(text);
    }

    function normalizeText(value) {
        return collapseWhitespace(value).toLowerCase();
    }

    function escapeRegExp(value) {
        return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    const QUESTION_UI_PHRASES = [
        'Вставить популярные ответы похожего вопроса',
        'Вставить популярный ответ похожего вопроса',
        'Вставить правильные ответы',
        'Вставить правильный ответ',
        'Вставить популярные ответы',
        'Вставить популярный ответ',
        'Вставить ответы похожего вопроса',
        'Вставить ответ похожего вопроса',
        'Нет точных ответов, только похожие данные.',
        'Нет статистики по этому вопросу.',
        'Для этого вопроса пока нет своей статистики.',
        'Точный ответ для этого вопроса не найден.',
        'Показаны данные похожего вопроса.',
        'Похожий вопрос',
        'Этот вопрос',
        'MooDuSh OpenEdu',
        'MooDuSh',
        'Пока нет ответов.',
        'Ответы'
    ].sort((a, b) => b.length - a.length);

    const QUESTION_UI_RE = /(\|\*\~?\??|\?+\s*(?=MooDuSh|Вставить)|похож\.)/gi;

    function containsQuestionUiArtifact(value) {
        const text = String(value || '');
        if (QUESTION_UI_RE.test(text)) {
            QUESTION_UI_RE.lastIndex = 0;
            return true;
        }
        QUESTION_UI_RE.lastIndex = 0;
        return QUESTION_UI_PHRASES.some((phrase) => text.toLowerCase().includes(phrase.toLowerCase()));
    }

    function stripQuestionUiPhrases(value) {
        let text = String(value || '').replace(/[\u200b-\u200f\ufeff]/g, ' ');
        text = text.replace(QUESTION_UI_RE, ' ');
        QUESTION_UI_RE.lastIndex = 0;

        QUESTION_UI_PHRASES.forEach((phrase) => {
            text = text.replace(new RegExp(escapeRegExp(phrase), 'gi'), ' ');
        });

        return text;
    }

    function stripAnswerTextArtifacts(text, answerTexts) {
        let result = String(text || '');
        const answers = Array.isArray(answerTexts) ? answerTexts : [];
        const normalizedAnswers = [];
        const seen = new Set();

        answers.forEach((answerText) => {
            const answer = collapseWhitespace(answerText);
            const answerNorm = normalizeText(answer);
            if (!answer || answerNorm.length < 4 || seen.has(answerNorm)) {
                return;
            }
            seen.add(answerNorm);
            normalizedAnswers.push(answer);
        });

        normalizedAnswers
            .sort((a, b) => b.length - a.length)
            .forEach((answer) => {
                result = result.replace(
                    new RegExp(escapeRegExp(answer) + '\\s*\\d*(?=\\s|$|\\D)', 'giu'),
                    ' '
                );
            });

        return result;
    }

    function sanitizeQuestionPrompt(value, answerTexts) {
        const raw = normalizeTexMathText(value);
        if (!raw) {
            return '';
        }

        const hadUiArtifact = containsQuestionUiArtifact(raw);
        let text = stripQuestionUiPhrases(raw);

        const answers = Array.isArray(answerTexts) ? answerTexts : [];
        const answerHits = answers.reduce((count, answerText) => {
            const answer = collapseWhitespace(answerText);
            return answer && answer.length >= 4 && text.includes(answer) ? count + 1 : count;
        }, 0);
        const shouldStripAnswers = hadUiArtifact || answerHits >= 2 || (answerHits >= 1 && raw.length > 240);
        if (shouldStripAnswers) {
            text = stripAnswerTextArtifacts(text, answers);
        }

        text = text
            .replace(/\b(верно|неверно|правильно|неправильно|correct|incorrect|true|false)\s*:\s*/ig, '')
            .replace(/\s*\b(верно|неверно|правильно|неправильно|correct|incorrect|true|false)\b\s*$/ig, '')
            .replace(/\s+([?.!,;:])/g, '$1');
        if (shouldStripAnswers || hadUiArtifact) {
            text = text.replace(/(^|\s)\d+(?=\s|$)/g, ' ');
        }

        const cleaned = collapseWhitespace(text);
        return cleaned || raw;
    }

    function sanitizeAnswerText(value) {
        return normalizeTexMathText(stripQuestionUiPhrases(value))
            .replace(/\s+([?.!,;:])/g, '$1');
    }

    function normalizeFingerprintText(value) {
        return collapseWhitespace(String(value || '').replace(fingerprintPunctRe, '')).toLowerCase();
    }

    function hashHex64(input, offset) {
        let hash = offset;
        const source = String(input || '');
        for (let i = 0; i < source.length; i += 1) {
            hash ^= BigInt(source.charCodeAt(i));
            hash = BigInt.asUintN(64, hash * FNV64_PRIME);
        }
        return hash.toString(16).padStart(16, '0');
    }

    function hashHex128(input) {
        const source = String(input || '');
        return hashHex64('a|' + source, FNV64_OFFSET_A) + hashHex64('b|' + source, FNV64_OFFSET_B);
    }

    function buildQuestionFingerprint(prompt, answerTexts) {
        const safeAnswerTexts = Array.isArray(answerTexts) ? answerTexts : [];
        const promptNorm = normalizeFingerprintText(sanitizeQuestionPrompt(prompt, safeAnswerTexts));
        const normalizedAnswers = [];
        const seen = new Set();

        safeAnswerTexts.forEach((answerText) => {
            const answerNorm = normalizeFingerprintText(sanitizeAnswerText(answerText));
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

        return hashHex128(JSON.stringify({
            prompt: promptNorm,
            answers: normalizedAnswers
        }));
    }

    function buildStableQuestionKeyBase(payload) {
        const answerTexts = Array.isArray(payload?.answerTexts) ? payload.answerTexts : [];
        const prompt = sanitizeQuestionPrompt(String(payload?.prompt || ''), answerTexts);
        const choiceCount = Math.max(0, Number(payload?.choiceCount || 0));
        const textInputCount = Math.max(0, Number(payload?.textInputCount || 0));
        const allowsMultipleAnswers = Boolean(payload?.allowsMultipleAnswers);

        return 'q2_' + hashHex128(JSON.stringify({
            promptNorm: normalizeFingerprintText(prompt),
            questionFingerprint: buildQuestionFingerprint(prompt, answerTexts),
            choiceCount,
            textInputCount,
            allowsMultipleAnswers
        }));
    }

    function normalizeMediaSource(raw) {
        const value = collapseWhitespace(raw);
        if (!value) {
            return '';
        }

        try {
            const parsed = new URL(value, 'https://openedu.ru');
            return collapseWhitespace(parsed.pathname + (parsed.search || ''));
        } catch (_) {
            return value.replace(/^https?:\/\/[^/]+/i, '');
        }
    }

    function getMediaFileName(path) {
        const normalized = collapseWhitespace(path);
        if (!normalized) {
            return '';
        }

        const parts = normalized.split('/');
        return collapseWhitespace(parts[parts.length - 1] || '');
    }

    function buildMediaToken(item, index) {
        const kind = normalizeText(item?.kind || item?.tag || 'media') || 'media';
        const source = normalizeMediaSource(item?.src || item?.href || '');
        const title = collapseWhitespace(item?.title || item?.ariaLabel || item?.alt || '');
        const signature = collapseWhitespace(item?.signature || item?.fingerprint || '');
        const fileName = getMediaFileName(source);
        const primary = fileName || source || signature || title || ('item-' + String(index + 1));
        return title && title !== primary
            ? (kind + ':' + primary + ' | ' + title)
            : (kind + ':' + primary);
    }

    function deriveOptionAnswerText(payload) {
        const text = sanitizeAnswerText(payload?.text || '');
        if (text) {
            return text;
        }

        const labelled = sanitizeAnswerText(payload?.ariaLabel || payload?.title || '');
        if (labelled) {
            return labelled;
        }

        const mediaDescriptors = Array.isArray(payload?.mediaDescriptors) ? payload.mediaDescriptors : [];
        if (mediaDescriptors.length > 0) {
            return mediaDescriptors.map((item, index) => buildMediaToken(item, index)).join(' + ');
        }

        const inputValue = collapseWhitespace(payload?.inputValue || '');
        if (inputValue) {
            return inputValue;
        }

        return '';
    }

    function normalizeOptionList(options) {
        if (!Array.isArray(options)) {
            return [];
        }

        return options
            .map((option) => normalizeText(option?.answerText || ''))
            .filter(Boolean)
            .sort();
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

    function parsePythonishDataLiteral(source) {
        const raw = decodeHtmlEntities(String(source || '').trim());
        if (!raw) {
            return null;
        }

        try {
            return JSON.parse(raw);
        } catch (_) {
            // OpenEdu advanced components often put a Python-like literal into
            // data-initial-data: single-quoted strings plus True/False/None.
        }

        let json = '';
        let i = 0;
        while (i < raw.length) {
            const ch = raw[i];
            if (ch !== "'") {
                json += ch;
                i += 1;
                continue;
            }

            i += 1;
            let value = '';
            while (i < raw.length) {
                const inner = raw[i];
                if (inner === '\\' && i + 1 < raw.length) {
                    value += inner + raw[i + 1];
                    i += 2;
                    continue;
                }
                if (inner === "'") {
                    i += 1;
                    break;
                }
                value += inner;
                i += 1;
            }
            let decodedValue = value;
            try {
                decodedValue = JSON.parse('"' + value
                    .replace(/"/g, '\\"')
                    .replace(/\r/g, '\\r')
                    .replace(/\n/g, '\\n') + '"');
            } catch (_) {
                decodedValue = value;
            }
            json += JSON.stringify(decodedValue);
        }

        json = json
            .replace(/\bTrue\b/g, 'true')
            .replace(/\bFalse\b/g, 'false')
            .replace(/\bNone\b/g, 'null');

        try {
            return JSON.parse(json);
        } catch (_) {
            return null;
        }
    }

    function normalizeMatchingText(value) {
        return collapseWhitespace(String(value || '')
            .replace(/\.\s*\{[^{}]*\}/g, ' ')
            .replace(/\{[^{}]*\}/g, ' ')
            .replace(/[*_`~]/g, ' ')
            .replace(/(^|\s)\.(?=\s|$)/g, ' ')
            .replace(/\s+/g, ' '));
    }

    function matchingCellText(cell) {
        if (!cell || typeof cell !== 'object') {
            return '';
        }
        const values = Array.isArray(cell.value) ? cell.value : [];
        return normalizeMatchingText(values.join(' '));
    }

    function buildMatchingCellLabels(initialData) {
        const table = Array.isArray(initialData?.table) ? initialData.table : [];
        const labels = {};
        if (table.length === 0) {
            return labels;
        }

        const headerRow = Array.isArray(table[0]) ? table[0] : [];
        const hasHeaderRow = headerRow.length > 0
            && !headerRow.some((cell) => cell && !cell.isFixed && cell.id);
        const headerCells = hasHeaderRow ? headerRow : [];
        const startIndex = hasHeaderRow ? 1 : 0;

        table.forEach((row, rowIndex) => {
            if (!Array.isArray(row) || rowIndex < startIndex) {
                return;
            }

            row.forEach((cell, colIndex) => {
                if (!cell || typeof cell !== 'object' || cell.isFixed || !cell.id) {
                    return;
                }

                const rowFixed = row
                    .filter((candidate) => candidate && candidate.isFixed)
                    .map(matchingCellText)
                    .filter(Boolean);
                const columnHeader = headerCells.length > 0
                    ? matchingCellText(headerCells[colIndex])
                    : '';
                const parts = [];
                if (rowFixed.length > 0) {
                    parts.push(rowFixed.join(' | '));
                }
                if (columnHeader) {
                    parts.push(columnHeader);
                }
                labels[String(cell.id)] = parts.join(' / ') || ('Ячейка ' + String(rowIndex + 1) + ':' + String(colIndex + 1));
            });
        });

        return labels;
    }

    function normalizeMatchingAnswerValue(answerValue) {
        if (!answerValue) {
            return {};
        }
        if (typeof answerValue === 'string') {
            const parsed = parsePythonishDataLiteral(answerValue);
            return parsed && typeof parsed === 'object' ? parsed : {};
        }
        return typeof answerValue === 'object' ? answerValue : {};
    }

    function buildMatchingTablePairs(initialData, answerValue, includeCandidates) {
        const data = initialData && typeof initialData === 'object' ? initialData : {};
        const answerById = {};
        (Array.isArray(data.answers) ? data.answers : []).forEach((answer) => {
            const id = collapseWhitespace(answer?.id || '');
            const title = normalizeMatchingText(answer?.title || '');
            if (id && title) {
                answerById[id] = title;
            }
        });

        const cellLabels = buildMatchingCellLabels(data);
        const answerObject = normalizeMatchingAnswerValue(answerValue);
        const selectedMap = answerObject && typeof answerObject.answer === 'object'
            ? answerObject.answer
            : {};

        const pairs = [];
        Object.keys(cellLabels).forEach((cellId) => {
            const selectedIdsRaw = Array.isArray(selectedMap[cellId]) ? selectedMap[cellId] : [];
            const selectedIds = selectedIdsRaw.map((item) => collapseWhitespace(item)).filter(Boolean);
            selectedIds.forEach((answerId) => {
                const answerTitle = answerById[answerId] || answerId;
                pairs.push({
                    cellId,
                    answerId,
                    cellLabel: cellLabels[cellId],
                    answerTitle,
                    answerText: cellLabels[cellId] + ': ' + answerTitle,
                    selected: true
                });
            });

            if (includeCandidates && selectedIds.length === 0) {
                Object.keys(answerById).forEach((answerId) => {
                    pairs.push({
                        cellId,
                        answerId,
                        cellLabel: cellLabels[cellId],
                        answerTitle: answerById[answerId],
                        answerText: cellLabels[cellId] + ': ' + answerById[answerId],
                        selected: false
                    });
                });
            }
        });

        return pairs;
    }

    function matchesQuestionReference(candidate, reference) {
        if (!candidate || !reference) {
            return false;
        }

        const candidateKey = collapseWhitespace(candidate.questionKey);
        const referenceKey = collapseWhitespace(reference.questionKey);
        if (candidateKey && referenceKey && candidateKey === referenceKey) {
            return true;
        }

        const candidateDomId = collapseWhitespace(candidate.domId);
        const referenceDomId = collapseWhitespace(reference.domId);
        if (candidateDomId && referenceDomId && candidateDomId === referenceDomId) {
            return true;
        }

        const candidatePrompt = normalizeText(candidate.prompt);
        const referencePrompt = normalizeText(reference.prompt);
        if (!candidatePrompt || !referencePrompt || candidatePrompt !== referencePrompt) {
            return false;
        }

        const candidateOptions = normalizeOptionList(candidate.options);
        const referenceOptions = normalizeOptionList(reference.options);
        if (candidateOptions.length === 0 || referenceOptions.length === 0) {
            return true;
        }

        return candidateOptions.join('|') === referenceOptions.join('|');
    }

    function shouldRetainRenderedAnswers(state) {
        const questionCount = Math.max(0, Number(state?.questionCount || 0));
        if (questionCount > 0) {
            return false;
        }

        if (!state?.hadRenderedAnswers) {
            return false;
        }

        const msSinceLastMeaningfulQuestions = Math.max(0, Number(state?.msSinceLastMeaningfulQuestions || Number.MAX_SAFE_INTEGER));
        const msSinceLastSubmit = Math.max(0, Number(state?.msSinceLastSubmit || Number.MAX_SAFE_INTEGER));
        const transientGraceMs = Math.max(0, Number(state?.transientGraceMs || 8000));
        const submitGraceMs = Math.max(0, Number(state?.submitGraceMs || 15000));

        return msSinceLastMeaningfulQuestions <= transientGraceMs || msSinceLastSubmit <= submitGraceMs;
    }

    function shouldDelayAutoAdvanceForParsing(state) {
        const waitMs = Math.max(0, Number(state?.waitMs || 0));
        if (waitMs === 0) {
            return false;
        }

        const elapsedMs = Math.max(0, Number(state?.elapsedMs || 0));
        if (elapsedMs >= waitMs) {
            return false;
        }

        if (!state?.syncedAfterNavigation) {
            return true;
        }

        const questionCount = Math.max(0, Number(state?.questionCount || 0));
        if (questionCount === 0) {
            return false;
        }

        const answerEvidenceCount = Math.max(0, Number(state?.answerEvidenceCount || 0));
        return answerEvidenceCount < questionCount;
    }

    const api = {
        collapseWhitespace,
        normalizeText,
        normalizeTexMathText,
        normalizeFingerprintText,
        sanitizeQuestionPrompt,
        sanitizeAnswerText,
        normalizeMediaSource,
        deriveOptionAnswerText,
        buildQuestionFingerprint,
        buildStableQuestionKeyBase,
        matchesQuestionReference,
        shouldRetainRenderedAnswers,
        shouldDelayAutoAdvanceForParsing,
        parsePythonishDataLiteral,
        normalizeMatchingText,
        buildMatchingTablePairs
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (root && typeof root === 'object') {
        root.ParamExtOpeneduShared = api;
    }
})(typeof globalThis !== 'undefined' ? globalThis : this);
