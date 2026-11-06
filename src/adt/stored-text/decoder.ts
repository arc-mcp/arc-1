/**
 * STXL container marker research and portions of the traversal design are adapted from:
 * https://github.com/aamelin1/sap-long-texts
 * Revision: 19c8c272b23f0ab481f7d63b6b36c45db15fd095
 *
 * MIT License
 *
 * Copyright (c) 2026 Andrey
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
/**
 * Bounded STXL/TLINE decoder; no SAP installation, RFC, Python, or third-party runtime.
 * Container marker research: aamelin1/sap-long-texts, commit 19c8c272 (MIT; attribution above).
 * Verified profile: FF06, Unicode little-endian (4103), flat TLINE, CS_LZH or plain.
 * This accepts the qualified stored profile; it is not a universal IMPORT/READ_TEXT implementation.
 */
import { promisify } from 'node:util';
import { inflateRaw } from 'node:zlib';
import { TextReadError, type TextReadErrorCode } from './errors.js';

const inflate = promisify(inflateRaw);
const CONTAINER_HEADER_BYTES = 16;
const COMPRESSION_HEADER_BYTES = 8;
const TLINE_FORMAT_UNITS = 2;
const TLINE_TEXT_UNITS = 132;
const UTF16_BYTES_PER_UNIT = 2;
const TLINE_ROW_BYTES = (TLINE_FORMAT_UNITS + TLINE_TEXT_UNITS) * UTF16_BYTES_PER_UNIT;
// Empirical ceiling for the verified SAP-produced compressed profile; not a trailer grammar.
const MAX_COMPRESSED_TRAILING_BYTES = 6;
const MARKER = {
  segment: 3,
  containerEnd: 4,
  characterField: 0xaa,
  structureStart: 0xad,
  structureEnd: 0xae,
  fixedRow: 0xbb,
  sizedRow: 0xbc,
  rowEnd: 0xbd,
  table: 0xbe,
  tableEnd: 0xbf,
} as const;

export interface TextLine {
  format: string;
  text: string;
}
export interface DecodeLimits {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxLines: number;
}
export interface UnpackedCluster {
  version: number;
  codePage: string;
  compressed: boolean;
  compressedTrailingBytes: number;
  payload: Buffer;
}
export interface DecodedText {
  version: number;
  codePage: string;
  compressed: boolean;
  compressedTrailingBytes: number;
  wellFormedUnicode: boolean;
  lines: TextLine[];
  outputBytes: number;
}
export const DEFAULT_LIMITS: Readonly<DecodeLimits> = Object.freeze({
  maxInputBytes: 2 * 1024 * 1024,
  maxOutputBytes: 4 * 1024 * 1024,
  maxLines: 10_000,
});

function fail(message: string, code: TextReadErrorCode = 'CORRUPT_CLUSTER'): never {
  throw new TextReadError(code, message);
}
function checkLimits(limits: DecodeLimits): void {
  for (const name of Object.keys(DEFAULT_LIMITS) as Array<keyof DecodeLimits>) {
    const value = limits?.[name];
    if (!Number.isSafeInteger(value) || value < 1 || value > DEFAULT_LIMITS[name as keyof DecodeLimits]) {
      fail(`invalid ${name}; limits may only narrow the hard ceiling`, 'LIMIT_EXCEEDED');
    }
  }
}
function range(data: Buffer, offset: number, size: number): Buffer {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(size) ||
    offset < 0 ||
    size < 0 ||
    offset + size > data.length
  ) {
    fail(`truncated container at byte ${offset}`);
  }
  return data.subarray(offset, offset + size);
}
function uint(data: Buffer, offset: number, size: number): number {
  return range(data, offset, size).readUIntBE(0, size);
}
function textBytes(bytes: Buffer, codePage: string): string {
  if (codePage !== '4103') fail(`unverified code page ${codePage}`, 'UNSUPPORTED_PROFILE');
  // ABAP CHAR truncation can leave a lone surrogate. Preserve its code unit, as IMPORT does.
  // JSON.stringify escapes such units; callers must not silently replace them during encoding.
  return bytes.toString('utf16le');
}

/** Remove SAP's bit prefix while preserving the bounded input size for native zlib. */
function reframeLzh(source: Buffer): Buffer {
  const shift = 2 + (source[0] & 3);
  const reframed = Buffer.alloc(source.length);
  for (let i = 0; i < source.length; i++) {
    reframed[i] = (source[i] >>> shift) | ((source[i + 1] ?? 0) << (8 - shift));
  }
  return reframed;
}

/** Validate the tested container profile and return its bounded decompressed payload. */
export async function unpackCluster(data: Buffer, limits: DecodeLimits = DEFAULT_LIMITS): Promise<UnpackedCluster> {
  checkLimits(limits);
  if (data.length > limits.maxInputBytes) fail('compressed input limit exceeded', 'LIMIT_EXCEEDED');
  range(data, 0, CONTAINER_HEADER_BYTES);
  if (data[0] !== 0xff || data[1] !== 6 || data[2] !== 2)
    fail('unverified container signature/version/byte order', 'UNSUPPORTED_PROFILE');
  const version = data[1];
  const codePage = data.subarray(8, 12).toString('latin1');
  textBytes(Buffer.alloc(0), codePage); // Reject unknown code pages even for an empty table.
  const compression = data[4];
  let payload: Buffer;
  let compressedTrailingBytes = 0;
  if (compression === 1) {
    payload = data.subarray(CONTAINER_HEADER_BYTES);
    if (payload.length > limits.maxOutputBytes) fail('uncompressed output limit exceeded', 'LIMIT_EXCEEDED');
  } else if (compression === 2) {
    range(data, CONTAINER_HEADER_BYTES, COMPRESSION_HEADER_BYTES + 1);
    if (data[20] !== 0x12 || data[21] !== 0x1f || data[22] !== 0x9d)
      fail('unsupported compression header', 'UNSUPPORTED_PROFILE');
    const expected = data.readUInt32LE(CONTAINER_HEADER_BYTES);
    if (expected < 1 || expected > limits.maxOutputBytes) fail('declared output limit exceeded', 'LIMIT_EXCEEDED');
    const reframed = reframeLzh(data.subarray(CONTAINER_HEADER_BYTES + COMPRESSION_HEADER_BYTES));
    const firstBlockType = (reframed[0] >>> 1) & 3;
    if (firstBlockType !== 1 && firstBlockType !== 2) fail('unsupported initial LZH block type', 'UNSUPPORTED_PROFILE');
    let consumed: number;
    try {
      // Node's callback typings omit the info:true result shape.
      const inflated = (await inflate(reframed, {
        maxOutputLength: expected,
        windowBits: 14,
        info: true,
      })) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
      payload = inflated.buffer;
      consumed = inflated.engine.bytesWritten;
    } catch {
      return fail('invalid, truncated, oversized, or unsupported LZH stream');
    }
    if (payload.length !== expected) fail('decompressed length mismatch');
    compressedTrailingBytes = reframed.length - consumed;
    // Live SAP buffers have 1–6 residual bytes, sometimes nonzero. Their grammar is unverified.
    // Bound the opaque tail to reject appended stale chunks; this is not an integrity check.
    if (
      !Number.isSafeInteger(consumed) ||
      consumed < 1 ||
      compressedTrailingBytes < 0 ||
      compressedTrailingBytes > MAX_COMPRESSED_TRAILING_BYTES
    )
      fail('excess compressed trailer bytes');
  } else {
    return fail(`unsupported compression flag ${compression}`, 'UNSUPPORTED_PROFILE');
  }
  return { version, codePage, compressed: compression === 2, compressedTrailingBytes, payload };
}

/** Parse one complete named TLINE table; every transition checks its required predecessor. */
function parseTlinePayload(payload: Buffer, codePage: string, limits: DecodeLimits): TextLine[] {
  // unpackCluster has already rejected all profiles except UTF-16LE / 4103.
  const charBytes = UTF16_BYTES_PER_UNIT;
  const lines: TextLine[] = [];
  let p = 0;
  let descriptor = false;
  let ended = false;
  let rowBytes = 0;
  const fields: number[] = [];
  let declaredRows: number | undefined;
  let structureStarted = false;
  let structureEnded = false;
  let rowPending = false;
  let tableClosed = false;
  let segmentLength = 0;
  const emit = (offset: number, length: number) => {
    if (
      ended ||
      tableClosed ||
      rowPending ||
      !descriptor ||
      declaredRows === undefined ||
      length !== TLINE_ROW_BYTES ||
      rowBytes !== length ||
      fields.length !== 2 ||
      fields[0] !== TLINE_FORMAT_UNITS * charBytes ||
      fields[1] !== TLINE_TEXT_UNITS * charBytes
    )
      fail('unexpected TLINE row shape');
    if (lines.length >= limits.maxLines) fail('line limit exceeded', 'LIMIT_EXCEEDED');
    const row = range(payload, offset, length);
    lines.push({
      format: textBytes(row.subarray(0, TLINE_FORMAT_UNITS * charBytes), codePage).replace(/ +$/u, ''),
      text: textBytes(row.subarray(TLINE_FORMAT_UNITS * charBytes), codePage).replace(/ +$/u, ''),
    });
    rowPending = true;
  };
  while (p < payload.length) {
    const marker = payload[p];
    // Verified plain and inflated TLINE payloads end exactly at marker 04. CLUSTR has
    // already removed storage padding; accepting zeros here could hide stale chunks.
    if (ended) fail('non-padding bytes after container end (trailing padding is unsupported)');
    switch (marker) {
      case MARKER.segment: {
        if (descriptor) fail('multiple tables in TLINE container');
        const nameOffset = 32;
        if (
          uint(payload, p + 1, 1) !== 14 ||
          uint(payload, p + 2, 1) !== 0 ||
          uint(payload, p + 3, 4) !== TLINE_ROW_BYTES
        )
          fail('unexpected TLINE segment descriptor');
        if (range(payload, p + 12, 20).some((byte) => byte !== 0)) fail('unsupported segment header fields');
        segmentLength = uint(payload, p + 7, 4);
        const nameLength = uint(payload, p + 11, 1);
        const bytes = charBytes;
        const name = textBytes(range(payload, p + nameOffset, nameLength * bytes), codePage);
        if (name !== 'TLINE') fail('container does not hold TLINE');
        range(payload, p, nameOffset + nameLength * bytes);
        p += nameOffset + nameLength * bytes;
        descriptor = true;
        break;
      }
      case MARKER.structureStart:
        if (!descriptor || structureStarted || fields.length || declaredRows !== undefined)
          fail('misplaced structure start');
        if (uint(payload, p + 3, 4) !== TLINE_ROW_BYTES) fail('unexpected structure length');
        structureStarted = true;
        p += 7;
        break;
      case MARKER.structureEnd:
        if (!structureStarted || structureEnded || fields.length !== 2 || declaredRows !== undefined)
          fail('misplaced structure end');
        if (uint(payload, p + 3, 4) !== TLINE_ROW_BYTES) fail('unexpected structure length');
        structureEnded = true;
        p += 7;
        break;
      case MARKER.characterField: {
        if (!structureStarted || structureEnded || fields.length >= 2) fail('unexpected character descriptor');
        const length = uint(payload, p + 3, 4);
        if (length !== (fields.length === 0 ? TLINE_FORMAT_UNITS : TLINE_TEXT_UNITS) * charBytes)
          fail('unexpected TLINE field length');
        fields.push(length);
        rowBytes += length;
        p += 7;
        break;
      }
      case MARKER.table:
        if (!structureEnded || declaredRows !== undefined || lines.length) fail('misplaced table descriptor');
        if (uint(payload, p + 1, 4) !== rowBytes) fail('table row length mismatch');
        declaredRows = uint(payload, p + 5, 4);
        if (declaredRows > limits.maxLines) fail('declared line limit exceeded', 'LIMIT_EXCEEDED');
        p += 9;
        break;
      case MARKER.sizedRow: {
        const length = uint(payload, p + 1, 4);
        emit(p + 5, length);
        p += 5 + length;
        break;
      }
      case MARKER.fixedRow:
        emit(p + 1, rowBytes);
        p += 1 + rowBytes;
        break;
      case MARKER.rowEnd:
        if (!rowPending || tableClosed) fail('misplaced row end');
        rowPending = false;
        p++;
        break;
      case MARKER.tableEnd:
        if (declaredRows === undefined || tableClosed || rowPending || declaredRows !== lines.length)
          fail('misplaced table end');
        tableClosed = true;
        p++;
        break;
      case MARKER.containerEnd:
        if (!tableClosed) fail('container ended before table');
        if (segmentLength !== 0 && segmentLength !== p) fail('segment length mismatch');
        ended = true;
        p++;
        break;
      default:
        return fail(`unsupported container marker ${marker} at ${p}`);
    }
  }
  if (!descriptor || !ended) fail('missing TLINE descriptor or end marker');
  if (declaredRows !== undefined && declaredRows !== lines.length) fail('declared line count mismatch');
  return lines;
}

/** Decode the verified stored-TLINE profile; returned lines retain ITF formatting codes. */
export async function decodeStxl(data: Buffer, limits: DecodeLimits = DEFAULT_LIMITS): Promise<DecodedText> {
  const { version, codePage, compressed, compressedTrailingBytes, payload } = await unpackCluster(data, limits);
  const lines = parseTlinePayload(payload, codePage, limits);
  return {
    version,
    codePage,
    compressed,
    compressedTrailingBytes,
    wellFormedUnicode: lines.every((line) => !/\p{Surrogate}/u.test(line.format) && !/\p{Surrogate}/u.test(line.text)),
    lines,
    outputBytes: payload.length,
  };
}
