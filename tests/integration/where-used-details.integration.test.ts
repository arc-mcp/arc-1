/** Read contract on established fixtures; fresh-activation visibility is diagnosed separately (#1057). */
import { describe, expect, it } from 'vitest';
import { fetchDiscoveryDocument } from '../../src/adt/discovery.js';
import { defaultSafetyConfig } from '../../src/adt/safety.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { readFixture } from '../e2e/fixtures.js';
import { getTestClient } from './helpers.js';

describe('where-used filters and snippets — persistent read contract (#1057)', () => {
  it('returns the known consumer and component-relative native usages, respecting exact packages', async () => {
    // Native read coverage: writes and SQL/data-preview implementer enrichment are disabled.
    const client = getTestClient().withSafety(defaultSafetyConfig());
    const root = 'ZIF_ARC1_TEST';
    const consumer = 'ZCL_ARC1_TEST';
    // This is a required CI prerequisite: validate inside the test and fail, never requireOrSkip.
    const normalize = (source: string) => source.replace(/\r\n/g, '\n').trimEnd();
    expect((await client.getClassMetadata(consumer)).package).toBe('$TMP');
    expect(normalize((await client.getInterface(root, { version: 'active' })).source)).toBe(
      normalize(readFixture('zif_arc1_test.intf.abap')),
    );
    expect(normalize((await client.getClass(consumer, undefined, { version: 'active' })).source)).toBe(
      normalize(readFixture('zcl_arc1_test.clas.abap')),
    );
    client.http.setDiscoveryMap((await fetchDiscoveryDocument(client.http)).map);
    async function call(args: Record<string, unknown>) {
      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPNavigate', args);
      if (result.isError) throw new Error(result.content[0]?.text ?? 'Tool failed');
      return JSON.parse(result.content[0]!.text!);
    }
    const args = { action: 'references', type: 'INTF', name: root, objectType: 'CLAS' };
    const ordinary = await call(args);
    const objects = await call({ ...args, packages: ['$TMP'] });
    expect(ordinary.warning).toBeUndefined();
    expect(objects.warning).toBeUndefined();
    const uris = (rows: { uri: string }[]) => rows.map((row) => row.uri).sort();
    expect(uris(objects.references)).toEqual(
      uris(ordinary.references.filter((row: { packageName: string }) => row.packageName === '$TMP')),
    );
    expect(objects.references).toContainEqual(expect.objectContaining({ name: consumer }));
    const detailed = await call({ ...args, packages: ['$TMP'], detail: 'snippets' });
    expect(detailed.usageDetails.usages).toContainEqual(
      expect.objectContaining({
        object: consumer,
        component: 'ZIF_ARC1_TEST~DO_SOMETHING',
        line: 1,
        snippet: expect.stringMatching(/zif_arc1_test/i),
      }),
    );
    expect(detailed.warning).toBeUndefined();
    expect(detailed.usageDetails.identifiersExpanded).toBeGreaterThan(0);
    expect(detailed.usageDetails.identifiersWithoutUsages).toBe(0);
    expect(detailed.usageDetails.truncated).toBe(false);
    const empty = await call({ ...args, packages: ['ZARC1018_ABSENT'] });
    expect(empty.total).toBe(0);
  }, 90_000);
});
