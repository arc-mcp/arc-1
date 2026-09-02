'use strict';

// Regression guard for GHSA decode-uri-component DoS (moderate, CVSS 6.6).
//
// @sap/approuter's url-utils calls query-string on every request from
// pathRewritingMiddleware, which is mounted BEFORE loginMiddleware — so an
// unauthenticated request reaches the decoder. decode-uri-component <= 0.4.2
// decodes malformed percent-encoding super-linearly: a 4.8 KB URL measured
// ~30 s of blocked event loop against 0.2.2 (the app runs `instances: 1`).
//
// The patched 0.5.0 is ESM-only while query-string@7 is CommonJS, so it is
// bridged by ../vendor/decode-uri-component-cjs. These tests fail if either
// the bridge breaks or the vulnerable decoder returns.

const test = require('node:test');
const assert = require('node:assert');

const urlUtils = require('../node_modules/@sap/approuter/lib/utils/url-utils.js');
const decodeUriComponent = require('decode-uri-component');

test('patched decoder is reachable as a CommonJS function', () => {
  // require() of the ESM 0.5.0 yields { __esModule, default }; the bridge unwraps it.
  assert.strictEqual(typeof decodeUriComponent, 'function');
  assert.strictEqual(decodeUriComponent('%C3%A5'), 'å');
  assert.strictEqual(decodeUriComponent('%E0%A4%A'), '%E0%A4%A'); // malformed stays literal
});

test('malformed percent-encoding decodes in linear time', () => {
  // 0.2.2 needed ~30_000 ms for this input; 0.5.0 needs well under 1 ms.
  const url = '/ui/x?sap_idp=1&a=' + '%C0'.repeat(1600);
  const started = process.hrtime.bigint();
  urlUtils.removeQueryParamFromUrl(url, 'sap_idp');
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 2000, `decode took ${elapsedMs.toFixed(1)}ms, expected < 2000ms`);
});

test('approuter query-param rewriting is unchanged', () => {
  const strip = (url) => urlUtils.removeQueryParamFromUrl(url, 'sap_idp');
  assert.strictEqual(strip('/ui/app?a=1&sap_idp=idp&b=2'), '/ui/app?a=1&b=2');
  assert.strictEqual(strip('/ui/x?sap_idp=1&e=%C3%A5'), '/ui/x?e=%C3%A5');
  assert.strictEqual(strip('/ui/x?q=hello+world&sap_idp=x'), '/ui/x?q=hello%20world');
  assert.strictEqual(strip('/ui/x?noidp=1'), '/ui/x?noidp=1');
});
