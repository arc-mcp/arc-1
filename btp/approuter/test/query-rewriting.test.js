'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

const urlUtilsPath = require.resolve('../node_modules/@sap/approuter/lib/utils/url-utils.js');
const urlUtils = require(urlUtilsPath);

test('malformed query encoding cannot stall pre-auth AppRouter rewriting', () => {
  // AppRouter 23.2+ removes query-string/decode-uri-component entirely. Keep
  // testing the real pre-auth helper, with a subprocess deadline if it regresses.
  execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { removeQueryParamFromUrl: strip } = require(${JSON.stringify(urlUtilsPath)});
    for (const value of ['%C0'.repeat(1600), '%E0%A4%A'.repeat(600)]) {
      assert.equal(strip('/ui/x?sap_idp=1&a=' + value, 'sap_idp'), '/ui/x?a=' + value);
    }
  `], { timeout: 5000, stdio: 'pipe' });
});

test('AppRouter removes its IDP selector and preserves unrelated query bytes', () => {
  const strip = (url) => urlUtils.removeQueryParamFromUrl(url, 'sap_idp');
  for (const [input, expected] of [
    ['/ui/app?a=1&sap_idp=idp&b=2', '/ui/app?a=1&b=2'],
    ['/ui/x?sap_idp=1&e=%C3%A5', '/ui/x?e=%C3%A5'],
    ['/ui/x?q=hello+world&sap_idp=x', '/ui/x?q=hello+world'],
    ['/ui/x?a=2&a=1&sap_idp=x', '/ui/x?a=2&a=1'],
    ['/ui/x?sap_idp=a&z=1&sap_idp=b#frag', '/ui/x?z=1#frag'],
    ['/ui/x?sap_idp=x#frag?keep=1', '/ui/x#frag?keep=1'],
    ['/ui/x?sap_idp=x', '/ui/x'],
    ['/ui/x?noidp=1', '/ui/x?noidp=1'],
    ['/ui/x#frag?sap_idp=x', '/ui/x#frag?sap_idp=x'],
  ]) {
    assert.equal(strip(input), expected);
  }
});
