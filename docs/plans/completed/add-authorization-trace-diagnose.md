# Add Authorization-Trace Read (`SAPDiagnose action=authorization_trace`)

> **2026-07-10 follow-up:** responses now expose an honest `traceState.status="unknown"` warning and
> RZ11/RZ10 activation guidance. Persisted `SUAUTHVALTRC` rows cannot reveal the current dynamic
> `auth/auth_user_trace` value, and the standard STUSERTRACE kernel status methods are not in ADT.

## Overview

> **Implemented 2026-07-09.** The public exports remain available from `src/adt/diagnostics.ts`, but the new implementation lives in focused `src/adt/authorization-trace.ts` because `diagnostics.ts` was already at its enforced file-size ceiling. All validation and live-proof tasks completed, including the empty trace-off result on a4h-2025 (SAP_BASIS 816).

Add a **read-only** diagnostic action `SAPDiagnose action=authorization_trace` that surfaces SAP's
long-term **user authorization trace** (transaction STUSERTRACE), persisted in table
`SUAUTHVALTRC`. For a given user / authorization object it returns every recorded authorization
check with its result code (`RC`: 0 = passed, ≠ 0 = denied), the checked field values decoded to
their field names via table `TOBJ`, the ABAP code location, and the first-seen timestamp. An
`only_failures` filter narrows to denied checks (`RC <> 0`) — the closest in-core equivalent to SU53
("what did user X get denied"), but persistent and covering every check rather than just the last.

Key design decisions:
- **Reuse the gated data-preview primitive, add no new endpoint.** The read is
  `client.runTableQuery('SUAUTHVALTRC', { columns, where, maxRows })` (`src/adt/client.ts:1451`),
  which is guarded by `checkOperation(this.safety, OperationType.Query, …)` → **`SAP_ALLOW_DATA_PREVIEW`
  (the *data* scope), NOT `SAP_ALLOW_FREE_SQL`**. This is the whole reason to make it a first-class
  action instead of a "just use SAPQuery" doc: authorization analysis becomes available under the
  small gate, and no deployment must open free SQL for it. `odata_perf` (`data` scope,
  `OperationType.Query`) is the exact precedent.
- **Mirror the `sql_trace_state` / `cds_testcases` shape** — a `SAPDiagnose` action that delegates to
  a function in `src/adt/diagnostics.ts` and returns `JSON.stringify`'d structured results. No new
  tool, no new config flag.
- **Field-name decode via `TOBJ`.** `SUAUTHVALTRC.FIELD1..FIELD0` hold the checked *values*
  positionally; `TOBJ.FIEL1..FIEL0` hold that object's field *names* in the same order. One extra
  `runTableQuery('TOBJ', …)` over the distinct objects in the result turns `FIELD1=SU01` into
  `TCD=SU01` — the way SU53 shows it. Cached per call.
- **Sort client-side.** The ADT freestyle SQL endpoint rejects `ORDER BY` on NW 7.50/7.51, so
  `buildTableQuerySql` (`client.ts:263`) omits it. `getAuthorizationTrace` sorts the returned rows by
  `FIRSTCALL` descending in JS. There is no server-side pagination — the read returns up to
  `maxResults` matching rows; when more exist the subset is arbitrary, so callers narrow with
  `user` / `authObject` / `only_failures`.
- **No new config, no probe-catalog entry, no discovery gate.** Availability is a pure runtime
  concern: on a system without `SUAUTHVALTRC` (ABAP Cloud / Steampunk / S/4HC, and NW 7.50 where the
  freestyle multi-column path is unavailable), the datapreview call returns `400 "Cannot find
  'SUAUTHVALTRC'"`; the handler catches that and returns a clear "not available here → use the
  *Display Authorization Trace* Fiori app; requires an on-prem system with the STUSERTRACE trace
  (`auth/auth_user_trace`) enabled" hint.

Success criteria (folded here as plain bullets, not a checkbox section):
- `SAPDiagnose action=authorization_trace` returns decoded trace entries, filterable by `user`,
  `authObject`, `only_failures`, capped by `maxResults`, sorted most-recent-first.
- Runs under `data` scope + `SAP_ALLOW_DATA_PREVIEW`; never requires `SAP_ALLOW_FREE_SQL`.
- Absent table / trace-off / empty result each return a clear, actionable message, not a raw error.
- Unit + E2E coverage including failure and polluted-payload paths; docs and Key-Files updated.

## Context

### Current State

- `handleSAPDiagnose` (`src/handlers/diagnose.ts:47`) dispatches read/diagnostic actions via
  `switch (action)`: `syntax`, `unittest`, `atc`, `cds_testcases`, `object_state`, `quickfix`,
  `apply_quickfix`, `dumps`, `traces`, `trace_start`, `trace_requests`, `trace_cancel`,
  `system_messages`, `gateway_errors`, `odata_perf`, `cds_sql`, `sql_trace_state`,
  `set_sql_trace_state`, `sql_trace_directory` (the `default` "Unknown SAPDiagnose action…"
  message at `diagnose.ts:~360` lists them). There is **no** authorization-trace action.
- The gated table-read primitive already exists: `AdtClient.runTableQuery(tableName, { columns,
  where, maxRows })` (`src/adt/client.ts:1451`) → `checkOperation(this.safety,
  OperationType.Query, 'RunTableQuery')` → `buildTableQuerySql` (`client.ts:263`, safe identifier
  sanitization + `ALLOWED_OPS`) → `POST /sap/bc/adt/datapreview/freestyle?rowNumber=N` →
  `parseTableContents` (`src/adt/xml-parser.ts:237`). `OperationType.Query` gates on
  `allowDataPreview` (`src/adt/safety.ts:116`).
- Scope policy lives in `src/authz/policy.ts` `ACTION_POLICY` (SAPDiagnose block at `:137–158`);
  `'SAPDiagnose.odata_perf': { scope: 'data', opType: OperationType.Query }` (`:154`) is the
  precedent for a data-preview-gated diagnostic.
- `diagnostics.ts` functions today are all `(http: AdtHttpClient, safety: SafetyConfig, …)` and
  return structured data with a sibling `parse*` helper (e.g. `getDump`/`parseDumpDetail`,
  `getSqlTraceState`). **None currently takes `AdtClient`** — `getAuthorizationTrace` will be the
  first, so it must add `import type { AdtClient } from './client.js';` (type-only, erased at compile
  time; no runtime cycle — `client.ts` does not import `diagnostics.ts`).
- Optional booleans in `src/handlers/schemas.ts` use `looseOptionalBoolean` (`schemas.ts:41`) — never
  `z.coerce.boolean()` (which maps `"false"`→`true`, #360).

### Target State

`SAPDiagnose action=authorization_trace` with optional `user`, `authObject`, `only_failures`,
`maxResults` returns:

```json
{
  "trace": "STUSERTRACE (long-term user authorization trace, table SUAUTHVALTRC)",
  "filters": { "user": "AUTH_TEST", "authObject": null, "onlyFailures": true },
  "count": 1,
  "entries": [
    {
      "user": "AUTH_TEST",
      "application": "TR",
      "authObject": "S_TCODE",
      "rc": 12,
      "result": "No authorization",
      "fields": { "TCD": "SU01" },
      "codeLocation": "LSUSEU11:53",
      "firstSeen": "2026-07-09T21:10:48Z"
    }
  ],
  "note": "1 entry (rc<>0). Trace records only while auth/auth_user_trace is enabled; passed checks (rc=0) are recorded too — omit only_failures to see them."
}
```

- On a system without the table (ABAP Cloud; NW 7.50 inferred, not directly tested) or with data-preview disabled: a clear message, not a
  raw stack. Table-absent → "authorization trace not available on this system…"; scope/gate off →
  the normal `AdtSafetyError` scope message from `dispatch.ts`.
- Empty result (trace off, or no matching rows): `count: 0` + a hint to enable
  `auth/auth_user_trace` / widen filters.

### Key Files

| File | Role |
|------|------|
| `src/adt/types.ts` | Add `AuthTraceEntry` + `AuthorizationTraceResult` interfaces (near other `*Result` types) |
| `src/adt/diagnostics.ts` | Add `getAuthorizationTrace(client, opts)`, `decodeAuthTraceRows(...)` pure helper, `AUTH_RC_LABELS` map, `parseFirstCallTs(...)` |
| `src/handlers/diagnose.ts` | Add `case 'authorization_trace'` to `handleSAPDiagnose` (before `default` at `:~360`); extend the "Supported:" list |
| `src/handlers/schemas.ts` | Add `'authorization_trace'` to the SAPDiagnose action enum; add `authObject` (optional string) + `onlyFailures` (`looseOptionalBoolean`) |
| `src/handlers/tools.ts` | Add `'authorization_trace'` to the SAPDiagnose action enum (`:~1133`) + `authObject`/`onlyFailures` param descriptions + an Actions/Examples line |
| `src/authz/policy.ts` | Add `'SAPDiagnose.authorization_trace': { scope: 'data', opType: OperationType.Query }` (after `:154`) |
| `src/adt/client.ts` | (Reuse only) `runTableQuery` `:1451`, `buildTableQuerySql` `:263` |
| `tests/unit/adt/diagnostics.test.ts` | Unit tests for `decodeAuthTraceRows` + `getAuthorizationTrace` (mock `runTableQuery`) |
| `tests/unit/handlers/lint-diagnose.test.ts` | Handler-case tests (empty hint, table-absent hint, filter wiring) |
| `tests/unit/handlers/schemas.test.ts` / `tools.test.ts` | Schema + polluted-payload + tool-def snapshot |
| `tests/e2e/*.e2e.test.ts` | E2E via MCP `callTool` (skip-policy when unavailable/empty) |
| `docs_page/tools.md`, `docs_page/authorization.md`, `docs_page/roadmap.md`, `docs/compare/00-feature-matrix.md`, `README.md`, `AGENTS.md` | Docs |

### Verified Live Evidence

Captured this session against **a4h** (`a4h.marianzeis.de:50000`, SAP_BASIS **758**, user MARIAN,
client 001) and **a4h-2025** (`:50100`, **816**); HANA catalog via `ssh root@176.9.72.62`. Commands
+ output are in `docs/research/2026-07-09-su53-authorization-analysis-adt-surface.md`.

- **`SUAUTHVALTRC` exists + readable via the data-preview path** (free-SQL OFF, data-preview ON):
  `arc1-cli call SAPRead --json '{"type":"TABLE_QUERY","name":"SUAUTHVALTRC", …}'` with
  `SAP_ALLOW_FREE_SQL=false SAP_ALLOW_DATA_PREVIEW=true` returns rows. Columns (HANA catalog):
  `MANDT, NAME, TYPE, USERNAME, HASH, OBJECT, FORUSER, RC(INTEGER), REASON1..5, CDS,
  FIELD1..FIELD9,FIELD0, ABAPPROG, ABAPLINE(INTEGER), FIRSTCALL(DECIMAL 15, YYYYMMDDHHMMSS), ADDINFO`.
  a4h: 147,809 rows / 56 objects / 6 users. a4h-2025 (816): table present, readable, 0 rows.
- **Real failure row** (restricted user `AUTH_TEST` denied tcode SU01; SU53 showed S_TCODE / TCD=SU01
  / RC12): the tool returned
  `{ USERNAME:"AUTH_TEST", NAME:"", TYPE:"TR", OBJECT:"S_TCODE", RC:"12", FIELD1:"SU01", FIELD2:"",
  ABAPPROG:"LSUSEU11", ABAPLINE:"53", FIRSTCALL:"20260709211048" }` — matches SU53's 21:10:48 UTC.
- **RC filter honored:** `RC='4'` → 0 rows; `RC='0'` → many; `RC='0' AND OBJECT='S_TABU_NAM'` →
  DEVELOPER+MARIAN rows. Both numeric and multi-condition AND work.
- **`TOBJ` decode source** (`arc1-cli call SAPRead TABLE_QUERY name=TOBJ`): `S_DEVELOP` →
  FIEL1..5 = `DEVCLASS,OBJTYPE,OBJNAME,P_GROUP,ACTVT`; `S_TCODE` → FIEL1 = `TCD`. Maps
  `SUAUTHVALTRC.FIELDn` (value) ↔ `TOBJ.FIELn` (name) positionally.
- **Absence signature:** a nonexistent table via the same path returns
  `AdtApiError: status 400 … /sap/bc/adt/datapreview/freestyle…: Cannot find '<TABLE>'.` (observed
  for `PA0008`/`PA0002`). Used for the "not available here" branch.
- **Not reachable any other way:** no `su53`/auth-trace collection in a4h discovery (1342
  collections); the STUSERTRACE OData service group `UI_AUTHORIZATION_TRACE` is *not published* on
  a4h; SU53's own live buffer is app-server memory + on-demand table `USR07` (0 rows) — out of scope.
- **Trace state:** a4h `auth/auth_user_trace = y` (on); a4h-2025 off (empty). MARIAN + DEVELOPER are
  `SAP_ALL`, so their checks are all `RC=0` — only a non-SAP_ALL user yields `rc<>0` rows.

### Design Principles

1. **Data-preview gate, never free-SQL.** Reuse `client.runTableQuery` (`OperationType.Query` →
   `allowDataPreview`). Scope `data`. This is the core value; do not build a free-SQL path.
2. **No new endpoint / config / probe type.** Reuse the datapreview freestyle primitive; availability
   is runtime (catch table-absent). No `SAP_*` flag beyond the existing `SAP_ALLOW_DATA_PREVIEW`.
3. **Honest to the SAP admin's model.** This is the **STUSERTRACE** trace, not SU53 and not
   STAUTHTRACE (live). Name/describe it as the authorization trace; document that `only_failures` is
   denied checks *from the trace* (requires the trace to be enabled), not SU53's live buffer. Do not
   claim to toggle the trace — there is no ADT endpoint for `auth/auth_user_trace` (verified: ADT
   `system/*` is read-only), so enabling it stays an out-of-band admin action.
4. **Release/system behavior:** on-prem SAP_BASIS 7.40 SP16+ with the trace enabled → full (verified
   758). 816 → table present + readable (verified; empty when trace off). ABAP Cloud/Steampunk/S4HC →
   table read returns `Cannot find '<table>'` (verified signature) → fail-soft hint. **NW 7.50 is
   inferred** unavailable (TABLE_QUERY needs SAP_BASIS 752+; NPL's datapreview is 404-bugged) and was
   NOT directly tested — there the read surfaces as a generic ADT 404 via the normal error path, not
   the friendly hint. No abaplint/DDIC-routing surface is touched, so no per-release write risk.
5. **Sort client-side, cap, no pagination.** `ORDER BY` is unavailable on the freestyle endpoint;
   sort by `FIRSTCALL` desc in JS. Returned set is capped at `maxResults`; when the trace has more
   matching rows the subset is arbitrary — the description tells callers to narrow with filters.
6. **Field values are decoded, not invented.** `FIELDn`→name mapping comes from `TOBJ`; if `TOBJ`
   has no entry for an object (or a `FIELDn` is blank) fall back to the raw `FIELDn=value` /
   omit-blank — never fabricate a field name.

## Development Approach

- **TDD, pure-core first.** Build `decodeAuthTraceRows` (pure: takes raw `SUAUTHVALTRC` rows + a
  `TOBJ` field-name map + options, returns `AuthTraceEntry[]` sorted by `firstSeen` desc) against the
  **real captured rows** in the Verified Live Evidence, before wiring HTTP. Then `getAuthorizationTrace`
  (orchestrates the two `runTableQuery` reads + decode) with `runTableQuery` mocked. Then the handler
  case, then schema/tool/policy, then E2E, then docs.
- **Fixtures = real values.** Use the AUTH_TEST S_TCODE/RC12 row and the S_DEVELOP/S_TCODE `TOBJ`
  field lists from the evidence block verbatim; do not invent trace shapes.
- **Failure paths are mandatory** (see per-task tests): table-absent → hint; empty result → hint;
  `TOBJ` miss → raw fallback; polluted payload (`onlyFailures:"false"` must stay `false`; empty
  `authObject` / irrelevant optionals ignored); unknown `RC` → generic "denied (rc=N)".
- Every code-changing task ends with `npm test`; run `npm run typecheck` + `npm run lint` at the end
  of each code task.
- Skip-policy helpers only (`requireOrSkip`, `expectSapFailureClass`) in live tests — never
  `if (!x) return` or empty `catch {}`.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run validate:policy`

<`validate:policy` (static `scripts/validate-action-policy.ts`, no SAP creds) is REQUIRED here: it is
the bidirectional guard that a new `schemas.ts` action enum value has a matching `ACTION_POLICY` row,
and that a `Query` opType maps to `data`/`sql`/`admin`. `npm test` does NOT run it (no `pretest`
hook). It stays consistent after every task — after Task 1 neither the enum nor the policy has the
action (consistent); after Task 2 both do. Missing this guard is high-risk: `getActionPolicy` returns
`undefined` for an unknown key and the runtime scope check `if (authInfo && policy)` (`dispatch.ts`)
then **fails open** — the action would run with no scope enforcement.>

### Task 1: Types, RC/timestamp helpers, decoder, and `getAuthorizationTrace`

**Files:**
- Modify: `src/adt/types.ts` (add interfaces near the other `*Result` types)
- Modify: `src/adt/diagnostics.ts` (add `AUTH_RC_LABELS`, `parseFirstCallTs`, `decodeAuthTraceRows`, `getAuthorizationTrace`)
- Modify: `tests/unit/adt/diagnostics.test.ts` (new `describe` blocks)

This is the foundation: the pure decode logic + the orchestrator that reads `SUAUTHVALTRC` and
`TOBJ` via the already-gated `client.runTableQuery`. Mirror the `diagnostics.ts` convention of a
data-returning function plus pure helpers (like `getDump`/`parseDumpDetail`). The read is gated by
`runTableQuery`'s `checkOperation(OperationType.Query, …)` — do **not** add a second guard; do not
introduce any free-SQL path.

- [x] Add to `src/adt/types.ts`:
      interface AuthTraceEntry {
        user: string; application: string; authObject: string;
        rc: number; result: string;
        fields: Record<string, string>;          // decoded name→value, blanks omitted
        codeLocation: string;                     // "ABAPPROG:ABAPLINE" (or "" if absent)
        firstSeen: string;                        // ISO 8601 Z, or "" if unparseable
      }
      interface AuthorizationTraceResult {
        trace: string; filters: { user: string | null; authObject: string | null; onlyFailures: boolean };
        count: number; entries: AuthTraceEntry[]; note?: string;
      }
- [x] In `diagnostics.ts` add `const AUTH_RC_LABELS: Record<number,string> = { 0: 'passed', 4: 'No authorization', 12: 'No authorization' }` and a `rcLabel(rc: number): string` returning `AUTH_RC_LABELS[rc]` when present, else `` `denied (rc=${rc})` `` (all non-zero unknowns; rc=0 is always mapped). Label `12` MUST be `'No authorization'` to match the Target-State example JSON and the Task-1 test below (the earlier draft's parenthetical was the outlier).
- [x] Add `parseFirstCallTs(raw: string): string` — parse a `YYYYMMDDHHMMSS` string (e.g. `20260709211048`) to ISO `2026-07-09T21:10:48Z`; return `''` for empty/malformed (wrong length / non-numeric). It is UTC (verified: SU53 21:10:48 UTC == FIRSTCALL 20260709211048).
- [x] Add pure `decodeAuthTraceRows(rows: Record<string,string>[], fieldNames: Record<string, string[]>, opts: { maxResults: number }): AuthTraceEntry[]`:
      for each row → build `fields` by pairing `FIELD1..FIELD9,FIELD0` **in that column order** with `fieldNames[OBJECT][i]` (fall back to the raw column key `FIELD1` when no TOBJ name; skip entries whose value is empty); `rc = Number(row.RC)`; `result = rcLabel(rc)`; `application = row.NAME || row.TYPE`; `codeLocation = row.ABAPPROG ? \`${row.ABAPPROG}:${row.ABAPLINE}\` : ''`; `firstSeen = parseFirstCallTs(row.FIRSTCALL)`. Sort by `firstSeen` **descending** (string compare on ISO is fine; empty sorts last), then `slice(0, maxResults)`. NOTE the SUAUTHVALTRC value column order is `FIELD1..FIELD9` then `FIELD0` (FIELD0 is the 10th) — encode that order explicitly, do not `Object.keys`.
- [x] Add `async getAuthorizationTrace(client: AdtClient, opts: { user?: string; authObject?: string; onlyFailures?: boolean; maxResults?: number }): Promise<AuthorizationTraceResult>` — add the `import type { AdtClient } from './client.js'` from Context (first `diagnostics.ts` fn to take the client). First `const clamped = clampPreviewRows(opts.maxResults)` (import `clampPreviewRows` from `./client.js`; default 100), used for BOTH `runTableQuery`'s `maxRows` AND `decodeAuthTraceRows(..., { maxResults: clamped })` so decode never gets `undefined`. Then
      build a `where: Array<{field,op,value}>` from opts — `user`→`{field:'USERNAME',op:'=',value:user}`, `authObject`→`{field:'OBJECT',op:'=',value:authObject}`, `onlyFailures`→`{field:'RC',op:'<>',value:'0'}`; call
      `client.runTableQuery('SUAUTHVALTRC', { columns: ['USERNAME','NAME','TYPE','OBJECT','RC','FIELD1','FIELD2','FIELD3','FIELD4','FIELD5','FIELD6','FIELD7','FIELD8','FIELD9','FIELD0','ABAPPROG','ABAPLINE','FIRSTCALL'], where, maxRows: clamped })` (`clamped` defined above);
      collect the distinct non-empty `OBJECT`s, and if any, call `client.runTableQuery('TOBJ', { columns: ['OBJCT','FIEL1','FIEL2','FIEL3','FIEL4','FIEL5','FIEL6','FIEL7','FIEL8','FIEL9','FIEL0'], where: [{ field:'OBJCT', op:'IN', value: distinctObjects.join(',') }], maxRows: 200 })` and build `fieldNames[obj] = [FIEL1..FIEL9,FIEL0]` (FIEL0 last, drop trailing empties); pass both to `decodeAuthTraceRows`; return `{ trace, filters, count, entries, note }` where `note` explains empties/caps.
- [x] Regression guard: do **not** change `runTableQuery`, `buildTableQuerySql`, or any existing `diagnostics.ts` export — only add new symbols.
- [x] Add unit tests (~10) in `describe('decodeAuthTraceRows')` and `describe('getAuthorizationTrace')` in `tests/unit/adt/diagnostics.test.ts`:
      - S_TCODE/RC12 row + `{ S_TCODE: ['TCD'] }` → one entry `{ authObject:'S_TCODE', rc:12, result:'No authorization', fields:{TCD:'SU01'}, codeLocation:'LSUSEU11:53', firstSeen:'2026-07-09T21:10:48Z', application:'TR' }` (happy path, real values)
      - S_DEVELOP row with FIELD1..5 = `$TMP,DOMA,ZX,,01` + `{ S_DEVELOP:['DEVCLASS','OBJTYPE','OBJNAME','P_GROUP','ACTVT'] }` → `fields:{DEVCLASS:'$TMP',OBJTYPE:'DOMA',OBJNAME:'ZX',ACTVT:'01'}` (blank P_GROUP omitted; multi-field order)
      - RC='0' → `result:'passed'`; RC='8' (unknown) → `result:'denied (rc=8)'` (failure/negative)
      - `fieldNames` missing the object → fields keyed by raw `FIELD1` etc. (TOBJ-miss fallback)
      - two rows, out-of-order FIRSTCALL → sorted newest-first; `maxResults:1` → only newest returned
      - `getAuthorizationTrace` with `runTableQuery` mocked (return the SUAUTHVALTRC rows then the TOBJ rows in call order): asserts the WHERE built for `onlyFailures:true` includes `RC <> 0`, and that a second TOBJ read happened; and the no-objects case makes only ONE read
- [x] Run `npm test` — all pass. Then `npm run typecheck` && `npm run lint`.

### Task 2: Wire the handler action + three-file schema sync + scope policy

**Files:**
- Modify: `src/handlers/diagnose.ts` (add `case 'authorization_trace'`; extend the "Supported:" list in the `default`)
- Modify: `src/handlers/schemas.ts` (SAPDiagnose action enum + `authObject` + `onlyFailures`)
- Modify: `src/handlers/tools.ts` (SAPDiagnose action enum `:~1133` + param descriptions + Actions/Examples)
- Modify: `src/authz/policy.ts` (add the `SAPDiagnose.authorization_trace` row after `:154`)
- Modify: `tests/unit/handlers/lint-diagnose.test.ts`, `tests/unit/handlers/schemas.test.ts`, `tests/unit/handlers/tools.test.ts`

Wire the Task-1 function to the tool surface. This adds a tool parameter, so **all three of
`tools.ts` (JSON Schema the LLM sees), `schemas.ts` (Zod), and the handler must stay in sync**
(Rule 7). Mirror the existing `case 'sql_trace_state'` (`diagnose.ts:332`) for the handler shape and
`odata_perf`'s policy row for the scope.

- [x] In `src/authz/policy.ts`, after the `SAPDiagnose.odata_perf` line (`:154`), add:
      `'SAPDiagnose.authorization_trace': { scope: 'data', opType: OperationType.Query },`
      (data scope — same as `odata_perf`; `sql` implies `data`, so free-SQL deployments also work).
- [x] In `src/handlers/schemas.ts`, add `'authorization_trace'` to the SAPDiagnose `action` enum (grep the enum containing `'sql_trace_directory'`), and add two optional fields to the SAPDiagnose schema object:
      `authObject: z.string().optional()` and `onlyFailures: looseOptionalBoolean` (NOT `z.coerce.boolean` — #360). Reuse the existing `user` and `maxResults` fields (already on the schema).
- [x] In `src/handlers/tools.ts`, add `'authorization_trace'` to the SAPDiagnose action enum array (ends at `'sql_trace_directory'` `:~1133`); add `authObject` (string — "Filter the authorization trace to one authorization object, e.g. S_TCODE") and `onlyFailures` (boolean — "Only denied checks (RC<>0) — the closest equivalent to SU53's failed-check view") to the SAPDiagnose property list; and add one Actions-list line + one Examples line describing it (mirror `odata_perf`: read-only, on-prem, `SAP_ALLOW_DATA_PREVIEW`-gated, reads the STUSERTRACE trace `SUAUTHVALTRC`, `user`/`authObject`/`onlyFailures` filters). Also touch up the reused `user` and `maxResults` descriptions in tools.ts (they currently say "Filter dumps by SAP user" / "default 50…") to mention this action; note the effective default for this path is 100 (`runTableQuery`→`clampPreviewRows`), not 50.
- [x] In `src/handlers/diagnose.ts`, add before `default` (`:~360`):
      `case 'authorization_trace': { … }` that reads `user`/`authObject` (strings, undefined when empty), `onlyFailures` (`args.onlyFailures === true || String(args.onlyFailures) === 'true'`), `maxResults` (Number, optional); calls `getAuthorizationTrace(client, …)`; wraps in `try/catch`: on `AdtApiError` (import it from `../adt/errors.js` — not currently imported in diagnose.ts) whose message matches `/Cannot find '/i` (table absent; a 403 permission error won't match, so it correctly rethrows as a real error) return `errorResult("Authorization trace not available on this system. It reads the on-prem STUSERTRACE table SUAUTHVALTRC (SAP_BASIS 7.40 SP16+); on ABAP Cloud/Steampunk use the 'Display Authorization Trace' Fiori app. Requires SAP_ALLOW_DATA_PREVIEW.")`; otherwise rethrow. When the result `count === 0`, keep the `note` hint (trace may be off / widen filters). Return `textResult(JSON.stringify(result, null, 2))`.
- [x] Extend the `default` branch "Supported:" list to include `authorization_trace`.
- [x] Tests — handler (`lint-diagnose.test.ts`): with `runTableQuery`/client mocked, `action:'authorization_trace', user:'AUTH_TEST', onlyFailures:true` returns the decoded S_TCODE entry; the table-absent `AdtApiError('… Cannot find \\'SUAUTHVALTRC\\'')` path returns the friendly `errorResult`; `count:0` returns the note. Schema (`schemas.test.ts`): **polluted-payload** — `onlyFailures:"false"` parses to `false` (NOT `true`); `authObject:""` and an irrelevant optional (e.g. `type:"CLAS"`) don't break validation. Tool-def (`tools.test.ts`): update the frozen SAPDiagnose tool-definition snapshot (`vitest -u` then eyeball the diff — only the new action + two params should appear).
- [x] Run `npm test` — all pass. Then `npm run typecheck` && `npm run lint`.

### Task 3: E2E test through the MCP tool surface

**Files:**
- Modify: an existing E2E spec under `tests/e2e/` that covers SAPDiagnose (grep for `SAPDiagnose` in `tests/e2e/`; if none, create `tests/e2e/authorization-trace.e2e.test.ts` following `tests/e2e/helpers.ts` patterns)

Exercise the full MCP JSON-RPC stack for the new action. This is the tier the skill mandates for a
new tool operation. Because the trace is data-dependent (populated only where `auth/auth_user_trace`
was on and a non-SAP_ALL user was denied something), assert on **shape**, not on specific rows, and
use skip-policy for the not-available/empty cases — never assert a failure row exists.

- [x] Add an E2E test using `connectClient()`/`callTool()`/`expectToolSuccess()`: call
      `SAPDiagnose { action: 'authorization_trace', maxResults: 5 }`. Parse the JSON; assert it has
      `trace`, `filters`, `count`, `entries` (array). If the tool returns the "not available" message
      (systems without the table), `requireOrSkip(ctx, false, SkipReason.BACKEND_UNSUPPORTED)` with a
      clear reason — do not fail.
- [x] Add one filtered call `{ action:'authorization_trace', onlyFailures:true, maxResults:5 }` and
      assert every returned entry (if any) has `rc !== 0`; `count === entries.length`.
- [x] Run `npm test` (unit still green). E2E itself runs against a live MCP server:
      `npm run test:e2e` (requires `E2E_MCP_URL` / running server per `INFRASTRUCTURE.md`) — note in
      the task that this is not part of the fast validation gates.

### Task 4: Documentation

**Files:**
- Modify: `docs_page/tools.md` (SAPDiagnose section — action enum ~`:1116`, Actions bullets, Examples)
- Modify: `docs_page/authorization.md` (capability table ~`:91`)
- Modify: `docs_page/roadmap.md` (Runtime Diagnostics rows `:2580` and `:2613`)
- Modify: `docs/compare/00-feature-matrix.md` (section 10 "Diagnostics & Runtime" + "Last updated" line `:5`)
- Modify: `README.md` (SAPDiagnose tools-table row `:95`)
- Modify: `AGENTS.md` (Key Files table — add a row near the ST05/odata_perf rows ~`:194`; optionally extend the `diagnostics.ts` line `:129`)

Docs run after implementation so they describe **as-shipped** behavior. Be explicit about the
constraints: on-prem only, `SAP_ALLOW_DATA_PREVIEW`-gated (not free-SQL), reads STUSERTRACE
(`SUAUTHVALTRC`), records only while `auth/auth_user_trace` is enabled, this is **not** SU53's live
buffer, and there is no in-core way to toggle the trace. Over-promising here creates
false-troubleshooting loops.

- [x] `docs_page/tools.md`: add `authorization_trace` to the SAPDiagnose action enum; add an Actions
      bullet mirroring `odata_perf` (read-only, on-prem, `SAP_ALLOW_DATA_PREVIEW`, reads
      `SUAUTHVALTRC`, `user`/`authObject`/`onlyFailures`); add an example. Mention it in the intro line.
- [x] `docs_page/authorization.md`: add a capability row after the "Preview named table contents"
      row (`:~91`): `| Authorization trace (SUAUTHVALTRC) | data | SAP_ALLOW_DATA_PREVIEW=true | SAPDiagnose action=authorization_trace, on-prem only |`.
- [x] `docs_page/roadmap.md`: append "authorization trace (SUAUTHVALTRC, STUSERTRACE)" to the
      "Runtime Diagnostics" matrix rows at `:2580` and `:2613`.
- [x] `docs/compare/00-feature-matrix.md`: add a row in section 10 (before "ABAP debugger") —
      `| Authorization trace (SUAUTHVALTRC / STUSERTRACE) | ✅ (SAPDiagnose authorization_trace, on-prem, data-preview) | … |` across the competitor columns; bump `_Last updated:_` on `:5`.
- [x] `README.md`: append "authorization trace (SUAUTHVALTRC, on-prem, data-preview gated)" to the
      SAPDiagnose row (`:95`).
- [x] `AGENTS.md`: add a Key Files row mirroring the ST05/odata_perf rows — `| Authorization trace (SAPDiagnose authorization_trace) | src/adt/diagnostics.ts (getAuthorizationTrace/decodeAuthTraceRows), diagnose.ts, {schemas,tools}.ts, policy.ts — data scope + SAP_ALLOW_DATA_PREVIEW, on-prem, reads SUAUTHVALTRC via runTableQuery; TOBJ field-name decode; sorts client-side (freestyle rejects ORDER BY); not SU53/STAUTHTRACE; details docs/research/2026-07-09-su53-authorization-analysis-adt-surface.md |`.
- [x] No changes needed in `docs_page/index.md`, `CLAUDE.md`, or `.claude/commands/*.md` (verified: no SAPDiagnose action enumeration there).
- [x] Run `npm test` (docs-only, but keep the gate green).

### Task 5: Final verification

- [x] `npm test` — all pass
- [x] `npm run typecheck` — no errors
- [x] `npm run lint` — no errors
- [x] `npm run validate:policy` — SAPDiagnose.authorization_trace present in ACTION_POLICY + schema enum, Query→data mapping valid
- [x] `npm run build` && `npm run check:sizes` — bundle builds, file-size ratchet passes
- [x] Live verification on **a4h** (creds in `INFRASTRUCTURE.md`), free-SQL OFF to prove the gate:
      `SAP_ALLOW_FREE_SQL=false SAP_ALLOW_DATA_PREVIEW=true arc1-cli call SAPDiagnose --json '{"action":"authorization_trace","user":"AUTH_TEST","onlyFailures":true}'`
      → expect the S_TCODE/RC12/SU01 entry with `fields:{TCD:"SU01"}`. Also run with
      `SAP_ALLOW_DATA_PREVIEW=false` → expect the scope/safety error (proves the gate). Do not commit throwaway scripts.
- [x] Confirm on **a4h-2025** (816) the action returns `count:0` + the trace-off note (not an error),
      proving the per-release read path. (a4h-2025 may be stopped — see `INFRASTRUCTURE.md`; skip if down.)
- [x] `grep -rn "authorization_trace" src/` — present in `diagnose.ts`, `schemas.ts`, `tools.ts`, `policy.ts`; `grep -rn "getAuthorizationTrace" src/` — defined + called once.
- [x] Move this plan to `docs/plans/completed/`, then fix any relative links inside it (the dossier link gains a `../` level).
