import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  history: {} as any,
  revision: 'a'.repeat(40),
  dirty: false,
  badFile: '',
  historyBroken: false,
  sourceReads: [] as string[],
}));
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn((_cmd: string, args: string[], options: { cwd: string }) => {
    if (args.includes('--show-toplevel')) return options.cwd.replace(/\/$/, '');
    if (args.includes('HEAD') && args[0] === 'rev-parse') return state.revision;
    if (args[0] === 'diff' && state.dirty) throw new Error('dirty');
    return '';
  }),
}));
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  realpathSync: (path: string) => path.replace(/\/$/, ''),
  readdirSync: (_path: string, options: { recursive: boolean }) => (options.recursive ? ['auth.js'] : ['fixed.mjs']),
  lstatSync: (path: string) => ({
    isFile: () => true,
    isSymbolicLink: () => path === state.badFile,
    uid: process.getuid!(),
    mode: 0o100600,
    size: (state.files.get(path) ?? Buffer.from('x')).length,
  }),
  readFileSync: (path: string, encoding?: string) => {
    state.sourceReads.push(path);
    let bytes = state.files.get(path);
    if (!bytes && path.endsWith('/fixed.mjs')) bytes = Buffer.from('fixed source');
    if (!bytes && path.endsWith('/auth.js')) bytes = Buffer.from('fixed auth');
    if (!bytes && path.endsWith('/package-lock.json')) bytes = Buffer.from('fixed lock');
    if (!bytes) throw new Error(`unexpected read: ${path}`);
    return encoding ? bytes.toString('utf8') : bytes;
  },
}));
vi.mock('../../../scripts/qualification/pr1142/current-retained-history.mjs', async (original) => ({
  ...(await original<typeof import('../../../scripts/qualification/pr1142/current-retained-history.mjs')>()),
  readFixedRetainedHistory: () => {
    if (state.historyBroken) throw new Error('history changed');
    return state.history;
  },
}));

import {
  retainedDescriptor,
  retainedMarker,
  retainedRoot,
} from '../../../scripts/qualification/pr1142/current-retained-history.mjs';

vi.mock('../../../scripts/qualification/pr1142/current-text-tail-history.mjs', async (original) => ({
  ...(await original<typeof import('../../../scripts/qualification/pr1142/current-text-tail-history.mjs')>()),
  readFixedTextTailHistory: () => {
    if (state.historyBroken) throw new Error('history changed');
    return state.history;
  },
}));

import { verifyRetainedSend } from '../../../scripts/qualification/pr1142/current-retained-send-proof.mjs';
import { textTailDescriptor, textTailRoot } from '../../../scripts/qualification/pr1142/current-text-tail-history.mjs';
import { sha } from '../../../scripts/qualification/pr1142/current-workflow-contract.mjs';

beforeEach(() => {
  state.files.clear();
  state.sourceReads = [];
  state.revision = 'a'.repeat(40);
  state.dirty = false;
  state.badFile = '';
  state.historyBroken = false;
});
function fixture(root = retainedRoot) {
  const deployment = { sourceRevision: state.revision },
    manifest = {
      marker: retainedMarker,
      fixtures: [{ name: 'fixed owned fixture' }],
      actors: [{ label: 'writerA' }],
      target: 'PR1142/001',
      nativeUrl: 'https://a4h.marianzeis.de',
      client: '001',
      bindings: {
        recording: { request: 'A4HK906605', task: 'A4HK906606' },
        deployment: { receiptSha256: sha(deployment) },
      },
    };
  const run = {
    runId: 'fresh-run',
    sourceRevision: state.revision,
    retained: root === textTailRoot ? textTailDescriptor : retainedDescriptor,
    harnessSha256: sha({ 'fixed.mjs': sha('fixed source') }),
    authModulesSha256: sha({ 'auth.js': sha('fixed auth') }),
    packageLockSha256: sha('fixed lock'),
  };
  const jpeg = Buffer.from([255, 216, 255, 217]);
  const receipt = {
    images: ['sm12-suffix.jpg', 'sm12-writerA.jpg', 'sm12-writerB.jpg'].map((file) => ({ file, sha256: sha(jpeg) })),
  };
  const baseline = { receipt, sha256: sha(receipt), freshUntil: Date.now() + 300000 };
  state.history = { manifest: structuredClone(manifest) };
  for (const [name, value] of Object.entries({
    'run-manifest.json': run,
    'fixture-manifest.json': manifest,
    'deployment-receipt.json': deployment,
    'current-baseline.json': receipt,
  }))
    state.files.set(`${root}/${name}`, Buffer.from(JSON.stringify(value)));
  for (const image of receipt.images) state.files.set(`${root}/${image.file}`, jpeg);
  return { root, run, manifest, baseline, config: { root } };
}
describe.each([retainedRoot, textTailRoot])(
  'actual synchronous retained send proof at %s with isolated filesystem and Git',
  (root) => {
    it('checks Git, harness, auth closure, lockfile, current inputs, all images and original history', () => {
      const f = fixture(root);
      expect(() => verifyRetainedSend(f)).not.toThrow();
      expect(state.sourceReads.filter((p) => p.endsWith('.jpg'))).toHaveLength(3);
      expect(state.sourceReads.some((p) => p.endsWith('/auth.js'))).toBe(true);
      expect(state.sourceReads.some((p) => p.endsWith('/fixed.mjs'))).toBe(true);
      expect(state.sourceReads.some((p) => /\.env|credential|fifo/.test(p))).toBe(false);
    });
    it.each([
      'revision',
      'dirty',
      'harness',
      'auth',
      'lock',
      'run',
      'manifest',
      'deployment',
      'baseline',
      'image',
      'symlink',
      'history',
      'root',
    ])('refuses changed %s before returning dispatch authority', (change) => {
      const f = fixture(root);
      if (change === 'revision') state.revision = 'b'.repeat(40);
      if (change === 'dirty') state.dirty = true;
      if (change === 'harness') f.run.harnessSha256 = 'c'.repeat(64);
      if (change === 'auth') f.run.authModulesSha256 = 'c'.repeat(64);
      if (change === 'lock') f.run.packageLockSha256 = 'c'.repeat(64);
      if (change === 'run')
        state.files.set(`${root}/run-manifest.json`, Buffer.from(JSON.stringify({ ...f.run, runId: 'other' })));
      if (change === 'manifest') state.files.set(`${root}/fixture-manifest.json`, Buffer.from('{}'));
      if (change === 'deployment') state.files.set(`${root}/deployment-receipt.json`, Buffer.from('{}'));
      if (change === 'baseline') state.files.set(`${root}/current-baseline.json`, Buffer.from('{}'));
      if (change === 'image') state.files.set(`${root}/sm12-writerB.jpg`, Buffer.from('changed'));
      if (change === 'symlink') state.badFile = `${root}/sm12-writerA.jpg`;
      if (change === 'history') state.historyBroken = true;
      if (change === 'root') f.root += '-other';
      expect(() => verifyRetainedSend(f)).toThrow();
    });
  },
);
