(function (global) {
    const STORAGE_KEY = 'paramExtPlatformSettingsV2';
    const LEGACY_KEY = 'paramExtSettings';

    const DEFAULT_BACKEND_CONFIG = {
        apiBaseUrl: 'https://syncshare.naloaty.me/api',
        apiToken: '',
        requestTimeoutMs: 4000
    };

    const buildConfig = global.ParamExtBuildConfig || {};

    const DEFAULT_SETTINGS = {
        activePlatform: 'openedu',
        backend: {
            moodle: Object.assign(deepClone(DEFAULT_BACKEND_CONFIG), {
                apiBaseUrl: buildConfig.moodleApiBaseUrl || DEFAULT_BACKEND_CONFIG.apiBaseUrl
            }),
            openedu: Object.assign(deepClone(DEFAULT_BACKEND_CONFIG), {
                apiBaseUrl: buildConfig.openeduApiBaseUrl || DEFAULT_BACKEND_CONFIG.apiBaseUrl
            })
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

    function deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function toNumberOrFallback(value, fallback) {
        const num = Number(value);
        return Number.isFinite(num) ? num : fallback;
    }

    function normalizeHotkey(value, fallback) {
        if (typeof value !== 'string') {
            return fallback;
        }
        const normalized = value.trim();
        return normalized.length > 0 ? normalized : fallback;
    }

    function normalizeSettings(raw) {
        const next = deepClone(DEFAULT_SETTINGS);
        const source = raw && typeof raw === 'object' ? raw : {};

        if (source.activePlatform === 'moodle' || source.activePlatform === 'openedu') {
            next.activePlatform = source.activePlatform;
        }

        if (source.backend && typeof source.backend === 'object') {
            const backend = source.backend;
            const hasPlatformBackend = backend.moodle || backend.openedu;

            if (hasPlatformBackend) {
                ['moodle', 'openedu'].forEach((platform) => {
                    const current = backend[platform];
                    if (!current || typeof current !== 'object') {
                        return;
                    }

                    if (typeof current.apiBaseUrl === 'string' && current.apiBaseUrl.trim().length > 0) {
                        next.backend[platform].apiBaseUrl = current.apiBaseUrl.trim().replace(/\/$/, '');
                    }
                    if (typeof current.apiToken === 'string') {
                        next.backend[platform].apiToken = current.apiToken.trim();
                    }
                    next.backend[platform].requestTimeoutMs = Math.max(1000, toNumberOrFallback(current.requestTimeoutMs, next.backend[platform].requestTimeoutMs));
                });
            } else {
                if (typeof backend.apiBaseUrl === 'string' && backend.apiBaseUrl.trim().length > 0) {
                    const normalizedUrl = backend.apiBaseUrl.trim().replace(/\/$/, '');
                    next.backend.moodle.apiBaseUrl = normalizedUrl;
                    next.backend.openedu.apiBaseUrl = normalizedUrl;
                }
                if (typeof backend.apiToken === 'string') {
                    const token = backend.apiToken.trim();
                    next.backend.moodle.apiToken = token;
                    next.backend.openedu.apiToken = token;
                }
                const timeoutMs = Math.max(1000, toNumberOrFallback(backend.requestTimeoutMs, next.backend.openedu.requestTimeoutMs));
                next.backend.moodle.requestTimeoutMs = timeoutMs;
                next.backend.openedu.requestTimeoutMs = timeoutMs;
            }
        }

        if (source.moodle && typeof source.moodle === 'object') {
            const moodle = source.moodle;
            if (moodle.mode === 'wand' || moodle.mode === 'autoInsert' || moodle.mode === 'autoSolve') {
                next.moodle.mode = moodle.mode;
            }
            next.moodle.wandHotkey = normalizeHotkey(moodle.wandHotkey, next.moodle.wandHotkey);
            if (typeof moodle.nextButtonText === 'string' && moodle.nextButtonText.trim().length > 0) {
                next.moodle.nextButtonText = moodle.nextButtonText.trim();
            }
            next.moodle.autoSolving = Boolean(moodle.autoSolving);
            next.moodle.hideWidgetByDefault = Boolean(moodle.hideWidgetByDefault);
        }

        if (source.openedu && typeof source.openedu === 'object') {
            const openedu = source.openedu;
            if (openedu.mode === 'stick' || openedu.mode === 'assist' || openedu.mode === 'autoSolve') {
                next.openedu.mode = openedu.mode;
            }
            next.openedu.stickHotkey = normalizeHotkey(openedu.stickHotkey, next.openedu.stickHotkey);
            next.openedu.autoAdvanceEnabled = Boolean(openedu.autoAdvanceEnabled);
            next.openedu.activeTabRefreshEnabled = Boolean(openedu.activeTabRefreshEnabled);
            next.openedu.activeTabPostSubmitRefreshEnabled = Boolean(openedu.activeTabPostSubmitRefreshEnabled);
            next.openedu.requiredCompletionOnly = Boolean(openedu.requiredCompletionOnly);
            next.openedu.showFallbackStats = Boolean(openedu.showFallbackStats);
            next.openedu.autoUseSimilarAnswers = Boolean(openedu.autoUseSimilarAnswers);
            next.openedu.autoUseFallbackAnswers = Boolean(openedu.autoUseFallbackAnswers);
            next.openedu.autoCheckAnswers = Boolean(openedu.autoCheckAnswers);
            if (openedu.missingAnswerAction === 'stop' || openedu.missingAnswerAction === 'advance' || openedu.missingAnswerAction === 'alert') {
                next.openedu.missingAnswerAction = openedu.missingAnswerAction;
            }
            next.openedu.autoAdvanceDelayMs = Math.max(500, toNumberOrFallback(openedu.autoAdvanceDelayMs, next.openedu.autoAdvanceDelayMs));
        }

        if (source.onboarding && typeof source.onboarding === 'object') {
            next.onboarding.privacyAccepted = Boolean(source.onboarding.privacyAccepted);
            next.onboarding.allowTechnicalDataCollection = source.onboarding.allowTechnicalDataCollection !== false;
            next.onboarding.completed = Boolean(source.onboarding.completed);
        }

        if (source.diagnostics && typeof source.diagnostics === 'object') {
            next.diagnostics.openeduDebugOverlay = Boolean(source.diagnostics.openeduDebugOverlay);
        }

        return next;
    }

    function toLegacySettings(raw) {
        const normalized = normalizeSettings(raw);
        return {
            mode: normalized.moodle.mode,
            wandKey: normalized.moodle.wandHotkey,
            nextBtnText: normalized.moodle.nextButtonText,
            autoSolving: normalized.moodle.autoSolving,
            hideWidgetByDefault: normalized.moodle.hideWidgetByDefault,
            privacyPolicyAcceptedByUser: normalized.onboarding.privacyAccepted,
            allowTechnicalDataCollection: normalized.onboarding.allowTechnicalDataCollection,
            backend: {
                apiBaseUrl: normalized.backend.moodle.apiBaseUrl,
                apiToken: normalized.backend.moodle.apiToken,
                requestTimeoutMs: normalized.backend.moodle.requestTimeoutMs
            }
        };
    }

    function storageGet(key) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.get(key, (result) => {
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                    reject(lastError);
                    return;
                }
                resolve(result);
            });
        });
    }

    function storageSet(value) {
        return new Promise((resolve, reject) => {
            chrome.storage.local.set(value, () => {
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                    reject(lastError);
                    return;
                }
                resolve();
            });
        });
    }

    async function migrateFromLegacy() {
        try {
            const payload = await storageGet(LEGACY_KEY);
            const legacy = payload[LEGACY_KEY];
            if (!legacy || typeof legacy !== 'object') {
                return null;
            }

            const migrated = deepClone(DEFAULT_SETTINGS);
            if (legacy.mode === 'wand' || legacy.mode === 'autoInsert' || legacy.mode === 'autoSolve') {
                migrated.moodle.mode = legacy.mode;
            }
            if (typeof legacy.wandKey === 'string' && legacy.wandKey.trim().length > 0) {
                migrated.moodle.wandHotkey = legacy.wandKey.trim();
            }
            if (typeof legacy.nextBtnText === 'string' && legacy.nextBtnText.trim().length > 0) {
                migrated.moodle.nextButtonText = legacy.nextBtnText.trim();
            }
            migrated.moodle.autoSolving = Boolean(legacy.autoSolving);

            await storageSet({
                [STORAGE_KEY]: migrated,
                [LEGACY_KEY]: toLegacySettings(migrated)
            });
            return migrated;
        } catch (_) {
            return null;
        }
    }

    async function getSettings() {
        try {
            const payload = await storageGet(STORAGE_KEY);
            if (payload[STORAGE_KEY]) {
                const normalized = normalizeSettings(payload[STORAGE_KEY]);
                await storageSet({ [LEGACY_KEY]: toLegacySettings(normalized) });
                return normalized;
            }

            const migrated = await migrateFromLegacy();
            if (migrated) {
                return normalizeSettings(migrated);
            }

            await storageSet({
                [STORAGE_KEY]: DEFAULT_SETTINGS,
                [LEGACY_KEY]: toLegacySettings(DEFAULT_SETTINGS)
            });
            return deepClone(DEFAULT_SETTINGS);
        } catch (_) {
            return deepClone(DEFAULT_SETTINGS);
        }
    }

    async function saveSettings(settings) {
        const normalized = normalizeSettings(settings);
        await storageSet({
            [STORAGE_KEY]: normalized,
            [LEGACY_KEY]: toLegacySettings(normalized)
        });
        return normalized;
    }

    async function clearBackendApiBaseUrl(platform) {
        const selected = platform === 'moodle' ? 'moodle' : 'openedu';
        const payload = await storageGet(STORAGE_KEY);
        const raw = payload[STORAGE_KEY] && typeof payload[STORAGE_KEY] === 'object'
            ? deepClone(payload[STORAGE_KEY])
            : {};

        if (raw.backend && typeof raw.backend === 'object') {
            if (raw.backend[selected] && typeof raw.backend[selected] === 'object') {
                delete raw.backend[selected].apiBaseUrl;
            }

            // Legacy shape fallback where backend settings were shared.
            if (Object.prototype.hasOwnProperty.call(raw.backend, 'apiBaseUrl')) {
                delete raw.backend.apiBaseUrl;
            }
        }

        const normalized = normalizeSettings(raw);
        await storageSet({
            [STORAGE_KEY]: raw,
            [LEGACY_KEY]: toLegacySettings(normalized)
        });
        return normalized;
    }

    function serializeHotkey(event) {
        const parts = [];
        if (event.ctrlKey) {
            parts.push('Ctrl');
        }
        if (event.altKey) {
            parts.push('Alt');
        }
        if (event.shiftKey) {
            parts.push('Shift');
        }
        if (event.metaKey) {
            parts.push('Meta');
        }

        const keyCode = event.code || event.key;
        if (!keyCode) {
            return parts.join('+');
        }

        const blockedModifierOnly = ['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'ShiftLeft', 'ShiftRight', 'MetaLeft', 'MetaRight'];
        if (blockedModifierOnly.includes(keyCode)) {
            return parts.join('+');
        }

        parts.push(keyCode);
        return parts.join('+');
    }

    function parseHotkey(raw) {
        const normalized = normalizeHotkey(raw, '');
        if (!normalized) {
            return { ctrl: false, alt: false, shift: false, meta: false, key: '' };
        }

        const chunks = normalized.split('+').map((chunk) => chunk.trim()).filter(Boolean);
        const parsed = { ctrl: false, alt: false, shift: false, meta: false, key: '' };

        for (const chunk of chunks) {
            if (chunk === 'Ctrl') {
                parsed.ctrl = true;
            } else if (chunk === 'Alt') {
                parsed.alt = true;
            } else if (chunk === 'Shift') {
                parsed.shift = true;
            } else if (chunk === 'Meta') {
                parsed.meta = true;
            } else {
                parsed.key = chunk;
            }
        }

        return parsed;
    }

    function hotkeyMatches(event, hotkeyRaw) {
        const hotkey = parseHotkey(hotkeyRaw);
        if (!hotkey.key) {
            return false;
        }

        return (
            event.ctrlKey === hotkey.ctrl &&
            event.altKey === hotkey.alt &&
            event.shiftKey === hotkey.shift &&
            event.metaKey === hotkey.meta &&
            (event.code === hotkey.key || event.key === hotkey.key)
        );
    }

    function getBackendByPlatform(settings, platform) {
        const normalized = normalizeSettings(settings);
        const selected = platform === 'moodle' ? 'moodle' : 'openedu';
        return deepClone(normalized.backend[selected]);
    }

    global.ParamExtSettings = {
        STORAGE_KEY,
        DEFAULT_SETTINGS,
        normalizeSettings,
        getSettings,
        saveSettings,
        clearBackendApiBaseUrl,
        serializeHotkey,
        parseHotkey,
        hotkeyMatches,
        getBackendByPlatform
    };
})(globalThis);
