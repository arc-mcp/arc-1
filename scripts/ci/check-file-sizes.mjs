#!/usr/bin/env node
/**
 * File-size ratchet — a regrowth brake for the handler refactor
 * (docs/plans/completed/2026-06-11-architecture-consolidation-plan.md).
 *
 * The codebase doubled in 8 weeks and the growth concentrated in a few monoliths (intent.ts,
 * intent.test.ts). This guard fails CI when a tracked source/test file crosses its line budget,
 * so the next big file can't sneak in unnoticed. To fix a failure: split the file, or — if the
 * size is genuinely justified — consciously raise its budget in BUDGETS below (a reviewed act,
 * visible in the diff). As the refactor shrinks the seeded files, LOWER their budgets here in the
 * same commit that shrinks them.
 *
 * Run: npm run check:sizes   (also wired into .github/workflows/test.yml)
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Explicit per-file budgets. Seeded at "current size + headroom" for files that are legitimately
 * large today, so the ratchet blocks GROWTH without forcing an immediate split. Lower these as
 * the refactor lands. There is intentionally no blanket exemption for `fixtures/` directories —
 * golden data is non-.ts/.mjs and never enters the scan, and a generated CODE fixture must earn
 * an explicit budget here like everything else (a silent infinite budget is the exact regrowth
 * hole this script exists to close).
 */
const BUDGETS = {
  // write.ts is now a thin SAPWrite orchestrator (prologue + ctx + action dispatch) after the
  // Stage D split into src/handlers/write/{create,update-delete,class-surgery,rap}.ts. The action
  // submodules ride the default src budget; keep this tight so the dispatcher can't reabsorb them.
  'src/handlers/write.ts': 360,
  // tools.ts holds every tool's JSON schema. The #520 description trim (write-mode tools/list
  // 87→66 KB to clear the Copilot-for-Eclipse gateway limit) shrank it; lowered to match. The
  // CLIENT-SAFETY size guard is scripts/ci/check-tool-schema-budget.ts — trim there before raising this.
  // +text-pool SAPWrite actions/description (edit_text_symbols/edit_selection_texts).
  'src/handlers/tools.ts': 1710,
  'src/adt/xml-parser.ts': 1650,
  // diagnostics.ts gained the ABAP trace-request engine (#508) + the OData perf probe + CDS Show-SQL (#509)
  // + ST05 SQL-trace control (#510) + clientWait split. Split out a perf/trace module if it grows much further.
  'src/adt/diagnostics.ts': 1845,
  // The ADT client facade aggregates every read/write op; set_api_state (#506) + runQueryWithMetrics
  // (SAPQuery metrics) + getEffectiveUser (BTP JWT-derived user, G-5) + getSourceAtObjectUrl
  // (post-activation cache promotion) + get/writeClassTextElements (class text pool) pushed it past
  // the default. Keep tight headroom.
  'src/adt/client.ts': 1680,
};

const DEFAULT_SRC = 1500;
const DEFAULT_TEST = 3000;

function budgetFor(path) {
  if (path in BUDGETS) return BUDGETS[path];
  if (path.endsWith('.test.ts') || path.startsWith('tests/')) return DEFAULT_TEST;
  return DEFAULT_SRC;
}

function countLines(path) {
  const text = readFileSync(path, 'utf8');
  if (text === '') return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0); // match `wc -l`
}

// NUL-delimited so paths with spaces/non-ASCII are never quoted-and-mangled (git's default
// core.quotePath would wrap "tests/.../zäh.ts" in quotes, and a naive .endsWith('.ts') would
// then silently skip it — voiding the ratchet for that file).
const files = execSync('git ls-files -z src tests bin', { encoding: 'utf8' })
  .split('\0')
  .filter((f) => f.endsWith('.ts') || f.endsWith('.mjs'));

// A BUDGETS key that no longer names a tracked file is a silent loosening: the renamed/deleted
// file's successor falls back to the (much larger) default budget while the tight entry sits dead.
// Fail loudly so a rename must move its budget in the same change.
const tracked = new Set(files);
const danglingBudgets = Object.keys(BUDGETS).filter((p) => !tracked.has(p));
if (danglingBudgets.length > 0) {
  console.error('✗ file-size ratchet: these BUDGETS keys no longer match a tracked file (rename/delete?):\n');
  for (const p of danglingBudgets) console.error(`  ${p}`);
  console.error('\nUpdate the key in scripts/ci/check-file-sizes.mjs to the new path, or remove it.');
  process.exit(1);
}

const offenders = [];
for (const f of files) {
  // A file tracked in the index but missing from the worktree (e.g. deleted-not-committed) is not
  // a size concern — skip it instead of crashing the whole report with a raw ENOENT.
  if (!existsSync(f)) continue;
  const lines = countLines(f);
  const budget = budgetFor(f);
  if (lines > budget) offenders.push({ f, lines, budget });
}

if (offenders.length > 0) {
  console.error('✗ file-size ratchet failed — these files exceed their line budget:\n');
  for (const o of offenders) {
    console.error(`  ${o.f}: ${o.lines} lines (budget ${o.budget})`);
  }
  console.error(
    '\nSplit the file (see docs/plans/completed/2026-06-11-architecture-consolidation-plan.md), or — if justified —\n' +
      'raise its budget in scripts/ci/check-file-sizes.mjs (a deliberate, reviewed change).',
  );
  process.exit(1);
}

console.log(`✓ file-size ratchet: all ${files.length} tracked source/test files within budget.`);
