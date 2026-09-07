import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// Deliberate allowlist: never upload the project root, local secrets, source snapshots or reports.
export const inputs = [
  'package.json',
  'package-lock.json',
  'dist',
  'db/pg/migrations',
  'tests/graph/fixtures/golden.json',
  'tests/graph/api-v2.mjs',
];
export function packageCf(source = root, target = join(root, '.graph-cf')) {
  source = resolve(source);
  target = resolve(target);
  if (target === source || source.startsWith(`${target}/`)) throw new Error('Unsafe artifact target');
  const marker = join(target, '.arc-graph-artifact');
  if (
    existsSync(target) &&
    (lstatSync(target).isSymbolicLink() ||
      !existsSync(marker) ||
      lstatSync(marker).isSymbolicLink() ||
      readFileSync(marker, 'utf8') !== source)
  ) {
    throw new Error('Refusing to replace an unowned artifact directory');
  }
  for (const input of inputs) {
    const check = (path) => {
      if (lstatSync(path, { throwIfNoEntry: true }).isSymbolicLink()) throw new Error('No symlinks in CF artifacts');
      if (lstatSync(path).isDirectory()) for (const name of readdirSync(path)) check(join(path, name));
    };
    check(join(source, input));
  }
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  writeFileSync(marker, source);
  for (const input of inputs) {
    mkdirSync(dirname(join(target, input)), { recursive: true });
    cpSync(join(source, input), join(target, input), { recursive: true, dereference: false });
  }
  return target;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) process.stdout.write(`${packageCf()}\n`);
