#!/usr/bin/env node
/**
 * File-size ratchet — a regrowth brake for the handler refactor
 * (docs/plans/architecture-consolidation-plan.md).
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
import { readFileSync } from 'node:fs';

/**
 * Explicit per-file budgets. Seeded at "current size + headroom" for files that are legitimately
 * large today, so the ratchet blocks GROWTH without forcing an immediate split. Lower these as
 * Stages B–E land.
 */
const BUDGETS = {
  // intent.ts is now a dispatch + barrel module after the Stage B handler split (was 8199).
  'src/handlers/intent.ts': 900,
  // write.ts is the un-split SAPWrite handler; the plan's Stage D splits it into a write/ package.
  // Budget set above its current size pending that split; lower it when write/ lands.
  'src/handlers/write.ts': 2050,
  'src/handlers/tools.ts': 1700,
  'src/adt/xml-parser.ts': 1650,
  'tests/unit/handlers/intent.test.ts': 15500,
};

const DEFAULT_SRC = 1500;
const DEFAULT_TEST = 3000;

function budgetFor(path) {
  if (path in BUDGETS) return BUDGETS[path];
  if (path.includes('/fixtures/')) return Number.POSITIVE_INFINITY; // generated/golden data, not code
  if (path.endsWith('.test.ts') || path.startsWith('tests/')) return DEFAULT_TEST;
  return DEFAULT_SRC;
}

function countLines(path) {
  const text = readFileSync(path, 'utf8');
  if (text === '') return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0); // match `wc -l`
}

const files = execSync('git ls-files src tests bin', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.ts') || f.endsWith('.mjs'));

const offenders = [];
for (const f of files) {
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
    '\nSplit the file (see docs/plans/architecture-consolidation-plan.md), or — if justified —\n' +
      'raise its budget in scripts/ci/check-file-sizes.mjs (a deliberate, reviewed change).',
  );
  process.exit(1);
}

console.log(`✓ file-size ratchet: all ${files.length} tracked source/test files within budget.`);
