# PR #677 — refreshed acceptance tests and October 13 live baseline

> Editorial update (2026-10-14): mode terminology below uses the current names `standard` and
> `xsuaa-attribute`. Recorded test dates, builds and outcomes are unchanged; these are not tests of
> the later naming change. For setup, use the [current guide](../../docs_page/multi-target-authorization.md).

Status: **core static-role and initial real-client acceptance recorded; customer-ready gates remain open.**
This supplements the [September validation record](2026-09-15-pr677-target-authorization-implementation.md)
without relabeling those older results as final-build evidence. An external tester reported that it
worked, but supplied no build, client, configuration or negative-case notes; that is encouraging
feedback, not a reproducible acceptance result.

## Revision and isolation

- Merged latest `origin/main` `e0c3389234ea2c7bd6900146c5bb6e30fddbc28c` into the PR in
  `baa72bcf`. The merge was clean. Production source deployed below is exactly that merge;
  subsequent changes in this follow-up are test/harness/documentation only.
- Clean `npm ci` and build used Node 24.11.1 and locked, published `@arc-mcp/xsuaa-auth` 1.1.0.
- Reused only `arc1-ta-677-test`, its existing route and its dedicated `arc1-ta-677-xsuaa`.
  Destination and Connectivity bindings are shared and were not modified.
- CF organization was at its 4,096 MiB memory and 10-route limits. Stopping/redeploying this
  existing 384 MiB test app avoided deleting anything or changing other apps.
- Uploaded only built `dist`, `bin`, package manifest/lock, README and LICENSE. No repository
  `.env`, user fixture, key or local auth package was uploaded. Preserved strict PP, no cache,
  explicit target authorization, disabled Basic/writes/UI/plugins, and the ATC/unit-test deny list.
- CF staged Node 24.19.0 with buildpack 1.9.4 on cflinuxfs4. The final process uses the original
  `exec sh ./bin/start-cf.sh` command and its adaptive memory policy. A temporary staging-only
  `HUSKY` property was removed. Original public URL and authorization settings were read back.
- New droplet: `a99d1212-e1fc-48d9-893c-c89ce81850cc`, SHA-256
  `bd66fa2d8d9be8c66060e9d5a560918cb025a67775f205bb5bf62c134084f9fa`.
  Previous droplet retained for rollback: `bf04512b-ad25-4542-b79f-0b5727dc1c67`.

## Test additions

The [acceptance harness](../../scripts/spikes/pr677-target-authorization/README.md) now supports:

1. Optional, fixed `TVARVC` client-marker checks through both aggregate and pinned endpoints.
   Both data and SQL probes select only `MANDT`, `NAME`, `LOW` for `ZARC1_CLIENT_MARKER`, with
   at most two rows. Positive results must contain exactly one marker for the requested client.
   Permission tests require the exact structured denial code; outages are failures, not passes.
   No arbitrary SQL, table names, marker creation or SAP writes are accepted.
2. A same-tenant, second-application **human** JWT-bearer exchange fixture. The source assertion
   must be a verified primary-app user. The issued foreign token is independently checked by
   its issuing application's SAP SDK and user-principal verifier, including expected identity
   and exact local scopes/attributes, before ARC-1's wrong-audience rejection is tested. Failed issuance is
   not a runtime isolation pass. Reciprocal runs are needed for both directions.
3. Offline oracles for the new fixtures: wrong clients, empty/duplicate markers, wrong identities,
   wrong/absent grants, machine principals, SDK/transport errors, and attempts to supply arbitrary
   SQL or send an assertion to another tenant. These are harness tests, not live acceptance.
4. Updated the stale deployment-document assertion to expect the current canonical
   `multi-target-authorization.md` link. No runtime security assertion was removed.

## Local verification

- Build, typecheck, lint, action-policy validation, schema/file budgets and BTP MTA profile validation passed.
- Full unit suite: **8,793 tests / 304 files passed**, both with two workers and on a subsequent
  default-concurrency rerun. The first run, concurrent with typechecking and other local work,
  hit four subprocess/startup timeouts (CLI and signal/audit tests). They did not reproduce in
  either full rerun. Timeouts were not raised and no tests were skipped.
- Harness self-tests: **36 passed**. This includes nine new tests; real-system coverage is below.
- `npm audit` reported four high entries from one `node-forge` advisory through the SAP SDK chain.
  Latest main already contains the time-limited `GHSA-86w9-cpqp-85rv` acceptance until **October 21,
  2026**. `npm run audit:ci` passed under that unchanged exception. This is not a claim of
  non-exploitability or a clean raw audit; reassess before release or exception expiry.

## Initial live baseline (before IAM-change approval)

All requests below used the isolated app on the merged production source. No BTP role collection,
XSUAA descriptor, IAS membership, destination or SAP authorization was changed in these runs.
The secondary user had the existing isolated Viewer collection and no target grants.

| Run | Assertions | What this proves |
|---|---:|---|
| Anonymous/invalid bearer, aggregate + compatibility + pinned routes | 14/14 | HTTP 401 and private/no-store responses |
| Fresh private-window password login, secondary user | 57/57 | Valid user/read scope, missing target attribute, empty tool projection, hidden/unknown target denials |
| Refresh of that token | 57/57 | Supported refreshed user, still no grants, same denials |
| Same-app JWT-bearer user exchange | 57/57 | Supported exchanged user, still no grants, same denials |
| Original token replay plus four explicit data/SQL target-denial probes | 73/73 | Both clients denied for both operations; aggregate exact policy errors and pinned 404s |

Total: **258 passing live assertions**, zero failed assertions in these runs. These are repeated
boundary assertions, not 258 distinct business scenarios. Login identity and IdP origin were
verified privately. Initial/refreshed/exchanged token sizes were 2,049 / 2,072 / 2,076 bytes.
The IAS admin session remained available; the completed private login window was closed.
The reused no-grants refresh test does not measure role-revocation freshness.

The marker-denial run did **not** prove a successful SAP query, client marker, or mapped SAP user.
At the end of this baseline, the foreign-human exchange oracle had not yet been exercised against
a second live service; the approved follow-up below closes that one-direction gap.
No unavailable fixture is counted as a passing security test.

## Approved live role matrix (October 13, approximately 10:48–11:14 UTC)

The user approved temporary changes to the isolated `ARC1 PR677 …` collections/assignments for
the two test users, machine issuance on the dedicated XSUAA, and one disposable second XSUAA
application. Starting role collections, assignments, mappings and the application's security
descriptor were saved privately. The same deployed production revision/droplet was used throughout;
no production code fix was needed in this round. Primary login used its normal browser context;
all secondary logins used incognito. Tokens stayed in the local harness's memory.

| Scenario | Passing assertions in the named run | Evidence and limits |
|---|---:|---|
| Viewer, exact `A4H/100` | 132 | Only the granted target projected; data and SQL denied with the expected scope error |
| Data Viewer + exact target, new JWT-bearer token | 129 | Data marker succeeds through aggregate and pinned routes; SQL remains denied |
| SQL + Data + exact target | 137 | Data and SQL markers both succeed through aggregate and pinned routes |
| Primary exact `A4H/001` | 118 | Correct target projection and rejection of ungranted/unknown targets |
| Concurrent disjoint primary/secondary users | 118 + 132 | Interleaved initialize/list/call checks retain each caller's projection; not independent SAP-username evidence |
| Two exact roles combined | 132 | Verified claim union and complete unpaged two-target catalog |
| Two exact targets + Data/SQL | 166 | Both clients return their own `MANDT` and marker value through both routes |
| Admin without target grants | 73 | Admin diagnostics remain available; no target execution bypass |
| Admin + explicit `*` | 130 | All four currently active targets projected/granted; positive execution checked only on the two 2023 clients |
| Admin + `*` + exact role | 130 | Union remains all-target |
| Admin + `*` + invalid `A4H/*` | 73 | Entire grant set rejected; `*` does not rescue a malformed set |
| 50 / 100 / 256 exact grant values | 118 each | Real issued user tokens traverse XSUAA, CF and ARC-1; only registered/granted targets are projected |
| 257 exact values | 57 | ARC-1 rejects the oversized grant set completely, with no truncation or partial access |
| Machine with read / read + Admin | 21 each | Real machine tokens independently verified, then HTTP 403 before inventory/execution |
| Other application's human token | 16 | Source SDK verifies the actual human and other app's distinct exact grant; primary SDK rejects wrong audience and ARC-1 returns HTTP 401 |

The foreign-human test used the same tenant and IdP origin, the same attribute name, and a separate
application with a different exact grant. It proves **one direction** only; it does not cover a
second ARC-1 deployment, a second IdP origin, or every cross-application trust configuration.
Temporary machine authorities were solely a fixture to issue real tokens, not a supported
production setup. Once restored, a new machine-issuance attempt was refused by XSUAA (HTTP 400);
that issuer refusal is separate from the successful runtime 403 tests above.

### Measured revocation and browser behavior

1. Adding the Data Viewer role did **not** add `data` to a token obtained by refreshing the older
   Viewer session. That token still passed the Viewer scenario (132 assertions). A new JWT-bearer
   user exchange obtained the updated scopes and passed the Data Viewer scenario.
2. After removing the secondary user's exact-target role, replay of the original token and refresh
   of that session still authorized `A4H/100` (132 assertions each). A fresh expiry was not revocation.
3. A new JWT-bearer exchange and a genuinely fresh incognito password login had no target attribute
   and denied all targets (57 assertions each).
4. Within the subsequently reused incognito browser session, adding the exact role and starting a
   **new authorization-code login** produced the new grant (137 assertions). Removing it and
   starting another authorization-code login removed the grant (57 assertions). Cookie deletion
   was unnecessary in these measured runs; this is not a guarantee for all IAS/SSO configurations.
5. Opening the bound XSUAA logout URL built by `buildXsuaaSessionRefreshUrl` reached ARC-1's
   `/oauth/logged-out` confirmation. A new authorization-code flow then requested credentials;
   the secondary login still had no target grants (57 assertions). This verifies the bound
   logout/reconnect operation, not a newly reproduced `invalid_scope` error-page injection.

Two exploratory expectations were wrong: the first refresh check expected newly added scopes
(three failed assertions), and the first reused-browser login check expected a stale missing grant
(26 failed assertions). Inspection of the independently verified tokens explained both. The same
captured tokens passed the corrected, explicitly named scenarios; no runtime code or policy was
weakened, and these exploratory failures are not hidden by an overall zero-fail claim.

### Size, routing and audit observations

- Access-token sizes at 50 / 100 / 256 / 257 exact values were **3,402 / 4,336 / 7,248 / 7,266 bytes**.
  These are token bytes, not total HTTP-header sizes. The scale fixtures included one real target
  and synthetic exact IDs; the active registry still had four targets. This does **not** establish
  support for 256 active backends or a customer with large enterprise group claims.
- The two-client markers are the pre-existing `TVARVC` parameter `ZARC1_CLIENT_MARKER`: client
  `001` returns `001`, client `100` returns `100`. The harness selected only the fixed marker fields
  and did not create data. This proves physical client routing, not which SAP username PP mapped.
- Independent destination inventory readback confirmed four active PP targets and one Basic
  candidate excluded under the unchanged Basic-disabled setting. No destination was changed;
  successful backend access was not asserted for the 2025 or NPL targets.
- A bounded sample of CF logs contained expected missing/malformed/over-limit/not-granted
  decisions and no raw entitlement-array/token fields in the inspected denial events. This is
  neither an exhaustive redaction audit nor durable BTP Audit Log evidence. Absence of a log entry
  alone is not proof that SAP was never contacted.

### Cleanup and restoration

- Readback matched all six starting isolated collections, including role references, user
  assignments and attribute mappings. The secondary user's pre-existing Viewer assignment was
  preserved. No new target or capability assignment remains.
- All eight saved descriptor fields matched after restoration: app name, tenant mode, scopes,
  authorities, foreign-scope references, attributes, role templates and OAuth configuration.
- The disposable foreign-human collection, service key and second XSUAA service were removed.
  Existing fixture roles, the original harness service key and the test app were preserved.
- Shared service bindings, original destinations, IAS group memberships/mappings and SAP roles
  were not modified. No other application was stopped or deleted.
- The harness stopped without persisting tokens; the temporary credential files were removed.
  The secondary incognito window was closed and the normal IAS admin window was preserved.
- After recording this round, all 36 harness self-tests, 22 focused documentation/session-recovery
  tests, strict MkDocs build and `git diff --check` passed. The preceding head's complete PR checks
  were green; a documentation-only evidence commit still needs its own CI results.

## Approved future-target test (October 13, 15:21–15:28 UTC)

The user separately approved a temporary copy of the existing client-100 PP destination, with a
unique test alias, and restart/removal/restoration on the isolated app. The approval explicitly
covered subaccount visibility: another multi-target app could discover the copy on its own reload.
Only `arc1-ta-677-test` was restarted; no other app was changed. Its source revision and droplet
remained the same as above.

Before any destination change, two fresh authorization-code logins were independently verified:
the primary user with Admin + the default `MCPAllTargetReadAccess` role (`arc1_targets: ["*"]`),
and the secondary incognito user with Viewer + exact `A4H/100`. The primary token contained only
the four requested mutation-free scopes (`read`, `data`, `sql`, `admin`); the secondary had `read`.
The same two in-memory access tokens were reused at every stage: no refresh, exchange, login or
role change occurred between the baseline and restored-catalog checks.

| Stage | Wildcard token | Exact-target token | Result |
|---|---:|---:|---|
| Before destination creation | 139/139 | 134/134 | Four active targets for `*`; only `A4H/100` for the exact grant; future alias denied |
| After creation and isolated-app restart | 137/137 | 134/134 | Five-target wildcard schema/catalog, new target usable; exact grant remains unchanged and new alias denied |
| After deletion and isolated-app restart | 139/139 | 134/134 | Four-target wildcard projection restored; removed alias denied again; exact grant unchanged |

All **817 assertions passed** across these six runs; these are repeated boundary assertions, not
817 distinct scenarios. The temporary destination was `ARC1_PR677_FUTURE_20261013_100_PP`, alias
`PR677-FUTURE/100`, copied from `ARC1_MULTI_A4H_2023_100_PP`. Only its name, description and alias
changed; its real SAP identity remained `A4H`, client `100`, with Principal Propagation.
Positive `SAPRead(SYSTEM)`, data-marker and SQL-marker calls succeeded through both aggregate and
pinned routes. The marker checks independently confirmed physical client `100`. The exact user
could not discover or execute the new public alias, despite having access to the same backend
through the original `A4H/100` ID. This closes the **future active target under an existing `*`
grant** test, not a large-inventory or a newly provisioned physical-backend test.

Cleanup was verified against private pre-change snapshots:

- Destination Service readback matched canonical configuration hashes for all **11 original
  destinations**; the temporary twelfth entry was absent. Post-restart MCP tests separately
  confirmed the restored runtime registry.
- All six isolated collections again matched their original roles, user assignments and mappings.
  The secondary user's original Viewer assignment remained. The temporary wildcard/Admin/exact
  assignments and the wildcard role reference in the test matrix collection were removed.
- The existing XSUAA descriptor, bindings, IAS configuration and SAP authorizations were not changed.
  The test app remained started on its original tested droplet; no other app was restarted.
- The harness stopped without persisting tokens, its temporary credential file was removed, and
  the completed secondary incognito window was closed. Stopping the harness does not revoke an
  issued token; the measured revocation limitations above still apply.

After recording this follow-up, all 36 harness self-tests, strict MkDocs build and
`git diff --check` passed. All PR checks on preceding head `328a5507` were green, including
Node 22/24, integration, E2E, documentation and security checks. This evidence-only commit still
needs its own CI; no production source or deployed artifact changed in this follow-up.

### Independent SAP-username evidence remains unavailable

Using the user-provided MARIAN WebGUI session in client `100`, read-only SM20 searches of existing
file and database audit sources returned no matching secondary-user entries for the morning test
window. STAD likewise returned no records for either test SAP user in the selected morning window.
A fresh client-100 STAD query for `SAPDOCUPD`, 15:20–15:30 in the displayed SAP clock, with statistics
from memory included, returned no records while this afternoon's successful calls were recent.
This is **not** evidence of wrong PP mapping, and it does not prove that logging is disabled.
No trace, audit configuration, user authorization or SAP object was changed. Client markers and
successful calls still must not be described as independent proof of the mapped SAP username;
that requires an agreed Basis-owned evidence source.

## Real MCP Inspector acceptance (October 13, approximately 18:12–18:29 UTC)

These checks used the actual **MCP Inspector 2.10.1** browser UI, not the custom acceptance
harness. Inspector connected to the isolated app's aggregate `/multi/mcp` endpoint using OAuth,
Streamable HTTP and protocol `2025-11-25`. It ran on loopback with API authentication enabled,
an isolated catalog, in-memory secret storage and token persistence disabled. The sample servers
shipped with Inspector were not connected. The CF app stayed on the same production source and
droplet; no redeployment or restart was needed.

Temporary changes were limited to the previously approved isolated collections and the two test
users. Primary authentication used the normal browser; every secondary authentication used
incognito. Results below were observed in Inspector's rendered tool schemas, protocol responses
and tool results. Token-claim verification belongs to the separate harness evidence above.

| Scenario | Observed result |
|---|---|
| Viewer + exact `A4H/100` | Seven operational tools; no `SAPQuery` or reader `SAPTargets`. The target selector contained only `A4H/100`. `SAPRead(SYSTEM)` succeeded. |
| Ungranted target supplied manually in the JSON editor | `SAPRead(SYSTEM)` for `A4H/001` returned structured `TARGET_NOT_AVAILABLE`; editing the arguments did not bypass the restricted selector. |
| Data + SQL + exact target, fresh secondary login | Eight operational tools, including `SAPQuery`; a fixed SQL marker query returned exactly client `100` and marker value `100`. |
| Data Viewer only, after SQL removal and fresh authentication | Seven operational tools; `SAPQuery` disappeared. `SAPRead(TABLE_QUERY)` returned the same client-100 marker. |
| Admin + Viewer, no target grant | Only `SAPTargets` was exposed. Its four active targets all had `granted: false`, with `grantMode: none` and `TARGET_GRANT_MISSING`; no operational tool was exposed. The known Basic-disabled candidate still made the diagnostic registry state degraded. |
| Restored baseline Viewer, no target grant or Admin | `initialize` and `tools/list` succeeded with an empty tool catalog. This was a valid authenticated no-access state, not a login failure. |

The SQL query was fixed to
`SELECT MANDT, NAME, LOW FROM TVARVC WHERE NAME = 'ZARC1_CLIENT_MARKER'`, capped at two rows.
The data-preview call selected those same three columns and exact marker, also capped at two.
Both returned exactly one row; no SAP object or data was created or changed. `SYSTEM`'s displayed
user identity is not an independent SAP-side username observation, so it does not close the
Basis evidence gap above.

### Session recovery and limits of this client check

- Adding Data Viewer and clearing Inspector's stored OAuth state alone did not update the reused
  primary SSO session: the marker call still returned `INSUFFICIENT_SCOPE` for `data`. This was
  a fail-closed stale-session observation, not a successful Data Viewer test or an ARC-1 defect.
- The bound XSUAA logout reached ARC-1's access-refreshed page. Fresh primary authentication then
  needed credentials; the saved primary credential was rejected once and was not retried. The
  remaining matrix used the already authorized secondary account, whose saved credential worked.
- Subsequent capability changes used both Inspector's OAuth-state reset and bound XSUAA logout,
  followed by a fresh secondary password login. The visible catalog reflected the removed SQL,
  added Admin and finally removed Admin/target grants. This verifies reconnect-time refresh,
  not automatic invalidation of an already-issued token or a live client's cached schema.
- On some callbacks Inspector returned to a disconnected server card. Selecting Connect again
  completed initialization and tool listing; no ARC-1 runtime change was required.
- This is aggregate-route Inspector coverage only. It does not replace the full named-client
  matrix, unchanged standard-mode checks, pinned-route client UX or an LLM-driven Copilot run.
  VS Code 1.140.0 was opened with an isolated, credential-free MCP configuration, but execution
  stopped at its workspace-trust prompt. Without confirmation to trust that folder, the prompt
  was cancelled and only the temporary window was closed; VS Code is not counted as passed.

### Restoration and verification

All six isolated role collections again matched their saved role references, assignments and
mappings, including the secondary user's original Viewer assignment. No temporary Data/SQL,
Admin or exact-target assignment remains. XSUAA descriptors, IAS configuration, destinations,
shared bindings and SAP authorizations were unchanged in this round. The CF app remained healthy
on the same droplet. Inspector was disconnected and stopped, its incognito window and temporary
login tabs were closed, and the user's existing VS Code workspace was preserved. In-memory token
storage and process shutdown are not token revocation.

All 36 harness self-tests and 15 focused documentation/session-recovery tests passed again.
The strict documentation build and `git diff --check` also passed after recording these results.
Before this evidence-only update, all 16 GitHub checks on `9a7c38da` were successful and the branch
contained latest fetched `origin/main` `e0c33892`. No production code fix was needed in this round.

## Exact next input and remaining gates

The saved IAS test credential worked, so another secondary-user password entry is not currently
needed. The core static role matrix now has final-build evidence, but the
[contract's live gates](../plans/xsuaa-target-authorization.md#live-btp-acceptance-gates) are **not
all closed**. In particular:

1. **Backend identity:** the provided SAP login worked, but existing narrowly selected SM20/STAD
   records did not supply the needed evidence. A Basis owner must agree an alternative; do not
   enable broad tracing, create helpers or grant SAP_ALL. No further login alone closes this gap.
2. **Installed clients:** Inspector now has the aggregate Viewer/Data/SQL/Admin, denied-target,
   no-grant and fresh-login catalog checks recorded above. Complete the remaining named-client
   and unchanged-standard cases; VS Code still needs workspace-trust confirmation. The harness is
   not Cursor/VS Code coverage, and the external tester's unversioned success report cannot
   replace these cases.
3. **Application/origin isolation:** reciprocal application acceptance and the same email under
   distinct IdP origins remain untested. A second approved origin/identity fixture is needed.
4. **Optional IAS recipe:** September evidence remains historical. Replay group-fed, static-plus-IAS,
   unrelated-group filtering and lifecycle cases on this build before recommending that recipe as
   final-build verified; do not silently mutate existing IAS mappings or group membership.
5. **Operational limits:** real enterprise-group token/header size, large active inventories and
   durable BTP Audit Log delivery remain unmeasured. The 256-value parser boundary is not a fleet
   sizing guarantee. The documented revocation window still needs operator acceptance.

### Merge recommendation versus customer sign-off

No new code-level blocker was found by this follow-up. The accumulated automated checks, live
static-role matrix, future-target test and initial real-client results support merging the
feature **as the reviewed default-off opt-in**, subject to the final commit's required CI checks.
This is not a claim that every acceptance gate has passed: keep the remaining gates visible and
complete the relevant customer/IAS/client qualification before calling those deployments ready.
Do not weaken the contract or enable enforcement in existing deployments merely to close this PR.

Roadmap checked: **no new roadmap impact**. This closes test-harness gaps in existing PR #677,
not the independent Basis-handbook review (DOC-02) or multi-tenant embedding work (FEAT-59).
