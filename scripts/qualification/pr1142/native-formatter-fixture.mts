import assert from 'node:assert/strict';
import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';

const path = '/sap/bc/adt/abapsource/prettyprinter/settings';
const contentType = 'application/vnd.sap.adt.ppsettings.v5+xml';
const namespace = 'http://www.sap.com/adt/prettyprintersettings';
const xmlOptions = { ignoreAttributes: false, parseAttributeValue: false, parseTagValue: false };
export const sentinelPreferences = {
  keepIdentifier: 'true',
  formatMethodCalls: 'true',
  condenseMethodCalls: 'true',
  formatValue: 'true',
  defaultAutoStyle: 'keywordLower',
};
const keys = new Set(['indentation', 'style', ...Object.keys(sentinelPreferences)]);

/** Deliberately bounded to the native A4H v5 attribute-only fixture schema, independent of the candidate parser. */
export function formatterFixtureDocument(xml: string) {
  assert.ok(Buffer.byteLength(xml) <= 16384 && !/<!/.test(xml) && XMLValidator.validate(xml) === true);
  const document = new XMLParser(xmlOptions).parse(xml);
  const roots = Object.keys(document).filter((key) => key !== '?xml');
  assert.equal(roots.length, 1);
  const root = roots[0];
  assert.match(root, /^[A-Za-z_][A-Za-z0-9_.-]*:PrettyPrinterSettings$/);
  const prefix = root.split(':')[0];
  const attributes = document[root];
  assert.ok(attributes && typeof attributes === 'object' && !Array.isArray(attributes));
  assert.equal(attributes[`@_xmlns:${prefix}`], namespace);
  const state: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (key === `@_xmlns:${prefix}`) continue;
    assert.ok(key.startsWith(`@_${prefix}:`) && typeof value === 'string', 'Unknown native fixture shape');
    const name = key.slice(prefix.length + 3);
    assert.ok(keys.has(name), 'Unqualified native fixture preference');
    state[name] = value as string;
  }
  assert.ok(['true', 'false'].includes(state.indentation));
  assert.ok(['none', 'toUpper', 'toLower', 'keywordUpper', 'keywordLower', 'keywordAuto'].includes(state.style));
  for (const name of Object.keys(sentinelPreferences).filter((name) => name !== 'defaultAutoStyle'))
    if (state[name] !== undefined) assert.ok(['true', 'false'].includes(state[name]));
  if (state.defaultAutoStyle !== undefined)
    assert.ok(['none', 'toUpper', 'toLower', 'keywordUpper', 'keywordLower'].includes(state.defaultAutoStyle));
  return { document, attributes, prefix, state };
}

export function seededFormatterDocument(original: string) {
  const parsed = formatterFixtureDocument(original);
  const expected = { ...parsed.state, ...sentinelPreferences };
  for (const [name, value] of Object.entries(sentinelPreferences))
    parsed.attributes[`@_${parsed.prefix}:${name}`] = value;
  const xml = new XMLBuilder({ ...xmlOptions, suppressBooleanAttributes: false, suppressEmptyNode: true }).build(
    parsed.document,
  );
  assert.deepEqual(formatterFixtureDocument(xml).state, expected);
  return { xml, state: expected };
}

export function assertSeededPreferences(xml: string) {
  const { state } = formatterFixtureDocument(xml);
  for (const [name, value] of Object.entries(sentinelPreferences))
    assert.equal(state[name], value, `Missing seeded ${name}`);
}

function matches(actual: unknown, expected: unknown) {
  try {
    assert.deepEqual(actual, expected);
    return true;
  } catch {
    return false;
  }
}

/** Native fixture setup/restore. Its original full XML is persisted before any PUT. */
export async function nativeFormatterFixture({ mode, http, run, root, read, write, expectedSettings, required }: any) {
  const file = `${root}/native-formatter-seed.json`;
  const options = { deadline: Date.now() + 60_000, noReplay: true, retryTransientErrors: false };
  const headers = { Accept: '*/*', 'Cache-Control': 'no-cache' };
  const get = async () => {
    const response = await http.get(path, headers, options);
    assert.equal(response.headers['content-type']?.split(';')[0], contentType);
    return { response, ...formatterFixtureDocument(response.body) };
  };
  const put = async (xml: string, prior: any) => {
    const etag = prior.response.headers.etag;
    if (etag !== undefined) assert.ok(/^(?:W\/)?"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag) && etag.length <= 1024);
    await http.put(
      path,
      xml,
      contentType,
      {
        ...headers,
        ...(etag && !etag.startsWith('W/') ? { 'If-Match': etag } : {}),
      },
      options,
    );
  };
  if (mode === 'seed') {
    const before = await get();
    assert.deepEqual({ indentation: before.state.indentation === 'true', style: before.state.style }, expectedSettings);
    const seeded = seededFormatterDocument(before.response.body);
    const ledger = {
      runId: run.runId,
      sourceRevision: run.sourceRevision,
      harnessSha256: run.harnessSha256,
      originalXml: before.response.body,
      originalState: before.state,
      seededState: seeded.state,
      phase: 'prepared',
      preparedAt: new Date().toISOString(),
      concurrency: before.response.headers.etag?.startsWith('"') ? 'strong-etag' : 'native-unconditional',
    };
    await write(file, ledger, true);
    if (!matches(before.state, seeded.state)) {
      ledger.phase = 'seed-submitted';
      await write(file, ledger);
      await put(seeded.xml, before);
    }
    const after = await get();
    assert.deepEqual(after.state, seeded.state, 'Native seeding was not confirmed');
    assertSeededPreferences(after.response.body);
    ledger.phase = 'seeded';
    await write(file, ledger);
    return { status: 'complete', seeded: true, sentinelFields: Object.keys(sentinelPreferences) };
  }
  assert.equal(mode, 'restore-seed');
  let ledger;
  try {
    ledger = await read(file);
  } catch (error: any) {
    if (error.code === 'ENOENT' && !required) return { status: 'not-required', originalBytesRestored: true };
    throw error;
  }
  for (const key of ['runId', 'sourceRevision', 'harnessSha256'])
    assert.equal(ledger[key], run[key], 'Seed receipt binding differs');
  assert.deepEqual(formatterFixtureDocument(ledger.originalXml).state, ledger.originalState);
  assert.deepEqual(seededFormatterDocument(ledger.originalXml).state, ledger.seededState);
  const before = await get();
  if (!matches(before.state, ledger.originalState)) {
    assert.deepEqual(before.state, ledger.seededState, 'Native preferences changed; preserve foreign work');
    ledger.phase = 'restore-submitted';
    await write(file, ledger);
    await put(ledger.originalXml, before);
  }
  const after = await get();
  assert.deepEqual(after.state, ledger.originalState);
  assert.equal(after.response.body, ledger.originalXml, 'Original full native XML was not restored');
  ledger.phase = 'restored';
  ledger.restoredAt = new Date().toISOString();
  await write(file, ledger);
  return { status: 'complete', originalBytesRestored: true };
}
