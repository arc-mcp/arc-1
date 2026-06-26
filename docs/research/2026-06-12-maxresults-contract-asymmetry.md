# Research: `maxResults` contract asymmetry (advertised `number`, SAPRead enforces int + rejects out-of-range)

**Date:** 2026-06-12
**Status:** Implemented — see `docs/plans/completed/2026-06-12-fix-maxresults-contract-asymmetry.md`. The fix
landed flooring at the three named inline sinks PLUS a fourth (`getSubpackages`, found by the Task-2
closeout grep) via one shared `clampUrlLimit` helper in `src/adt/client.ts`; the five Zod
declarations are now identical (`z.coerce.number().optional()`); LLM surface unchanged.
**Origin:** surfaced by the PR-5 spike's Zod↔JSON-Schema parity test
([zod-to-jsonschema-spike.md](2026-06-12-zod-to-jsonschema-spike.md), "obs" row). This dossier corrects that
note's tool attribution and traces the full sink behavior.

## Verified findings (probed live on main @ 0855e2c6, scratch tsx scripts)

### 1. The five Zod `maxResults` declarations (schemas.ts)

| Line | Schema | Declaration |
|---|---|---|
| 163 | `SAPReadSchema` | `z.coerce.number().int().min(1).max(1000).optional()` |
| 189 | `SAPReadSchemaBtp` | same |
| 207 | `SAPSearchSchema` | `z.coerce.number().optional()` |
| 248 | `SAPSearchSchemaNoSource` | `z.coerce.number().optional()` |
| 701 | `SAPDiagnoseSchema` | `z.coerce.number().optional()` |

(The PR-5 spike note said "SAPRead/SAPContext" — wrong: **SAPContext has no `maxResults` field at
all**; unknown keys are stripped. The `.int()` outlier is SAPRead, both variants.)

### 2. What the LLM is told vs what happens (probed via `getToolSchema(...).safeParse`)

Every hand-written schema advertises `type: 'number'` (tools.ts:336, :532, :1200). The SAPRead DEVC
description even **promises clamping**: "default 200, **clamped to [1, 1000]**" (tools.ts:534).

| Input | SAPRead (actual) | SAPSearch/SAPDiagnose (actual) |
|---|---|---|
| `50.5` | **REJECTED** — `"Invalid input: expected int, received number"` | accepted |
| `'25'` (string) | accepted, coerced to 25 | accepted, coerced to 25 |
| `0` / `1001` | **REJECTED** (`.min(1).max(1000)`) — despite the description saying *clamped* | accepted |

So SAPRead's runtime contract contradicts its advertised contract twice: floats are valid-per-schema
but rejected, and out-of-range values are documented as clamped but rejected. SAPSearch/SAPDiagnose
accept everything and rely on their sinks.

### 3. The sinks (where the value actually lands) — all are SAP URL query params

| Tool path | Sink | Clamps? | Floors? |
|---|---|---|---|
| SAPRead DEVC → `getPackageContents` | `client.ts:~1216` `Math.max(1, Math.min(maxResults, 1000))` → `...search?...&maxResults=${limit}` | ✓ | **✗** |
| SAPSearch → `searchObject` | `clampSearchResults` (client.ts:~218) — `Math.min(Math.floor(requested), MAX_SEARCH_RESULTS)`, non-finite/<1 → fallback | ✓ | ✓ |
| SAPSearch tadir_lookup → `lookupObjects` | `client.ts:~1044` inline `Math.max(1, Math.min(options.maxResults ?? 100, 1000))` → URL `maxResults: String(limit)` | ✓ | **✗** |
| SAPDiagnose dumps/messages/gateway | `clampMaxResults` (diagnostics.ts:~780) — `Math.max(1, Math.min(MAX_RESULTS_CAP, Math.trunc(maxResults!)))`, non-finite → fallback → `$top=` | ✓ | ✓ (verified: `Math.trunc`) |
| SAPSearch tadir_lookup `source=db\|both` → `lookupObjectsViaDb` | `client.ts:~1126` inline `Math.max(1, Math.min(options.maxResults ?? 1000, 1000))` → `runQuery` → `/sap/bc/adt/datapreview/freestyle?rowNumber=${maxRows}` (client.ts:~1311) | ✓ | **✗** |

(The fifth sink, `lookupObjectsViaDb`, was missed in the first pass and caught by the adversarial
plan review — exactly the "one sink fixed, sibling missed" failure mode AGENTS.md warns about.)

Consequence today: **a float CAN reach a SAP URL** (`maxResults=50.5`, `rowNumber=50.5`) via three
of the five sinks — `getPackageContents`, `lookupObjects`, and `lookupObjectsViaDb`, the inline
clamps without flooring. Nobody has reported breakage (SAP presumably tolerates/truncates), but it
is undefined behavior we emit, and the two helper-based sinks that DO floor (`clampSearchResults`,
`clampMaxResults`) prove the codebase already considers floor+clamp the correct sink hygiene.

### 4. Existing tests pinning current behavior

- `tests/unit/handlers/schemas.test.ts:105` — accepts DEVC maxResults within [1,1000].
- `tests/unit/handlers/schemas.test.ts:121` — **rejects** DEVC maxResults out of range (0, 1001,
  negative) — pins the rejection that contradicts the "clamped" description; must change with the fix.
- `tests/unit/handlers/zod-jsonschema-parity.test.ts:50-54` — `normPrim` collapses `integer`→`number`
  specifically because of this asymmetry; after the fix the normalization becomes vacuous for
  `maxResults` (keep it — it guards the *category*, and `.int()` may legitimately appear elsewhere later).

## Fix direction (for the plan)

Align runtime to the advertised contract, defense at the sink (the repo's I6 pattern):
1. schemas.ts: make all five declarations identical — `z.coerce.number().optional()` (drop
   `.int().min(1).max(1000)` from the two SAPRead variants). Zod then accepts exactly what
   `type: 'number'` advertises; range handling is the sink's job, as documented.
2. Sinks: normalize all five to **floor + clamp** (add flooring to the three inline clamps —
   `getPackageContents` client.ts:~1216, `lookupObjects` :~1044, `lookupObjectsViaDb` :~1126;
   `clampSearchResults` and diagnostics' `clampMaxResults` already floor). No float ever reaches a
   SAP URL, regardless of which tool grew the field.
3. Tests: update schemas.test.ts:121 (rejection → clamped acceptance, asserted at the sink), add
   float-acceptance + flooring cases; parity test untouched (24 green by construction).
4. LLM surface: **zero change** — tools.ts untouched, fixtures stay byte-identical.

**Commit type:** `fix(handlers)` — user-visible behavior change (requests that were wrongly rejected
now succeed) → patch release. That is the point: today an LLM following the published schema gets a
validation error the schema says cannot happen.

**Optional live check during implementation** (not load-bearing once flooring lands): one
`arc1-cli call SAPSearch query=ZCL maxResults=50.5` against a4h to record SAP's float handling in
this dossier for posterity.

## Open questions for the plan

- Drop `.min(1).max(1000)` entirely vs keep `.min(0)`-style sanity? Recommendation: drop — the sinks
  clamp (and the description says clamped); negative/0 → sink clamps to 1 or falls back.
- `diagnostics.ts` `clampMaxResults` body needs reading during implementation (only its first line
  was verified here).
