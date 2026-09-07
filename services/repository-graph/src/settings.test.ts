import { afterEach, describe, expect, it } from 'vitest';
import { integerSetting } from './settings.js';

afterEach(() => {
  delete process.env.TEST_INTEGER_SETTING;
});

describe('integerSetting', () => {
  it('uses the fallback for missing and invalid values', () => {
    expect(integerSetting('TEST_INTEGER_SETTING', 4, 1, 5)).toBe(4);
    process.env.TEST_INTEGER_SETTING = 'invalid';
    expect(integerSetting('TEST_INTEGER_SETTING', 4, 1, 5)).toBe(4);
  });

  it('truncates and clamps configured values', () => {
    process.env.TEST_INTEGER_SETTING = '9.8';
    expect(integerSetting('TEST_INTEGER_SETTING', 4, 1, 5)).toBe(5);
  });
});
