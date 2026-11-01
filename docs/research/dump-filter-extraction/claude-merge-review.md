# Claude merge-resolution review — dump-filter extraction (#1020)

| | |
|---|---|
| Reviewed merge | **`5af876955455d2424f0068fbc2757ba11a0875f0`** (`chore: merge current main and reconcile schema budgets`) |
| First parent | `2efb8286fa047acf7024a82f8bb030bfc01d5a2d`: my reviewed `027159e3` plus a docs-only commit that archives the final review |
| Second parent | new main `37fece94359c8a48523af56b0ff71f52359a7c21` (#1012, stored SAPscript long texts; 135 files) |
| Reviewer | Claude Code, model **Opus 5.5** (`claude-opus-5-5`), effort **max** |
| Date | 2026-10-17 |
| Method | Fresh immutable `git archive` export; per-file patch-ID comparison; focused offline checks. No SAP, models, network, GitHub, shared edits or full-suite rerun. The lockfile is unchanged. |

## Verdict

**The merge resolution is correct, and the branch is ready for a draft PR. There are no must-fix
defects.**

- Main is preserved exactly.
- Both conflicts are resolved with correct arithmetic, and no ceiling is raised.
- The 100-byte trim touches only dump/discovery wording and keeps every agreed element.
- Both policy surfaces carry both features.

The limits below are nonblocking; most important, validation of the merged head is still running.

## Preservation of main

- **The merge touches only this PR's 42 files.** `git diff 37fece94 5af87695` lists exactly the
  42 files the PR changed against old main, and nothing else. All other #1012 files are identical
  to main.
- **Main's change arrived intact.** For 123 of its 135 files, main's own change has the same
  patch ID in the merge (`498c12bb→37fece94` equals `2efb8286→5af87695`). That includes nine
  files both sides edited: `AGENTS.md`, `policy.ts`, `dispatch.ts`, `schemas.ts`,
  `multi-target-tools.ts`, the normative multi-target plan, `tools.md`, `tools.test.ts` and
  `multi-target-tools.test.ts`.
- **The other 12 files keep main's content.** They differ only because of adjacent PR edits or
  the resolution: the two ratchet scripts, `tools.ts`, `multi-target-setup.md`, `roadmap.md` and
  seven snapshots. Their diffs against new main contain only this PR's edits:
  - no `-` lines remove #1012 content from the SAPRead/SAPQuery definitions or the roadmap;
  - the only roadmap removals are the PR's own FEAT-69/71/74 rewrites.
- **The PR's own changes survive.** 29 of its 42 files keep identical patch IDs. The remaining 13
  are the research-note addition and the resolved, trimmed or regenerated files reviewed below.

## Conflict resolution and arithmetic

| File | Resolution | Check |
|---|---|---|
| `check-file-sizes.mjs` | `tools.ts`: main 1,745 (query-tool extraction, −33 from 1,778) + 6 = **1,751**. `diagnostics.ts`: 1,933 + 5 = **1,938**. | ✓ Actual sizes are 1,751 and 1,938, exactly at budget. The ratchet passes (686 files). |
| `check-tool-schema-budget.ts` | Full on-prem variants: 281 + 8 (LONG_TEXT) + 1 = **290** (both). Read-only: 188 + 1 = **189** (both). BTP full: 275 + 1 = **276** (both; LONG_TEXT does not apply). | ✓ No `maxTotalWireBytes`, `maxPerToolWireBytes` or token estimate changed. |

Measured combined surfaces:

| Surface | Wire bytes | Tokens | Ceiling | Headroom |
|---|---|---|---|---|
| Full on-prem | **74,492** | ~18,623 | 74,500 / 18,625 | 8 bytes / 2 tokens |
| BTP full | 69,596 | ~17,399 | — | — |
| Read-only | 45,629 | ~11,408 | — | — |

## The 100-byte trim (`2efb8286` → merge)

| String | Before | After |
|---|---|---|
| `dumps` line | `… /filters. Supply id for detail.` | `… /filters; id for detail.` |
| `feed_schema` line | `… action only. Known filters work directly.` | `… action only.` |
| `filters` property | `dumps list: AND, max 8 including user. E.g. [ … MESSAGE_TYPE_X …]. Use optional feed_schema for target names.` | `AND, max 8 incl. user: [ … MESSAGE_TYPE_X …].` |

Measured as wire JSON strings, the change is **362 → 262 bytes, exactly 100 saved**. The combined
surface was 74,592 bytes, 92 over the ceiling; after the trim it is 74,492.

**Retained:**

- newest-first ordering;
- `filters` in list mode and `id` for detail;
- optional, action-only discovery;
- AND with at most eight terms including `user`;
- the `runtimeError`/`equals`/`MESSAGE_TYPE_X` example.

**Dropped, all redundant or enforced elsewhere:**

- the "Known filters work directly" sentence, which "optional" already conveys;
- the duplicate `feed_schema` pointer;
- the `dumps list:` prefix — the `dumps` action line implies it, and validation refuses filters
  elsewhere with "filters requires dumps list mode.";
- "E.g." — the example now reads like a shape specification, which is acceptable.

No other `tools.ts` text changed relative to the pre-merge head, apart from main's own #1012 lines.

## Snapshots and policy surfaces

- All seven tool-definition snapshots match the generated definitions (snapshot test passes).
  `tools.test.ts` and `btp-docs-contract.test.ts` pass on the combined catalog.
- **`ACTION_POLICY`:** main's 132 entries plus `SAPDiagnose.feed_schema`; `validate:policy`
  passes with **133 entries** across 14 tool schemas.
- **Multi-target allowlist:** `feed_schema` is added beside main's unchanged additions (identical
  patch ID). The maintained and normative action lists both include it.
- #1012's long-text policy and authorization tests pass on the merge.

## Nonblocking limits

1. **Merged-head validation is in progress.** The full suite, build, lint, docs and the fresh live
   probe are still running. The research note correctly labels the earlier 9,003/9,003 results
   (Node 22 and 24) and the 260-test SAP integration run as **prior-head** evidence. Confirm the
   merged results, including the known pre-existing startup timeouts, before marking the PR ready.
2. **Budgets are now at their limit.** `tools.ts` is at 1,751/1,751 lines, and the full catalog is
   8 bytes / 2 tokens under its ceiling. The next change to either will need a deliberate budget
   raise.
3. **Model evidence is historical.** The 24 trials compare against `498c12bb`. Neither #1012's
   stored-text surface nor the trimmed wording was model-evaluated. The note says so.
4. **Docs accuracy (low).** The note's "Review of the review" calls my earlier claim (that Llama
   once used `MESSAGE_TYPE_X` as an attribute) unsupported. It is unsupported by *these two*
   archives, but supported by committed #1011 evidence I failed to cite:
   - file: `5d5c7824:docs/research/adt-vscode-1.2/evidence/diagnostic-value/adjudication.json`;
   - row: run `2026-10-17-llama-confirmation`, candidate `dumps-target`
     (`llama3.1_8b-0-dumps-target-candidate.json`);
   - call: `filters:[{"attribute":"MESSAGE_TYPE_X","operator":"equals","values":["TIME_OUT"]}, …]`.

   Suggested rewording: "Not shown in these two archives; the #1011 Llama confirmation trace
   (`5d5c7824`) used `MESSAGE_TYPE_X` as an attribute." The raw observations stand either way.
5. **Comments (trivial).** Main's ratchet comments were condensed. The schema-budget note that
   "shorter existing guidance preserves byte/token ceilings" was dropped; the meaning survives.

## Checks run (fresh export of `5af87695`, Node 22.21.1)

| Check | Result |
|---|---|
| Focused tests: both dump-filter files, ADT diagnostics, `tools`, snapshots, schemas, key sync, Zod/JSON parity, registry sync, hyperfocused, dispatch, `long-text`, `long-text-policy`, `tool-auth-long-text`, `btp-docs-contract`, multi-target tools/server, `server`, authz, HTTP body | **20 files / 1,204 tests passed** |
| `tsc --noEmit` (src and tests) | pass |
| Biome (14 changed code files against new main) | pass |
| `validate:policy` | pass (133 entries) |
| Strict `docs:build` | pass |
| `check:sizes` | pass (686 files; budget numbers above) |
| Main preservation (per-file patch IDs) | 123/135 identical; the other 12 contain PR-only edits |
| Archived final review in the branch | byte-identical to my report |

## Limitations

- I didn't rerun the full suite, build artefacts, SAP integration, E2E or the live probe on the
  merged head; those results are pending on your side.
- Node 22.21.1 locally.
