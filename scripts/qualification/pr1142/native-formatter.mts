import assert from 'node:assert/strict';
import { parseXml } from '../../../src/adt/xml-parser.js';
import { getTestClient } from '../../../tests/integration/helpers.js';
import { durable } from './durable-journal.mjs';
import { digest } from './fixture-contract.mjs';
import { assertSeededPreferences, nativeFormatterFixture } from './native-formatter-fixture.mjs';
import { configuration, validateConfiguration } from './qualification-config.mjs';
import { retainNativeWorkerOnInterrupt } from './process-boundaries.mjs';
import { verifyRunManifest } from './run-manifest.mjs';
import { assertSafeDiagnosticEnvironment, privateJson } from './safe-io.mjs';

retainNativeWorkerOnInterrupt();
assertSafeDiagnosticEnvironment();
validateConfiguration(configuration);
await verifyRunManifest(configuration.root);
const { root } = configuration;
const [mode, attempt] = process.argv.slice(2);
assert.ok(['seed', 'restore-seed', 'before', 'during-primary', 'during-secondary', 'after'].includes(mode));
assert.match(attempt, /^[a-f0-9-]{36}$/);
assert.equal(process.env.TEST_SAP_URL, 'https://a4h.marianzeis.de');
assert.equal(process.env.TEST_SAP_CLIENT, '001');
assert.equal(process.env.TEST_SAP_INSECURE, 'false');
const journal = await privateJson(`${root}/formatter-qualification.json`);
const run = await privateJson(`${root}/run-manifest.json`);
assert.equal(journal.runId, run.runId);
assert.equal(journal.sourceRevision, run.sourceRevision);
const client = getTestClient();
assert.equal(client.username, configuration.actors[0].sapUser);
assert.equal(client.sapClient, '001');
if (mode === 'seed' || mode === 'restore-seed') {
  const result = await nativeFormatterFixture({
    mode,
    http: client.http,
    run,
    root,
    read: privateJson,
    write: durable,
    expectedSettings: journal.baseline.writerA,
    required: journal.nativeSeedAttempted === true,
  });
  await durable(
    `${root}/native-formatter-${mode}-${attempt}.json`,
    {
      mode,
      attempt,
      runId: run.runId,
      sourceRevision: run.sourceRevision,
      at: new Date().toISOString(),
      nativeReader: client.username,
      nativeUrl: 'https://a4h.marianzeis.de',
      client: '001',
      ...result,
    },
    true,
  );
  console.log(JSON.stringify({ mode, ...result }));
} else {
  const response = await client.http.get(
    '/sap/bc/adt/abapsource/prettyprinter/settings',
    { Accept: '*/*', 'Cache-Control': 'no-cache' },
    { deadline: Date.now() + 30000, noReplay: true, retryTransientErrors: false },
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type']?.split(';')[0], 'application/vnd.sap.adt.ppsettings.v5+xml');
  assert.ok(Buffer.byteLength(response.body) < 16384);
  const document = parseXml(response.body);
  const settings = document.PrettyPrinterSettings as Record<string, string>;
  assert.ok(settings);
  assert.ok(['true', 'false'].includes(settings['@_indentation']));
  const report: any = {
    mode,
    attempt,
    runId: run.runId,
    sourceRevision: run.sourceRevision,
    at: new Date().toISOString(),
    nativeReader: client.username,
    nativeUrl: 'https://a4h.marianzeis.de',
    client: '001',
    settings: { indentation: settings['@_indentation'] === 'true', style: settings['@_style'] },
    sha256: digest(response.body),
    xml: response.body,
    document,
  };
  const expected = mode.startsWith('during') ? journal.expected.writerA : journal.baseline.writerA;
  assert.deepEqual(report.settings, expected);
  if (mode === 'before') {
    const seed = await privateJson(`${root}/native-formatter-seed.json`);
    for (const key of ['runId', 'sourceRevision', 'harnessSha256']) assert.equal(seed[key], run[key]);
    assert.equal(seed.phase, 'seeded');
    assertSeededPreferences(response.body);
    await durable(`${root}/native-formatter-baseline.json`, report, true);
  } else {
    const before = await privateJson(`${root}/native-formatter-baseline.json`);
    assert.equal(before.runId, run.runId);
    if (mode === 'after') {
      report.originalBytesRestored = response.body === before.xml;
      assert.equal(report.originalBytesRestored, true);
    } else {
      const expectedDocument = structuredClone(before.document);
      expectedDocument.PrettyPrinterSettings['@_indentation'] = String(expected.indentation);
      expectedDocument.PrettyPrinterSettings['@_style'] = expected.style;
      assert.deepEqual(document, expectedDocument, 'Native preferences differ beyond the intended primary patch');
      report.unrelatedPreserved = true;
    }
  }
  report.status = 'complete';
  await durable(`${root}/native-formatter-${mode}-${attempt}.json`, report, true);
  console.log(
    JSON.stringify({
      mode,
      status: report.status,
      settings: report.settings,
      originalBytesRestored: report.originalBytesRestored,
      unrelatedPreserved: report.unrelatedPreserved,
    }),
  );
}
