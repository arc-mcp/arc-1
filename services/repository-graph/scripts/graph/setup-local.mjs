import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function setupLocal(env = process.env) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const secrets = resolve(root, env.ARC_GRAPH_SECRET_DIR || '.secrets');
  const port = Number(env.ARC_GRAPH_HOST_PORT || 8091);
  const systemKey = env.ARC_GRAPH_API_SYSTEM_KEY || 'TRIAL-2023-001';
  const audience = env.ARC_GRAPH_API_AUDIENCE || 'trial';
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    !/^[A-Z0-9][A-Z0-9._:-]{0,127}$/.test(systemKey) ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(audience)
  )
    throw new Error('Invalid local graph scope/port');
  if (existsSync(secrets) && (lstatSync(secrets).isSymbolicLink() || !lstatSync(secrets).isDirectory()))
    throw new Error('Unsafe secrets directory');
  mkdirSync(secrets, { recursive: true, mode: 0o700 });
  chmodSync(secrets, 0o700);
  for (const name of ['graph_api_key', 'pg_admin_password', 'pg_api_password', 'pg_writer_password']) {
    const file = join(secrets, name);
    if (existsSync(file) && (lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()))
      throw new Error('Unsafe secret file');
    if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600, flag: 'wx' });
    chmodSync(file, 0o600);
  }
  const descriptor = join(secrets, 'arc1-graph-connection.json');
  const data = {
    version: 1,
    url: `http://127.0.0.1:${port}`,
    systemKey,
    audience,
    sharing: 'shared-repository-metadata',
    apiKeyFile: join(secrets, 'graph_api_key'),
  };
  if (!isAbsolute(data.apiKeyFile)) throw new Error('Absolute key path required');
  if (existsSync(descriptor)) {
    if (lstatSync(descriptor).isSymbolicLink() || !lstatSync(descriptor).isFile()) throw new Error('Unsafe descriptor');
    const current = JSON.parse(readFileSync(descriptor, 'utf8'));
    if (JSON.stringify(current) !== JSON.stringify(data))
      throw new Error('Existing descriptor differs; use its original settings or a new ARC_GRAPH_SECRET_DIR');
    chmodSync(descriptor, 0o600);
  }
  if (!existsSync(descriptor))
    writeFileSync(descriptor, JSON.stringify(data, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { descriptor, createdOrPreserved: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(setupLocal()));
}
