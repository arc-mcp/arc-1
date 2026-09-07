import { randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function prepareGraphAuth(settings, output) {
  const url = new URL(settings.url);
  if (
    url.protocol !== 'https:' ||
    url.origin !== settings.url ||
    url.username ||
    url.password ||
    !/^[A-Z0-9][A-Z0-9._:-]{0,127}$/.test(settings.systemKey ?? '') ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(settings.audience ?? '') ||
    settings.sharing !== 'shared-repository-metadata'
  )
    throw new Error('Explicit HTTPS origin, system, audience and sharing approval required');
  const directory = resolve(output);
  if (lstatSync(dirname(directory)).isSymbolicLink() || realpathSync(dirname(directory)) !== dirname(directory))
    throw new Error('Use an existing canonical parent directory');
  mkdirSync(directory, { mode: 0o700 });
  const apiKey = randomBytes(32).toString('hex');
  for (const [name, value] of Object.entries({
    'api-auth.json': { apiKey },
    'connection.json': {
      version: 1,
      url: settings.url,
      systemKey: settings.systemKey,
      audience: settings.audience,
      sharing: settings.sharing,
      apiKey,
    },
  }))
    writeFileSync(join(directory, name), JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  return { status: 'prepared', directory, files: ['api-auth.json', 'connection.json'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error();
    console.log(JSON.stringify(prepareGraphAuth(JSON.parse(readFileSync(process.argv[2], 'utf8')), process.argv[3])));
  } catch {
    console.error(
      'Graph auth preparation failed; verify settings and a new private output directory. No credentials logged.',
    );
    process.exitCode = 1;
  }
}
