import { beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { fetchDiscoveryDocument } from '../../src/adt/discovery.js';
import { AdtApiError } from '../../src/adt/errors.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { generateUniqueName } from './crud-harness.js';
import { getTestClient } from './helpers.js';

describe('classic secondary indexes through public dispatch', () => {
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

  it('lists, reads, updates, activates and deletes an index', async (ctx) => {
    requireOrSkip(
      ctx,
      client.http.discoveryAcceptFor('/sap/bc/adt/ddic/db/indexes'),
      `${SkipReason.BACKEND_UNSUPPORTED}: ADT index collection absent`,
    );
    const name = generateUniqueName('ZATI');
    const tableUrl = `/sap/bc/adt/ddic/tables/${name.toLowerCase()}`;
    const indexName = `${name}~001`;
    const indexArgs = { type: 'TABL/DTI', name: indexName };
    const indexUrl = `/sap/bc/adt/ddic/db/indexes/${indexName.toLowerCase()}`;
    // Register before creation, including a table/index shell left by a failed follow-up PUT.
    ctx.onTestFinished(async () => {
      try {
        await client.http.get(tableUrl);
      } catch (error) {
        expect(error).toBeInstanceOf(AdtApiError);
        expect(error).toMatchObject({ statusCode: 404 });
        return;
      }
      let indexExists = false;
      try {
        await client.http.get(indexUrl, { Accept: 'application/vnd.sap.adt.blues.v1+xml' });
        indexExists = true;
      } catch (error) {
        expect(error).toBeInstanceOf(AdtApiError);
        expect(error).toMatchObject({ statusCode: 404 });
      }
      if (indexExists) await call('SAPWrite', { action: 'delete', ...indexArgs });
      await call('SAPWrite', { action: 'delete', type: 'TABL', name });
      await expect(client.http.get(tableUrl)).rejects.toMatchObject({ statusCode: 404 });
      await expect(client.http.get(indexUrl, { Accept: 'application/vnd.sap.adt.blues.v1+xml' })).rejects.toMatchObject(
        { statusCode: 404 },
      );
    });
    await call('SAPWrite', {
      action: 'create',
      type: 'TABL',
      name,
      package: '$TMP',
      description: 'ARC1 index integration test',
      source: `@EndUserText.label : 'ARC1 index test'
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
    await call('SAPActivate', { type: 'TABL', name });
    const list = async () => JSON.parse(await call('SAPRead', { type: 'TABL', name, include: 'indexes' }));
    expect(await list()).toEqual([]);
    const source = {
      formatVersion: '1',
      header: { description: 'ARC1 index test', originalLanguage: 'en' },
      uniqueIndex: false,
      bufferIndexOnly: false,
      textIndex: false,
      indexFields: [{ fieldName: 'CLIENT' }, { fieldName: 'STATUS' }],
    };
    await call('SAPWrite', { action: 'create', ...indexArgs, source: JSON.stringify(source) });
    expect(await list()).toEqual([expect.objectContaining({ name: indexName, index: '001' })]);
    await call('SAPActivate', indexArgs);
    const read = async () => JSON.parse(await call('SAPRead', indexArgs));
    expect(await read()).toMatchObject({ version: 'active', source: { indexFields: source.indexFields } });
    source.indexFields.push({ fieldName: 'ID' });
    await call('SAPWrite', { action: 'update', ...indexArgs, source: JSON.stringify(source) });
    const pending = await read();
    expect(['new', 'inactive']).toContain(pending.version);
    expect(pending.source.indexFields).toEqual(source.indexFields);
    await call('SAPActivate', { objects: [indexArgs] });
    expect((await read()).version).toBe('active');
    await call('SAPWrite', { action: 'delete', ...indexArgs });
    expect(await list()).toEqual([]);
  }, 120_000);
});
