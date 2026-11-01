import { writeFileSync } from 'node:fs';
/** Owned class fixtures verify native usages, independent of installed SAP example content. */
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest';
import { fetchDiscoveryDocument } from '../../src/adt/discovery.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { recordWhereUsed } from '../helpers/where-used-diagnostics.js';
import { generateUniqueName } from './crud-harness.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

describe('where-used retained-failure diagnosis (#1057)', () => {
  const client = getTestClient();
  const root = generateUniqueName('ZAR1057_ROOT');
  const consumer = generateUniqueName('ZAR1057_USE');
  const created: string[] = [];
  const expectedSources = new Map<string, string>();
  let activatedAt = 0;
  async function call(tool: string, args: Record<string, unknown>) {
    const result = await handleToolCall(client, DEFAULT_CONFIG, tool, args);
    if (result.isError) throw new Error(result.content[0]?.text ?? 'Tool failed');
    return result.content[0]!.text!;
  }
  beforeAll(async () => {
    requireSapCredentials();
    const components = await client.getInstalledComponents();
    console.log(
      JSON.stringify({
        diagnosticTarget: {
          matchesLocalHost: new URL(process.env.TEST_SAP_URL!).hostname === 'a4h-2025.marianzeis.de',
          matchesLocalUser: process.env.TEST_SAP_USER === 'DEVELOPER',
          matchesLocalClient: process.env.TEST_SAP_CLIENT === '001',
          basis: components.filter((component) => component.name === 'SAP_BASIS'),
        },
      }),
    );
    client.http.setDiscoveryMap((await fetchDiscoveryDocument(client.http)).map);
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
      expectedSources.set(name!, source!);
      created.push(name!);
      await call('SAPWrite', { action: 'create', type: 'CLAS', name, package: '$TMP', source });
      await call('SAPActivate', { type: 'CLAS', name });
    }
    activatedAt = Date.now();
  });
  afterAll(async () => {
    const failures: string[] = [];
    for (const name of created.reverse()) {
      try {
        await call('SAPWrite', { action: 'delete', type: 'CLAS', name });
        await expect(client.http.get(`/sap/bc/adt/oo/classes/${name.toLowerCase()}`)).rejects.toMatchObject({
          statusCode: 404,
        });
      } catch (error) {
        failures.push(`${name}: ${String(error)}`);
      }
    }
    expect(failures, 'remove every owned where-used fixture').toEqual([]);
  });
  it('returns the consumer and component-relative native usages, respecting exact packages', async () => {
    const args = { action: 'references', type: 'CLAS', name: root, objectType: 'CLAS' };
    const evidence = recordWhereUsed(client.http, {
      root,
      consumer,
      activatedAt,
      artifactPath: `/tmp/arc1-1057-native-original-${root}.json`,
    });
    onTestFailed(async () => {
      evidence.writeFailure();
      const deadline = Date.now() + 20_000;
      const observations: Record<string, unknown>[] = [];
      const fresh = getTestClient();
      const restore: Array<() => void> = [];
      for (const api of [client, fresh]) {
        const get = api.http.get;
        const post = api.http.post;
        api.http.get = (path, headers, options) =>
          get.call(api.http, path, headers, {
            ...options,
            deadline: Math.min(options?.deadline ?? deadline, deadline),
          });
        api.http.post = (path, body, contentType, headers, options) =>
          post.call(api.http, path, body, contentType, headers, {
            ...options,
            deadline: Math.min(options?.deadline ?? deadline, deadline),
          });
        restore.push(() => {
          api.http.get = get;
          api.http.post = post;
        });
      }
      async function observe(phase: string, run: () => Promise<Record<string, unknown>>) {
        const startedMsAfterActivation = Date.now() - activatedAt;
        if (Date.now() >= deadline) {
          observations.push({ phase, skipped: 'deadline' });
          return;
        }
        try {
          const value = await run();
          observations.push({
            phase,
            startedMsAfterActivation,
            finishedMsAfterActivation: Date.now() - activatedAt,
            ...value,
          });
        } catch (error) {
          observations.push({
            phase,
            startedMsAfterActivation,
            errorType: error instanceof Error ? error.name : typeof error,
          });
        }
      }
      async function references(api: typeof client, scoped = false) {
        const result = await handleToolCall(api, DEFAULT_CONFIG, 'SAPNavigate', {
          ...args,
          ...(scoped ? { packages: ['$TMP'] } : {}),
        });
        if (result.isError) throw new Error('Diagnostic query failed');
        const rows: { name: string }[] = JSON.parse(result.content[0]!.text!).references;
        return { count: rows.length, consumerPresent: rows.some((row) => row.name === consumer) };
      }
      try {
        for (const name of [root, consumer])
          await observe(`active-${name === root ? 'root' : 'consumer'}`, async () => {
            const result = await client.getClass(name, undefined, { version: 'active' });
            const normalize = (value: string) => value.replace(/\s+/g, '').toUpperCase();
            return {
              sourceBytes: Buffer.byteLength(result.source),
              matchesExpectedSource: normalize(result.source) === normalize(expectedSources.get(name)!),
            };
          });
        await observe('ordinary-again', () => references(client));
        await observe('scoped-again', () => references(client, true));
        await observe('fresh-session-ordinary', () => references(fresh));
        const delay = Math.max(0, activatedAt + 10_000 - Date.now());
        if (delay && Date.now() + delay < deadline) await new Promise((resolve) => setTimeout(resolve, delay));
        await observe('later-ordinary', () => references(client));
      } finally {
        for (const reset of restore) reset();
        const path = `/tmp/arc1-1057-native-followup-${root}.json`;
        writeFileSync(path, JSON.stringify({ root, consumer, observations }, null, 2), { mode: 0o600 });
        console.log(JSON.stringify({ diagnosticFile: path, root, consumer }));
      }
    });
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
    }
    const uris = (rows: { uri: string }[]) => rows.map((row) => row.uri).sort();
    expect(uris(objects.references)).toEqual(
      uris(ordinary.references.filter((row: { packageName: string }) => row.packageName === '$TMP')),
    );
    expect(objects.references).toContainEqual(expect.objectContaining({ name: consumer }));
    const detailed = JSON.parse(await call('SAPNavigate', { ...args, packages: ['$TMP'], detail: 'snippets' }));
    expect(detailed.usageDetails.usages).toContainEqual(
      expect.objectContaining({ object: consumer, component: 'CALCULATE', snippet: expect.stringContaining(root) }),
    );
    expect(detailed.usageDetails.identifiersExpanded).toBeGreaterThan(0);
    expect(detailed.usageDetails.truncated).toBe(false);
    const empty = JSON.parse(await call('SAPNavigate', { ...args, packages: ['ZARC1018_ABSENT'] }));
    expect(empty.total).toBe(0);
  }, 90_000);
});
