/**
 * Decodes one field's raw bytes into a JS value, and the codepage/UTF-16
 * handling every character field goes through first.
 *
 * Ported from vibing-steampunk's `pkg/datacluster/values.go` (same MIT
 * license, same original author).
 */

import { decodeDecfloat } from './decfloat.js';
import {
  isStringType,
  type Node,
  TYPE_CHAR,
  TYPE_DATE,
  TYPE_DECFLOAT16,
  TYPE_DECFLOAT34,
  TYPE_FLOAT,
  TYPE_INT,
  TYPE_INT1,
  TYPE_INT2,
  TYPE_INT8,
  TYPE_NUMC,
  TYPE_PACKED,
  TYPE_RAW,
  TYPE_TIME,
  TYPE_XSTRING,
} from './types.js';

export class Decoder {
  readonly utf16: boolean;
  readonly bigEndian: boolean;

  constructor(codepage: string) {
    if (codepage === '4103') {
      this.utf16 = true;
      this.bigEndian = false;
    } else if (codepage === '4102') {
      this.utf16 = true;
      this.bigEndian = true;
    } else if (codepage.length !== 4) {
      throw new Error(`datacluster: unreadable code page "${codepage}" in header`);
    } else {
      // A single-byte page: bytes are taken as they are, right for the ASCII range and a
      // stand-in for the rest.
      this.utf16 = false;
      this.bigEndian = false;
    }
  }

  text(raw: Buffer): string {
    if (this.utf16) {
      const s = decodeUtf16(raw, this.bigEndian);
      if (s !== undefined) return s;
    }
    // A single-byte page, read as Latin-1: right for 1100, and for the others the ASCII range is
    // right and the rest is at least one code point per byte rather than an invalid sequence.
    let out = '';
    for (const b of raw) out += String.fromCharCode(b);
    return out;
  }

  /** Decodes one fixed-length field. Character types come back trimmed, numbers as number/bigint/string, raw bytes as upper-case hex. */
  value(n: Node, raw: Buffer): unknown {
    switch (n.typeCode) {
      case TYPE_CHAR:
        return this.text(raw).replace(/ +$/, '');
      case TYPE_NUMC:
      case TYPE_DATE:
      case TYPE_TIME:
        return this.text(raw);
      case TYPE_RAW:
        return raw.toString('hex').toUpperCase();
      case TYPE_INT:
        if (raw.length === 4) return raw.readInt32LE(0);
        break;
      case TYPE_INT2:
        if (raw.length === 2) return raw.readInt16LE(0);
        break;
      case TYPE_INT1:
        if (raw.length === 1) return raw.readUInt8(0);
        break;
      case TYPE_INT8:
        if (raw.length === 8) return raw.readBigInt64LE(0);
        break;
      case TYPE_FLOAT:
        if (raw.length === 8) return raw.readDoubleLE(0);
        break;
      case TYPE_PACKED:
        return decodePacked(raw, n.decimals);
      case TYPE_DECFLOAT16:
      case TYPE_DECFLOAT34: {
        const s = decodeDecfloat(raw);
        if (s !== undefined) return s;
        break;
      }
      default:
        break;
    }
    return raw.toString('hex').toUpperCase();
  }

  stringValue(n: Node, raw: Buffer): unknown {
    if (n.typeCode === TYPE_XSTRING) return raw.toString('hex').toUpperCase();
    return this.text(raw);
  }
}

export function newDecoder(codepage: string): Decoder {
  return new Decoder(codepage);
}

function decodeUtf16(raw: Buffer, bigEndian: boolean): string | undefined {
  if (raw.length % 2 !== 0) return undefined;
  const units = new Uint16Array(raw.length / 2);
  for (let i = 0; i < units.length; i++) {
    units[i] = bigEndian ? raw.readUInt16BE(2 * i) : raw.readUInt16LE(2 * i);
  }
  return String.fromCharCode(...units);
}

/** Decodes a whole buffer as UTF-16LE — how a Unicode system stores text it compresses on its own, source code included. */
export function utf16Text(raw: Buffer): string {
  const s = decodeUtf16(raw, false);
  if (s === undefined) throw new Error(`${raw.length} bytes is not a whole number of UTF-16 units`);
  return s;
}

/** Renders a BCD number: two digits per byte, the last nibble the sign (C/F positive, D negative). */
export function decodePacked(raw: Buffer, decimals: number): string {
  if (raw.length === 0) return '';
  let digits = '';
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i]!;
    digits += String(b >> 4);
    if (i < raw.length - 1) digits += String(b & 0x0f);
  }
  const sign = (raw[raw.length - 1]! & 0x0f) === 0x0d ? '-' : '';
  return sign + placeDecimal(digits, decimals);
}

/** Turns a digit string into a number with the decimal point placed from the right, leading zeros gone. */
export function placeDecimal(digitsIn: string, decimals: number): string {
  let digits = digitsIn;
  if (decimals > 0) {
    while (digits.length <= decimals) digits = `0${digits}`;
    digits = `${digits.slice(0, digits.length - decimals)}.${digits.slice(digits.length - decimals)}`;
  }
  let trimmed = digits.replace(/^0+/, '');
  if (trimmed === '' || trimmed[0] === '.') trimmed = `0${trimmed}`;
  return trimmed;
}

export { isStringType };
