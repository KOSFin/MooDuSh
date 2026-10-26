(function () {
    const KEY = 'moodushOpeneduReminders';
    const PAGE = chrome.runtime.getURL('html/reminders.html');
    let queue = Promise.resolve();

    function cleanTaskUrl(tabUrl, frameUrl, vertical) {
        const top = new URL(tabUrl);
        const frame = new URL(frameUrl);
        for (const url of [top, frame]) {
            if (url.protocol !== 'https:' || !/(^|\.)openedu\.ru$/i.test(url.hostname)) throw new Error('Invalid OpenEdu origin');
        }
        if (!/^\/(learning\/course\/|courses\/)/.test(top.pathname)) throw new Error('Not an OpenEdu course');
        top.username = ''; top.password = ''; top.hash = '';
        const activeBlock = top.searchParams.get('activate_block_id');
        top.search = '';
        if (activeBlock) top.searchParams.set('activate_block_id', activeBlock);
        if (/^block-v1:[\w.+:-]+\+type@vertical\+block@[\w.-]+$/.test(vertical || '') && top.pathname.startsWith('/learning/course/')) {
            const parts = top.pathname.replace(/\/$/, '').split('/');
            if (parts.length >= 5) {
                if (parts.length >= 6) parts[5] = vertical;
                else parts.push(vertical);
                top.pathname = parts.slice(0, 6).join('/');
            }
        }
        return top.href;
    }

    async function openReminders(active) {
        const tabs = await chrome.tabs.query({ url: PAGE });
        if (tabs[0]) {
            if (active) {
                await chrome.tabs.update(tabs[0].id, { active: true });
                if (chrome.windows?.update && tabs[0].windowId !== undefined) {
                    await chrome.windows.update(tabs[0].windowId, { focused: true });
                }
            }
            return;
        }
        await chrome.tabs.create({ url: PAGE, active });
    }

    async function record(message, sender) {
        const url = cleanTaskUrl(sender.tab?.url, sender.url, message.vertical);
        const stored = await chrome.storage.local.get(KEY);
        const links = Array.isArray(stored[KEY]) ? stored[KEY].filter(x => typeof x === 'string') : [];
        const added = !links.includes(url);
        if (added) {
            links.push(url);
            await chrome.storage.local.set({ [KEY]: links });
        }
        // Reuse the tab, or recreate it when a saved task is encountered again.
        // This also makes links saved before the tab feature immediately visible.
        try { await openReminders(false); } catch (_) { /* The popup can reopen it. */ }
        return { ok: true, count: links.length };
    }

    async function handle(message, sender) {
        if (message.type === 'MOODUSH_OPENEDU_REMINDER') return record(message, sender);
        if (message.type === 'MOODUSH_OPEN_REMINDERS') {
            await openReminders(true);
            return { ok: true };
        }
        if (sender.url !== PAGE) throw new Error('Only the reminders page can remove links');
        const stored = await chrome.storage.local.get(KEY);
        const links = Array.isArray(stored[KEY]) ? stored[KEY] : [];
        await chrome.storage.local.set({ [KEY]: links.filter(url => url !== message.url) });
        return { ok: true };
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!['MOODUSH_OPENEDU_REMINDER', 'MOODUSH_OPEN_REMINDERS', 'MOODUSH_REMOVE_REMINDER'].includes(message?.type)) return;
        queue = queue.catch(() => {}).then(() => handle(message, sender));
        const respond = result => {
            if (message.type === 'MOODUSH_OPENEDU_REMINDER' && sender.tab?.id !== undefined && chrome.tabs?.sendMessage) {
                chrome.tabs.sendMessage(sender.tab.id, {
                    type: 'MOODUSH_OPENEDU_REMINDER_STATUS', pageUrl: sender.tab.url, frameUrl: sender.url, result
                }, { frameId: 0 }, () => { void chrome.runtime.lastError; });
            }
            sendResponse(result);
        };
        queue.then(respond, error => respond({ ok: false, error: error.message }));
        return true;
    });
})();
