import { Version } from '@abaplint/core';
import { describe, expect, it, vi } from 'vitest';
import type { FeatureConfig } from '../../../src/adt/config.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import {
  classifyAuthProbeError,
  classifyFeatureProbeStatus,
  detectHanaFromComponents,
  detectHanaFromDiscovery,
  detectSystemType,
  mapSapReleaseToAbaplintVersion,
  probeAuthorization,
  probeFeatures,
  probeTextSearch,
  resolveWithoutProbing,
} from '../../../src/adt/features.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';

describe('Feature Detection', () => {
  describe('resolveWithoutProbing', () => {
    it('forces all features on', () => {
      const config: FeatureConfig = {
        hana: 'on',
        abapGit: 'on',
        gcts: 'on',
        rap: 'on',
        amdp: 'on',
        ui5: 'on',
        transport: 'on',
        ui5repo: 'on',
        flp: 'on',
      };
      const result = resolveWithoutProbing(config);

      expect(result.hana.available).toBe(true);
      expect(result.hana.mode).toBe('on');
      expect(result.abapGit.available).toBe(true);
      expect(result.gcts.available).toBe(true);
      expect(result.rap.available).toBe(true);
    });

    it('forces all features off', () => {
      const config: FeatureConfig = {
        hana: 'off',
        abapGit: 'off',
        gcts: 'off',
        rap: 'off',
        amdp: 'off',
        ui5: 'off',
        transport: 'off',
        ui5repo: 'off',
        flp: 'off',
      };
      const result = resolveWithoutProbing(config);

      expect(result.hana.available).toBe(false);
      expect(result.hana.mode).toBe('off');
      expect(result.abapGit.available).toBe(false);
      expect(result.gcts.available).toBe(false);
    });

    it('auto defaults to unavailable without probing', () => {
      const config: FeatureConfig = {
        hana: 'auto',
        abapGit: 'auto',
        gcts: 'auto',
        rap: 'auto',
        amdp: 'auto',
        ui5: 'auto',
        transport: 'auto',
        ui5repo: 'auto',
        flp: 'auto',
      };
      const result = resolveWithoutProbing(config);

      expect(result.hana.available).toBe(false);
      expect(result.hana.mode).toBe('auto');
    });

    it('handles mixed modes', () => {
      const config: FeatureConfig = {
        hana: 'on',
        abapGit: 'off',
        gcts: 'auto',
        rap: 'auto',
        amdp: 'on',
        ui5: 'off',
        transport: 'auto',
        ui5repo: 'auto',
        flp: 'auto',
      };
      const result = resolveWithoutProbing(config);

      expect(result.hana.available).toBe(true);
      expect(result.abapGit.available).toBe(false);
      expect(result.gcts.available).toBe(false);
      expect(result.rap.available).toBe(false);
      expect(result.amdp.available).toBe(true);
      expect(result.ui5.available).toBe(false);
      expect(result.transport.available).toBe(false);
    });

    it('includes descriptive messages', () => {
      const config: FeatureConfig = {
        hana: 'on',
        abapGit: 'off',
        gcts: 'on',
        rap: 'auto',
        amdp: 'auto',
        ui5: 'auto',
        transport: 'auto',
        ui5repo: 'auto',
        flp: 'auto',
      };
      const result = resolveWithoutProbing(config);

      expect(result.hana.message).toContain('Forced on');
      expect(result.abapGit.message).toContain('Disabled');
      expect(result.gcts.message).toContain('Forced on');
      expect(result.rap.message).toContain('not available');
    });

    it('resolves ui5repo feature when forced on', () => {
      const config: FeatureConfig = {
        hana: 'auto',
        abapGit: 'auto',
        gcts: 'auto',
        rap: 'auto',
        amdp: 'auto',
        ui5: 'auto',
        transport: 'auto',
        ui5repo: 'on',
        flp: 'auto',
      };
      const result = resolveWithoutProbing(config);
      expect(result.ui5repo.available).toBe(true);
      expect(result.ui5repo.mode).toBe('on');
    });

    it('resolves ui5repo feature as unavailable in auto mode without probing', () => {
      const config: FeatureConfig = {
        hana: 'auto',
        abapGit: 'auto',
        gcts: 'auto',
        rap: 'auto',
        amdp: 'auto',
        ui5: 'auto',
        transport: 'auto',
        ui5repo: 'auto',
        flp: 'auto',
      };
      const result = resolveWithoutProbing(config);
      expect(result.ui5repo.available).toBe(false);
      expect(result.ui5repo.mode).toBe('auto');
      expect(result.ui5repo.message).toContain('not available');
    });

    it('resolves flp feature when forced on', () => {
      const config: FeatureConfig = {
        hana: 'auto',
        abapGit: 'auto',
        gcts: 'auto',
        rap: 'auto',
        amdp: 'auto',
        ui5: 'auto',
        transport: 'auto',
        ui5repo: 'auto',
        flp: 'on',
      };
      const result = resolveWithoutProbing(config);
      expect(result.flp.available).toBe(true);
      expect(result.flp.mode).toBe('on');
    });

    it('resolves flp feature as unavailable in auto mode without probing', () => {
      const config: FeatureConfig = {
        hana: 'auto',
        abapGit: 'auto',
        gcts: 'auto',
        rap: 'auto',
        amdp: 'auto',
        ui5: 'auto',
        transport: 'auto',
        ui5repo: 'auto',
        flp: 'auto',
      };
      const result = resolveWithoutProbing(config);
      expect(result.flp.available).toBe(false);
      expect(result.flp.mode).toBe('auto');
      expect(result.flp.message).toContain('not available');
    });
  });

  describe('mapSapReleaseToAbaplintVersion', () => {
    it('maps SAP_BASIS releases to correct abaplint versions', () => {
      expect(mapSapReleaseToAbaplintVersion('700')).toBe(Version.v700);
      expect(mapSapReleaseToAbaplintVersion('702')).toBe(Version.v702);
      expect(mapSapReleaseToAbaplintVersion('740')).toBe(Version.v740sp02);
      expect(mapSapReleaseToAbaplintVersion('750')).toBe(Version.v750);
      expect(mapSapReleaseToAbaplintVersion('751')).toBe(Version.v751);
      expect(mapSapReleaseToAbaplintVersion('752')).toBe(Version.v752);
      expect(mapSapReleaseToAbaplintVersion('753')).toBe(Version.v753);
      expect(mapSapReleaseToAbaplintVersion('754')).toBe(Version.v754);
      expect(mapSapReleaseToAbaplintVersion('755')).toBe(Version.v755);
      expect(mapSapReleaseToAbaplintVersion('756')).toBe(Version.v756);
      expect(mapSapReleaseToAbaplintVersion('757')).toBe(Version.v757);
      expect(mapSapReleaseToAbaplintVersion('758')).toBe(Version.v758);
    });

    it('maps releases >= 758 to v758', () => {
      expect(mapSapReleaseToAbaplintVersion('759')).toBe(Version.v758);
      expect(mapSapReleaseToAbaplintVersion('800')).toBe(Version.v758);
    });

    it('returns Cloud for non-numeric or empty input', () => {
      expect(mapSapReleaseToAbaplintVersion('')).toBe(Version.Cloud);
      expect(mapSapReleaseToAbaplintVersion('sap_btp')).toBe(Version.Cloud);
      expect(mapSapReleaseToAbaplintVersion('unknown')).toBe(Version.Cloud);
    });

    it('handles versions between known mappings', () => {
      // 710 is between 702 and 740, should map to 702
      expect(mapSapReleaseToAbaplintVersion('710')).toBe(Version.v702);
      // 745 is between 740 and 750, should map to v740sp02
      expect(mapSapReleaseToAbaplintVersion('745')).toBe(Version.v740sp02);
    });
  });

  // ─── System Type Detection ──────────────────────────────────────────

  describe('detectSystemType', () => {
    it('detects BTP when SAP_CLOUD component is present', () => {
      const components = [
        { name: 'SAP_BASIS', release: '758', description: 'SAP Basis' },
        { name: 'SAP_CLOUD', release: '100', description: 'SAP Cloud' },
        { name: 'DW4CORE', release: '100', description: 'DW4 Core' },
      ];
      expect(detectSystemType(components)).toBe('btp');
    });

    it('detects on-premise when SAP_ABA is present and no SAP_CLOUD', () => {
      const components = [
        { name: 'SAP_BASIS', release: '757', description: 'SAP Basis' },
        { name: 'SAP_ABA', release: '757', description: 'SAP Application Basis' },
        { name: 'SAP_UI', release: '757', description: 'SAP UI' },
      ];
      expect(detectSystemType(components)).toBe('onprem');
    });

    it('detects on-premise when components list is empty', () => {
      expect(detectSystemType([])).toBe('onprem');
    });

    it('detects on-premise for typical S/4HANA components', () => {
      const components = [
        { name: 'SAP_BASIS', release: '758', description: 'SAP Basis' },
        { name: 'SAP_ABA', release: '758', description: 'SAP Application Basis' },
        { name: 'S4CORE', release: '108', description: 'S/4HANA Core' },
      ];
      expect(detectSystemType(components)).toBe('onprem');
    });

    it('is case-insensitive for component names', () => {
      const components = [
        { name: 'sap_basis', release: '758', description: 'SAP Basis' },
        { name: 'sap_cloud', release: '100', description: 'SAP Cloud' },
      ];
      expect(detectSystemType(components)).toBe('btp');
    });
  });

  // ─── detectHanaFromComponents ──────────────────────────────────────

  describe('detectHanaFromComponents', () => {
    it('detects HANA when HDB component is present', () => {
      expect(detectHanaFromComponents([{ name: 'HDB' }])).toBe(true);
    });

    it('detects HANA when component name contains HANA', () => {
      expect(detectHanaFromComponents([{ name: 'HANA_XS' }])).toBe(true);
    });

    it('detects HANA via S4CORE (S/4HANA ≤ 2020)', () => {
      expect(detectHanaFromComponents([{ name: 'S4CORE' }])).toBe(true);
    });

    it('detects HANA via S4FND (S/4HANA 2021+)', () => {
      expect(detectHanaFromComponents([{ name: 'S4FND' }])).toBe(true);
    });

    it('detects HANA via S4CEXT', () => {
      expect(detectHanaFromComponents([{ name: 'S4CEXT' }])).toBe(true);
    });

    it('detects HANA via BW4CORE (BW/4HANA)', () => {
      expect(detectHanaFromComponents([{ name: 'BW4CORE' }])).toBe(true);
    });

    it('returns false when no HANA indicators are present', () => {
      expect(detectHanaFromComponents([{ name: 'SAP_BASIS' }, { name: 'SAP_ABA' }, { name: 'SAP_APPL' }])).toBe(false);
    });

    it('returns false for empty component list', () => {
      expect(detectHanaFromComponents([])).toBe(false);
    });

    it('is case-insensitive for component names', () => {
      expect(detectHanaFromComponents([{ name: 'hdb' }])).toBe(true);
      expect(detectHanaFromComponents([{ name: 'Hana_XS' }])).toBe(true);
      expect(detectHanaFromComponents([{ name: 's4fnd' }])).toBe(true);
      expect(detectHanaFromComponents([{ name: 'bw4core' }])).toBe(true);
    });

    it('does not false-positive on non-S/4 components starting with "S4"-adjacent text', () => {
      // S4 must be followed by an uppercase letter (checked after uppercasing input), so "S4" alone,
      // "S4" followed by a digit, or "SAP_S4" would not match. Only S/4HANA component naming fits.
      expect(detectHanaFromComponents([{ name: 'S4' }])).toBe(false);
      expect(detectHanaFromComponents([{ name: 'S40' }])).toBe(false);
      expect(detectHanaFromComponents([{ name: 'SAP_S4' }])).toBe(false);
    });

    it('detects HANA on a real-world S/4HANA 2023 on-prem component list (S4FND + MDG_FND)', () => {
      // Captured from /sap/bc/adt/system/components on an S/4HANA 2023 on-prem trial.
      // Notably absent: S4CORE, HDB, anything named HANA — the original heuristic missed this.
      expect(
        detectHanaFromComponents([
          { name: 'DMIS' },
          { name: 'HOME' },
          { name: 'LOCAL' },
          { name: 'MDG_FND' },
          { name: 'S4FND' },
          { name: 'SAP_ABA' },
          { name: 'SAP_BASIS' },
          { name: 'SAP_BW' },
          { name: 'SAP_GWFND' },
          { name: 'SAP_UI' },
          { name: 'ST-PI' },
          { name: 'UIBAS001' },
          { name: 'ZCUSTOM_DEVELOPMENT' },
          { name: 'ZLOCAL' },
        ]),
      ).toBe(true); // S4FND triggers the rule
    });

    it('returns false on real-world NetWeaver 7.50 SP02 trial (AnyDB / SAP MaxDB, no HANA)', () => {
      // Captured from the NPL 7.50 SP02 dev-edition trial system
      // (tests/fixtures/probe/npl-750-sp02-dev-edition/meta.json).
      // Regression guard: the heuristic must not false-positive on plain NetWeaver +
      // SAP_BW (BW on AnyDB ≠ BW/4HANA), and BI_CONT must not match HDB|HANA.
      expect(
        detectHanaFromComponents([
          { name: 'BI_CONT' },
          { name: 'DMIS' },
          { name: 'SAP_ABA' },
          { name: 'SAP_BASIS' },
          { name: 'SAP_BW' },
          { name: 'SAP_GWFND' },
          { name: 'SAP_UI' },
          { name: 'ST-PI' },
        ]),
      ).toBe(false);
    });
  });

  // ─── detectHanaFromDiscovery ───────────────────────────────────────

  describe('detectHanaFromDiscovery', () => {
    it('returns true when NHI is present', () => {
      expect(detectHanaFromDiscovery(true)).toBe(true);
    });

    it('returns false when NHI is absent', () => {
      expect(detectHanaFromDiscovery(false)).toBe(false);
    });
  });

  // ─── probeFeatures (with discovery) ───────────────────────────────

  describe('probeFeatures', () => {
    const defaultConfig: FeatureConfig = {
      hana: 'auto',
      abapGit: 'auto',
      gcts: 'auto',
      rap: 'auto',
      amdp: 'auto',
      ui5: 'auto',
      transport: 'auto',
      ui5repo: 'auto',
      flp: 'auto',
    };

    const componentsXml = `<?xml version="1.0" encoding="utf-8"?>
<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
  <atom:entry>
    <atom:id>SAP_BASIS</atom:id>
    <atom:title>758;SAPKB75801;0001;SAP Basis Component</atom:title>
  </atom:entry>
  <atom:entry>
    <atom:id>SAP_ABA</atom:id>
    <atom:title>758;SAPK-75801INSAPABA;0001;SAP Application Basis</atom:title>
  </atom:entry>
</atom:feed>`;

    const discoveryXml = `<?xml version="1.0" encoding="utf-8"?>
<app:service xmlns:app="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom">
  <app:workspace>
    <app:collection href="/sap/bc/adt/oo/classes">
      <app:accept>application/vnd.sap.adt.oo.classes.v4+xml</app:accept>
    </app:collection>
  </app:workspace>
</app:service>`;

    function mockProbeClient(options?: { discoveryFails?: boolean }): AdtHttpClient {
      return {
        get: vi.fn().mockImplementation((url: string) => {
          if (url === '/sap/bc/adt/discovery') {
            if (options?.discoveryFails) {
              return Promise.reject(new Error('Discovery unavailable'));
            }
            return Promise.resolve({ statusCode: 200, body: discoveryXml });
          }
          if (url === '/sap/bc/adt/system/components') {
            return Promise.resolve({ statusCode: 200, body: componentsXml });
          }
          return Promise.resolve({ statusCode: 200, body: '' });
        }),
      } as unknown as AdtHttpClient;
    }

    it('includes discovery map from startup probe', async () => {
      const client = mockProbeClient();
      const result = await probeFeatures(client, defaultConfig);

      expect(result.discoveryMap).toBeDefined();
      expect(result.discoveryMap?.get('/sap/bc/adt/oo/classes')).toEqual(['application/vnd.sap.adt.oo.classes.v4+xml']);
    });

    it('calls discovery endpoint as part of probeFeatures', async () => {
      const client = mockProbeClient();
      await probeFeatures(client, defaultConfig);

      expect((client as any).get).toHaveBeenCalledWith('/sap/bc/adt/discovery', {
        Accept: 'application/atomsvc+xml',
      });
    });

    it('does not fail feature probing when discovery request fails', async () => {
      const client = mockProbeClient({ discoveryFails: true });
      const result = await probeFeatures(client, defaultConfig);

      expect(result.hana.available).toBe(true);
      expect(result.textSearch?.available).toBe(true);
      expect(result.discoveryMap).toEqual(new Map());
    });

    it('sets discoveryMap to empty map when discovery fails', async () => {
      const client = mockProbeClient({ discoveryFails: true });
      const result = await probeFeatures(client, defaultConfig);

      expect(result.discoveryMap).toBeDefined();
      expect(result.discoveryMap?.size).toBe(0);
    });

    // ─── abapRelease fallback via /sap/bc/adt/abapsource/syntax/configurations ──

    const syntaxConfigurationsXml = `<?xml version="1.0" encoding="utf-8"?>
<abapsource:syntaxConfigurations xmlns:abapsource="http://www.sap.com/adt/abapsource">
  <abapsource:syntaxConfiguration>
    <abapsource:language>
      <abapsource:version>X</abapsource:version>
      <abapsource:description>Standard ABAP</abapsource:description>
      <atom:link href="/sap/bc/adt/abapsource/parsers/rnd/grammar" rel="http://www.sap.com/adt/relations/abapsource/parser" type="text/plain" title="Standard ABAP" etag="757" xmlns:atom="http://www.w3.org/2005/Atom"/>
    </abapsource:language>
  </abapsource:syntaxConfiguration>
</abapsource:syntaxConfigurations>`;

    const emptyComponentsFeed = `<?xml version="1.0" encoding="utf-8"?>
<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">
  <atom:title>Installed Components</atom:title>
</atom:feed>`;

    function mockProbeClientWithSyntaxConfigs(options: {
      componentsBody: string;
      syntaxConfigsBody?: string;
    }): AdtHttpClient {
      return {
        get: vi.fn().mockImplementation((url: string) => {
          if (url === '/sap/bc/adt/discovery') {
            return Promise.resolve({ statusCode: 200, body: discoveryXml });
          }
          if (url === '/sap/bc/adt/system/components') {
            return Promise.resolve({ statusCode: 200, body: options.componentsBody });
          }
          if (url === '/sap/bc/adt/abapsource/syntax/configurations') {
            return Promise.resolve({
              statusCode: 200,
              body: options.syntaxConfigsBody ?? syntaxConfigurationsXml,
            });
          }
          return Promise.resolve({ statusCode: 200, body: '' });
        }),
      } as unknown as AdtHttpClient;
    }

    it('falls back to syntax-configurations endpoint when components feed has no SAP_BASIS', async () => {
      const client = mockProbeClientWithSyntaxConfigs({ componentsBody: emptyComponentsFeed });
      const result = await probeFeatures(client, defaultConfig);

      expect(result.abapRelease).toBe('757');
      expect((client as any).get).toHaveBeenCalledWith('/sap/bc/adt/abapsource/syntax/configurations', {
        Accept: 'application/vnd.sap.adt.syntaxconfigurations+xml',
      });
    });

    it('skips syntax-configurations probe when components feed already yields a release', async () => {
      const client = mockProbeClientWithSyntaxConfigs({ componentsBody: componentsXml });
      const result = await probeFeatures(client, defaultConfig);

      expect(result.abapRelease).toBe('758'); // From componentsXml (SAP_BASIS 758)
      const calls = (client as any).get.mock.calls.map((args: unknown[]) => args[0]);
      expect(calls).not.toContain('/sap/bc/adt/abapsource/syntax/configurations');
    });

    it('leaves abapRelease undefined when both components and syntax-configurations are empty', async () => {
      const emptySyntaxConfigs = `<?xml version="1.0" encoding="utf-8"?>
<abapsource:syntaxConfigurations xmlns:abapsource="http://www.sap.com/adt/abapsource"/>`;
      const client = mockProbeClientWithSyntaxConfigs({
        componentsBody: emptyComponentsFeed,
        syntaxConfigsBody: emptySyntaxConfigs,
      });
      const result = await probeFeatures(client, defaultConfig);

      expect(result.abapRelease).toBeUndefined();
    });

    function makeComponentsXml(entries: Array<{ id: string; title: string }>): string {
      const items = entries
        .map(
          (e) =>
            `  <atom:entry>\n    <atom:id>${e.id}</atom:id>\n    <atom:title>${e.title}</atom:title>\n  </atom:entry>`,
        )
        .join('\n');
      return `<?xml version="1.0" encoding="utf-8"?>\n<atom:feed xmlns:atom="http://www.w3.org/2005/Atom">\n${items}\n</atom:feed>`;
    }

    function mockProbeClientHanaScenario(options: { componentsXml: string; hanaEndpoint404: boolean }): AdtHttpClient {
      return {
        get: vi.fn().mockImplementation((url: string) => {
          if (url === '/sap/bc/adt/discovery') {
            return Promise.resolve({ statusCode: 200, body: discoveryXml });
          }
          if (url === '/sap/bc/adt/system/components') {
            return Promise.resolve({ statusCode: 200, body: options.componentsXml });
          }
          if (url === '/sap/bc/adt/ddic/sysinfo/hanainfo') {
            if (options.hanaEndpoint404) {
              return Promise.reject(new AdtApiError('Not Found', 404, url));
            }
            return Promise.resolve({ statusCode: 200, body: '' });
          }
          return Promise.resolve({ statusCode: 200, body: '' });
        }),
      } as unknown as AdtHttpClient;
    }

    it('detects HANA via S4CORE component when hanainfo endpoint returns 404', async () => {
      const s4Components = makeComponentsXml([
        { id: 'SAP_BASIS', title: '758;SAPKB75801;0001;SAP Basis Component' },
        { id: 'S4CORE', title: '108;S4CORE108;0001;S/4HANA Core' },
      ]);
      const client = mockProbeClientHanaScenario({ componentsXml: s4Components, hanaEndpoint404: true });
      const result = await probeFeatures(client, defaultConfig);
      expect(result.hana.available).toBe(true);
    });

    it('detects HANA via S4FND on S/4HANA 2021+ when hanainfo endpoint returns 404', async () => {
      // S/4HANA 2021+ ships S4FND instead of S4CORE — this was the scenario that originally
      // produced a false negative on the reporter's test system.
      const s4Components = makeComponentsXml([
        { id: 'SAP_BASIS', title: '758;SAPKB75801;0001;SAP Basis Component' },
        { id: 'S4FND', title: '108;S4FND108;0001;S/4HANA Foundation' },
        { id: 'MDG_FND', title: '808;MDGFND808;0001;S/4HANA MDG Foundation' },
      ]);
      const client = mockProbeClientHanaScenario({ componentsXml: s4Components, hanaEndpoint404: true });
      const result = await probeFeatures(client, defaultConfig);
      expect(result.hana.available).toBe(true);
    });

    it('reports HANA unavailable when hanainfo 404 and no HANA components', async () => {
      const nonHanaComponents = makeComponentsXml([
        { id: 'SAP_BASIS', title: '758;SAPKB75801;0001;SAP Basis Component' },
        { id: 'SAP_ABA', title: '758;SAPK-75801INSAPABA;0001;SAP Application Basis' },
      ]);
      const client = mockProbeClientHanaScenario({ componentsXml: nonHanaComponents, hanaEndpoint404: true });
      const result = await probeFeatures(client, defaultConfig);
      expect(result.hana.available).toBe(false);
    });

    // ─── HTTP status classification (regression for the 401-as-available bug) ──

    function mockProbeClientStatus(hanainfoStatus: number): AdtHttpClient {
      return {
        get: vi.fn().mockImplementation((url: string) => {
          if (url === '/sap/bc/adt/discovery') return Promise.resolve({ statusCode: 200, body: discoveryXml });
          if (url === '/sap/bc/adt/system/components') {
            return Promise.resolve({
              statusCode: 200,
              body: makeComponentsXml([{ id: 'SAP_BASIS', title: '750;SAPKB75002;0002;SAP Basis Component' }]),
            });
          }
          if (url === '/sap/bc/adt/ddic/sysinfo/hanainfo') {
            if (hanainfoStatus >= 400) {
              return Promise.reject(new AdtApiError(`HTTP ${hanainfoStatus}`, hanainfoStatus, url));
            }
            return Promise.resolve({ statusCode: hanainfoStatus, body: '' });
          }
          // Other probes: return success so we can isolate the hana-status assertion.
          return Promise.resolve({ statusCode: 200, body: '' });
        }),
      } as unknown as AdtHttpClient;
    }

    it('classifies hanainfo 401 as unavailable (regression: was incorrectly true)', async () => {
      const client = mockProbeClientStatus(401);
      const result = await probeFeatures(client, defaultConfig);
      expect(result.hana.available).toBe(false);
      expect(result.hana.message).toMatch(/auth failure \(401\)/);
    });

    it('classifies hanainfo 403 as unavailable (user lacks authorization)', async () => {
      const client = mockProbeClientStatus(403);
      const result = await probeFeatures(client, defaultConfig);
      expect(result.hana.available).toBe(false);
      expect(result.hana.message).toMatch(/forbidden \(403\)/);
    });

    it('classifies hanainfo 404 as unavailable (endpoint not registered)', async () => {
      const client = mockProbeClientStatus(404);
      const result = await probeFeatures(client, defaultConfig);
      expect(result.hana.available).toBe(false);
      expect(result.hana.message).toMatch(/endpoint not found \(404\)|not available/);
    });

    it('classifies hanainfo 400 as available (endpoint exists, request shape rejected)', async () => {
      const client = mockProbeClientStatus(400);
      const result = await probeFeatures(client, defaultConfig);
      expect(result.hana.available).toBe(true);
    });

    it('classifies hanainfo 500 as available (endpoint exists, server error)', async () => {
      const client = mockProbeClientStatus(500);
      const result = await probeFeatures(client, defaultConfig);
      expect(result.hana.available).toBe(true);
    });

    it('treats network error (no AdtApiError) as unavailable', async () => {
      const client = {
        get: vi.fn().mockImplementation((url: string) => {
          if (url === '/sap/bc/adt/discovery') return Promise.resolve({ statusCode: 200, body: discoveryXml });
          if (url === '/sap/bc/adt/system/components') {
            return Promise.resolve({
              statusCode: 200,
              body: makeComponentsXml([{ id: 'SAP_BASIS', title: '750;SAPKB75002;0002;SAP Basis Component' }]),
            });
          }
          if (url === '/sap/bc/adt/ddic/sysinfo/hanainfo') return Promise.reject(new Error('ECONNRESET'));
          return Promise.resolve({ statusCode: 200, body: '' });
        }),
      } as unknown as AdtHttpClient;
      const result = await probeFeatures(client, defaultConfig);
      expect(result.hana.available).toBe(false);
      expect(result.hana.message).toMatch(/network error|not available/);
    });

    it('surfaces inferred-from-components reason when fallback overrides 404', async () => {
      const s4Components = makeComponentsXml([
        { id: 'SAP_BASIS', title: '758;SAPKB75801;0001;SAP Basis Component' },
        { id: 'S4FND', title: '108;S4FND108;0001;S/4HANA Foundation' },
      ]);
      const client = mockProbeClientHanaScenario({ componentsXml: s4Components, hanaEndpoint404: true });
      const result = await probeFeatures(client, defaultConfig);
      expect(result.hana.available).toBe(true);
      expect(result.hana.message).toMatch(/inferred from installed components/);
    });

    // ─── Discovery-based HANA fallback ────────────────────────────────

    const nhiDiscoveryXml = `<?xml version="1.0" encoding="utf-8"?>
<app:service xmlns:app="http://www.w3.org/2007/app" xmlns:atom="http://www.w3.org/2005/Atom">
  <app:workspace>
    <atom:title>HANA-Integration</atom:title>
    <app:collection href="/sap/bc/adt/nhi/repositories">
      <atom:title>NHI Repositories</atom:title>
    </app:collection>
    <app:collection href="/sap/bc/adt/nhi/configurations">
      <atom:title>NHI Configurations</atom:title>
    </app:collection>
  </app:workspace>
</app:service>`;

    const emptyComponentsXml = `<?xml version="1.0" encoding="utf-8"?>
<atom:feed xmlns:atom="http://www.w3.org/2005/Atom"/>`;

    function mockProbeClientDiscoveryScenario(options: {
      componentsXml: string;
      discoveryXml: string;
      hanaEndpoint404: boolean;
    }): AdtHttpClient {
      return {
        get: vi.fn().mockImplementation((url: string) => {
          if (url === '/sap/bc/adt/discovery') {
            return Promise.resolve({ statusCode: 200, body: options.discoveryXml });
          }
          if (url === '/sap/bc/adt/system/components') {
            return Promise.resolve({ statusCode: 200, body: options.componentsXml });
          }
          if (url === '/sap/bc/adt/ddic/sysinfo/hanainfo') {
            if (options.hanaEndpoint404) {
              return Promise.reject(new AdtApiError('Not Found', 404, url));
            }
            return Promise.resolve({ statusCode: 200, body: '' });
          }
          return Promise.resolve({ statusCode: 200, body: '' });
        }),
      } as unknown as AdtHttpClient;
    }

    it('detects HANA via NHI workspace when components feed is empty and hanainfo 404', async () => {
      // Regression case: systems where /sap/bc/adt/system/components returns an empty feed
      // AND hanainfo is not activated. Discovery NHI workspace is the last resort.
      const client = mockProbeClientDiscoveryScenario({
        componentsXml: emptyComponentsXml,
        discoveryXml: nhiDiscoveryXml,
        hanaEndpoint404: true,
      });
      const result = await probeFeatures(client, defaultConfig);
      expect(result.hana.available).toBe(true);
      expect(result.hana.message).toMatch(/NHI|Native HANA Integration/);
    });

    it('reports HANA unavailable when all three signals are absent', async () => {
      const client = mockProbeClientDiscoveryScenario({
        componentsXml: emptyComponentsXml,
        discoveryXml: discoveryXml, // standard fixture — no NHI
        hanaEndpoint404: true,
      });
      const result = await probeFeatures(client, defaultConfig);
      expect(result.hana.available).toBe(false);
    });

    it('promotes hana to available via NHI even when hanainfo returns 401', async () => {
      // 401 on hanainfo means auth failure on THAT endpoint, not that HANA is absent.
      // The discovery NHI signal is from a separate, independently-trusted 200 OK response
      // and should still override the hanainfo auth failure.
      const client = {
        get: vi.fn().mockImplementation((url: string) => {
          if (url === '/sap/bc/adt/discovery') return Promise.resolve({ statusCode: 200, body: nhiDiscoveryXml });
          if (url === '/sap/bc/adt/system/components') {
            return Promise.resolve({ statusCode: 200, body: emptyComponentsXml });
          }
          if (url === '/sap/bc/adt/ddic/sysinfo/hanainfo') {
            return Promise.reject(new AdtApiError('Unauthorized', 401, url));
          }
          return Promise.resolve({ statusCode: 200, body: '' });
        }),
      } as unknown as AdtHttpClient;
      const result = await probeFeatures(client, defaultConfig);
      expect(result.hana.available).toBe(true);
      expect(result.hana.message).toMatch(/NHI|Native HANA Integration/);
    });
  });

  // ─── classifyFeatureProbeStatus ────────────────────────────────────

  describe('classifyFeatureProbeStatus', () => {
    it('returns available=true on 2xx', () => {
      expect(classifyFeatureProbeStatus('hana', 200)).toEqual({ id: 'hana', available: true });
      expect(classifyFeatureProbeStatus('rap', 204)).toEqual({ id: 'rap', available: true });
    });

    it('returns available=false with auth-failure reason on 401', () => {
      const r = classifyFeatureProbeStatus('hana', 401);
      expect(r.available).toBe(false);
      expect(r.reason).toMatch(/auth failure \(401\)/);
    });

    it('returns available=false with forbidden reason on 403', () => {
      const r = classifyFeatureProbeStatus('amdp', 403);
      expect(r.available).toBe(false);
      expect(r.reason).toMatch(/forbidden \(403\)/);
    });

    it('returns available=false with not-found reason on 404', () => {
      const r = classifyFeatureProbeStatus('amdp', 404);
      expect(r.available).toBe(false);
      expect(r.reason).toMatch(/endpoint not found \(404\)/);
    });

    it('returns available=true on 400 / 405 / 500 (endpoint exists, request rejected)', () => {
      // 400 = e.g. /ddic/ddl/sources without query params; 405 = wrong method;
      // 500 = backend error from a registered endpoint. All three confirm endpoint presence.
      expect(classifyFeatureProbeStatus('rap', 400).available).toBe(true);
      expect(classifyFeatureProbeStatus('hana', 405).available).toBe(true);
      expect(classifyFeatureProbeStatus('hana', 500).available).toBe(true);
    });
  });

  // ─── probeTextSearch ───────────────────────────────────────────────

  describe('probeTextSearch', () => {
    function mockClient(statusCode: number): AdtHttpClient {
      return { get: vi.fn().mockResolvedValue({ statusCode, body: '' }) } as unknown as AdtHttpClient;
    }

    function mockClientThrows(statusCode: number): AdtHttpClient {
      return { get: vi.fn().mockRejectedValue({ statusCode }) } as unknown as AdtHttpClient;
    }

    function mockClientNetworkError(): AdtHttpClient {
      return { get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) } as unknown as AdtHttpClient;
    }

    it('returns available=true for 200 response', async () => {
      const result = await probeTextSearch(mockClient(200));
      expect(result.available).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('returns auth error for thrown 401', async () => {
      const result = await probeTextSearch(mockClientThrows(401));
      expect(result.available).toBe(false);
      expect(result.reason).toContain('authorization');
      expect(result.reason).toContain('S_ADT_RES');
    });

    it('returns auth error for thrown 403', async () => {
      const result = await probeTextSearch(mockClientThrows(403));
      expect(result.available).toBe(false);
      expect(result.reason).toContain('authorization');
    });

    it('returns SICF activation hint for thrown 404', async () => {
      const result = await probeTextSearch(mockClientThrows(404));
      expect(result.available).toBe(false);
      expect(result.reason).toContain('SICF');
      expect(result.reason).toContain('textSearch');
    });

    it('returns framework error for thrown 500', async () => {
      const result = await probeTextSearch(mockClientThrows(500));
      expect(result.available).toBe(false);
      expect(result.reason).toContain('BC-DWB-AIE');
    });

    it('returns not-implemented for thrown 501', async () => {
      const result = await probeTextSearch(mockClientThrows(501));
      expect(result.available).toBe(false);
      expect(result.reason).toContain('SAP_BASIS');
      expect(result.reason).toContain('7.51');
    });

    it('returns generic message for unexpected thrown status codes', async () => {
      const result = await probeTextSearch(mockClientThrows(502));
      expect(result.available).toBe(false);
      expect(result.reason).toContain('HTTP 502');
    });

    it('returns network error for generic errors', async () => {
      const result = await probeTextSearch(mockClientNetworkError());
      expect(result.available).toBe(false);
      expect(result.reason).toContain('Network error');
    });
  });

  // ─── probeAuthorization ─────────────────────────────────────────────

  describe('probeAuthorization', () => {
    function mockClientByUrl(urlMap: Record<string, number | 'throw' | 'network-error'>): AdtHttpClient {
      const getFn = vi.fn().mockImplementation((url: string) => {
        for (const [pattern, result] of Object.entries(urlMap)) {
          if (url.includes(pattern)) {
            if (result === 'network-error') {
              return Promise.reject(new Error('ECONNREFUSED'));
            }
            if (result === 'throw') {
              return Promise.reject({ statusCode: 403 });
            }
            if (typeof result === 'number' && result >= 400) {
              return Promise.reject({ statusCode: result });
            }
            return Promise.resolve({ statusCode: result, body: '' });
          }
        }
        return Promise.resolve({ statusCode: 200, body: '' });
      });
      return { get: getFn } as unknown as AdtHttpClient;
    }

    it('returns both available when search and transport succeed', async () => {
      const client = mockClientByUrl({
        quickSearch: 200,
        transportrequests: 200,
      });
      const result = await probeAuthorization(client);
      expect(result.searchAccess).toBe(true);
      expect(result.searchReason).toBeUndefined();
      expect(result.transportAccess).toBe(true);
      expect(result.transportReason).toBeUndefined();
    });

    it('reports search access denied on 403', async () => {
      const client = mockClientByUrl({
        quickSearch: 403,
        transportrequests: 200,
      });
      const result = await probeAuthorization(client);
      expect(result.searchAccess).toBe(false);
      expect(result.searchReason).toContain('S_ADT_RES');
      expect(result.transportAccess).toBe(true);
    });

    it('reports transport access denied on 403', async () => {
      const client = mockClientByUrl({
        quickSearch: 200,
        transportrequests: 403,
      });
      const result = await probeAuthorization(client);
      expect(result.searchAccess).toBe(true);
      expect(result.transportAccess).toBe(false);
      expect(result.transportReason).toContain('S_TRANSPRT');
    });

    it('reports both denied when both return 401', async () => {
      const client = mockClientByUrl({
        quickSearch: 401,
        transportrequests: 401,
      });
      const result = await probeAuthorization(client);
      expect(result.searchAccess).toBe(false);
      expect(result.searchReason).toContain('authorization');
      expect(result.transportAccess).toBe(false);
      expect(result.transportReason).toContain('authorization');
    });

    it('handles 404 (ICF service not activated)', async () => {
      const client = mockClientByUrl({
        quickSearch: 404,
        transportrequests: 404,
      });
      const result = await probeAuthorization(client);
      expect(result.searchAccess).toBe(false);
      expect(result.searchReason).toContain('SICF');
      expect(result.transportAccess).toBe(false);
      expect(result.transportReason).toContain('SICF');
    });

    it('handles network errors gracefully', async () => {
      const client = mockClientByUrl({
        quickSearch: 'network-error',
        transportrequests: 'network-error',
      });
      const result = await probeAuthorization(client);
      expect(result.searchAccess).toBe(false);
      expect(result.searchReason).toContain('Network error');
      expect(result.transportAccess).toBe(false);
      expect(result.transportReason).toContain('Network error');
    });
  });

  // ─── classifyAuthProbeError ─────────────────────────────────────────

  describe('classifyAuthProbeError', () => {
    it('classifies 403 for search probe', () => {
      const result = classifyAuthProbeError(403, 'search');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('S_ADT_RES');
    });

    it('classifies 401 for search probe', () => {
      const result = classifyAuthProbeError(401, 'search');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('S_ADT_RES');
    });

    it('classifies 403 for transport probe', () => {
      const result = classifyAuthProbeError(403, 'transport');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('S_TRANSPRT');
    });

    it('classifies 404 as SICF not activated', () => {
      const result = classifyAuthProbeError(404, 'search');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('SICF');
    });

    it('classifies unexpected status codes', () => {
      const result = classifyAuthProbeError(500, 'transport');
      expect(result.available).toBe(false);
      expect(result.reason).toContain('HTTP 500');
    });
  });
});
