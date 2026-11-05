import { describe, expect, it } from 'vitest';
import { isIncludeSaveResult } from '../../../scripts/qualification/pr1142/include-qualification.mjs';

const expected = { target: 'PR1142/001', name: 'ZARC1_TEST', include: 'testclasses', initialized: true };
const saved = { ...expected, state: 'saved-inactive', action: 'update', type: 'CLAS', sourceHash: 'a'.repeat(64) };

describe('include save evidence contract', () => {
  it('accepts a complete save without inventing an ok field', () => {
    expect(isIncludeSaveResult(saved, expected)).toBe(true);
    expect(saved).not.toHaveProperty('ok');
  });
  it.each([
    ['state', 'unchanged'],
    ['action', 'create'],
    ['target', 'OTHER/001'],
    ['type', 'INTF'],
    ['name', 'ZARC1_OTHER'],
    ['include', 'definitions'],
    ['initialized', false],
    ['sourceHash', 'a'.repeat(63)],
    ['sourceHash', 'A'.repeat(64)],
    ['sourceHash', 123],
  ])('refuses a contradictory %s field', (key, value) => {
    expect(isIncludeSaveResult({ ...saved, [key as string]: value }, expected)).toBe(false);
  });
  it.each(Object.keys(saved))('refuses missing %s evidence', (key) => {
    const incomplete: Record<string, unknown> = { ...saved };
    delete incomplete[key];
    expect(isIncludeSaveResult(incomplete, expected)).toBe(false);
  });
  it.each([null, undefined, {}, []])('refuses an incomplete response: %j', (body) => {
    expect(isIncludeSaveResult(body, expected)).toBe(false);
  });
});
