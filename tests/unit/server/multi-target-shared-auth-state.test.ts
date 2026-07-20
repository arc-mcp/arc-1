import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MultiTargetSharedAuthState,
  SHARED_AUTH_BLOCKED_RETENTION_MS,
  SHARED_AUTH_MAX_BLOCKED_GENERATIONS,
  SHARED_AUTH_MAX_TARGETS,
  SHARED_AUTH_QUEUE_LIMIT,
  SharedAuthBlockedError,
  SharedAuthBusyError,
} from '../../../src/server/multi-target-shared-auth-state.js';

const KEY = new Uint8Array(32).fill(7);

function reachableStrings(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  if (value instanceof Map) {
    return Array.from(value.entries()).flatMap(([key, entry]) => [
      ...reachableStrings(key, seen),
      ...reachableStrings(entry, seen),
    ]);
  }
  if (value instanceof Set) return Array.from(value).flatMap((entry) => reachableStrings(entry, seen));
  return Object.values(value as Record<string, unknown>).flatMap((entry) => reachableStrings(entry, seen));
}

function state(options: ConstructorParameters<typeof MultiTargetSharedAuthState>[0] = {}) {
  return new MultiTargetSharedAuthState({ hmacKey: KEY, ...options });
}

async function blockCredential(
  guard: MultiTargetSharedAuthState,
  target: string,
  username: string,
  password: string,
  kind: 'authentication' | 'authorization' = 'authentication',
) {
  await guard.runExclusive(target, (lease) => {
    lease.bindCredentials(username, password);
    if (kind === 'authentication') lease.markAuthenticationFailed();
    else lease.markAuthorizationFailed();
  });
}

describe('MultiTargetSharedAuthState', () => {
  afterEach(() => vi.useRealTimers());

  it('serializes complete calls for one target', async () => {
    const guard = state();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const first = guard.runExclusive('A4H/100', async () => {
      order.push('first-start');
      await firstCanFinish;
      order.push('first-end');
    });
    const second = guard.runExclusive('A4H/100', () => {
      order.push('second');
    });

    await vi.waitFor(() => expect(order).toEqual(['first-start']));
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-start', 'first-end', 'second']);
  });

  it('allows different targets to run concurrently', async () => {
    const guard = state();
    let active = 0;
    let peak = 0;
    let release!: () => void;
    const finish = new Promise<void>((resolve) => {
      release = resolve;
    });
    const invoke = (target: string) =>
      guard.runExclusive(target, async () => {
        active += 1;
        peak = Math.max(peak, active);
        await finish;
        active -= 1;
      });

    const calls = [invoke('A4H/100'), invoke('NPL/001')];
    await vi.waitFor(() => expect(peak).toBe(2));
    release();
    await Promise.all(calls);
  });

  it('rejects the 33rd waiter with SAP_TARGET_BUSY and drains queued leases', async () => {
    const guard = state();
    const active = await guard.acquire('A4H/100');
    const queued = Array.from({ length: SHARED_AUTH_QUEUE_LIMIT }, () => guard.acquire('A4H/100'));

    await expect(guard.acquire('A4H/100')).rejects.toMatchObject({
      code: 'SAP_TARGET_BUSY',
      reason: 'queue_full',
      retryable: true,
    });

    active.release();
    for (const pending of queued) {
      const lease = await pending;
      lease.release();
    }
  });

  it('times out acquisition, removes the waiter, and never receives a stale lease', async () => {
    vi.useFakeTimers();
    const guard = state({ acquisitionTimeoutMs: 25 });
    const active = await guard.acquire('A4H/100');
    const timedOut = guard.acquire('A4H/100');
    const timedOutAssertion = expect(timedOut).rejects.toMatchObject({
      code: 'SAP_TARGET_BUSY',
      reason: 'acquisition_timeout',
    });

    await vi.advanceTimersByTimeAsync(25);
    await timedOutAssertion;
    active.release();
    const next = await guard.acquire('A4H/100');
    next.release();
  });

  it('always releases runExclusive after a thrown callback', async () => {
    const guard = state();
    await expect(
      guard.runExclusive('A4H/100', () => {
        throw new Error('handler failed');
      }),
    ).rejects.toThrow('handler failed');
    await expect(guard.runExclusive('A4H/100', () => 'next')).resolves.toBe('next');
  });

  it('reports safe health transitions without credentials or generations', async () => {
    let now = Date.parse('2026-07-20T10:00:00.000Z');
    const guard = state({ now: () => now });
    expect(guard.getHealth('A4H/100')).toEqual({ status: 'not_checked' });

    const lease = await guard.acquire('A4H/100');
    const sentinelUser = 'SENTINEL_BASIC_USER';
    const sentinelPassword = 'SENTINEL_BASIC_PASSWORD';
    expect(lease.bindCredentials(sentinelUser, sentinelPassword)).toEqual({ changed: true });
    expect(guard.getHealth('A4H/100')).toEqual({ status: 'checking' });
    now += 1_000;
    lease.markHealthy();
    expect(guard.getHealth('A4H/100')).toEqual({
      status: 'healthy',
      checkedAt: '2026-07-20T10:00:01.000Z',
    });
    expect(JSON.stringify(guard.getHealth('A4H/100'))).not.toContain(sentinelUser);
    expect(JSON.stringify(guard.getHealth('A4H/100'))).not.toContain(sentinelPassword);
    expect(JSON.stringify(guard)).not.toContain(sentinelUser);
    expect(JSON.stringify(guard)).not.toContain(sentinelPassword);
    expect(reachableStrings(guard)).not.toContain(sentinelUser);
    expect(reachableStrings(guard)).not.toContain(sentinelPassword);
    lease.release();
  });

  it('tracks changed credential generations without exposing their value', async () => {
    const guard = state();
    await guard.runExclusive('A4H/100', (lease) => {
      expect(lease.bindCredentials('USER', 'ONE')).toEqual({ changed: true });
      lease.markHealthy();
    });
    await guard.runExclusive('A4H/100', (lease) => {
      expect(lease.bindCredentials('USER', 'ONE')).toEqual({ changed: false });
      lease.markHealthy();
    });
    await guard.runExclusive('A4H/100', (lease) => {
      expect(lease.bindCredentials('USER', 'TWO')).toEqual({ changed: true });
      lease.markHealthy();
    });
  });

  it('blocks a rejected generation locally across an old-new-old sequence', async () => {
    const guard = state();
    await blockCredential(guard, 'A4H/100', 'USER', 'OLD');
    await guard.runExclusive('A4H/100', (lease) => {
      expect(lease.bindCredentials('USER', 'NEW')).toEqual({ changed: true });
      lease.markHealthy();
    });

    await expect(guard.runExclusive('A4H/100', (lease) => lease.bindCredentials('USER', 'OLD'))).rejects.toMatchObject({
      code: 'SAP_AUTHENTICATION_FAILED',
      status: 'authentication_failed',
      retryable: false,
      message: expect.stringContaining('15 minutes'),
    });
    expect(guard.getHealth('A4H/100').status).toBe('authentication_failed');
  });

  it('blocks discovery authorization failures separately', async () => {
    const guard = state();
    await blockCredential(guard, 'A4H/100', 'USER', 'DENIED', 'authorization');
    await expect(
      guard.runExclusive('A4H/100', (lease) => lease.bindCredentials('USER', 'DENIED')),
    ).rejects.toMatchObject({
      code: 'SAP_AUTHORIZATION_DENIED',
      status: 'authorization_failed',
      retryable: false,
      message: expect.stringContaining('restart ARC-1'),
    });
  });

  it('allows a blocked generation after the 15-minute retention expires', async () => {
    let now = 100_000;
    const guard = state({ now: () => now });
    await blockCredential(guard, 'A4H/100', 'USER', 'OLD');
    now += SHARED_AUTH_BLOCKED_RETENTION_MS - 1;
    await expect(guard.runExclusive('A4H/100', (lease) => lease.bindCredentials('USER', 'OLD'))).rejects.toBeInstanceOf(
      SharedAuthBlockedError,
    );
    now += 1;
    await expect(guard.runExclusive('A4H/100', (lease) => lease.bindCredentials('USER', 'OLD'))).resolves.toEqual({
      changed: false,
    });
  });

  it('retains at most four blocked generations and evicts least-recently-used', async () => {
    let now = 0;
    const guard = state({ now: () => now });
    for (let index = 0; index < SHARED_AUTH_MAX_BLOCKED_GENERATIONS; index += 1) {
      await blockCredential(guard, 'A4H/100', 'USER', `PASSWORD_${index}`);
      now += 1;
    }

    await expect(
      guard.runExclusive('A4H/100', (lease) => lease.bindCredentials('USER', 'PASSWORD_0')),
    ).rejects.toBeInstanceOf(SharedAuthBlockedError);
    await blockCredential(guard, 'A4H/100', 'USER', 'PASSWORD_4');
    await expect(
      guard.runExclusive('A4H/100', (lease) => lease.bindCredentials('USER', 'PASSWORD_0')),
    ).rejects.toBeInstanceOf(SharedAuthBlockedError);
    await expect(
      guard.runExclusive('A4H/100', (lease) => lease.bindCredentials('USER', 'PASSWORD_1')),
    ).resolves.toEqual({ changed: true });
  });

  it('marks lookup failure before binding without losing the current generation', async () => {
    let now = Date.parse('2026-07-20T11:00:00.000Z');
    const guard = state({ now: () => now });
    await guard.runExclusive('A4H/100', (lease) => {
      lease.bindCredentials('USER', 'PASSWORD');
      lease.markHealthy();
    });
    await guard.runExclusive('A4H/100', (lease) => lease.markLookupUnavailable());
    expect(guard.getHealth('A4H/100').status).toBe('temporarily_unavailable');
    await guard.runExclusive('A4H/100', (lease) => {
      expect(lease.bindCredentials('USER', 'PASSWORD')).toEqual({ changed: false });
      lease.markTemporarilyUnavailable();
    });
    expect(guard.getHealth('A4H/100').status).toBe('temporarily_unavailable');
    now += 1;
    await guard.runExclusive('A4H/100', (lease) => {
      expect(lease.bindCredentials('USER', 'PASSWORD')).toEqual({ changed: false });
      lease.markHealthy();
    });
    await guard.runExclusive('A4H/100', (lease) => lease.markConfigurationInvalid());
    expect(guard.getHealth('A4H/100')).toEqual({
      status: 'configuration_invalid',
      checkedAt: '2026-07-20T11:00:00.001Z',
    });
  });

  it('preserves blocked and current generations across credentialless configuration failures', async () => {
    const guard = state();
    await blockCredential(guard, 'A4H/100', 'USER', 'REJECTED');
    await guard.runExclusive('A4H/100', (lease) => lease.markConfigurationInvalid());

    await expect(
      guard.runExclusive('A4H/100', (lease) => lease.bindCredentials('USER', 'REJECTED')),
    ).rejects.toBeInstanceOf(SharedAuthBlockedError);
    await guard.runExclusive('A4H/100', (lease) => {
      expect(lease.bindCredentials('USER', 'ROTATED')).toEqual({ changed: true });
      lease.markHealthy();
    });
    await expect(
      guard.runExclusive('A4H/100', (lease) => lease.bindCredentials('USER', 'REJECTED')),
    ).rejects.toBeInstanceOf(SharedAuthBlockedError);
  });

  it('bounds process state to 256 target gates', async () => {
    const guard = state();
    for (let index = 0; index < SHARED_AUTH_MAX_TARGETS; index += 1) {
      const lease = await guard.acquire(`SYS/${String(index).padStart(3, '0')}`);
      lease.release();
    }
    await expect(guard.acquire('OVERFLOW/000')).rejects.toMatchObject({
      code: 'SAP_TARGET_BUSY',
      reason: 'target_limit',
    });
  });

  it('rejects health mutation after release and makes release idempotent', async () => {
    const guard = state();
    const lease = await guard.acquire('A4H/100');
    lease.bindCredentials('USER', 'PASSWORD');
    lease.release();
    lease.release();
    expect(() => lease.markHealthy()).toThrow('no longer active');
    await expect(guard.acquire('A4H/100')).resolves.toBeDefined();
  });

  it('validates internal safety options without exposing key material', () => {
    expect(() => state({ acquisitionTimeoutMs: 0 })).toThrow(RangeError);
    expect(() => new MultiTargetSharedAuthState({ hmacKey: new Uint8Array(8) })).toThrow(RangeError);
    const busy = new SharedAuthBusyError('queue_full');
    expect(JSON.stringify(busy)).not.toContain('A4H');
  });
});
