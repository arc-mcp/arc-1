import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const seaState = vi.hoisted(() => ({ requested: [] as string[] }));

vi.mock('node:sea', () => ({
  isSea: () => true,
  getAsset: (key: string) => {
    seaState.requested.push(key);
    return readFileSync(join(process.cwd(), 'src', 'aff', 'schemas', key.replace('aff/', '')), 'utf8');
  },
}));

import { resetValidatorCache, validateAffHeader } from '../../../src/aff/validator.js';

describe('AFF validator inside a single-executable build', () => {
  beforeEach(() => {
    seaState.requested.length = 0;
    resetValidatorCache();
  });

  it('reads schemas from embedded assets instead of the file system', () => {
    const result = validateAffHeader('CLAS', { description: 'A'.repeat(61), originalLanguage: 'en' });

    expect(seaState.requested).toEqual(['aff/clas-v1.json']);
    expect(result.valid).toBe(false);
  });
});
