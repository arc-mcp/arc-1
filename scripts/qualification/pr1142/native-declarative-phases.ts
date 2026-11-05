/** Fixed new protocol: offline intent, GET-only preflight, then one separately reviewed native attempt. */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { invalidNativeCredentialFields } from './native-declarative-entry.js';
import { declarativeV2Fixtures, declarativeV4Fixtures } from './native-declarative-fixtures.js';
import { declarativeV5Fixtures } from './native-declarative-v5-fixtures.js';
import { declarativeV5References } from './native-declarative-v5-references.js';
import type { DeclarativeRunDependencies } from './native-declarative-runner.js';
import type {
  DeclarativeBinding,
  DeclarativeIntent,
  readSavedDeclarativePrerequisites,
} from './native-declarative-prerequisites.js';
import { boundSourceCheck, DeclarativeFailure, declarativeFailureRow } from './native-declarative-workflow.js';
import { claimDirectory, durableRecord, journal, nativeLockBinding, privateDirectory } from './native-lock-binding.js';

export interface DeclarativePhaseDependencies extends DeclarativeRunDependencies {
  validateRuntime: () => void;
  bind: typeof nativeLockBinding;
}
interface DeclarativePhaseContract {
  protocol: 'pr1142-native-declarative-v2' | 'pr1142-native-declarative-v3' | 'pr1142-native-declarative-v4' | 'pr1142-native-declarative-v5';
  validateRuntime: () => void;
  readIntent: (binding: DeclarativeBinding) => DeclarativeIntent;
  readPrerequisites: (
    binding: DeclarativeBinding,
    intent: DeclarativeIntent,
    sample: string,
    now: number,
  ) => ReturnType<typeof readSavedDeclarativePrerequisites>;
}
export type DeclarativePhaseProfile = DeclarativePhaseContract &
  ({ version: 'v2' | 'v3'; history?: never } | { version: 'v4' | 'v5'; history: { facts: unknown; verify: () => void } });

async function preflight(
  binding: DeclarativeBinding,
  intent: DeclarativeIntent,
  dependencies: DeclarativeRunDependencies,
  profile: DeclarativePhaseProfile,
) {
  const { getOnlyReader } = await import('./native-declarative-preflight.js');
  const { declarativeAbsence } = await import('./native-declarative-evidence.js');
  const sample = randomBytes(8).toString('hex').toUpperCase();
  const root = join(binding.root, 'preflight', sample);
  privateDirectory(join(binding.root, 'preflight'));
  claimDirectory(root);
  const startedAt = new Date().toISOString();
  const common = {
    protocol: profile.protocol,
    revision: binding.evidence.revision,
    intentHash: intent.hash,
    startedAt,
  };
  durableRecord(join(root, 'manifest.json'), {
    ...common,
    owners: intent.fixtures.map(({ type, owner }) => ({ type, owner })),
  });
  const record = journal(join(root, 'run'));
  const verify = boundSourceCheck(() => {
    binding.verifySource();
    intent.verify();
    if (existsSync(join(binding.root, 'attempt'))) throw new DeclarativeFailure(`${profile.version}-claimed`);
  });
  let invalidFields: string[] = [];
  try {
    verify();
    let env: Record<string, string>;
    try {
      env = dependencies.readEnv(binding.repo);
    } catch {
      throw new DeclarativeFailure('configuration-env-unreadable');
    }
    let client: ReturnType<DeclarativeRunDependencies['createClient']>;
    try {
      verify();
      invalidFields = invalidNativeCredentialFields(env);
      if (invalidFields.length) throw new DeclarativeFailure('configuration-env-invalid');
      try {
        client = dependencies.createClient({
          baseUrl: 'https://a4h.marianzeis.de',
          client: '001',
          username: env.SAP_USER,
          password: env.SAP_PASSWORD,
          insecure: false,
          safety: { ...defaultSafetyConfig(), allowWrites: false },
        });
      } catch {
        throw new DeclarativeFailure('configuration-client');
      }
    } finally {
      delete env.SAP_PASSWORD;
    }
    verify();
    const reader = getOnlyReader({
      get: (path, headers, options) => {
        verify();
        return client.http.get(path, headers, options);
      },
    });
    await declarativeAbsence(reader, intent.fixtures, record, { deadline: Date.now() + 60_000 }, intent.readOnlyReferences);
    verify();
    const result = {
      ...common,
      completedAt: new Date().toISOString(),
      failure: false,
      mutationAttempted: false,
      verifiedOwners: intent.fixtures.map((fixture) => fixture.owner),
      ...(profile.version === 'v5' ? { verifiedReadOnlyReferences: intent.readOnlyReferences.map(r => r.owner) } : {}),
      inventory: 'valid-without-suffix',
    };
    durableRecord(join(root, 'result.json'), result);
    return { mode: 'preflight' as const, root, preflightId: sample, ...result };
  } catch (error) {
    const result = {
      ...common,
      completedAt: new Date().toISOString(),
      failure: true,
      mutationAttempted: false,
      ...declarativeFailureRow(error),
      ...(invalidFields.length ? { invalidFields } : {}),
    };
    record(result);
    durableRecord(join(root, 'result.json'), result);
    throw error;
  }
}

/** Only fixed wrappers call this coordinator; no CLI-selected entry, root or profile exists. */
export async function runDeclarativePhases(
  args: string[],
  entry: URL,
  profile: DeclarativePhaseProfile,
  dependencies?: DeclarativePhaseDependencies,
) {
  const flags = {
    prepare: `--prepare-reviewed-declarative-${profile.version}`,
    preflight: `--preflight-reviewed-declarative-${profile.version}`,
    execute: `--execute-reviewed-declarative-${profile.version}`,
    ...(profile.version !== 'v2' ? { check: `--check-reviewed-declarative-${profile.version}` } : {}),
  };
  const nativeDependencies = async () =>
    dependencies ?? (await import('./native-declarative-runner.js')).declarativeRunDefaults;
  const mode = Object.entries(flags).find(([, flag]) => flag === args[0])?.[0];
  if (
    !mode ||
    args.length !== (mode === 'execute' || mode === 'check' ? 3 : 2) ||
    !/^[a-f0-9]{40}$/.test(args[1]) ||
    ((mode === 'execute' || mode === 'check') && !/^[A-F0-9]{16}$/.test(args[2]))
  )
    throw new Error('Requires a fixed phase, reviewed full revision and, for check/execute, its preflight ID.');
  (dependencies?.validateRuntime ?? profile.validateRuntime)();
  const bind = dependencies?.bind ?? nativeLockBinding;
  const sourceBinding =
    mode === 'check' ? await bind(args[1], entry, undefined, { readOnly: true }) : await bind(args[1], entry);
  const binding = {
    ...sourceBinding,
    verifySource: () => {
      sourceBinding.verifySource();
      profile.history?.verify();
    },
  };
  if (mode !== 'execute' && ['v4', 'v5'].includes(profile.version)) binding.verifySource();
  if (mode !== 'check') process.umask(0o077);
  if (mode === 'prepare') {
    const suffix = randomBytes(8).toString('hex').toUpperCase();
    const fixtures = (profile.version === 'v5' ? declarativeV5Fixtures : profile.version === 'v4' ? declarativeV4Fixtures : declarativeV2Fixtures)(suffix);
    claimDirectory(binding.root);
    durableRecord(join(binding.root, 'intent.json'), {
      protocol: profile.protocol,
      createdAt: new Date().toISOString(),
      suffix,
      binding: binding.evidence,
      fixtures,
      ...(profile.version === 'v5' ? { readOnlyReferences: declarativeV5References(fixtures) } : {}),
      identity: 'MARIAN',
      target: 'A4H/001',
      authentication: 'Basic-native-contract-only',
      ...(profile.history ? { history: profile.history.facts } : {}),
    });
    claimDirectory(join(binding.root, 'preflight'));
    const intent = profile.readIntent(binding);
    return {
      mode: 'prepare' as const,
      root: binding.root,
      failure: false,
      mutationAttempted: false,
      suffix,
      intentHash: intent.hash,
      owners: intent.fixtures.map(({ type, name }) => ({ type, name })),
    };
  }
  privateDirectory(binding.root);
  if (mode === 'preflight') {
    // Read-only samples may be refreshed, but never after a mutation attempt has claimed the protocol.
    if (existsSync(join(binding.root, 'attempt'))) throw new DeclarativeFailure(`${profile.version}-claimed`);
    // An active GET-only sample must not overlap a separately invoked attempt. A crashed sample
    // leaves this sentinel for inspection; it is never treated as an expired lease.
    const running = join(binding.root, 'preflight-running');
    mkdirSync(running, { mode: 0o700 });
    try {
      if (existsSync(join(binding.root, 'attempt'))) throw new DeclarativeFailure(`${profile.version}-claimed`);
      return await preflight(binding, profile.readIntent(binding), await nativeDependencies(), profile);
    } finally {
      rmdirSync(running);
    }
  }
  if (mode === 'check') {
    const assertIdle = () => {
      if (existsSync(join(binding.root, 'attempt'))) throw new DeclarativeFailure(`${profile.version}-claimed`);
      if (existsSync(join(binding.root, 'preflight-running')))
        throw new DeclarativeFailure(`${profile.version}-preflight`);
    };
    assertIdle();
    binding.verifySource();
    const intent = profile.readIntent(binding);
    const prerequisites = profile.readPrerequisites(binding, intent, args[2], Date.now());
    binding.verifySource();
    intent.verify();
    prerequisites.verify();
    if (Date.now() > prerequisites.freshUntil) throw new DeclarativeFailure(`${profile.version}-baseline`);
    assertIdle();
    return {
      mode: 'check' as const,
      root: binding.root,
      protocol: profile.protocol,
      revision: binding.evidence.revision,
      intentHash: intent.hash,
      preflightId: args[2],
      receipts: prerequisites.receipts,
      freshUntil: new Date(prerequisites.freshUntil).toISOString(),
      failure: false,
      mutationAttempted: false,
      attemptClaimed: false,
      executionGrant: false,
    };
  }
  const root = join(binding.root, 'attempt');
  // Exclusivity survives failures, configuration refusals, process exit and a different reviewed revision.
  claimDirectory(root);
  const record = journal(join(root, 'run'));
  let intent: DeclarativeIntent;
  let prerequisites: ReturnType<DeclarativePhaseProfile['readPrerequisites']>;
  try {
    if (existsSync(join(binding.root, 'preflight-running')))
      throw new DeclarativeFailure(`${profile.version}-preflight`);
    if (profile.version !== 'v2') binding.verifySource();
    intent = profile.readIntent(binding);
    prerequisites = profile.readPrerequisites(binding, intent, args[2], Date.now());
    if (profile.version !== 'v2') {
      binding.verifySource();
      intent.verify();
      prerequisites.verify();
      if (Date.now() > prerequisites.freshUntil) throw new DeclarativeFailure(`${profile.version}-baseline`);
    }
    durableRecord(join(root, 'manifest.json'), {
      protocol: profile.protocol,
      binding: binding.evidence,
      intentHash: intent.hash,
      preflightId: args[2],
      prerequisites: prerequisites.receipts,
      fixtures: intent.fixtures,
      ...(profile.version === 'v5' ? { readOnlyReferences: intent.readOnlyReferences } : {}),
      identity: 'MARIAN',
      target: 'A4H/001',
      authentication: 'Basic-native-contract-only',
    });
  } catch (error) {
    const result = {
      failure: true,
      mutationAttempted: false,
      cleanupUnconfirmed: false,
      finalAbsenceConfirmed: false,
      independentAbsence: 'not-run',
      stoppedAt: 'prerequisites',
      ...declarativeFailureRow(error),
    };
    record(result);
    durableRecord(join(root, 'result.json'), result);
    throw error;
  }
  let mutationStarted = false;
  const observe = (value: unknown) => {
    const row = value as { stage?: string; method?: string; path?: string };
    if (
      row.stage === (profile.version === 'v5' ? 'dispatch' : 'request') &&
      row.method !== 'GET' &&
      row.method !== 'HEAD' &&
      !row.path?.startsWith('/sap/bc/adt/cts/transportchecks')
    )
      mutationStarted = true;
    record(value);
  };
  const verified = {
    ...binding,
    root,
    verifySource: () => {
      binding.verifySource();
      intent.verify();
      prerequisites.verify();
      if (!mutationStarted && Date.now() > prerequisites.freshUntil)
        throw new DeclarativeFailure(`${profile.version}-baseline`);
    },
  };
  try {
    if (profile.version !== 'v2') verified.verifySource();
    const { runClaimedDeclarative } = await import('./native-declarative-runner.js');
    const native = await nativeDependencies();
    if (profile.version !== 'v2') verified.verifySource();
    const result = await runClaimedDeclarative(verified, intent.fixtures, observe, native, intent.readOnlyReferences);
    return { mode: 'execute' as const, ...result };
  } catch (error) {
    // A configuration refusal already has a no-mutation result; an unexpected execution error remains unknown.
    if (!existsSync(join(root, 'result.json')))
      durableRecord(join(root, 'result.json'), {
        failure: true,
        mutationAttempted: 'unknown',
        cleanupUnconfirmed: true,
        finalAbsenceConfirmed: false,
        independentAbsence: 'not-run',
        stoppedAt: 'execution-error',
        ...declarativeFailureRow(error),
      });
    throw error;
  }
}
