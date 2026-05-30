(function () {
    const V2_KEY = 'paramExtPlatformSettingsV2';
    const LEGACY_KEY = 'paramExtSettings';

    function storageGet(keys) {
        return new Promise((resolve) => {
            chrome.storage.local.get(keys, (result) => resolve(result || {}));
        });
    }

    function storageSet(payload) {
        return new Promise((resolve) => {
            chrome.storage.local.set(payload, () => resolve());
        });
    }

    function defaultSettings() {
        return {
            activePlatform: 'openedu',
            backend: {
                moodle: { apiBaseUrl: 'https://syncshare.naloaty.me/api', apiToken: '', requestTimeoutMs: 4000 },
                openedu: { apiBaseUrl: 'https://syncshare.naloaty.me/api', apiToken: '', requestTimeoutMs: 4000 }
            },
            onboarding: {
                privacyAccepted: false,
                allowTechnicalDataCollection: true,
                completed: false
            },
            moodle: {
                mode: 'wand',
                wandHotkey: 'Escape',
                nextButtonText: 'Следующая страница',
                autoSolving: false,
                hideWidgetByDefault: false
            },
            openedu: {
                mode: 'stick',
                backendVersion: 'v2',
                stickHotkey: 'Alt+KeyS',
                autoAdvanceEnabled: false,
                activeTabRefreshEnabled: true,
                activeTabPostSubmitRefreshEnabled: false,
                autoAdvanceDelayMs: 1800,
                requiredCompletionOnly: true,
                showFallbackStats: true,
                autoUseSimilarAnswers: false,
                autoUseFallbackAnswers: false,
                autoCheckAnswers: false,
                missingAnswerAction: 'stop'
            },
            diagnostics: {
                openeduDebugOverlay: false
            }
        };
    }

    async function markAccepted() {
        const payload = await storageGet([V2_KEY, LEGACY_KEY]);
        const settings = Object.assign(defaultSettings(), payload[V2_KEY] || {});
        settings.onboarding = Object.assign(defaultSettings().onboarding, settings.onboarding || {}, {
            privacyAccepted: true,
            allowTechnicalDataCollection: document.getElementById('technicalConsent')?.checked !== false
        });
        settings.onboarding.completed = Boolean(settings.onboarding.privacyAccepted && settings.backend?.openedu?.apiToken);

        const legacy = Object.assign({}, payload[LEGACY_KEY] || {}, {
            privacyPolicyAcceptedByUser: true,
            allowTechnicalDataCollection: settings.onboarding.allowTechnicalDataCollection
        });

        await storageSet({
            [V2_KEY]: settings,
            [LEGACY_KEY]: legacy
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('acceptBtn')?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            markAccepted().finally(() => window.close());
        }, { capture: true });
    });
})();
