import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../../../src');

describe('xml-entities', () => {
  // The decoder is only safe on text that is still raw markup. Each of these two modules owns one
  // such boundary (parsed ADT responses, scanned SAP error bodies); a third importer would be
  // decoding a value one of them already decoded.
  it('is imported only by the two boundaries where raw markup becomes text', () => {
    const importers = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => /['"][^'"]*\/xml-entities\.js['"]/.test(readFileSync(join(SRC, file), 'utf8')))
      .map((file) => file.replaceAll('\\', '/'))
      .sort();

    expect(importers).toEqual(['adt/errors.ts', 'adt/xml-parser.ts']);
  });
});
