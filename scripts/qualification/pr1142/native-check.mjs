import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { durable } from './durable-journal.mjs';
import { configuration, validateConfiguration } from './qualification-config.mjs';
import { assertSafeDiagnosticEnvironment, HarnessError, privateJson } from './safe-io.mjs';

const execute = promisify(execFile);
export async function nativeCheck(script, mode, name) {
  assertSafeDiagnosticEnvironment();
  validateConfiguration(configuration);
  if (
    !['native-fixtures.mts', 'native-formatter.mts'].includes(script) ||
    !/^[a-z-]+$/.test(mode) ||
    (name !== undefined && !/^[A-Za-z0-9_-]+$/.test(name))
  )
    throw new HarnessError('INVALID_NATIVE_CHECK');
  const prefix = script === 'native-fixtures.mts' ? 'native' : 'native-formatter';
  const attempt = script === 'native-fixtures.mts' && mode === 'cleanup' ? randomUUID() : undefined;
  const output = `${configuration.root}/${prefix}-${mode}${name ? `-${name}` : ''}${attempt ? `-${attempt}` : ''}`;
  try {
    await execute(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL(`./${script}`, import.meta.url)),
        mode,
        ...(name ? [name] : []),
        ...(attempt ? [attempt] : []),
      ],
      {
        cwd: fileURLToPath(new URL('../../../', import.meta.url)),
        env: {
          ...process.env,
          TEST_SAP_URL: 'https://a4h.marianzeis.de',
          TEST_SAP_CLIENT: '001',
          TEST_SAP_INSECURE: 'false',
        },
        timeout: 180_000,
        maxBuffer: 1024 * 1024,
      },
    );
  } catch (error) {
    await durable(
      `${output}-process-error.json`,
      {
        code: 'NATIVE_PROCESS_FAILED',
        stdout: String(error.stdout ?? '').slice(0, 131072),
        stderr: String(error.stderr ?? '').slice(0, 131072),
      },
      true,
    );
    throw new HarnessError('INDEPENDENT_NATIVE_CHECK_FAILED');
  }
  return privateJson(`${output}.json`);
}
