/* Each frame measures its own DOM; no access to another frame's document is needed. */
(function () {
    const REQUEST = 'PARAMEXT_AI_CAPTURE_FRAME_REQUEST';
    const REPLY = 'PARAMEXT_AI_CAPTURE_FRAME_REPLY';
    const pending = new Map();
    const sessions = new Map();
    const trusted = origin => {
        try { const url = new URL(origin); return /^https?:$/.test(url.protocol) && /(^|\.)openedu\.ru$/.test(url.hostname); }
        catch (_) { return false; }
    };
    const point = value => value && Number.isFinite(value.x) && Number.isFinite(value.y);
    const rectangle = value => value && ['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(value[key]));
    const clip = (rect, bounds) => ({ left: Math.max(rect.left, bounds.left), top: Math.max(rect.top, bounds.top), right: Math.min(rect.right, bounds.right), bottom: Math.min(rect.bottom, bounds.bottom) });
    function scrollers(frame) {
        const result = [];
        for (let node = frame.parentElement; node && node !== document.scrollingElement; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (/(auto|scroll|hidden)/.test(style.overflow + style.overflowX + style.overflowY)
                && (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth)) result.push(node);
        }
        return result;
    }
    function geometry(frame) {
        const rect = frame.getBoundingClientRect();
        const scaleX = frame.offsetWidth ? rect.width / frame.offsetWidth : 1;
        const scaleY = frame.offsetHeight ? rect.height / frame.offsetHeight : 1;
        if (!(scaleX > 0 && scaleY > 0)) throw new Error('Question frame is hidden');
        return { x: rect.left + frame.clientLeft * scaleX, y: rect.top + frame.clientTop * scaleY, scaleX, scaleY };
    }
    function request(session, action, payload) {
        if (window === window.top) {
            if (action === 'map') return Promise.resolve({ rect: payload, localRect: payload, width: window.innerWidth, height: window.innerHeight });
            return Promise.resolve({ width: window.innerWidth, height: window.innerHeight });
        }
        return new Promise((resolve, reject) => {
            const id = crypto.randomUUID();
            const timer = setTimeout(() => {
                pending.delete(id);
                reject(new Error('Screenshot coordination with the parent course frame timed out. Reload the course tabs.'));
            }, 10000);
            pending.set(id, { session, resolve, reject, timer });
            window.parent.postMessage({ type: REQUEST, id, session, action, payload }, '*');
        });
    }
    function restore(session) {
        const state = sessions.get(session);
        if (!state) return;
        clearTimeout(state.timer);
        sessions.delete(session);
        for (const [target, position] of state.positions) target.scrollTo({ left: position.x, top: position.y, behavior: 'instant' });
    }
    async function handle(message, source, frame) {
        const { session, action, payload } = message;
        if (!['prepare', 'scroll', 'map', 'restore'].includes(action)
            || (action === 'scroll' && !point(payload)) || (action === 'map' && !rectangle(payload))) throw new Error('Invalid frame screenshot request');
        let state = sessions.get(session);
        if (state && state.source !== source) throw new Error('Screenshot session belongs to another frame');
        if (action === 'restore') {
            try { return await request(session, action); } finally { restore(session); }
        }
        if (!state) {
            if (action !== 'prepare' || sessions.size >= 8) throw new Error('Screenshot frame session is unavailable');
            state = { source, positions: new Map() };
            sessions.set(session, state);
        }
        clearTimeout(state.timer);
        state.timer = setTimeout(() => { restore(session); request(session, 'restore').catch(() => {}); }, 120000);
        const parents = scrollers(frame);
        for (const target of [window, ...parents]) {
            if (!state.positions.has(target)) state.positions.set(target, { x: target.scrollX ?? target.scrollLeft, y: target.scrollY ?? target.scrollTop });
        }
        if (action === 'prepare') {
            frame.scrollIntoView({ block: 'start', inline: 'start', behavior: 'instant' });
            const outer = await request(session, action);
            const { scaleX, scaleY } = geometry(frame);
            return {
                width: Math.min(frame.clientWidth, window.innerWidth / scaleX, outer.width / scaleX, ...parents.map(node => node.clientWidth / scaleX)),
                height: Math.min(frame.clientHeight, window.innerHeight / scaleY, outer.height / scaleY, ...parents.map(node => node.clientHeight / scaleY))
            };
        }
        if (action === 'scroll') {
            for (const target of [...parents, window]) {
                const origin = geometry(frame);
                const bounds = target === window ? { left: 0, top: 0 } : target.getBoundingClientRect();
                target.scrollBy({ left: origin.x + payload.x * origin.scaleX - bounds.left - 20, top: origin.y + payload.y * origin.scaleY - bounds.top - 30, behavior: 'instant' });
            }
            const origin = geometry(frame);
            return request(session, action, { x: origin.x + payload.x * origin.scaleX, y: origin.y + payload.y * origin.scaleY });
        }
        const origin = geometry(frame);
        const local = clip(payload, { left: 0, top: 0, right: frame.clientWidth, bottom: frame.clientHeight });
        let mapped = { left: origin.x + local.left * origin.scaleX, top: origin.y + local.top * origin.scaleY, right: origin.x + local.right * origin.scaleX, bottom: origin.y + local.bottom * origin.scaleY };
        for (const parent of parents) {
            const rect = parent.getBoundingClientRect();
            mapped = clip(mapped, { left: rect.left + parent.clientLeft, top: rect.top + parent.clientTop, right: rect.left + parent.clientLeft + parent.clientWidth, bottom: rect.top + parent.clientTop + parent.clientHeight });
        }
        mapped = clip(mapped, { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight });
        const result = await request(session, action, mapped);
        // Carry the visible crop back into the requesting frame's coordinates.
        const visible = result.localRect;
        return { ...result, localRect: {
            left: (visible.left - origin.x) / origin.scaleX,
            top: (visible.top - origin.y) / origin.scaleY,
            right: (visible.right - origin.x) / origin.scaleX,
            bottom: (visible.bottom - origin.y) / origin.scaleY
        } };

    }
    window.addEventListener('message', event => {
        const message = event.data;
        if (!message || !trusted(event.origin)) return;
        if (message.type === REPLY && event.source === window.parent) {
            const waiter = pending.get(message.id);
            if (!waiter || waiter.session !== message.session) return;
            pending.delete(message.id); clearTimeout(waiter.timer);
            if (message.error) waiter.reject(new Error(message.error)); else waiter.resolve(message.result);
        } else if (message.type === REQUEST && typeof message.id === 'string'
            && typeof message.session === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(message.session)) {
            const frame = [...document.querySelectorAll('iframe, frame')].find(node => node.contentWindow === event.source);
            if (!frame) return;
            handle(message, event.source, frame).then(result => {
                event.source.postMessage({ type: REPLY, id: message.id, session: message.session, result }, event.origin);
            }).catch(error => {
                event.source.postMessage({ type: REPLY, id: message.id, session: message.session, error: error.message }, event.origin);
            });
        }
    });
    window.ParamExtOpeneduCaptureFrames = { request };
})();
