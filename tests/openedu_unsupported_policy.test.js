const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const content = fs.readFileSync(require.resolve('../js/openedu_content.js'), 'utf8');

function loadFunction(context, name) {
    const start = content.indexOf('    function ' + name + '(');
    const end = content.indexOf('\n    function ', start + 10);
    vm.runInNewContext(content.slice(start, end), context);
}

function policy(html = '') {
    const dom = new JSDOM(html, { url: 'https://apps.openedu.ru/learning/course/test', runScripts: 'outside-only' });
    dom.window.eval(fs.readFileSync(require.resolve('../js/openedu_shared.js'), 'utf8'));
    const context = {
        document: dom.window.document, window: dom.window, location: dom.window.location, URL,
        settings: { openedu: { unsupportedTaskAction: 'skipPage' } },
        openeduShared: dom.window.ParamExtOpeneduShared, isTopFrame: true,
        topFrameIframeSnapshots: new Map(), lastSequenceNavigationAt: 100
    };
    loadFunction(context, 'getUnsupportedPageState');
    loadFunction(context, 'shouldSkipUnsupportedPage');
    return { context, close: () => dom.window.close() };
}

test('unsupported-page setting defaults safely and accepts only the two menu choices', () => {
    const context = {};
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/platform_settings.js'), 'utf8'), context);
    const api = context.ParamExtSettings;
    for (const value of [undefined, 'invalid', 'solveSupported', 'skipPage']) {
        assert.equal(api.normalizeSettings({ openedu: { unsupportedTaskAction: value } }).openedu.unsupportedTaskAction,
            value === 'skipPage' ? 'skipPage' : 'solveSupported');
    }
});

test('skip-page mode blocks mixed supported and unsupported content before reminder persistence', () => {
    const p = policy('<div class="problems-wrapper"><input type="radio"></div><div class="problems-wrapper"><div class="jsinput"></div></div>');
    try {
        assert.equal(p.context.shouldSkipUnsupportedPage(), true);
        loadFunction(p.context, 'runOpeneduAutoActions');
        loadFunction(p.context, 'runChatgptAutoActions');
        p.context.isChatgptAutoMode = () => true;
        p.context.aiRun = null;
        // Neither path may reach answer lookup, ChatGPT requests or submission.
        assert.doesNotThrow(() => p.context.runOpeneduAutoActions([], {}));
        assert.doesNotThrow(() => p.context.runChatgptAutoActions([], {}));
        for (const name of ['maybeAutoApplyVerifiedAnswers', 'maybeAutoSubmitSolvedQuestions', 'maybeAutoCheckInsertedAnswers', 'handleMissingAutoAnswers']) {
            loadFunction(p.context, name);
            assert.doesNotThrow(() => p.context[name]([], {}));
        }
        p.context.settings.openedu.unsupportedTaskAction = 'solveSupported';
        assert.equal(p.context.shouldSkipUnsupportedPage(), false);
    } finally { p.close(); }
});

test('skip-page mode allows supported-only pages and waits for current course frame reports', () => {
    const p = policy('<div class="problems-wrapper"><input type="radio"></div><iframe src="https://courses.openedu.ru/xblock/test"></iframe>');
    try {
        const c = p.context;
        const source = c.document.querySelector('iframe').contentWindow;
        assert.equal(c.shouldSkipUnsupportedPage(), true);
        c.topFrameIframeSnapshots.set('frame', { source, updatedAt: 99, hasUnsupportedTask: false });
        assert.equal(c.shouldSkipUnsupportedPage(), true);
        c.topFrameIframeSnapshots.set('frame', { source, updatedAt: 101, hasUnsupportedTask: false });
        assert.equal(c.shouldSkipUnsupportedPage(), false);
        c.topFrameIframeSnapshots.set('frame', { source, updatedAt: 102, hasUnsupportedTask: true });
        assert.equal(c.shouldSkipUnsupportedPage(), true);
        c.document.querySelector('iframe').remove();
        assert.equal(c.shouldSkipUnsupportedPage(), false);
    } finally { p.close(); }
});

test('a supported sibling frame respects the top page policy until its context is ready', () => {
    const p = policy('<div class="problems-wrapper"><input type="radio"></div>');
    try {
        const c = p.context;
        c.isTopFrame = false;
        assert.equal(c.shouldSkipUnsupportedPage(), true);
        c.window.__PARAMEXT_TOP_CONTEXT = { unsupportedPage: { ready: true, hasUnsupportedTask: true } };
        assert.equal(c.shouldSkipUnsupportedPage(), true);
        c.window.__PARAMEXT_TOP_CONTEXT.unsupportedPage.hasUnsupportedTask = false;
        assert.equal(c.shouldSkipUnsupportedPage(), false);
    } finally { p.close(); }
});
