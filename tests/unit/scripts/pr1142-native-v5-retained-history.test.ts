import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { retainedHash } from '../../../scripts/qualification/pr1142/native-v5-retained-fixed.js';
import { verifyRetainedHistory } from '../../../scripts/qualification/pr1142/native-v5-retained-history.js';

let temporary: string, digest: string, older: ReturnType<typeof vi.fn<() => void>>;
const original = 'arc1-qualification/pr1142-native-declarative-v5',
  packet = 'arc1-review/pr1142-native-v5-execution-20261103',
  ledger = 'arc1-review/pr1142-native-v5-retained-assessment/continuation-inputs.json';
function write(name: string, body: string) {
  const p = join(temporary, name);
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, body, { mode: 0o600 });
  return retainedHash(body);
}
beforeEach(() => {
  vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => {
    throw new Error('OFFLINE_SOCKET_GUARD');
  });
  temporary = mkdtempSync(join(tmpdir(), 'retained-history-'));
  older = vi.fn();
  const originalFiles: Record<string, string> = {},
    inspectionRows: Record<string, string> = {},
    postFiles: Record<string, string> = {};
  for (let i = 0; i < 980; i++) {
    const name = `run/${i}.json`;
    originalFiles[name] = write(`${original}/${name}`, '{"synthetic":true}');
  }
  for (let i = 1; i <= 18; i++) {
    const name = `${String(i).padStart(5, '0')}.json`;
    inspectionRows[name] = write(`${packet}/retained-inspection/${name}`, '{"synthetic":true}');
  }
  for (const name of [
    'controls.json',
    'invalid-observation.json',
    'sm12-suffix.jpg',
    'sm12-user-session-timeout.jpg',
    'sm12-user.jpg',
  ])
    postFiles[name] = write(`${packet}/post-failure/${name}`, 'synthetic');
  const inspectionManifest = write(`${packet}/retained-inspection/manifest.json`, '{}'),
    inspectionResult = write(`${packet}/retained-inspection/result.json`, '{}'),
    collectorHash = write(`${packet}/inspect-retained.mjs`, '// fixture');
  digest = write(
    ledger,
    JSON.stringify({ originalFiles, inspectionRows, inspectionManifest, inspectionResult, postFiles, collectorHash }),
  );
});
afterEach(() => {
  expect(Socket.prototype.connect).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  rmSync(temporary, { recursive: true, force: true });
});
it('verifies a complete immutable failed-root ledger and its precise inspection/post bindings', () => {
  const before = readFileSync(join(temporary, ledger));
  verifyRetainedHistory(temporary, digest, older);
  expect(older).toHaveBeenCalledOnce();
  expect(readFileSync(join(temporary, ledger))).toEqual(before);
});
it.each(['original', 'inspection', 'post', 'collector', 'ledger', 'extra', 'older'])(
  'refuses changed %s evidence',
  (fault) => {
    if (fault === 'original') write(`${original}/run/500.json`, 'changed');
    if (fault === 'inspection') write(`${packet}/retained-inspection/00018.json`, 'changed');
    if (fault === 'post') write(`${packet}/post-failure/invalid-observation.json`, 'changed');
    if (fault === 'collector') write(`${packet}/inspect-retained.mjs`, 'changed');
    if (fault === 'ledger') write(ledger, '{}');
    if (fault === 'extra') write(`${original}/extra.json`, 'changed');
    if (fault === 'older')
      older.mockImplementation(() => {
        throw new Error('older binding drift');
      });
    expect(() => verifyRetainedHistory(temporary, digest, older)).toThrow();
  },
);
