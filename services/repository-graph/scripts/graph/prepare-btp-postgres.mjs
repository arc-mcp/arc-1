import { randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cfJson, preflight } from './preflight-btp.mjs';

export function validateBtpSettings(input) {
  const names = ['database', 'databaseKey', 'prefix'];
  for (const name of names) if (!/^[a-zA-Z0-9_-]{1,80}$/.test(input[name] ?? '')) throw new Error(`Invalid ${name}`);
  if (
    !/^[a-f0-9-]{36}$/i.test(input.subaccount ?? '') ||
    !/^[A-Z0-9][A-Z0-9._:-]{0,127}$/.test(input.systemKey ?? '') ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(input.audience ?? '') ||
    input.sharing !== 'shared-repository-metadata'
  )
    throw new Error('Explicit subaccount, system, audience and shared-metadata approval required');
  const url = new URL(input.url);
  if (url.protocol !== 'https:' || url.origin !== input.url || url.username || url.password)
    throw new Error('Graph URL must be a credential-free HTTPS origin');
  return input;
}

/** Pure credential projection: the admin identity is never returned in reader/writer files. */
export function postgresArtifacts(settings, credentials, random = () => randomBytes(32).toString('hex')) {
  validateBtpSettings(settings);
  const host = credentials.hostname ?? credentials.host;
  const database = credentials.dbname ?? credentials.database;
  if (
    typeof host !== 'string' ||
    /[\s/@]/.test(host) ||
    typeof database !== 'string' ||
    !database ||
    !Number.isInteger(Number(credentials.port)) ||
    Number(credentials.port) < 1 ||
    Number(credentials.port) > 65535
  )
    throw new Error('Invalid PostgreSQL binding endpoint');
  const secrets = { apiPassword: random(), writerPassword: random(), apiKey: random() };
  if (Object.values(secrets).some((value) => !/^[a-f0-9]{64}$/.test(value)))
    throw new Error('Invalid generated secrets');
  const base = {
    host,
    database,
    port: Number(credentials.port),
    ...(credentials.sslcert ? { sslcert: credentials.sslcert } : {}),
  };
  return {
    'bootstrap-auth.json': { apiPassword: secrets.apiPassword, writerPassword: secrets.writerPassword },
    'reader.json': { ...base, user: 'arc_graph_api', password: secrets.apiPassword },
    'writer.json': { ...base, user: 'arc_graph_writer', password: secrets.writerPassword },
    'api-auth.json': { apiKey: secrets.apiKey },
    'connection.json': {
      version: 1,
      url: settings.url,
      systemKey: settings.systemKey,
      audience: settings.audience,
      sharing: settings.sharing,
      apiKey: secrets.apiKey,
    },
  };
}

export function prepareBtpPostgres(settings, output, api = cfJson, check = preflight) {
  validateBtpSettings(settings);
  const checked = check(settings.subaccount, settings.database, 0, 0);
  if (checked.databaseOffering !== 'postgresql-db') throw new Error('This helper requires PostgreSQL free');
  const bindings = api(
    `/v3/service_credential_bindings?service_instance_guids=${checked.databaseGuid}&type=key`,
  ).resources;
  const keys = bindings?.filter((binding) => binding.name === settings.databaseKey);
  if (keys?.length !== 1) throw new Error('Create/select exactly one database bootstrap service key first');
  const { credentials } = api(`/v3/service_credential_bindings/${keys[0].guid}/details`);
  const artifacts = postgresArtifacts(settings, credentials);
  const target = resolve(output);
  // Output parent must already exist; canonicalize it and reject a symlink at the final component.
  if (lstatSync(dirname(target)).isSymbolicLink() || realpathSync(dirname(target)) !== dirname(target))
    throw new Error('Output parent must use its canonical path');
  mkdirSync(target, { mode: 0o700 }); // Exclusive: existing installations must keep their original credentials.
  for (const [name, value] of Object.entries(artifacts))
    writeFileSync(join(target, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return { status: 'prepared', directory: target, files: Object.keys(artifacts), paidResourcesCreated: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw new Error();
    console.log(JSON.stringify(prepareBtpPostgres(JSON.parse(readFileSync(process.argv[2], 'utf8')), process.argv[3])));
  } catch {
    console.error(
      'PostgreSQL preparation failed; verify free target/key, settings and a new private output directory. No credentials logged.',
    );
    process.exitCode = 1;
  }
}
