/** Historical reproduction runner for reviewed base c55adcb8; expected assertions describe the former defect.
 * Run: ARC1_RESEARCH_ENV=/path/to/.env.infrastructure node --import tsx docs/research/issues/771-evidence/live.mts 758
 * Credentials stay in memory. Each created object is deleted in finally.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { AdtClient } from '../../../../src/adt/client.js';
import { defaultSafetyConfig } from '../../../../src/adt/safety.js';
import { buildDataElementXml } from '../../../../src/adt/ddic-xml.js';
import { createObject, safeUpdateObject, lockObject, unlockObject, deleteObject } from '../../../../src/adt/crud.js';
import { activate as activateDirect } from '../../../../src/adt/devtools.js';
import { handleToolCall } from '../../../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../../../src/server/types.js';

const id = process.argv[2];
if (!['750', '758', '816'].includes(id)) throw new Error('Select test release: 750, 758, or 816');
const envPath = process.env.ARC1_RESEARCH_ENV;
if (!envPath) throw new Error('ARC1_RESEARCH_ENV must name the local infrastructure credentials file');
const e = dotenv.parse(fs.readFileSync(envPath));
const target =
  id === '758'
    ? {
        baseUrl: 'https://a4h.marianzeis.de',
        username: e.SAP_S4_PRIMARY_USER,
        password: e.SAP_S4_PRIMARY_PASSWORD,
        client: '001',
      }
    : id === '816'
      ? {
          baseUrl: e.SAP_A4H_2025_PUBLIC_URL,
          username: e.SAP_A4H_2025_USER,
          password: e.SAP_A4H_2025_PASSWORD,
          client: e.SAP_A4H_2025_CLIENT,
        }
      : {
          baseUrl: e.SAP_NPL_HTTPS_URL,
          username: e.SAP_NPL_USER,
          password: e.SAP_NPL_PASSWORD,
          client: e.SAP_NPL_CLIENT,
        };
const safety = { ...defaultSafetyConfig(), allowWrites: true, allowedPackages: ['$TMP'] };
const client = new AdtClient({ ...target, safety, language: 'EN', retryUnauthorized: false });
const config = {
  ...DEFAULT_CONFIG,
  ...target,
  sapUrl: target.baseUrl,
  allowWrites: true,
  allowedPackages: ['$TMP'],
  systemType: 'onprem' as const,
  language: 'EN',
  lintBeforeWrite: false,
  checkBeforeWrite: false,
};
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), id);
fs.mkdirSync(out, { recursive: true });
const events: unknown[] = [];
function record(event: Record<string, unknown>) {
  events.push(event);
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(events, null, 2) + '\n');
  console.log(JSON.stringify(event));
}
function save(label: string, body: string) {
  fs.writeFileSync(path.join(out, `${label}.xml`), body);
}
function fields(body: string) {
  const value = (tag: string) => body.match(new RegExp(`<dtel:${tag}>([^<]*)</dtel:${tag}>`))?.[1] ?? '';
  return {
    lengths: ['short', 'medium', 'long', 'heading'].map((k) => value(`${k}FieldLength`)),
    labels: ['short', 'medium', 'long', 'heading'].map((k) => value(`${k}FieldLabel`)),
    deactivateInputHistory: value('deactivateInputHistory'),
    changeDocument: value('changeDocument'),
  };
}
const names = ['A', 'B', 'C'].map((suffix) => `Z771_${id}_${Date.now().toString(36).toUpperCase()}${suffix}`);
const created = new Set<string>();
const url = (name: string) => `/sap/bc/adt/ddic/dataelements/${name}`;
const ct = 'application/vnd.sap.adt.dataelements.v2+xml';
const props = {
  typeKind: 'predefinedAbapType' as const,
  dataType: 'CHAR',
  length: 60,
  shortLabel: 'ABCDEF',
  mediumLabel: 'ABCDEFGHIJKL',
  longLabel: 'ABCDEFGHIJKLMNOPQRSTU',
  headingLabel: 'ABCDEF',
};
const explicit = { shortLength: 10, mediumLength: 20, longLength: 40, headingLength: 55, deactivateInputHistory: true };
async function call(label: string, tool: string, args: Record<string, unknown>, expectedError = false) {
  const result = await handleToolCall(client, config, tool, args);
  record({ label, tool, args, result });
  if (Boolean(result.isError) !== expectedError) throw new Error(`${label}: unexpected tool error status`);
  return result;
}
async function snapshot(label: string, name: string, active = false) {
  const r = await client.http.get(
    `${url(name)}${active ? '?version=active' : id === '750' ? '?version=inactive' : ''}`,
  );
  save(label, r.body);
  record({ label, ...fields(r.body) });
  return r.body;
}
async function activate(label: string, name: string) {
  if (id === '750') {
    // Default GET was session-sensitive on 750 even after activation. Verify
    // the test object's package from its explicit inactive version instead.
    const r = await client.http.get(`${url(name)}?version=inactive`);
    if (!r.body.includes('adtcore:name="$TMP"')) throw new Error('Unexpected test-object package');
    const result = await activateDirect(client.http, safety, url(name), { name });
    record({ label, directActivationFor750: true, result });
    return;
  }
  await call(label, 'SAPActivate', { type: 'DTEL', name });
}
function customXml(name: string) {
  let body = buildDataElementXml({
    ...props,
    name,
    description: 'Issue 771 disposable probe',
    package: '$TMP',
    responsible: target.username,
  });
  for (const [i, key] of ['short', 'medium', 'long', 'heading'].entries()) {
    body = body.replace(
      new RegExp(`(<dtel:${key}FieldLength>)[^<]*(</dtel:${key}FieldLength>)`),
      `$1${[10, 20, 40, 55][i]}$2`,
    );
  }
  return body.replace('<dtel:deactivateInputHistory>false', '<dtel:deactivateInputHistory>true');
}
try {
  const components = await client.getInstalledComponents();
  record({
    label: 'system',
    baseUrl: target.baseUrl,
    client: target.client,
    components: components.filter((x) => x.name === 'SAP_BASIS'),
  });
  const mandt = await client.http.get('/sap/bc/adt/ddic/dataelements/MANDT');
  save('MANDT', mandt.body);
  record({ label: 'standard-MANDT', ...fields(mandt.body) });
  await call(
    'rejected-explicit-create',
    'SAPWrite',
    { action: 'create', type: 'DTEL', name: names[0], package: '$TMP', ...props, ...explicit },
    true,
  );
  // Use a separate read-only session for existence checks. A prior 404 on NPL
  // remained observable on the creating session after successful activation.
  const existenceClient = new AdtClient({ ...target, language: 'EN', retryUnauthorized: false });
  for (const name of names) {
    try {
      await existenceClient.http.get(url(name));
      throw new Error(`Refusing to reuse existing ${name}`);
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 404) throw err;
    }
  }
  created.add(names[0]);
  await call('arc-create-labels', 'SAPWrite', {
    action: 'create',
    type: 'DTEL',
    name: names[0],
    package: '$TMP',
    description: 'Issue 771 disposable probe',
    ...props,
  });
  await snapshot('arc-created', names[0]);
  await activate('arc-created-activate', names[0]);
  await snapshot('arc-created-active', names[0], true);
  await call(
    'rejected-explicit-update',
    'SAPWrite',
    { action: 'update', type: 'DTEL', name: names[0], ...explicit },
    true,
  );
  const desired = customXml(names[0]);
  save('direct-put-request', desired);
  await safeUpdateObject(client.http, safety, url(names[0]), desired, ct, undefined, id);
  await snapshot('direct-put', names[0]);
  await activate('direct-put-activate', names[0]);
  await snapshot('direct-put-active', names[0], true);
  await call('arc-read-after-direct-put', 'SAPRead', { type: 'DTEL', name: names[0] });
  await call('arc-description-only-update', 'SAPWrite', {
    action: 'update',
    type: 'DTEL',
    name: names[0],
    description: 'Issue 771 description only',
  });
  await snapshot('arc-description-only', names[0]);
  await activate('description-only-activate', names[0]);
  await snapshot('arc-description-only-active', names[0], true);

  created.add(names[1]);
  const postBody = customXml(names[1]);
  save('direct-post-request', postBody);
  const postResponse = await createObject(
    client.http,
    safety,
    '/sap/bc/adt/ddic/dataelements',
    postBody,
    ct,
    undefined,
    '$TMP',
    id,
    'onprem',
    names[1],
  );
  save('direct-post-response', postResponse);
  await snapshot('direct-post', names[1]);
  await safeUpdateObject(client.http, safety, url(names[1]), postBody, ct, undefined, id);
  await snapshot('direct-post-followup-put', names[1]);
  await activate('post-followup-activate', names[1]);
  await snapshot('direct-post-followup-active', names[1], true);
  const falseBody = postBody.replace('<dtel:deactivateInputHistory>true', '<dtel:deactivateInputHistory>false');
  await safeUpdateObject(client.http, safety, url(names[1]), falseBody, ct, undefined, id);
  await snapshot('direct-explicit-false', names[1]);

  created.add(names[2]);
  await call('arc-batch-explicit-fields', 'SAPWrite', {
    action: 'batch_create',
    package: '$TMP',
    objects: [{ type: 'DTEL', name: names[2], description: 'Issue 771 batch probe', ...props, ...explicit }],
  });
  await snapshot('arc-batch', names[2]);
  if (id === '750') await activate('batch-activate-for-cleanup', names[2]);
  if (id === '758') {
    for (const length of [0, 5, 11, -1, 6.5]) {
      const body = desired.replace(/(<dtel:shortFieldLength>)[^<]*(<\/dtel:shortFieldLength>)/, `$1${length}$2`);
      save(`edge-short-${length}-request`, body);
      try {
        await safeUpdateObject(client.http, safety, url(names[0]), body, ct, undefined, id);
        await snapshot(`edge-short-${length}`, names[0]);
      } catch (err) {
        const error = err as { statusCode?: number; message?: string; responseBody?: string };
        record({ label: `edge-short-${length}`, statusCode: error.statusCode, message: error.message });
        if (error.responseBody) save(`edge-short-${length}-error`, error.responseBody);
      }
    }
  }
} finally {
  for (const name of created) {
    try {
      if (id === '750') {
        const body = await client.http
          .get(`${url(name)}?version=inactive`)
          .catch(async () => client.http.get(`${url(name)}?version=active`));
        if (!body.body.includes('adtcore:name="$TMP"')) throw new Error('Unexpected test-object package');
        await client.http.withStatefulSession(async (session) => {
          const lock = await lockObject(session, safety, url(name), 'MODIFY', id);
          try {
            await deleteObject(session, safety, url(name), lock.lockHandle);
          } finally {
            await unlockObject(session, url(name), lock.lockHandle);
          }
        });
        record({ label: 'cleanup-delete', directDeleteFor750: true, name });
      } else await call('cleanup-delete', 'SAPWrite', { action: 'delete', type: 'DTEL', name });
      try {
        await client.http.get(url(name));
        record({ label: 'cleanup-FAILED-still-exists', name });
        process.exitCode = 1;
      } catch (err) {
        if ((err as { statusCode?: number }).statusCode !== 404) throw err;
        record({ label: 'cleanup-confirmed-404', name });
      }
    } catch (err) {
      record({ label: 'cleanup-FAILED', name, message: (err as Error).message });
      process.exitCode = 1;
    }
  }
}
