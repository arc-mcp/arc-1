import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import {
  discoverStoredTexts,
  readStoredText,
  readStoredTextBatch,
  searchStoredTexts,
} from '../../../src/adt/stored-text/index.js';

const key = { TDOBJECT: 'TEXT', TDNAME: 'Z_EXAMPLE', TDID: 'ST', TDSPRAS: 'E' };
const fixtures = JSON.parse(readFileSync(new URL('../../fixtures/stxl/sap-758.json', import.meta.url), 'utf8')) as {
  cases: Array<{ compressed: string }>;
};
const bytes = Buffer.from(fixtures.cases[2].compressed, 'base64');
const header = {
  MANDT: '001',
  ...key,
  TDTITLE: '',
  TDTEXTTYPE: '',
  TDTXTLINES: '1',
  TDVERSION: '0',
  TDLDATE: '20261017',
  TDLTIME: '120000',
  TDREF: '',
  TDREFOBJ: '',
  TDREFNAME: '',
  TDREFID: '',
};

function clientWithStoredText(sapClient = '001') {
  const client = new AdtClient({ baseUrl: 'https://sap.invalid', client: sapClient });
  const query = vi.spyOn(client, 'runTableQuery').mockImplementation(async (table, options) => {
    const name = options?.where?.find(({ field }) => field === 'TDNAME')?.value;
    const rows =
      table === 'TTXOB'
        ? [{ TDOBJECT: 'TEXT', HANDLER_CLASS: '' }]
        : table === 'TTXID'
          ? [{ TDOBJECT: 'TEXT', TDID: 'ST', HANDLER_CLASS: '' }]
          : table === 'T002'
            ? [{ SPRAS: 'E' }]
            : name !== key.TDNAME
              ? []
              : table === 'STXH'
                ? [header]
                : [
                    {
                      MANDT: '001',
                      RELID: 'TX',
                      ...key,
                      SRTF2: '0',
                      CLUSTR: String(bytes.length),
                      CLUSTD: bytes.toString('hex').padEnd(15804, '0'),
                    },
                  ];
    return { columns: [], rows };
  });
  return { client, query };
}

describe('stored-text production API', () => {
  it('reads an exact stored key using the selected client identity and exposes ITF lines', async () => {
    const { client } = clientWithStoredText();
    const result = await readStoredText(client, key);
    expect(result).toMatchObject({
      requestedKey: key,
      resolvedKey: key,
      lineCount: 1,
      storage: { kind: 'classic-stxh-stxl', consistency: 'reread-matched', snapshotGuaranteed: false },
    });
    expect(result).not.toHaveProperty('bytes');
    const other = clientWithStoredText('002');
    await expect(readStoredText(other.client, key)).rejects.toMatchObject({ code: 'CORRUPT_CLUSTER' });
  });

  it('preserves batch partial successes, duplicates, and supplied-batch search', async () => {
    const { client } = clientWithStoredText();
    const inputs = [key, { ...key, TDNAME: 'MISSING' }, key];
    const result = await readStoredTextBatch(client, inputs);
    expect(result.map(({ status }) => status)).toEqual(['ok', 'error', 'ok']);
    expect(result[1]).toMatchObject({ error: { code: 'NOT_FOUND' } });
    if (result[0].status !== 'ok') throw new Error('expected stored fixture');
    const search = await searchStoredTexts(client, inputs, result[0].text.lines[0].text);
    expect(search).toMatchObject({ requested: 3, succeeded: 2, scope: 'supplied-batch-only', truncated: false });
    expect(search.matches.map(({ index }) => index)).toEqual([0, 2]);
    expect(search.errors).toHaveLength(1);
  });

  it('passes literal discovery prefixes and rejects invalid phrases before querying', async () => {
    const { client, query } = clientWithStoredText();
    query.mockResolvedValue({ columns: [], rows: [header] });
    expect((await discoverStoredTexts(client, { object: 'TEXT', namePrefix: 'Z_' })).headers).toHaveLength(1);
    expect(query.mock.calls[0][1]?.where).toContainEqual({ field: 'TDNAME', op: 'STARTS_WITH', value: 'Z_' });
    query.mockClear();
    expect(() => searchStoredTexts(client, [key], '')).toThrow('search phrase');
    expect(query).not.toHaveBeenCalled();
  });
});
