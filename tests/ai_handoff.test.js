const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const { chat } = require('./helpers/chatgpt_tab');
const flush = () => new Promise(resolve => setImmediate(resolve));

for (const choiceType of ['radio', 'checkbox', 'matching', 'mixed']) {
test('full boot applies ' + choiceType + ' answers and activates the native submit action', async () => {
    const source = new JSDOM(`<!doctype html><body><div class="xblock-student_view-problem">
      <div class="problems-wrapper" id="problem_demo" data-problem-id="demo" data-url="/demo/handler/xmodule_handler" data-attempts-used="0">
        <div class="problem"><div class="wrapper-problem-response"><fieldset><legend>Choose the first option.</legend><div class="choicegroup">
          <input id="input_demo_1_choice_0" name="input_demo_1" type="${choiceType === 'mixed' ? 'radio' : choiceType}" value="choice_0"><label for="input_demo_1_choice_0">First option</label>
          <input id="input_demo_1_choice_1" name="input_demo_1" type="${choiceType === 'mixed' ? 'radio' : choiceType}" value="choice_1"><label for="input_demo_1_choice_1">Second option</label>
          <span class="status unanswered">unanswered</span></div></fieldset></div></div>
        <button type="button" class="submit" disabled data-should-enable-submit-button="True">Отправить</button>
        <div class="submission-feedback">Вы использовали 0 из 2 попыток</div>
      </div></div></body>`, { url: 'https://courses.openedu.ru/xblock/demo', runScripts: 'outside-only', pretendToBeVisual: true });
    const w = source.window;
    if (choiceType === 'matching') {
        // Same adv-app + serialized CAPA input structure as the supplied matching table.
        const problem = w.document.querySelector('.problem');
        problem.innerHTML = '<p>Choose the first option.</p><div class="adv-app"><table><tbody><tr><td>Matching table</td></tr></tbody></table></div><input type="text" id="input_demo_matching" name="input_demo_matching" style="display:none">';
        problem.querySelector('.adv-app').setAttribute('data-initial-data', JSON.stringify({
            table: Array.from({ length: 9 }, (_, i) => [
                { isFixed: true, value: ['Author ' + i] }, { id: 'cell' + i, isFixed: false, value: [] }
            ]),
            answers: Array.from({ length: 9 }, (_, i) => ({ id: 'answer' + i, title: 'Definition ' + i }))
        }));
    }
    if (choiceType === 'mixed') w.document.body.insertAdjacentHTML('beforeend',
        '<div class="problems-wrapper" data-problem-id="manual_task" data-url="/manual/handler/xmodule_handler"><div class="problem"><div class="jsinput"><fieldset><legend>UNSUPPORTED MANUAL TASK</legend><input type="radio" id="manual_choice" name="manual_choice"><label for="manual_choice">MANUAL ONLY</label></fieldset></div></div></div>');
    const reminderTabs = [];
    const storage = { paramExtPlatformSettingsV2: { openedu: { mode: 'autoSolve', missingAnswerAction: 'chatgpt' } } };
    const sourceListeners = [], workerListeners = [], storageListeners = [];
    let opened = 0, submitted = 0;
    const errors = [];
    const chromeId = 'extension';
    const sourceSender = { url: w.location.href, tab: { id: 3, url: 'https://courses.openedu.ru/courses/course-v1:test+test+2026/courseware/unit' }, frameId: 0 };
    const chatSender = { url: 'https://chatgpt.com/', tab: { id: 20 }, frameId: 0 };
    function route(message, sender) {
        return new Promise((resolve, reject) => {
            let claimed = false;
            for (const listener of workerListeners) {
                const result = listener(message, sender, resolve);
                if (result === true) claimed = true;
                if (result?.then) { claimed = true; result.then(resolve, reject); }
            }
            if (!claimed) resolve();
        });
    }
    const c = chat({
        sendMessage: message => route(message, chatSender),
        reply(prompt) {
            const payload = JSON.parse(prompt.slice(prompt.indexOf('{\n  "questions"'), prompt.lastIndexOf('\nRequest ID:')));
            return JSON.stringify({ answers: payload.questions.map(q => ({ questionKey: q.questionKey, answers:
                choiceType === 'matching' ? q.options.filter(option => {
                    const match = option.answerKey.match(/^match:cell(\d+):answer(\d+)$/);
                    return match && match[1] === match[2];
                }) : q.options.slice(0, choiceType === 'checkbox' ? 2 : 1)
            })) });
        }
    });
    c.w.DataTransfer = class { constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; } };
    const upload = c.w.document.createElement('input');
    upload.type = 'file'; upload.multiple = true; upload.accept = '.pdf,.txt';
    Object.defineProperty(upload, 'files', { value: [], writable: true });
    upload.addEventListener('change', () => {
        for (const file of upload.files) {
            const card = c.w.document.createElement('div'); card.dataset.fileId = 'uploaded-' + file.name; card.textContent = file.name; c.w.document.querySelector('form').appendChild(card);
        }
    });
    c.w.document.querySelector('form').appendChild(upload);
    const session = {};
    const backgroundChrome = {
        runtime: { getURL: path => 'chrome-extension://extension/' + path, onMessage: { addListener(fn) { workerListeners.push(fn); } } },
        storage: { session: {
            async get(keys) { const out = {}; for (const key of Array.isArray(keys) ? keys : [keys]) out[key] = session[key]; return out; },
            async set(value) { Object.assign(session, value); }, async remove(key) { delete session[key]; }
        } },
        windows: { async update() {} },
        tabs: {
            async create(properties) {
                if (properties.url.startsWith('chrome-extension://')) { const tab = { id: 21, ...properties }; reminderTabs.push(tab); return tab; }
                opened++; return { id: 20, url: 'https://chatgpt.com/', status: 'loading' };
            },
            async query(options) { return options?.active ? [{ id: 3 }] : reminderTabs; },
            async get(id) { return { id, windowId: 1, url: id === 3 ? w.location.href : 'https://chatgpt.com/', status: 'complete' }; },
            async captureVisibleTab() { return 'data:image/png;base64,YQ=='; },
            async update() {},
            async sendMessage(tab, message) {
                if (tab === 20) return c.deliver(message.job.id, message.job.prompt, message.job.answerTimeoutMs, { attachments: message.job.attachments });
                for (const listener of sourceListeners) listener(message, { id: chromeId }, () => {});
            },
            onUpdated: { addListener() {} }, onRemoved: { addListener() {} }
        }
    };
    // Exercise the actual legacy bus guard alongside the new message handler.
    const commons = fs.readFileSync(require.resolve('../js/commons.js'), 'utf8');
    const legacy = commons.match(/runtime\.onMessage\.addListener\((.*?)\)\}async messageHandler/s)[1];
    workerListeners.push(Function('return ' + legacy).call({ messageHandler: async () => ({ error_type: true }) }));
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/ai_background.js'), 'utf8'), {
        indexedDB: new (require('fake-indexeddb').IDBFactory)(),
        chrome: backgroundChrome, crypto: require('node:crypto').webcrypto, URL, setTimeout: (callback, delay) => delay === 600 ? setImmediate(callback) : setTimeout(callback, delay)
    });
    w.chrome = {
        runtime: { id: chromeId, getManifest: () => ({ version: 'test' }), onMessage: { addListener(fn) { sourceListeners.push(fn); } }, sendMessage: message => route(message, sourceSender) },
        storage: {
            local: {
                get(keys, callback) { const out = {}; for (const key of Array.isArray(keys) ? keys : [keys]) out[key] = storage[key]; if (callback) callback(out); else return Promise.resolve(out); },
                set(value, callback) { Object.assign(storage, value); if (callback) callback(); else return Promise.resolve(); }
            }, onChanged: { addListener(listener) { storageListeners.push(listener); } }
        }
    };
    backgroundChrome.storage.local = w.chrome.storage.local;
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/reminders_background.js'), 'utf8'), { chrome: backgroundChrome, URL });
    // The saved CAPA runtime recalculates this readiness on input clicks.
    for (const input of w.document.querySelectorAll('input')) input.addEventListener('click', () => {
        const required = choiceType === 'checkbox' ? 2 : 1;
        w.document.querySelector('.submit').disabled = w.document.querySelectorAll('input:checked').length !== required;
    });
    if (choiceType === 'matching') w.document.querySelector('#input_demo_matching').addEventListener('change', event => {
        const answer = JSON.parse(event.target.value).answer;
        w.document.querySelector('.submit').disabled = Object.keys(answer).length !== 9;
    });
    const nativeTimeout = w.setTimeout.bind(w);
    w.setTimeout = (callback, delay, ...args) => delay === 150 ? (queueMicrotask(callback), 0) : nativeTimeout(callback, delay, ...args);
    w.scrollTo = ({ left, top }) => { w.scrollX = left; w.scrollY = top; };
    w.Image = class {
        constructor() { this.naturalWidth = 1024; this.naturalHeight = 768; }
        set src(value) { queueMicrotask(() => this.onload()); }
    };
    w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
    w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    w.fetch = async () => ({ ok: false, status: 404 });
    w.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 800, height: 30, top: 0, left: 0 });
    w.addEventListener('error', e => errors.push(e.message));
    w.postMessage = (data) => {
        if (data.type !== 'PARAMEXT_CAPA_SUBMIT') return;
        if (choiceType === 'matching') {
            const answer = JSON.parse(w.document.getElementById('input_demo_matching').value).answer;
            assert.deepEqual(answer, Object.fromEntries(Array.from({ length: 9 }, (_, i) => ['cell' + i, ['answer' + i]])));
        } else assert.equal(w.document.getElementById('input_demo_1_choice_0').checked, true, 'the answer must already be applied');
        assert.equal(w.document.querySelector('.submit').disabled, false, 'native readiness must activate submit');
        if (choiceType === 'checkbox') assert.equal(w.document.getElementById('input_demo_1_choice_1').checked, true);
        submitted++;
        const wrapper = w.document.querySelector('.problems-wrapper');
        wrapper.innerHTML = wrapper.innerHTML; // CAPA replaces response HTML after grading.
        const grade = w.document.querySelector('.status');
        if (grade) { grade.className = 'status correct'; grade.textContent = 'correct'; }
        w.dispatchEvent(new w.MessageEvent('message', { source: w, data: { type: 'PARAMEXT_CAPA_RESULT', id: data.id, ok: true, success: 'submitted', currentScore: 1, totalPossible: 1 } }));
    };
    try {
        const manifest = JSON.parse(fs.readFileSync(require.resolve('../manifest.json'), 'utf8'));
        const scripts = manifest.content_scripts.find(s => s.js?.includes('js/openedu_content.js')).js;
        for (const script of scripts) w.eval(fs.readFileSync(require('node:path').join(__dirname, '..', script), 'utf8'));
        for (let i = 0; i < 100 && !opened; i++) await flush();
        for (let i = 0; i < 20; i++) await flush();
        assert.equal(opened, 1, 'actual boot must open the AI tab');
        // Popup UI bookkeeping and idempotent saves used to cancel the active
        // solve even though neither the course page nor solve mode changed.
        const oldSettings = JSON.parse(JSON.stringify(storage.paramExtPlatformSettingsV2));
        storage.paramExtPlatformSettingsV2.ui = { lastTab: 'diagnostics' };
        for (const listener of storageListeners) await listener({ paramExtPlatformSettingsV2: {
            oldValue: oldSettings, newValue: storage.paramExtPlatformSettingsV2
        } }, 'local');

        await c.advance(6000);
        for (let i = 0; i < 10; i++) await flush();
        assert.equal(c.sends, 1);
        await c.advance(6000);
        assert.equal(upload.files[0]?.name, 'openedu-full-page.pdf');
        assert.ok(c.inserted[0].includes(choiceType === 'matching' ? 'Author 0' : 'Choose the first option.'));
        await new Promise(resolve => setTimeout(resolve, 900));
        assert.equal(submitted, 1, JSON.stringify({ sourceError: w.document.getElementById('moodush-ai-error')?.textContent, result: c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT'), sessionKeys: Object.keys(session), errors }));
        if (choiceType === 'mixed') {
            assert.equal(storage.moodushOpeneduReminders.length, 1);
            assert.equal(reminderTabs.length, 1);
            assert.equal(reminderTabs[0].active, false);
            assert.ok(!c.inserted[0].includes('UNSUPPORTED MANUAL TASK'));
            assert.ok(!c.inserted[0].includes('MANUAL ONLY'));
            assert.equal(w.document.getElementById('manual_choice').checked, false);
        }
        assert.deepEqual(errors, []);
        assert.equal(w.document.getElementById('moodush-ai-error'), null);
    } finally { source.window.close(); c.dom.window.close(); }
});

}
