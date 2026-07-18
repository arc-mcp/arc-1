#!/usr/bin/env node
/**
 * Smoke-test HTTP/API-key authorization profiles against a running ARC-1 server.
 *
 * Intended setup:
 *   SAP_ALLOW_WRITES=true
 *   SAP_ALLOW_DATA_PREVIEW=true
 *   SAP_ALLOW_FREE_SQL=true
 *   SAP_ALLOW_TRANSPORT_WRITES=true
 *   SAP_ALLOW_GIT_WRITES=false
 *   SAP_FEATURE_ABAPGIT=on
 *   SAP_ALLOWED_PACKAGES='$TMP,Z*'
 *   ARC1_API_KEYS='viewer-key-local:viewer,sql-key-local:viewer-sql,dev-key-local:developer,admin-key-local:admin'
 *
 * This checks the live MCP tool manifest only. It does not mutate SAP.
 */

const mcpUrl = process.env.ARC1_AUTHZ_MCP_URL ?? process.env.E2E_MCP_URL ?? 'http://127.0.0.1:19081/mcp';

const transportReadActions = ['list', 'get', 'check', 'history', 'layers', 'targets'];
const transportWriteActions = ['create', 'release', 'delete', 'remove_object', 'reassign', 'release_recursive'];
const gitReadActions = ['list_repos', 'whoami', 'config', 'branches', 'external_info', 'history', 'objects', 'check'];
const gitWriteActions = ['stage', 'clone', 'pull', 'push', 'commit', 'switch_branch', 'create_branch', 'unlink'];

const profiles = [
  {
    name: 'viewer',
    key: process.env.ARC1_AUTHZ_VIEWER_KEY ?? 'viewer-key-local',
    expected: {
      hasSAPQuery: false,
      hasSAPWrite: false,
      hasSAPActivate: false,
      readHasTableContents: false,
      transportActions: transportReadActions,
      gitActions: gitReadActions,
    },
  },
  {
    name: 'viewer-sql',
    key: process.env.ARC1_AUTHZ_SQL_KEY ?? 'sql-key-local',
    expected: {
      hasSAPQuery: true,
      hasSAPWrite: false,
      hasSAPActivate: false,
      readHasTableContents: true,
      transportActions: transportReadActions,
      gitActions: gitReadActions,
    },
  },
  {
    name: 'developer',
    key: process.env.ARC1_AUTHZ_DEV_KEY ?? 'dev-key-local',
    expected: {
      hasSAPQuery: false,
      hasSAPWrite: true,
      hasSAPActivate: true,
      readHasTableContents: false,
      transportActions: [...transportReadActions, ...transportWriteActions],
      gitActions: gitReadActions,
    },
  },
  {
    name: 'admin',
    key: process.env.ARC1_AUTHZ_ADMIN_KEY ?? 'admin-key-local',
    expected: {
      hasSAPQuery: true,
      hasSAPWrite: true,
      hasSAPActivate: true,
      readHasTableContents: true,
      transportActions: [...transportReadActions, ...transportWriteActions],
      gitActions: gitReadActions,
    },
  },
];

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function parseMcpResponse(text) {
  const dataLine = text
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('data: '));
  const raw = dataLine ? dataLine.slice(6) : text;
  return JSON.parse(raw);
}

async function listTools(profile) {
  const response = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${profile.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });

  const text = await response.text();
  if (!response.ok) {
    fail(`${profile.name}: tools/list failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  const payload = parseMcpResponse(text);
  if (payload.error) {
    fail(`${profile.name}: tools/list returned JSON-RPC error: ${JSON.stringify(payload.error)}`);
  }

  const tools = payload.result?.tools;
  if (!Array.isArray(tools)) {
    fail(`${profile.name}: tools/list response did not contain result.tools[]`);
  }
  return tools;
}

function enumOf(tool, field) {
  return tool?.inputSchema?.properties?.[field]?.enum ?? [];
}

function sameMembers(actual, expected) {
  return actual.length === expected.length && expected.every((value) => actual.includes(value));
}

function assertProfile(profile, tools) {
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  const expected = profile.expected;

  assert(Boolean(byName.SAPRead), `${profile.name}: SAPRead missing`);
  assert(Boolean(byName.SAPSearch), `${profile.name}: SAPSearch missing`);
  assert(Boolean(byName.SAPTransport), `${profile.name}: SAPTransport missing`);
  assert(Boolean(byName.SAPGit), `${profile.name}: SAPGit missing`);

  assert(Boolean(byName.SAPQuery) === expected.hasSAPQuery, `${profile.name}: SAPQuery visibility mismatch`);
  assert(Boolean(byName.SAPWrite) === expected.hasSAPWrite, `${profile.name}: SAPWrite visibility mismatch`);
  assert(Boolean(byName.SAPActivate) === expected.hasSAPActivate, `${profile.name}: SAPActivate visibility mismatch`);

  const readTypes = enumOf(byName.SAPRead, 'type');
  assert(
    readTypes.includes('TABLE_CONTENTS') === expected.readHasTableContents,
    `${profile.name}: SAPRead.TABLE_CONTENTS visibility mismatch`,
  );

  const transportActions = enumOf(byName.SAPTransport, 'action');
  assert(
    sameMembers(transportActions, expected.transportActions),
    `${profile.name}: SAPTransport actions mismatch; expected [${expected.transportActions.join(', ')}], got [${transportActions.join(', ')}]`,
  );

  const gitActions = enumOf(byName.SAPGit, 'action');
  assert(
    sameMembers(gitActions, expected.gitActions),
    `${profile.name}: SAPGit actions mismatch; expected [${expected.gitActions.join(', ')}], got [${gitActions.join(', ')}]`,
  );

  for (const action of gitWriteActions) {
    assert(!gitActions.includes(action), `${profile.name}: SAPGit.${action} should be hidden when SAP_ALLOW_GIT_WRITES=false`);
  }
}

console.log(`ARC-1 HTTP authz profile smoke test: ${mcpUrl}`);
for (const profile of profiles) {
  const tools = await listTools(profile);
  assertProfile(profile, tools);
  const names = tools.map((tool) => tool.name).join(', ');
  console.log(`PASS ${profile.name}: ${names}`);
}
console.log('PASS all HTTP/API-key profile manifest checks');
