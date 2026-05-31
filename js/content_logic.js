(async function () {
    if (window.ParamExtTelemetry) {
        window.ParamExtTelemetry.installGlobalHandlers('moodle-content');
    }

    let settings = {
        mode: 'wand',
        wandHotkey: 'Escape',
        insertHotkey: 'Alt+KeyA',
        autoInsertOnLoad: true,
        nextButtonText: 'Следующая страница',
        autoSolving: false
    };

    async function loadSettings() {
        if (window.ParamExtSettings) {
            const merged = await window.ParamExtSettings.getSettings();
            settings = {
                mode: merged.moodle.mode,
                wandHotkey: merged.moodle.wandHotkey,
                insertHotkey: merged.moodle.insertHotkey,
                autoInsertOnLoad: merged.moodle.autoInsertOnLoad,
                nextButtonText: merged.moodle.nextButtonText,
                autoSolving: merged.moodle.autoSolving
            };
            return;
        }

        try {
            const data = await chrome.storage.local.get('paramExtSettings');
            if (data.paramExtSettings) {
                settings = {
                    mode: data.paramExtSettings.mode || settings.mode,
                    wandHotkey: data.paramExtSettings.wandKey || settings.wandHotkey,
                    insertHotkey: data.paramExtSettings.insertKey || settings.insertHotkey,
                    autoInsertOnLoad: data.paramExtSettings.autoInsertOnLoad !== false,
                    nextButtonText: data.paramExtSettings.nextBtnText || settings.nextButtonText,
                    autoSolving: Boolean(data.paramExtSettings.autoSolving)
                };
            }
        } catch (_) {
            // Keep defaults if storage cannot be read.
        }
    }

    function getAllShadowRoots(node) {
        const rootNode = node || document.body;
        const shadowRoots = [];
        const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_ELEMENT);
        while (walker.nextNode()) {
            const element = walker.currentNode;
            if (element.shadowRoot) {
                shadowRoots.push(element.shadowRoot);
                const nested = getAllShadowRoots(element.shadowRoot);
                nested.forEach((item) => shadowRoots.push(item));
            }
        }
        return shadowRoots;
    }

    function getMagicButtons() {
        const buttons = [];
        const roots = getAllShadowRoots();
        roots.forEach((root) => {
            const button = root.querySelector('.icon.magic');
            if (button) {
                buttons.push(button);
            }
        });
        return buttons;
    }

    function setWandsVisible(visible) {
        getMagicButtons().forEach((button) => {
            button.style.display = visible ? '' : 'none';
        });
    }

    function toggleWands() {
        const buttons = getMagicButtons();
        const hasHidden = buttons.some((button) => button.style.display === 'none');
        setWandsVisible(hasHidden);
    }

    function clickNextButton() {
        const byValue = document.querySelector('input[type="submit"][value="' + settings.nextButtonText + '"]');
        if (byValue) {
            byValue.click();
            return;
        }

        const byText = Array.from(document.querySelectorAll('button, input[type="submit"]')).find((element) => {
            if (!(element instanceof HTMLElement)) {
                return false;
            }

            if (element instanceof HTMLInputElement) {
                return element.value.trim() === settings.nextButtonText;
            }

            return (element.textContent || '').trim() === settings.nextButtonText;
        });

        if (byText && byText instanceof HTMLElement) {
            byText.click();
        }
    }

    function applyQueuedAnswers() {
        const api = window.ParamExtMoodleAutoInsert;
        if (!api || typeof api.apply !== 'function') {
            return 0;
        }

        try {
            return Number(api.apply()) || 0;
        } catch (error) {
            console.error(error);
            return 0;
        }
    }

    function hasAnsweredDataOnPage() {
        const checkedOptions = document.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked');
        if (checkedOptions.length > 0) {
            return true;
        }

        const hasFilledTextInput = Array.from(document.querySelectorAll('textarea, input[type="text"], input[type="number"]')).some((element) => {
            if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) {
                return false;
            }
            return element.value.trim().length > 0;
        });
        if (hasFilledTextInput) {
            return true;
        }

        const hasMeaningfulSelect = Array.from(document.querySelectorAll('select')).some((element) => {
            if (!(element instanceof HTMLSelectElement)) {
                return false;
            }
            return element.selectedIndex > 0 || (element.value && element.value.trim().length > 0);
        });

        return hasMeaningfulSelect;
    }

    function applySettings() {
        if (settings.mode === 'wand') {
            setWandsVisible(true);
        }

        if (settings.mode === 'autoSolve' && settings.autoSolving) {
            setTimeout(() => {
                if (hasAnsweredDataOnPage()) {
                    clickNextButton();
                }
            }, 3500);
        }
    }

    chrome.runtime.onMessage.addListener((message) => {
        if (!message || typeof message !== 'object') {
            return;
        }

        if (message.type === 'SETTINGS_UPDATED') {
            if (message.settings && message.settings.moodle) {
                settings = {
                    mode: message.settings.moodle.mode,
                    wandHotkey: message.settings.moodle.wandHotkey,
                    insertHotkey: message.settings.moodle.insertHotkey,
                    autoInsertOnLoad: message.settings.moodle.autoInsertOnLoad,
                    nextButtonText: message.settings.moodle.nextButtonText,
                    autoSolving: Boolean(message.settings.moodle.autoSolving)
                };
            } else if (message.settings) {
                settings = {
                    mode: message.settings.mode || settings.mode,
                    wandHotkey: message.settings.wandKey || settings.wandHotkey,
                    insertHotkey: message.settings.insertKey || settings.insertHotkey,
                    autoInsertOnLoad: message.settings.autoInsertOnLoad !== false,
                    nextButtonText: message.settings.nextBtnText || settings.nextButtonText,
                    autoSolving: Boolean(message.settings.autoSolving)
                };
            }
            applySettings();
        }

        if (message.type === 'START_AUTO_SOLVE') {
            settings.autoSolving = true;
            if (settings.mode === 'autoSolve') {
                window.location.reload();
            }
        }

        if (message.type === 'STOP_AUTO_SOLVE') {
            settings.autoSolving = false;
        }
    });

    document.addEventListener('keydown', (event) => {
        if (window.ParamExtSettings) {
            if (window.ParamExtSettings.hotkeyMatches(event, settings.insertHotkey)) {
                event.preventDefault();
                applyQueuedAnswers();
                return;
            }
            if (window.ParamExtSettings.hotkeyMatches(event, settings.wandHotkey)) {
                toggleWands();
            }
            return;
        }

        if (event.code === settings.insertHotkey || event.key === settings.insertHotkey) {
            event.preventDefault();
            applyQueuedAnswers();
            return;
        }

        if (event.code === settings.wandHotkey || event.key === settings.wandHotkey) {
            toggleWands();
        }
    });

    await loadSettings();

    if (window.ParamExtTelemetry) {
        window.ParamExtTelemetry.push('system_state', {
            mode: settings.mode,
            autoSolving: settings.autoSolving,
            autoInsertOnLoad: settings.autoInsertOnLoad,
            host: location.host
        }, 'moodle-content');
    }

    applySettings();
})();
