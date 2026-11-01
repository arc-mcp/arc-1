/** Owned class fixtures verify native usages, independent of installed SAP example content. */
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { recordWhereUsed } from '../helpers/where-used-diagnostics.js';
import {
  captureReferenceFailure,
  checkTarget,
  cleanupPair,
  createOwned,
  MANIFEST,
  PUBLIC_DIR,
  preparePair,
  readManifest,
  recordDescriptions,
  recordError,
  registerPair,
  snapshotPair,
  writeJson,
} from '../helpers/where-used-experiment.js';
import { generateUniqueName } from './crud-harness.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

describe('where-used filters and snippets — live (#1018)', () => {
  const client = getTestClient();
  const root = generateUniqueName('ZAR1018_ROOT');
  const consumer = generateUniqueName('ZAR1018_USE');
  const state = readManifest();
  const pair = registerPair(state, root, consumer);
  const writes = client.withSafety({ ...client.safety, allowedPackages: ['$TMP'] });
  const sources: [string, string][] = [];
  // A Vitest timeout does not cancel an SAP request; settle it before cleanup.
  let pending: Promise<unknown> = Promise.resolve();
  let testFailed = false;
  let activatedAt = 0;
  async function call(tool: string, args: Record<string, unknown>) {
    const result = await handleToolCall(client, DEFAULT_CONFIG, tool, args);
    if (result.isError) throw new Error(result.content[0]?.text ?? 'Tool failed');
    return result.content[0]!.text!;
  }
  beforeAll(
    () =>
      (pending = (async () => {
        requireSapCredentials();
        await checkTarget(client);
        await preparePair(client, state, pair);
        for (const [name, source] of [
          [
            root,
            `CLASS ${root} DEFINITION PUBLIC FINAL CREATE PUBLIC. PUBLIC SECTION. CONSTANTS marker TYPE i VALUE 1. ENDCLASS. CLASS ${root} IMPLEMENTATION. ENDCLASS.`,
          ],
          [
            consumer,
            `CLASS ${consumer} DEFINITION PUBLIC FINAL CREATE PUBLIC. PUBLIC SECTION. CLASS-METHODS calculate RETURNING VALUE(result) TYPE i. ENDCLASS.
CLASS ${consumer} IMPLEMENTATION.
 METHOD calculate.
 DATA instance TYPE REF TO ${root}.
 CREATE OBJECT instance.
 result = ${root}=>marker.
 ENDMETHOD.
ENDCLASS.`,
          ],
        ]) {
          expect(await client.searchObject(name!, 5)).toEqual([]);
          sources.push([name!, source!]);
          await createOwned(writes, state, pair, name!, source!);
        }
        activatedAt = Date.now();
        pair.activatedAt = activatedAt;
        writeJson(MANIFEST, state);
      })().catch((error) => {
        recordError(state, 'setup', error);
        throw error;
      })),
    120_000,
  );
  afterAll(async () => {
    await pending.catch(() => undefined);
    if (pair.outcome === 'setup') state.stop = 'setup';
    if (testFailed && pair.outcome === 'passed') pair.outcome = 'other-failure';
    if (pair.outcome === 'passed') await snapshotPair(client, state, pair, sources);
    if (!pair.retain && !(await cleanupPair(writes, state, pair, 60_000))) state.stop = 'cleanup';
    writeJson(MANIFEST, state);
    expect(state.stop, 'diagnostic setup, snapshots and cleanup must succeed').toBeUndefined();
  }, 120_000);
  it(
    'returns the consumer and component-relative native usages, respecting exact packages',
    () =>
      (pending = (async () => {
        const testStartedAt = Date.now();
        pair.outcome = 'other-failure';
        writeJson(MANIFEST, state);
        onTestFailed(() => {
          testFailed = true;
        });
        const descriptions = recordDescriptions(client, root);
        const evidence = recordWhereUsed(client.http, {
          root,
          consumer,
          activatedAt,
          artifactPath: `${PUBLIC_DIR}/${root}-original.json`,
        });
        onTestFailed(() => evidence.writeFailure());
        const args = { action: 'references', type: 'CLAS', name: root, objectType: 'CLAS' };
        let ordinary: { references: { name: string; uri: string; packageName: string }[] };
        let objects: typeof ordinary;
        try {
          ordinary = JSON.parse(await call('SAPNavigate', args));
          evidence.recordResult('ordinary', ordinary);
          evidence.phase = 'scoped';
          objects = JSON.parse(await call('SAPNavigate', { ...args, packages: ['$TMP'] }));
          evidence.recordResult('scoped', objects);
        } finally {
          evidence.restore();
          descriptions.restore();
          evidence.writeFailure();
          writeJson(`${PUBLIC_DIR}/${root}-descriptions.json`, descriptions.descriptions);
        }
        const uris = (rows: { uri: string }[]) => rows.map((row) => row.uri).sort();
        try {
          expect(uris(objects.references)).toEqual(
            uris(ordinary.references.filter((row: { packageName: string }) => row.packageName === '$TMP')),
          );
          expect(objects.references).toContainEqual(expect.objectContaining({ name: consumer }));
        } catch (error) {
          if (testFailed) throw error;
          await captureReferenceFailure(client, state, pair, sources, error, testStartedAt);
        }
        const detailed = JSON.parse(await call('SAPNavigate', { ...args, packages: ['$TMP'], detail: 'snippets' }));
        expect(detailed.usageDetails.usages).toContainEqual(
          expect.objectContaining({ object: consumer, component: 'CALCULATE', snippet: expect.stringContaining(root) }),
        );
        expect(detailed.usageDetails.identifiersExpanded).toBeGreaterThan(0);
        expect(detailed.usageDetails.truncated).toBe(false);
        const empty = JSON.parse(await call('SAPNavigate', { ...args, packages: ['ZARC1018_ABSENT'] }));
        expect(empty.total).toBe(0);
        pair.outcome = 'passed';
        writeJson(MANIFEST, state);
      })()),
    90_000,
  );
});
