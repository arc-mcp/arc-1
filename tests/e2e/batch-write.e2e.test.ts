import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callTool, connectClient, expectToolSuccess, uniqueName } from './helpers.js';
import { bestEffortDelete } from './rap-write-helpers.js';

describe('E2E batch preflight and persisted outcomes', () => {
  let client: Client;
  beforeAll(async () => {
    client = await connectClient();
  });
  afterAll(async () => {
    await client?.close();
  });

  async function expectAbsent(name: string) {
    const result = await callTool(client, 'SAPSearch', { query: name });
    expect(expectToolSuccess(result)).toMatch(/^\[\]\s/);
  }

  it('rejects a later invalid entry without leaving the first object', async () => {
    const name = uniqueName('ZBPRE');
    const later = uniqueName('ZBLATE');
    try {
      const result = await callTool(client, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        objects: [
          { type: 'PROG', name, source: `REPORT ${name.toLowerCase()}.` },
          { type: 'PROG', name: later.toLowerCase() },
        ],
      });
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[1].text).batch).toMatchObject({ phase: 'preflight', created: 0 });
      await expectAbsent(name);
      await expectAbsent(later);
    } finally {
      await bestEffortDelete(client, 'PROG', name);
      await bestEffortDelete(client, 'PROG', later);
    }
  });

  it('reports the persisted draft when activation fails and skips the next create', async () => {
    const name = uniqueName('ZBFAIL');
    const later = uniqueName('ZBSKIP');
    try {
      const result = await callTool(client, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        lintBeforeWrite: false,
        objects: [
          { type: 'PROG', name, source: `REPORT ${name.toLowerCase()}.\nDATA value TYPE zarc1_missing_type_b14.` },
          { type: 'PROG', name: later, source: `REPORT ${later.toLowerCase()}.` },
        ],
      });
      expect(result.isError).toBe(true);
      const { batch } = JSON.parse(result.content[1].text);
      expect(batch).toMatchObject({ created: 1, completed: 0, failed: 1, skipped: 1 });
      expect(batch.results[0]).toMatchObject({ creation: 'confirmed', write: 'confirmed', activation: 'failed' });
      const read = await callTool(client, 'SAPRead', { type: 'PROG', name, version: 'inactive' });
      expect(expectToolSuccess(read).toLowerCase()).toContain('zarc1_missing_type_b14');
      await expectAbsent(later);
    } finally {
      await bestEffortDelete(client, 'PROG', name);
      await bestEffortDelete(client, 'PROG', later);
    }
  });

  it('creates dependent interfaces and activates their written sources together', async () => {
    const names = Array.from({ length: 3 }, () => uniqueName('ZIF_BATCH'));
    try {
      const result = await callTool(client, 'SAPWrite', {
        action: 'batch_create',
        package: '$TMP',
        activateAtEnd: true,
        lintBeforeWrite: false,
        objects: names.map((name, index) => ({
          type: 'INTF',
          name,
          source: `INTERFACE ${name.toLowerCase()} PUBLIC.\nTYPES value TYPE ${index === 0 ? 'i' : `${names[index - 1].toLowerCase()}=>value`}.\nENDINTERFACE.`,
        })),
      });
      expect(expectToolSuccess(result)).toContain('Batch created 3 objects');
      expect(result.content).toHaveLength(1);
      for (const [index, name] of names.entries()) {
        const read = await callTool(client, 'SAPRead', { type: 'INTF', name, version: 'active' });
        const source = expectToolSuccess(read).toLowerCase();
        expect(source).toContain('types value type');
        if (index > 0) expect(source).toContain(`${names[index - 1].toLowerCase()}=>value`);
      }
    } finally {
      for (const name of names.toReversed()) await bestEffortDelete(client, 'INTF', name);
    }
  });
});
