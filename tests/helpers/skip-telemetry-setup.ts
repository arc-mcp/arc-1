/**
 * Vitest global setup for live-test skip telemetry.
 *
 * Clears suite-specific skip reason artifacts before a new integration/E2E run
 * so reliability summaries cannot report stale local data.
 */
import { resetSkipReasonArtifacts } from './skip-policy.js';

export function setup(): void {
  resetSkipReasonArtifacts();
}
