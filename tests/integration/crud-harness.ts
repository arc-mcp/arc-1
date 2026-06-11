/**
 * CRUD test harness for integration tests.
 *
 * Provides unique name generation, an object registry for cleanup tracking,
 * retry-aware delete logic, and XML builder for ADT object creation.
 *
 * All functions are pure or take explicit dependencies (no global state).
 */

import { deleteObject, lockObject } from '../../src/adt/crud.js';
import type { AdtHttpClient } from '../../src/adt/http.js';
import type { SafetyConfig } from '../../src/adt/safety.js';

let nameCounter = 0;

/**
 * Generate a unique ABAP-valid object name.
 * Returns `${prefix}_${timestamp_base36}${counter_base36}` — uppercase, max 30 chars.
 * Uses a monotonic counter to guarantee uniqueness even within the same millisecond.
 */
export function generateUniqueName(prefix: string): string {
  const suffix = `${Date.now().toString(36)}${(nameCounter++).toString(36)}`.toUpperCase().slice(-6);
  const name = `${prefix}_${suffix}`;
  if (name.length > 30) {
    throw new Error(`Generated name "${name}" exceeds 30 characters. Use a shorter prefix.`);
  }
  return name;
}

/** Entry tracked by CrudRegistry */
export interface RegistryEntry {
  objectUrl: string;
  objectType: string;
  name: string;
}

/**
 * Tracks created objects for guaranteed cleanup.
 * Objects are returned in reverse creation order (last created = first deleted)
 * to respect potential dependencies.
 */
export class CrudRegistry {
  private entries: RegistryEntry[] = [];

  register(objectUrl: string, objectType: string, name: string): void {
    this.entries.push({ objectUrl, objectType, name });
  }

  getAll(): RegistryEntry[] {
    return [...this.entries].reverse();
  }

  remove(name: string): void {
    this.entries = this.entries.filter((e) => e.name !== name);
  }

  get size(): number {
    return this.entries.length;
  }
}

/** Result of a retryDelete attempt */
export interface RetryDeleteResult {
  success: boolean;
  attempts: number;
  lastError?: string;
}

/**
 * Check if an error is transient and worth retrying.
 * Covers lock conflicts, SAP work process exhaustion, and connectivity blips.
 */
function isRetryableError(message: string): boolean {
  return /locked|enqueue|service cannot be reached|connection reset|ECONNRESET|socket hang up|timeout/i.test(message);
}

/**
 * Attempt to delete an object with retries on lock conflicts and transient errors.
 * Uses exponential backoff between retries.
 */
export async function retryDelete(
  http: AdtHttpClient,
  safety: SafetyConfig,
  objectUrl: string,
  maxRetries = 5,
  delayMs = 1000,
): Promise<RetryDeleteResult> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await http.withStatefulSession(async (session) => {
        const lock = await lockObject(session, safety, objectUrl);
        await deleteObject(session, safety, objectUrl, lock.lockHandle);
      });
      return { success: true, attempts: attempt };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);

      if (!isRetryableError(message) || attempt === maxRetries) {
        return { success: false, attempts: attempt, lastError: message };
      }

      // Exponential backoff before retry
      await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** (attempt - 1)));
    }
  }

  // Should not reach here, but satisfy TypeScript
  return { success: false, attempts: maxRetries, lastError: 'Max retries exhausted' };
}

/** Cleanup report from cleanupAll */
export interface CleanupReport {
  cleaned: number;
  failed: Array<{ name: string; error: string }>;
}

/**
 * Iterate all registered objects and attempt to delete each.
 * Returns a report of successes and failures.
 */
export async function cleanupAll(
  http: AdtHttpClient,
  safety: SafetyConfig,
  registry: CrudRegistry,
): Promise<CleanupReport> {
  const entries = registry.getAll();
  let cleaned = 0;
  const failed: Array<{ name: string; error: string }> = [];

  for (const entry of entries) {
    const result = await retryDelete(http, safety, entry.objectUrl);
    if (result.success) {
      registry.remove(entry.name);
      cleaned++;
    } else {
      failed.push({ name: entry.name, error: result.lastError ?? 'Unknown error' });
    }
  }

  return { cleaned, failed };
}

// buildCreateXml comes from src/handlers/write-helpers.ts — no local duplicate needed.
export { buildCreateXml } from '../../src/handlers/write-helpers.js';
