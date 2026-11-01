import { HarnessError, readToolBody } from './safe-io.mjs';

const TARGET = /^[A-Z][A-Z0-9-]{1,30}[A-Z0-9]\/[0-9]{3}$/;
const OUTCOMES = new Set(['marker', 'INSUFFICIENT_SCOPE', 'TARGET_POLICY_DENIED', 'TARGET_NOT_AVAILABLE']);
const MARKER = 'ZARC1_CLIENT_MARKER';

/** Explicitly opt-in, fixed read-only fixture. Never accept caller-supplied SQL or table names. */
export function validateBackendChecks(checks) {
  if (checks === undefined) return [];
  if (!Array.isArray(checks) || checks.length === 0 || checks.length > 8)
    throw new HarnessError('INVALID_BACKEND_CHECKS');
  for (const check of checks) {
    if (
      !check ||
      typeof check !== 'object' ||
      Array.isArray(check) ||
      Object.keys(check).some((key) => !['target', 'operation', 'outcome'].includes(key)) ||
      typeof check.target !== 'string' ||
      !TARGET.test(check.target) ||
      !['data', 'sql'].includes(check.operation) ||
      !OUTCOMES.has(check.outcome)
    )
      throw new HarnessError('INVALID_BACKEND_CHECK');
  }
  return checks;
}

function markerRequest(operation, target) {
  const args = target === undefined ? {} : { target };
  return operation === 'data'
    ? {
        name: 'SAPRead',
        arguments: {
          ...args,
          type: 'TABLE_QUERY',
          name: 'TVARVC',
          columns: ['MANDT', 'NAME', 'LOW'],
          where: [{ field: 'NAME', op: '=', value: MARKER }],
          maxRows: 2,
        },
      }
    : {
        name: 'SAPQuery',
        arguments: {
          ...args,
          sql: "SELECT mandt, name, low FROM tvarvc WHERE name = 'ZARC1_CLIENT_MARKER'",
          maxRows: 2,
        },
      };
}

/** Full response stays local; only assertions leave the harness. Not proof of mapped SAP username. */
export async function runBackendChecks({ checks, aggregate, session, record }) {
  for (const [index, check] of validateBackendChecks(checks).entries()) {
    const prefix = `backend_${index}`;
    const assertResult = (response, route) => {
      const read = readToolBody(response);
      if (check.outcome !== 'marker') {
        record(
          `${prefix}.${route}.exact_denial`,
          response.status === 200 &&
            read.result?.isError === true &&
            read.body?.error === check.outcome &&
            read.body?.rows === undefined,
        );
        return;
      }
      const rows = read.body?.rows;
      const client = check.target.split('/')[1];
      const row =
        Array.isArray(rows) && rows.length === 1 && rows[0] && typeof rows[0] === 'object'
          ? Object.fromEntries(Object.entries(rows[0]).map(([key, value]) => [key.toUpperCase(), value]))
          : undefined;
      record(
        `${prefix}.${route}.exact_client_marker`,
        response.status === 200 &&
          read.result?.isError !== true &&
          !!row &&
          row.MANDT === client &&
          row.NAME === MARKER &&
          row.LOW === client,
      );
    };
    assertResult(await aggregate.request('tools/call', markerRequest(check.operation, check.target)), 'aggregate');
    const pinned = session(`/${check.target}/mcp`, `${prefix}.pinned`);
    const init = await pinned.initialize();
    if (check.outcome === 'TARGET_NOT_AVAILABLE') {
      record(`${prefix}.pinned.denied`, init.status === 404);
    } else {
      record(`${prefix}.pinned.initialized`, init.status === 200 && !!init.json?.result?.protocolVersion);
      if (init.status === 200 && init.json?.result?.protocolVersion)
        assertResult(await pinned.request('tools/call', markerRequest(check.operation)), 'pinned');
    }
  }
}
