/** Runtime and configuration checks shared by the declarative entries; never reads credentials itself. */
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DeclarativeFailure } from './native-declarative-workflow.js';
import { assertNativeQualificationEnvironment, isNativeContractOrigin } from './native-qualification-runtime.js';
import { HarnessError } from './safe-io.mjs';

/** Node resolves the loaded module through symlinks, so a plain argv comparison could silently do nothing. */
export function isDirectEntry(argument: string | undefined, moduleUrl: string) {
  if (!argument) return false;
  try {
    return realpathSync(argument) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

/** Trust roots, module resolution and the TSX loader must stay those of the reviewed checkout. */
export function assertDeclarativeRuntime(env: NodeJS.ProcessEnv = process.env, argv = process.execArgv) {
  assertNativeQualificationEnvironment(env, argv);
  if (
    Object.keys(env).some(
      (key) => ['NODE_EXTRA_CA_CERTS', 'NODE_USE_SYSTEM_CA', 'NODE_PATH'].includes(key) || key.startsWith('TSX_'),
    )
  )
    throw new HarnessError('UNSAFE_RUNTIME_OVERRIDE');
}

/** Field names only: a value may hold a secret or a URL with userinfo. */
export function invalidNativeCredentialFields(env: Record<string, string | undefined>) {
  return [
    ...(isNativeContractOrigin(env.SAP_URL) ? [] : ['SAP_URL']),
    ...(env.SAP_USER === 'MARIAN' ? [] : ['SAP_USER']),
    ...(env.SAP_CLIENT === '001' ? [] : ['SAP_CLIENT']),
    ...(env.SAP_PASSWORD ? [] : ['SAP_PASSWORD']),
  ];
}

/** Console output stays allow-listed even though private receipts hold more detail. */
export function declarativeStopCode(error: unknown) {
  if (error instanceof DeclarativeFailure) return error.reason;
  const allowed = new Set([
    'TLS_VERIFICATION_REQUIRED',
    'UNSAFE_RUNTIME_DIAGNOSTICS',
    'UNSAFE_RUNTIME_OVERRIDE',
    'REAL_GIT_WORKSPACE_ROOT_REQUIRED',
  ]);
  return error instanceof HarnessError && allowed.has(error.code) ? error.code : 'QUALIFICATION_STOPPED';
}
