import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import {
  claimDirectory,
  durableRecord,
  journal,
  nativeLockBinding,
} from '../../../scripts/qualification/pr1142/native-lock-binding.js';
import { createPassiveObservationChannel } from '../../../scripts/qualification/pr1142/native-observation-channel.js';

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
it('refuses binding when the supplied reviewed revision cannot be established', async () => {
  await expect(
    nativeLockBinding(
      '0'.repeat(40),
      new URL('../../../scripts/qualification/pr1142/native-lock-workflow.ts', import.meta.url),
    ),
  ).rejects.toThrow();
});
it('rejects a copied ignored entry that inherits the real checkout HEAD', async () => {
  const cache = fileURLToPath(new URL('../../../node_modules/.cache/', import.meta.url));
  mkdirSync(cache, { recursive: true });
  const root = mkdtempSync(join(cache, 'passive-copy-'));
  temporary.push(root);
  const folder = join(root, 'scripts/qualification/pr1142');
  mkdirSync(folder, { recursive: true });
  const entry = join(folder, 'native-lock-workflow.ts');
  writeFileSync(entry, '// copied entry\n');
  await expect(nativeLockBinding('0'.repeat(40), pathToFileURL(entry))).rejects.toMatchObject({
    code: 'REAL_GIT_WORKSPACE_ROOT_REQUIRED',
  });
});
it('claims a fixed run and each journal phase exactly once, retaining exclusive private receipts', () => {
  const root = mkdtempSync(join(tmpdir(), 'arc1-observation-'));
  temporary.push(root);
  const run = join(root, 'fixed-run');
  claimDirectory(run);
  expect(() => claimDirectory(run)).toThrow();
  const phase = join(run, 'observe'),
    record = journal(phase);
  record({ step: 'locked' });
  record({ step: 'group-default' });
  expect(() => journal(phase)).toThrow();
  expect(JSON.parse(readFileSync(join(phase, '00001.json'), 'utf8')).value).toEqual({ step: 'locked' });
  expect(statSync(join(phase, '00001.json')).mode & 0o077).toBe(0);
  expect(() => durableRecord(join(phase, '00001.json'), { changed: true })).toThrow();
  expect(() => durableRecord(join(phase, 'invalid.json'), undefined)).toThrow();
});
it('accepts only the current prompt and has no queue of future acknowledgements', async () => {
  const input = new PassThrough(),
    controller = new AbortController();
  const prompts: unknown[] = [];
  const channel = createPassiveObservationChannel(input, controller, (prompt) => prompts.push(prompt));
  const pending = channel.observe({ step: 'locked', resource: 'OWNED', signal: controller.signal });
  input.write('{"step":"locked","observation":"present"}\n');
  await expect(pending).resolves.toBe('present');
  expect(prompts).toEqual([{ step: 'locked', resource: 'OWNED' }]);
  input.write('{"step":"group-default","observation":"present"}\n');
  expect(controller.signal.aborted).toBe(true);
  await expect(
    channel.observe({ step: 'group-default', resource: 'OWNED', signal: controller.signal }),
  ).rejects.toThrow();
  channel.close();
  input.destroy();
});
it.each([
  '{"step":"stale","observation":"present"}',
  '{"step":"locked","observation":"present","extra":true}',
  '{"step":"locked","observation":"yes"}',
  'not JSON',
  'x'.repeat(5000),
])('cancels on malformed, stale, extra or oversized control input', async (line) => {
  const input = new PassThrough(),
    controller = new AbortController();
  const channel = createPassiveObservationChannel(input, controller, () => {});
  const pending = channel.observe({ step: 'locked', resource: 'OWNED', signal: controller.signal });
  const rejected = expect(pending).rejects.toThrow();
  input.write(`${line}\n`);
  await rejected;
  expect(controller.signal.aborted).toBe(true);
  channel.close();
  input.destroy();
});
it.each(['abort', 'end', 'error'] as const)('unblocks a pending prompt on %s', async (scenario) => {
  const input = new PassThrough(),
    controller = new AbortController();
  const channel = createPassiveObservationChannel(input, controller, () => {});
  const pending = channel.observe({ step: 'locked', resource: 'OWNED', signal: controller.signal });
  const rejected = expect(pending).rejects.toThrow();
  if (scenario === 'abort') controller.abort();
  else if (scenario === 'end') input.end();
  else input.emit('error', new Error('Fixture stream error'));
  await rejected;
  channel.close();
  input.destroy();
});
