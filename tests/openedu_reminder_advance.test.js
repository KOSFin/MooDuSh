const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

function navigation({ chatgpt = false, saved = true, enabled = true, questions = [], ready = true, elapsed = 10000, running = false, action = 'solveSupported' } = {}) {
    const dom = new JSDOM('<div class="sequence-navigation-tabs"><button class="active">Task</button></div><iframe src="https://courses.openedu.ru/xblock/unit"></iframe>', { url: 'https://apps.openedu.ru/learning/course/demo' });
    let next = 0;
    const frame = dom.window.document.querySelector('iframe');
    const context = {
        document: dom.window.document, location: dom.window.location,
        window: { ParamExtOpeneduReminders: { hasSavedUnsupportedTask: () => saved }, ParamExtOpeneduAi: { classify: () => 'unknown' } },
        URL, Date: { now: () => 20000 }, isTopFrame: true,
        lastSequenceTabKey: 'current', lastSequenceNavigationAt: 20000 - elapsed,
        lastAutoAdvanceAt: 0, AUTO_ADVANCE_PARSE_WAIT_MS: 9000,
        shouldSkipUnsupportedPage: () => true,
        settings: { openedu: { unsupportedTaskAction: action, requiredCompletionOnly: true, activeTabRefreshEnabled: false, autoAdvanceDelayMs: 1800 } },
        getActiveSequenceTabKey: () => 'current', markSequenceNavigation() {},
        isChatgptAutoMode: () => chatgpt, isAutoAdvanceEnabled: () => enabled,
        aiRun: running ? {} : null, aiSnapshot: q => q, aiLocalQuestions: () => [], parseQuestions: () => [],
        topFrameIframeQuestions: questions,
        topFrameIframeSnapshots: new Map(ready ? [['frame', { source: frame.contentWindow, updatedAt: 20000, pageKind: 'unknown' }]] : []),
        isSequenceTabComplete: () => false,
        requestNextSequencePage: () => { next++; }
    };
    const content = fs.readFileSync(require.resolve('../js/openedu_content.js'), 'utf8');
    const code = content.slice(content.indexOf('    function maybeClickNextOnSequencePage()'), content.indexOf('    function installPageMonitors()'));
    vm.runInNewContext(code, context);
    return { run: () => { context.maybeClickNextOnSequencePage(); return next; }, close: () => dom.window.close() };
}

for (const chatgpt of [false, true]) {
    test(`${chatgpt ? 'ChatGPT' : 'regular'} auto mode advances past a saved unsupported task despite completion-only setting`, () => {
        const p = navigation({ chatgpt });
        try { assert.equal(p.run(), 1); } finally { p.close(); }
    });
    test(`${chatgpt ? 'ChatGPT' : 'regular'} mode waits for supported questions sharing the section`, () => {
        const p = navigation({ chatgpt, questions: [{ correct: false }] });
        try { assert.equal(p.run(), 0); } finally { p.close(); }
        const done = navigation({ chatgpt, questions: [{ correct: true }] });
        try { assert.equal(done.run(), 1); } finally { done.close(); }
    });
    test(`${chatgpt ? 'ChatGPT' : 'regular'} mode does not skip unknown content without a saved reminder`, () => {
        const p = navigation({ chatgpt, saved: false });
        try { assert.equal(p.run(), 0); } finally { p.close(); }
    });
}
for (const options of [{ enabled: false }, { ready: false }, { elapsed: 1000 }, { running: true }]) {
    test('reminder skip respects readiness, delay, active work and auto-advance settings: ' + JSON.stringify(options), () => {
        const p = navigation(options);
        try { assert.equal(p.run(), 0); } finally { p.close(); }
    });
}

test('saved unsupported tasks do not trigger repeated empty-section refreshes', () => {
    const content = fs.readFileSync(require.resolve('../js/openedu_content.js'), 'utf8');
    const start = content.indexOf('    function refreshActiveSequenceTabForEmptySection(');
    const end = content.indexOf('\n    function ', start + 10);
    const context = { window: { ParamExtOpeneduReminders: { hasSavedUnsupportedTask: () => true } } };
    vm.runInNewContext(content.slice(start, end), context);
    assert.doesNotThrow(() => context.refreshActiveSequenceTabForEmptySection('test'));
});

for (const chatgpt of [false, true]) {
    test(`${chatgpt ? 'ChatGPT' : 'regular'} skip-page mode advances without solving supported questions after saving a reminder`, () => {
        const p = navigation({ chatgpt, action: 'skipPage', questions: [{ correct: false }] });
        try { assert.equal(p.run(), 1); } finally { p.close(); }
    });
    test(`${chatgpt ? 'ChatGPT' : 'regular'} skip-page mode still waits for frame readiness`, () => {
        const p = navigation({ chatgpt, action: 'skipPage', ready: false, questions: [{ correct: false }] });
        try { assert.equal(p.run(), 0); } finally { p.close(); }
    });
}

test('skip-page mode waits for reminder persistence even when supported questions are already settled', () => {
    const p = navigation({ chatgpt: true, action: 'skipPage', saved: false, questions: [{ correct: true }] });
    try { assert.equal(p.run(), 0); } finally { p.close(); }
});
