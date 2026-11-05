import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prepareFunctionSourceVerification } from '../../../src/adt/source-precondition.js';

// Authored framing follows a GET-only A4H/758 lowercase signature observation. It is not a native PUT receipt.
const requested = `"! Parameter documentation.
FUNCTION ZARC1_FM
  IMPORTING
    VALUE(IV_TEXT) TYPE STRING DEFAULT 'MiXeD'
  EXPORTING
    EV_COUNT TYPE I.
  WRITE 'Keep Body Case'.
ENDFUNCTION.
* Preserve trailing note.
`;
const observedShape = `"! Parameter documentation.
function zarc1_fm
  importing
    value(iv_text) type string default 'MiXeD'
  exporting
    ev_count type i.
  WRITE 'Keep Body Case'.
endfunction.
* Preserve trailing note.
`;

describe('function source readback framing', () => {
  it('accepts case-normalized identifiers and CRLF with exact body and literal preservation', () => {
    const verify = prepareFunctionSourceVerification(requested, 'ZARC1_FM');
    expect(verify(observedShape.replaceAll('\n', '\r\n'))).toBe(true);
    expect(verify(requested)).toBe(true);
  });
  it.each([
    ["'MiXeD'", "'mixed'"],
    ["'Keep Body Case'", "'keep body case'"],
    ['WRITE', 'write'],
    ['iv_text', 'iv_other'],
    ['type string', 'type i'],
    ['exporting', 'changing'],
    ['value(iv_text)', 'iv_text'],
    ['ev_count', 'ev_total'],
    ['Parameter documentation.', 'Changed documentation.'],
    ['Preserve trailing note.', 'Changed trailing note.'],
  ])('refuses a native change from %s to %s', (before, after) => {
    expect(prepareFunctionSourceVerification(requested, 'ZARC1_FM')(observedShape.replace(before, after))).toBe(false);
  });
  it.each([
    requested.replace('FUNCTION ZARC1_FM', 'FUNCTION ZFOREIGN'),
    requested.replace('ENDFUNCTION.', ''),
    `${requested}WRITE 'outside function'.`,
    `FUNCTION ZARC1_FM\n IMPORTING\n IV_TEXT TYPE STRING${' '.repeat(64 * 1024)}.\nENDFUNCTION.`,
    `FUNCTION ZARC1_FM.\n${'x'.repeat(1024 * 1024)}\nENDFUNCTION.`,
  ])('rejects unprovable framing before saving', (source) => {
    expect(() => prepareFunctionSourceVerification(source, 'ZARC1_FM')).toThrow('No source save was sent');
  });
  it('refuses a body template containing a false ENDFUNCTION boundary before saving', () => {
    expect(() =>
      prepareFunctionSourceVerification(
        'FUNCTION ZARC1_FM.\n DATA(v) = |start\nENDFUNCTION.\nend|.\nENDFUNCTION.',
        'ZARC1_FM',
      ),
    ).toThrow('boundaries');
  });
});

const native = JSON.parse(
  readFileSync(new URL('../../fixtures/adt/function-source-a4h-readback.json', import.meta.url), 'utf8'),
);
it('matches the recorded native readback hash', () => {
  expect(createHash('sha256').update(native.readback).digest('hex')).toBe(native.readbackSha256);
});
it.each([0, 1, 7])('accepts %i empty body-padding lines but preserves whitespace-only lines', (count) => {
  const source = 'FUNCTION ZARC1_FM.\n  DATA(text) = 1.\nENDFUNCTION.';
  const verify = prepareFunctionSourceVerification(source, 'ZARC1_FM');
  expect(verify(source.replace('.\n  DATA', `.\n${'\n'.repeat(count)}  DATA`))).toBe(true);
  expect(verify(source.replace('.\n  DATA', '.\n \n  DATA'))).toBe(false);
});
it.each(['putResponse', 'readback'])('accepts the captured A4H native %s with generated empty-line padding', (key) => {
  expect(prepareFunctionSourceVerification(native.requested, native.functionName)(native[key])).toBe(true);
});
it('preserves internal empty lines and indentation within a body template', () => {
  const source = 'FUNCTION ZARC1_FM.\n  DATA(text) = |first\n\nlast|.\nENDFUNCTION.';
  const padded = source.replace('.\n  DATA', '.\n\n\n\n  DATA');
  const verify = prepareFunctionSourceVerification(source, 'ZARC1_FM');
  expect(verify(padded)).toBe(true);
  expect(verify(padded.replace('first\n\nlast', 'first\nlast'))).toBe(false);
  expect(verify(padded.replace('  DATA', ' DATA'))).toBe(false);
});
