/**
 * Decodes the two compression formats SAP applies to its own byte streams,
 * including every `EXPORT ... TO DATABASE` cluster — BALDAT, INDX, STXL and
 * their kin.
 *
 * SAP calls them LZH and LZC. Neither is the thing its name suggests. LZH is
 * raw DEFLATE (RFC 1951) — the same literal/length alphabet, the same fixed
 * Huffman trees — wearing an eight-byte SAP header and a two-bit prefix that
 * says how many junk bits precede the first block. Once that prefix is
 * stripped, Node's zlib inflates it. LZC is the LZW variant of compress(1),
 * with block mode and the code-width padding quirk of that program; it has
 * no zlib equivalent, so `./lzc.ts` implements it directly.
 *
 * Only decompression is needed — nothing here writes a cluster. Ported from
 * vibing-steampunk's `pkg/sapcompress` (same MIT license, same original
 * author).
 */

import { inflateRawSync } from 'node:zlib';
import { lzcDecode } from './lzc.js';

/** Identifies the compression scheme named in a SAP header. */
export enum Algorithm {
  /** The compress(1)-style LZW variant. Header algorithm byte 0x10 (nibble 1). */
  LZC = 1,
  /** DEFLATE with a SAP prefix. Header algorithm byte 0x12 (nibble 2). */
  LZH = 2,
}

export function algorithmName(a: number): string {
  if (a === Algorithm.LZC) return 'LZC';
  if (a === Algorithm.LZH) return 'LZH';
  return `algorithm ${a}`;
}

/** The length of the SAP compression header. */
export const HEADER_SIZE = 8;

/** The eight bytes every SAP-compressed stream starts with. */
export interface SapCompressHeader {
  /** The size of the uncompressed data, stated up front; the decoder holds the stream to it. */
  length: number;
  algorithm: Algorithm;
  version: number;
  /** The eighth byte. LZC keeps its block mode and code-width limit there; LZH does not use it. */
  extra: number;
}

const MAGIC = Buffer.from([0x1f, 0x9d]);

export class NotCompressedError extends Error {
  constructor() {
    super('sapcompress: no SAP compression signature');
    this.name = 'NotCompressedError';
  }
}

/** Reads the header without decompressing anything. */
export function parseHeader(data: Buffer): SapCompressHeader {
  if (data.length < HEADER_SIZE) {
    throw new Error(`sapcompress: ${data.length} bytes is shorter than the ${HEADER_SIZE}-byte header`);
  }
  if (!data.subarray(5, 7).equals(MAGIC)) {
    throw new NotCompressedError();
  }
  return {
    length: data.readUInt32LE(0),
    algorithm: (data[4]! & 0x0f) as Algorithm,
    version: data[4]! >> 4,
    extra: data[7]!,
  };
}

/** Decodes a complete SAP-compressed stream, header included, and returns exactly the promised byte count. */
export function decompress(data: Buffer): Buffer {
  const h = parseHeader(data);
  const body = data.subarray(HEADER_SIZE);
  let out: Buffer;
  try {
    if (h.algorithm === Algorithm.LZH) {
      out = inflate(body);
    } else if (h.algorithm === Algorithm.LZC) {
      out = lzcDecode(body, h);
    } else {
      throw new Error(`unknown ${algorithmName(h.algorithm)}`);
    }
  } catch (err) {
    throw new Error(`sapcompress: ${algorithmName(h.algorithm)}: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (out.length !== h.length) {
    throw new Error(
      `sapcompress: ${algorithmName(h.algorithm)}: header promised ${h.length} bytes, stream held ${out.length}`,
    );
  }
  return out;
}

/**
 * Decodes the LZH body: a two-bit count of noise bits, that many noise bits, then DEFLATE blocks.
 * DEFLATE is read least-significant-bit first, so dropping the prefix is a right shift of the
 * whole buffer by that many bits; the standard zlib inflater then reads it as a raw stream. SAP
 * never emits stored blocks, the only part of DEFLATE that would care about byte alignment.
 */
function inflate(body: Buffer): Buffer {
  if (body.length === 0) throw new Error('empty body');
  const prefix = 2 + (body[0]! & 0x03);
  const shifted = Buffer.alloc(body.length);
  for (let i = 0; i < body.length; i++) {
    let v = body[i]! >>> prefix;
    if (i + 1 < body.length) {
      v |= (body[i + 1]! << (8 - prefix)) & 0xff;
    }
    shifted[i] = v & 0xff;
  }
  // Node's raw inflate decodes to the deflate stream's own end-of-block marker and ignores
  // whatever padding trails it, exactly like Go's flate.Reader stopping at the same marker — so a
  // length mismatch here (too short OR too long) means the header's promise was wrong, and
  // decompress()'s exact-length check reports it either way.
  return inflateRawSync(shifted);
}
