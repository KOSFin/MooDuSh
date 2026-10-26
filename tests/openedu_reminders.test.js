const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

function page(html) {
    const dom = new JSDOM(html, { url: 'https://courses.openedu.ru/courses/course-v1:test+test+2026/xblock/test', runScripts: 'outside-only' });
    dom.window.chrome = { runtime: { onMessage: { addListener() {} } } };
    dom.window.eval(fs.readFileSync(require.resolve('../js/openedu_shared.js'), 'utf8'));
    dom.window.eval(fs.readFileSync(require.resolve('../js/openedu_reminders.js'), 'utf8'));
    return dom;
}

test('detects the simulator JSInput structure, including data-content before rendering', () => {
    const dom = page('<div class="problems-wrapper"><div class="wrapper-problem-response"><div class="jsinput"><iframe src="simulator.html"></iframe><input type="hidden"></div></div></div>');
    try {
        const api = dom.window.ParamExtOpeneduReminders;
        assert.equal(api.findUnsupportedTasks(dom.window.document).length, 1);
        const root = dom.window.document.querySelector('.problems-wrapper');
        root.setAttribute('data-content', root.innerHTML);
        root.innerHTML = '';
        assert.equal(api.findUnsupportedTasks(dom.window.document).length, 1);
    } finally { dom.window.close(); }
});

test('does not treat video, theory, ordinary questions, or supported matching tables as unsupported', () => {
    const dom = page('<div data-block-type="video"><iframe></iframe></div><article>Theory</article><div class="problems-wrapper"><input type="radio"><input type="text"><table class="MatchingTable"><tr><td>Drag answer</td></tr></table></div>');
    try { assert.equal(dom.window.ParamExtOpeneduReminders.findUnsupportedTasks(dom.window.document).length, 0); }
    finally { dom.window.close(); }
});

test('mixed pages retain unsupported tasks even when ordinary questions are present', () => {
    const dom = page('<div class="problems-wrapper"><input type="radio"><div class="jsinput"></div></div><div data-block-type="lti_consumer"></div>');
    try { assert.equal(dom.window.ParamExtOpeneduReminders.findUnsupportedTasks(dom.window.document).length, 2); }
    finally { dom.window.close(); }
});

function background(initialLinks = []) {
    let listener;
    const saved = { moodushOpeneduReminders: [...initialLinks] }, created = [], updated = [], tabs = [];
    const chrome = {
        storage: { local: { async get() { return saved; }, async set(data) { Object.assign(saved, data); } } },
        runtime: {
            getURL: value => 'chrome-extension://moodush/' + value,
            onMessage: { addListener(fn) { listener = fn; } }
        },
        tabs: {
            async query() { return tabs; },
            async create(data) { created.push(data); tabs.push({ ...data, id: 1 }); return tabs[0]; },
            async update(id, data) { updated.push({ id, ...data }); }
        }
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/reminders_background.js'), 'utf8'), { chrome, URL });
    return { saved, created, updated, tabs, chrome, send: (message, sender = {}) => new Promise(resolve => listener(message, sender, resolve)) };
}
const vertical = 'block-v1:urfu+SoftSkills+fall_2026+type@vertical+block@6220d1276bc547a89c3475ed1dfbe8ee';
const base = 'https://apps.openedu.ru/learning/course/course-v1:urfu+SoftSkills+fall_2026/block-v1:urfu+SoftSkills+fall_2026+type@sequential+block@topic';
const sender = { tab: { url: base + '?utm_source=test#tracking' }, url: 'https://courses.openedu.ru/xblock/' + vertical };
const message = { type: 'MOODUSH_OPENEDU_REMINDER', vertical };

test('saves clean vertical links, serializes simultaneous iframe reports and opens one inactive tab', async () => {
    const bg = background();
    const results = await Promise.all([bg.send(message, sender), bg.send(message, sender)]);
    assert.ok(results.every(r => r.ok));
    assert.deepEqual(Array.from(bg.saved.moodushOpeneduReminders), [base + '/' + vertical]);
    assert.equal(bg.created.length, 1);
    assert.equal(bg.created[0].active, false);
    assert.equal(bg.created[0].url, 'chrome-extension://moodush/html/reminders.html');
    assert.equal(bg.updated.length, 0);
});

test('a second task updates the existing reminders tab without stealing focus', async () => {
    const bg = background();
    await bg.send(message, sender);
    await bg.send({ ...message, vertical: vertical.replace('6220d1276bc547a89c3475ed1dfbe8ee', 'another') }, sender);
    assert.equal(bg.saved.moodushOpeneduReminders.length, 2);
    assert.equal(bg.created.length, 1);
    assert.equal(bg.updated.length, 0);
});

test('existing saved links survive; manual open focuses or recreates the reminders tab', async () => {
    const bg = background([base + '/' + vertical]);
    await bg.send(message, sender);
    assert.equal(bg.created.length, 1);
    assert.equal(bg.created[0].active, false);
    await bg.send({ type: 'MOODUSH_OPEN_REMINDERS' });
    assert.equal(bg.updated[0].active, true);
    await bg.send({ type: 'MOODUSH_OPEN_REMINDERS' });
    assert.equal(bg.created.length, 1);
    assert.equal(bg.updated[0].active, true);
    bg.tabs.length = 0;
    await bg.send({ type: 'MOODUSH_OPEN_REMINDERS' });
    assert.equal(bg.created.length, 2);
    assert.equal(bg.saved.moodushOpeneduReminders.length, 1);
});

test('rejects non-OpenEdu senders and saves links even if creating a tab fails', async () => {
    const bg = background();
    assert.equal((await bg.send(message, { ...sender, url: 'https://evil.example/course' })).ok, false);
    assert.equal(bg.created.length, 0);
    bg.chrome.tabs.create = async () => { throw new Error('Window closed'); };
    assert.equal((await bg.send(message, sender)).ok, true);
    assert.equal(bg.saved.moodushOpeneduReminders.length, 1);
});

test('only the reminders page can remove a saved link', async () => {
    const url = base + '/' + vertical;
    const bg = background([url]);
    const remove = { type: 'MOODUSH_REMOVE_REMINDER', url };
    assert.equal((await bg.send(remove, sender)).ok, false);
    assert.equal(bg.saved.moodushOpeneduReminders.length, 1);
    assert.equal((await bg.send(remove, { url: 'chrome-extension://moodush/html/reminders.html' })).ok, true);
    assert.equal(bg.saved.moodushOpeneduReminders.length, 0);
});

test('saves silently once and clears saved-task state on navigation', async () => {
    const dom = new JSDOM('<div class="problems-wrapper"><div class="jsinput"></div></div>', { url: base, runScripts: 'outside-only' });
    const scheduled = [], intervals = [];
    let sends = 0;
    dom.window.setTimeout = fn => { scheduled.push(fn); return scheduled.length; };
    dom.window.clearTimeout = () => {};
    dom.window.setInterval = fn => { intervals.push(fn); };
    dom.window.chrome = { runtime: {
        onMessage: { addListener() {} },
        async sendMessage() { sends++; return { ok: true }; }
    } };
    try {
        dom.window.eval(fs.readFileSync(require.resolve('../js/openedu_shared.js'), 'utf8'));
        dom.window.eval(fs.readFileSync(require.resolve('../js/openedu_reminders.js'), 'utf8'));
        await scheduled[0]();
        assert.equal(dom.window.document.getElementById('moodush-openedu-reminder'), null);
        assert.equal(dom.window.ParamExtOpeneduReminders.hasSavedUnsupportedTask(), true);
        await intervals[0]();
        assert.equal(sends, 1);
        dom.window.document.querySelector('.problems-wrapper').remove();
        dom.reconfigure({ url: base + '/another' });
        await intervals[0]();
        assert.equal(dom.window.document.getElementById('moodush-openedu-reminder'), null);
        assert.equal(dom.window.ParamExtOpeneduReminders.hasSavedUnsupportedTask(), false);
    } finally { dom.window.close(); }
});

test('iframe save status is silent, ignores stale pages and expires when the unit changes', () => {
    const frameUrl = 'https://courses.openedu.ru/xblock/unit';
    const dom = new JSDOM('<iframe id="unit-iframe" src="' + frameUrl + '"></iframe>', { url: base, runScripts: 'outside-only' });
    let listener;
    dom.window.chrome = { runtime: { onMessage: { addListener(fn) { listener = fn; } } } };
    try {
        dom.window.eval(fs.readFileSync(require.resolve('../js/openedu_shared.js'), 'utf8'));
        dom.window.eval(fs.readFileSync(require.resolve('../js/openedu_reminders.js'), 'utf8'));
        const api = dom.window.ParamExtOpeneduReminders;
        listener({ type: 'MOODUSH_OPENEDU_REMINDER_STATUS', pageUrl: base + '/old', frameUrl, result: { ok: true } });
        assert.equal(api.hasSavedUnsupportedTask(), false);
        listener({ type: 'MOODUSH_OPENEDU_REMINDER_STATUS', pageUrl: base, frameUrl, result: { ok: false } });
        assert.equal(api.hasSavedUnsupportedTask(), false);
        listener({ type: 'MOODUSH_OPENEDU_REMINDER_STATUS', pageUrl: base, frameUrl, result: { ok: true } });
        assert.equal(api.hasSavedUnsupportedTask(), true);
        assert.equal(dom.window.document.getElementById('moodush-openedu-reminder'), null);
        dom.window.document.querySelector('iframe').src = frameUrl + '-next';
        assert.equal(api.hasSavedUnsupportedTask(), false);
    } finally { dom.window.close(); }
});

function remindersPage(links) {
    const dom = new JSDOM(fs.readFileSync(require.resolve('../html/reminders.html'), 'utf8'), { url: 'https://extension.test/reminders', runScripts: 'outside-only' });
    let onChange;
    const messages = [];
    dom.window.chrome = {
        runtime: { async sendMessage(message) { messages.push(message); return { ok: true }; } },
        storage: {
            local: { async get() { return { moodushOpeneduReminders: links }; } },
            onChanged: { addListener(fn) { onChange = fn; } }
        }
    };
    dom.window.eval(fs.readFileSync(require.resolve('../js/reminders_page.js'), 'utf8'));
    return { dom, messages, change: links => onChange({ moodushOpeneduReminders: { newValue: links } }, 'local') };
}

test('reminders page renders safe links, updates live, removes entries and shows the empty state', async () => {
    const url = base + '/' + vertical;
    const p = remindersPage([url, url, 'javascript:alert(1)', 'https://openedu.ru.evil.example']);
    try {
        await Promise.resolve();
        const doc = p.dom.window.document;
        assert.equal(doc.querySelectorAll('#reminders li').length, 1);
        assert.equal(doc.querySelector('#reminders a').href, url);
        assert.equal(doc.querySelector('#reminders a').target, '_blank');
        assert.equal(doc.getElementById('count').textContent, 'Сохранено: 1');
        doc.querySelector('#reminders button').click();
        await Promise.resolve();
        assert.equal(p.messages[0].type, 'MOODUSH_REMOVE_REMINDER');
        assert.equal(p.messages[0].url, url);
        p.change([]);
        assert.equal(doc.querySelectorAll('#reminders li').length, 0);
        assert.equal(doc.getElementById('empty').hidden, false);
        p.change([url, base + '/other']);
        assert.equal(doc.querySelectorAll('#reminders li').length, 2);
        assert.equal(doc.getElementById('empty').hidden, true);
    } finally { p.dom.window.close(); }
});

test('a live storage update cannot be overwritten by an older initial load', async () => {
    const p = remindersPage([]);
    try {
        p.change([base + '/' + vertical]);
        await Promise.resolve();
        assert.equal(p.dom.window.document.querySelectorAll('#reminders li').length, 1);
    } finally { p.dom.window.close(); }
});

test('the saved-task status identifies its source iframe for auto-progression', async () => {
    const bg = background();
    let status;
    bg.chrome.tabs.sendMessage = (tab, message, options, callback) => {
        status = { tab, message, options };
        callback();
    };
    await bg.send(message, { ...sender, tab: { ...sender.tab, id: 42 } });
    assert.equal(status.tab, 42);
    assert.equal(status.message.frameUrl, sender.url);
    assert.equal(status.message.pageUrl, sender.tab.url);
    assert.equal(status.message.result.ok, true);
    assert.equal(status.options.frameId, 0);
});
