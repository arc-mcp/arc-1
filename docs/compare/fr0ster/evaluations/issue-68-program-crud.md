# Issue #68 — CreateProgram / UpdateProgram / DeleteProgram

> **Priority**: Skip (already covered)
> **Source**: fr0ster issue #68 (2026-04-20, closed superseded by #69)
> **ARC-1 component**: `src/handlers/intent.ts` (already present)

## What fr0ster reported

`HighLevelHandlersGroup` exposed Create/Update/Delete for CLAS, INTF, TABL, STRU, DTEL, DOMA, VIEW, BDEF, SRVD, SRVB, FUGR, FM — but **not for classic executable PROG** (`REPORT zfoo.`). The use case was preparing demo landscapes that include classic reports for code-review/security training. The issue was closed in favour of #69 (per-instance systemType, broader root cause).

## ARC-1 current state

ARC-1 supports PROG CRUD already. From `src/handlers/intent.ts`:

- `case 'PROG'` in SAPRead (line 1271) → `client.getProgram(name)`
- `case 'PROG'` in `buildCreateXml` (line 2194) → emits the `<program:abapProgram adtcore:type="PROG/P">` envelope
- `case 'PROG'` in `objectBasePath` (line 2529) → `/sap/bc/adt/programs/programs/`
- `'PROG'` is in `SAPWRITE_TYPES_ONPREM` (`src/handlers/schemas.ts:216`)

So `SAPWrite(action='create', type='PROG', name='ZARC1_TEST_REPORT', package='$TMP', source='REPORT zarc1_test_report.\n...')` and the corresponding `update` / `delete` already work, with end-to-end coverage in `tests/e2e/fixtures.ts` (`ZARC1_TEST_REPORT` is one of the four persistent fixtures).

## Decision

**no-action** — ARC-1 has had PROG CRUD since before this issue was filed. The intent-based design (one `SAPWrite` tool with `type=PROG`) means we never had the per-type-handler gap fr0ster hit.

This is a **win for the architecture comparison**, not a TODO.
