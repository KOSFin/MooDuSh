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
            [${ATTR}="answer"] { outline: 2px solid rgba(22, 163, 74, .7) !important; outline-offset: 1px !important; }
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
            rootNode.querySelectorAll('label, input, textarea, select').forEach((node) => {
                node.setAttribute(ATTR, 'answer');
            });
            labelFor(rootNode, `${question.questionType || 'question'} · ${question.parseConfidence ?? '?'} · ${question.questionKey || ''}`);
        });
    }

    root.ParamExtOpeneduDebugOverlay = { render, clear };
})(typeof globalThis !== 'undefined' ? globalThis : window);
