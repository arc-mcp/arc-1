import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, decodeStxl } from '../../../src/adt/stored-text/decoder.js';
import { TextReadError } from '../../../src/adt/stored-text/errors.js';

const fixture = JSON.parse(readFileSync(new URL('../../fixtures/stxl/sap-758.json', import.meta.url), 'utf8')) as {
  cases: Array<{ plain?: string; compressed: string }>;
};
const plain = Buffer.from(fixture.cases[2].plain!, 'base64');

describe('STXL decoder error contract', () => {
  it('preserves the recognizable message and exposes a stable category', () => {
    const cause = new Error('local cause');
    const error = new TextReadError('NOT_FOUND', 'stored text not found', { cause });
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('TextReadError');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('STXL: stored text not found');
    expect(error.cause).toBe(cause);
    expect(error.message).not.toContain(cause.message);
  });

  it('distinguishes unqualified profiles from corrupt framing', async () => {
    const unsupported = Buffer.from(plain);
    unsupported[1] = 5;
    await expect(decodeStxl(unsupported)).rejects.toMatchObject({
      name: 'TextReadError',
      code: 'UNSUPPORTED_PROFILE',
      message: expect.stringContaining('STXL: unverified container'),
    });
    await expect(decodeStxl(plain.subarray(0, 12))).rejects.toMatchObject({ code: 'CORRUPT_CLUSTER' });
    await expect(decodeStxl(Buffer.concat([plain, Buffer.alloc(7902)]))).rejects.toMatchObject({
      code: 'CORRUPT_CLUSTER',
      message: expect.stringContaining('after container end'),
    });
  });

  it('categorizes caller ceilings and declared expansion limits', async () => {
    await expect(decodeStxl(plain, { ...DEFAULT_LIMITS, maxInputBytes: 16 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    });
    await expect(decodeStxl(plain, { ...DEFAULT_LIMITS, maxOutputBytes: 16 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    });
    await expect(decodeStxl(plain, { ...DEFAULT_LIMITS, maxLines: 0 })).rejects.toMatchObject({
      code: 'LIMIT_EXCEEDED',
    });
    const compressed = Buffer.from(fixture.cases[2].compressed, 'base64');
    compressed.writeUInt32LE(DEFAULT_LIMITS.maxOutputBytes + 1, 16);
    await expect(decodeStxl(compressed)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });
});
