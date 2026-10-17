import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError, AdtNetworkError, AdtResponseLimitError, AdtSafetyError } from '../../../src/adt/errors.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { withStoredTextSession } from '../../../src/adt/stored-text/source.js';
import type { StoredTextSource } from '../../../src/adt/stored-text/types.js';
import { getCurrentContext, requestContext } from '../../../src/server/context.js';

const key = { TDOBJECT: 'TEXT', TDNAME: '  Z_TEXT', TDID: 'ST', TDSPRAS: 'E' };
const header = () => ({
  MANDT: '001',
  ...key,
  TDTITLE: '  title  ',
  TDTEXTTYPE: ' ',
  TDTXTLINES: '1 ',
  TDVERSION: '00001',
  TDLDATE: '20261017',
  TDLTIME: '153000',
  TDREF: '',
  TDREFOBJ: '',
  TDREFNAME: '',
  TDREFID: '',
});
function setup() {
  const client = new AdtClient({
    baseUrl: 'https://sap.invalid',
    safety: { ...defaultSafetyConfig(), allowDataPreview: true },
  });
  const query = vi.spyOn(client, 'runTableQuery').mockResolvedValue({ columns: [], rows: [] });
  return { client, query };
}
const fixture = JSON.parse(readFileSync(new URL('../../fixtures/stxl/sap-758.json', import.meta.url), 'utf8')) as {
  cases: Array<{ compressed: string }>;
};
const bytes = Buffer.from(fixture.cases[8].compressed, 'base64');
const chunks = () =>
  Array.from({ length: Math.ceil(bytes.length / 7902) }, (_, index) => ({
    MANDT: '001 ',
    RELID: 'TX ',
    ...Object.fromEntries(Object.entries(key).map(([name, value]) => [name, `${value} `])),
    SRTF2: `${index} `,
    CLUSTR: `${Math.min(bytes.length - index * 7902, 7902)} `,
    CLUSTD: bytes
      .subarray(index * 7902, (index + 1) * 7902)
      .toString('hex')
      .padEnd(15804, '0'),
  }));

describe('stored-text ADT source', () => {
  it('shares the existing response ceiling across queries in a standalone session', async () => {
    const { client, query } = setup();
    const budgets = new Set();
    query.mockImplementation(async () => {
      const budget = getCurrentContext()!.dataResultScope!.responseBudget;
      expect(budget.limitBytes).toBe(2 * 1024 * 1024);
      budgets.add(budget);
      const reservation = budget.createReservation();
      reservation.add(1_200_000);
      reservation.commit();
      return { columns: [], rows: [] };
    });
    await expect(
      withStoredTextSession(client, '001', async (source) => {
        await source.readHeader(key);
        await source.readCluster(key);
      }),
    ).rejects.toBeInstanceOf(AdtResponseLimitError);
    expect(budgets.size).toBe(1);
  });
  it('uses one outer scope and preserves inherited context, signal, and lease ownership', async () => {
    const { client, query } = setup();
    const scope = client.createDataResultScope();
    const release = vi.spyOn(scope, 'release');
    const controller = new AbortController();
    await expect(
      requestContext.run({ requestId: 'REQ-test', signal: controller.signal, dataResultScope: scope }, async () => {
        await withStoredTextSession(client, '001', async (source) => {
          expect(getCurrentContext()?.dataResultScope).toBe(scope);
          expect(getCurrentContext()?.requestId).toBe('REQ-test');
          expect(getCurrentContext()?.signal).not.toBe(controller.signal);
          controller.abort();
          await expect(source.readHeader(key)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
        });
      }),
    ).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(query).not.toHaveBeenCalled();
    expect(release).not.toHaveBeenCalled();
    scope.release();
  });

  it('releases its own scope on failure and refuses retained sources after the session', async () => {
    const { client } = setup();
    const scope = client.createDataResultScope();
    const release = vi.spyOn(scope, 'release');
    vi.spyOn(client, 'createDataResultScope').mockReturnValue(scope);
    let retained: StoredTextSource | undefined;
    await expect(
      withStoredTextSession(client, '001', async (source) => {
        retained = source;
        throw new Error('caller failure');
      }),
    ).rejects.toThrow('caller failure');
    expect(release).toHaveBeenCalledOnce();
    await expect(retained!.readHeader(key)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('normalizes identity padding, preserves title/type metadata, and detects revisions', async () => {
    const { client, query } = setup();
    const row = header();
    row.TDNAME += '  ';
    query.mockResolvedValueOnce({ columns: [], rows: [row] });
    query.mockResolvedValueOnce({ columns: [], rows: [{ ...row, TDVERSION: '00002' }] });
    await withStoredTextSession(client, '001', async (source) => {
      const first = await source.readHeader(key);
      const second = await source.readHeader(key);
      expect(first).toMatchObject({ key, title: '  title  ', textType: ' ', storedLineCount: 1, version: 1 });
      expect(first?.revision).not.toBe(second?.revision);
    });
    expect(query.mock.calls.every(([, options]) => options?.preserveLiteralSpaces === true)).toBe(true);
  });

  it('classifies references only when flagged and preserves incomplete legacy references', async () => {
    const { client, query } = setup();
    const target = { TDREFOBJ: 'TEXT ', TDREFNAME: 'TARGET ', TDREFID: 'ST ' };
    query.mockResolvedValueOnce({ columns: [], rows: [{ ...header(), ...target, TDREF: '' }] });
    query.mockResolvedValueOnce({ columns: [], rows: [{ ...header(), ...target, TDREF: 'X ' }] });
    query.mockResolvedValueOnce({ columns: [], rows: [{ ...header(), TDREF: 'X' }] });
    await withStoredTextSession(client, '001', async (source) => {
      expect((await source.readHeader(key))?.reference).toBeUndefined();
      expect((await source.readHeader(key))?.reference).toEqual({ ...key, TDNAME: 'TARGET' });
      expect(await source.readHeader(key)).toMatchObject({ legacyReference: true, reference: undefined });
    });
  });

  it('fails closed on duplicate, mixed-client, malformed counts, and absent header metadata', async () => {
    for (const rows of [
      [header(), header()],
      [{ ...header(), MANDT: '002' }],
      [{ ...header(), TDTXTLINES: '1x' }],
      [{ ...header(), TDTEXTTYPE: undefined }],
    ]) {
      const { client, query } = setup();
      query.mockResolvedValue({ columns: [], rows: rows as ReturnType<typeof header>[] });
      await expect(withStoredTextSession(client, '001', (source) => source.readHeader(key))).rejects.toMatchObject({
        code: 'CORRUPT_CLUSTER',
      });
    }
  });

  it('assembles multiple bounded windows, preserving binary data and trimming identity padding only', async () => {
    const { client, query } = setup();
    const rows = chunks();
    query.mockResolvedValueOnce({ columns: [], rows: rows.slice(0, 32).reverse() });
    query.mockResolvedValueOnce({ columns: [], rows: rows.slice(32).reverse() });
    expect(await withStoredTextSession(client, '001', (source) => source.readCluster(key))).toEqual(bytes);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][1]).toMatchObject({
      maxRows: 33,
      preserveLiteralSpaces: true,
      where: expect.arrayContaining([{ field: 'SRTF2', op: '>=', value: '32' }]),
    });
  });

  it('returns undefined only for a missing first window and rejects gaps/truncated cells', async () => {
    const { client, query } = setup();
    expect(await withStoredTextSession(client, '001', (source) => source.readCluster(key))).toBeUndefined();
    query.mockResolvedValue({ columns: [], rows: chunks().slice(1, 3) });
    await expect(withStoredTextSession(client, '001', (source) => source.readCluster(key))).rejects.toMatchObject({
      code: 'CORRUPT_CLUSTER',
    });
    query.mockResolvedValue({ columns: [], rows: [{ ...chunks()[0], CLUSTD: '00' }] });
    await expect(withStoredTextSession(client, '001', (source) => source.readCluster(key))).rejects.toMatchObject({
      code: 'CORRUPT_CLUSTER',
    });
  });

  it('caches configuration within a session and honors the ID handler override', async () => {
    const { client, query } = setup();
    query.mockImplementation(async (table) => ({
      columns: [],
      rows:
        table === 'TTXOB'
          ? [{ TDOBJECT: 'TEXT', HANDLER_CLASS: 'Z_OBJECT_CUSTOM' }]
          : table === 'TTXID'
            ? [{ TDOBJECT: 'TEXT', TDID: 'ST', HANDLER_CLASS: 'CL_RSTXT_DEFAULT_PERSISTENCE ' }]
            : [{ SPRAS: 'E' }],
    }));
    await withStoredTextSession(client, '001', async (source) => {
      await source.assertSupportedKey(key);
      await source.assertSupportedKey({ ...key, TDNAME: 'ANOTHER' });
    });
    expect(query).toHaveBeenCalledTimes(3);
    await withStoredTextSession(client, '001', (source) => source.assertSupportedKey(key));
    expect(query).toHaveBeenCalledTimes(6);
  });

  it('rejects unknown configuration, missing handler metadata, and custom persistence', async () => {
    for (const objectRows of [[], [{ TDOBJECT: 'TEXT' }], [{ TDOBJECT: 'TEXT', HANDLER_CLASS: 'Z_CUSTOM' }]]) {
      const { client, query } = setup();
      query.mockImplementation(async (table) => ({
        columns: [],
        rows:
          table === 'TTXOB'
            ? objectRows
            : table === 'TTXID'
              ? [{ TDOBJECT: 'TEXT', TDID: 'ST', HANDLER_CLASS: '' }]
              : [{ SPRAS: 'E' }],
      }));
      await expect(
        withStoredTextSession(client, '001', (source) => source.assertSupportedKey(key)),
      ).rejects.toMatchObject({ code: objectRows.length === 0 ? 'INVALID_KEY' : 'UNSUPPORTED_PERSISTENCE' });
    }
  });

  it('discovers literal prefixes with bounded extra-row detection and sorted keys', async () => {
    const { client, query } = setup();
    query.mockResolvedValue({ columns: [], rows: ['Z_%B', 'Z_%A', 'Z_%C'].map((TDNAME) => ({ ...header(), TDNAME })) });
    const result = await withStoredTextSession(client, '001', (source) =>
      source.discover({ object: 'TEXT', namePrefix: 'Z_%', limit: 2 }),
    );
    expect(result.headers.map(({ key: found }) => found.TDNAME)).toEqual(['Z_%A', 'Z_%B']);
    expect(result.more).toBe(true);
    expect(query).toHaveBeenCalledWith(
      'STXH',
      expect.objectContaining({
        maxRows: 3,
        where: [
          { field: 'TDOBJECT', op: '=', value: 'TEXT' },
          { field: 'TDNAME', op: 'STARTS_WITH', value: 'Z_%' },
        ],
      }),
    );
  });

  it('preserves a spaces-only discovery prefix without treating it as an empty text key', async () => {
    const { client, query } = setup();
    await withStoredTextSession(client, '001', (source) => source.discover({ object: 'TEXT', namePrefix: '  ' }));
    expect(query.mock.calls[0][1]?.where).toContainEqual({ field: 'TDNAME', op: 'STARTS_WITH', value: '  ' });
  });

  it('validates caller values before any SAP query and bounds total session requests', async () => {
    const { client, query } = setup();
    await expect(withStoredTextSession(client, 'bad', async () => undefined)).rejects.toMatchObject({
      code: 'INVALID_KEY',
    });
    await withStoredTextSession(client, '001', async (source) => {
      await expect(source.readHeader({ ...key, TDNAME: '' })).rejects.toMatchObject({ code: 'INVALID_KEY' });
      await expect(source.discover({ object: 'TEXT', namePrefix: 'Z', limit: 51 })).rejects.toMatchObject({
        code: 'INVALID_KEY',
      });
      expect(query).not.toHaveBeenCalled();
      for (let index = 0; index < 120; index++) await source.readHeader(key);
      await expect(source.readHeader(key)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
    });
    expect(query).toHaveBeenCalledTimes(120);
  });

  it('preserves typed infrastructure/policy errors and sanitizes unknown query failures', async () => {
    const { client, query } = setup();
    for (const error of [
      new AdtSafetyError('blocked'),
      new AdtApiError('denied', 403, '/test'),
      new AdtNetworkError('connection failed without cancellation'),
    ]) {
      query.mockRejectedValue(error);
      await expect(withStoredTextSession(client, '001', (source) => source.readHeader(key))).rejects.toBe(error);
    }
    query.mockRejectedValue(new Error('private SAP response'));
    const result = withStoredTextSession(client, '001', (source) => source.readHeader(key));
    await expect(result).rejects.toBeInstanceOf(AdtNetworkError);
    await expect(result).rejects.toThrow('stored-text query failed');
    await expect(result).rejects.not.toThrow('private SAP response');
  });

  it('retains the real data-preview safety gate before network access', async () => {
    const client = new AdtClient({ baseUrl: 'https://sap.invalid', safety: defaultSafetyConfig() });
    const post = vi.spyOn(client.http, 'post');
    await expect(withStoredTextSession(client, '001', (source) => source.readHeader(key))).rejects.toBeInstanceOf(
      AdtSafetyError,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it.each(['STXH', 'STXL'])('retains the %s source blocklist before network access', async (table) => {
    const client = new AdtClient({
      baseUrl: 'https://sap.invalid',
      safety: {
        ...defaultSafetyConfig(),
        allowDataPreview: true,
        blockedDataSources: [table],
      },
    });
    const post = vi.spyOn(client.http, 'post');
    const get = vi.spyOn(client.http, 'get');
    await expect(
      withStoredTextSession(client, '001', async (source) =>
        table === 'STXH' ? await source.readHeader(key) : await source.readCluster(key),
      ),
    ).rejects.toMatchObject({ code: 'DATA_SOURCE_BLOCKED' });
    expect(post).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });
});
