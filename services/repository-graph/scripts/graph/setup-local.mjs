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
  // Compose file secrets are bind mounts: uid/gid/mode remapping is ignored on Linux.
  // Keep original ARC files 0600. Individually mounted copies are 0444 INSIDE an owner-only
  // 0700 host directory, so unrelated host users cannot traverse to them. Containers see
  // only their explicitly granted files, regardless of their numeric uid (node vs postgres).
  const mounts = join(secrets, 'docker-mounts');
  if (existsSync(mounts) && (lstatSync(mounts).isSymbolicLink() || !lstatSync(mounts).isDirectory()))
    throw new Error('Unsafe Docker secret directory');
  mkdirSync(mounts, { recursive: true, mode: 0o700 });
  chmodSync(mounts, 0o700);
  for (const name of [
    'graph_api_key',
    'pg_admin_password',
    'pg_api_password',
    'pg_writer_password',
    'destination-service-key.json',
  ]) {
    const source = join(secrets, name);
    if (!existsSync(source)) continue; // Optional live Destination binding is absent offline.
    if (lstatSync(source).isSymbolicLink() || !lstatSync(source).isFile()) throw new Error('Unsafe secret source');
    const target = join(mounts, name);
    const content = readFileSync(source);
    if (existsSync(target)) {
      if (lstatSync(target).isSymbolicLink() || !lstatSync(target).isFile() || !readFileSync(target).equals(content))
        throw new Error('Existing Docker secret differs; coordinate credential rotation explicitly');
    } else writeFileSync(target, content, { flag: 'wx', mode: 0o444 });
    chmodSync(target, 0o444);
  }
  return { descriptor, createdOrPreserved: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  setupLocal();
  console.log(
    'Local graph setup ready. Connection: <ARC_GRAPH_SECRET_DIR>/arc1-graph-connection.json (default directory: .secrets).',
  );
}
