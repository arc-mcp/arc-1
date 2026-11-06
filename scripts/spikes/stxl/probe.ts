/** Manual, read-only transport probe. Credentials stay in TEST_SAP_* environment variables. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AdtClient } from '../../../src/adt/client.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
const baseUrl = required('TEST_SAP_URL');
if (new URL(baseUrl).protocol !== 'https:') throw new Error('The live spike requires verified HTTPS');
const label = required('STXL_SYSTEM_LABEL');
if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid system label');
const output = resolve(required('STXL_OUTPUT_DIR'));
await mkdir(output, { recursive: true, mode: 0o700 });
const client = new AdtClient({
  baseUrl,
  username: required('TEST_SAP_USER'),
  password: required('TEST_SAP_PASSWORD'),
  client: required('TEST_SAP_CLIENT'),
  language: 'EN',
  maxConcurrent: 2,
  safety: { ...defaultSafetyConfig(), allowDataPreview: true },
});
const results: Record<string, unknown> = { label, baseUrl, time: new Date().toISOString() };
const mode = process.env.STXL_PREVIEW_MODE === 'ddic' ? 'ddic' : 'query';
try {
  results.components = await client.getInstalledComponents();
  const data =
    process.env.STXL_PREVIEW_MODE === 'ddic'
      ? await client.getTableContents('STXL', 2)
      : await client.runTableQuery('STXL', {
          columns: ['RELID', 'TDOBJECT', 'TDNAME', 'TDID', 'TDSPRAS', 'SRTF2', 'CLUSTR', 'CLUSTD'],
          where: [{ field: 'TDOBJECT', op: '=', value: 'TEXT' }],
          maxRows: 5,
        });
  await writeFile(resolve(output, `${label}-${mode}-initial.json`), JSON.stringify(data, null, 2), { mode: 0o600 });
  results.rows = data.rows.map(({ CLUSTD, ...row }) => ({
    ...row,
    binaryCharacters: CLUSTD?.length,
    hexOnly: /^[0-9a-f]*$/i.test(CLUSTD ?? ''),
    binaryPrefix: CLUSTD?.slice(0, 48),
  }));
} catch (error) {
  results.error = error instanceof Error ? error.message : 'Unknown probe failure';
  process.exitCode = 1;
}
await writeFile(resolve(output, `${label}-${mode}-probe.json`), JSON.stringify(results, null, 2), { mode: 0o600 });
process.stderr.write(`${JSON.stringify(results, null, 2)}\n`);
