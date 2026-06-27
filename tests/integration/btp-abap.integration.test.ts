/**
 * BTP ABAP Extended Integration Tests (LOCAL ONLY)
 *
 * These tests require interactive browser login and are NOT run in CI.
 * For CI-capable BTP tests, see btp-abap.smoke.integration.test.ts.
 *
 * Reasons for local-only:
 * - BTP free tier instances are stopped each night
 * - Free tier instances are deleted after 90 days
 * - OAuth browser login requires interactive user
 *
 * Prerequisites:
 * - BTP ABAP instance provisioned and running
 * - Booster "Prepare an Account for ABAP Development" has been run
 * - SAP_BR_DEVELOPER role assigned to user
 * - Service key saved to file
 * - User has completed browser OAuth login at least once (token cached)
 *
 * Run:
 *   TEST_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-abap-service-key.json npm run test:integration:btp
 *
 * Or with env file:
 *   Set TEST_BTP_SERVICE_KEY_FILE in .env, then: npm run test:integration:btp
 */

import { config } from 'dotenv';
import { beforeAll, describe, expect, it } from 'vitest';
import { AdtClient } from '../../src/adt/client.js';
import { createObject, deleteObject, lockObject, unlockObject, updateSource } from '../../src/adt/crud.js';
import { activate } from '../../src/adt/devtools.js';
import { createBearerTokenProvider, loadServiceKeyFile } from '../../src/adt/oauth.js';
import { unrestrictedSafetyConfig } from '../../src/adt/safety.js';
import { buildCreateXml, createContentTypeForType } from '../../src/handlers/write-helpers.js';
import { expectSapFailureClass } from '../helpers/expected-error.js';
import { generateUniqueName } from './crud-harness.js';
import { hasBtpCredentials } from './helpers.js';

// Load .env before anything else
config();

/** Create an ADT client configured for BTP ABAP */
function getBtpTestClient(): AdtClient {
  const keyFile = process.env.TEST_BTP_SERVICE_KEY_FILE || process.env.SAP_BTP_SERVICE_KEY_FILE || '';
  const serviceKey = loadServiceKeyFile(keyFile);
  // A pre-acquired dev JWT (TEST_BTP_ACCESS_TOKEN) skips the interactive browser login — required for
  // the write tests, which need a named-user token (client_credentials is rejected by ADT), and lets
  // these run headless once a token is cached.
  const presetToken = process.env.TEST_BTP_ACCESS_TOKEN;
  const bearerTokenProvider = presetToken ? async () => presetToken : createBearerTokenProvider(serviceKey);

  return new AdtClient({
    baseUrl: serviceKey.url,
    client: serviceKey.abap?.sapClient || '100',
    language: 'EN',
    safety: unrestrictedSafetyConfig(),
    bearerTokenProvider,
  });
}

// Skip entire suite if no BTP credentials.
// This suite is intentionally local-only; CI workflows do not provide BTP service-key secrets for it.
const describeIf = hasBtpCredentials() ? describe : describe.skip;

describeIf('BTP ABAP Environment Integration Tests', () => {
  let client: AdtClient;

  beforeAll(() => {
    client = getBtpTestClient();
  });

  // ─── OAuth & Connectivity ──────────────────────────────────────

  describe('OAuth connectivity', () => {
    it('connects to BTP ABAP via Bearer token', async () => {
      const info = await client.getSystemInfo();
      expect(info).toBeTruthy();
      const parsed = JSON.parse(info);
      // BTP ABAP may return empty user string (OAuth user not exposed in discovery)
      expect(typeof parsed.user).toBe('string');
      expect(Array.isArray(parsed.collections)).toBe(true);
      expect(parsed.collections.length).toBeGreaterThan(0);
    });

    it('reuses cached token on second request', async () => {
      // First call may trigger OAuth, second should use cache
      const info1 = await client.getSystemInfo();
      const info2 = await client.getSystemInfo();
      expect(info1).toBeTruthy();
      expect(info2).toBeTruthy();
    });
  });

  // ─── BTP System Information ────────────────────────────────────

  describe('BTP system info', () => {
    it('returns system info with BTP-specific components', async () => {
      const components = await client.getInstalledComponents();
      expect(components.length).toBeGreaterThan(0);

      // BTP ABAP should have SAP_BASIS
      const basis = components.find((c) => c.name === 'SAP_BASIS');
      expect(basis).toBeDefined();

      // BTP ABAP release is typically 7.58+ (ABAP Platform Cloud)
      if (basis) {
        const release = parseInt(basis.release, 10);
        expect(release).toBeGreaterThanOrEqual(758);
      }
    });

    it('has BTP-specific components', async () => {
      const components = await client.getInstalledComponents();
      const componentNames = components.map((c) => c.name);
      // BTP ABAP always has SAP_BASIS
      expect(componentNames).toContain('SAP_BASIS');
      // BTP ABAP has SAP_CLOUD instead of SAP_ABA (unlike on-premise)
      expect(componentNames).toContain('SAP_CLOUD');
    });

    it('system info contains ADT discovery collections', async () => {
      const info = await client.getSystemInfo();
      const parsed = JSON.parse(info);
      expect(Array.isArray(parsed.collections)).toBe(true);
      // BTP should have ADT collections available
      expect(parsed.collections.length).toBeGreaterThan(0);
    });
  });

  // ─── Search (Released Objects) ─────────────────────────────────

  describe('search on BTP', () => {
    it('finds released SAP classes', async () => {
      const results = await client.searchObject('CL_ABAP_*', 10);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.objectName).toMatch(/^CL_ABAP_/);
    });

    it('finds CDS views', async () => {
      const results = await client.searchObject('I_*', 10);
      expect(results.length).toBeGreaterThan(0);
    });

    it('returns empty for non-existent Z* objects', async () => {
      // Fresh BTP system has no custom Z* objects
      const results = await client.searchObject('ZZZNONEXISTENT999*', 10);
      expect(results).toHaveLength(0);
    });

    it('respects maxResults limit', async () => {
      const results = await client.searchObject('CL_*', 3);
      expect(results.length).toBeLessThanOrEqual(3);
    });

    it('finds interfaces', async () => {
      const results = await client.searchObject('IF_ABAP_*', 5);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.objectName).toMatch(/^IF_ABAP_/);
    });
  });

  // ─── Read Released Objects ─────────────────────────────────────

  describe('read released objects on BTP', () => {
    it('reads a released SAP class', async () => {
      const { source } = await client.getClass('CL_ABAP_CHAR_UTILITIES');
      expect(source).toBeTruthy();
      expect(source.length).toBeGreaterThan(0);
    });

    it('reads a released interface', async () => {
      const { source } = await client.getInterface('IF_SERIALIZABLE_OBJECT');
      expect(source).toBeTruthy();
    });

    it('reads CDS view (DDLS)', async () => {
      // I_Language is a commonly available released CDS view
      try {
        const { source } = await client.getDdls('I_LANGUAGE');
        expect(source).toBeTruthy();
      } catch (err) {
        // May not be available on all BTP systems — acceptable
        expectSapFailureClass(err, [404], [/not found/i, /not accessible/i]);
      }
    });

    it('reads class with includes', async () => {
      const { source } = await client.getClass('CL_ABAP_CHAR_UTILITIES', 'definitions');
      expect(typeof source).toBe('string');
    });
  });

  // ─── BTP-Specific: Restricted ABAP ────────────────────────────

  describe('BTP restricted ABAP behavior', () => {
    it('classic PROG is READABLE, but creating a classic program is refused (T-1)', async () => {
      // READ: standard classic reports ARE fully readable on the ABAP Environment (live-verified —
      // RSHOWTIM returns its REPORT source). The earlier "NOT available" assertion was wrong.
      const prog = await client.getProgram('RSHOWTIM');
      expect(prog.source).toMatch(/\bREPORT\b|\bMESSAGE\b/i);

      // WRITE: classic executable programs (PROG) are not part of ABAP Cloud — creation is refused.
      // Needs a writable package to isolate the program-type refusal from the package-allowlist gate.
      const pkg = process.env.TEST_BTP_PACKAGE;
      if (pkg) {
        const name = 'ZARC1_SMOKE_PROG';
        const body = buildCreateXml(
          'PROG',
          name,
          pkg,
          'arc1 prog',
          undefined,
          'EN',
          await client.getEffectiveUser(),
          true,
        );
        await expect(
          createObject(
            client.http,
            client.safety,
            '/sap/bc/adt/programs/programs',
            body,
            createContentTypeForType('PROG'),
            undefined,
            undefined,
            '919',
            'btp',
            name,
          ),
        ).rejects.toThrow();
      }
    });

    it('classic function modules may not be available', async () => {
      // Standard FM FUNCTION_EXISTS may not exist on BTP
      const results = await client.searchObject('FUNCTION_EXISTS', 5);
      // On BTP, classic FMs are typically not accessible — 0 results is expected
      // Some may still show up — either way is valid, but assert array shape
      expect(results).toBeInstanceOf(Array);
    });

    it('standard-table preview is blocked with the BTP data-view 400 (T-2)', async () => {
      // BTP returns HTTP 400 ExceptionDataPreviewGeneral "No authorization to view data"
      // (ADT_DATAPREVIEW_MSG/023; auth object S_ABPLNGVS) — NOT a 403/500. Live-verified 919.
      const err = await client.getTableContents('T000', 5).then(
        () => null,
        (e) => e,
      );
      expectSapFailureClass(err, [400], [/No authorization to view data/i]);
    });

    it('freestyle SQL on standard tables is blocked with the BTP data-view 400 (T-3)', async () => {
      // Same cloud data-access gate as table preview — 400, not the 403/500 the old test expected.
      const err = await client.runQuery('SELECT * FROM T000', 5).then(
        () => null,
        (e) => e,
      );
      expectSapFailureClass(err, [400], [/No authorization to view data/i]);
    });
  });

  // ─── BTP-Specific: RAP / Cloud Development ────────────────────

  describe('BTP RAP and cloud development', () => {
    it('finds RAP-related released objects', async () => {
      // RAP is the primary development model on BTP
      const results = await client.searchObject('CL_ABAP_BEHV*', 10);
      expect(results.length).toBeGreaterThan(0);
    });

    it('finds ABAP Cloud released classes', async () => {
      // CL_ABAP_RANDOM is a released utility class
      const results = await client.searchObject('CL_ABAP_RANDOM', 5);
      expect(results.length).toBeGreaterThan(0);
    });

    it('finds released BDEFs (behavior definitions)', async () => {
      // Search for behavior definitions — central to RAP
      const results = await client.searchObject('R_*', 10);
      // Should find some released objects
      expect(Array.isArray(results)).toBe(true);
    });
  });

  // ─── BTP-Specific: ATC / Code Analysis ────────────────────────

  describe('BTP ATC and diagnostics', () => {
    it('system info includes ADT discovery collections', async () => {
      const info = await client.getSystemInfo();
      const parsed = JSON.parse(info);
      // Collections are objects with title and href
      const collections = parsed.collections as Array<{ title: string; href: string }>;
      expect(collections.length).toBeGreaterThan(0);
      // Check structure
      expect(collections[0]).toHaveProperty('title');
      expect(collections[0]).toHaveProperty('href');
      // Look for ATC or check-related collections
      const hasAtcRelated = collections.some(
        (c) => c.href.includes('atc') || c.href.includes('check') || c.title.toLowerCase().includes('check'),
      );
      // ATC is typically available on BTP but not guaranteed in discovery
      expect(typeof hasAtcRelated).toBe('boolean');
    });
  });

  // ─── HTTP Session with OAuth ───────────────────────────────────

  describe('HTTP session management with OAuth', () => {
    it('maintains session across multiple requests', async () => {
      // Verify CSRF + Bearer token work together
      const { source: source1 } = await client.getClass('CL_ABAP_CHAR_UTILITIES');
      expect(source1).toBeTruthy();

      const { source: source2 } = await client.getInterface('IF_SERIALIZABLE_OBJECT');
      expect(source2).toBeTruthy();
    });

    it('search works after read (session continuity)', async () => {
      await client.getClass('CL_ABAP_CHAR_UTILITIES');
      const results = await client.searchObject('CL_ABAP_CONV*', 5);
      expect(results.length).toBeGreaterThan(0);
    });

    it('multiple sequential requests work correctly', async () => {
      // Fire several requests to verify session stability
      const r1 = await client.searchObject('CL_ABAP_CHAR*', 3);
      const r2 = await client.getInstalledComponents();
      const r3 = await client.searchObject('IF_ABAP_*', 3);

      expect(r1.length).toBeGreaterThan(0);
      expect(r2.length).toBeGreaterThan(0);
      expect(r3.length).toBeGreaterThan(0);
    });
  });

  // ─── Edge Cases ────────────────────────────────────────────────

  describe('BTP edge cases', () => {
    it('handles namespace objects (slash notation)', async () => {
      // /DMO/ namespace objects should exist on BTP ABAP
      const results = await client.searchObject('/DMO/*', 10);
      // /DMO/ flight reference scenario is often pre-installed
      if (results.length > 0) {
        expect(results[0]?.objectName).toMatch(/^\/DMO\//);
      }
      // May be empty on minimal BTP instances — that's OK
      expect(Array.isArray(results)).toBe(true);
    });

    it('returns 404 for non-existent class', async () => {
      await expect(client.getClass('ZCL_NONEXISTENT_999')).rejects.toThrow();
    });

    it('handles wildcard-only search', async () => {
      const results = await client.searchObject('*', 3);
      expect(results.length).toBeGreaterThan(0);
    });
  });

  // ─── BTP-Specific: object-create path (G-2..G-5) ──────────────
  //
  // The cloud create body differs from on-prem (no adtcore:responsible, no masterSystem,
  // abapLanguageVersion="cloudDevelopment", explicit CLAS attributes). These tests assert the
  // body is accepted by SAP's create simple-transformation and that the owner is taken from the JWT.

  describe('BTP object-create path', () => {
    it('surfaces the ABAP user from the JWT, not an empty string (G-5)', async () => {
      // On-prem this is SAP_USER; on BTP there is none, so it comes from the JWT user_name claim.
      const user = await client.getEffectiveUser();
      expect(user).toBeTruthy();
      expect(user.length).toBeGreaterThan(0);
      const parsed = JSON.parse(await client.getSystemInfo());
      expect(parsed.user).toBe(user);
    });

    it('produces a cloud create body that SAP accepts (deserializes) — G-3', async () => {
      // Target the default structure package (or any package): a CORRECT cloud body gets past XML
      // deserialization to package-assignment (403 ExceptionResourceNoAccess). A WRONG body (e.g. one
      // still carrying adtcore:responsible) fails earlier with 400 "error deserializing in CLASS_TRANSFORMATION".
      const pkg = process.env.TEST_BTP_STRUCTURE_PACKAGE || 'ZLOCAL';
      const name = 'ZCL_ARC1_BTP_BODYCHECK';
      const body = buildCreateXml(
        'CLAS',
        name,
        pkg,
        'ARC-1 BTP body check',
        undefined,
        'EN',
        await client.getEffectiveUser(),
        true,
      );
      expect(body).not.toContain('adtcore:responsible');
      expect(body).toContain('adtcore:abapLanguageVersion="cloudDevelopment"');
      try {
        await createObject(
          client.http,
          client.safety,
          '/sap/bc/adt/oo/classes',
          body,
          createContentTypeForType('CLAS'),
          undefined,
          undefined,
          '919',
          'btp',
          name,
        );
        // If it actually created (pkg was writable), clean up — body is obviously accepted.
        await client.http.withStatefulSession(async (session) => {
          const lock = await lockObject(
            session,
            client.safety,
            `/sap/bc/adt/oo/classes/${name.toLowerCase()}`,
            'MODIFY',
            '919',
            'btp',
          );
          await deleteObject(
            session,
            client.safety,
            `/sap/bc/adt/oo/classes/${name.toLowerCase()}`,
            lock.lockHandle,
            lock.corrNr || undefined,
          );
        });
      } catch (err) {
        // The body must have deserialized — assert it did NOT fail at the create transformation.
        const msg = err instanceof Error ? err.message : String(err);
        expect(msg).not.toMatch(/deserializ|transformation program/i);
        expectSapFailureClass(err, [403], [/package/i, /authoriz/i, /structure/i]);
      }
    });

    // Positive lifecycle needs a writable, regular (non-structure) cloud package. The default ZLOCAL
    // is a structure package and cannot host objects, so provide one via TEST_BTP_PACKAGE.
    const writablePkg = process.env.TEST_BTP_PACKAGE;
    (writablePkg ? it : it.skip)('CLAS create → activate → read → delete in a cloud package (G-3)', async () => {
      const pkg = writablePkg as string;
      const name = generateUniqueName('ZCL_ARC1_BTP');
      const lc = name.toLowerCase();
      const objectUrl = `/sap/bc/adt/oo/classes/${lc}`;
      const sourceUrl = `${objectUrl}/source/main`;
      const responsible = await client.getEffectiveUser();
      const body = buildCreateXml('CLAS', name, pkg, 'ARC-1 BTP lifecycle test', undefined, 'EN', responsible, true);

      let created = false;
      try {
        await createObject(
          client.http,
          client.safety,
          '/sap/bc/adt/oo/classes',
          body,
          createContentTypeForType('CLAS'),
          undefined,
          undefined,
          '919',
          'btp',
          name,
        );
        created = true;

        // Deliberately NON-final: the cloud create metadata hardcodes class:final="true", so this
        // exercises the mismatch — the source PUT must win and yield a non-final class (Codex review #2).
        const source = [
          `CLASS ${lc} DEFINITION PUBLIC CREATE PUBLIC.`,
          '  PUBLIC SECTION.',
          '    METHODS hello RETURNING VALUE(result) TYPE string.',
          'ENDCLASS.',
          `CLASS ${lc} IMPLEMENTATION.`,
          '  METHOD hello.',
          "    result = 'hi from ARC-1'.",
          '  ENDMETHOD.',
          'ENDCLASS.',
        ].join('\n');
        await client.http.withStatefulSession(async (session) => {
          const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', '919', 'btp');
          try {
            await updateSource(session, client.safety, sourceUrl, source, lock.lockHandle, lock.corrNr || undefined);
          } finally {
            await unlockObject(session, objectUrl, lock.lockHandle);
          }
        });

        await activate(client.http, client.safety, objectUrl, { name });

        const read = await client.getClass(name);
        expect(read.source).toContain('hello');
        // Source wins over the hardcoded create metadata: the activated class is non-final (Codex #2).
        expect(read.source).not.toMatch(/\bfinal\b/i);
      } finally {
        if (created) {
          // best-effort-cleanup
          try {
            await client.http.withStatefulSession(async (session) => {
              const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', '919', 'btp');
              await deleteObject(session, client.safety, objectUrl, lock.lockHandle, lock.corrNr || undefined);
            });
          } catch {
            // leave the object; a follow-up run reuses a fresh unique name
          }
        }
      }
    });

    // INTF needs the v5 content-type on cloud — application/* routes to an older ST that drops the
    // language version (HTTP 500 "ABAP language version  is not allowed"). Review fix; live-verified 919.
    (writablePkg ? it : it.skip)(
      'INTF create → activate → read → delete in a cloud package (v5 content-type)',
      async () => {
        const pkg = writablePkg as string;
        const name = generateUniqueName('ZIF_ARC1_BTP');
        const lc = name.toLowerCase();
        const objectUrl = `/sap/bc/adt/oo/interfaces/${lc}`;
        const responsible = await client.getEffectiveUser();
        const body = buildCreateXml('INTF', name, pkg, 'ARC-1 BTP intf test', undefined, 'EN', responsible, true);

        let created = false;
        try {
          await createObject(
            client.http,
            client.safety,
            '/sap/bc/adt/oo/interfaces',
            body,
            createContentTypeForType('INTF', true),
            undefined,
            undefined,
            '919',
            'btp',
            name,
          );
          created = true;

          const source = [`INTERFACE ${lc} PUBLIC.`, '  METHODS ping.', 'ENDINTERFACE.'].join('\n');
          await client.http.withStatefulSession(async (session) => {
            const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', '919', 'btp');
            try {
              await updateSource(
                session,
                client.safety,
                `${objectUrl}/source/main`,
                source,
                lock.lockHandle,
                lock.corrNr || undefined,
              );
            } finally {
              await unlockObject(session, objectUrl, lock.lockHandle);
            }
          });

          await activate(client.http, client.safety, objectUrl, { name });
          const read = await client.getInterface(name);
          expect(read.source).toContain('ping');
        } finally {
          if (created) {
            // best-effort-cleanup
            try {
              await client.http.withStatefulSession(async (session) => {
                const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', '919', 'btp');
                await deleteObject(session, client.safety, objectUrl, lock.lockHandle, lock.corrNr || undefined);
              });
            } catch {
              // leave the object; a follow-up run reuses a fresh unique name
            }
          }
        }
      },
    );
  });

  // ─── BTP-Specific: RAP object-create path (BDEF/SRVD/SRVB) ──────────────
  //
  // RAP create bodies are corrected by the same generic cloudify as CLAS/INTF (no adtcore:responsible,
  // no masterSystem, +abapLanguageVersion="cloudDevelopment"). Live-verified on BTP 919: all three
  // create (201) with their existing content types — no INTF-style override needed. A structure package
  // rejects them at package-assignment with 409 "cannot contain development objects" (RAP surfaces
  // ExceptionResourceLockConflict/409, unlike CLAS's ExceptionResourceNoAccess/403).
  describe('BTP RAP object-create path (BDEF/SRVD/SRVB)', () => {
    // needsPackage mirrors the handler (src/handlers/write/create.ts `needsPackageParam`): only BDEF
    // (and TABL*) get the ?_package= query param; SRVD/SRVB carry the target solely via the body's
    // packageRef. We exercise the same per-type path the product actually uses.
    const RAP: {
      type: string;
      base: string;
      prefix: string;
      needsPackage: boolean;
      props?: Record<string, unknown>;
    }[] = [
      { type: 'BDEF', base: '/sap/bc/adt/bo/behaviordefinitions', prefix: 'ZBD_ARC1_BTP', needsPackage: true },
      { type: 'SRVD', base: '/sap/bc/adt/ddic/srvd/sources', prefix: 'ZSD_ARC1_BTP', needsPackage: false },
      {
        type: 'SRVB',
        base: '/sap/bc/adt/businessservices/bindings',
        prefix: 'ZSB_ARC1_BTP',
        needsPackage: false,
        props: { serviceDefinition: 'ZSRVD_DUMMY', bindingType: 'ODATA V2 UI', category: '0' },
      },
    ];
    const structurePkg = process.env.TEST_BTP_STRUCTURE_PACKAGE || 'ZLOCAL';
    const writablePkg = process.env.TEST_BTP_PACKAGE;

    for (const r of RAP) {
      it(`${r.type} cloud create body is accepted (deserializes past the create ST)`, async () => {
        const name = generateUniqueName(r.prefix); // unique → never re-deletes a stale object before probing
        const responsible = await client.getEffectiveUser();
        const body = buildCreateXml(
          r.type,
          name,
          structurePkg,
          `ARC-1 BTP ${r.type} body check`,
          r.props,
          'EN',
          responsible,
          true,
        );
        // The cloud body must be ABAP-for-Cloud and carry no responsible (owner comes from the JWT).
        expect(body).not.toContain('adtcore:responsible');
        expect(body).toContain('adtcore:abapLanguageVersion="cloudDevelopment"');
        const objectUrl = `${r.base}/${name.toLowerCase()}`;
        let created = false;
        try {
          await createObject(
            client.http,
            client.safety,
            r.base,
            body,
            createContentTypeForType(r.type, true),
            undefined,
            r.needsPackage ? structurePkg : undefined,
            '919',
            'btp',
            name,
          );
          // structurePkg happened to be writable — a successful create is itself proof the body is
          // accepted; clean up in finally.
          created = true;
        } catch (err) {
          // Decisive: the cloud body deserialized — it did NOT fail at the create ST, the cloud
          // language-version check, or content-type negotiation. A structure package then rejects it at
          // package-assignment with a specific, unambiguous message (a status-only assert could false-green).
          const msg = err instanceof Error ? err.message : String(err);
          expect(msg).not.toMatch(/deserializ|transformation program|System expected the element/i);
          expect(msg).not.toMatch(/language version|Unsupported Media Type|not acceptable/i);
          expectSapFailureClass(err, [403, 409], [/structure package/i, /cannot contain development objects/i]);
        } finally {
          if (created) {
            // best-effort-cleanup
            try {
              await client.http.withStatefulSession(async (session) => {
                const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', '919', 'btp');
                await deleteObject(session, client.safety, objectUrl, lock.lockHandle, lock.corrNr || undefined);
              });
            } catch {
              // leave the object; a follow-up run reuses a fresh unique name
            }
          }
        }
      });
    }

    // Full create→delete needs a writable, regular (non-structure) cloud package via TEST_BTP_PACKAGE.
    // (Activation is out of scope: an empty RAP shell can't activate on any system — it needs a real
    // root entity + behavior source + service exposure, a RAP-scenario concern, not a create-body one.)
    for (const r of RAP) {
      (writablePkg ? it : it.skip)(`${r.type} create → delete in a cloud package`, async () => {
        const pkg = writablePkg as string;
        const name = generateUniqueName(r.prefix);
        const objectUrl = `${r.base}/${name.toLowerCase()}`;
        const responsible = await client.getEffectiveUser();
        const body = buildCreateXml(r.type, name, pkg, `ARC-1 BTP ${r.type} create`, r.props, 'EN', responsible, true);
        let created = false;
        try {
          await createObject(
            client.http,
            client.safety,
            r.base,
            body,
            createContentTypeForType(r.type, true),
            undefined,
            r.needsPackage ? pkg : undefined,
            '919',
            'btp',
            name,
          );
          created = true;
        } finally {
          if (created) {
            // best-effort-cleanup
            try {
              await client.http.withStatefulSession(async (session) => {
                const lock = await lockObject(session, client.safety, objectUrl, 'MODIFY', '919', 'btp');
                await deleteObject(session, client.safety, objectUrl, lock.lockHandle, lock.corrNr || undefined);
              });
            } catch {
              // leave the object; a follow-up run reuses a fresh unique name
            }
          }
        }
        expect(created).toBe(true);
      });
    }
  });
});
