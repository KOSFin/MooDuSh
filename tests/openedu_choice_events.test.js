const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

function page(options = {}) {
    const dom = new JSDOM(`<!doctype html><body><div class="xblock-student_view-problem"><div class="problems-wrapper" id="problem_choices" data-problem-id="choices" data-url="/problem/handler/xmodule_handler">
      <div class="problem"><div class="wrapper-problem-response"><fieldset><legend>Select two choices.</legend><div class="choicegroup capa_inputtype" id="inputtype_choices_1">
        <input type="checkbox" id="input_choices_1_a" name="input_choices_1[]" value="a"><label for="input_choices_1_a">Alpha</label>
        <input type="checkbox" id="input_choices_1_b" name="input_choices_1[]" value="b"><label for="input_choices_1_b">Beta</label>
        <input type="checkbox" id="input_choices_1_c" name="input_choices_1[]" value="c"><label for="input_choices_1_c">Gamma</label>
      </div></fieldset></div></div>
      <button class="submit" disabled data-should-enable-submit-button="${options.exhausted ? 'False' : 'True'}">Отправить</button>
    </div></div></body>`, { url: 'https://courses.openedu.ru/xblock/choices', runScripts: 'outside-only' });
    const w = dom.window, refreshes = [], clicks = [];
    w.chrome = { runtime: { onMessage: { addListener() {} } } };
    w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 800, height: 30, top: 0, left: 0 });
    w.postMessage = message => refreshes.push(message);
    const button = w.document.querySelector('.submit');
    // CAPA registers readiness on click, as observed in the saved runtime.
    for (const input of w.document.querySelectorAll('input[type=checkbox]')) {
        input.addEventListener('click', () => {
            clicks.push(input.value);
            button.disabled = options.exhausted || !w.document.querySelector('input:checked');
        });
    }
    for (const file of ['platform_settings', 'openedu_shared', 'openedu_course_api', 'openedu_parser', 'openedu_ai', 'openedu_content']) {
        let code = fs.readFileSync(require.resolve('../js/' + file + '.js'), 'utf8');
        if (file === 'openedu_content') code = code.replace('    boot();', `settings = window.ParamExtSettings.normalizeSettings({ backend: { openedu: { apiToken: 'test' } }, openedu: { mode: 'assist' } });
            window.__test = { parseQuestions, requestApplyAnswers, areAnswersAppliedToQuestion, dispatchInputState, renderInlineWands };`);
        w.eval(code);
    }
    const question = w.__test.parseQuestions()[0];
    const answers = question.options.filter(option => ['Alpha', 'Beta'].includes(option.answerText));
    return { dom, w, button, clicks, refreshes, question, answers, apply: () => w.__test.requestApplyAnswers(question, answers, 'set-all') };
}

test('inserting multiple checked answers activates CAPA submit through its native click handlers', () => {
    const p = page();
    try {
        assert.equal(p.button.disabled, true);
        assert.equal(p.apply(), true);
        assert.deepEqual([...p.w.document.querySelectorAll('input:checked')].map(input => input.value), ['a', 'b']);
        assert.equal(p.button.disabled, false);
        assert.deepEqual(p.clicks, ['a', 'b']);
        assert.equal(p.w.__test.areAnswersAppliedToQuestion(p.question, p.answers), true);
        assert.ok(p.refreshes.some(message => message.type === 'PARAMEXT_CAPA_REFRESH'));
    } finally { p.dom.window.close(); }
});

test('reapplying checkbox answers does not toggle selected options off', () => {
    const p = page();
    try {
        p.apply(); p.apply();
        assert.deepEqual(p.clicks, ['a', 'b']);
        assert.equal(p.button.disabled, false);
        assert.deepEqual([...p.w.document.querySelectorAll('input:checked')].map(input => input.value), ['a', 'b']);
    } finally { p.dom.window.close(); }
});

test('inserting checkboxes cannot override an exhausted problem policy', () => {
    const p = page({ exhausted: true });
    try {
        p.apply();
        assert.equal(p.button.disabled, true);
    } finally { p.dom.window.close(); }
});

test('disabled checkbox inputs are not changed behind the LMS permission checks', () => {
    const p = page();
    try {
        const input = p.w.document.querySelector('input'); input.disabled = true;
        p.w.__test.dispatchInputState(input, true);
        assert.equal(input.checked, false);
        assert.deepEqual(p.clicks, []);
    } finally { p.dom.window.close(); }
});


test('answer popovers open explicitly one at a time and close on Escape', () => {
    const p = page();
    try {
        const second = p.w.document.querySelector('.problems-wrapper').cloneNode(true);
        second.id = 'problem_second'; second.setAttribute('data-problem-id', 'second');
        for (const input of second.querySelectorAll('input')) { input.id += '_second'; input.name += '_second'; }
        const inputs = [...second.querySelectorAll('input')];
        [...second.querySelectorAll('label')].forEach((label, index) => label.htmlFor = inputs[index].id);
        p.w.document.body.appendChild(second);
        const questions = p.w.__test.parseQuestions();
        p.w.__test.renderInlineWands({}, questions);
        const buttons = [...p.w.document.querySelectorAll('.moodush-openedu-inline-wand')];
        const panels = [...p.w.document.querySelectorAll('.moodush-openedu-inline-popover')];
        assert.equal(buttons.length, 2);
        assert.ok(panels.every(panel => panel.hidden));
        buttons[0].click(); assert.equal(panels.filter(panel => !panel.hidden).length, 1);
        buttons[1].click(); assert.equal(panels.filter(panel => !panel.hidden).length, 1);
        assert.equal(panels[0].hidden, true);
        p.w.document.dispatchEvent(new p.w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert.ok(panels.every(panel => panel.hidden));
        p.w.__test.renderInlineWands({}, p.w.__test.parseQuestions());
        assert.equal(p.w.document.querySelectorAll('.moodush-openedu-inline-menu').length, 2);
        assert.ok([...p.w.document.querySelectorAll('.moodush-openedu-inline-popover')].every(panel => panel.hidden));
    } finally { p.dom.window.close(); }
});
