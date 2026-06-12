import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  callTool,
  connectClient,
  expectToolError,
  expectToolSuccess,
  expectToolSuccessOrSkip,
  skipOnBatchCreateFailure,
  uniqueName,
} from './helpers.js';

function parsePossiblyCachedJson(text: string): any {
  return JSON.parse(text.replace(/^\[cached(?::revalidated)?\]\n/, ''));
}

describe('E2E DDIC metadata write tests', () => {
  let client: Client;

  beforeAll(async () => {
    client = await connectClient();
  });

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // best-effort-cleanup
    }
  });

  it('SAPWrite create DOMA with fixed values', async (ctx) => {
    const domainName = uniqueName('ZARC1_DOMA');

    const createResult = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'DOMA',
      name: domainName,
      package: '$TMP',
      dataType: 'CHAR',
      length: 1,
      fixedValues: [{ low: 'X', description: 'Test' }],
    });
    expectToolSuccessOrSkip(ctx, createResult);

    try {
      const readResult = await callTool(client, 'SAPRead', { type: 'DOMA', name: domainName });
      const text = expectToolSuccess(readResult);
      const domain = parsePossiblyCachedJson(text);
      expect(domain.name).toBe(domainName);
      expect(domain.dataType).toBe('CHAR');
    } finally {
      try {
        await callTool(client, 'SAPWrite', { action: 'delete', type: 'DOMA', name: domainName });
      } catch {
        // best-effort-cleanup
      }
    }
  });

  it('SAPWrite create DTEL (domain-based + predefined)', async (ctx) => {
    const domainName = uniqueName('ZARC1_DMD');
    const dtelDomain = uniqueName('ZARC1_DTD');
    const dtelPredef = uniqueName('ZARC1_DTP');

    const domaResult = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'DOMA',
      name: domainName,
      package: '$TMP',
      dataType: 'CHAR',
      length: 3,
    });
    // Skip the whole test if DOMA create isn't supported on this release —
    // DTEL needs it as a dependency.
    expectToolSuccessOrSkip(ctx, domaResult);

    try {
      const byDomain = await callTool(client, 'SAPWrite', {
        action: 'create',
        type: 'DTEL',
        name: dtelDomain,
        package: '$TMP',
        typeKind: 'domain',
        typeName: domainName,
        shortLabel: 'Ref',
      });
      expectToolSuccessOrSkip(ctx, byDomain);

      const byType = await callTool(client, 'SAPWrite', {
        action: 'create',
        type: 'DTEL',
        name: dtelPredef,
        package: '$TMP',
        typeKind: 'predefinedAbapType',
        dataType: 'CHAR',
        length: 20,
        shortLabel: 'Text',
      });
      expectToolSuccessOrSkip(ctx, byType);
    } finally {
      for (const [type, name] of [
        ['DTEL', dtelDomain],
        ['DTEL', dtelPredef],
        ['DOMA', domainName],
      ] as const) {
        try {
          await callTool(client, 'SAPWrite', { action: 'delete', type, name });
        } catch {
          // best-effort-cleanup
        }
      }
    }
  });

  it('SAPWrite update DOMA and verify via SAPRead', async (ctx) => {
    const domainName = uniqueName('ZARC1_UPD');

    const createResult = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'DOMA',
      name: domainName,
      package: '$TMP',
      dataType: 'CHAR',
      length: 1,
      fixedValues: [{ low: 'A', description: 'Active' }],
    });
    expectToolSuccessOrSkip(ctx, createResult);

    try {
      const updateResult = await callTool(client, 'SAPWrite', {
        action: 'update',
        type: 'DOMA',
        name: domainName,
        package: '$TMP',
        dataType: 'CHAR',
        length: 2,
        fixedValues: [
          { low: 'A', description: 'Active' },
          { low: 'I', description: 'Inactive' },
        ],
      });
      expectToolSuccessOrSkip(ctx, updateResult);

      const readResult = await callTool(client, 'SAPRead', { type: 'DOMA', name: domainName });
      const domain = parsePossiblyCachedJson(expectToolSuccess(readResult));
      expect(domain.length).toBe('000002');
      expect((domain.fixedValues ?? []).some((v: { low: string }) => v.low === 'I')).toBe(true);
    } finally {
      try {
        await callTool(client, 'SAPWrite', { action: 'delete', type: 'DOMA', name: domainName });
      } catch {
        // best-effort-cleanup
      }
    }
  });

  it('SAPWrite delete DOMA/DTEL removes objects', async (ctx) => {
    const domainName = uniqueName('ZARC1_DEL');
    const dtelName = uniqueName('ZARC1_DELD');

    const domaCreate = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'DOMA',
      name: domainName,
      package: '$TMP',
      dataType: 'CHAR',
      length: 1,
    });
    expectToolSuccessOrSkip(ctx, domaCreate);
    const dtelCreate = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'DTEL',
      name: dtelName,
      package: '$TMP',
      typeKind: 'domain',
      typeName: domainName,
      shortLabel: 'Del',
    });
    expectToolSuccessOrSkip(ctx, dtelCreate);

    const deleteDtel = await callTool(client, 'SAPWrite', { action: 'delete', type: 'DTEL', name: dtelName });
    expectToolSuccessOrSkip(ctx, deleteDtel);
    const deleteDomain = await callTool(client, 'SAPWrite', { action: 'delete', type: 'DOMA', name: domainName });
    expectToolSuccessOrSkip(ctx, deleteDomain);

    const readDtel = await callTool(client, 'SAPRead', { type: 'DTEL', name: dtelName });
    expectToolError(readDtel, dtelName);
    const readDomain = await callTool(client, 'SAPRead', { type: 'DOMA', name: domainName });
    expectToolError(readDomain, domainName);
  });

  it('SAPWrite rejects mixed-case object names on create', async () => {
    const result = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'DDLS',
      name: 'Zarc1_Mixed_Case',
      package: '$TMP',
      source: 'define view entity Zarc1_Mixed_Case as select from t000 { key mandt }',
    });
    expectToolError(result, 'uppercase');
  });

  it('SAPWrite batch_create supports DOMA + DTEL dependency chain', async (ctx) => {
    const domainName = uniqueName('ZARC1_BDOM');
    const dtelName = uniqueName('ZARC1_BDTL');

    const batchResult = await callTool(client, 'SAPWrite', {
      action: 'batch_create',
      package: '$TMP',
      objects: [
        {
          type: 'DOMA',
          name: domainName,
          dataType: 'CHAR',
          length: 1,
          fixedValues: [{ low: 'X', description: 'Batch' }],
        },
        {
          type: 'DTEL',
          name: dtelName,
          typeKind: 'domain',
          typeName: domainName,
          shortLabel: 'Batch',
        },
      ],
    });
    // batch_create aggregates per-object errors. The handler surfaces them as
    // either isError=true (with "Batch created 0/N") or isError=false (success
    // payload but same "Batch created 0/N" summary). Handle both.
    const batchText = expectToolSuccessOrSkip(ctx, batchResult);
    if (skipOnBatchCreateFailure(ctx, batchText)) return;

    try {
      const readDtel = await callTool(client, 'SAPRead', { type: 'DTEL', name: dtelName });
      const dtel = parsePossiblyCachedJson(expectToolSuccess(readDtel));
      expect(dtel.typeKind).toBe('domain');
      expect(dtel.typeName).toBe(domainName);
    } finally {
      try {
        await callTool(client, 'SAPWrite', { action: 'delete', type: 'DTEL', name: dtelName });
      } catch {
        // best-effort-cleanup
      }
      try {
        await callTool(client, 'SAPWrite', { action: 'delete', type: 'DOMA', name: domainName });
      } catch {
        // best-effort-cleanup
      }
    }
  });
});
