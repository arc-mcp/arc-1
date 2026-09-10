/** Narrow ADT contract probes; creates one disposable $TMP DTEL and removes it.
 * ARC1_RESEARCH_ENV=/path/to/.env.infrastructure node --import tsx docs/research/issues/771-evidence/contract.mts 758
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { AdtClient } from '../../../../src/adt/client.js';
import { defaultSafetyConfig } from '../../../../src/adt/safety.js';
import { buildDataElementXml } from '../../../../src/adt/ddic-xml.js';
import { createObject, safeUpdateObject, lockObject, unlockObject, deleteObject } from '../../../../src/adt/crud.js';
import { activate } from '../../../../src/adt/devtools.js';

const id = process.argv[2];
if (!['750', '758', '816'].includes(id)) throw new Error('Select release 750, 758, or 816');
if (!process.env.ARC1_RESEARCH_ENV) throw new Error('Set ARC1_RESEARCH_ENV');
const e = dotenv.parse(fs.readFileSync(process.env.ARC1_RESEARCH_ENV));
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
const c = new AdtClient({ ...target, safety, language: 'EN', retryUnauthorized: false });
const name = `Z771_${id}_${Date.now().toString(36).toUpperCase()}D`;
const uri = `/sap/bc/adt/ddic/dataelements/${name}`;
const out = path.join(path.dirname(fileURLToPath(import.meta.url)), id);
const events: unknown[] = [];
const save = (key: string, body: string) => fs.writeFileSync(path.join(out, `${key}.xml`), body);
const record = (data: object) => {
  events.push(data);
  fs.writeFileSync(path.join(out, 'contract-results.json'), JSON.stringify(events, null, 2) + '\n');
  console.log(JSON.stringify(data));
};
const tags = [
  'shortFieldLength',
  'mediumFieldLength',
  'longFieldLength',
  'headingFieldLength',
  'deactivateInputHistory',
];
async function snapshot(key: string, version = 'inactive') {
  const r = await c.http.get(`${uri}?version=${version}`);
  save(key, r.body);
  record({
    key,
    version,
    values: Object.fromEntries(
      tags.map((t) => [t, r.body.match(new RegExp(`<dtel:${t}>([^<]*)</dtel:${t}>`))?.[1] ?? '']),
    ),
  });
  return r.body;
}
const replace = (body: string, tag: string, value: string | number) =>
  body.replace(new RegExp(`(<dtel:${tag}>)[^<]*(</dtel:${tag}>)`), (_m, a, b) => `${a}${value}${b}`);
let desired = buildDataElementXml({
  name,
  package: '$TMP',
  description: 'Issue 771 contract probe',
  responsible: target.username,
  dataType: 'CHAR',
  length: 60,
  shortLabel: 'ABCDEF',
  mediumLabel: 'ABCDEFGHIJKL',
  longLabel: 'ABCDEFGHIJKLMNOPQRSTU',
  headingLabel: 'ABCDEF',
});
for (const [i, tag] of tags.entries()) desired = replace(desired, tag, [8, 18, 30, 50, 'true'][i]);
const ct = 'application/vnd.sap.adt.dataelements.v2+xml';
try {
  await c.http.get(uri);
  throw new Error('Refusing to reuse existing object');
} catch (err) {
  if ((err as { statusCode?: number }).statusCode !== 404) throw err;
}
try {
  save('contract-post-request', desired);
  save(
    'contract-post-response',
    await createObject(
      c.http,
      safety,
      '/sap/bc/adt/ddic/dataelements',
      desired,
      ct,
      undefined,
      '$TMP',
      id,
      'onprem',
      name,
    ),
  );
  await snapshot('contract-post');
  await safeUpdateObject(c.http, safety, uri, desired, ct, undefined, id);
  await snapshot('contract-put');
  record({ key: 'contract-activate', result: await activate(c.http, safety, uri, { name }) });
  await snapshot('contract-active', 'active');
  if (id === '758') {
    for (const length of [0, 5, 6, 10, 11]) {
      const body = replace(desired, 'shortFieldLength', length);
      save(`contract-edge-${length}-request`, body);
      await safeUpdateObject(c.http, safety, uri, body, ct, undefined, id);
      await snapshot(`contract-edge-${length}-saved`);
      record({ key: `contract-edge-${length}-activation`, result: await activate(c.http, safety, uri, { name }) });
      await snapshot(`contract-edge-${length}-active`, 'active');
    }
    const blank = replace(replace(desired, 'shortFieldLabel', ''), 'shortFieldLength', 0);
    await safeUpdateObject(c.http, safety, uri, blank, ct, undefined, id);
    record({ key: 'contract-blank-zero-activation', result: await activate(c.http, safety, uri, { name }) });
    await snapshot('contract-blank-zero-active', 'active');
  }
} finally {
  // Verify ownership even if only an inactive version exists (NW 7.50).
  const body = await c.http.get(`${uri}?version=inactive`).catch(async () => c.http.get(`${uri}?version=active`));
  if (!body.body.includes('adtcore:name="$TMP"')) throw new Error('Unexpected test-object package');
  await c.http.withStatefulSession(async (session) => {
    const lock = await lockObject(session, safety, uri, 'MODIFY', id);
    try {
      await deleteObject(session, safety, uri, lock.lockHandle);
    } finally {
      await unlockObject(session, uri, lock.lockHandle);
    }
  });
  for (const version of ['active', 'inactive']) {
    try {
      await c.http.get(`${uri}?version=${version}`);
      throw new Error('Object still exists after delete');
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode !== 404) throw err;
      record({ key: 'cleanup-confirmed-404', name, version });
    }
  }
}
