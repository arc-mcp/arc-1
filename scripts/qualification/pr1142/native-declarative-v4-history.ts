/** Fixed historical receipts: hashes only. No old claim is writable or reusable by v4. */
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { DeclarativeFailure } from './native-declarative-workflow.js';
import { privateDirectory } from './native-lock-binding.js';
export interface DeclarativeHistoryEvidence {
  files: Readonly<Record<string, string>>;
  journals: readonly { path: string; count: number; sha256: string }[];
  absent: readonly string[];
}
export const declarativeV4HistoryEvidence: DeclarativeHistoryEvidence = {
  files: {
    'pr1142-native-declarative-v1/manifest.json': '8e728667000831c462cfe10f1854dffa65fad6f8fb75d124e22278e2d995a605',
    'pr1142-native-declarative-v1/result.json': 'e4a1997c61034c9de302dd0e25c44b524b1d9caa4af69fcb0270685ae13a7bf4',
    'pr1142-native-declarative-recovery-v1/manifest.json':
      '2f80efdb077459959ea19d0e25bb14e0b09174d8f8442294dcb4d85daa1e99ad',
    'pr1142-native-declarative-recovery-v1/result.json':
      '31f1bd4a81643f79adfdc6a19ca816e1aeb6a4eb855a59e3a18b2738a23e3130',
    'pr1142-native-declarative-v2/intent.json': '32dfdaeb4b1b7fd3b5e2770b641a9d1e39bc49d466ddbb8446c5971c44eae3fa',
    'pr1142-native-declarative-v2/attempt/result.json':
      'c9958fdf2466255fa644e335e90f4bafb01556d75cd7db6f6ca98298f227a129',
    'pr1142-native-declarative-v3/intent.json': 'baf30e8af101a55265af39e4a68d8071e019f1f60f7ba5c57da55452f4933852',
    'pr1142-native-declarative-v3/attempt/manifest.json':
      '1c27ee243e21b5a36d467f47f8a7cfde1b2d7780160cb1bdb77aac9c5e4347ef',
    'pr1142-native-declarative-v3/attempt/result.json':
      '3b448b37cd7fbfeaf6aa6710fdae756f1af90bc15c156738ca1182f0d5a9408d',
    'pr1142-native-declarative-v3/preflight/6C429830936744AE/result.json':
      'dfe12302bde197c0fc836d1a029cbd8c2954f013bac649638d2a5af109e0e389',
    'pr1142-native-declarative-v3/preflight/6C429830936744AE/sm12-baseline.json':
      'f3375540aca179749e3aeade9b9809638bd49ccbcd44bf886ae722f4e7016f01',
    'pr1142-native-declarative-v3/preflight/6C429830936744AE/sm12-suffix.jpg':
      'eeecab595761ee6628ced400a40becbfebe7725cb1a118c28e0a561f87aa0fe4',
    'pr1142-native-declarative-v3/preflight/6C429830936744AE/sm12-user.jpg':
      '796669c9a6ff7610b9f041cbbee2b7ce737b9d634176fad2162aa33f1e2a78dc',
    'pr1142-native-declarative-v3-recovery-v1/intent.json':
      '18b83ddd9969d15f8d5da78987c39c73abd7975bdd754125dca9ea3e58ec1293',
    'pr1142-native-declarative-v3-recovery-v1/attempt/manifest.json':
      '4226581dcfbe3078b0287744cf6ba9d23791d2ac0c34c06fbd3cab7420ea233f',
    'pr1142-native-declarative-v3-recovery-v1/attempt/result.json':
      '31f1bd4a81643f79adfdc6a19ca816e1aeb6a4eb855a59e3a18b2738a23e3130',
    'pr1142-native-declarative-v3-recovery-v1/prerequisites/sm12-baseline.json':
      'a864f3f05380d1e68ff82bf402a8895d86505275614ac0af55536ea032891ca8',
    'pr1142-native-declarative-v3-recovery-v1/prerequisites/sm12-suffix.jpg':
      'eeecab595761ee6628ced400a40becbfebe7725cb1a118c28e0a561f87aa0fe4',
    'pr1142-native-declarative-v3-recovery-v1/prerequisites/sm12-user.jpg':
      '796669c9a6ff7610b9f041cbbee2b7ce737b9d634176fad2162aa33f1e2a78dc',
    'pr1142-native-declarative-v3-recovery-post-20261103T010724/sm12-post.json':
      '07f955c9c2800b2f086e1d24921e1436373177f3ff0394ae56ef9ad76ca20cbb',
    'pr1142-native-declarative-v3-recovery-post-20261103T010724/sm12-suffix.jpg':
      'eeecab595761ee6628ced400a40becbfebe7725cb1a118c28e0a561f87aa0fe4',
    'pr1142-native-declarative-v3-recovery-post-20261103T010724/sm12-user.jpg':
      '796669c9a6ff7610b9f041cbbee2b7ce737b9d634176fad2162aa33f1e2a78dc',
    'pr1142-native-declarative-v3-recovery-audit.md':
      '8ddaf3eab883c2ceca028f0901f04ab016b389b27bb1dc56453868ad1850cf9f',
    'pr1142-native-declarative-v3-recovery-audit.json':
      'e1e81cf8686dfeeef5e34b19e83631284da079f3c71481827cc64dbcbc06bb13',
  },
  journals: [
    {
      path: 'pr1142-native-declarative-v1/run',
      count: 55,
      sha256: '2e371c10916b53ccaab44a02f40548f017104c970ece41bc76ca02880b765eaa',
    },
    {
      path: 'pr1142-native-declarative-recovery-v1/run',
      count: 29,
      sha256: '2ce05c4b706ac51f72a9a229fa26c39ce991295806ef462d70ee7af246195eab',
    },
    {
      path: 'pr1142-native-declarative-v2/attempt/run',
      count: 1,
      sha256: '1e1e736f9215cd702598455a405f3b9ec673a69f28753568964b19c4ac763d44',
    },
    {
      path: 'pr1142-native-declarative-v3/attempt/run',
      count: 95,
      sha256: '6ddb88daed1699b7c48f975144a056e476048fd1d2974aafbfac9fe44b9fb2b8',
    },
    {
      path: 'pr1142-native-declarative-v3-recovery-v1/attempt/run',
      count: 61,
      sha256: 'b6640d05f00a357705276095825a79d0abefd1011e494beda3f535818fb2ba5d',
    },
  ],
  absent: ['pr1142-native-declarative-v2/attempt/manifest.json'],
};
export const DECLARATIVE_V4_HISTORY = {
  v1: 'failed; separately recovered; both claims consumed',
  v2: 'failed before credentials and native mutation; claim consumed',
  v3: 'failed after one DDLS update; separately recovered; both claims consumed',
  recoveryRevision: '9c103ab74852d75db5f518e4d0f93e777d5cf8ca',
  evidence: declarativeV4HistoryEvidence,
} as const;

/** Explicit fixtures are for offline tests only; the fixed entry always calls this with no arguments. */
export function verifyDeclarativeV4History(
  parent = join(homedir(), '.local/state/arc1-qualification'),
  expected: DeclarativeHistoryEvidence = declarativeV4HistoryEvidence,
) {
  try {
    privateDirectory(parent);
    const resolve = (name: string) => {
      const segments = name.split('/');
      if (segments.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..')) throw new Error();
      for (let i = 1; i < segments.length; i++) privateDirectory(join(parent, ...segments.slice(0, i)));
      return join(parent, ...segments);
    };
    for (const [name, expectedHash] of Object.entries(expected.files))
      if (privateEvidence(resolve(name), name.endsWith('.jpg') ? 8 * 1024 * 1024 : 128 * 1024).sha256 !== expectedHash)
        throw new Error();
    for (const item of expected.journals) {
      if (!Number.isInteger(item.count) || item.count < 1 || item.count > 100) throw new Error();
      const directory = resolve(item.path);
      privateDirectory(directory);
      const names = Array.from({ length: item.count }, (_, i) => `${String(i + 1).padStart(5, '0')}.json`);
      if (JSON.stringify(readdirSync(directory).sort()) !== JSON.stringify(names)) throw new Error();
      const rows = names.map((name) => [name, privateEvidence(join(directory, name)).sha256]);
      if (createHash('sha256').update(JSON.stringify(rows)).digest('hex') !== item.sha256) throw new Error();
    }
    for (const name of expected.absent) if (lstatSync(resolve(name), { throwIfNoEntry: false })) throw new Error();
  } catch {
    throw new DeclarativeFailure('v4-history');
  }
}
