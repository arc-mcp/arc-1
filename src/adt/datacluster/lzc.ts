/**
 * LZC is compress(1): LZW with codes that grow from nine bits to a limit the
 * header states, a clear code of 256 in block mode, and the quirk that codes
 * are read in chunks of `width` BYTES so a width change or a clear starts on
 * a chunk boundary and the tail of the previous chunk is discarded. The
 * dictionary is the usual prefix-code-plus-byte table; the case where a code
 * names the entry being defined is the classic KwKwK case of every LZW.
 *
 * Ported from vibing-steampunk's `pkg/sapcompress/lzc.go` (same MIT license,
 * same original author).
 */

import type { SapCompressHeader } from './sapcompress.js';

const LZC_MIN_WIDTH = 9;
const LZC_MAX_WIDTH = 16;
const LZC_LITERALS = 256;
const LZC_CLEAR_CODE = 256;

interface LzcEntry {
  /** The code this entry extends, or -1 for a literal. */
  prefix: number;
  /** The byte it appends. */
  last: number;
  /** Bytes in the expanded string. */
  length: number;
}

class LzcReader {
  private pos = 0;
  private chunk: Buffer = Buffer.alloc(0);
  private cpos = 0; // bit position inside chunk

  constructor(private readonly src: Buffer) {}

  /** Takes the next `width` bytes as the chunk codes are read from; a shorter final chunk is fine. */
  nextChunk(width: number): void {
    const left = this.src.length - this.pos;
    const n = Math.min(width, left);
    this.chunk = this.src.subarray(this.pos, this.pos + n);
    this.pos += n;
    this.cpos = 0;
  }

  bitsLeft(): number {
    return this.chunk.length * 8 - this.cpos;
  }

  readBits(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const bit = (this.chunk[this.cpos >> 3]! >> (this.cpos % 8)) & 1;
      v |= bit << i;
      this.cpos++;
    }
    return v;
  }
}

export function lzcDecode(body: Buffer, h: SapCompressHeader): Buffer {
  const blockMode = (h.extra & 0x80) !== 0;
  const limit = h.extra & 0x1f;
  if (limit < LZC_MIN_WIDTH || limit > LZC_MAX_WIDTH) {
    throw new Error(`code width limit ${limit} outside ${LZC_MIN_WIDTH}..${LZC_MAX_WIDTH}`);
  }
  const firstFree = LZC_LITERALS + (blockMode ? 1 : 0);
  const table: LzcEntry[] = new Array(1 << limit);
  for (let i = 0; i < LZC_LITERALS; i++) {
    table[i] = { prefix: -1, last: i, length: 1 };
  }

  const r = new LzcReader(body);
  let width = LZC_MIN_WIDTH;
  let maxCode = (1 << width) - 1;
  const setWidth = (w: number): void => {
    width = w;
    maxCode = w === limit ? 1 << limit : (1 << w) - 1;
  };
  let nextFree = firstFree;
  r.nextChunk(width);

  const readCode = (): number | undefined => {
    if (r.bitsLeft() < width || nextFree > maxCode) {
      if (nextFree > maxCode) setWidth(width + 1);
      r.nextChunk(width);
    }
    if (r.bitsLeft() < width) return undefined;
    return r.readBits(width);
  };

  const out: number[] = [];
  const expand = (codeIn: number): number[] => {
    let code = codeIn;
    const scratch = new Array<number>(table[code]!.length);
    for (let i = scratch.length - 1; i >= 0; i--) {
      const e = table[code]!;
      scratch[i] = e.last;
      code = e.prefix;
    }
    return scratch;
  };

  let prev = -1;
  while (out.length < h.length) {
    const code = readCode();
    if (code === undefined) {
      // The original library stops here too: the header's length is the contract, and a stream
      // that ends early is reported by the caller's length check.
      break;
    }
    if (blockMode && code === LZC_CLEAR_CODE) {
      nextFree = firstFree;
      setWidth(LZC_MIN_WIDTH);
      r.nextChunk(width);
      prev = -1;
      continue;
    }
    let chain: number[];
    if (code < nextFree && (code < LZC_LITERALS || table[code]!.length > 0)) {
      chain = expand(code);
    } else if (code === nextFree && prev >= 0) {
      // KwKwK: the string is the previous one plus its own first byte.
      const p = expand(prev);
      chain = [...p, p[0]!];
    } else {
      throw new Error(`unknown code ${code}`);
    }
    out.push(...chain);
    if (prev >= 0 && nextFree < table.length) {
      table[nextFree] = { prefix: prev, last: chain[0]!, length: table[prev]!.length + 1 };
      nextFree++;
    }
    prev = code;
  }
  if (out.length > h.length) {
    throw new Error('stream expanded past the header length');
  }
  return Buffer.from(out);
}
