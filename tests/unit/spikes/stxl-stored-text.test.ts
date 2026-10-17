import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { TextReadError } from '../../../src/adt/stored-text/errors.js';
import {
  type ClassicTextBatchItem,
  findTextMatches,
  readClassicText,
  readClassicTextBatch,
} from '../../../src/adt/stored-text/reader.js';
import type { StoredTextHeader, StoredTextSource, TextKey } from '../../../src/adt/stored-text/types.js';

type Fixture = { cases: Array<{ name: string; compressed: string; plain?: string; lines: number }> };
const fixture = JSON.parse(
  readFileSync(new URL('../../fixtures/stxl/sap-758.json', import.meta.url), 'utf8'),
) as Fixture;
const oneLine = Buffer.from(fixture.cases[2].compressed, 'base64');
const emptyText = Buffer.from(fixture.cases[0].compressed, 'base64');
const blankLine = Buffer.from(fixture.cases[1].compressed, 'base64');
const commandText = Buffer.from(fixture.cases[3].compressed, 'base64');
const manyLines = Buffer.from(fixture.cases[8].compressed, 'base64');

const key: TextKey = { TDOBJECT: 'TEXT', TDNAME: 'Z_TEST', TDID: 'ST', TDSPRAS: 'E' };
const keyId = (value: TextKey) => JSON.stringify(value);
const textKey = (name: string): TextKey => ({ ...key, TDNAME: name });

function header(overrides: Partial<StoredTextHeader> = {}, textKeyArg: TextKey = key): StoredTextHeader {
  return {
    key: textKeyArg,
    title: 'Test text',
    textType: '',
    storedLineCount: 1,
    version: 1,
    modifiedDate: '20261017',
    modifiedTime: '120000',
    legacyReference: false,
    revision: 'revision-1',
    ...overrides,
  };
}

function makeSource(
  options: {
    headers?: Map<string, StoredTextHeader>;
    clusters?: Map<string, Buffer | undefined>;
    assertSupportedKey?: StoredTextSource['assertSupportedKey'];
  } = {},
) {
  const headers = options.headers ?? new Map([[keyId(key), header()]]);
  const clusters = options.clusters ?? new Map([[keyId(key), oneLine]]);
  const source: StoredTextSource = {
    assertSupportedKey: options.assertSupportedKey ?? vi.fn(async () => {}),
    readHeader: vi.fn(async (requested) => headers.get(keyId(requested))),
    readCluster: vi.fn(async (requested) => clusters.get(keyId(requested))),
    discover: vi.fn(async () => ({ headers: [], more: false })),
  };
  return source;
}

describe('classic stored text semantics', () => {
  it('normalizes trailing field padding while retaining leading and internal key spaces', async () => {
    const paddedKey = textKey('  MAT  A   ');
    const normalizedKey = textKey('  MAT  A');
    const source = makeSource({
      headers: new Map([[keyId(normalizedKey), header({ key: normalizedKey }, normalizedKey)]]),
      clusters: new Map([[keyId(normalizedKey), oneLine]]),
    });

    const result = await readClassicText(source, paddedKey);

    expect(result.requestedKey).toEqual(normalizedKey);
    expect(source.assertSupportedKey).toHaveBeenCalledWith(normalizedKey);
    expect(source.readHeader).toHaveBeenCalledWith(normalizedKey);
    expect(result.lines).toEqual([{ format: '*', text: 'Hello world!' }]);
  });

  it('rejects ISO language tags instead of truncating them to SAP language keys', async () => {
    const source = makeSource();
    await expect(readClassicText(source, { ...key, TDSPRAS: 'EN' })).rejects.toMatchObject({ code: 'INVALID_KEY' });
    expect(source.assertSupportedKey).not.toHaveBeenCalled();
    expect(source.readHeader).not.toHaveBeenCalled();
  });

  it('distinguishes an absent root header from a broken reference target', async () => {
    const missingRoot = makeSource({ headers: new Map() });
    await expect(readClassicText(missingRoot, key)).rejects.toMatchObject({ code: 'NOT_FOUND' });

    const target = textKey('TARGET');
    const brokenReference = makeSource({
      headers: new Map([[keyId(key), header({ reference: target }, key)]]),
      clusters: new Map(),
    });
    await expect(readClassicText(brokenReference, key)).rejects.toMatchObject({ code: 'REFERENCE_ERROR' });
  });

  it('returns a header-only empty text successfully and distinguishes it from an empty export', async () => {
    const noCluster = makeSource({ clusters: new Map([[keyId(key), undefined]]) });
    const headerOnly = await readClassicText(noCluster, key);
    expect(headerOnly.lines).toEqual([]);
    expect(headerOnly.storage.clusterPresent).toBe(false);

    const zeroLineExport = makeSource({ clusters: new Map([[keyId(key), emptyText]]) });
    const exportedEmpty = await readClassicText(zeroLineExport, key);
    expect(exportedEmpty.lines).toEqual([]);
    expect(exportedEmpty.storage.clusterPresent).toBe(true);

    const oneBlankLine = makeSource({
      headers: new Map([[keyId(key), header({ storedLineCount: 1 })]]),
      clusters: new Map([[keyId(key), blankLine]]),
    });
    const blank = await readClassicText(oneBlankLine, key);
    expect(blank.lines).toEqual([{ format: '', text: '' }]);
    expect(blank.lineCount).toBe(1);
  });

  it('resolves a one-hop reference while retaining the root header and requested language', async () => {
    const target = textKey('ONE_HOP');
    const rootHeader = header({ reference: target, title: 'Root metadata' }, key);
    const targetHeader = header({ title: 'Target metadata' }, target);
    const source = makeSource({
      headers: new Map([
        [keyId(key), rootHeader],
        [keyId(target), targetHeader],
      ]),
      clusters: new Map([[keyId(target), oneLine]]),
    });

    const result = await readClassicText(source, key);

    expect(result.header).toEqual(rootHeader);
    expect(result.requestedKey).toEqual(key);
    expect(result.resolvedKey).toEqual(target);
    expect(result.referenceChain).toEqual([key, target]);
    expect(result.header.key.TDSPRAS).toBe('E');
  });

  it('resolves a two-hop reference and reads only the final target cluster', async () => {
    const middle = textKey('MIDDLE');
    const target = textKey('FINAL');
    const source = makeSource({
      headers: new Map([
        [keyId(key), header({ reference: middle }, key)],
        [keyId(middle), header({ reference: target }, middle)],
        [keyId(target), header({}, target)],
      ]),
      clusters: new Map([[keyId(target), oneLine]]),
    });

    const result = await readClassicText(source, key);

    expect(result.referenceChain).toEqual([key, middle, target]);
    expect(result.resolvedKey).toEqual(target);
    expect(result.header.key).toEqual(key);
    expect(result.requestedKey).toEqual(key);
    expect(source.readCluster).toHaveBeenCalledTimes(2);
    expect(source.readCluster).toHaveBeenNthCalledWith(1, target);
    expect(source.readCluster).toHaveBeenNthCalledWith(2, target);
  });

  it('rejects cross-language references instead of silently changing the requested language', async () => {
    const target = { ...textKey('GERMAN'), TDSPRAS: 'D' };
    const source = makeSource({
      headers: new Map([[keyId(key), header({ reference: target }, key)]]),
      clusters: new Map(),
    });

    await expect(readClassicText(source, key)).rejects.toMatchObject({ code: 'REFERENCE_ERROR' });
    expect(source.readCluster).not.toHaveBeenCalled();
  });

  it('detects reference cycles and enforces the reference hop bound', async () => {
    const cycleKey = textKey('CYCLE');
    const cycle = makeSource({
      headers: new Map([
        [keyId(key), header({ reference: cycleKey }, key)],
        [keyId(cycleKey), header({ reference: key }, cycleKey)],
      ]),
      clusters: new Map(),
    });
    await expect(readClassicText(cycle, key)).rejects.toMatchObject({ code: 'REFERENCE_CYCLE' });

    const chain = new Map<string, StoredTextHeader>();
    for (let index = 0; index < 10; index++) {
      const current = textKey(`HOP_${index}`);
      const next = textKey(`HOP_${index + 1}`);
      chain.set(keyId(current), header({ reference: next }, current));
    }
    const limited = makeSource({ headers: chain, clusters: new Map() });
    await expect(readClassicText(limited, textKey('HOP_0'))).rejects.toMatchObject({ code: 'REFERENCE_LIMIT' });
  });

  it('rejects legacy references and non-ITF headers before reading cluster bytes', async () => {
    for (const [overrides, code] of [
      [{ legacyReference: true }, 'UNSUPPORTED_PROFILE'],
      [{ textType: 'RTF' }, 'NON_ITF_TEXT'],
    ] as const) {
      const source = makeSource({ headers: new Map([[keyId(key), header(overrides, key)]]) });
      await expect(readClassicText(source, key)).rejects.toMatchObject({ code });
      expect(source.readCluster).not.toHaveBeenCalled();
    }
  });

  it('detects header and payload changes during the read', async () => {
    const initial = header();
    const changed = header({ revision: 'revision-2' });
    const changedHeaderSource = makeSource();
    vi.mocked(changedHeaderSource.readHeader).mockResolvedValueOnce(initial).mockResolvedValueOnce(changed);
    await expect(readClassicText(changedHeaderSource, key)).rejects.toMatchObject({ code: 'INCONSISTENT_READ' });

    const changedPayloadSource = makeSource();
    vi.mocked(changedPayloadSource.readCluster)
      .mockResolvedValueOnce(oneLine)
      .mockResolvedValueOnce(Buffer.from(oneLine).reverse());
    await expect(readClassicText(changedPayloadSource, key)).rejects.toMatchObject({ code: 'INCONSISTENT_READ' });
  });

  it('reports stored line-count differences as an advisory warning', async () => {
    const source = makeSource({ headers: new Map([[keyId(key), header({ storedLineCount: 99 }, key)]]) });
    const result = await readClassicText(source, key);
    expect(result.lineCount).toBe(1);
    expect(result.warnings).toContain('STORED_LINE_COUNT_DIFFERS');
  });
});

describe('classic stored text batches and bounded phrase search', () => {
  it('preserves batch input order and reads duplicate exact keys only once', async () => {
    const other = textKey('OTHER');
    const source = makeSource({
      headers: new Map([
        [keyId(key), header({}, key)],
        [keyId(other), header({}, other)],
      ]),
      clusters: new Map([
        [keyId(key), oneLine],
        [keyId(other), oneLine],
      ]),
    });

    const results = await readClassicTextBatch(source, [key, other, key]);

    expect(results.map((item) => item.index)).toEqual([0, 1, 2]);
    expect(results.map((item) => (item.status === 'ok' ? item.text.requestedKey.TDNAME : 'error'))).toEqual([
      'Z_TEST',
      'OTHER',
      'Z_TEST',
    ]);
    expect(source.readHeader).toHaveBeenCalledTimes(4);
  });

  it('returns semantic errors per item but propagates infrastructure and budget errors', async () => {
    const source = makeSource({ headers: new Map() });
    const mixed = await readClassicTextBatch(source, [key, { ...key, TDNAME: 'MISSING' }]);
    expect(mixed.map((item) => item.status)).toEqual(['error', 'error']);
    expect(mixed.map((item) => item.status === 'error' && item.error.code)).toEqual(['NOT_FOUND', 'NOT_FOUND']);

    const outage = makeSource({
      assertSupportedKey: vi.fn(async () => {
        throw new Error('source unavailable');
      }),
    });
    await expect(readClassicTextBatch(outage, [key])).rejects.toThrow('source unavailable');

    const budgetFailure = makeSource({
      assertSupportedKey: vi.fn(async () => {
        throw new TextReadError('LIMIT_EXCEEDED', 'source budget exhausted');
      }),
    });
    await expect(readClassicTextBatch(budgetFailure, [key])).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('enforces batch item and cumulative decoded-line limits', async () => {
    const source = makeSource();
    const tooMany = Array.from({ length: 26 }, (_, index) => textKey(`KEY_${index}`));
    await expect(readClassicTextBatch(source, tooMany)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });

    const largeHeaders = new Map<string, StoredTextHeader>();
    const largeClusters = new Map<string, Buffer | undefined>();
    const largeInputs = Array.from({ length: 6 }, (_, index) => {
      const largeKey = textKey(`LARGE_${index}`);
      largeHeaders.set(keyId(largeKey), header({ key: largeKey, storedLineCount: 2000 }, largeKey));
      largeClusters.set(keyId(largeKey), manyLines);
      return largeKey;
    });
    const large = makeSource({ headers: largeHeaders, clusters: largeClusters });
    await expect(readClassicTextBatch(large, largeInputs)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('enforces the cumulative serialized batch output budget', async () => {
    const headers = new Map<string, StoredTextHeader>();
    const clusters = new Map<string, Buffer | undefined>();
    const inputs = Array.from({ length: 25 }, (_, index) => {
      const itemKey = textKey(`BULK_${index}`);
      headers.set(keyId(itemKey), header({ key: itemKey, title: 'x'.repeat(100_000) }, itemKey));
      clusters.set(keyId(itemKey), oneLine);
      return itemKey;
    });
    const source = makeSource({ headers, clusters });

    await expect(readClassicTextBatch(source, inputs)).rejects.toMatchObject({ code: 'LIMIT_EXCEEDED' });
  });

  it('matches literal phrases in ITF command lines within only the supplied batch', async () => {
    const source = makeSource({
      headers: new Map([[keyId(key), header({ storedLineCount: 4 }, key)]]),
      clusters: new Map([[keyId(key), commandText]]),
    });
    const [result] = await readClassicTextBatch(source, [key]);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected successful fixture read');

    const search = findTextMatches([result], 'leading');
    expect(search).toMatchObject({ truncated: false, caseSensitive: true, scope: 'supplied-batch-only' });
    expect(search.matches).toEqual([
      { index: 0, key, lineNumber: 2, format: '/:', text: '  leading  and internal spaces' },
    ]);
  });

  it('reports when bounded phrase matches are capped at 50', async () => {
    const source = makeSource();
    const result = await readClassicText(source, key);
    const baseItem: ClassicTextBatchItem = { index: 0, status: 'ok', text: result };
    const item = (index: number): ClassicTextBatchItem => ({
      ...baseItem,
      index,
      text: {
        ...result,
        lines: Array.from({ length: 3 }, (_, line) => ({ format: '', text: `hit ${line}` })),
        lineCount: 3,
      },
    });

    const search = findTextMatches(
      Array.from({ length: 25 }, (_, index) => item(index)),
      'hit',
    );

    expect(search.matches).toHaveLength(50);
    expect(search.truncated).toBe(true);
  });

  it('rejects malformed phrases and oversized search batches', () => {
    const result = {
      index: 0,
      status: 'ok',
      text: {
        requestedKey: key,
        resolvedKey: key,
        header: header(),
        referenceChain: [key],
        lines: [{ format: '', text: 'hit' }],
        lineCount: 1,
        storage: {
          kind: 'classic-stxh-stxl',
          clusterPresent: true,
          consistency: 'reread-matched',
          snapshotGuaranteed: false,
        },
        warnings: [],
      },
    } satisfies ClassicTextBatchItem;
    expect(() => findTextMatches([result], '')).toThrow(TextReadError);
    expect(() =>
      findTextMatches(
        Array.from({ length: 26 }, () => result),
        'hit',
      ),
    ).toThrow(expect.objectContaining({ code: 'LIMIT_EXCEEDED' }));
  });
});
