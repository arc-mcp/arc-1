/** Research branch only: preserve the original #1018 assertions and retain #1057 evidence. */
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest';
import { recordWhereUsed } from '../helpers/where-used-diagnostics.js';
import {
  call,
  checkTarget,
  cleanupPair,
  createOwned,
  MANIFEST,
  makeClient,
  PUBLIC_DIR,
  preparePair,
  readManifest,
  recordDescriptions,
  selectRetention,
  snapshotIndex,
  withReadDeadline,
  writeJson,
} from '../helpers/where-used-experiment.js';

describe('where-used retained-pair diagnosis (#1057)', () => {
  const state = readManifest();
  const pair = state.pairs.at(-1)!;
  const { root, consumer } = pair;
  const client = makeClient();
  const sources = [
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
  ] as const;
  // Vitest timeouts do not cancel an SAP request. afterAll waits for the actual operation.
  let pending: Promise<unknown> = Promise.resolve();
  let testFailed = false;
  beforeAll(() => {
    pending = (async () => {
      await checkTarget(client);
      await preparePair(client, state, pair);
      for (const [name, source] of sources) await createOwned(client, state, pair, name, source);
      pair.activatedAt = Date.now();
      writeJson(MANIFEST, state);
    })();
    return pending;
  }, 120_000);

  afterAll(async () => {
    await pending.catch(() => undefined);
    if (pair.outcome === 'setup') state.stop = 'setup';
    if (testFailed && pair.outcome === 'passed') pair.outcome = 'other-failure';
    if (pair.activatedAt) {
      try {
        await snapshotIndex(client, pair, 'original');
        pair.indexOk = true;
        await withReadDeadline(client, 15_000, async () => {
          const active = [];
          for (const [name, source] of sources) {
            const result = await client.getClass(name, undefined, { version: 'active' });
            const metadata = await client.http.get(`/sap/bc/adt/oo/classes/${name.toLowerCase()}`);
            const owner = /\b(?:\w+:)?(?:responsible|createdBy)="([^"]*)"/.exec(metadata.body)?.[1];
            const normalize = (value: string) => value.replace(/\s+/g, '').toUpperCase();
            active.push({
              name,
              sourceMatches: normalize(source) === normalize(result.source),
              metadataUserMatchesNativePreflight: owner === undefined ? null : owner === 'DEVELOPER',
            });
          }
          pair.activeSourcesMatch = active.every((row) => row.sourceMatches);
          writeJson(`${PUBLIC_DIR}/${root}-active.json`, { active });
          if (!pair.activeSourcesMatch) state.stop = 'setup';
        });
      } catch {
        pair.indexOk = false;
        state.stop = 'index';
      }
      selectRetention(state, pair);
    } else state.stop = 'setup';
    writeJson(MANIFEST, state);
    if (!pair.retain && !(await cleanupPair(client, state, pair))) state.stop = 'cleanup';
    writeJson(MANIFEST, state);
    expect(state.stop, 'diagnostic setup, snapshots and cleanup must succeed').toBeUndefined();
  }, 420_000);

  it('returns the consumer and component-relative native usages, respecting exact packages', () => {
    onTestFailed(() => {
      testFailed = true;
    });
    pending = (async () => {
      const args = { action: 'references', type: 'CLAS', name: root, objectType: 'CLAS' };
      const descriptions = recordDescriptions(client, root);
      const evidence = recordWhereUsed(client.http, {
        root,
        consumer,
        activatedAt: pair.activatedAt!,
        artifactPath: `${PUBLIC_DIR}/${root}-original.json`,
      });
      pair.outcome = 'other-failure';
      try {
        let ordinary: { references: { name: string; uri: string; packageName: string }[] };
        let objects: typeof ordinary;
        try {
          ordinary = JSON.parse(await call(client, 'SAPNavigate', args));
          evidence.recordResult('ordinary', ordinary);
          evidence.phase = 'scoped';
          objects = JSON.parse(await call(client, 'SAPNavigate', { ...args, packages: ['$TMP'] }));
          evidence.recordResult('scoped', objects);
        } finally {
          evidence.restore();
          descriptions.restore();
        }
        const uris = (rows: { uri: string }[]) => rows.map((row) => row.uri).sort();
        try {
          expect(uris(objects.references)).toEqual(
            uris(ordinary.references.filter((row: { packageName: string }) => row.packageName === '$TMP')),
          );
          expect(objects.references).toContainEqual(expect.objectContaining({ name: consumer }));
        } catch (error) {
          pair.outcome = 'ordinary-scoped-failure';
          throw error;
        }
        const detailed = JSON.parse(
          await call(client, 'SAPNavigate', { ...args, packages: ['$TMP'], detail: 'snippets' }),
        );
        expect(detailed.usageDetails.usages).toContainEqual(
          expect.objectContaining({ object: consumer, component: 'CALCULATE', snippet: expect.stringContaining(root) }),
        );
        expect(detailed.usageDetails.identifiersExpanded).toBeGreaterThan(0);
        expect(detailed.usageDetails.truncated).toBe(false);
        const empty = JSON.parse(await call(client, 'SAPNavigate', { ...args, packages: ['ZARC1018_ABSENT'] }));
        expect(empty.total).toBe(0);
        pair.outcome = 'passed';
      } finally {
        evidence.restore();
        descriptions.restore();
        evidence.writeFailure(); // Always preserve the same first three exchanges, including controls.
        writeJson(`${PUBLIC_DIR}/${root}-descriptions.json`, descriptions.descriptions);
        writeJson(`${PUBLIC_DIR}/${root}-capture-scope.json`, {
          originalCapture: 'ordinary and scoped object queries only',
          snippetsCaptured: false,
          outcome: pair.outcome,
        });
        writeJson(MANIFEST, state);
      }
    })();
    return pending;
  }, 90_000);
});
