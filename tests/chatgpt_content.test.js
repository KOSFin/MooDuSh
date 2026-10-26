const { test } = require('node:test');
const assert = require('node:assert/strict');

const { chat } = require('./helpers/chatgpt_tab');

test('actual tab adapter enters and sends a prompt using the current composer button ID', async () => {
    const c = chat();
    try {
        const ack = c.deliver();
        assert.equal(ack.ok, true); assert.equal(ack.id, 'job');
        await c.advance(6000);
        assert.equal(c.sends, 1);
        assert.ok(c.inserted[0].includes('Solve these questions\nRequest ID: job'));
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
        assert.match(c.w.document.getElementById('moodush-chatgpt-status').textContent, /ответ получен/);
    } finally { c.dom.window.close(); }
});

test('tab adapter waits for a delayed editor and does not duplicate redelivered jobs', async () => {
    const c = chat({ late: true });
    try {
        c.deliver(); c.deliver();
        await c.advance(2000);
        assert.equal(c.sends, 0);
        c.mount(); await c.advance(6000);
        assert.equal(c.sends, 1);
        c.deliver(); await c.advance(1000);
        assert.equal(c.sends, 1);
    } finally { c.dom.window.close(); }
});

test('contenteditable composer works without execCommand and with a role-based editor', async () => {
    const c = chat({ contenteditable: true, alternateEditor: true });
    try {
        c.deliver(); await c.advance(6000);
        assert.equal(c.sends, 1);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('unsent user draft is preserved and the failure is visible', async () => {
    const c = chat({ draft: 'my draft' });
    try {
        c.deliver(); await c.advance(100);
        assert.equal(c.sends, 0);
        assert.equal(c.w.document.getElementById('prompt-textarea').value, 'my draft');
        assert.match(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.error, /unsent message/);
        assert.match(c.w.document.getElementById('moodush-chatgpt-status').textContent, /unsent message/);
    } finally { c.dom.window.close(); }
});

test('missing editor returns an explicit error after 30 seconds instead of waiting silently', async () => {
    const c = chat({ late: true });
    try {
        c.deliver(); await c.advance(31000);
        assert.equal(c.sends, 0);
        assert.match(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.error, /editor is unavailable/);
    } finally { c.dom.window.close(); }
});

test('hidden stale send controls cannot intercept the actual composer button', async () => {
    const c = chat({ hiddenDecoy: true });
    try {
        c.deliver(); await c.advance(6500);
        assert.equal(c.sends, 1);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('native form submission is supported and confirmed through the sent user message', async () => {
    const c = chat({ formSubmit: true });
    try {
        c.deliver(); await c.advance(6500);
        assert.equal(c.sends, 1);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('Enter fallback handles composers whose button click does not submit', async () => {
    const c = chat({ enterOnly: true });
    try {
        c.deliver(); await c.advance(10000);
        assert.equal(c.sends, 1);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('an ignored send action is reported rather than claiming the prompt was sent', async () => {
    const c = chat({ noAcceptance: true });
    try {
        c.deliver(); await c.advance(11000);
        assert.equal(c.sends, 0);
        assert.match(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.error, /did not confirm sending/);
        assert.ok(c.w.document.getElementById('prompt-textarea').value.includes('Request ID: job'));
    } finally { c.dom.window.close(); }
});


test('paragraph markup for pasted newlines does not falsely reject a correct prompt', async () => {
    const c = chat({ contenteditable: true, paragraphEdits: true });
    try {
        c.deliver('job', 'First line\nSecond line\nThird line');
        await c.advance(6500);
        assert.equal(c.sends, 1);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});


test('a matching generated draft left by a failed run resumes with a fresh request ID', async () => {
    const c = chat({ draft: 'Solve these questions\nRequest ID: old-job' });
    try {
        c.deliver('new-job'); await c.advance(6500);
        assert.equal(c.sends, 1);
        assert.ok(c.inserted[0].includes('Request ID: new-job'));
        assert.ok(!c.inserted[0].includes('old-job'));
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('a request marker alone cannot authorize replacing an unrelated draft', async () => {
    const draft = 'My unrelated question\nRequest ID: old-job';
    const c = chat({ draft });
    try {
        c.deliver(); await c.advance(100);
        assert.equal(c.sends, 0);
        assert.equal(c.w.document.getElementById('prompt-textarea').value, draft);
        assert.match(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.error, /unrelated unsent message/);
    } finally { c.dom.window.close(); }
});


test('collapsed sent prompts confirm acceptance even when their request marker is hidden', async () => {
    const c = chat({ collapsedPrompt: true });
    try {
        c.deliver(); await c.advance(6500);
        assert.equal(c.sends, 1);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('turn attributes support confirmation and reading responses without author-role attributes', async () => {
    const c = chat({ turnAttributes: true, collapsedPrompt: true });
    try {
        c.deliver(); await c.advance(6500);
        assert.equal(c.sends, 1);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('old assistant responses are excluded when matching a newly sent request', async () => {
    const c = chat({ collapsedPrompt: true });
    try {
        const old = c.w.document.createElement('article');
        old.dataset.turn = 'assistant'; old.dataset.turnId = 'old';
        old.innerHTML = '<div class="markdown">{"answers":["stale"]}</div><button data-testid="copy-turn-action-button"></button>';
        c.w.document.body.appendChild(old);
        c.deliver(); await c.advance(6500);
        assert.equal(c.sends, 1);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});


test('saved Work markup confirms an accepted prompt and reports cancellation precisely', async () => {
    const c = chat({ workLayout: 'cancelled' });
    try {
        c.deliver(); await c.advance(12000);
        assert.equal(c.sends, 1);
        const result = c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT');
        assert.match(result?.error, /accepted the prompt, but generation was cancelled/);
        assert.ok(!result.error.includes('did not confirm'));
    } finally { c.dom.window.close(); }
});

test('Work user and assistant share a turn key without hiding a completed answer', async () => {
    const c = chat({ workLayout: 'completed' });
    try {
        c.deliver(); await c.advance(6500);
        assert.equal(c.sends, 1);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});


test('Work accessibility heading is excluded from a plain JSON response', async () => {
    const c = chat({ workLayout: 'completed', workHeading: true });
    try {
        c.deliver(); await c.advance(6500);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('Work final response can be a sibling of the heading and activity block', async () => {
    const c = chat({ workLayout: 'completed', workHeading: true, workSibling: true });
    try {
        c.deliver(); await c.advance(6500);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('label-only response never parses the JSON example in the user prompt', async () => {
    const c = chat({ workLayout: 'completed', workHeading: true, workLabelOnly: true });
    try {
        c.deliver('job', 'Example {"answers":[{"questionKey":"example"}]}');
        await c.advance(12000);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT'), undefined);
        await c.advance(590000);
        const result = c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT');
        assert.equal(result?.text, undefined);
        assert.match(result?.error, /Timed out waiting for a valid/);
    } finally { c.dom.window.close(); }
});

test('response extraction tolerates surrounding text and braces inside quoted answers', async () => {
    const expected = { answers: [{ questionKey: 'q', answers: [{ answerText: 'a } \" b { c' }] }] };
    const c = chat({ workLayout: 'completed', workHeading: true, reply: () => 'ChatGPT said:\n```json\n' + JSON.stringify(expected) + '\n```\nCopy' });
    try {
        c.deliver(); await c.advance(6500);
        assert.deepEqual(JSON.parse(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text), expected);
    } finally { c.dom.window.close(); }
});

test('Work final answer outside the state subtree is still read', async () => {
    const c = chat({ workLayout: 'completed', workHeading: true, workLabelOnly: true });
    try {
        c.deliver(); await c.advance(400);
        const state = c.w.document.querySelector('[data-talvt-turn-state]');
        const answer = c.w.document.createElement('div');
        answer.textContent = '{"answers":[{"index":3,"questionKey":"q2_f8b48aec7052c3def70094efcc05f5d4","answers":[{"answerKey":"1947483719","answerText":"Аферист"}]}]}';
        state.after(answer);
        await c.advance(6500);
        const result = c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT');
        assert.equal(result?.text, answer.textContent);
        assert.equal(result?.error, undefined);
    } finally { c.dom.window.close(); }
});

test('final message sibling is read instead of the first assistant reasoning body', async () => {
    const c = chat({ reply: () => 'Thinking about the questions...' });
    try {
        c.deliver(); await c.advance(400);
        const answer = c.w.document.createElement('div');
        answer.dataset.messageAuthorRole = 'assistant';
        answer.innerHTML = '<pre><code>{"answers":[{"questionKey":"Q3","answers":[{"answerText":"Шулер"}]}]}</code></pre>';
        c.w.document.querySelector('article').appendChild(answer);
        await c.advance(6500);
        assert.equal(JSON.parse(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text).answers[0].questionKey, 'Q3');
    } finally { c.dom.window.close(); }
});

test('latest new assistant message is selected after an intermediate assistant message', async () => {
    const c = chat({ reply: () => 'Thinking about the questions...' });
    try {
        c.deliver(); await c.advance(400);
        const final = c.w.document.createElement('article');
        final.innerHTML = '<div data-message-author-role="assistant"><pre>{"answers":[]}</pre></div><button data-testid="copy-turn-action-button"></button>';
        c.w.document.body.appendChild(final);
        await c.advance(6500);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('completed placeholder does not fail while a delayed final response is still pending', async () => {
    const c = chat({ workLayout: 'completed', workHeading: true, workLabelOnly: true });
    try {
        c.deliver(); await c.advance(45000);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT'), undefined);
        const final = c.w.document.createElement('div');
        final.setAttribute('data-markdown', '');
        final.textContent = '{"answers":[{"questionKey":"Q3","answers":[{"answerText":"Шулер"}]}]}';
        c.w.document.querySelector('[data-turn-key]').appendChild(final);
        await c.advance(6500);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, final.textContent);
        assert.equal(c.sends, 1);
    } finally { c.dom.window.close(); }
});

test('completed intermediate assistant message waits for the later final message', async () => {
    const c = chat({ reply: () => 'Thinking...' });
    try {
        c.deliver(); await c.advance(30000);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT'), undefined);
        const final = c.w.document.createElement('article');
        final.innerHTML = '<div data-message-author-role="assistant">{"answers":[]}</div><button data-testid="copy-turn-action-button"></button>';
        c.w.document.body.appendChild(final);
        await c.advance(6500);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('an assistant response without the current user turn cannot complete the request', async () => {
    const c = chat();
    try {
        c.deliver(); await c.advance(400);
        const user = c.w.document.querySelector('[data-message-author-role="user"]');
        user.remove();
        await c.advance(15000);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT'), undefined);
        c.w.document.querySelector('article').before(user);
        await c.advance(6500);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('a ChatGPT response taking eight minutes still completes without resending', async () => {
    const c = chat({ reply: () => 'Thinking...' });
    try {
        c.deliver(); await c.advance(8 * 60 * 1000);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT'), undefined);
        const final = c.w.document.createElement('article');
        final.innerHTML = '<div data-message-author-role="assistant">{"answers":[]}</div><button data-testid="copy-turn-action-button"></button>';
        c.w.document.body.appendChild(final);
        await c.advance(6500);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
        assert.equal(c.sends, 1);
    } finally { c.dom.window.close(); }
});

test('configured one-minute timeout replaces the default ten-minute timeout', async () => {
    const c = chat({ answerTimeoutMs: 60000, reply: () => 'Thinking...' });
    try {
        c.deliver(); await c.advance(59000);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT'), undefined);
        await c.advance(3000);
        assert.match(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.error, /Timed out/);
        assert.equal(c.sends, 1);
    } finally { c.dom.window.close(); }
});

test('configured longer timeout allows a response after the former ten-minute deadline', async () => {
    const c = chat({ answerTimeoutMs: 25 * 60000, reply: () => 'Thinking...' });
    try {
        c.deliver(); await c.advance(11 * 60000);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT'), undefined);
        const final = c.w.document.createElement('article');
        final.innerHTML = '<div data-message-author-role="assistant">{"answers":[]}</div><button data-testid="copy-turn-action-button"></button>';
        c.w.document.body.appendChild(final);
        await c.advance(6500);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});


function mockDocumentUpload(c, confirm = true, accept = '.pdf,.txt') {
    class Transfer {
        constructor() { this.files = []; this.items = { add: file => this.files.push(file) }; }
    }
    c.w.DataTransfer = Transfer;
    const input = c.w.document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = accept;
    Object.defineProperty(input, 'files', { value: [], writable: true });
    input.addEventListener('change', () => {
        if (!confirm) return;
        for (const file of input.files) {
            if (['text/plain', 'application/pdf'].includes(file.type)) {
                // Document chips use plain text and an icon, outside the form;
                // they need neither an img nor an attachment data-testid.
                const card = c.w.document.createElement('div');
                const name = c.w.document.createElement('span'); name.textContent = file.name.replace(/\.txt$/, '');
                const type = c.w.document.createElement('span'); type.textContent = file.type === 'application/pdf' ? 'PDF' : 'TXT';
                const remove = c.w.document.createElement('button'); remove.type = 'button'; remove.setAttribute('aria-label', 'Remove');
                card.append(name, type, remove); c.w.document.body.appendChild(card);
            } else {
                const image = c.w.document.createElement('img'); image.src = 'blob:' + file.name;
                c.w.document.querySelector('form').appendChild(image);
            }
        }
    });
    c.w.document.querySelector('form').appendChild(input);
    return input;
}

function nativePickerSelection(input) {
    let files = [];
    // Unlike the old writable-files mock, native file inputs acquire a nonempty
    // value after assignment, and clearing value also clears their FileList.
    Object.defineProperty(input, 'files', { configurable: true, get: () => files, set: value => { files = [...value]; } });
    Object.defineProperty(input, 'value', { configurable: true,
        get: () => files.length ? 'C:\\fakepath\\' + files[0].name : '',
        set: value => { if (value === '') files = []; }
    });
}

function uploadedCards(c, files) {
    const tray = c.w.document.querySelector('[data-composer-attachments]');
    for (const file of files) {
        const card = c.w.document.createElement('div'); card.dataset.fileId = 'uploaded-' + file.name;
        card.textContent = file.name; tray.appendChild(card);
    }
}

test('saved composer retries an unhandled native selection until ChatGPT consumes the full request', async () => {
    const c = chat({ contenteditable: true, savedComposer: true, paragraphEdits: true,
        attachments: [{ name: 'openedu-full-page.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=' }] });
    try {
        mockDocumentUpload(c, false).remove(); // Install DataTransfer, not another picker.
        const input = c.w.document.querySelector('input[aria-label="Attach files"]');
        nativePickerSelection(input);
        const selected = [], events = [];
        input.addEventListener('input', () => events.push('input'));
        input.addEventListener('change', () => events.push('change'));
        c.w.setTimeout(() => input.addEventListener('change', () => {
            selected.push([...input.files]); input.value = ''; uploadedCards(c, selected.at(-1));
        }), 1200);
        const prompt = 'Full instructions and all questions: ' + 'x'.repeat(94000);
        c.deliver('saved-upload', prompt); await c.advance(10000);
        assert.equal(selected.length, 1, 'only one selection is consumed by the application');
        assert.equal(selected[0].length, 2);
        assert.equal(selected[0][0].name, 'moodush-questions-saved-upload.txt');
        assert.equal(selected[0][1].name, 'openedu-full-page.pdf');
        assert.ok(events.length > 2, 'the first unhandled selection must be retried');
        assert.deepEqual(events.slice(0, 2), ['input', 'change']);
        const text = await new Promise(resolve => {
            const reader = new c.w.FileReader(); reader.onload = () => resolve(reader.result); reader.readAsText(selected[0][0]);
        });
        assert.equal(text, prompt);
        assert.equal(c.sends, 1);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('saved composer reacquires a picker replaced by the input event before change', async () => {
    const c = chat({ contenteditable: true, savedComposer: true });
    try {
        mockDocumentUpload(c, false).remove();
        const original = c.w.document.querySelector('input[aria-label="Attach files"]');
        nativePickerSelection(original);
        let staleChanges = 0, accepted = 0;
        original.addEventListener('change', () => staleChanges++);
        original.addEventListener('input', () => {
            const replacement = original.cloneNode(); nativePickerSelection(replacement);
            replacement.addEventListener('change', () => {
                accepted++; const files = [...replacement.files]; replacement.value = ''; uploadedCards(c, files);
            });
            original.replaceWith(replacement);
        }, { once: true });
        c.deliver('replaced-picker', 'questions '.repeat(2000)); await c.advance(10000);
        assert.equal(staleChanges, 0);
        assert.equal(accepted, 1);
        assert.equal(c.sends, 1);
    } finally { c.dom.window.close(); }
});

test('an ignored native file selection fails explicitly without waiting for nonexistent attachments', async () => {
    const c = chat({ contenteditable: true, savedComposer: true });
    try {
        mockDocumentUpload(c, false).remove();
        nativePickerSelection(c.w.document.querySelector('input[aria-label="Attach files"]'));
        c.deliver('ignored-selection', 'questions '.repeat(2000)); await c.advance(6500);
        assert.equal(c.sends, 0);
        assert.match(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.error, /did not handle the file selection/);
    } finally { c.dom.window.close(); }
});

test('the answer request sends only after the full-page screenshot appears in the composer', async () => {
    const attachments = [{ name: 'openedu-full-page.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=' }];
    const c = chat({ attachments });
    try {
        const input = mockDocumentUpload(c);
        c.deliver('full-page', 'Return all answers'); await c.advance(8000);
        assert.equal(input.files.length, 1);
        assert.equal(input.files[0].name, attachments[0].name);
        assert.equal(c.sends, 1);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT').text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('an unconfirmed full-page upload stops before sending the answer request', async () => {
    const c = chat({ attachments: [{ name: 'openedu-full-page.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=' }] });
    try {
        mockDocumentUpload(c, false);
        c.deliver(); await c.advance(62000);
        assert.equal(c.sends, 0);
        assert.match(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT').error, /confirm PDF attachment/);
    } finally { c.dom.window.close(); }
});


test('large matching prompts are acknowledged before composer work and are sent only once', async () => {
    const c = chat();
    try {
        const prompt = 'Matching options: ' + 'x'.repeat(94000);
        assert.equal(c.deliver('large-job', prompt).ok, true);
        assert.equal(c.inserted.length, 0, 'delivery acknowledgement must precede expensive editor updates');
        c.deliver('large-job', prompt);
        await c.advance(6500);
        assert.equal(c.sends, 1);
        assert.ok(c.inserted[0].includes(prompt));
        c.deliver('large-job', prompt); await c.advance(1000);
        assert.equal(c.sends, 1);
    } finally { c.dom.window.close(); }
});

test('large rich-editor prompts are uploaded intact as text files with a short composer message', async () => {
    const c = chat({ contenteditable: true, paragraphEdits: true, attachments: [{ name: 'openedu-full-page.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=' }] });
    const prompt = 'Original full instructions and questions: ' + 'x'.repeat(94000);
    try {
        const input = mockDocumentUpload(c, true, '*/*');
        c.deliver('large-file', prompt); await c.advance(9000);
        assert.equal(c.sends, 1);
        assert.ok(c.inserted.every(text => text.length < 1000), 'the rich editor must never receive the large payload');
        assert.equal(input.files.length, 2);
        assert.equal(input.files[1].name, 'openedu-full-page.pdf');
        assert.equal(input.files[0].type, 'text/plain');
        assert.equal(input.files[0].name, 'moodush-questions-large-file.txt');
        const text = await new Promise((resolve, reject) => {
            const reader = new c.w.FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsText(input.files[0]);
        });
        assert.equal(text, prompt);
        assert.ok(c.inserted[0].includes(input.files[0].name));
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('lazy attachment menu mounts separate text and PDF inputs before mixed upload', async () => {
    const c = chat({ contenteditable: true, attachments: [{ name: 'openedu-full-page.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=' }] });
    try {
        const documents = mockDocumentUpload(c, true, '.txt'); documents.remove();
        const attachments = mockDocumentUpload(c, true, 'application/pdf'); attachments.remove();
        const add = c.w.document.createElement('button'); add.type = 'button'; add.dataset.testid = 'composer-plus-btn';
        let menuClicks = 0, pasteEvents = 0;
        c.w.document.addEventListener('paste', () => pasteEvents++);
        add.onclick = () => {
            const item = c.w.document.createElement('button'); item.setAttribute('role', 'menuitem'); item.textContent = 'Add photos & files';
            item.onclick = () => { menuClicks++; c.w.document.querySelector('form').append(documents, attachments); item.remove(); };
            c.w.document.body.appendChild(item);
        };
        c.w.document.querySelector('form').appendChild(add);
        const prompt = 'Full questions '.repeat(2000);
        c.deliver('lazy-files', prompt); await c.advance(9000);
        assert.equal(menuClicks, 1);
        assert.equal(pasteEvents, 0, 'documents must use the document upload handler');
        assert.equal(documents.files.length, 1);
        assert.equal(documents.files[0].name, 'moodush-questions-lazy-files.txt');
        assert.equal(attachments.files.length, 1);
        assert.equal(attachments.files[0].name, 'openedu-full-page.pdf');
        assert.equal(c.sends, 1);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('a single-file picker uploads documents one at a time', async () => {
    const c = chat({ attachments: [1, 2].map(n => ({ name: 'page-' + n + '.pdf', mimeType: 'application/pdf', dataUrl: 'data:application/pdf;base64,JVBERi0=' })) });
    try {
        const input = mockDocumentUpload(c); input.multiple = false;
        const batches = [];
        input.addEventListener('change', () => batches.push([...input.files].map(file => file.name)));
        c.deliver(); await c.advance(9000);
        assert.deepEqual(batches, [['page-1.pdf'], ['page-2.pdf']]);
        assert.equal(c.sends, 1);
    } finally { c.dom.window.close(); }
});

test('upload waits for a document input mounted after the prompt editor updates', async () => {
    const c = chat({ contenteditable: true });
    try {
        const input = mockDocumentUpload(c, true, '.txt'); input.remove();
        c.w.document.querySelector('#prompt-textarea').addEventListener('input', () => {
            c.w.setTimeout(() => c.w.document.querySelector('form').appendChild(input), 300);
        });
        c.deliver('delayed-picker', 'questions '.repeat(2000)); await c.advance(9000);
        assert.equal(input.files[0].name, 'moodush-questions-delayed-picker.txt');
        assert.equal(c.sends, 1);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('missing document picker reports the upload stage without silently pasting a file', async () => {
    const c = chat({ contenteditable: true });
    try {
        let pastes = 0;
        c.w.document.addEventListener('paste', () => pastes++);
        c.deliver('no-picker', 'questions '.repeat(2000)); await c.advance(4000);
        assert.equal(pastes, 0);
        assert.equal(c.sends, 0);
        assert.match(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.error, /document upload input is unavailable/);
    } finally { c.dom.window.close(); }
});

test('failed large-prompt upload stops visibly and never falls back to a giant editor insertion', async () => {
    const c = chat({ contenteditable: true, paragraphEdits: true });
    try {
        mockDocumentUpload(c, false, '*/*');
        c.deliver('upload-failed', 'x'.repeat(94000)); await c.advance(62000);
        assert.equal(c.sends, 0);
        assert.ok(c.inserted.every(text => text.length < 1000));
        assert.match(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.error, /confirm PDF attachment or prompt file/);
    } finally { c.dom.window.close(); }
});

test('a reloaded adapter reads the existing answer without editing or sending another message', async () => {
    const c = chat({ late: true });
    try {
        c.w.document.body.insertAdjacentHTML('beforeend', '<div data-message-author-role="user">Existing request\nRequest ID: restored</div><article><div data-message-author-role="assistant">{"answers":[{"questionKey":"Q1","answers":[{"answerText":"result"}]}]}</div><button data-testid="copy-turn-action-button"></button></article>');
        c.deliver('restored', 'Existing request', undefined, { resume: true, mayHaveSent: true });
        await c.advance(6000);
        assert.equal(c.sends, 0);
        assert.equal(c.inserted.length, 0);
        assert.match(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, /result/);
    } finally { c.dom.window.close(); }
});

test('uncertain requests missing after reload stop explicitly instead of stalling or resending', async () => {
    const c = chat();
    try {
        c.deliver('not-visible', 'Original prompt', undefined, { resume: true, mayHaveSent: true });
        await c.advance(31000);
        assert.equal(c.sends, 0);
        assert.equal(c.inserted.length, 0);
        assert.match(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.error, /previously sent request is not visible/);
    } finally { c.dom.window.close(); }
});

test('an unsent request can resume normally after the adapter reloads', async () => {
    const c = chat();
    try {
        c.deliver('unsent', 'Original prompt', undefined, { resume: true, mayHaveSent: false });
        await c.advance(6000);
        assert.equal(c.sends, 1);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
        const phases = c.messages.filter(m => m.type === 'PARAMEXT_CHATGPT_PHASE').map(m => m.phase);
        assert.deepEqual(phases, ['sending', 'submitted']);
    } finally { c.dom.window.close(); }
});

test('streaming assistant trees are not cloned while waiting for the final response', async () => {
    const c = chat();
    try {
        c.deliver(); await c.advance(300);
        const reply = c.w.document.querySelector('[data-message-author-role="assistant"]').closest('article');
        assert.ok(reply);
        let clones = 0;
        const original = reply.cloneNode.bind(reply);
        reply.cloneNode = (...args) => { clones++; return original(...args); };
        const stop = c.w.document.createElement('button'); stop.dataset.testid = 'stop-button'; c.w.document.body.appendChild(stop);
        await c.advance(3000);
        assert.equal(clones, 0);
        stop.remove(); await c.advance(5000);
        assert.equal(clones, 1, 'completed response parsing is cached while waiting for stability');
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('text-file chips outside the form send despite unrelated composer aria-busy state', async () => {
    const c = chat({ contenteditable: true });
    try {
        mockDocumentUpload(c, true, '.txt');
        c.w.document.querySelector('form').setAttribute('aria-busy', 'true');
        c.deliver('plain-chip', 'questions '.repeat(2000)); await c.advance(9000);
        assert.equal(c.sends, 1);
        assert.equal(c.w.document.querySelector('form [data-testid="attachment"]'), null);
        assert.equal(c.w.document.querySelector('form img'), null);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('a document filename split across nested spans still confirms the attachment', async () => {
    const c = chat({ contenteditable: true });
    try {
        const input = mockDocumentUpload(c, false, '.txt');
        input.addEventListener('change', () => {
            const card = c.w.document.createElement('div');
            const name = c.w.document.createElement('div');
            for (const part of ['moodush-questions-', 'split-name', '.txt']) {
                const span = c.w.document.createElement('span'); span.textContent = part; name.appendChild(span);
            }
            card.appendChild(name); c.w.document.body.appendChild(card);
        });
        c.deliver('split-name', 'questions '.repeat(2000)); await c.advance(9000);
        assert.equal(c.sends, 1);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('upload progress next to the form delays sending until the file finishes', async () => {
    const c = chat({ contenteditable: true });
    try {
        mockDocumentUpload(c, true, '.txt');
        const progress = c.w.document.createElement('div'); progress.setAttribute('role', 'progressbar');
        c.w.document.body.appendChild(progress);
        c.deliver('upload-progress', 'questions '.repeat(2000)); await c.advance(3000);
        assert.equal(c.sends, 0);
        progress.remove(); await c.advance(9000);
        assert.equal(c.sends, 1);
    } finally { c.dom.window.close(); }
});

test('a filename mentioned only in conversation history cannot confirm an absent upload', async () => {
    const c = chat({ contenteditable: true });
    try {
        mockDocumentUpload(c, false, '.txt');
        const previous = c.w.document.createElement('article'); previous.setAttribute('data-message-author-role', 'assistant');
        previous.textContent = 'moodush-questions-history-only.txt'; c.w.document.body.appendChild(previous);
        c.deliver('history-only', 'questions '.repeat(2000)); await c.advance(62000);
        assert.equal(c.sends, 0);
        assert.match(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.error, /filenames: 0\/1/);
    } finally { c.dom.window.close(); }
});

test('upload can replace the composer and sending uses the replacement editor', async () => {
    const c = chat({ contenteditable: true });
    try {
        const input = mockDocumentUpload(c, true, '.txt');
        input.addEventListener('change', () => {
            const old = c.w.document.querySelector('#prompt-textarea');
            const text = old.textContent; old.closest('form').remove();
            const editor = c.mount(); editor.textContent = text;
            editor.dispatchEvent(new c.w.InputEvent('input', { bubbles: true }));
        });
        c.deliver('remounted', 'questions '.repeat(2000)); await c.advance(9000);
        assert.equal(c.sends, 1);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('an explicit upload failure stops sending even when the filename and send button exist', async () => {
    const c = chat({ contenteditable: true });
    try {
        const input = mockDocumentUpload(c, true, '.txt');
        input.addEventListener('change', () => {
            const card = [...c.w.document.body.children].find(node => node.id !== 'moodush-chatgpt-status' && node.textContent.includes('moodush-questions-upload-error') && node.tagName === 'DIV');
            card.appendChild(c.w.document.createTextNode(' Upload failed'));
        });
        c.deliver('upload-error', 'questions '.repeat(2000)); await c.advance(5000);
        assert.equal(c.sends, 0);
        assert.match(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.error, /could not upload the attachment/);
    } finally { c.dom.window.close(); }
});

test('file chips remain visible to confirmation when the active composer is inside a Work turn', async () => {
    const c = chat({ contenteditable: true });
    try {
        const input = mockDocumentUpload(c, true, '.txt');
        const turn = c.w.document.createElement('section'); turn.setAttribute('data-turn-key', 'active-work-turn');
        c.w.document.body.appendChild(turn); turn.appendChild(c.w.document.querySelector('form'));
        input.addEventListener('change', () => {
            const chip = [...c.w.document.body.children].find(node => node.tagName === 'DIV' && node.textContent.includes('moodush-questions-work-chip'));
            turn.appendChild(chip);
        });
        c.deliver('work-chip', 'questions '.repeat(2000)); await c.advance(9000);
        assert.equal(c.sends, 1);
        assert.equal(c.messages.find(m => m.type === 'PARAMEXT_CHATGPT_RESULT')?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});

test('retry replaces its own failed file-upload draft when the new request gets a new filename', async () => {
    const c = chat({ contenteditable: true });
    try {
        const failedInput = mockDocumentUpload(c, false, '.txt');
        const prompt = 'questions '.repeat(2000);
        c.deliver('failed-old', prompt); await c.advance(62000);
        assert.equal(c.sends, 0);
        assert.ok(c.w.document.querySelector('#prompt-textarea').textContent.includes('moodush-questions-failed-old.txt'));
        failedInput.remove(); mockDocumentUpload(c, true, '.txt');
        c.deliver('retry-new', prompt); await c.advance(9000);
        assert.equal(c.sends, 1);
        assert.ok(c.inserted.at(-1).includes('moodush-questions-retry-new.txt'));
        assert.equal(c.messages.filter(m => m.type === 'PARAMEXT_CHATGPT_RESULT').at(-1)?.text, '{"answers":[]}');
    } finally { c.dom.window.close(); }
});
