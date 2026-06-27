/**
 * buildCreateXml — BTP/Steampunk cloud-mode corrections (G-3).
 *
 * Live-verified on BTP SAP_BASIS 919: the object-create simple transformations reject
 * `adtcore:responsible` and the on-prem `adtcore:masterSystem`, and require
 * `adtcore:abapLanguageVersion="cloudDevelopment"` (plus explicit class attributes for CLAS).
 * On-prem output must be byte-for-byte unchanged.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import type { ResolvedFeatures } from '../../../src/adt/types.js';
import { resetCachedFeatures, setCachedFeatures } from '../../../src/handlers/feature-cache.js';
import {
  buildCreateXml,
  createContentTypeForType,
  mergeMetadataWriteProperties,
  resolveWriteSystemType,
} from '../../../src/handlers/write-helpers.js';
import type { ServerConfig } from '../../../src/server/types.js';

describe('buildCreateXml — cloud mode (G-3)', () => {
  describe('on-prem (cloud=false) is unchanged', () => {
    it('CLAS keeps masterSystem + responsible and omits the cloud attributes', () => {
      const xml = buildCreateXml('CLAS', 'ZCL_X', 'ZPKG', 'desc', undefined, 'EN', 'MARIAN', false);
      expect(xml).toContain('adtcore:masterSystem="H00"');
      expect(xml).toContain('adtcore:responsible="MARIAN"');
      expect(xml).not.toContain('abapLanguageVersion');
      expect(xml).not.toContain('class:final');
    });

    it('BDEF (RAP) keeps masterSystem + responsible and omits the cloud attributes', () => {
      const xml = buildCreateXml('BDEF', 'ZBD_X', 'ZPKG', 'desc', undefined, 'EN', 'MARIAN', false);
      expect(xml).toContain('adtcore:masterSystem="H00"');
      expect(xml).toContain('adtcore:responsible="MARIAN"');
      expect(xml).not.toContain('abapLanguageVersion');
    });
  });

  describe('cloud (cloud=true)', () => {
    it('CLAS drops masterSystem + responsible, adds cloud language version + class attributes', () => {
      const xml = buildCreateXml('CLAS', 'ZCL_X', 'ZPKG', 'desc', undefined, 'EN', 'marian@zeis.de', true);
      expect(xml).not.toContain('masterSystem');
      expect(xml).not.toContain('responsible'); // cloud assigns the owner from the JWT
      expect(xml).toContain('adtcore:abapLanguageVersion="cloudDevelopment"');
      expect(xml).toContain('class:final="true"');
      expect(xml).toContain('class:visibility="public"');
      expect(xml).toContain('class:category="generalObjectType"');
    });

    it('INTF drops masterSystem + responsible and adds the cloud language version', () => {
      const xml = buildCreateXml('INTF', 'ZIF_X', 'ZPKG', 'desc', undefined, 'EN', 'marian@zeis.de', true);
      expect(xml).not.toContain('masterSystem');
      expect(xml).not.toContain('responsible');
      expect(xml).toContain('adtcore:abapLanguageVersion="cloudDevelopment"');
      expect(xml).not.toContain('class:final'); // class attributes are CLAS-only
    });

    it('DDLS (CDS source) gets the cloud language version', () => {
      const xml = buildCreateXml('DDLS', 'ZCDS_X', 'ZPKG', 'desc', undefined, 'EN', 'marian@zeis.de', true);
      expect(xml).not.toContain('masterSystem');
      expect(xml).not.toContain('responsible');
      expect(xml).toContain('adtcore:abapLanguageVersion="cloudDevelopment"');
    });

    it('DTEL (builder path) also drops masterSystem + responsible and adds the cloud language version', () => {
      const xml = buildCreateXml(
        'DTEL',
        'ZDT_X',
        'ZPKG',
        'desc',
        { typeKind: 'predefinedAbapType', dataType: 'CHAR', length: 10 },
        'EN',
        'marian@zeis.de',
        true,
      );
      expect(xml).not.toContain('masterSystem');
      expect(xml).not.toContain('responsible');
      expect(xml).toContain('adtcore:abapLanguageVersion="cloudDevelopment"');
    });

    it('BDEF (RAP behavior definition) drops masterSystem + responsible and adds the cloud language version', () => {
      const xml = buildCreateXml('BDEF', 'ZBD_X', 'ZPKG', 'desc', undefined, 'EN', 'marian@zeis.de', true);
      expect(xml).not.toContain('masterSystem');
      expect(xml).not.toContain('responsible');
      expect(xml).toContain('adtcore:abapLanguageVersion="cloudDevelopment"');
    });

    it('SRVD (service definition) drops masterSystem + responsible and adds the cloud language version', () => {
      const xml = buildCreateXml('SRVD', 'ZSRVD_X', 'ZPKG', 'desc', undefined, 'EN', 'marian@zeis.de', true);
      expect(xml).not.toContain('masterSystem');
      expect(xml).not.toContain('responsible');
      expect(xml).toContain('adtcore:abapLanguageVersion="cloudDevelopment"');
    });

    it('SRVB (service binding) drops responsible and adds the cloud language version', () => {
      const xml = buildCreateXml(
        'SRVB',
        'ZSB_X',
        'ZPKG',
        'desc',
        { serviceDefinition: 'ZSRVD_X' },
        'EN',
        'marian@zeis.de',
        true,
      );
      expect(xml).not.toContain('responsible');
      expect(xml).toContain('adtcore:abapLanguageVersion="cloudDevelopment"');
    });
  });
});

describe('resolveWriteSystemType (G-3, Codex #1)', () => {
  const cfg = (systemType: string) => ({ systemType }) as unknown as ServerConfig;
  const client = (usesBearerAuth: boolean) => ({ usesBearerAuth }) as unknown as AdtClient;
  afterEach(() => resetCachedFeatures());

  it('prefers the probed feature cache', () => {
    setCachedFeatures({ systemType: 'btp' } as unknown as ResolvedFeatures);
    expect(resolveWriteSystemType(cfg('auto'), client(false))).toBe('btp');
  });

  it('uses an explicit non-auto config when the probe has not resolved', () => {
    expect(resolveWriteSystemType(cfg('onprem'), client(true))).toBe('onprem');
  });

  it('falls back to btp for bearer auth when unresolved — so BTP creates never emit on-prem XML', () => {
    expect(resolveWriteSystemType(cfg('auto'), client(true))).toBe('btp');
  });

  it('returns undefined when unresolved and not bearer auth (on-prem)', () => {
    expect(resolveWriteSystemType(cfg('auto'), client(false))).toBeUndefined();
  });
});

describe('createContentTypeForType — cloud INTF content-type (review fix)', () => {
  it('uses the v5 interfaces content-type for cloud INTF create', () => {
    // application/* routes cloud INTF to an older ST that drops abapLanguageVersion → 500. Live-verified 919.
    expect(createContentTypeForType('INTF', true)).toBe('application/vnd.sap.adt.oo.interfaces.v5+xml');
  });

  it('keeps application/* for on-prem INTF create (unchanged)', () => {
    expect(createContentTypeForType('INTF', false)).toBe('application/*');
    expect(createContentTypeForType('INTF')).toBe('application/*');
  });

  it('does not change CLAS (works with application/* on cloud)', () => {
    expect(createContentTypeForType('CLAS', true)).toBe('application/*');
  });

  it('needs no cloud override for RAP types (live-verified 919: BDEF/SRVD/SRVB create 201 as-is)', () => {
    expect(createContentTypeForType('BDEF', true)).toBe('application/vnd.sap.adt.blues.v1+xml');
    expect(createContentTypeForType('SRVD', true)).toBe('application/*');
    expect(createContentTypeForType('SRVB', true)).toBe('application/*');
  });
});

describe('mergeMetadataWriteProperties — DOMA outputLength follows a length change (review fix)', () => {
  const stubClient = (existing: Record<string, unknown>) =>
    ({ getDomain: async () => existing }) as unknown as AdtClient;
  const base = { description: 'd', package: 'P', dataType: 'CHAR', length: 10, outputLength: 10 };

  it('defaults outputLength to a changed length when not provided (avoids SAP output-length warning)', async () => {
    const merged = await mergeMetadataWriteProperties(stubClient(base), 'DOMA', 'ZDOMA', { length: 20 });
    expect(merged.outputLength).toBe(20);
    expect(merged.length).toBe(20);
  });

  it('keeps the existing outputLength when length is unchanged', async () => {
    const merged = await mergeMetadataWriteProperties(stubClient({ ...base, outputLength: 8 }), 'DOMA', 'ZDOMA', {
      description: 'new',
    });
    expect(merged.outputLength).toBe(8);
  });

  it('respects an explicit outputLength', async () => {
    const merged = await mergeMetadataWriteProperties(stubClient(base), 'DOMA', 'ZDOMA', {
      length: 20,
      outputLength: 15,
    });
    expect(merged.outputLength).toBe(15);
  });
});
