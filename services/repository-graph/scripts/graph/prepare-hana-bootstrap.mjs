import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [directory, host] = process.argv.slice(2);
if (!directory || !/^[a-f0-9-]{36}\.hna0\.prod-[a-z0-9-]+\.hanacloud\.ondemand\.com$/.test(host ?? ''))
  throw new Error('Usage: prepare-hana-bootstrap.mjs PRIVATE_HANA_DIRECTORY HANA_SQL_HOST');
const root = resolve(directory);
const file = resolve(root, 'dbadmin-password');
for (const path of [root, file]) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())
    throw new Error('Expected an owner-only HANA credential path');
}
const output = resolve(root, 'bootstrap-binding.json');
writeFileSync(
  output,
  JSON.stringify({
    host,
    port: 443,
    user: 'DBADMIN',
    password: readFileSync(file, 'utf8').trim(),
  }),
  { mode: 0o600, flag: 'wx' },
);
console.log(output);
