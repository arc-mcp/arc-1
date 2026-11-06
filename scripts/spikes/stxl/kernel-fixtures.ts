import { readFile } from 'node:fs/promises';
import { liveContext, oracleJson } from './live-client.js';

const context = liveContext();
await context.save('features.json', await context.call('SAPManage', { action: 'probe' }));
const source = await readFile(new URL('./kernel-fixtures.abap', import.meta.url), 'utf8');
const result = await context.oracle(source);
await context.save('kernel-console.txt', result);
await context.save('kernel-fixtures-output.txt', oracleJson(result));
process.stderr.write(`${JSON.stringify({ label: context.label, outputBytes: result.length })}\n`);
