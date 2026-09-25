/**
 * decfloat16 and decfloat34 are IEEE 754-2008 decimal64 and decimal128 in the
 * densely-packed-decimal encoding, stored little-endian. The value is
 * coefficient × 10^exponent; the coefficient's leading digit lives in the
 * combination field and the rest in ten-bit declets of three digits each.
 *
 * Ported from vibing-steampunk's `pkg/datacluster/decfloat.go` (same MIT
 * license, same original author).
 */

import { placeDecimal } from './values.js';

function signed(sign: number, s: string): string {
  return sign === 1 ? `-${s}` : s;
}

/** Expands ten densely-packed bits into three decimal digits, after Cowlishaw's table. */
function declet(d: number): [number, number, number] {
  const p = (d >> 9) & 1;
  const q = (d >> 8) & 1;
  const r = (d >> 7) & 1;
  const s = (d >> 6) & 1;
  const t = (d >> 5) & 1;
  const u = (d >> 4) & 1;
  const v = (d >> 3) & 1;
  const w = (d >> 2) & 1;
  const x = (d >> 1) & 1;
  const y = d & 1;
  const three = (a: number, b: number, c: number): number => (a << 2) | (b << 1) | c;
  if (v === 0) return [three(p, q, r), three(s, t, u), three(w, x, y)];
  switch ((w << 1) | x) {
    case 0b00:
      return [three(p, q, r), three(s, t, u), 8 + y];
    case 0b01:
      return [three(p, q, r), 8 + u, three(s, t, y)];
    case 0b10:
      return [8 + r, three(s, t, u), three(p, q, y)];
    default:
      break;
  }
  // w x == 11: the s t bits say which two digits are large.
  switch ((s << 1) | t) {
    case 0b00:
      return [8 + r, 8 + u, three(p, q, y)];
    case 0b01:
      return [8 + r, three(p, q, u), 8 + y];
    case 0b10:
      return [three(p, q, r), 8 + u, 8 + y];
    default:
      return [8 + r, 8 + u, 8 + y];
  }
}

/** Decodes a densely-packed-decimal float (8 or 16 raw bytes) into a decimal string, or returns undefined. */
export function decodeDecfloat(raw: Buffer): string | undefined {
  let expBits: number;
  let declets: number;
  let bias: number;
  if (raw.length === 8) {
    expBits = 8;
    declets = 5;
    bias = 398;
  } else if (raw.length === 16) {
    expBits = 12;
    declets = 11;
    bias = 6176;
  } else {
    return undefined;
  }
  // Big-endian working copy, mirroring the raw little-endian bytes.
  const bits = Buffer.alloc(raw.length);
  for (let i = 0; i < raw.length; i++) bits[raw.length - 1 - i] = raw[i]!;

  const bit = (i: number): number => (bits[i >> 3]! >> (7 - (i % 8))) & 1; // i counted from the MSB
  const field = (from: number, n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) v = (v << 1) | bit(from + i);
    return v;
  };

  const sign = bit(0);
  const comb = field(1, 5);
  let msd: number;
  let expHigh: number;
  if (comb >> 3 === 0b11) {
    if (comb === 0b11110) return signed(sign, 'Inf');
    if (comb === 0b11111) return 'NaN';
    expHigh = (comb >> 1) & 0b11;
    msd = 8 + (comb & 1);
  } else {
    expHigh = comb >> 3;
    msd = comb & 0b111;
  }
  const exponent = ((expHigh << expBits) | field(6, expBits)) - bias;

  let digits = String(msd);
  let pos = 6 + expBits;
  for (let i = 0; i < declets; i++) {
    const d = field(pos, 10);
    pos += 10;
    const [a, b, c] = declet(d);
    digits += `${a}${b}${c}`;
  }
  if (exponent >= 0) {
    return signed(sign, BigInt(digits + '0'.repeat(exponent)).toString());
  }
  return signed(sign, placeDecimal(digits, -exponent));
}
