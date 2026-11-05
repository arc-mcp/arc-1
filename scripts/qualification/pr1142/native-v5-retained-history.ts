/** Private hash-bound evidence, including the original failed claim; no native calls or repairs. */
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { verifyDeclarativeV5History } from './native-declarative-v5-history.js';
import { privateDirectory } from './native-lock-binding.js';
import { retainedLedgerHash } from './native-v5-retained-fixed.js';
const packet = 'arc1-review/pr1142-native-v5-execution-20261103';
/** Explicit parameters are isolated offline seams; the fixed entry always supplies none. */
export function verifyRetainedHistory(
  state = join(homedir(), '.local/state'),
  digest = retainedLedgerHash,
  older = verifyDeclarativeV5History,
) {
  older();
  const path = (relative: string) => {
    const parts = relative.split('/');
    if (parts.some((p) => !/^[A-Za-z0-9_.-]+$/.test(p) || p === '.' || p === '..'))
      throw new Error('Invalid fixed evidence path.');
    for (let i = 1; i < parts.length; i++) privateDirectory(join(state, ...parts.slice(0, i)));
    return join(state, ...parts);
  };
  const file = privateEvidence(
    path('arc1-review/pr1142-native-v5-retained-assessment/continuation-inputs.json'),
    512 * 1024,
  );
  if (file.sha256 !== digest) throw new Error('Retained ledger changed.');
  const data = JSON.parse(file.body.toString('utf8')) as {
    originalFiles: Record<string, string>;
    inspectionRows: Record<string, string>;
    inspectionManifest: string;
    inspectionResult: string;
    postFiles: Record<string, string>;
    collectorHash: string;
  };
  const original = 'arc1-qualification/pr1142-native-declarative-v5';
  const actual: string[] = [];
  const walk = (relative = '', depth = 0) => {
    if (depth > 6) throw new Error('Evidence depth changed.');
    const directory = path(`${original}${relative ? `/${relative}` : ''}`);
    privateDirectory(directory);
    for (const child of readdirSync(directory, { withFileTypes: true })) {
      if (child.isSymbolicLink()) throw new Error('Evidence link refused.');
      const name = relative ? `${relative}/${child.name}` : child.name;
      if (child.isDirectory()) walk(name, depth + 1);
      else {
        if (!child.isFile() || actual.length >= 980) throw new Error('Evidence count changed.');
        actual.push(name);
      }
    }
  };
  walk();
  if (
    actual.length !== 980 ||
    JSON.stringify(actual.sort()) !== JSON.stringify(Object.keys(data.originalFiles).sort())
  )
    throw new Error('Original failed root changed.');
  const check = (relative: string, sha: string) => {
    if (
      !/^[a-f0-9]{64}$/.test(sha) ||
      privateEvidence(path(relative), relative.endsWith('.jpg') ? 8 * 1024 * 1024 : 512 * 1024).sha256 !== sha
    )
      throw new Error('Retained evidence changed.');
  };
  for (const [name, sha] of Object.entries(data.originalFiles)) check(`${original}/${name}`, sha);
  if (Object.keys(data.inspectionRows).length !== 18 || Object.keys(data.postFiles).length !== 5)
    throw new Error('Inspection evidence count changed.');
  for (let i = 1; i <= 18; i++) {
    const name = `${String(i).padStart(5, '0')}.json`;
    check(`${packet}/retained-inspection/${name}`, data.inspectionRows[name]);
  }
  check(`${packet}/retained-inspection/manifest.json`, data.inspectionManifest);
  check(`${packet}/retained-inspection/result.json`, data.inspectionResult);
  check(`${packet}/inspect-retained.mjs`, data.collectorHash);
  for (const [name, sha] of Object.entries(data.postFiles)) check(`${packet}/post-failure/${name}`, sha);
}
