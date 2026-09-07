import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Integration-test artifact only: the normal ARC distribution excludes the optional service.
const service = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arc = resolve(service, '../..');
const output = resolve(service, '.secrets/arc-test-artifact');
if (existsSync(output)) throw new Error('ARC test artifact already exists; choose a fresh test build deliberately');
for (const input of ['package.json', 'package-lock.json', 'dist', 'bin']) {
  const check = (path) => {
    if (lstatSync(path).isSymbolicLink()) throw new Error('Symlinks are not allowed in ARC test artifacts');
    if (lstatSync(path).isDirectory()) for (const name of readdirSync(path)) check(resolve(path, name));
  };
  check(resolve(arc, input));
}
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const input of ['package.json', 'package-lock.json', 'dist', 'bin'])
  cpSync(resolve(arc, input), resolve(output, input), { recursive: true });
console.log(output);
