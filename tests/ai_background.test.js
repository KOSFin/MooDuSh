const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const flush = () => new Promise(resolve => setImmediate(resolve));

function worker(storage, sent, options = {}) {
    let listener, updated;
    const busSource = fs.readFileSync(require.resolve('../js/commons.js'), 'utf8');
    const callback = busSource.match(/runtime\.onMessage\.addListener\((.*?)\)\}async messageHandler/s)?.[1];
    assert.ok(callback);
    const legacy = Function('return ' + callback).call({
        messageHandler: async () => ({ error_type: true, error_message: 'isParcel ==> false' })
    });
    const context = {
        indexedDB: options.indexedDB || new (require('fake-indexeddb').IDBFactory)(),
        URL, Date: { now: () => options.now ?? Date.now() }, crypto: require('node:crypto').webcrypto, setTimeout: options.schedule || setTimeout,
        chrome: {
            storage: { session: {
                async get(keys) { const result = {}; for (const key of Array.isArray(keys) ? keys : [keys]) result[key] = storage[key]; return result; },
                async set(value) { Object.assign(storage, value); },
                async remove(key) { delete storage[key]; }
            } },
            runtime: { onMessage: { addListener(fn) { listener = fn; } } },
            windows: { async update() {} },
            tabs: {
                async create() { return { id: 20, url: 'https://chatgpt.com/', status: options.createStatus || 'complete' }; },
                async get(id) { return { id, windowId: 1, url: 'https://chatgpt.com/c/test', status: 'complete' }; },
                async query() { return [{ id: options.activeTab ?? 3 }]; },
                async captureVisibleTab(...args) { options.captures?.push(args); return 'data:image/png;base64,YQ=='; },
                async update(...args) { options.updates?.push(args); },
                async sendMessage(...args) { sent.push(args); if (options.busyCount > 0) { options.busyCount--; return { busy: true }; } return options.noAcknowledgement ? undefined : { ok: true, id: args[1].job?.id, instanceId: options.instanceId }; },
                onUpdated: { addListener(fn) { updated = fn; } },
                onRemoved: { addListener() {} }
            }
        }
    };
    vm.runInNewContext(fs.readFileSync(require.resolve('../js/ai_background.js'), 'utf8'), context);
    return {
        request: (message, sender) => new Promise(resolve => {
            const response = legacy(message, sender);
            if (response && typeof response.then === 'function') response.then(resolve);
            listener(message, sender, resolve);
        }),
        message: (message, sender) => listener(message, sender, () => {}),
        updated: id => updated(id, { status: 'complete' })
    };
}
const source = { url: 'https://courses.openedu.ru/test', tab: { id: 3 }, frameId: 7 };

test('MV3 restart keeps request identity and routes the response to its source frame', async () => {
    const storage = {}, sent = [];
    const first = worker(storage, sent);
    const response = await first.request({ type: 'PARAMEXT_AI_REQUEST', prompt: 'Solve this question' }, source);
    assert.ok(response.id);
    assert.equal(sent.length, 1);
    assert.equal(sent[0][1].type, 'PARAMEXT_CHATGPT_RUN');
    const restarted = worker(storage, sent);
    restarted.updated(20);
    await flush();
    assert.equal(sent.length, 1, 'an already dispatched prompt must not be sent twice after worker restart');
    restarted.message({ type: 'PARAMEXT_CHATGPT_RESULT', id: response.id, text: '{"answers":[]}' }, { url: 'https://chatgpt.com/c/test', tab: { id: 20 } });
    await flush();
    assert.equal(sent.length, 2);
    assert.equal(sent[1][0], 3);
    assert.equal(sent[1][2].frameId, 7);
    assert.equal(sent[1][1].id, response.id);
    assert.equal(storage.paramExtAiJob, undefined);
});

test('concurrent frames cannot overwrite the active job; unrelated ChatGPT tabs cannot complete it', async () => {
    const storage = {}, sent = [];
    const w = worker(storage, sent);
    const response = await w.request({ type: 'PARAMEXT_AI_REQUEST', prompt: 'first' }, source);
    const busy = await w.request({ type: 'PARAMEXT_AI_REQUEST', prompt: 'second' }, { ...source, frameId: 9 });
    assert.equal(busy.busy, true);
    assert.equal(storage.paramExtAiJob.id, response.id);
    w.message({ type: 'PARAMEXT_CHATGPT_RESULT', id: response.id, text: 'fake' }, { url: 'https://chatgpt.com/', tab: { id: 21 } });
    await flush();
    assert.equal(storage.paramExtAiJob.id, response.id);
    assert.equal(sent.length, 1);
});


test('new tab is dispatched even if its load events fire before the job is saved', async () => {
    const storage = {}, sent = [];
    const w = worker(storage, sent, { createStatus: 'loading' });
    const response = await w.request({ type: 'PARAMEXT_AI_REQUEST', prompt: 'question' }, source);
    assert.ok(response.id);
    assert.equal(sent.filter(entry => entry[1].type === 'PARAMEXT_CHATGPT_RUN').length, 1);
});

test('an unacknowledged delivery retries the same request in the top ChatGPT frame', async () => {
    const storage = {}, sent = [], timers = [];
    const options = { noAcknowledgement: true, now: 0, schedule: callback => timers.push(callback) };
    const w = worker(storage, sent, options);
    const response = await w.request({ type: 'PARAMEXT_AI_REQUEST', prompt: 'question' }, source);
    assert.equal(storage.paramExtAiJob.dispatched, false);
    assert.equal(sent.length, 1);
    assert.equal(sent[0][2].frameId, 0);
    options.noAcknowledgement = false;
    timers.shift()(); await flush();
    assert.equal(storage.paramExtAiJob.id, response.id);
    assert.equal(storage.paramExtAiJob.dispatched, true);
    assert.equal(sent[1][1].job.id, response.id);
});

test('persistent missing acknowledgements stop after a bounded retry window', async () => {
    const storage = {}, sent = [], timers = [];
    const options = { noAcknowledgement: true, now: 0, schedule: callback => timers.push(callback) };
    const w = worker(storage, sent, options);
    await w.request({ type: 'PARAMEXT_AI_REQUEST', prompt: 'question' }, source);
    options.now = 30001;
    timers.shift()(); await flush();
    assert.equal(storage.paramExtAiJob, undefined);
    assert.match(sent.at(-1)[1].error, /did not acknowledge/);
    assert.ok(!sent.at(-1)[1].error.includes('tab unavailable'));
    assert.equal(timers.length, 0);
});

test('send failures notify OpenEdu without switching away from the failed ChatGPT composer', async () => {
    const storage = {}, sent = [], updates = [];
    const w = worker(storage, sent, { updates });
    const response = await w.request({ type: 'PARAMEXT_AI_REQUEST', prompt: 'question' }, source);
    updates.length = 0;
    w.message({ type: 'PARAMEXT_CHATGPT_RESULT', id: response.id, error: 'The editor did not retain the prompt' }, { url: 'https://chatgpt.com/', tab: { id: 20 } });
    await flush();
    assert.equal(updates.length, 0);
    assert.equal(sent.at(-1)[1].type, 'PARAMEXT_AI_RESULT');
    assert.match(sent.at(-1)[1].error, /editor/);
});

test('a slow eight-minute job remains reserved across worker restart and delivers its result', async () => {
    const storage = {}, sent = [];
    const first = worker(storage, sent, { now: 0 });
    const response = await first.request({ type: 'PARAMEXT_AI_REQUEST', prompt: 'first' }, source);
    const restarted = worker(storage, sent, { now: 8 * 60 * 1000 });
    const busy = await restarted.request({ type: 'PARAMEXT_AI_REQUEST', prompt: 'second' }, { ...source, frameId: 9 });
    assert.equal(busy.busy, true);
    assert.equal(storage.paramExtAiJob.id, response.id);
    restarted.message({ type: 'PARAMEXT_CHATGPT_RESULT', id: response.id, text: '{"answers":[]}' }, { url: 'https://chatgpt.com/', tab: { id: 20 } });
    await flush();
    assert.equal(sent.at(-1)[1].text, '{"answers":[]}');
    assert.equal(sent.at(-1)[2].frameId, 7);
    assert.equal(storage.paramExtAiJob, undefined);
});

test('configured timeout is forwarded to ChatGPT and preserved across worker restart', async () => {
    const storage = {}, sent = [];
    const first = worker(storage, sent, { now: 0 });
    const response = await first.request({ type: 'PARAMEXT_AI_REQUEST', prompt: 'slow', answerTimeoutMs: 25 * 60000 }, source);
    assert.equal(storage.paramExtAiJob.answerTimeoutMs, 25 * 60000);
    assert.equal(sent[0][1].job.answerTimeoutMs, 25 * 60000);
    const restarted = worker(storage, sent, { now: 20 * 60000 });
    const busy = await restarted.request({ type: 'PARAMEXT_AI_REQUEST', prompt: 'other', answerTimeoutMs: 60000 }, source);
    assert.equal(busy.busy, true);
    assert.equal(storage.paramExtAiJob.id, response.id);
    restarted.message({ type: 'PARAMEXT_CHATGPT_RESULT', id: response.id, text: 'late' }, { url: 'https://chatgpt.com/', tab: { id: 20 } });
    await flush();
    assert.equal(sent.at(-1)[1].text, 'late');
});

test('a correction prompt retries delivery when the previous tab job is still releasing', async () => {
    const storage = {}, sent = [], timers = [];
    const w = worker(storage, sent, { busyCount: 1, schedule: callback => timers.push(callback) });
    const response = await w.request({ type: 'PARAMEXT_AI_REQUEST', prompt: 'Fill missing answers' }, source);
    assert.equal(storage.paramExtAiJob.dispatched, undefined);
    assert.equal(timers.length, 1);
    timers.shift()(); await flush();
    assert.equal(storage.paramExtAiJob.dispatched, true);
    assert.equal(sent.length, 2);
    assert.equal(sent[1][1].job.id, response.id);
});


test('full-page PDFs survive worker storage and are forwarded to the ChatGPT adapter', async () => {
    const storage = {}, sent = [];
    const w = worker(storage, sent);
    const attachments = [{ name: 'openedu-full-page.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=' }];
    await w.request({ type: 'PARAMEXT_AI_REQUEST', prompt: 'combined answers', attachments }, source);
    assert.equal(storage.paramExtAiJob.attachments, undefined);
    assert.equal(storage.paramExtAiJob.hasAttachment, true);
    assert.deepEqual(sent[0][1].job.attachments, attachments);
});

test('invalid screenshot payloads are rejected before a ChatGPT job is reserved', async () => {
    for (const attachments of [[{ name: 'bad.png', dataUrl: 'https://example.com/a.png' }], Array(13).fill({ name: 'openedu-full-page.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=' })]) {
        const storage = {}, sent = [];
        const response = await worker(storage, sent).request({ type: 'PARAMEXT_AI_REQUEST', prompt: 'test', attachments }, source);
        assert.match(response.error, /PDF/);
        assert.equal(storage.paramExtAiJob, undefined);
        assert.equal(sent.length, 0);
    }
});

test('capture is tied to the requesting course tab and fails if focus changes', async () => {
    const captures = [];
    const options = { captures, schedule: callback => callback() };
    const w = worker({}, [], options);
    assert.equal((await w.request({ type: 'PARAMEXT_AI_CAPTURE' }, source)).dataUrl, 'data:image/png;base64,YQ==');
    assert.equal(captures.length, 1);
    assert.equal(captures[0][0], 1);
    options.activeTab = 99;
    assert.match((await w.request({ type: 'PARAMEXT_AI_CAPTURE' }, source)).error, /lost focus/);
    assert.equal(captures.length, 1);
});


test('manifest grants the explicit all-URLs permission required for automatic screenshots', () => {
    const manifest = JSON.parse(fs.readFileSync(require.resolve('../manifest.json'), 'utf8'));
    // *://*/* allows normal page access but does not satisfy captureVisibleTab.
    // activeTab alone requires a user invocation, so it cannot support this
    // automated capture after switching back from ChatGPT.
    assert.ok(manifest.host_permissions.includes('<all_urls>'),
        'Automatic screenshots require <all_urls> in host_permissions');
});

test('a new ChatGPT document resumes a delivered unsent request instead of leaving it stuck', async () => {
    const storage = {}, sent = [];
    const w = worker(storage, sent, { instanceId: 'old-document' });
    const response = await w.request({ type: 'PARAMEXT_AI_REQUEST', prompt: 'pending' }, source);
    const sender = { url: 'https://chatgpt.com/c/test', tab: { id: 20 } };
    const restarted = worker(storage, sent, { instanceId: 'new-document' });
    await restarted.request({ type: 'PARAMEXT_CHATGPT_READY', instanceId: 'new-document' }, sender);
    const jobs = sent.filter(entry => entry[1].type === 'PARAMEXT_CHATGPT_RUN');
    assert.equal(jobs.length, 2);
    assert.equal(jobs[1][1].job.id, response.id);
    assert.equal(jobs[1][1].job.resume, true);
    assert.equal(jobs[1][1].job.mayHaveSent, false);
    assert.equal(storage.paramExtAiJob.adapterInstance, 'new-document');
    await restarted.request({ type: 'PARAMEXT_CHATGPT_READY', instanceId: 'new-document' }, sender);
    assert.equal(sent.filter(entry => entry[1].type === 'PARAMEXT_CHATGPT_RUN').length, 2);
});

test('recovery retains send progress and rejects results from the previous document', async () => {
    const storage = {}, sent = [];
    const w = worker(storage, sent, { instanceId: 'old-document' });
    const response = await w.request({ type: 'PARAMEXT_AI_REQUEST', prompt: 'pending' }, source);
    const sender = { url: 'https://chatgpt.com/c/test', tab: { id: 20 } };
    await w.request({ type: 'PARAMEXT_CHATGPT_PHASE', id: response.id, instanceId: 'old-document', phase: 'submitted', userTurnId: 'turn-1' }, sender);
    const restarted = worker(storage, sent, { instanceId: 'new-document' });
    await restarted.request({ type: 'PARAMEXT_CHATGPT_READY', instanceId: 'new-document' }, sender);
    const job = sent.filter(entry => entry[1].type === 'PARAMEXT_CHATGPT_RUN').at(-1)[1].job;
    assert.equal(job.mayHaveSent, true);
    assert.equal(job.userTurnId, 'turn-1');
    restarted.message({ type: 'PARAMEXT_CHATGPT_RESULT', id: response.id, instanceId: 'old-document', error: 'stale error' }, sender);
    await flush(); assert.equal(storage.paramExtAiJob.id, response.id);
    restarted.message({ type: 'PARAMEXT_CHATGPT_RESULT', id: response.id, instanceId: 'new-document', text: '{"answers":[]}' }, sender);
    await flush(); assert.equal(storage.paramExtAiJob, undefined);
});

test('a large full-page PDF survives a worker restart outside the session-storage quota and is cleaned up', async () => {
    const indexedDB = new (require('fake-indexeddb').IDBFactory)();
    const storage = {}, sent = [];
    const attachments = [{ name: 'openedu-full-page.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,' + 'A'.repeat(12000000) }];
    const w = worker(storage, sent, { indexedDB });
    const response = await w.request({ type: 'PARAMEXT_AI_REQUEST', prompt: 'Solve using the full PDF', attachments }, source);
    assert.ok(response.id);
    assert.ok(JSON.stringify(storage).length < 1000);
    assert.equal(sent[0][1].job.attachments[0].dataUrl.length, attachments[0].dataUrl.length);
    storage.paramExtAiJob.dispatched = false;
    const resumed = worker(storage, sent, { indexedDB });
    await resumed.request({ type: 'PARAMEXT_CHATGPT_READY' }, { url: 'https://chatgpt.com/', tab: { id: 20 } });
    assert.equal(sent[1][1].job.attachments[0].dataUrl, attachments[0].dataUrl);
    resumed.message({ type: 'PARAMEXT_CHATGPT_RESULT', id: response.id, text: '{"answers":[]}' }, { url: 'https://chatgpt.com/', tab: { id: 20 } });
    for (let i = 0; i < 20; i++) await flush();
    assert.equal(storage.paramExtAiJob, undefined);
    const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('moodushAiDocuments', 1);
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    const remaining = await new Promise((resolve, reject) => {
        const request = database.transaction('attachments').objectStore('attachments').count();
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    assert.equal(remaining, 0);
    database.close();
});
