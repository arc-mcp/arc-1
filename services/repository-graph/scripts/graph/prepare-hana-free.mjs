import { randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Preparation only: provisioning must explicitly select the hana-free service plan.
export function prepareHanaFree(directory) {
  const target = resolve(directory);
  for (let parent = dirname(target); ; parent = dirname(parent)) {
    try {
      if (lstatSync(parent).isSymbolicLink()) throw new Error('Refusing a symlink parent');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (parent === dirname(parent)) break;
  }
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  mkdirSync(target, { mode: 0o700 }); // Never overwrite existing administrator credentials.
  const password = `Aa1${randomBytes(32).toString('hex')}`;
  const parameters = { data: { memory: 16, systempassword: password, whitelistIPs: [] } };
  writeFileSync(resolve(target, 'parameters.json'), `${JSON.stringify(parameters)}\n`, {
    flag: 'wx',
    mode: 0o600,
  });
  writeFileSync(resolve(target, 'dbadmin-password'), `${password}\n`, { flag: 'wx', mode: 0o600 });
  return resolve(target, 'parameters.json');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: prepare-hana-free.mjs PRIVATE_DIRECTORY');
    console.log(prepareHanaFree(process.argv[2]));
  } catch {
    console.error('HANA free preparation failed; existing paths are never overwritten.');
    process.exitCode = 1;
  }
}
