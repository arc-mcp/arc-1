import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TextReadError } from '../../../src/adt/stored-text/errors.js';
import { findTextMatches, readClassicText, readClassicTextBatch } from '../../../src/adt/stored-text/reader.js';
import type { StoredTextHeader, StoredTextSource, TextDiscovery, TextKey } from '../../../src/adt/stored-text/types.js';

type GoldenCase = {
  id: string;
  key: TextKey;
  nativeReadText: {
    status: number;
    oldLineCounter: string;
    lines: Array<{ format: string; text: string }>;
  };
  header: StoredTextHeader | null;
  clusterBase64?: string;
};
type Golden = { release: string; cases: GoldenCase[] };
const load = (release: string): Golden =>
  JSON.parse(readFileSync(join(process.cwd(), `tests/fixtures/stxl/semantics-${release}.json`), 'utf8')) as Golden;
const goldens = ['758', '816'].map(load);
const keyId = (key: TextKey) => JSON.stringify([key.TDOBJECT, key.TDNAME, key.TDID, key.TDSPRAS]);

function fixtureSource(fixture: Golden): StoredTextSource {
  const headers = new Map<string, StoredTextHeader>();
  const clusters = new Map<string, Buffer>();
  for (const item of fixture.cases) {
    if (item.header) headers.set(keyId(item.header.key), item.header);
    if (item.clusterBase64) clusters.set(keyId(item.key), Buffer.from(item.clusterBase64, 'base64'));
  }
  return {
    async assertSupportedKey() {},
    async readHeader(key) {
      return headers.get(keyId(key));
    },
    async readCluster(key) {
      return clusters.get(keyId(key));
    },
    async discover(query: TextDiscovery) {
      const all = [...headers.values()].filter(
        (header) =>
          header.key.TDOBJECT === query.object &&
          header.key.TDNAME.startsWith(query.namePrefix) &&
          (!query.id || header.key.TDID === query.id) &&
          (!query.language || header.key.TDSPRAS === query.language),
      );
      const limit = query.limit ?? all.length;
      return { headers: all.slice(0, limit), more: all.length > limit };
    },
  };
}

for (const fixture of goldens) {
  describe(`STXL semantic goldens on SAP ${fixture.release}`, () => {
    const source = fixtureSource(fixture);
    const casesById = new Map(fixture.cases.map((item) => [item.id, item]));

    it('matches native READ_TEXT lines for every ITF success, including blank, empty, and references', async () => {
      for (const item of fixture.cases) {
        if (item.id === 'non-itf' || item.nativeReadText.status !== 0) continue;
        const actual = await readClassicText(source, item.key);
        expect(actual.lines, item.id).toEqual(item.nativeReadText.lines);
        expect(actual.lineCount, item.id).toBe(item.nativeReadText.lines.length);
        expect(actual.header.storedLineCount, item.id).toBe(Number(item.nativeReadText.oldLineCounter));
      }
    });

    it('preserves root headers and exact targets through one- and two-hop references', async () => {
      const normal = casesById.get('normal-en')!;
      const one = await readClassicText(source, casesById.get('reference-one')!.key);
      const two = await readClassicText(source, casesById.get('reference-two')!.key);
      expect(one.header.key).toEqual(casesById.get('reference-one')!.key);
      expect(one.resolvedKey).toEqual(normal.key);
      expect(one.referenceChain).toEqual([casesById.get('reference-one')!.key, normal.key]);
      expect(one.header.storedLineCount).toBe(0);
      expect(one.lines).toEqual(casesById.get('reference-one')!.nativeReadText.lines);
      expect(two.header.key).toEqual(casesById.get('reference-two')!.key);
      expect(two.resolvedKey).toEqual(normal.key);
      expect(two.referenceChain).toEqual([
        casesById.get('reference-two')!.key,
        casesById.get('reference-one')!.key,
        normal.key,
      ]);
      expect(two.lines).toEqual(casesById.get('reference-two')!.nativeReadText.lines);
    });

    it('distinguishes missing root headers from broken references and explicit non-ITF storage', async () => {
      for (const id of ['missing-key', 'missing-language', 'deleted-target', 'empty-save']) {
        await expect(readClassicText(source, casesById.get(id)!.key)).rejects.toMatchObject({
          code: 'NOT_FOUND',
        });
      }
      await expect(readClassicText(source, casesById.get('broken-reference')!.key)).rejects.toMatchObject({
        code: 'REFERENCE_ERROR',
      });
      const nativeNonItf = casesById.get('non-itf')!;
      expect(nativeNonItf.nativeReadText.status).toBe(0);
      expect(nativeNonItf.nativeReadText.lines).toHaveLength(1);
      await expect(readClassicText(source, nativeNonItf.key)).rejects.toMatchObject({ code: 'NON_ITF_TEXT' });
    });

    it('uses native status and OLD_LINE_COUNT as oracle metadata for all 13 requested keys', () => {
      expect(fixture.cases).toHaveLength(13);
      for (const item of fixture.cases) {
        expect(item.nativeReadText.status).toBe(item.id === 'broken-reference' ? 6 : item.header ? 0 : 4);
        if (item.header) expect(item.header.storedLineCount, item.id).toBe(Number(item.nativeReadText.oldLineCounter));
        else expect(item.nativeReadText.lines).toEqual([]);
      }
    });

    it('matches native lines in batch order and preserves a duplicate request', async () => {
      const inputs = [...fixture.cases.map((item) => item.key), casesById.get('normal-en')!.key];
      const actual = await readClassicTextBatch(source, inputs);
      expect(actual).toHaveLength(14);
      for (const [index, item] of fixture.cases.entries()) {
        const result = actual[index];
        if (item.id === 'non-itf') {
          expect(result).toMatchObject({ status: 'error', error: { code: 'NON_ITF_TEXT' } });
        } else if (item.nativeReadText.status === 0) {
          expect(result.status, item.id).toBe('ok');
          if (result.status === 'ok') expect(result.text.lines, item.id).toEqual(item.nativeReadText.lines);
        } else {
          expect(result).toMatchObject({
            status: 'error',
            error: { code: item.id === 'broken-reference' ? 'REFERENCE_ERROR' : 'NOT_FOUND' },
          });
        }
      }
      expect(actual[13]).toMatchObject({ index: 13, status: 'ok' });
      if (actual[0].status === 'ok' && actual[13].status === 'ok')
        expect(actual[13].text.lines).toEqual(casesById.get('normal-en')!.nativeReadText.lines);
    });

    it('searches literal phrases in ITF lines and reports a bounded result set', async () => {
      const matches = await readClassicTextBatch(source, [casesById.get('normal-en')!.key]);
      const phrase = findTextMatches(matches, 'Synthetic English second');
      expect(phrase.matches).toMatchObject([{ lineNumber: 2, format: '/', text: 'Synthetic English second' }]);
      expect(findTextMatches(matches, '*').matches).toEqual([]);
      expect(() => findTextMatches(matches, '')).toThrow(TextReadError);
    });
  });
}
