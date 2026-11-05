/** Preserved failed partial create, old claims and exact private operator copy; no native imports. */
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CTS_RETAINED_V3_ORIGIN } from './native-cts-fixtures.js';
import { retainedCtsV2History } from './native-cts-retained-v2-history.js';
import { privateHistoryPath, verifyPrivateHistoryLedger } from './native-ddic-structure-cleanup-history.js';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { privateDirectory } from './native-lock-binding.js';

const auditRoot = 'arc1-review/pr1142-cts-retained-v2-stop-independent-audit1';
const operator = 'arc1-review/pr1142-cts-retained-v2-execution-20261104';
const copy = 'arc1-review/pr1142-cts-retained-v2-operator-private-copy1';
const native = 'arc1-qualification/pr1142-native-cts-retained-v2';
const roots = { [native]: 240, [operator]: 16, 'arc1-review/pr1142-cts-retained-v2-stop-reads-20261104': 14 };
type Receipt = { sha256: string; bytes: number; mode: number; uid: number; gid: number };
/** Test seams only; the fixed executable supplies no paths, receipts or expected hashes. */
export function retainedCtsV3History(
  state = join(homedir(), '.local/state'),
  expected: {
    auditHash: string;
    reportHash: string;
    operatorCopyHash: string;
    inventoryAuditHash: string;
    revision: string;
    intentHash: string;
    resultHash: string;
    completed: readonly string[];
  } = CTS_RETAINED_V3_ORIGIN.consumedRetainedV2,
  older: (state: string) => { verify: () => void } = retainedCtsV2History,
) {
  const old = older(state),
    path = (relative: string) => privateHistoryPath(state, relative);
  const read = (relative: string, hash: string) => {
    const f = privateEvidence(path(relative), 2 * 1024 * 1024);
    if (f.sha256 !== hash) throw new Error('Retained CTS v3 audit changed.');
    return JSON.parse(f.body.toString());
  };
  const audit = read(`${auditRoot}/verification.json`, expected.auditHash),
    provenance = read(`${auditRoot}/operator-copy-provenance.json`, expected.operatorCopyHash);
  if (
    audit.revision !== expected.revision ||
    audit.intentHash !== expected.intentHash ||
    audit.resultHash !== expected.resultHash ||
    JSON.stringify(audit.completed) !== JSON.stringify(expected.completed) ||
    audit.dispatchedMutations !== 3 ||
    !audit.originalsUnchanged ||
    provenance.source !== path(operator) ||
    provenance.copy !== path(copy) ||
    provenance.files?.length !== 16
  )
    throw new Error('Exact failed partial class create history required.');
  const inventory = read(`${auditRoot}/inventory-addendum.json`, expected.inventoryAuditHash);
  if (
    inventory.root !== 'arc1-review/pr1142-cts-retained-inactive-inventory-20261104' ||
    inventory.source !== expected.revision ||
    inventory.rawBodyHash !== 'c117c4b1733d7947ceaa5395384155902a7a010c9044e9f0376b5e18e3320968' ||
    inventory.totalEntries !== 64 ||
    inventory.ownedEntries !== 8 ||
    inventory.suffixOccurrences !== 30
  )
    throw new Error('Exact initial inventory binding required.');
  const verify = () => {
    old.verify();
    read(`${auditRoot}/inventory-addendum.json`, expected.inventoryAuditHash);
    verifyPrivateHistoryLedger(path(inventory.root), inventory.files, 5);
    read(`${auditRoot}/verification.json`, expected.auditHash);
    read(`${auditRoot}/operator-copy-provenance.json`, expected.operatorCopyHash);
    if (privateEvidence(path(`${auditRoot}/result.md`), 512 * 1024).sha256 !== expected.reportHash)
      throw new Error('Retained CTS assessment changed.');
    let bytes = 0;
    for (const [root, count] of Object.entries(roots)) {
      const files = audit.roots[root] as Record<string, Receipt>;
      if (!files || Object.keys(files).length !== count) throw new Error('Retained CTS history count changed.');
      const dirs = new Set(['']);
      for (const name of Object.keys(files)) {
        let d = dirname(name);
        while (d !== '.') {
          dirs.add(d);
          d = dirname(d);
        }
      }
      if (root === native) for (const d of ['B', 'B/preflight', 'C', 'C/preflight']) dirs.add(d);
      const found: string[] = [],
        seen = new Set<string>();
      const walk = (dir = '', depth = 0) => {
        if (depth > 6 || !dirs.has(dir)) throw new Error('Retained CTS directory changed.');
        const full = path(root + (dir ? `/${dir}` : ''));
        privateDirectory(full);
        seen.add(dir);
        for (const child of readdirSync(full, { withFileTypes: true })) {
          const name = dir ? `${dir}/${child.name}` : child.name;
          if (child.isSymbolicLink()) throw new Error('Retained CTS links refused.');
          if (child.isDirectory()) walk(name, depth + 1);
          else {
            const receipt = files[name];
            if (!child.isFile() || !receipt || found.length >= count)
              throw new Error('Retained CTS membership changed.');
            const file = privateEvidence(path(`${root}/${name}`), 8 * 1024 * 1024, root !== native),
              stat = lstatSync(path(`${root}/${name}`));
            bytes += file.body.length;
            if (
              bytes > 24 * 1024 * 1024 ||
              file.sha256 !== receipt.sha256 ||
              file.body.length !== receipt.bytes ||
              (stat.mode & 0o777) !== receipt.mode ||
              stat.uid !== receipt.uid ||
              stat.gid !== receipt.gid
            )
              throw new Error('Retained CTS receipt or ownership changed.');
            found.push(name);
          }
        }
      };
      walk();
      if (seen.size !== dirs.size || JSON.stringify(found.sort()) !== JSON.stringify(Object.keys(files).sort()))
        throw new Error('Retained CTS history incomplete.');
    }
    const copied: Record<string, Receipt> = {};
    for (const item of provenance.files) {
      const original = audit.roots[operator][item.name] as Receipt;
      if (
        !original ||
        copied[item.name] ||
        item.sha256 !== original.sha256 ||
        item.bytes !== original.bytes ||
        item.sourceMode !== original.mode ||
        item.sourceUid !== original.uid ||
        item.sourceGid !== original.gid ||
        item.copyMode !== 0o600 ||
        item.copyUid !== process.getuid?.() ||
        item.copyGid !== original.gid
      )
        throw new Error('Private CTS operator copy changed.');
      const stat = lstatSync(path(`${copy}/${item.name}`));
      if ((stat.mode & 0o777) !== item.copyMode || stat.uid !== item.copyUid || stat.gid !== item.copyGid)
        throw new Error('Private CTS copy ownership changed.');
      copied[item.name] = { ...original, mode: item.copyMode };
    }
    verifyPrivateHistoryLedger(path(copy), copied, 16);
    if (
      existsSync(path(`${native}/B/attempt`)) ||
      existsSync(path(`${native}/C/attempt`)) ||
      existsSync(path(`${native}/running`))
    )
      throw new Error('Old CTS claim changed.');
    const intent = privateEvidence(path(`${native}/intent.json`)),
      result = privateEvidence(path(`${native}/A/attempt/result.json`));
    const outcome = JSON.parse(result.body.toString());
    if (
      intent.sha256 !== expected.intentHash ||
      result.sha256 !== expected.resultHash ||
      outcome.failure !== true ||
      JSON.stringify(outcome.completed) !== JSON.stringify(expected.completed) ||
      outcome.confirmedDeleted.length ||
      outcome.confirmedReleased.length
    )
      throw new Error('Original CTS claim must remain failed.');
  };
  verify();
  return { verify };
}
