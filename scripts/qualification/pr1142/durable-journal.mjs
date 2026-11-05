import { randomUUID } from 'node:crypto';
import { open, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
export async function durable(path, value, exclusive = false) {
  const destination = exclusive ? path : `${path}.${randomUUID()}.tmp`;
  const file = await open(destination, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(value, null, 2) + '\n');
    await file.sync();
  } finally {
    await file.close();
  }
  if (!exclusive) await rename(destination, path);
  const parent = await open(dirname(path), 'r');
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}
