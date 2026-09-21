import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import type { TextElementPart } from '../../../src/adt/text-elements.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const LOCK =
  '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H/9</LOCK_HANDLE><CORRNR>DEVK900001</CORRNR></DATA></asx:values></asx:abap>';
const calls = () => mockFetch.mock.calls as [string, RequestInit][];
const mutations = () => calls().filter(([, init]) => ['POST', 'PUT', 'DELETE'].includes(init?.method ?? 'GET'));

describe('text elements routing and safety', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(mockResponse(200, String(url).includes('_action=LOCK') ? LOCK : '', { 'x-csrf-token': 'T' })),
    );
  });

  it.each(['PROG', 'FUGR', 'CLAS'])('refuses unavailable %s service without a legacy request', async (objectType) => {
    const client = createClient();
    client.http.setDiscoveryMap(new Map([['/sap/bc/adt/programs/programs', ['text/plain']]]));
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', {
      type: 'TEXT_ELEMENTS',
      objectType,
      name: 'ZTEST',
      include: 'symbols',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/textelements service/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('reads only symbols for a whole class pool and preserves the raw body', async () => {
    const body = '@MaxLength:20\r\n001=Label  \r\n';
    mockFetch.mockResolvedValue(mockResponse(200, body));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'TEXT_ELEMENTS',
      objectType: 'clas/oc',
      name: '/ARC/CL_TEST',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(`=== symbols ===\n${body}`);
    expect(calls()).toHaveLength(1);
    expect(String(calls()[0]?.[0])).toContain('/textelements/classes/%2FARC%2FCL_TEST/source/symbols');
  });

  it.each(['selections', 'headings'])('returns the raw SAP response for an explicit class %s read', async (include) => {
    const body =
      include === 'selections'
        ? ''
        : 'listHeader=\r\n\r\ncolumnHeader_1=\r\ncolumnHeader_2=\r\ncolumnHeader_3=\r\ncolumnHeader_4=';
    mockFetch.mockResolvedValue(mockResponse(200, body));
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'TEXT_ELEMENTS',
      objectType: 'CLAS',
      name: 'ZCL_TEST',
      include,
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(body);
    expect(calls()).toHaveLength(1);
    expect(String(calls()[0]?.[0])).toContain(`/textelements/classes/ZCL_TEST/source/${include}`);
    expect(calls()[0]?.[1]?.headers).toMatchObject({ Accept: `application/vnd.sap.adt.textelements.${include}.v1` });
  });

  it.each(['selections', 'headings'] as const)(
    'refuses class %s writes at both boundaries before HTTP',
    async (textPart) => {
      const client = createClient();
      const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'edit_text_symbols',
        type: 'CLAS',
        name: 'ZCL_TEST',
        textPart,
        source: '',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Only symbols can be written for CLAS');
      await expect(client.writeTextElementPart('CLAS', 'ZCL_TEST', textPart, '')).rejects.toThrow(
        /Only symbols can be written for CLAS/,
      );
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it('adds an editing hint to multipart output without changing individual part reads', async () => {
    const body = '@MaxLength:20\r\n001=Label  \r\n';
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        mockResponse(
          200,
          String(url).includes('/source/symbols')
            ? body
            : String(url).includes('/source/selections')
              ? 'P_TEST=Label'
              : '',
        ),
      ),
    );
    const client = createClient();
    const whole = await client.getTextElements('ZTEST');
    expect(whole).toContain(`=== symbols ===\n${body}`);
    expect(whole).toContain('=== selections ===\nP_TEST=Label');
    expect(whole).toContain('SAPRead include=<part>, then SAPWrite textPart=<part>');
    expect(whole).toContain('without the === part === markers');
    expect(await client.getTextElementPart('PROG', 'ZTEST', 'symbols')).toBe(body);
  });

  it('rejects uppercase textPart rather than advertising ineffective case normalization', async () => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_text_symbols',
      type: 'PROG',
      name: 'ZTEST',
      textPart: 'SYMBOLS',
      source: '',
    });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([403, 404, 406, 500])('propagates HTTP %i during a whole program read', async (status) => {
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        String(url).includes('/source/symbols')
          ? mockResponse(200, '@MaxLength:10\n001=Hello')
          : mockResponse(status, '<exc:exception><message>Cannot parse the source code</message></exc:exception>'),
      ),
    );
    await expect(createClient().getTextElements('ZTEST')).rejects.toMatchObject({ statusCode: status });
  });

  it('refuses an invalid part at the client boundary', async () => {
    const client = createClient();
    await expect(client.getTextElementPart('PROG', 'ZTEST', '../main' as TextElementPart)).rejects.toBeInstanceOf(
      AdtApiError,
    );
    await expect(
      client.writeTextElementPart('PROG', 'ZTEST', '../main' as TextElementPart, 'bad'),
    ).rejects.toBeInstanceOf(AdtApiError);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(['PROG', 'FUGR', 'CLAS'])('forwards an explicit empty %s symbols replacement', async (type) => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_text_symbols',
      type,
      name: 'ZTEST',
      source: '',
    });
    expect(result.isError).toBeUndefined();
    const put = calls().find(([, init]) => init?.method === 'PUT');
    expect(put?.[1]?.body).toBe('');
    expect(String(put?.[0])).toContain('corrNr=DEVK900001');
    expect(String(put?.[0])).toContain('lockHandle=H%2F9');
  });

  it.each([undefined, null])('refuses an absent source (%s) without mutation', async (source) => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_text_symbols',
      type: 'PROG',
      name: 'ZTEST',
      source,
    });
    expect(result.isError).toBe(true);
    expect(mutations()).toHaveLength(0);
  });

  it.each(['PROG', 'FUGR'])('checks the real %s package instead of a caller-supplied package', async (type) => {
    const client = createClient();
    client.safety.allowedPackages = ['$TMP'];
    mockFetch.mockResolvedValue(
      mockResponse(
        200,
        '<adtcore:object xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="ZPROTECTED"/></adtcore:object>',
      ),
    );
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_text_symbols',
      type,
      name: 'ZTEST',
      package: '$TMP',
      textPart: 'selections',
      source: 'P_TEST=Label',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('ZPROTECTED');
    expect(mutations()).toHaveLength(0);
  });

  it('fails closed on missing package metadata', async () => {
    const client = createClient();
    client.safety.allowedPackages = ['$TMP'];
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_text_symbols',
      type: 'FUGR',
      name: 'ZTEST',
      source: '@MaxLength:10\n001=Hello',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/could not determine.*package/);
    expect(mutations()).toHaveLength(0);
  });

  it('honours the write ceiling', async () => {
    const client = createClient();
    client.safety.allowWrites = false;
    const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
      action: 'edit_text_symbols',
      type: 'PROG',
      name: 'ZTEST',
      source: '@MaxLength:10\n001=Hello',
    });
    expect(result.isError).toBe(true);
    expect(mutations()).toHaveLength(0);
  });

  it('honours the action deny rule before HTTP', async () => {
    const result = await handleToolCall(
      createClient(),
      { ...DEFAULT_CONFIG, denyActions: ['SAPWrite.edit_text_symbols'] },
      'SAPWrite',
      { action: 'edit_text_symbols', type: 'PROG', name: 'ZTEST', source: '' },
    );
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(['symbols', 'selections', 'headings'] as const)(
    'uses FUGR %s media types and caller transport, and unlocks on a rejected PUT',
    async (part) => {
      mockFetch.mockImplementation((url: string, init?: RequestInit) =>
        Promise.resolve(
          init?.method === 'PUT'
            ? mockResponse(406, '<exc:exception><message>Rejected text</message></exc:exception>')
            : mockResponse(200, String(url).includes('_action=LOCK') ? LOCK : '', { 'x-csrf-token': 'T' }),
        ),
      );
      await expect(
        createClient().writeTextElementPart('FUGR', '/ARC/FG', part, 'body', 'DEVK900002'),
      ).rejects.toMatchObject({ statusCode: 406 });
      const put = calls().find(([, init]) => init?.method === 'PUT');
      expect(String(put?.[0])).toContain(`/textelements/functiongroups/%2FARC%2FFG/source/${part}`);
      expect(String(put?.[0])).toContain('corrNr=DEVK900002');
      expect(put?.[1]?.headers).toMatchObject({
        Accept: `application/vnd.sap.adt.textelements.${part}.v1`,
        'Content-Type': `application/vnd.sap.adt.textelements.${part}.v1`,
      });
      const lock = calls().find(([url]) => String(url).includes('_action=LOCK'));
      const unlock = calls().find(([url]) => String(url).includes('_action=UNLOCK'));
      expect(String(lock?.[0])).toContain('/textelements/functiongroups/%2FARC%2FFG?');
      expect(String(unlock?.[0])).toContain('/textelements/functiongroups/%2FARC%2FFG?');
      expect(calls().indexOf(unlock!)).toBeGreaterThan(calls().indexOf(put!));
    },
  );
});
