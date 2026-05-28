// scripts/probe-issue-303.mjs — verify the 4-action plan against a real SAP system.
//
// Exercises against a fresh probe class:
//   1. edit_class_definition happy path (no method-set change)
//   2. edit_class_definition refuse-policy SAP-side evidence (added method w/o stub → activation rejected)
//   3. edit_class_definition refuse-policy SAP-side evidence (orphan impl → activation rejected)
//   4. add_method (public section)
//   5. add_method into a missing PROTECTED section (refuse case — verify section detection)
//   6. edit_method_signature (one-range replace)
//   7. delete_method (delete both ranges)
//
// All operations roundtrip through objectstructure → splice → PUT /source/main.
//
// Usage: node scripts/probe-issue-303.mjs <system>
//   <system> ∈ { a4h, npl }
//
// Outputs each step's PASS/FAIL/SAP_RESPONSE and a final summary.

import 'dotenv/config';
import { fetch, Agent } from 'undici';
import { readFileSync } from 'node:fs';

const SYSTEM = process.argv[2] ?? 'a4h';

// Credentials come from env only — never hardcode them here.
//   a4h: SAP_URL / SAP_USER / SAP_PASSWORD / SAP_CLIENT (loaded from .env via dotenv)
//   npl: NPL_URL  / NPL_USER / NPL_PASSWORD / NPL_CLIENT
// See INFRASTRUCTURE.md for the test-system endpoints + credential locations.
const sysConfig = {
  a4h: {
    url: process.env.SAP_URL,
    user: process.env.SAP_USER,
    password: process.env.SAP_PASSWORD,
    client: process.env.SAP_CLIENT ?? '001',
    className: 'ZCL_ARC1_PROBE303',
  },
  npl: {
    url: process.env.NPL_URL ?? 'https://npl.marianzeis.de',
    user: process.env.NPL_USER,
    password: process.env.NPL_PASSWORD,
    client: process.env.NPL_CLIENT ?? '001',
    className: 'ZCL_ARC1_PROBE303',
  },
};

const cfg = sysConfig[SYSTEM];
if (!cfg) throw new Error(`unknown system ${SYSTEM}`);
if (!cfg.url || !cfg.user || !cfg.password) {
  const prefix = SYSTEM === 'npl' ? 'NPL' : 'SAP';
  throw new Error(
    `Missing credentials for ${SYSTEM}. Set ${prefix}_URL, ${prefix}_USER, ${prefix}_PASSWORD (a4h reads SAP_* from .env; npl reads NPL_*).`,
  );
}

const auth = 'Basic ' + Buffer.from(`${cfg.user}:${cfg.password}`).toString('base64');
const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
let cookies = '';
const collectCookies = (resp) => {
  for (const c of resp.headers.getSetCookie?.() ?? []) {
    const pair = c.indexOf(';') >= 0 ? c.slice(0, c.indexOf(';')) : c;
    cookies = cookies ? cookies + '; ' + pair : pair;
  }
};

async function http(method, path, opts = {}) {
  const url = `${cfg.url}${path}${path.includes('?') ? '&' : '?'}sap-client=${cfg.client}`;
  const headers = { Authorization: auth, ...(opts.headers ?? {}) };
  if (cookies) headers.Cookie = cookies;
  const r = await fetch(url, { method, headers, body: opts.body, dispatcher });
  collectCookies(r);
  const text = await r.text();
  return { status: r.status, text, headers: r.headers };
}

let csrf;
async function fetchCsrf() {
  const r = await http('GET', '/sap/bc/adt/discovery', { headers: { 'X-CSRF-Token': 'Fetch', Accept: 'application/atomsvc+xml' } });
  csrf = r.headers.get('x-csrf-token');
  if (!csrf) throw new Error(`CSRF fetch failed: status=${r.status} csrf=${csrf} body=${r.text.slice(0, 200)}`);
  return csrf;
}

async function deleteProbe() {
  const objPath = `/sap/bc/adt/oo/classes/${cfg.className}`;
  // Lock first.
  const lock = await http('POST', `${objPath}?_action=LOCK&accessMode=MODIFY`, {
    headers: { 'X-CSRF-Token': csrf, Accept: 'application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.lock.Result2', 'X-sap-adt-sessiontype': 'stateful' },
  });
  if (lock.status >= 400) {
    if (lock.status === 404) return false; // didn't exist
    console.log(`  preexisting class lock failed: ${lock.status} ${lock.text.slice(0, 200)}`);
    return false;
  }
  const lockHandle = lock.text.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/)?.[1];
  const del = await http('DELETE', `${objPath}?lockHandle=${encodeURIComponent(lockHandle)}`, {
    headers: { 'X-CSRF-Token': csrf, 'X-sap-adt-sessiontype': 'stateful' },
  });
  return del.status < 300;
}

async function createProbe() {
  const objPath = '/sap/bc/adt/oo/classes';
  const payload = `<?xml version="1.0" encoding="UTF-8"?>
<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes"
  xmlns:adtcore="http://www.sap.com/adt/core"
  class:final="true"
  class:visibility="public"
  adtcore:name="${cfg.className}"
  adtcore:type="CLAS/OC"
  adtcore:description="Probe for issue 303 plan verification"
  adtcore:masterLanguage="EN"
  adtcore:masterSystem="A4H">
  <adtcore:packageRef adtcore:name="$TMP"/>
</class:abapClass>`;
  const r = await http('POST', objPath, {
    headers: {
      'Content-Type': 'application/vnd.sap.adt.oo.classes.v4+xml',
      Accept: 'application/vnd.sap.adt.oo.classes.v4+xml',
      'X-CSRF-Token': csrf,
    },
    body: payload,
  });
  if (r.status >= 400) throw new Error(`create failed: ${r.status} ${r.text.slice(0, 400)}`);
  return r;
}

async function lockClass() {
  const objPath = `/sap/bc/adt/oo/classes/${cfg.className}`;
  const r = await http('POST', `${objPath}?_action=LOCK&accessMode=MODIFY`, {
    headers: { 'X-CSRF-Token': csrf, Accept: 'application/vnd.sap.as+xml; charset=UTF-8; dataname=com.sap.adt.lock.Result2', 'X-sap-adt-sessiontype': 'stateful' },
  });
  if (r.status >= 400) throw new Error(`lock failed: ${r.status} ${r.text.slice(0, 400)}`);
  return {
    lockHandle: r.text.match(/<LOCK_HANDLE>([^<]+)<\/LOCK_HANDLE>/)?.[1],
    corrNr: r.text.match(/<CORRNR>([^<]+)<\/CORRNR>/)?.[1],
  };
}

async function unlockClass(lockHandle) {
  const objPath = `/sap/bc/adt/oo/classes/${cfg.className}`;
  await http('POST', `${objPath}?_action=UNLOCK&lockHandle=${encodeURIComponent(lockHandle)}`, {
    headers: { 'X-CSRF-Token': csrf, 'X-sap-adt-sessiontype': 'stateful' },
  });
}

async function putMain(source, lockHandle, corrNr) {
  const objPath = `/sap/bc/adt/oo/classes/${cfg.className}`;
  const qs = `?lockHandle=${encodeURIComponent(lockHandle)}${corrNr ? `&corrNr=${encodeURIComponent(corrNr)}` : ''}`;
  return await http('PUT', `${objPath}/source/main${qs}`, {
    headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'text/plain; charset=utf-8', Accept: 'text/plain', 'X-sap-adt-sessiontype': 'stateful' },
    body: source,
  });
}

async function getMain() {
  const objPath = `/sap/bc/adt/oo/classes/${cfg.className}`;
  const r = await http('GET', `${objPath}/source/main`, { headers: { Accept: 'text/plain' } });
  return r.text;
}

async function getObjectStructure() {
  const objPath = `/sap/bc/adt/oo/classes/${cfg.className}`;
  const r = await http('GET', `${objPath}/objectstructure`, {
    headers: { Accept: 'application/vnd.sap.adt.objectstructure.v2+xml' },
  });
  if (r.status >= 400) throw new Error(`objectstructure failed: ${r.status} ${r.text.slice(0, 200)}`);
  return r.text;
}

// Activate via the ADT activation endpoint.
async function activate() {
  const objUri = `/sap/bc/adt/oo/classes/${cfg.className.toLowerCase()}`;
  const payload = `<?xml version="1.0" encoding="UTF-8"?>
<adtcore:objectReferences xmlns:adtcore="http://www.sap.com/adt/core">
  <adtcore:objectReference adtcore:uri="${objUri}" adtcore:name="${cfg.className}"/>
</adtcore:objectReferences>`;
  return await http('POST', '/sap/bc/adt/activation?method=activate&preauditRequested=true', {
    headers: { 'Content-Type': 'application/xml', Accept: 'application/xml', 'X-CSRF-Token': csrf },
    body: payload,
  });
}

// ── Structure parsing ─────────────────────────────────────────────────────────
function parseRange(href) {
  const m = href.match(/#start=(\d+),(\d+);end=(\d+),(\d+)/);
  if (!m) return null;
  return { sr: +m[1], sc: +m[2], er: +m[3], ec: +m[4] };
}

function parseObjectStructure(xml) {
  const result = { class: {}, methods: [], attributes: [] };

  // Class-level blocks: the FIRST `definitionBlock` and FIRST `implementationBlock` in document order
  // are the class-level ones (they precede any nested `<objectStructureElement>`).
  const defMatch = xml.match(/rel="http:\/\/www\.sap\.com\/adt\/relations\/source\/definitionBlock"[^>]*href="([^"]+)"/);
  if (defMatch) result.class.definition = parseRange(defMatch[1]);
  const implMatch = xml.match(/rel="http:\/\/www\.sap\.com\/adt\/relations\/source\/implementationBlock"[^>]*href="([^"]+)"/);
  if (implMatch) result.class.implementation = parseRange(implMatch[1]);

  // Parse method elements.
  const methodRe = /<abapsource:objectStructureElement\s+adtcore:type="CLAS\/OM"\s+adtcore:name="([^"]+)"([^>]*)>([\s\S]*?)<\/abapsource:objectStructureElement>/g;
  for (const mm of xml.matchAll(methodRe)) {
    const name = mm[1];
    const attrs = mm[2];
    const inner = mm[3];
    const visibility = attrs.match(/visibility="([^"]+)"/)?.[1];
    const level = attrs.match(/level="([^"]+)"/)?.[1];
    const isAbstract = /abstract="true"/.test(attrs);
    const isConstructor = /constructor="true"/.test(attrs);
    const def = inner.match(/rel="[^"]*\/definitionBlock"\s+href="([^"]+)"/)?.[1];
    const impl = inner.match(/rel="[^"]*\/implementationBlock"\s+href="([^"]+)"/)?.[1];
    result.methods.push({
      name,
      visibility,
      level,
      abstract: isAbstract,
      constructor: isConstructor,
      definition: def ? parseRange(def) : null,
      implementation: impl ? parseRange(impl) : null,
    });
  }
  return result;
}

// Splice lines [sr..er] (1-indexed, INCLUSIVE) with replacement text.
function spliceLines(source, sr, er, replacement) {
  const lines = source.split('\n');
  // Strip trailing \r — PUT must round-trip as the server returns.
  const ret = source.includes('\r\n') ? '\r\n' : '\n';
  const before = lines.slice(0, sr - 1);
  const after = lines.slice(er);
  const replLines = replacement.split('\n');
  const combined = [...before, ...replLines, ...after];
  let out = combined.join('\n');
  // Convert back to source's line endings.
  if (ret === '\r\n' && !out.includes('\r\n')) out = out.replace(/\n/g, '\r\n');
  return out;
}

// Insert lines BEFORE line `lineNo` (1-indexed).
function insertBefore(source, lineNo, text) {
  const lines = source.split('\n');
  const before = lines.slice(0, lineNo - 1);
  const after = lines.slice(lineNo - 1);
  const insertLines = text.split('\n');
  let out = [...before, ...insertLines, ...after].join('\n');
  if (source.includes('\r\n') && !out.includes('\r\n')) out = out.replace(/\n/g, '\r\n');
  return out;
}

// ── Per-step harness ──────────────────────────────────────────────────────────
const results = [];
async function step(name, fn) {
  const start = Date.now();
  process.stdout.write(`\n── ${name}\n`);
  try {
    const r = await fn();
    const dur = Date.now() - start;
    console.log(`   PASS (${dur}ms)`);
    if (r) console.log(`   ${typeof r === 'string' ? r : JSON.stringify(r).slice(0, 400)}`);
    results.push({ name, status: 'PASS', dur, detail: r });
    return r;
  } catch (e) {
    const dur = Date.now() - start;
    console.log(`   FAIL (${dur}ms): ${e.message}`);
    results.push({ name, status: 'FAIL', dur, error: e.message });
    return null;
  }
}

// ── Probe class v1: baseline ──────────────────────────────────────────────────
const PROBE_V1 = `CLASS ${cfg.className.toLowerCase()} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello
      IMPORTING name TYPE string
      RETURNING VALUE(result) TYPE string.
    METHODS goodbye
      RETURNING VALUE(result) TYPE string.
  PRIVATE SECTION.
    DATA mv_counter TYPE i.
ENDCLASS.

CLASS ${cfg.className.toLowerCase()} IMPLEMENTATION.

  METHOD hello.
    result = |Hello, { name }!|.
  ENDMETHOD.

  METHOD goodbye.
    result = 'Goodbye!'.
  ENDMETHOD.

ENDCLASS.
`.replace(/\n/g, '\r\n');

// ── Main ──────────────────────────────────────────────────────────────────────
console.log(`Probing ${SYSTEM.toUpperCase()} (${cfg.url}, client=${cfg.client}, user=${cfg.user})`);
await fetchCsrf();
console.log(`CSRF acquired`);

// 0a. Reset: delete then recreate the probe class.
await step('0a. Delete preexisting probe class (if any)', async () => {
  const deleted = await deleteProbe();
  return deleted ? 'deleted' : 'did not exist';
});

await step('0b. Create probe class skeleton', async () => {
  const r = await createProbe();
  return `HTTP ${r.status}`;
});

await step('0c. Write v1 source (lock → PUT → unlock → activate)', async () => {
  const { lockHandle, corrNr } = await lockClass();
  try {
    const put = await putMain(PROBE_V1, lockHandle, corrNr);
    if (put.status !== 200) throw new Error(`PUT failed: ${put.status} ${put.text.slice(0, 300)}`);
  } finally {
    await unlockClass(lockHandle);
  }
  const act = await activate();
  if (act.status !== 200) throw new Error(`activate failed: ${act.status} ${act.text.slice(0, 300)}`);
  // Activation can return 200 with embedded errors. Check.
  if (/<chkrun:checkMessage\s/i.test(act.text)) {
    const msg = act.text.match(/shortText="([^"]+)"/)?.[1] ?? '(no shortText)';
    throw new Error(`activation reported errors: ${msg}`);
  }
  return 'activated';
});

// 1. Read objectstructure baseline.
let baseStructure;
await step('1. GET objectstructure (baseline parse)', async () => {
  const xml = await getObjectStructure();
  baseStructure = parseObjectStructure(xml);
  return {
    classDef: baseStructure.class.definition,
    classImpl: baseStructure.class.implementation,
    methodCount: baseStructure.methods.length,
    methods: baseStructure.methods.map((m) => ({
      name: m.name,
      vis: m.visibility,
      def: m.definition,
      impl: m.implementation,
    })),
  };
});

// 2. edit_class_definition happy path: add a method WITH paired impl (no symmetry violation).
//    Caller's intent: add a parameter to the class signature via SDETAIL. We change FINAL→ABSTRACT
//    via DEFINITION only. No method-set change.
await step('2. edit_class_definition: change to NOT FINAL (no method-set change)', async () => {
  const main = await getMain();
  const oldDef = baseStructure.class.definition;
  const newDef = `CLASS ${cfg.className.toLowerCase()} DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello
      IMPORTING name TYPE string
      RETURNING VALUE(result) TYPE string.
    METHODS goodbye
      RETURNING VALUE(result) TYPE string.
  PRIVATE SECTION.
    DATA mv_counter TYPE i.
ENDCLASS.`.replace(/\n/g, '\r\n');
  const spliced = spliceLines(main, oldDef.sr, oldDef.er, newDef);
  const { lockHandle, corrNr } = await lockClass();
  let put;
  try {
    put = await putMain(spliced, lockHandle, corrNr);
  } finally { await unlockClass(lockHandle); }
  if (put.status !== 200) throw new Error(`PUT failed: ${put.status} ${put.text.slice(0, 300)}`);
  const act = await activate();
  if (act.status !== 200 || /<chkrun:checkMessage\s/i.test(act.text)) {
    throw new Error(`activate failed: ${act.text.slice(0, 300)}`);
  }
  return 'PUT 200, activated';
});

// 3. edit_class_definition SAP-side proof: add a method WITHOUT impl stub → write 200, activate fail.
await step('3. edit_class_definition: refuse-policy SAP-side proof (added METHOD GREET, no stub)', async () => {
  const xml = await getObjectStructure();
  const struct = parseObjectStructure(xml);
  const main = await getMain();
  const oldDef = struct.class.definition;
  const newDef = `CLASS ${cfg.className.toLowerCase()} DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello
      IMPORTING name TYPE string
      RETURNING VALUE(result) TYPE string.
    METHODS goodbye
      RETURNING VALUE(result) TYPE string.
    METHODS greet
      IMPORTING who TYPE string
      RETURNING VALUE(result) TYPE string.
  PRIVATE SECTION.
    DATA mv_counter TYPE i.
ENDCLASS.`.replace(/\n/g, '\r\n');
  const spliced = spliceLines(main, oldDef.sr, oldDef.er, newDef);
  const { lockHandle, corrNr } = await lockClass();
  let put;
  try {
    put = await putMain(spliced, lockHandle, corrNr);
  } finally { await unlockClass(lockHandle); }
  if (put.status !== 200) throw new Error(`PUT unexpectedly failed: ${put.status} ${put.text.slice(0, 300)}`);
  const act = await activate();
  const hasError = act.text.includes('Implementation missing for method "GREET"') || act.text.includes('Implementation missing for method &quot;GREET&quot;');
  if (!hasError) {
    return `WARN: activation didn't reject missing impl as expected. status=${act.status} body=${act.text.slice(0, 300)}`;
  }
  return 'SAP rejected activation as expected (missing impl)';
});

// 4. Restore baseline.
await step('4. Restore baseline (full update v1)', async () => {
  const { lockHandle, corrNr } = await lockClass();
  try {
    const put = await putMain(PROBE_V1, lockHandle, corrNr);
    if (put.status !== 200) throw new Error(`PUT failed: ${put.status}`);
  } finally { await unlockClass(lockHandle); }
  await activate();
  return 'restored';
});

// 5. add_method: insert at end of PUBLIC SECTION + add impl stub.
await step('5. add_method (greet, public) — atomic def+impl insert', async () => {
  const xml = await getObjectStructure();
  const struct = parseObjectStructure(xml);
  // Find last PUBLIC method's definitionBlock end row → insert after.
  const publicMethods = struct.methods.filter((m) => m.visibility === 'public' && m.definition);
  if (publicMethods.length === 0) throw new Error('no public methods to anchor');
  const lastPublicDefEnd = Math.max(...publicMethods.map((m) => m.definition.er));
  const main = await getMain();

  const newDecl = `    METHODS greet
      IMPORTING who TYPE string
      RETURNING VALUE(result) TYPE string.`;
  // Insert AFTER lastPublicDefEnd → before lastPublicDefEnd+1
  let stage1 = insertBefore(main, lastPublicDefEnd + 1, newDecl);
  // Now insert impl stub at end of IMPLEMENTATION block.
  // Need updated impl block range — but we haven't PUT yet; for splicing on the SAME source
  // we can re-parse with abaplint or just use the OLD impl range and add lines INSIDE.
  // Simpler: insert BEFORE the original ENDCLASS of the IMPLEMENTATION block.
  // The class:implementation block ends at struct.class.implementation.er — that's ENDCLASS.
  // After our stage1 splice, the IMPLEMENTATION block has shifted by the number of inserted lines.
  const insertedLines = newDecl.split('\n').length;
  const newImplEnd = struct.class.implementation.er + insertedLines;
  const stub = `  METHOD greet.\n    result = ||.\n  ENDMETHOD.\n`;
  const stage2 = insertBefore(stage1, newImplEnd, stub);

  const { lockHandle, corrNr } = await lockClass();
  let put;
  try {
    put = await putMain(stage2, lockHandle, corrNr);
  } finally { await unlockClass(lockHandle); }
  if (put.status !== 200) throw new Error(`PUT failed: ${put.status} ${put.text.slice(0, 300)}`);
  const act = await activate();
  if (act.status !== 200 || /<chkrun:checkMessage[^>]*type="E/i.test(act.text)) {
    throw new Error(`activate failed: ${act.text.slice(0, 400)}`);
  }
  return 'PUT 200, activated';
});

// 6. edit_method_signature: change greet to take 2 importing params.
await step('6. edit_method_signature (greet: add greeting param with DEFAULT)', async () => {
  const xml = await getObjectStructure();
  const struct = parseObjectStructure(xml);
  const greet = struct.methods.find((m) => m.name === 'GREET');
  if (!greet?.definition) throw new Error('greet method not found');
  const main = await getMain();
  const newSig = `    METHODS greet
      IMPORTING who TYPE string
                greeting TYPE string DEFAULT 'Hi'
      RETURNING VALUE(result) TYPE string.`;
  const spliced = spliceLines(main, greet.definition.sr, greet.definition.er, newSig);
  const { lockHandle, corrNr } = await lockClass();
  let put;
  try {
    put = await putMain(spliced, lockHandle, corrNr);
  } finally { await unlockClass(lockHandle); }
  if (put.status !== 200) throw new Error(`PUT failed: ${put.status} ${put.text.slice(0, 300)}`);
  const act = await activate();
  if (act.status !== 200 || /<chkrun:checkMessage[^>]*type="E/i.test(act.text)) {
    throw new Error(`activate failed: ${act.text.slice(0, 400)}`);
  }
  return 'PUT 200, activated';
});

// 7. delete_method: drop greet (def + impl).
await step('7. delete_method (greet) — drop both def and impl ranges', async () => {
  const xml = await getObjectStructure();
  const struct = parseObjectStructure(xml);
  const greet = struct.methods.find((m) => m.name === 'GREET');
  if (!greet?.definition || !greet?.implementation) throw new Error('greet ranges missing');
  let main = await getMain();
  // Delete impl FIRST (higher line numbers) so def line numbers stay valid.
  main = spliceLines(main, greet.implementation.sr, greet.implementation.er, '');
  main = spliceLines(main, greet.definition.sr, greet.definition.er, '');
  const { lockHandle, corrNr } = await lockClass();
  let put;
  try {
    put = await putMain(main, lockHandle, corrNr);
  } finally { await unlockClass(lockHandle); }
  if (put.status !== 200) throw new Error(`PUT failed: ${put.status} ${put.text.slice(0, 300)}`);
  const act = await activate();
  if (act.status !== 200 || /<chkrun:checkMessage[^>]*type="E/i.test(act.text)) {
    throw new Error(`activate failed: ${act.text.slice(0, 400)}`);
  }
  return 'PUT 200, activated, greet gone';
});

// 8. add_method into missing PROTECTED SECTION — verify refuse-detection input.
//    Probe class currently has only PUBLIC + PRIVATE. add_method protected should refuse.
await step('8. add_method (protected) — section detection (probe class has no PROTECTED SECTION)', async () => {
  const xml = await getObjectStructure();
  const struct = parseObjectStructure(xml);
  const protectedMethods = struct.methods.filter((m) => m.visibility === 'protected');
  return {
    publicCount: struct.methods.filter((m) => m.visibility === 'public').length,
    protectedCount: protectedMethods.length,
    privateCount: struct.methods.filter((m) => m.visibility === 'private').length,
    attributeCount: 0, // not parsed here
    note: 'plan: refuse if protectedCount === 0 AND no PROTECTED SECTION header exists. Caller adds via edit_class_definition.',
  };
});

// 9. Edge case: ABSTRACT class with ABSTRACT methods.
//    Refuse-policy exemption: a method declared ABSTRACT should NOT require an IMPL block,
//    and objectstructure should reflect this (abstract="true", no implementationBlock link).
const PROBE_ABSTRACT = `CLASS ${cfg.className.toLowerCase()} DEFINITION PUBLIC ABSTRACT CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS hello
      IMPORTING name TYPE string
      RETURNING VALUE(result) TYPE string.
    METHODS to_impl ABSTRACT
      RETURNING VALUE(result) TYPE string.
ENDCLASS.

CLASS ${cfg.className.toLowerCase()} IMPLEMENTATION.

  METHOD hello.
    result = |Hello, { name }!|.
  ENDMETHOD.

ENDCLASS.
`.replace(/\n/g, '\r\n');

await step('9. Edge: ABSTRACT class with ABSTRACT method — refuse-policy exemption check', async () => {
  // Rewrite the class with an abstract method.
  const { lockHandle, corrNr } = await lockClass();
  try {
    const put = await putMain(PROBE_ABSTRACT, lockHandle, corrNr);
    if (put.status !== 200) throw new Error(`PUT failed: ${put.status} ${put.text.slice(0, 300)}`);
  } finally { await unlockClass(lockHandle); }
  const act = await activate();
  if (act.status !== 200 || /<chkrun:checkMessage[^>]*type="E/i.test(act.text)) {
    throw new Error(`activate failed: ${act.text.slice(0, 400)}`);
  }
  const xml = await getObjectStructure();
  const struct = parseObjectStructure(xml);
  const abs = struct.methods.find((m) => m.name === 'TO_IMPL');
  return {
    abstractMethodFound: !!abs,
    abstract: abs?.abstract,
    hasDefinition: !!abs?.definition,
    hasImplementation: !!abs?.implementation,
    expected: 'abstract=true, no implementation link',
  };
});

// 10. Edge case: 3-section class — add_method works in PROTECTED when section exists.
const PROBE_3SECTIONS = `CLASS ${cfg.className.toLowerCase()} DEFINITION PUBLIC CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS pub_a RETURNING VALUE(r) TYPE string.
  PROTECTED SECTION.
    METHODS prot_a RETURNING VALUE(r) TYPE string.
  PRIVATE SECTION.
    METHODS priv_a RETURNING VALUE(r) TYPE string.
ENDCLASS.

CLASS ${cfg.className.toLowerCase()} IMPLEMENTATION.

  METHOD pub_a.
    r = 'pub'.
  ENDMETHOD.

  METHOD prot_a.
    r = 'prot'.
  ENDMETHOD.

  METHOD priv_a.
    r = 'priv'.
  ENDMETHOD.

ENDCLASS.
`.replace(/\n/g, '\r\n');

await step('10. Edge: 3-section class — add_method into PROTECTED SECTION', async () => {
  const { lockHandle: lh1, corrNr: cn1 } = await lockClass();
  try { await putMain(PROBE_3SECTIONS, lh1, cn1); } finally { await unlockClass(lh1); }
  await activate();

  const xml = await getObjectStructure();
  const struct = parseObjectStructure(xml);
  const protMethods = struct.methods.filter((m) => m.visibility === 'protected' && m.definition);
  if (protMethods.length === 0) throw new Error('no protected methods to anchor');
  const lastProtEnd = Math.max(...protMethods.map((m) => m.definition.er));
  const main = await getMain();

  const newDecl = `    METHODS prot_b RETURNING VALUE(r) TYPE string.`;
  let stage1 = insertBefore(main, lastProtEnd + 1, newDecl);
  const insertedLines = newDecl.split('\n').length;
  const newImplEnd = struct.class.implementation.er + insertedLines;
  const stub = `  METHOD prot_b.\n    r = 'b'.\n  ENDMETHOD.\n`;
  const stage2 = insertBefore(stage1, newImplEnd, stub);

  const { lockHandle: lh2, corrNr: cn2 } = await lockClass();
  let put;
  try { put = await putMain(stage2, lh2, cn2); } finally { await unlockClass(lh2); }
  if (put.status !== 200) throw new Error(`PUT failed: ${put.status} ${put.text.slice(0, 300)}`);
  const act = await activate();
  if (act.status !== 200 || /<chkrun:checkMessage[^>]*type="E/i.test(act.text)) {
    throw new Error(`activate failed: ${act.text.slice(0, 400)}`);
  }
  // Re-fetch structure to confirm.
  const xml2 = await getObjectStructure();
  const struct2 = parseObjectStructure(xml2);
  return {
    protectedMethodsAfter: struct2.methods.filter((m) => m.visibility === 'protected').map((m) => m.name),
  };
});

// 11. Edge case: empty class skeleton — can add_method work into a freshly-created class?
const PROBE_SKELETON = `CLASS ${cfg.className.toLowerCase()} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
  PROTECTED SECTION.
  PRIVATE SECTION.
ENDCLASS.

CLASS ${cfg.className.toLowerCase()} IMPLEMENTATION.
ENDCLASS.
`.replace(/\n/g, '\r\n');

await step('11. Edge: empty class skeleton — add_method into a class with no existing methods', async () => {
  const { lockHandle: lh1, corrNr: cn1 } = await lockClass();
  try { await putMain(PROBE_SKELETON, lh1, cn1); } finally { await unlockClass(lh1); }
  await activate();

  const xml = await getObjectStructure();
  const struct = parseObjectStructure(xml);
  // No existing methods → insertion anchor is the end of the PUBLIC SECTION line.
  // We can't get that from objectstructure (no method to anchor against).
  // Plan: when method-set is empty, the implementation must fall back to scanning the
  // DEFINITION block for "PUBLIC SECTION." line and inserting AFTER it.
  // Here we simulate by string-searching the source.
  const main = await getMain();
  const lines = main.split(/\r?\n/);
  const publicSectionLine = lines.findIndex((l) => /^\s*PUBLIC\s+SECTION\s*\.\s*$/i.test(l));
  if (publicSectionLine < 0) throw new Error('no PUBLIC SECTION line found');
  const newDecl = `    METHODS first RETURNING VALUE(r) TYPE string.`;
  const stage1 = insertBefore(main, publicSectionLine + 2, newDecl);
  const insertedLines = newDecl.split('\n').length;
  const newImplEnd = struct.class.implementation.er + insertedLines;
  const stub = `  METHOD first.\n    r = '1'.\n  ENDMETHOD.\n`;
  const stage2 = insertBefore(stage1, newImplEnd, stub);

  const { lockHandle: lh2, corrNr: cn2 } = await lockClass();
  let put;
  try { put = await putMain(stage2, lh2, cn2); } finally { await unlockClass(lh2); }
  if (put.status !== 200) throw new Error(`PUT failed: ${put.status} ${put.text.slice(0, 300)}`);
  const act = await activate();
  if (act.status !== 200 || /<chkrun:checkMessage[^>]*type="E/i.test(act.text)) {
    throw new Error(`activate failed: ${act.text.slice(0, 400)}`);
  }
  return 'add_method into empty class works — requires string fallback for section anchor';
});

// 12. Restore baseline.
await step('12. Restore baseline', async () => {
  const { lockHandle, corrNr } = await lockClass();
  try { await putMain(PROBE_V1, lockHandle, corrNr); } finally { await unlockClass(lockHandle); }
  await activate();
  return 'restored';
});

// 10. Summary
console.log('\n══ Summary ══');
for (const r of results) {
  console.log(`  ${r.status.padEnd(4)} ${r.name}`);
  if (r.error) console.log(`         ${r.error}`);
}
const failed = results.filter((r) => r.status === 'FAIL').length;
console.log(`\n${failed === 0 ? 'ALL PASSED' : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
