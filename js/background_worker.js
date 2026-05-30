function isMissingReceiverError(error) {
    const message = String(error && error.message ? error.message : error || '');
    return message.includes('Could not establish connection')
        && message.includes('Receiving end does not exist');
}

self.addEventListener('unhandledrejection', (event) => {
    if (isMissingReceiverError(event.reason)) {
        event.preventDefault();
    }
});

importScripts('background.js');

const PARAMEXT_SETTINGS_KEY = 'paramExtPlatformSettingsV2';

function getLocalStorage(keys) {
    return new Promise((resolve) => {
        chrome.storage.local.get(keys, (result) => resolve(result || {}));
    });
}

function openPrivacyPolicyTab() {
    chrome.tabs.create({
        url: chrome.runtime.getURL('/html/privacy_policy/index.html')
    });
}

async function ensurePrivacyPolicyTab() {
    const payload = await getLocalStorage(PARAMEXT_SETTINGS_KEY);
    const accepted = Boolean(payload?.[PARAMEXT_SETTINGS_KEY]?.onboarding?.privacyAccepted);
    if (!accepted) {
        openPrivacyPolicyTab();
    }
}

chrome.runtime.onInstalled.addListener(() => {
    ensurePrivacyPolicyTab().catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
    ensurePrivacyPolicyTab().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === 'PARAMEXT_OPEN_PRIVACY_POLICY') {
        openPrivacyPolicyTab();
        sendResponse({ ok: true });
        return;
    }

    if (!message || message.type !== 'PARAMEXT_HTTP' || !message.request || typeof message.request.url !== 'string') {
        return;
    }

    const request = message.request;
    const timeoutMsRaw = Number(request.timeoutMs);
    const timeoutMs = Number.isFinite(timeoutMsRaw) ? Math.max(500, timeoutMsRaw) : 4000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    fetch(request.url, {
        method: typeof request.method === 'string' ? request.method : 'GET',
        headers: request.headers && typeof request.headers === 'object' ? request.headers : undefined,
        body: typeof request.body === 'string' ? request.body : undefined,
        mode: 'cors',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'follow',
        referrerPolicy: 'no-referrer',
        signal: controller.signal
    }).then(async (response) => {
        let text = '';
        try {
            text = await response.text();
        } catch (_) {
            text = '';
        }

        let json = null;
        if (text) {
            try {
                json = JSON.parse(text);
            } catch (_) {
                json = null;
            }
        }

        sendResponse({
            ok: response.ok,
            status: response.status,
            responseType: response.type,
            redirected: response.redirected,
            finalUrl: response.url || request.url,
            error: (!response.ok && Number(response.status || 0) === 0)
                ? ('status_0_' + String(response.type || 'unknown'))
                : '',
            json,
            text
        });
    }).catch((error) => {
        const isTimeout = controller.signal.aborted;
        sendResponse({
            ok: false,
            status: 0,
            error: isTimeout
                ? 'request_timeout'
                : (error && error.message ? error.message : 'request_failed'),
            errorName: error && error.name ? String(error.name) : '',
            isTimeout
        });
    }).finally(() => {
        clearTimeout(timer);
    });

    return true;
});
