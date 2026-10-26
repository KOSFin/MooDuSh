(function () {
    const HOST_RE = /(^|\.)openedu\.ru$/i;
    if (!HOST_RE.test(location.hostname)) return;
    const findUnsupportedTasks = window.ParamExtOpeneduShared.findUnsupportedTasks;

    let timer;
    let lastSignature = '';
    let savedSignature = '';
    let savedFrame = null;
    let inFlight = false;
    let retryAt = 0;

    function taskSignature() {
        const tasks = findUnsupportedTasks(document);
        if (!tasks.length) return '';
        const vertical = document.querySelector('[data-block-type="vertical"][data-usage-id]')?.getAttribute('data-usage-id') || '';
        return location.href + '|' + vertical + '|' + tasks.map(t => t.getAttribute('data-problem-id') || t.getAttribute('data-usage-id') || t.id).join('|');
    }

    function pageSignature() {
        const tabs = [...document.querySelectorAll('.sequence-navigation-tabs button')];
        return location.href + '|' + tabs.findIndex(tab => tab.classList.contains('active'))
            + '|' + [...document.querySelectorAll('iframe[src]')].map(frame => frame.src).join('|');
    }

    function hasSavedUnsupportedTask() {
        if (savedSignature && savedSignature === taskSignature()) return true;
        return Boolean(savedFrame && savedFrame.page === pageSignature()
            && [...document.querySelectorAll('iframe[src]')].some(frame => frame.src === savedFrame.url));
    }

    window.ParamExtOpeneduReminders = { findUnsupportedTasks, hasSavedUnsupportedTask };
    // Remove any notice left by an older content-script version.
    document.getElementById('moodush-openedu-reminder')?.remove();
    if (window === window.top) chrome.runtime.onMessage.addListener(message => {
        if (message?.type !== 'MOODUSH_OPENEDU_REMINDER_STATUS' || !message.result?.ok
            || message.pageUrl !== location.href) return;
        if (![...document.querySelectorAll('iframe[src]')].some(frame => frame.src === message.frameUrl)) return;
        savedFrame = { page: pageSignature(), url: message.frameUrl };
    });

    async function scan() {
        if (inFlight) return;
        const signature = taskSignature();
        if (!signature) { lastSignature = ''; savedSignature = ''; return; }
        if (signature === lastSignature && Date.now() < retryAt) return;
        const vertical = document.querySelector('[data-block-type="vertical"][data-usage-id]')?.getAttribute('data-usage-id') || '';
        inFlight = true;
        try {
            const result = await chrome.runtime.sendMessage({ type: 'MOODUSH_OPENEDU_REMINDER', vertical });
            if (signature !== taskSignature()) return;
            lastSignature = signature;
            savedSignature = result?.ok ? signature : '';
            retryAt = result?.ok ? Infinity : Date.now() + 30000;
        } catch (_) {
            retryAt = Date.now() + 30000;
            lastSignature = signature;
        } finally { inFlight = false; }
    }
    function schedule() { clearTimeout(timer); timer = setTimeout(scan, 600); }
    if (document.documentElement) new MutationObserver(schedule).observe(document.documentElement, {
        childList: true, subtree: true, attributes: true,
        attributeFilter: ['data-content', 'data-usage-id', 'class', 'src']
    });
    setInterval(scan, 5000);
    schedule();
})();
