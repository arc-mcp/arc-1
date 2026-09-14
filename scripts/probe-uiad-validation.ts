/** Explicit live probe: TEST_SAP_URL/USER/PASSWORD/CLIENT; owned $TMP fixture only. */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { AdtClient } from '../src/adt/client.js';
import { defaultSafetyConfig } from '../src/adt/safety.js';
import { ensureServerDrivenSupport, serverDrivenObjectUrl } from '../src/adt/server-driven.js';
import { parseUiadSource, validateUiadSource } from '../src/adt/uiad.js';
import { handleToolCall } from '../src/handlers/dispatch.js';
import { resetCachedFeatures } from '../src/handlers/feature-cache.js';
import { DEFAULT_CONFIG } from '../src/server/types.js';

const { TEST_SAP_URL, TEST_SAP_USER, TEST_SAP_PASSWORD, TEST_SAP_CLIENT, TEST_UIAD_READONLY_NAME } = process.env;
assert(TEST_SAP_URL && TEST_SAP_USER && TEST_SAP_PASSWORD, 'Set TEST_SAP_URL, TEST_SAP_USER, TEST_SAP_PASSWORD.');
const client = new AdtClient({
  baseUrl: TEST_SAP_URL,
  username: TEST_SAP_USER,
  password: TEST_SAP_PASSWORD,
  client: TEST_SAP_CLIENT ?? '001',
  safety: { ...defaultSafetyConfig(), allowWrites: true },
});
const available = await ensureServerDrivenSupport(client.http, client.safety, 'UIAD');
if (!available) {
  console.log(JSON.stringify({ available: false, mutated: false }));
} else {
  const name = `ZARC1_UIAD_${randomBytes(6).toString('hex').toUpperCase()}`;
  const uri = serverDrivenObjectUrl('UIAD', name);
  const config = {
    ...DEFAULT_CONFIG,
    allowWrites: true,
    allowedPackages: ['$TMP'],
    lintBeforeWrite: false,
    username: TEST_SAP_USER,
  };
  const candidate = {
    formatVersion: '2',
    header: {
      description: 'ARC1 UIAD validation probe',
      originalLanguage: 'en',
      abapLanguageVersion: 'cloudDevelopment',
    },
    generalInformation: { appType: 'url', catalogId: 'SAP_TC_ALV5_DEFAULT' },
    navigation: {
      targetMappingId: `${name}_TM`,
      semanticObject: 'ZArc1Validation',
      action: 'display',
      targetUrl: 'https://example.com',
      desktop: true,
    },
    tiles: [],
  };
  const evidence: Record<string, unknown>[] = [];
  const exists = async () => (await client.searchObject(name, 10)).some((object) => object.objectName === name);
  const call = async (action: string, source?: unknown) => {
    resetCachedFeatures();
    return handleToolCall(client, config, 'SAPWrite', {
      action,
      type: 'UIAD',
      name,
      package: '$TMP',
      description: 'ARC1 UIAD validation probe',
      ...(source === undefined ? {} : { source: JSON.stringify(source) }),
    });
  };
  assert.equal(await exists(), false, 'Random fixture must be absent before the probe.');
  let createAttempted = false;
  try {
    for (const catalog of ['', 'X'.repeat(36)]) {
      const result = await call('create', {
        ...candidate,
        generalInformation: { ...candidate.generalInformation, catalogId: catalog },
      });
      assert.equal(result.isError, true);
      const outcome = JSON.parse(result.content[0].text);
      assert.equal(outcome.metadata, 'notAttempted');
      assert.equal(outcome.source, 'notAttempted');
      assert.equal(outcome.validation.schema, 'passed');
      assert.equal(outcome.validation.semantic, 'failed');
      assert.equal(await exists(), false);
      evidence.push({ case: catalog ? 'catalog-length' : 'empty-catalog', validation: outcome.validation });
    }
    createAttempted = true;
    const created = await call('create', candidate);
    assert.equal(created.isError, undefined, created.content[0].text);
    assert.equal(JSON.parse(created.content[0].text).source, 'saved');
    const readSource = async () =>
      JSON.parse((await client.http.get(`${uri}/source/main`, { Accept: 'application/json' })).body);
    assert.equal((await readSource()).navigation.targetUrl, candidate.navigation.targetUrl);
    candidate.navigation.targetUrl = 'https://example.com/updated';
    const updated = await call('update', candidate);
    assert.equal(updated.isError, undefined, updated.content[0].text);
    assert.equal((await readSource()).navigation.targetUrl, candidate.navigation.targetUrl);
    evidence.push({ case: 'create-update-readback', passed: true });
    candidate.formatVersion = '1';
    candidate.navigation.targetUrl = 'https://example.com/aff-v1';
    const legacy = await call('update', candidate);
    assert.equal(legacy.isError, undefined, legacy.content[0].text);
    assert.equal(JSON.parse(legacy.content[0].text).validation.schema, 'unavailable');
    const legacyReadback = await readSource();
    assert.equal(legacyReadback.navigation.targetUrl, candidate.navigation.targetUrl);
    evidence.push({ case: 'aff-v1-update-readback', passed: true, storedFormatVersion: legacyReadback.formatVersion });
    if (TEST_UIAD_READONLY_NAME) {
      const readonlyUri = serverDrivenObjectUrl('UIAD', TEST_UIAD_READONLY_NAME);
      const read = async () =>
        (await client.http.get(`${readonlyUri}/source/main`, { Accept: 'application/json' })).body;
      const before = await read();
      const validation = await validateUiadSource(
        client.http,
        defaultSafetyConfig(),
        readonlyUri,
        before,
        parseUiadSource(before).value,
        false,
      );
      assert.equal(validation.configuration, 'readonly');
      assert.equal(
        createHash('sha256')
          .update(await read())
          .digest('hex'),
        createHash('sha256').update(before).digest('hex'),
      );
      evidence.push({ case: 'readonly-unchanged', passed: true });
    }
  } finally {
    if (createAttempted && (await exists())) {
      const deleted = await call('delete');
      assert.equal(deleted.isError, undefined, deleted.content[0].text);
    }
    assert.equal(await exists(), false, `Cleanup required for owned fixture ${name}.`);
    evidence.push({ case: 'cleanup', absent: true });
    console.log(JSON.stringify({ available: true, evidence }));
  }
}
