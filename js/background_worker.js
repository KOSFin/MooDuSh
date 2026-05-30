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

const PRIVACY_POLICY_PATH = '/html/privacy_policy/index.html';
let nativeTabsCreate = null;
let nativeTabsQuery = null;
let nativeTabsUpdate = null;
let nativeWindowsUpdate = null;
let privacyPolicyCreateGuardInFlight = false;

function isPrivacyPolicyUrl(url) {
    const value = String(url || '');
    return value.includes(PRIVACY_POLICY_PATH) || value.includes('/html/privacy_policy/index.html');
}

function installPrivacyPolicyTabsGuard() {
    if (typeof chrome === 'undefined' || !chrome.tabs || typeof chrome.tabs.create !== 'function') {
        return;
    }

    nativeTabsCreate = chrome.tabs.create.bind(chrome.tabs);
    nativeTabsQuery = typeof chrome.tabs.query === 'function' ? chrome.tabs.query.bind(chrome.tabs) : null;
    nativeTabsUpdate = typeof chrome.tabs.update === 'function' ? chrome.tabs.update.bind(chrome.tabs) : null;
    nativeWindowsUpdate = chrome.windows && typeof chrome.windows.update === 'function'
        ? chrome.windows.update.bind(chrome.windows)
        : null;

    chrome.tabs.create = (createProperties, callback) => {
        const url = createProperties && typeof createProperties === 'object' ? createProperties.url : '';
        if (!isPrivacyPolicyUrl(url)) {
            return nativeTabsCreate(createProperties, callback);
        }

        openPrivacyPolicyTabGuarded(url, callback);
        return undefined;
    };
}

function openPrivacyPolicyTabGuarded(url, callback) {
    if (privacyPolicyCreateGuardInFlight) {
        if (typeof callback === 'function') {
            callback();
        }
        return;
    }

    privacyPolicyCreateGuardInFlight = true;
    const finalUrl = url || chrome.runtime.getURL(PRIVACY_POLICY_PATH);
    const done = (tab) => {
        privacyPolicyCreateGuardInFlight = false;
        if (typeof callback === 'function') {
            callback(tab);
        }
    };

    if (!nativeTabsQuery) {
        nativeTabsCreate({ url: finalUrl }, done);
        return;
    }

    nativeTabsQuery({ url: finalUrl }, (tabs) => {
        if (!chrome.runtime.lastError && Array.isArray(tabs) && tabs[0] && typeof tabs[0].id === 'number') {
            const tab = tabs[0];
            if (nativeTabsUpdate) {
                nativeTabsUpdate(tab.id, { active: true }, () => {});
            }
            if (nativeWindowsUpdate && typeof tab.windowId === 'number') {
                nativeWindowsUpdate(tab.windowId, { focused: true }, () => {});
            }
            done(tab);
            return;
        }
        nativeTabsCreate({ url: finalUrl }, done);
    });
}

installPrivacyPolicyTabsGuard();
importScripts('background.js');

const PARAMEXT_SETTINGS_KEY = 'paramExtPlatformSettingsV2';
const PARAMEXT_LEGACY_SETTINGS_KEY = 'paramExtSettings';
const PARAMEXT_OLD_SETTINGS_KEY = 'settings';
let privacyPolicyOpenInFlight = false;

function getLocalStorage(keys) {
    return new Promise((resolve) => {
        chrome.storage.local.get(keys, (result) => resolve(result || {}));
    });
}

function queryPrivacyPolicyTabs(url) {
    return new Promise((resolve) => {
        if (!chrome.tabs || typeof chrome.tabs.query !== 'function') {
            resolve([]);
            return;
        }
        chrome.tabs.query({ url }, (tabs) => {
            if (chrome.runtime.lastError) {
                resolve([]);
                return;
            }
            resolve(Array.isArray(tabs) ? tabs : []);
        });
    });
}

async function openPrivacyPolicyTab() {
    if (privacyPolicyOpenInFlight) {
        return;
    }
    privacyPolicyOpenInFlight = true;
    const url = chrome.runtime.getURL('/html/privacy_policy/index.html');
    const existing = await queryPrivacyPolicyTabs(url);
    const tab = existing[0];
    if (tab && typeof tab.id === 'number') {
        chrome.tabs.update(tab.id, { active: true }, () => {});
        if (typeof tab.windowId === 'number') {
            chrome.windows?.update?.(tab.windowId, { focused: true }, () => {});
        }
    } else {
        chrome.tabs.create({ url });
    }
    setTimeout(() => {
        privacyPolicyOpenInFlight = false;
    }, 2000);
}

async function seedOldPrivacySettings() {
    const payload = await getLocalStorage([PARAMEXT_SETTINGS_KEY, PARAMEXT_LEGACY_SETTINGS_KEY, PARAMEXT_OLD_SETTINGS_KEY]);
    const accepted = Boolean(
        payload?.[PARAMEXT_SETTINGS_KEY]?.onboarding?.privacyAccepted
        || payload?.[PARAMEXT_LEGACY_SETTINGS_KEY]?.privacyPolicyAcceptedByUser
        || payload?.[PARAMEXT_OLD_SETTINGS_KEY]?.privacyPolicyAcceptedByUser
    );
    if (!accepted) {
        return false;
    }
    const oldSettings = Object.assign({}, payload[PARAMEXT_OLD_SETTINGS_KEY] || {}, {
        privacyPolicyAcceptedByUser: true
    });
    chrome.storage.local.set({ [PARAMEXT_OLD_SETTINGS_KEY]: oldSettings }, () => {});
    return true;
}

async function ensurePrivacyPolicyTab() {
    const payload = await getLocalStorage([PARAMEXT_SETTINGS_KEY, PARAMEXT_LEGACY_SETTINGS_KEY, PARAMEXT_OLD_SETTINGS_KEY]);
    const accepted = Boolean(
        payload?.[PARAMEXT_SETTINGS_KEY]?.onboarding?.privacyAccepted
        || payload?.[PARAMEXT_LEGACY_SETTINGS_KEY]?.privacyPolicyAcceptedByUser
        || payload?.[PARAMEXT_OLD_SETTINGS_KEY]?.privacyPolicyAcceptedByUser
    );
    if (!accepted) {
        await openPrivacyPolicyTab();
    }
}

chrome.runtime.onInstalled.addListener(() => {
    seedOldPrivacySettings()
        .then((accepted) => {
            if (!accepted) {
                return ensurePrivacyPolicyTab();
            }
            return null;
        })
        .catch(() => {});
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
