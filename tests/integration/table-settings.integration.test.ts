import { beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { fetchDiscoveryDocument } from '../../src/adt/discovery.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { generateUniqueName } from './crud-harness.js';
import { getTestClient } from './helpers.js';

describe('technical table settings through public dispatch', () => {
  let client: AdtClient;
  const config = { ...DEFAULT_CONFIG, allowWrites: true, allowedPackages: ['$TMP'] };
  beforeAll(async () => {
    client = getTestClient();
    client.safety.allowedPackages = ['$TMP'];
    client.http.setDiscoveryMap((await fetchDiscoveryDocument(client.http)).map);
  });
  async function call(tool: string, args: Record<string, unknown>): Promise<string> {
    const result = await handleToolCall(client, config, tool, args);
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    return result.content.map((c) => c.text ?? '').join('\n');
  }

  it('preserves pending fields and activates settings separately from the table', async (ctx) => {
    requireOrSkip(
      ctx,
      client.http.discoveryAcceptFor('/sap/bc/adt/ddic/db/settings'),
      `${SkipReason.BACKEND_UNSUPPORTED}: ADT technical settings collection absent`,
    );
    const name = generateUniqueName('ZARC1_TS');
    const tableUrl = `/sap/bc/adt/ddic/tables/${name.toLowerCase()}`;
    await call('SAPWrite', {
      action: 'create',
      type: 'TABL',
      name,
      package: '$TMP',
      description: 'ARC1 settings integration test',
      source: `@EndUserText.label : 'ARC1 settings test'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #A
@AbapCatalog.dataMaintenance : #RESTRICTED
define table ${name.toLowerCase()} {
 key client : abap.clnt not null;
 key id : abap.char(10) not null;
 status : abap.char(1);
}`,
    });
    ctx.onTestFinished(async () => {
      await call('SAPWrite', { action: 'delete', type: 'TABL', name });
      await expect(client.http.get(tableUrl)).rejects.toMatchObject({ statusCode: 404 });
      await expect(client.http.get(`/sap/bc/adt/ddic/db/settings/${name.toLowerCase()}`)).rejects.toMatchObject({
        statusCode: 404,
      });
    });
    const read = async () => JSON.parse(await call('SAPRead', { type: 'TABL/DTT', name }));
    const write = (patch: unknown) =>
      call('SAPWrite', { action: 'update', type: 'TABL/DTT', name, source: JSON.stringify(patch) });
    expect((await read()).version).toBe('new');
    expect(await write({ dataClass: 'APPL1' })).toContain('type="TABL"');
    const premature = await handleToolCall(client, config, 'SAPActivate', { type: 'TABL/DTT', name });
    expect(premature.isError).toBe(true);
    expect(premature.content[0]?.text).toContain('first activation');
    await call('SAPActivate', { type: 'TABL', name });
    expect((await read()).version).toBe('active');
    await write({ sizeCategory: 2 });
    expect(await write({ buffering: { allowed: 'X', type: 'G', areaKeyFields: 1 } })).toContain('entire draft');
    expect(await read()).toMatchObject({
      version: 'inactive',
      source: { dataClass: 'APPL1', sizeCategory: 2, buffering: { allowed: 'X', type: 'G', areaKeyFields: 1 } },
    });
    await call('SAPActivate', { type: 'TABL/DTT', name });
    expect((await read()).version).toBe('active');
    await write({ buffering: { allowed: 'N', type: '', areaKeyFields: 0 } });
    await call('SAPActivate', { objects: [{ type: 'TABL/DTT', name }] });
    expect(await read()).toMatchObject({
      version: 'active',
      source: { dataClass: 'APPL1', sizeCategory: 2, buffering: { allowed: 'N', type: '', areaKeyFields: 0 } },
    });
  }, 120_000);
});
