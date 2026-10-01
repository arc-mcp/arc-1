'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:http');
const test = require('node:test');
const { CookieJar } = require('tough-cookie');
const requestModule = require.resolve('../node_modules/@sap/approuter/lib/utils/request-utils.js');
const { axiosRequest } = require(requestModule);

test('malformed data URLs cannot stall the AppRouter request wrapper', () => {
  // GHSA-c29m-xwm3-cm6r: keep a vulnerable dependency from hanging the test runner itself.
  execFileSync(process.execPath, ['-e', `
    const assert = require('node:assert/strict');
    const { axiosRequest } = require(${JSON.stringify(requestModule)});
    (async () => {
      const valid = await axiosRequest('get', { url: 'data:text/plain,hello%20world', responseType: 'text' });
      assert.equal(valid.body, 'hello world');
      assert.equal(valid.error, null);
      for (const suffix of ['/'.repeat(200000), '/'.repeat(200000) + ';base64']) {
        const result = await axiosRequest('get', { url: 'data:' + suffix });
        assert.ok(result.error);
      }
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `], { timeout: 5000, stdio: 'pipe' });
});

test('AppRouter retains forms, authentication, cookies, redirects and retries', async (t) => {
  let retryCalls = 0;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (req.url === '/redirect') {
      res.writeHead(302, { Location: '/echo' }).end();
    } else if (req.url === '/retry' && ++retryCalls === 1) {
      res.writeHead(502).end('try again');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': 'session=test; Path=/' });
      res.end(JSON.stringify({ method: req.method, body, headers: req.headers }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const options = { proxy: false, timeout: 2000, jar: new CookieJar() };
  const form = await axiosRequest('post', {
    ...options, url: `${baseUrl}/echo`, form: { code: 'a&b' }, auth: { user: 'test', pass: 'example' },
  });
  assert.equal(form.error, null);
  assert.equal(form.response.statusCode, 200);
  const received = JSON.parse(form.body); // The wrapper must preserve raw response text.
  assert.equal(received.method, 'POST');
  assert.equal(received.body, 'code=a%26b');
  assert.equal(received.headers.authorization, `Basic ${Buffer.from('test:example').toString('base64')}`);
  assert.equal(received.headers['content-type'], 'application/x-www-form-urlencoded');
  const read = await axiosRequest('get', { ...options, url: `${baseUrl}/echo` });
  assert.equal(JSON.parse(read.body).headers.cookie, 'session=test');
  const stopped = await axiosRequest('get', { ...options, url: `${baseUrl}/redirect`, followRedirect: false });
  assert.equal(stopped.error, null);
  assert.equal(stopped.response.statusCode, 302);
  const followed = await axiosRequest('get', { ...options, url: `${baseUrl}/redirect` });
  assert.equal(followed.response.statusCode, 200);
  const retried = await axiosRequest('get', { ...options, url: `${baseUrl}/retry`, enableRetry: true, retries: 1 });
  assert.equal(retried.error, null);
  assert.equal(retried.response.statusCode, 200);
  assert.equal(retryCalls, 2);
});

test('SAP logging still creates timestamped contexts with distinct IDs', () => {
  const app = require('@sap/logging').createAppContext();
  const first = app.createLogContext();
  const second = app.createLogContext();
  assert.ok(Number.isFinite(first._timeCreated.valueOf()));
  assert.ok(Number.isFinite(second._timeCreated.valueOf()));
  assert.equal(typeof first.id, 'string');
  assert.notEqual(first.id, second.id);
});
