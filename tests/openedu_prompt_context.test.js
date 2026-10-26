const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

function page(problems) {
    const body = problems.map((html, index) => `<div class="xblock-student_view-problem"><div class="problems-wrapper" data-url="/handler/${index}" data-problem-id="p${index}"><div class="problem">${html}</div><button class="submit">Отправить</button></div></div>`).join('');
    return pageHtml(body);
}

function pageHtml(body, asFrame = false) {
    const dom = new JSDOM('<!doctype html><body>' + body, { url: 'https://courses.openedu.ru/xblock/test', runScripts: 'outside-only' });
    const w = dom.window;
    w.chrome = { runtime: { onMessage: { addListener() {} } } };
    w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 800, height: 30, top: 0, left: 0 });
    for (const file of ['platform_settings', 'openedu_shared', 'openedu_course_api', 'openedu_parser', 'openedu_ai', 'openedu_capture_frames', 'openedu_content']) {
        let code = fs.readFileSync(require.resolve('../js/' + file + '.js'), 'utf8');
        if (file === 'openedu_content' && asFrame) code = code.replace('const isTopFrame = window === window.top;', 'const isTopFrame = false;');
        if (file === 'openedu_content') code = code.replace('    boot();', 'window.__test = { parseQuestions, buildQuestionAiExport, buildAiPromptText, captureAiPage, requestApplyAnswers, syncIframeStateToTop };');
        w.eval(code);
    }
    const questions = w.__test.parseQuestions();
    const items = questions.map((question, index) => ({ question, index }));
    return { dom, w, questions, export: () => w.__test.buildQuestionAiExport(items) };
}

const input = (id, value = '') => `<span class="textline"><input type="text" id="input_${id}" name="input_${id}" value="${value}"><span class="status incorrect">Неверно</span><p class="answer" id="answer_${id}">secret feedback</p></span>`;

test('AI export preserves the sentence on both sides of an inline blank instead of only its instruction', () => {
    const p = page([`<div class="wrapper-problem-response"><label class="problem-group-label" for="input_one">Вставьте пропущенное слово</label><div>Способность <strong>понимать</strong> чувства ${input('one', 'old wrong guess')} другого человека называется эмпатией.</div><p>Укажите термин в именительном падеже.</p></div>`]);
    try {
        assert.equal(p.questions.length, 1);
        const oldPrompt = p.questions[0].prompt, oldKey = p.questions[0].questionKey;
        const exported = p.export()[0];
        assert.match(exported.prompt, /Способность понимать чувства \[ANSWER 1\] другого человека называется эмпатией/);
        assert.ok(exported.prompt.includes('Укажите термин в именительном падеже.'));
        assert.ok(!exported.prompt.includes('old wrong guess'));
        assert.ok(!exported.prompt.includes('secret feedback'));
        assert.equal(exported.questionKey, oldKey);
        assert.equal(p.questions[0].prompt, oldPrompt);
        assert.equal(p.questions[0].questionKey, oldKey);
        assert.match(p.w.__test.buildAiPromptText([{ question: p.questions[0], index: 0 }]), /другого человека называется эмпатией/);
    } finally { p.dom.window.close(); }
});

test('multiple blanks retain the shared sentence and identify a different target for each question', () => {
    const p = page([`<div class="wrapper-problem-response"><p>Вставьте пропущенные слова</p><div>Общение бывает ${input('verbal')} и ${input('nonverbal')}, а интонация относится к паралингвистическим средствам.</div></div>`]);
    try {
        assert.equal(p.questions.length, 2);
        const exports = p.export();
        const first = exports.find(q => q.prompt.includes('Заполни только [ANSWER 1]'));
        const second = exports.find(q => q.prompt.includes('Заполни только [ANSWER 2]'));
        assert.ok(first); assert.ok(second);
        assert.match(first.prompt, /Общение бывает \[ANSWER 1\] и \[BLANK 2\], а интонация/);
        assert.match(second.prompt, /Общение бывает \[BLANK 1\] и \[ANSWER 2\], а интонация/);
    } finally { p.dom.window.close(); }
});

test('a blank prompt stays within its own LMS problem and excludes extension and grading UI', () => {
    const p = page([
        `<h3>Вставьте слово</h3><div class="problem-progress">0/1 points</div><div class="wrapper-problem-response"><p>Восприятие эмоций ${input('local')} связано с эмпатией.</p><div class="moodush-openedu-inline-menu">MooDuSh insert answers</div><div class="submission-feedback">attempts used</div></div>`,
        '<div class="wrapper-problem-response"><fieldset><legend>UNRELATED NEXT QUESTION</legend><input type="radio" name="choice" id="choice" value="a"><label for="choice">Option A</label></fieldset></div>'
    ]);
    try {
        const exported = p.export().find(q => q.prompt.includes('[ANSWER 1]'));
        assert.ok(exported);
        for (const noise of ['UNRELATED NEXT QUESTION', 'MooDuSh', 'secret feedback', '0/1 points', 'attempts used', 'Отправить']) assert.ok(!exported.prompt.includes(noise), noise);
    } finally { p.dom.window.close(); }
});

test('choice-only exports retain their existing prompt', () => {
    const p = page(['<div class="wrapper-problem-response"><fieldset><legend>Choose one</legend><input type="radio" name="choice" id="choice" value="a"><label for="choice">Alpha</label></fieldset></div>']);
    try { assert.equal(p.export()[0].prompt, p.questions[0].prompt); }
    finally { p.dom.window.close(); }
});

test('sentence paragraphs outside the narrow input wrapper are included', () => {
    const p = page([`<p>Эмпатия означает понимание чувств другого человека.</p><div class="wrapper-problem-response"><label class="problem-group-label" for="input_term">Вставьте пропущенное слово</label><div>${input('term')}</div></div><p>Назовите описанную способность одним словом.</p>`]);
    try {
        assert.equal(p.questions.length, 1);
        const prompt = p.export()[0].prompt;
        assert.match(prompt, /Эмпатия означает понимание чувств другого человека/);
        assert.match(prompt, /Назовите описанную способность одним словом/);
        assert.ok(prompt.includes('[ANSWER 1]'));
    } finally { p.dom.window.close(); }
});


test('prompt directs ChatGPT to the attached full page when text lacks visual context', () => {
    const p = page([]);
    try {
        const prompt = p.w.__test.buildAiPromptText([]);
        assert.match(prompt, /openedu-full-page.pdf/);
        assert.match(prompt, /ВСЕЙ страницы/);
        assert.match(prompt, /найди их на страницах приложенного PDF/);
        assert.ok(!prompt.includes('visual_context_request'));
        assert.ok(!prompt.includes('questionKeys'));
        assert.match(prompt, /"answers"/);
    } finally { p.dom.window.close(); }
});

function capturePage(width = 1600, height = 1500) {
    const p = page(['<fieldset><legend>Read the chart</legend><input type="radio" name="choice" id="choice" value="a"><label for="choice">Alpha</label></fieldset>']);
    const w = p.w, crops = [], captures = [], canvases = [];
    w.setTimeout = callback => { queueMicrotask(callback); return 0; };
    Object.defineProperties(w, { innerWidth: { value: 800 }, innerHeight: { value: 500 }, devicePixelRatio: { value: 2 } });
    Object.defineProperties(w.document.documentElement, { scrollWidth: { value: width }, scrollHeight: { value: height } });
    w.scrollTo = ({ top, left }) => { w.scrollY = Math.max(0, Math.min(height - 500, top)); w.scrollX = Math.max(0, Math.min(width - 800, left)); };
    w.scrollTo({ top: 70, left: 50 });
    w.Image = class {
        constructor() { this.naturalWidth = 1600; this.naturalHeight = 1000; }
        set src(value) { queueMicrotask(() => this.onload()); }
    };
    w.HTMLCanvasElement.prototype.getContext = function () { canvases.push(this); return { drawImage(...args) { crops.push(args.slice(1)); } }; };
    w.ParamExtOpeneduPagePdf = { async create() { return { name: 'openedu-full-page.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=' }; } };
    w.chrome.runtime.sendMessage = async message => { captures.push(message); return { dataUrl: 'data:image/png;base64,YQ==' }; };
    return { ...p, crops, captures, canvases };
}

test('the entire page is stitched horizontally and vertically for one lossless PDF at device resolution', async () => {
    const p = capturePage();
    try {
        const images = await p.w.__test.captureAiPage();
        assert.equal(images.length, 1);
        assert.equal(images[0].name, 'openedu-full-page.pdf');
        assert.equal(p.captures.length, 12);
        assert.equal(p.canvases[0].width, 3200);
        assert.equal(p.canvases[0].height, 3000);
        assert.equal(p.crops.reduce((area, crop) => area + crop[6] * crop[7], 0), 3200 * 3000, 'all page pixels are covered exactly once');
        assert.equal(p.crops[0][2], 1440, '720 CSS pixels are copied at native 2x device scale');
        assert.equal(p.w.scrollY, 70);
        assert.equal(p.w.scrollX, 50);
    } finally { p.dom.window.close(); }
});

test('long full-page captures have no twelve-tile limit', async () => {
    const p = capturePage(800, 6500);
    try {
        const images = await p.w.__test.captureAiPage();
        assert.equal(images.length, 1);
        assert.ok(p.captures.length > 12);
        assert.equal(p.canvases[0].height, 13000);
        assert.equal(p.crops.reduce((area, crop) => area + crop[6] * crop[7], 0), 1600 * 13000);
    } finally { p.dom.window.close(); }
});

test('failed full-page capture restores course scrolling and does not return a partial image', async () => {
    const p = capturePage();
    try {
        p.w.chrome.runtime.sendMessage = async () => ({ error: 'capture unavailable' });
        await assert.rejects(p.w.__test.captureAiPage(), /capture unavailable/);
        assert.equal(p.w.scrollY, 70);
        assert.equal(p.w.scrollX, 50);
    } finally { p.dom.window.close(); }
});

test('a clipped course frame fails instead of sending an incomplete PDF and restores scrolling', async () => {
    const p = capturePage();
    try {
        const request = p.w.ParamExtOpeneduCaptureFrames.request;
        p.w.ParamExtOpeneduCaptureFrames.request = async (session, action, payload) => {
            const value = await request(session, action, payload);
            if (action === 'map') value.localRect = { ...value.localRect, right: value.localRect.right - 20 };
            return value;
        };
        await assert.rejects(p.w.__test.captureAiPage(), /clipped by its course frame/);
        assert.equal(p.captures.length, 0);
        assert.equal(p.w.scrollY, 70);
        assert.equal(p.w.scrollX, 50);
    } finally { p.dom.window.close(); }
});

const inlineSentenceFixture = fs.readFileSync(require.resolve('./fixtures/openedu-inline-sentence-blanks.html'), 'utf8');

test('reported inline blanks preserve the full sentences in parsed questions and AI export', () => {
    const p = pageHtml(inlineSentenceFixture);
    try {
        assert.equal(p.questions.length, 2);
        assert.equal(p.questions[0].prompt, 'Основная причина мозгового штурма – создание [ANSWER 1] количества идей за относительно короткий промежуток времени.');
        assert.equal(p.questions[1].prompt, 'Используйте [ANSWER 1] идеи, если работа команды в мозговом штурме сломалась.');
        assert.ok(p.questions.every(question => question.questionType === 'text_input' && question.parseConfidence >= 0.9));
        const exported = p.export();
        for (let i = 0; i < p.questions.length; i++) {
            assert.ok(exported[i].prompt.includes(p.questions[i].prompt));
            assert.equal(exported[i].questionKey, p.questions[i].questionKey);
            for (const noise of ['font-size', 'нет ответа', 'Сохранить', 'Отправить', 'использовали 0']) {
                assert.ok(!p.questions[i].prompt.includes(noise), noise);
                assert.ok(!exported[i].prompt.includes(noise), noise);
            }
        }
        assert.ok(!p.questions[0].prompt.includes('Используйте'));
        assert.ok(!p.questions[1].prompt.includes('Основная причина'));
    } finally { p.dom.window.close(); }
});

test('unrelated inline sentences have independent keys when another question is removed', () => {
    const p = pageHtml(inlineSentenceFixture);
    try {
        const [first, second] = p.questions;
        assert.notEqual(first.questionKey, second.questionKey);
        assert.notEqual(first.questionFingerprint, second.questionFingerprint);
        first.root.closest('.problems-wrapper').remove();
        const remaining = p.w.__test.parseQuestions();
        assert.equal(remaining.length, 1);
        assert.equal(remaining[0].questionKey, second.questionKey);
        assert.equal(remaining[0].questionFingerprint, second.questionFingerprint);
    } finally { p.dom.window.close(); }
});

test('inline prompt and identity ignore user values, hidden solutions, grading and extension UI', () => {
    const p = pageHtml(inlineSentenceFixture);
    try {
        const input = p.w.document.querySelector('input[type="text"]');
        input.value = 'OLD USER GUESS';
        input.setAttribute('value', 'OLD USER GUESS');
        const scope = input.closest('.inline-input-task');
        scope.querySelector('.solution-span').textContent = 'HIDDEN SOLUTION';
        scope.querySelector('.trailing_text').textContent = 'HIDDEN TRAILING TEXT';
        scope.querySelector('.status').textContent = 'NEW GRADING FEEDBACK';
        const widget = p.w.document.createElement('span');
        widget.className = 'moodush-openedu-inline-menu'; widget.textContent = 'MooDuSh EXISTING ANSWER';
        scope.prepend(widget);
        const reparsed = p.w.__test.parseQuestions();
        assert.equal(reparsed[0].prompt, p.questions[0].prompt);
        assert.equal(reparsed[0].questionKey, p.questions[0].questionKey);
        const exported = p.w.__test.buildQuestionAiExport(reparsed.map((question, index) => ({ question, index })));
        for (const noise of ['OLD USER GUESS', 'HIDDEN SOLUTION', 'HIDDEN TRAILING TEXT', 'NEW GRADING FEEDBACK', 'EXISTING ANSWER']) {
            assert.ok(!exported[0].prompt.includes(noise), noise);
        }
    } finally { p.dom.window.close(); }
});

test('inline multi-blank sentences identify each target in the parsed question itself', () => {
    const p = page([`<p>Вставьте пропущенные слова</p><div class="inline-input-task"><span>Генерация идей направлена на создание гибкого (за счет <div class="wrapper-problem-response">${input('first')}</div>) и плавного (за счет <div class="wrapper-problem-response">${input('second')}</div>) инновационного процесса.</span></div>`]);
    try {
        assert.equal(p.questions.length, 2);
        assert.match(p.questions[0].prompt, /гибкого \(за счет \[ANSWER 1\]\) и плавного \(за счет \[BLANK 2\]\)/);
        assert.match(p.questions[1].prompt, /гибкого \(за счет \[BLANK 1\]\) и плавного \(за счет \[ANSWER 2\]\)/);
        assert.notEqual(p.questions[0].questionKey, p.questions[1].questionKey);
    } finally { p.dom.window.close(); }
});

test('data-content fallback preserves inline sentences before live controls render', () => {
    const fixture = new JSDOM(inlineSentenceFixture);
    const hosts = [...fixture.window.document.querySelectorAll('.problems-wrapper')];
    for (const host of hosts) { host.setAttribute('data-content', host.innerHTML); host.replaceChildren(); }
    const p = pageHtml(fixture.window.document.body.innerHTML);
    try {
        assert.equal(p.questions.length, 2);
        assert.ok(p.questions.every(question => question.fromVirtualContent));
        assert.match(p.questions[0].prompt, /создание \[ANSWER 1\] количества идей/);
        assert.match(p.questions[1].prompt, /Используйте \[ANSWER 1\] идеи, если работа команды/);
        assert.ok(p.export().every(question => question.prompt.includes('[ANSWER 1]')));
    } finally { p.dom.window.close(); fixture.window.close(); }
});

const inlineSelectFixture = fs.readFileSync(require.resolve('./fixtures/openedu-inline-selects.html'), 'utf8');

test('dropdown instructions do not create the reported empty Q9/Q14 phantom questions', () => {
    const p = pageHtml(inlineSelectFixture);
    try {
        assert.equal(p.questions.length, 2, 'two dropdown tasks must produce exactly two questions');
        assert.ok(p.questions.every(question => question.questionType === 'select'));
        assert.ok(p.questions.every(question => question.options.length === 4));
        assert.ok(p.questions.every(question => question.options.every(option => option.inputType === 'select')));
        assert.equal(p.questions[0].prompt, 'Суть морфологического анализа – придумать максимальное количество решений для отдельных частей проекта, [ANSWER 1] их случайным образом.');
        assert.equal(p.questions[1].prompt, 'Бодисторминг основывается на изменении [ANSWER 1] вокруг пользователя.');
        const exported = p.export();
        assert.equal(exported.length, 2);
        assert.ok(exported.every(question => question.prompt && question.type === 'select'));
        assert.ok(exported.every(question => question.options.every(option => option.answerText !== 'Выберите правильный вариант ответа')));
        assert.ok(!exported[0].prompt.includes('Бодисторминг'));
        assert.ok(!exported[1].prompt.includes('морфологического'));
    } finally { p.dom.window.close(); }
});

test('dropdown answers still apply to native controls after removing phantom instruction questions', () => {
    const p = pageHtml(inlineSelectFixture);
    try {
        for (const question of p.questions) {
            const option = question.options[1];
            assert.equal(p.w.__test.requestApplyAnswers(question, [{ answerKey: option.answerKey, answerText: option.answerText }], 'set-all'), true);
            assert.equal(p.w.document.getElementById(option.inputId).value, option.inputValue);
        }
        const reparsed = p.w.__test.parseQuestions();
        assert.equal(reparsed.length, 2);
        assert.deepEqual(Array.from(reparsed, question => question.prompt), Array.from(p.questions, question => question.prompt));
        assert.deepEqual(Array.from(reparsed, question => question.questionKey), Array.from(p.questions, question => question.questionKey));
    } finally { p.dom.window.close(); }
});

test('generic wording remains a real answer when its label is paired with a radio input', () => {
    const p = page(['<fieldset><legend>Which sentence is an instruction?</legend><input type="radio" id="instruction" name="choice" value="a"><label for="instruction">Выберите правильный вариант ответа</label><input type="radio" id="answer" name="choice" value="b"><label for="answer">Другое предложение</label></fieldset>']);
    try {
        assert.equal(p.questions.length, 1);
        assert.equal(p.questions[0].options.length, 2);
        assert.equal(p.questions[0].options[0].answerText, 'Выберите правильный вариант ответа');
    } finally { p.dom.window.close(); }
});

test('inline dropdown sentences also parse from data-content before the live DOM is rendered', () => {
    const fixture = new JSDOM(inlineSelectFixture);
    for (const host of fixture.window.document.querySelectorAll('.problems-wrapper')) {
        host.setAttribute('data-content', host.innerHTML); host.replaceChildren();
    }
    const p = pageHtml(fixture.window.document.body.innerHTML);
    try {
        assert.equal(p.questions.length, 2);
        assert.ok(p.questions.every(question => question.fromVirtualContent && question.questionType === 'select'));
        assert.match(p.questions[0].prompt, /\[ANSWER 1\] их случайным образом/);
        assert.match(p.questions[1].prompt, /\[ANSWER 1\] вокруг пользователя/);
    } finally { p.dom.window.close(); fixture.window.close(); }
});

const mixedUnsupportedFixture = fs.readFileSync(require.resolve('./fixtures/openedu-mixed-unsupported.html'), 'utf8');

test('mixed-page export keeps matching/radio tasks and omits the unsupported simulator', () => {
    const p = pageHtml(mixedUnsupportedFixture);
    try {
        assert.equal(p.w.ParamExtOpeneduShared.findUnsupportedTasks(p.w.document).length, 1);
        assert.equal(p.questions.length, 2);
        assert.deepEqual(Array.from(p.questions, q => q.questionType), ['drag_table', 'single_choice']);
        assert.match(p.questions[1].prompt, /Ваша рабочая группа вынесла на итоговое обсуждение/);
        assert.ok(p.export().every(q => q.type !== 'unknown'));
        // Even if the simulator later mounts native choices, it must stay out
        // of the parser, prompt, and answer application workflow.
        p.w.document.querySelector('.jsinput').insertAdjacentHTML('beforeend', '<fieldset><legend>UNSUPPORTED SIMULATOR</legend><input type="radio" id="sim_choice" name="sim_choice"><label for="sim_choice">SIMULATOR ONLY ANSWER</label></fieldset>');
        const parsed = p.w.__test.parseQuestions();
        assert.equal(parsed.length, 2);
        const prompt = p.w.__test.buildAiPromptText(parsed.map((question, index) => ({ question, index })));
        assert.ok(!prompt.includes('UNSUPPORTED SIMULATOR'));
        assert.ok(!prompt.includes('SIMULATOR ONLY ANSWER'));
    } finally { p.dom.window.close(); }
});

test('iframe synchronization preserves supported question types and omits unsupported tasks', () => {
    const p = pageHtml(mixedUnsupportedFixture, true);
    const messages = [];
    p.w.top.postMessage = message => messages.push(message);
    try {
        p.w.__test.syncIframeStateToTop({}, p.questions, { online: true });
        const sync = messages.find(message => message.type === 'PARAMEXT_OPENEDU_QUESTIONS_SYNC');
        assert.ok(sync);
        assert.equal(sync.questions.length, 2);
        assert.deepEqual(Array.from(sync.questions, q => q.questionType), ['drag_table', 'single_choice']);
        assert.ok(sync.questions.every(q => q.questionFingerprint && q.parserSource && q.parseConfidence > 0));
        // A structured clone at the top page has no DOM references.
        const remote = JSON.parse(JSON.stringify(sync.questions));
        const exported = p.w.__test.buildQuestionAiExport(remote.map((question, index) => ({ question, index })));
        assert.deepEqual(Array.from(exported, q => q.type), ['drag_table', 'single_choice']);
        delete remote[0].questionType;
        assert.equal(p.w.__test.buildQuestionAiExport([{ question: remote[0], index: 0 }])[0].type, 'drag_table');
    } finally { p.dom.window.close(); }
});
