/**
 * Process-wide serialization and credential-attempt state for shared Basic targets.
 *
 * Construct exactly one instance for the HTTP server process. Callers acquire the
 * target gate before Destination Find, bind the resolved credentials only after the
 * lookup, and hold the lease through canary, feature probing, and tool dispatch.
 */

import { createHmac, randomBytes } from 'node:crypto';

export const SHARED_AUTH_MAX_TARGETS = 256;
export const SHARED_AUTH_QUEUE_LIMIT = 32;
export const SHARED_AUTH_ACQUIRE_TIMEOUT_MS = 30_000;
export const SHARED_AUTH_BLOCKED_RETENTION_MS = 15 * 60_000;
export const SHARED_AUTH_MAX_BLOCKED_GENERATIONS = 4;

export type SharedAuthHealth =
  | 'not_checked'
  | 'checking'
  | 'healthy'
  | 'configuration_invalid'
  | 'authentication_failed'
  | 'authorization_failed'
  | 'temporarily_unavailable';

export type SharedAuthBlockedHealth = Extract<SharedAuthHealth, 'authentication_failed' | 'authorization_failed'>;

export interface SharedAuthHealthSnapshot {
  readonly status: SharedAuthHealth;
  /** Time of the latest completed health transition. Absent for not_checked/checking. */
  readonly checkedAt?: string;
}

export type SharedAuthBusyReason = 'queue_full' | 'acquisition_timeout' | 'target_limit';

export class SharedAuthBusyError extends Error {
  readonly code = 'SAP_TARGET_BUSY' as const;
  readonly retryable = true;

  constructor(readonly reason: SharedAuthBusyReason) {
    super('The shared SAP target is busy. Retry after the active call completes.');
    this.name = 'SharedAuthBusyError';
  }
}

export class SharedAuthBlockedError extends Error {
  readonly retryable = false;
  readonly code: 'SAP_AUTHENTICATION_FAILED' | 'SAP_AUTHORIZATION_DENIED';

  constructor(readonly status: SharedAuthBlockedHealth) {
    super(
      status === 'authentication_failed'
        ? 'SAP rejected the shared target credentials. ARC-1 will not retry this credential generation for 15 minutes. An administrator should update the destination User/Password before retrying; an unchanged credential may be attempted once again after the block expires or ARC-1 restarts.'
        : 'SAP denied ADT discovery for the shared technical user. Correct its least-privilege ADT authorization, then restart ARC-1, wait 15 minutes for the temporary block to expire, or rotate to a reviewed credential before retrying.',
    );
    this.name = 'SharedAuthBlockedError';
    this.code = status === 'authentication_failed' ? 'SAP_AUTHENTICATION_FAILED' : 'SAP_AUTHORIZATION_DENIED';
  }
}

interface BlockedGeneration {
  readonly status: SharedAuthBlockedHealth;
  readonly blockedAt: number;
}

interface Waiter {
  settled: boolean;
  timer?: ReturnType<typeof setTimeout>;
  readonly resolve: (lease: SharedAuthLease) => void;
  readonly reject: (error: SharedAuthBusyError) => void;
}

interface TargetState {
  locked: boolean;
  readonly waiters: Waiter[];
  currentGeneration?: string;
  status: SharedAuthHealth;
  checkedAt?: number;
  /** In insertion order from least to most recently used. */
  readonly blocked: Map<string, BlockedGeneration>;
}

export interface BindSharedCredentialsResult {
  /** True when the selected technical identity differs from the preceding call. */
  readonly changed: boolean;
}

export interface SharedAuthLease {
  /**
   * HMAC-bind the credentials resolved inside this gate. Raw values are not retained
   * or returned. Throws SharedAuthBlockedError for a recently rejected generation.
   */
  bindCredentials(username: string, password: string): BindSharedCredentialsResult;
  markHealthy(): void;
  markAuthenticationFailed(): void;
  markAuthorizationFailed(): void;
  /** Destination Find failed before credentials could be bound; existing generations remain intact. */
  markLookupUnavailable(): void;
  markTemporarilyUnavailable(): void;
  markConfigurationInvalid(): void;
  /** Idempotent. Prefer runExclusive() so release is guaranteed in finally. */
  release(): void;
}

export interface MultiTargetSharedAuthStateOptions {
  /** Internal/test injection. Production uses the 30-second default. */
  readonly acquisitionTimeoutMs?: number;
  /** Internal/test clock for deterministic retention tests. */
  readonly now?: () => number;
  /** Internal/test process key. A random 256-bit key is generated when omitted. */
  readonly hmacKey?: Uint8Array;
}

/** Bounded, process-local guard for shared Basic-authentication targets. */
export class MultiTargetSharedAuthState {
  private readonly targets = new Map<string, TargetState>();
  private readonly acquisitionTimeoutMs: number;
  private readonly now: () => number;
  private readonly hmacKey: Uint8Array;

  constructor(options: MultiTargetSharedAuthStateOptions = {}) {
    const timeout = options.acquisitionTimeoutMs ?? SHARED_AUTH_ACQUIRE_TIMEOUT_MS;
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new RangeError('Shared-auth acquisition timeout must be a positive finite number.');
    }
    if (options.hmacKey && options.hmacKey.byteLength < 32) {
      throw new RangeError('Shared-auth HMAC key must contain at least 32 bytes.');
    }
    this.acquisitionTimeoutMs = timeout;
    this.now = options.now ?? Date.now;
    this.hmacKey = options.hmacKey ? Uint8Array.from(options.hmacKey) : randomBytes(32);
  }

  /** Acquire the target gate before any Destination Service or SAP request. */
  async acquire(target: string): Promise<SharedAuthLease> {
    const state = this.targetState(target);
    if (!state.locked) {
      state.locked = true;
      return this.createLease(state);
    }
    if (state.waiters.length >= SHARED_AUTH_QUEUE_LIMIT) {
      throw new SharedAuthBusyError('queue_full');
    }

    return await new Promise<SharedAuthLease>((resolve, reject) => {
      const waiter: Waiter = { settled: false, resolve, reject };
      waiter.timer = setTimeout(() => {
        if (waiter.settled) return;
        waiter.settled = true;
        const index = state.waiters.indexOf(waiter);
        if (index >= 0) state.waiters.splice(index, 1);
        reject(new SharedAuthBusyError('acquisition_timeout'));
      }, this.acquisitionTimeoutMs);
      state.waiters.push(waiter);
    });
  }

  /** Run with an automatically released lease, including thrown/rejected callbacks. */
  async runExclusive<T>(target: string, callback: (lease: SharedAuthLease) => Promise<T> | T): Promise<T> {
    const lease = await this.acquire(target);
    try {
      return await callback(lease);
    } finally {
      lease.release();
    }
  }

  /** Passive, secret-free health for the admin catalog. This never creates state or probes SAP. */
  getHealth(target: string): SharedAuthHealthSnapshot {
    const state = this.targets.get(target);
    if (!state) return Object.freeze({ status: 'not_checked' });
    return Object.freeze({
      status: state.status,
      ...(state.checkedAt === undefined ? {} : { checkedAt: new Date(state.checkedAt).toISOString() }),
    });
  }

  private targetState(target: string): TargetState {
    const existing = this.targets.get(target);
    if (existing) return existing;
    if (this.targets.size >= SHARED_AUTH_MAX_TARGETS) {
      throw new SharedAuthBusyError('target_limit');
    }
    const created: TargetState = {
      locked: false,
      waiters: [],
      status: 'not_checked',
      blocked: new Map(),
    };
    this.targets.set(target, created);
    return created;
  }

  private credentialGeneration(username: string, password: string): string {
    return createHmac('sha256', this.hmacKey).update(username).update('\0').update(password).digest('hex');
  }

  private pruneBlocked(state: TargetState, now: number): void {
    for (const [generation, blocked] of state.blocked) {
      if (now - blocked.blockedAt >= SHARED_AUTH_BLOCKED_RETENTION_MS) state.blocked.delete(generation);
    }
  }

  private touchBlocked(state: TargetState, generation: string, blocked: BlockedGeneration): void {
    state.blocked.delete(generation);
    state.blocked.set(generation, blocked);
  }

  private rememberBlocked(state: TargetState, generation: string, status: SharedAuthBlockedHealth): void {
    const now = this.now();
    this.pruneBlocked(state, now);
    this.touchBlocked(state, generation, { status, blockedAt: now });
    while (state.blocked.size > SHARED_AUTH_MAX_BLOCKED_GENERATIONS) {
      const leastRecentlyUsed = state.blocked.keys().next().value;
      if (leastRecentlyUsed === undefined) break;
      state.blocked.delete(leastRecentlyUsed);
    }
    state.currentGeneration = generation;
    state.status = status;
    state.checkedAt = now;
  }

  private createLease(state: TargetState): SharedAuthLease {
    let active = true;
    let boundGeneration: string | undefined;

    const requireActive = (): void => {
      if (!active) throw new Error('Shared-auth lease is no longer active.');
    };
    const requireGeneration = (): string => {
      requireActive();
      if (!boundGeneration) throw new Error('Shared credentials must be bound before recording authentication health.');
      return boundGeneration;
    };
    const complete = (status: SharedAuthHealth): void => {
      requireActive();
      state.status = status;
      state.checkedAt = this.now();
    };

    return Object.freeze({
      bindCredentials: (username: string, password: string): BindSharedCredentialsResult => {
        requireActive();
        const generation = this.credentialGeneration(username, password);
        const now = this.now();
        this.pruneBlocked(state, now);
        const blocked = state.blocked.get(generation);
        if (blocked) {
          this.touchBlocked(state, generation, blocked);
          state.currentGeneration = generation;
          state.status = blocked.status;
          state.checkedAt = blocked.blockedAt;
          throw new SharedAuthBlockedError(blocked.status);
        }
        const changed = state.currentGeneration !== generation;
        state.currentGeneration = generation;
        state.status = 'checking';
        state.checkedAt = undefined;
        boundGeneration = generation;
        return Object.freeze({ changed });
      },
      markHealthy: () => {
        requireGeneration();
        complete('healthy');
      },
      markAuthenticationFailed: () => {
        this.rememberBlocked(state, requireGeneration(), 'authentication_failed');
      },
      markAuthorizationFailed: () => {
        this.rememberBlocked(state, requireGeneration(), 'authorization_failed');
      },
      markLookupUnavailable: () => {
        requireActive();
        complete('temporarily_unavailable');
      },
      markTemporarilyUnavailable: () => {
        requireActive();
        complete('temporarily_unavailable');
      },
      markConfigurationInvalid: () => {
        requireActive();
        boundGeneration = undefined;
        complete('configuration_invalid');
      },
      release: () => {
        if (!active) return;
        active = false;
        this.release(state);
      },
    });
  }

  private release(state: TargetState): void {
    while (state.waiters.length > 0) {
      const waiter = state.waiters.shift() as Waiter;
      if (waiter.settled) continue;
      waiter.settled = true;
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.resolve(this.createLease(state));
      return;
    }
    state.locked = false;
  }
}
