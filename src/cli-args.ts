/**
 * Pure argument-parsing helpers for the `arc1 call` command.
 * Split out for focused tests and reuse. `src/cli.ts` is also import-safe:
 * parsing only starts when its exported `main()` is called.
 */

import { readFileSync } from 'node:fs';

export type OutputMode = 'text' | 'json';

export function coerceValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (raw !== '' && /^-?(\d+(\.\d+)?|\.\d+)$/.test(raw) && !Number.isNaN(Number(raw))) {
    return Number(raw);
  }
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(raw);
    } catch {
      // fall through — treat as literal string
    }
  }
  return raw;
}

export function parseArgPair(pair: string): [string, unknown] {
  const idx = pair.indexOf('=');
  if (idx <= 0) {
    throw new Error(`Invalid --arg '${pair}': expected key=value`);
  }
  return [pair.slice(0, idx), coerceValue(pair.slice(idx + 1))];
}

export function readJsonInput(source: string): Record<string, unknown> {
  let text: string;
  const trimmed = source.trimStart();
  if (source === '-') {
    text = readFileSync(0, 'utf-8');
  } else if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    text = source;
  } else {
    text = readFileSync(source, 'utf-8');
  }
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('--json payload must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function buildArgs(opts: { arg?: string[]; json?: string }): Record<string, unknown> {
  const fromJson = opts.json ? readJsonInput(opts.json) : {};
  const merged: Record<string, unknown> = { ...fromJson };
  for (const pair of opts.arg ?? []) {
    const [k, v] = parseArgPair(pair);
    merged[k] = v;
  }
  return merged;
}
