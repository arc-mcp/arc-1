/** Shared entry orchestration for fixed declarative protocols; the lifecycle remains in one driver/workflow. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { AdtClient } from '../../../src/adt/client.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { declarativeAbsence } from './native-declarative-evidence.js';
import { runNativeDeclarativeContract } from './native-declarative-driver.js';
import { invalidNativeCredentialFields } from './native-declarative-entry.js';
import type { DeclarativeFixture } from './native-declarative-fixtures.js';
import { boundSourceCheck, DeclarativeFailure, declarativeFailureRow } from './native-declarative-workflow.js';
import type { DeclarativeReadOnlyReference } from './native-declarative-v5-references.js';
import { durableRecord, type nativeLockBinding } from './native-lock-binding.js';

export interface DeclarativeRunDependencies {
  readEnv: (repo: string) => Record<string, string>;
  createClient: (input: ConstructorParameters<typeof AdtClient>[0]) => AdtClient;
  execute: typeof runNativeDeclarativeContract;
  confirmAbsence: typeof declarativeAbsence;
}
export const declarativeRunDefaults: DeclarativeRunDependencies = {
  readEnv: (repo) => parse(readFileSync(join(repo, '.env'))),
  createClient: (input) => new AdtClient(input),
  execute: runNativeDeclarativeContract,
  confirmAbsence: declarativeAbsence,
};

/** The caller must durably claim its fixed protocol and save its complete intent before entering. */
export async function runClaimedDeclarative(
  binding: Awaited<ReturnType<typeof nativeLockBinding>>,
  fixtures: readonly DeclarativeFixture[],
  record: (value: unknown) => void,
  dependencies: DeclarativeRunDependencies,
  readOnlyReferences: readonly DeclarativeReadOnlyReference[] = [],
) {
  const config = {
    ...DEFAULT_CONFIG,
    client: '001',
    systemType: 'onprem' as const,
    allowWrites: true,
    targetId: 'A4H/001',
    allowedPackages: ['$TMP'],
    lintBeforeWrite: false,
    checkBeforeWrite: false,
    multiTargetWrite: {
      target: 'A4H/001',
      enabled: true,
      allowedPackages: ['$TMP'],
      allowedTransports: [],
      serverAllowedTransports: [],
    },
  };
  let base: AdtClient;
  let invalidFields: string[] = [];
  try {
    boundSourceCheck(binding.verifySource)();
    let env: Record<string, string>;
    try {
      env = dependencies.readEnv(binding.repo);
    } catch {
      throw new DeclarativeFailure('configuration-env-unreadable');
    }
    try {
      boundSourceCheck(binding.verifySource)();
      invalidFields = invalidNativeCredentialFields(env);
      if (invalidFields.length) throw new DeclarativeFailure('configuration-env-invalid');
      try {
        base = dependencies.createClient({
          baseUrl: 'https://a4h.marianzeis.de',
          client: '001',
          username: env.SAP_USER,
          password: env.SAP_PASSWORD,
          insecure: false,
          safety: { ...defaultSafetyConfig(), ...config },
        });
      } catch {
        throw new DeclarativeFailure('configuration-client');
      }
    } finally {
      delete env.SAP_PASSWORD;
    }
    boundSourceCheck(binding.verifySource)();
  } catch (error) {
    // A consumed claim always explains itself; only the fixed reason and field names are retained.
    const refusal = { ...declarativeFailureRow(error), ...(invalidFields.length ? { invalidFields } : {}) };
    record({ qualificationStopped: 'configuration', ...refusal });
    durableRecord(join(binding.root, 'result.json'), {
      failure: true,
      mutationAttempted: false,
      cleanupUnconfirmed: false,
      finalAbsenceConfirmed: false,
      independentAbsence: 'not-run',
      stoppedAt: 'configuration',
      ...refusal,
    });
    throw error;
  }
  let stopped = false;
  const stop = (signal: NodeJS.Signals) => {
    stopped = true;
    try {
      record({ stopSignal: signal });
    } catch {
      // The stop must take effect even when the journal cannot accept this row.
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, stop);
  try {
    const result = await dependencies.execute({
      base,
      config,
      fixtures,
      readOnlyReferences,
      record,
      verifySource: binding.verifySource,
      shouldStop: () => stopped,
    });
    const allOwnersCompleted =
      result.completed.length === fixtures.length &&
      fixtures.every((fixture) => result.completed.includes(fixture.owner));
    // The workflow's own `finalAbsenceConfirmed` stays as reported; this second read is separate evidence.
    let independentAbsence: 'confirmed' | 'unconfirmed' | 'not-run' = 'not-run';
    if (!result.failure && !result.cleanupUnconfirmed && allOwnersCompleted && !stopped) {
      try {
        boundSourceCheck(binding.verifySource)();
        await dependencies.confirmAbsence(base.http, fixtures, record, { deadline: Date.now() + 60_000 }, readOnlyReferences);
        boundSourceCheck(binding.verifySource)();
        independentAbsence = 'confirmed';
      } catch (error) {
        independentAbsence = 'unconfirmed';
        record({ finalAbsenceUnconfirmed: true, ...declarativeFailureRow(error) });
      }
    }
    let bindingUnconfirmed = false;
    try {
      boundSourceCheck(binding.verifySource)();
    } catch (error) {
      bindingUnconfirmed = true;
      record({ terminalBindingUnconfirmed: true, ...declarativeFailureRow(error) });
    }
    const outcome = {
      ...result,
      ...(bindingUnconfirmed
        ? {
            bindingUnconfirmed: true,
            inspectionRequired: [
              ...new Set([...result.inspectionRequired, ...fixtures.map((fixture) => fixture.owner)]),
            ],
          }
        : {}),
      independentAbsence,
      stopped: result.stopped || stopped,
      failure:
        result.failure || stopped || bindingUnconfirmed || !allOwnersCompleted || independentAbsence !== 'confirmed',
      cleanupUnconfirmed:
        result.cleanupUnconfirmed ||
        independentAbsence === 'unconfirmed' ||
        (bindingUnconfirmed && result.mutationAttempted),
    };
    durableRecord(join(binding.root, 'result.json'), outcome);
    return { root: binding.root, ...outcome };
  } catch (error) {
    record({ qualificationStopped: 'execution-error', ...declarativeFailureRow(error) });
    throw error;
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(signal, stop);
  }
}
