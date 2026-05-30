document.addEventListener('DOMContentLoaded', async () => {
    if (!window.ParamExtSettings) {
        return;
    }

    const buildConfig = window.ParamExtBuildConfig || {};
    const manifest = chrome.runtime.getManifest();

    if (window.ParamExtTelemetry) {
        window.ParamExtTelemetry.installGlobalHandlers('popup');
    }

    const $ = (id) => document.getElementById(id);
    const settingsApi = window.ParamExtSettings;

    const refs = {
        mainLogo: $('mainLogo'),
        headerStatus: $('headerStatus'),
        versionPill: $('versionPill'),
        onboardingPanel: $('onboardingPanel'),
        privacyStep: $('privacyStep'),
        apiSetupStep: $('apiSetupStep'),
        acceptPrivacyBtn: $('acceptPrivacyBtn'),
        allowTechnicalDataCollection: $('allowTechnicalDataCollection'),
        botLink: $('botLink'),
        customBackendToggle: $('customBackendToggle'),
        customBackendFields: $('customBackendFields'),
        backendApiBaseUrl: $('backendApiBaseUrl'),
        backendApiToken: $('backendApiToken'),
        backendRequestTimeoutMs: $('backendRequestTimeoutMs'),
        backendPingBtn: $('backendPingBtn'),
        backendResetUrlBtn: $('backendResetUrlBtn'),
        backendPingStatus: $('backendPingStatus'),
        backendCompactStatus: $('backendCompactStatus'),
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
    let autoSaveTimer = 0;

    refs.versionPill.textContent = 'v' + (manifest.version || 'unknown');
    refs.buildStatus.textContent = String(buildConfig.buildChannel || 'local') + ' / ' + String(buildConfig.buildId || 'local-dev').slice(0, 8);
    if (refs.mainLogo) {
        refs.mainLogo.addEventListener('error', () => {
            refs.mainLogo.src = '../../logo_main.png';
        });
    }
    if (refs.botLink) {
        refs.botLink.href = buildConfig.botLink || 'https://t.me/moodush_bot';
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

    function defaultOpeneduUrl() {
        return buildConfig.openeduApiBaseUrl || settingsApi.DEFAULT_SETTINGS.backend.openedu.apiBaseUrl;
    }

    function sendToActiveTab(message) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tabId = tabs && tabs[0] ? tabs[0].id : null;
            if (!tabId) {
                return;
            }
            chrome.tabs.sendMessage(tabId, message, () => {
                const lastError = chrome.runtime.lastError;
                if (lastError && window.ParamExtTelemetry) {
                    window.ParamExtTelemetry.push('send_message_error', {
                        message: lastError.message,
                        type: message.type || 'unknown'
                    }, 'popup');
                }
            });
        });
    }

    function setTab(name) {
        document.querySelectorAll('.tab').forEach((tab) => {
            tab.classList.toggle('active', tab.dataset.tab === name);
        });
        refs.openeduSettings.classList.toggle('hidden', name !== 'openedu');
        refs.moodleSettings.classList.toggle('hidden', name !== 'moodle');
        refs.statsPanel.classList.toggle('hidden', name !== 'stats');
        refs.diagnosticsPanel.classList.toggle('hidden', name !== 'diagnostics');
    }

    function updateOnboarding() {
        const accepted = Boolean(settings.onboarding?.privacyAccepted);
        const hasToken = Boolean(settings.backend?.openedu?.apiToken);
        refs.onboardingPanel.classList.toggle('hidden', accepted && hasToken);
        refs.privacyStep.classList.toggle('hidden', accepted);
        refs.apiSetupStep.classList.toggle('hidden', !accepted || hasToken);
        refs.headerStatus.textContent = hasToken ? 'Готово к работе' : 'Нужно подключение';
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

    function applyStateToUi() {
        const openeduBackend = settings.backend.openedu;
        refs.backendApiBaseUrl.value = openeduBackend.apiBaseUrl || defaultOpeneduUrl();
        refs.backendApiToken.value = openeduBackend.apiToken || '';
        refs.backendRequestTimeoutMs.value = String(openeduBackend.requestTimeoutMs || 4000);
        refs.customBackendToggle.checked = Boolean(openeduBackend.apiBaseUrl && openeduBackend.apiBaseUrl !== defaultOpeneduUrl());
        refs.customBackendFields.classList.toggle('hidden', !refs.customBackendToggle.checked);

        setRadio('openeduMode', settings.openedu.mode);
        setRadio('moodleMode', settings.moodle.mode);
        refs.wandKey.value = settings.moodle.wandHotkey;
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
        refs.openeduAutoAdvanceDelayMs.value = String(settings.openedu.autoAdvanceDelayMs);
        refs.openeduDebugOverlay.checked = Boolean(settings.diagnostics?.openeduDebugOverlay);
        refs.allowTechnicalDataCollection.checked = settings.onboarding?.allowTechnicalDataCollection !== false;
        refs.platformOpenedu.classList.toggle('active', settings.activePlatform === 'openedu');
        refs.platformMoodle.classList.toggle('active', settings.activePlatform === 'moodle');
        refs.platformOpenedu.textContent = settings.activePlatform === 'openedu' ? 'Активно' : 'Сделать активным';
        refs.platformMoodle.textContent = settings.activePlatform === 'moodle' ? 'Активно' : 'Сделать активным';
        updateOnboarding();
        updateModeVisibility();
    }

    function collectStateFromUi() {
        const next = JSON.parse(JSON.stringify(settings));
        next.activePlatform = refs.platformMoodle.classList.contains('active') ? 'moodle' : 'openedu';
        next.onboarding.privacyAccepted = Boolean(next.onboarding.privacyAccepted);
        next.onboarding.allowTechnicalDataCollection = refs.allowTechnicalDataCollection.checked;
        next.onboarding.completed = Boolean(next.onboarding.privacyAccepted && refs.backendApiToken.value.trim());

        next.backend.openedu.apiBaseUrl = refs.customBackendToggle.checked
            ? refs.backendApiBaseUrl.value.trim().replace(/\/$/, '')
            : defaultOpeneduUrl();
        next.backend.openedu.apiToken = refs.backendApiToken.value.trim();
        next.backend.openedu.requestTimeoutMs = Math.max(1000, Number(refs.backendRequestTimeoutMs.value || 4000));

        next.moodle.mode = radioValue('moodleMode', next.moodle.mode);
        next.moodle.wandHotkey = refs.wandKey.value.trim() || next.moodle.wandHotkey;
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
        next.openedu.autoAdvanceDelayMs = Math.max(500, Number(refs.openeduAutoAdvanceDelayMs.value || next.openedu.autoAdvanceDelayMs));
        next.diagnostics.openeduDebugOverlay = refs.openeduDebugOverlay.checked;

        return settingsApi.normalizeSettings(next);
    }

    async function save(reason) {
        settings = collectStateFromUi();
        settings = await settingsApi.saveSettings(settings);
        sendToActiveTab({ type: 'SETTINGS_UPDATED', settings, reason: reason || 'popup' });
        applyStateToUi();
    }

    function scheduleSave(reason) {
        if (autoSaveTimer) {
            clearTimeout(autoSaveTimer);
        }
        autoSaveTimer = setTimeout(() => {
            autoSaveTimer = 0;
            save(reason);
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
        try {
            const response = await fetch(baseUrl + '/v2/status', {
                headers: token ? { Authorization: 'Bearer ' + token } : {},
                cache: 'no-store'
            });
            setBackendStatus(response.ok || response.status !== 404 ? 'Онлайн' : 'Не найден', response.ok || response.status !== 404);
        } catch (_) {
            setBackendStatus('Оффлайн', false);
        }
    }

    async function refreshStats() {
        const baseUrl = settings.backend.openedu.apiBaseUrl;
        const token = settings.backend.openedu.apiToken;
        if (!baseUrl || !token) {
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
                scheduleSave('hotkey-clear');
                return;
            }
            const value = settingsApi.serializeHotkey(event);
            if (value) {
                input.value = value;
                scheduleSave('hotkey');
            }
        });
    }

    document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => setTab(tab.dataset.tab)));
    refs.acceptPrivacyBtn.addEventListener('click', () => {
        settings.onboarding.privacyAccepted = true;
        settings.onboarding.allowTechnicalDataCollection = refs.allowTechnicalDataCollection.checked;
        scheduleSave('privacy');
        applyStateToUi();
    });
    refs.customBackendToggle.addEventListener('change', () => {
        refs.customBackendFields.classList.toggle('hidden', !refs.customBackendToggle.checked);
        scheduleSave('backend-custom-toggle');
    });
    refs.backendPingBtn.addEventListener('click', pingBackend);
    refs.backendResetUrlBtn.addEventListener('click', () => {
        refs.customBackendToggle.checked = false;
        refs.backendApiBaseUrl.value = defaultOpeneduUrl();
        refs.customBackendFields.classList.add('hidden');
        scheduleSave('backend-reset');
    });
    refs.platformOpenedu.addEventListener('click', () => {
        settings.activePlatform = 'openedu';
        scheduleSave('platform-openedu');
        applyStateToUi();
    });
    refs.platformMoodle.addEventListener('click', () => {
        settings.activePlatform = 'moodle';
        scheduleSave('platform-moodle');
        applyStateToUi();
    });
    refs.btnSave.addEventListener('click', () => save('save-button'));
    refs.statsRefreshBtn.addEventListener('click', refreshStats);
    refs.updateCheckBtn.addEventListener('click', checkUpdate);
    refs.btnStart.addEventListener('click', async () => {
        settings.moodle.autoSolving = true;
        await save('moodle-start');
        sendToActiveTab({ type: 'START_AUTO_SOLVE' });
    });
    refs.btnStop.addEventListener('click', async () => {
        settings.moodle.autoSolving = false;
        await save('moodle-stop');
        sendToActiveTab({ type: 'STOP_AUTO_SOLVE' });
    });

    [
        refs.backendApiBaseUrl,
        refs.backendApiToken,
        refs.nextBtnSelector,
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
        refs.openeduDebugOverlay,
        refs.allowTechnicalDataCollection
    ].forEach((control) => {
        control.addEventListener(control.tagName === 'INPUT' && control.type !== 'checkbox' ? 'input' : 'change', () => {
            updateModeVisibility();
            scheduleSave(control.id || 'change');
        });
    });
    Array.from(document.getElementsByName('openeduMode')).forEach((radio) => radio.addEventListener('change', () => {
        updateModeVisibility();
        scheduleSave('openedu-mode');
    }));
    Array.from(document.getElementsByName('moodleMode')).forEach((radio) => radio.addEventListener('change', () => {
        updateModeVisibility();
        scheduleSave('moodle-mode');
    }));
    bindHotkey(refs.wandKey);
    bindHotkey(refs.openeduHotkey);

    applyStateToUi();
    checkUpdate();
    refreshStats();
});
