import { randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '');
const file = resolve(root, 'bootstrap-binding.json');
for (const path of [root, file]) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())
    throw new Error('Expected an owner-only HANA credential path');
}
const admin = JSON.parse(readFileSync(file, 'utf8'));
const users = Object.fromEntries(
  ['owner', 'reader', 'writer'].map((role) => [
    role,
    {
      host: admin.host,
      port: 443,
      schema: 'ARC_GRAPH',
      user: `ARC_GRAPH_${role.toUpperCase()}`,
      password: `Aa1${randomBytes(24).toString('hex')}`,
    },
  ]),
);
// This additional artifact never modifies or rotates previously generated credentials.
writeFileSync(resolve(root, 'provision-binding.json'), JSON.stringify({ ...admin, bootstrapUsers: users }), {
  flag: 'wx',
  mode: 0o600,
});
for (const [role, credentials] of Object.entries(users))
  writeFileSync(resolve(root, `${role}-binding.json`), JSON.stringify(credentials), { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ directory: root, prepared: ['owner', 'reader', 'writer'] }));
