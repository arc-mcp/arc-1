/**
 * CRUD lifecycle integration test for ARC-1.
 *
 * Exercises the full create -> read -> update -> activate -> delete -> verify-deleted
 * roundtrip against a live SAP system.
 *
 * Missing credentials are treated as setup errors and fail the suite.
 *
 * Run: npm run test:integration:crud
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import {
  createObject,
  deleteObject,
  lockObject,
  safeUpdateObject,
  safeUpdateSource,
  unlockObject,
} from '../../src/adt/crud.js';
import { activate } from '../../src/adt/devtools.js';
import { AdtApiError } from '../../src/adt/errors.js';
import { expectSapFailureClass } from '../helpers/expected-error.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { buildCreateXml, CrudRegistry, cleanupAll, generateUniqueName } from './crud-harness.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

/**
 * Classify a caught error as a known NW 7.50-class CRUD limitation we should
 * skip rather than fail on. Returns a SkipReason message, or null when the
 * error is genuinely unexpected and should propagate.
 */
function ddicSkipReason(err: unknown): string | null {
  if (!(err instanceof AdtApiError)) return null;
  // DOMA/DTEL collection endpoints are absent or only accept v1 bodies on 7.50.
  if (err.statusCode === 404 && /\/ddic\/domains/.test(err.path)) {
    return `${SkipReason.BACKEND_UNSUPPORTED}: /ddic/domains endpoint not available on this release`;
  }
  if (err.statusCode === 415 && /\/ddic\/dataelements/.test(err.path)) {
    return `${SkipReason.BACKEND_UNSUPPORTED}: DTEL v2 content type not supported on this release`;
  }
  // PROG lock→PUT sequence sometimes fails with 423 on 7.50 (session correlation quirk).
  if (err.statusCode === 423) {
    return `${SkipReason.BACKEND_UNSUPPORTED}: lock-handle session correlation differs on this release`;
  }
  return null;
}

const DOMAIN_V2_CONTENT_TYPE = 'application/vnd.sap.adt.domains.v2+xml; charset=utf-8';
const DATAELEMENT_V2_CONTENT_TYPE = 'application/vnd.sap.adt.dataelements.v2+xml; charset=utf-8';

describe('CRUD lifecycle', () => {
  let client: AdtClient;
  const registry = new CrudRegistry();

  async function deleteWithLock(objectUrl: string): Promise<void> {
    await client.http.withStatefulSession(async (session) => {
      const lock = await lockObject(session, client.safety, objectUrl);
      try {
        await deleteObject(session, client.safety, objectUrl, lock.lockHandle);
      } finally {
        try {
          await unlockObject(session, objectUrl, lock.lockHandle);
        } catch {
          // best-effort-cleanup
        }
      }
    });
  }

  beforeAll(() => {
    requireSapCredentials();
    client = getTestClient();
  });

  afterAll(async () => {
    if (!client) return;
    const report = await cleanupAll(client.http, client.safety, registry);
    if (report.failed.length > 0) {
      // best-effort-cleanup
      console.error('CRUD cleanup failures:', report.failed);
    }
  }, 60_000); // Higher timeout — slow remote SAP systems can need > 10s for multi-object cleanup.

  it('full lifecycle: create -> read -> update -> activate -> delete -> verify-deleted', async (ctx) => {
    const testName = generateUniqueName('ZARC1_IT');
    const objectUrl = `/sap/bc/adt/programs/programs/${testName.toLowerCase()}`;
    const sourceUrl = `${objectUrl}/source/main`;
    const xml = buildCreateXml('PROG', testName, '$TMP', 'ARC-1 lifecycle test');

    try {
      // 1. CREATE
      await createObject(client.http, client.safety, '/sap/bc/adt/programs/programs', xml);
      registry.register(objectUrl, 'PROG', testName);

      // 2. READ — verify creation
      const { source: source1 } = await client.getProgram(testName);
      expect(typeof source1).toBe('string');
      expect(source1.length).toBeGreaterThan(0);

      // 3. UPDATE — modify source
      const newSource = `REPORT ${testName.toLowerCase()}.\nWRITE: / 'updated by CRUD lifecycle test'.`;
      await safeUpdateSource(client.http, client.safety, objectUrl, sourceUrl, newSource);

      // 4. READ — verify update
      const { source: source2 } = await client.getProgram(testName);
      expect(source2).toContain('updated by CRUD lifecycle test');

      // 5. ACTIVATE
      const activation = await activate(client.http, client.safety, objectUrl);
      expect(activation.success).toBe(true);

      // 6. DELETE
      await client.http.withStatefulSession(async (session) => {
        const lock = await lockObject(session, client.safety, objectUrl);
        await deleteObject(session, client.safety, objectUrl, lock.lockHandle);
      });
      registry.remove(testName);

      // 7. VERIFY DELETION — read should fail with 404
      await expect(client.getProgram(testName)).rejects.toThrow(/404|not found/i);
    } catch (err) {
      const skip = ddicSkipReason(err);
      if (skip) {
        requireOrSkip(ctx, undefined, skip);
      }
      throw err;
    }
  }, 60_000);

  it('class text symbols: create -> write symbol -> read back -> malformed 406 -> delete', async (ctx) => {
    const name = generateUniqueName('ZARC1_TESY');
    const lower = name.toLowerCase();
    const objectUrl = `/sap/bc/adt/oo/classes/${lower}`;
    const sourceUrl = `${objectUrl}/source/main`;
    const classSource =
      `CLASS ${lower} DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\n` +
      `    METHODS greet RETURNING VALUE(rv) TYPE string.\nENDCLASS.\n` +
      `CLASS ${lower} IMPLEMENTATION.\n  METHOD greet.\n    rv = 'Hi'(001).\n  ENDMETHOD.\nENDCLASS.`;

    try {
      await createObject(
        client.http,
        client.safety,
        '/sap/bc/adt/oo/classes',
        buildCreateXml('CLAS', name, '$TMP', 'ARC-1 text-symbol lifecycle'),
      );
      registry.register(objectUrl, 'CLAS', name);
      await safeUpdateSource(client.http, client.safety, objectUrl, sourceUrl, classSource);
      expect((await activate(client.http, client.safety, objectUrl)).success).toBe(true);

      // WRITE a text symbol, then READ it back via the textelements service.
      await client.writeClassTextSymbols(name, '@MaxLength:20\n001=Hello\n');
      expect(await client.getClassTextSymbols(name)).toContain('001=Hello');

      // FAILURE PATH: a malformed body (one @MaxLength shared by two symbols) is rejected (406),
      // and the earlier symbol stays intact.
      try {
        await client.writeClassTextSymbols(name, '@MaxLength:20\n001=A\n002=B\n');
        throw new Error('expected malformed text-symbol write to be rejected');
      } catch (err) {
        expectSapFailureClass(err, [406], [/inconsisten|error/i]);
      }
      expect(await client.getClassTextSymbols(name)).toContain('001=Hello');

      await deleteWithLock(objectUrl);
      registry.remove(name);
      await expect(client.getClass(name)).rejects.toThrow(/404|not found/i);
    } catch (err) {
      // NW 7.50 has no textelements service — skip rather than fail.
      if (err instanceof AdtApiError && err.statusCode === 404 && /\/textelements\/classes\//.test(err.path)) {
        requireOrSkip(
          ctx,
          undefined,
          `${SkipReason.BACKEND_UNSUPPORTED}: ADT textelements service absent on this release`,
        );
      }
      const skip = ddicSkipReason(err);
      if (skip) requireOrSkip(ctx, undefined, skip);
      throw err;
    }
  }, 60_000);

  it('DOMA CRUD lifecycle', async (ctx) => {
    const domainName = generateUniqueName('ZARC1_TDOM');
    const domainUrl = `/sap/bc/adt/ddic/domains/${domainName}`;

    try {
      const createXml = buildCreateXml('DOMA', domainName, '$TMP', 'ARC-1 test domain', {
        dataType: 'CHAR',
        length: 1,
        fixedValues: [
          { low: 'A', description: 'Active' },
          { low: 'I', description: 'Inactive' },
        ],
      });

      await createObject(client.http, client.safety, '/sap/bc/adt/ddic/domains', createXml, DOMAIN_V2_CONTENT_TYPE);
      registry.register(domainUrl, 'DOMA', domainName);
      expect((await activate(client.http, client.safety, domainUrl)).success).toBe(true);

      const created = await client.getDomain(domainName);
      expect(created.dataType).toBe('CHAR');
      expect(created.length).toBe('000001');
      expect(created.fixedValues.map((v) => v.low)).toEqual(expect.arrayContaining(['A', 'I']));

      const updateXml = buildCreateXml('DOMA', domainName, '$TMP', 'ARC-1 test domain updated', {
        dataType: 'CHAR',
        length: 2,
        fixedValues: [
          { low: 'A', description: 'Active' },
          { low: 'I', description: 'Inactive' },
          { low: 'P', description: 'Pending' },
        ],
      });
      await safeUpdateObject(client.http, client.safety, domainUrl, updateXml, DOMAIN_V2_CONTENT_TYPE);
      expect((await activate(client.http, client.safety, domainUrl)).success).toBe(true);

      const updated = await client.getDomain(domainName);
      expect(updated.length).toBe('000002');
      expect(updated.fixedValues.map((v) => v.low)).toContain('P');

      await deleteWithLock(domainUrl);
      registry.remove(domainName);

      try {
        await client.getDomain(domainName);
        throw new Error('Expected domain read to fail after delete');
      } catch (err) {
        expectSapFailureClass(err, [404], [/not found/i]);
      }
    } catch (err) {
      const skip = ddicSkipReason(err);
      if (skip) {
        requireOrSkip(ctx, undefined, skip);
      }
      throw err;
    } finally {
      if (registry.getAll().some((entry) => entry.name === domainName)) {
        try {
          await deleteWithLock(domainUrl);
          registry.remove(domainName);
        } catch {
          // best-effort-cleanup
        }
      }
    }
  }, 90_000);

  it('DTEL create + delete (no PUT — exercises v2→v1 content-type fallback)', async (ctx) => {
    // This test exercises ONLY the content-negotiated create path — not the
    // full CRUD lifecycle that needs stateful lock+PUT (which hits the NW 7.50
    // lock-handle session-correlation quirk). It catches the DTEL v1 fallback
    // regression on older releases while staying green on modern systems too.
    const name = generateUniqueName('ZARC1_DTCV1');
    const url = `/sap/bc/adt/ddic/dataelements/${name}`;

    try {
      const xml = buildCreateXml('DTEL', name, '$TMP', 'ARC-1 DTEL v1 fallback test', {
        typeKind: 'predefinedAbapType',
        dataType: 'CHAR',
        length: 10,
      });
      // The handler posts with DATAELEMENT_V2_CONTENT_TYPE. On SAP_BASIS < 7.52
      // the server returns 415; createObject transparently retries with the
      // v1 MIME type. Either way, the POST must succeed.
      await createObject(client.http, client.safety, '/sap/bc/adt/ddic/dataelements', xml, DATAELEMENT_V2_CONTENT_TYPE);
      registry.register(url, 'DTEL', name);

      // Verify via SAPRead that the shell was created. Only assert the name —
      // release-specific differences in how `predefinedAbapType` vs `domain`
      // is stored for a shell DTEL (and how fields roundtrip via v1 vs v2)
      // aren't what this test is about. The full semantics are covered by
      // the `DTEL CRUD lifecycle` test on modern systems.
      const created = await client.getDataElement(name);
      expect(created.name).toBe(name);
    } catch (err) {
      const skip = ddicSkipReason(err);
      if (skip) {
        requireOrSkip(ctx, undefined, skip);
      }
      throw err;
    } finally {
      if (registry.getAll().some((entry) => entry.name === name)) {
        try {
          // Delete uses lock+DELETE which hits 423 on NW 7.50. Best-effort;
          // the SM12 cleanup is the operator's problem on that release.
          await deleteWithLock(url);
          registry.remove(name);
        } catch {
          // best-effort-cleanup
        }
      }
    }
  }, 60_000);

  // issue #343: a DTEL created with a German session must carry German as its
  // master language (not hard-coded EN), so its labels are filed under DE. The
  // DTEL ADT metadata echoes DD04L-DTELMASTER (= the create-body masterLanguage),
  // so this is a valid discriminator (it was "EN" before the fix). On NW 7.50 the
  // v1 handler ignores the body language — skipped via ddicSkipReason there.
  it('DTEL create with SAP_LANGUAGE=DE persists masterLanguage=DE (issue #343)', async (ctx) => {
    const deClient = getTestClient('DE');
    const name = generateUniqueName('ZARC1_LDE');
    const url = `/sap/bc/adt/ddic/dataelements/${name}`;
    try {
      const xml = buildCreateXml(
        'DTEL',
        name,
        '$TMP',
        'Sprachtest',
        { typeKind: 'predefinedAbapType', dataType: 'CHAR', length: 10, shortLabel: 'Kurz', mediumLabel: 'Mittel' },
        'DE',
      );
      expect(xml).toContain('adtcore:masterLanguage="DE"');
      const createResp = await createObject(
        deClient.http,
        deClient.safety,
        '/sap/bc/adt/ddic/dataelements',
        xml,
        DATAELEMENT_V2_CONTENT_TYPE,
      );
      registry.register(url, 'DTEL', name);
      // The create response echoes the persisted DTELMASTER.
      expect(createResp).toContain('adtcore:masterLanguage="DE"');
      // Re-read the persisted metadata to confirm (not just the create echo).
      // Note: Accept must not carry a charset param (SAP returns 406 otherwise).
      const meta = await deClient.http.get(url, { Accept: 'application/vnd.sap.adt.dataelements.v2+xml' });
      expect(meta.body).toContain('adtcore:masterLanguage="DE"');
    } catch (err) {
      const skip = ddicSkipReason(err);
      if (skip) {
        requireOrSkip(ctx, undefined, skip);
      }
      throw err;
    } finally {
      if (registry.getAll().some((entry) => entry.name === name)) {
        try {
          await deleteWithLock(url);
          registry.remove(name);
        } catch {
          // best-effort-cleanup
        }
      }
    }
  }, 60_000);

  // issue #343: DOMA smoke check. The DOMA ADT GET echoes TADIR-MASTERLANG (the
  // sap-language URL param, already DE), NOT the body, so ADT cannot discriminate
  // the DOMMASTER/DD01T text-language fix here — that is covered by the unit test
  // (POST body carries masterLanguage="DE") plus the manual HANA verification in
  // docs/research/2026-06-04-issue-343-masterlanguage-on-create.md. This only asserts that a
  // DE-language DOMA create still succeeds (non-regression).
  it('DOMA create with SAP_LANGUAGE=DE succeeds (issue #343 non-regression)', async (ctx) => {
    const deClient = getTestClient('DE');
    const name = generateUniqueName('ZARC1_LDO');
    const url = `/sap/bc/adt/ddic/domains/${name}`;
    try {
      const xml = buildCreateXml('DOMA', name, '$TMP', 'Sprachtest', { dataType: 'CHAR', length: 10 }, 'DE');
      expect(xml).toContain('adtcore:masterLanguage="DE"');
      const createResp = await createObject(
        deClient.http,
        deClient.safety,
        '/sap/bc/adt/ddic/domains',
        xml,
        DOMAIN_V2_CONTENT_TYPE,
      );
      registry.register(url, 'DOMA', name);
      expect(typeof createResp).toBe('string');
    } catch (err) {
      const skip = ddicSkipReason(err);
      if (skip) {
        requireOrSkip(ctx, undefined, skip);
      }
      throw err;
    } finally {
      if (registry.getAll().some((entry) => entry.name === name)) {
        try {
          await deleteWithLock(url);
          registry.remove(name);
        } catch {
          // best-effort-cleanup
        }
      }
    }
  }, 60_000);

  it('DTEL CRUD lifecycle', async (ctx) => {
    const dataElementName = generateUniqueName('ZARC1_TDEL');
    const dataElementUrl = `/sap/bc/adt/ddic/dataelements/${dataElementName}`;

    try {
      const createXml = buildCreateXml('DTEL', dataElementName, '$TMP', 'ARC-1 test data element', {
        typeKind: 'predefinedAbapType',
        dataType: 'CHAR',
        length: 10,
        shortLabel: 'Status',
        mediumLabel: 'Order Status',
        longLabel: 'Order Processing Status',
        headingLabel: 'Status',
      });

      await createObject(
        client.http,
        client.safety,
        '/sap/bc/adt/ddic/dataelements',
        createXml,
        DATAELEMENT_V2_CONTENT_TYPE,
      );
      registry.register(dataElementUrl, 'DTEL', dataElementName);
      // SAP ignores DTEL labels on POST — follow-up PUT is required to set them
      await safeUpdateObject(client.http, client.safety, dataElementUrl, createXml, DATAELEMENT_V2_CONTENT_TYPE);
      expect((await activate(client.http, client.safety, dataElementUrl)).success).toBe(true);

      const created = await client.getDataElement(dataElementName);
      expect(created.typeKind).toBe('predefinedAbapType');
      expect(created.dataType).toBe('CHAR');
      expect(created.length).toBe('000010');
      expect(created.shortLabel).toBe('Status');

      const updateXml = buildCreateXml('DTEL', dataElementName, '$TMP', 'ARC-1 updated data element', {
        typeKind: 'predefinedAbapType',
        dataType: 'CHAR',
        length: 10,
        shortLabel: 'Stat',
        mediumLabel: 'Status Updated',
        longLabel: 'Order Status Updated',
        headingLabel: 'Status Upd',
      });
      await safeUpdateObject(client.http, client.safety, dataElementUrl, updateXml, DATAELEMENT_V2_CONTENT_TYPE);
      expect((await activate(client.http, client.safety, dataElementUrl)).success).toBe(true);

      const updated = await client.getDataElement(dataElementName);
      expect(updated.shortLabel).toBe('Stat');
      expect(updated.mediumLabel).toBe('Status Updated');

      await deleteWithLock(dataElementUrl);
      registry.remove(dataElementName);

      try {
        await client.getDataElement(dataElementName);
        throw new Error('Expected data element read to fail after delete');
      } catch (err) {
        expectSapFailureClass(err, [404], [/not found/i]);
      }
    } catch (err) {
      const skip = ddicSkipReason(err);
      if (skip) {
        requireOrSkip(ctx, undefined, skip);
      }
      throw err;
    } finally {
      if (registry.getAll().some((entry) => entry.name === dataElementName)) {
        try {
          await deleteWithLock(dataElementUrl);
          registry.remove(dataElementName);
        } catch {
          // best-effort-cleanup
        }
      }
    }
  }, 90_000);

  it('DOMA + DTEL dependency lifecycle', async (ctx) => {
    const domainName = generateUniqueName('ZARC1_DDM');
    const dataElementName = generateUniqueName('ZARC1_DDE');
    const domainUrl = `/sap/bc/adt/ddic/domains/${domainName}`;
    const dataElementUrl = `/sap/bc/adt/ddic/dataelements/${dataElementName}`;

    try {
      const domainCreateXml = buildCreateXml('DOMA', domainName, '$TMP', 'Dependency domain', {
        dataType: 'CHAR',
        length: 1,
        fixedValues: [{ low: 'X', description: 'Test' }],
      });
      await createObject(
        client.http,
        client.safety,
        '/sap/bc/adt/ddic/domains',
        domainCreateXml,
        DOMAIN_V2_CONTENT_TYPE,
      );
      registry.register(domainUrl, 'DOMA', domainName);
      expect((await activate(client.http, client.safety, domainUrl)).success).toBe(true);

      const dataElementCreateXml = buildCreateXml('DTEL', dataElementName, '$TMP', 'Dependency data element', {
        typeKind: 'domain',
        typeName: domainName,
        dataType: 'CHAR',
        length: 1,
        shortLabel: 'Dep',
      });
      await createObject(
        client.http,
        client.safety,
        '/sap/bc/adt/ddic/dataelements',
        dataElementCreateXml,
        DATAELEMENT_V2_CONTENT_TYPE,
      );
      registry.register(dataElementUrl, 'DTEL', dataElementName);
      expect((await activate(client.http, client.safety, dataElementUrl)).success).toBe(true);

      const dataElement = await client.getDataElement(dataElementName);
      expect(dataElement.typeKind).toBe('domain');
      expect(dataElement.typeName).toBe(domainName);

      await deleteWithLock(dataElementUrl);
      registry.remove(dataElementName);
      await deleteWithLock(domainUrl);
      registry.remove(domainName);

      try {
        await client.getDataElement(dataElementName);
        throw new Error('Expected data element read to fail after delete');
      } catch (err) {
        expectSapFailureClass(err, [404], [/not found/i]);
      }
      try {
        await client.getDomain(domainName);
        throw new Error('Expected domain read to fail after delete');
      } catch (err) {
        expectSapFailureClass(err, [404], [/not found/i]);
      }
    } catch (err) {
      const skip = ddicSkipReason(err);
      if (skip) {
        requireOrSkip(ctx, undefined, skip);
      }
      throw err;
    } finally {
      if (registry.getAll().some((entry) => entry.name === dataElementName)) {
        try {
          await deleteWithLock(dataElementUrl);
          registry.remove(dataElementName);
        } catch {
          // best-effort-cleanup
        }
      }
      if (registry.getAll().some((entry) => entry.name === domainName)) {
        try {
          await deleteWithLock(domainUrl);
          registry.remove(domainName);
        } catch {
          // best-effort-cleanup
        }
      }
    }
  }, 90_000);
});
