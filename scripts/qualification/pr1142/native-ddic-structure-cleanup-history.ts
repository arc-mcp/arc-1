/** Rehash the consumed original protocol and separate read-only/operator observations, without changing either. */
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  STRUCTURE_HISTORY,
  STRUCTURE_RECEIPT,
  STRUCTURE_SUFFIX,
  structureCleanupFixtures,
} from './native-ddic-structure-cleanup-fixed.js';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { privateDirectory } from './native-lock-binding.js';

type Ledger = Record<string, { bytes: number; sha256: string }>;
export function privateHistoryPath(root: string, relative: string) {
  const parts = relative.split('/');
  if (parts.some((v) => !/^[A-Za-z0-9_.-]+$/.test(v) || v === '.' || v === '..')) throw new Error();
  for (let i = 1; i < parts.length; i++) privateDirectory(join(root, ...parts.slice(0, i)));
  return join(root, ...parts);
}
export function verifyPrivateHistoryLedger(root: string, files: Ledger, count: number) {
  if (Object.keys(files).length !== count) throw new Error();
  const names: string[] = [];
  const walk = (relative = '', depth = 0) => {
    if (depth > 6) throw new Error();
    const directory = join(root, relative);
    privateDirectory(directory);
    for (const child of readdirSync(directory, { withFileTypes: true })) {
      const name = relative ? `${relative}/${child.name}` : child.name;
      if (child.isSymbolicLink()) throw new Error();
      if (child.isDirectory()) walk(name, depth + 1);
      else {
        if (!child.isFile() || names.length >= count) throw new Error();
        names.push(name);
      }
    }
  };
  walk();
  if (JSON.stringify(names.sort()) !== JSON.stringify(Object.keys(files).sort())) throw new Error();
  for (const [name, receipt] of Object.entries(files)) {
    const saved = privateEvidence(privateHistoryPath(root, name), name.endsWith('.jpg') ? 8 * 1024 * 1024 : 512 * 1024);
    if (saved.sha256 !== receipt.sha256 || saved.body.byteLength !== receipt.bytes) throw new Error();
  }
}

/** Explicit state/hashes are offline test seams; the fixed CLI never supplies them. */
export function verifyStructureCleanupHistory(
  state = join(homedir(), '.local/state'),
  expected: { audit: string; ledger: string; intent: string; result: string } = STRUCTURE_HISTORY,
) {
  try {
    const auditRoot = 'arc1-review/pr1142-native-ddic-collections-execution-audit1';
    if (privateEvidence(privateHistoryPath(state, `${auditRoot}/audit.md`), 512 * 1024).sha256 !== expected.audit)
      throw new Error();
    const path = privateHistoryPath(state, `${auditRoot}/audit.json`),
      saved = privateEvidence(path, 512 * 1024);
    if (saved.sha256 !== expected.ledger) throw new Error();
    const audit = JSON.parse(saved.body.toString('utf8'));
    if (
      audit.revision !== '757a7cef0e3a4bec73f08fb59ab29c964572bc05' ||
      audit.resultSha256 !== expected.result ||
      audit.nativeVersion !== 'new' ||
      audit.retainedSourceSha256 !== STRUCTURE_RECEIPT.sourceHash ||
      JSON.stringify(audit.remaining) !== JSON.stringify([structureCleanupFixtures(STRUCTURE_SUFFIX)[0].owner]) ||
      audit.protocolFiles['intent.json']?.sha256 !== expected.intent ||
      audit.protocolFiles['attempt/result.json']?.sha256 !== expected.result
    )
      throw new Error();
    verifyPrivateHistoryLedger(
      privateHistoryPath(state, 'arc1-qualification/pr1142-native-ddic-collections-v1'),
      audit.protocolFiles,
      78,
    );
    verifyPrivateHistoryLedger(
      privateHistoryPath(state, 'arc1-review/pr1142-native-ddic-collections-execution-20261103'),
      audit.operatorFiles,
      18,
    );
    if (privateEvidence(path, 512 * 1024).sha256 !== expected.ledger) throw new Error();
  } catch {
    throw new Error('Original collections failure or retained structure evidence changed.');
  }
}
