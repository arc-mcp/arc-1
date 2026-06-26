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
import { buildCreateXml, resolveWriteSystemType } from '../../../src/handlers/write-helpers.js';
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
