import { describe, expect, it } from 'vitest';
import { expectToolSuccess } from '../../e2e/helpers.js';

describe('E2E success assertions', () => {
  const base = { type: 'text', text: 'define structure zroot { field : abap.char(1); }' };
  it('keeps base-source assertions separate from extension context', () => {
    expect(expectToolSuccess({ content: [base, { type: 'text', text: '[extensions] {}' }] })).toBe(base.text);
    expect(expectToolSuccess({ content: [base] })).toBe(base.text);
  });
  it.each([
    { content: [] },
    { content: [base], isError: true },
    { content: [base, { type: 'text', text: '' }] },
    { content: [base, { type: 'image', text: 'unexpected' }] },
  ])('still rejects unsuccessful or malformed results', (result) => {
    expect(() => expectToolSuccess(result)).toThrow();
  });
});
