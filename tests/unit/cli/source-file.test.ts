import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';

const directory = mkdtempSync(join(tmpdir(), 'arc1-source-'));
const command = fileURLToPath(new URL('../../../bin/arc1-source.js', import.meta.url));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
function run(args: string[], input?: string) {
  return spawnSync(process.execPath, [command, ...args], { input, encoding: 'utf8', maxBuffer: 400_000 });
}
function read(content: string | Buffer) {
  const path = join(directory, 'source.abap');
  writeFileSync(path, content);
  return run(['read', path]);
}
it('preserves Unicode, entities, CRLF and final-newline differences through both commands', () => {
  const source = 'REPORT ztest.\r\n* < > -> & &amp; " quotes ü 日本語\r\nWRITE `$(ignored)`.';
  const result = read(source);
  expect(result.status, result.stderr).toBe(0);
  const envelope = JSON.parse(result.stdout);
  expect(envelope).toEqual({
    source,
    sourceBytes: Buffer.byteLength(source),
    sourceSha256: createHash('sha256').update(source).digest('hex'),
  });
  const verified = run(['verify'], result.stdout);
  expect(verified.status, verified.stderr).toBe(0);
  expect(JSON.parse(verified.stdout)).toEqual({
    verified: true,
    sourceBytes: envelope.sourceBytes,
    sourceSha256: envelope.sourceSha256,
  });
  expect(verified.stdout).not.toContain('REPORT');
});
it('refuses valid-JSON truncation, same-length corruption, wrong counts and invalid Unicode', () => {
  const envelope = JSON.parse(read('REPORT ztest.\n').stdout);
  for (const changed of [
    { ...envelope, source: 'REPORT' },
    { ...envelope, source: 'REPORT xtest.\n' },
    { ...envelope, sourceBytes: 1 },
    { ...envelope, source: '\ud800' },
  ]) {
    const result = run(['verify'], JSON.stringify(changed));
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
  }
});
it('bounds source bytes and encoded envelope bytes independently', () => {
  expect(read('x'.repeat(200_000)).status).toBe(0);
  expect(read('ü'.repeat(100_001)).status).toBe(1);
  expect(read('\t'.repeat(160_000)).status).toBe(1);
  expect(run(['verify'], ' '.repeat(300_001)).status).toBe(1);
});
it('rejects empty, BOM, NUL, malformed UTF-8 and non-file inputs', () => {
  for (const content of ['', '\ufeffREPORT ztest.', 'a\0b', Buffer.from([0xc3, 0x28])]) {
    const result = read(content);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
  }
  expect(run(['read', directory]).status).toBe(1);
  expect(run(['read', join(directory, 'absent')]).status).toBe(1);
});
it('refuses malformed envelopes and ambiguous command arguments', () => {
  for (const input of ['{', 'null', '[]', '{}', '{"source":"text"}']) expect(run(['verify'], input).status).toBe(1);
  for (const args of [[], ['read'], ['verify', 'file'], ['read', 'file', 'extra']]) expect(run(args).status).toBe(1);
});
it('refuses a valid envelope containing a leading BOM', () => {
  const source = '\ufeffREPORT ztest.';
  const result = run(
    ['verify'],
    JSON.stringify({
      source,
      sourceBytes: Buffer.byteLength(source),
      sourceSha256: createHash('sha256').update(source).digest('hex'),
    }),
  );
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('UTF-8 without BOM');
  expect(result.stdout).toBe('');
});
