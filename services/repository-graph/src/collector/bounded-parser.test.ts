import { expect, it } from 'vitest';
import { extractBounded } from './bounded-parser.js';
import { SourceParseError } from './extractor.js';

const object = { systemKey: 'TEST', name: 'ZTEST', type: 'PROG', source: 'REPORT ztest. DATA x TYPE zfoo.' };
it('returns metadata only from an isolated parser', async () => {
  const result = await extractBounded(object, []);
  expect(result.observations.some((edge) => edge.target.name === 'ZFOO')).toBe(true);
  expect(JSON.stringify(result)).not.toContain(object.source);
});
it('preserves structured coverage reasons but suppresses parser exception text', async () => {
  await expect(extractBounded({ ...object, source: '???' }, [])).rejects.toBeInstanceOf(SourceParseError);
});
it('terminates workers on deadline and refuses oversized inputs before starting', async () => {
  await expect(extractBounded(object, [], 1)).rejects.toThrow('parser_timeout');
  await expect(extractBounded({ ...object, source: 'x'.repeat(1_048_577) }, [])).rejects.toThrow('source_too_large');
});
