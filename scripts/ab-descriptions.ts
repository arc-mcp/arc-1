#!/usr/bin/env tsx
/**
 * A/B a description change against the routing benchmark.
 *
 * Takes an overlay of tool definitions (same shape the optimizer emits, or hand-written) and scores
 * it against the stock surface on the same 181 fixed cases. Reports per-tool deltas so you can see
 * both the intended win AND whether the change stole calls from a neighbouring tool — a shorter or
 * louder SAPWrite pulls in requests that belong to SAPRead, and only the full case set shows that.
 *
 * This is the "does it still work?" command for later runs: cases are fixed, temperature is 0, and
 * the seed is pinned, so a re-run on a future branch is comparable to today's numbers.
 *
 *   npx tsx scripts/ab-descriptions.ts --overlay experiments/sapwrite-reordered.json
 *   npx tsx scripts/ab-descriptions.ts --overlay <f> --model claude-haiku-4-5-20251001
 *   npx tsx scripts/ab-descriptions.ts --overlay <f> --only SAPWrite   # target tool's cases only (fast)
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { getToolDefinitions, type ToolDefinition } from '../src/handlers/tools.js';
import { descriptionsOnlyDiff } from './optimize-tool-descriptions.js';
import { FULL_CONFIG, loadCases, type RoutingCase, runBench } from './routing-bench.js';

loadDotenv();

const argv = process.argv.slice(2);
function flag(name: string, fallback = ''): string {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

export interface ToolDelta {
  tool: string;
  before: number;
  after: number;
  total: number;
}

/** Per-tool pass counts, so a win on the target tool can be told apart from theft elsewhere. */
export function perTool(cases: RoutingCase[], failedIds: Set<string>): Map<string, { ok: number; total: number }> {
  const out = new Map<string, { ok: number; total: number }>();
  for (const c of cases) {
    const row = out.get(c.tool) ?? { ok: 0, total: 0 };
    row.total++;
    if (!failedIds.has(c.id)) row.ok++;
    out.set(c.tool, row);
  }
  return out;
}

export function diffTools(
  before: Map<string, { ok: number; total: number }>,
  after: Map<string, { ok: number; total: number }>,
): ToolDelta[] {
  return [...before.entries()]
    .map(([tool, b]) => ({ tool, before: b.ok, after: after.get(tool)?.ok ?? 0, total: b.total }))
    .sort((a, b) => a.after - a.before - (b.after - b.before));
}


/**
 * An overlay is meant to change descriptions only. Applying one that also alters enums or
 * properties silently turns a "description A/B" into a schema comparison, and the reader has no way
 * to tell. Validate before scoring, not after publishing the number.
 */
export function assertDescriptionOnlyOverlay(
  stock: ToolDefinition[],
  overlay: Record<string, ToolDefinition>,
): void {
  for (const [name, patched] of Object.entries(overlay)) {
    const base = stock.find((t) => t.name === name);
    if (!base) throw new Error(`overlay names "${name}", which is not in the current surface`);
    const drift = descriptionsOnlyDiff(base, patched);
    if (drift) {
      throw new Error(
        `overlay for ${name} changes more than descriptions (${drift}) — not a description A/B. ` +
          `Regenerate it against the current surface.`,
      );
    }
  }
}

async function main(): Promise<void> {
  const overlayPath = flag('overlay');
  if (!overlayPath) throw new Error('--overlay <file.json> is required');
  const model = flag('model', 'qwen3.5:27b');
  const only = flag('only');

  const stock = getToolDefinitions(FULL_CONFIG) as ToolDefinition[];
  const overlay = JSON.parse(readFileSync(overlayPath, 'utf8')) as Record<string, ToolDefinition>;
  assertDescriptionOnlyOverlay(stock, overlay);
  const patched = stock.map((t) => overlay[t.name] ?? t);

  const all = loadCases();
  const cases = only ? all.filter((c) => c.tool === only) : all;

  const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), 'utf8');
  console.log(`model=${model} cases=${cases.length}${only ? ` (only ${only})` : ''}`);
  console.log(`overlay: ${Object.keys(overlay).join(', ')}`);
  console.log(`wire ${bytes({ tools: stock })} → ${bytes({ tools: patched })} bytes\n`);

  const [b, a] = [await runBench(stock, cases, model), await runBench(patched, cases, model)];
  // Differing unscored sets mean differing denominators; the delta below would be meaningless.
  if (b.errors > 0 || a.errors > 0) {
    throw new Error(
      `unscored cases (before=${b.errors}, after=${a.errors}) — not comparable. Fix the backend and re-run.`,
    );
  }
  const delta = a.passed - b.passed;
  const pp = ((delta / cases.length) * 100).toFixed(1);

  console.log(`BEFORE ${b.passed}/${b.total} (${((b.passed / b.total) * 100).toFixed(1)}%)`);
  console.log(`AFTER  ${a.passed}/${a.total} (${((a.passed / a.total) * 100).toFixed(1)}%)`);
  console.log(`DELTA  ${delta >= 0 ? '+' : ''}${delta} cases (${delta >= 0 ? '+' : ''}${pp} pp)\n`);

  const rows = diffTools(perTool(cases, new Set(b.failures.map((f) => f.id))), perTool(cases, new Set(a.failures.map((f) => f.id))));
  console.log('tool           before  after   delta');
  for (const r of rows) {
    const d = r.after - r.before;
    console.log(
      `${r.tool.padEnd(14)} ${String(r.before).padStart(3)}/${String(r.total).padEnd(3)} ${String(r.after).padStart(3)}/${String(r.total).padEnd(3)} ${d > 0 ? `+${d}` : d}${d < 0 ? '  ← regressed' : ''}`,
    );
  }

  // Cases that flipped, both directions — the actual evidence for or against the change.
  const bf = new Set(b.failures.map((f) => f.id));
  const af = new Set(a.failures.map((f) => f.id));
  const fixed = [...bf].filter((id) => !af.has(id));
  const broke = [...af].filter((id) => !bf.has(id));
  if (fixed.length) console.log(`\nFIXED (${fixed.length}): ${fixed.slice(0, 25).join(', ')}`);
  if (broke.length) console.log(`\nBROKE (${broke.length}): ${broke.slice(0, 25).join(', ')}`);

  // Measured floor: 3 runs on identical input gave 153/149/153 (sd ~2.3). Anything under ~7 cases
  // is indistinguishable from the sampler in a single run.
  if (Math.abs(delta) < 7) {
    console.log(`\n⚠ delta ${delta} is BELOW THE DETECTION FLOOR (~7 cases) — not evidence either way.`);
    console.log('  Run each arm 5+ times and compare means if you need to resolve an effect this small.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
