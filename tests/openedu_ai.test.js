const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const ai = require('../js/openedu_ai.js');

test('attempt budgets support English and Russian and never treat unknown as exhausted', () => {
    for (const text of ['You have used 2 of 2 attempts', 'Вы использовали 2 из 2 попыток', '2 из 2 попыток']) {
        assert.equal(ai.attempts({ text }).exhausted, true);
    }
    assert.equal(ai.attempts({ text: 'Вы использовали 1 из 2 попыток' }).exhausted, false);
    assert.equal(ai.attempts({ used: 3, max: 3 }).exhausted, true);
    assert.equal(ai.attempts({ used: 10, max: 0 }).exhausted, false); // CAPA unlimited
    assert.equal(ai.attempts({}).exhausted, false);
    assert.equal(ai.attempts({ closed: true }).exhausted, true);
});

test('strict answer validation rejects partial, duplicate and foreign question replies', () => {
    const a = { questionKey: 'a', answers: [{ answerText: '0' }] };
    const b = { questionKey: 'b', answers: [{ answerKey: 'choice_1' }] };
    assert.deepEqual(ai.parseResponse('```json\n' + JSON.stringify({ answers: [a, b] }) + '\n```', ['a', 'b']), [a, b]);
    for (const entries of [[a], [a, a], [a, { ...b, questionKey: 'other' }], [{ ...a, answers: [] }, b]]) {
        assert.throws(() => ai.parseResponse(JSON.stringify({ answers: entries }), ['a', 'b']));
    }
    assert.throws(() => ai.parseResponse('{"answers":', ['a']));
});

test('tests take priority over video/theory, unknown content is never skipped', () => {
    const doc = (...types) => ({ querySelector: selector => types.some(type => selector.includes(type)) ? {} : null });
    assert.equal(ai.classify(doc('data-problem-id', 'video')), 'test');
    assert.equal(ai.classify(doc('video')), 'video');
    assert.equal(ai.classify(doc('xblock-student_view-html')), 'theory');
    assert.equal(ai.classify(doc()), 'unknown');
});

test('ChatGPT setting survives normalization', () => {
    const context = { window: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/platform_settings.js'), 'utf8'), context);
    const api = context.ParamExtSettings;
    assert.ok(api);
    assert.equal(api.DEFAULT_SETTINGS.openedu.missingAnswerAction, 'stop');
    assert.equal(api.normalizeSettings({ openedu: { missingAnswerAction: 'chatgpt' } }).openedu.missingAnswerAction, 'chatgpt');
});

function workflow(questions, replies, grade) {
    const document = { getElementById: () => null };
    const requests = [], submissions = [], applications = [];
    const q = questions.map((spec, i) => {
        const button = { disabled: false, getAttribute: name => name === 'aria-disabled' ? 'false' : 'True' };
        const container = {
            getAttribute(name) { return name === 'data-attempts-used' ? String(item.used) : name === 'data-max-attempts' ? String(item.max) : null; },
            querySelector(selector) { return selector === '.submit' ? button : null; }
        };
        const root = {
            closest: () => container,
            querySelector: () => item.graded && !item.correct ? {} : null
        };
        const item = { questionKey: String(i + 1), ownerDocument: document, root, used: 0, max: 3, correct: false, ...spec };
        return item;
    });
    const context = {
        document, location: { href: 'https://courses.openedu.ru/test' },
        settings: { openedu: { missingAnswerAction: 'chatgpt' } },
        isOpeneduAutoSolveMode: () => true,
        parseQuestions: () => q,
        locateQuestionBlock: item => item.root,
        getQuestionProblemContainer: item => item.root.closest(),
        findQuestionByReference: (list, reference) => list.find(q => q.questionKey === reference.questionKey || (reference.domId && q.domId === reference.domId)),
        isTopFrame: true, iframeQuestionsCache: [], lastRenderedQuestions: [],
        getAutoAnswerCandidates: () => [],
        buildAiPromptText: items => JSON.stringify(items.map(({ question }) => ({ questionKey: question.questionKey }))),
        questionAllowsMultipleAnswers: () => false,
        normalizeImportedAnswerList: entry => entry.answers,
        requestApplyAnswers: (question, answers) => { applications.push(question.questionKey); question.applied = answers; return true; },
        areAnswersAppliedToQuestion: () => true,
        getProblemAutoKey: item => item.questionKey,
        setStickOnline() {},
        chrome: { runtime: { onMessage: { addListener() {} } } },
        window: { ParamExtOpeneduAi: ai },
        crypto: require('node:crypto').webcrypto, setTimeout: callback => { queueMicrotask(callback); return 0; }, clearTimeout,
        console
    };
    vm.createContext(context);
    const content = fs.readFileSync(require.resolve('../js/openedu_content.js'), 'utf8');
    const snippet = content.slice(content.indexOf('    let aiRun = null;'), content.indexOf('    function runOpeneduAutoActions('));
    vm.runInContext(snippet, context);
    context.requestMock = async prompt => { requests.push(prompt); return replies.shift(); };
    context.submitMock = async item => { submissions.push(item.questionKey); const live = q.find(current => current.questionKey === item.questionKey || (item.domId && current.domId === item.domId)); live.used++; grade(live); };
    const request = vm.runInContext('requestChatgptOnce', context);
    vm.runInContext('requestChatgpt = requestMock; submitAiProblem = submitMock;', context);
    return { context, q, requests, submissions, applications, request, run: () => vm.runInContext('solveWithChatgpt(aiSectionKey(aiLocalQuestions()), {})', context) };
}
const reply = (...keys) => JSON.stringify({ answers: keys.map(questionKey => ({ questionKey, answers: [{ answerText: 'answer' }] })) });

test('workflow submits, retries only eligible wrong questions, and omits exhausted questions from feedback', async () => {
    const w = workflow([{ max: 1 }, {}, { correct: true }], [reply('1', '2'), reply('2')], q => {
        q.graded = true;
        if (q.questionKey === '2' && q.used === 2) q.correct = true;
    });
    await w.run();
    assert.deepEqual(w.submissions, ['1', '2', '2']);
    assert.deepEqual(w.applications, ['1', '2', '2']);
    assert.equal(w.requests.length, 2);
    assert.ok(w.requests[1].includes('"wrong":["Q2"]'));
    assert.ok(!w.requests[1].includes('"questionKey":"1"'));
});

test('all exhausted problems cause neither AI requests nor submissions', async () => {
    const w = workflow([{ used: 2, max: 2 }, { correct: true }], [], () => {});
    await w.run();
    assert.equal(w.requests.length, 0);
    assert.equal(w.submissions.length, 0);
});

test('invalid or incomplete AI response spends no attempts', async () => {
    const w = workflow([{}, {}], [reply('1'), '{"answers":[]}', '{"answers":[]}'], () => {});
    await assert.rejects(w.run(), /omitted/);
    assert.equal(w.submissions.length, 0);
    assert.equal(w.applications.length, 0);
});

test('unconfirmed grading never triggers an automatic retry', async () => {
    const w = workflow([{}], [reply('1')], () => {});
    await assert.rejects(w.run(), /definite grade/);
    assert.equal(w.submissions.length, 1);
    assert.equal(w.requests.length, 1);
});

test('navigation while waiting for ChatGPT prevents applying or submitting stale answers', async () => {
    const w = workflow([{}], [], () => {});
    w.context.requestMock = async () => { w.context.location.href += '/next'; return reply('1'); };
    vm.runInContext('requestChatgpt = requestMock', w.context);
    await assert.rejects(w.run(), /page or mode changed/);
    assert.equal(w.submissions.length, 0);
    assert.equal(w.applications.length, 0);
});


test('AI acknowledgement errors report the actual extension failure', async () => {
    const w = workflow([{}], [], () => {});
    w.context.chrome.runtime.sendMessage = async () => ({ error_type: true, error_message: 'Bus.messageHandler isParcel ==> false' });
    await assert.rejects(w.request('prompt'), /Extension message routing failed: Bus.messageHandler isParcel/);
    w.context.chrome.runtime.sendMessage = async () => undefined;
    await assert.rejects(w.request('prompt'), /AI background did not acknowledge/);
    assert.equal(w.submissions.length, 0);
});

test('iframe workflow failures are forwarded to the visible outer course page', () => {
    const w = workflow([{}], [], () => {});
    const messages = [];
    w.context.isTopFrame = false;
    w.context.frameSyncId = 'question-frame';
    w.context.window.top = { postMessage: message => messages.push(message) };
    vm.runInContext("reportAiWorkflowStatus('LMS submit action is unavailable', true)", w.context);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, 'PARAMEXT_OPENEDU_AI_STATUS');
    assert.equal(messages[0].frameId, 'question-frame');
    assert.equal(messages[0].error, true);
    assert.match(messages[0].text, /submit action/);
});


test('CAPA question fingerprint changes do not invalidate a stable problem section', () => {
    const w = workflow([{ domId: 'problem-one::input-one' }], [], () => {});
    const before = vm.runInContext('aiSectionKey(aiLocalQuestions())', w.context);
    w.q[0].questionKey = 'new-fingerprint-after-answer';
    const after = vm.runInContext('aiSectionKey(aiLocalQuestions())', w.context);
    assert.equal(before, after);
});

test('grading can redraw a question fingerprint without losing the submitted question', async () => {
    const w = workflow([{ domId: 'problem-one::input-one' }], [reply('1')], q => {
        q.questionKey = 'graded-fingerprint'; q.correct = true; q.graded = true;
    });
    await w.run();
    assert.deepEqual(w.submissions, ['1']);
    assert.equal(w.requests.length, 1);
});


test('answer application may change fingerprints without aborting submission', async () => {
    const w = workflow([{ domId: 'problem-one::input-one' }], [reply('1')], q => { q.correct = true; q.graded = true; });
    w.context.requestApplyAnswers = () => { w.q[0].questionKey = 'after-native-choice-change'; return true; };
    await w.run();
    assert.deepEqual(w.submissions, ['1']);
});

test('a real change of the LMS problem container still rejects stale AI answers', async () => {
    const w = workflow([{}], [], () => {});
    let problemId = 'old-problem';
    w.context.document.querySelectorAll = () => [{ getAttribute: name => name === 'data-problem-id' ? problemId : null }];
    w.context.requestMock = async () => { problemId = 'new-problem'; return reply('1'); };
    vm.runInContext('requestChatgpt = requestMock', w.context);
    await assert.rejects(w.run(), /page or mode changed/);
    assert.equal(w.submissions.length, 0);
    assert.equal(w.applications.length, 0);
});

test('switching off ChatGPT mode still prevents applying a pending response', async () => {
    const w = workflow([{}], [], () => {});
    w.context.requestMock = async () => { w.context.settings.openedu.missingAnswerAction = 'stop'; return reply('1'); };
    vm.runInContext('requestChatgpt = requestMock', w.context);
    await assert.rejects(w.run(), /page or mode changed/);
    assert.equal(w.submissions.length, 0);
    assert.equal(w.applications.length, 0);
});

test('confirmed server score is sufficient when custom controls expose no grade markers', async () => {
    const w = workflow([{}], [reply('1')], () => {});
    w.context.submitMock = async item => { w.submissions.push(item.questionKey); return { success: 'submitted', currentScore: 1, totalPossible: 1 }; };
    vm.runInContext('submitAiProblem = submitMock', w.context);
    await w.run();
    assert.deepEqual(w.submissions, ['1']);
    assert.equal(vm.runInContext('aiSnapshot(aiLocalQuestions())[0].correct', w.context), true);
});

test('confirmed zero score is treated as incorrect and retried without status CSS', async () => {
    const w = workflow([{}], [reply('1'), reply('1')], () => {});
    w.context.submitMock = async item => {
        w.submissions.push(item.questionKey);
        return { success: 'submitted', currentScore: w.submissions.length === 1 ? 0 : 1, totalPossible: 1 };
    };
    vm.runInContext('submitAiProblem = submitMock', w.context);
    await w.run();
    assert.equal(w.submissions.length, 2);
    assert.equal(w.requests.length, 2);
});

test('per-input correct map distinguishes text subquestions in a partially wrong problem', () => {
    const w = workflow([{ options: [{ inputName: 'input_a' }] }, { options: [{ inputName: 'input_b' }] }], [], () => {});
    w.context.receipt = { correctMap: { a: { correctness: 'correct' }, b: { correctness: 'incorrect' } } };
    assert.equal(vm.runInContext('aiQuestionGrade(aiLocalQuestions()[0], receipt)', w.context), 'correct');
    assert.equal(vm.runInContext('aiQuestionGrade(aiLocalQuestions()[1], receipt)', w.context), 'incorrect');
});

test('each problem keeps its submission receipt when CAPA replaces roots and question fingerprints', async () => {
    const w = workflow([
        { domId: 'matching', options: [{ inputName: 'input_matching' }] },
        { domId: 'text', options: [{ inputName: 'input_text' }] }
    ], [reply('1', '2')], () => {});
    w.context.getProblemAutoKey = item => item.root.problemKey || item.domId;
    w.context.submitMock = async item => {
        w.submissions.push(item.domId);
        const index = w.q.findIndex(current => current.domId === item.domId);
        const next = { ...w.q[index], questionKey: 'redrawn-' + item.domId };
        w.q[index] = next;
        item.root.problemKey = 'detached-' + item.domId;
        return { success: 'submitted', currentScore: 1, totalPossible: 1 };
    };
    vm.runInContext('submitAiProblem = submitMock', w.context);
    await w.run();
    assert.deepEqual(w.submissions, ['matching', 'text']);
    assert.equal(w.requests.length, 1);
    assert.equal(vm.runInContext('aiSnapshot(aiLocalQuestions()).every(q => q.correct)', w.context), true);
});

const userReply = '{"answers":[{"index":3,"questionKey":"q2_f8b48aec7052c3def70094efcc05f5d4","answers":[{"answerKey":"1947483719","answerText":"Аферист"},{"answerKey":"890166878","answerText":"Шулер"},{"answerKey":"313354633","answerText":"Мошенник"}]},{"index":5,"questionKey":"q2_5081b09644027e592a96c74b30aa677b","answers":[{"answerKey":"561382872","answerText":"Умение видеть"}]}]}';

test('reported response is valid and exact original question IDs remain accepted', () => {
    const entries = JSON.parse(userReply).answers;
    assert.deepEqual(ai.parseResponse(userReply, entries.map(e => e.questionKey)), entries);
});

test('a mistyped hash can recover only with a unique choice match and matching prompt index', () => {
    const entries = JSON.parse(userReply).answers;
    const requested = entries.map(e => ({ questionKey: e.questionKey + '0', responseKey: 'Q' + e.index, index: e.index,
        type: 'multiple_choice', options: e.answers.map(a => ({ ...a, inputType: 'checkbox' })) }));
    const result = ai.parseResponse(userReply, requested.map(q => q.questionKey), requested);
    assert.deepEqual(result.map(e => e.questionKey), requested.map(q => q.questionKey));
    requested[1].index = 4;
    assert.throws(() => ai.parseResponse(userReply, requested.map(q => q.questionKey), requested), /unknown question ID/);
});

test('unknown text IDs or ambiguous choices cannot be reassigned by index alone', () => {
    const entries = JSON.parse(userReply).answers;
    const raw = JSON.stringify({ answers: [entries[1]] });
    const q = { questionKey: 'actual', responseKey: 'Q5', index: 5, type: 'text_input', options: entries[1].answers };
    assert.throws(() => ai.parseResponse(raw, ['actual'], [q]), /unknown question ID/);
    q.type = 'multiple_choice';
    assert.throws(() => ai.parseResponse(raw, ['actual', 'another'], [q, { ...q, questionKey: 'another', index: 6 }]), /unknown question ID/);
});

test('short prompt IDs map to internal keys before answers are applied', async () => {
    const w = workflow([{}, {}], [reply('Q1', 'Q2')], q => { q.correct = true; });
    await w.run();
    assert.deepEqual(w.applications, ['1', '2']);
    assert.ok(w.requests[0].includes('"questionKey":"Q1"'));
    assert.equal(w.requests[0].includes('"questionKey":"1"'), false);
});

test('OpenEdu result waiter outlasts the ten-minute generation and worker reservation', async () => {
    const w = workflow([{}], [], () => {});
    const timers = [];
    w.context.chrome.runtime.sendMessage = async () => ({ id: 'slow-job' });
    w.context.setTimeout = (callback, delay) => { timers.push({ callback, delay }); return timers.length; };
    const pending = w.request('prompt');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(timers[0].delay, 12 * 60 * 1000 + 5000);
    vm.runInContext("aiWaiters.get('slow-job').resolve('late response')", w.context);
    assert.equal(await pending, 'late response');
});

test('ChatGPT timeout settings persist and invalid values normalize', async () => {
    const storage = {};
    const context = { window: {}, chrome: { runtime: {}, storage: { local: {
        get(key, callback) { callback({ [key]: storage[key] }); },
        set(value, callback) { Object.assign(storage, value); callback(); }
    } } } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/platform_settings.js'), 'utf8'), context);
    const settings = context.ParamExtSettings;
    await settings.saveSettings({ openedu: { chatgptAnswerTimeoutMinutes: 25 } });
    assert.equal((await settings.getSettings()).openedu.chatgptAnswerTimeoutMinutes, 25);
    for (const [value, expected] of [[undefined, 10], ['', 10], ['bad', 10], [-5, 1], [200, 60]]) {
        assert.equal(settings.normalizeSettings({ openedu: { chatgptAnswerTimeoutMinutes: value } }).openedu.chatgptAnswerTimeoutMinutes, expected);
    }
});

test('configured timeout is sent to the worker and controls the OpenEdu waiter', async () => {
    const w = workflow([{}], [], () => {});
    w.context.settings.openedu.chatgptAnswerTimeoutMinutes = 25;
    const messages = [], timers = [];
    w.context.chrome.runtime.sendMessage = async message => { messages.push(message); return { id: 'configured' }; };
    w.context.setTimeout = (callback, delay) => { timers.push(delay); return timers.length; };
    const pending = w.request('prompt');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(messages[0].answerTimeoutMs, 25 * 60000);
    assert.equal(timers[0], 25 * 60000 + 125000);
    w.context.settings.openedu.chatgptAnswerTimeoutMinutes = 1;
    assert.equal(timers[0], 25 * 60000 + 125000, 'changing settings must not shorten an in-flight request');
    vm.runInContext("aiWaiters.get('configured').resolve('done')", w.context);
    assert.equal(await pending, 'done');
});

const incompleteReply = fs.readFileSync(require.resolve('./fixtures/chatgpt-incomplete-answers.json'), 'utf8');

test('reported twenty-question reply identifies the four empty questions and preserves the other sixteen', () => {
    const keys = Array.from({ length: 20 }, (_, i) => 'Q' + (i + 1));
    assert.throws(() => ai.parseResponse(incompleteReply, keys), error => {
        assert.deepEqual(error.missingQuestionKeys, ['Q3', 'Q4', 'Q10', 'Q20']);
        assert.equal(error.partialAnswers.length, 16);
        assert.match(error.message, /Q3, Q4, Q10, Q20/);
        return true;
    });
});

test('reported response requests only empty questions before applying or submitting any answer', async () => {
    const w = workflow(Array.from({ length: 20 }, () => ({})), [], q => { q.correct = true; });
    w.context.requestApplyAnswers = (question, answers) => {
        w.applications.push(question.questionKey);
        w.q.find(q => q.questionKey === question.questionKey).applied = answers;
        return true;
    };
    w.context.requestMock = async prompt => {
        w.requests.push(prompt);
        assert.equal(w.applications.length, 0, 'partial results must not touch the LMS yet');
        assert.equal(w.submissions.length, 0);
        return w.requests.length === 1 ? incompleteReply : reply('Q3', 'Q4', 'Q10', 'Q20');
    };
    vm.runInContext('requestChatgpt = requestMock', w.context);
    await w.run();
    assert.equal(w.requests.length, 2);
    for (const key of ['Q3', 'Q4', 'Q10', 'Q20']) assert.ok(w.requests[1].includes('"questionKey":"' + key + '"'));
    assert.equal(w.requests[1].includes('"questionKey":"Q1"'), false);
    assert.equal(w.applications.length, 20);
    assert.equal(w.submissions.length, 20);
    assert.equal(w.q[0].applied.length, 6, 'matching answer pairs must be preserved');
});

test('repeated empty answers stop after two correction requests without spending attempts', async () => {
    const raw = JSON.stringify({ answers: [{ questionKey: 'Q1', answers: [] }] });
    const w = workflow([{}], [raw, raw, raw], () => {});
    await assert.rejects(w.run(), /omitted usable answers.*Q1/);
    assert.equal(w.requests.length, 3);
    assert.equal(w.applications.length, 0);
    assert.equal(w.submissions.length, 0);
});


function installVisualTransport(w) {
    const content = fs.readFileSync(require.resolve('../js/openedu_content.js'), 'utf8');
    w.context.buildQuestionAiExport = items => items.map(({ question }) => question);
    vm.runInContext(content.slice(content.indexOf('    function buildAiPromptText('), content.indexOf('    async function copyTextToClipboard(')), w.context);
    vm.runInContext(content.slice(content.indexOf('    async function requestChatgpt('), content.indexOf('    function requestChatgptOnce(')), w.context);
    vm.runInContext('requestChatgptOnce = onceMock; captureAiPage = captureMock;', w.context);
}

test('every ChatGPT request captures the full page before sending the original prompt with its attachment', async () => {
    const w = workflow([{}], [], () => {});
    const attachments = [{ name: 'openedu-full-page.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=' }];
    const events = [];
    w.context.captureMock = async () => { events.push('capture'); return attachments; };
    w.context.onceMock = async (prompt, attachments) => {
        events.push('send');
        assert.equal(prompt, 'Questions plus grading feedback');
        assert.deepEqual(Array.from(attachments), attachments);
        return reply('Q1');
    };
    installVisualTransport(w);
    for (let i = 0; i < 5; i++) {
        assert.equal(await vm.runInContext('requestChatgpt("Questions plus grading feedback")', w.context), reply('Q1'));
    }
    assert.deepEqual(events, Array.from({ length: 5 }, () => ['capture', 'send']).flat());
});

test('a failed full-page capture never sends a text-only answer request', async () => {
    const w = workflow([{}], [], () => {});
    let sends = 0;
    w.context.captureMock = async () => { throw new Error('Screenshot unavailable'); };
    w.context.onceMock = async () => { sends++; return reply('Q1'); };
    installVisualTransport(w);
    await assert.rejects(vm.runInContext('requestChatgpt("Original")', w.context), /Screenshot unavailable/);
    assert.equal(sends, 0);
    assert.equal(w.applications.length, 0);
    assert.equal(w.submissions.length, 0);
});

test('error banner can restart the stopped section or route retry to the owning iframe', () => {
    const w = workflow([{}], [], () => {});
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('<body></body>');
    try {
        w.context.document = dom.window.document;
        w.q[0].ownerDocument = dom.window.document;
        w.context.lastMergedStatsByQuestion = {};
        let retries = 0;
        w.context.runChatgptAutoActions = () => { retries++; };
        vm.runInContext('aiStoppedSection = "stopped"; reportAiWorkflowStatus("Unreadable screenshot", true)', w.context);
        dom.window.document.querySelector('#moodush-ai-error button').click();
        assert.equal(retries, 1);
        assert.equal(vm.runInContext('aiStoppedSection', w.context), '');
        const messages = [];
        w.context.retryFrame = { postMessage: message => messages.push(message) };
        vm.runInContext('reportAiWorkflowStatus("Unreadable screenshot", true, retryFrame)', w.context);
        dom.window.document.querySelector('#moodush-ai-error button').click();
        assert.equal(messages[0].type, 'PARAMEXT_OPENEDU_AI_RETRY');
        assert.equal(retries, 1, 'a child-frame error must retry in the child, not top');
    } finally { dom.window.close(); }
});
