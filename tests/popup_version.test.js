const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const flush = () => new Promise(resolve => setImmediate(resolve));

test('popup keeps the installed version when the backend advertises a different project version', async () => {
    const dom = new JSDOM(fs.readFileSync(require.resolve('../html/popup/popup_new.html'), 'utf8'), {
        url: 'https://extension.test/popup.html', runScripts: 'outside-only'
    });
    const w = dom.window;
    const manifest = JSON.parse(fs.readFileSync(require.resolve('../manifest.json'), 'utf8'));
    const requests = [];
    w.chrome = { runtime: { getManifest: () => manifest } };
    w.eval(fs.readFileSync(require.resolve('../js/platform_settings.js'), 'utf8'));
    w.ParamExtSettings.getSettings = async () => w.ParamExtSettings.normalizeSettings({});
    w.fetch = async url => {
        requests.push(url);
        return { ok: true, async json() { return { projectVersion: '99.0.0', latestVersion: '99.0.0' }; } };
    };
    try {
        w.eval(fs.readFileSync(require.resolve('../js/popup_new.js'), 'utf8'));
        await flush(); await flush();
        assert.equal(w.document.getElementById('versionPill').textContent, 'v' + manifest.version);
        assert.ok(!requests.some(url => url.endsWith('/v2/version')));
    } finally { dom.window.close(); }
});
