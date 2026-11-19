// ════════════════════════════════════════════════════════════════════════
// CROSS-ORIGIN REQUESTS
// ════════════════════════════════════════════════════════════════════════
//
// Drop-in wrapper for GM.xmlHttpRequest / GM_xmlhttpRequest. Same options and
// callbacks (method, url, headers, data, timeout, onload, onerror, ontimeout,
// onabort), with the platform quirks handled once here instead of per module:
//
//   - Torn PDA fires onload once with `undefined` before the real response.
//     That call is dropped, so onload only ever sees a real response object.
//   - With no transport at all, onerror is called (async) instead of throwing.

// Looked up on each call (not once at load), matching how the modules checked
// before, in case a manager/PDA exposes GM late.
function getTransport() {
    if (typeof GM !== 'undefined' && GM && typeof GM.xmlHttpRequest === 'function') return GM.xmlHttpRequest.bind(GM);
    if (typeof GM_xmlhttpRequest === 'function') return GM_xmlhttpRequest;
    return null;
}

/** True if a userscript-manager request function is available. */
function hasGmRequest() {
    return getTransport() !== null;
}

function gmRequest(opts) {
    const transport = getTransport();
    if (!transport) {
        setTimeout(() => opts.onerror && opts.onerror(new Error('No GM request function available')), 0);
        return;
    }
    const onload = opts.onload;
    return transport({
        ...opts,
        onload: (response) => {
            if (!response) return; // PDA: first onload call carries no response
            if (onload) onload(response);
        },
    });
}

export { gmRequest, hasGmRequest };
