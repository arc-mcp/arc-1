import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '../../../src');

describe('xml-entities', () => {
  // Decode raw XML or ABAP Doc markup once at its parser boundary. abapGit also decodes a private
  // inspection copy for credential detection; that copy is never returned as diagnostic text.
  it('is imported only by XML boundaries and private credential inspection', () => {
    const importers = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => /['"][^'"]*\/xml-entities\.js['"]/.test(readFileSync(join(SRC, file), 'utf8')))
      .map((file) => file.replaceAll('\\', '/'))
      .sort();

    expect(importers).toEqual(['adt/abapgit.ts', 'adt/errors.ts', 'adt/fm-parameter-docs.ts', 'adt/xml-parser.ts']);
  });
});
