import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { readStoredText } from '../../../scripts/spikes/stxl/reader.js';
import { readStoredTextSql, spacePreservingLiteral } from '../../../scripts/spikes/stxl/sql-reader.js';
import { AdtClient } from '../../../src/adt/client.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { assembleChunks, keyFilters } from '../../../src/adt/stored-text/chunks.js';
import { DEFAULT_LIMITS, type DecodeLimits, decodeStxl, unpackCluster } from '../../../src/adt/stored-text/decoder.js';

type Fixture = {
  basis: string;
  cases: Array<{ name: string; compressed: string; plain?: string; lines: number; sha256: string }>;
};
const fixtures = ['750', '758', '816'].map(
  (basis) =>
    JSON.parse(readFileSync(new URL(`../../fixtures/stxl/sap-${basis}.json`, import.meta.url), 'utf8')) as Fixture,
);
const small = Buffer.from(fixtures[1].cases[2].compressed, 'base64');
const plain = Buffer.from(fixtures[1].cases[2].plain!, 'base64');
const key = { TDOBJECT: 'TEXT', TDNAME: 'Z_ARC1_SYNTHETIC', TDID: 'ST', TDSPRAS: 'E' };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rowsFor = (bytes: Buffer) =>
  Array.from({ length: Math.ceil(bytes.length / 7902) }, (_, i) => ({
    ...key,
    MANDT: '001',
    RELID: 'TX',
    SRTF2: `${i} `,
    CLUSTR: `${Math.min(bytes.length - i * 7902, 7902)} `,
    CLUSTD: bytes
      .subarray(i * 7902, (i + 1) * 7902)
      .toString('hex')
      .padEnd(15804, '0'),
  }));

describe('STXL spike: independent SAP kernel fixtures', () => {
  for (const basis of ['750', '758', '816']) {
    const edgeCases = JSON.parse(
      readFileSync(new URL(`../../fixtures/stxl/sap-${basis}-unicode.json`, import.meta.url), 'utf8'),
    ) as { cases: Array<{ NAME: string; COMPRESSED: string; PLAIN: string; EXPECTED_RAW: string[] }> };
    for (const sample of edgeCases.cases) {
      for (const mode of ['COMPRESSED', 'PLAIN'] as const) {
        it(`${basis} ${sample.NAME} ${mode}`, async () => {
          const decoded = await decodeStxl(Buffer.from(sample[mode], 'base64'));
          // Independent raw TLINE oracle, avoiding SAP/JSON UTF-8 conversion of lone surrogates.
          const expected = sample.EXPECTED_RAW.map((raw) => {
            const bytes = Buffer.from(raw, 'base64');
            expect(bytes.length).toBe(268);
            const units = Array.from({ length: 134 }, (_, index) => bytes.readUInt16LE(index * 2));
            return {
              format: String.fromCharCode(...units.slice(0, 2)).replace(/ +$/u, ''),
              text: String.fromCharCode(...units.slice(2)).replace(/ +$/u, ''),
            };
          });
          expect(decoded.lines).toEqual(expected);
          expect(decoded.wellFormedUnicode).toBe(sample.NAME !== 'unicode-edge-1');
          expect(JSON.parse(JSON.stringify(decoded.lines))).toEqual(expected);
          if (sample.NAME === 'unicode-edge-1') {
            expect(decoded.lines[0].text.charCodeAt(131)).toBe(0xd83d);
            expect(decoded.lines[1].text.charCodeAt(0)).toBe(0xde00);
          }
          if (sample.NAME === 'unicode-edge-2') expect(decoded.lines[0].text.charCodeAt(1)).toBe(0);
          if (sample.NAME === 'unicode-edge-3')
            expect(decoded.lines.map((line) => line.text.at(-1))).toEqual(['\t', '\u00a0', '\u3000']);
        });
      }
    }
  }

  for (const fixture of fixtures) {
    for (const sample of fixture.cases) {
      for (const mode of ['compressed', 'plain'] as const) {
        if (!sample[mode]) continue; // Only small plain fixtures are retained; live runs check all nine.
        it(`${fixture.basis} ${sample.name} ${mode}`, async () => {
          const decoded = await decodeStxl(Buffer.from(sample[mode]!, 'base64'));
          expect(decoded.lines).toHaveLength(sample.lines);
          expect(hash(decoded.lines)).toBe(sample.sha256);
          expect(decoded.codePage).toBe('4103');
        });
      }
    }
  }

  it('preserves literal entities, leading spaces and tabs', async () => {
    const { lines } = await decodeStxl(Buffer.from(fixtures[1].cases[3].compressed, 'base64'));
    expect(lines[0].text).toBe('Literal &amp; & <tag> > entity fidelity');
    expect(lines[1]).toEqual({ format: '/:', text: '  leading  and internal spaces' });
    expect(lines[2]).toEqual({ format: '=', text: '\ttabs\t' });
  });

  it('rejects unverified versions, byte orders and code pages', async () => {
    for (const [offset, value] of [
      [0, 0],
      [1, 3],
      [1, 4],
      [1, 5],
      [1, 7],
      [2, 1],
      [4, 0],
      [20, 0],
      [21, 0],
      [22, 0],
    ]) {
      const bad = Buffer.from(small);
      bad[offset] = value;
      await expect(decodeStxl(bad)).rejects.toThrow('STXL:');
    }
    for (const cp of ['1100', '1500', '4102', '8300']) {
      const bad = Buffer.from(small);
      bad.write(cp, 8, 'ascii');
      await expect(decodeStxl(bad)).rejects.toThrow('unverified code page');
    }
    const highBit = Buffer.from(small);
    highBit[8] |= 0x80;
    await expect(decodeStxl(highBit)).rejects.toThrow('unverified code page');
  });

  it('rejects truncated headers and compressed streams', async () => {
    for (const size of [0, 1, 15, 16, 20, 24, 25, 30, Math.floor(small.length / 2)]) {
      await expect(decodeStxl(small.subarray(0, size))).rejects.toThrow('STXL:');
    }
  });

  it('enforces every caller limit, including malformed runtime options', async () => {
    for (const limits of [
      null,
      {},
      { ...DEFAULT_LIMITS, maxLines: NaN },
      { ...DEFAULT_LIMITS, maxInputBytes: Infinity },
      { ...DEFAULT_LIMITS, maxOutputBytes: DEFAULT_LIMITS.maxOutputBytes + 1 },
    ]) {
      await expect(decodeStxl(small, limits as DecodeLimits)).rejects.toThrow('invalid');
    }
    await expect(decodeStxl(small, { ...DEFAULT_LIMITS, maxInputBytes: 16 })).rejects.toThrow('input limit');
    await expect(decodeStxl(plain, { ...DEFAULT_LIMITS, maxOutputBytes: 16 })).rejects.toThrow('output limit');
    await expect(
      decodeStxl(Buffer.from(fixtures[1].cases[8].compressed, 'base64'), { ...DEFAULT_LIMITS, maxLines: 10 }),
    ).rejects.toThrow('line limit');
    const bad = Buffer.from(small);
    bad.writeUInt32LE(DEFAULT_LIMITS.maxOutputBytes + 1, 16);
    await expect(decodeStxl(bad)).rejects.toThrow('declared output limit');
    bad.writeUInt32LE(1, 16);
    await expect(decodeStxl(bad)).rejects.toThrow('LZH stream');
    bad.writeUInt32LE(356, 16);
    await expect(decodeStxl(bad)).rejects.toThrow('length mismatch');
  });

  it('bounds native decompression even when the declared length lies', async () => {
    const raw = deflateRawSync(Buffer.alloc(1024 * 1024, 65));
    const packed = Buffer.alloc(raw.length + 1);
    for (let i = 0; i < raw.length; i++) {
      packed[i] |= raw[i] << 2;
      packed[i + 1] |= raw[i] >>> 6;
    }
    const header = Buffer.from(small.subarray(0, 24));
    header.writeUInt32LE(100, 16);
    await expect(unpackCluster(Buffer.concat([header, packed]))).rejects.toThrow('LZH stream');
  });

  it('requires complete TLINE structure even for an empty table', async () => {
    const empty = Buffer.from(fixtures[1].cases[0].plain!, 'base64');
    const descriptorOnly = Buffer.concat([empty.subarray(0, 58), Buffer.from([4])]);
    await expect(decodeStxl(descriptorOnly)).rejects.toThrow('container ended before table');
    const badField = Buffer.from(empty);
    badField[71] = 8;
    await expect(decodeStxl(badField)).rejects.toThrow('field length');
    const duplicateRowEnd = Buffer.concat([empty.subarray(0, -2), Buffer.from([0xbd]), empty.subarray(-2)]);
    await expect(decodeStxl(duplicateRowEnd)).rejects.toThrow('misplaced row end');
    await expect(decodeStxl(Buffer.concat([empty, Buffer.from([1])]))).rejects.toThrow('non-padding');
    await expect(decodeStxl(Buffer.concat([empty, Buffer.from([0])]))).rejects.toThrow('non-padding');
    await expect(decodeStxl(plain.subarray(0, -3))).rejects.toThrow('missing');
  });

  it('rejects appended stale chunks instead of silently ignoring them', async () => {
    for (const length of [7, 7902]) {
      await expect(decodeStxl(Buffer.concat([small, Buffer.alloc(length)]))).rejects.toThrow('trailer');
      await expect(decodeStxl(Buffer.concat([small, Buffer.alloc(length, 0xa5)]))).rejects.toThrow('trailer');
    }
    expect((await decodeStxl(small)).compressedTrailingBytes).toBeLessThanOrEqual(6);
  });

  it('rejects unsupported initial compression block types', async () => {
    const shift = 2 + (small[24] & 3);
    for (const type of [0, 3]) {
      const bad = Buffer.from(small);
      bad[24] = (bad[24] & ~(3 << (shift + 1))) | (type << (shift + 1));
      await expect(decodeStxl(bad)).rejects.toThrow('initial LZH block type');
    }
  });

  it('validates segment type, row size, reserved fields and declared length', async () => {
    for (const offset of [17, 18, 22, 28, 47]) {
      const bad = Buffer.from(plain);
      bad[offset] ^= 1;
      await expect(decodeStxl(bad)).rejects.toThrow(/segment/u);
    }
    const bad = Buffer.from(plain);
    bad.writeUInt32BE(1, 23);
    await expect(decodeStxl(bad)).rejects.toThrow('segment length');
  });

  it('terminates bounded deterministic corruption probes', async () => {
    let seed = 12345;
    for (let i = 0; i < 1000; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const bad = Buffer.from(i % 2 ? small : plain);
      bad[seed % bad.length] ^= 1 << (i % 8);
      try {
        const result = await decodeStxl(bad, { maxInputBytes: 1024, maxOutputBytes: 2048, maxLines: 5 });
        expect(result.lines.length).toBeLessThanOrEqual(5);
        expect(result.outputBytes).toBeLessThanOrEqual(2048);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toMatch(/^STXL:/u);
      }
    }
  });
});

describe('STXL spike: bounded ADT chunk reader', () => {
  it('encodes repeated key spaces without putting them inside SQL literals', () => {
    expect(spacePreservingLiteral('  NAME')).toBe("concat_with_space( ' ', 'NAME', 2 )");
    expect(spacePreservingLiteral("A'B   C")).toBe("concat_with_space( 'A''B', 'C', 3 )");
    expect(spacePreservingLiteral('A B')).toBe("'A B'");
    expect(spacePreservingLiteral('A  B  C')).toBe("concat_with_space( concat_with_space( 'A', 'B', 2 ), 'C', 2 )");
  });

  it('keeps the SQL compatibility route behind the free-SQL gate', async () => {
    const client = new AdtClient({
      baseUrl: 'https://sap.invalid',
      safety: { ...defaultSafetyConfig(), allowDataPreview: true },
    });
    const post = vi.spyOn(client.http, 'post');
    await expect(readStoredTextSql(client, { ...key, TDNAME: '  NAME' }, '001')).rejects.toThrow(
      /free.?sql|allowFreeSQL/iu,
    );
    expect(post).not.toHaveBeenCalled();
  });

  it('quotes a malicious-looking key without changing the statement structure', async () => {
    const suspicious = { ...key, TDNAME: "A'  OR '1'='1" };
    const rows = rowsFor(small).map((row) => ({ ...row, TDNAME: suspicious.TDNAME }));
    const runQuery = vi.fn().mockResolvedValue({ rows, columns: [] });
    expect((await readStoredTextSql({ runQuery }, suspicious, '001')).lines).toHaveLength(1);
    expect(runQuery.mock.calls[0][0]).toContain(
      "TDNAME = concat_with_space( concat_with_space( 'A''', 'OR', 2 ), '''1''=''1', 1 )",
    );
  });

  it('sorts chunks, trims CLUSTR and crosses a 32-row request boundary', async () => {
    const bytes = Buffer.from(fixtures[1].cases[8].compressed, 'base64');
    const rows = rowsFor(bytes);
    expect(rows.length).toBeGreaterThan(32);
    expect(assembleChunks([...rows].reverse(), key, '001')).toEqual(bytes);
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: rows.slice(0, 32).reverse() })
      .mockResolvedValueOnce({ rows: rows.slice(32).reverse() });
    const result = await readStoredText({ runTableQuery: query }, key, '001');
    expect(hash(result.lines)).toBe(fixtures[1].cases[8].sha256);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][1]).toMatchObject({
      maxRows: 33,
      where: expect.arrayContaining([{ field: 'SRTF2', op: '>=', value: '32' }]),
    });
  });

  it('rejects identity mixing, gaps, duplicates, partial hex and invalid lengths', () => {
    const row = rowsFor(small)[0];
    for (const patch of [
      { MANDT: '002' },
      { TDNAME: 'OTHER' },
      { RELID: 'OT' },
      { SRTF2: '1' },
      { SRTF2: '0x0' },
      { SRTF2: '256' },
      { CLUSTR: '7903' },
      { CLUSTR: '0' },
      { CLUSTD: row.CLUSTD.slice(2) },
      { CLUSTD: `zz${row.CLUSTD.slice(2)}` },
    ]) {
      expect(() => assembleChunks([{ ...row, ...patch }], key, '001')).toThrow('STXL:');
    }
    expect(() => assembleChunks([row, row], key, '001')).toThrow('short intermediate');
    expect(() => assembleChunks([], key, '001')).toThrow('missing');
    expect(() => keyFilters({ ...key, TDNAME: '' })).toThrow('invalid TDNAME');
    expect(() => keyFilters({ ...key, TDNAME: '\n' })).toThrow('invalid TDNAME');
    expect(keyFilters({ ...key, TDNAME: "A'B" })).toContainEqual({ field: 'TDNAME', op: '=', value: "A'B" });
  });

  it('bounds SRTF2 at the complete 256-row INT1 domain without a ninth request', async () => {
    // Expand the independently generated single-row container using its parsed frame bounds.
    // This exercises 256 real chunks without relying on padding after the container end.
    const payload = (await unpackCluster(plain)).payload;
    const descriptorEnd = 32 + payload[11] * 2;
    const tableDescriptor = descriptorEnd + 4 * 7; // structure start, two CHAR fields, structure end
    expect(payload[tableDescriptor]).toBe(0xbe);
    const rowStart = tableDescriptor + 9;
    expect(payload[rowStart]).toBe(0xbc);
    const rowEnd = rowStart + 5 + payload.readUInt32BE(rowStart + 1) + 1;
    expect(payload[rowEnd - 1]).toBe(0xbd);
    expect([...payload.subarray(rowEnd)]).toEqual([0xbf, 4]);
    const rowCount = 7355;
    const prefix = Buffer.from(payload.subarray(0, rowStart));
    prefix.writeUInt32BE(rowCount, tableDescriptor + 5);
    prefix.writeUInt32BE(prefix.length + (rowEnd - rowStart) * rowCount + 1, 7);
    const bytes = Buffer.concat([
      plain.subarray(0, 16),
      prefix,
      ...Array.from({ length: rowCount }, () => payload.subarray(rowStart, rowEnd)),
      Buffer.from([0xbf, 4]),
    ]);
    const rows = rowsFor(bytes);
    expect(rows).toHaveLength(256);
    expect(assembleChunks(rows, key, '001').equals(bytes)).toBe(true);
    expect(() => assembleChunks([...rows, { ...rows[0], SRTF2: '256' }], key, '001')).toThrow('excessive');
    let offset = 0;
    const query = vi.fn().mockImplementation(async () => {
      const result = { rows: rows.slice(offset, offset + 32) };
      offset += 32;
      return result;
    });
    expect((await readStoredText({ runTableQuery: query }, key, '001')).chunks).toBe(256);
    expect(query).toHaveBeenCalledTimes(8);
  });

  it('rejects a truncated/inconsistent window without returning partial text', async () => {
    const rows = rowsFor(Buffer.from(fixtures[1].cases[8].compressed, 'base64'));
    await expect(
      readStoredText({ runTableQuery: vi.fn().mockResolvedValue({ rows: rows.slice(1, 3) }) }, key, '001'),
    ).rejects.toThrow('sequence');
    await expect(
      readStoredText({ runTableQuery: vi.fn().mockResolvedValue({ rows: rows.slice(0, 33) }) }, key, '001'),
    ).rejects.toThrow('window');
    await expect(
      readStoredText({ runTableQuery: vi.fn().mockResolvedValue({ rows: rows.slice(0, 31) }) }, key, '001'),
    ).rejects.toThrow('LZH stream');
  });

  it('retains the ARC-1 data-preview safety gate', async () => {
    const client = new AdtClient({
      baseUrl: 'https://sap.invalid',
      username: 'test',
      password: 'test',
      safety: defaultSafetyConfig(),
    });
    const post = vi.spyOn(client.http, 'post');
    await expect(readStoredText(client, key, '001')).rejects.toThrow(/data preview|allowDataPreview/iu);
    expect(post).not.toHaveBeenCalled();
  });
});
