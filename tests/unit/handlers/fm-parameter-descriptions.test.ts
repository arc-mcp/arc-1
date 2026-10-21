import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { SAPWriteSchema } = await import('../../../src/handlers/schemas.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');

const parameter = { kind: 'importing', name: 'IV_INPUT', type: 'CHAR10', description: 'Eingabewert' };
const source =
  '"! Keep this function documentation\nFUNCTION z_demo\n IMPORTING iv_input TYPE char10.\n\n WRITE / 1.\nENDFUNCTION.\n* Footer\n';
const identity = { type: 'FUNC', name: 'Z_DEMO', group: 'ZFG' };
let originalLanguage: string | undefined;
let storedSource: string;
let calls: { url: string; method: string; body?: string }[];

beforeEach(() => {
  resetCachedFeatures();
  originalLanguage = 'DE';
  storedSource = source;
  calls = [];
  mockFetch.mockReset();
  mockFetch.mockImplementation((url: string | URL, options?: RequestInit) => {
    const target = new URL(String(url));
    const method = options?.method ?? 'GET';
    const body = typeof options?.body === 'string' ? options.body : undefined;
    calls.push({ url: String(url), method, body });
    let result = '';
    if (target.searchParams.get('_action') === 'LOCK') {
      result =
        '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>L1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';
    } else if (target.pathname.endsWith('/source/main')) {
      if (method === 'PUT') storedSource = body!;
      if (method === 'GET') result = storedSource;
    } else if (/\/functions\/groups\/[^/]+$/i.test(target.pathname)) {
      result = `<group:abapFunctionGroup xmlns:group="http://www.sap.com/adt/functions/groups" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:language="EN" ${originalLanguage ? `adtcore:masterLanguage="${originalLanguage}"` : ''}><adtcore:packageRef adtcore:name="$TMP"/></group:abapFunctionGroup>`;
    } else if (/\/fmodules\/[^/]+$/i.test(target.pathname)) {
      result =
        '<fmodule:abapFunctionModule xmlns:fmodule="http://www.sap.com/adt/functions/fmodules" xmlns:adtcore="http://www.sap.com/adt/core" fmodule:processingType="normal"><adtcore:packageRef adtcore:name="$TMP"/></fmodule:abapFunctionModule>';
    }
    return Promise.resolve(mockResponse(200, result, { 'x-csrf-token': 'T' }));
  });
});

function writtenSource(): string | undefined {
  return calls.find((call) => call.method === 'PUT' && call.url.includes('/source/main'))?.body;
}

describe('FUNC parameter descriptions through handlers', () => {
  it.each(['create', 'update'])(
    '%s recognizes documented full source and uses original rather than request language',
    async (action) => {
      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action,
        ...identity,
        source,
        parameters: [parameter],
      });
      expect(result.isError, result.content[0]?.text).not.toBe(true);
      const output = writtenSource()!;
      expect(output.startsWith('"! Keep this function documentation\n')).toBe(true);
      expect(output).toContain('lang="de">Eingabewert</p>');
      expect(output.endsWith('\n\n WRITE / 1.\nENDFUNCTION.\n* Footer\n')).toBe(true);
      expect(output.match(/^FUNCTION /gm)).toHaveLength(1);
    },
  );

  it('reads the current documented source under the lock before a signature-only update', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      ...identity,
      parameters: [parameter],
    });
    expect(result.isError, result.content[0]?.text).not.toBe(true);
    const lockIndex = calls.findIndex((call) => call.url.includes('_action=LOCK'));
    const readIndex = calls.findIndex((call) => call.method === 'GET' && call.url.includes('/source/main'));
    const putIndex = calls.findIndex((call) => call.method === 'PUT' && call.url.includes('/source/main'));
    expect(lockIndex).toBeLessThan(readIndex);
    expect(readIndex).toBeLessThan(putIndex);
    expect(writtenSource()).toContain('WRITE / 1.\nENDFUNCTION.\n* Footer\n');
  });

  it('supports batch create with descriptions', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'batch_create',
      objects: [{ ...identity, source, parameters: [parameter] }],
    });
    expect(result.isError, result.content[0]?.text).not.toBe(true);
    expect(writtenSource()).toContain('lang="de">Eingabewert</p>');
  });

  it('reads descriptions from source and keeps plain source reads unchanged', async () => {
    storedSource = `"! @parameter iv_input | <p class="shorttext synchronized" lang="de">Eingabewert</p>\n${source}`;
    const client = createClient();
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', { ...identity, includeSignature: true });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse(result.content[0]!.text).signature.importing[0]).toMatchObject({
      name: 'IV_INPUT',
      description: 'Eingabewert',
    });
    const plain = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', identity);
    expect(plain.content[0]!.text).toContain(storedSource);
  });

  it.each(['create', 'update', 'batch_create'])(
    'refuses %s before mutation if original language is missing',
    async (action) => {
      originalLanguage = undefined;
      const entry = { ...identity, source, parameters: [parameter] };
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPWrite',
        action === 'batch_create' ? { action, objects: [entry] } : { action, ...entry },
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('original language');
      expect(calls.filter((call) => ['POST', 'PUT', 'DELETE'].includes(call.method))).toEqual([]);
    },
  );

  it.each(['create', 'update'])('refuses ambiguous explicit description on %s without a source PUT', async (action) => {
    const duplicate = `"! @parameter iv_input | First\n"! @parameter iv_input | Second\n${source}`;
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action,
      ...identity,
      source: duplicate,
      parameters: [parameter],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Duplicate ABAP Doc');
    expect(writtenSource()).toBeUndefined();
  });

  it('leaves source-only updates untouched without a language lookup', async () => {
    originalLanguage = undefined;
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      ...identity,
      source,
    });
    expect(result.isError, result.content[0]?.text).not.toBe(true);
    expect(writtenSource()).toBe(source);
  });
});

describe('FUNC description input contract', () => {
  it.each(['x', 'x'.repeat(60), '输入说明'])('accepts %j for single and batch writes', (description) => {
    const entry = { ...identity, parameters: [{ ...parameter, description }] };
    for (const args of [
      { action: 'create', ...entry },
      { action: 'batch_create', objects: [entry] },
    ]) {
      const result = SAPWriteSchema.safeParse(args);
      expect(result.success).toBe(true);
      expect(JSON.stringify(result.success && result.data)).toContain(description);
    }
  });

  it.each(['', '   ', 'x'.repeat(61), 'two\nlines', 'tab\tvalue', '\u0000', '\u2028'])(
    'rejects invalid description %j',
    (description) => {
      expect(
        SAPWriteSchema.safeParse({ action: 'update', ...identity, parameters: [{ ...parameter, description }] })
          .success,
      ).toBe(false);
    },
  );

  it.each(['exceptions', 'raising'])('does not promise native short texts for %s', (kind) => {
    expect(
      SAPWriteSchema.safeParse({ action: 'create', ...identity, parameters: [{ ...parameter, kind }] }).success,
    ).toBe(false);
  });
});
