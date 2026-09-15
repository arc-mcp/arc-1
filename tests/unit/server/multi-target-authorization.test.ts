import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { describe, expect, it, vi } from 'vitest';
import {
  isTargetGranted,
  parseTargetGrant,
  projectGrantedTargets,
  type TargetGrant,
} from '../../../src/server/multi-target-authorization.js';

function auth(values: unknown, status: unknown = 'valid'): Pick<AuthInfo, 'extra'> {
  return {
    extra: {
      xsuaaUserAttributes: { arc1_targets: values },
      xsuaaUserAttributeStatus: { arc1_targets: status },
    },
  };
}

const ids = (count: number) => Array.from({ length: count }, (_, index) => `A4H/${String(index).padStart(3, '0')}`);
const missing = { mode: 'none', status: 'TARGET_GRANT_MISSING' };
const invalid = { mode: 'none', status: 'TARGET_GRANT_MALFORMED' };
const exceeded = { mode: 'none', status: 'TARGET_GRANT_LIMIT_EXCEEDED' };

describe('verified XSUAA target grant parsing', () => {
  it('accepts a scalar from the verified boundary and freezes the canonical exact result', () => {
    const grant = parseTargetGrant(auth('  a4h-2025/001  '));
    expect(grant).toEqual({ mode: 'exact', status: 'valid', targets: ['A4H-2025/001'], exactGrantCount: 1 });
    expect(Object.isFrozen(grant)).toBe(true);
    if (grant.mode !== 'exact') throw new Error('Expected exact grant');
    expect(Object.isFrozen(grant.targets)).toBe(true);
    expect(() => (grant.targets as string[]).push('ABC/100')).toThrow();
  });

  it('deduplicates after canonicalization without mutating or retaining the input array', () => {
    const values = ['A4H/100', ' a4h/001 ', 'a4h/100'];
    const grant = parseTargetGrant(auth(values));
    expect(grant).toEqual({ mode: 'exact', status: 'valid', targets: ['A4H/001', 'A4H/100'], exactGrantCount: 2 });
    expect(values).toEqual(['A4H/100', ' a4h/001 ', 'a4h/100']);
    values.push('*');
    expect(isTargetGranted(grant, 'ABC/999')).toBe(false);
  });

  it.each([undefined, {}, { extra: {} }, { extra: { arc1_targets: ['*'] } }])(
    'does not scan missing/unrelated attribute locations: %j',
    (input) => expect(parseTargetGrant(input)).toEqual(missing),
  );

  it.each([
    ['missing', missing],
    ['invalid', invalid],
    ['limit_exceeded', exceeded],
    ['unexpected', invalid],
    [undefined, invalid],
  ])('honors extraction status %s instead of accepting stray values', (status, expected) => {
    const input = auth(['*']);
    input.extra!.xsuaaUserAttributeStatus = { arc1_targets: status };
    expect(parseTargetGrant(input)).toEqual(expected);
  });

  it('treats valid-empty as missing and valid-without-values as malformed', () => {
    expect(parseTargetGrant(auth([]))).toEqual(missing);
    expect(parseTargetGrant(auth(undefined))).toEqual(invalid);
  });

  it.each([null, false, 1, {}, '', '   ', ['A4H/001', false], ['A4H/001', null], ['A4H/001', '']])(
    'rejects the complete malformed value %j',
    (value) => expect(parseTargetGrant(auth(value))).toEqual(invalid),
  );

  it.each([
    'A4H/*',
    'A4*',
    'A4H',
    'A4H/1',
    'A4H/0001',
    'A4H/001,A4H/100',
    'A4H/001\nA4H/100',
    'https://a4h.example/001',
    'A4H/001/mcp',
    '/A4H/001',
    'A4H/001/..',
    'A4H/001?x=1',
    'A4H/001#fragment',
    'A4H%2F001',
    'A4H/００１',
    'A4H\u0000/001',
    'AB/001',
    '-A4H/001',
    'A4H-/001',
    '1A4H/001',
    `${'A'.repeat(33)}/001`,
    '__proto__',
    'constructor',
    'Unrestricted',
  ])('rejects unsupported syntax %s even alongside an all-target value', (value) => {
    expect(parseTargetGrant(auth(['A4H/001', value]))).toEqual(invalid);
    expect(parseTargetGrant(auth(['*', value]))).toEqual(invalid);
  });

  it.each(['*', ['*'], ['A4H/001', ' * ', 'a4h/001']])(
    'accepts only a validated full all-target grant: %j',
    (value) => {
      const grant = parseTargetGrant(auth(value));
      expect(grant).toEqual({ mode: 'all', status: 'valid' });
      expect(Object.isFrozen(grant)).toBe(true);
      expect(grant).not.toHaveProperty('targets');
      expect(grant).not.toHaveProperty('exactGrantCount');
    },
  );

  it('enforces raw entry bounds before deduplicating even a list of stars', () => {
    expect(parseTargetGrant(auth(Array(1_024).fill('A4H/001'))).mode).toBe('exact');
    expect(parseTargetGrant(auth(Array(1_025).fill('A4H/001')))).toEqual(exceeded);
    expect(parseTargetGrant(auth(Array(1_025).fill('*')))).toEqual(exceeded);
    expect(parseTargetGrant(auth(new Array(1_025)))).toEqual(exceeded);
    expect(parseTargetGrant(auth(new Array(1)))).toEqual(invalid);
  });

  it('enforces the original UTF-8 entry bound before trimming', () => {
    expect(parseTargetGrant(auth(`${' '.repeat(121)}A4H/001`)).mode).toBe('exact');
    expect(parseTargetGrant(auth(`${' '.repeat(122)}A4H/001`))).toEqual(exceeded);
    expect(parseTargetGrant(auth(`${'\u2003'.repeat(40)} A4H/001`)).mode).toBe('exact');
    expect(parseTargetGrant(auth(`${'\u2003'.repeat(41)}A4H/001`))).toEqual(exceeded);
  });

  it('enforces summed original bytes before deduplication or star collapse', () => {
    const value = `${' '.repeat(121)}A4H/001`;
    expect(parseTargetGrant(auth(Array(128).fill(value))).mode).toBe('exact');
    expect(parseTargetGrant(auth(Array(129).fill(value)))).toEqual(exceeded);
    expect(parseTargetGrant(auth(['*', ...Array(128).fill(value)]))).toEqual(exceeded);
  });

  it('counts unique canonical IDs, including unknown IDs and star, before star collapse', () => {
    expect(parseTargetGrant(auth(ids(256)))).toMatchObject({ mode: 'exact', exactGrantCount: 256 });
    expect(parseTargetGrant(auth(ids(257)))).toEqual(exceeded);
    expect(parseTargetGrant(auth(['*', ...ids(255)]))).toEqual({ mode: 'all', status: 'valid' });
    expect(parseTargetGrant(auth(['*', ...ids(256)]))).toEqual(exceeded);
  });

  it('ignores inherited values and accessors at every boundary', () => {
    const input = auth(['A4H/001']);
    input.extra!.xsuaaUserAttributes = Object.create({ arc1_targets: ['*'] });
    expect(parseTargetGrant(input)).toEqual(invalid);
    const getter = vi.fn(() => ['*']);
    input.extra!.xsuaaUserAttributes = Object.defineProperty({}, 'arc1_targets', { get: getter });
    expect(parseTargetGrant(input)).toEqual(invalid);
    expect(getter).not.toHaveBeenCalled();
    expect(parseTargetGrant(Object.create(auth(['*'])))).toEqual(missing);
  });

  it('does not copy prototype-shaped unrelated fields into grants', () => {
    const input = auth(['A4H/001']);
    input.extra!.xsuaaUserAttributes = JSON.parse('{"__proto__":{"polluted":true},"arc1_targets":["A4H/001"]}');
    expect(parseTargetGrant(input)).toMatchObject({ mode: 'exact', targets: ['A4H/001'] });
    expect({}).not.toHaveProperty('polluted');
  });

  it('returns safe failure metadata, retains no malformed claim, and does not log', () => {
    const spies = ['log', 'info', 'warn', 'error', 'debug'].map((method) =>
      vi.spyOn(console, method as 'log').mockImplementation(() => undefined),
    );
    try {
      const grant = parseTargetGrant(auth(['*', 'DO_NOT_LOG_RAW_ATTRIBUTE_SENTINEL']));
      expect(grant).toEqual(invalid);
      expect(Object.isFrozen(grant)).toBe(true);
      expect(JSON.stringify(grant)).not.toContain('DO_NOT_LOG_RAW_ATTRIBUTE_SENTINEL');
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('target grant policy and projection', () => {
  const registry = Object.freeze([
    Object.freeze({ target: 'A4H/100', description: 'Test' }),
    Object.freeze({ target: 'A4H/001', description: 'Development' }),
    Object.freeze({ target: 'A4H-2025/001', description: 'Independent system' }),
  ]);

  it('projects only known granted targets and preserves immutable registry entries/order', () => {
    const grant = parseTargetGrant(auth(['A4H/001', 'A4H/100', 'ZZZ/999']));
    const projection = projectGrantedTargets(registry, grant);
    expect(projection).toEqual(registry.slice(0, 2));
    expect(projection[0]).toBe(registry[0]);
    expect(Object.isFrozen(projection)).toBe(true);
    expect(JSON.stringify(projection)).not.toContain('ZZZ/999');
    expect(registry).toHaveLength(3);
    expect(grant).toMatchObject({ exactGrantCount: 3 });
  });

  it('does not infer all-target or execution access from no matching active target', () => {
    for (const grant of [parseTargetGrant(), parseTargetGrant(auth(['ZZZ/999']))]) {
      expect(projectGrantedTargets(registry, grant)).toEqual([]);
      expect(isTargetGranted(grant, 'A4H/001')).toBe(false);
      expect(Object.isFrozen(projectGrantedTargets(registry, grant))).toBe(true);
    }
  });

  it('keeps aliases separate and matches only canonical target IDs', () => {
    const grant = parseTargetGrant(auth(['A4H/001']));
    expect(isTargetGranted(grant, 'A4H/001')).toBe(true);
    for (const target of ['A4H/100', 'A4H-2025/001', 'a4h/001', ' A4H/001', 'A4H/*', '*']) {
      expect(isTargetGranted(grant, target)).toBe(false);
    }
  });

  it('allows future canonical IDs only with an explicit all-target grant', () => {
    const grant = parseTargetGrant(auth('*'));
    expect(projectGrantedTargets(registry, grant)).toEqual(registry);
    expect(isTargetGranted(grant, 'NEW/777')).toBe(true);
    for (const target of ['', 'a4h/001', 'A4H/*', '*', 'A4H/001\n', 'A4H/001/mcp', `${'A'.repeat(33)}/001`]) {
      expect(isTargetGranted(grant, target)).toBe(false);
    }
  });

  it('does not carry grants between users or subsequent token versions', () => {
    const first = parseTargetGrant(auth(['A4H/001']));
    const second = parseTargetGrant(auth(['A4H/100']));
    const removed = parseTargetGrant();
    for (const grant of [first, second, removed, second, first]) {
      const expected = grant === first ? [registry[1]] : grant === second ? [registry[0]] : [];
      expect(projectGrantedTargets(registry, grant)).toEqual(expected);
    }
  });

  it('keeps the documented union of targets independent from global capability scopes', () => {
    const base = auth(['A4H/001', 'A4H/100']);
    const grants: TargetGrant[] = ['read', 'data', 'sql', 'admin'].map((scope) =>
      parseTargetGrant({ ...base, scopes: [scope] } as AuthInfo),
    );
    for (const grant of grants) expect(projectGrantedTargets(registry, grant)).toEqual(registry.slice(0, 2));
    expect(parseTargetGrant({ extra: { scopes: ['admin'] } })).toEqual(missing);
  });
});
