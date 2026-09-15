# SAPDiagnose

Run diagnostics such as ATC, ABAP Unit, short-dump inspection, and quickfix discovery.

```text
SAPDiagnose(action="dumps")
```

Server-side code analysis and runtime diagnostics: syntax check, ABAP unit tests, ATC checks, CDS
test-case scaffolding, active/inactive object state, short dumps (ST22), ABAP profiler trace
arming/list/analysis, SM02 messages, Gateway errors, the on-prem STUSERTRACE authorization trace, an
OData performance probe (`sap-statistics`), CDS Show-SQL, and ST05 trace control.

Multi-target v1 includes `atc` and `unittest` under the existing `read` scope. They do not mutate
repository objects, but they execute SAP workloads and may create transient worklists/results;
administrators can disable them with `SAP_DENY_ACTIONS`.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `action` | string | Yes | `syntax`, `unittest`, `unittest_ci`, `atc`, `atc_ci`, `atc_variants`, `cds_testcases`, `dumps`, `traces`, `trace_start`, `trace_requests`, `trace_cancel`, `system_messages`, `gateway_errors`, `object_state`, `quickfix`, `apply_quickfix`, `odata_perf`, `cds_sql`, `sql_trace_state`, `set_sql_trace_state`, `sql_trace_directory`, or `authorization_trace` |
| `name` | string | No | Object or package name (required for syntax/unittest/object_state/quickfix/apply_quickfix, and atc without objects; the CDS entity / DDLS source name for `cds_testcases` and `cds_sql`) |
| `objects` | array | No | ATC only: 1–20 `{type,name}` entries instead of top-level `name`, `type`, or `url`. Supported: `CLAS`, `INTF`, `PROG`, `FUGR`, `DDLS`, `DCLS`, `BDEF`, `DDLX`, `SRVD`, `SRVB`, `TABL`, `DTEL`, `DOMA`. `TABL` includes tables and structures (`TABL/DT` and `TABL/DS` aliases). Names and type aliases are normalized; duplicates execute once. No package expansion or per-item system selection. `PROG` is on-premises only. |
| `url` | string | No | For `odata_perf`: the host-relative OData path to probe (from the Fiori app's Network tab), e.g. `/sap/opu/odata4/sap/.../Entity?$filter=...`. Must be a path on the SAP system ARC-1 connects to — absolute URLs are rejected. |
| `type` | string | No | Object type. `unittest` supports `CLAS`, `PROG`, `FUGR`, and `DEVC` (package); other actions accept their documented ADT types. |
| `sourceUri` | string | No | Exact ADT source URI for quickfix/apply_quickfix; defaults to the type/name main source. Use it for class-local includes. |
| `version` | string | No | For syntax: `active` (default) or `inactive`. |
| `coverage` | boolean | No | For `unittest`: also return statement/branch/procedure coverage for the object, plus `methodsBelowFull` (methods under 100% statement coverage, worst first), in one extra round-trip. Default false. |
| `includeSubpackages` | boolean | No | For `unittest` with `type="DEVC"`: include the package subtree. Default false selects only objects whose actual package is `name`. Rejected for other types/actions. |
| `resultFormat` | string | No | For `unittest`: `legacy` (default), `structured`, or `junit`; JUnit uses SAP's public asynchronous AUnit endpoint when available and otherwise generates JUnit from the legacy result. For `atc`: `legacy` or `structured`; `junit` is rejected because ATC JUnit output is not implemented. Other actions reject this parameter. Dedicated CLI checks choose their required format automatically. |
| `timeoutSeconds` | number | No | Overall execution/verification budget, `1..3600` seconds. Default `300` for `unittest`/`atc`, `600` for `unittest_ci`/`atc_ci`. Timeout cannot pass. |
| `source` | string | No | Current source code (required for `quickfix` and `apply_quickfix`) |
| `line` | number | No | Source line number (required for `quickfix` and `apply_quickfix`) |
| `column` | number | No | Source column number (optional for `quickfix` and `apply_quickfix`, default `0`) |
| `proposalUri` | string | No | Quickfix proposal URI from `quickfix` response (required for `apply_quickfix`) |
| `proposalUserContent` | string | No | Opaque proposal state from `quickfix` response (required for `apply_quickfix`) |
| `proposalAffectedObjects` | array | No | Optional affected-object rows returned by quickfix. Preserve each URI and include current content when applying a multi-object proposal. |
| `id` | string | No | Dump ID, profiler trace ID, or armed trace-request ID to cancel. Omit for list actions. |
| `detailUrl` | string | No | For Gateway-error detail: canonical host-relative `/sap/bc/adt/gw/errorlog/...` path. Absolute URLs, traversal, encoded separators, and non-canonical encodings are rejected. |
| `errorType` | string | No | Gateway error type required when requesting detail by `id` rather than `detailUrl`, e.g. `Frontend Error`. |
| `user` | string | No | SAP-user filter for dumps, runtime feeds, or `authorization_trace` |
| `authObject` | string | No | For `authorization_trace`: filter to one authorization object, for example `S_TCODE` |
| `from` | string | No | Lower time boundary for `system_messages`/`gateway_errors`. |
| `to` | string | No | Upper time boundary for `system_messages`/`gateway_errors`. |
| `onlyFailures` | boolean | No | For `authorization_trace`: return only denied checks (`RC <> 0`) |
| `maxResults` | number | No | Maximum results (default 50 for dumps/feeds, 100 for `authorization_trace`; safely capped) |
| `sections` | array | No | Dump chapter IDs for detail mode, e.g. `["kap0","kap3","kap8"]`; omit for focused defaults. |
| `includeFullText` | boolean | No | Dump detail only: include the full formatted text blob. Default false to limit tokens. |
| `variant` | string | No | Check variant for `atc`/`atc_ci`; name filter for `atc_variants`. CI names: 1–128 characters; default `ABAP_CLOUD_DEVELOPMENT_DEFAULT`. |
| `packages` | array | No | CI exact packages. Names: 1–40 characters matching `[A-Za-z0-9_/$]+`. Require 1–50 total entries across `packages` and `packageTrees`, before deduplication. |
| `packageTrees` | array | No | CI packages including subpackages; same name and combined-count limits as `packages`. |
| `configuration` | string | No | `atc_ci`: optional ATC configuration name, 1–128 characters. |
| `includeReportXml` | boolean | No | CI actions: include XML reports within a combined 256 KiB cap. Default false. |
| `failOnSeverity` | string | No | `atc_ci`: fail at `error` (default), `warning`, or `info`, including all higher severities. |
| `sqlOn` | boolean | No | For `set_sql_trace_state`: `true` arms the ST05 SQL trace, `false` disarms it (combine with `user` to filter to one SAP user) |
| `analysis` | string | No | For trace detail: `hitlist`, `statements`, or `dbAccesses` |
| `traceUser` | string | No | For `trace_start`/`trace_requests`: SAP user whose matching execution is traced/listed; defaults to the connected user. |
| `processType` | string | No | For `trace_start`: `any`, `http` (default), `dialog`, `batch`, or `rfc`. |
| `objectType` | string | No | For `trace_start`: `any`, `url`, `transaction`, `report`, or `functionModule`; inferred from `processType` when omitted. |
| `maxExecutions` | number | No | For `trace_start`: number of matching executions to capture (default 1). |
| `expiresHours` | number | No | For `trace_start`: hours until the armed request expires (default 24). |
| `sqlTrace` | boolean | No | For `trace_start`: capture SQL/DB accesses (default true; needed for `dbAccesses` analysis). |
| `aggregate` | boolean | No | For `trace_start`: aggregate the captured trace (default true). |
| `description` | string | No | Optional label for an armed trace request. |

## Actions

### `syntax`

Run SAP syntax check on an object. Returns errors/warnings with line, column, and message. Uses stored active source by default. Pass `version="inactive"` to check a saved draft before activation. It does not accept proposed source in place of the stored object.

### `unittest`

Run tests for a `CLAS`, `PROG`, `FUGR`, or `DEVC` package. Tests are fixed to **harmless** risk;
dangerous and critical tests are disabled, while all duration categories remain eligible.

```text
SAPDiagnose(action="unittest", type="CLAS", name="ZCL_ORDER", resultFormat="structured")
```

- **Scope:** packages are exact by default; `includeSubpackages=true` includes the subtree. Native
  JUnit uses SAP's package object set; legacy, coverage, and corroboration runs use resolved roots.
- **Completeness:** ARC-1 checks package membership and active source before and after the run.
  Changed or unreadable source, invalid URIs, the 1,000-row package-search bound, and risk refusals
  remain incomplete evidence. They are not passing tests.
- **Output:** per-class/method status, alerts, and duration. `resultFormat="structured"` exposes
  outcome/completeness; `junit` uses native or generated JUnit and reconciles native results with a
  harmless legacy run so missing risk alerts cannot imply success.
- **Coverage:** `coverage=true` adds a SAP round-trip and returns `{tests, coverage}`. Statement,
  branch, and procedure metrics each contain `{executed, total, percent}`. `methodsBelowFull` lists
  methods below full statement coverage, worst first. An unavailable endpoint retains test results
  with a `coverageNote`.

### `atc`

Run ABAP Test Cockpit checks and inspect completeness before evaluating findings:

```text
SAPDiagnose(action="atc", type="CLAS", name="ZCL_ORDER", resultFormat="structured")
```

Findings contain priority, check title, message, source URI, line, and quickfix metadata
(`quickfixInfo`, `hasQuickfix`). Omit `variant` to bind SAP's configured default; the literal variant
`DEFAULT` can be different. Unknown names are rejected rather than silently substituted.

#### Variant evidence

| `variantSource` | Meaning |
|---|---|
| `requested` | The requested variant was verified |
| `systemDefault` | ARC-1 used `systemCheckVariant` from customizing |
| `sapFallback` | Customizing was unavailable; SAP supplied the fallback |
| `requestedUnverified` | A variant was requested, but listing failed and ARC-1 could not verify it |

#### Completion evidence

On asynchronous systems, ARC-1 follows a validated status location until `Completed`; unknown
non-failure states keep polling. Older systems require a ten-second quiet interval over the full
worklist, excluding the volatile root timestamp. Unsafe/missing asynchronous locations leave the
result incomplete even if findings were recovered. Failure/deadline paths make a best-effort final
worklist read.

| Field | Meaning |
|---|---|
| `completionEvidence` | `asyncRunCompleted` or `legacyWorklistSettled` for successful lifecycle verification |
| `runStatus` | Observed SAP run state |
| `findingStatistics` | Informational `errors`, `warnings`, `infos`, `total`; may be null |
| `runInfos` | Informational run messages; may be empty |
| `expectedFindingCount` | Deprecated alias of `findingStatistics.total`; does not establish completeness |
| `truncated` | Compatibility field; false until SAP provides a reliable truncation signal |

Missing/false object-set completeness, zero processed objects, malformed evidence, cancellation,
timeouts, or an unsettled worklist cannot pass. Default output contains `findings`, `variant`, and
`variantSource`; incomplete default results are tool errors that still carry recovered findings.
Structured callers must check completeness explicitly. Empty HTTP 201 run bodies do not provide
finding statistics.

### ATC object batches

Pass 1–20 `objects` for one native worklist. The limit applies **before** deduplication; divide
larger selections explicitly. Supported types are listed in the parameter table. DDIC `TABL`,
`DTEL`, and `DOMA` use R3TR identities and need no editor/subtype lookup. `FUNC` and `INCL` are
outside this batch contract; `DEVC` uses the single/package call.

If a completed run omits selected objects, ARC-1 attempts one additional batch containing only
those objects, with the same confirmed variant, SAP identity, and original timeout. It skips this
step for failed, malformed, timed-out, or unverified-variant runs, or when too little time remains
for legacy settlement. Initial findings survive a failed verification. There are no per-object
retries or automatic chunks.

| Batch field | Meaning |
|---|---|
| `complete` | Must be true before treating the batch as evaluable |
| `coverage` | Ordered entries with canonical `type`, `name`, input `uri`, `status` (`reported`/`notReported`), nullable `findingCount`, and `worklistId` |
| `findings` | Flat findings with owning `object` and `worklistId`; `uri` remains the actual source location |
| `runs` | Evidence per run; totals describe the complete returned worklist |
| `excludedFindingCount` | Findings actually excluded from a run's batch contribution |
| `requestedObjectCount` | Includes duplicate input entries |
| `uniqueObjectCount`, `reportedObjectCount` | Deduplicated counts |
| `verificationAttempted` | Whether the second batch ran |

Missing records remain unknown. Zero findings requires a unique object record in a complete run.
Findings for other supported roots, including repeated first-run objects, are excluded from that
run's batch contribution. Unqualified child identities may belong to a selected container: their
findings are retained, with incomplete results and unknown coverage counts. ARC-1 does not guess
parentage. Unassigned, unowned, or contradictory evidence also remains incomplete.

Keep source stable while checking: two runs are separate observations, not an atomic snapshot.
Default/legacy incomplete batches return a tool error. The generic CLI accepts the same input:
`arc1 call SAPDiagnose --json batch.json`.

### CI package checks

Use `atc_ci` or `unittest_ci` for explicit package selections on a **single target**. Both verify
package access before execution and share one overall deadline. Names are uppercased and
deduplicated; `packageTrees` takes precedence when the same name appears in both lists.
Software-component selection and multi-target mode are unsupported.

Require a successful tool response with `status="completed"` and `fail=false`. A tool error,
`status="incomplete"`, or `fail=true` cannot pass. The [CLI](../cli-guide.md#output-and-exit-codes)
applies this rule automatically to these two actions.

`includeReportXml=true` adds `reportXml` for ATC or `results[].reportXml` for Unit, up to **256 KiB
combined**. Larger reports carry `reportXmlOmitted`; available result paths remain in the response.
Without this option, XML is omitted.

These actions use the configured SAP identity and normal authentication, discovery and CSRF.
They require their CI API plus ordinary ADT package/source access. BTP may require `SAP_COM_0901`
for ATC or `SAP_COM_0735` for Unit; communication-arrangement completion has not been verified for
this implementation. API reachability alone does not prove a background job can start.

### `unittest_ci`

Run harmless-only package tests across all duration categories through native AUnit, with legacy
and active-source reconciliation:

```text
SAPDiagnose(action="unittest_ci", packages=["ZORDER"], includeReportXml=true)
```

Empty, all-skipped, omitted-test or otherwise incomplete evidence returns `status="incomplete"`
and `fail=true`. Test failures also set `fail=true`. There are no risky-test or failure-bypass
options. After a package execution/protocol failure, earlier evidence is retained and remaining
packages are marked unattempted.

| Result field | Meaning |
|---|---|
| `status`, `fail` | Overall completion and quality-gate outcome |
| `summary` | Totals: `tests`, `failures`, `errors`, `skipped` |
| `selectedPackages`, `processedPackages` | Counts of normalized selections and packages with result counters |
| `durationMs` | Overall elapsed time |
| `results[]` | Per-package `name`, `includeSubpackages`, `outcome` (`passed`, `failed`, `incomplete`), and available `summary`, `incompleteReason`, `runPath`, `resultPath` |
| `results[].sourceSelection` | Reconciliation `status` and count of `omittedTestClasses`, when available |
| `results[].attempted` | Present on execution errors or unattempted packages |

### `atc_ci`

Run the package ATC CI API (`/sap/bc/adt/api/atc/runs`):

```text
SAPDiagnose(action="atc_ci", packages=["ZORDER"], failOnSeverity="error", timeoutSeconds=600)
```

The default variant is `ABAP_CLOUD_DEVELOPMENT_DEFAULT`; choose one available on the target.
Every selection must be verified and nonempty before the run starts. A completed, valid empty
Checkstyle report can then pass. All findings count toward `failOnSeverity`, even when the returned
list is truncated. Reports above the 2 MiB parsing limit are incomplete.

| Result field | Meaning |
|---|---|
| `status`, `fail` | Overall completion and quality-gate outcome |
| `durationMs`, `runPath`, `resultPath` | Elapsed time and available SAP run/report paths |
| `summary` | `findingCount`, `errorCount`, `warningCount`, `infoCount` across the full report |
| `findings` | Up to 200 rows with `file`, `message`, `source`, `severity`, and optional `line` |
| `truncated` | More than 200 findings exist; the full set still determines the gate |
| `incompleteReason`, `lastStatus`, `progress` | Available evidence for an incomplete run |

A local deadline or cancellation may leave a SAP job running. Inspect the returned `runPath` and
last status/progress before starting another run.

### `atc_variants`

List the ATC check variants this system offers, plus the system default variant (the one `atc` binds when no `variant` is passed). Read-only. The `variant` parameter doubles as an optional name filter (`*` = all; e.g. `variant="ABAP_CLOUD*"`). Returns `{ systemDefault, filter, count, variants: [{ name, description }] }`. Use it to discover the exact `variant` string to pass to `action="atc"`.

### `cds_testcases`

Get SAP-suggested ABAP Unit test cases for a CDS entity (CDS Test Double Framework). Requires `name` (the CDS entity / DDLS source name; no `type`). Returns one suggestion per testable semantic — the whole view (`semanticType: "NONE"`), each calculated field (`"CALCULATION"` + `calculatedField`), and `"CAST"`/`"JOIN"`/`"CASE"` expressions — each with a suggested `testMethod` name + `description`, plus a `hint` for scaffolding a `cl_cds_test_environment` test class. **Read-only.** Available on **SAP_BASIS 8.16+ (ABAP Platform 2025 / S/4HANA 2025)** only — discovery-gated, so older releases return a clear "needs 8.16+" message. The AI-backed test-data / test-method *generation* (Joule for Developers) is intentionally **not** exposed.

### `object_state`

Compare active and inactive source versions for one object. For `CLAS`, ARC-1 checks main, definitions, implementations, macros, and testclasses includes (up to 10 parallel reads per class; sequence calls when sweeping many classes). Returns ETags, byte lengths, SHA-256 hashes, and divergence flags without returning full source. Useful for diagnosing activation failures where active and inactive class includes disagree.

### `quickfix`

Get SAP quickfix proposals for a specific source position (`name`, `type`, `source`, `line`, optional `column`). Returns proposal entries with `uri`, `type`, `name`, `description`, `userContent`.

### `apply_quickfix`

Apply one proposal (`proposalUri` + `proposalUserContent`) and return text deltas (range + replacement content). This does not write source; use `SAPWrite` to persist.

### `dumps`

List short dumps (ST22). Without `id`: returns recent dumps (filterable by `user`, `maxResults`). With `id`: returns full dump detail including error type, exception, program, stack trace, and formatted output.

### `traces`

List ABAP profiler traces. Without `id`: returns trace list. With `id` + `analysis`: returns trace analysis (`hitlist` = call hierarchy with hit counts and timings, `statements` = executed statements, `dbAccesses` = database access details).

### `trace_start`

Arm an ABAP profiler request for the next matching execution. Defaults to the next HTTP request by the connected user, with SQL capture on. This changes SAP trace-request state and needs `write` scope plus `SAP_ALLOW_WRITES=true`; reproduce the workload, then read it through `traces`.

### `trace_requests`

List armed profiler requests, optionally filtered by `traceUser`. Read-only.

### `trace_cancel`

Cancel one armed profiler request by `id`. Mutating; needs `write` scope plus `SAP_ALLOW_WRITES=true`.

### `system_messages`

List SM02 system messages, with optional `from`/`to`, `user`, and `maxResults` feed filters. Read-only.

### `gateway_errors`

List on-prem `/IWFND/ERROR_LOG` entries; request detail with the returned canonical `detailUrl`, or with `id` plus `errorType`. Read-only.

### `odata_perf`

Diagnose *why* a Fiori/OData request is slow. Pass `url` (the host-relative OData path from the app's Network tab); ARC-1 GETs it with `?sap-statistics=true` and a wall-clock timer, then returns the server-side timing split (`gwtotal`, `gwapp`, `gwappdb` = DB time, `gwfw`/`gwhub` = framework, `icfauth` = auth) plus a `verdict` routing you to the dominant cost (`db` → check the CDS query / `cds_sql` / ST05; `app` → ABAP profiler `traces`; `framework` → metadata/first-call; `auth` → ICF/DCL). Read-only GET; gated like data preview (`SAP_ALLOW_DATA_PREVIEW`). The OData service must be on the same SAP host ARC-1 connects to. Older releases (e.g. NW 7.50) may report only a `gwhub` total without a per-component split → the verdict says so rather than guessing.

### `authorization_trace`

Read persisted on-prem STUSERTRACE entries from `SUAUTHVALTRC`, decoded using `TOBJ`. The response
contains user, application, authorization object, result code, checked fields, code location, and
first-seen timestamp. Filter with `user`, `authObject`, `onlyFailures`, and `maxResults`; entries are
newest-first within the capped result.

Requires `data` scope, `SAP_ALLOW_DATA_PREVIEW=true`, and SAP table-read authorization for both
tables. Free SQL is not required. This reads persisted trace rows, not SU53's live failure buffer.
`traceState.status="unknown"` means existing rows do not prove tracing is currently active.

ARC-1 cannot change `auth/auth_user_trace`. An administrator can inspect it in RZ11:

| Value | Behavior |
|---|---|
| `N` | Inactive |
| `F` | Record configured STUSERTRACE filters; at least one filter is required |
| `Y` | Record all users/application types |

Dynamic RZ11 changes last until restart. **Change on All Servers** applies to all instances;
persistent configuration belongs in the approved Basis `DEFAULT.PFL` workflow. Empty results
include this activation guidance. ABAP Cloud users use the *Display Authorization Trace* Fiori app.

### `cds_sql`

Show the native SQL a CDS view compiles to (ADT "Show SQL Create Statement"). Pass `name` (the CDS DDL source / DDLS, e.g. `I_CURRENCY`). Returns the `CREATE VIEW` statement(s) — the joins/scans behind a slow entity. Read-only. Verified on NW 7.50, S/4HANA 2023 (758), and ABAP Platform 2025 (816); on 7.50 the statement is a classic DB `VIEW`.

### `sql_trace_state`

Read the current ST05 trace state (SQL/buffer/enqueue/RFC/HTTP/APC/AMC/auth on-off per application server, plus the active filter). Read-only.

### `set_sql_trace_state`

Arm or disarm the ST05 SQL trace. Requires `sqlOn` (`true` = arm, `false` = disarm); optional `user` filters the trace to one SAP user. Mutates server trace state → needs `SAP_ALLOW_WRITES`. Workflow: arm → reproduce the slow request → `sql_trace_directory` for the record-viewer link.

### `sql_trace_directory`

Return where the recorded SQL is read. ADT has no SQL-record endpoint; SAP answers `/st05/trace/directory` with the **Technical Monitoring Cockpit "SQL Trace Analysis" deep-link** — ARC-1 returns that URL (open it in a browser; needs the `/sap/bc/stmc` SICF service active). Read-only.

## Examples

```
SAPDiagnose(action="syntax", type="CLAS", name="ZCL_ORDER")
SAPDiagnose(action="unittest", type="CLAS", name="ZCL_ORDER")
SAPDiagnose(action="unittest", type="CLAS", name="ZCL_ORDER", coverage=true, resultFormat="structured")
SAPDiagnose(action="unittest", type="DEVC", name="ZORDER", resultFormat="structured")
SAPDiagnose(action="unittest", type="DEVC", name="ZORDER", includeSubpackages=true, resultFormat="junit")
SAPDiagnose(action="atc", type="PROG", name="ZTEST_REPORT", variant="DEFAULT", resultFormat="structured")
SAPDiagnose(action="atc", objects=[{type:"CLAS",name:"ZCL_ORDER"},{type:"INTF",name:"ZIF_ORDER"}])
// DDIC selection example: choose an applicable variant and inspect complete/coverage; omitted objects stay unknown.
SAPDiagnose(action="atc", objects=[{type:"TABL",name:"ZORDER"},{type:"DTEL",name:"ZORDER_ID"},{type:"DOMA",name:"ZORDER_ID"}], resultFormat="structured")
SAPDiagnose(action="cds_testcases", name="I_CURRENCY")              — SAP-suggested unit-test cases for a CDS view (8.16+)
SAPDiagnose(action="object_state", type="CLAS", name="ZBP_DM_PROJECT")
SAPDiagnose(action="quickfix", type="CLAS", name="ZCL_ORDER", source="<current_source>", line=42, column=1)
SAPDiagnose(action="apply_quickfix", type="CLAS", name="ZCL_ORDER", source="<current_source>", line=42, column=1, proposalUri="/sap/bc/adt/quickfixes/...", proposalUserContent="<opaque_state>")
SAPDiagnose(action="dumps")
SAPDiagnose(action="dumps", user="DEVELOPER", maxResults=10)
SAPDiagnose(action="dumps", id="20260409_123456_DUMP_ID")
SAPDiagnose(action="traces")
SAPDiagnose(action="traces", id="TRACE123", analysis="hitlist")
SAPDiagnose(action="traces", id="TRACE123", analysis="dbAccesses")
SAPDiagnose(action="trace_start", processType="http", objectType="url", maxExecutions=1, description="Reproduce slow OData")
SAPDiagnose(action="trace_requests", traceUser="DEVELOPER")
SAPDiagnose(action="trace_cancel", id="REQUEST123")
SAPDiagnose(action="system_messages", maxResults=20)
SAPDiagnose(action="gateway_errors", maxResults=20)
SAPDiagnose(action="odata_perf", url="/sap/opu/odata4/sap/zui_mup/.../SerialNumbers?$filter=...")  — where did the time go (DB vs ABAP vs framework)
SAPDiagnose(action="authorization_trace", user="AUTH_TEST", onlyFailures=true, maxResults=20) — denied STUSERTRACE checks (on-prem; data-preview gated)
SAPDiagnose(action="cds_sql", name="I_CURRENCY")                    — the native SQL CREATE VIEW behind a CDS entity
SAPDiagnose(action="sql_trace_state")                               — is the ST05 SQL trace on? for whom?
SAPDiagnose(action="set_sql_trace_state", sqlOn=true, user="DEVELOPER") — arm the SQL trace for one user (needs SAP_ALLOW_WRITES)
SAPDiagnose(action="sql_trace_directory")                           — get SAP's SQL Trace Analysis deep-link to read the records
```

## Quickfix Workflow

1. Run `SAPDiagnose(action="atc" ...)` or `SAPDiagnose(action="syntax" ...)`.
2. Check ATC findings for `hasQuickfix: true`.
3. Call `SAPDiagnose(action="quickfix", ...)` for the relevant line/column.
4. Select a proposal and call `SAPDiagnose(action="apply_quickfix", ...)` to receive deltas.
5. Apply those deltas to source and persist via `SAPWrite(action="update" | "edit_method", ...)`.

[All tools](../tools.md)
