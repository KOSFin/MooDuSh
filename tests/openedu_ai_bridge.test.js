const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function bridge(response, options = {}) {
    const posts = [], replies = [], rendered = [];
    let listener;
    let readinessCalls = 0;
    const button = { disabled: !!options.disabled, getAttribute: () => 'false' };
    const attributes = { 'data-moodush-submit-id': 'job', 'data-moodush-capa-id': 'job', 'data-url': '/courses/demo/problem/handler/xmodule_handler' };
    const values = {};
    const wrapper = {
        getAttribute: name => attributes[name],
        setAttribute: (name, value) => { attributes[name] = value; },
        querySelector(selector) {
            if (selector.startsWith('button.submit')) return button;
            return null;
        },
        parentElement: { querySelectorAll: () => [1] }
    };
    const el = { find: () => ({}), data(name, value) { if (arguments.length === 1) return values[name]; values[name] = value; return this; }, trigger() {} };
    function Problem() { rendered.push(values.content); }
    Problem.prototype.refreshAnswers = function () { this.answers = 'input_question=choice_1'; };
    Problem.prototype.forceUpdate = function () {};
    if (options.readiness) Problem.prototype.submitAnswersAndSubmitButton = function (bind) {
        assert.equal(bind, false, 'refresh must not register duplicate input handlers');
        readinessCalls++;
        button.disabled = !options.canSubmit;
    };
    const $ = () => el;
    $.postWithPrefix = (url, body, resolve) => {
        posts.push({ url, body });
        queueMicrotask(() => resolve(response));
        return { fail() {} };
    };
    const window = { jQuery: $, Problem: options.unsupported ? null : Problem, addEventListener: (name, fn) => { listener = fn; }, postMessage: message => replies.push(message) };
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/openedu_ai_bridge.js'), 'utf8'), {
        window, document: { querySelectorAll: () => [wrapper] }, location: { origin: 'https://courses.openedu.ru', href: 'https://courses.openedu.ru/test' }, URL
    });
    return { posts, replies, rendered, attributes, get readinessCalls() { return readinessCalls; }, run: (type = 'PARAMEXT_CAPA_SUBMIT') => listener({ source: window, data: { type, id: 'job', marker: 'job' } }) };
}

test('CAPA bridge serializes through its runtime and renders only a confirmed submission', async () => {
    const b = bridge({ success: 'incorrect', contents: '<div>Graded</div>', attempts_used: 1, current_score: 0, total_possible: 5, correct_map: { question: { correctness: 'incorrect' } } });
    await b.run();
    assert.equal(b.posts.length, 1);
    assert.equal(b.posts[0].url, 'https://courses.openedu.ru/courses/demo/problem/handler/xmodule_handler/problem_check');
    assert.equal(b.posts[0].body, 'input_question=choice_1');
    assert.equal(b.attributes['data-attempts-used'], 1);
    assert.equal(b.rendered[0], '<div>Graded</div>');
    assert.equal(b.replies[0].ok, true);
    assert.equal(b.replies[0].currentScore, 0);
    assert.equal(b.replies[0].totalPossible, 5);
    assert.equal(b.replies[0].correctMap.question.correctness, 'incorrect');
});

test('CAPA refusal cannot be mistaken for a submitted test', async () => {
    const b = bridge({ success: 'You have no attempts remaining' });
    await b.run();
    assert.equal(b.rendered.length, 0);
    assert.match(b.replies[0].error, /did not confirm/);
});

test('closed problems and unavailable CAPA runtimes cannot consume an attempt', async () => {
    for (const options of [{ disabled: true }, { unsupported: true }]) {
        const b = bridge(null, options);
        await b.run();
        assert.equal(b.posts.length, 0);
        assert.ok(b.replies[0].error);
    }
});


test('refresh invokes native readiness without posting or spending an attempt', async () => {
    const b = bridge(null, { readiness: true, canSubmit: true, disabled: true });
    await b.run('PARAMEXT_CAPA_REFRESH');
    assert.equal(b.readinessCalls, 1);
    assert.equal(b.posts.length, 0);
    assert.equal(b.replies[0].ok, true);
});

test('submission refreshes stale readiness before checking the submit action', async () => {
    const b = bridge({ success: 'correct', contents: '<div>correct</div>' }, { readiness: true, canSubmit: true, disabled: true });
    await b.run();
    assert.equal(b.readinessCalls, 1);
    assert.equal(b.posts.length, 1);
    assert.equal(b.replies[0].ok, true);
});

test('native readiness refusal never force-enables a closed problem', async () => {
    const b = bridge(null, { readiness: true, canSubmit: false, disabled: true });
    await b.run();
    assert.equal(b.readinessCalls, 1);
    assert.equal(b.posts.length, 0);
    assert.match(b.replies[0].error, /closed/);
});
