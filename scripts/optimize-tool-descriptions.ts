#!/usr/bin/env tsx
/**
 * Overnight tool-description optimizer.
 *
 * The `tools/list` is re-sent on every request, so every byte of description is a recurring tax
 * (~17k tokens on the full write surface). ARC-1's descriptions were measured for the usual free
 * wins first and there are none — tool↔property duplication is ~800B, cross-tool duplicate property
 * descriptions are 11B, and the prose around re-listed enum values carries real meaning. So every
 * further byte is genuine semantic compression that trades information for size, and the only safe
 * way to spend it is to measure routing before and after.
 *
 *   baseline → propose rewrite (strong local model) → structural gate → size gate
 *           → cheap gate (that tool's routing cases) → full gate (all cases) → accept
 *
 * Gated by scripts/routing-bench.ts, which covers 100% of the action/type discriminators — the
 * agentic `tests/evals` suite reaches only a fraction (2/12 SAPTransport actions, 11/49 SAPRead
 * types) and a rewrite once dropped the target=/summary= syntax while scoring a clean pass there.
 *
 * Deliberately NOT here: no DSPy/GEPA dep (the reflective-mutation idea is the prompt below; the
 * scoring half already existed), and no source edits — winners land in a JSON overlay for review.
 *
 *   npx tsx scripts/optimize-tool-descriptions.ts --help
 */

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { getToolDefinitions, type ToolDefinition } from '../src/handlers/tools.js';
import { DEFAULT_CONFIG } from '../src/server/types.js';
import { FULL_CONFIG, loadCases, type RoutingCase, runBench } from './routing-bench.js';

loadDotenv();

// ─── CLI ────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function flag(name: string, fallback: string): string {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && argv[i + 1]) return argv[i + 1];
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : fallback;
}

if (argv.includes('--help')) {
  console.log(`
Tool-description optimizer. Gated by scripts/routing-bench.ts (100% discriminator coverage).

  --model <id>       Model under test (default qwen3.5:27b). Keep it at or above Haiku class —
                     an 8B model fails cases for reasons that have nothing to do with the wording.
  --rewriter <id>    Model proposing shorter descriptions (default qwen3.6:35b-mlx).
  --rounds <n>       Passes over the tool list (default 2). Later rounds see earlier winners.
  --tolerance <n>    Routing cases allowed to regress before rejecting (default 0).
  --out <path>       Accepted-override JSON (default test-results/desc-opt/overrides.json).
  --resume           Start from the existing --out overlay instead of stock descriptions.
  --readonly         Optimize the read-only surface instead of the full one.

Generate the cases first:  npx tsx scripts/routing-bench.ts gen
`);
  process.exit(0);
}

const MODEL = flag('model', 'qwen3.5:27b');
const REWRITER = flag('rewriter', 'qwen3.6:35b-mlx');
const ROUNDS = Number(flag('rounds', '2'));
const TOLERANCE = Number(flag('tolerance', '0'));
const OUT = flag('out', 'test-results/desc-opt/overrides.json');
const LOG = OUT.replace(/\.json$/, '.jsonl');
const OLLAMA = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';

const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), 'utf8');

// ─── Candidate safety ───────────────────────────────────────────────

/**
 * A rewrite may change `description` strings and nothing else. An LLM that quietly drops an enum
 * value or renames a property would "win" the bench (which only scores routing) while breaking
 * every call path it does not score, so this is a hard structural equality check, not a lint.
 */
export function descriptionsOnlyDiff(before: unknown, after: unknown, path = ''): string | null {
  if (typeof before === 'string' && typeof after === 'string') {
    return path.endsWith('.description') || before === after ? null : `${path}: string changed`;
  }
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) return `${path}: array/non-array`;
    if (before.length !== after.length) return `${path}: array length`;
    for (let i = 0; i < before.length; i++) {
      const d = descriptionsOnlyDiff(before[i], after[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    const a = Object.keys(before as object).sort();
    const b = Object.keys(after as object).sort();
    if (a.join(' ') !== b.join(' ')) return `${path}: keys differ`;
    for (const k of a) {
      const d = descriptionsOnlyDiff(
        (before as Record<string, unknown>)[k],
        (after as Record<string, unknown>)[k],
        `${path}.${k}`,
      );
      if (d) return d;
    }
    return null;
  }
  return Object.is(before, after) ? null : `${path}: value changed`;
}

// ─── Rewriter ───────────────────────────────────────────────────────

/**
 * Grounded in the tool-interface research: descriptions are the dominant selection signal (swapping
 * two tools' descriptions can invert their selection rates), and models often attend to a
 * description without using it — lower information density makes the deciding detail register. So
 * the instruction is "cut what the schema already says", not "cut words".
 */
const REWRITE_PROMPT = `You compress MCP tool definitions for an SAP ABAP developer tool.

The tool JSON below is re-sent to the model on EVERY request, so its size is a recurring cost.
Rewrite ONLY the "description" strings to be shorter. A mid-tier model must still pick the right
tool AND the right action/type value from them alone.

Rules:
- Change nothing but "description" values. Same keys, same enums, same order, same everything else.
- The description is what distinguishes this tool and this action from its siblings. Keep every
  discriminating cue: what it does, when to pick it over a similar one, destructive/irreversible
  warnings, required argument combinations, and concrete syntax a model cannot guess (URL forms,
  target/name formats, flag names).
- Cut what the JSON Schema already states: type, required, and the enum values themselves. Do not
  re-list enum values in prose. Do not restate a parameter's name inside its own description.
- Cut duplication between the tool description and its property descriptions.
- Cut background, marketing, and examples that only repeat an enum.
- Imperative and terse. "Returns X" not "This tool can be used to return X".

Return ONLY the complete rewritten JSON object. No markdown fence, no commentary.

TOOL:
`;

async function propose(tool: ToolDefinition): Promise<ToolDefinition | null> {
  const resp = await fetch(`${OLLAMA}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: REWRITER,
      messages: [{ role: 'user', content: REWRITE_PROMPT + JSON.stringify(tool, null, 2) }],
      temperature: 0.4, // some spread — a deterministic rewriter proposes the same loser every round
      stream: false,
    }),
  });
  if (!resp.ok) throw new Error(`rewriter ${resp.status}: ${await resp.text()}`);
  const data = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const raw = data.choices?.[0]?.message?.content ?? '';
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  if (!json) return null;
  try {
    return JSON.parse(json) as ToolDefinition;
  } catch {
    return null;
  }
}

// ─── Loop ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  mkdirSync(dirname(OUT), { recursive: true });

  const config = argv.includes('--readonly') ? DEFAULT_CONFIG : FULL_CONFIG;
  const stock = getToolDefinitions(config) as ToolDefinition[];
  const overrides: Record<string, ToolDefinition> = argv.includes('--resume')
    ? JSON.parse(readFileSync(OUT, 'utf8'))
    : {};
  const current = (): ToolDefinition[] => stock.map((t) => overrides[t.name] ?? t);

  const cases = loadCases();
  const casesFor = (name: string): RoutingCase[] => cases.filter((c) => c.tool === name);
  const score = async (tools: ToolDefinition[], subset = cases) => (await runBench(tools, subset, MODEL)).passed;

  console.log(`model=${MODEL} rewriter=${REWRITER} rounds=${ROUNDS} cases=${cases.length}\n`);

  let best = await score(current());
  console.log(`Baseline: ${best}/${cases.length} (${((best / cases.length) * 100).toFixed(1)}%)`);
  console.log(`          wire=${bytes({ tools: current() })} bytes\n`);

  const ranked = [...stock].sort((a, b) => bytes(b) - bytes(a));

  for (let round = 1; round <= ROUNDS; round++) {
    for (const stockTool of ranked) {
      const live = overrides[stockTool.name] ?? stockTool;
      const own = casesFor(stockTool.name);
      if (own.length === 0) {
        console.log(`  r${round} ${stockTool.name}: skip — no routing cases`);
        continue;
      }

      const reject = (why: string) => console.log(`  r${round} ${stockTool.name}: reject — ${why}`);
      const candidate = await propose(live);
      if (!candidate) {
        reject('unparseable rewrite');
        continue;
      }
      const structural = descriptionsOnlyDiff(live, candidate);
      if (structural) {
        reject(`changed more than descriptions (${structural})`);
        continue;
      }
      const saved = bytes(live) - bytes(candidate);
      if (saved <= 0) {
        reject('not smaller');
        continue;
      }

      // Cheap gate: this tool's own cases. Rejects most losers without a full-surface run.
      const withCandidate = current().map((t) => (t.name === stockTool.name ? candidate : t));
      const ownBefore = await score(current(), own);
      const ownAfter = await score(withCandidate, own);
      if (ownAfter < ownBefore - TOLERANCE) {
        reject(`own routing ${ownBefore}/${own.length} → ${ownAfter}/${own.length}`);
        continue;
      }

      // Full gate: a shorter SAPRead steals calls that belong to SAPContext. Own-tool parity cannot
      // see that; only scoring every case can.
      const full = await score(withCandidate);
      if (full < best - TOLERANCE) {
        reject(`full routing ${best} → ${full}`);
        continue;
      }

      overrides[stockTool.name] = candidate;
      best = Math.max(best, full);
      console.log(`  r${round} ${stockTool.name}: ACCEPT −${saved}B, routing ${full}/${cases.length}`);
      writeFileSync(OUT, JSON.stringify(overrides, null, 2));
      appendFileSync(
        LOG,
        `${JSON.stringify({ round, tool: stockTool.name, saved, passed: full, total: cases.length, model: MODEL })}\n`,
      );
    }
  }

  const before = bytes({ tools: stock });
  const after = bytes({ tools: current() });
  console.log(`\nwire ${before} → ${after} bytes (−${(((before - after) / before) * 100).toFixed(1)}%)`);
  console.log(`routing ${best}/${cases.length}   overrides: ${OUT}`);
  console.log('\nBefore shipping: re-score on a second model, run `npm run test:eval -- --provider claude-code`,');
  console.log('and hand-diff the overlay for guidance the bench does not score (locking rules, error recovery).');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
