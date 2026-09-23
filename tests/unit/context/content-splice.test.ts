import { describe, expect, it } from 'vitest';
import { spliceContent } from '../../../src/context/content-splice.js';

describe('spliceContent', () => {
  it('replaces the single match', () => {
    const result = spliceContent(
      "REPORT ztest.\nWRITE 'old value'.\nWRITE 'kept line'.",
      "WRITE 'old value'.",
      "WRITE 'new value'.",
    );
    expect(result.outcome).toBe('spliced');
    expect(result.newSource).toBe("REPORT ztest.\nWRITE 'new value'.\nWRITE 'kept line'.");
  });

  it('deletes oldContent when newContent is empty', () => {
    const result = spliceContent(
      "REPORT ztest.\nWRITE 'to be removed'.\nWRITE 'kept line'.",
      "WRITE 'to be removed'.\n",
      '',
    );
    expect(result.outcome).toBe('spliced');
    expect(result.newSource).toBe("REPORT ztest.\nWRITE 'kept line'.");
  });

  it('errors with no matches and no idempotent no-op available', () => {
    const result = spliceContent("REPORT ztest.\nWRITE 'kept line'.", "WRITE 'missing line'.", "WRITE 'new value'.");
    expect(result.outcome).toBe('error');
    expect(result.error).toMatch(/not found/i);
  });

  it('reports an idempotent no-op when oldContent is absent but newContent already holds uniquely', () => {
    const result = spliceContent(
      "REPORT ztest.\nWRITE 'new value'.\nWRITE 'kept line'.",
      "WRITE 'old value'.",
      "WRITE 'new value'.",
    );
    expect(result.outcome).toBe('already-applied');
    expect(result.newSource).toBeUndefined();
  });

  it('does not guess already-applied when newContent is empty (deletion cannot be confirmed)', () => {
    const result = spliceContent("REPORT ztest.\nWRITE 'kept line'.", "WRITE 'to be removed'.\n", '');
    expect(result.outcome).toBe('error');
  });

  it('does not guess already-applied when newContent itself is ambiguous', () => {
    const result = spliceContent(
      "REPORT ztest.\nWRITE 'new value'.\nWRITE 'new value'.",
      "WRITE 'old value'.",
      "WRITE 'new value'.",
    );
    expect(result.outcome).toBe('error');
    expect(result.error).toMatch(/not found/i);
  });

  it('errors on an ambiguous oldContent match, listing each line', () => {
    const result = spliceContent("WRITE 'dup'.\nWRITE 'other'.\nWRITE 'dup'.", "WRITE 'dup'.", "WRITE 'changed'.");
    expect(result.outcome).toBe('error');
    expect(result.error).toMatch(/ambiguous/i);
    expect(result.error).toContain('1');
    expect(result.error).toContain('3');
  });

  it('rejects empty oldContent', () => {
    const result = spliceContent("WRITE 'x'.", '', "WRITE 'y'.");
    expect(result.outcome).toBe('error');
    expect(result.error).toMatch(/non-empty/);
  });

  it('scopes the search to a line window — match inside the window is found', () => {
    const source = "WRITE 'dup'.\nWRITE 'other'.\nWRITE 'dup'.\nWRITE 'tail'.";
    const result = spliceContent(source, "WRITE 'dup'.", "WRITE 'changed'.", 3, 4);
    expect(result.outcome).toBe('spliced');
    expect(result.newSource).toBe("WRITE 'dup'.\nWRITE 'other'.\nWRITE 'changed'.\nWRITE 'tail'.");
  });

  it('scopes the search to a line window — the same text outside the window is not found', () => {
    const source = "WRITE 'target'.\nWRITE 'other'.\nWRITE 'foo'.\nWRITE 'bar'.";
    const result = spliceContent(source, "WRITE 'target'.", "WRITE 'changed'.", 3, 4);
    expect(result.outcome).toBe('error');
    expect(result.error).toMatch(/lines 3-4/);
  });

  it('requires both lineStart and lineEnd together', () => {
    const result = spliceContent("WRITE 'x'.", "WRITE 'x'.", "WRITE 'y'.", 2, undefined);
    expect(result.outcome).toBe('error');
    expect(result.error).toMatch(/lineStart and lineEnd are required together/);
  });

  it('surfaces line-window validation errors (e.g. lineStart past end of source)', () => {
    const result = spliceContent("WRITE 'x'.\nWRITE 'y'.", "WRITE 'x'.", "WRITE 'z'.", 10, 12);
    expect(result.outcome).toBe('error');
    expect(result.error).toMatch(/past the end/);
  });

  it('preserves CRLF line endings', () => {
    const source = "REPORT ztest.\r\nWRITE 'old'.\r\nWRITE 'kept'.";
    const result = spliceContent(source, "WRITE 'old'.", "WRITE 'new'.");
    expect(result.outcome).toBe('spliced');
    expect(result.newSource).toBe("REPORT ztest.\r\nWRITE 'new'.\r\nWRITE 'kept'.");
  });

  it('replaces a multi-line oldContent spanning several lines', () => {
    const source = "FORM foo.\n  WRITE 'first'.\n  WRITE 'second'.\nENDFORM.";
    const result = spliceContent(
      source,
      "  WRITE 'first'.\n  WRITE 'second'.",
      "  WRITE 'first changed'.\n  WRITE 'second changed'.",
    );
    expect(result.outcome).toBe('spliced');
    expect(result.newSource).toBe("FORM foo.\n  WRITE 'first changed'.\n  WRITE 'second changed'.\nENDFORM.");
  });
});
