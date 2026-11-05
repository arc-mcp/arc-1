import { createHash } from 'node:crypto';
import { HarnessError } from './safe-io.mjs';

export const currentPlan = 'current-pp-workflows-v1';
export const currentApp = 'https://mcp-sap-docs.cfapps.us10-001.hana.ondemand.com';
export const sha = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value))
    .digest('hex');
export const requireEvidence = (condition, code) => {
  if (!condition) throw new HarnessError(code);
};
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...keys].sort().join();
export function validateCurrentBindings(bindings, revision) {
  requireEvidence(exact(bindings, ['version', 'deployment', 'recording']), 'INVALID_CURRENT_BINDINGS');
  const { deployment: d, recording: r } = bindings;
  requireEvidence(
    bindings.version === 1 &&
      exact(d, ['appOrigin', 'sourceRevision', 'dropletGuid', 'artifactSha256', 'observedAt', 'receiptSha256']) &&
      d.appOrigin === currentApp &&
      d.sourceRevision === revision &&
      /^[a-f0-9]{40}$/.test(revision) &&
      /^[a-f0-9-]{36}$/.test(d.dropletGuid) &&
      /^[a-f0-9]{64}$/.test(d.artifactSha256) &&
      /^[a-f0-9]{64}$/.test(d.receiptSha256) &&
      Number.isFinite(Date.parse(d.observedAt)) &&
      Date.parse(d.observedAt) <= Date.now(),
    'DEPLOYMENT_BINDING_REQUIRED',
  );
  requireEvidence(
    exact(r, ['package', 'request', 'task', 'owner']) &&
      /^[ZY][A-Z0-9_]{0,29}$/.test(r.package) &&
      /^A4HK\d{6}$/.test(r.request) &&
      /^A4HK\d{6}$/.test(r.task) &&
      r.request !== r.task &&
      /^[A-Z0-9_]{1,12}$/.test(r.owner),
    'EXACT_RECORDED_CONTEXT_REQUIRED',
  );
  return bindings;
}
export function currentFixtureSources(f, marker, fixtures) {
  const comment = `" ${marker} ${f.name}`;
  if (f.type === 'CLAS')
    return {
      initial: `${comment}\nCLASS ${f.name.toLowerCase()} DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\n    METHODS get_value RETURNING VALUE(rv_value) TYPE i.\nENDCLASS.\nCLASS ${f.name.toLowerCase()} IMPLEMENTATION.\n  METHOD get_value.\n    rv_value = 1.\n  ENDMETHOD.\nENDCLASS.\n`,
      tests: `${comment}\nCLASS ltc_value DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.\n  PRIVATE SECTION.\n    METHODS returns_value FOR TESTING.\nENDCLASS.\nCLASS ltc_value IMPLEMENTATION.\n  METHOD returns_value.\n    DATA(subject) = NEW ${f.name.toLowerCase()}( ).\n    cl_abap_unit_assert=>assert_equals( act = subject->get_value( ) exp = 2 ).\n  ENDMETHOD.\nENDCLASS.\n`,
    };
  if (f.type === 'INCL')
    return {
      initial: `${comment}\nFORM fixture_value CHANGING cv_value TYPE i.\n  cv_value = 1.\nENDFORM.\n`,
      updated: `${comment}\nFORM fixture_value CHANGING cv_value TYPE i.\n  cv_value = 2.\nENDFORM.\n`,
    };
  const inc = fixtures.find((entry) => entry.type === 'INCL');
  return {
    initial: `${comment}\nREPORT ${f.name.toLowerCase()}.\nINCLUDE ${inc.name.toLowerCase()}.\nDATA gv_value TYPE i.\nSTART-OF-SELECTION.\n  PERFORM fixture_value CHANGING gv_value.\n`,
    updated: `${comment}\nREPORT ${f.name.toLowerCase()}.\nINCLUDE ${inc.name.toLowerCase()}.\nDATA gv_value TYPE i.\nSTART-OF-SELECTION.\n  PERFORM fixture_value CHANGING gv_value.\n  gv_value = gv_value + 1.\n`,
    symbols: `@MaxLength:27\n001=${marker.slice(0, 16)} PP fixture\n`,
  };
}
export function makeCurrentManifest(marker, bindings, config) {
  requireEvidence(/^[A-F0-9]{32}$/.test(marker), 'INVALID_CURRENT_MARKER');
  const suffix = marker.slice(0, 12);
  const fixtures = [
    ['writerA', 'CLAS', 'CA'],
    ['writerB', 'CLAS', 'CB'],
    ['writerA', 'INCL', 'I'],
    ['writerA', 'PROG', 'P'],
  ].map(([actor, type, tag]) => ({
    actor,
    type,
    name: `ZARC1_PP_${tag}_${suffix}`,
    package: actor === 'writerA' ? bindings.recording.package : '$TMP',
  }));
  return {
    version: 1,
    plan: currentPlan,
    target: config.target,
    nativeUrl: 'https://a4h.marianzeis.de',
    client: '001',
    marker,
    bindings,
    actors: config.actors,
    fixtures,
  };
}
export function validateCurrentManifest(manifest, config, revision) {
  validateCurrentBindings(manifest?.bindings, revision);
  requireEvidence(manifest.bindings.recording.owner === config.actors[0].sapUser, 'RECORDING_OWNER_MISMATCH');
  requireEvidence(
    JSON.stringify(manifest) === JSON.stringify(makeCurrentManifest(manifest.marker, manifest.bindings, config)),
    'CURRENT_MANIFEST_CHANGED',
  );
  return sha(manifest);
}
export function currentOwner(f) {
  const base = {
    CLAS: '/sap/bc/adt/oo/classes/',
    PROG: '/sap/bc/adt/programs/programs/',
    INCL: '/sap/bc/adt/programs/includes/',
  }[f.type];
  requireEvidence(base && /^ZARC1_PP_(?:CA|CB|I|P)_[A-F0-9]{12}$/.test(f.name), 'UNKNOWN_CURRENT_OWNER');
  return base + f.name.toLowerCase();
}
/** Complete parsed request/tree, never a package-browser result or caller-claimed recording. */
export function verifyCurrentRecording(request, manifest, required = []) {
  const r = manifest.bindings.recording;
  requireEvidence(
    request?.id === r.request &&
      request.owner === r.owner &&
      ['D', 'L'].includes(request.status) &&
      request.type === 'K' &&
      Array.isArray(request.tasks) &&
      (request.requestObjects === undefined || Array.isArray(request.requestObjects)),
    'RECORDED_REQUEST_NOT_MODIFIABLE',
  );
  const tasks = request.tasks.filter((task) => task.id === r.task);
  requireEvidence(
    tasks.length === 1 &&
      tasks[0].owner === r.owner &&
      ['D', 'L'].includes(tasks[0].status) &&
      Array.isArray(tasks[0].objects),
    'RECORDED_TASK_NOT_MODIFIABLE',
  );
  const objects = [...(request.requestObjects ?? []), ...tasks[0].objects];
  for (const f of required)
    requireEvidence(
      objects.some((o) => o.pgmid === 'R3TR' && o.type === (f.type === 'INCL' ? 'PROG' : f.type) && o.name === f.name),
      'FIXTURE_RECORDING_NOT_CONFIRMED',
    );
  return { request: request.id, task: tasks[0].id, required: required.map((f) => f.name) };
}

/** The fixed one-row native symbol fixture; preserve values, allow native annotation spacing/blank lines. */
export function currentSymbolsMatch(actual, expected) {
  const lines = (text) =>
    typeof text === 'string'
      ? text
          .replace(/\r\n/g, '\n')
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => line.replace(/^@MaxLength:[ \t]*/, '@MaxLength:'))
      : [];
  const wanted = lines(expected),
    observed = lines(actual);
  return (
    wanted.length === 2 &&
    /^@MaxLength:27$/.test(wanted[0]) &&
    /^001=[A-F0-9]{16} PP fixture$/.test(wanted[1]) &&
    JSON.stringify(observed) === JSON.stringify(wanted)
  );
}
