import { describe, expect, it } from 'vitest';
import { isErrorLogLine, readHealthField, summarizeLogErrors } from '../../../scripts/e2e-local-utils.mjs';

describe('e2e-local-utils', () => {
  describe('readHealthField', () => {
    it('reads scalar fields from health JSON', () => {
      const raw = JSON.stringify({
        version: '0.9.6',
        startedAt: '2026-05-27T10:00:00.000Z',
        healthy: true,
      });

      expect(readHealthField(raw, 'version')).toBe('0.9.6');
      expect(readHealthField(raw, 'startedAt')).toBe('2026-05-27T10:00:00.000Z');
      expect(readHealthField(raw, 'healthy')).toBe('true');
    });

    it('returns unknown for missing, object, or malformed fields', () => {
      expect(readHealthField('{"version":"0.9.6"}', 'startedAt')).toBe('unknown');
      expect(readHealthField('{"version":{"nested":true}}', 'version')).toBe('unknown');
      expect(readHealthField('{not-json', 'version')).toBe('unknown');
    });
  });

  describe('isErrorLogLine', () => {
    it('detects JSON error log entries', () => {
      expect(isErrorLogLine('{"timestamp":"2026-05-27T10:00:00.000Z","level":"error","message":"failed"}')).toBe(true);
      expect(isErrorLogLine('{"timestamp":"2026-05-27T10:00:00.000Z","level":"ERROR","message":"failed"}')).toBe(true);
    });

    it('detects default text logger error entries', () => {
      expect(isErrorLogLine('[2026-05-27T10:00:00.000Z] ERROR: activation failed')).toBe(true);
    });

    it('ignores non-error lines and malformed JSON', () => {
      expect(isErrorLogLine('{"level":"info","message":"ready"}')).toBe(false);
      expect(isErrorLogLine('[2026-05-27T10:00:00.000Z] WARN: warning')).toBe(false);
      expect(isErrorLogLine('{not-json')).toBe(false);
      expect(isErrorLogLine('')).toBe(false);
    });
  });

  describe('summarizeLogErrors', () => {
    it('counts text and JSON error lines and keeps the last five', () => {
      const log = [
        '[2026-05-27T10:00:00.000Z] INFO: ready',
        '[2026-05-27T10:00:01.000Z] ERROR: one',
        '{"level":"error","message":"two"}',
        '[2026-05-27T10:00:03.000Z] ERROR: three',
        '{"level":"error","message":"four"}',
        '[2026-05-27T10:00:05.000Z] ERROR: five',
        '[2026-05-27T10:00:06.000Z] ERROR: six',
      ].join('\n');

      const summary = summarizeLogErrors(log);

      expect(summary.lineCount).toBe(7);
      expect(summary.errorCount).toBe(6);
      expect(summary.lastErrors).toHaveLength(5);
      expect(summary.lastErrors[0]).toContain('"two"');
      expect(summary.lastErrors.at(-1)).toContain('six');
    });

    it('handles empty logs', () => {
      expect(summarizeLogErrors('')).toEqual({
        lineCount: 0,
        errorCount: 0,
        lastErrors: [],
      });
    });
  });
});
