/** Fixed read-only proof of the second consumed quickfix computation and unchanged owned source. */
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { privateDirectory } from './native-lock-binding.js';
import { runtimeRetainedClassReceipt, runtimeRetainedHistory } from './native-runtime-retained-fixed.js';
import { verifyRuntimeRetainedHistory } from './native-runtime-retained-history.js';
import { runtimeRetainedV2History as proof } from './native-runtime-retained-v2-fixed.js';
import { runtimeClassOwner } from './native-runtime-slice-fixed.js';
const audit = 'arc1-review/pr1142-runtime-retained-stop-independent-audit1';
const operator = 'arc1-review/pr1142-runtime-retained-stop-operator-audit1';
const roots = {
  'arc1-qualification/pr1142-native-runtime-flp-retained-v1': 31,
  'arc1-review/pr1142-runtime-retained-execution-20261104': 9,
  'arc1-review/pr1142-runtime-quickfix-post-computation-reads-20261104': 5,
};
const savedPrefix = '/Users/marianzeis/.local/state/';
/** Alternate state/digests/prior verifier are isolated test seams, absent from CLI execution. */
export function verifyRuntimeRetainedV2History(
  state = join(homedir(), '.local/state'),
  expected = proof,
  verifyPrior = () => verifyRuntimeRetainedHistory(state),
) {
  verifyPrior();
  if (JSON.stringify(expected.priorHistory) !== JSON.stringify(runtimeRetainedHistory))
    throw new Error('Prior runtime proof changed.');
  const path = (relative: string) => {
    const parts = relative.split('/');
    if (parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..'))
      throw new Error('Historical path.');
    for (let i = 1; i < parts.length; i++) privateDirectory(join(state, ...parts.slice(0, i)));
    return join(state, ...parts);
  };
  const read = (name: string, hash: string) => {
    const file = privateEvidence(path(name), name.endsWith('.jpg') ? 8 * 1024 * 1024 : 512 * 1024);
    if (!/^[a-f0-9]{64}$/.test(hash) || file.sha256 !== hash) throw new Error('Historical bytes changed.');
    return file;
  };
  // A claim directory remains consumed even if a process stopped before writing a result.
  for (const root of [Object.keys(roots)[0], 'arc1-qualification/pr1142-native-runtime-flp-v1'])
    for (const stage of ['profiler', 'populated-flp', 'st05'])
      if (existsSync(join(path(root), stage, 'attempt'))) throw new Error('A later historical stage was claimed.');
  const independent = JSON.parse(read(`${audit}/result.json`, expected.independentAuditHash).body.toString('utf8'));
  read(`${audit}/result.md`, expected.independentReportHash);
  const operated = JSON.parse(read(`${operator}/result.json`, expected.operatorAuditHash).body.toString('utf8'));
  read(`${operator}/result.md`, expected.operatorReportHash);
  if (
    expected.originalFileCount !== 45 ||
    independent.revision !== expected.originalRevision ||
    independent.resultSha256 !== expected.failedQuickfixResultHash ||
    independent.status !== 'audited-failed-retained' ||
    independent.journalRows !== 25 ||
    JSON.stringify(independent.dispatchCounts) !== JSON.stringify({ GET: 5, POST: 3 }) ||
    independent.allObservedResponses200 !== true ||
    independent.metadataSha256 !== runtimeRetainedClassReceipt.metadataHash ||
    independent.sourceSha256 !== runtimeRetainedClassReceipt.sourceHash ||
    independent.proposalSha256 !== expected.proposalResultHash ||
    independent.followupBytesEqual !== true ||
    independent.originalEvidenceUnchanged !== true ||
    independent.postLocksVisuallyZero !== true ||
    JSON.stringify(independent.remaining) !== JSON.stringify([runtimeClassOwner]) ||
    JSON.stringify(independent.rootCounts) !== JSON.stringify(roots) ||
    !independent.originalEvidence || Object.keys(independent.originalEvidence).length !== 45 ||
    operated.revision !== expected.originalRevision ||
    operated.resultSha256 !== expected.failedQuickfixResultHash ||
    operated.createPutDeleteActivationDispatched !== false ||
    operated.storedSourceAndMetadataUnchangedAfterStop !== true ||
    JSON.stringify(operated.remaining) !== JSON.stringify([runtimeClassOwner]) ||
    operated.fileCount !== 45 || !Array.isArray(operated.files) || operated.files.length !== 45
  ) throw new Error('Historical native facts changed.');
  const declared = Object.keys(independent.originalEvidence).map((absolute) => {
    if (!absolute.startsWith(savedPrefix)) throw new Error('Historical origin.');
    const relative = absolute.slice(savedPrefix.length);
    if (!Object.keys(roots).some(root => relative.startsWith(root+'/'))) throw new Error('Historical root.');
    return relative;
  });
  const actual: string[] = [];
  const walk = (relative: string, depth = 0) => {
    if (depth > 6) throw new Error('Historical depth.');
    privateDirectory(path(relative));
    for (const child of readdirSync(path(relative), { withFileTypes: true })) {
      if (child.isSymbolicLink()) throw new Error('Historical link.');
      const name = `${relative}/${child.name}`;
      if (child.isDirectory()) walk(name, depth+1);
      else {
        if (!child.isFile() || actual.length >= 45) throw new Error('Historical count.');
        actual.push(name);
      }
    }
  };
  for (const [root,count] of Object.entries(roots)) {
    walk(root);
    if (declared.filter(name=>name.startsWith(root+'/')).length !== count) throw new Error('Historical root count.');
  }
  if (JSON.stringify(actual.sort()) !== JSON.stringify(declared.sort())) throw new Error('Historical membership.');
  const operatorPaths = operated.files.map((row: {path:string})=>row.path);
  if (new Set(operatorPaths).size !== 45 || JSON.stringify(operatorPaths.sort()) !== JSON.stringify(declared.map(name=>savedPrefix+name).sort()))
    throw new Error('Operator membership.');
  for (const relative of declared) {
    const entry=independent.originalEvidence[savedPrefix+relative], file=read(relative,entry.sha256), stat=lstatSync(path(relative));
    const other=operated.files.find((row:{path:string})=>row.path===savedPrefix+relative);
    if(file.body.length!==entry.bytes || entry.mode!==0o600 || (stat.mode&0o7777)!==entry.mode || stat.uid!==entry.uid || stat.gid!==entry.gid || entry.uid!==process.getuid?.() || other.sha256!==entry.sha256 || other.bytes!==entry.bytes || other.mode!=='0600')
      throw new Error('Historical file metadata.');
  }
  const root=Object.keys(roots)[0];
  read(`${root}/intent.json`,expected.originalIntentHash);
  const failed=JSON.parse(read(`${root}/quickfix/attempt/result.json`,expected.failedQuickfixResultHash).body.toString('utf8'));
  if(failed.protocol!==expected.originalProtocol || failed.revision!==expected.originalRevision || failed.intentHash!==expected.originalIntentHash || failed.previousResultHash!==runtimeRetainedHistory.failedQuickfixResultHash || failed.failure!==true || failed.stage!=='quickfix' || failed.stoppedAt!=='quickfix' || failed.created!==false || failed.createReplayed!==false || failed.finalAbsent!==false || failed.sourceUnchanged!==false || failed.mutationDispatched!==true || JSON.stringify(failed.adopted)!==JSON.stringify([runtimeClassOwner]) || JSON.stringify(failed.remaining)!==JSON.stringify([runtimeClassOwner]) || JSON.stringify(failed.confirmedDeleted)!=='[]')
    throw new Error('Historical retained outcome.');
}
