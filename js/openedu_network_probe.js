(function () {
    const EVENT_TYPE = 'PARAMEXT_OPENEDU_COURSE_PAYLOAD';
    const TARGET_RE = /\/api\/(?:courses\/v2\/blocks\/|courseware\/course\/|courseware\/sequence\/)/;

    function shouldCapture(url) {
        return TARGET_RE.test(String(url || ''));
    }

    function postPayload(url, payload) {
        if (!payload || typeof payload !== 'object') {
            return;
        }
        window.postMessage({
            type: EVENT_TYPE,
            url: String(url || ''),
            payload
        }, '*');
    }

    function responseUrl(response, fallback) {
        return String(response?.url || fallback || '');
    }

    if (typeof window.fetch === 'function' && !window.__PARAMEXT_OPENEDU_FETCH_PROBED) {
        window.__PARAMEXT_OPENEDU_FETCH_PROBED = true;
        const nativeFetch = window.fetch.bind(window);
        window.fetch = function paramExtOpeneduFetch(input, init) {
            const requestUrl = typeof input === 'string' ? input : String(input?.url || '');
            return nativeFetch(input, init).then((response) => {
                const finalUrl = responseUrl(response, requestUrl);
                if (shouldCapture(finalUrl)) {
                    try {
                        response.clone().json().then((payload) => postPayload(finalUrl, payload)).catch(() => {});
                    } catch (_) {}
                }
                return response;
            });
        };
    }

    if (typeof window.XMLHttpRequest === 'function' && !window.__PARAMEXT_OPENEDU_XHR_PROBED) {
        window.__PARAMEXT_OPENEDU_XHR_PROBED = true;
        const NativeXHR = window.XMLHttpRequest;
        const nativeOpen = NativeXHR.prototype.open;
        const nativeSend = NativeXHR.prototype.send;

        NativeXHR.prototype.open = function paramExtOpeneduXhrOpen(method, url) {
            this.__PARAMEXT_OPENEDU_URL = String(url || '');
            return nativeOpen.apply(this, arguments);
        };

        NativeXHR.prototype.send = function paramExtOpeneduXhrSend() {
            this.addEventListener('load', function () {
                const finalUrl = String(this.responseURL || this.__PARAMEXT_OPENEDU_URL || '');
                if (!shouldCapture(finalUrl)) {
                    return;
                }
                try {
                    const payload = JSON.parse(String(this.responseText || ''));
                    postPayload(finalUrl, payload);
                } catch (_) {}
            });
            return nativeSend.apply(this, arguments);
        };
    }
})();
