/** Temporary #1057 research infrastructure. Never merge this experiment into main. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AdtClient } from '../../src/adt/client.js';
import { fetchDiscoveryDocument } from '../../src/adt/discovery.js';
import { defaultSafetyConfig } from '../../src/adt/safety.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { getTestClient } from '../integration/helpers.js';

export const PUBLIC_DIR = 'test-results/1057-public';
export const MANIFEST = `${PUBLIC_DIR}/manifest.json`;
export const BASELINE = 'e21b7159e';
export type Outcome = 'setup' | 'ordinary-scoped-failure' | 'other-failure' | 'passed';
export interface Pair {
  root: string;
  consumer: string;
  absentBeforeCreate: boolean;
  attempts: string[];
  conflicts: string[];
  activatedAt?: number;
  outcome: Outcome;
  retain?: 'control' | 'failure';
  indexOk?: boolean;
  activeSourcesMatch?: boolean;
  phase?: string;
  cleanup: Record<string, 'absent' | 'failed' | 'conflict-refused'>;
}
export interface Manifest {
  baseline: typeof BASELINE;
  startedUtc: string;
  pairs: Pair[];
  trialFailures: number;
  errors?: { phase: string; kind: string; status: number | null; category: string | null }[];
  stop?: 'target' | 'setup' | 'index' | 'cleanup' | 'process';
  observationFailures?: number;
  nativeInspectionReadyUtc?: string;
  holdStartedUtc?: string;
  holdFinishedUtc?: string;
  cleanupFinishedUtc?: string;
}

export class ProbeError extends Error {
  constructor(
    public readonly kind: 'lock' | 'conflict' | 'tool' | 'target' | 'ownership' | 'metadata',
    public readonly status: number | null = null,
    public readonly category: string | null = null,
  ) {
    super(`Diagnostic operation failed (${kind}).`);
  }
}

export function recordError(state: Manifest, phase: string, error: unknown): void {
  state.errors ??= [];
  if (state.errors.length < 64)
    state.errors.push({
      phase,
      kind: error instanceof ProbeError ? error.kind : 'unexpected',
      status: error instanceof ProbeError ? error.status : null,
      category: error instanceof ProbeError ? error.category : null,
    });
  writeJson(MANIFEST, state);
}

export function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
export function readManifest(): Manifest {
  const value = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest;
  if (value.baseline !== BASELINE || !Array.isArray(value.pairs) || value.pairs.length > 6) {
    throw new ProbeError('ownership');
  }
  for (const pair of value.pairs) validatePair(pair);
  return value;
}
export function validatePair(pair: Pair): void {
  const suffix = /^ZAR1057_ROOT_([A-Z0-9]{7,12})$/.exec(pair.root)?.[1];
  if (!suffix || pair.consumer !== `ZAR1057_USE_${suffix}`) throw new ProbeError('ownership');
  for (const name of [...pair.attempts, ...pair.conflicts, ...Object.keys(pair.cleanup)]) {
    if (name !== pair.root && name !== pair.consumer) throw new ProbeError('ownership');
  }
}

function checkMutationScope(client: AdtClient): void {
  if (
    !client.safety.allowWrites ||
    client.safety.allowedPackages.length !== 1 ||
    client.safety.allowedPackages[0] !== '$TMP'
  ) {
    throw new ProbeError('ownership');
  }
}

export function makeClient(): AdtClient {
  return getTestClient().withSafety({ ...defaultSafetyConfig(), allowWrites: true, allowDataPreview: true });
}

export async function checkTarget(client: AdtClient): Promise<void> {
  const configured = new URL(process.env.TEST_SAP_URL ?? 'https://invalid.invalid');
  const target = {
    urlMatches: configured.href === 'https://a4h-2025.marianzeis.de/',
    clientMatches: process.env.TEST_SAP_CLIENT === '001',
    tlsVerified: process.env.TEST_SAP_INSECURE !== 'true',
    basisMatches: null as boolean | null,
  };
  writeJson(`${PUBLIC_DIR}/target.json`, target);
  if (!target.urlMatches || !target.clientMatches || !target.tlsVerified) throw new ProbeError('target');
  const components = await client.getInstalledComponents();
  target.basisMatches = components.some((row) => row.name === 'SAP_BASIS' && row.release === '816');
  writeJson(`${PUBLIC_DIR}/target.json`, target);
  if (!target.basisMatches) throw new ProbeError('target');
  client.http.setDiscoveryMap((await fetchDiscoveryDocument(client.http)).map);
}

export async function call(client: AdtClient, tool: string, args: Record<string, unknown>): Promise<string> {
  const result = await handleToolCall(client, { ...DEFAULT_CONFIG, minimalErrors: true }, tool, args);
  if (!result.isError) return result.content[0]!.text!;
  const text = result.content[0]?.text ?? '';
  const statusText = /\bstatus (\d{3})\b/i.exec(text)?.[1];
  const status = statusText ? Number(statusText) : null;
  const category = /\bCategory: ([a-z-]{1,64})\./.exec(text)?.[1] ?? null;
  if (/Category: (lock-conflict|invalid-lock-handle|enqueue-error)\./.test(text) || /status 423\./.test(text)) {
    throw new ProbeError('lock', status, category);
  }
  if (/Category: object-exists\.|\balready exists?\b|\bstatus 409\b/i.test(text))
    throw new ProbeError('conflict', status, category);
  throw new ProbeError('tool', status, category);
}

export async function absent(client: AdtClient, name: string): Promise<boolean> {
  try {
    await client.http.get(`/sap/bc/adt/oo/classes/${name.toLowerCase()}`);
    return false;
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 404) return true;
    throw new ProbeError('metadata');
  }
}

/** Check both names before either mutation; register each attempt durably before sending it. */
export async function preparePair(client: AdtClient, state: Manifest, pair: Pair): Promise<void> {
  validatePair(pair);
  if (!(await absent(client, pair.root)) || !(await absent(client, pair.consumer))) throw new ProbeError('ownership');
  pair.absentBeforeCreate = true;
  writeJson(MANIFEST, state);
}
export async function createOwned(
  client: AdtClient,
  state: Manifest,
  pair: Pair,
  name: string,
  source: string,
): Promise<void> {
  validatePair(pair);
  checkMutationScope(client);
  if (!pair.absentBeforeCreate || ![pair.root, pair.consumer].includes(name)) throw new ProbeError('ownership');
  pair.attempts.push(name);
  pair.phase = 'create';
  writeJson(MANIFEST, state);
  try {
    await call(client, 'SAPWrite', { action: 'create', type: 'CLAS', name, package: '$TMP', source });
  } catch (error) {
    if (error instanceof ProbeError && error.kind === 'conflict') {
      pair.conflicts.push(name);
      writeJson(MANIFEST, state);
    }
    throw error;
  }
  pair.phase = 'activate';
  writeJson(MANIFEST, state);
  await call(client, 'SAPActivate', { type: 'CLAS', name });
}

export function selectRetention(state: Manifest, pair: Pair): void {
  if (!pair.activatedAt || pair.activeSourcesMatch === false) return;
  if (pair.outcome === 'passed' && (!pair.indexOk || !pair.activeSourcesMatch)) return;
  const role =
    pair.outcome === 'passed' ? 'control' : pair.outcome === 'ordinary-scoped-failure' ? 'failure' : undefined;
  if (role && !state.pairs.some((other) => other !== pair && other.retain === role)) pair.retain = role;
}

/** Cleanup uses the same package-gated tool as creation. Never delete an explicit conflict. */
export async function cleanupPair(client: AdtClient, state: Manifest, pair: Pair, retryMs = 180_000): Promise<boolean> {
  validatePair(pair);
  checkMutationScope(client);
  if (!pair.absentBeforeCreate) return pair.attempts.length === 0;
  let ok = true;
  const deadline = Date.now() + retryMs;
  for (const name of [...new Set(pair.attempts)].reverse()) {
    if (pair.conflicts.includes(name)) {
      pair.cleanup[name] = 'conflict-refused';
      ok = false;
      continue;
    }
    while (true) {
      try {
        if (!(await absent(client, name))) await call(client, 'SAPWrite', { action: 'delete', type: 'CLAS', name });
        if (!(await absent(client, name))) throw new ProbeError('metadata');
        pair.cleanup[name] = 'absent';
        break;
      } catch (error) {
        if (error instanceof ProbeError && error.kind === 'lock' && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, deadline - Date.now())));
          continue;
        }
        pair.cleanup[name] = 'failed';
        recordError(state, 'cleanup', error);
        ok = false;
        break;
      }
    }
    writeJson(MANIFEST, state);
  }
  writeJson(MANIFEST, state);
  return ok;
}

/** Publish a semantic classification, never arbitrary SAP description text. */
export function recordDescriptions(client: AdtClient, root: string) {
  const original = client.http.post;
  const descriptions: { bytes: number; classification: string }[] = [];
  client.http.post = async function (...args) {
    const result = await original.apply(this, args);
    if (args[0].startsWith('/sap/bc/adt/repository/informationsystem/usageReferences') && descriptions.length < 3) {
      const description =
        result.body.length <= 65_536 ? /\bresultDescription="([^"]*)"/.exec(result.body)?.[1] : undefined;
      descriptions.push({
        bytes: description === undefined ? 0 : Buffer.byteLength(description),
        classification:
          description === undefined
            ? 'missing-or-over-cap'
            : description === `[A4H] Where-Used List: ${root} (Class)`
              ? 'expected-class-template'
              : 'other',
      });
    }
    return result;
  };
  return {
    descriptions,
    restore: () => {
      client.http.post = original;
    },
  };
}

export const INDEX_QUERIES = [
  { table: 'WBBGRFCTMP', field: 'PROGNAME', columns: ['PROGNAME', 'ADATE', 'TIME', 'STARTED', 'INDEX_OK'] },
  {
    table: 'WBCROSSMD',
    field: 'PROG_NAME',
    columns: [
      'PROG_NAME',
      'STATE',
      'IDX_LAST_CHANGED_AT',
      'IDX_LAST_CHANGED_ON',
      'IDX_VERSION',
      'COMPILER_ERROR',
      'DURATION',
    ],
  },
  {
    table: 'WBCROSSGT',
    field: 'NAME',
    columns: ['OTYPE', 'NAME', 'INCLUDE', 'DIRECT', 'INDIRECT', 'COMPONENT', 'UDATE', 'UZEIT'],
  },
  { table: 'WBCROSSI', field: 'INCLUDE', columns: ['OTYPE', 'INCLUDE', 'MASTER', 'STATE', 'UDATE', 'UZEIT'] },
] as const;

/** A single deadline covers every native read in a snapshot. No mutations use this wrapper. */
export async function withReadDeadline<T>(client: AdtClient, milliseconds: number, run: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + milliseconds;
  const get = client.http.get;
  const post = client.http.post;
  client.http.get = (path, headers, options) => get.call(client.http, path, headers, { ...options, deadline });
  client.http.post = (path, body, contentType, headers, options) =>
    post.call(client.http, path, body, contentType, headers, { ...options, deadline });
  try {
    return await run();
  } finally {
    client.http.get = get;
    client.http.post = post;
  }
}

export async function snapshotIndex(client: AdtClient, pair: Pair, label: string): Promise<void> {
  validatePair(pair);
  const reads: unknown[] = [];
  let complete = false;
  try {
    await withReadDeadline(client, 25_000, async () => {
      for (const spec of INDEX_QUERIES) {
        for (const name of spec.table === 'WBCROSSGT' ? [pair.root] : [pair.root, pair.consumer]) {
          const startedUtc = new Date().toISOString();
          const result = await client.runTableQuery(spec.table, {
            columns: [...spec.columns],
            where: [{ field: spec.field, op: 'LIKE', value: `${name}%` }],
            maxRows: 30,
          });
          // Never publish user/host columns or names outside our two program prefixes.
          const exactRows = result.rows.filter((row) => String(row[spec.field] ?? '').startsWith(name));
          const rows = exactRows.map((row) =>
            Object.fromEntries(
              spec.columns.map((field) => {
                const value = String(row[field] ?? '');
                const programField = ['PROGNAME', 'PROG_NAME', 'NAME', 'INCLUDE', 'MASTER'].includes(field);
                return [
                  field,
                  programField && ![pair.root, pair.consumer].some((owned) => value.startsWith(owned))
                    ? '[outside-owned-prefix]'
                    : value,
                ];
              }),
            ),
          );
          reads.push({
            table: spec.table,
            prefix: name,
            startedUtc,
            finishedUtc: new Date().toISOString(),
            rows,
            atRowCap: result.rows.length === 30,
            // SQL LIKE also treats underscores as wildcards; never mistake such rows for ours.
            outsideExactPrefix: result.rows.length - exactRows.length,
          });
        }
      }
    });
    complete = true;
  } finally {
    writeJson(`${PUBLIC_DIR}/${pair.root}-${label}-index.json`, {
      complete,
      observedUtc: new Date().toISOString(),
      reads,
    });
  }
}
