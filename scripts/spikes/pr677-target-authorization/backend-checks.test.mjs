import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runBackendChecks, validateBackendChecks } from './backend-checks.mjs';
import { validateScenario } from './mcp-checks.mjs';

const check = { target: 'A4H/100', operation: 'data', outcome: 'marker' };
const response = (body, isError = false, status = 200) => ({
  status,
  json: { result: { isError, content: [{ type: 'text', text: JSON.stringify(body) }] } },
});
const marker = { rows: [{ MANDT: '100', NAME: 'ZARC1_CLIENT_MARKER', LOW: '100' }] };

async function run(probe, result, initStatus = 200) {
  const calls = [];
  const assertions = [];
  const request = async (method, params) => {
    calls.push({ method, params });
    return result;
  };
  await runBackendChecks({
    checks: [probe],
    aggregate: { request },
    session: (path) => {
      calls.push({ path });
      return {
        initialize: async () => ({ status: initStatus, json: { result: { protocolVersion: '2025-03-26' } } }),
        request,
      };
    },
    record: (name, pass) => assertions.push({ name, pass }),
  });
  return { calls, assertions };
}

test('backend probes require explicit bounded, mutation-free fixtures', () => {
  assert.deepEqual(validateBackendChecks(undefined), []);
  assert.deepEqual(validateBackendChecks([check]), [check]);
  for (const value of [
    null,
    [],
    Array(9).fill(check),
    [{ ...check, target: '../001' }],
    [{ ...check, sql: 'DELETE FROM tvarvc' }],
    [{ ...check, operation: 'write' }],
    [{ ...check, outcome: 'any_error' }],
  ])
    assert.throws(() => validateBackendChecks(value), HarnessErrorLike);
  assert.throws(() => validateScenario({ expect: { aggregateHttpStatus: 401 }, backendChecks: [check] }), {
    code: 'BACKEND_CHECKS_REQUIRE_AUTHENTICATED_SCENARIO',
  });
});
const HarnessErrorLike = (error) => error.code?.startsWith('INVALID_BACKEND_CHECK');

test('data and SQL probes use the same fixed marker and bounded row count on both routes', async () => {
  for (const operation of ['data', 'sql']) {
    const result = await run({ ...check, operation }, response(marker));
    assert.ok(result.assertions.every((item) => item.pass));
    const calls = result.calls.filter((item) => item.method);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].params.arguments.target, 'A4H/100');
    assert.equal(calls[1].params.arguments.target, undefined);
    for (const call of calls) {
      assert.equal(call.params.arguments.maxRows, 2);
      assert.equal(call.params.name, operation === 'data' ? 'SAPRead' : 'SAPQuery');
      if (operation === 'data') {
        assert.equal(call.params.arguments.type, 'TABLE_QUERY');
        assert.equal(call.params.arguments.name, 'TVARVC');
        assert.deepEqual(call.params.arguments.columns, ['MANDT', 'NAME', 'LOW']);
        assert.deepEqual(call.params.arguments.where, [{ field: 'NAME', op: '=', value: 'ZARC1_CLIENT_MARKER' }]);
      } else {
        assert.equal(
          call.params.arguments.sql,
          "SELECT mandt, name, low FROM tvarvc WHERE name = 'ZARC1_CLIENT_MARKER'",
        );
      }
    }
    assert.equal(result.calls[1].path, '/A4H/100/mcp');
  }
});

test('wrong client, missing/duplicate marker, malformed response and SAP failures cannot pass', async () => {
  for (const body of [
    undefined,
    {},
    { rows: [] },
    { rows: [marker.rows[0], marker.rows[0]] },
    { rows: [{ ...marker.rows[0], MANDT: '001' }] },
    { rows: [{ ...marker.rows[0], LOW: '001' }] },
    { rows: [{ ...marker.rows[0], NAME: 'UNRELATED' }] },
  ]) {
    const result = await run(check, response(body));
    assert.equal(result.assertions.filter((item) => item.pass).length, 1); // Only initialization.
  }
  for (const result of [response(marker, true), response(marker, false, 503)]) {
    assert.equal((await run(check, result)).assertions.filter((item) => item.pass).length, 1);
  }
});

test('denial requires exact policy code, never an outage or general tool error', async () => {
  for (const outcome of ['INSUFFICIENT_SCOPE', 'TARGET_POLICY_DENIED']) {
    assert.ok((await run({ ...check, outcome }, response({ error: outcome }, true))).assertions.every((a) => a.pass));
    for (const bad of [
      response({ error: 'BACKEND_UNAVAILABLE' }, true),
      response({ error: outcome }, false),
      response({ error: outcome, rows: marker.rows }, true),
      response({ error: outcome }, true, 503),
    ]) {
      assert.equal((await run({ ...check, outcome }, bad)).assertions.filter((a) => a.pass).length, 1);
    }
  }
  const denied = await run(
    { ...check, outcome: 'TARGET_NOT_AVAILABLE' },
    response({ error: 'TARGET_NOT_AVAILABLE' }, true),
    404,
  );
  assert.ok(denied.assertions.every((a) => a.pass));
  assert.equal(denied.calls.filter((item) => item.method).length, 1);
});

test('failed pinned initialization cannot accidentally pass or send a backend query', async () => {
  const result = await run(check, response(marker), 401);
  assert.equal(result.calls.filter((item) => item.method).length, 1);
  assert.ok(result.assertions.some((item) => !item.pass));
  assert.ok(!JSON.stringify(result.assertions).includes('ZARC1_CLIENT_MARKER'));
});
