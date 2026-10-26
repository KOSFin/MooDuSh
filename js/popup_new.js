document.addEventListener('DOMContentLoaded', async () => {
    if (!window.ParamExtSettings) {
        return;
    }

    const buildConfig = window.ParamExtBuildConfig || {};
    const manifest = chrome.runtime.getManifest();
    const settingsApi = window.ParamExtSettings;
    const $ = (id) => document.getElementById(id);

    if (window.ParamExtTelemetry) {
        window.ParamExtTelemetry.installGlobalHandlers('popup');
    }

    $('openRemindersBtn').addEventListener('click', async () => {
        await chrome.runtime.sendMessage({ type: 'MOODUSH_OPEN_REMINDERS' });
        window.close();
    });

    const refs = {
        mainLogo: $('mainLogo'),
        headerStatus: $('headerStatus'),
        versionPill: $('versionPill'),
        telegramChannelLink: $('telegramChannelLink'),
        openSetupBtn: $('openSetupBtn'),
        privacyScreen: $('privacyScreen'),
        openPrivacyBtn: $('openPrivacyBtn'),
        refreshPrivacyBtn: $('refreshPrivacyBtn'),
        setupScreen: $('setupScreen'),
        setupBackBtn: $('setupBackBtn'),
        setupContinueBtn: $('setupContinueBtn'),
        setupMoodleOnlyBtn: $('setupMoodleOnlyBtn'),
        setupDescription: $('setupDescription'),
        appScreen: $('appScreen'),
        botLink: $('botLink'),
        customBackendToggle: $('customBackendToggle'),
        customBackendFields: $('customBackendFields'),
        backendApiBaseUrl: $('backendApiBaseUrl'),
        backendApiToken: $('backendApiToken'),
        backendRequestTimeoutMs: $('backendRequestTimeoutMs'),
        openeduBackendVersion: $('openeduBackendVersion'),
        backendPingBtn: $('backendPingBtn'),
        backendResetUrlBtn: $('backendResetUrlBtn'),
        backendPingStatus: $('backendPingStatus'),
        backendCompactStatus: $('backendCompactStatus'),
        backendVersionStatus: $('backendVersionStatus'),
        platformMoodle: $('platformMoodle'),
        platformOpenedu: $('platformOpenedu'),
        moodleSettings: $('moodleSettings'),
        openeduSettings: $('openeduSettings'),
        statsPanel: $('statsPanel'),
        diagnosticsPanel: $('diagnosticsPanel'),
        autoSolveControls: $('autoSolveControls'),
        btnStart: $('btnStart'),
        btnStop: $('btnStop'),
        wandKey: $('wandKey'),
        moodleAutoInsertOnLoad: $('moodleAutoInsertOnLoad'),
        moodleInsertKey: $('moodleInsertKey'),
        nextBtnSelector: $('nextBtnSelector'),
        openeduHotkey: $('openeduHotkey'),
        openeduStickOptions: $('openeduStickOptions'),
        openeduAssistOptions: $('openeduAssistOptions'),
        openeduAutoOptions: $('openeduAutoOptions'),
        requiredCompletionRow: $('requiredCompletionRow'),
        openeduAutoAdvanceEnabled: $('openeduAutoAdvanceEnabled'),
        openeduRequiredCompletionOnly: $('openeduRequiredCompletionOnly'),
        openeduActiveTabRefreshEnabled: $('openeduActiveTabRefreshEnabled'),
        openeduActiveTabPostSubmitRefreshEnabled: $('openeduActiveTabPostSubmitRefreshEnabled'),
        openeduShowFallbackStats: $('openeduShowFallbackStats'),
        openeduAutoUseSimilarAnswers: $('openeduAutoUseSimilarAnswers'),
        openeduAutoUseFallbackAnswers: $('openeduAutoUseFallbackAnswers'),
        openeduAutoCheckAnswers: $('openeduAutoCheckAnswers'),
        openeduMissingAnswerAction: $('openeduMissingAnswerAction'),
        openeduUnsupportedTaskAction: $('openeduUnsupportedTaskAction'),
        openeduChatgptAnswerTimeoutMinutes: $('openeduChatgptAnswerTimeoutMinutes'),
        openeduAutoAdvanceDelayMs: $('openeduAutoAdvanceDelayMs'),
        openeduDebugOverlay: $('openeduDebugOverlay'),
        statsRefreshBtn: $('statsRefreshBtn'),
        statCourses: $('statCourses'),
        statTests: $('statTests'),
        statQuestions: $('statQuestions'),
        statCompletions: $('statCompletions'),
        updateCheckBtn: $('updateCheckBtn'),
        updateStatus: $('updateStatus'),
        buildStatus: $('buildStatus'),
        btnSave: $('btnSave')
    };

    let settings = await settingsApi.getSettings();
    let setupOpenedFromApp = false;
    let saveTimer = 0;
    let startupEventsReported = false;

    refs.versionPill.textContent = 'v' + (manifest.version || 'unknown');
    refs.buildStatus.textContent = String(buildConfig.buildChannel || 'local') + ' / ' + String(buildConfig.buildId || 'local-dev').slice(0, 8);
    const configuredBotLink = String(buildConfig.botLink || '').trim();
    const configuredTelegramChannelLink = String(buildConfig.telegramChannelLink || buildConfig.telegramLink || '').trim();
    refs.telegramChannelLink.href = configuredTelegramChannelLink || '#';
    refs.telegramChannelLink.classList.toggle('hidden', !configuredTelegramChannelLink);
    refs.botLink.href = configuredBotLink || '#';
    refs.botLink.classList.toggle('hidden', !configuredBotLink);
    refs.mainLogo?.addEventListener('error', () => {
        refs.mainLogo.src = '../../logo_main.png';
    });

    function defaultOpeneduUrl() {
        return buildConfig.openeduApiBaseUrl || settingsApi.DEFAULT_SETTINGS.backend.openedu.apiBaseUrl;
    }

    function endpointPrefix() {
        return (refs.openeduBackendVersion.value || settings.openedu.backendVersion || 'v2') === 'v1' ? '/v1' : '/v2';
    }

    function isMoodleOnlyMode() {
        return Boolean(settings.onboarding?.moodleOnly && !settings.backend?.openedu?.apiToken);
    }

    function getVisibleTab(name) {
        const preferred = ['openedu', 'moodle', 'stats', 'diagnostics'].includes(name) ? name : 'openedu';
        if (isMoodleOnlyMode() && (preferred === 'openedu' || preferred === 'stats')) {
            return 'moodle';
        }
        return preferred;
    }

    function setRadio(name, value) {
        Array.from(document.getElementsByName(name)).forEach((radio) => {
            radio.checked = radio.value === value;
        });
    }

    function radioValue(name, fallback) {
        const checked = Array.from(document.getElementsByName(name)).find((radio) => radio.checked);
        return checked ? checked.value : fallback;
    }

    function sendToActiveTab(message) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabId = tabs && tabs[0] ? tabs[0].id : null;
            if (!tabId) {
                return;
            }
            chrome.tabs.sendMessage(tabId, message, () => {
                const lastError = chrome.runtime.lastError;
                if (lastError) {
                    return;
                }
            });
        });
    }

    function showScreen(name) {
        refs.privacyScreen.classList.toggle('hidden', name !== 'privacy');
        refs.setupScreen.classList.toggle('hidden', name !== 'setup');
        refs.appScreen.classList.toggle('hidden', name !== 'app');
        refs.openSetupBtn.classList.toggle('hidden', name !== 'app');
        refs.setupBackBtn.classList.toggle('hidden', !setupOpenedFromApp);
        refs.headerStatus.textContent = name === 'privacy'
            ? 'Нужно согласие'
            : (name === 'setup' ? (isMoodleOnlyMode() ? 'Подключение OpenEdu' : 'Нужно подключение') : 'Готово к работе');
    }

    function route() {
        const accepted = Boolean(settings.onboarding?.privacyAccepted);
        const hasToken = Boolean(settings.backend?.openedu?.apiToken);
        const moodleOnly = Boolean(settings.onboarding?.moodleOnly);
        if (!accepted) {
            showScreen('privacy');
        } else if ((!hasToken && !moodleOnly) || setupOpenedFromApp) {
            showScreen('setup');
        } else {
            showScreen('app');
        }
    }

    function setTab(name, persist) {
        const visibleName = getVisibleTab(name);
        document.querySelectorAll('.tab').forEach((tab) => {
            tab.classList.toggle('active', tab.dataset.tab === visibleName);
        });
        refs.openeduSettings.classList.toggle('hidden', visibleName !== 'openedu');
        refs.moodleSettings.classList.toggle('hidden', visibleName !== 'moodle');
        refs.statsPanel.classList.toggle('hidden', visibleName !== 'stats');
        refs.diagnosticsPanel.classList.toggle('hidden', visibleName !== 'diagnostics');
        settings.ui = settings.ui || {};
        settings.ui.lastTab = visibleName;
        if (persist) {
            scheduleAppSave('last-tab');
        }
    }

    function updateModeVisibility() {
        const openeduMode = radioValue('openeduMode', settings.openedu.mode);
        const moodleMode = radioValue('moodleMode', settings.moodle.mode);
        refs.openeduStickOptions.classList.toggle('hidden', openeduMode !== 'stick');
        refs.openeduAssistOptions.classList.toggle('hidden', openeduMode === 'stick');
        refs.openeduAutoOptions.classList.toggle('hidden', openeduMode !== 'autoSolve');
        refs.requiredCompletionRow.classList.toggle('hidden', !refs.openeduAutoAdvanceEnabled.checked);
        refs.autoSolveControls.classList.toggle('hidden', moodleMode !== 'autoSolve');
        refs.btnStart.classList.toggle('hidden', Boolean(settings.moodle.autoSolving));
        refs.btnStop.classList.toggle('hidden', !settings.moodle.autoSolving);
    }

    function getOpeneduBackendUiState() {
        const openeduBackend = settings.backend.openedu || {};
        const defaultUrl = defaultOpeneduUrl();
        const moodleDefault = buildConfig.moodleApiBaseUrl || settingsApi.DEFAULT_SETTINGS.backend.moodle.apiBaseUrl;
        const currentUrl = String(openeduBackend.apiBaseUrl || '').trim();
        const shouldForceDefault =
            !settings.onboarding?.completed
            && !openeduBackend.apiToken
            && currentUrl
            && defaultUrl
            && currentUrl === moodleDefault
            && defaultUrl !== moodleDefault;

        return {
            apiBaseUrl: shouldForceDefault ? defaultUrl : (currentUrl || defaultUrl),
            isCustom: !shouldForceDefault && Boolean(currentUrl && currentUrl !== defaultUrl)
        };
    }

    function applyStateToUi() {
        const openeduBackend = settings.backend.openedu;
        const uiBackend = getOpeneduBackendUiState();
        refs.backendApiBaseUrl.value = uiBackend.apiBaseUrl;
        refs.backendApiToken.value = openeduBackend.apiToken || '';
        refs.backendRequestTimeoutMs.value = String(openeduBackend.requestTimeoutMs || 4000);
        refs.openeduBackendVersion.value = settings.openedu.backendVersion || 'v2';
        refs.backendVersionStatus.textContent = String(refs.openeduBackendVersion.value || 'v2').toUpperCase();
        refs.customBackendToggle.checked = uiBackend.isCustom;
        refs.customBackendFields.classList.toggle('hidden', !uiBackend.isCustom);

        setRadio('openeduMode', settings.openedu.mode);
        setRadio('moodleMode', settings.moodle.mode);
        refs.wandKey.value = settings.moodle.wandHotkey;
        refs.moodleAutoInsertOnLoad.checked = settings.moodle.autoInsertOnLoad !== false;
        refs.moodleInsertKey.value = settings.moodle.insertHotkey;
        refs.nextBtnSelector.value = settings.moodle.nextButtonText;
        refs.openeduHotkey.value = settings.openedu.stickHotkey;
        refs.openeduAutoAdvanceEnabled.checked = settings.openedu.autoAdvanceEnabled;
        refs.openeduRequiredCompletionOnly.checked = settings.openedu.requiredCompletionOnly;
        refs.openeduActiveTabRefreshEnabled.checked = settings.openedu.activeTabRefreshEnabled;
        refs.openeduActiveTabPostSubmitRefreshEnabled.checked = settings.openedu.activeTabPostSubmitRefreshEnabled;
        refs.openeduShowFallbackStats.checked = settings.openedu.showFallbackStats;
        refs.openeduAutoUseSimilarAnswers.checked = settings.openedu.autoUseSimilarAnswers;
        refs.openeduAutoUseFallbackAnswers.checked = settings.openedu.autoUseFallbackAnswers;
        refs.openeduAutoCheckAnswers.checked = settings.openedu.autoCheckAnswers;
        refs.openeduMissingAnswerAction.value = settings.openedu.missingAnswerAction;
        refs.openeduUnsupportedTaskAction.value = settings.openedu.unsupportedTaskAction;
        refs.openeduChatgptAnswerTimeoutMinutes.value = String(settings.openedu.chatgptAnswerTimeoutMinutes);
        refs.openeduAutoAdvanceDelayMs.value = String(settings.openedu.autoAdvanceDelayMs);
        refs.openeduDebugOverlay.checked = Boolean(settings.diagnostics?.openeduDebugOverlay);
        const moodleOnly = isMoodleOnlyMode();
        const activePlatform = moodleOnly ? 'moodle' : settings.activePlatform;
        refs.platformOpenedu.classList.toggle('active', activePlatform === 'openedu');
        refs.platformMoodle.classList.toggle('active', activePlatform === 'moodle');
        refs.platformOpenedu.textContent = activePlatform === 'openedu' ? 'Активно' : 'Сделать активным';
        refs.platformMoodle.textContent = activePlatform === 'moodle' ? 'Активно' : 'Сделать активным';
        document.querySelectorAll('.tab[data-tab="openedu"], .tab[data-tab="stats"]').forEach((tab) => {
            tab.classList.toggle('hidden', moodleOnly);
        });
        refs.setupDescription.textContent = moodleOnly
            ? 'Moodle уже доступен без Telegram-ключа. Чтобы вернуть OpenEdu, получите ключ у бота и подключите его здесь.'
            : 'Откройте бота, получите персональный ключ и вставьте его ниже. Если нужен только Moodle, этот шаг можно пропустить.';
        refs.setupContinueBtn.textContent = moodleOnly ? 'Проверить и подключить OpenEdu' : 'Проверить и продолжить';
        refs.setupMoodleOnlyBtn.textContent = moodleOnly ? 'Оставаться только с Moodle' : 'Использовать только Moodle';
        refs.setupMoodleOnlyBtn.classList.toggle('hidden', Boolean(refs.backendApiToken.value.trim()));
        updateModeVisibility();
        setTab(settings.ui?.lastTab || settings.activePlatform || 'openedu', false);
        route();
    }

    function collectStateFromUi() {
        const next = JSON.parse(JSON.stringify(settings));
        next.ui = next.ui || {};
        next.ui.lastTab = getVisibleTab(next.ui.lastTab || 'openedu');
        next.activePlatform = isMoodleOnlyMode() ? 'moodle' : (refs.platformMoodle.classList.contains('active') ? 'moodle' : 'openedu');
        next.onboarding.privacyAccepted = Boolean(next.onboarding.privacyAccepted);
        next.onboarding.moodleOnly = Boolean(next.onboarding.moodleOnly && !refs.backendApiToken.value.trim());
        next.onboarding.completed = Boolean(next.onboarding.privacyAccepted && (next.onboarding.moodleOnly || refs.backendApiToken.value.trim()));

        next.backend.openedu.apiBaseUrl = refs.customBackendToggle.checked
            ? refs.backendApiBaseUrl.value.trim().replace(/\/$/, '')
            : defaultOpeneduUrl();
        next.backend.openedu.apiToken = refs.backendApiToken.value.trim();
        next.backend.openedu.requestTimeoutMs = Math.max(1000, Number(refs.backendRequestTimeoutMs.value || 4000));
        next.openedu.backendVersion = refs.openeduBackendVersion.value === 'v1' ? 'v1' : 'v2';

        next.moodle.mode = radioValue('moodleMode', next.moodle.mode);
        next.moodle.wandHotkey = refs.wandKey.value.trim() || next.moodle.wandHotkey;
        next.moodle.autoInsertOnLoad = refs.moodleAutoInsertOnLoad.checked;
        next.moodle.insertHotkey = refs.moodleInsertKey.value.trim() || next.moodle.insertHotkey;
        next.moodle.nextButtonText = refs.nextBtnSelector.value.trim() || next.moodle.nextButtonText;

        next.openedu.mode = radioValue('openeduMode', next.openedu.mode);
        next.openedu.stickHotkey = refs.openeduHotkey.value.trim() || next.openedu.stickHotkey;
        next.openedu.autoAdvanceEnabled = refs.openeduAutoAdvanceEnabled.checked;
        next.openedu.requiredCompletionOnly = refs.openeduRequiredCompletionOnly.checked;
        next.openedu.activeTabRefreshEnabled = refs.openeduActiveTabRefreshEnabled.checked;
        next.openedu.activeTabPostSubmitRefreshEnabled = refs.openeduActiveTabPostSubmitRefreshEnabled.checked;
        next.openedu.showFallbackStats = refs.openeduShowFallbackStats.checked;
        next.openedu.autoUseSimilarAnswers = refs.openeduAutoUseSimilarAnswers.checked;
        next.openedu.autoUseFallbackAnswers = refs.openeduAutoUseFallbackAnswers.checked;
        next.openedu.autoCheckAnswers = refs.openeduAutoCheckAnswers.checked;
        next.openedu.missingAnswerAction = refs.openeduMissingAnswerAction.value;
        next.openedu.unsupportedTaskAction = refs.openeduUnsupportedTaskAction.value;
        next.openedu.chatgptAnswerTimeoutMinutes = Number(refs.openeduChatgptAnswerTimeoutMinutes.value || 10);
        next.openedu.autoAdvanceDelayMs = Math.max(500, Number(refs.openeduAutoAdvanceDelayMs.value || next.openedu.autoAdvanceDelayMs));
        next.diagnostics.openeduDebugOverlay = refs.openeduDebugOverlay.checked;

        return settingsApi.normalizeSettings(next);
    }

    async function persistSettings(next, reason) {
        settings = settingsApi.normalizeSettings(next);
        settings = await settingsApi.saveSettings(settings);
        sendToActiveTab({ type: 'SETTINGS_UPDATED', settings, reason: reason || 'popup' });
        applyStateToUi();
    }

    async function save(reason, stayOnSetup) {
        settings = collectStateFromUi();
        if (!stayOnSetup) {
            setupOpenedFromApp = false;
        }
        await persistSettings(settings, reason);
    }

    function telemetryAllowed() {
        return Boolean(settings.onboarding?.privacyAccepted && settings.onboarding?.allowTechnicalDataCollection !== false);
    }

    function eventStorageKey(name) {
        return 'paramExtExtensionEvent:' + name;
    }

    async function reportExtensionEvent(eventName, onceKey) {
        if (!telemetryAllowed()) {
            return;
        }
        try {
            if (onceKey && localStorage.getItem(eventStorageKey(onceKey))) {
                return;
            }
        } catch (_) {
            return;
        }

        const baseUrl = normalizeUrl(settings.backend?.openedu?.apiBaseUrl || defaultOpeneduUrl());
        if (!baseUrl) {
            return;
        }

        const payload = {
            eventName,
            extensionVersion: manifest.version || 'unknown',
            buildId: String(buildConfig.buildId || 'local-dev'),
            channel: String(buildConfig.buildChannel || 'local'),
            platform: isMoodleOnlyMode() ? 'moodle' : String(settings.activePlatform || 'openedu'),
            authMode: settings.backend?.openedu?.apiToken ? 'openedu-token' : (isMoodleOnlyMode() ? 'moodle-only' : 'anonymous')
        };

        try {
            const response = await fetch(baseUrl + '/v2/extension/events', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                cache: 'no-store'
            });
            if (response.ok && onceKey) {
                localStorage.setItem(eventStorageKey(onceKey), new Date().toISOString());
            }
        } catch (_) {
            // Anonymous counters are best-effort only.
        }
    }

    function normalizeUrl(value) {
        return String(value || '').trim().replace(/\/$/, '');
    }

    function reportStartupEvents() {
        if (!telemetryAllowed()) {
            return;
        }
        if (startupEventsReported) {
            return;
        }
        startupEventsReported = true;
        const today = new Date().toISOString().slice(0, 10);
        reportExtensionEvent('extension_installed', 'install-v1');
        reportExtensionEvent('popup_opened', 'popup-opened-' + today);
    }

    function scheduleAppSave(reason) {
        if (saveTimer) {
            clearTimeout(saveTimer);
        }
        saveTimer = setTimeout(() => {
            saveTimer = 0;
            save(reason, false);
        }, 250);
    }

    function scheduleSetupSave(reason) {
        if (saveTimer) {
            clearTimeout(saveTimer);
        }
        saveTimer = setTimeout(() => {
            saveTimer = 0;
            save(reason, true);
        }, 250);
    }

    function setBackendStatus(text, ok) {
        refs.backendPingStatus.textContent = text;
        refs.backendCompactStatus.textContent = text;
        [refs.backendPingStatus, refs.backendCompactStatus].forEach((node) => {
            node.classList.toggle('online', ok === true);
            node.classList.toggle('offline', ok === false);
        });
    }

    async function pingBackend() {
        setBackendStatus('Проверка...', null);
        const baseUrl = (refs.customBackendToggle.checked ? refs.backendApiBaseUrl.value : defaultOpeneduUrl()).trim().replace(/\/$/, '');
        const token = refs.backendApiToken.value.trim();
        if (!baseUrl) {
            setBackendStatus('URL пустой', false);
            return false;
        }
        try {
            const response = await fetch(baseUrl + endpointPrefix() + '/status', {
                headers: token ? { Authorization: 'Bearer ' + token } : {},
                cache: 'no-store'
            });
            const ok = response.ok || response.status === 401 || response.status === 403;
            setBackendStatus(ok ? 'Онлайн' : 'Ошибка ' + response.status, ok);
            return ok;
        } catch (_) {
            setBackendStatus('Оффлайн', false);
            return false;
        }
    }

    async function refreshStats() {
        const baseUrl = settings.backend.openedu.apiBaseUrl;
        const token = settings.backend.openedu.apiToken;
        if (!baseUrl || !token) {
            refs.statQuestions.textContent = '!';
            return;
        }
        if ((settings.openedu.backendVersion || 'v2') !== 'v2') {
            refs.statQuestions.textContent = 'V1';
            return;
        }
        try {
            const response = await fetch(baseUrl + '/v2/users/me/stats', {
                headers: { Authorization: 'Bearer ' + token },
                cache: 'no-store'
            });
            const data = await response.json();
            const stats = data.stats || {};
            refs.statCourses.textContent = String(stats.courses || 0);
            refs.statTests.textContent = String(stats.tests || 0);
            refs.statQuestions.textContent = String(stats.questions || 0);
            refs.statCompletions.textContent = String(stats.completions || 0);
        } catch (_) {
            refs.statQuestions.textContent = '!';
        }
    }

    async function checkUpdate() {
        const baseUrl = settings.backend.openedu.apiBaseUrl || defaultOpeneduUrl();
        const url = (buildConfig.updateCheckUrl || (baseUrl + '/v2/update'))
            + '?version=' + encodeURIComponent(manifest.version || '')
            + '&build_id=' + encodeURIComponent(buildConfig.buildId || '');
        refs.updateStatus.textContent = 'Проверка...';
        refs.updateStatus.classList.remove('online', 'offline');
        try {
            const response = await fetch(url, { cache: 'no-store' });
            const data = await response.json();
            if (data.updateRequired) {
                refs.updateStatus.textContent = 'Доступна ' + (data.latestVersion || 'новая');
                refs.updateStatus.classList.add('offline');
            } else {
                refs.updateStatus.textContent = 'Актуально';
                refs.updateStatus.classList.add('online');
            }
        } catch (_) {
            refs.updateStatus.textContent = 'Ошибка';
            refs.updateStatus.classList.add('offline');
        }
    }

    function bindHotkey(input) {
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Tab') {
                return;
            }
            event.preventDefault();
            if ((event.key === 'Backspace' || event.key === 'Delete') && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) {
                input.value = '';
                scheduleAppSave('hotkey-clear');
                return;
            }
            const value = settingsApi.serializeHotkey(event);
            if (value) {
                input.value = value;
                scheduleAppSave('hotkey');
            }
        });
    }

    refs.openPrivacyBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'PARAMEXT_OPEN_PRIVACY_POLICY' }, () => {});
    });
    refs.refreshPrivacyBtn.addEventListener('click', async () => {
        settings = await settingsApi.getSettings();
        applyStateToUi();
    });
    refs.openSetupBtn.addEventListener('click', () => {
        setupOpenedFromApp = true;
        applyStateToUi();
    });
    refs.setupBackBtn.addEventListener('click', () => {
        setupOpenedFromApp = false;
        applyStateToUi();
    });
    refs.setupContinueBtn.addEventListener('click', async () => {
        const token = refs.backendApiToken.value.trim();
        if (!token) {
            setBackendStatus('Введите ключ', false);
            return;
        }
        const ok = await pingBackend();
        if (!ok) {
            return;
        }
        const next = collectStateFromUi();
        next.onboarding.moodleOnly = false;
        next.onboarding.completed = true;
        next.activePlatform = 'openedu';
        next.ui = next.ui || {};
        next.ui.lastTab = 'openedu';
        setupOpenedFromApp = false;
        await persistSettings(next, 'setup-continue');
        reportExtensionEvent('openedu_connected', 'openedu-connected-v1');
    });
    refs.setupMoodleOnlyBtn.addEventListener('click', async () => {
        const next = collectStateFromUi();
        next.onboarding.moodleOnly = true;
        next.onboarding.completed = Boolean(next.onboarding.privacyAccepted);
        next.activePlatform = 'moodle';
        next.ui = next.ui || {};
        next.ui.lastTab = 'moodle';
        setupOpenedFromApp = false;
        await persistSettings(next, 'setup-moodle-only');
        reportExtensionEvent('moodle_only_enabled', 'moodle-only-v1');
    });

    document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setTab(tab.dataset.tab, true)));
    refs.customBackendToggle.addEventListener('change', () => {
        if (!refs.customBackendToggle.checked) {
            refs.backendApiBaseUrl.value = defaultOpeneduUrl();
        }
        refs.customBackendFields.classList.toggle('hidden', !refs.customBackendToggle.checked);
        if (settings.backend?.openedu?.apiToken) {
            scheduleSetupSave('backend-toggle');
        }
    });
    refs.openeduBackendVersion.addEventListener('change', () => {
        refs.backendVersionStatus.textContent = String(refs.openeduBackendVersion.value || 'v2').toUpperCase();
        if (settings.backend?.openedu?.apiToken) {
            scheduleSetupSave('backend-version');
        }
    });
    refs.backendApiBaseUrl.addEventListener('input', () => {
        if (refs.customBackendToggle.checked && settings.backend?.openedu?.apiToken) {
            scheduleSetupSave('backend-url');
        }
    });
    refs.backendApiToken.addEventListener('input', () => {
        refs.setupMoodleOnlyBtn.classList.toggle('hidden', Boolean(refs.backendApiToken.value.trim()));
    });
    refs.backendRequestTimeoutMs.addEventListener('input', () => {
        if (settings.backend?.openedu?.apiToken) {
            scheduleSetupSave('backend-timeout');
        }
    });
    if (refs.backendPingBtn) {
        refs.backendPingBtn.addEventListener('click', pingBackend);
    }
    refs.backendResetUrlBtn.addEventListener('click', () => {
        refs.customBackendToggle.checked = false;
        refs.backendApiBaseUrl.value = defaultOpeneduUrl();
        refs.customBackendFields.classList.add('hidden');
        setBackendStatus('Не проверено', null);
    });
    refs.platformOpenedu.addEventListener('click', () => {
        settings.activePlatform = 'openedu';
        scheduleAppSave('platform-openedu');
        applyStateToUi();
    });
    refs.platformMoodle.addEventListener('click', () => {
        settings.activePlatform = 'moodle';
        scheduleAppSave('platform-moodle');
        applyStateToUi();
    });
    refs.btnSave.addEventListener('click', () => save('save-button', false));
    refs.statsRefreshBtn.addEventListener('click', refreshStats);
    refs.updateCheckBtn.addEventListener('click', checkUpdate);
    refs.btnStart.addEventListener('click', async () => {
        settings.moodle.autoSolving = true;
        await save('moodle-start', false);
        sendToActiveTab({ type: 'START_AUTO_SOLVE' });
    });
    refs.btnStop.addEventListener('click', async () => {
        settings.moodle.autoSolving = false;
        await save('moodle-stop', false);
        sendToActiveTab({ type: 'STOP_AUTO_SOLVE' });
    });

    [
        refs.nextBtnSelector,
        refs.moodleAutoInsertOnLoad,
        refs.openeduAutoAdvanceDelayMs,
        refs.openeduAutoAdvanceEnabled,
        refs.openeduRequiredCompletionOnly,
        refs.openeduActiveTabRefreshEnabled,
        refs.openeduActiveTabPostSubmitRefreshEnabled,
        refs.openeduShowFallbackStats,
        refs.openeduAutoUseSimilarAnswers,
        refs.openeduAutoUseFallbackAnswers,
        refs.openeduAutoCheckAnswers,
        refs.openeduMissingAnswerAction,
        refs.openeduUnsupportedTaskAction,
        refs.openeduChatgptAnswerTimeoutMinutes,
        refs.openeduDebugOverlay
    ].forEach((control) => {
        control.addEventListener(control.tagName === 'INPUT' && control.type !== 'checkbox' ? 'input' : 'change', () => {
            updateModeVisibility();
            scheduleAppSave(control.id || 'change');
        });
    });
    Array.from(document.getElementsByName('openeduMode')).forEach((radio) => radio.addEventListener('change', () => {
        updateModeVisibility();
        scheduleAppSave('openedu-mode');
    }));
    Array.from(document.getElementsByName('moodleMode')).forEach((radio) => radio.addEventListener('change', () => {
        updateModeVisibility();
        scheduleAppSave('moodle-mode');
    }));
    bindHotkey(refs.wandKey);
    bindHotkey(refs.moodleInsertKey);
    bindHotkey(refs.openeduHotkey);

    applyStateToUi();
    reportStartupEvents();
    pingBackend();
    checkUpdate();
    refreshStats();
});
