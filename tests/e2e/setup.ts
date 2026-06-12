/**
 * E2E fixture sync — keeps persistent test objects aligned with local fixtures.
 *
 * For each object in PERSISTENT_OBJECTS:
 *   1. SAPSearch to discover existing object type(s) on the SAP system
 *   2. If missing → SAPWrite create from fixture → SAPActivate
 *   3. If present but source drifted → SAPWrite delete old object(s) → recreate from fixture
 *   4. If present and source matches fixture → keep as-is
 *
 * Objects are created in $TMP and intended only for automated E2E validation.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { bareObjectName } from '../helpers/test-prefixes.js';
import { PERSISTENT_OBJECTS, readFixture } from './fixtures.js';
import { callTool, type ToolResult } from './helpers.js';

type PersistentObject = (typeof PERSISTENT_OBJECTS)[number];

interface InactiveFixture {
  type: string;
  name: string;
  uri?: string;
  transport?: string;
  deleted?: boolean;
}

export interface FixtureSyncSummary {
  created: string[];
  recreated: string[];
  unchanged: string[];
  deleted: string[];
  /**
   * Fixtures whose create/recreate hit a known backend quirk (e.g. NW 7.50
   * lock-handle 423, DOMA/DTEL endpoint 404) — recorded here instead of
   * aborting the whole sync so tests can cleanly skip via `requireOrSkip` /
   * `expectToolSuccessOrSkip` based on the same taxonomy.
   */
  skipped: Array<{ label: string; reason: string }>;
}

/**
 * Classify a fixture-sync error message against the release-gap / backend-quirk
 * taxonomy. Kept in sync with `classifyToolErrorSkip()` in tests/e2e/helpers.ts
 * and `ddicSkipReason()` in tests/integration/crud.lifecycle.integration.test.ts
 * (see docs/integration-test-skips.md).
 */
export function classifyFixtureError(message: string): string | null {
  if (/status 423.*invalid lock handle/i.test(message)) {
    return 'NW 7.50 lock-handle session correlation differs — create+PUT sequence returns 423 on this release';
  }
  // A stale partial-create from a previous failed sync run: the object shell
  // exists on SAP but wasn't indexed / populated, so our SAPSearch returns empty
  // yet SAPWrite(create) fails with 500 "already exists". Rather than fighting
  // it here — which would need a delete-under-lock that may also 423 on 7.50 —
  // skip cleanly and surface the situation to the operator.
  if (/A program or include already exists/i.test(message) || /does already exist/i.test(message)) {
    return 'Stale partial-create detected (object exists on SAP but not indexed) — delete manually via SE80 and re-run sync';
  }
  if (/\/sap\/bc\/adt\/ddic\/domains(?:\/|\b).*(?:does not exist|not found)/i.test(message)) {
    return '/ddic/domains endpoint not available on this release';
  }
  if (/\/sap\/bc\/adt\/ddic\/dataelements\b.*Unsupported Media Type/i.test(message)) {
    return 'DTEL v2 content type not supported on this release';
  }
  if (/\/sap\/bc\/adt\/ddic\/tables(?:\?|\b).*(?:does not exist|not found)/i.test(message)) {
    return '/ddic/tables collection not available on this release';
  }
  if (/\/sap\/bc\/adt\/packages\b.*(?:No suitable|does not exist)/i.test(message)) {
    return '/packages endpoint not available on this release';
  }
  return null;
}

/**
 * Ensure all persistent test objects exist on SAP and match fixture content.
 * Existing objects with source drift are deleted and recreated.
 */
export async function syncPersistentFixtures(client: Client): Promise<FixtureSyncSummary> {
  const summary: FixtureSyncSummary = {
    created: [],
    recreated: [],
    unchanged: [],
    deleted: [],
    skipped: [],
  };
  const verifiedActiveSources = new Set<string>();

  for (const obj of PERSISTENT_OBJECTS) {
    const label = `${obj.type} ${obj.name}`;
    const expectedType = obj.type.toUpperCase();
    const desiredSource = normalizeSource(readFixture(obj.fixture), obj.type);
    const existingTypes = await findExistingObjectTypes(client, obj.name);
    const hasExpectedType = existingTypes.includes(expectedType);

    if (!hasExpectedType && existingTypes.length === 0) {
      console.log(`    [setup] ${label}: missing -> creating from ${obj.fixture}`);
      await createActivateOrReconcile(client, obj, desiredSource, summary, verifiedActiveSources, 'create');
      continue;
    }

    let needsRecreate = !hasExpectedType;
    if (hasExpectedType) {
      const liveSource = await readObjectSource(client, obj.type, obj.name);
      if (normalizeSource(liveSource, obj.type) !== desiredSource) {
        needsRecreate = true;
        console.log(`    [setup] ${label}: fixture drift detected -> delete + recreate`);
      }
    }

    if (!needsRecreate) {
      const staleTypes = existingTypes.filter((type) => type !== expectedType);
      if (staleTypes.length > 0) {
        console.log(`    [setup] ${label}: removing stale typed variants (${staleTypes.join(', ')})`);
        await deleteObjectTypes(client, obj.name, staleTypes, summary.deleted);
      }
      console.log(`    [setup] ${label}: up-to-date`);
      summary.unchanged.push(label);
      verifiedActiveSources.add(label);
      continue;
    }

    if (existingTypes.length > 0) {
      console.log(`    [setup] ${label}: deleting existing object(s) [${existingTypes.join(', ')}]`);
      await deleteObjectTypes(client, obj.name, existingTypes, summary.deleted);
    }

    console.log(`    [setup] ${label}: recreating from ${obj.fixture}`);
    await createActivateOrReconcile(client, obj, desiredSource, summary, verifiedActiveSources, 'recreate');
  }

  await assertSyncedFixturesActive(client, summary, verifiedActiveSources);

  console.log(
    `    [setup] Fixture sync summary: created=${summary.created.length}, recreated=${summary.recreated.length}, unchanged=${summary.unchanged.length}, deleted=${summary.deleted.length}, skipped=${summary.skipped.length}`,
  );
  if (summary.skipped.length > 0) {
    console.log(
      `    [setup] Some fixtures skipped due to known backend gaps — affected tests will auto-skip. See docs/integration-test-skips.md.`,
    );
  }
  return summary;
}

/**
 * Backward-compatible alias used by older docs/callers.
 */
export async function ensureTestObjects(client: Client): Promise<string[]> {
  const summary = await syncPersistentFixtures(client);
  return [...summary.created, ...summary.recreated];
}

/**
 * Delete all persistent fixture objects currently present on the target system.
 * Useful for manual reset.
 */
export async function deletePersistentFixtures(client: Client): Promise<string[]> {
  const deleted: string[] = [];
  for (const obj of PERSISTENT_OBJECTS) {
    const existingTypes = await findExistingObjectTypes(client, obj.name);
    if (existingTypes.length === 0) continue;
    await deleteObjectTypes(client, obj.name, existingTypes, deleted);
  }
  return deleted;
}

async function createObjectFromFixture(client: Client, obj: PersistentObject): Promise<void> {
  const source = readFixture(obj.fixture);
  const createResult = await callTool(client, 'SAPWrite', {
    action: 'create',
    type: obj.type,
    name: obj.name,
    source,
    package: '$TMP',
  });
  assertToolSuccess(createResult, `create ${obj.type} ${obj.name}`);
}

async function activateObject(client: Client, type: string, name: string): Promise<void> {
  const activateResult = await callTool(client, 'SAPActivate', { type, name });
  assertToolSuccess(activateResult, `activate ${type} ${name}`);
}

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Create + activate a fixture, tolerating a concurrent run that produced the
 * same object microseconds earlier. On a known backend-quirk error (423 /
 * "already exists" — see {@link classifyFixtureError}) we re-check the system
 * before skipping: a parallel worktree / CI run may simply have won the create
 * race, in which case the object is already correct and we record it as
 * unchanged rather than skipping a chunk of the suite.
 */
async function createActivateOrReconcile(
  client: Client,
  obj: PersistentObject,
  desiredSource: string,
  summary: FixtureSyncSummary,
  verifiedActiveSources: Set<string>,
  mode: 'create' | 'recreate',
): Promise<void> {
  const label = `${obj.type} ${obj.name}`;
  try {
    await createObjectFromFixture(client, obj);
    await activateObject(client, obj.type, obj.name);
    (mode === 'create' ? summary.created : summary.recreated).push(label);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const reason = classifyFixtureError(msg);
    if (reason === null) throw err;
    // Only a create RACE (a concurrent run beat us to the same object) is worth
    // re-polling; release gaps / stale phantoms can never appear via a re-check,
    // so skip them immediately as before (no wasted poll/backoff).
    if (isConcurrencyRaceError(msg)) {
      const recon = await reconcileConcurrentFixture(client, obj, desiredSource);
      if (recon === 'reconciled') {
        console.log(`    [setup] ${label}: produced by a concurrent run — reconciled (source matches)`);
        summary.unchanged.push(label);
        verifiedActiveSources.add(label);
        return;
      }
      if (recon === 'drift') {
        const driftReason =
          'Concurrent run created a different version of this fixture (likely another branch) — re-run once it finishes';
        console.warn(`    [setup] ${label}: skipping ${mode} — ${driftReason}`);
        summary.skipped.push({ label, reason: driftReason });
        return;
      }
    }
    console.warn(`    [setup] ${label}: skipping ${mode} — ${reason}`);
    summary.skipped.push({ label, reason });
  }
}

/** A create error that looks like a lost race — another run created the same object first. */
function isConcurrencyRaceError(message: string): boolean {
  return (
    /status 423.*invalid lock handle/i.test(message) ||
    /already exists/i.test(message) ||
    /does already exist/i.test(message)
  );
}

/**
 * After a create race, poll a few times to see whether the object now exists on
 * SAP and matches our fixture:
 *   - 'reconciled' — present with matching source (another run won; we idempotently
 *     re-activate in case that run hasn't finished activating yet)
 *   - 'drift'      — present but DIFFERENT source (a genuinely conflicting writer,
 *     e.g. another branch) — caller skips rather than fighting it
 *   - 'absent'     — still not there, so the original error stands
 */
async function reconcileConcurrentFixture(
  client: Client,
  obj: PersistentObject,
  desiredSource: string,
): Promise<'reconciled' | 'drift' | 'absent'> {
  const expectedType = obj.type.toUpperCase();
  // Probe first (an "already exists" race means the object is there NOW), then a
  // single short re-poll for a still-in-flight create. The whole body is guarded
  // so a read/search failure mid-reconcile (release-gapped source read, object
  // locked by the other run) returns 'absent' and the caller records the
  // ORIGINAL skip — never an uncaught throw that aborts the entire sync.
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const types = await findExistingObjectTypes(client, obj.name);
      if (types.includes(expectedType)) {
        const live = normalizeSource(await readObjectSource(client, obj.type, obj.name), obj.type);
        if (live !== desiredSource) return 'drift';
        try {
          await activateObject(client, obj.type, obj.name);
        } catch {
          // best-effort — the other run may hold the lock or have already activated it
        }
        return 'reconciled';
      }
    } catch {
      // fall through to the retry / 'absent' — see the comment above
    }
    if (attempt < 2) await delay(1500);
  }
  return 'absent';
}

// Types SAPWrite(action="delete") accepts. SAP-generated siblings like STOB (structure
// objects auto-created when a DDLS is activated) are not directly deletable and are
// cleaned up implicitly when their parent DDLS is removed — filter them out so we don't
// fail the fixture sync on a phantom cleanup step.
const DELETABLE_TYPES = new Set([
  'PROG',
  'CLAS',
  'INTF',
  'FUNC',
  'INCL',
  'DDLS',
  'DCLS',
  'DDLX',
  'BDEF',
  'SRVD',
  'SRVB',
  'SKTD',
  'TABL',
  'DOMA',
  'DTEL',
  'MSAG',
]);

async function deleteObjectTypes(client: Client, name: string, types: string[], sink: string[]): Promise<void> {
  for (const type of types) {
    if (!DELETABLE_TYPES.has(type.toUpperCase())) {
      console.warn(
        `    [setup] delete skipped for ${type} ${name}: type not directly deletable (likely SAP-generated sibling)`,
      );
      continue; // best-effort-cleanup
    }
    const deleteResult = await callTool(client, 'SAPWrite', {
      action: 'delete',
      type,
      name,
    });
    if (deleteResult.isError) {
      const text = toolText(deleteResult);
      if (/not found|does not exist|unknown/i.test(text)) continue;
      if (/still in use|dependent object|used by|cannot be deleted/i.test(text)) {
        console.warn(`    [setup] delete skipped for ${type} ${name}: ${text.slice(0, 240)}`);
        continue; // best-effort-cleanup
      }
      // NW 7.50 lock-handle 423 quirk — the same pattern that breaks create+PUT
      // also breaks lock+DELETE. Treat as skip so the sync doesn't abort.
      if (/status 423.*invalid lock handle/i.test(text)) {
        console.warn(
          `    [setup] delete skipped for ${type} ${name}: NW 7.50 lock-handle 423 quirk (object remains; tests that need a fresh fixture will skip)`,
        );
        continue;
      }
      throw new Error(`Failed to delete ${type} ${name}: ${text}`);
    }
    sink.push(`${type} ${name}`);
  }
}

async function findExistingObjectTypes(client: Client, name: string): Promise<string[]> {
  const result = await callTool(client, 'SAPSearch', { query: name, maxResults: 20 });
  if (result.isError) {
    return [];
  }
  const text = toolText(result);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCachedPrefix(text));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const types = new Set<string>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') continue;
    const objectName = getString(entry, 'objectName');
    const objectType = getString(entry, 'objectType');
    if (!objectName || !objectType) continue;
    // On NW 7.50 the search result decorates the name with a display suffix
    // like "ZIF_ARC1_TEST (Interface)". Normalize to the bare name (shared with
    // the janitor's selector) so equality matches.
    const bareName = bareObjectName(objectName);
    if (bareName.toUpperCase() !== name.toUpperCase()) continue;
    types.add(objectType.split('/')[0].toUpperCase());
  }
  return [...types];
}

async function readObjectSource(client: Client, type: string, name: string): Promise<string> {
  const result = await callTool(client, 'SAPRead', { type, name });
  assertToolSuccess(result, `read ${type} ${name}`);
  return toolText(result);
}

async function assertSyncedFixturesActive(
  client: Client,
  summary: FixtureSyncSummary,
  verifiedActiveSources: ReadonlySet<string>,
): Promise<void> {
  const skippedLabels = new Set(summary.skipped.map((skip) => skip.label));
  const checkedFixtures = PERSISTENT_OBJECTS.filter((obj) => !skippedLabels.has(`${obj.type} ${obj.name}`));
  if (checkedFixtures.length === 0) return;

  let inactiveFixtures = await findInactiveFixtures(client, checkedFixtures);
  // Only wait-and-recheck if THIS run actually issued an activation that might
  // still be settling. If everything was already unchanged, an inactive fixture
  // is a durable problem — fail fast instead of paying a blind 5s.
  const issuedActivations = summary.created.length > 0 || summary.recreated.length > 0;
  if (inactiveFixtures.length > 0 && issuedActivations) {
    await delay(5000);
    inactiveFixtures = await findInactiveFixtures(client, checkedFixtures);
  }
  if (inactiveFixtures.length > 0) {
    const details = inactiveFixtures
      .map((obj) => {
        const suffix = [obj.transport ? `transport=${obj.transport}` : null, obj.deleted ? 'deleted=true' : null]
          .filter(Boolean)
          .join(', ');
        return `${obj.type} ${obj.name}${suffix ? ` (${suffix})` : ''}`;
      })
      .join(', ');
    throw new Error(`Persistent fixture activation incomplete; inactive fixtures remain: ${details}`);
  }

  for (const obj of checkedFixtures) {
    const label = `${obj.type} ${obj.name}`;
    if (verifiedActiveSources.has(label)) continue;
    await readObjectSource(client, obj.type, obj.name);
  }
}

async function findInactiveFixtures(client: Client, fixtures: readonly PersistentObject[]): Promise<InactiveFixture[]> {
  const result = await callTool(client, 'SAPRead', { type: 'INACTIVE_OBJECTS' });
  assertToolSuccess(result, 'read INACTIVE_OBJECTS');
  const parsed = parseInactiveObjectsPayload(toolText(result));
  return parsed.filter((inactive) =>
    fixtures.some(
      (fixture) =>
        inactive.name.toUpperCase() === fixture.name.toUpperCase() && inactiveTypeMatches(fixture.type, inactive.type),
    ),
  );
}

function parseInactiveObjectsPayload(text: string): InactiveFixture[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCachedPrefix(text));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`read INACTIVE_OBJECTS failed: invalid JSON response: ${message}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('read INACTIVE_OBJECTS failed: expected JSON object response');
  }

  const objects = (parsed as { objects?: unknown }).objects;
  if (!Array.isArray(objects)) {
    throw new Error('read INACTIVE_OBJECTS failed: expected objects array');
  }

  const inactive: InactiveFixture[] = [];
  for (const entry of objects) {
    if (!entry || typeof entry !== 'object') continue;
    const name = getString(entry, 'name');
    const type = getString(entry, 'type');
    if (!name || !type) continue;
    inactive.push({
      name,
      type,
      uri: getString(entry, 'uri') ?? undefined,
      transport: getString(entry, 'transport') ?? undefined,
      deleted: getBoolean(entry, 'deleted') ?? undefined,
    });
  }
  return inactive;
}

function inactiveTypeMatches(expectedType: string, inactiveType: string): boolean {
  return (inactiveType.split('/')[0] ?? inactiveType).toUpperCase() === expectedType.toUpperCase();
}

function assertToolSuccess(result: ToolResult, action: string): void {
  if (result.isError) {
    throw new Error(`${action} failed: ${toolText(result)}`);
  }
  if (!result.content?.length || !result.content[0]?.text) {
    throw new Error(`${action} failed: empty response`);
  }
}

function toolText(result: ToolResult): string {
  return result.content?.map((item) => item.text).join('\n') ?? '';
}

function stripCachedPrefix(text: string): string {
  return text.replace(/^\[cached(?::revalidated)?\]\n/, '');
}

function normalizeSource(source: string, type?: string): string {
  const normalized = stripCachedPrefix(source).replace(/\r\n/g, '\n').trimEnd();

  if (type?.toUpperCase() !== 'TABL') {
    return normalized;
  }

  return normalized
    .replace(/^define table\s+([^\s{]+)\s*\{/gim, (_match, name: string) => `define table ${name.toUpperCase()} {`)
    .split('\n')
    .map((line) => line.trimEnd().replace(/\s+:/g, ' :'))
    .filter((line) => line.trim().length > 0)
    .join('\n');
}

function getString(input: object, key: string): string | null {
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function getBoolean(input: object, key: string): boolean | null {
  const value = (input as Record<string, unknown>)[key];
  return typeof value === 'boolean' ? value : null;
}

/**
 * Check if an object exists on SAP via SAPSearch.
 * Retained for compatibility with older call sites.
 */
export async function objectExists(client: Client, query: string): Promise<boolean> {
  const types = await findExistingObjectTypes(client, query);
  return types.length > 0;
}
