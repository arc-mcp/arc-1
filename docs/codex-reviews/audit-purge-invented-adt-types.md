# Codex Review Report — PR #223 (audit-purge-invented-adt-types)

> **2026-05-08 update**: incorporates two rounds of codex review feedback.
> The "Probe catalog still uses old VIEW URL" gap noted in the original brief
> has been **resolved** (commit `830e8dc`); fixtures re-recorded for both
> systems. The "FUGR/FF → FUNC routes through `objectBasePath('FUNC')`"
> latent gap noted in the second review has been **resolved** by making
> `objectBasePath('FUNC')` throw — function modules require parent group
> context and the SAPRead/SAPNavigate FUNC handlers have always taken a
> dedicated path; SAPActivate / SAPDiagnose / SAPTransport now fail loudly
> instead of building wrong URLs.

This report briefs codex without conversation context. It explains **what changed**,
**why each change is correct** (with primary evidence), **what was verified live vs.
inferred**, and **the known gaps and follow-ups** that are out of scope.

## TL;DR for review

PR #223 implements [Plan A](../plans/completed/audit-purge-invented-adt-types.md) from
PR [#222](https://github.com/marianfoo/arc-1/pull/222) (the audit research). It purges
five invented or mis-routed entries from `SLASH_TYPE_MAP`, fixes the silently-broken
DDIC VIEW read path, and adds anti-cargo-cult guards. Verified live against both SAP
test systems — a4h S/4HANA 2023 and npl NW 7.50 — on 2026-05-08.

The previous round of review (PR [#219](https://github.com/marianfoo/arc-1/pull/219),
which collapsed `STRU` into `TABL`) found two real bugs that this author had missed:
P1 (SAPNavigate TABL routing on 7.50) and P2 (T000 brittle integration assertion).
**That review pattern is what we want again** — the codebase has many cross-cutting
edges where a single-file change can leave a stale call site.

## Files touched

```
src/handlers/intent.ts                     +159 -37
src/handlers/tools.ts                      +1   -1
src/adt/client.ts                          +18  -3
tests/unit/handlers/intent.test.ts         +24  -14
tests/unit/handlers/slash-type-map.test.ts +136 (new)
tests/integration/adt.integration.test.ts  +52  -0
docs_page/tools.md                         +1   -1
docs_page/roadmap.md                       +1   -0
compare/00-feature-matrix.md               +2   -1
CLAUDE.md                                  +1   -0
docs/plans/audit-purge-invented-adt-types.md → completed/  (rename only)
```

## Per-change rationale + evidence

### 1. `SLASH_TYPE_MAP` purge

| Action | Slash code | Evidence | Live |
|---|---|---|---|
| Remove | `FUNC/FM` | Eclipse `com.sap.adt.core.apidoc-3.58.1` jar grep — zero hits. abap-file-formats places `func-v1.json` *inside* `file-formats/fugr/`, confirming function modules are LIMU sub-objects, not top-level R3TR. | a4h + npl: function-module search returns `FUGR/FF`, never `FUNC/FM` |
| Remove | `CLAS/LI` | Absent from Eclipse apidoc; not emitted by any live ADT response. | a4h + npl: class child includes are sub-resources of `/oo/classes/<name>/includes/<inc>`, not standalone search results |
| Replace | `VIEW/V → VIEW` becomes `VIEW/DV → VIEW` | a4h + npl: `?objectType=VIEW%2FV` returns silent-ignored unfiltered results; only `VIEW/DV` matches DDIC views | ✓ |
| Replace | `TRAN/O → TRAN` becomes `TRAN/T → TRAN` | a4h + npl: search for `SE38`, `SU01` returns `adtcore:type="TRAN/T"`. Existing `objectBasePath('TRAN')` already used `trant` infix — only the slash alias was wrong. | ✓ |
| Repoint | `FUGR/FF: 'FUGR'` → `'FUGR/FF': 'FUNC'` | Eclipse apidoc `IAdtRepositorySearchParameters.html` line 208 documents `"FUGR/FF"` literally. Live a4h: `GET /sap/bc/adt/functions/groups/su_user/fmodules/bapi_user_getlist` returns `<fmodule:abapFunctionModule adtcore:type="FUGR/FF">` with `<adtcore:containerRef adtcore:type="FUGR/F" adtcore:name="SU_USER"/>`. | ✓ |

**Rationale for repointing FUGR/FF → FUNC**: When a caller passes `type='FUGR/FF'` to
`SAPRead`, the handler dispatches to a type-specific switch case. With the old mapping
to `FUGR`, the handler would treat `name` as the function group name (e.g.
"BAPI_USER_GETLIST") and build URL `/sap/bc/adt/functions/groups/BAPI_USER_GETLIST` —
yielding a 404. The correct route is `case 'FUNC'` which hits
`/sap/bc/adt/functions/groups/<group>/fmodules/<fm>`.

### 2. `objectBasePath('VIEW')` — silent fallthrough fix

Pre-fix: the switch had no `case 'VIEW'`, so VIEW reads fell through to the default
branch `return '/sap/bc/adt/programs/programs/'`. Reads were silently routed to the
program endpoint and either 404'd or returned wrong data.

Live evidence (2026-05-08, both systems):
- `GET /sap/bc/adt/ddic/views/V_USR_NAME` → HTTP 500 (a4h) / 500 (npl)
- `GET /sap/bc/adt/ddic/views/V_USR_NAME/source/main` → HTTP 404 (a4h) / 404 (npl)
- `GET /sap/bc/adt/vit/wb/object_type/viewdv/object_name/V_USR_NAME` → HTTP 200 with
  `<adtcore:mainObject adtcore:type="VIEW/DV" adtcore:name="V_USR_NAME">` metadata XML

The fix is in TWO places:
1. `objectBasePath('VIEW')` returns the VIT URL (intent.ts:2780)
2. `client.getView()` calls the VIT URL (client.ts:351 — `fetchSource` directly, since
   VIEW has no `/source/main` sub-resource on either system)

**Codex, please verify**: are there other call sites that build VIEW URLs by hand
(e.g. in `crud.ts`, `devtools.ts`, `codeintel.ts`) that I missed? `grep -n VIEW
src/adt/*.ts` is a good starting point.

### 3. Exhaustiveness guard (`KNOWN_BASE_TYPES`)

The VIEW silent-fallthrough bug existed because `objectBasePath` had a permissive
default. Adding a sentinel: if the input type is in the canonical `KNOWN_BASE_TYPES`
set but no switch case matched, throw. Unknown raw inputs still fall through to the
program path for legacy `inferObjectType` compatibility.

`KNOWN_BASE_TYPES` exported for tests. Lockstep invariant: every type in the set must
have a switch case (regression test in `slash-type-map.test.ts`).

**Codex, please verify**: I added 20 types to `KNOWN_BASE_TYPES`. Is that complete vs.
the union of `SAPREAD_TYPES_*` ∪ `SAPWRITE_TYPES_*`? Pseudo types like `TABLE_CONTENTS`,
`SYSTEM`, `MESSAGES`, etc. are NOT in `KNOWN_BASE_TYPES` because they don't go through
`objectBasePath` (they have dedicated handlers). Confirm that's the intended design.

### 4. Citation guard (`SLASH_TYPE_EVIDENCE`)

Every key in `SLASH_TYPE_MAP` must have a matching entry in `SLASH_TYPE_EVIDENCE`
pointing at an existing `research/abap-types/types/<short>.md` file. Future
contributors can't add a slash alias without writing evidence first.

**Codex, please verify**: Is the test resilient to repo-root inference? It uses
`resolve(__dirname, '..', '..', '..')`. If vitest changes how it resolves CWD, the
test could break silently.

### 5. Integration tests — returned-type assertion pattern

Methodology fix. ADT silently ignores unknown `objectType` filters in
`/sap/bc/adt/repository/informationsystem/search`. We empirically verified by passing
`?objectType=ZZZZ%2FZZ` and getting status 200 with unfiltered results.

The new tests inspect `searchObject(...).objectType` to confirm the live system emits
the expected slash code:
- `VIEW/DV` for V_USR_NAME
- `TRAN/T` for SE38
- `FUGR/FF` for BAPI_USER_GETLIST

Plus the VIEW round-trip test (V_USR_NAME via `client.getView`) asserts the returned
body contains `adtcore:type="VIEW/DV"`.

**Codex, please verify**: are these tests resilient to system-config differences?
V_USR_NAME ships everywhere I checked, but if the licensed users feature is disabled
on some 7.50 SP, would the view be missing? (I added `requireOrSkip` for the VIEW
round-trip test on 404; the SAPSearch tests don't have that — they would fail loudly,
which I think is correct since these are SAP-shipped objects, but worth a second
opinion.)

## What was verified live vs. inferred

### Verified live (a4h + npl, 2026-05-08)
- `FUGR/FF` is the function-module slash code (both systems)
- `VIEW/DV` is the DDIC-view slash code (both systems)
- `TRAN/T` is the transaction slash code (both systems)
- `/sap/bc/adt/ddic/views/V_USR_NAME` returns HTTP 500
- `/sap/bc/adt/vit/wb/object_type/viewdv/object_name/V_USR_NAME` returns HTTP 200
- ADT silently ignores unknown `objectType` filter in `informationsystem/search`
- All 87/88 integration tests pass on both systems

### Inferred / from research
- `CLAS/I` is the real form for class child includes — research/abap-types/types/clas.md
  cites this, but I did NOT find a way to verify it live (the search filter trick
  doesn't work for class includes since they're sub-resources). The PR removes
  `CLAS/LI` but does NOT add `CLAS/I` — the research finding remains, but I'd rather
  add it the day a live caller needs it (with verified evidence) than guess now.
- abap-file-formats placement of `func-v1.json` inside `fugr/` — verified via `gh api`
  list, but the structure could change.

## Known gaps / out of scope

These are intentional non-changes; codex should not flag them:

1. **`CLAS/LI` has no replacement.** `CLAS/I` is the research-suggested real form but
   I couldn't verify it live, so the audit chose to remove `CLAS/LI` without adding
   `CLAS/I`. If a future caller hits us with `CLAS/I` we'll add it then with proof.
2. ~~**Probe catalog (`src/probe/catalog.ts`) keeps the old VIEW URL** (`/sap/bc/adt/
   ddic/views`).~~ **Resolved in commit `830e8dc`** — VIEW catalog URL updated to the
   VIT URL; fixtures re-recorded for both `s4hana-2023-onprem-abap-trial` and
   `npl-750-sp02-dev-edition`; replay test assertions updated (VIEW promotes
   from ambiguous → available-high on 7.50; `discoveryAccuracyVsKnownObject`
   denominator grows by 1 because VIT URL isn't in ADT discovery).
3. **Plan B** (`docs/plans/audit-symmetry-and-ftg2-rename.md`) is a separate PR —
   read/write enum symmetry (`MSAG` missing from read enum) and `FTG2 → FEATURE_TOGGLE`
   rename.
4. **Plan C** (`docs/plans/audit-pseudo-type-view-parameter.md`) is deferred to next
   major — the architectural cleanup of `API_STATE`/`VERSIONS`/`TABLE_CONTENTS` etc.

## Specific review attention requested

- **`getView()` URL change** — did I miss any other call site that needs the same
  fix? I grepped `getView` (one call site in `intent.ts:1561`) but VIEW URLs could be
  built ad-hoc elsewhere.
- **`KNOWN_BASE_TYPES` completeness** — does it match the canonical types in
  `SAPREAD_TYPES_*` ∪ `SAPWRITE_TYPES_*` minus pseudo types? See `src/handlers/schemas.ts`.
- **Pass-through behaviour for removed aliases** — `normalizeObjectType('FUNC/FM')`
  returns `'FUNC/FM'` (unchanged). Does that input then reliably hit a Zod schema
  rejection, or does some downstream handler accept it as freestyle?
- ~~**Probe catalog discrepancy**~~ — Resolved (see above).
- **The `SLASH_TYPE_EVIDENCE` map duplicates SLASH_TYPE_MAP keys** — is the cost
  (boilerplate, two-place updates) worth the benefit (the citation guard)? An
  alternative would be to make `SLASH_TYPE_MAP` an array of `{ slash, canonical,
  evidence }` triples. I went with the side-table because it's the smaller diff
  against existing code, but the array shape might be cleaner long-term.

## Live verification commands (for reproducibility)

```bash
# a4h
SAP_URL=http://a4h.marianzeis.de:50000 SAP_USER=MARIAN SAP_PASSWORD='<pwd>' \
  SAP_INSECURE=false npx vitest run --config vitest.integration.config.ts \
  tests/integration/adt.integration.test.ts

# npl 7.50
SAP_URL=https://npl.marianzeis.de SAP_USER=MARIAN SAP_PASSWORD='<pwd>' \
  SAP_INSECURE=true SAP_CLIENT=001 npx vitest run \
  --config vitest.integration.config.ts tests/integration/adt.integration.test.ts

# Manual returned-type probe (replace ?objectType=VIEW%2FDV with VIEW%2FV to see
# silent-ignore behavior)
curl -sk -u "$AUTH" "https://a4h.marianzeis.de:50001/sap/bc/adt/repository/\
informationsystem/search?operation=quickSearch&query=V_USR_NAME&objectType=VIEW%2FDV"
```

## What would change my mind

- If codex finds a call site that hand-builds a VIEW URL using
  `/sap/bc/adt/ddic/views/`, that's a P0 fix to add to this PR.
- If `KNOWN_BASE_TYPES` is incomplete vs. the SAPRead/SAPWrite enums, exhaustiveness
  isn't actually enforced — that's a P0 fix to add.
- If the integration tests fail on a system codex has access to that we don't (some
  cloud edition, BTP), that's important new data — though the BTP enum excludes
  VIEW/TRAN already, so this is unlikely.
- If codex prefers the array-of-triples shape for `SLASH_TYPE_MAP` enough to argue
  for a refactor, I'm open — it's a structural choice, not a correctness one.
