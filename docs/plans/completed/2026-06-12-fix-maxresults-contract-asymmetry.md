# Fix the `maxResults` contract asymmetry (advertised `number`, SAPRead rejects floats + out-of-range)

> **As shipped (deviation note):** the plan inventoried THREE unfloored inline sinks; Task 2's
> sink-inventory closeout grep found a FOURTH during execution — `getSubpackages`
> (`client.ts:~1259`, identical clamp shape) — exactly the drift class that checkbox exists to
> catch. The shipped commit floors all FOUR via one shared `clampUrlLimit` helper. The dossier's
> status header records the final inventory; sink counts in the plan body below are the
> as-planned numbers.

## Overview

The LLM-visible JSON Schema advertises `maxResults` as `type: 'number'` on every tool that has it,
and the SAPRead DEVC description explicitly promises *clamping* ("default 200, clamped to
[1, 1000]", `tools.ts:~534`). But `SAPReadSchema`/`SAPReadSchemaBtp` enforce
`z.coerce.number().int().min(1).max(1000)` — so an LLM following the published contract gets
`"Invalid input: expected int, received number"` for `50.5` and a hard rejection for `1001`, while
the same values are accepted by SAPSearch/SAPDiagnose. This plan aligns runtime validation to the
advertised contract (accept any number) and moves range/integer handling to the sinks (floor+clamp),
which two of the five sinks already do — the other three are inline clamps without flooring. All facts verified live; evidence in
[docs/research/2026-06-12-maxresults-contract-asymmetry.md](../../research/2026-06-12-maxresults-contract-asymmetry.md) —
cite it, don't re-derive it.

Success criteria (plain bullets, verified in the final task):

- All five Zod `maxResults` declarations are identical: `z.coerce.number().optional()`.
- Every sink floors AND clamps before the value reaches a SAP URL (no float ever emitted).
- `maxResults: 50.5` and `maxResults: 1001` on SAPRead DEVC succeed end-to-end through
  `handleToolCall` (clamped to 50 / 1000 at the sink), matching the published description.
- Zero LLM-surface change: `src/handlers/tools.ts` untouched; the 9 tool-definition fixtures stay
  byte-identical.

## Context

### Current State

Verified live on main @ `0855e2c6` (probe transcripts in the research dossier):

- `src/handlers/schemas.ts` has five `maxResults` declarations; only the two SAPRead variants
  (`SAPReadSchema:~163`, `SAPReadSchemaBtp:~189`) carry `.int().min(1).max(1000)`. SAPSearch
  (`:~207`, `:~248`) and SAPDiagnose (`:~701`) use plain `z.coerce.number().optional()`.
- Probe results: SAPRead rejects `50.5` ("expected int, received number") and `0`/`1001`
  (min/max), accepts `'25'` (coerced). SAPSearch/SAPDiagnose accept all of those.
- Sinks (all SAP URL query params), five total: `getPackageContents` (`src/adt/client.ts:~1216`),
  `lookupObjects` (`client.ts:~1044`), and `lookupObjectsViaDb` (`client.ts:~1126`, flows through
  `runQuery` into `/sap/bc/adt/datapreview/freestyle?rowNumber=${maxRows}` at `client.ts:~1311`;
  reachable from SAPSearch `tadir_lookup` with `source='db'|'both'`, `src/handlers/search.ts:~90`)
  clamp via inline `Math.max(1, Math.min(...))` but do **not** floor; `clampSearchResults`
  (`client.ts:~218`) and diagnostics' `clampMaxResults` (`src/adt/diagnostics.ts:~780`, uses
  `Math.trunc`) both floor and clamp. So today a float can reach a SAP URL through the three
  inline-clamp sinks. (The fifth sink was caught by the adversarial plan review, not the original
  research — treat the sink inventory as closed only after Task 2's grep checkbox.)
- Pinning tests: `tests/unit/handlers/schemas.test.ts` has `it('accepts optional DEVC maxResults
  within [1, 1000]')` (~line 105), `it('coerces numeric maxResults from string for DEVC')` (~113),
  and `it('rejects DEVC maxResults out of range (0, 1001, negative)')` (~121) — the last one pins
  the rejection behavior this plan removes.
- `tests/unit/handlers/zod-jsonschema-parity.test.ts` normalizes `integer`→`number` (`normPrim`,
  ~line 54) specifically because of this asymmetry; it stays as-is (category guard) and must remain
  green throughout.

### Target State

Zod accepts exactly what the JSON Schema advertises (`number`, optional); the sinks deterministically
floor+clamp so SAP only ever sees integers in range. Behavior change is acceptance-only: requests
that used to fail validation now succeed (clamped), which is what the published description already
promised. LLM surface unchanged.

### Key Files

| File | Role |
|------|------|
| `src/handlers/schemas.ts` | The five Zod `maxResults` declarations (two to change) |
| `src/adt/client.ts` | Sinks: `getPackageContents` (~1216), `lookupObjects` (~1044), `clampSearchResults` helper (~218) |
| `src/adt/diagnostics.ts` | Sink helper `clampMaxResults` (~780) — already correct, reference pattern |
| `tests/unit/handlers/schemas.test.ts` | Pinning tests to update/extend |
| `tests/unit/adt/client.test.ts` | Sink flooring tests (URL assertions) |
| `src/handlers/tools.ts` | **Verify-only: must NOT change** (LLM surface) |
| `tests/fixtures/tool-definitions/*.json` | **Verify-only: must stay byte-identical** |

### Verified Live Evidence

2026-06-12, local probes against the real schemas/fixtures (not a SAP system — this is a
TypeScript-contract fix; the SAP-facing URLs are already in production shape). Full transcripts in
`docs/research/2026-06-12-maxresults-contract-asymmetry.md`: `SAPReadSchema.safeParse({type:'DEVC', name:'ZPKG',
maxResults:50.5})` → REJECTED "expected int, received number"; same input on SAPSearch → accepted;
`tools.ts` advertises `type:'number'` at ~336/~532/~1200 with the DEVC description promising
clamping. Optional (non-load-bearing once flooring lands): one live
`arc1-cli call SAPRead --type DEVC --name $TMP --maxResults 50.5` against a4h in final verification
to record SAP's float-tolerance for posterity.

### Design Principles

1. **Align runtime to the advertised contract** — the JSON Schema (and its prose) is the product
   surface; Zod must not reject what it declares valid. Range/precision handling belongs at the
   sink (the repo's defense-at-the-sink pattern, security-model.md I6).
2. **Floor+clamp at every sink, mirroring the existing helpers** — `clampMaxResults`
   (`Math.max(1, Math.min(CAP, Math.trunc(x)))`) is the proven shape; the two inline clamps adopt it.
3. **Zero LLM-surface change** — `tools.ts` and the 9 fixtures are untouched; the
   tool-definitions-snapshot test is the proof.
4. **Release-invariant** — the SAP endpoints involved (`informationsystem/search`, dumps `$top=`)
   already receive these query params in production; this change only narrows the emitted values to
   integers in range (a strict subset of today's possible outputs). No per-release verification
   needed beyond the optional posterity check.
5. **No new config/env flags; no behavior change for integer in-range inputs** (the overwhelmingly
   common case) — identical URLs emitted.

## Development Approach

TDD per task: first extend/adjust the pinning tests to the target contract (red), then change the
schema/sink (green). The failure-path requirement is covered by polluted-input tests (floats,
out-of-range, negative, non-numeric strings → Zod coercion yields NaN → sink falls back to default).
Note one subtlety: with `.min(1)` gone, `z.coerce.number()` will accept `-5` and `NaN` never occurs
post-coercion failure — verify what `z.coerce.number().optional()` does with `'abc'` (coercion to
NaN: Zod **rejects** NaN for `z.number()` — confirm with a test, mirroring how SAPSearch already
behaves today; SAPSearch is the contract twin). Scope: no changes to `tools.ts`, no fixture
regeneration, no new exports.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Align the two SAPRead `maxResults` declarations to the advertised contract

**Files:**
- Modify: `src/handlers/schemas.ts` (`SAPReadSchema` at ~163, `SAPReadSchemaBtp` at ~189)
- Modify: `tests/unit/handlers/schemas.test.ts` (the DEVC maxResults `it()` blocks at ~105–132)

SAPRead is the only tool whose Zod `maxResults` (`z.coerce.number().int().min(1).max(1000)`)
diverges from the advertised `type: 'number'` + "clamped to [1, 1000]" description — see
docs/research/2026-06-12-maxresults-contract-asymmetry.md §1–2 for the probe evidence. Make it identical to the
SAPSearch/SAPDiagnose declarations (the contract twins).

- [ ] In `src/handlers/schemas.ts`, change BOTH `SAPReadSchema` and `SAPReadSchemaBtp` `maxResults`
      from `z.coerce.number().int().min(1).max(1000).optional()` to `z.coerce.number().optional()` —
      byte-identical to the SAPSearch declaration at ~207. Grep `maxResults` afterwards: all five
      declarations must be identical.
- [ ] In `tests/unit/handlers/schemas.test.ts`, REPLACE
      `it('rejects DEVC maxResults out of range (0, 1001, negative)')` (~121) with
      `it('accepts out-of-range and float DEVC maxResults (clamping happens at the sink)')`:
      `0`, `1001`, `-1`, and `50.5` must all `safeParse` successfully and round-trip their raw value
      (e.g. `result.data.maxResults === 50.5`) — range/precision is now the sink's job.
- [ ] Keep `it('accepts optional DEVC maxResults within [1, 1000]')` and the string-coercion test
      unchanged (still true).
- [ ] Add a negative test: `maxResults: 'abc'` must still FAIL validation (z.coerce yields NaN,
      which `z.number()` rejects) — assert this matches SAPSearchSchema's behavior for the same
      input (the two schemas must agree; ~2 assertions in one `it`).
- [ ] Regression guard: `tests/unit/handlers/zod-jsonschema-parity.test.ts` must stay green
      unchanged (24 tests) — after this task the generated SAPRead `maxResults` becomes
      `{"type":"number"}`, matching the hand-written schema directly.
- [ ] Run `npm test` — all green; specifically `schemas.test.ts`, `zod-jsonschema-parity.test.ts`,
      and `tool-definitions-snapshot.test.ts` (fixtures must be byte-identical — this task must NOT
      touch `tools.ts`).

### Task 2: Floor at the three inline-clamp sinks (`getPackageContents`, `lookupObjects`, `lookupObjectsViaDb`)

**Files:**
- Modify: `src/adt/client.ts` (`getPackageContents` at ~1216, `lookupObjects` at ~1044,
  `lookupObjectsViaDb` at ~1126)
- Modify: `tests/unit/adt/client.test.ts` (the `describe` blocks covering these methods;
  `describe('lookupObjectsViaDb')` exists at ~1272)

Three of the five `maxResults` sinks clamp but do not floor, so a float can reach a SAP URL
(`...&maxResults=50.5`, `...?rowNumber=50.5`) — dossier §3. Adopt the floor+clamp shape the
codebase's two helper-based sinks already use (`clampSearchResults` at `client.ts:~218`;
`clampMaxResults` at `diagnostics.ts:~780`, which uses `Math.trunc`).

- [ ] In `getPackageContents` (`src/adt/client.ts:~1216`), change
      `const limit = Math.max(1, Math.min(maxResults, 1000));` to also floor, mirroring
      `clampMaxResults`: `Math.max(1, Math.min(1000, Math.floor(maxResults)))` — and make
      non-finite input fall back to the default 200 (today `NaN` would propagate through
      `Math.max/min` into the URL; Zod blocks NaN upstream, but the method is exported and callable
      directly — fail safe like `clampSearchResults` does).
- [ ] In `lookupObjects` (`src/adt/client.ts:~1044`), apply the same floor+fallback shape to its
      inline `Math.max(1, Math.min(options.maxResults ?? 100, 1000))`.
- [ ] In `lookupObjectsViaDb` (`src/adt/client.ts:~1126`), apply the same floor+fallback shape to
      its inline `Math.max(1, Math.min(options.maxResults ?? 1000, 1000))` — this value flows
      through `runQuery` into `/sap/bc/adt/datapreview/freestyle?rowNumber=${maxRows}`
      (`client.ts:~1311`) and is reachable from SAPSearch `tadir_lookup source='db'|'both'`.
- [ ] Since all three sites now share one shape, extract a small module-local helper in client.ts
      (mirror `clampMaxResults`'s body; do NOT export it) and use it at all three sites — one
      definition, three callers, no fourth copy for the next reviewer to find.
- [ ] Do NOT change `clampSearchResults` or diagnostics' `clampMaxResults` — they already floor;
      they are the reference pattern.
- [ ] Sink-inventory closeout: `grep -n "maxResults" src/adt/*.ts src/handlers/*.ts` and confirm
      every hit that feeds a URL goes through a flooring clamp — list any new finding in the PR
      body rather than silently skipping it (this grep is what catches a sixth sink).
- [ ] Add unit tests in `tests/unit/adt/client.test.ts` (~6 tests) in the existing `describe`
      blocks for `getPackageContents`, the tadir-lookup path, and `describe('lookupObjectsViaDb')`
      (~1272): assert the REQUESTED URL (via `mockFetch.mock.calls`) contains `maxResults=50` for
      input `50.5`, `maxResults=1000` for `5000`, `maxResults=1` for `0.4`, `rowNumber=50` for
      ViaDb input `50.5`, and the default (`200` / `100` / `1000`) for `Number.NaN` — the
      failure-path/polluted-input coverage.
- [ ] Run `npm test` — all green.

### Task 3: End-to-end acceptance proof through `handleToolCall` + dossier closeout

**Files:**
- Modify: `tests/unit/handlers/read.test.ts` (the SAPRead DEVC `describe` block)
- Modify: `docs/research/2026-06-12-maxresults-contract-asymmetry.md` (status header)

Tasks 1–2 prove the layers separately; this task pins the user-visible outcome — the exact input an
LLM following the published schema may send, which today returns a Zod error. Mirrors the existing
DEVC dispatch tests in `read.test.ts` (grep `getPackageContents` there for the mock shape).

- [ ] Add tests in `tests/unit/handlers/read.test.ts` (~2 tests) next to the existing DEVC tests
      inside `describe('SAPRead')` — the template is
      `it('forwards maxResults from SAPRead args to getPackageContents URL')` at ~542:
      `handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', { type: 'DEVC', name: 'ZPKG',
      maxResults: 50.5 })` must NOT return a validation error (`result.isError` falsy or the text
      free of "Invalid arguments"), and the mocked fetch URL must contain `maxResults=50`; second
      test: `maxResults: 1001` → URL contains `maxResults=1000` (the promised clamping, end to end).
- [ ] Update the dossier `docs/research/2026-06-12-maxresults-contract-asymmetry.md`: flip the Status header to
      "Implemented — see docs/plans/completed/2026-06-12-fix-maxresults-contract-asymmetry.md" and append a
      one-line note that flooring landed at the inline sinks (as shipped: four — see the deviation
      note at the top).
- [ ] Run `npm test` — all green.

### Task 4: Final verification

- [ ] Run full test suite: `npm test` — all tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] `git diff --stat tests/fixtures/tool-definitions/` is EMPTY and `git diff src/handlers/tools.ts`
      is EMPTY — the LLM surface is untouched (the plan's core constraint).
- [ ] Grep `src/handlers/schemas.ts` for `maxResults`: exactly five declarations, all
      `z.coerce.number().optional()`.
- [ ] OPTIONAL (needs `TEST_SAP_URL` creds per `INFRASTRUCTURE.md`; skip cleanly if absent): run
      `arc1-cli call SAPRead --type DEVC --name '$TMP' --maxResults 50.5` against a4h — record in
      the dossier what SAP returns for posterity. Do not commit throwaway scripts.
- [ ] Commit message: `fix(handlers): accept any maxResults number and floor+clamp at the sinks` —
      `fix:` is correct (user-visible: wrongly-rejected requests now succeed) → patch release.
- [ ] Move this plan to `docs/plans/completed/`, then fix any relative links inside it (completed
      plans sit one directory deeper — `../` paths gain a level; the dossier link at the top becomes
      `../../research/...`).
