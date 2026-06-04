# Add SAP ABAP Platform 2025 (SAP_BASIS 816) as a Validated Test Target

## Overview

A third SAP test system was added to the lab on 2026-06-04: **ABAP Platform Trial 2025**
(`a4h-2025.marianzeis.de:50100`, documented in `.env.infrastructure` as `SAP_A4H_2025_*` and in
`INFRASTRUCTURE.md`). Live probing established that it reports **`SAP_BASIS 816`** — SAP renumbered
the release scheme from the 7.5x line straight to 8.16 for ABAP Platform 2025 (the quarterly
S/4HANA Cloud Public Edition consumed releases 759–815; kernel is 9.16). It is an on-prem S/4HANA
2025 stack (`S4FND 109`, `SAP_ABA 816`, `SAP_GWFND 816`, `SAP_UI 816`, `DMIS 2025`).

This plan makes 816/2025 a **first-class, regression-locked test target** and fixes a real bug found
while trying to capture its fixture. The work is deliberately scoped to *validation + hardening*, not
to adding support for the 124 new ADT collections the 2025 system exposes (those are future
opportunities, catalogued in research but explicitly out of scope here).

Key design decisions:
- **816 needs no new release-comparison logic.** Every release gate in the codebase uses
  digit-stripping + `>=`/`<` integer comparison, and `816 > 758` holds, so the 8xx scheme is already
  handled *correctly by monotonic numbering*. The gap is that it is **untested and undocumented** —
  this plan closes that with explicit comments + tests using the real `816` value, not by changing
  logic.
- **`mapSapReleaseToAbaplintVersion("816")` must stay `v758`.** `@abaplint/core` maxes at `v758`
  (`defaultVersion = v758`) with `Cloud` as the ABAP-Cloud superset. 816 is an **on-prem** Standard
  ABAP system (`systemType=onprem`, no `SAP_CLOUD` component); mapping it to `Cloud` would
  false-positive on classic on-prem ABAP. `v758` (abaplint's highest on-prem version) is the correct
  baseline; lint is advisory and activation remains the definitive check.
- **The probe CLI (`npm run probe`) is currently broken** and must be fixed first, because the 2025
  fixture is captured with it.

## Context

### Current State

- `scripts/probe-adt-types.ts:212` destructures `fetchDiscoveryDocument()`'s return as a bare `Map`,
  but the function returns `{ map, nhiPresent }` (see `src/adt/discovery.ts:33`). Running
  `npm run probe` against any system fails at runtime with `discoveryMap.has is not a function`.
  `scripts/` is excluded from `tsconfig.json` (`"include": ["src/**/*"]`), so `npm run typecheck`
  never caught the API drift.
- There are 4 probe fixtures (`tests/fixtures/probe/{s4hana-2023-onprem-abap-trial,
  npl-750-sp02-dev-edition, ecc-ehp8-nw750-sp31-onprem-prod, synthetic-752}`) and replay tests in
  `tests/unit/probe/replay.test.ts`. None covers an 8xx / 2025 release.
- `mapSapReleaseToAbaplintVersion` (`src/adt/features.ts:191`) maps `>= 758 → v758`; tested for
  `'759'`/`'800'` (`tests/unit/adt/features.test.ts:210`) but not the real `'816'`.
- `release.ts` doc-comment lists release examples up to `758`; `release.test.ts` tests the
  750/751 stateful boundary but not 816.
- Docs reference only "758 for S/4HANA 2023": `CLAUDE.md` (config table row for
  `SAP_ABAP_RELEASE`), `.env.example:144`, `docs_page/configuration-reference.md:52`.
  `docs/probe-adt-types.md` lists the fixture naming convention; `docs/integration-test-skips.md`
  has per-system skip-profile tables (no 2025 row); `research/abap-types/00-methodology.md`
  describes a 2-system inventory.

### Target State

- `npm run probe` works again; the probe script is under typecheck coverage so the drift cannot recur.
- A committed `tests/fixtures/probe/abap-platform-2025-onprem-trial/` fixture (SAP_BASIS 816,
  onprem, full type surface available) with a replay test that regression-locks it.
- `816`/8xx release handling is explicitly commented and unit-tested in `release.ts` + `features.ts`.
- Docs acknowledge the 2025/816 system (config examples, fixture list, 3-system inventory, skip
  profile, INFRASTRUCTURE arc-1 facts).
- Live validation evidence: probe runs clean against 2025, and a read slice of the integration suite
  passes against 2025 with the abapGit-absent skip profile captured.

### Key Files

| File | Role |
|------|------|
| `scripts/probe-adt-types.ts` | Probe CLI — has the `discoveryMap.has` bug at line ~212 |
| `src/adt/discovery.ts` | `fetchDiscoveryDocument` returns `{ map, nhiPresent }` (the API the script must match) |
| `src/probe/runner.ts` | `probeType(fetcher, entry, discoveryMap, abapRelease)` — consumes the `Map` |
| `src/probe/fixtures.ts` | Recording/replay fetchers + `FixtureMeta` shape (`meta.json`) |
| `tests/unit/probe/replay.test.ts` | Replay tests per fixture set — model for the 2025 block |
| `tests/fixtures/probe/abap-platform-2025-onprem-trial/` | NEW fixture (meta.json + responses/) |
| `src/adt/features.ts` | `mapSapReleaseToAbaplintVersion` (line ~191) — 8xx mapping + comment |
| `tests/unit/adt/features.test.ts` | Release-mapping tests (line ~210) |
| `src/adt/release.ts` | `parseReleaseNumber`/`isPreStatefulRelease` + doc-comment examples |
| `tests/unit/adt/release.test.ts` | Release-parsing tests |
| `tsconfig.json` | `include: ["src/**/*"]` — excludes `scripts/` (root cause of undetected drift) |
| `CLAUDE.md`, `.env.example`, `docs_page/configuration-reference.md` | `SAP_ABAP_RELEASE` examples |
| `docs/probe-adt-types.md` | Fixture naming convention + fixture inventory |
| `docs/integration-test-skips.md` | Per-system skip-profile tables |
| `research/abap-types/00-methodology.md` | Test-system inventory |
| `INFRASTRUCTURE.md` | Test-system reference (add arc-1-verified 816 facts) |

### Design Principles

1. **No release-logic changes** — 816 is already handled by `>=`/`<` comparisons; only add comments
   + tests using the real value. Do not introduce special-case branches that could regress other
   releases.
2. **abaplint mapping for on-prem 816 stays `v758`** — never `Cloud` (would reject valid classic
   ABAP). Lock this with an explicit test + comment so a future abaplint bump is a deliberate change.
3. **Key release detection off `SAP_BASIS` only** — it stays numeric (758, 816), whereas `SAP_ABA` is
   alphanumeric on ≤2023 systems (e.g. `75I`). Do not add code that integer-parses non-SAP_BASIS
   component releases.
4. **Fixture is the canonical artifact** — capture once with the (fixed) probe CLI, commit verbatim,
   regression-lock with a replay test. Name it `abap-platform-2025-onprem-trial` per the documented
   product-line + edition convention.
5. **Scope discipline** — the 124 new 2025 ADT collections (AI `$codeprediction`, `chat`,
   `abapunit/explain`, CDS `dtsc` table entities, AIF, Fiori UI types, etc.) are documented as future
   opportunities only; no new object-type support in this PR.

## Development Approach

- Unit tests for every code change (probe-CLI fix, release mapping, release parsing, replay).
- The 2025 probe fixture is captured live with `npm run probe -- --save-fixtures` against
  `a4h-2025.marianzeis.de:50100` (creds in `.env.infrastructure` `SAP_A4H_2025_*`). Pass credentials
  via the process environment (the 2025 password contains shell-hostile characters — `'`, `\`, `|`,
  `^`; never place it on a shell command line).
- Worktree needs `npm ci` before building/testing (it has no `node_modules`).
- Order: fix the broken tool → capture + lock the fixture → release comments/tests → docs → live
  validation → final verification.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Fix the broken probe CLI and bring it under typecheck coverage

**Files:**
- Modify: `scripts/probe-adt-types.ts`
- Add: `tsconfig.scripts.json`
- Modify: `package.json` (typecheck script)
- Add: `tests/unit/probe/probe-cli-wiring.test.ts` (optional guard — see steps)

`npm run probe` is broken: `fetchDiscoveryDocument()` returns `{ map, nhiPresent }`
(`src/adt/discovery.ts:33`) but `scripts/probe-adt-types.ts:212` treats the whole return as a `Map`,
so `discoveryMap.has`/`.size`/`.keys` throw (`discoveryMap.has is not a function`). `scripts/` is not
in `tsconfig.json` (`include: ["src/**/*"]`), so `tsc` never flagged it. This task fixes the bug and
adds typecheck coverage so the drift can't recur. This must be done first — Task 2 captures the
fixture with the fixed tool.

- [ ] In `scripts/probe-adt-types.ts` around line 212, destructure the discovery result:
  change `const [discoveryMap, sysinfo] = await Promise.all([fetchDiscoveryDocument(client.http), detectSystem(client)]);`
  to capture the result object and read `.map` from it (e.g.
  `const [discovery, sysinfo] = await Promise.all([fetchDiscoveryDocument(client.http), detectSystem(client)]); const discoveryMap = discovery.map;`).
  Confirm `discoveryMap.size` (line ~237) and `[...discoveryMap.keys()]` (line ~255) and the
  `probeType(fetcher, entry, discoveryMap, ...)` call (line ~226) now operate on the `Map`.
- [ ] Add `tsconfig.scripts.json` extending `./tsconfig.json` with `"include": ["scripts/**/*"]` and
  `"noEmit": true`. Run `tsc --noEmit -p tsconfig.scripts.json` — if the whole `scripts/` dir
  typechecks cleanly, keep it; if unrelated scripts have pre-existing errors, narrow `include` to
  `["scripts/probe-adt-types.ts"]` (its imports are all already-typechecked `src/` modules) so this
  PR stays scoped.
- [ ] In `package.json`, change `"typecheck"` to also check scripts, e.g.
  `"typecheck": "tsc --noEmit && tsc --noEmit -p tsconfig.scripts.json"`. Verify a deliberate
  reintroduction of the bug (locally, temporarily) now fails `npm run typecheck`.
- [ ] (Guard test, only if it can be written without a live SAP system) Add a small unit test that
  asserts `fetchDiscoveryDocument`'s contract is an object exposing `.map` (a `Map`) and `.nhiPresent`
  — documents the shape the script depends on. If not cleanly unit-testable, rely on the new
  typecheck coverage instead and skip this checkbox.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm test` — all tests pass.

### Task 2: Capture + commit the ABAP Platform 2025 (816) probe fixture with a replay test

**Files:**
- Add: `tests/fixtures/probe/abap-platform-2025-onprem-trial/meta.json`
- Add: `tests/fixtures/probe/abap-platform-2025-onprem-trial/responses/*.json`
- Modify: `tests/unit/probe/replay.test.ts`

The 2025 fixture is the canonical artifact proving arc-1 validates against SAP_BASIS 816. Capture it
with the now-fixed probe CLI and regression-lock it with a replay test modeled on the existing
`s4hana-2023-onprem-abap-trial` block (`tests/unit/probe/replay.test.ts:83`). Expected live result
(already verified during research): all probed types `available-high`/`available-medium`, 0
unavailable, 0 ambiguous, `abapRelease "816"`, `systemType onprem`, `S4FND 109`, discovery ~352
collections.

- [ ] Capture the fixture against the 2025 system (creds from `.env.infrastructure` `SAP_A4H_2025_*`,
  passed via the process environment, NOT the shell command line):
  `TEST_SAP_URL=http://a4h-2025.marianzeis.de:50100 TEST_SAP_USER=MARIAN TEST_SAP_PASSWORD=<2025 pw> TEST_SAP_CLIENT=001 TEST_SAP_INSECURE=false npm run probe -- --save-fixtures tests/fixtures/probe/abap-platform-2025-onprem-trial`
- [ ] Verify `meta.json` shows `"abapRelease": "816"`, `"systemType": "onprem"`, and a `products[]`
  entry `SAP_BASIS / 816`. Confirm the fixture size is comparable to the 2023 fixture (~0.8 MB, ~35
  files) before committing.
- [ ] Add a `describe('probe replay — abap-platform-2025-onprem-trial fixture …')` block in
  `tests/unit/probe/replay.test.ts` modeled on the 2023 block: assert `meta.abapRelease === '816'`,
  `S4FND` release `'109'`, `SAP_BASIS` release `'816'`, `systemType === 'onprem'`; run `probeType`
  over `CATALOG` and assert `verdictHistogram['unavailable-high'] === 0`,
  `['unavailable-likely'] === 0`, `ambiguous === 0`, and that the verdict counts sum to
  `CATALOG.length` (full modern type surface available on 816).
- [ ] Run `npm test` — all tests pass (the new replay block included).

### Task 3: Make 816 / 8xx release handling explicit and tested

**Files:**
- Modify: `src/adt/release.ts` (doc-comment only)
- Modify: `src/adt/features.ts` (comment in `mapSapReleaseToAbaplintVersion`)
- Modify: `tests/unit/adt/release.test.ts`
- Modify: `tests/unit/adt/features.test.ts`

816 is handled correctly today only because every gate uses `>=`/`<` integer comparison and
`816 > 758`. This task documents that the 8xx scheme is intentional and locks the behavior with tests
using the real `816` value, so nobody "fixes" the mapping to `Cloud` or special-cases 8xx wrongly.
No logic changes.

- [ ] In `src/adt/release.ts`, update the file/function doc-comment that lists release examples
  ("700, 740, 750, 757, 758") to include `816` and a one-line note: SAP renumbered to 8xx for ABAP
  Platform 2025 (SAP_BASIS 816, 2023 was 758); `parseReleaseNumber`/`isPreStatefulRelease` work
  unchanged because `816 > 751`. Do not change any logic.
- [ ] In `src/adt/features.ts` `mapSapReleaseToAbaplintVersion`, add a comment on the `if (num >= 758)
  return Version.v758;` branch: it intentionally catches the 8xx scheme (816 = ABAP Platform 2025);
  abaplint's ceiling is `v758`, which is the correct **on-prem** baseline — do NOT map on-prem 8xx to
  `Cloud` (it would reject classic ABAP). Update the example list in the function's doc-comment to
  include `816`. No logic change.
- [ ] In `tests/unit/adt/features.test.ts`, in the "maps releases >= 758 to v758" test (line ~210),
  add `expect(mapSapReleaseToAbaplintVersion('816')).toBe(Version.v758);` with a comment that 816 is
  the real ABAP Platform 2025 release.
- [ ] In `tests/unit/adt/release.test.ts`, add assertions for the 2025 release:
  `parseReleaseNumber('816') === 816`; `isPreStatefulRelease('816') === false`;
  `shouldWarnPreStatefulRelease(true, '816') === false` (816 is post-stateful — the 423 lock-handle
  warning must NOT fire). Add a comment referencing ABAP Platform 2025.
- [ ] Run `npm test` — all tests pass.
- [ ] Run `npm run typecheck` — no errors.

### Task 4: Update documentation for the 2025/816 system

**Files:**
- Modify: `CLAUDE.md`
- Modify: `.env.example`
- Modify: `docs_page/configuration-reference.md`
- Modify: `docs/probe-adt-types.md`
- Modify: `docs/integration-test-skips.md`
- Modify: `research/abap-types/00-methodology.md`
- Modify: `INFRASTRUCTURE.md`

Docs currently reference only "758 for S/4HANA 2023" and a 2-system test inventory. Acknowledge the
new 2025/816 system everywhere a release example or test-system list appears. Keep CLAUDE.md edits
terse (it is auto-loaded every session).

- [ ] `CLAUDE.md`: in the `SAP_ABAP_RELEASE` / `--abap-release` config-table row, extend the example
  to "`758` for S/4HANA 2023, `816` for ABAP Platform 2025". If there is a probe/release Key-Files
  row, add a one-line note that 816 (8xx) is a validated release. Do not bloat the file.
- [ ] `.env.example:144`: add an inline note next to `SAP_ABAP_RELEASE=758` mentioning `816` for ABAP
  Platform 2025.
- [ ] `docs_page/configuration-reference.md:52`: change "Example: `758` for S/4HANA 2023" to
  "Examples: `758` for S/4HANA 2023, `816` for ABAP Platform 2025".
- [ ] `docs/probe-adt-types.md`: add `abap-platform-2025-onprem-trial` to the fixture inventory /
  naming-convention examples (lines ~92, ~102) alongside `s4hana-2023-onprem-abap-trial`.
- [ ] `docs/integration-test-skips.md`: add an "ABAP Platform 2025 (816)" row to the per-system
  skip-profile tables (integration + E2E), noting it behaves like S/4HANA 2023 (full modern type
  surface) **except abapGit ADT bridge is not installed** (SAPGit tests skip). Use the live skip
  numbers captured in Task 5.
- [ ] `research/abap-types/00-methodology.md`: change the 2-system inventory to 3 systems — add
  `ABAP Platform 2025 (SAP_BASIS 816): current-generation on-prem, full RAP/CDS surface` and add
  "vs ABAP 2025" to the release-conditional checklist.
- [ ] `INFRASTRUCTURE.md`: in the A4H 2025 section, add an "arc-1 verified facts (2026-06-04)"
  note: SAP_BASIS 816 (renumbered from 75x), `S4FND 109`, full ADT type surface available, **abapGit
  ADT bridge absent**, 124 new ADT collections vs 2023 (AI/codeprediction/CDS-dtsc/AIF/Fiori-UI —
  future opportunities).
- [ ] Run `npm run lint` — no errors (markdown is not linted by biome, but run to be safe on any
  touched TS).

### Task 5: Live validation against the 2025 system

**Files:**
- None (validation only — records evidence used to finalize Task 4's skip-profile row)

Confirm arc-1 actually works against SAP_BASIS 816 end-to-end, and capture the real skip profile so
the docs are accurate. Uses the live 2025 system (`SAP_A4H_2025_*` creds, via process env).

- [ ] Re-run the probe against 2025 with the fixed CLI and confirm a clean run: SAP_BASIS 816,
  systemType onprem, all types available, 0 unavailable/ambiguous (matches the committed fixture).
- [ ] Run a read slice of the integration suite against 2025
  (`TEST_SAP_URL=http://a4h-2025.marianzeis.de:50100` + `SAP_A4H_2025_*` creds): confirm core reads
  (PROG/CLAS/INTF/TABL/DDLS/BDEF) succeed and that release detection inside the client returns "816".
  Record how many tests pass/skip and which categories skip (expect SAPGit/abapGit to skip — bridge
  absent).
- [ ] Feed the observed skip counts/categories back into the `docs/integration-test-skips.md` row
  from Task 4.
- [ ] If any read unexpectedly fails on 816 (not just skips), capture the error and add a follow-up
  note; do not expand scope to fix unrelated issues in this PR.

### Task 6: Final verification

- [ ] Run full unit test suite: `npm test` — all tests pass (including the new 2025 replay block and
  release/feature assertions).
- [ ] Run typecheck: `npm run typecheck` — no errors (now including `scripts/` via
  `tsconfig.scripts.json`; a reintroduced probe-CLI drift would fail here).
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Confirm `npm run probe` executes without the `discoveryMap.has` error (smoke-run against any
  reachable system, or confirm via the typecheck guard if no system is reachable).
- [ ] Confirm the committed `tests/fixtures/probe/abap-platform-2025-onprem-trial/` fixture has
  `meta.json` `abapRelease: "816"` and the replay test passes.
- [ ] Move this plan to `docs/plans/completed/`.
