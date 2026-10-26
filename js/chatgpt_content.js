/* Browser-tab transport only; OpenEdu application stays in its internal functions. */
(function () {
    const instanceId = crypto.randomUUID();
    let activeJob = null;
    const received = new Set();
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const streaming = () => document.querySelector('[data-testid="stop-button"], [data-is-streaming="true"], .result-streaming');

    function status(text, error = false) {
        let badge = document.getElementById('moodush-chatgpt-status');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'moodush-chatgpt-status';
            badge.setAttribute('role', 'status');
            Object.assign(badge.style, { position: 'fixed', bottom: '12px', left: '12px', zIndex: '2147483647', padding: '10px 14px', borderRadius: '8px', background: '#172b38', color: '#fff', font: '13px sans-serif', maxWidth: '440px' });
            document.body.appendChild(badge);
        }
        badge.style.background = error ? '#572525' : '#172b38';
        badge.textContent = 'MooDuSh: ' + text;
    }

    function editorText(editor) {
        if (typeof editor.value === 'string') return editor.value.replace(/\u200b/g, '').trim();
        // ProseMirror represents line breaks as <p>/<div>/<br>, while textContent
        // concatenates those lines. Compare the visible text, preserving boundaries.
        const read = node => {
            if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
            if (node.nodeType !== Node.ELEMENT_NODE) return '';
            if (node.tagName === 'BR') return '\n';
            const text = [...node.childNodes].map(read).join('');
            return /^(P|DIV|LI|PRE)$/.test(node.tagName) ? '\n' + text + '\n' : text;
        };
        const value = typeof editor.innerText === 'string' ? editor.innerText : read(editor);
        return value.replace(/\u200b/g, '').trim();
    }

    function samePrompt(editor, prompt) {
        const normalized = text => String(text).replace(/\s+/g, ' ').trim();
        return normalized(editorText(editor)) === normalized(prompt);
    }

    function isMatchingJobDraft(editor, job) {
        // A previous failed run can leave this exact generated prompt in the
        // extension-owned tab. Only replace an identical prompt with its request
        // marker; a user's unrelated draft must remain untouched.
        const normalize = text => String(text).replace(/\s+/g, ' ').trim();
        const draft = normalize(editorText(editor));
        const marker = draft.lastIndexOf(' Request ID:');
        if (marker < 0) return false;
        const requestId = draft.slice(marker + ' Request ID:'.length).trim();
        if (!/^[A-Za-z0-9_-]+$/.test(requestId)) return false;
        const expected = normalize(job.prompt);
        if (draft.slice(0, marker) === expected) return true;
        // Failed file uploads leave the extension's short wrapper in the
        // composer. A retry gets a new request/file ID, but still owns that
        // exact generated wrapper; do not mistake it for a user's draft.
        const fileName = 'moodush-questions-' + job.id + '.txt';
        return expected.includes(fileName) && draft.slice(0, marker)
            === expected.replaceAll(fileName, 'moodush-questions-' + requestId + '.txt');
    }

    function findEditor() {
        const candidates = document.querySelectorAll('#prompt-textarea, textarea[data-testid="prompt-textarea"], [contenteditable="true"][role="textbox"], form textarea');
        return [...candidates].find(node => !node.disabled && !node.readOnly
            && node.getAttribute('aria-disabled') !== 'true' && node.getClientRects().length > 0);
    }

    function insertPrompt(editor, prompt) {
        editor.focus();
        if (editor instanceof HTMLTextAreaElement) {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(editor, prompt);
        } else {
            const range = document.createRange();
            range.selectNodeContents(editor);
            const selection = getSelection();
            selection.removeAllRanges(); selection.addRange(range);
            // Chrome's editing command lets ProseMirror observe the normal edit.
            const inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, prompt);
            if (!inserted) {
                range.deleteContents();
                range.insertNode(document.createTextNode(prompt));
                range.collapse(false);
                selection.removeAllRanges(); selection.addRange(range);
            }
        }
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));
        if (!samePrompt(editor, prompt)) throw new Error('The ChatGPT editor did not retain the prompt');
    }

    function findSend(editor) {
        const selector = '#composer-submit-button, [data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"], button[aria-label="Отправить запрос"], button[aria-label="Отправить сообщение"], button[type="submit"]';
        const form = editor.closest('form');
        const candidates = [...(form || document).querySelectorAll(selector)];
        return candidates.find(button => button.isConnected && button.getClientRects().length > 0
            && !button.disabled && button.getAttribute('aria-disabled') !== 'true'
            && !/(voice|dictat|stop|голос|диктов|останов)/i.test(button.getAttribute('aria-label') || ''));
    }

    function conversationTurns() {
        const nodes = document.querySelectorAll('[data-message-author-role="user"], [data-message-author-role="assistant"], [data-turn="user"], [data-turn="assistant"], [data-user-message-bubble], [data-chatgpt-search-unit-key], [data-content-search-unit-key], [data-chatgpt-agent-turn-start]');
        const seen = new Set();
        const turns = [];
        for (const node of nodes) {
            const workTurn = node.closest('[data-turn-key]');
            const unitKey = node.getAttribute('data-chatgpt-search-unit-key') || node.getAttribute('data-content-search-unit-key') || '';
            const unitRole = unitKey.match(/(?:^|:)(user|assistant)(?=:|$)/)?.[1];
            const role = node.getAttribute('data-message-author-role') || node.getAttribute('data-turn') || unitRole
                || (node.hasAttribute('data-user-message-bubble') ? 'user' : null)
                || (node.hasAttribute('data-chatgpt-agent-turn-start') ? 'assistant' : null);
            if (!role) continue;
            let root = node.closest('article, [data-testid^="conversation-turn-"]') || node;
            if (workTurn) {
                if (role === 'user') root = node.closest('[data-chatgpt-search-unit-key]') || node;
                else {
                    const marker = workTurn.querySelector('[data-chatgpt-agent-turn-start]');
                    // Work can put the heading, activity and final answer in
                    // separate sibling blocks. Read the turn, then exclude user UI.
                    root = marker ? workTurn
                        : node.closest('[data-chatgpt-search-unit-key]') || node;
                }
            }
            // Work groups user and assistant content under one turn key; retain
            // separate role identities instead of discarding the second message.
            const workId = workTurn ? workTurn.getAttribute('data-turn-key') + ':' + role : '';
            const identity = workId || root;
            if (seen.has(identity)) continue;
            seen.add(identity);
            const body = role === 'assistant' ? root
                : root.querySelector('[data-user-message-bubble], [data-message-author-role="user"]') || root;
            const id = workId || body.getAttribute('data-message-id') || root.getAttribute('data-turn-id') || root.id || root.getAttribute('data-testid');
            const stateNode = workTurn?.querySelector('[data-talvt-turn-state]') || root.closest('[data-talvt-turn-state]');
            turns.push({ root, body, role, id, text: body.textContent || '', state: stateNode?.getAttribute('data-talvt-turn-state') || '' });
        }
        return turns;
    }

    function answerJson(text) {
        const source = String(text || '');
        const candidates = [];
        let start = -1, depth = 0, quoted = false, escaped = false;
        for (let i = 0; i < source.length; i++) {
            const char = source[i];
            if (start < 0) {
                if (char === '{') { start = i; depth = 1; quoted = false; escaped = false; }
                continue;
            }
            if (quoted) {
                if (escaped) escaped = false;
                else if (char === '\\') escaped = true;
                else if (char === '"') quoted = false;
                continue;
            }
            if (char === '"') quoted = true;
            else if (char === '{') depth++;
            else if (char === '}' && --depth === 0) {
                try {
                    const value = JSON.parse(source.slice(start, i + 1));
                    if (value && Array.isArray(value.answers)) candidates.push(JSON.stringify(value));
                } catch (_) { /* A label/example is not an answer payload. */ }
                start = -1;
            }
        }
        return candidates.at(-1) || null;
    }

    function assistantOutput(reply) {
        if (!reply) return { text: '', json: null };
        const content = reply.cloneNode(true);
        // Shared Work turns include the user's prompt, which contains a JSON
        // format example. Never mistake that example or accessibility labels for
        // the assistant's answer.
        content.querySelectorAll('[data-message-author-role="user"], [data-turn="user"], [data-user-message-bubble], [data-chatgpt-search-unit-key$=":user"], [data-content-search-unit-key$=":user"], .sr-only, [aria-hidden="true"], button, script, style, [data-markdown-copy="exclude"]').forEach(node => node.remove());
        const text = content.textContent || '';
        const blocks = [...content.querySelectorAll('pre code, pre, .markdown, [data-markdown]')];
        // Prefer actual answer blocks over the outer turn's labels and controls.
        for (const block of blocks.reverse()) {
            const json = answerJson(block.textContent);
            if (json) return { text, json };
        }
        return { text, json: answerJson(text) };
    }

    function snapshotConversation(turns = conversationTurns()) {
        return {
            nodes: new Set(turns.map(turn => turn.root)),
            ids: new Set(turns.filter(turn => turn.id).map(turn => turn.id)),
            texts: new Set(turns.map(turn => turn.role + '|' + turn.text.replace(/\s+/g, ' ').trim()))
        };
    }

    function isNewTurn(turn, before) {
        if (turn.id) return !before.ids.has(turn.id);
        return !before.nodes.has(turn.root)
            && !before.texts.has(turn.role + '|' + turn.text.replace(/\s+/g, ' ').trim());
    }

    function currentExchange(jobId, before) {
        const turns = conversationTurns();
        let userIndex = turns.findIndex(turn => turn.role === 'user' && turn.text.includes(jobId));
        if (userIndex < 0) userIndex = turns.findIndex(turn => turn.role === 'user' && isNewTurn(turn, before));
        const nextUser = turns.findIndex((turn, index) => index > userIndex && turn.role === 'user' && isNewTurn(turn, before));
        const reply = turns.filter((turn, index) => turn.role === 'assistant'
            && userIndex >= 0 && index > userIndex && (nextUser < 0 || index < nextUser)
            && isNewTurn(turn, before)).at(-1);
        return { user: userIndex >= 0 ? turns[userIndex] : null, reply };
    }

    async function sendPrompt(editor, prompt, jobId) {
        status('ожидаю готовность кнопки отправки');
        // Let the controlled editor commit its input before selecting the live button.
        await pause(250);
        let send;
        for (let i = 0; i < 60; i++) {
            send = findSend(editor);
            if (send) break;
            await pause(250);
        }
        if (!send) throw new Error('ChatGPT send button is unavailable or disabled; the prompt was left in the editor');
        const before = snapshotConversation();
        await reportPhase(jobId, 'sending');
        const form = editor.closest('form');
        if (form && send.form === form && send.type === 'submit' && typeof form.requestSubmit === 'function') {
            form.requestSubmit(send);
        } else {
            send.click();
        }
        status('проверяю, что ChatGPT принял запрос');
        let enterTried = false;
        for (let poll = 0; poll < 40; poll++) {
            const exchange = currentExchange(jobId, before);
            const currentEditor = findEditor();
            const draftCleared = currentEditor ? editorText(currentEditor) === '' : !editor.isConnected;
            // Long prompts can be collapsed and hide the request marker. A fresh
            // turn, or a cleared draft plus generation, still confirms acceptance.
            if (exchange.user || (draftCleared && (exchange.reply || streaming()))) return before;
            // Some composer variants send through the editor's Enter handler.
            // Fall back only while the original draft and enabled send action remain:
            // a cleared/locked composer or streaming response is already in flight.
            if (poll >= 12 && !enterTried && editor.isConnected
                && samePrompt(editor, prompt) && !streaming() && findSend(editor)) {
                enterTried = true;
                editor.focus();
                editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
                editor.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            }
            await pause(250);
        }
        throw new Error('ChatGPT did not confirm sending the prompt. Check the composer; automatic sending stopped.');
    }

    async function reportPhase(id, phase, userTurnId) {
        const response = await chrome.runtime.sendMessage({ type: 'PARAMEXT_CHATGPT_PHASE', id, instanceId, phase, userTurnId });
        if (response?.error) throw new Error(response.error);
    }

    const attachmentExclusions = '[data-message-author-role], [data-turn="user"], [data-turn="assistant"], [data-turn-key], [data-testid^="conversation-turn-"], [data-user-message-bubble], [data-chatgpt-search-unit-key], [data-content-search-unit-key], #moodush-chatgpt-status, script, style';

    function acceptsFile(input, file) {
        return !input.disabled && (!input.accept || input.accept.split(',').some(value => {
            const accept = value.trim().toLowerCase();
            return accept === '*/*' || accept === file.type || (accept.endsWith('/*') && file.type.startsWith(accept.slice(0, -1)))
                || (accept.startsWith('.') && file.name.toLowerCase().endsWith(accept));
        }));
    }

    function findFileInput(editor, file) {
        const inputs = [...document.querySelectorAll('input[type="file"]')].filter(input => !input.hasAttribute('capture'));
        const form = editor.closest('form');
        // Prefer the general Attach files control observed in the saved page,
        // ahead of camera/media controls and unrelated uploaders elsewhere.
        return inputs.find(input => form?.contains(input) && !input.accept && acceptsFile(input, file))
            || inputs.find(input => form?.contains(input) && acceptsFile(input, file))
            || inputs.find(input => !input.closest('form') && acceptsFile(input, file));
    }

    async function selectUploadFiles(editor, initialInput, files) {
        const deadline = Date.now() + 5000;
        let input = initialInput;
        while (Date.now() < deadline) {
            // An editor update can replace the picker between its discovery and
            // this continuation. Never dispatch to a detached React input.
            if (!input?.isConnected) input = findFileInput(findEditor() || editor, files[0]);
            if (input && files.every(file => acceptsFile(input, file)) && (input.multiple || files.length === 1)) {
                const transfer = new DataTransfer();
                for (const file of files) transfer.items.add(file);
                input.value = '';
                input.files = transfer.files;
                const selectedValue = input.value;
                input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
                const changeDispatched = input.isConnected;
                if (changeDispatched) input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
                // The ChatGPT handler in the page's referenced frontend bundle
                // reads files and clears value synchronously. A retained native
                // value means this selection did not reach that handler.
                if (changeDispatched && (!selectedValue || input.value === '')) return;
                const state = composerAttachments(findEditor() || editor, files);
                if (state.named.size || state.pending || state.failure) return;
            }
            await pause(500);
            input = findFileInput(findEditor() || editor, files[0]);
        }
        throw new Error('ChatGPT did not handle the file selection. Its upload control is not ready; no answer request was sent.');
    }

    async function revealFileInput(editor, file) {
        // ChatGPT can mount its upload input only after opening the attachment
        // menu. A synthetic paste of a document is not a file-upload fallback.
        let menuOpened = false, menuClicked = false;
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
            const input = findFileInput(findEditor() || editor, file);
            if (input) return input;
            if (!menuOpened) {
                const add = [...document.querySelectorAll('[data-testid="composer-plus-btn"], [data-testid="attach-button"], button[aria-label]')]
                    .find(node => node.getClientRects().length && !node.disabled && node.getAttribute('aria-disabled') !== 'true'
                        && (node.matches('[data-testid="composer-plus-btn"], [data-testid="attach-button"]')
                            || /^(?:attach|add (?:photos|files)|прикрепить|добавить (?:фото|файл))/i.test(node.getAttribute('aria-label') || '')));
                if (add) { menuOpened = true; add.click(); }
            }
            const item = !menuClicked && [...document.querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="dialog"] button')]
                .find(node => node.getClientRects().length && !node.disabled
                    && /^(?:add photos (?:&|and) files|upload (?:a file|files|from computer)|добавить фото и файлы|загрузить (?:файл|с компьютера))/i.test((node.textContent || node.getAttribute('aria-label') || '').trim()));
            if (item) { menuClicked = true; item.click(); }
            await pause(100);
        }
        return null;
    }

    function composerAttachments(editor, files) {
        const named = new Map();
        // File chips are not necessarily inside the form and document uploads
        // need not expose image thumbnails or an attachment data-testid.
        // Match their real filename, excluding the composer instruction itself
        // and previous conversation turns that may mention the same filename.
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (node.nodeType === Node.ELEMENT_NODE && (node === editor || node.matches('[hidden], [aria-hidden="true"]') || (node.matches(attachmentExclusions) && !node.contains(editor)))) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            let text = node.nodeType === Node.TEXT_NODE ? node.textContent :
                ['title', 'aria-label', 'data-file-name', 'data-filename'].map(attr => node.getAttribute(attr) || '').join(' ');
            // A filename can be split into basename/extension or nested spans.
            // Read small labels as a whole, without aggregating the composer,
            // hidden labels or old conversation turns into attachment evidence.
            if (node.nodeType === Node.ELEMENT_NODE && node.childElementCount > 0 && node.childElementCount <= 6
                && !node.contains(editor)
                && !node.querySelector(attachmentExclusions + ', [hidden], [aria-hidden="true"], textarea, [contenteditable="true"]')) {
                const label = node.textContent || '';
                if (label.length <= 512) text += ' ' + label;
            }
            if (!text) continue;
            files.forEach((file, index) => {
                // Some cards display the extension separately from the basename.
                const basename = file.name.replace(/\.[^.]+$/, '');
                if (text.includes(file.name) || (basename.length >= 8 && text.includes(basename))) named.set(index, node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
            });
        }
        const visible = node => (!node.closest(attachmentExclusions) || node.closest(attachmentExclusions).contains(editor)) && !editor.contains(node)
            && !node.closest('[hidden], [aria-hidden="true"]') && node.getClientRects().length > 0;
        const region = (editor.closest('form') || editor.parentElement).parentElement;
        const cards = [...named.values()].map(node => node.closest('[data-file-id], [data-testid*="attachment"], [data-testid*="file"]') || node.parentElement);
        const pending = [...document.querySelectorAll('[role="progressbar"], progress, [data-testid*="upload-progress"], [data-upload-state="uploading"], [data-state="uploading"]')]
            .some(node => visible(node) && (region?.contains(node) || cards.some(card => card?.contains(node))));
        const failure = [...named.values()].map(node => node.closest('[data-file-id], [data-testid*="attachment"], [data-testid*="file"]') || node.parentElement)
            .find(card => /(?:upload failed|failed to upload|error uploading|file too large|не удалось загрузить|ошибка загрузки|файл слишком большой)/i.test(card?.textContent || ''));
        return { named, pending, failure };
    }

    async function attachFiles(editor, files) {
        if (!files.length) return editor;
        status('прикрепляю файлы запроса');
        const remaining = [...files];
        while (remaining.length) {
            editor = findEditor() || editor;
            const file = remaining[0];
            const input = await revealFileInput(editor, file);
            if (!input) {
                throw new Error('ChatGPT document upload input is unavailable for ' + file.name + '. The request file was not attached or sent.');
            }
            // Text and PDF pickers can be separate; some accept one file at a time.
            const batch = remaining.filter(candidate => acceptsFile(input, candidate)).slice(0, input.multiple ? undefined : 1);
            status('загружаю: ' + batch.map(candidate => candidate.name).join(', '));
            await selectUploadFiles(editor, input, batch);
            batch.forEach(candidate => remaining.splice(remaining.indexOf(candidate), 1));
            // React may replace both the composer and file input after change.
            await pause(100);
        }
        status('ожидаю подтверждение загрузки файлов');
        const deadline = Date.now() + 60000;
        let readySince = 0;
        let lastState;
        while (Date.now() < deadline) {
            const currentEditor = findEditor() || editor;
            const state = composerAttachments(currentEditor, files);
            lastState = state;
            if (state.failure) throw new Error('ChatGPT could not upload the attachment: ' + state.failure.textContent.trim().slice(0, 240));
            const confirmed = state.named.size === files.length;
            if (confirmed && !state.pending && findSend(currentEditor)) {
                if (!readySince) readySince = Date.now();
                if (Date.now() - readySince >= 1500) return currentEditor;
            } else readySince = 0;
            await pause(500);
        }
        throw new Error('Could not confirm PDF attachment or prompt file in ChatGPT (filenames: ' + (lastState?.named.size || 0) + '/' + files.length + ', uploading: ' + Boolean(lastState?.pending) + ', send ready: ' + Boolean(findSend(findEditor() || editor)) + '). No answer request was sent.');
    }

    async function run(job) {
        const editorDeadline = Date.now() + 30000;
        let editor, before;
        status(job.resume ? 'восстанавливаю запрос после перезагрузки' : 'запрос получен, ожидаю поле ввода ChatGPT');
        while (Date.now() < editorDeadline) {
            const turns = conversationTurns();
            const userIndex = turns.findIndex(turn => turn.role === 'user'
                && ((job.userTurnId && turn.id === job.userTurnId) || turn.text.includes('Request ID: ' + job.id)));
            if (userIndex >= 0) { before = snapshotConversation(turns.slice(0, userIndex)); break; }
            if (!job.mayHaveSent) {
                editor = findEditor();
                if (editor && !streaming()) break;
            }
            await pause(500);
        }
        if (!before) {
            if (job.mayHaveSent) throw new Error('The previously sent request is not visible after reload. Open its ChatGPT conversation and retry from the course. The prompt was not sent again.');
            if (!editor || streaming()) throw new Error('ChatGPT editor is unavailable. Check sign-in, verification, or an unfinished response.');
            // A large insertText transaction in the rich editor can freeze the
            // renderer. Upload the original prompt intact instead of expanding
            // thousands of JSON lines into ProseMirror paragraphs.
            const useFile = !(editor instanceof HTMLTextAreaElement) && job.prompt.length > 12000;
            const fileName = 'moodush-questions-' + job.id + '.txt';
            const composerText = useFile
                ? 'Прочитай файл ' + fileName + ': он содержит полный запрос, инструкции, вопросы и варианты ответов. Выполни его целиком. Верни только запрошенный JSON; не пропускай вопросы. Прочитай также openedu-full-page.pdf: он содержит снимок всей страницы курса, включая изображения и формулы.'
                : job.prompt;
            const hasDraft = Boolean(editorText(editor));
            if (hasDraft && !isMatchingJobDraft(editor, { ...job, prompt: composerText }) && !isMatchingJobDraft(editor, job)) {
                throw new Error('ChatGPT composer contains an unrelated unsent message. Move or send that draft, then reload the OpenEdu page to retry.');
            }
            const prompt = composerText + '\nRequest ID: ' + job.id;
            status(hasDraft ? 'возобновляю оставшийся запрос MooDuSh' : 'вставляю запрос');
            insertPrompt(editor, prompt);
            const files = useFile ? [new File([job.prompt], fileName, { type: 'text/plain' })] : [];
            for (const attachment of job.attachments || []) {
                const bytes = Uint8Array.from(atob(attachment.dataUrl.split(',')[1]), char => char.charCodeAt(0));
                files.push(new File([bytes], attachment.name, { type: attachment.mimeType }));
            }
            editor = await attachFiles(editor, files);
            if (!samePrompt(editor, prompt)) throw new Error('ChatGPT changed the composer draft during upload; automatic sending stopped.');
            before = await sendPrompt(editor, prompt, job.id);
            await reportPhase(job.id, 'submitted', currentExchange(job.id, before).user?.id);
        }
        status('запрос отправлен, ожидаю ответ');
        const deadline = Date.now() + Math.min(3600000, Math.max(60000, Number(job.answerTimeoutMs) || 600000));
        let last = '', lastReply = null, cachedOutput = null, stableAt = Date.now();
        while (Date.now() < deadline) {
            await pause(750);
            const exchange = currentExchange(job.id, before);
            // A user turn can retain a completed state while the assistant is
            // still being mounted. Never inherit that as response completion.
            if (!exchange.user || !exchange.reply) continue;
            const reply = exchange.reply.body;
            const state = String(exchange.reply?.state || exchange.user?.state || '').toLowerCase();
            if (['cancelled', 'canceled', 'stopped', 'interrupted'].includes(state)) {
                throw new Error('ChatGPT accepted the prompt, but generation was cancelled (Stopped thinking). No answers were applied.');
            }
            if (['error', 'failed'].includes(state)) throw new Error('ChatGPT accepted the prompt, but generation failed. No answers were applied.');
            const turn = exchange.reply?.root;
            const completed = turn?.querySelector('[data-testid="copy-turn-action-button"], [data-testid="good-response-turn-action-button"], [data-testid="bad-response-turn-action-button"]');
            const running = ['running', 'thinking', 'streaming', 'pending', 'queued', 'in_progress', 'in-progress'].includes(state);
            const finished = ['completed', 'complete', 'done', 'finished', 'success', 'succeeded'].includes(state);
            if ((completed || finished) && !running && !streaming()) {
                const value = reply.textContent || '';
                if (value !== last || reply !== lastReply) {
                    last = value; lastReply = reply; stableAt = Date.now();
                    cachedOutput = assistantOutput(reply);
                }
                if (cachedOutput?.json && Date.now() - stableAt > 3000) return cachedOutput.json;
                // Completion controls can belong to an intermediate thinking
                // block. Missing JSON is not a terminal result: allow the final
                // answer to mount until the response deadline.
            }
        }
        throw new Error('Timed out waiting for a valid answers JSON response from the current ChatGPT turn. No answers were applied.');
    }

    function accept(job) {
        if (!job || typeof job.id !== 'string' || typeof job.prompt !== 'string') return { error: 'Invalid ChatGPT job' };
        if (received.has(job.id)) return { ok: true, id: job.id, instanceId };
        if (activeJob) return { busy: true, id: activeJob };
        activeJob = job.id;
        received.add(job.id);
        // Acknowledge the job before touching the composer. Large matching
        // prompts can make editor updates expensive; delivery is a separate step.
        Promise.resolve().then(() => run(job)).then(text => {
            status('ответ получен, возвращаюсь к OpenEdu');
            return chrome.runtime.sendMessage({ type: 'PARAMEXT_CHATGPT_RESULT', id: job.id, instanceId, text });
        }).catch(error => {
            status(error.message, true);
            return chrome.runtime.sendMessage({ type: 'PARAMEXT_CHATGPT_RESULT', id: job.id, instanceId, error: error.message });
        }).catch(error => status('связь с расширением прервана: ' + error.message, true))
            .finally(() => { activeJob = null; });
        return { ok: true, id: job.id, instanceId };
    }

    // Install the receiver before announcing readiness. Re-announcement recovers
    // startup events that happened before the worker persisted the source job.
    chrome.runtime.onMessage.addListener((message, sender, respond) => {
        if (sender.id !== chrome.runtime.id || message?.type !== 'PARAMEXT_CHATGPT_RUN') return;
        respond(accept(message.job));
    });
    const readyUntil = Date.now() + 30000;
    async function announceReady() {
        try {
            const response = await chrome.runtime.sendMessage({ type: 'PARAMEXT_CHATGPT_READY', instanceId });
            if (response?.managed && !activeJob && received.size === 0) status('соединение установлено, ожидаю запрос');
        } catch (_) { /* Extension may be reloading. */ }
        if (!activeJob && received.size === 0 && Date.now() < readyUntil) setTimeout(announceReady, 1000);
    }
    announceReady();
})();
