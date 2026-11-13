# Plan: pinned PP writes through the shared handlers

**Status:** Steps 1–6 implemented and revised after review (13 November 2026). Step 7: first live run of `896320813` on A4H 758 — 12 pass, 2 fail, 3 not run; both failures and three review findings fixed in follow-up commits; a re-run of the [Live qualification checklist](#live-qualification-checklist) is outstanding. Decision record: [ADR-0011 (proposed revision)](../adr/0011-broader-pinned-pp-mutations.md).
**Supersedes the approach of** draft [PR #1142](https://github.com/arc-mcp/arc-1/pull/1142) (not its goal).
**Roadmap:** FEAT-93.

## Goal

Writes on an opted-in pinned strict-PP target should work like writes on a single-target instance:
same tools, actions, types, fields and result text. Multi-target adds only the controls that exist
because one app serves several systems and users. No per-resource `pinned-*` adapter is added. If a
step seems to need one, stop and report — that is the design this plan replaces.

PR 1 (this plan): every `SAPWrite` action and `SAPActivate action=activate` (single and batch).
Later PRs are listed at the end.

## What differs from single-target, and where it is enforced

| # | Control | Enforced once at |
|---|---|---|
| 1 | Who may write: pinned route, strict PP, raw write scope, exact read and write target grant, destination opt-in. Aggregate, Copilot, Basic and read-only destinations never write. | Existing HTTP gate and `isOperationAllowed` (`src/adt/safety.ts`) — unchanged |
| 2 | Admission: an explicit list of `Tool.action` keys (`edit_content` is not on it). A new single-target action is not writable here until listed. Unknown fields and `preaudit=false` are refused. | `src/server/multi-target-write-surface.ts`; `handleToolCall` repeats the gate's decision for every tool; the `SAPActivate` handler refuses `preaudit=false` |
| 3 | Package ceiling: server **and** destination list, against the real package. | `checkPackage` / `enforceAllowedPackageForObjectUrl` — already dual, unchanged |
| 4 | Request ceiling: server **and** destination transport list, for every request ID ARC-1 sends or SAP returns from a lock. A save with no request is decided by SAP. | Caller-supplied: admission (2). Sent on the wire: `AdtHttpClient.request()`. Returned by the lock: `lockObject` |
| 5 | No transient replay of POST/PUT/DELETE (503, 429, lost DB connection); definitive rejections keep their single retry, and a 403 is resent only on SAP's CSRF challenge. | `AdtHttpClient.request()` |
| 6 | Activation scope: SAP may add other inactive objects in its preaudit answer. Only the requested, package-checked objects and their own sub-resources may be confirmed. | `confirmPreaudit` in `src/adt/devtools.ts` |

Everything else is the single-target behaviour. Do **not** add read-back, under-lock re-validation,
recording preflight, native identity evidence, per-call budgets, a JSON `state`/`phase` result, a
required source hash, per-type or per-field allowlists, or a new config switch. If one is needed, it
goes into the shared path for all modes and needs an ADR note first.

`CLAS`/`INTF` use the shared handlers like every other type. The ADR-0010 adapter was removed in
review (the maintainer released it from being a contract): a hybrid routing seam let some spellings
bypass its hash requirement, and CLAS delete/`batch_create` already used the shared path.

## New PR, not the old branch

Open a **new PR from `main`**. Do not rebase or continue `codex/broader-pinned-pp-writes`: it is 365
files, conflicts with `main`, its runtime is the design being replaced, and its live evidence is
bound to its revisions. Leave #1142 open as a draft reference until this merges, then close it with
a link here (history is preserved at snapshot `1636bab36`).

Read on the old branch for reference only — do not copy runtime code:

- `docs/research/broader-pinned-pp-writes/` — live SAP findings per resource family.
- `docs_page/multi-target-writes.md` — operator wording.

## Starting point: the spike

Worktree `architecture-refactor-review-94a50d`, uncommitted on `main` at `0698468a6`. 128 added
production lines in seven files; 13 mock tests in
`tests/unit/handlers/pinned-shared-handler-spike.test.ts` (PROG only). Start from it.

| File | What the spike does |
|---|---|
| `src/adt/http.ts`, `src/adt/client.ts` | `pinnedWrite` config field; controls 4 (wire) and 5 at the top of `request()` |
| `src/adt/mutation-context.ts` | Shared lifecycle allowed on an **enabled** target; disabled still throws |
| `src/server/multi-target-write-surface.ts` | `SHARED_PINNED_ACTIONS`, `adr0010Row`, transport check on `transport` and `objects[].transport` |
| `src/handlers/write.ts`, `src/handlers/activate.ts` | ADR-0010 rows → adapter; other admitted calls → shared handler |
| `src/adt/devtools.ts` | Batch activation allowed on an enabled target; `preaudit=false` refused; control 6 |

Known state of the spike:

- Only `PROG` create/update/delete/activate is tested, and only against mocks. Nothing ran on SAP.
- Code is unformatted (Biome does not start in that worktree; `node_modules` is stale — run `npm ci`).
- Tests that fail **by design** and must be rewritten, not worked around:
  - `tests/unit/adt/mutation-lifecycle.test.ts` — `refuses legacy wrappers on multi-target clients: enabled=true`, and the `legacy` case in `refuses absent, reconstructed, disabled and different-target contexts…`.
  - `tests/unit/handlers/pinned-writes.test.ts` — `requires a validator at low-level multi-target activation and refuses batch recovery`.
  - `tests/unit/server/multi-target-writes.test.ts` — seven `rejects hidden write inputs…` cases (`type:PROG`, `action:delete`, `include`, `objects`, `lintBeforeWrite`, `lcl_helper~run`, `target`). All but `target` are now admitted on purpose. **`target` must stay refused** — see step 2.
- One regression was found and fixed during the spike: checking the caller's request at admission
  broke ADR-0010's task-to-parent resolution. The admission transport check therefore applies to
  shared rows only. Keep the existing test `canonicalizes a verified task to its allowed parent`.

## Implementation status (13 November 2026)

Steps 1–6 are implemented, then revised after review:

- **ADR-0010 adapter removed.** Deleted `src/handlers/write/pinned{,-activation,-result}.ts`,
  `src/adt/pinned-write-policy.ts`, `src/adt/mutation-{context,http}.ts` and their tests; the pinned-only
  activation options (`validateReferences`, `beforeSubmit`, required execution evidence) and the
  lock `localityKnown` evidence are gone. `crud.ts::withLockedMutation` is the plain single-target
  lifecycle again. CLAS/INTF rows are in `pinned-shared-families.test.ts`.
- **Barrier narrowed** to `retryTransientErrors: false`: CSRF refresh, 401 retry and 406/415
  negotiation still run once. There is no network-error retry to disable.
- **Dispatch recheck covers every tool** (`multiTargetInvocationDecision` when `config.targetId` is
  set), because `isOperationAllowed` alone no longer refuses mutations on a write-enabled target.
- The central predicate keeps the existing semantics: empty destination list refuses, empty server
  list does not restrict. Unknown fields are checked against the single-target Zod schema keys.
- No type failed step 5; none is refused at admission. Schema budget raise approved by the maintainer.

After the first live run and review (follow-up commits on this branch):

- **Merged `main`;** its new `SAPWrite.edit_content` stays excluded. The pinned catalog drops
  `oldContent`/`newContent` and the `edit_content` guidance, so no budget was raised.
- **Text-symbol activation:** `edit_text_symbols` activated its pool with `preaudit=false`, which
  devtools refused on pinned targets after the PUT had saved. That internal exact-URI activation now
  proceeds; caller `preaudit=false` is refused in the `SAPActivate` handler as well as at admission
  and dispatch. Tests drive save → activation → state read for PROG, CLAS and FUGR.
- **403 resend:** pinned clients resend POST/PUT/DELETE after a 403 only when SAP sends
  `x-csrf-token: Required`. Single-target is unchanged (possible follow-up for all modes).
- **Lock request:** `lockObject` refuses, after unlocking, a lock `CORRNR` that is off either list.
- **`activationExecuted="false"`:** reported as a warning in every mode, not as success.

Numbers: production +169/−905 (net −736) in 17 `src/` files; tests: 3 new files (704 lines),
tracked tests +142/−1,125; 267 family cases. Full gate green. In the generic mock some families stop
on a type-specific response shape before the save (listed in the checklist); package refusal is
verified for all of them.

## Steps

Commit after each step. Before each commit run `npm test`, `npm run typecheck`, `npm run lint`,
`npm run validate:policy`, `npm run check:sizes`, `npm run build`. Remove every `SPIKE:` comment.

### 1. Central controls (`src/adt/http.ts`, `src/adt/client.ts`, `src/adt/safety.ts`)

- Keep the block at the top of `request()`. Apply it only when `pinnedWrite.enabled` is true.
- Move the "on both lists, empty list refuses" predicate into `src/adt/safety.ts` and use it from
  `http.ts`, `multi-target-write-surface.ts` and `pinned-write-policy.ts` (three copies today).
- Tests: PUT/POST/DELETE with a 503 sent once; GET still retried; `corrNr` allowed / denied /
  absent; a request inside `withStatefulSession`; a client without a pinned policy unaffected.

Gotcha: the wire check sees only a `corrNr` **query parameter**. Every object write in PR 1 uses it
(verified by grep: `crud.ts`, `server-driven.ts`, `text-elements.ts`, `table-settings.ts`,
`rap-generate.ts`). Body-carried requests (`refactoring.ts`, `transport.ts`) are later PRs.

### 2. Admission (`src/server/multi-target-write-surface.ts`)

- Keep `SHARED_PINNED_ACTIONS` as the single explicit list. PR 1 = the 15 `SAPWrite` actions and
  `SAPActivate.activate`.
- Add a test that every `SAPWrite.*` / `SAPActivate.*` key in `ACTION_POLICY` is either in the list
  or in an explicit "not admitted" list in the test (`publish_srvb`, `unpublish_srvb`). A new policy
  row then fails CI until someone decides (Playbook §5).
- Refuse keys that are not properties of the single-target tool schema (this keeps `target`
  refused). Derive the key set from the tool definition; do not hand-write field lists.
- Keep: `preaudit === false` refused; `transport` and `objects[].transport` on both lists.
- Recheck admission once in `handleToolCall` (`src/handlers/dispatch.ts`) for `SAPWrite` /
  `SAPActivate` when `config.targetId` is set, and drop the per-router recheck in `write.ts`. The
  HTTP gate is the real entry point; this covers direct dispatch.

### 3. Barrier and activation (`src/adt/crud.ts`, `src/adt/devtools.ts`, `src/handlers/activate.ts`)

- Keep the spike's changes. Rewrite the by-design failing tests to the new invariants:
  enabled target → shared wrapper runs, mutations are no-replay and ceiling-checked; disabled
  target → refused before any request; preaudit expansion with a foreign object → refused before the
  confirming POST; own sub-resource (`…/includes/…`, `…/source/main`) → confirmed.
- Add a test that the per-user multi-target client built by `server.ts` carries `pinnedWrite`
  (security value by construction — Playbook §4).
- Check the ED064 single-object retry in `activateBatch` on a pinned target: it sends new requests
  after a definite SAP answer, which is allowed, but each retried object must pass control 6 again.

### 4. Advertised schema (`src/server/multi-target-tools.ts`)

- `pruneDefinition` hardcodes CLAS/INTF fields, enums and descriptions. On a write-enabled pinned
  target return the single-target `SAPWrite` / `SAPActivate` definition with: the `action` enum
  filtered to admitted actions, `preaudit` removed, and one sentence appended to the description
  (both package and transport lists apply; `expectedSourceHash` is required for CLAS/INTF
  create/update/edit_method).
- Fixtures change: `npx vitest run -u` on the tool-definition snapshot test, review the diff,
  include it. Check the schema token budgets.

### 5. Per-type tests

The handlers are shared, so per-type risk is in two places only: package resolution and where the
request goes on the wire. For each family below add create/update/delete/activate through
`handleToolCall` with a multi-target config, asserting: package outside the destination list refused
before any mutation; request off the list refused; failed save sent once; lock released.

Families: source objects (PROG, INCL, CLAS includes, INTF, DDLS, DDLX, DCLS, BDEF, SRVD);
FUGR/FUNC and group includes; DDIC metadata (DOMA, DTEL, TABL, TTYP, MSAG, ENQU, TABL/DTT, TABL/DTI);
server-driven (one representative); SRVB, SKTD, ENHO; text symbols; class and unit surgery;
`batch_create` with and without `activateAtEnd`; RAP scaffold/generate.

If a type cannot resolve its package or sends a request outside the `corrNr` query, leave the
action admitted but refuse that type at admission with a one-line reason, and list it in the PR.

Also add one test through the HTTP gate (`multiTargetInvocationDecision`, see
`tests/unit/server/http-multi-target-routes.test.ts`): admitted call allowed; aggregate route, Basic
target, read-only destination, `SAPGit`, `Custom_*` and `SAPTransport` writes forbidden.

### 6. Docs and roadmap

- `docs_page/multi-target-writes.md`: replace the matrix for PR 1 scope with "same as single-target,
  plus these six controls" and the "what you do not get" list from the ADR.
- `docs/security-model.md` R23, `docs/dev-guide.md` shared-mutation section, one terse AGENTS.md row.
- AGENTS.md and ADR-0010 currently say "explicit action/type/input allowlists" for multi-target.
  State the change (action allowlist; types and inputs from the single-target schema) in ADR-0011.
- `docs_page/roadmap.md` FEAT-93: narrow to the later PRs, overview and details.
- ADR-0011 stays Proposed until the security review.

### 7. Live qualification (required before merge) — not done

Run the [Live qualification checklist](#live-qualification-checklist) below. If no live window is
available, say so and keep the PR draft. Mock results are not live evidence.

## Behaviour changes to state in the PR

- On a write-enabled pinned target every POST/PUT/DELETE loses the transient retry (503, 429, lost
  DB connection), including read-like POSTs (search, syntax check, activation preaudit). The error
  surfaces; CSRF refresh, session retry and content negotiation still run once.
- CLAS/INTF lose the ADR-0010 adapter: no JSON `state`/`phase` result, no read-back, no under-lock
  revalidation, no positive activation-execution evidence, optional `expectedSourceHash`.
- A task ID as `transport` is refused unless the task itself is on both lists; there is no
  task-to-parent resolution. List and pass parent requests (on 758, saving with a task ID returned
  HTTP 500 and left a stub — see the ADR-0010 qualification record).
- Per-call `lintBeforeWrite=false` is accepted, as in single-target. Lint is not an access control.
- Whole-object activation can include other users' inactive parts of the **same** object, as in
  single-target. Other objects are never pulled in.
- Direct dispatch with a multi-target config now applies the HTTP gate's tool/action decision to
  every tool, not only writes.
- A plain authorization 403 on a pinned write is reported, not resent; only SAP's CSRF challenge
  triggers the one refresh-and-resend.
- A lock whose request is off either list is released and the write refused, even when the caller
  passed no `transport`.
- `SAPWrite edit_content` (new on `main`) is not available on pinned routes.
- In every mode, an activation that SAP answers with `activationExecuted="false"` and no errors is
  reported with a warning ("Activation request completed for …", batch status `requested`,
  `batch_create` activation `unknown`) instead of "Successfully activated".

## Later PRs (not in this plan)

Each needs its own admission keys, tests and live evidence.

1. **Package and CTS management:** `SAPManage` package create/move/delete and `set_api_state`,
   `SAPTransport` writes. Needs `checkTransport` in `safety.ts` made dual like `checkPackage`, and
   the body-carried request in `refactoring.ts` checked.
2. **Publication:** `SAPActivate publish_srvb` / `unpublish_srvb`.
3. **Only on request:** quickfix apply, formatter settings, profiler trace, FLP. ST05 SQL trace
   switches all application-server instances, not only the pinned client — admit last, if at all.

Never: `SAPGit`, `Custom_*` plugins, any write on aggregate, Copilot or shared Basic routes.

## Live qualification checklist

Self-contained instructions for the agent that runs step 7. Do every step through the **MCP pinned
route** (not the CLI, not a direct ADT client), with the build from this change deployed. Stop and
report if a gate expected to refuse lets a call through; do not work around it.

### Setup (record each item)

1. **Build:** deploy this change's commit to an isolated CF app (the ADR-0010 qualification used
   `arc1-ta-677-test` with its own XSUAA). Record commit SHA, deploy time (UTC), app name.
2. **Instance config** (`.mtaext` or `cf set-env`, then restart): `SAP_ALLOW_WRITES=true`,
   `SAP_ALLOWED_PACKAGES=$TMP,ZARC1_DEMO`, `SAP_ALLOWED_TRANSPORTS=` (empty = unrestricted for
   all steps except 9, which sets it), `ARC1_MULTI_TARGET_ENDPOINTS=true`,
   `ARC1_MULTI_TARGET_AUTHORIZATION=xsuaa-attribute`, `ARC1_CACHE=none`, `ARC1_TOOL_MODE=standard`,
   `ARC1_UI=off`.
3. **Destination** (PP to a4h 2023, SAP_BASIS 758, client 001), alias e.g. `SH1142/001`:
   `arc1.enabled=true`, `arc1.allow_writes=true`, `arc1.allowed_packages=$TMP,ZARC1_DEMO`,
   `arc1.allowed_transports=<REQ_A>`. A second destination (or alias) for A4H/100 without write
   properties serves as the read-only target.
4. **Requests:** in SAP GUI/ADT create two Workbench requests in `ZARC1_DEMO`: `REQ_A` (allowed)
   and `REQ_B` (not listed). Record both IDs and `REQ_A`'s task ID `TASK_A`.
5. **Identity:** one user with role collection granting `arc1_targets=[SH1142/001, A4H/100]` and
   `arc1_write_targets=[SH1142/001]`; raw scopes `read`, `write`. Connect an MCP client to
   `https://<route>/SH1142/001/mcp`, sign in fresh, list tools.
6. **Names:** prefix every object with `ZARC1_SH_<MMDD>_`; keep a list for cleanup. SAP naming rules
   override the prefix: ENQU names start with `E` (`EZARC1_SH_<MMDD>`, max 16 characters);
   function-group includes are `L<GROUP>` plus a suffix (`LZARC1_SH_<MMDD>_FGF01` for group
   `ZARC1_SH_<MMDD>_FG`).

For every call record: tool + arguments (minus source bodies), `isError`, the first 300 characters
of the result, and for mutations the SAP state afterwards (`SAPRead` active/inactive, or
`SAPDiagnose object_state`). Use `SAPRead(format="editable")` to read hashes when you pass
`expectedSourceHash`.

### Steps

| # | Call(s) | Expected | Record |
|---|---|---|---|
| 0 | `tools/list` on the pinned route | `SAPWrite` with 15 actions (no `edit_content`, no `oldContent`/`newContent`), `SAPActivate` with only `activate` and no `preaudit`; no `SAPManage`/`SAPGit` write actions | Action enums |
| 1 | Per family in `$TMP`: `SAPWrite create` → `update` → `SAPActivate` → `SAPWrite delete` for PROG, INCL, CLAS, INTF, DDLS, DDLX, DCLS, BDEF, SRVD, FUGR, FUNC (`group`), group INCL (`group`), DOMA, DTEL, TABL, TTYP, MSAG, ENQU, one server-driven type (APLO if available), SRVB, SKTD, ENHO | Each step succeeds as in single-target. After delete the read no longer returns the object (404 or the type's absence response — run 1 saw 422 for FUGR, a server error for FUNC, an informational absence for DDLX/SKTD; see roadmap COMPAT-24), corroborated by an exact `SAPSearch` with no hit | Per call result + final state + search |
| 2 | Families the mock did not reach — run their save path explicitly: PROG delete and FUGR delete (text-pool check), `TABL/DTT update`, `TABL/DTI create`+`delete`, `ENQU update`, `APLO delete`, `SKTD update`, `ENHO update`+`delete`, CLAS `add_method`/`edit_class_definition`/`edit_method_signature`/`delete_method`/`change_method_visibility`, local `edit_method` (`lcl_*~m`), PROG `edit_unit`/`add_unit`, `edit_text_symbols` (PROG, CLAS and FUGR), RAP `generate_behavior_implementation` with activation | Same as single-target; no lock left (SM12 empty for the user). `edit_text_symbols`: saved, activation succeeds (no error), `SAPRead TEXT_ELEMENTS` shows the new text active, deleting the owner then works, SM12 empty | Result, read-back, SM12 check |
| 3 | RAP: `batch_create` DDLS+BDEF+SRVD (+ behavior pool CLAS) with `activateAtEnd=true`; then `scaffold_rap_handlers autoApply=true` and `generate_behavior_implementation` on the pool | Stack active; handlers saved; activation result as single-target | Results, active state |
| 4 | `batch_create` without `activateAtEnd` (two PROGs) | Both created, each activated inline | Results |
| 5 | Transportable create in `ZARC1_DEMO` with `transport=REQ_A` (PROG and CLAS) | Created; objects recorded under `REQ_A` (SE09) | Request contents |
| 6 | Same create with `transport=REQ_B` | Refused before any SAP request (`not enabled for this multi-target connection`); object does not exist | Result, GET 404 |
| 7 | `transport=TASK_A` (task not listed) | Refused at admission | Result |
| 8 | Lock-derived request off the list: lock an existing `ZARC1_DEMO` object into `REQ_B` in ADT (make a change, save into `REQ_B`, release your editor lock), then `SAPWrite update` without `transport` | Refused (`CTS request is not allowed…`); source unchanged; no lock left (SM12) | Result, source hash before/after, SM12 |
| 9 | Server list: set `SAP_ALLOWED_TRANSPORTS=<some other request>` and restart; repeat step 5 with `REQ_A` | Refused (server ceiling) | Result; restore setting afterwards |
| 10 | Preaudit expansion: create two PROGs A and B in `$TMP`, make B include-dependent on A or just leave B inactive in the same package, then `SAPActivate` A only. If SAP's preaudit answer lists B | Refused with `SAP would also activate objects that were not requested: B`; nothing activated. If SAP does not add B, record that the case was not reproducible and how it was attempted. **Stays open** until a live fixture produces an expanded preaudit | Result, active state of A and B |
| 11 | `SAPActivate objects=[A, B]` after step 10 | Both active | Result |
| 12 | Second writer: hold a lock on a `$TMP` PROG in ADT (open in editor, change without saving), then `SAPWrite update` | Clean lock error; no lock left by ARC-1 (SM12 shows only the ADT lock) | Result, SM12 |
| 13 | Negatives: same writes on `/multi/mcp` (aggregate), the read-only A4H/100 route, a Basic target if configured, a token without `arc1_write_targets`, a token with only `read` scope | All refused; write tools hidden in `tools/list` | Results |
| 14 | Direct non-write mutations on the pinned route: `SAPManage create_package`, `SAPTransport create`, `SAPDiagnose set_sql_trace_state`, `SAPActivate publish_srvb` | `MULTI_TARGET_OPERATION_FORBIDDEN`; nothing changed in SAP | Results |
| 15 | Optional — older release (7.50/7.40 target, if one is reachable by PP): a DTEL create (versioned content type) | Succeeds after one 415 renegotiation; with `ARC1_LOG_HTTP_DEBUG=true` the log shows one 415 then success | Result + log excerpt |
| 16 | Optional — transient failure: if a 503 can be provoked safely, confirm the write is reported as an error and not resent. Also a plain authorization 403 (for example a write to a package the SAP user may not change): one send. A CSRF challenge 403 (`x-csrf-token: Required`) is refreshed and sent twice | One request in the audit/HTTP log for 503 and plain 403 | Log excerpt |
| 17 | Optional — text-pool repair: if a program's pool is inactive (edit texts in ADT without activating), `SAPActivate type="REPT"` on it; if SAP proposes the program as well, repeat with `objects=[REPT, PROG]` | Pool active; deleting the program then works | Result, read-back |

### Cleanup

Delete every `ZARC1_SH_*` object (verify GET 404), release or delete `REQ_A`/`REQ_B`, remove the
destination write properties and role collection, restore the app's previous config and droplet,
and confirm health 200. Record the cleanup in the PR alongside the results.

