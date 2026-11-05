import { expect, it } from 'vitest';
import { jpegEvidenceSignature } from '../../../scripts/qualification/pr1142/native-declarative-v3-evidence.js';

// Marker-envelope fixtures; this validator deliberately does not decode entropy or interpret a screen.
const baseline = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex');
it.each([0xc0, 0xc2])('accepts bounded 8-bit frame marker %i and byte-stuffed scan data', (marker) => {
  const image = Buffer.from(baseline);
  image[3] = marker;
  expect(jpegEvidenceSignature(image)).toBe(true);
});
it('permits native application metadata without changing captured bytes', () => {
  const image = Buffer.concat([baseline.subarray(0, 2), Buffer.from('ffe1000645584946', 'hex'), baseline.subarray(2)]);
  const original = Buffer.from(image);
  expect(jpegEvidenceSignature(image)).toBe(true);
  expect(image).toEqual(original);
});
it.each([
  ['empty', Buffer.alloc(0)],
  ['signature only', Buffer.from('ffd8ffd9', 'hex')],
  ['truncated frame', baseline.subarray(0, 9)],
  ['missing EOI', baseline.subarray(0, -2)],
  ['trailing data', Buffer.concat([baseline, Buffer.from('trailing')])],
  ['missing SOF', Buffer.from(`ffd8ffda0008010100003f00${'11'.repeat(20)}ffd9`, 'hex')],
  ['segment beyond file', Buffer.from(`ffd8ffe1ffff${'00'.repeat(20)}ffd9`, 'hex')],
  ['short segment', Buffer.from(`ffd8ffe10001${'00'.repeat(20)}ffd9`, 'hex')],
  ['unsupported frame', Buffer.from(baseline.toString('hex').replace('ffc0', 'ffc3'), 'hex')],
  ['zero height', Buffer.from(baseline.toString('hex').replace('0800010001', '0800000001'), 'hex')],
  ['over allowance', Buffer.alloc(8 * 1024 * 1024 + 1)],
] as const)('refuses %s', (_name, image) => {
  expect(jpegEvidenceSignature(image)).toBe(false);
});
