const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const code = fs.readFileSync(require.resolve('../js/openedu_capture_frames.js'), 'utf8');
const flush = () => new Promise(resolve => setImmediate(resolve));

// Foreign WindowProxy objects expose postMessage only. Any accidental attempt
// to read a parent document, viewport, frameElement or scroll position throws.
function frames() {
    const nodes = [], messages = [], forbidden = [];
    function node(origin, parent, width, height, frameTop = 500, scale = 1) {
        const item = { origin, parent, listeners: [], children: [], proxies: new Map(), timers: new Map() };
        let timerId = 0;
        function view(target) {
            if (target === item) return item.window;
            if (!item.proxies.has(target)) item.proxies.set(target, new Proxy({}, {
                get(unused, key) {
                    if (key === 'postMessage') return (data, targetOrigin) => {
                        if (targetOrigin !== '*' && targetOrigin !== target.origin) return;
                        const copy = structuredClone(data);
                        messages.push({ from: item, to: target, data: copy });
                        queueMicrotask(() => target.listeners.forEach(listener => listener({ data: copy, origin: item.origin, source: target.view(item) })));
                    };
                    forbidden.push(key);
                    throw new Error('SecurityError: cross-origin access to ' + String(key));
                }
            }));
            return item.proxies.get(target);
        }
        const window = {
            innerWidth: width, innerHeight: height, scrollX: 0, scrollY: 0,
            addEventListener(type, listener) { if (type === 'message') item.listeners.push(listener); },
            scrollBy({ left, top }) { this.scrollX = Math.max(0, this.scrollX + left); this.scrollY = Math.max(0, this.scrollY + top); },
            scrollTo({ left, top }) { this.scrollX = left; this.scrollY = top; }
        };
        item.window = window; item.view = view;
        window.parent = parent ? view(parent) : window;
        window.top = parent ? view(nodes[0]) : window;
        const document = { scrollingElement: null, querySelectorAll() { return item.children.map(child => child.frame); } };
        item.document = document;
        if (parent) {
            item.frame = {
                clientLeft: 10, clientTop: 10, clientWidth: width, clientHeight: height,
                offsetWidth: width + 20, offsetHeight: height + 20, parentElement: null,
                contentWindow: parent.view(item),
                getBoundingClientRect() { return { left: 100 - parent.window.scrollX, top: frameTop - parent.window.scrollY, width: (width + 20) * scale, height: (height + 20) * scale }; },
                scrollIntoView() { parent.window.scrollY = frameTop; }
            };
            parent.children.push(item);
        }
        const context = {
            window, document, URL, crypto: require('node:crypto').webcrypto,
            getComputedStyle: () => ({ overflow: 'visible', overflowX: 'visible', overflowY: 'visible' }),
            setTimeout(callback, delay) { const id = ++timerId; item.timers.set(id, { callback, delay }); return id; },
            clearTimeout(id) { item.timers.delete(id); }
        };
        vm.runInNewContext(code, context);
        item.api = window.ParamExtOpeneduCaptureFrames;
        nodes.push(item);
        return item;
    }
    const top = node('https://apps.openedu.ru', null, 1200, 800);
    const middle = node('https://courses.openedu.ru', top, 1000, 1500);
    const inner = node('https://lms.openedu.ru', middle, 900, 3000, 700);
    return { top, middle, inner, node, messages, forbidden };
}

test('cross-origin nested frames coordinate viewport, scrolling, cropping and restoration without foreign DOM access', async () => {
    const f = frames();
    const viewport = await f.inner.api.request('capture-1', 'prepare');
    assert.equal(viewport.width, 900);
    assert.equal(viewport.height, 800, 'a tall iframe must use the outer browser viewport for tiling');
    await f.inner.api.request('capture-1', 'scroll', { x: 30, y: 1200 });
    const mapped = await f.inner.api.request('capture-1', 'map', { left: 10, top: 1180, right: 300, bottom: 1480 });
    assert.equal(mapped.width, 1200);
    assert.equal(mapped.height, 800);
    assert.deepEqual(JSON.parse(JSON.stringify(mapped.localRect)), { left: 10, top: 1180, right: 300, bottom: 1480 });
    assert.equal(mapped.rect.top, 10);
    assert.equal(mapped.rect.bottom, 310);
    assert.ok(mapped.rect.left >= 0 && mapped.rect.right <= 1200);
    assert.ok(f.top.window.scrollY > 0);
    assert.ok(f.middle.window.scrollY > 0);
    await f.inner.api.request('capture-1', 'restore');
    assert.equal(f.top.window.scrollY, 0);
    assert.equal(f.middle.window.scrollY, 0);
    assert.equal(f.top.timers.size, 0);
    assert.equal(f.middle.timers.size, 0);
    assert.equal(f.inner.timers.size, 0);
    assert.deepEqual(f.forbidden, []);
});

test('frame borders and CSS scaling are included in crop coordinates', async () => {
    const f = frames();
    const scaled = f.node('https://exam.openedu.ru', f.top, 800, 1000, 200, 0.5);
    await scaled.api.request('scaled', 'prepare');
    const mapped = await scaled.api.request('scaled', 'map', { left: 20, top: 40, right: 220, bottom: 240 });
    assert.equal(mapped.rect.left, 115);
    assert.equal(mapped.rect.top, 25);
    assert.equal(mapped.rect.right - mapped.rect.left, 100);
    assert.equal(mapped.rect.bottom - mapped.rect.top, 100);
    await scaled.api.request('scaled', 'restore');
});

test('frame clipping excludes content outside the iframe and browser viewport', async () => {
    const f = frames();
    await f.middle.api.request('clipped', 'prepare');
    const mapped = await f.middle.api.request('clipped', 'map', { left: -100, top: -100, right: 5000, bottom: 5000 });
    assert.equal(mapped.rect.left, 110);
    assert.equal(mapped.rect.top, 10);
    assert.equal(mapped.rect.right, 1110);
    assert.equal(mapped.rect.bottom, 800);
    await f.middle.api.request('clipped', 'restore');
});

test('another child frame cannot use or restore an existing screenshot session', async () => {
    const f = frames();
    const sibling = f.node('https://exam.openedu.ru', f.top, 600, 900);
    await f.middle.api.request('owned', 'prepare');
    for (const action of ['prepare', 'restore', 'map']) {
        await assert.rejects(sibling.api.request('owned', action, { left: 0, top: 0, right: 50, bottom: 50 }), /another frame/);
    }
    assert.ok(f.top.window.scrollY > 0);
    await f.middle.api.request('owned', 'restore');
    assert.equal(f.top.window.scrollY, 0);
});

test('missing parent adapter times out with an actionable error', async () => {
    const f = frames();
    f.top.listeners.length = 0;
    const result = assert.rejects(f.middle.api.request('missing', 'prepare'), /parent course frame timed out/);
    const timer = [...f.middle.timers.values()].find(timer => timer.delay === 10000);
    timer.callback();
    await result;
});

test('non-OpenEdu children and unrelated windows cannot create screenshot sessions', async () => {
    const f = frames();
    const outsider = f.node('https://example.com', f.top, 600, 900);
    // Supply a rejection handler immediately; the bridge must ignore this
    // request rather than moving the parent viewport.
    const result = assert.rejects(outsider.api.request('outsider', 'prepare'), /timed out/);
    await flush();
    assert.equal(f.top.window.scrollY, 0);
    assert.equal(f.messages.filter(message => message.from === f.top).length, 0);
    [...outsider.timers.values()].find(timer => timer.delay === 10000).callback();
    await result;
});

test('abandoned frame sessions restore scrolling automatically', async () => {
    const f = frames();
    await f.inner.api.request('abandoned', 'prepare');
    const timer = [...f.middle.timers.values()].find(timer => timer.delay === 120000);
    timer.callback();
    await flush();
    assert.equal(f.middle.window.scrollY, 0);
    assert.equal(f.top.window.scrollY, 0);
});

test('manifest loads the frame adapter before OpenEdu workflow code in every frame', () => {
    const manifest = JSON.parse(fs.readFileSync(require.resolve('../manifest.json'), 'utf8'));
    const script = manifest.content_scripts.find(script => script.js?.includes('js/openedu_content.js'));
    assert.equal(script.all_frames, true);
    assert.ok(script.js.indexOf('js/openedu_capture_frames.js') < script.js.indexOf('js/openedu_content.js'));
});
