/* Short messages + session storage survive MV3 worker suspension during generation. */
(function () {
    const KEY = 'paramExtAiJob';
    const TAB = 'paramExtAiTab';
    // Extra time covers tab loading, editor/send setup and result delivery.
    const answerTimeout = value => Math.min(3600000, Math.max(60000, Number(value) || 600000));
    const jobTimeout = job => answerTimeout(job.answerTimeoutMs) + 120000;
    // Full-resolution pages can exceed chrome.storage.session's 10 MB quota.
    // Keep PDF bytes in IndexedDB and only request metadata in session storage.
    let attachmentDatabase;
    function documentDatabase() {
        if (!attachmentDatabase) attachmentDatabase = new Promise((resolve, reject) => {
            const open = indexedDB.open('moodushAiDocuments', 1);
            open.onupgradeneeded = () => open.result.createObjectStore('attachments');
            open.onsuccess = () => resolve(open.result);
            open.onerror = () => { attachmentDatabase = null; reject(open.error); };
        });
        return attachmentDatabase;
    }
    async function attachmentData(mode, action) {
        const database = await documentDatabase();
        return new Promise((resolve, reject) => {
            const transaction = database.transaction('attachments', mode);
            const request = action(transaction.objectStore('attachments'));
            transaction.oncomplete = () => resolve(request?.result);
            transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('PDF storage failed'));
        });
    }
    let reserving = false;
    let dispatching = false;
    const isOpenedu = url => { try { return /(^|\.)openedu\.ru$/.test(new URL(url).hostname); } catch (_) { return false; } };
    const isChatgpt = url => { try { return new URL(url).origin === 'https://chatgpt.com'; } catch (_) { return false; } };
    async function finish(job, result) {
        await chrome.storage.session.remove(KEY);
        if (job.hasAttachment) await attachmentData('readwrite', store => store.delete(job.id));
        try {
            // Keep a failed composer visible so its status/draft can be inspected.
            if (!result.error) await chrome.tabs.update(job.sourceTab, { active: true });
            await chrome.tabs.sendMessage(job.sourceTab, { type: 'PARAMEXT_AI_RESULT', id: job.id, ...result }, { frameId: job.sourceFrame });
        } catch (_) { /* Source frame was closed or navigated. */ }
    }
    async function retryDelivery(job, reason) {
        const current = (await chrome.storage.session.get(KEY))[KEY];
        if (!current || current.id !== job.id || current.dispatched) return;
        const deliveryStartedAt = current.deliveryStartedAt ?? Date.now();
        const queued = { ...current, deliveryStartedAt, dispatched: false };
        await chrome.storage.session.set({ [KEY]: queued });
        if (Date.now() - deliveryStartedAt < 30000) setTimeout(() => dispatch(queued), 500);
        else await finish(queued, { error: reason + '. Reload the ChatGPT tab and retry. No answers were applied.' });
    }
    async function dispatch(job) {
        if (dispatching) return;
        dispatching = true;
        try {
            const current = (await chrome.storage.session.get(KEY))[KEY];
            if (!current || current.id !== job.id || current.dispatched) return;
            const tab = await chrome.tabs.get(job.aiTab);
            if (!isChatgpt(tab.url) || tab.status !== 'complete') return;
            if (current.deliveryStartedAt == null) await chrome.storage.session.set({ [KEY]: { ...current, deliveryStartedAt: Date.now() } });
            const attachments = job.hasAttachment ? await attachmentData('readonly', store => store.get(job.id)) : [];
            if (job.hasAttachment && !attachments?.length) throw new Error('The full-page PDF is missing. Retry the course request.');
            const acknowledgement = await chrome.tabs.sendMessage(job.aiTab, { type: 'PARAMEXT_CHATGPT_RUN', job: { id: job.id, prompt: job.prompt, attachments, answerTimeoutMs: answerTimeout(job.answerTimeoutMs), resume: job.resume, mayHaveSent: job.mayHaveSent || ['sending', 'submitted'].includes(job.phase), userTurnId: job.userTurnId } }, { frameId: 0 });
            if (acknowledgement?.busy) {
                // The previous result can reach OpenEdu before the tab adapter
                // clears activeJob. Retry the queued request once it releases.
                if (Date.now() - job.createdAt < jobTimeout(job)) setTimeout(() => dispatch(job), 500);
                else await finish(job, { error: 'ChatGPT adapter remained busy until the request timed out' });
                return;
            }
            if (acknowledgement?.ok !== true || acknowledgement.id !== job.id) {
                await retryDelivery(job, acknowledgement?.error || 'ChatGPT adapter did not acknowledge the prompt');
                return;
            }
            const latest = (await chrome.storage.session.get(KEY))[KEY];
            if (latest?.id === job.id) await chrome.storage.session.set({ [KEY]: { ...latest, dispatched: true, phase: latest.phase || 'received', adapterInstance: acknowledgement.instanceId || latest.adapterInstance } });
        } catch (error) {
            if (/Receiving end does not exist|Could not establish connection/.test(error.message)) {
                await retryDelivery(job, 'ChatGPT adapter did not load');
                return; // document_idle also signals readiness after injection.
            }
            await finish(job, { error: 'ChatGPT request delivery failed: ' + error.message });
        } finally { dispatching = false; }
    }
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (message?.type === 'PARAMEXT_AI_CAPTURE' && isOpenedu(sender.url) && sender.tab) {
            (async () => {
                const tab = await chrome.tabs.get(sender.tab.id);
                await chrome.tabs.update(tab.id, { active: true });
                await chrome.windows.update(tab.windowId, { focused: true });
                // Let scrolling, focus and lazy-loaded images settle before capture.
                await new Promise(resolve => setTimeout(resolve, 600));
                const [active] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
                if (active?.id !== tab.id) throw new Error('Course tab lost focus during screenshot capture');
                return { dataUrl: await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' }) };
            })().then(respond).catch(error => respond({ error: error.message }));
            return true;
        }
        if (message?.type === 'PARAMEXT_AI_REQUEST' && isOpenedu(sender.url) && sender.tab) {
            (async () => {
                if (reserving) return { error: 'Another AI request is starting; try again shortly', busy: true };
                reserving = true;
                try {
                    const stored = await chrome.storage.session.get([KEY, TAB]);
                    if (stored[KEY] && Date.now() - stored[KEY].createdAt < jobTimeout(stored[KEY])) return { error: 'Another AI request is running', busy: true };
                    if (typeof message.prompt !== 'string' || message.prompt.length > 100000) throw new Error('Invalid AI prompt');
                    const attachments = message.attachments || [];
                    if (!Array.isArray(attachments) || attachments.length > 1 || attachments.some(file =>
                        !file || typeof file.name !== 'string' || file.name !== 'openedu-full-page.pdf' || file.mimeType !== 'application/pdf'
                        || typeof file.dataUrl !== 'string' || !/^data:application\/pdf;base64,[A-Za-z0-9+/]+=*$/.test(file.dataUrl))
                        || attachments.reduce((size, file) => size + file.dataUrl.length, 0) > 64000000) {
                        throw new Error('Invalid or oversized full-page PDF (maximum one PDF / 48 MB)');
                    }
                    let tab;
                    if (stored[TAB]) {
                        try { tab = await chrome.tabs.get(stored[TAB]); } catch (_) {}
                        if (tab && !isChatgpt(tab.url)) tab = null;
                    }
                    if (!tab) tab = await chrome.tabs.create({ url: 'https://chatgpt.com/', active: true });
                    else await chrome.tabs.update(tab.id, { active: true });
                    const job = { id: crypto.randomUUID(), sourceTab: sender.tab.id, sourceFrame: sender.frameId, aiTab: tab.id, createdAt: Date.now(), prompt: message.prompt, hasAttachment: attachments.length > 0, answerTimeoutMs: answerTimeout(message.answerTimeoutMs) };
                    await attachmentData('readwrite', store => {
                        store.clear();
                        return attachments.length ? store.put(attachments, job.id) : undefined;
                    });
                    await chrome.storage.session.set({ [KEY]: job, [TAB]: tab.id });
                    // Query current readiness after saving: create() can return a stale
                    // loading status after onUpdated/READY have already fired.
                    await dispatch(job);
                    return { id: job.id };
                } finally { reserving = false; }
            })().then(respond).catch(error => respond({ error: error.message }));
            return true;
        }
        if (message?.type === 'PARAMEXT_CHATGPT_READY' && isChatgpt(sender.url)) {
            (async () => {
                const stored = await chrome.storage.session.get([KEY, TAB]);
                let job = stored[KEY];
                if (job?.aiTab === sender.tab?.id && typeof message.instanceId === 'string'
                    && job.dispatched && job.adapterInstance !== message.instanceId) {
                    // A new document has no active run, even though the old
                    // document acknowledged delivery before crashing/reloading.
                    job = { ...job, dispatched: false, resume: true,
                        mayHaveSent: job.mayHaveSent || !job.phase || ['sending', 'submitted'].includes(job.phase),
                        adapterInstance: message.instanceId, deliveryStartedAt: Date.now() };
                    await chrome.storage.session.set({ [KEY]: job });
                }
                if (job?.aiTab === sender.tab?.id) await dispatch(job);
                return { ok: true, managed: stored[TAB] === sender.tab?.id };
            })().then(respond).catch(error => respond({ error: error.message }));
            return true;
        }
        if (message?.type === 'PARAMEXT_CHATGPT_PHASE' && isChatgpt(sender.url)) {
            (async () => {
                const job = (await chrome.storage.session.get(KEY))[KEY];
                if (!job || job.id !== message.id || job.aiTab !== sender.tab?.id
                    || !['sending', 'submitted'].includes(message.phase)
                    || (job.adapterInstance && job.adapterInstance !== message.instanceId)) return { error: 'ChatGPT request is no longer active' };
                await chrome.storage.session.set({ [KEY]: { ...job,
                    phase: job.phase === 'submitted' ? 'submitted' : message.phase,
                    adapterInstance: message.instanceId, userTurnId: message.userTurnId || job.userTurnId } });
                return { ok: true };
            })().then(respond).catch(error => respond({ error: error.message }));
            return true;
        }
        if (message?.type === 'PARAMEXT_CHATGPT_RESULT' && isChatgpt(sender.url)) {
            (async () => {
                const job = (await chrome.storage.session.get(KEY))[KEY];
                if (job && job.id === message.id && job.aiTab === sender.tab?.id
                    && (!job.adapterInstance || job.adapterInstance === message.instanceId)) {
                    await finish(job, { text: message.text, error: message.error });
                }
            })().catch(() => {});
        }
    });
    chrome.tabs.onUpdated.addListener((id, change) => {
        if (change.status !== 'complete') return;
        chrome.storage.session.get(KEY).then(stored => {
            if (stored[KEY]?.aiTab === id && Date.now() - stored[KEY].createdAt < jobTimeout(stored[KEY])) dispatch(stored[KEY]);
        });
    });
    chrome.tabs.onRemoved.addListener(id => {
        chrome.storage.session.get(KEY).then(stored => {
            if (stored[KEY]?.aiTab === id) finish(stored[KEY], { error: 'ChatGPT tab was closed' });
        });
    });
})();
