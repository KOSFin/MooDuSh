/* Pure workflow policy shared by the content script and tests. */
(function (root) {
    function attempts(state) {
        const text = String(state.text || '').replace(/\s+/g, ' ');
        let used = state.used === null || state.used === undefined || state.used === '' ? NaN : Number(state.used);
        let max = state.max === null || state.max === undefined || state.max === '' ? NaN : Number(state.max);
        const match = text.match(/(?:used|использовано|использовали|попыток|attempts?)\D{0,35}(\d+)\s*(?:из|of|\/)\s*(\d+)/i)
            || text.match(/(\d+)\s*(?:из|of|\/)\s*(\d+)\s*(?:попыт|attempt)/i);
        if (match) { used = Number(match[1]); max = Number(match[2]); }
        return {
            used: Number.isFinite(used) ? used : null,
            max: Number.isFinite(max) ? max : null,
            exhausted: state.closed === true || (Number.isFinite(max) && max > 0 && used >= max)
                || /(?:no attempts remaining|attempts exhausted|попытки исчерпаны|не осталось попыток|осталось\s*0\s*попыт)/i.test(text)
        };
    }
    function parseResponse(raw, keys, questions = []) {
        const value = String(raw || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
        const parsed = JSON.parse(value);
        if (!Array.isArray(parsed.answers)) throw new Error('AI must return an answers array');
        const allowed = new Set(keys);
        const seen = new Set();
        const normalized = text => String(text || '').replace(/\s+/g, ' ').trim();
        const matchesChoices = (entry, question) => entry.answers.length > 0 && question.type !== 'text_input'
            && entry.answers.every(answer => (question.options || []).some(option => option.inputType !== 'text'
                && (!answer.answerKey || normalized(answer.answerKey) === normalized(option.answerKey))
                && (!answer.answerText || normalized(answer.answerText) === normalized(option.answerText))));
        const result = [];
        for (const entry of parsed.answers) {
            if (!entry || !Array.isArray(entry.answers)
                || entry.answers.some(a => !a || typeof a !== 'object'
                    || (typeof a.answerText !== 'string' && typeof a.answerKey !== 'string')
                    || (!normalized(a.answerText) && !normalized(a.answerKey)))) {
                throw new Error('AI returned an empty or invalid answer entry');
            }
            const receivedKey = normalized(entry.questionKey);
            let question = questions.find(q => receivedKey === q.questionKey || receivedKey === q.responseKey);
            let key = question?.questionKey || receivedKey;
            if (!allowed.has(key)) {
                // Recover a mistyped hash only when the explicit prompt index AND
                // every chosen option identify exactly one requested question.
                const candidates = questions.filter(q => matchesChoices(entry, q));
                if (candidates.length === 1 && Number(entry.index) === candidates[0].index) {
                    question = candidates[0]; key = question.questionKey;
                } else throw new Error('AI returned an unknown question ID: ' + receivedKey
                    + '; expected: ' + questions.map(q => q.responseKey || q.questionKey).join(', '));
            }
            if (question && entry.index != null && Number(entry.index) !== question.index) {
                throw new Error('AI question ID and index disagree: ' + receivedKey);
            }
            if (seen.has(key)) throw new Error('AI returned duplicate answers for question: ' + key);
            seen.add(key);
            if (entry.answers.length) result.push({ ...entry, questionKey: key });
        }
        const missing = keys.filter(key => !result.some(entry => entry.questionKey === key));
        if (missing.length) {
            const labels = missing.map(key => questions.find(q => q.questionKey === key)?.responseKey || key);
            const error = new Error('AI omitted usable answers for questions: ' + labels.join(', '));
            error.missingQuestionKeys = missing;
            error.partialAnswers = result;
            throw error;
        }
        return result;
    }
    function classify(doc) {
        if (doc.querySelector('[data-problem-id], .problems-wrapper, .xblock-student_view-problem')) return 'test';
        if (doc.querySelector('video, .video, .xblock-student_view-video, [data-block-type="video"]')) return 'video';
        if (doc.querySelector('.xblock-student_view-html, [data-block-type="html"], .vert .xblock .html')) return 'theory';
        return 'unknown';
    }
    const api = { attempts, parseResponse, classify };
    root.ParamExtOpeneduAi = api;
    if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
