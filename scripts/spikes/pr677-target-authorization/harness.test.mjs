import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { comparableDenial, guardedMcpChecks, validateScenario } from './mcp-checks.mjs';
import { clientCredentialsToken } from './oauth-requests.mjs';
import {
  assertSafeDiagnosticEnvironment,
  boundedFetch,
  classifySapVerificationFailure,
  HarnessError,
  label,
  outsideRepository,
  REPO_ROOT,
  safeFailure,
  validateBaseUrl,
} from './safe-io.mjs';

test('safe failures never emit arbitrary error messages or tokens', () => {
  assert.deepEqual(safeFailure(new Error('secret-token-user-data')), { code: 'UNEXPECTED_FAILURE' });
  assert.deepEqual(safeFailure(new HarnessError('HTTP_REQUEST_FAILED', 401)), {
    code: 'HTTP_REQUEST_FAILED',
    httpStatus: 401,
  });
});

test('runtime diagnostic channels that could disclose credentials are rejected before input is loaded', () => {
  assert.doesNotThrow(() => assertSafeDiagnosticEnvironment({ NODE_OPTIONS: '--max-old-space-size=1024' }, []));
  for (const env of [{ NODE_DEBUG: 'http' }, { SSLKEYLOGFILE: '/unprinted/file' }, { NODE_OPTIONS: '--inspect=9229' }])
    assert.throws(() => assertSafeDiagnosticEnvironment(env, []), { code: 'UNSAFE_RUNTIME_DIAGNOSTICS' });
  assert.throws(() => assertSafeDiagnosticEnvironment({}, ['--trace-tls']), { code: 'UNSAFE_RUNTIME_DIAGNOSTICS' });
});

test('origin/label validation rejects unsafe values', () => {
  for (const url of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/path'])
    assert.throws(() => validateBaseUrl(url));
  assert.equal(validateBaseUrl('https://example.com').origin, 'https://example.com');
  assert.throws(() => label('email@example.com'));
  assert.equal(label('viewer-100'), 'viewer-100');
});

test('example scenarios validate and malformed target routes are rejected', async () => {
  const examples = JSON.parse(await readFile(new URL('./scenarios.example.json', import.meta.url), 'utf8'));
  for (const scenario of Object.values(examples)) validateScenario(scenario);
  for (const value of ['https://evil.example', '../001', 'A4H/001?x=1', 'A4H/001/mcp', 'A4H/001#fragment']) {
    assert.throws(() => validateScenario({ expect: { schemaTargets: [], allowedTargets: [value] } }));
  }
  for (const scenario of [
    { expect: [] },
    { expectedIdentity: {} },
    { expect: { grantCount: '50' } },
    { expect: { catalogGranted: { 'A4H/001': 'false' } } },
    { expect: { grantStatus: 'anything' } },
    { expect: { schemaTargets: ['A4H/001', 'A4H/001'] } },
  ]) {
    assert.throws(() => validateScenario(scenario));
  }
  assert.throws(() => validateScenario({ expect: { allowedTargets: ['A4H/100'] } }), {
    code: 'COMPLETE_SCHEMA_TARGET_EXPECTATION_REQUIRED',
  });
});

test('private input boundary cannot be fooled by a repository directory starting with two dots', () => {
  assert.equal(outsideRepository(REPO_ROOT), false);
  assert.equal(outsideRepository(resolve(REPO_ROOT, '..secret/input.json')), false);
  assert.equal(outsideRepository(resolve(REPO_ROOT, 'scripts/input.json')), false);
  assert.equal(outsideRepository(resolve(REPO_ROOT, '../private/input.json')), true);
});

test('MCP assertions consume actual responses but never expose token or SAP bodies', async () => {
  const originalFetch = globalThis.fetch;
  const records = [];
  let outbound = 0;
  const headers = { 'cache-control': 'private, no-store, no-transform' };
  globalThis.fetch = async (url, init) => {
    outbound++;
    if (!init.headers.Authorization) return Response.json({ error: 'invalid_token' }, { status: 401, headers });
    assert.equal(init.headers.Authorization, 'Bearer process-memory-secret');
    const request = JSON.parse(init.body);
    let result;
    const target = request.params.arguments?.target;
    if (['/ZZZ/999/mcp', '/A4H/001/mcp'].includes(new URL(url).pathname))
      return Response.json({ error: 'TARGET_NOT_AVAILABLE' }, { status: 404, headers });
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202, headers });
    if (request.method === 'initialize')
      result = { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'test', version: '0' } };
    else if (request.method === 'tools/list')
      result = {
        tools: [
          {
            name: 'SAPRead',
            inputSchema: {
              type: 'object',
              properties: { target: { type: 'string', enum: ['A4H/100'] } },
              required: ['target'],
            },
          },
        ],
      };
    else if (request.params.name === 'SAPTargets')
      result = { isError: true, content: [{ type: 'text', text: 'UNKNOWN_TOOL' }] };
    else if (['ZZZ/999', 'A4H/001'].includes(target))
      result = {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'TARGET_NOT_AVAILABLE',
              message: 'Target not available',
              retryable: false,
              requestId: `req-${outbound}`,
            }),
          },
        ],
      };
    else result = { content: [{ type: 'text', text: JSON.stringify({ user: 'DO_NOT_LEAK_SAP_USER_OR_BODY' }) }] };
    return Response.json({ jsonrpc: '2.0', id: request.id, result }, { headers });
  };
  try {
    await guardedMcpChecks({
      baseUrl: new URL('https://example.invalid'),
      accessToken: 'process-memory-secret',
      scenario: {
        expect: {
          schemaTargets: ['A4H/100'],
          catalogVisible: false,
          allowedTargets: ['A4H/100'],
          deniedTargets: ['A4H/001', 'ZZZ/999'],
        },
      },
      record: (name, pass, details) => records.push({ name, pass, details }),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(outbound > 5);
  assert.ok(
    records.every((entry) => entry.pass),
    JSON.stringify(records),
  );
  const report = JSON.stringify(records);
  assert.ok(!report.includes('process-memory-secret'));
  assert.ok(!report.includes('DO_NOT_LEAK_SAP_USER_OR_BODY'));
  assert.ok(records.some((entry) => entry.name === 'aggregate.target_schema.tool_0.exact_enum' && entry.pass));
  assert.ok(records.some((entry) => entry.name === 'alias.target_schema.tool_0.exact_enum' && entry.pass));
});

test('denial comparison removes correlation only, retaining target and other disclosure differences', () => {
  const base = { error: 'TARGET_NOT_AVAILABLE', message: 'Target not available', retryable: false };
  assert.equal(
    comparableDenial({ ...base, requestId: 'first' }).comparable,
    comparableDenial({ ...base, requestId: 'second' }).comparable,
  );
  assert.notEqual(
    comparableDenial({ ...base, target: 'A4H/001' }).comparable,
    comparableDenial({ ...base, target: 'ZZZ/999' }).comparable,
  );
  assert.equal(comparableDenial({ ...base, requestId: 'secret/path' }).correlationValid, false);
});

test('matching SSE reply ends a request without waiting for server stream closure', async () => {
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  const encoder = new TextEncoder();
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n'));
          controller.enqueue(encoder.encode('data: {"jsonrpc":"2.0","id":999,"result":{}}\n\n'));
          controller.enqueue(encoder.encode('data: {"jsonrpc":"2.0","id":1,"result":{"ok":true}}\n'));
          controller.enqueue(encoder.encode('\n'));
          // Deliberately never close: completion must be driven by matching response ID.
        },
        cancel() {
          cancelled = true;
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  try {
    const result = await boundedFetch('https://example.invalid', {}, { rpcResponseId: 1 });
    assert.equal(result.json.id, 1);
    assert.equal(result.json.result.ok, true);
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('machine token request is real client_credentials shape, credentials stay out of returned metadata', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const credentials = {
    url: 'https://issuer.example.invalid',
    xsappname: 'isolated!t123',
    clientid: 'test-client',
    clientsecret: 'DO_NOT_REPORT_SECRET',
  };
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(new URL(url).href, 'https://issuer.example.invalid/oauth/token');
    assert.equal(init.redirect, 'error');
    assert.equal(
      init.headers.Authorization,
      `Basic ${Buffer.from('test-client:DO_NOT_REPORT_SECRET').toString('base64')}`,
    );
    assert.equal(init.body.get('grant_type'), 'client_credentials');
    assert.equal(init.body.get('scope'), calls === 1 ? null : 'isolated!t123.read isolated!t123.admin');
    return Response.json({
      access_token: 'MEMORY_ONLY_TOKEN',
      token_type: 'bearer',
      ignored_provider_extension: 'DO_NOT_REPORT_EXTENSION',
    });
  };
  try {
    assert.deepEqual(await clientCredentialsToken(credentials), { access_token: 'MEMORY_ONLY_TOKEN' });
    await clientCredentialsToken(credentials, ['read', 'admin']);
    await assert.rejects(clientCredentialsToken(credentials, ['arbitrary.scope']), { code: 'INVALID_MACHINE_SCOPES' });
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('verification outages and forged error names never count as proven JWT rejections', () => {
  class WrongAudienceError extends Error {}
  class NetworkError extends Error {}
  const errors = { WrongAudienceError, NetworkError };
  assert.equal(classifySapVerificationFailure(new WrongAudienceError('unprinted'), errors), 'wrong_audience');
  assert.equal(classifySapVerificationFailure(new NetworkError('unprinted'), errors), undefined);
  assert.equal(classifySapVerificationFailure({ name: 'WrongAudienceError' }, errors), undefined);
});

test('missing private cache headers fail on rejection responses instead of being inferred', async () => {
  const originalFetch = globalThis.fetch;
  const records = [];
  globalThis.fetch = async (_url, init) =>
    Response.json(
      { error: init.headers.Authorization ? 'forbidden' : 'invalid_token' },
      { status: init.headers.Authorization ? 403 : 401 },
    );
  try {
    await guardedMcpChecks({
      baseUrl: new URL('https://example.invalid'),
      accessToken: 'memory-token',
      scenario: { expect: { aggregateHttpStatus: 403, aggregateErrorCode: 'forbidden' } },
      record: (name, pass) => records.push({ name, pass }),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(records.some((value) => value.name.endsWith('private_no_store') && !value.pass));
  assert.ok(records.some((value) => value.name === 'aggregate.initialize.http' && value.pass));
});

test('authentication denial reasons are checked on aggregate, compatibility and pinned routes', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const expectedCode of ['forbidden', 'insufficient_scope']) {
      for (const actualCode of [expectedCode, 'unexpected_denial']) {
        const records = [];
        globalThis.fetch = async (_url, init) =>
          Response.json(
            { error: init.headers.Authorization ? actualCode : 'invalid_token' },
            {
              status: init.headers.Authorization ? 403 : 401,
              headers: {
                'cache-control': 'private, no-store',
                'www-authenticate': `Bearer error="${actualCode}", scope="read"`,
              },
            },
          );
        await guardedMcpChecks({
          baseUrl: new URL('https://example.invalid'),
          accessToken: 'memory-only-token',
          scenario: {
            expect: {
              aggregateHttpStatus: 403,
              aggregateErrorCode: expectedCode,
              deniedTargets: ['A4H/100', 'ZZZ/999'],
            },
          },
          record: (name, pass) => records.push({ name, pass }),
        });
        for (const prefix of ['aggregate.initialize', 'alias.initialize', 'pinned.authentication_0', 'pinned.authentication_1']) {
          assert.ok(
            records.some((value) => value.name === `${prefix}.error_code` && value.pass === (actualCode === expectedCode)),
            JSON.stringify(records),
          );
        }
        if (actualCode === expectedCode) assert.ok(records.every((value) => value.pass));
        if (expectedCode === 'insufficient_scope')
          assert.equal(records.filter((value) => value.name.endsWith('.read_scope_challenge')).length, 4);
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('mismatched JSON-RPC IDs cannot produce a successful MCP scenario', async () => {
  const originalFetch = globalThis.fetch;
  const records = [];
  globalThis.fetch = async (_url, init) =>
    !init.headers.Authorization
      ? Response.json({ error: 'invalid_token' }, { status: 401, headers: { 'cache-control': 'private, no-store' } })
      : Response.json({ jsonrpc: '2.0', id: 999, result: {} }, { headers: { 'cache-control': 'private, no-store' } });
  try {
    await guardedMcpChecks({
      baseUrl: new URL('https://example.invalid'),
      accessToken: 'memory-token',
      scenario: { expect: { schemaTargets: [] } },
      record: (name, pass, details) => records.push({ name, pass, details }),
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(
    records.some(
      (value) =>
        value.name === 'mcp.transport_or_protocol_failure' &&
        !value.pass &&
        value.details.code === 'INVALID_MCP_RESPONSE',
    ),
  );
});
