/** GET-only typed-absence prerequisite on fresh names; it creates, locks and claims nothing on SAP. */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { AdtClient } from '../../../src/adt/client.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import {
  assertDeclarativeRuntime,
  declarativeStopCode,
  invalidNativeCredentialFields,
  isDirectEntry,
} from './native-declarative-entry.js';
import { declarativeInventoryClean, declarativeOwnerAbsent, type DeclarativeReader } from './native-declarative-evidence.js';
import { declarativeFixtures } from './native-declarative-fixtures.js';
import { checkDeclarativeRequest } from './native-declarative-transport.js';
import { boundSourceCheck, DeclarativeFailure, declarativeFailureRow } from './native-declarative-workflow.js';
import { claimDirectory, durableRecord, journal, nativeLockBinding, privateDirectory } from './native-lock-binding.js';

interface Dependencies {
  validateRuntime: () => void;
  bind: typeof nativeLockBinding;
  readEnv: (repo: string) => Record<string, string>;
  createClient: (input: ConstructorParameters<typeof AdtClient>[0]) => AdtClient;
}
const defaults: Dependencies = {
  validateRuntime: assertDeclarativeRuntime,
  bind: nativeLockBinding,
  readEnv: (repo) => parse(readFileSync(join(repo, '.env'))),
  createClient: (input) => new AdtClient(input),
};

/** Only `get` is reachable: there is no mutating method, CSRF fetch or stateful session to misuse. */
export function getOnlyReader(http: DeclarativeReader): DeclarativeReader {
  return {
    get: (path, headers, options) => {
      checkDeclarativeRequest(undefined, 'GET', path);
      return http.get(path, headers, options);
    },
  };
}

export async function runNativeDeclarativeAbsencePreflight(args: string[], dependencies: Dependencies = defaults) {
  if (args.length !== 2 || args[0] !== '--execute-reviewed-absence-preflight' || !/^[a-f0-9]{40}$/.test(args[1]))
    throw new Error('Requires --execute-reviewed-absence-preflight <full reviewed commit>.');
  dependencies.validateRuntime();
  const binding = await dependencies.bind(args[1], new URL(import.meta.url));
  process.umask(0o077);
  // Each read-only sample has its own directory; this never touches the one-run experiment's claim.
  mkdirSync(binding.root, { recursive: true, mode: 0o700 });
  privateDirectory(binding.root);
  const suffix = randomBytes(8).toString('hex').toUpperCase();
  const root = join(binding.root, suffix);
  claimDirectory(root);
  const fixtures = declarativeFixtures(suffix);
  durableRecord(join(root, 'manifest.json'), {
    time: new Date().toISOString(),
    binding: binding.evidence,
    owners: fixtures.map(({ type, owner }) => ({ type, owner })),
    identity: 'MARIAN',
    target: 'A4H/001',
    authentication: 'Basic-native-contract-only',
    purpose: 'GET-only typed absence on fresh names and inactive inventory shape; no mutation request is possible',
  });
  const record = journal(join(root, 'run'));
  let reader: DeclarativeReader;
  let invalidFields: string[] = [];
  try {
    let env: Record<string, string>;
    try {
      env = dependencies.readEnv(binding.repo);
    } catch {
      throw new DeclarativeFailure('configuration-env-unreadable');
    }
    invalidFields = invalidNativeCredentialFields(env);
    if (invalidFields.length) throw new DeclarativeFailure('configuration-env-invalid');
    try {
      const base = dependencies.createClient({
        baseUrl: 'https://a4h.marianzeis.de',
        client: '001',
        username: env.SAP_USER,
        password: env.SAP_PASSWORD,
        insecure: false,
        safety: { ...defaultSafetyConfig(), allowWrites: false },
      });
      reader = getOnlyReader({ get: base.http.get.bind(base.http) });
    } catch {
      throw new DeclarativeFailure('configuration-client');
    } finally {
      delete env.SAP_PASSWORD;
    }
  } catch (error) {
    const refusal = {
      failure: true, mutationAttempted: false, stoppedAt: 'configuration', ...declarativeFailureRow(error),
      ...(invalidFields.length ? { invalidFields } : {}),
    };
    record(refusal);
    durableRecord(join(root, 'result.json'), refusal);
    throw error;
  }
  // Every type answers even after an earlier row refuses: this sample exists to see all five shapes.
  const verifySource = boundSourceCheck(binding.verifySource);
  const deadline = Date.now() + 60_000;
  const owners: { type: string; owner: string; result: string; status?: number }[] = [];
  for (const fixture of fixtures) {
    try {
      verifySource();
      await declarativeOwnerAbsent(reader, fixture, record, { deadline });
      owners.push({ type: fixture.type, owner: fixture.owner, result: 'typed-absent' });
    } catch (error) {
      const { reason, ...detail } = declarativeFailureRow(error);
      owners.push({ type: fixture.type, owner: fixture.owner, result: reason, ...detail });
    }
  }
  let inventory = 'valid-without-suffix';
  try {
    verifySource();
    await declarativeInventoryClean(reader, fixtures, record, { deadline });
  } catch (error) {
    inventory = declarativeFailureRow(error).reason;
  }
  const outcome = {
    failure: inventory !== 'valid-without-suffix' || owners.some((owner) => owner.result !== 'typed-absent'),
    mutationAttempted: false,
    owners,
    inventory,
  };
  durableRecord(join(root, 'result.json'), outcome);
  return { root, ...outcome };
}

if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeDeclarativeAbsencePreflight(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch (error) {
    console.error(`Native declarative absence preflight stopped (${declarativeStopCode(error)}). No SAP mutation is possible here.`);
    process.exitCode = 1;
  }
}
