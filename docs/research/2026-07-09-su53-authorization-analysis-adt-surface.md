# SU53 / deep-roles access analysis — is it reachable via ADT?

**Date:** 2026-07-09
**Question:** Can ARC-1 give "SU53 / deep roles access analysis" (which authorization a user is
missing) through the ADT REST surface it already reaches, before we resort to manual GUI/Fiori
traffic inspection and tracing?

**Verdict: NO.** Neither SU53 (last-failed-auth-check buffer) nor STAUTHTRACE (authorization
trace) is exposed on any ADT surface on 7.50 / 7.58 / 8.16. The auth-related ADT endpoints that DO
exist are **design-time** (define auth objects/fields/SU24 defaults), not **runtime** introspection
of a user's failed checks. Runtime SU53/STAUTHTRACE data would require a Z-wrapper or manual
traffic capture — that's the deciding fact for whether the "manual inspection + tracing" step is
even needed.

---

## What SU53 / STAUTHTRACE actually are (SAP Notes + Help, verified)

- **SU53** = "display the **last failed** authorization checks of a **user**" — reads the kernel
  auth buffer (tables `USRBF`/`USRBF2`; FM behind it `SUSR_SHOW_LAST_AUTH_CHECK`, modern
  `cl_susr_basic_tools=>auth_check`). Reactive, one snapshot per user. Notes: 3025100 (search help
  for users with auth errors), 968915 (revision of SU53/SU56), 181353 (USRBF buffer), 1671117.
- **STAUTHTRACE** = system trace that records **all** authorization checks (not just failed) for
  selected users; the modern replacement for ST01's auth trace, and the tool SAP itself recommends
  for "analyze missing authorizations / build a role from a trace" (Help: *Using the System Trace
  to Record Authorization Checks*; datasphere KBA 4518522125 "How to check STAUTHTRACE, SU53 and
  SLG1"). Kernel trace (function group `SUST` / `RSAUTRACE`).
- Both are **Dynpro transactions only**. No SAP Note or Help page documents a REST/OData/ADT API
  for either. BTP/Steampunk exposes a Fiori **"Display Authorization Trace"** app (business-user
  auth trace) — a UI app, not a documented public API.

## ADT surface — evidence it is NOT there

Live `GET /sap/bc/adt/discovery` on **a4h 7.58** (MARIAN) → HTTP 200, **1342 collections**. Grep for
`auth|security|role|user|trace|su53`: only the endpoints below. No `su53`, `authcheck`,
`lastauthcheck`, or `authorizationtrace` collection anywhere.

Guessed SU53-style paths all 404 on 7.58:
`/sap/bc/adt/su53`, `/sap/bc/adt/runtime/authcheck`, `/sap/bc/adt/aps/iam/auth/trace`,
`/sap/bc/adt/authorizationtrace`, `/sap/bc/adt/system/users/MARIAN/authorizations`.

Cross-checked in read-only reference sources — **all negative** for SU53/auth-trace:
- `~/DEV/arc-1-eclipse-adt` (SAP's ADT apidoc + endpoint contracts): only `S_ADT_RES`/`S_DEVELOP`
  as ADT's *own* access-control objects, RAP-BDEF "authorization", and OAuth noise.
- `~/DEV/arc-1-lsp` (SAP's own ADT language server) + `~/DEV/mcp-abap-adt`, `~/DEV/mcp-abap-adt-fr0ster`:
  no code calls any auth-check/auth-trace endpoint. (fr0ster ships a *captured* discovery doc that
  enumerates the same `aps/iam/*` design-time tooling below — confirming those exist, not SU53.)

## What ADT DOES expose (a4h 7.58, live `GET` verified) — design-time only

**Authorization *modeling* tooling (`/sap/bc/adt/aps/iam/*`)** — the ABAP-Cloud "IAM" developer
surface, media type `application/vnd.sap.adt.blues.v1+xml`:
- `.../aps/iam/auth` — **Authorization Field** (SU20-ish): value helps for data element / check
  table / auth field; field-name validation.
- `.../aps/iam/sush` — **Authorization Default Values** (SU22/SU24): `su22authobject/values`,
  `su22authfield/values`, `su22authobject/detail` (`…sush.authobjdetail+xml`), `su22newobject/values`,
  `sush/synchronize`, application-type / proposal-status / check-indicator value helps.
  (`su22authobject/values` returned `totalItemCount=0` here — value-help, needs query context.)
- `.../aps/iam/suso` — **Authorization Object** (SU21): object-class list, auth fields, activities,
  `su22tracelevel/values`, criticality, privileged-BDEF-mode / own-context usage, search help.

These answer *"what authorizations does this object/app require"* — **not** *"what does user X
lack at runtime."*

**Trace subsystems — none traces authorization:**
- `/sap/bc/adt/crosstrace/*` — **ABAP Cross Trace**. Live: `request_types` = T Transaction / C RFC /
  U URL / S Submit Report / B Batch Job / V Update task / I Unknown / O OData V2 / 4 OData V4 /
  D Daemon; `components` = 32, **zero** auth/role/security. It's a request-flow/perf trace, not an
  auth trace.
- `/sap/bc/adt/st05/trace/{state,directory}` — ST05 performance trace (SQL/RFC/HTTP/enqueue). ARC-1
  already wires `state`/`directory` (`SAPDiagnose sql_trace_state`).
- `/sap/bc/adt/runtime/traces/abaptraces/*` — ABAP profiler/runtime (SAT/SE30). Performance.
- `/sap/bc/adt/runtime/workprocesses` — SM50 list.

**`/sap/bc/adt/system/users`** — user *list* only (id + full name; live returned MARIAN, DEVELOPER,
DDIC, …). No roles, no authorizations.

## Per-release

| Surface | NPL 7.50 | a4h 7.58 | a4h-2025 8.16 |
|---|---|---|---|
| `aps/iam/*` design-time auth tooling | **absent** (probe: AUTH unavailable-high) | present (live) | present (2025 probe: AUTH available) |
| `crosstrace/*`, `system/users` | not verified this pass | present (live) | likely (352-collection discovery) |
| SU53 / STAUTHTRACE via ADT | none | **none** | none (nothing su53/authtrace in 352 collections) |

## UPDATE (same day): the auth trace is a readable DB table — NO traffic capture needed

Decision was to pursue the auth trace via "manual traffic capture of the Fiori Display Authorization
Trace app / STUSERTRACE." Live investigation shows that's unnecessary **on-prem**: the trace is a
plain DB table.

**Trace family (Note 2220030 + S/4 Help "Trace for Authorization Checks"):** all Dynpro + DB, no
public API.
- **STUSOBTRACE** — long-term, cross-client, user-*independent*; feeds SU22/SU24 default maintenance.
- **STAUTHTRACE / ST01** — short-term, in-memory ring buffer, current app server only.
- **STUSERTRACE** — long-term, client- + user-specific; enabled by profile param
  `auth/auth_user_trace` (dynamic); gated by `S_ADMI_FCD` (STUF=change filter, STUR=evaluate);
  since SAP_BASIS 7.40 SP16.

**Persistence tables (live HANA catalog on a4h, SAPA4H schema):**
| Table | Rows (a4h, 2026-07-09) | What |
|---|---|---|
| `SUAUTHVALTRC` | **147,838** | STUSERTRACE — per-user auth-check trace |
| `USOB_AUTHVALTRC` | 3,904 | STUSOBTRACE — object/SU24 default trace |
| `USKRIA` / `USKRIAT` | 0 | SU24 check-indicator (empty here) |
| `RSSBAUTHTRACE` | 0 | BW auth trace (empty) |

**`SUAUTHVALTRC` columns** = exactly the deep-roles payload:
`MANDT, NAME+TYPE` (application), `USERNAME`, `HASH`, `OBJECT` (auth object, e.g. `S_DEVELOP`),
`FORUSER`, **`RC`** (0=passed, ≠0=failed — the SU53 signal), `REASON1..5`, `CDS`, `FIELD1..FIELD0`
(the 10 checked auth-field values), `ABAPPROG`+`ABAPLINE` (code location), `FIRSTCALL` (ts
YYYYMMDDHHMMSS), `ADDINFO`. Sample rows are ARC-1's own `S_DEVELOP` create-checks (RC=0, $TMP / DOMA
/ ZARC1_… / ACTVT 01).

**Live validation via ARC-1 (built dist CLI, `call SAPQuery --json`, a4h client 001, 2026-07-09):**
- `SELECT ... FROM suauthvaltrc WHERE rc <> 0` → correct columns, **0 rows** (a4h only traced
  *passed* checks — not a tool limit).
- `SELECT rc, COUNT(*) GROUP BY rc` → RC 0 = **147,809** (all passed).
- `COUNT(*), COUNT(DISTINCT object), COUNT(DISTINCT username)` → **147,809 rows / 56 auth objects /
  6 users**.
- `GROUP BY object ORDER BY cnt DESC` → S_DEVELOP(89048), S_DATASET(42601), S_ADT_RES(13087),
  S_WDR_ADM, S_TABU_NAM, S_TCODE, S_TRANSPRT, S_USER_GRP, S_BTCH_*, S_ADMI_FCD, …
- **Real failure captured end-to-end (2026-07-09):** with `auth/auth_user_trace=y`, a restricted
  user `AUTH_TEST` was denied tcode SU01 (SU53 showed S_TCODE / TCD=SU01 / RC12). ARC-1
  `TABLE_QUERY SUAUTHVALTRC WHERE username='AUTH_TEST' AND rc<>0` returned exactly that row:
  `OBJECT=S_TCODE, RC=12, FIELD1=SU01, ABAPPROG=LSUSEU11:53, FIRSTCALL=20260709211048` (=SU53's
  21:10:48 UTC). Note `FIELD1` holds the *value* (SU01); SU53's *field name* (TCD) needs the object
  decode (deferred). MARIAN + DEVELOPER are both SAP_ALL → they never fail a check (why the other
  147,809 rows are all RC=0); only a non-SAP_ALL user produces `rc<>0` data.
- **Conclusion: ARC-1 already surfaces the full auth-trace profile today** (per-user × per-object ×
  RC, with field values + code location), via generic `SAPQuery`. Aggregations (GROUP BY, COUNT
  DISTINCT) work through the freestyle endpoint. No new code, no traffic capture. To see *denials*,
  trace a system where a denied check actually ran while `auth/auth_user_trace` was on.

**Consequences:**
- This is **better than SU53** for analysis: SU53 = only the *last failed* check for a user;
  `SUAUTHVALTRC` = *every distinct* check per user with RC + field values + code location, persisted.
- Read it **today** with ARC-1 `SAPQuery` (free-SQL) or `SAPRead TABLE_CONTENTS` (`data`/`sql` scope) —
  e.g. `SELECT username, object, rc, field1..field0, abapprog, firstcall FROM suauthvaltrc WHERE rc <> 0`.
- **No OData / ADT / traffic** involved on-prem. The Fiori "Display Authorization Trace" app is a UI
  over this same data and is **BTP-only** — its V4 service group `UI_AUTHORIZATION_TRACE` returns
  *"Service group not published"* on a4h; all guessed V2 service names 403; the V2 catalog has no
  auth-trace service. Traffic capture is therefore only meaningful **on BTP/Steampunk**, where the
  table isn't directly readable and the app's V4 XHRs would be the only surface.
- Caveat: STUSERTRACE only records while `auth/auth_user_trace` is enabled + a filter is set; a4h
  happens to have accumulated data. A clean system reads empty until the trace is switched on.

## SU53 is NOT the trace — different stores (matters for tool honesty)

An auth admin treats these as **four distinct tools**; the ARC-1 read maps to STUSERTRACE only.

| Admin tool | Input | Output | Store | ARC-1 |
|---|---|---|---|---|
| **SU53** (Evaluate Auth Check) | user | THE last failed check + the auth the user *holds* for it | app-server **shared memory** (≤100/work-proc, ~last 3h), snapshot table `USR07` written *only when SU53 is run* | ✗ (memory/FM; `USR07` empty=0 rows on a4h) |
| **STAUTHTRACE / ST01** | activate + user filter | live chronological checks, current server | **in-memory** | ✗ |
| **STUSERTRACE** | `auth/auth_user_trace` on + filter | every distinct check per user, first-ts, RC, values, program | DB `SUAUTHVALTRC` | ✓ **the tool** |
| **STUSOBTRACE** | activate | cross-user per-app (SU24 defaults) | DB `USOB_AUTHVALTRC` | ✓ (v2 scope=object) |

**SU53 data location (verified):** Note 1671117 — "100 last failed checks … on the current
application server" = shared memory, not persisted. Read only via kernel/FM
`SUSR_ANALYSE_LAST_AUTH_CHECK` / `SUSR_SHOW_LAST_AUTH_CHECK`. It *snapshots* to table **`USR07`**
(cols `BNAME, TIMESTAMP, OBJCT, FIEL1..0, VAL01..`) but only when a user runs SU53 (a4h: 0 rows).
`USRBF2` (16,845 rows) is the user *authorization buffer* — what a user **holds**, the "you have"
side SU53 shows — encoded, not the failed-check list.

**So: the trace does NOT include SU53.** Overlap is partial — `SUAUTHVALTRC WHERE rc<>0` shows denied
checks *only if the long-term trace was running*, deduped to first-occurrence, without the held-auth
comparison. True SU53 ("the last denial for user X right now + what they hold") needs an FM/RFC =
custom code. Therefore name the tool **`authorization_trace` (STUSERTRACE)**, never "SU53"; document
that `only_failures` = denied checks *from the trace* (trace must be active), the closest in-core
equivalent, not SU53's live buffer.

## Options for "deep roles access analysis" (if we want it)

- **A. Z-wrapper** — FEAT-61 plugin console class (`ctx.run.classRun`) or a custom ICF/RFC service
  around `SUSR_SHOW_LAST_AUTH_CHECK` (SU53) or the STUSERTRACE/auth-trace record tables. Reachable
  via the plugin *execute* gate (`SAP_ALLOW_PLUGIN_EXECUTE` + write scope). Only ADT-adjacent path
  to true runtime data.
- **B. SAPQuery free-SQL** on role/auth tables (`AGR_USERS`, `AGR_1251`, `USOBT_C`, `USR12`, …) —
  static "who has what" analysis; needs `data`/`sql` scope + free SQL. Not runtime failures.
- **C. Design-time `aps/iam/*` ADT endpoints** (above) — "what auth a given object/app requires."
  Already reachable, read-only, no new backend code.
- **D. Manual traffic capture** of the Fiori "Display Authorization Trace" app / STUSERTRACE OData —
  the explicitly-deferred next step; only worth it to reach true SU53/STAUTHTRACE runtime data that
  A can't get more cheaply.

## Commands run (repro)

```bash
B=https://a4h.marianzeis.de:50001; A='MARIAN:<pw>'
curl -sk -u "$A" "$B/sap/bc/adt/discovery"                              # 1342 collections
curl -sk -u "$A" "$B/sap/bc/adt/crosstrace/request_types"              # 10 entry-point kinds, no auth
curl -sk -u "$A" "$B/sap/bc/adt/crosstrace/components"                 # 32, no auth/role/security
curl -sk -u "$A" "$B/sap/bc/adt/aps/iam/sush/su22authobject/values"    # design-time value help
curl -sk -u "$A" "$B/sap/bc/adt/system/users"                         # user list only
# guessed SU53 paths -> all 404
```

## Pre-plan spikes (2026-07-09) — resolved

- **8.16 coverage:** `SUAUTHVALTRC` reads via TABLE_QUERY on a4h-2025 (SAP_BASIS 816) — correct
  columns, 0 rows (present + readable; trace off there). Read path works on 7.58 ✓ and 8.16 ✓.
- **Field-name decode source = `TOBJ`:** readable via TABLE_QUERY; `FIEL1..0` are the object's field
  names in order — `S_DEVELOP` → DEVCLASS/OBJTYPE/OBJNAME/P_GROUP/ACTVT, `S_TCODE` → TCD. Map
  `SUAUTHVALTRC.FIELD1..0` positionally to `TOBJ.FIEL1..0` (one small, cacheable read per object; 56
  objects here). → **include field-name labels in v1** (that's `TCD=SU01` vs raw `FIELD1=SU01`).
- **No trace-toggle endpoint:** ADT discovery exposes no profile-parameter write (only read-only
  `system/{clients,components,information,landscape/servers,users}`; `abaptraces/parameters` is the
  profiler trace, not `auth/auth_user_trace`). → **drop `set_auth_trace_state`**; enabling the trace
  is an out-of-band admin action (RZ11/profile). The tool reads an existing trace and hints when off.
- **No reliable ADT trace-state read (2026-07-10 follow-up):** `SUAUTHVALTRC` rows persist after
  deactivation, so neither an empty nor a populated result proves the current state. The standard
  STUSERTRACE program `RSUSR_SUAUTHVALTRC_DISPLAY` determines state through kernel-only methods
  `CL_SUSR_TOOLS_KERNEL=>AUTH_USER_TRACE_GET_STATUS` / `...SET_FILTER`: `X` = active without filter,
  `F` = active with filter, other = inactive. This is not exposed by ADT. Live `sapcontrol
  ParameterValue auth/auth_user_trace` returned `y` on a4h 7.58 and `N` on a4h-2025 8.16, but
  sapcontrol requires instance-administration access ARC-1 deployments do not have. Therefore the
  action reports state as `unknown`, warns about the ambiguity, and tells admins to verify in RZ11.
- **Activation guidance:** `auth/auth_user_trace` is dynamic. Use RZ11 for a temporary value (`N` =
  inactive, `F` = STUSERTRACE-filtered, `Y` = unfiltered); for `F`, maintain at least one user,
  application, or object filter in STUSERTRACE. In multi-instance systems, use RZ11's **Change on
  All Servers** option when every application server must participate. Maintain `DEFAULT.PFL`
  through the approved Basis profile workflow for a restart-persistent setting. Standard
  STUSERTRACE source verifies `S_ADMI_FCD` value `STUF` for changing filters and `STUR` for
  evaluation.

## Follow-up: custom-code path live proof (2026-07-10)

The table-backed core action and a temporary custom helper were tested side by side on both live
on-prem trial systems. The helper was created in `$TMP`, executed through an actual ARC-1 code
extension using `ctx.run.classRun`, and deleted from both systems after the proof.

| System | Core `authorization_trace` | Custom kernel/SU53 helper |
|---|---|---|
| a4h 7.58, `auth/auth_user_trace=y` | One persisted `AUTH_TEST` denial: `S_TCODE`, `TCD=SU01`, RC 12, `LSUSEU11:53` | `TRACE_STATUS=X`; `SUSR_USER_SU53_READ` returned the same live SU53 denial, plus instance `vhcala4hci_A4H_00` and high-resolution timestamp |
| a4h-2025 8.16, `auth/auth_user_trace=N` | Empty result with the new state-ambiguity warning and activation guidance | Empty trace status; no SU53 rows (and a structured "user does not exist" return for `AUTH_TEST`) |

The standard APIs behind the proof are available on both 7.58 and 8.16:

- `CL_SUSR_TOOLS_KERNEL=>AUTH_USER_TRACE_GET_STATUS( )` returns `X` (active without filter), `F`
  (active with filter), blank (inactive), or `U` (unexpected). Its implementation calls the kernel
  `AUTH_TRACE` operation and falls back to `C_SAPGPARAM auth/auth_user_trace` on old kernels.
- `SUSR_USER_SU53_READ` is the API used by the modern `SU53` transaction. It reads the shared-memory
  failed-check buffers, can fan out across all application servers, accepts user/time/result caps,
  returns structured `USR07_EXT` rows, and performs SAP authorization checks when reading another
  user. This is the missing live-buffer capability that no ADT endpoint exposes.

### Recommended product shape: optional companion extension

Do **not** put these unreleased kernel/function-module calls in ARC-1 core. Offer them as an
on-prem-only extension with an explicitly installed ABAP companion:

1. Customer installs an abapGit package or transport containing a read-only HTTP handler (for
   example `/sap/bc/http/sap/zarc1_auth_diag`) and activates its SICF node.
2. The handler validates/clamps `user`, `minutes`, and `maxResults`, calls
   `AUTH_USER_TRACE_GET_STATUS` and `SUSR_USER_SU53_READ`, preserves the standard function module's
   authorization result, and returns bounded JSON. It performs no trace-state or filter mutation.
3. A reviewed TypeScript ARC-1 extension registers `Custom_AuthorizationDiagnostics` as
   `availableOn:'onprem'`, `scope:'data'`, `OperationType.Query`, and calls the endpoint with
   `ctx.http.get`. Principal propagation/shared SAP identity and the standard FM's user-group check
   remain the final SAP-side authorization boundary.
4. The installer documents the required SAP authorizations, SICF/Cloud Connector resource exposure,
   release compatibility, removal procedure, and the fact that these are unreleased SAP internals
   with upgrade risk.

A console-class product (`IF_OO_ADT_CLASSRUN`) is not recommended even though the spike proved it
works: `ctx.run.classRun` accepts only a class name, so it cannot safely carry per-call user/time
filters, and enabling it requires `SAP_ALLOW_WRITES=true`, `SAP_ALLOW_PLUGIN_EXECUTE=true`, and a
write-scoped tool. A read-only ICF GET keeps the runtime capability aligned with the diagnostic's
actual risk and lets the extension retain the `data` scope used by the built-in trace read.

Extension-v1 nuance: `ctx.http.get` is safety-checked as a normal read. Declaring `scope:'data'` /
`OperationType.Query` enforces the MCP user scope and registration consistency, but it does **not**
implicitly consult `SAP_ALLOW_DATA_PREVIEW`; that flag specifically gates ARC-1's generic table
preview primitives. Loading the reviewed extension, exposing the custom SICF resource, and the SAP
endpoint's own authorization check are therefore the explicit server/admin consent. If deployments
need a second default-off ARC-1 ceiling for this endpoint, add a dedicated extension capability flag
or the planned `ctx.data` facade before publishing it broadly rather than implying the existing data
preview flag applies.

The combined value proposition is now clear:

- **Core action, no SAP install:** persisted long-term STUSERTRACE history, field decoding, code
  location, and safe activation guidance.
- **Optional installed extension:** live trace state + true recent SU53 failures across application
  servers.
- **Still separate future work:** mapping a missing object/value to assigned or candidate PFCG roles;
  that needs controlled role/authorization analysis and should not be inferred from SU53 alone.

Design notes the plan carries (evidenced, no further spike): **sort client-side by `FIRSTCALL DESC`**
+ cap — the ADT freestyle endpoint rejects `ORDER BY` on 7.50/7.51 so `buildTableQuerySql`
(`client.ts:263`) omits it, and there's no server pagination → narrow with filters; reuse the gated
`client.runTableQuery('SUAUTHVALTRC', …)` (`OperationType.Query` = data-preview); absence surfaces as
datapreview 400 "Cannot find
'<table>'" → catch → hint; the ARC-1 SAP user needs `S_TABU_*` read auth on `SUAUTHVALTRC`+`TOBJ`
(hidden here by SAP_ALL); 7.50 + cloud = unavailable → hint (Fiori *Display Authorization Trace*).

## Bottom line

SU53/STAUTHTRACE/STUSERTRACE are **provably not in ADT** (any release) and there is **no auth-trace
OData service on a4h on-prem**. But the "manual traffic capture" plan is unnecessary on-prem: the
long-term user trace is the readable table **`SUAUTHVALTRC`** (per-user, RC + field values + code
location) with `USOB_AUTHVALTRC` for SU24/object traces — read directly via ARC-1 SAPQuery /
TABLE_CONTENTS (`data`/`sql` scope), no capture. Traffic capture only pays off on **BTP/Steampunk**,
where the table isn't reachable and the "Display Authorization Trace" Fiori app's V4 service
(`UI_AUTHORIZATION_TRACE`, unpublished on a4h) is the only surface. Recommended next step: read
`SUAUTHVALTRC WHERE rc <> 0` on a4h to validate the payload end-to-end before deciding whether a
dedicated ARC-1 wrapper (typed "authorization trace" read) is worth it over generic SAPQuery.
