/**
 * E2E test helpers — MCP client factory, tool call wrapper, assertion helpers.
 *
 * Usage in tests:
 *   import { connectClient, callTool, expectToolError, expectToolSuccess } from './helpers.js';
 *
 *   let client: Client;
 *   beforeAll(async () => { client = await connectClient(); });
 *   afterAll(async () => { await client.close(); });
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect } from 'vitest';
import { RUN_ID } from '../helpers/run-id.js';
import { skipTest } from '../helpers/skip-policy.js';

/** MCP tool call result shape */
export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

/**
 * Generate a collision-safe, ABAP-valid unique object name for E2E writes.
 * Embeds the per-run id (tests/helpers/run-id.ts) plus a timestamp and a random
 * component, so two runs against the same SAP system never collide. Truncated to
 * the ABAP 30-char object-name limit; keep prefixes short enough that the
 * `_${RUN_ID}…` suffix survives the truncation.
 */
export function uniqueName(prefix: string): string {
  const rand = Math.floor(Math.random() * 1e5)
    .toString(36)
    .toUpperCase()
    .padStart(3, '0');
  const ts = Date.now().toString(36).toUpperCase();
  return `${prefix}_${RUN_ID}${ts}${rand}`.slice(0, 30);
}

/**
 * Like {@link uniqueName} but the generated suffix is letters-only — for object
 * types that reject digits in the generated portion (e.g. function-group naming
 * in func-write.e2e). The prefix may still contain digits; only the suffix is
 * constrained.
 */
export function uniqueLettersName(prefix: string): string {
  const toLetters = (n: number): string => {
    let s = '';
    let v = n;
    while (v > 0) {
      s = String.fromCharCode(65 + (v % 26)) + s;
      v = Math.floor(v / 26);
    }
    return s || 'A';
  };
  // RUN_ID is letters-only, so no separate mapping is needed. Random BEFORE the
  // timestamp so per-call entropy survives caller-side truncation — rap-write
  // call sites do `.slice(0, 16)` for ≤16-char CDS/TABL names, which would
  // otherwise chop a trailing random component off entirely.
  return `${prefix}${RUN_ID}${toLetters(Math.floor(Math.random() * 1e6))}${toLetters(Date.now())}`.slice(0, 30);
}

/** Server identity from /health endpoint */
export interface ServerHealth {
  status: string;
  version: string;
  startedAt?: string;
  pid?: number;
}

/**
 * Check MCP server health and return identity info.
 * Useful for verifying you're talking to the correct (freshly deployed) process.
 */
export async function checkServerHealth(): Promise<ServerHealth> {
  const mcpUrl = process.env.E2E_MCP_URL ?? 'http://localhost:3000/mcp';
  const healthUrl = mcpUrl.replace(/\/mcp$/, '/health');

  const resp = await fetch(healthUrl);
  if (!resp.ok) {
    throw new Error(`Health check failed: HTTP ${resp.status} from ${healthUrl}`);
  }
  return (await resp.json()) as ServerHealth;
}

/**
 * Connect an MCP client to the E2E server.
 * Uses E2E_MCP_URL env var (default: http://localhost:3000/mcp).
 *
 * Performs a health check first to verify the server is the expected process
 * (not a zombie from a previous deploy). Logs server identity for debugging.
 */
export async function connectClient(): Promise<Client> {
  const url = process.env.E2E_MCP_URL ?? 'http://localhost:3000/mcp';

  // Pre-flight: verify server identity
  try {
    const health = await checkServerHealth();
    console.log(`    [server] version=${health.version} pid=${health.pid ?? '?'} startedAt=${health.startedAt ?? '?'}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`    [server] Health check failed (non-fatal): ${msg}`);
  }

  const client = new Client({ name: 'arc1-e2e-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url));

  try {
    await client.connect(transport);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to connect to MCP server at ${url}\n` +
        `  Error: ${message}\n` +
        `  - Is the MCP server running? (npm run test:e2e:deploy)\n` +
        `  - Is E2E_MCP_URL correct? (current: ${url})`,
    );
  }

  return client;
}

/**
 * Reconnect an MCP client after a transport failure (timeout, fetch failed, etc.).
 * Closes the old client and returns a fresh one.
 */
export async function reconnectClient(oldClient: Client): Promise<Client> {
  try {
    await oldClient.close();
  } catch {
    // best-effort-cleanup — the transport is likely already broken
  }
  console.log('    [reconnect] Transport broken — creating fresh MCP connection...');
  return connectClient();
}

/**
 * Detect if an error indicates a broken transport that requires reconnection.
 * These errors cascade: once the transport breaks, ALL subsequent calls fail.
 */
function isTransportError(message: string): boolean {
  return /fetch failed|ECONNREFUSED|ECONNRESET|socket hang up|aborted/i.test(message);
}

/**
 * Call an MCP tool with rich error context on failure.
 * Logs every call for debugging (visible in vitest verbose output).
 *
 * If the transport is broken (fetch failed after a timeout), attempts to
 * reconnect and retry once. The reconnected client is returned via the
 * optional `clientRef` parameter so subsequent calls use the fresh client.
 */
export async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
  clientRef?: { current: Client },
): Promise<ToolResult> {
  const start = Date.now();
  try {
    const result = (await client.callTool({ name, arguments: args })) as ToolResult;
    const duration = Date.now() - start;

    const status = result.isError ? 'ERROR' : 'OK';
    const preview = result.content?.[0]?.text?.slice(0, 100) ?? '(empty)';
    console.log(`    -> ${name}(${JSON.stringify(args)}) [${duration}ms] ${status}: ${preview}...`);

    return result;
  } catch (err) {
    const duration = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`    -> ${name}(${JSON.stringify(args)}) [${duration}ms] THREW: ${message}`);

    // If the transport is broken and we have a clientRef, reconnect and retry once
    if (isTransportError(message) && clientRef) {
      try {
        const freshClient = await reconnectClient(client);
        clientRef.current = freshClient;

        const retryStart = Date.now();
        const result = (await freshClient.callTool({ name, arguments: args })) as ToolResult;
        const retryDuration = Date.now() - retryStart;

        const status = result.isError ? 'ERROR' : 'OK';
        const preview = result.content?.[0]?.text?.slice(0, 100) ?? '(empty)';
        console.log(
          `    -> ${name}(${JSON.stringify(args)}) [${retryDuration}ms] ${status} (after reconnect): ${preview}...`,
        );

        return result;
      } catch (retryErr) {
        const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
        console.error(`    -> ${name} retry after reconnect also failed: ${retryMessage}`);
      }
    }

    throw new Error(
      `Tool call failed: ${name}(${JSON.stringify(args)})\n` +
        `  Duration: ${duration}ms\n` +
        `  Error: ${message}\n` +
        `  Tip: Check $E2E_LOG_DIR/mcp-server.log for server-side details`,
    );
  }
}

/**
 * Assert a tool call returned successfully (no error).
 * Returns the text content for further assertions.
 */
export function expectToolSuccess(result: ToolResult): string {
  expect(result.isError, `Expected success but got error: ${result.content?.[0]?.text?.slice(0, 300)}`).toBeFalsy();
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe('text');
  expect(result.content[0].text).toBeTruthy();
  return result.content[0].text;
}

/**
 * Assert a tool call returned an error with expected properties:
 * - isError is true
 * - No raw XML leaked
 * - No stack traces leaked
 * - Contains expected substrings (if provided)
 */
export function expectToolError(result: ToolResult, ...expectedSubstrings: string[]): string {
  expect(result.isError, `Expected error but got success: ${result.content?.[0]?.text?.slice(0, 200)}`).toBe(true);
  expect(result.content).toHaveLength(1);
  const text = result.content[0]?.text ?? '';

  // Must not leak internals
  expect(text, 'Error contains raw XML').not.toContain('<?xml');
  expect(text, 'Error contains stack trace').not.toMatch(/at \w+\.\w+ \(/);
  expect(text, 'Error contains .ts file reference').not.toMatch(/\.ts:\d+/);

  // Check expected content
  for (const sub of expectedSubstrings) {
    expect(text, `Error should contain "${sub}":\n  Actual: ${text.slice(0, 300)}`).toContain(sub);
  }

  return text;
}

/**
 * Classify a `ToolResult` error message as a known SAP release gap / backend
 * limitation that should skip the test cleanly rather than fail.
 *
 * Mirrors `ddicSkipReason()` in `tests/integration/crud.lifecycle.integration.test.ts`
 * — kept in sync so both suites speak the same skip taxonomy
 * (see `docs/integration-test-skips.md`). Returns a skip reason string or
 * null when the error is genuinely unexpected and should propagate.
 */
export function classifyToolErrorSkip(result: ToolResult): string | null {
  if (!result.isError) return null;
  const text = result.content?.[0]?.text ?? '';
  // Release gap — ADT endpoints absent on pre-7.52 systems.
  if (/\/sap\/bc\/adt\/ddic\/domains(?:\/|\b).*(?:does not exist|not found)/i.test(text)) {
    return 'Backend feature not supported on this SAP system: /ddic/domains endpoint not available on this release';
  }
  if (/\/sap\/bc\/adt\/ddic\/tables(?:\?|\b).*(?:does not exist|not found)/i.test(text)) {
    return 'Backend feature not supported on this SAP system: /ddic/tables collection not available on this release';
  }
  if (/\/sap\/bc\/adt\/ddic\/tables\/[A-Z0-9_]+\/source.*(?:does not exist|not found)/i.test(text)) {
    return 'Backend feature not supported on this SAP system: TABL source read not available on this release';
  }
  // resolveTablObjectUrl() probes /tables/ first then falls back to /structures/.
  // When neither exists (e.g. the table itself isn't shipped on this system —
  // observed for T001 on a4h S/4HANA 2023 trial), both probes return 404 and the
  // tool error surfaces the structures URL. Skip cleanly so missing fixtures
  // don't fail tests that target a different feature.
  if (/\/sap\/bc\/adt\/ddic\/structures\/[A-Z0-9_]+\b.*status 404/i.test(text)) {
    return 'Fixture not on this SAP system: TABL/STRU object missing from shipped repository';
  }
  if (/\/sap\/bc\/adt\/ddic\/dataelements\b.*Unsupported Media Type/i.test(text)) {
    return 'Backend feature not supported on this SAP system: DTEL v2 content type not supported on this release';
  }
  if (/\/sap\/bc\/adt\/packages\b.*(?:No suitable|does not exist)/i.test(text)) {
    return 'Backend feature not supported on this SAP system: /packages endpoint not available on this release';
  }
  if (/\/sap\/bc\/adt\/datapreview\/ddic\b.*No suitable resource/i.test(text)) {
    return 'Backend feature not supported on this SAP system: /datapreview/ddic endpoint not available on this release';
  }
  if (/\/sap\/bc\/adt\/datapreview\/freestyle\b.*No suitable resource/i.test(text)) {
    return 'Backend feature not supported on this SAP system: /datapreview/freestyle endpoint not available on this release';
  }
  if (/usageReferences.*status 500/i.test(text)) {
    return 'Backend feature not supported on this SAP system: usageReferences endpoint unstable on this release';
  }
  // Transport create — NW 7.50 backend gap (the action keyword isn't supported).
  if (/transportrequests.*user action\s+is not supported/i.test(text)) {
    return 'Backend feature not supported on this SAP system: transport create not supported on this SAP release';
  }
  // Lock-handle session correlation quirk — observed on NW 7.50 trial.
  if (/status 423.*invalid lock handle/i.test(text)) {
    return 'Backend feature not supported on this SAP system: lock-handle session correlation differs on this release';
  }
  // Intermittent backend flake observed in CI: ADT write/session infrastructure
  // accepts a mutation but the object LOCK/UNLOCK route responds 400
  // "Service cannot be reached". Treat that routing failure as backend
  // instability, while still failing authorization, syntax, and non-session
  // errors normally.
  if (/_action=(?:LOCK|UNLOCK)\b[^\n]*Service cannot be reached/i.test(text)) {
    return 'Backend instability on this SAP system: ADT lock/unlock endpoint intermittently unreachable during write session handling';
  }
  // batch_create aggregates per-object errors and can surface as either isError=false
  // (handler returned a "Batch created 0/N" summary string as success) or isError=true
  // (handler decided the whole batch is a failure). Handle the error path here;
  // callers should additionally pass the success-path text to skipOnBatchCreateFailure().
  if (/Batch created 0\/\d+ objects/i.test(text) && /✗/.test(text)) {
    return 'Backend feature not supported on this SAP system: batch_create aggregated inner-object failure (backend gap)';
  }
  // Stale partial-create phantom: object shell on SAP but not searchable,
  // so our cleanup in the test miss it and SAPWrite(create) returns 500/405.
  // Surface as a skip so the suite continues — operator cleans up via SE80.
  if (/A program or include already exists with the name/i.test(text) || /does already exist/i.test(text)) {
    return 'Stale partial-create phantom detected on this SAP system (object exists but not indexed) — delete manually via SE80';
  }
  // usageReferences 500 (text order varies: "status 500 at … usageReferences"
  // or "usageReferences … status 500"). Use a simpler bidirectional check.
  if (/usageReferences/i.test(text) && /status 500/i.test(text)) {
    return 'Backend feature not supported on this SAP system: usageReferences endpoint unstable on this release';
  }
  // E2E-specific: managed Z-namespace fixtures that failed to sync on this
  // system. Fixture sync records these in its summary; tests that expect them
  // surface as "... does not exist" here. Treat as NO_FIXTURE.
  const missingDdlsFixture = text.match(/DDL Source (Z[A-Z0-9_/]+) .*does not exist/i);
  if (missingDdlsFixture) {
    return `Required test fixture not found on SAP system (${missingDdlsFixture[1]}) — fixture sync skipped this object (see e2e-start-local log)`;
  }
  // E2E-specific: S/4-only SAP-shipped CDS views absent from plain NetWeaver.
  if (/DDL Source I_ABAPPACKAGE .*does not exist/i.test(text)) {
    return 'Required test fixture not found on SAP system (I_ABAPPACKAGE) — S/4 CDS view, not on this release';
  }
  // E2E-specific: /DMO/* is the S/4 Flight Reference Scenario demo content. On
  // pre-S/4 systems any /DMO/ read returns 404. Treat as NO_FIXTURE.
  const missingDmoObject = text.match(/%2FDMO%2F([A-Z0-9_]+).*(?:does not exist|not found)/i);
  if (missingDmoObject) {
    return `Required test fixture not found on SAP system (/DMO/${missingDmoObject[1]}) — S/4 Flight Reference Scenario, not on this release`;
  }
  return null;
}

/**
 * Inspect the output of a `SAPWrite action="batch_create"` call and skip if any
 * inner object failed due to a known backend gap. The batch_create handler
 * returns isError=false even when all sub-creates fail, so this has to run on
 * the *success* payload, not the error path.
 *
 * Returns true when a skip was triggered (caller should early-return).
 */
export function skipOnBatchCreateFailure(ctx: import('vitest').TestContext, text: string): boolean {
  if (!/Batch created 0\/\d+ objects/i.test(text)) return false;
  if (!/✗/i.test(text)) return false;
  const match = text.match(/✗\s*—\s*([^\n]{0,160})/);
  const hint = match?.[1] ?? '';
  skipTest(
    ctx,
    `Backend feature not supported on this SAP system: batch_create aggregated inner-object failure (${hint.slice(0, 100)}…)`,
  );
  return true;
}

/**
 * Expect success, OR skip via `skipTest(ctx, reason)` if the error matches a known release
 * gap / backend quirk. Returns the text content on success.
 *
 * Usage:
 *   const text = await expectToolSuccessOrSkip(ctx, result);
 *   // text is guaranteed non-null here.
 */
export function expectToolSuccessOrSkip(ctx: import('vitest').TestContext, result: ToolResult): string {
  const skip = classifyToolErrorSkip(result);
  if (skip !== null) {
    skipTest(ctx, skip);
    // Unreachable — skipTest(ctx, reason) throws. Return empty to satisfy the type.
    return '';
  }
  return expectToolSuccess(result);
}
