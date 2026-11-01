import { beforeAll, describe, expect, it, type TestContext } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { fetchDiscoveryDocument } from '../../src/adt/discovery.js';
import { AdtApiError } from '../../src/adt/errors.js';
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
    expect(client.http.hasDiscoveryData(), 'ADT discovery must succeed before capability checks').toBe(true);
  });
  async function call(tool: string, args: Record<string, unknown>): Promise<string> {
    const result = await handleToolCall(client, config, tool, args);
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    return result.content.map((c) => c.text ?? '').join('\n');
  }

  async function createTable(ctx: TestContext): Promise<string> {
    requireOrSkip(
      ctx,
      client.http.discoveryAcceptFor('/sap/bc/adt/ddic/db/settings'),
      `${SkipReason.BACKEND_UNSUPPORTED}: ADT technical settings collection absent`,
    );
    const name = generateUniqueName('ZATS');
    const tableUrl = `/sap/bc/adt/ddic/tables/${name.toLowerCase()}`;
    // Register before creation: a failed follow-up PUT can leave the owned table shell.
    ctx.onTestFinished(async () => {
      try {
        await client.http.get(tableUrl);
      } catch (error) {
        expect(error).toBeInstanceOf(AdtApiError);
        expect(error).toMatchObject({ statusCode: 404 });
        return;
      }
      await call('SAPWrite', { action: 'delete', type: 'TABL', name });
      await expect(client.http.get(tableUrl)).rejects.toMatchObject({ statusCode: 404 });
      await expect(client.http.get(`/sap/bc/adt/ddic/db/settings/${name.toLowerCase()}`)).rejects.toMatchObject({
        statusCode: 404,
      });
    });
    await call('SAPWrite', {
      action: 'create',
      type: 'TABL',
      name,
      package: '$TMP',
      description: 'ARC1 settings integration test',
      source: `@EndUserText.label : 'ARC1 settings test'
@AbapCatalog.enhancement.category : #NOT_EXTENSIBLE
@AbapCatalog.tableCategory : #TRANSPARENT
@AbapCatalog.deliveryClass : #C
@AbapCatalog.dataMaintenance : #RESTRICTED
define table ${name.toLowerCase()} {
 key client : abap.clnt not null;
 key id : abap.char(10) not null;
 status : abap.char(1);
}`,
    });
    return name;
  }

  it('preserves pending fields and activates settings separately from the table', async (ctx) => {
    const name = await createTable(ctx);
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

  it('enables and disables change logging, preserving other pending settings', async (ctx) => {
    const name = await createTable(ctx);
    await call('SAPActivate', { type: 'TABL', name });
    const read = async (version?: 'active') => JSON.parse(await call('SAPRead', { type: 'TABL/DTT', name, version }));
    const write = (patch: unknown) =>
      call('SAPWrite', { action: 'update', type: 'TABL/DTT', name, source: JSON.stringify(patch) });
    const initial = await read();
    expect(initial.source.loggingEnabled).toBe(false);
    await write({ loggingEnabled: true });
    expect(await read()).toMatchObject({ version: 'inactive', source: { ...initial.source, loggingEnabled: true } });
    expect((await read('active')).source.loggingEnabled).toBe(false);
    await write({ sizeCategory: 2 });
    await call('SAPActivate', { type: 'TABL/DTT', name });
    const enabled = await read();
    expect(enabled).toMatchObject({
      version: 'active',
      source: { ...initial.source, loggingEnabled: true, sizeCategory: 2 },
    });
    await write({ loggingEnabled: false });
    expect((await read('active')).source.loggingEnabled).toBe(true);
    await call('SAPActivate', { type: 'TABL/DTT', name });
    expect(await read()).toMatchObject({ version: 'active', source: { ...enabled.source, loggingEnabled: false } });
  }, 120_000);
});
