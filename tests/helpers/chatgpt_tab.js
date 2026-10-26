const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const flush = () => new Promise(resolve => setImmediate(resolve));

function chat(options = {}) {
    const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://chatgpt.com/', runScripts: 'outside-only' });
    const w = dom.window;
    const messages = [], inserted = [];
    let receiver, now = 0, nextTimer = 1, sendCount = 0;
    const timers = new Map();
    w.Date.now = () => now;
    w.setTimeout = (callback, delay = 0) => { const id = nextTimer++; timers.set(id, { callback, due: now + delay }); return id; };
    w.clearTimeout = id => timers.delete(id);
    w.HTMLElement.prototype.getClientRects = function () { return this.hidden ? [] : [{}]; };
    w.chrome = {
        runtime: {
            id: 'extension',
            onMessage: { addListener(fn) { receiver = fn; } },
            async sendMessage(message) { messages.push(message); return options.sendMessage ? options.sendMessage(message) : { ok: true, managed: true }; }
        }
    };
    function mount() {
        let form = w.document.createElement('form');
        if (options.savedComposer) {
            const template = w.document.createElement('template');
            template.innerHTML = fs.readFileSync(require.resolve('../fixtures/chatgpt-upload-composer.html'), 'utf8');
            form = template.content.querySelector('form');
        }
        const editor = options.savedComposer ? form.querySelector('[contenteditable="true"]')
            : options.contenteditable ? w.document.createElement('div') : w.document.createElement('textarea');
        if (options.alternateEditor) { editor.setAttribute('contenteditable', 'true'); editor.setAttribute('role', 'textbox'); }
        else if (!options.savedComposer) editor.id = 'prompt-textarea';
        if (options.contenteditable) editor.setAttribute('contenteditable', 'true');
        if (options.draft) editor.textContent = options.draft;
        if (options.paragraphEdits) {
            w.document.execCommand = (command, unused, text) => {
                if (command !== 'insertText') return false;
                editor.replaceChildren(...text.split('\n').map(line => { const p = w.document.createElement('p'); p.textContent = line; return p; }));
                return true;
            };
        }
        const send = options.savedComposer ? form.querySelector('button[type="submit"]') : w.document.createElement('button');
        if (!options.savedComposer) { send.id = 'composer-submit-button'; send.type = options.formSubmit ? 'submit' : 'button'; }
        if (options.hiddenDecoy) {
            const decoy = send.cloneNode(); decoy.hidden = true; decoy.disabled = false;
            form.appendChild(decoy);
        }
        send.disabled = true;
        editor.addEventListener('input', () => { inserted.push(editor.value ?? editor.textContent); if (!options.disabledSend) send.disabled = false; });
        const performSend = () => {
            sendCount++;
            const prompt = editor.value ?? editor.textContent;
            const user = w.document.createElement('div');
            if (options.turnAttributes) user.dataset.turn = 'user';
            else user.dataset.messageAuthorRole = 'user';
            user.textContent = options.collapsedPrompt ? prompt.slice(0, 12) : prompt;
            const article = w.document.createElement('article');
            const assistant = w.document.createElement('div');
            if (options.turnAttributes) article.dataset.turn = 'assistant';
            else assistant.dataset.messageAuthorRole = 'assistant';
            if (options.turnAttributes) assistant.dataset.testid = 'assistant-body';
            const body = w.document.createElement('div'); body.className = 'markdown'; body.textContent = options.reply ? options.reply(prompt) : '{"answers":[]}';
            assistant.appendChild(body); article.appendChild(assistant);
            const complete = w.document.createElement('button'); complete.dataset.testid = 'copy-turn-action-button'; article.appendChild(complete);
            if (options.workLayout) {
                const template = w.document.createElement('template');
                template.innerHTML = fs.readFileSync(require.resolve('../fixtures/chatgpt-work-turn.html'), 'utf8');
                const turn = template.content.firstElementChild;
                turn.setAttribute('data-turn-key', 'work-' + sendCount);
                if (options.workLayout === 'completed') {
                    turn.querySelector('[data-talvt-turn-state]').setAttribute('data-talvt-turn-state', 'completed');
                    const output = turn.querySelector('[data-chatgpt-agent-turn-start]').parentElement;
                    output.querySelector('.group\\/activity-header')?.remove();
                    const markdown = w.document.createElement('div'); markdown.setAttribute('data-markdown', ''); markdown.textContent = options.reply ? options.reply(prompt) : '{"answers":[]}';
                    if (options.workHeading) {
                        const heading = w.document.createElement('h4'); heading.className = 'sr-only'; heading.textContent = 'ChatGPT said:';
                        output.prepend(heading);
                        markdown.removeAttribute('data-markdown');
                    }
                    if (options.workLabelOnly) markdown.textContent = '';
                    if (options.workSibling) {
                        const sibling = w.document.createElement('div'); sibling.appendChild(markdown);
                        output.after(sibling);
                    } else output.appendChild(markdown);
                }
                w.document.body.appendChild(turn);
            } else w.document.body.append(user, article);
            if ('value' in editor) editor.value = ''; else editor.textContent = '';
        };
        send.addEventListener('click', () => { if (!options.enterOnly && !options.formSubmit && !options.savedComposer && !options.noAcceptance) performSend(); });
        form.addEventListener('submit', event => { event.preventDefault(); if (!options.noAcceptance) performSend(); });
        editor.addEventListener('keydown', event => { if (event.key === 'Enter' && options.enterOnly) { event.preventDefault(); performSend(); } });
        if (!options.savedComposer) form.append(editor, send);
        w.document.body.appendChild(form);
        return editor;
    }
    if (!options.late) mount();
    w.eval(fs.readFileSync(require.resolve('../../js/chatgpt_content.js'), 'utf8'));
    async function advance(ms) {
        await flush();
        const end = now + ms;
        for (let limit = 0; limit < 2000; limit++) {
            const due = [...timers].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0];
            if (!due) break;
            now = due[1].due; timers.delete(due[0]); due[1].callback(); await flush();
        }
        now = end; await flush();
    }
    return {
        dom, w, messages, inserted, mount, advance,
        get sends() { return sendCount; },
        deliver(id = 'job', prompt = 'Solve these questions', answerTimeoutMs = options.answerTimeoutMs, extra = {}) { let ack; receiver({ type: 'PARAMEXT_CHATGPT_RUN', job: { id, prompt, answerTimeoutMs, attachments: options.attachments, ...extra } }, { id: 'extension' }, response => { ack = response; }); return ack; }
    };
}

module.exports = { chat };
