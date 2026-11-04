/** Owned class fixtures verify native usages, independent of installed SAP example content. */
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest';
import { fetchDiscoveryDocument } from '../../src/adt/discovery.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { recordWhereUsed } from '../helpers/where-used-diagnostics.js';
import { generateUniqueName } from './crud-harness.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

describe('where-used filters and snippets — live (#1018)', () => {
  const client = getTestClient();
  const root = generateUniqueName('ZAR1018_ROOT');
  const consumer = generateUniqueName('ZAR1018_USE');
  const created: string[] = [];
  let activatedAt = 0;
  async function call(tool: string, args: Record<string, unknown>) {
    const result = await handleToolCall(client, DEFAULT_CONFIG, tool, args);
    if (result.isError) throw new Error(result.content[0]?.text ?? 'Tool failed');
    return result.content[0]!.text!;
  }
  beforeAll(async () => {
    requireSapCredentials();
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
      } catch (error) {
        failures.push(`${name}: ${String(error)}`);
      }
    }
    expect(failures, 'remove every owned where-used fixture').toEqual([]);
  });
  it('returns the consumer and component-relative native usages, respecting exact packages', async () => {
    const evidence = recordWhereUsed(client.http, { root, consumer, activatedAt });
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
