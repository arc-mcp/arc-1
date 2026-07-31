#!/usr/bin/env tsx
/**
 * Score several description variants against the routing benchmark in one pass.
 *
 * Iterating one A/B at a time re-scores the unchanged stock surface every round, which is most of
 * the cost — each call has to prefill the whole ~17k-token tool payload. This scores stock once and
 * every variant against the same cases, so N variants cost N+1 runs instead of 2N.
 *
 * Scoring is per-tool as well as overall, because the interesting failure is a variant that wins its
 * own cases by stealing a neighbour's: SAPWrite and SAPContext compete for the same requests, and a
 * louder SAPWrite can drag in reads. `--only` narrows to one tool's cases for fast iteration; drop
 * it for the full 181 before believing any result.
 *
 *   npx tsx scripts/variant-tournament.ts --only SAPWrite experiments/*.json
 *   npx tsx scripts/variant-tournament.ts --model claude-haiku-4-5-20251001 experiments/winner.json
 */

import { basename } from 'node:path';
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

interface Scored {
  name: string;
  passed: number;
  bytes: number;
  failedIds: Set<string>;
  perTool: Map<string, number>;
}

function tally(cases: RoutingCase[], failed: Set<string>): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of cases) if (!failed.has(c.id)) m.set(c.tool, (m.get(c.tool) ?? 0) + 1);
  return m;
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
  const model = flag('model', 'qwen3.5:27b');
  const only = flag('only');
  const files = argv.filter((a) => a.endsWith('.json'));
  if (files.length === 0) throw new Error('pass one or more overlay JSON files');

  const stock = getToolDefinitions(FULL_CONFIG) as ToolDefinition[];
  const all = loadCases();
  // Accepts a comma list: a change to SAPWrite must be scored against SAPContext's cases too, or a
  // variant that wins by stealing its neighbour's requests looks like a clean win.
  const onlySet = new Set(only.split(',').map((s) => s.trim()).filter(Boolean));
  let cases = onlySet.size > 0 ? all.filter((c) => onlySet.has(c.tool)) : all;

  // Each call re-prefills the ~17k-token tool payload, so a full run is minutes per variant. Sample
  // a deterministic every-Nth slice for fast iteration — never for a result you intend to act on.
  const sample = Number(flag('sample', '0'));
  if (sample > 0 && sample < cases.length) {
    const step = cases.length / sample;
    cases = Array.from({ length: sample }, (_, i) => cases[Math.floor(i * step)]);
    console.log(`⚠ SAMPLED ${cases.length} of ${only ? 'tool' : 'all'} cases — iteration only, confirm on the full set\n`);
  }
  const bytes = (t: ToolDefinition[]) => Buffer.byteLength(JSON.stringify({ tools: t }), 'utf8');

  console.log(`model=${model} cases=${cases.length}${only ? ` (only ${only})` : ''} variants=${files.length}\n`);

  const results: Scored[] = [];
  const score = async (name: string, tools: ToolDefinition[]): Promise<void> => {
    const r = await runBench(tools, cases, model);
    const failed = new Set(r.failures.map((f) => f.id));
    results.push({ name, passed: r.passed, bytes: bytes(tools), failedIds: failed, perTool: tally(cases, failed) });
    // Unscored cases differ run to run, so any material count makes variants incomparable — the
    // first tournament was decided by server errors, not by wording.
    // A run with unscored cases has a different denominator, so its pass count cannot be compared
    // with one that scored everything — that is how a broken candidate ties a healthy baseline.
    if (r.errors > 0) {
      throw new Error(
        `${name}: ${r.errors} case(s) never got a verdict after retries — results are not comparable. ` +
          `Fix the server/model and re-run rather than trusting this number.`,
      );
    }
    console.log(`  ${name.padEnd(26)} ${String(r.passed).padStart(3)}/${r.total}`);
  };

  console.log('scoring…');
  // A full-surface stock run is ~2 hours; with temperature 0 and a pinned seed it reproduces, so a
  // known baseline can be supplied instead of re-measured. Per-tool deltas are unavailable then —
  // only the total — which is why this is for final validation, not iteration.
  const known = Number(flag('baseline', '0'));
  if (known > 0 && (onlySet.size > 0 || sample > 0)) {
    // A recorded baseline belongs to the case set it was measured on; pairing it with --only or
    // --sample yields impossible rows like "133/37".
    throw new Error('--baseline cannot be combined with --only or --sample (different case set).');
  }
  if (known > 0 && known > cases.length) {
    throw new Error(`--baseline ${known} exceeds the ${cases.length} cases being scored.`);
  }
  if (known > 0) {
    results.push({ name: '(stock, recorded)', passed: known, bytes: bytes(stock), failedIds: new Set(), perTool: new Map() });
    console.log(`  ${'(stock, recorded)'.padEnd(26)} ${String(known).padStart(3)}/${cases.length}`);
  } else {
    await score('(stock)', stock);
  }
  for (const f of files) {
    const overlay = JSON.parse(readFileSync(f, 'utf8')) as Record<string, ToolDefinition>;
    assertDescriptionOnlyOverlay(stock, overlay);
    await score(basename(f, '.json'), stock.map((t) => overlay[t.name] ?? t));
  }

  const base = results[0];
  const ranked = [...results].sort((a, b) => b.passed - a.passed);
  const tools = [...new Set(cases.map((c) => c.tool))];

  console.log('\nvariant                     pass   delta   bytes   per-tool');
  for (const r of ranked) {
    const d = r.passed - base.passed;
    const per = tools.map((t) => `${t.replace('SAP', '')} ${r.perTool.get(t) ?? 0}`).join('  ');
    // ~7 cases is the measured single-run detection floor (153/149/153 on identical input).
    const flagStr = r === base ? '  (baseline)' : Math.abs(d) < 7 ? '  ~noise' : d > 0 ? '  ✓' : '  ✗';
    console.log(
      `${r.name.padEnd(26)} ${String(r.passed).padStart(3)}  ${(d >= 0 ? `+${d}` : String(d)).padStart(5)}  ${String(r.bytes - base.bytes).padStart(6)}   ${per}${flagStr}`,
    );
  }

  const best = ranked[0];
  if (best !== base && best.passed - base.passed >= 7) {
    const fixed = [...base.failedIds].filter((id) => !best.failedIds.has(id));
    const broke = [...best.failedIds].filter((id) => !base.failedIds.has(id));
    console.log(`\nbest = ${best.name}`);
    if (fixed.length) console.log(`  FIXED (${fixed.length}): ${fixed.slice(0, 20).join(', ')}`);
    if (broke.length) console.log(`  BROKE (${broke.length}): ${broke.slice(0, 20).join(', ')}`);
  } else {
    console.log('\nNo variant clears the ~7-case detection floor. Repeat each arm 5+ times to resolve smaller effects.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
