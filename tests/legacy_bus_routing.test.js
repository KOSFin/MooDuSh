const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

function legacyListener(handler) {
    // Exercise the actual bundled registration: returning any Promise here claims
    // the Chrome response channel, even if that Promise resolves to undefined.
    const source = fs.readFileSync(require.resolve('../js/commons.js'), 'utf8');
    const callback = source.match(/runtime\.onMessage\.addListener\((.*?)\)\}async messageHandler/s)?.[1];
    assert.ok(callback, 'legacy bus registration found');
    return Function('return ' + callback).call({ messageHandler: handler });
}

test('legacy bus leaves AI/HTTP/ChatGPT response channels unclaimed', () => {
    let calls = 0;
    const listener = legacyListener(async () => { calls++; return { error_type: true, error_message: 'isParcel ==> false' }; });
    for (const type of ['PARAMEXT_AI_CAPTURE', 'PARAMEXT_AI_REQUEST', 'PARAMEXT_CHATGPT_RUN', 'PARAMEXT_AI_RESULT', 'PARAMEXT_HTTP']) {
        assert.equal(listener({ type }, {}), undefined, type + ' must reach its own handler');
    }
    assert.equal(calls, 0);
});

test('legacy topic messages still reach the existing bus', async () => {
    const parcel = { topic: 'GetSettings' };
    const sender = { id: 'extension' };
    const listener = legacyListener(async (message, origin) => ({ message, origin }));
    const result = await listener(parcel, sender);
    assert.equal(result.message, parcel);
    assert.equal(result.origin, sender);
});
