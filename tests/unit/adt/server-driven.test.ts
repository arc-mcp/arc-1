import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtSafetyError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { type SafetyConfig, unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import {
  buildServerDrivenMetadataXml,
  createServerDrivenObject,
  deleteServerDrivenObject,
  ensureServerDrivenSupport,
  getServerDrivenObject,
  isServerDrivenObjectType,
  SDO_REGISTRY,
  serverDrivenObjectUrl,
  serverDrivenSourceContentType,
  supportsServerDrivenObject,
  updateServerDrivenObjectSource,
} from '../../../src/adt/server-driven.js';
import { parseServerDrivenMetadata } from '../../../src/adt/xml-parser.js';

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

describe('parseServerDrivenMetadata', () => {
  it('parses DESD metadata (name/type/description/package/language)', () => {
    const m = parseServerDrivenMetadata(DESD_META, 'blueSource');
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
    const m = parseServerDrivenMetadata(EVTB_META, 'blueSource');
    expect(m.name).toBe('S_BUSINESSPARTNER_CHANGE');
    expect(m.type).toBe('EVTB/EVB');
    expect(m.package).toBe('MDC_BUPA_BO');
  });

  it('parses DTDC metadata from the dtdc:dtdcSource root (non-blue format)', () => {
    const DTDC_META =
      '<?xml version="1.0" encoding="utf-8"?><dtdc:dtdcSource adtcore:responsible="SAP" adtcore:masterLanguage="EN" adtcore:abapLanguageVersion="cloudDevelopment" adtcore:name="DEMO_DDIC_DYNAMIC_CACHE" adtcore:type="DTDC/DF" adtcore:version="active" adtcore:description="Demo Dynamic Cache" xmlns:dtdc="http://www.sap.com/adt/ddic/dtdcsources" xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="SABAP_DEMOS"/></dtdc:dtdcSource>';
    const m = parseServerDrivenMetadata(DTDC_META, 'dtdcSource');
    expect(m.name).toBe('DEMO_DDIC_DYNAMIC_CACHE');
    expect(m.type).toBe('DTDC/DF');
    expect(m.description).toBe('Demo Dynamic Cache');
    expect(m.package).toBe('SABAP_DEMOS');
    expect(m.abapLanguageVersion).toBe('cloudDevelopment');
  });

  it('returns empty name/type for an unrelated root and omits empty optionals', () => {
    const m = parseServerDrivenMetadata('<other/>', 'blueSource');
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

/**
 * The gate used to be consulted synchronously, so a cold discovery map (always, in the CLI) let the
 * call through and surfaced a raw 404 with a misleading "verify the name exists" hint.
 */
describe('ensureServerDrivenSupport', () => {
  /** `has` controls whether the served discovery doc advertises ddic/desd with the blues accept. */
  function mockHttp(opts: { loaded: boolean; has?: boolean; getThrows?: boolean }) {
    const doc =
      '<?xml version="1.0"?><app:service xmlns:app="http://www.w3.org/2007/app" ' +
      'xmlns:atom="http://www.w3.org/2005/Atom"><app:workspace><atom:title>W</atom:title>' +
      (opts.has
        ? '<app:collection href="/sap/bc/adt/ddic/desd"><atom:title>D</atom:title>' +
          '<app:accept>application/vnd.sap.adt.blues.v1+xml</app:accept></app:collection>'
        : '<app:collection href="/sap/bc/adt/programs/programs"><atom:title>P</atom:title>' +
          '<app:accept>text/plain</app:accept></app:collection>') +
      '</app:workspace></app:service>';
    const get = vi.fn(async () => {
      if (opts.getThrows) throw new AdtApiError('discovery forbidden', 403, '/sap/bc/adt/discovery');
      return { statusCode: 200, headers: {}, body: doc };
    });
    return {
      http: {
        get,
        hasDiscoveryData: () => opts.loaded,
        discoveryAcceptFor: (path: string) =>
          opts.loaded && path === '/sap/bc/adt/ddic/desd' ? 'application/vnd.sap.adt.blues.v1+xml' : undefined,
        setDiscoveryMap: vi.fn(),
      } as unknown as AdtHttpClient,
      get,
    };
  }

  it('uses the already-loaded map without fetching discovery', async () => {
    const { http, get } = mockHttp({ loaded: true });
    await expect(ensureServerDrivenSupport(http, unrestrictedSafetyConfig(), 'DESD')).resolves.toBe(true);
    expect(get).not.toHaveBeenCalled();
  });

  it('fetches discovery when cold, then reports the type as unavailable on that release', async () => {
    const { http, get } = mockHttp({ loaded: false, has: false });
    await expect(ensureServerDrivenSupport(http, unrestrictedSafetyConfig(), 'DESD')).resolves.toBe(false);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('fetches discovery when cold, then reports the type as available', async () => {
    const { http } = mockHttp({ loaded: false, has: true });
    await expect(ensureServerDrivenSupport(http, unrestrictedSafetyConfig(), 'DESD')).resolves.toBe(true);
  });

  it('never stores the fetched map — server.ts re-injects per call, and sharing it would leak per-user capabilities', async () => {
    const { http } = mockHttp({ loaded: false, has: true });
    await ensureServerDrivenSupport(http, unrestrictedSafetyConfig(), 'DESD');
    expect(http.setDiscoveryMap).not.toHaveBeenCalled();
  });

  it('proceeds when discovery itself is unreachable — the gate is an error-message affordance, not a control', async () => {
    const { http } = mockHttp({ loaded: false, getThrows: true });
    await expect(ensureServerDrivenSupport(http, unrestrictedSafetyConfig(), 'DESD')).resolves.toBe(true);
  });

  it('rejects an unknown code without paying for a discovery round-trip', async () => {
    const { http, get } = mockHttp({ loaded: false, has: true });
    await expect(ensureServerDrivenSupport(http, unrestrictedSafetyConfig(), 'NOPE')).resolves.toBe(false);
    expect(get).not.toHaveBeenCalled();
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
  it('every entry carries a createType and a metadata content-type', () => {
    for (const e of Object.values(SDO_REGISTRY)) {
      expect(e.createType).toMatch(/^[A-Z]{4}\/[A-Z]+$/);
      expect(e.metadataContentType).toMatch(/^application\/vnd\.sap\.adt\./);
    }
  });

  it('the blue family uses blues content types (EVTO v2, rest v1); DTDC uses its own (verified live)', () => {
    expect(SDO_REGISTRY.EVTO.metadataContentType).toContain('blues.v2');
    expect(SDO_REGISTRY.UIAD.metadataContentType).toContain('blues.v2');
    for (const code of ['DESD', 'DTSC', 'CSNM', 'EVTB', 'COTA', 'DSFD'] as const) {
      expect(SDO_REGISTRY[code].metadataContentType).toContain('blues.v1');
      expect(SDO_REGISTRY[code].discoveryMarker).toBe('blues');
    }
    expect(SDO_REGISTRY.DTDC.metadataContentType).toBe('application/vnd.sap.adt.ddic.dtdc.v1+xml');
    expect(SDO_REGISTRY.DTDC.discoveryMarker).toBe('dtdc');
    expect(SDO_REGISTRY.DTDC.metadataRootLocalName).toBe('dtdcSource');
  });

  it('createType is not uniformly /TYP (EVTB → EVTB/EVB)', () => {
    expect(SDO_REGISTRY.EVTB.createType).toBe('EVTB/EVB');
    expect(SDO_REGISTRY.DESD.createType).toBe('DESD/TYP');
  });

  // Regression guard for the 2026-07-21 fix: the source PUT content type used to be a single
  // hardcoded 'application/json' for every type, which SAP answers with 415 for the DDL-text
  // ones — DTSC write was dead on arrival. Content types live-verified per type on 816.
  it('maps each type to the source content type SAP actually accepts (live-verified 816)', () => {
    for (const code of ['DESD', 'CSNM', 'EVTB', 'EVTO', 'COTA'] as const) {
      expect(serverDrivenSourceContentType(code)).toBe('application/json');
    }
    for (const code of ['DTSC', 'DSFD', 'DTDC'] as const) {
      expect(serverDrivenSourceContentType(code)).toBe('text/plain');
    }
  });
});

// DTDC is the first NON-blue server-driven type. These lock down that the generalized engine paths
// use DTDC's own metadata format end-to-end and never fall back to blue:blueSource / blues content
// types — the whole point of "generalize off blue-only".
describe('DTDC engine paths (non-blue server-driven type)', () => {
  const DTDC_META =
    '<?xml version="1.0" encoding="utf-8"?><dtdc:dtdcSource adtcore:name="DEMO_DDIC_DYNAMIC_CACHE" adtcore:type="DTDC/DF" adtcore:description="Demo Dynamic Cache" xmlns:dtdc="http://www.sap.com/adt/ddic/dtdcsources" xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="SABAP_DEMOS"/></dtdc:dtdcSource>';
  const DTDC_SRC = 'define dynamic cache DEMO_DDIC_DYNAMIC_CACHE on demo_ddic_types { char1 }';

  it('isServerDrivenObjectType(DTDC) is true', () => {
    expect(isServerDrivenObjectType('DTDC')).toBe(true);
  });

  it('serverDrivenSourceContentType(DTDC) is text/plain (DDL source)', () => {
    expect(serverDrivenSourceContentType('DTDC')).toBe('text/plain');
  });

  it('supportsServerDrivenObject: true when the DTDC collection advertises the dtdc accept', () => {
    const http = {
      hasDiscoveryData: () => true,
      discoveryAcceptFor: (p: string) =>
        p === '/sap/bc/adt/ddic/dtdc/sources' ? 'application/vnd.sap.adt.ddic.dtdc.v1+xml, text/html' : undefined,
    } as unknown as AdtHttpClient;
    expect(supportsServerDrivenObject(http, 'DTDC')).toBe(true);
  });

  it('supportsServerDrivenObject: false when the DTDC collection advertises only a non-dtdc accept', () => {
    const http = {
      hasDiscoveryData: () => true,
      // e.g. a blues accept on the dtdc href would NOT match DTDC's discoveryMarker ('dtdc').
      discoveryAcceptFor: (p: string) =>
        p === '/sap/bc/adt/ddic/dtdc/sources' ? 'application/vnd.sap.adt.blues.v1+xml' : undefined,
    } as unknown as AdtHttpClient;
    expect(supportsServerDrivenObject(http, 'DTDC')).toBe(false);
  });

  it('getServerDrivenObject(DTDC) uses the dtdc Accept and parses <dtdc:dtdcSource> (DDL source kept raw)', async () => {
    const http = mockHttp((p) => (p.endsWith('/source/main') ? { body: DTDC_SRC } : { body: DTDC_META }));
    const r = await getServerDrivenObject(http, unrestrictedSafetyConfig(), 'DTDC', 'DEMO_DDIC_DYNAMIC_CACHE');
    expect(r.type).toBe('DTDC/DF');
    expect(r.package).toBe('SABAP_DEMOS');
    expect(r.source).toBe(DTDC_SRC); // DDL text, not JSON-parsed
    expect(http.get).toHaveBeenCalledWith(
      '/sap/bc/adt/ddic/dtdc/sources/DEMO_DDIC_DYNAMIC_CACHE',
      expect.objectContaining({ Accept: 'application/vnd.sap.adt.ddic.dtdc.v1+xml' }),
    );
  });

  it('createServerDrivenObject(DTDC) POSTs the dtdc collection with the dtdc content-type + <dtdc:dtdcSource> body', async () => {
    const { http, calls } = mockWriteHttp();
    await createServerDrivenObject(http, unrestrictedSafetyConfig(), 'DTDC', 'ZDYN', {
      package: '$TMP',
      description: 'd',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/sap/bc/adt/ddic/dtdc/sources',
      contentType: 'application/vnd.sap.adt.ddic.dtdc.v1+xml',
    });
    expect(calls[0].body).toContain('<dtdc:dtdcSource');
    expect(calls[0].body).toContain('adtcore:type="DTDC/DF"');
    expect(calls[0].body).not.toContain('blue:blueSource');
  });

  it('updateServerDrivenObjectSource(DTDC) PUTs the DDL source as text/plain', async () => {
    const { http, calls } = mockWriteHttp();
    await updateServerDrivenObjectSource(http, unrestrictedSafetyConfig(), 'DTDC', 'ZDYN', DTDC_SRC);
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toContain('/sap/bc/adt/ddic/dtdc/sources/ZDYN/source/main');
    expect(put.contentType).toBe('text/plain');
    expect(put.body).toBe(DTDC_SRC);
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

describe('buildServerDrivenMetadataXml', () => {
  it('emits the per-type createType, packageRef, and escapes the description', () => {
    const xml = buildServerDrivenMetadataXml('EVTB', 'ZEVT', '$TMP', 'A & B "x"');
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
    for (const code of ['DESD', 'DTSC', 'CSNM', 'EVTB', 'EVTO', 'COTA', 'DSFD', 'DTDC', 'UIAD']) {
      expect(buildServerDrivenMetadataXml(code, 'Z', '$TMP', 'd')).not.toContain('masterLanguage');
    }
  });
  it('throws AdtApiError for an unknown code', () => {
    expect(() => buildServerDrivenMetadataXml('NOPE', 'Z', '$TMP', 'd')).toThrow(AdtApiError);
  });

  it('emits the DTDC root element + namespace (not blue) for the non-blue type', () => {
    const xml = buildServerDrivenMetadataXml('DTDC', 'ZDYN', '$TMP', 'd');
    expect(xml).toContain('<dtdc:dtdcSource xmlns:dtdc="http://www.sap.com/adt/ddic/dtdcsources"');
    expect(xml).toContain('adtcore:type="DTDC/DF"');
    expect(xml).toContain('</dtdc:dtdcSource>');
    expect(xml).not.toContain('blue:blueSource');
  });
  it('emits a cloud-safe create body for every type — no responsible/masterSystem/abapLanguageVersion (BTP)', () => {
    // BTP/Steampunk create simple-transformations reject adtcore:responsible/masterSystem; the cloud
    // assigns the owner from the JWT. SDO bodies carry none by construction (no cloudify needed) —
    // live-verified that all six deserialize and reach package-assignment on BTP 919. Lock the contract
    // so a refactor can't reintroduce a cloud-hostile attribute. See btp-abap.integration.test.ts.
    const reg = SDO_REGISTRY as Record<string, { createType: string }>;
    for (const code of Object.keys(reg)) {
      const xml = buildServerDrivenMetadataXml(code, 'ZARC1_SDO', 'ZPKG', 'd');
      expect(xml).not.toContain('adtcore:responsible');
      expect(xml).not.toContain('adtcore:masterSystem');
      expect(xml).not.toContain('abapLanguageVersion');
      expect(xml).toContain(`adtcore:type="${reg[code].createType}"`);
      expect(xml).toContain('<adtcore:packageRef adtcore:name="ZPKG"/>');
    }
  });
});

describe('createServerDrivenObject', () => {
  it('POSTs the collection href with the entry metadata content-type and the blue-family body', async () => {
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
  it('locks → PUTs /source/main as the type\u2019s source content type → unlocks (in order)', async () => {
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

  it('PUTs a DDL-text type (DTSC) as text/plain, not application/json', async () => {
    const { http, calls } = mockWriteHttp();
    const ddl = 'define static cache ZC on DEMO_CDS_CUBE_VIEW { sum( amount_sum ) } retention 60 s;';
    await updateServerDrivenObjectSource(http, unrestrictedSafetyConfig(), 'DTSC', 'ZC', ddl);
    const put = calls.find((c) => c.method === 'PUT')!;
    // application/json here is a hard 415 from SAP — live-verified on 816.
    expect(put.contentType).toBe('text/plain');
    expect(put.body).toBe(ddl);
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
