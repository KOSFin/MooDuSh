(function (root) {
    const STYLE_ID = 'moodush-openedu-debug-overlay-style';
    const ATTR = 'data-moodush-openedu-debug';

    function ensureStyle(doc) {
        if (doc.getElementById(STYLE_ID)) {
            return;
        }
        const style = doc.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            [${ATTR}="question"] { outline: 2px solid rgba(37, 99, 235, .75) !important; outline-offset: 2px !important; }
            [${ATTR}="prompt"] { outline: 2px solid rgba(124, 58, 237, .75) !important; outline-offset: 2px !important; }
            [${ATTR}="answer"] { outline: 2px solid rgba(22, 163, 74, .7) !important; outline-offset: 1px !important; }
            [${ATTR}="answer-correct"] { outline: 3px solid rgba(22, 163, 74, .95) !important; outline-offset: 1px !important; }
            [${ATTR}="answer-incorrect"] { outline: 3px solid rgba(220, 38, 38, .9) !important; outline-offset: 1px !important; }
            [${ATTR}="control"] { outline: 2px dashed rgba(245, 158, 11, .85) !important; outline-offset: 2px !important; }
            [${ATTR}="answer-correct"],
            [${ATTR}="answer-incorrect"],
            [${ATTR}="answer"],
            [${ATTR}="control"],
            [${ATTR}="prompt"] { position: relative !important; }
            [${ATTR}="answer-correct"]::after,
            [${ATTR}="answer-incorrect"]::after,
            [${ATTR}="control"]::after {
                position: absolute;
                right: 4px;
                top: 2px;
                z-index: 2147483000;
                padding: 1px 5px;
                border-radius: 4px;
                color: #fff;
                font: 10px/1.3 system-ui, sans-serif;
                pointer-events: none;
            }
            [${ATTR}="answer-correct"]::after { content: "correct"; background: rgba(22, 101, 52, .92); }
            [${ATTR}="answer-incorrect"]::after { content: "wrong"; background: rgba(153, 27, 27, .92); }
            [${ATTR}="control"]::after { content: "control"; background: rgba(146, 64, 14, .92); }
            .moodush-openedu-debug-label {
                position: absolute;
                z-index: 2147483000;
                padding: 2px 6px;
                border-radius: 4px;
                background: rgba(17, 24, 39, .9);
                color: #fff;
                font: 11px/1.35 system-ui, sans-serif;
                pointer-events: none;
            }
        `;
        doc.documentElement.appendChild(style);
    }

    function clear(doc) {
        const target = doc || document;
        target.querySelectorAll('[' + ATTR + ']').forEach((node) => node.removeAttribute(ATTR));
        target.querySelectorAll('.moodush-openedu-debug-label').forEach((node) => node.remove());
    }

    function getElementByPath(root, path) {
        if (!(root instanceof Element) || !path) {
            return null;
        }
        let current = root;
        const parts = String(path).split('.');
        for (let i = 0; i < parts.length; i += 1) {
            const idx = Number(parts[i]);
            if (!Number.isInteger(idx) || idx < 0 || idx >= current.children.length) {
                return null;
            }
            current = current.children[idx];
        }
        return current instanceof Element ? current : null;
    }

    function escapeSelector(value) {
        if (root.CSS && typeof root.CSS.escape === 'function') {
            return root.CSS.escape(String(value || ''));
        }
        return String(value || '').replace(/"/g, '\\"');
    }

    function labelFor(rootNode, text) {
        const doc = rootNode.ownerDocument || document;
        const label = doc.createElement('div');
        const rect = rootNode.getBoundingClientRect();
        label.className = 'moodush-openedu-debug-label';
        label.textContent = text;
        label.style.left = Math.max(4, rect.left + doc.defaultView.scrollX) + 'px';
        label.style.top = Math.max(4, rect.top + doc.defaultView.scrollY - 18) + 'px';
        doc.body.appendChild(label);
    }

    function questionStateText(question) {
        const options = Array.isArray(question?.options) ? question.options : [];
        const selected = options.filter((option) => option.selected).length;
        const correct = options.filter((option) => option.correct).length;
        const incorrect = options.filter((option) => option.incorrect).length;
        const verified = Boolean(question?.hasVerifiedAnswer || correct > 0 || incorrect > 0);
        const parts = [];
        parts.push(verified ? 'checked' : 'not checked');
        if (question?.correct) {
            parts.push('correct');
        } else if (verified) {
            parts.push('not correct');
        }
        if (selected > 0) {
            parts.push('selected ' + selected);
        }
        if (correct > 0) {
            parts.push('ok ' + correct);
        }
        if (incorrect > 0) {
            parts.push('bad ' + incorrect);
        }
        return parts.join(' · ');
    }

    function promptPreview(question) {
        const raw = String(question?.prompt || '').replace(/\s+/g, ' ').trim();
        if (!raw) {
            return 'prompt: empty';
        }
        return raw.length > 120
            ? ('prompt: ' + raw.slice(0, 117) + '...')
            : ('prompt: ' + raw);
    }

    function render(questions, enabled) {
        const list = Array.isArray(questions) ? questions : [];
        clear(document);
        if (!enabled) {
            return;
        }
        ensureStyle(document);
        list.forEach((question) => {
            const rootNode = question?.root instanceof Element ? question.root : null;
            if (!rootNode) {
                return;
            }
            rootNode.setAttribute(ATTR, 'question');
            rootNode.querySelectorAll('.problem-header, .problem-title, .question-title, legend, h2, h3, h4').forEach((node) => {
                node.setAttribute(ATTR, 'prompt');
            });
            (Array.isArray(question.options) ? question.options : []).forEach((option) => {
                const answerNode = getElementByPath(rootNode, option.inputPath || option.dragAnswerPath || '')
                    || (option.inputId ? rootNode.querySelector('#' + escapeSelector(option.inputId)) : null);
                if (answerNode instanceof Element) {
                    answerNode.setAttribute(ATTR, option.correct ? 'answer-correct' : (option.incorrect ? 'answer-incorrect' : 'answer'));
                }
                const cellNode = getElementByPath(rootNode, option.dragCellPath || '');
                if (cellNode instanceof Element) {
                    cellNode.setAttribute(ATTR, 'answer');
                }
            });
            rootNode.querySelectorAll('label, input[type="radio"], input[type="checkbox"], textarea.answer, select, .dragAnswer').forEach((node) => {
                if (!node.getAttribute(ATTR)) {
                    node.setAttribute(ATTR, 'answer');
                }
            });
            rootNode.querySelectorAll('button, input[type="submit"], input[type="button"]').forEach((node) => {
                const text = String(node.textContent || node.value || node.getAttribute('data-value') || '').toLowerCase();
                if (/провер|check|отправ|submit|save|сохран/.test(text)) {
                    node.setAttribute(ATTR, 'control');
                }
            });
            labelFor(rootNode, `${question.questionType || 'question'} · ${question.parseConfidence ?? '?'} · ${questionStateText(question)} · ${promptPreview(question)}`);
        });
    }

    root.ParamExtOpeneduDebugOverlay = { render, clear };
})(typeof globalThis !== 'undefined' ? globalThis : window);
