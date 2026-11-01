#!/usr/bin/env node
/** Capture a selected CF service key directly into a private local file, never into tool output. */
import { execFile } from 'node:child_process';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';
import { promisify } from 'node:util';
import { assertSafeDiagnosticEnvironment, HarnessError, label, outsideRepository, safeFailure } from './safe-io.mjs';

const run = promisify(execFile);

async function main() {
  assertSafeDiagnosticEnvironment();
  const [service, key, outputDirectory = '/tmp/arc1-pr677-private', filename = 'xsuaa-credentials.json'] =
    process.argv.slice(2);
  label(service);
  label(key);
  if (!/^[a-zA-Z0-9_-]{1,64}\.json$/.test(filename) || !isAbsolute(outputDirectory))
    throw new HarnessError('INVALID_PRIVATE_OUTPUT_PATH');
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
  const actualDirectory = await realpath(outputDirectory);
  if (!outsideRepository(actualDirectory)) throw new HarnessError('PRIVATE_OUTPUT_MUST_BE_OUTSIDE_REPOSITORY');
  const directory = await lstat(actualDirectory);
  if (!directory.isDirectory() || (directory.mode & 0o077) !== 0 || directory.uid !== process.getuid())
    throw new HarnessError('PRIVATE_DIRECTORY_REQUIRES_OWNER_ONLY_PERMISSIONS');
  let stdout;
  try {
    ({ stdout } = await run('cf', ['service-key', service, key], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 30_000,
      env: { ...process.env, CF_TRACE: 'false' },
    }));
  } catch {
    throw new HarnessError('CF_SERVICE_KEY_READ_FAILED');
  }
  let credentials;
  try {
    const parsed = JSON.parse(stdout.slice(stdout.indexOf('{')));
    credentials = parsed.credentials ?? parsed;
    for (const field of ['clientid', 'clientsecret', 'url', 'xsappname', 'uaadomain']) {
      if (typeof credentials[field] !== 'string' || !credentials[field]) throw new Error('invalid');
    }
    if (new URL(credentials.url).protocol !== 'https:') throw new Error('invalid');
  } catch {
    throw new HarnessError('CF_SERVICE_KEY_DID_NOT_RETURN_XSUAA_CREDENTIALS');
  }
  const destination = resolve(actualDirectory, filename);
  let file;
  try {
    file = await open(destination, 'wx', 0o600);
    await file.writeFile(`${JSON.stringify(credentials)}\n`, 'utf8');
  } catch {
    throw new HarnessError('PRIVATE_OUTPUT_CREATE_FAILED_OR_ALREADY_EXISTS');
  } finally {
    await file?.close();
  }
  process.stdout.write(
    `${JSON.stringify({ event: 'credentials_saved', path: destination, service, key, mode: '0600', credentialFields: Object.keys(credentials).length })}\n`,
  );
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ event: 'credentials_prepare_failed', ...safeFailure(error) })}\n`);
  process.exitCode = 1;
});
