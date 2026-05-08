# Type Auto-Mappings for SAPWrite

> **⚠ Historical document — partially superseded by issue #218 audit (PR #222) and PR #223.**
>
> The mapping tables below were the original design snapshot. Several entries
> were later identified as **invented** (not emitted by any ADT version) and
> have been corrected. **Do not learn slash codes from this document — refer to
> `src/handlers/intent.ts` SLASH_TYPE_MAP and `research/abap-types/types/<short>.md`
> for the verified-current source of truth.**
>
> Specifically:
> - `FUNC/FM` removed (invented; ADT emits `FUGR/FF` for function modules)
> - `CLAS/LI` removed (invented)
> - `VIEW/V` corrected to `VIEW/DV` (live a4h + npl 2026-05-08)
> - `TRAN/O` corrected to `TRAN/T` (live a4h + npl 2026-05-08)
> - `FUGR/FF` repointed from `→ FUGR` to `→ FUNC` (FF is a function module, not a group)
> - `STRU/DS → STRU` collapsed: `STRU/DS → TABL` and bare `STRU` removed (Model B, PR #219)
>
> See `docs/plans/completed/audit-purge-invented-adt-types.md` for the full
> per-entry rationale + live evidence.

## Overview

Add automatic mapping of friendly type codes to ADT internal type codes in the `SAPWrite` and `SAPActivate` handlers, so LLMs don't need to know SAP's internal slash-suffix type codes (e.g., `CLAS/OC`, `INTF/OI`, `PROG/P`). Currently, ARC-1 already hardcodes these mappings inside `buildCreateXml()` and `buildActivationXml()`, but if an LLM sends `type: "CLAS/OC"` (as it might after seeing search results from `SAPSearch`), the `objectBasePath()` switch falls through to the default and produces a wrong URL.

This feature adds a single `normalizeObjectType()` function that strips ADT slash suffixes and normalizes common aliases (case-insensitive), applied early in `handleSAPWrite`, `handleSAPActivate`, `handleSAPRead`, and `handleSAPSearch`. This follows the dassian-adt pattern of 16 type auto-mappings but with ARC-1's design philosophy: a simple, testable normalization layer rather than a separate type registry.

The approach is conservative and reversible — if an LLM sends an already-correct type like `CLAS`, it passes through unchanged. If it sends `CLAS/OC` or `clas`, it gets normalized to `CLAS`.

## Context

### Current State
- `buildCreateXml()` in `intent.ts` (line ~1402) hardcodes the mapping: `CLAS` → XML with `adtcore:type="CLAS/OC"`, etc.
- `objectBasePath()` in `intent.ts` (line ~1632) maps friendly types to ADT URL paths but has no normalization — `CLAS/OC` falls through to the default `programs/programs/` path.
- The SAPRead error message (line ~909) hints LLMs to "drop the slash suffix" — but this is guidance, not enforcement.
- `normalizeSrvbBindingType()` in `ddic-xml.ts` is the only existing normalization function (for SRVB binding types).
- Dassian-adt has 16 type auto-mappings in `abap_create`. The `compare/00-feature-matrix.md` row for "Type auto-mappings" shows ARC-1 as ❌.

### Target State
- A `normalizeObjectType()` function that maps ADT slash types and common aliases to the canonical short codes used by ARC-1.
- Applied at the entry point of all handlers that accept a `type` parameter: `handleSAPRead`, `handleSAPWrite`, `handleSAPActivate`, `handleSAPSearch`, `handleSAPNavigate`, `handleSAPDiagnose`, `handleSAPContext`.
- Also applied to the `objects` array in `batch_create` and `batch_activate`.
- The `compare/00-feature-matrix.md` row updated to ✅.

### Complete Type Mapping Table

| ADT slash code | Normalized to | Description |
|---------------|---------------|-------------|
| `PROG/P` | `PROG` | ABAP program |
| `PROG/I` | `INCL` | ABAP include |
| `CLAS/OC` | `CLAS` | ABAP class |
| `CLAS/LI` | `CLAS` | ABAP class (library variant) |
| `INTF/OI` | `INTF` | ABAP interface |
| `FUNC/FM` | `FUNC` | Function module |
| `FUGR/F` | `FUGR` | Function group |
| `FUGR/FF` | `FUGR` | Function group (variant) |
| `DDLS/DF` | `DDLS` | CDS DDL source |
| `BDEF/BDO` | `BDEF` | Behavior definition |
| `SRVD/SRV` | `SRVD` | Service definition |
| `SRVB/SVB` | `SRVB` | Service binding |
| `DDLX/EX` | `DDLX` | CDS metadata extension |
| `TABL/DT` | `TABL` | Database table |
| `STRU/DS` | `STRU` | DDIC structure |
| `DOMA/DD` | `DOMA` | DDIC domain |
| `DTEL/DE` | `DTEL` | DDIC data element |
| `MSAG/N` | `MSAG` | Message class |
| `DEVC/K` | `DEVC` | Package |
| `TRAN/O` | `TRAN` | Transaction |
| `VIEW/V` | `VIEW` | DDIC view |

Additionally, the function handles case-insensitive input (`clas` → `CLAS`, `Prog` → `PROG`).

### Key Files

| File | Role |
|------|------|
| `src/handlers/intent.ts` | Main handler — add `normalizeObjectType()`, apply at handler entry points |
| `src/handlers/tools.ts` | Tool descriptions — add hint about type auto-mapping |
| `tests/unit/handlers/intent.test.ts` | Unit tests for normalization function and integration |
| `compare/00-feature-matrix.md` | Feature matrix — update row |
| `docs/roadmap.md` | Mark FEAT-17 as completed |
| `docs/tools.md` | Update SAPWrite docs with type normalization note |

### Design Principles

1. **Normalize early, once** — Apply normalization at the top of each handler, before any logic. This avoids spreading normalization logic across multiple functions.
2. **Passthrough for valid types** — Already-correct types (`CLAS`, `PROG`, etc.) pass through unchanged. No overhead for well-behaved LLMs.
3. **Case-insensitive** — LLMs may send `clas`, `Clas`, or `CLAS`. All normalize to `CLAS`.
4. **Slash-suffix stripping** — `CLAS/OC` → `CLAS`, `PROG/P` → `PROG`. Some slash types map to different friendly codes: `PROG/I` → `INCL`, `FUNC/FM` → `FUNC`.
5. **No fallback guessing** — Unknown types pass through unchanged. The existing error messages handle unknown types well.
6. **Exported for testing** — The function is exported so unit tests can exercise it directly.

## Development Approach

This is a small, focused change (XS effort). The normalization function is pure (no I/O) and easy to unit test exhaustively. Integration testing is not needed — the function is applied at the handler entry point before any SAP calls, so existing E2E tests implicitly cover the wiring.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add `normalizeObjectType()` function and apply to all handlers

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Add a pure function `normalizeObjectType(type: string): string` that normalizes ADT type codes. Export it for testing.

The function should:
1. Trim and uppercase the input
2. Check a `SLASH_TYPE_MAP` for ADT slash types (e.g., `CLAS/OC` → `CLAS`, `PROG/I` → `INCL`)
3. If not in the slash map, return the uppercased input as-is (passthrough for already-correct types)

The complete slash type map (based on `buildCreateXml` adtcore:type values and ADT API documentation):
```
PROG/P → PROG, PROG/I → INCL, CLAS/OC → CLAS, CLAS/LI → CLAS,
INTF/OI → INTF, FUNC/FM → FUNC, FUGR/F → FUGR, FUGR/FF → FUGR,
DDLS/DF → DDLS, BDEF/BDO → BDEF, SRVD/SRV → SRVD, SRVB/SVB → SRVB,
DDLX/EX → DDLX, TABL/DT → TABL, STRU/DS → STRU, DOMA/DD → DOMA,
DTEL/DE → DTEL, MSAG/N → MSAG, DEVC/K → DEVC, TRAN/O → TRAN,
VIEW/V → VIEW
```

Place the function near the existing `objectBasePath()` function (~line 1632) since they are logically related.

Apply `normalizeObjectType()` at the entry point of these handlers in `intent.ts`:

1. **`handleSAPRead`** (~line 480): normalize `type` after extraction from `args`
2. **`handleSAPWrite`** (~line 1710): normalize `type` after extraction from `args`. Also normalize `type` in each object in the `objects` array for `batch_create` (~line 2004)
3. **`handleSAPActivate`** (~line 2280 approx): normalize `type` from `args`, and each object's `type` in the `objects` array
4. **`handleSAPSearch`** (~line 920 approx): normalize `objectType` if provided
5. **`handleSAPNavigate`** (~line 2370 approx): normalize `type` from args
6. **`handleSAPDiagnose`** (~line 2450 approx): normalize `type` from args
7. **`handleSAPContext`** (~line 2550 approx): normalize `type` from args

For batch arrays, normalize inline:
```typescript
const objType = normalizeObjectType(String(obj.type ?? ''));
```

- [ ] Create the `SLASH_TYPE_MAP` constant as a `Record<string, string>` with all 21 mappings
- [ ] Implement `normalizeObjectType()` — trim, uppercase, lookup in map, return match or passthrough
- [ ] Export the function for testing
- [ ] Apply normalization in `handleSAPRead` for the `type` variable
- [ ] Apply normalization in `handleSAPWrite` for the `type` variable and batch `objects` types
- [ ] Apply normalization in `handleSAPActivate` for the `type` variable and batch `objects` types
- [ ] Apply normalization in `handleSAPSearch` for `objectType`
- [ ] Apply normalization in `handleSAPNavigate` for `type`
- [ ] Apply normalization in `handleSAPDiagnose` for `type`
- [ ] Apply normalization in `handleSAPContext` for `type`
- [ ] Add unit tests (~20 tests) in a new `describe('normalizeObjectType')` block:
  - All 21 slash-type mappings produce correct output
  - Case-insensitive input (`clas` → `CLAS`, `Prog/P` → `PROG`)
  - Already-correct types pass through (`CLAS` → `CLAS`, `PROG` → `PROG`)
  - Unknown types pass through unchanged (`UNKNOWN` → `UNKNOWN`)
  - Empty/whitespace input returns empty string
- [ ] Add integration test: verify `handleToolCall` with `SAPWrite create` using `type: "CLAS/OC"` produces correct create XML (mock HTTP, check the URL contains `/oo/classes/`)
- [ ] Add integration test: verify `handleToolCall` with `SAPRead` using `type: "clas"` (lowercase) calls the correct ADT endpoint
- [ ] Run `npm test` — all tests must pass

### Task 2: Update tool descriptions and documentation

**Files:**
- Modify: `src/handlers/tools.ts`
- Modify: `docs/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `compare/00-feature-matrix.md`
- Modify: `compare/07-dassian-adt.md`
- Modify: `compare/08-dassian-adt-feature-gap.md`

Update tool descriptions and documentation to reflect the new type auto-mapping capability.

- [ ] In `src/handlers/tools.ts`, update the `SAPWrite` tool description (line ~122) to add a note: `'Type codes are auto-normalized: "CLAS/OC" → "CLAS", case-insensitive. '`
- [ ] In `src/handlers/tools.ts`, update the `SAPRead` tool description to mention type normalization
- [ ] In `src/handlers/tools.ts`, update the `SAPActivate` tool description to mention type normalization
- [ ] In `docs/tools.md`, add a note in the SAPWrite section about type auto-mapping (search for "SAPWrite" section, add under the type parameter description)
- [ ] In `docs/roadmap.md`, mark FEAT-17 as completed: change the table row status from "Not started" to a strikethrough like the other completed items (e.g., `~~9~~ | ~~FEAT-17~~ | ~~Type Auto-Mappings for SAPWrite~~ | ~~P1~~ | ~~XS~~ | ~~Completed 2026-04-14~~`)
- [ ] In `docs/roadmap.md`, update the FEAT-17 detail section status field to "Completed"
- [ ] In `compare/00-feature-matrix.md`, update the "Type auto-mappings (CLAS→CLAS/OC)" row: change ARC-1 from ❌ to ✅
- [ ] In `compare/07-dassian-adt.md`, update the "16 type auto-mappings" row in the "Features This Project Has That ARC-1 Lacks" table: mark as implemented
- [ ] In `compare/08-dassian-adt-feature-gap.md`, update the "16 type auto-mappings" row in Category C: mark as implemented
- [ ] Run `npm test` — all tests must pass (tool description changes should not break tests)

### Task 3: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Verify the normalization function handles all 21 ADT slash types correctly
- [ ] Verify that existing E2E tests still work conceptually (they send correct types like `CLAS`, `TABL`, `DDLS` which should pass through unchanged)
- [ ] Move this plan to `docs/plans/completed/`
