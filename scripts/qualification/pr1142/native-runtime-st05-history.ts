/** Fixed read-only evidence proof; no generic resume path or caller-supplied historical root. */
import { lstatSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { privateDirectory } from './native-lock-binding.js';
import { runtimeRetainedV2History } from './native-runtime-retained-v2-fixed.js';
import { verifyRuntimeRetainedV2History } from './native-runtime-retained-v2-history.js';
import { runtimeClassOwner } from './native-runtime-slice-fixed.js';
import { runtimeSt05History as proof } from './native-runtime-st05-fixed.js';
const audit = 'arc1-review/pr1142-runtime-retained-v2-independent-audit1';
const operator = 'arc1-review/pr1142-runtime-retained-v2-operator-audit1';
const roots = {
  'arc1-qualification/pr1142-native-runtime-flp-retained-v2': 330,
  'arc1-review/pr1142-runtime-retained-v2-execution-20261104': 18,
  'arc1-review/pr1142-enho-content-and-st05-post-reads-20261104': 6,
};
const prefix = '/Users/marianzeis/.local/state/';
/** Alternate state/proof/prior callback are isolated offline test seams, absent from the CLI. */
export function verifyRuntimeSt05History(
  state = join(homedir(), '.local/state'),
  expected = proof,
  verifyPrior = () => verifyRuntimeRetainedV2History(state),
) {
  verifyPrior();
  if (JSON.stringify(expected.priorHistory) !== JSON.stringify(runtimeRetainedV2History))
    throw new Error('Prior runtime proof changed.');
  const path = (relative: string) => {
    const parts = relative.split('/');
    if (parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..'))
      throw new Error('Historical path.');
    for (let i = 1; i < parts.length; i++) privateDirectory(join(state, ...parts.slice(0, i)));
    return join(state, ...parts);
  };
  const read = (name: string, hash: string) => {
    const value = privateEvidence(path(name), name.endsWith('.jpg') ? 8 * 1024 * 1024 : 512 * 1024);
    if (!/^[a-f0-9]{64}$/.test(hash) || value.sha256 !== hash) throw new Error('Historical bytes changed.');
    return value;
  };
  const independent = JSON.parse(read(`${audit}/result.json`, expected.independentAuditHash).body.toString());
  read(`${audit}/result.md`, expected.independentReportHash);
  const manifest = JSON.parse(
    read(`${audit}/all-evidence-after.json`, expected.independentManifestHash).body.toString(),
  );
  const operated = JSON.parse(read(`${operator}/result.json`, expected.operatorAuditHash).body.toString());
  read(`${operator}/result.md`, expected.operatorReportHash);
  if (
    expected.originalFileCount !== 354 ||
    independent.source !== expected.originalRevision ||
    independent.status !== 'actual-execution-audit-complete-with-explicit-limitations' ||
    independent.st05MutationDispatched !== false ||
    independent.fullRuntimeComplete !== false ||
    independent.evidence.currentFiles !== 354 ||
    independent.evidence.priorFiles !== 165 ||
    independent.evidence.allBoundFiles !== 562 ||
    independent.evidence.unchanged !== true ||
    independent.evidence.manifestSha256 !== expected.independentManifestHash ||
    independent.postSm12.zero !== true ||
    Object.keys(manifest).length !== 562 ||
    operated.revision !== expected.originalRevision ||
    operated.status !== 'three-completed-st05-baseline-refused' ||
    operated.st05NoMutation !== true ||
    operated.st05PostRawBytesEqual !== true ||
    operated.fileCount !== 354 ||
    !Array.isArray(operated.files) ||
    operated.files.length !== 354 ||
    JSON.stringify(operated.resultHashes) !== JSON.stringify(expected.results)
  )
    throw new Error('Historical native facts changed.');
  const declared = operated.files.map((row: { path: string }) => {
    if (!row.path.startsWith(prefix)) throw new Error('Historical origin.');
    const relative = row.path.slice(prefix.length);
    if (!Object.keys(roots).some((root) => relative.startsWith(root + '/'))) throw new Error('Historical root.');
    path(relative);
    return relative;
  }) as string[];
  if (new Set(declared).size !== 354) throw new Error('Historical duplicate.');
  const root = Object.keys(roots)[0];
  const directories = new Set([root + '/final', root + '/final/prerequisites', ...Object.keys(roots)]);
  for (const name of declared) {
    const parts = name.split('/');
    for (let i = 2; i < parts.length; i++) directories.add(parts.slice(0, i).join('/'));
  }
  const actual: string[] = [],
    seenDirectories = new Set<string>();
  const walk = (relative: string, depth = 0) => {
    if (depth > 6 || !directories.has(relative)) throw new Error('Historical directory.');
    privateDirectory(path(relative));
    seenDirectories.add(relative);
    for (const child of readdirSync(path(relative), { withFileTypes: true })) {
      if (child.isSymbolicLink()) throw new Error('Historical link.');
      const name = relative + '/' + child.name;
      if (child.isDirectory()) walk(name, depth + 1);
      else {
        if (!child.isFile() || actual.length >= 354) throw new Error('Historical count.');
        actual.push(name);
      }
    }
  };
  for (const [directory, count] of Object.entries(roots)) {
    walk(directory);
    if (declared.filter((name) => name.startsWith(directory + '/')).length !== count)
      throw new Error('Historical root count.');
  }
  if (
    JSON.stringify(actual.sort()) !== JSON.stringify(declared.sort()) ||
    JSON.stringify([...seenDirectories].sort()) !== JSON.stringify([...directories].sort())
  )
    throw new Error('Historical membership.');
  for (const name of declared) {
    const row = operated.files.find((v: { path: string }) => v.path === prefix + name);
    const saved = manifest[prefix + name],
      file = read(name, row.sha256),
      stat = lstatSync(path(name));
    if (
      !saved ||
      row.bytes !== file.body.length ||
      row.mode !== '0600' ||
      saved.sha256 !== row.sha256 ||
      saved.bytes !== row.bytes ||
      saved.mode !== '0600' ||
      (stat.mode & 0o7777) !== 0o600 ||
      saved.uid !== stat.uid ||
      saved.gid !== stat.gid ||
      stat.uid !== process.getuid?.() ||
      row.uid !== stat.uid ||
      row.gid !== stat.gid
    )
      throw new Error('Historical file metadata.');
  }
  read(root + '/intent.json', expected.originalIntentHash);
  let previous: string = expected.priorHistory.failedQuickfixResultHash;
  for (const stage of ['quickfix', 'profiler', 'populated-flp', 'st05'] as const) {
    const result = JSON.parse(read(`${root}/${stage}/attempt/result.json`, expected.results[stage]).body.toString());
    if (
      result.protocol !== expected.originalProtocol ||
      result.revision !== expected.originalRevision ||
      result.intentHash !== expected.originalIntentHash ||
      result.previousResultHash !== previous ||
      result.stage !== stage ||
      JSON.stringify(result.remaining) !== '[]' ||
      result.ppQualified !== false ||
      result.publicAdmission !== false ||
      result.failure !== (stage === 'st05') ||
      result.mutationDispatched !== (stage !== 'st05')
    )
      throw new Error('Historical outcome.');
    if (
      stage === 'quickfix' &&
      (result.finalAbsent !== true ||
        result.sourceUnchanged !== true ||
        result.createReplayed !== false ||
        result.cleanup.unlockFailed !== false ||
        result.cleanup.sessionClosed !== true ||
        JSON.stringify(result.confirmedDeleted) !== JSON.stringify([runtimeClassOwner]))
    )
      throw new Error('Class cleanup.');
    if (
      stage === 'profiler' &&
      (result.cancelled !== true || result.parametersCleanup !== 'native-retention-unverified')
    )
      throw new Error('Profiler outcome.');
    if (
      stage === 'populated-flp' &&
      (result.nativeDeleteCompleted?.length !== 2 ||
        result.readAbsenceConfirmed !== false ||
        result.recording !== 'native-governed-unverified')
    )
      throw new Error('FLP outcome.');
    if (
      stage === 'st05' &&
      (result.reason !== 'st05-restoration-prerequisite' ||
        result.stoppedAt !== 'baseline' ||
        result.restored !== false ||
        result.clientIsolated !== false)
    )
      throw new Error('ST05 refusal.');
    previous = expected.results[stage];
  }
  const baseline = JSON.parse(privateEvidence(path(`${root}/st05/attempt/run/00003.json`)).body.toString());
  if (
    baseline.value.stage !== 'response' ||
    baseline.value.method !== 'GET' ||
    baseline.value.path !== '/sap/bc/adt/st05/trace/state' ||
    baseline.value.status !== 200 ||
    baseline.value.sha256 !== expected.baselineHash
  )
    throw new Error('ST05 baseline.');
}
