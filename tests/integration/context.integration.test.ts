/**
 * Integration tests for SAPContext dependency compression.
 *
 * These tests run against a live SAP system (A4H at a4h.marianzeis.de:50000)
 * and fail fast when SAP credentials are missing.
 *
 * Test objects:
 * - /DMO/CL_FLIGHT_LEGACY: Rich class with interface + exception deps
 * - /DMO/IF_FLIGHT_LEGACY: Interface with many type references
 * - ZCL_DEMO_D_CALC_AMOUNT: Class inheriting from BOBF superclass
 *
 * Run: npm run test:integration
 */

import { beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { extractCdsDependencies, extractCdsElements } from '../../src/context/cds-deps.js';
import { compressCdsContext, compressContext } from '../../src/context/compressor.js';
import { extractContract } from '../../src/context/contract.js';
import { extractDependencies } from '../../src/context/deps.js';
import { extractMethod, listMethods, spliceMethod } from '../../src/context/method-surgery.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

/** Well-known CDS views that may exist on SAP demo systems */
const DDLS_CANDIDATES = ['/DMO/I_TRAVEL', '/DMO/I_FLIGHT', '/DMO/I_BOOKING', 'I_LANGUAGE', 'SEPM_I_SALESORDER'];

/** Try to find any readable DDLS on the system — returns name + source, or undefined */
async function findAnyDdls(client: AdtClient): Promise<{ name: string; source: string } | undefined> {
  // Try well-known names first
  for (const name of DDLS_CANDIDATES) {
    try {
      const { source } = await client.getDdls(name);
      if (source) return { name, source };
    } catch {
      // discovery-fallback: not available — try next candidate
    }
  }
  // Fall back to searching for any DDLS
  try {
    const results = await client.searchObject('*', 20);
    const ddls = results.filter((r) => r.objectType?.startsWith('DDLS'));
    for (const r of ddls) {
      try {
        const { source } = await client.getDdls(r.objectName);
        if (source) return { name: r.objectName, source };
      } catch {
        // discovery-fallback: can't read this one — try next
      }
    }
  } catch {
    // discovery-fallback: search endpoint not available
  }
  return undefined;
}

describe('SAPContext Integration Tests', () => {
  let client: AdtClient;
  let hasFlightLegacy = false;
  let hasIfFlightLegacy = false;
  let hasBobfDemo = false;

  beforeAll(async () => {
    requireSapCredentials();
    client = getTestClient();
    // Probe fixture availability once. /DMO/* is S/4 demo content; BOBF demo
    // class is custom content on S/4 systems. Neither exists on NW 7.50.
    try {
      await client.getClass('/DMO/CL_FLIGHT_LEGACY');
      hasFlightLegacy = true;
    } catch {
      hasFlightLegacy = false;
    }
    try {
      await client.getInterface('/DMO/IF_FLIGHT_LEGACY');
      hasIfFlightLegacy = true;
    } catch {
      hasIfFlightLegacy = false;
    }
    try {
      await client.getClass('ZCL_DEMO_D_CALC_AMOUNT');
      hasBobfDemo = true;
    } catch {
      hasBobfDemo = false;
    }
  });

  function requireFlightLegacy(ctx: import('vitest').TestContext): void {
    if (!hasFlightLegacy) {
      requireOrSkip(ctx, undefined, `${SkipReason.NO_FIXTURE} (/DMO/CL_FLIGHT_LEGACY) — S/4 demo content`);
    }
  }
  function requireIfFlightLegacy(ctx: import('vitest').TestContext): void {
    if (!hasIfFlightLegacy) {
      requireOrSkip(ctx, undefined, `${SkipReason.NO_FIXTURE} (/DMO/IF_FLIGHT_LEGACY) — S/4 demo content`);
    }
  }
  function requireBobfDemo(ctx: import('vitest').TestContext): void {
    if (!hasBobfDemo) {
      requireOrSkip(ctx, undefined, `${SkipReason.NO_FIXTURE} (ZCL_DEMO_D_CALC_AMOUNT) — S/4 BOBF demo class`);
    }
  }

  // ─── Dependency Extraction on Real Sources ─────────────────────────

  describe('dependency extraction', () => {
    it('extracts dependencies from /DMO/CL_FLIGHT_LEGACY', async (ctx) => {
      requireFlightLegacy(ctx);
      const { source } = await client.getClass('/DMO/CL_FLIGHT_LEGACY');
      const deps = extractDependencies(source, '/DMO/CL_FLIGHT_LEGACY', false);

      // This class implements /DMO/IF_FLIGHT_LEGACY and raises /DMO/CX_FLIGHT_LEGACY
      const names = deps.map((d) => d.name.toUpperCase());

      // Should find the interface implementation
      expect(names).toContain('/DMO/IF_FLIGHT_LEGACY');

      // Should find exception class references
      expect(names).toContain('/DMO/CX_FLIGHT_LEGACY');

      // Should have multiple dependencies
      expect(deps.length).toBeGreaterThan(2);

      // Each dep should have a valid line number
      for (const dep of deps) {
        expect(dep.line).toBeGreaterThan(0);
        expect(dep.name).toBeTruthy();
        expect(dep.kind).toBeTruthy();
      }
    });

    it('extracts dependencies from /DMO/IF_FLIGHT_LEGACY', async (ctx) => {
      requireIfFlightLegacy(ctx);
      const { source } = await client.getInterface('/DMO/IF_FLIGHT_LEGACY');
      const deps = extractDependencies(source, '/DMO/IF_FLIGHT_LEGACY', false);

      // Interface has many type references to /DMO/* data types
      expect(deps.length).toBeGreaterThan(0);
    });

    it('extracts INHERITING FROM from ZCL_DEMO_D_CALC_AMOUNT', async (ctx) => {
      requireBobfDemo(ctx);
      const { source } = await client.getClass('ZCL_DEMO_D_CALC_AMOUNT');
      const deps = extractDependencies(source, 'ZCL_DEMO_D_CALC_AMOUNT', false);

      // This class inherits from /BOBF/CL_LIB_D_SUPERCL_SIMPLE
      const inheritDep = deps.find((d) => d.kind === 'inheritance');
      expect(inheritDep).toBeDefined();
      expect(inheritDep?.name.toUpperCase()).toContain('BOBF');
    });
  });

  // ─── Contract Extraction on Real Sources ───────────────────────────

  describe('contract extraction', () => {
    it('extracts class contract with public section only', async (ctx) => {
      requireFlightLegacy(ctx);
      const { source } = await client.getClass('/DMO/CL_FLIGHT_LEGACY');
      const contract = extractContract(source, '/DMO/CL_FLIGHT_LEGACY', 'CLAS');

      expect(contract.success).toBe(true);
      expect(contract.type).toBe('CLAS');
      expect(contract.methodCount).toBeGreaterThan(0);

      // Contract should be significantly smaller than full source
      expect(contract.source.length).toBeLessThan(source.length);

      // Should contain PUBLIC SECTION
      expect(contract.source.toUpperCase()).toContain('PUBLIC SECTION');

      // Should NOT contain IMPLEMENTATION
      expect(contract.source.toUpperCase()).not.toContain('CLASS IMPLEMENTATION');
    });

    it('extracts interface contract (full source)', async (ctx) => {
      requireIfFlightLegacy(ctx);
      const { source } = await client.getInterface('/DMO/IF_FLIGHT_LEGACY');
      const contract = extractContract(source, '/DMO/IF_FLIGHT_LEGACY', 'INTF');

      expect(contract.success).toBe(true);
      expect(contract.type).toBe('INTF');
      // Interface contract should be approximately the same size as source
      expect(contract.source.length).toBeGreaterThan(0);
    });
  });

  // ─── Full Compression Pipeline ────────────────────────────────────

  describe('full compression', () => {
    it('compresses context for /DMO/CL_FLIGHT_LEGACY', async (ctx) => {
      requireFlightLegacy(ctx);
      const { source } = await client.getClass('/DMO/CL_FLIGHT_LEGACY');
      const result = await compressContext(client, source, '/DMO/CL_FLIGHT_LEGACY', 'CLAS', 5, 1);

      // Should have resolved at least some dependencies
      expect(result.depsResolved).toBeGreaterThan(0);
      expect(result.output).toContain('Dependency context for /DMO/CL_FLIGHT_LEGACY');
      expect(result.output).toContain('Stats:');

      // Output should be reasonable size
      expect(result.totalLines).toBeGreaterThan(5);
    }, 30000); // 30s timeout for SAP calls

    it('compresses context with depth=2', async (ctx) => {
      requireFlightLegacy(ctx);
      const { source } = await client.getClass('/DMO/CL_FLIGHT_LEGACY');
      const shallow = await compressContext(client, source, '/DMO/CL_FLIGHT_LEGACY', 'CLAS', 3, 1);
      const deep = await compressContext(client, source, '/DMO/CL_FLIGHT_LEGACY', 'CLAS', 3, 2);

      // Depth=2 should resolve at least as many as depth=1
      expect(deep.depsResolved).toBeGreaterThanOrEqual(shallow.depsResolved);
    }, 60000); // 60s timeout

    it('handles maxDeps limit correctly', async (ctx) => {
      requireFlightLegacy(ctx);
      const { source } = await client.getClass('/DMO/CL_FLIGHT_LEGACY');
      const result = await compressContext(client, source, '/DMO/CL_FLIGHT_LEGACY', 'CLAS', 2, 1);

      // Should resolve at most 2
      expect(result.depsResolved).toBeLessThanOrEqual(2);
    }, 30000);

    it('compresses interface context', async (ctx) => {
      requireIfFlightLegacy(ctx);
      const { source } = await client.getInterface('/DMO/IF_FLIGHT_LEGACY');
      const result = await compressContext(client, source, '/DMO/IF_FLIGHT_LEGACY', 'INTF', 5, 1);

      expect(result.output).toContain('Dependency context for /DMO/IF_FLIGHT_LEGACY');
    }, 30000);
  });

  // ─── Method-Level Surgery ──────────────────────────────────────────

  describe('method-level surgery', () => {
    it('lists methods from /DMO/CL_FLIGHT_LEGACY', async (ctx) => {
      requireFlightLegacy(ctx);
      const { source } = await client.getClass('/DMO/CL_FLIGHT_LEGACY');
      const listing = listMethods(source, '/DMO/CL_FLIGHT_LEGACY');

      expect(listing.success).toBe(true);
      expect(listing.methods.length).toBeGreaterThan(0);

      // Should find methods with valid line ranges
      for (const method of listing.methods) {
        expect(method.name).toBeTruthy();
        expect(method.startLine).toBeGreaterThan(0);
        expect(method.endLine).toBeGreaterThanOrEqual(method.startLine);
      }

      // Should have at least some public methods
      const publicMethods = listing.methods.filter((m) => m.visibility === 'public');
      expect(publicMethods.length).toBeGreaterThan(0);
    }, 15000);

    it('extracts a single method from /DMO/CL_FLIGHT_LEGACY', async (ctx) => {
      requireFlightLegacy(ctx);
      const { source } = await client.getClass('/DMO/CL_FLIGHT_LEGACY');
      const listing = listMethods(source, '/DMO/CL_FLIGHT_LEGACY');
      expect(listing.success).toBe(true);
      expect(listing.methods.length).toBeGreaterThan(0);

      // Extract the first method
      const firstMethod = listing.methods[0]!;
      const extracted = extractMethod(source, '/DMO/CL_FLIGHT_LEGACY', firstMethod.name);

      expect(extracted.success).toBe(true);
      expect(extracted.methodSource).toContain('METHOD');
      expect(extracted.methodSource).toContain('ENDMETHOD');
      expect(extracted.startLine).toBe(firstMethod.startLine);
      expect(extracted.endLine).toBe(firstMethod.endLine);

      // Extracted method should be much smaller than full source
      expect(extracted.methodSource.length).toBeLessThan(source.length);
    }, 15000);

    it('round-trips spliceMethod without changing source', async (ctx) => {
      requireFlightLegacy(ctx);
      const { source } = await client.getClass('/DMO/CL_FLIGHT_LEGACY');
      const listing = listMethods(source, '/DMO/CL_FLIGHT_LEGACY');
      expect(listing.success).toBe(true);

      const firstMethod = listing.methods[0]!;
      const extracted = extractMethod(source, '/DMO/CL_FLIGHT_LEGACY', firstMethod.name);
      expect(extracted.success).toBe(true);

      // Splice back the same method source — should produce identical output
      // Normalize line endings for comparison (SAP returns CRLF, our functions normalize to LF)
      const spliced = spliceMethod(source, '/DMO/CL_FLIGHT_LEGACY', firstMethod.name, extracted.methodSource);
      expect(spliced.success).toBe(true);
      const normalize = (s: string) => s.replace(/\r\n/g, '\n');
      expect(normalize(spliced.newSource)).toBe(normalize(source));
    }, 15000);

    it('achieves significant token reduction vs full source', async (ctx) => {
      requireFlightLegacy(ctx);
      const { source } = await client.getClass('/DMO/CL_FLIGHT_LEGACY');
      const listing = listMethods(source, '/DMO/CL_FLIGHT_LEGACY');
      expect(listing.success).toBe(true);

      // Pick a method and measure reduction
      const method = listing.methods[0]!;
      const extracted = extractMethod(source, '/DMO/CL_FLIGHT_LEGACY', method.name);
      expect(extracted.success).toBe(true);

      const fullTokens = source.length;
      const methodTokens = extracted.methodSource.length;
      const reduction = 1 - methodTokens / fullTokens;

      // Should achieve at least 50% reduction (typically 90%+)
      expect(reduction).toBeGreaterThan(0.5);
    }, 15000);
  });

  // ─── CDS Context Compression ───────────────────────────────────────
  // Dynamically discover a DDLS on the system. Try well-known names,
  // then fall back to searching for any DDLS/S object.

  describe('CDS dependency extraction', () => {
    let ddlSource: string | undefined;
    let cdsName: string | undefined;

    beforeAll(async () => {
      const found = await findAnyDdls(client);
      cdsName = found?.name;
      ddlSource = found?.source;
    }, 30000);

    it('extracts dependencies from CDS DDL source', async (ctx) => {
      requireOrSkip(ctx, cdsName, SkipReason.NO_DDLS);
      requireOrSkip(ctx, ddlSource, SkipReason.NO_DDLS);
      const deps = extractCdsDependencies(ddlSource);

      expect(deps.length).toBeGreaterThan(0);
      for (const dep of deps) {
        expect(dep.name).toBeTruthy();
        expect(dep.kind).toBeTruthy();
      }
    });

    it('extracts elements from CDS DDL source', async (ctx) => {
      requireOrSkip(ctx, cdsName, SkipReason.NO_DDLS);
      requireOrSkip(ctx, ddlSource, SkipReason.NO_DDLS);
      const elements = extractCdsElements(ddlSource, cdsName);

      expect(elements).toContain(`=== ${cdsName} elements ===`);
      // CDS views have a projection list with fields
      expect(elements.length).toBeGreaterThan(0);
    });
  });

  describe('CDS full compression', () => {
    let ddlSource: string | undefined;
    let cdsName: string | undefined;

    beforeAll(async () => {
      const found = await findAnyDdls(client);
      cdsName = found?.name;
      ddlSource = found?.source;
    }, 30000);

    it('compresses CDS context', async (ctx) => {
      requireOrSkip(ctx, cdsName, SkipReason.NO_DDLS);
      requireOrSkip(ctx, ddlSource, SkipReason.NO_DDLS);
      const result = await compressCdsContext(client, ddlSource, cdsName, 5, 1);

      expect(result.depsResolved).toBeGreaterThan(0);
      expect(result.output).toContain(`CDS dependency context for ${cdsName}`);
      expect(result.output).toContain('Stats:');
      expect(result.objectType).toBe('DDLS');
    }, 30000);

    it('respects maxDeps limit for CDS context', async (ctx) => {
      requireOrSkip(ctx, cdsName, SkipReason.NO_DDLS);
      requireOrSkip(ctx, ddlSource, SkipReason.NO_DDLS);
      const result = await compressCdsContext(client, ddlSource, cdsName, 2, 1);

      expect(result.depsResolved).toBeLessThanOrEqual(2);
    }, 30000);

    it('compresses CDS context with depth=2', async (ctx) => {
      requireOrSkip(ctx, cdsName, SkipReason.NO_DDLS);
      requireOrSkip(ctx, ddlSource, SkipReason.NO_DDLS);
      const shallow = await compressCdsContext(client, ddlSource, cdsName, 5, 1);
      const deep = await compressCdsContext(client, ddlSource, cdsName, 5, 2);

      expect(deep.depsResolved).toBeGreaterThanOrEqual(shallow.depsResolved);
    }, 60000);
  });

  // ─── SAPManage Feature Probing ────────────────────────────────────

  describe('SAPManage feature probing', () => {
    it('probes features successfully', async () => {
      const { probeFeatures } = await import('../../src/adt/features.js');
      const { defaultFeatureConfig } = await import('../../src/adt/config.js');

      const features = await probeFeatures(client.http, defaultFeatureConfig());

      // Should return all probed features
      expect(features.hana).toBeDefined();
      expect(features.abapGit).toBeDefined();
      expect(features.rap).toBeDefined();
      expect(features.amdp).toBeDefined();
      expect(features.ui5).toBeDefined();
      expect(features.transport).toBeDefined();
      expect(features.ui5repo).toBeDefined();
      expect(features.flp).toBeDefined();

      // Each feature should have required fields
      const featureKeys = ['hana', 'abapGit', 'rap', 'amdp', 'ui5', 'transport', 'ui5repo', 'flp'] as const;
      for (const key of featureKeys) {
        const feature = features[key];
        expect(typeof feature.available).toBe('boolean');
        expect(feature.mode).toBe('auto');
        expect(feature.message).toBeTruthy();
      }

      // Transport should be available on A4H
      expect(features.transport.available).toBe(true);

      // Should detect ABAP release from SAP_BASIS
      expect(features.abapRelease).toBeDefined();
      expect(features.abapRelease).toMatch(/^\d{3}/); // e.g. "750", "757"
    }, 15000);
  });
});
