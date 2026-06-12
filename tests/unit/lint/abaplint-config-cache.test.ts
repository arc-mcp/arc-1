import { Version } from '@abaplint/core';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clearAbaplintConfigCacheForTests,
  cloneDefaultAbaplintConfig,
  getDefaultAbaplintConfig,
} from '../../../src/lint/abaplint-config-cache.js';

describe('abaplint config cache', () => {
  afterEach(() => {
    clearAbaplintConfigCacheForTests();
  });

  it('reuses the same default Config for the same version', () => {
    const first = getDefaultAbaplintConfig(Version.Cloud);
    const second = getDefaultAbaplintConfig(Version.Cloud);

    expect(second).toBe(first);
  });

  it('keeps different versions in separate cache entries', () => {
    const cloud = getDefaultAbaplintConfig(Version.Cloud);
    const v702 = getDefaultAbaplintConfig(Version.v702);

    expect(v702).not.toBe(cloud);
  });

  it('returns isolated clones for mutable config builder callers', () => {
    const first = cloneDefaultAbaplintConfig(Version.Cloud);
    const firstRules = first.rules as Record<string, unknown>;
    firstRules.__arc1_test_marker = false;

    const second = cloneDefaultAbaplintConfig(Version.Cloud);
    const secondRules = second.rules as Record<string, unknown>;

    expect(secondRules.__arc1_test_marker).toBeUndefined();
  });
});
