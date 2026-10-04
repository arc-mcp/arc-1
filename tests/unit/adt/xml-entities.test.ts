import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../../../src');

describe('xml-entities', () => {
  // Output decoding belongs to the two XML boundaries. abapGit additionally decodes a private
  // inspection copy for credential detection; that copy is never returned as diagnostic text.
  it('is imported only by XML boundaries and private credential inspection', () => {
    const importers = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => /['"][^'"]*\/xml-entities\.js['"]/.test(readFileSync(join(SRC, file), 'utf8')))
      .map((file) => file.replaceAll('\\', '/'))
      .sort();

    expect(importers).toEqual(['adt/abapgit.ts', 'adt/errors.ts', 'adt/xml-parser.ts']);
  });
});
