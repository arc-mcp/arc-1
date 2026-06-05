import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtSafetyError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { type SafetyConfig, unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import {
  buildBlueSourceXml,
  createServerDrivenObject,
  deleteServerDrivenObject,
  getServerDrivenObject,
  isServerDrivenObjectType,
  SDO_REGISTRY,
  serverDrivenObjectUrl,
  supportsServerDrivenObject,
  updateServerDrivenObjectSource,
} from '../../../src/adt/server-driven.js';
import { parseBlueSource } from '../../../src/adt/xml-parser.js';

const readOnlySafety = (): SafetyConfig => ({ ...unrestrictedSafetyConfig(), allowWrites: false });

/** Mock http for WRITE flows — records calls; lock POSTs return a parsable lock handle. */
function mockWriteHttp(overrides: { putThrows?: boolean; unlockThrows?: boolean } = {}): {
  http: AdtHttpClient;
  calls: Array<{ method: string; path: string; body?: string; contentType?: string }>;
} {
  const calls: Array<{ method: string; path: string; body?: string; contentType?: string }> = [];
  const lockBody = '<asx:abap><LOCK_HANDLE>LH123</LOCK_HANDLE><CORRNR></CORRNR></asx:abap>';
  const http = {
    post: vi.fn(async (path: string, body?: string, contentType?: string) => {
      calls.push({ method: 'POST', path, body, contentType });
      if (path.includes('_action=LOCK')) return { statusCode: 200, headers: {}, body: lockBody };
      if (path.includes('_action=UNLOCK') && overrides.unlockThrows) throw new AdtApiError('unlock failed', 404, path);
      return { statusCode: 201, headers: {}, body: 'created' };
    }),
    put: vi.fn(async (path: string, body?: string, contentType?: string) => {
      calls.push({ method: 'PUT', path, body, contentType });
      if (overrides.putThrows) throw new AdtApiError('put failed', 400, path);
      return { statusCode: 200, headers: {}, body: '' };
    }),
    delete: vi.fn(async (path: string) => {
      calls.push({ method: 'DELETE', path });
      return { statusCode: 200, headers: {}, body: '' };
    }),
    get: vi.fn(async (path: string) => {
      calls.push({ method: 'GET', path });
      return { statusCode: 200, headers: {}, body: '' };
    }),
    withStatefulSession: vi.fn(async (cb: (s: unknown) => Promise<unknown>) => cb(http)),
  };
  return { http: http as unknown as AdtHttpClient, calls };
}

const fx = (f: string): string => readFileSync(new URL(`../../fixtures/sdo/${f}`, import.meta.url), 'utf-8');
const DESD_META = fx('sdo-desd-metadata.xml');
const DESD_SRC = fx('sdo-desd-source.json');
const EVTB_META = fx('sdo-evtb-metadata.xml');
const EVTB_SRC = fx('sdo-evtb-source.json');
const asObj = (v: unknown): Record<string, unknown> => v as Record<string, unknown>;

/** Mock http whose get() returns a body chosen by the request path. */
function mockHttp(resolve: (path: string) => { statusCode?: number; body: string }): AdtHttpClient {
  return {
    get: vi.fn(async (path: string) => ({ statusCode: 200, headers: {}, ...resolve(path) })),
  } as unknown as AdtHttpClient;
}

describe('parseBlueSource', () => {
  it('parses DESD metadata (name/type/description/package/language)', () => {
    const m = parseBlueSource(DESD_META);
    expect(m.name).toBe('DEMO_CDS_LOGICL_EXTERNL_SCHEMA');
    expect(m.type).toBe('DESD/TYP');
    expect(m.description).toBe('Demo CDS Logical External Schema');
    expect(m.package).toBe('SABAP_DEMOS_ABAP_CDS_CLOUD');
    expect(m.masterLanguage).toBe('EN');
    expect(m.abapLanguageVersion).toBe('cloudDevelopment');
    expect(m.responsible).toBe('SAP');
    expect(m.version).toBe('active');
  });

  it('parses EVTB metadata (RAP event binding)', () => {
    const m = parseBlueSource(EVTB_META);
    expect(m.name).toBe('S_BUSINESSPARTNER_CHANGE');
    expect(m.type).toBe('EVTB/EVB');
    expect(m.package).toBe('MDC_BUPA_BO');
  });

  it('returns empty name/type for an unrelated root and omits empty optionals', () => {
    const m = parseBlueSource('<other/>');
    expect(m.name).toBe('');
    expect(m.type).toBe('');
    expect(m.package).toBeUndefined();
    expect(m.description).toBeUndefined();
  });
});

describe('SDO registry + gate', () => {
  it('isServerDrivenObjectType', () => {
    expect(isServerDrivenObjectType('DESD')).toBe(true);
    expect(isServerDrivenObjectType('EVTB')).toBe(true);
    expect(isServerDrivenObjectType('PROG')).toBe(false);
  });

  it('every registry href is an absolute ADT path', () => {
    for (const { href } of Object.values(SDO_REGISTRY)) expect(href.startsWith('/sap/bc/adt/')).toBe(true);
  });

  it('supportsServerDrivenObject: undefined when discovery is not loaded', () => {
    const http = { hasDiscoveryData: () => false, discoveryAcceptFor: () => undefined } as unknown as AdtHttpClient;
    expect(supportsServerDrivenObject(http, 'DESD')).toBeUndefined();
  });

  it('supportsServerDrivenObject: true when the collection advertises blues (816)', () => {
    const http = {
      hasDiscoveryData: () => true,
      discoveryAcceptFor: (p: string) =>
        p === '/sap/bc/adt/ddic/desd' ? 'application/vnd.sap.adt.blues.v1+xml, text/html' : undefined,
    } as unknown as AdtHttpClient;
    expect(supportsServerDrivenObject(http, 'DESD')).toBe(true);
  });

  it('supportsServerDrivenObject: false when the collection is absent (758) or the code is unknown', () => {
    const http = { hasDiscoveryData: () => true, discoveryAcceptFor: () => undefined } as unknown as AdtHttpClient;
    expect(supportsServerDrivenObject(http, 'DESD')).toBe(false);
    expect(supportsServerDrivenObject(http, 'NOPE')).toBe(false);
  });
});

describe('getServerDrivenObject', () => {
  it('reads DESD metadata + JSON source via the two GETs', async () => {
    const http = mockHttp((p) => (p.endsWith('/source/main') ? { body: DESD_SRC } : { body: DESD_META }));
    const r = await getServerDrivenObject(http, unrestrictedSafetyConfig(), 'DESD', 'DEMO_CDS_LOGICL_EXTERNL_SCHEMA');
    expect(r.type).toBe('DESD/TYP');
    expect(r.package).toBe('SABAP_DEMOS_ABAP_CDS_CLOUD');
    expect(asObj(r.source).formatVersion).toBe('1');
    expect(String(asObj(asObj(r.source).header).description)).toContain('Demo CDS');
    expect(http.get).toHaveBeenCalledWith(
      '/sap/bc/adt/ddic/desd/DEMO_CDS_LOGICL_EXTERNL_SCHEMA',
      expect.objectContaining({ Accept: 'application/vnd.sap.adt.blues.v1+xml' }),
    );
    expect(http.get).toHaveBeenCalledWith(
      '/sap/bc/adt/ddic/desd/DEMO_CDS_LOGICL_EXTERNL_SCHEMA/source/main',
      expect.anything(),
    );
  });

  it('parses EVTB source (boName + events)', async () => {
    const http = mockHttp((p) => (p.endsWith('/source/main') ? { body: EVTB_SRC } : { body: EVTB_META }));
    const r = await getServerDrivenObject(http, unrestrictedSafetyConfig(), 'EVTB', 'S_BUSINESSPARTNER_CHANGE');
    expect(r.type).toBe('EVTB/EVB');
    expect(asObj(r.source).boName).toBe('BusinessPartner');
    expect(Array.isArray(asObj(r.source).events)).toBe(true);
    expect((asObj(r.source).events as unknown[]).length).toBeGreaterThan(0);
  });

  it('url-encodes the object name', async () => {
    const http = mockHttp(() => ({ body: '<blue:blueSource adtcore:name="X"/>' }));
    await getServerDrivenObject(http, unrestrictedSafetyConfig(), 'COTA', 'A/B C');
    expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/conn/commtargets/A%2FB%20C', expect.anything());
  });

  it('keeps raw text when the source is not JSON', async () => {
    const http = mockHttp((p) => (p.endsWith('/source/main') ? { body: 'not json' } : { body: DESD_META }));
    const r = await getServerDrivenObject(http, unrestrictedSafetyConfig(), 'DESD', 'X');
    expect(r.source).toBe('not json');
  });

  it('throws AdtApiError for an unknown type code', async () => {
    const http = mockHttp(() => ({ body: '' }));
    await expect(getServerDrivenObject(http, unrestrictedSafetyConfig(), 'NOPE', 'X')).rejects.toBeInstanceOf(
      AdtApiError,
    );
  });

  it('uses the per-entry blues content-type for the metadata GET (EVTO → v2)', async () => {
    const http = mockHttp((p) => (p.endsWith('/source/main') ? { body: 'null' } : { body: '<blue:blueSource/>' }));
    await getServerDrivenObject(http, unrestrictedSafetyConfig(), 'EVTO', 'X');
    expect(http.get).toHaveBeenCalledWith(
      '/sap/bc/adt/businessservices/evtoevo/X',
      expect.objectContaining({ Accept: 'application/vnd.sap.adt.blues.v2+xml' }),
    );
  });
});

describe('SDO registry write metadata', () => {
  it('every entry carries a createType and a blues content-type', () => {
    for (const e of Object.values(SDO_REGISTRY)) {
      expect(e.createType).toMatch(/^[A-Z]{4}\/[A-Z]+$/);
      expect(e.blueContentType).toMatch(/^application\/vnd\.sap\.adt\.blues\.v[12]\+xml$/);
    }
  });

  it('EVTO uses blues v2; the others use v1 (verified live on 816)', () => {
    expect(SDO_REGISTRY.EVTO.blueContentType).toContain('v2');
    for (const code of ['DESD', 'DTSC', 'CSNM', 'EVTB', 'COTA']) {
      expect(SDO_REGISTRY[code].blueContentType).toContain('v1');
    }
  });

  it('createType is not uniformly /TYP (EVTB → EVTB/EVB)', () => {
    expect(SDO_REGISTRY.EVTB.createType).toBe('EVTB/EVB');
    expect(SDO_REGISTRY.DESD.createType).toBe('DESD/TYP');
  });
});

describe('serverDrivenObjectUrl', () => {
  it('builds collection href + url-encoded name', () => {
    expect(serverDrivenObjectUrl('DESD', 'A B')).toBe('/sap/bc/adt/ddic/desd/A%20B');
    expect(serverDrivenObjectUrl('COTA', 'A/B')).toBe('/sap/bc/adt/conn/commtargets/A%2FB');
  });
  it('throws AdtApiError for an unknown code', () => {
    expect(() => serverDrivenObjectUrl('NOPE', 'X')).toThrow(AdtApiError);
  });
});

describe('buildBlueSourceXml', () => {
  it('emits the per-type createType, packageRef, and escapes the description', () => {
    const xml = buildBlueSourceXml('EVTB', 'ZEVT', '$TMP', 'A & B "x"');
    expect(xml).toContain('adtcore:type="EVTB/EVB"');
    expect(xml).toContain('adtcore:name="ZEVT"');
    expect(xml).toContain('adtcore:description="A &amp; B &quot;x&quot;"');
    expect(xml).toContain('<adtcore:packageRef adtcore:name="$TMP"/>');
    expect(xml).not.toContain('masterLanguage');
  });
  it('never emits adtcore:masterLanguage — ADT ignores it for these objects (live-verified 816)', () => {
    // The create body deliberately omits masterLanguage: a4h-2025 (816) silently ignores it
    // (create with "DE" → object read back as the session language). Master language comes from
    // the sap-language request param (session = config.language), as with other source objects.
    for (const code of ['DESD', 'DTSC', 'CSNM', 'EVTB', 'EVTO', 'COTA']) {
      expect(buildBlueSourceXml(code, 'Z', '$TMP', 'd')).not.toContain('masterLanguage');
    }
  });
  it('throws AdtApiError for an unknown code', () => {
    expect(() => buildBlueSourceXml('NOPE', 'Z', '$TMP', 'd')).toThrow(AdtApiError);
  });
});

describe('createServerDrivenObject', () => {
  it('POSTs the collection href with the entry blues content-type and the blue body', async () => {
    const { http, calls } = mockWriteHttp();
    await createServerDrivenObject(http, unrestrictedSafetyConfig(), 'DESD', 'ZD', {
      package: '$TMP',
      description: 'demo',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/sap/bc/adt/ddic/desd',
      contentType: 'application/vnd.sap.adt.blues.v1+xml',
    });
    expect(calls[0].body).toContain('adtcore:type="DESD/TYP"');
  });

  it('EVTO posts with blues v2', async () => {
    const { http, calls } = mockWriteHttp();
    await createServerDrivenObject(http, unrestrictedSafetyConfig(), 'EVTO', 'ZE', {
      package: '$TMP',
      description: 'd',
    });
    expect(calls[0].contentType).toBe('application/vnd.sap.adt.blues.v2+xml');
  });

  it('appends ?corrNr= when a transport is supplied', async () => {
    const { http, calls } = mockWriteHttp();
    await createServerDrivenObject(http, unrestrictedSafetyConfig(), 'DESD', 'ZD', {
      package: 'ZPKG',
      description: 'd',
      transport: 'TR123',
    });
    expect(calls[0].path).toBe('/sap/bc/adt/ddic/desd?corrNr=TR123');
  });

  it('blocks when allowWrites=false (AdtSafetyError, no HTTP)', async () => {
    const { http, calls } = mockWriteHttp();
    await expect(
      createServerDrivenObject(http, readOnlySafety(), 'DESD', 'ZD', { package: '$TMP', description: 'd' }),
    ).rejects.toBeInstanceOf(AdtSafetyError);
    expect(calls).toHaveLength(0);
  });
});

describe('updateServerDrivenObjectSource', () => {
  it('locks → PUTs /source/main as application/json → unlocks (in order)', async () => {
    const { http, calls } = mockWriteHttp();
    await updateServerDrivenObjectSource(http, unrestrictedSafetyConfig(), 'DESD', 'ZD', '{"formatVersion":"1"}');
    const methods = calls.map((c) => `${c.method} ${c.path.split('?')[0]}`);
    expect(methods).toEqual([
      'POST /sap/bc/adt/ddic/desd/ZD', // lock
      'PUT /sap/bc/adt/ddic/desd/ZD/source/main',
      'POST /sap/bc/adt/ddic/desd/ZD', // unlock
    ]);
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.contentType).toBe('application/json');
    expect(put.path).toContain('lockHandle=LH123');
    expect(put.body).toBe('{"formatVersion":"1"}');
  });

  it('still unlocks when the PUT throws', async () => {
    const { http, calls } = mockWriteHttp({ putThrows: true });
    await expect(
      updateServerDrivenObjectSource(http, unrestrictedSafetyConfig(), 'DESD', 'ZD', '{}'),
    ).rejects.toBeInstanceOf(AdtApiError);
    expect(calls.some((c) => c.method === 'POST' && c.path.includes('_action=UNLOCK'))).toBe(true);
  });

  it('blocks when allowWrites=false', async () => {
    const { http, calls } = mockWriteHttp();
    await expect(updateServerDrivenObjectSource(http, readOnlySafety(), 'DESD', 'ZD', '{}')).rejects.toBeInstanceOf(
      AdtSafetyError,
    );
    expect(calls).toHaveLength(0);
  });
});

describe('deleteServerDrivenObject', () => {
  it('locks → DELETEs with lockHandle → unlocks', async () => {
    const { http, calls } = mockWriteHttp();
    await deleteServerDrivenObject(http, unrestrictedSafetyConfig(), 'CSNM', 'ZC');
    const del = calls.find((c) => c.method === 'DELETE')!;
    expect(del.path).toBe('/sap/bc/adt/csn/csnm/ZC?lockHandle=LH123');
    expect(calls.some((c) => c.method === 'POST' && c.path.includes('_action=UNLOCK'))).toBe(true);
  });

  it('tolerates an unlock failure after the delete', async () => {
    const { http } = mockWriteHttp({ unlockThrows: true });
    await expect(deleteServerDrivenObject(http, unrestrictedSafetyConfig(), 'CSNM', 'ZC')).resolves.toBeUndefined();
  });

  it('blocks when allowWrites=false', async () => {
    const { http, calls } = mockWriteHttp();
    await expect(deleteServerDrivenObject(http, readOnlySafety(), 'CSNM', 'ZC')).rejects.toBeInstanceOf(AdtSafetyError);
    expect(calls).toHaveLength(0);
  });
});
