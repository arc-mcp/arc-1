import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import type { TextElementPart } from '../../../src/adt/text-elements.js';
import type { SapWriteContext } from '../../../src/handlers/write/context.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { writeActionDelete, writeActionEditTextSymbols } = await import('../../../src/handlers/write/update-delete.js');
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
    if (type === 'PROG') {
      expect(result.content[0]?.text).not.toContain('Updated and activated');
      expect(result.content[0]?.text).toContain('never been activated');
      expect(result.content[0]?.text).toContain('SAPActivate(type="PROG", name="ZTEST")');
    } else {
      expect(result.content[0]?.text).toContain('Updated and activated');
    }
    const put = calls().find(([, init]) => init?.method === 'PUT');
    expect(put?.[1]?.body).toBe('');
    expect(String(put?.[0])).toContain('corrNr=DEVK900001');
    expect(String(put?.[0])).toContain('lockHandle=H%2F9');
  });

  it.each([
    ['PROG', 'programs'],
    ['FUGR', 'functiongroups'],
    ['CLAS', 'classes'],
  ] as const)('activates only the %s text pool after unlock in the same stateful session', async (type, collection) => {
    await createClient().writeTextElementPart(type, '/ARC/TEST', 'symbols', '@MaxLength:20\n001=Hello');
    const writes = mutations();
    expect(writes).toHaveLength(4);
    expect(writes[0]?.[0]).toContain('_action=LOCK');
    expect(writes[1]?.[1].method).toBe('PUT');
    expect(writes[2]?.[0]).toContain('_action=UNLOCK');
    expect(writes[3]?.[0]).toContain('/activation?method=activate&preauditRequested=false');
    expect(writes[3]?.[1].body).toContain(`/sap/bc/adt/textelements/${collection}/%2FARC%2FTEST`);
    expect(String(writes[3]?.[1].body).match(/<adtcore:objectReference /g)).toHaveLength(1);
    for (const [, request] of writes) {
      expect(request.headers).toMatchObject({ 'X-sap-adt-sessiontype': 'stateful' });
    }
  });

  it.each(['rejected', 'http', 'pending'])(
    'reports saved but unconfirmed text activation on %s and invalidates caches',
    async (failure) => {
      mockFetch.mockImplementation((url: string) =>
        Promise.resolve(
          String(url).includes('/activation')
            ? mockResponse(
                failure === 'http' ? 403 : 200,
                failure === 'pending'
                  ? '<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/adt/activation"><entry><object><ref uri="/sap/bc/adt/other" name="OTHER"/></object></entry></ioc:inactiveObjects>'
                  : '<messages><msg type="E"><shortText><txt>Activation refused</txt></shortText></msg></messages>',
              )
            : mockResponse(200, String(url).includes('_action=LOCK') ? LOCK : '', { 'x-csrf-token': 'T' }),
        ),
      );
      const invalidateWrittenObject = vi.fn();
      const ctx = {
        client: createClient(),
        args: {},
        type: 'PROG',
        name: 'ZTEST',
        source: '001=Hello',
        hasSource: true,
        enforcePackageForExistingObject: vi.fn().mockResolvedValue('$TMP'),
        invalidateWrittenObject,
      } as unknown as SapWriteContext;
      await expect(writeActionEditTextSymbols(ctx)).rejects.toThrow(/saved.*activation.*not confirmed/i);
      expect(invalidateWrittenObject).toHaveBeenCalledOnce();
      // HTTP 403 has the transport's existing one-time CSRF refresh/retry.
      expect(calls().filter(([url]) => String(url).includes('/activation'))).toHaveLength(failure === 'http' ? 2 : 1);
      expect(calls().some(([url]) => String(url).includes('_action=UNLOCK'))).toBe(true);
    },
  );

  it.each([false, true])(
    'retains the saved-state hint through dispatch with minimalErrors=%s',
    async (minimalErrors) => {
      mockFetch.mockImplementation((url: string) =>
        Promise.resolve(
          mockResponse(
            200,
            String(url).includes('/activation')
              ? '<messages><msg type="E"><shortText><txt>Activation refused</txt></shortText></msg></messages>'
              : String(url).includes('_action=LOCK')
                ? LOCK
                : '',
            { 'x-csrf-token': 'T' },
          ),
        ),
      );
      const result = await handleToolCall(createClient(), { ...DEFAULT_CONFIG, minimalErrors }, 'SAPWrite', {
        action: 'edit_text_symbols',
        type: 'PROG',
        name: 'ZTEST',
        source: '@MaxLength:20\n001=Hello',
      });
      expect(result.isError).toBe(true);
      const message = result.content[0]?.text ?? '';
      expect(message.match(/Text elements were saved, but activation was not confirmed\./g)).toHaveLength(1);
      expect(message).toContain('Retry the same text write.');
      if (minimalErrors) {
        expect(message).not.toContain('Activation refused');
        expect(message).toContain('ARC1_MINIMAL_ERRORS=true');
      } else {
        expect(message).toContain('Activation refused');
      }
    },
  );

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
      expect(calls().some(([url]) => String(url).includes('/activation'))).toBe(false);
    },
  );
});

describe('PROG/FUGR deletion preserves inactive text pools', () => {
  const metadata = (type = 'PROG', name = 'ZTEST', version = 'active') =>
    `<rept:textElement xmlns:rept="http://www.sap.com/adt/textelements" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${name}" adtcore:type="${type}/PX" adtcore:version="${version}"/>`;
  const mockSap = (body = metadata()) =>
    mockFetch.mockImplementation((url: string) =>
      Promise.resolve(
        mockResponse(
          200,
          String(url).includes('_action=LOCK') ? LOCK : String(url).includes('?version=inactive') ? body : '',
          { 'x-csrf-token': 'T' },
        ),
      ),
    );
  const del = (type = 'PROG', name = 'ZTEST', config = DEFAULT_CONFIG, client = createClient()) =>
    handleToolCall(client, config, 'SAPWrite', { action: 'delete', type, name });
  const steps = () =>
    mutations().map(([url, init]) =>
      String(url).includes('_action=') ? /_action=(\w+)/.exec(String(url))?.[1] : init.method,
    );
  beforeEach(() => vi.resetAllMocks());

  it.each(['PROG', 'FUGR'])('deletes clean %s only after checking under both locks', async (type) => {
    mockSap(metadata(type));
    expect((await del(type)).isError).toBeUndefined();
    expect(steps()).toEqual(['LOCK', 'LOCK', 'DELETE', 'UNLOCK', 'UNLOCK']);
    const readIndex = calls().findIndex(([url]) => String(url).includes('?version=inactive'));
    const poolLockIndex = calls().findIndex(
      ([url]) => String(url).includes('/textelements/') && String(url).includes('_action=LOCK'),
    );
    const deleteIndex = calls().findIndex(([, init]) => init.method === 'DELETE');
    expect(readIndex).toBeGreaterThan(poolLockIndex);
    expect(deleteIndex).toBeGreaterThan(readIndex);
    expect(String(calls()[deleteIndex]?.[0])).toContain('corrNr=DEVK900001');
    expect(calls().some(([url]) => String(url).includes('/activation'))).toBe(false);
  });

  it.each(['PROG', 'FUGR'])(
    'refuses %s with an inactive pool even when the caller feed would be empty',
    async (type) => {
      mockSap(metadata(type, 'ZTEST', 'inactive'));
      const result = await del(type);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('Review the draft with its author');
      expect(steps()).toEqual(['LOCK', 'LOCK', 'UNLOCK', 'UNLOCK']);
      expect(calls().some(([url]) => String(url).includes('/activation'))).toBe(false);
    },
  );

  it('retains the actionable refusal with minimal errors', async () => {
    mockSap(metadata('PROG', 'ZTEST', 'inactive'));
    const result = await del('PROG', 'ZTEST', { ...DEFAULT_CONFIG, minimalErrors: true });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('explicitly activate the pool');
    expect(result.content[0]?.text).toContain('first owner activation');
  });

  it.each([
    '',
    '<html>login</html>',
    metadata('PROG', 'OTHER'),
    metadata('FUGR'),
    metadata('PROG', 'ZTEST', 'unknown'),
    '<textElement/>',
    '<textElement name="ZTEST" type="PROG/PX" version="active"/>'.repeat(2),
  ])('fails closed on unverified metadata: %s', async (body) => {
    mockSap(body);
    expect((await del()).isError).toBe(true);
    expect(steps()).toEqual(['LOCK', 'LOCK', 'UNLOCK', 'UNLOCK']);
  });

  it.each([403, 404, 406, 500])('preserves owner on advertised pool HTTP %i', async (status) => {
    mockSap();
    const sap = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes('?version=inactive')
        ? Promise.resolve(mockResponse(status, '<exception><message>Failed</message></exception>'))
        : sap(url, init),
    );
    const result = await del();
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).not.toContain('rejected DELETE');
    expect(steps()).toEqual(['LOCK', 'LOCK', 'UNLOCK', 'UNLOCK']);
  });

  it.each(['owner lock', 'pool lock', 'delete'])('releases acquired locks when %s fails', async (failure) => {
    mockSap();
    const sap = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string, init?: RequestInit) => {
      const pool = String(url).includes('/textelements/');
      const fail =
        failure === 'delete'
          ? init?.method === 'DELETE'
          : String(url).includes('_action=LOCK') && (failure === 'pool lock' ? pool : !pool);
      return fail
        ? Promise.resolve(mockResponse(423, '<exception><message>Locked</message></exception>'))
        : sap(url, init);
    });
    expect((await del()).isError).toBe(true);
    expect(steps()).toEqual(
      failure === 'owner lock'
        ? ['LOCK']
        : failure === 'pool lock'
          ? ['LOCK', 'LOCK', 'UNLOCK']
          : ['LOCK', 'LOCK', 'DELETE', 'UNLOCK', 'UNLOCK'],
    );
  });

  it('tolerates pool removal during successful owner deletion', async () => {
    mockSap();
    const sap = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation((url: string, init?: RequestInit) =>
      String(url).includes('_action=UNLOCK')
        ? Promise.resolve(mockResponse(404, '<exception><message>Gone</message></exception>'))
        : sap(url, init),
    );
    expect((await del()).isError).toBeUndefined();
  });

  it.each(['PROG', 'FUGR'])('retains legacy %s deletion when discovery proves the collection absent', async (type) => {
    mockSap();
    const client = createClient();
    client.http.setDiscoveryMap(new Map([['/sap/bc/adt/programs/programs', ['text/plain']]]));
    expect((await del(type, 'ZTEST', DEFAULT_CONFIG, client)).isError).toBeUndefined();
    expect(steps()).toEqual(['LOCK', 'DELETE', 'UNLOCK']);
    expect(calls().some(([url]) => String(url).includes('/textelements/'))).toBe(false);
  });

  it.each(['PROG', 'FUGR'])('encodes a namespaced %s pool name', async (type) => {
    mockSap(metadata(type, '/ARC/TEST'));
    expect((await del(type, '/ARC/TEST')).isError).toBeUndefined();
    expect(calls().find(([url]) => String(url).includes('?version=inactive'))?.[0]).toContain('/%2FARC%2FTEST?');
  });

  it.each(['write ceiling', 'delete deny', 'package'])(
    'refuses a denied %s before locking either object',
    async (gate) => {
      mockSap();
      const client = createClient();
      if (gate === 'write ceiling') client.safety.allowWrites = false;
      if (gate === 'package') {
        client.safety.allowedPackages = ['$TMP'];
        mockFetch.mockResolvedValue(mockResponse(200, '<object><packageRef name="ZPROTECTED"/></object>'));
      }
      expect(
        (
          await del(
            'PROG',
            'ZTEST',
            { ...DEFAULT_CONFIG, denyActions: gate === 'delete deny' ? ['SAPWrite.delete'] : [] },
            client,
          )
        ).isError,
      ).toBe(true);
      expect(mutations()).toHaveLength(0);
    },
  );

  it('does not invalidate unchanged object caches on an inactive-pool refusal', async () => {
    mockSap(metadata('PROG', 'ZTEST', 'inactive'));
    const invalidateWrittenObject = vi.fn();
    const ctx = {
      client: createClient(),
      type: 'PROG',
      name: 'ZTEST',
      objectUrl: '/sap/bc/adt/programs/programs/ztest',
      enforcePackageForExistingObject: vi.fn().mockResolvedValue('$TMP'),
      invalidateWrittenObject,
    } as unknown as SapWriteContext;
    await expect(writeActionDelete(ctx)).rejects.toMatchObject({ statusCode: 409 });
    expect(invalidateWrittenObject).not.toHaveBeenCalled();
  });

  it('does not add pool requests to CLAS deletion', async () => {
    mockSap();
    expect((await del('CLAS')).isError).toBeUndefined();
    expect(steps()).toEqual(['LOCK', 'DELETE', 'UNLOCK']);
  });
});
