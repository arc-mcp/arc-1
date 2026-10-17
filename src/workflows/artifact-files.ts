import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export async function reserveArtifactDirectory(directory: string) {
  // Reserve a new private directory before SAP work; never mix new JSON with an old HTML report.
  await mkdir(dirname(directory), { recursive: true });
  await mkdir(directory, { mode: 0o700 });
}

export async function saveWorkflowArtifact(directory: string, json: unknown, html: string) {
  // Never silently overwrite an earlier review or exported customer evidence.
  await writeFile(join(directory, 'evidence.json'), `${JSON.stringify(json, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await writeFile(join(directory, 'report.html'), html, { flag: 'wx', mode: 0o600 });
  console.log(`Saved ${join(directory, 'evidence.json')} and ${join(directory, 'report.html')}`);
}
