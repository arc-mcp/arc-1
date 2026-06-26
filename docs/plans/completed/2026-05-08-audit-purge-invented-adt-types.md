# Purge invented ADT slash aliases (audit follow-up to PR #219)

**References**

- Issue [#218](https://github.com/arc-mcp/arc-1/issues/218) — original `STRU/DS` report
- [Comment 4404553535](https://github.com/arc-mcp/arc-1/issues/218#issuecomment-4404553535) — `FUNC/FM` flagged by @oisee
- PR [#219](https://github.com/arc-mcp/arc-1/pull/219) — Model B / STRU→TABL collapse (merged)
- PR [#222](https://github.com/arc-mcp/arc-1/pull/222) — Audit (research-only, this plan ships in it)
- [`docs/research/abap-types/02-master-overview.md`](../../research/abap-types/02-master-overview.md) — synthesis + verdict matrix
- [`docs/research/abap-types/00-methodology.md`](../../research/abap-types/00-methodology.md) — research procedure
- Per-type evidence: [`func.md`](../../research/abap-types/types/func.md), [`fugr.md`](../../research/abap-types/types/fugr.md), [`view.md`](../../research/abap-types/types/view.md), [`clas.md`](../../research/abap-types/types/clas.md), [`ddlx.md`](../../research/abap-types/types/ddlx.md), [`tran.md`](../../research/abap-types/types/tran.md)
- External: [SAP/abap-file-formats](https://github.com/SAP/abap-file-formats) (TADIR + cloud serialization truth)
- External: Eclipse ADT plugin source (apidoc 3.58.1) at `/Users/marianzeis/DEV/arc-1-eclipse-adt/com.sap.adt.core.apidoc-3.58.1/`
- Probe runner docs: [`docs/probe-adt-types.md`](../probe-adt-types.md)


## Overview

Issue [#218](https://github.com/arc-mcp/arc-1/issues/218)'s `STRU/DS` was not the only
invented entry in `SLASH_TYPE_MAP`. After PR
[#219](https://github.com/arc-mcp/arc-1/pull/219) (Model B / STRU→TABL collapse) merged,
@oisee flagged in
[issue #218 comment 4404553535](https://github.com/arc-mcp/arc-1/issues/218#issuecomment-4404553535)
that `'FUNC/FM': 'FUNC'` is also wrong — function modules don't exist as TADIR R3TR
objects (they're `LIMU FUNC` under `R3TR FUGR`), and the real ADT slash code is `FUGR/FF`.

In response, ARC-1 ran a systematic audit of all 35 canonical short types and 24 slash
aliases. The full evidence is in
[`docs/research/abap-types/`](../../research/abap-types/02-master-overview.md) — 36 per-type
docs grounded in TADIR truth, [SAP/abap-file-formats](https://github.com/SAP/abap-file-formats),
the Eclipse ADT plugin source (`com.sap.adt.core.apidoc-3.58.1` jars under
`/Users/marianzeis/DEV/arc-1-eclipse-adt/`), live a4h S/4HANA 2023 probes, and SAP
docs/notes via the `sap-docs` and `sap-notes` MCP servers. The audit found five additional
bugs of the same class as `STRU/DS`:

| Bug | Real form | Currently | Should be | Evidence |
|---|---|---|---|---|
| `FUNC/FM` invented | (does not exist) | `FUNC/FM → FUNC` | (remove) | [`func.md`](../../research/abap-types/types/func.md) |
| `FUGR/FF` mis-routes | `FUGR/FF` (function module) | `→ FUGR` | `→ FUNC` | [`fugr.md`](../../research/abap-types/types/fugr.md) |
| `VIEW/V` invented | `VIEW/DV` | `VIEW/V → VIEW` | `VIEW/DV → VIEW` | [`view.md`](../../research/abap-types/types/view.md) |
| `VIEW` URL missing | `/sap/bc/adt/vit/wb/object_type/viewdv/object_name/` | falls through to `/programs/programs/` | add VIT URL | [`view.md`](../../research/abap-types/types/view.md) |
| `CLAS/LI` invented | `CLAS/I` | `CLAS/LI → CLAS` | `CLAS/I → CLAS` | [`clas.md`](../../research/abap-types/types/clas.md) |

Plus two slash codes the audit could not verify in any source — must be confirmed via
live fixture or corrected:

- `DDLX/EX` — not present in Eclipse apidoc 3.58.1 grep ([`ddlx.md`](../../research/abap-types/types/ddlx.md))
- `TRAN/O` — not present in Eclipse apidoc; likely `TRAN/T` ([`tran.md`](../../research/abap-types/types/tran.md))

This is a breaking change in the same vein as PR #219 — pre-1.0, breaking changes are
acceptable.

### Why the audit found bugs that hid for a release

The cross-cutting methodology finding (see
[`02-master-overview.md`](../../research/abap-types/02-master-overview.md#cross-cutting-findings-apply-to-future-audits-too)):
**ADT silently ignores unknown `objectType` filters in
`/sap/bc/adt/repository/informationsystem/search`.** Request status 200 does NOT mean the
filter was honored. Manually testing `?objectType=VIEW%2FV` returned a 200 with
unfiltered results — exactly why nobody noticed `VIEW/V` was invented. Plan A's tests
must inspect the returned `<adtcore:type>` attribute, never just the request status.

## Context

### Current State

- `src/handlers/intent.ts:2558-2591` — `SLASH_TYPE_MAP` contains the invented entries.
- `src/handlers/intent.ts:2667-2713` — `objectBasePath` switch has no `case 'VIEW'`,
  so VIEW reads route to the program endpoint and silently fail or return wrong data.
- ADT silently ignores unknown `objectType` filters in
  `/sap/bc/adt/repository/informationsystem/search` — request status 200 does **not**
  imply the alias was honored. This is why the bugs hid for so long.

### Target State

- `SLASH_TYPE_MAP` contains only verified-real ADT slash subtypes, each with an inline
  citation (Eclipse apidoc reference, abap-file-formats reference, or live fixture path).
- `objectBasePath` covers every type that has a write surface, with an exhaustive-switch
  guard so adding a new canonical type without an URL is a compile-time error.
- A unit assertion enforces that every key in `SLASH_TYPE_MAP` has a citation comment.
- Integration tests for VIEW + symmetry tests for `<adtcore:type>` round-trip — what
  would have caught these bugs.

### Key Files

| File | Role |
|------|------|
| `src/handlers/intent.ts` | `SLASH_TYPE_MAP`, `normalizeObjectType`, `objectBasePath`, `inferObjectType` |
| `src/handlers/schemas.ts` | Type enums |
| `src/handlers/tools.ts` | LLM-facing type descriptions |
| `src/probe/catalog.ts` | Per-type ADT probe entries |
| `src/adt/client.ts` | Per-type readers |
| `tests/unit/handlers/intent.test.ts` | Normalization unit tests |
| `tests/unit/handlers/schemas.test.ts` | Schema validation tests |
| `tests/integration/adt.integration.test.ts` | Live ADT round-trip tests |
| `docs/research/abap-types/types/{view,clas,fugr,func,ddlx,tran}.md` | Per-type evidence |

### Design Principles

1. Every `SLASH_TYPE_MAP` key MUST be backed by one of: (a) Eclipse apidoc citation,
   (b) abap-file-formats reference, (c) live fixture under `tests/fixtures/probe/`.
2. `objectBasePath` MUST throw or surface an error when given a known-listed type with
   no URL prefix — never silently fall through.
3. Tests for slash-form round-trips MUST assert the returned `<adtcore:type>` from ADT,
   not just the request status.
4. Bare `FUNC` stays as a useful caller-facing alias for `LIMU FUNC under FUGR` even
   though there is no `R3TR FUNC` in TADIR — it's an ARC-1 abstraction, documented as
   such.

## Development Approach

- Foundation first (data: SLASH_TYPE_MAP), then wiring (objectBasePath, handlers),
  then schemas/tools text, then tests, then docs.
- Each task self-contained per ralphex contract.
- Run `npm test` at end of every task.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:integration` (final verification only — needs SAP creds)

### Task 1: Purge `FUNC/FM`, repoint `FUGR/FF`, fix `CLAS/LI` and `VIEW/V`

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

**Background**: Update `SLASH_TYPE_MAP` (~line 2558) to remove invented aliases and remap
real ones. Evidence sources for each change:

- **`FUNC/FM` removal**: [`docs/research/abap-types/types/func.md`](../../research/abap-types/types/func.md)
  — zero occurrences in Eclipse `com.sap.adt.core.apidoc-3.58.1` jar grep; not in
  [abap-file-formats](https://github.com/SAP/abap-file-formats) (which places
  `func-v1.json` *inside* `file-formats/fugr/`, confirming function modules are LIMU
  sub-objects, not top-level R3TR); live a4h returns `FUGR/FF` for function modules.
- **`FUGR/FF → FUNC`**: [`docs/research/abap-types/types/fugr.md`](../../research/abap-types/types/fugr.md)
  — Eclipse apidoc `com/sap/adt/ris/search/IAdtRepositorySearchParameters.html` line 208
  documents `"FUGR/FF"` literally; live a4h GET
  `/sap/bc/adt/functions/groups/su_user/fmodules/bapi_user_getlist` returns
  `<fmodule:abapFunctionModule adtcore:type="FUGR/FF">` with
  `<adtcore:containerRef adtcore:type="FUGR/F" adtcore:name="SU_USER"/>`.
- **`CLAS/LI → CLAS/I`**: [`docs/research/abap-types/types/clas.md`](../../research/abap-types/types/clas.md)
  — `CLAS/LI` not found in any source; `CLAS/I` is the documented form for class child
  includes.
- **`VIEW/V → VIEW/DV`**: [`docs/research/abap-types/types/view.md`](../../research/abap-types/types/view.md)
  — `VIEW/V` not in Eclipse apidoc; live a4h returns `VIEW/DV` for DDIC views via the
  VIT generic-object endpoint.

- [ ] Remove `'FUNC/FM': 'FUNC'` from `SLASH_TYPE_MAP`
- [ ] Change `'FUGR/FF': 'FUGR'` to `'FUGR/FF': 'FUNC'` (function module under group)
- [ ] Replace `'CLAS/LI': 'CLAS'` with `'CLAS/I': 'CLAS'` (real ADT class-include code per
      `docs/research/abap-types/types/clas.md`)
- [ ] Replace `'VIEW/V': 'VIEW'` with `'VIEW/DV': 'VIEW'` (real ADT DDIC-view code per
      `docs/research/abap-types/types/view.md`)
- [ ] Add inline `// see docs/research/abap-types/types/<x>.md` citation comment on every
      remaining and changed entry in `SLASH_TYPE_MAP`
- [ ] Update `tests/unit/handlers/intent.test.ts` `normalizeObjectType` cases:
      - `normalizeObjectType('FUNC/FM')` → `'FUNC/FM'` (unchanged passthrough — no longer
        normalized; surface as schema error downstream)
      - `normalizeObjectType('FUGR/FF')` → `'FUNC'`
      - `normalizeObjectType('CLAS/I')` → `'CLAS'`; `'CLAS/LI'` → `'CLAS/LI'` (passthrough)
      - `normalizeObjectType('VIEW/DV')` → `'VIEW'`; `'VIEW/V'` → `'VIEW/V'` (passthrough)
- [ ] Add unit tests (~6 tests): each new mapping + each removed alias passthrough
- [ ] Run `npm test` — all tests must pass

### Task 2: Add VIEW URL prefix to `objectBasePath`

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

**Background**: `objectBasePath` (~line 2667) has no `case 'VIEW'`, so VIEW reads
currently route to `/sap/bc/adt/programs/programs/` via the default fallthrough. This is
why DDIC view reads have been silently broken since the type was added — there's never
been a working code path. Real ADT URL per
[`docs/research/abap-types/types/view.md`](../../research/abap-types/types/view.md) is the VIT
generic-object endpoint, same shape as the existing `case 'TRAN'` at ~line 2706
(`/sap/bc/adt/vit/wb/object_type/trant/object_name/`).

Reference pattern: `case 'TRAN'` already uses the VIT route — copy that structure for
VIEW. The VIT endpoint also handles other rarely-touched legacy types and is documented
in the Eclipse plugin source under `com.sap.adt.tools.viewbase.*`.

- [ ] Add `case 'VIEW': return '/sap/bc/adt/vit/wb/object_type/viewdv/object_name/';`
      to `objectBasePath`
- [ ] Cite `docs/research/abap-types/types/view.md` in an inline comment
- [ ] Add unit tests (~3 tests): `objectBasePath('VIEW')` returns the VIT URL;
      `objectUrlForType('VIEW', 'V_USR_NAME')` returns expected full URL; reject regression
      to `/programs/programs/`
- [ ] Run `npm test` — all tests must pass

### Task 3: Probe / fixture-confirm `DDLX/EX` and `TRAN/O`

**Files:**
- Modify: `src/probe/catalog.ts`
- Add: `tests/fixtures/probe/ddlx-tran-confirm.json` (capture)
- Modify: `tests/unit/probe/replay.test.ts`

**Background**: [`docs/research/abap-types/types/ddlx.md`](../../research/abap-types/types/ddlx.md)
and [`tran.md`](../../research/abap-types/types/tran.md) flag both slash codes as not
seen in Eclipse apidoc 3.58.1 grep. The audit could not definitively classify them as
correct or invented because:
- The `DDLX` short type itself is real (released in abap-file-formats, supported on BTP);
  only the slash form is unverified.
- The `TRAN` URL prefix in `objectBasePath` (`/sap/bc/adt/vit/wb/object_type/trant/object_name/`)
  works on a4h, but the `trant` infix suggests `TRAN/T`, not `TRAN/O`.

Capture a live `informationsystem/search` response and a real ADT GET against
representative fixtures (e.g. a known DDLX `Z*_EXT` and a known transaction like
`SE38` or `SU01`) to confirm the slash code that ADT actually emits in
`<adtcore:type>`. The probe infrastructure to use is `npm run probe -- --save-fixtures`
(see [`docs/probe-adt-types.md`](../probe-adt-types.md)).

- [ ] Run `npm run probe -- --save-fixtures tests/fixtures/probe/ddlx-tran-confirm` against
      a4h
- [ ] Inspect saved fixture for the actual `<adtcore:type>` in DDLX and TRAN responses
- [ ] If `DDLX/EX` is wrong, update `SLASH_TYPE_MAP` accordingly with citation
- [ ] If `TRAN/O` is wrong (likely `TRAN/T`), update `SLASH_TYPE_MAP` and the inline
      citation
- [ ] Add fixture-replay test that asserts the verified slash code for both types
- [ ] Run `npm test` — all tests must pass

### Task 4: Make `objectBasePath` exhaustive-by-default

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

The VIEW bug existed because `objectBasePath` silently fell through to the program path
for unhandled types. Replace the silent fallback with an explicit allowlist + sentinel
that throws for canonical types not in the map. Unknown raw inputs still return the
program path (legacy behavior for inferObjectType callers), but every canonical short
type from `SAPREAD_TYPES_*` ∪ `SAPWRITE_TYPES_*` MUST have a switch case.

- [ ] Add a `KNOWN_BASE_TYPES` set covering all canonical types in the read+write enums
- [ ] In `objectBasePath`, if `KNOWN_BASE_TYPES.has(type)` and the switch falls through,
      throw an internal error (`AdtSafetyError` or similar) with a clear message
- [ ] Verify all KNOWN_BASE_TYPES are handled (PROG, CLAS, INTF, INCL, FUGR, FUNC, DDLS,
      DCLS, BDEF, SRVD, SRVB, DDLX, TABL, DOMA, DTEL, MSAG, DEVC, TRAN, VIEW, SKTD)
- [ ] Add unit test: every canonical type returns a path that starts with `/sap/bc/adt/`
- [ ] Add unit test: passing a known canonical type that lacks a case throws (regression
      guard)
- [ ] Run `npm test` — all tests must pass

### Task 5: Citation guard — every `SLASH_TYPE_MAP` key has evidence

**Files:**
- Add: `tests/unit/handlers/slash-type-map.test.ts`

**Background**: Anti-cargo-cult guard. The audit found six bugs (`STRU/DS`, `FUNC/FM`,
`FUGR/FF` mis-route, `CLAS/LI`, `VIEW/V`, possibly `DDLX/EX` and `TRAN/O`) sharing one
root cause: nobody had ever asked "what is your evidence that this slash code exists?"
The pattern `XXXX/<first letter>` does **not** generalize from TADIR R3TR to ADT slash
subtypes. Real ADT subtypes come from class `CL_WB_OBJECT_TYPE` and table `WBOBJTYPE`,
documented in Eclipse plugin source under `com.sap.adt.core.apidoc-3.58.1` (apidoc jars
in `/Users/marianzeis/DEV/arc-1-eclipse-adt/`).

Add a unit test that reads the source of `intent.ts` (or a co-located JSON manifest) and
asserts every entry in `SLASH_TYPE_MAP` has either an inline citation comment matching
`// (docs/research/abap-types/|see fixture|Eclipse apidoc)` or a registered fixture in
`tests/fixtures/probe/`. The shape can be:

```ts
const SLASH_TYPE_EVIDENCE: Record<string, string> = {
  'PROG/P': 'docs/research/abap-types/types/prog.md',
  'PROG/I': 'docs/research/abap-types/types/prog.md',
  // ...
};
// Test: keys of SLASH_TYPE_MAP === keys of SLASH_TYPE_EVIDENCE
```

- [ ] Decide on form (inline-comment scrape OR co-located evidence map). Prefer the
      evidence map — easier to lint
- [ ] Add `SLASH_TYPE_EVIDENCE` constant alongside `SLASH_TYPE_MAP`
- [ ] Populate citations for every current entry from
      `docs/research/abap-types/types/*.md`
- [ ] Add unit test: `Object.keys(SLASH_TYPE_MAP).sort()` deep-equals
      `Object.keys(SLASH_TYPE_EVIDENCE).sort()`
- [ ] Add unit test: every cited file path resolves on disk (so a renamed research doc
      doesn't silently de-cite an entry)
- [ ] Run `npm test` — all tests must pass

### Task 6: Tools.ts and schemas.ts — surface the changes to LLMs

**Files:**
- Modify: `src/handlers/tools.ts`
- Modify: `src/handlers/schemas.ts`

The LLM-facing type descriptions in `tools.ts` carry examples (`FUNC/FM`,
`VIEW/V`) that users learn from. They must change in lockstep, otherwise LLMs continue
emitting the dead aliases.

- [ ] Find every example in `src/handlers/tools.ts` referencing `FUNC/FM`, `VIEW/V`,
      `CLAS/LI`, `FUGR/FF`. Replace with the corrected forms.
- [ ] Add a short note in the SAPRead description: "Function modules: use `FUNC` (or
      slash form `FUGR/FF`)."
- [ ] Verify no schema enum needs updating (canonical short forms didn't change — only
      slash aliases did, and slash forms aren't in enums)
- [ ] Add unit test that scrapes tool descriptions for the dead aliases and fails if
      any are present
- [ ] Run `npm test` — all tests must pass

### Task 7: VIEW round-trip integration test (the missing test)

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

The VIEW bug existed because no integration test ever read a DDIC view. Add one against
a known SAP standard view (e.g. `V_USR_NAME` or `V_T100`).

- [ ] Add integration test that calls `client.getView('V_USR_NAME')` (or whichever
      method handles VIEW reads — see `src/adt/client.ts`)
- [ ] Assert the resolved URL contains
      `/sap/bc/adt/vit/wb/object_type/viewdv/object_name/`
- [ ] Assert the response body shape matches a DDIC view (root element, namespaces)
- [ ] Use `requireOrSkip` for missing credentials, never empty catch
- [ ] Run `npm run test:integration` against a4h — must pass
- [ ] Run `npm test` — all tests must pass

### Task 8: SAPSearch returned-type assertion

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

**Background**: Cross-cutting methodology fix. The audit's biggest single finding (see
[`02-master-overview.md` cross-cutting findings](../../research/abap-types/02-master-overview.md#cross-cutting-findings-apply-to-future-audits-too)):
ADT silently ignores unknown `objectType` filters in `informationsystem/search` and
returns unfiltered results with status 200. Manually verified on a4h:
`?objectType=ZZZZ%2FZZ` returns `<adtcore:objectReferences>` with hits whose actual
`adtcore:type` is `CLAS/OC`, `PROG/P`, etc. — the filter was silently dropped.

This is *the* reason `STRU/DS`, `VIEW/V`, `CLAS/LI`, and `FUNC/FM` all hid for so long.
Any test that asserts only the request status is structurally unable to catch invented
aliases. Add a test pattern that always inspects the returned `<adtcore:type>` for
SAPSearch — so that future invented aliases fail loudly.

- [ ] Add integration test: SAPSearch with `objectType='CLAS/OC'` returns at least one
      result whose `adtcore:type === 'CLAS/OC'` (not just status 200)
- [ ] Add integration test: SAPSearch with `objectType='VIEW/DV'` returns at least one
      result whose `adtcore:type === 'VIEW/DV'`
- [ ] Add integration test: SAPSearch with a deliberately-invalid `objectType='ZZZZ/ZZ'`
      returns either zero results OR an error — assert the test fails loudly if ADT
      returns unfiltered hits (regression for the silent-ignore behavior)
- [ ] Run `npm run test:integration` — must pass
- [ ] Run `npm test` — all tests must pass

### Task 9: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs_page/tools.md` (or wherever the tool reference lives)
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `.claude/commands/*.md` (skills that reference dead aliases — search for
      `FUNC/FM`, `VIEW/V`, `CLAS/LI`)

- [ ] CLAUDE.md "Key Files for Common Tasks" — add a row for adding/removing slash
      aliases citing this plan
- [ ] CLAUDE.md "Code Patterns" — add a brief note: "Every SLASH_TYPE_MAP entry must
      have a citation in docs/research/abap-types/types/<short>.md or a fixture path"
- [ ] tools.md — replace any `FUNC/FM`, `VIEW/V`, `CLAS/LI`, `FUGR/FF→FUGR` examples
- [ ] roadmap.md — add an entry under recent: "Audit-driven purge of invented ADT slash
      aliases (issue #218 follow-up). Removes FUNC/FM, CLAS/LI, VIEW/V; repoints
      FUGR/FF→FUNC; adds missing VIEW URL; adds citation guard."
- [ ] docs/compare/00-feature-matrix.md — refresh "Last Updated" date
- [ ] Search `.claude/commands/*.md` for the dead aliases and fix
- [ ] Run `npm test` — all tests must pass

### Task 10: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Run integration: `npm run test:integration` against a4h — VIEW + SAPSearch
      assertions pass
- [ ] Manually verify on a4h: `arc1-cli call SAPRead --type VIEW --name V_USR_NAME`
      returns DDIC view source
- [ ] Manually verify on a4h: `arc1-cli call SAPRead --type FUNC --name BAPI_USER_GETLIST`
      still works (FUNC bare alias preserved)
- [ ] Move this plan to `docs/plans/completed/`
