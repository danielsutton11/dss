import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { gmRequest, hasGmRequest } from '../src/core/request.js';

beforeEach(() => { delete globalThis.GM; delete globalThis.GM_xmlhttpRequest; });

test('drops the empty onload Torn PDA fires before the real response', () => {
    globalThis.GM = { xmlHttpRequest: (o) => { o.onload(undefined); o.onload({ status: 200, responseText: 'ok' }); } };
    const seen = [];
    gmRequest({ url: 'x', onload: (r) => seen.push(r) });
    assert.deepEqual(seen, [{ status: 200, responseText: 'ok' }]);
});

test('passes options through unchanged', () => {
    let got;
    globalThis.GM = { xmlHttpRequest: (o) => { got = o; } };
    const onerror = () => {};
    gmRequest({ method: 'POST', url: 'u', headers: { a: '1' }, data: 'd', timeout: 5, onerror });
    assert.equal(got.method, 'POST');
    assert.equal(got.url, 'u');
    assert.deepEqual(got.headers, { a: '1' });
    assert.equal(got.data, 'd');
    assert.equal(got.timeout, 5);
    assert.equal(got.onerror, onerror);
});

test('falls back to GM_xmlhttpRequest', () => {
    let called = false;
    globalThis.GM_xmlhttpRequest = () => { called = true; };
    assert.equal(hasGmRequest(), true);
    gmRequest({ url: 'x' });
    assert.equal(called, true);
});

test('calls onerror instead of throwing when no transport exists', async () => {
    assert.equal(hasGmRequest(), false);
    const err = await new Promise((resolve) => gmRequest({ url: 'x', onerror: resolve }));
    assert.match(err.message, /No GM request/);
});
