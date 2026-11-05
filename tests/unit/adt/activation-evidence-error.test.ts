import { expect, it } from 'vitest';
import { ActivationEvidenceError } from '../../../src/adt/activation-evidence-error.js';

it('bounds native diagnostics independently from the safe exception message', () => {
  const text = 'PRIVATE_NATIVE_TEXT'.repeat(100);
  const error = new ActivationEvidenceError(
    Array(8).fill(text),
    Array.from({ length: 8 }, () => ({ severity: 'error' as const, text, uri: `/${text}` })),
  );
  expect(error.message).not.toContain('PRIVATE_NATIVE_TEXT');
  expect(error.nativeActivation.messages).toHaveLength(5);
  expect(error.nativeActivation.details).toHaveLength(5);
  for (const message of error.nativeActivation.messages) expect(message).toBe(text.slice(0, 500));
  for (const detail of error.nativeActivation.details!) {
    expect(detail.text).toBe(text.slice(0, 500));
    expect(detail.uri).toHaveLength(500);
  }
});
