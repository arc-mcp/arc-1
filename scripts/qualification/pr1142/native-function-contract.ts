/** One explicitly reviewed native active-FUNC deletion qualification. Never a public capability or PP proof. */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { AdtClient } from '../../../src/adt/client.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { contractSelection, isNativeContractOrigin } from './native-contract-transport.js';
import { confirmNativeFunctionAbsence } from './native-contract-absence.js';
import { runNativeFunctionContract } from './native-function-contract-run.js';
import { claimDirectory, durableRecord, journal, nativeLockBinding } from './native-lock-binding.js';
import { HarnessError } from './safe-io.mjs';
import { assertNativeQualificationEnvironment } from './native-qualification-runtime.js';

export { assertNativeQualificationEnvironment } from './native-qualification-runtime.js';

interface Dependencies {
  validateRuntime: () => void;
  bind: typeof nativeLockBinding;
  readEnv: (repo: string) => Record<string, string>;
  createClient: (input: ConstructorParameters<typeof AdtClient>[0]) => AdtClient;
  execute: typeof runNativeFunctionContract;
  confirmAbsence: typeof confirmNativeFunctionAbsence;
}
const defaults: Dependencies = {
  validateRuntime: assertNativeQualificationEnvironment,
  bind: nativeLockBinding,
  readEnv: (repo) => parse(readFileSync(join(repo, '.env'))),
  createClient: (input) => new AdtClient(input),
  execute: runNativeFunctionContract,
  confirmAbsence: confirmNativeFunctionAbsence,
};

/** Injectable edges allow phase/credential/claim tests without importing an executing CLI. */
export async function runNativeFunctionQualification(args: string[], dependencies: Dependencies = defaults) {
  if (args.length !== 2 || args[0] !== '--execute-reviewed-active-delete' || !/^[a-f0-9]{40}$/.test(args[1]))
    throw new Error('Requires --execute-reviewed-active-delete <full reviewed commit>.');
  dependencies.validateRuntime();
  const binding = await dependencies.bind(args[1], new URL(import.meta.url));
  process.umask(0o077);
  claimDirectory(binding.root);
  const selection = contractSelection(randomBytes(8).toString('hex').toUpperCase());
  const marker = `ARC1 native contract ${selection.group.slice(-16)}`;
  durableRecord(join(binding.root, 'manifest.json'), {
    time: new Date().toISOString(),
    binding: binding.evidence,
    selection,
    marker,
    identity: 'MARIAN',
    target: 'A4H/001',
    authentication: 'Basic-native-contract-only',
    purpose: 'one active FUNC deletion qualification, then unchanged empty-parent cleanup',
  });
  const record = journal(join(binding.root, 'run'));
  const env = dependencies.readEnv(binding.repo);
  if (
    !isNativeContractOrigin(env.SAP_URL) ||
    env.SAP_USER !== 'MARIAN' ||
    env.SAP_CLIENT !== '001' ||
    !env.SAP_PASSWORD
  )
    throw new Error('Requires the existing approved HTTPS MARIAN/001 native test credentials.');
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
  const base = dependencies.createClient({
    baseUrl: 'https://a4h.marianzeis.de',
    client: '001',
    username: env.SAP_USER,
    password: env.SAP_PASSWORD,
    insecure: false,
    safety: { ...defaultSafetyConfig(), ...config },
  });
  delete env.SAP_PASSWORD;
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, stop);
  try {
    const result = await dependencies.execute({
      base,
      config,
      selection,
      marker,
      record,
      verifySource: binding.verifySource,
      shouldStop: () => stopped,
      activatedCleanup: 'delete-verified-active',
    });
    let finalAbsenceConfirmed = false;
    if (!result.failure && !result.cleanupUnconfirmed && result.activeDeletionVerified && !stopped) {
      try {
        binding.verifySource();
        await dependencies.confirmAbsence(base.http, selection, record);
        finalAbsenceConfirmed = true;
      } catch (error) {
        record({ finalAbsenceUnconfirmed: true, errorType: error instanceof Error ? error.name : 'unknown' });
      }
    }
    const outcome = {
      ...result,
      finalAbsenceConfirmed,
      stopped: result.stopped || stopped,
      failure: result.failure || stopped || !result.activeDeletionVerified || !finalAbsenceConfirmed,
      cleanupUnconfirmed: result.cleanupUnconfirmed || !finalAbsenceConfirmed,
    };
    durableRecord(join(binding.root, 'result.json'), outcome);
    return { root: binding.root, ...outcome };
  } catch (error) {
    record({ qualificationStopped: 'execution-error', errorType: error instanceof Error ? error.name : 'unknown' });
    throw error;
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(signal, stop);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await runNativeFunctionQualification(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure || result.cleanupUnconfirmed ? 1 : 0;
  } catch (error) {
    const allowed = new Set([
      'TLS_VERIFICATION_REQUIRED',
      'UNSAFE_RUNTIME_DIAGNOSTICS',
      'REAL_GIT_WORKSPACE_ROOT_REQUIRED',
    ]);
    const code = error instanceof HarnessError && allowed.has(error.code) ? error.code : 'QUALIFICATION_STOPPED';
    console.error(
      `Native function qualification stopped (${code}). Inspect private receipts; never repeat a claimed run.`,
    );
    process.exitCode = 1;
  }
}
