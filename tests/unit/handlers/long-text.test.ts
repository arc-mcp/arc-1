import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { throwIfRequestCancelled } from '../../../src/adt/http-deadline.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { LONG_TEXT_PROPERTY, LongTextInputSchema } from '../../../src/handlers/long-text-input.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { createLongTextFixture, type FixtureTextKey } from '../../helpers/long-text-fixture.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { getToolDefinitions } = await import('../../../src/handlers/tools.js');
const { filterToolsByAuthScope } = await import('../../../src/server/server.js');
const { getCurrentContext, requestContext } = await import('../../../src/server/context.js');

type Item = {
  index: number;
  status: string;
  key: FixtureTextKey;
  lineCount?: number;
  lines?: Array<{ format: string; text: string }>;
  error?: { code: string };
};
type Payload = {
  mode: string;
  scope: string;
  items: Item[];
  candidates: Array<{ key: FixtureTextKey; textType: string }>;
  more: boolean;
  nextStep: string;
  errors: Item[];
  matches: Array<{ key: FixtureTextKey; text: string; format: string; lineNumber: number }>;
  requested: number;
  succeeded: number;
  truncated: boolean;
  caseSensitive: boolean;
};
const config = {
  ...DEFAULT_CONFIG,
  systemType: 'onprem' as const,
  allowDataPreview: true,
  allowWrites: false,
  allowFreeSQL: false,
};
const auth = (scopes: string[]) => ({ token: 'test', clientId: 'test', scopes, expiresAt: 9_999_999_999 });
const readArgs = (keys: FixtureTextKey[]) => ({ action: 'long_text', longText: { mode: 'read', keys } });
function setup(safety = { ...defaultSafetyConfig(), allowDataPreview: true }) {
  const fixture = createLongTextFixture();
  const client = new AdtClient({ baseUrl: 'https://sap.invalid', client: '001', safety });
  const originalQuery = client.runTableQuery.bind(client);
  const query = vi.spyOn(client, 'runTableQuery').mockImplementation(fixture.query);
  return { client, fixture, query, originalQuery };
}
async function payload(result: Awaited<ReturnType<typeof handleToolCall>>) {
  expect(result.isError).not.toBe(true);
  return JSON.parse(result.content[0]!.text) as Payload;
}

beforeEach(() => {
  vi.resetAllMocks();
  resetCachedFeatures();
});
afterEach(() => {
  vi.restoreAllMocks();
  resetCachedFeatures();
});

describe('SAPQuery long_text nested input contract', () => {
  const key = { object: 'TEXT', name: '  ZÄ  Hinweis', id: 'ST', language: 'E' };
  it('keeps nested wire properties, key requirements, modes and limits aligned with runtime validation', () => {
    const shape = LongTextInputSchema.out.shape;
    expect(Object.keys(LONG_TEXT_PROPERTY.properties).sort()).toEqual(Object.keys(shape).sort());
    expect(LONG_TEXT_PROPERTY.properties.mode.enum).toEqual(shape.mode.options);
    const wireKey = LONG_TEXT_PROPERTY.properties.keys.items;
    expect(Object.keys(wireKey.properties).sort()).toEqual(Object.keys(shape.keys.unwrap().element.shape).sort());
    expect(wireKey.required.toSorted()).toEqual(Object.keys(wireKey.properties).sort());
    for (const [field, property] of Object.entries(wireKey.properties)) {
      const read = (value: string) => ({ mode: 'read', keys: [{ ...key, [field]: value }] });
      expect(LongTextInputSchema.safeParse(read('X'.repeat(property.maxLength))).success).toBe(true);
      expect(LongTextInputSchema.safeParse(read('X'.repeat(property.maxLength + 1))).success).toBe(false);
      expect(LongTextInputSchema.safeParse(read('')).success).toBe(false);
      const missing = { ...key } as Record<string, string>;
      delete missing[field];
      expect(LongTextInputSchema.safeParse({ mode: 'read', keys: [missing] }).success).toBe(false);
    }
    const { maxItems } = LONG_TEXT_PROPERTY.properties.keys;
    expect(LongTextInputSchema.safeParse({ mode: 'read', keys: Array(maxItems).fill(key) }).success).toBe(true);
    expect(LongTextInputSchema.safeParse({ mode: 'read', keys: Array(maxItems + 1).fill(key) }).success).toBe(false);
    const { maximum } = LONG_TEXT_PROPERTY.properties.limit;
    const discover = { mode: 'discover', object: 'TEXT', namePrefix: 'Z' };
    expect(LongTextInputSchema.safeParse({ ...discover, limit: maximum }).success).toBe(true);
    expect(LongTextInputSchema.safeParse({ ...discover, limit: maximum + 1 }).success).toBe(false);
  });
  it('accepts strict-client null padding only in optional control fields', () => {
    expect(
      LongTextInputSchema.parse({
        mode: 'read',
        keys: [key],
        object: null,
        namePrefix: null,
        id: null,
        language: null,
        limit: null,
        phrase: null,
      }),
    ).toEqual({ mode: 'read', keys: [key] });
    expect(LongTextInputSchema.safeParse({ mode: null, keys: [key] }).success).toBe(false);
    expect(LongTextInputSchema.safeParse({ mode: 'read', keys: [{ ...key, name: null }] }).success).toBe(false);
  });
  it('preserves Unicode, leading/internal name spaces, and literal phrase whitespace', () => {
    expect(LongTextInputSchema.parse({ mode: 'search', keys: [key], phrase: '  ' })).toEqual({
      mode: 'search',
      keys: [key],
      phrase: '  ',
    });
    expect(LongTextInputSchema.parse({ mode: 'discover', object: 'TEXT', namePrefix: '  ZÄ  ' })).toMatchObject({
      namePrefix: '  ZÄ  ',
    });
  });
  it.each([
    { mode: 'discover', object: 'TEXT' },
    { mode: 'discover', namePrefix: 'Z' },
    { mode: 'read' },
    { mode: 'search', keys: [key] },
    { mode: 'discover', object: 'TEXT', namePrefix: 'Z', keys: [key] },
    { mode: 'read', keys: [key], phrase: 'text' },
    { mode: 'search', keys: [key], phrase: 'text', namePrefix: 'Z' },
    { mode: 'read', keys: [] },
    { mode: 'read', keys: Array.from({ length: 26 }, () => key) },
    { mode: 'read', keys: [{ ...key, language: 'EN' }] },
    { mode: 'read', keys: [{ ...key, unexpected: 'x' }] },
  ])('rejects missing, conflicting, or invalid mode data: %j', (input) => {
    expect(LongTextInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('SAPQuery long_text public dispatch with real source orchestration and decoder', () => {
  it.each(['session deadline', 'caller cancellation'])(
    'reports an in-flight %s with the limit hint',
    async (reason) => {
      const { client, fixture, query } = setup();
      const controller = new AbortController();
      if (reason === 'session deadline') vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
      query.mockImplementationOnce(async () => {
        controller.abort(
          new DOMException('Query interrupted', reason === 'session deadline' ? 'TimeoutError' : 'AbortError'),
        );
        // Use the real transport cancellation helper: it wraps the signal as AdtNetworkError.
        throwIfRequestCancelled({ signal: getCurrentContext()?.signal });
        throw new Error('Expected the active query to be cancelled');
      });
      const result = await requestContext.run(
        {
          requestId: 'REQ-stored-text-cancel',
          signal: reason === 'caller cancellation' ? controller.signal : undefined,
        },
        () => handleToolCall(client, config, 'SAPQuery', readArgs([fixture.keys.invoice]), auth(['data'])),
      );
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0]!.text)).toMatchObject({
        code: 'LIMIT_EXCEEDED',
        hint: expect.stringContaining('fewer/smaller texts'),
      });
      expect(query).toHaveBeenCalledOnce();
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );
  it.each(['references', 'distinct IDs'])('bounds a 25-key batch with %s and allows a smaller retry', async (kind) => {
    const { client, fixture } = setup();
    const header = fixture.tables.STXH.find((row) => row.TDNAME === fixture.keys.invoice.name)!;
    const cluster = fixture.tables.STXL.find((row) => row.TDNAME === fixture.keys.invoice.name)!;
    const keys = Array.from({ length: 25 }, (_, index) => {
      const key = {
        ...fixture.keys.invoice,
        name: `Z_BATCH_${index}`,
        id: kind === 'distinct IDs' ? `I${index}` : 'ST',
      };
      fixture.tables.STXH.push({
        ...header,
        TDNAME: key.name,
        TDID: key.id,
        ...(kind === 'references'
          ? { TDREF: 'X', TDREFOBJ: 'TEXT', TDREFNAME: fixture.keys.invoice.name, TDREFID: 'ST' }
          : {}),
      });
      if (kind === 'distinct IDs') {
        fixture.tables.TTXID.push({ TDOBJECT: 'TEXT', TDID: key.id, HANDLER_CLASS: '' });
        fixture.tables.STXL.push({ ...cluster, TDNAME: key.name, TDID: key.id });
      }
      return key;
    });
    const result = await handleToolCall(client, config, 'SAPQuery', readArgs(keys), auth(['data']));
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ code: 'LIMIT_EXCEEDED' });
    expect(fixture.calls).toHaveLength(120);
    fixture.calls.length = 0;
    const retried = await payload(
      await handleToolCall(client, config, 'SAPQuery', readArgs(keys.slice(0, 10)), auth(['data'])),
    );
    expect(retried.items).toHaveLength(10);
    expect(retried.items.every((item) => item.status === 'ok')).toBe(true);
    expect(fixture.calls.length).toBeLessThan(120);
  });
  it('discovers reusable lower-case keys and reads the selected key without guessing', async () => {
    const { client, fixture } = setup();
    const found = await payload(
      await handleToolCall(
        client,
        config,
        'SAPQuery',
        { action: 'long_text', longText: { mode: 'discover', object: 'TEXT', namePrefix: 'Z_PAYMENT', limit: 20 } },
        auth(['read', 'data']),
      ),
    );
    expect(found.mode).toBe('discover');
    expect(found.scope).toBe('classic-stored-itf');
    expect(found.candidates.map((item) => item.key)).toEqual(
      expect.arrayContaining([fixture.keys.invoice, fixture.keys.german, fixture.keys.reference]),
    );
    expect(found.more).toBe(false);
    const selected = found.candidates.find(
      (item) => item.key.name === fixture.keys.invoice.name && item.key.language === 'E',
    )!.key;
    const read = await payload(await handleToolCall(client, config, 'SAPQuery', readArgs([selected]), auth(['data'])));
    expect(read.items).toHaveLength(1);
    expect(read.items[0]).toMatchObject({
      index: 0,
      status: 'ok',
      key: selected,
      lineCount: 1,
      lines: [{ format: '*', text: 'Payment within 30 days.' }],
      snapshotGuaranteed: false,
    });
    expect(JSON.stringify(read)).not.toMatch(/CLUSTD|compressedTrailingBytes|revision/);
    expect(fixture.calls.every(({ options }) => options.preserveLiteralSpaces === true)).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('preserves batch order, duplicates, and distinct missing/non-ITF/reference failures', async () => {
    const { client, fixture } = setup();
    const inputs = [
      fixture.keys.invoice,
      fixture.keys.missing,
      fixture.keys.nonItf,
      fixture.keys.broken,
      fixture.keys.invoice,
    ];
    const read = await payload(await handleToolCall(client, config, 'SAPQuery', readArgs(inputs)));
    expect(read.items.map((item) => [item.index, item.key])).toEqual(inputs.map((key, index) => [index, key]));
    expect(read.items.map((item) => item.status)).toEqual(['ok', 'error', 'error', 'error', 'ok']);
    expect(read.items.slice(1, 4).map((item) => item.error!.code)).toEqual([
      'NOT_FOUND',
      'NON_ITF_TEXT',
      'REFERENCE_ERROR',
    ]);
  });
  it('returns a blank row and both kinds of empty stored text without marking them missing', async () => {
    const { client, fixture } = setup();
    const read = await payload(
      await handleToolCall(
        client,
        config,
        'SAPQuery',
        readArgs([fixture.keys.empty, fixture.keys.headerOnly, fixture.keys.blank]),
      ),
    );
    expect(read.items.map((item) => item.status)).toEqual(['ok', 'ok', 'ok']);
    expect(read.items.map((item) => item.lineCount)).toEqual([0, 0, 1]);
    expect(read.items[2].lines).toEqual([{ format: '', text: '' }]);
  });
  it('reads names and text containing Unicode, spaces, and literal entities unchanged', async () => {
    const { client, fixture } = setup();
    const read = await payload(await handleToolCall(client, config, 'SAPQuery', readArgs([fixture.keys.unicode])));
    expect(read.items[0]).toMatchObject({
      key: fixture.keys.unicode,
      lines: [{ format: '*', text: '  Leading  spaces &amp; <tag> 😀' }],
    });
    expect(
      fixture.calls.some(({ options }) =>
        options.where?.some((item) => item.field === 'TDNAME' && item.value === fixture.keys.unicode.name),
      ),
    ).toBe(true);
  });
  it('searches only supplied keys with literal case-sensitive matching and error coverage', async () => {
    const { client, fixture } = setup();
    const search = await payload(
      await handleToolCall(client, config, 'SAPQuery', {
        action: 'long_text',
        longText: { mode: 'search', keys: [fixture.keys.invoice, fixture.keys.missing], phrase: 'Payment' },
      }),
    );
    expect(search).toMatchObject({ mode: 'search', requested: 2, succeeded: 1, truncated: false, caseSensitive: true });
    expect(search.matches).toEqual([
      { index: 0, key: fixture.keys.invoice, lineNumber: 1, format: '*', text: 'Payment within 30 days.' },
    ]);
    expect(search.errors).toMatchObject([{ index: 1, key: fixture.keys.missing, error: { code: 'NOT_FOUND' } }]);
    expect(
      fixture.calls
        .filter(({ table }) => table === 'STXH')
        .every(({ options }) => !options.where?.some((item) => item.op === 'STARTS_WITH')),
    ).toBe(true);
    const wrongCase = await payload(
      await handleToolCall(client, config, 'SAPQuery', {
        action: 'long_text',
        longText: { mode: 'search', keys: [fixture.keys.invoice], phrase: 'payment' },
      }),
    );
    expect(wrongCase.matches).toEqual([]);
  });
  it('returns ITF commands as source data instead of expanding their INCLUDE targets', async () => {
    const { client, fixture } = setup();
    const read = await payload(await handleToolCall(client, config, 'SAPQuery', readArgs([fixture.keys.command])));
    expect(read.items[0]).toMatchObject({
      lines: [{ format: '/:', text: 'INCLUDE Z_OTHER OBJECT TEXT ID ST' }],
      warnings: ['ITF_COMMANDS_PRESENT'],
    });
    expect(fixture.calls.some(({ options }) => options.where?.some((item) => item.value === 'Z_OTHER'))).toBe(false);
  });
  it('makes bounded discovery truncation explicit and interprets wildcards literally', async () => {
    const { client } = setup();
    const limited = await payload(
      await handleToolCall(client, config, 'SAPQuery', {
        action: 'long_text',
        longText: { mode: 'discover', object: 'TEXT', namePrefix: 'Z_PAYMENT', limit: 1 },
      }),
    );
    expect(limited.candidates).toHaveLength(1);
    expect(limited.more).toBe(true);
    expect(limited.nextStep).toMatch(/Narrow namePrefix/);
    for (const namePrefix of ['Z_PAYMENT%', 'Z_PAYMENT*']) {
      const empty = await payload(
        await handleToolCall(client, config, 'SAPQuery', {
          action: 'long_text',
          longText: { mode: 'discover', object: 'TEXT', namePrefix },
        }),
      );
      expect(empty.candidates).toEqual([]);
    }
  });
  it('forwards the nested contract through hyperfocused mode', async () => {
    const { client, fixture } = setup();
    const result = await payload(
      await handleToolCall(
        client,
        { ...config, toolMode: 'hyperfocused' },
        'SAP',
        { action: 'query', params: { action: 'long_text', longText: { mode: 'read', keys: [fixture.keys.invoice] } } },
        auth(['data']),
      ),
    );
    expect(result.items[0].status).toBe('ok');
  });
});

describe('SAPQuery long_text policy and rejection behavior', () => {
  it('rejects the unreleased former SAPRead LONG_TEXT API without any table query', async () => {
    const { client, fixture, query } = setup();
    const result = await handleToolCall(
      client,
      config,
      'SAPRead',
      { type: 'LONG_TEXT', longText: { mode: 'read', keys: [fixture.keys.invoice] } },
      auth(['admin']),
    );
    expect(result.isError).toBe(true);
    expect(query).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([{}, { allowFreeSQL: true }])(
    'keeps long_text disabled for admin when data preview is off: %j',
    async (flags) => {
      const safety = { ...defaultSafetyConfig(), ...flags };
      const { client, fixture, query } = setup(safety);
      const result = await handleToolCall(
        client,
        { ...config, allowDataPreview: false, ...flags },
        'SAPQuery',
        readArgs([fixture.keys.invoice]),
        auth(['admin']),
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toMatch(/allowDataPreview=false|data preview/i);
      expect(query).not.toHaveBeenCalled();
    },
  );
  it('reads with data preview enabled and free SQL disabled without invoking the SQL handler', async () => {
    const { client, fixture } = setup();
    const sql = vi.spyOn(client, 'runQueryBatch');
    const result = await payload(
      await handleToolCall(client, config, 'SAPQuery', readArgs([fixture.keys.invoice]), auth(['data'])),
    );
    expect(result.items[0].status).toBe('ok');
    expect(sql).not.toHaveBeenCalled();
  });
  it.each([{}, { action: 'sql' }])('preserves existing SQL payload behavior: %j', async (selector) => {
    const safety = { ...defaultSafetyConfig(), allowFreeSQL: true };
    const { client, query } = setup(safety);
    const runSql = vi.spyOn(client, 'runQueryBatch').mockResolvedValue({ columns: ['VALUE'], rows: [{ VALUE: '1' }] });
    const result = await handleToolCall(
      client,
      { ...config, allowDataPreview: false, allowFreeSQL: true },
      'SAPQuery',
      { ...selector, sql: 'SELECT value FROM ztest', maxRows: 7 },
      auth(['sql']),
    );
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ rowsReturned: 1, rows: [{ VALUE: '1' }] });
    expect(runSql).toHaveBeenCalledWith(['SELECT value FROM ztest'], 7);
    expect(query).not.toHaveBeenCalled();
  });
  it('keeps legacy SQL disabled even when data-preview permission exists', async () => {
    const { client } = setup();
    const result = await handleToolCall(
      client,
      config,
      'SAPQuery',
      { sql: 'SELECT value FROM ztest' },
      auth(['admin']),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/allowFreeSQL=false|free.?SQL/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([
    { action: 'long_text' },
    { action: 'long_text', longText: null },
    {
      action: 'long_text',
      longText: { mode: 'read', keys: [{ object: 'TEXT', name: 'Z', id: 'ST', language: 'E' }] },
      sql: 'SELECT * FROM stxl',
    },
    { action: 'long_text', longText: { mode: 'discover', object: 'TEXT', namePrefix: 'Z' }, maxRows: 10 },
    { action: 'sql', longText: { mode: 'discover', object: 'TEXT', namePrefix: 'Z' }, sql: 'SELECT * FROM stxh' },
    { longText: { mode: 'discover', object: 'TEXT', namePrefix: 'Z' } },
  ])('rejects missing or mixed action payloads before querying SAP: %j', async (args) => {
    const { client, query } = setup();
    const runSql = vi.spyOn(client, 'runQueryBatch');
    const result = await handleToolCall(client, { ...config, allowFreeSQL: true }, 'SAPQuery', args, auth(['admin']));
    expect(result.isError).toBe(true);
    expect(query).not.toHaveBeenCalled();
    expect(runSql).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('shares one cumulative data-response budget across configuration and text reads', async () => {
    const { client, fixture, query } = setup();
    const budgets = new Set();
    query.mockImplementation(async (table, options) => {
      const budget = getCurrentContext()!.dataResultScope!.responseBudget;
      budgets.add(budget);
      const reservation = budget.createReservation();
      reservation.add(800_000);
      reservation.commit();
      return fixture.query(table, options);
    });
    const result = await handleToolCall(client, config, 'SAPQuery', readArgs([fixture.keys.invoice]));
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ error: 'DATA_RESPONSE_TOO_LARGE', retryable: false });
    expect(budgets.size).toBe(1);
    expect(query).toHaveBeenCalledTimes(3);
  });
  it('requires data scope before any table query', async () => {
    const { client, fixture, query } = setup();
    const result = await handleToolCall(client, config, 'SAPQuery', readArgs([fixture.keys.invoice]), auth(['read']));
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/Insufficient scope: 'data'/);
    expect(query).not.toHaveBeenCalled();
  });
  it('retains the server data-preview ceiling even with data scope', async () => {
    const { client, fixture, query } = setup(defaultSafetyConfig());
    const result = await handleToolCall(
      client,
      { ...config, allowDataPreview: false },
      'SAPQuery',
      readArgs([fixture.keys.invoice]),
      auth(['data']),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/allowDataPreview=false|data preview/i);
    expect(query).not.toHaveBeenCalled();
  });
  it('enforces an explicit action denial before decoding', async () => {
    const { client, fixture, query } = setup();
    const result = await handleToolCall(
      client,
      { ...config, denyActions: ['SAPQuery.long_text'] },
      'SAPQuery',
      readArgs([fixture.keys.invoice]),
      auth(['data']),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/denied by server policy/);
    expect(query).not.toHaveBeenCalled();
  });
  it.each(['STXH', 'STXL', 'TTXOB', 'TTXID', 'T002'])('honors the real table blocklist for %s', async (table) => {
    const safety = { ...defaultSafetyConfig(), allowDataPreview: true, blockedDataSources: [table] };
    const { client, fixture, query, originalQuery } = setup(safety);
    query.mockImplementation((requested, options) =>
      requested === table ? originalQuery(requested, options) : fixture.query(requested, options),
    );
    const result = await handleToolCall(
      client,
      { ...config, blockedDataSources: [table] },
      'SAPQuery',
      readArgs([fixture.keys.invoice]),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('DATA_SOURCE_BLOCKED');
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('rejects BTP at the public schema boundary and cached BTP detection', async () => {
    const { client, fixture, query } = setup();
    const args = readArgs([fixture.keys.invoice]);
    const publicBtp = await handleToolCall(client, { ...config, systemType: 'btp' }, 'SAPQuery', args);
    expect(publicBtp.isError).toBe(true);
    expect(query).not.toHaveBeenCalled();
    setCachedFeatures({ systemType: 'btp' });
    const detectedBtp = await handleToolCall(client, config, 'SAPQuery', args);
    expect(detectedBtp.isError).toBe(true);
    expect(detectedBtp.content[0]!.text).toMatch(/BTP|UNSUPPORTED_PLATFORM/);
    expect(query).not.toHaveBeenCalled();
  });
  it('classifies a missing preview capability without claiming the text is missing', async () => {
    const { client, fixture, query } = setup();
    query.mockRejectedValue(new AdtApiError('not found', 404, '/sap/bc/adt/datapreview/freestyle?rowNumber=2'));
    const result = await handleToolCall(client, config, 'SAPQuery', readArgs([fixture.keys.invoice]));
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ code: 'UNSUPPORTED_PLATFORM' });
  });
  it.each([
    { grep: 'text' },
    { method: '*' },
    { include: 'definitions' },
    { action: 'diff' },
    { version: 'inactive' },
    { name: 'Z_PAYMENT_NOTICE' },
    { format: 'editable' },
    { lineStart: 1, lineEnd: 2 },
    { columns: ['CLUSTD'] },
    { where: [{ field: 'TDNAME', op: '=', value: 'Z' }] },
  ])('rejects source/data query options before SAP access: %j', async (extra) => {
    const { client, fixture, query } = setup();
    const result = await handleToolCall(client, config, 'SAPQuery', { ...readArgs([fixture.keys.invoice]), ...extra });
    expect(result.isError).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });
  it('accepts omitted SQL fields represented by strict-client null fillers', async () => {
    const { client, fixture } = setup();
    const result = await payload(
      await handleToolCall(client, config, 'SAPQuery', {
        ...readArgs([fixture.keys.invoice]),
        sql: null,
        maxRows: null,
      }),
    );
    expect(result.items[0].status).toBe('ok');
  });
  it('hides text queries from read-only scopes and BTP while preserving data-only tool visibility', () => {
    const definitions = getToolDefinitions(config);
    const visible = filterToolsByAuthScope(definitions, ['read']);
    expect(visible.find((tool) => tool.name === 'SAPQuery')).toBeUndefined();
    const dataOnly = filterToolsByAuthScope(definitions, ['data']).find((tool) => tool.name === 'SAPQuery')!;
    expect(dataOnly).toBeDefined();
    expect((dataOnly.inputSchema as { properties: { action: { enum: string[] } } }).properties.action.enum).toEqual([
      'long_text',
      'application_log',
    ]);
    expect((dataOnly.inputSchema as { properties: Record<string, unknown> }).properties.longText).toBeDefined();
    const btp = getToolDefinitions({ ...config, allowFreeSQL: true, systemType: 'btp' }).find(
      (tool) => tool.name === 'SAPQuery',
    )!;
    expect((btp.inputSchema as { properties: Record<string, unknown> }).properties.longText).toBeUndefined();
    expect(
      (btp.inputSchema as { properties: { action?: { enum: string[] } } }).properties.action?.enum ?? [],
    ).not.toContain('long_text');
  });
});
