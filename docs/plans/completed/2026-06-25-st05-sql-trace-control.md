# ST05 SQL-trace state control + record-access directory (`SAPDiagnose`)

## Overview

Let an LLM **arm/read the ST05 SQL trace** and find **where the recorded SQL lives**, GUI-free — the control
half of the "why is this OData/SQL slow" loop (pairs with PR-A's `odata_perf`/`cds_sql`). Three read/write
`SAPDiagnose` actions, all live-verified on a4h (758):

1. **`sql_trace_state`** (read) — GET the current ST05 trace state (sql/buf/enq/rfc/http/… on-off + filters).
2. **`set_sql_trace_state`** (write) — arm/disarm the SQL trace (+ a user filter): GET → flip `sqlOn` /
   `traceUser` → PUT.
3. **`sql_trace_directory`** (read) — GET `/st05/trace/directory`, which SAP answers with the **TMC "SQL
   Trace Analysis" deep-link** — the official place to read the recorded statements. There is **no ADT
   SQL-record read endpoint**; SAP routes record viewing to this UI. ARC-1 returns the deep-link + the
   prerequisites instead of a dead end.

**Why not the TMC PTC OData reader (the original #5):** exhaustively proven blocked. `/sap/bc/stmc/data`
returns `200 text/html` 0-bytes for every verb/path/Accept/`$batch` (the internal `/STMC/` framework needs a
system-specific, session-bound request the UI builds). SAP's own `st05/trace/directory` hands back the deep-link
— so the deep-link **is** the stable answer. The real ADT-native record reader is **ABAP Cross Trace** (see
Follow-up); that's a separate PR.

- `sql_trace_state`/`sql_trace_directory` = `read`; `set_sql_trace_state` = `write` (mutates server trace state).
- Reuses PR-A's `icf-service-inactive` guard for an un-activated stmc node behind the deep-link.
- No new env vars/flags. Stacked on PR A (`feat/odata-sql-perf-insight`) — shares the SAPDiagnose surface.

## Context

### Current State
- PR A added `odata_perf`/`cds_sql` to `SAPDiagnose`. No SQL-trace control.
- ADT has `/sap/bc/adt/st05/trace/state` (GET+PUT) and `/sap/bc/adt/st05/trace/directory` (GET) — both in
  `/discovery`. `CL_ADT_ST05_KERNEL_INTERFACE` is state-only (no record read).

### Key Files
| File | Role |
|------|------|
| `src/adt/diagnostics.ts` | `getSqlTraceState`/`setSqlTraceState`/`getSqlTraceDirectory` + `parseSqlTraceState`/`parseSqlTraceDirectory` |
| `src/handlers/diagnose.ts` | `case 'sql_trace_state'`/`'set_sql_trace_state'`/`'sql_trace_directory'` + default action list |
| `src/handlers/schemas.ts` | enum + `sqlOn`/`traceUser` params |
| `src/handlers/tools.ts` | enum + descriptions + props |
| `src/authz/policy.ts` | `sql_trace_state`/`sql_trace_directory`=read/Read, `set_sql_trace_state`=write/Update |
| `tests/unit/adt/diagnostics.test.ts`, `tests/fixtures/xml/st05-trace-state.xml`, `st05-trace-directory.xml` | tests + fixtures |

### Verified Live Evidence (2026-06-25, a4h 758, user MARIAN)
- **GET `/sap/bc/adt/st05/trace/state`** → `200`, `application/vnd.sap.adt.perf.trace.state.v1+xml`:
  `<ts:traceStateInstanceTable><ts:traceStateInstance><ts:instance>vhcala4hci_A4H_00</ts:instance>…
  <ts:traceTypes><ts:sqlOn>false</ts:sqlOn><ts:bufOn>false</ts:bufOn>…<ts:authOn>false</ts:authOn></ts:traceTypes>
  <ts:traceProperties>…</ts:traceProperties><ts:traceFilter><ts:traceUser/><ts:transactionCode/><ts:program/>
  <ts:rfcFunction/><ts:url/><ts:wpId/></ts:traceFilter></ts:traceStateInstance></ts:traceStateInstanceTable>`.
- **PUT** the same body with `<ts:sqlOn>true</ts:sqlOn>` + `<ts:traceUser>MARIAN</ts:traceUser>`, CSRF +
  `Content-Type: application/vnd.sap.adt.perf.trace.state.v1+xml` → `200`, response echoes `sqlOn=true` +
  `traceUser=MARIAN`. PUT-it-back-with-edits round-trips. (Disarm = PUT with `sqlOn=false`, `traceUser` empty.)
- **GET `/sap/bc/adt/st05/trace/directory`** → `200`,
  `<td:traceDirectory><td:uri>http://vhcala4hci:50000/sap/bc/stmc/ui5/?sap-client=001&sap-language=EN#domain_id=AS_ABAP&navigation_id=SQL_TRACE_ANALYSIS&system_id=TMS_…</td:uri></td:traceDirectory>` — the TMC deep-link.
- **TMC OData blocker:** `/sap/bc/stmc/data{,/$metadata,/TH_PTC_DIRECTORY,/$batch}` all → `200 text/html` 0-bytes.

### Design Principles
1. **`setSqlTraceState` = GET→edit→PUT on the raw XML** (targeted replace of `sqlOn`/`traceUser`) — preserves
   SAP's exact element set/order and is forward-compatible with fields ARC-1 doesn't model. `// ponytail:` flips
   all instances; add per-instance targeting only if a multi-instance system needs it.
2. **Release behavior.** `/st05/trace/*` is in `/discovery` on 758; verify presence on 750/816 at test, and
   surface a clear "not available on this release" via the existing error classifier if absent.
3. Three-file schema sync + ACTION_POLICY parity; all ADT calls `checkOperation`-guarded.

## Development Approach
Pure parser + unit test first, then the GET/PUT client functions, then wire the handler. Fixtures captured live
(`st05-trace-state.xml`, `st05-trace-directory.xml`) — do not hand-edit. `set_sql_trace_state` integration is
verified live (arm → read state shows sqlOn=true → disarm). Snapshot + budgets refreshed in the same commit.

## Validation Commands
- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run validate:policy`

### Task 1: Parse + read ST05 trace state & directory
**Files:** Modify `src/adt/diagnostics.ts`, `src/handlers/diagnose.ts`, `schemas.ts`, `tools.ts`,
`src/authz/policy.ts`; add `tests/unit/adt/diagnostics.test.ts` cases + the two captured fixtures.

- [ ] `parseSqlTraceState(xml)` → `{ instance, host, isLocal, isSelected, traceTypes:{sql,buf,enq,rfc,http,apc,amc,auth}, filter:{user,transactionCode,program,rfcFunction,url,wpId} }[]` (booleans from `'true'`/`'false'`).
- [ ] `parseSqlTraceDirectory(xml)` → `{ recordViewerUrl, note }` (the `td:uri` deep-link).
- [ ] `getSqlTraceState`/`getSqlTraceDirectory` client fns (`checkOperation` Read).
- [ ] Wire `sql_trace_state` + `sql_trace_directory` (read). Update default-case action list.
- [ ] Three-file sync + policy (read/Read).
- [ ] Tests (~4): parse the captured state fixture (sql off, all flags present); parse the directory fixture → deep-link; empty/garbage → safe.
- [ ] `npm test`.

### Task 2: Arm/disarm the SQL trace (`set_sql_trace_state`, write)
**Files:** Modify `src/adt/diagnostics.ts`, `src/handlers/diagnose.ts`, `schemas.ts`, `tools.ts`,
`src/authz/policy.ts`, tests.

- [ ] `setSqlTraceState(http, safety, { sqlOn, traceUser? })`: `checkOperation` Update; GET raw state; targeted
      replace `<ts:sqlOn>…` → the requested value and `<ts:traceUser>…`/`<ts:traceUser/>` → the user (or empty);
      PUT with CSRF + `Content-Type: application/vnd.sap.adt.perf.trace.state.v1+xml`; return `parseSqlTraceState(resp)`.
- [ ] Wire `set_sql_trace_state` (require `sqlOn`); response includes a `next` hint → run `sql_trace_directory`
      after reproducing, to get the record-viewer link.
- [ ] Three-file sync + policy (write/Update).
- [ ] Tests (~3): the GET→PUT replace produces `sqlOn=true` + the user filter (mock GET/PUT, assert the PUT body);
      a disarm (`sqlOn=false`) clears it; the write gate (`checkOperation` Update) is exercised.
- [ ] `npm test`.

### Task 3: Snapshot, budgets, docs
**Files:** `tests/fixtures/tool-definitions/*.json` (regen), `scripts/ci/check-tool-schema-budget.ts`,
`docs_page/tools.md`, `docs_page/roadmap.md`, `docs/compare/00-feature-matrix.md`, `AGENTS.md`.

- [ ] `npx vitest run -u` the snapshot; bump budgets if tripped.
- [ ] Document the 3 actions (as-shipped): `set_sql_trace_state` needs `SAP_ALLOW_WRITES`; records are read via
      the deep-link (no ADT SQL-record API); note the **Cross Trace** follow-up.
- [ ] Roadmap: FEAT-09 SQL-trace **control** done; records via deep-link; Cross Trace = next. Feature-matrix: flip
      "SQL traces" for ARC-1 to ✅ (state control) and add a "SQL-trace record viewer (deep-link)" row.
- [ ] `npm test`, `npm run validate:policy`.

### Task 4: Final verification
- [ ] Full gate green.
- [ ] Live on **758**: `sql_trace_state` → off; `set_sql_trace_state sqlOn=true traceUser=MARIAN` → state shows
      on; `sql_trace_directory` → deep-link; then disarm. Verify on **750** + **816** (or record graceful absence).
- [ ] Move plan to `docs/plans/completed/`, fix links.

## Follow-up (separate PR) — ABAP Cross Trace = the real GUI-free record reader
Discovered live on 758 (NOT 816-only as previously assumed): `/sap/bc/adt/crosstrace/{traces,activations,
components,request_types,urimapping}`. ADT-native XML; **request types include `O`=OData V2, `4`=OData V4, `U`=URL**
— exactly the slow-Fiori case. Create-activation Content-Type `application/vnd.sap.adt.crosstrace.activations.v1+xml`;
activation element order begins `<sxt:activation><sxt:enabled/><sxt:components/>…` (error-driven schema walk).
`components` GET = 32 trace components; `request_types` GET = 10. A focused PR: create activation → reproduce →
list `crosstrace/traces` → read a trace's records (RAP/OData-aware, SQL + component timings). This is the
strategic successor to the blocked TMC OData reader.
