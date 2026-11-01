import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AdtClient } from '../../../src/adt/client.js';
import { checkOperation, defaultSafetyConfig, OperationType } from '../../../src/adt/safety.js';
import { handleToolCall } from '../../../src/handlers/dispatch.js';
import { createPluginRunOps } from '../../../src/server/safe-http-client.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

export function liveContext() {
  const baseUrl = required('TEST_SAP_URL');
  if (new URL(baseUrl).protocol !== 'https:') throw new Error('Verified HTTPS is required');
  const label = required('STXL_SYSTEM_LABEL');
  if (!/^[a-z0-9-]+$/.test(label)) throw new Error('Invalid system label');
  const output = resolve(required('STXL_OUTPUT_DIR'));
  const allowHelpers = process.env.STXL_ALLOW_HELPERS === 'true';
  const safety = {
    ...defaultSafetyConfig(),
    allowDataPreview: true,
    allowWrites: allowHelpers,
    allowFreeSQL: process.env.STXL_ALLOW_FREE_SQL === 'true',
  };
  const client = new AdtClient({
    baseUrl,
    username: required('TEST_SAP_USER'),
    password: required('TEST_SAP_PASSWORD'),
    client: required('TEST_SAP_CLIENT'),
    language: 'EN',
    maxConcurrent: 2,
    safety,
  });
  const config = { ...DEFAULT_CONFIG, ...safety, lintBeforeWrite: false, allowPluginExecute: allowHelpers };
  async function save(name: string, value: unknown) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('Invalid artifact name');
    await mkdir(output, { recursive: true, mode: 0o700 });
    await writeFile(
      resolve(output, `${label}-${name}`),
      typeof value === 'string' ? value : JSON.stringify(value, null, 2),
      { mode: 0o600 },
    );
  }
  async function call(tool: string, args: Record<string, unknown>) {
    const result = await handleToolCall(client, config, tool, args);
    if (result.isError) throw new Error(`${tool}: ${JSON.stringify(result.content)}`);
    return result;
  }
  async function oracle(source: string) {
    if (!allowHelpers) throw new Error('Set STXL_ALLOW_HELPERS=true for disposable $TMP helpers');
    const name = `ZCL_ARC1_STXL_${Date.now().toString(36).toUpperCase()}`;
    const actualSource = source.replaceAll('ZCL_ARC1_STXL_ORACLE', name);
    await save(`${name}.abap`, actualSource);
    let created = false;
    try {
      await call('SAPWrite', {
        action: 'create',
        type: 'CLAS',
        name,
        description: 'Disposable STXL kernel oracle',
        package: '$TMP',
      });
      created = true;
      await save('helper-lifecycle.json', { name, state: 'created' });
      await call('SAPWrite', { action: 'update', type: 'CLAS', name, source: actualSource, lintBeforeWrite: false });
      await call('SAPActivate', { objects: [{ type: 'CLAS', name }] });
      if (process.env.STXL_LEGACY_GET_CLASSRUN === 'true') {
        // Verified in 7.50 CL_OO_ADT_RES_CLASSRUN~GET. GET still executes arbitrary ABAP:
        // retain the same explicit helper opt-in and mutation safety gate as POST.
        checkOperation(safety, OperationType.Workflow, 'STXLSpikeOracle:LegacyClassRun');
        return (await client.http.get(`/sap/bc/adt/oo/classrun/${name}`)).body;
      }
      const run = createPluginRunOps(client.http, safety, true, 'write', 'STXLSpikeOracle');
      return await run.classRun(name);
    } finally {
      if (created) {
        await call('SAPWrite', { action: 'delete', type: 'CLAS', name });
        await save('helper-lifecycle.json', { name, state: 'deleted' });
        await save(`${name}-lifecycle.json`, { name, state: 'deleted' });
      }
    }
  }
  return { client, label, output, save, call, oracle };
}

export function oracleJson(result: string): string {
  if (!/^[A-Za-z\d+/=\s]+$/.test(result)) throw new Error('Oracle did not return base64 JSON');
  const json = Buffer.from(result.trim(), 'base64').toString('utf8');
  if (!Array.isArray(JSON.parse(json).CASES)) throw new Error('Oracle JSON has no CASES');
  return json;
}
