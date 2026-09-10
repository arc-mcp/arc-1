/**
 * Product-path verification for issue #771.
 *
 * Creates disposable $TMP DTELs and verifies create/read/update/activation, the zero boundary,
 * schema rejection, and cleanup. SAP_BASIS 750 uses explicit-version reads around its separately
 * documented default-read anomaly; 758 and 816 use the public handlers throughout.
 *
 * Run:
 * ARC1_RESEARCH_ENV=/path/to/.env.infrastructure \
 *   node --import tsx docs/research/issues/771-evidence/verify-fix.mts 758
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { AdtClient } from '../../../../src/adt/client.js';
import { deleteObject, lockObject, safeUpdateObject, unlockObject } from '../../../../src/adt/crud.js';
import { buildDataElementXml } from '../../../../src/adt/ddic-xml.js';
import { activate as activateDirect } from '../../../../src/adt/devtools.js';
import { defaultSafetyConfig } from '../../../../src/adt/safety.js';
import { parseDataElementMetadata } from '../../../../src/adt/xml-parser.js';
import { handleToolCall } from '../../../../src/handlers/dispatch.js';
import { mergeMetadataWriteProperties } from '../../../../src/handlers/write-helpers.js';
import { DEFAULT_CONFIG } from '../../../../src/server/types.js';

const release = process.argv[2];
if (!['750', '758', '816'].includes(release)) throw new Error('Select test release: 750, 758, or 816');
const envPath = process.env.ARC1_RESEARCH_ENV;
if (!envPath) throw new Error('ARC1_RESEARCH_ENV must name the local infrastructure credentials file');
const env = dotenv.parse(fs.readFileSync(envPath));
const target =
  release === '758'
    ? {
        baseUrl: 'https://a4h.marianzeis.de',
        username: env.SAP_S4_PRIMARY_USER,
        password: env.SAP_S4_PRIMARY_PASSWORD,
        client: '001',
      }
    : release === '816'
      ? {
          baseUrl: env.SAP_A4H_2025_PUBLIC_URL,
          username: env.SAP_A4H_2025_USER,
          password: env.SAP_A4H_2025_PASSWORD,
          client: env.SAP_A4H_2025_CLIENT,
        }
      : {
          baseUrl: env.SAP_NPL_HTTPS_URL,
          username: env.SAP_NPL_USER,
          password: env.SAP_NPL_PASSWORD,
          client: env.SAP_NPL_CLIENT,
        };

for (const [key, value] of Object.entries(target)) {
  if (!value) throw new Error(`Missing target setting: ${key}`);
}

const safety = { ...defaultSafetyConfig(), allowWrites: true, allowedPackages: ['$TMP'] };
const config = {
  ...DEFAULT_CONFIG,
  sapUrl: target.baseUrl,
  username: target.username,
  password: target.password,
  client: target.client,
  allowWrites: true,
  allowedPackages: ['$TMP'],
  systemType: 'onprem' as const,
  language: 'EN',
  lintBeforeWrite: false,
  checkBeforeWrite: false,
};
const client = () => new AdtClient({ ...target, safety, language: 'EN', retryUnauthorized: false });
const stamp = Date.now().toString(36).toUpperCase();
const fullName = `Z771F${release}${stamp}A`;
const zeroName = `Z771F${release}${stamp}Z`;
const invalidName = `Z771F${release}${stamp}I`;
const created = new Set<string>();
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), release);
const outputFile = path.join(out, 'fix-results.json');
const events: Array<Record<string, unknown>> = [];
fs.mkdirSync(out, { recursive: true });

function record(event: Record<string, unknown>) {
  events.push(event);
  fs.writeFileSync(outputFile, `${JSON.stringify(events, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function call(label: string, tool: string, args: Record<string, unknown>, expectError = false) {
  const result = await handleToolCall(client(), config, tool, args);
  record({ label, tool, args, isError: result.isError === true, result: result.content[0]?.text ?? '' });
  if ((result.isError === true) !== expectError) throw new Error(`${label}: unexpected tool result`);
  return result;
}

async function read(label: string, name: string, version: 'active' | 'inactive') {
  if (release === '750') {
    const response = await client().http.get(`/sap/bc/adt/ddic/dataelements/${name}?version=${version}`);
    const parsed = parseDataElementMetadata(response.body) as unknown as Record<string, unknown>;
    record({ label, tool: 'versioned ADT read + production parser', args: { type: 'DTEL', name, version }, parsed });
    return parsed;
  }
  const result = await call(label, 'SAPRead', { type: 'DTEL', name, version });
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

async function activate(label: string, name: string) {
  if (release === '750') {
    const c = client();
    const metadata = await c.http.get(`/sap/bc/adt/ddic/dataelements/${name}?version=inactive`);
    if (!metadata.body.includes('adtcore:name="$TMP"')) throw new Error(`Unexpected package for ${name}`);
    const result = await activateDirect(c.http, safety, `/sap/bc/adt/ddic/dataelements/${name}`, { name });
    record({ label, tool: 'direct production activation helper', result });
    return;
  }
  await call(label, 'SAPActivate', { type: 'DTEL', name });
}

function expectFields(label: string, value: Record<string, unknown>, expectedShortLength = '10') {
  const expected = {
    shortLength: expectedShortLength,
    mediumLength: '20',
    longLength: '40',
    headingLength: '55',
    deactivateInputHistory: true,
  };
  for (const [key, wanted] of Object.entries(expected)) {
    if (value[key] !== wanted) throw new Error(`${label}: expected ${key}=${wanted}, got ${String(value[key])}`);
  }
  record({ label: `${label}-asserted`, expected });
}

async function confirmMissing(name: string, version?: 'active' | 'inactive') {
  const suffix = version ? `?version=${version}` : '';
  try {
    await client().http.get(`/sap/bc/adt/ddic/dataelements/${name}${suffix}`);
    throw new Error(`${name} still exists${version ? ` (${version})` : ''}`);
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode !== 404) throw error;
  }
}

async function robustDelete(name: string) {
  const c = client();
  try {
    const result = await handleToolCall(c, config, 'SAPWrite', { action: 'delete', type: 'DTEL', name });
    if (result.isError !== true) {
      record({ label: 'cleanup-delete', name, path: 'SAPWrite' });
      return;
    }
  } catch {
    // The direct fallback below keeps cleanup independent from the 7.50 default-read session quirk.
  }
  const uri = `/sap/bc/adt/ddic/dataelements/${name}`;
  const metadata = await c.http.get(`${uri}?version=inactive`).catch(async () => c.http.get(`${uri}?version=active`));
  if (!metadata.body.includes('adtcore:name="$TMP"')) throw new Error(`Refusing to delete non-$TMP object ${name}`);
  await c.http.withStatefulSession(async (session) => {
    const lock = await lockObject(session, safety, uri, 'MODIFY', release);
    try {
      await deleteObject(session, safety, uri, lock.lockHandle);
    } finally {
      await unlockObject(session, uri, lock.lockHandle);
    }
  });
  record({ label: 'cleanup-delete', name, path: 'direct-fallback' });
}

try {
  const basis = (await client().getInstalledComponents()).find((component) => component.name === 'SAP_BASIS');
  record({ label: 'system', release, component: basis });
  for (const name of [fullName, zeroName, invalidName]) await confirmMissing(name);

  const labels = {
    shortLabel: 'ABCDEF',
    mediumLabel: 'ABCDEFGHIJKL',
    longLabel: 'ABCDEFGHIJKLMNOPQRSTU',
    headingLabel: 'ABCDEF',
  };
  const metadata = {
    shortLength: 10,
    mediumLength: 20,
    longLength: 40,
    headingLength: 55,
    deactivateInputHistory: true,
  };

  created.add(fullName);
  await call('create-explicit', 'SAPWrite', {
    action: 'create',
    type: 'DTEL',
    name: fullName,
    package: '$TMP',
    description: 'Issue 771 fix verification',
    typeKind: 'predefinedAbapType',
    dataType: 'CHAR',
    length: 60,
    ...labels,
    ...metadata,
  });
  expectFields('created-inactive', await read('read-created-inactive', fullName, 'inactive'));
  await activate('activate-created', fullName);
  expectFields('created-active', await read('read-created-active', fullName, 'active'));

  if (release === '750') {
    const c = client();
    const current = parseDataElementMetadata(
      (await c.http.get(`/sap/bc/adt/ddic/dataelements/${fullName}?version=active`)).body,
    );
    const merged = await mergeMetadataWriteProperties(
      { getDataElement: async () => current } as unknown as AdtClient,
      'DTEL',
      fullName,
      {},
    );
    const body = buildDataElementXml({
      ...(merged as Parameters<typeof buildDataElementXml>[0]),
      name: fullName,
      package: '$TMP',
      description: 'Issue 771 preserved metadata',
      responsible: target.username,
    });
    await safeUpdateObject(
      c.http,
      safety,
      `/sap/bc/adt/ddic/dataelements/${fullName}`,
      body,
      'application/vnd.sap.adt.dataelements.v2+xml',
      undefined,
      release,
    );
    record({
      label: 'description-only-update',
      path: 'production merge, builder, and CRUD with explicit-version read workaround',
    });
  } else {
    await call('description-only-update', 'SAPWrite', {
      action: 'update',
      type: 'DTEL',
      name: fullName,
      description: 'Issue 771 preserved metadata',
    });
  }
  const updated = await read('read-updated-inactive', fullName, 'inactive');
  if (updated.description !== 'Issue 771 preserved metadata') throw new Error('Description update did not persist');
  expectFields('updated-inactive', updated);
  await activate('activate-updated', fullName);
  expectFields('updated-active', await read('read-updated-active', fullName, 'active'));

  created.add(zeroName);
  await call('create-zero', 'SAPWrite', {
    action: 'create',
    type: 'DTEL',
    name: zeroName,
    package: '$TMP',
    description: 'Issue 771 zero boundary',
    typeKind: 'predefinedAbapType',
    dataType: 'CHAR',
    length: 1,
    shortLength: 0,
  });
  await activate('activate-zero', zeroName);
  const zero = await read('read-zero-active', zeroName, 'active');
  if (zero.shortLength !== '00') throw new Error(`Expected zero shortLength, got ${String(zero.shortLength)}`);
  record({ label: 'zero-asserted', shortLength: zero.shortLength });

  await call(
    'reject-invalid',
    'SAPWrite',
    {
      action: 'create',
      type: 'DTEL',
      name: invalidName,
      package: '$TMP',
      typeKind: 'predefinedAbapType',
      dataType: 'CHAR',
      length: 1,
      shortLength: 11,
    },
    true,
  );
  await confirmMissing(invalidName);
  record({ label: 'invalid-object-absent', name: invalidName });
} finally {
  for (const name of created) {
    try {
      await robustDelete(name);
    } catch (error) {
      record({ label: 'cleanup-error', name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  for (const name of created) {
    for (const version of ['active', 'inactive'] as const) {
      await confirmMissing(name, version);
      record({ label: 'cleanup-confirmed-404', name, version });
    }
  }
}
