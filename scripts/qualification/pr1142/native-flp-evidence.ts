import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
/** Historical active native contract; proprietary payloads remain outside the repository. */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { privateEvidence } from './native-declarative-prerequisites.js';
import { FlpQualificationFailure } from './native-flp-fixed.js';
import { privateDirectory } from './native-lock-binding.js';
export const flpNativeEvidence = {
  ledger: 'pr1142-flp-native-delete-completion-evidence.json',
  ledgerHash: 'edcfa9086e44ee213c5c60cbe6886ce0a07e1b05a862d2345af66b6d8be8f075',
  assessment: 'pr1142-flp-native-delete-completion-assessment.md',
  assessmentHash: '55dc5fad68f346c00e34fa50600f9e2667998fec95a70cbc91d85965f8cb3719',
  metadataHash: 'ed97334444de153f4a24263237ba3c37a7ac4488dff99ec5aa5bfc62212364a7',
} as const;
// Original assessments are 0644 inside the owner-only review directory. Preserve their bytes/mode;
// do not silently rewrite historical evidence to satisfy the stricter new-receipt file policy.
function historicalReport(path: string) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid?.() || stat.mode & 0o022 || stat.size > 128 * 1024)
      throw new Error();
    const buffer = Buffer.alloc(stat.size + 1);
    let size = 0,
      count = 0;
    while (size < buffer.length && (count = readSync(fd, buffer, size, buffer.length - size, null))) size += count;
    if (size !== stat.size) throw new Error();
    const body = buffer.subarray(0, size);
    return { body, sha256: createHash('sha256').update(body).digest('hex') };
  } finally {
    closeSync(fd);
  }
}
export function verifyFlpNativeEvidence() {
  try {
    const root = join(homedir(), '.local/state/arc1-review');
    privateDirectory(root);
    const ledger = historicalReport(join(root, flpNativeEvidence.ledger));
    if (
      ledger.sha256 !== flpNativeEvidence.ledgerHash ||
      historicalReport(join(root, flpNativeEvidence.assessment)).sha256 !== flpNativeEvidence.assessmentHash
    )
      throw new Error();
    const packets = JSON.parse(ledger.body.toString('utf8')) as {
      packet: string;
      manifestSha256: string;
      observations: { file: string; bytes: number; sha256: string }[];
    }[];
    for (const packet of packets) {
      if (privateEvidence(join(root, packet.packet, 'manifest.json')).sha256 !== packet.manifestSha256)
        throw new Error();
      for (const item of packet.observations) {
        const payload = privateEvidence(join(root, packet.packet, item.file), 2 * 1024 * 1024);
        if (payload.body.length !== item.bytes || payload.sha256 !== item.sha256) throw new Error();
      }
    }
  } catch {
    throw new FlpQualificationFailure('binding');
  }
}
