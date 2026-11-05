/** Native qualification phases, with injected protocol edges and conservative dependency-preserving cleanup. */
import { type DeclarativeFixture, declarativePreservationClosure } from './native-declarative-fixtures.js';

export interface DeclarativeReceipt {
  sourceHash: string;
  metadataHash: string;
  activeMetadataHash?: string;
  activeVerified: boolean;
}

/** Closed journal vocabulary: arbitrary exception messages, paths and handles never become reasons. */
export type DeclarativeReason =
  | 'v5-history'
  | 'v5-runtime'
  | 'v5-intent'
  | 'v5-preflight'
  | 'v5-baseline'
  | 'v5-claimed'
  | 'v4-history'
  | 'v4-runtime'
  | 'v4-intent'
  | 'v4-preflight'
  | 'v4-baseline'
  | 'v4-claimed'
  | 'recovery-original'
  | 'recovery-intent'
  | 'recovery-baseline'
  | 'recovery-claimed'
  | 'recovery-runtime'
  | 'v3-runtime'
  | 'v3-intent'
  | 'v3-preflight'
  | 'v3-baseline'
  | 'v3-claimed'
  | 'v2-runtime'
  | 'v2-intent'
  | 'v2-preflight'
  | 'v2-baseline'
  | 'v2-claimed'
  | 'stopped'
  | 'source-binding'
  | 'request-out-of-scope'
  | 'delete-guard-unconfirmed'
  | 'deletion-receipt-missing'
  | 'metadata-read-failed'
  | 'metadata-status'
  | 'metadata-identity'
  | 'metadata-package'
  | 'metadata-marker'
  | 'metadata-version'
  | 'metadata-not-active'
  | 'metadata-author'
  | 'metadata-state-link'
  | 'source-read-failed'
  | 'source-status'
  | 'source-media'
  | 'source-content'
  | 'absence-owner-present'
  | 'absence-not-typed'
  | 'absence-read-failed'
  | 'inventory-read-failed'
  | 'inventory-status'
  | 'inventory-media'
  | 'inventory-contains-fixture'
  | 'inventory-malformed'
  | 'receipt-missing'
  | 'receipt-drift'
  | 'adapter-refused'
  | 'create-not-sent'
  | 'write-unconfirmed'
  | 'save-disagrees'
  | 'delete-not-sent'
  | 'delete-unconfirmed'
  | 'deleted-cleanup-unconfirmed'
  | 'activation-budget'
  | 'activation-unconfirmed'
  | 'activation-source-changed'
  | 'configuration-env-unreadable'
  | 'configuration-env-invalid'
  | 'configuration-client';

export class DeclarativeFailure extends Error {
  constructor(
    readonly reason: DeclarativeReason,
    /** Positive local evidence only; an absent flag always stays on the conservative path. */
    readonly evidence: { createNeverSent?: true; ownerDeleted?: true; status?: number } = {},
  ) {
    super(reason);
    this.name = 'DeclarativeFailure';
  }
}

export function declarativeFailureRow(error: unknown) {
  return error instanceof DeclarativeFailure
    ? { reason: error.reason, ...(error.evidence.status === undefined ? {} : { status: error.evidence.status }) }
    : { reason: 'unclassified' as const };
}

/** Replace the binding's arbitrary Git/filesystem failure text with its fixed reason. */
export function boundSourceCheck(verifySource: () => void) {
  return () => {
    try {
      verifySource();
    } catch {
      throw new DeclarativeFailure('source-binding');
    }
  };
}

export interface DeclarativeDriver {
  preflight(fixtures: readonly DeclarativeFixture[]): Promise<void>;
  create(fixture: DeclarativeFixture): Promise<DeclarativeReceipt>;
  activate(fixture: DeclarativeFixture, receipt: DeclarativeReceipt): Promise<DeclarativeReceipt>;
  update(fixture: DeclarativeFixture, receipt: DeclarativeReceipt): Promise<DeclarativeReceipt>;
  remove(fixture: DeclarativeFixture, receipt: DeclarativeReceipt): Promise<void>;
  finalAbsence(fixtures: readonly DeclarativeFixture[]): Promise<void>;
  verifySource(): void;
  shouldStop(): boolean;
  record(value: unknown): void;
  /** True once any native mutation request left the observer, whatever its later outcome. */
  mutationAttempted(): boolean;
}

export async function runNativeDeclarativeWorkflow(fixtures: readonly DeclarativeFixture[], driver: DeclarativeDriver) {
  const receipts = new Map<string, DeclarativeReceipt>();
  const pending = new Set<string>();
  const uncertain = new Set<string>();
  const cleanupIssues = new Set<string>();
  const cleanupNotAttempted = new Set<string>();
  const completed: string[] = [];
  const confirmedDeleted: string[] = [];
  const createNeverSent: string[] = [];
  let phase = 'preflight';
  let selected: DeclarativeFixture | undefined;
  let preflightComplete = false;
  let failure = false;
  let finalAbsenceConfirmed = false;
  let finalEvidenceUnconfirmed = false;

  function before(action: string, fixture?: DeclarativeFixture) {
    phase = action;
    driver.verifySource();
    if (driver.shouldStop()) throw new DeclarativeFailure('stopped');
    driver.record({ phase, owner: fixture?.owner, stage: 'intent' });
  }
  try {
    before('preflight');
    await driver.preflight(fixtures);
    preflightComplete = true;
    for (const fixture of fixtures) {
      selected = fixture;
      before('create', fixture);
      pending.add(fixture.owner);
      const created = await driver.create(fixture);
      receipts.set(fixture.owner, created);
      pending.delete(fixture.owner);
      driver.record({ phase, owner: fixture.owner, receipt: created, stage: 'complete' });
      for (const action of ['activate', 'update', 'activate'] as const) {
        before(action, fixture);
        const current = receipts.get(fixture.owner)!;
        const next = await driver[action](fixture, current);
        receipts.set(fixture.owner, next);
        driver.record({ phase, owner: fixture.owner, receipt: next, stage: 'complete' });
      }
      completed.push(fixture.owner);
      selected = undefined;
    }
  } catch (error) {
    failure = true;
    if (
      selected &&
      pending.has(selected.owner) &&
      error instanceof DeclarativeFailure &&
      error.evidence.createNeverSent
    ) {
      // The observer saw no create POST and the adapter reports unchanged: nothing can depend on this owner.
      pending.delete(selected.owner);
      createNeverSent.push(selected.owner);
    } else if (selected && (pending.has(selected.owner) || receipts.has(selected.owner))) uncertain.add(selected.owner);
    driver.record({ phase, owner: selected?.owner, stage: 'unconfirmed', ...declarativeFailureRow(error) });
  }

  // A child with an unconfirmed creation/save/activation/deletion preserves its complete dependency closure.
  for (const fixture of [...fixtures].reverse()) {
    const receipt = receipts.get(fixture.owner);
    if (!receipt || declarativePreservationClosure(fixtures, uncertain).has(fixture.owner)) continue;
    try {
      before('delete', fixture);
    } catch (error) {
      // No cleanup request was attempted for this owner, so this is not a failed deletion.
      failure = true;
      uncertain.add(fixture.owner);
      cleanupNotAttempted.add(fixture.owner);
      driver.record({ phase, owner: fixture.owner, stage: 'not-attempted', ...declarativeFailureRow(error) });
      continue;
    }
    try {
      await driver.remove(fixture, receipt);
      receipts.delete(fixture.owner);
      confirmedDeleted.push(fixture.owner);
      driver.record({ phase, owner: fixture.owner, stage: 'complete' });
    } catch (error) {
      failure = true;
      uncertain.add(fixture.owner);
      cleanupIssues.add(fixture.owner);
      if (error instanceof DeclarativeFailure && error.evidence.ownerDeleted) {
        // Absent by typed read, but its lock/session is unconfirmed: bases stay preserved for inspection.
        receipts.delete(fixture.owner);
        confirmedDeleted.push(fixture.owner);
      }
      driver.record({ phase, owner: fixture.owner, stage: 'unconfirmed', ...declarativeFailureRow(error) });
    }
  }
  if (preflightComplete && !receipts.size && !pending.size && !driver.shouldStop()) {
    try {
      before('final-absence');
      await driver.finalAbsence(fixtures);
      driver.verifySource();
      finalAbsenceConfirmed = true;
      driver.record({ phase, stage: 'complete' });
    } catch (error) {
      failure = true;
      finalEvidenceUnconfirmed = true;
      driver.record({ phase, stage: 'unconfirmed', ...declarativeFailureRow(error) });
    }
  }
  const preserved = declarativePreservationClosure(fixtures, uncertain);
  const mutationAttempted = driver.mutationAttempted();
  if (mutationAttempted && finalEvidenceUnconfirmed) for (const fixture of fixtures) preserved.add(fixture.owner);
  return {
    failure: failure || completed.length !== fixtures.length || !finalAbsenceConfirmed || driver.shouldStop(),
    mutationAttempted,
    completed,
    /** Owners still believed present; a confirmed deletion with failed cleanup is reported in cleanupIssues. */
    remaining: [...receipts.keys()],
    confirmedDeleted,
    /** A create request was sent, or could have been: its native outcome is unknown. */
    pendingCreation: [...pending],
    createNeverSent,
    inspectionRequired: [...preserved],
    cleanupIssues: [...cleanupIssues],
    cleanupNotAttempted: [...cleanupNotAttempted],
    // Without a sent mutation there is nothing to clean up; `failure` still records the refusal.
    cleanupUnconfirmed:
      mutationAttempted && (receipts.size > 0 || pending.size > 0 || cleanupIssues.size > 0 || !finalAbsenceConfirmed),
    finalAbsenceConfirmed,
    stopped: driver.shouldStop(),
  };
}
