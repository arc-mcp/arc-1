/** Pure runtime admission; importing this guard never loads a native client or credentials. */
import { assertSafeDiagnosticEnvironment } from './safe-io.mjs';

export function assertNativeQualificationEnvironment(env = process.env, argv = process.execArgv) {
  assertSafeDiagnosticEnvironment(env, argv);
  if (
    env.NODE_OPTIONS ||
    Object.keys(env).some((key) => key.startsWith('GIT_')) ||
    JSON.stringify(argv) !== JSON.stringify(['--import', 'tsx'])
  )
    throw new Error('Use only node --import tsx, with NODE_OPTIONS and all GIT_* variables unset.');
}

/** Check credential binding without echoing malformed URL input (which might contain userinfo). */
export function isNativeContractOrigin(value: unknown): boolean {
  try {
    return typeof value === 'string' && new URL(value).href === 'https://a4h.marianzeis.de/';
  } catch {
    return false;
  }
}
