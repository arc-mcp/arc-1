import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import {
  getServerDrivenObject,
  isServerDrivenObjectType,
  SDO_REGISTRY,
  supportsServerDrivenObject,
} from '../../../src/adt/server-driven.js';
import { parseBlueSource } from '../../../src/adt/xml-parser.js';

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
});
