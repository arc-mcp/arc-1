import { describe, expect, it } from 'vitest';
import {
  formatClientInfo,
  sanitizeClientAgent,
  traceHeaders,
  validateTraceparent,
  validateTracestate,
} from '../../../src/server/trace-context.js';

const VALID = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';

describe('validateTraceparent', () => {
  it('accepts a spec-shaped header', () => {
    expect(validateTraceparent(VALID)).toBe(VALID);
  });

  it('accepts the unsampled flag', () => {
    const unsampled = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00';
    expect(validateTraceparent(unsampled)).toBe(unsampled);
  });

  it('accepts a future version so a newer tracer still correlates', () => {
    const future = '01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    expect(validateTraceparent(future)).toBe(future);
  });

  it('forwards a higher version that appends fields after the 55-char prefix', () => {
    // Spec: a version above 00 may carry extra dash-delimited fields; a pass-through forwards them.
    const extended = '01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-ab12cd';
    expect(validateTraceparent(extended)).toBe(extended);
  });

  it('rejects extra fields on version 00 (spec: exactly 55 characters)', () => {
    expect(validateTraceparent(`${VALID}-ab12cd`)).toBeUndefined();
  });

  it('rejects a higher version whose appended field is not dash-delimited hex', () => {
    expect(validateTraceparent('01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01 evil')).toBeUndefined();
    expect(
      validateTraceparent('01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01-\r\nX-Injected: evil'),
    ).toBeUndefined();
  });

  it.each([
    ['version ff (forbidden by spec)', 'ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'],
    ['all-zero trace-id', '00-00000000000000000000000000000000-00f067aa0ba902b7-01'],
    ['all-zero parent-id', '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01'],
    ['uppercase hex', '00-4BF92F3577B34DA6A3CE929D0E0E4736-00f067aa0ba902b7-01'],
    ['short trace-id', '00-4bf92f3577b34da6a3ce929d0e473-00f067aa0ba902b7-01'],
    ['long parent-id', '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7ab-01'],
    ['missing flags', '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7'],
    ['trailing junk', `${VALID}-extra`],
    ['non-hex characters', '00-zzf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01'],
    ['empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(validateTraceparent(value)).toBeUndefined();
  });

  it('rejects a CRLF header-injection attempt', () => {
    expect(validateTraceparent(`${VALID}\r\nX-Injected: evil`)).toBeUndefined();
  });

  it('rejects non-string input', () => {
    expect(validateTraceparent(undefined)).toBeUndefined();
    expect(validateTraceparent(['00-a-b-01'])).toBeUndefined();
    expect(validateTraceparent(42)).toBeUndefined();
  });
});

describe('validateTracestate', () => {
  it('accepts vendor state alongside a valid traceparent', () => {
    expect(validateTracestate('rojo=00f067aa0ba902b7,congo=t61rcWkgMzE', VALID)).toBe(
      'rojo=00f067aa0ba902b7,congo=t61rcWkgMzE',
    );
  });

  it('drops tracestate when traceparent is absent (spec: MUST NOT travel alone)', () => {
    expect(validateTracestate('rojo=00f067aa0ba902b7', undefined)).toBeUndefined();
  });

  it('rejects a value over the 512-char cap', () => {
    expect(validateTracestate(`a=${'x'.repeat(520)}`, VALID)).toBeUndefined();
  });

  it('accepts HTAB, which the spec allows as optional whitespace between members', () => {
    expect(validateTracestate('rojo=1,\tcongo=2', VALID)).toBe('rojo=1,\tcongo=2');
  });

  it('rejects control characters', () => {
    expect(validateTracestate('rojo=1\r\nX-Injected: evil', VALID)).toBeUndefined();
    expect(validateTracestate('rojo=1\n', VALID)).toBeUndefined();
  });

  it('rejects non-string input', () => {
    expect(validateTracestate(undefined, VALID)).toBeUndefined();
    expect(validateTracestate(['rojo=1'], VALID)).toBeUndefined();
  });
});

describe('sanitizeClientAgent', () => {
  it('passes an ordinary user agent through', () => {
    expect(sanitizeClientAgent('claude-code/1.2.3')).toBe('claude-code/1.2.3');
  });

  it('strips control characters that would forge a log line', () => {
    expect(sanitizeClientAgent('evil\n{"event":"forged"}')).toBe('evil {"event":"forged"}');
  });

  it('truncates to 200 characters', () => {
    expect(sanitizeClientAgent('a'.repeat(500))).toHaveLength(200);
  });

  it('returns undefined for blank or non-string input', () => {
    expect(sanitizeClientAgent('   ')).toBeUndefined();
    expect(sanitizeClientAgent('')).toBeUndefined();
    expect(sanitizeClientAgent(undefined)).toBeUndefined();
    expect(sanitizeClientAgent(7)).toBeUndefined();
  });
});

describe('formatClientInfo', () => {
  it('joins name and version', () => {
    expect(formatClientInfo({ name: 'cursor', version: '0.44.1' })).toBe('cursor/0.44.1');
  });

  it('falls back to the name alone', () => {
    expect(formatClientInfo({ name: 'cursor' })).toBe('cursor');
    expect(formatClientInfo({ name: 'cursor', version: '  ' })).toBe('cursor');
  });

  it('returns undefined without a usable name', () => {
    expect(formatClientInfo(undefined)).toBeUndefined();
    expect(formatClientInfo({ version: '1.0.0' })).toBeUndefined();
  });
});

describe('traceHeaders', () => {
  it('forwards traceparent verbatim (ARC-1 is a non-participating pass-through)', () => {
    expect(traceHeaders({ traceparent: VALID })).toEqual({ traceparent: VALID });
  });

  it('forwards tracestate alongside traceparent', () => {
    expect(traceHeaders({ traceparent: VALID, tracestate: 'rojo=1' })).toEqual({
      traceparent: VALID,
      tracestate: 'rojo=1',
    });
  });

  it('emits nothing when the caller sent no trace context — never originates a trace', () => {
    expect(traceHeaders(undefined)).toEqual({});
    expect(traceHeaders({})).toEqual({});
    expect(traceHeaders({ tracestate: 'rojo=1' })).toEqual({});
  });
});
