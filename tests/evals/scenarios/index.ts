/**
 * Scenario aggregator — imports every scenario file under this directory and
 * exposes them as a flat list plus a by-file map so the test harness can
 * filter by feature area.
 *
 * To add a new feature-bucket:
 *   1. Create `tests/evals/scenarios/<feature>.ts` exporting `SCENARIOS`.
 *   2. Add a line to SCENARIO_FILES below (the key becomes the EVAL_FILE
 *      filter value, e.g. `EVAL_FILE=<feature>`).
 *   3. Tag your scenarios with a stable tag (e.g. `feat-33`, `cds-impact`)
 *      so they can also be picked up via `EVAL_TAG=<tag>`.
 *
 * Filtering precedence in the test harness (see llm-eval.test.ts):
 *   EVAL_SCENARIO (single id)  >  EVAL_FILE  >  EVAL_TAG  >  EVAL_CATEGORY
 */

import type { EvalScenario } from '../types.js';
import { SCENARIOS as ACTIVATE } from './activate.js';
import { SCENARIOS as APPLICATION_LOG } from './application-log.js';
import { SCENARIOS as CONTEXT_DEPS } from './context-deps.js';
import { SCENARIOS as CONTEXT_IMPACT } from './context-impact.js';
import { SCENARIOS as DIAGNOSE } from './diagnose.js';
import { SCENARIOS as LINT } from './lint.js';
import { SCENARIOS as MANAGE } from './manage.js';
import { SCENARIOS as NAVIGATE } from './navigate.js';
import { SCENARIOS as QUERY } from './query.js';
import { SCENARIOS as READ_BASIC } from './read-basic.js';
import { SCENARIOS as READ_METHODS } from './read-methods.js';
import { SCENARIOS as REVISIONS } from './revisions.js';
import { SCENARIOS as SEARCH } from './search.js';
import { SCENARIOS as STORED_TEXT } from './stored-text.js';
import { SCENARIOS as TRANSPORT } from './transport.js';
import { SCENARIOS as WRITE } from './write.js';

/**
 * Map of feature-bucket name → scenarios. The key is what you pass to
 * `EVAL_FILE=...` on the command line.
 */
export const SCENARIO_FILES: Record<string, EvalScenario[]> = {
  activate: ACTIVATE,
  'application-log': APPLICATION_LOG,
  'context-deps': CONTEXT_DEPS,
  'context-impact': CONTEXT_IMPACT,
  diagnose: DIAGNOSE,
  lint: LINT,
  manage: MANAGE,
  navigate: NAVIGATE,
  query: QUERY,
  'read-basic': READ_BASIC,
  'read-methods': READ_METHODS,
  revisions: REVISIONS,
  search: SEARCH,
  'stored-text': STORED_TEXT,
  transport: TRANSPORT,
  write: WRITE,
};

/** Every scenario across every file. Order matches SCENARIO_FILES iteration. */
export const ALL_SCENARIOS: EvalScenario[] = Object.values(SCENARIO_FILES).flat();

/** Reverse lookup: scenario id → file it came from. */
export const FILE_OF_SCENARIO: Record<string, string> = Object.fromEntries(
  Object.entries(SCENARIO_FILES).flatMap(([file, scenarios]) => scenarios.map((s) => [s.id, file])),
);

/**
 * Sanity check at import time: scenario ids must be globally unique so that
 * `EVAL_SCENARIO=<id>` is unambiguous and the results table stays readable.
 */
function assertUniqueIds(): void {
  const counts = new Map<string, number>();
  for (const s of ALL_SCENARIOS) {
    counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
  }
  const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
  if (dupes.length > 0) {
    throw new Error(`Duplicate scenario ids across evaluation files: ${dupes.join(', ')}`);
  }
}
assertUniqueIds();
