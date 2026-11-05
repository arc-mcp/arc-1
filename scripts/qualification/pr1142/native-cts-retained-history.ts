/** Fixed consumed A and independent retained-pair audit. No native imports or phase execution. */
import { lstatSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { CTS_RETAINED_ORIGIN } from './native-cts-fixtures.js';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { privateDirectory } from './native-lock-binding.js';

const audit = 'arc1-review/pr1142-native-cts-stop-independent-audit1';
const roots = {
  original: ['arc1-qualification/pr1142-native-cts-workflows-v1', 86],
  operator: ['arc1-review/pr1142-native-cts-execution-20261103', 11],
  inspection: ['arc1-review/pr1142-cts-created-request-readonly-20261103', 3],
} as const;
interface Receipt {
  sha256: string;
  bytes: number;
  mode: string;
  uid: number;
  gid: number;
}
/** The entry supplies no overrides. Explicit values are offline test seams only. */
export function retainedCtsHistory(
  state = join(homedir(), '.local/state'),
  expectedAudit = CTS_RETAINED_ORIGIN.auditHash as string,
  expectedReport = CTS_RETAINED_ORIGIN.auditReportHash as string,
) {
  const path = (relative: string) => {
    const parts = relative.split('/');
    if (parts.some((p) => !/^[A-Za-z0-9_.-]+$/.test(p) || p === '.' || p === '..'))
      throw new Error('Invalid CTS history path.');
    for (let i = 1; i < parts.length; i++) privateDirectory(join(state, ...parts.slice(0, i)));
    return join(state, ...parts);
  };
  const file = privateEvidence(path(`${audit}/audit.json`), 1024 * 1024);
  if (file.sha256 !== expectedAudit) throw new Error('Fixed CTS audit changed.');
  const data = JSON.parse(file.body.toString()) as {
    sourceRevision: string;
    failedResultSha256: string;
    files: Record<string, Receipt>;
  };
  if (
    data.sourceRevision !== CTS_RETAINED_ORIGIN.revision ||
    data.failedResultSha256 !== CTS_RETAINED_ORIGIN.resultHash ||
    !data.files ||
    Object.keys(data.files).length !== 100
  )
    throw new Error('Fixed stopped CTS history required.');
  const verify = () => {
    if (
      privateEvidence(path(`${audit}/audit.json`), 1024 * 1024).sha256 !== expectedAudit ||
      privateEvidence(path(`${audit}/audit.md`), 128 * 1024).sha256 !== expectedReport
    )
      throw new Error('Independent CTS audit changed.');
    let bytes = 0;
    for (const [prefix, [root, count]] of Object.entries(roots)) {
      const expected = Object.keys(data.files).filter((key) => key.startsWith(`${prefix}/`));
      if (expected.length !== count) throw new Error('CTS history count changed.');
      const files: string[] = [],
        directories = new Set(['']);
      for (const key of expected) {
        const relative = key.slice(prefix.length + 1);
        if (relative.split('/').some((part) => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..'))
          throw new Error('Invalid CTS history member.');
        let parent = dirname(relative);
        while (parent !== '.') {
          directories.add(parent);
          parent = dirname(parent);
        }
      }
      if (prefix === 'original') for (const name of ['B', 'B/preflight', 'C', 'C/preflight']) directories.add(name);
      const actualDirectories = new Set<string>();
      const walk = (relative = '', depth = 0) => {
        if (depth > 6 || !directories.has(relative)) throw new Error('CTS history directory changed.');
        const directory = path(root + (relative ? `/${relative}` : ''));
        privateDirectory(directory);
        actualDirectories.add(relative);
        for (const child of readdirSync(directory, { withFileTypes: true })) {
          if (child.isSymbolicLink()) throw new Error('CTS history links refused.');
          const name = relative ? `${relative}/${child.name}` : child.name;
          if (child.isDirectory()) walk(name, depth + 1);
          else {
            if (!child.isFile() || files.length >= count) throw new Error('CTS history membership changed.');
            const receipt = data.files[`${prefix}/${name}`];
            if (!receipt || !/^[a-f0-9]{64}$/.test(receipt.sha256)) throw new Error('Unbound CTS history file.');
            const full = path(`${root}/${name}`),
              saved = privateEvidence(full, 8 * 1024 * 1024),
              stat = lstatSync(full);
            bytes += saved.body.length;
            if (
              bytes > 16 * 1024 * 1024 ||
              saved.sha256 !== receipt.sha256 ||
              saved.body.length !== receipt.bytes ||
              `0o${(stat.mode & 0o777).toString(8)}` !== receipt.mode ||
              stat.uid !== receipt.uid ||
              stat.gid !== receipt.gid
            )
              throw new Error('CTS history bytes or ownership changed.');
            files.push(`${prefix}/${name}`);
          }
        }
      };
      walk();
      if (
        JSON.stringify(files.sort()) !== JSON.stringify(expected.sort()) ||
        actualDirectories.size !== directories.size
      )
        throw new Error('Incomplete CTS history.');
    }
  };
  verify();
  return { verify };
}
