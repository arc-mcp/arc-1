# PR #677 — Target Authorization Implementation and Validation

Status (2026-09-17): implemented and locally reviewed; **published dependency integration is
complete, but live acceptance remains incomplete. Do not merge/deploy to a customer yet.**

## Baseline and scope

- PR: <https://github.com/arc-mcp/arc-1/pull/677>
- Latest main reviewed and merged: `31690347` (2026-09-17); merge `2814b8f2`.
- Accepted contract: [XSUAA target authorization](../plans/xsuaa-target-authorization.md).
- Architectural qualification: [ADR-0008](../adr/0008-opt-in-xsuaa-target-authorization.md).
- Runtime dependency: published `@arc-mcp/xsuaa-auth ^1.1.0`, locked to `1.1.0` by `a25d62c6`.
  This provides the additive verified-attribute/principal API; the former `1.0.2` did not.

The companion [xsuaa-auth PR #70](https://github.com/arc-mcp/xsuaa-auth/pull/70) is merged and
published as 1.1.0 (npm `gitHead` `1e92a059a3b80341907eece82826c997eb64a1d3`). Registry metadata,
tarball integrity and the installed API were checked. **A clean `npm ci` now reproduces the
implementation without a local tarball or package override.** The September 15 live results below
remain historical candidate-build evidence; they are not silently relabeled as final 1.1.0 runs.

Main's newer instruction builder, tool-discovery filtering and runtime startup paths were reviewed.
Caller authorization must precede construction, selected configs must preserve the opt-in, and the
mixed-route guard must run before any startup network operation. Existing relation/tool-family
restrictions remain in force.

## Published-dependency integration — 2026-09-17

Source candidate: `a25d62c680982fa4769f21ac8701ca161366f3c8`, based on main `31690347`.
The only merge conflict was the HTTP startup return signature: main's returned `http.Server`
for graceful shutdown was retained together with the feature's authorization-mode initialization.
Shutdown, audit-sink and data-policy changes from main were not reverted.

- Clean `npm ci` on Node 24.11.1 resolved registry auth 1.1.0; audit reported zero vulnerabilities.
- **7,021 unit/HTTP tests in 231 files passed**. Typecheck, build, size/schema budgets, action-policy
  validation, all six BTP descriptor profiles and strict MkDocs build passed.
- **21 harness self-tests passed**. Lint exited successfully with three existing informational
  notices; unrelated formatting/configuration changes were not included.
- A frozen security diff review of `31690347..a25d62c6` covered all **33 changed source/config/harness
  inventory entries**, using the supplied security model and independent catalog/runtime and
  harness/descriptor reviews. No reportable candidate was found. This is source-review coverage,
  not proof of live IAM freshness, SAP identity or customer rollout readiness.
- Rebuilt an explicit runtime-only staging directory from the reviewed `dist`, `bin`, manifest and
  lockfile. No local auth tarball, vendor override, `.env`, private fixture or credential file was
  included. Only the isolated app `arc1-ta-677-test` and its previously approved spare route were
  redeployed; no shared XSUAA service, destination, IAS membership or other app was changed.
- CF staged successfully with Node **24.19.0**, Node buildpack **1.9.4**, one 384 MiB instance,
  registry dependencies and zero reported npm vulnerabilities. Startup logs confirmed enforced
  mode and a complete available registry: **four active, one quarantined, zero disabled**.
- **44 unauthenticated live assertions passed**: health; missing/invalid bearer rejection on
  aggregate, pinned existing/unknown and `/authorize` compatibility paths; final private/no-store
  cache headers; and exactly the four mutation-free advertised OAuth scopes. A repeat also passed.
- The restored isolated descriptor still refuses machine-token issuance: HTTP 401 `invalid_client`
  with a grant-type rejection, not bad credentials. The retained key matched a fresh CF key read.
  This is an issuance control, **not** a fresh runtime machine-principal rejection pass.
- IAS administration is accessible. BTP security API calls remain intermittent after CLI login;
  successful mutations/readbacks and cockpit fallback allowed the matrix below. CF SSH readback
  was unavailable due to authorization, so deployment evidence is the reviewed bundle/lockfile
  and successful staging, not a claimed remote `npm ls` result.

The harness's positive SYSTEM assertions prove response success only. Independent SAP user and
client-marker evidence remains required. Remote CI and the authenticated final-build matrix are
tracked separately; neither is inferred from these local and unauthenticated checks.

The first remote CI run after the documentation update caught a stale documentation assertion:
it required the removed `1.0.2`-is-insufficient warning. The local full run above preceded that
documentation edit. Updated the assertion to require the published 1.1.0 statement **and** retain
the incomplete-live-acceptance warning; no runtime assertion or authorization check was weakened.
The final full suite after this correction passed again: **7,021 tests / 231 files** on Node 24.11.1.
The packaged CLI/npx smoke test also passed. The follow-up changes are test/docs only; the deployed
production source remains `a25d62c6`.

Remote clean-install CI on `d780e174` passed the Node 22 and Node 24 jobs, including their required
lint, typecheck, action-policy, budget, packaged CLI and unit checks. Docs, MTA validation,
dependency review and CodeQL also passed. The integration and end-to-end jobs also passed;
these do not replace the isolated XSUAA/IAS acceptance matrix below.

### Published-build secondary-user baseline

The first local harness stopped at 08:37 UTC without receiving a user token. A new harness started
at 08:42 UTC, loading the installed registry auth module. The user completed the fresh-incognito
login for the secondary identity; private expected-email and `sap.custom` origin checks passed.
No role or IAS membership was changed between these three cases:

| Flow | Token bytes | Result |
|---|---:|---|
| Authorization code, 08:43 UTC | 2,049 | 49/49 assertions passed |
| Refresh, 08:46 UTC | 2,072 | 49/49 assertions passed |
| User JWT-bearer exchange, 08:47 UTC | 2,076 | 49/49 assertions passed |

All **147 assertions passed**. SAP xssec verified each token before identity/scope/attribute
assertions. Each contained only the local `read` scope and no `arc1_targets` claim: aggregate
operational tools/catalog stayed hidden, existing and unknown pinned targets returned equivalent
generic 404s, aggregate denials were generic, and private/no-store headers were retained. Refresh
retained the `authorization_code` grant type; exchange used the JWT-bearer grant type and was
accepted as a supported verified user. No SAP execution was authorized in this baseline.

These are final-dependency **no-grant** replays, not a grant-change freshness result. The following
cases then changed only the approved isolated test role collections. Tokens remain memory-only.

### Published-build role/target matrix

The following tokens were issued through user JWT-bearer exchange, using the verified secondary
baseline identity. They are real XSUAA tokens, **not fresh browser-login or refresh-freshness
proof**. Each scenario asserts the independently specified complete target projection, generic
denials, cache headers and permitted tool surface against the deployed HTTP service.

| Case (UTC) | Token bytes | Result |
|---|---:|---|
| Viewer, exact client 100 (08:51) | 2,137 | 116/116 |
| Viewer, clients 001 + 100, corrected positive-SAP fixture (08:54) | 2,188 | 123/123 |
| Data Viewer, clients 001 + 100 (08:54) | 2,258 | 123/123 |
| SQL, clients 001 + 100, confirmed role readback (08:59) | 2,293 | 131/131 |
| Admin, clients 001 + 100 (09:00) | 2,472 | 123/123 |
| Admin, no target grant (09:00) | 2,360 | 58/58 |
| Invalid `*` + `A4H/*` (09:02) | 2,150 | 52/52; complete grant denied |
| Explicit `*` (09:02) | 2,140 | 123/123; four active targets projected |
| 257 values (09:03) | 6,926 | 53/53; complete grant denied |
| 129-byte value (09:03) | 2,310 | 52/52; complete grant denied |
| 256 values (09:04) | 6,908 | 115/115; active client 100 projected |
| IAS-backed role, group empty and no static grant (09:08) | 2,132 | 49/49; valid empty array denied |

These passing replays total **1,118 assertions**, or **1,265 including the three baseline flows**.
The Admin exchange issued all seven local capability scopes, including write/transport/Git;
the multi-target surface still exposed no mutation tools. Admin without grants had diagnostics
but no execution permission. Scale values contain one active target and otherwise unknown exact
IDs: successful token delivery is not a 17+ active-destination/schema test. Data/SQL cases currently
prove scope/tool projection, not independent positive query or destination-ceiling execution.

Two unsuccessful runs are retained separately and excluded from that total:

- The first two-target Viewer scenario passed 128 and failed two positive SAP-read expectations
  for client 001. CF logs showed SAP HTTP 401 / `sap_authentication_failed` after PP preparation.
  Target grants and schema/catalog projection passed. The secondary account was set up for client
  100; the exact client-001 mapping/user cause is not independently established. Corrected only
  the private scenario's positive `allowedTargets` to client 100; it still asserts both grant and
  schema values, with no production-code or SAP-authorization change. Client-001 positive access
  for this identity remains unproven.
- The first SQL scenario passed 121 and failed two expectations because the CLI role-add request
  was still pending and ultimately timed out before backend execution. The token correctly had
  only Viewer/Data scopes. Added the SQL role through the cockpit, verified the exact isolated
  application and collection roles, then obtained a new token: 131/131 passed. Subsequent CLI
  batches use `set -e -o pipefail`; request completion and actual readback, not an empty successful
  JSON filter or a submitted asynchronous command, are required before exchanging tokens.

At 09:08 UTC all temporary static/Admin/capability collection assignments had been removed from
the secondary identity. Its baseline Viewer and unrelated Data Viewer were preserved, alongside
the temporary isolated IAS-backed role needed for the next test. On explicit owner approval,
added only this identity to the existing canonical IAS group `A4H/100` at 09:12 UTC; membership
readback showed one user. The existing exact-name mapping and every other group remained unchanged.
The fresh-incognito IAS-positive login is pending; it is not yet counted as a pass. Restored both
unassigned Matrix/Capabilities collections to empty through the cockpit by 09:19 UTC, verifying
no roles, users, groups or attribute mappings in their saved views. Cleanup of the IAS membership
and isolated IAS-backed role assignment must be recorded after the pending test. The isolated
app and in-memory harness remain running. Focused documentation tests (5/5), strict MkDocs and
`git diff --check` passed for this evidence-only update; deployed runtime source is unchanged.

## Evidence strategy

Use deterministic assertions for security boundaries. LLM-driven exploration supplements them; a
model choosing not to call a hidden target is not proof that the server rejects that target.

| Layer | Assertions and evidence |
|---|---|
| Auth library | Real SAP SDK signature/expiry/audience verification with isolated JWKS fixtures; user/machine classification; immutable allowlisted extraction/status; omitted-option regression |
| ARC unit/HTTP | Real MCP SDK initialize/list/call and HTTP middleware; only external identity/network decisions mocked; assert no outbound call for denied/catalog paths |
| Descriptor | Baseline service with an existing assigned Viewer role, additive update, read back roles/attributes/assignment; no default exact role and explicit all-target default |
| Live CF | Isolated app/XSUAA identity; actual CF gorouter, XSUAA OAuth, IAS user sign-in, Destination/Connectivity and SAP PP |
| IAM matrix | Missing/exact/multiple/union/all-target/invalid/Unrestricted grants with Viewer/Data/SQL/Admin; refresh/revocation and origin/application isolation |
| Size | 50, 100 and 256 realistic values; complete token/header/tool payload sizes and explicit failures; no unexplained truncation |
| LLM-facing | Inspect actual instructions/schemas/catalog, select explicit target, try malicious labels and hidden IDs, verify no remembered/default target or invented entitlement |
| Client UX | Record actual installed-client runs separately from SDK harness tests; do not claim Inspector/VS Code/Cursor coverage from protocol assertions alone |

### Automated cases

1. Legacy default and explicit legacy retain existing inputs, paging and global-reader behavior.
   Empty/unknown opt-in and enforced mixed single-target startup fail before network contact.
2. Zero, one, two, sixteen, seventeen, one hundred and 256 visible targets exercise every schema
   threshold. One target is still explicitly required. Admin without grants gets diagnostics only.
3. Concurrent callers with disjoint grants (including the same email under distinct origins) have
   separate instructions, schemas, data/SQL policy unions and routes. No shared user projection.
4. Hidden/unknown/disabled/quarantined targets have generic denial responses on pinned, aggregate
   and compatibility routes. Unavailable registry ordering is checked with and without a grant.
5. Invalid/expired tokens return 401; valid unsupported machine principals and missing `read`
   return 403 before target or Admin-inventory handling. Check final streaming cache headers.
6. Missing/empty/type-invalid/oversized claims, duplicates, case normalization, unknown IDs, `*`
   combined with bad data, and partial wildcard attempts fail according to the parser contract.
7. Catalog query/admin inputs are bounded; strict offset is rejected. Reader disclosure is limited
   to granted active targets; Admin receives complete bounded diagnostics. The 257th ARC-related
   candidate or oversized serialized catalog disables the snapshot rather than truncating it.
8. Direct tool calls remain authorized even when a client ignores the advertised schema. Data/SQL
   scopes do not override target/instance policies; target grants do not enable mutations.
9. Logs and BTP Audit Log contain internal decision codes and safe counts, not grant arrays,
   roles, groups, tokens, credentials or arbitrary unknown destination-property keys.

### LLM-driven live exploration

After deterministic gates, give the assistant the actual caller's MCP connection and ask it to:

- identify the permitted target without seeing a separate administrator inventory;
- read a known standard class in client 001, then explicitly select client 100 and read its small
  `ZARC1_CLIENT_MARKER` test fixture only where data/SQL permissions allow;
- attempt a known ungranted ID directly, omit the target, switch users, and retry an old selection;
- distinguish a target grant from successful PP/SAP authorization without suggesting `SAP_ALL`;
- interpret Admin diagnostics without treating `granted:false` as execution permission; and
- treat a destination description containing instructions as an untrusted label.

Keep live operations mutation-free and bounded. Do not run ATC/ABAP Unit workload-producing reads,
freestyle business-table queries or destructive mutation attempts just to prove a schema boundary;
cover prohibited calls locally and use tiny known fixtures for positive SAP tests. Keep tokens out
of LLM prompts. The harness validates identity, returns assertion summaries and retains tokens only
for controlled replay/refresh in memory.

## Isolation and setup evidence

On 2026-09-15, CF CLI, BTP CLI and the existing IAS administrator browser session were accessible.
The current multi-system app shares its XSUAA service with three other ARC-1 applications. It is
not used as an in-place experimental authorization target.

- Created isolated XSUAA service `arc1-ta-677-xsuaa`, app identity `arc1-ta-677!t498139`, from main's
  unchanged descriptor first. Broker creation succeeded; the five existing default functional
  roles were read back.
- Created isolated `ARC1 PR677 Viewer` collection for the test identity under the existing business
  IdP origin. Existing production/test-app role collections are left unchanged.
- Updated that same service to the additive descriptor after assigning its baseline Viewer role.
  Broker update succeeded; the existing assignment remained. Read-back confirmed the all-target
  default is exactly `*` and the exact-target template did not create a default role. Created two
  isolated exact roles for `A4H/001` and `A4H/100`; creating them does not prove token issuance.
- Staged `arc1-ta-677-test` with the local auth candidate: one 384 MiB instance on CF Node 24.18.0,
  four active PP targets and one quarantined Basic target. After explicit owner approval, mapped
  the previously unused `mcp-sap-docs.cfapps.us10-001.hana.ondemand.com` route and aligned
  `ARC1_PUBLIC_URL`. No extra route quota or unrelated app changes were required.
- Read the Destination service's configuration independently of ARC-1's catalog to establish the
  complete expected active set: `A4H/001`, `A4H/100`, `A4H-2025/001`, `NPL/001`. Only safe fields
  were retained. All positive SAP tests below use A4H clients 001/100; listing the other targets
  is not proof of their backend connectivity in this run.
- Temporarily enabled client credentials and explicit `read`/`admin` client authorities on the
  isolated service. Real plain and Admin machine tokens were SAP-SDK verified and then rejected
  by the deployed aggregate, compatibility and pinned HTTP routes. Restored the original three
  grant types with no client authorities; the broker update succeeded and another machine-token
  request was rejected. Restoration is not token revocation.
- Created a second isolated XSUAA application, `arc1-ta-677-other-xsuaa`, with no app binding or
  SAP access. Its real token verified against its own service, failed with `wrong_audience`
  against the ARC test service, and received HTTP 401 at the deployed ARC routes. This is a real
  wrong-application **machine** test, not yet a two-human/same-attribute isolation test.
- Used actual primary-user browser authorization-code logins, a refresh and user JWT-bearer
  exchanges. Only isolated role collections were assigned or edited. Primary Admin was removed
  before Viewer/Data/SQL and denial cases; existing unrelated assignments were preserved.
- In the first session, IAS administration was accessible but the subaccount application had no
  dedicated `arc1_targets` mapping. The resumed session below adds only an explicitly approved,
  narrowly filtered test mapping. Secondary-user, IAS-only and combined-grant application tokens
  are now measured below, separately from stale-refresh and browser-display behavior.

All generated secrets, callbacks and fixture credentials belong outside the repository with
owner-only permissions. Record cleanup of test app/service/roles/temporary mappings when finished.
Changes are limited to the isolated app, approved temporary route, XSUAA services/keys,
`ARC1 PR677` collections/custom roles, and the explicitly approved IAS test mapping/membership
described below. No existing destination, unrelated role assignment, shared app binding or SAP
data was changed. Temporary route/app/key/assignment cleanup is recorded below; do not infer cleanup
from a stopped browser or from forgetting a token in the harness.

### Cleanup and retained fixtures

The first acceptance session paused at 16:38 UTC on 2026-09-15 with these verified outcomes:

- Removed all `ARC1 PR677` collection assignments from the primary account. Read-back showed
  none remaining; unrelated assignments were preserved. The secondary account's pre-existing
  isolated Viewer assignment is retained for its pending incognito test.
- `ARC1 PR677 Matrix Targets` and `ARC1 PR677 Capabilities` are empty. Custom scale/malformed/
  exact roles remain unassigned fixtures; no temporary broad grant remains assigned to the primary.
- Restored the primary isolated XSUAA descriptor's original user grant types and removed temporary
  machine authorities. Deleted the second application's test key and unbound XSUAA service, then
  removed its private credential file.
- Stopped only `arc1-ta-677-test` to release its 384 MiB and unmapped the approved spare hostname,
  returning it to its initially unmapped state. Its staged build, three bindings, primary isolated
  XSUAA service/key and owner-only local fixtures remain available for the next acceptance run.
- Stopped the in-memory harness at 16:38 UTC; it reported no persisted tokens. This clears local
  snapshots, not issued-token validity. Existing bearer tokens are not revoked by these cleanup
  actions and remain subject to their original expiry/issuer behavior.

Resume only this isolated fixture, restore its approved mapping and use a new harness/login.
Do not reuse expired callback URLs or treat a previously displayed browser success page as a token.

#### Resumed secondary-user/IAS session

At 18:23 UTC the same isolated app was started and its approved spare route remapped. A new
in-memory harness and a fresh secondary-user incognito authorization-code login were used.
The secondary identity/origin are privately asserted on every scenario; no JWT or password is
recorded here. Its pre-existing isolated Viewer and unrelated assignments were preserved.

- An isolated static `A4H/100` collection was temporarily assigned, tested and removed. The
  subsequently assigned `ARC1 PR677 IAS Targets` collection contains an IdP-backed
  `MCPTargetReadAccess` role: `arc1_targets` maps to the IdP attribute named `arc1_targets`.
- Before configuring that IdP attribute, XSUAA issued a **valid empty array** for the role. ARC
  denied all targets. This is distinct from the absent attribute observed with Viewer alone.
- After explicit owner approval, added one self-defined attribute on **SAP BTP subaccount dev**:
  name `arc1_targets`, source **Expression**, value `${companyGroups:regex[^A4H/100$]}`. Saved
  read-back confirmed the expression and all five existing mappings unchanged: email, family
  name, given name, groups and user UUID. No raw All Groups fallback was introduced.
- Added only the secondary test user to the existing group whose **Name** is `A4H/100` and
  display name is `ARC-1 canonical target A4H/100 spike`. Membership changed from zero to one
  and was read back. A separate pre-existing group has display name `A4H/100` but a technical
  name `ARC1_TARGET_A4H_100_SPIKE`; these are not interchangeable expression inputs.
- Independently read the secondary user's **Assigned Groups**: both the canonical group and
  the pre-existing `ARC1_TARGET_A4H_100_SPIKE` membership are present. The verified IAS-only
  token contains only `A4H/100`, proving exclusion of that nonmatching technical group in this
  fixture. Its existing membership was not changed to make the test pass.
- The first post-mapping flow expired while waiting for the owner. Its callback was correctly
  rejected and yielded no test token. At 19:15 UTC a new authorization request in the same private
  window, after the owner's IAS sign-in, yielded the verified IAS-only grant. A subsequent
  combined static+IAS authorization-code request also passed. These are new authorization codes
  in the private session, not proof that `prompt=login` forced credentials on every request.
- Temporarily added static `A4H/001` through `ARC1 PR677 Matrix Targets`: new user exchange and
  authorization-code tokens both held exactly clients 001/100. Removed that secondary assignment,
  then briefly assigned the exact-001 collection to the primary user. Primary static-001 and
  secondary IAS-100 snapshots passed concurrent, disjoint live calls. Removed the primary
  assignment again and emptied the Matrix collection; no temporary primary grant remains.

After the owner's explicit removal approval, removed only the secondary user's membership from
the canonical `A4H/100` group at approximately 19:31 UTC. IAS read-back showed **Users (0 out of
0)**. The account, group, existing technical-name membership and attribute mappings were not
deleted or modified. The removal/re-login comparisons below ran while the IdP-backed role was
still assigned, so a missing role cannot explain the fresh token's empty attribute.

Final cleanup at 19:39 UTC was verified:

- Removed the temporary `ARC1 PR677 IAS Targets` collection assignment from the secondary user.
  CLI read-back retained exactly its baseline `ARC1 PR677 Viewer` and unrelated `arc1-mcp Data
  Viewer` collections. The primary user still had no `ARC1 PR677` assignments; Matrix remained
  empty after its earlier verified cleanup.
- Stopped only `arc1-ta-677-test` and unmapped the approved spare hostname. CF read-back showed
  requested state `stopped`, zero running instances and no routes. The staged fixture, isolated
  XSUAA service/key and existing service bindings remain available for a subsequent test run.
- Finished the harness; it reported `tokensPersisted:false`. This clears in-memory snapshots,
  not already-issued tokens or the issuer's browser sessions.
- Retained the narrowly filtered IAS mapping and empty canonical group, as agreed. Broadening
  that shared mapping or removing unrelated memberships requires a separate reviewed change.

## Validation results

| Check | Result | Limitation |
|---|---|---|
| ARC-1 unit/HTTP suite | Initial 6,936 tests / 226 files passed repeatedly; after the live audit fix, **6,941 tests / 227 files passed**, including a full Node 24.11.1 run | Local candidate dependency; external identity decisions mocked where documented |
| HTTP enforcement stress | All 29 cases passed with 50 repeats (1,479 executions) after listener correction | Real local HTTP/MCP SDK, not CF gorouter |
| Companion auth suite/CI | 301 tests in 15 files passed; PR #70 CI green on Node 22/24 and peer matrix | Unit fixtures are not live user-token evidence; see separate table below |
| Harness self-tests | 21 passed after adding the missing-versus-empty IdP fixture regression | Harness parsing/assertion/redaction/schema logic only |
| Typecheck, Biome, build, file/schema budgets | Passed | Existing unrelated Biome informational notices remain |
| Strict MkDocs and deployment descriptor checks | Passed | No customer deployment implied |
| Security diff review | No reportable vulnerability found in `96b3f381..c73d56c5`; all 24 selected production/deployment surfaces reviewed | Single source-backed scan, not absence proof; dependency/live gates explicit |
| Baseline-to-additive XSUAA service update | Passed with pre-existing isolated Viewer assignment preserved | Existing customer IAM still needs its own rollout acceptance |
| Real machine tokens, including Admin, and wrong-application rejection | Passed through SDK verification and CF HTTP | Wrong-application human and cross-origin tests remain open |
| CF startup, registry and primary-user PP calls | Passed; real `SAPRead(SYSTEM)` through aggregate and pinned client 001/100 routes | Not a client-marker/data/SQL or second-SAP-user proof |
| Audit diagnostic regression | Fixed, redeployed and rechecked through real CF logs; six adjacent scenario replays passed 421 assertions | Recent CF logs, not durable BTP Audit Log service retrieval |
| Primary-user static grants, role unions, capability matrix and issued-token sizes | Passed as detailed below | No 17+ active destination fixture or installed-client coverage |
| Secondary-user baseline, static/IAS/combined grants and empty IdP value | Verified application tokens, unrelated-group exclusion, two-human disjoint concurrency and fresh-session group-removal denial passed | Independent SAP-user evidence remains open |
| Refresh/reused-session/revocation behavior | Old token, refresh and reused SSO retained the removed grant; fresh private login and its refresh each passed 59 no-grant assertions | Immediate revocation is not provided; customer recovery/window acceptance and cross-origin isolation remain open |
| LLM-driven and installed-client acceptance | **Pending** | Run after deterministic live gates, not inferred from unit tests |

### Real BTP matrix (2026-09-15)

All tokens in this table were issued by XSUAA and verified by `@sap/xssec` before inspecting
claims. `JWT bearer` means a real user-token exchange, **not a new interactive IAS login**.
Sizes are complete access-token bytes, not a promised size for other customers. Positive cases
include private/no-store headers, exact independently specified schemas, explicit target
selection, catalog/denial checks and bounded PP `SYSTEM` reads where configured. Assertion counts
refer to each recorded run; they are not counts of distinct security properties.

| Scenario | Flow / token bytes | Result |
|---|---|---|
| Machine, no ARC scopes | Client credentials / 1,385 | 18 assertions passed; HTTP 403 before catalog/execution |
| Machine with `read` + `admin` | Client credentials / 1,533 | 19 passed; still HTTP 403 |
| Valid user with all isolated app roles removed | JWT bearer / 2,350 | 20 boundary assertions passed; no local scopes, HTTP 403 on aggregate, alias and known/unknown pinned routes; see fixture correction below |
| Other application | Client credentials / 1,522 | 16 passed; own verification succeeds, ARC SDK rejects `wrong_audience`, HTTP 401 |
| Admin, no target grant | Authorization code / 2,522 | 58 passed; only diagnostic `SAPTargets`, no operational tools |
| Admin, exact client 100 | Authorization code / 2,584 | 132 passed; client 100 works, client 001 denied despite Admin |
| Admin, two separately assigned exact roles | Authorization code / 2,608 | 130 passed; union contains exactly clients 001/100 |
| Admin, exact grant by user exchange | JWT bearer / 2,726 | 132 passed; extra assigned write-family scopes do not add mutation tools |
| Viewer / two targets | JWT bearer / 2,536 | 130 passed; exactly `read`, no `SAPQuery`, filtered two-target catalog |
| Data Viewer / two targets | JWT bearer / 2,572 | 123 passed; `read,data`, no `SAPQuery` |
| SQL / two targets | JWT bearer / 2,606 | 131 passed; `read,data,sql`, `SAPQuery` listed; no SQL execution in this harness |
| Explicit all-target role | JWT bearer / 2,514 | 130 passed; four active targets; quarantined Basic/unknown IDs still denied |
| `*` plus invalid `A4H/*` | JWT bearer / 2,525 | 52 passed; complete grant rejected, zero operational tools |
| 50 exact issued values | JWT bearer / 3,473 | 115 passed; all 50 arrive, one active granted target works |
| 100 exact issued values | JWT bearer / 4,406 | 115 passed; all 100 arrive, one active granted target works |
| 256 exact issued values | JWT bearer / 7,318 | 115 passed; all 256 arrive, one active granted target works |
| 257 exact issued values | JWT bearer / 7,301 | 53 passed; ARC rejects entire over-limit set; no truncation-to-access |
| One 129-byte attribute value | JWT bearer / 2,685 | 52 passed; ARC rejects it before normalization |
| Lowercase and padded duplicate IDs | JWT bearer / 2,538 | 116 passed; two issued strings project to only canonical `A4H/100` |
| All target roles removed, Viewer retained | JWT bearer / 2,488 | 52 passed; missing attribute, zero operational tools |
| Concurrent old Admin token and new no-grant token | Existing snapshots | 130 + 52 passed; each retains its own projection in one process |
| Secondary Viewer, no target role | Fresh incognito authorization code / 2,049 | 49 passed; verified intended identity, missing attribute, zero tools, hidden/unknown target denials |
| Secondary Viewer, exact client 100 | JWT bearer / 2,137 | 116 passed after fixture correction; explicit client 100 selector, no reader catalog, aggregate/pinned PP `SYSTEM` succeeds, client 001 denied |
| Secondary Viewer, IdP-backed role before attribute mapping | JWT bearer / 2,132 | 49 passed after fixture correction; valid empty array, zero tools, all target calls denied |
| Secondary Viewer, IAS-only client 100 | Authorization code / 2,162 | 116 passed; exact one-value array and permitted aggregate/pinned PP reads, client 001 denied; no static grant assigned |
| Dedicated IAS mapping excludes nonmatching group | IAS membership read-back + verified IAS-only token | Existing technical-name group remains assigned but does not appear in the exact one-value `arc1_targets` array |
| Secondary Viewer, static client 001 + IAS client 100 | JWT bearer / 2,240; authorization code / 2,213 | 123 passed per flow; exact two-value union and filtered unpaged catalog; PP execution probe limited to client 100 |
| Secondary Viewer after removing the static union role | JWT bearer / 2,189 | 116 passed; only IAS client 100 remains, client 001 is denied again |
| Primary Viewer, static client 001 | Authorization code / 2,461 | 116 passed; client 001 reads succeed and client 100 is denied |
| Two distinct human users, disjoint static/IAS grants | Existing primary-001 and secondary-100 snapshots | 116 + 116 passed concurrently, including each user's known-other-target denial |
| Primary valid user without `read`, strengthened fixture | JWT bearer / 2,350 | 28 passed; SDK-verified user with no local scopes receives `insufficient_scope` and the `read` challenge on aggregate, compatibility and pinned routes |
| IAS group removed, old positive token replayed | Existing authorization-code snapshot / 2,162 | 116 positive assertions still passed: old grant retained, **not** a revocation pass |
| IAS group removed, old session refreshed | Refresh / 2,185 | 77 passed, **25 failed no-grant expectations**; client 100 remained accessible and the new token had a new one-hour lifetime |
| IAS group removed, new code in reused private SSO session | Authorization code / 2,162 | 77 passed, **25 failed no-grant expectations**; issued token still contained client 100 |
| IAS group removed, fresh private session | Authorization code / 2,105 | 59 passed; valid empty array, zero tools, client 100/001 and unknown-target denials across tested routes |
| Concurrent old positive and fresh no-grant tokens | Existing secondary-user snapshots | 116 + 59 passed; each token retained its own projection without cross-request leakage |
| Refresh of the fresh no-grant session | Refresh / 2,128 | 59 passed; empty array and client 100 denial preserved |

The 257-value token is smaller than the 256-value token because its capability/collection
context differs; sizes are measurements, not a monotonic per-value formula. Scale roles contain
one active ID and otherwise valid unknown IDs. They establish claim delivery/header passage and
unknown-ID intersection, **not** 17+ active schemas or 256 connected systems. SAP's attribute
accessor reports these string arrays as `valid`; ARC separately rejects target syntax/128-byte/
256-unique violations. Do not confuse the auth library's shape status with an accepted target grant.

The CLI rejected an invented `attributeValueOrigin=unrestricted` (only IDP/SAML/STATIC accepted),
and rejected an empty attribute list for the required template. No Unrestricted token was issued;
these are provisioning observations, **not a passed runtime Unrestricted test**. The required
attribute and explicit `*` recipe remain unchanged.

After the audit-field fix was deployed at 16:24:51 UTC, six adjacent live regressions passed
421 assertions: malformed mixed wildcard, two exact Admin targets, revoked target grants,
257-value denial, Admin-machine denial and 256-value success. The bounded recent-log sample
contained 18 grant-denial events (5 missing, 5 malformed, 5 over-limit and 3 not granted); all
retained `targetAccessMode` and none contained a grant-array key or JWT-like value. This sample
does not establish long-term retention or successful ingestion/retrieval by the BTP Audit Log
service. The real Logger-to-BTP-sink path is separately unit-tested with only its HTTP transport
mocked.

### Session and refresh observations

- Refresh before changing assignments succeeded and retained an `authorization_code` grant type;
  the candidate classifier accepted the verified user shape. After adding an exact target role,
  refreshing the old token still had no target attribute: the new-grant scenario recorded **7
  failed expectations**. A subsequent authorization-code login obtained the exact grant.
- A later authorization-code login through the reused browser session retained Admin scopes after
  removing Admin. The Viewer scenario recorded **3 failed expectations** (scopes, `SAPQuery`,
  catalog size). A user JWT-bearer exchange reflected the current Viewer/Data/SQL assignments.
  This is evidence that those flows differed; the exact SSO/cache propagation cause is not yet
  isolated by a completed fresh-incognito control.
- The documented XSUAA `/logout.do` flow reached ARC-1's **Access refreshed** landing page, and
  the next login required IAS credentials. That landing page alone does not prove new claims.
  Existing token replay still succeeded until expiry; logout is not bearer-token revocation.
- An early exchange was deliberately rerun with the corrected fixture after a role-assignment
  race: the first expectation still described no grants while XSUAA already issued client 100.
  Its mismatch is not a product defect and is not included as a passing scenario.
- The valid-user/no-`read` fixture initially reused the machine-token expectation `forbidden`:
  HTTP 403 and all 20 other assertions passed, but that error-code assertion failed. Source/HTTP
  regression review confirms this branch intentionally returns `insufficient_scope` with a
  `read` challenge. A boundary-only replay passed 20/20; the harness now has an explicit
  missing-scope fixture and tests reason/challenge checks on aggregate, alias and pinned routes.
  Those strengthened assertions were added after the first harness had loaded its module. The
  restarted harness's 19:20 UTC replay passed all 28 assertions, including the denial reason and
  challenge on every route. No production scope behavior was changed.
- Chrome blocked rendering some loopback callback pages even though the harness had consumed
  the authorization code and completed its assertions. OAuth/MCP success is separately verified;
  callback-page UX and installed-client compatibility remain unproven.
- In the resumed secondary-user test, refreshing the pre-assignment token after adding a static
  target role produced a 2,072-byte token with the old missing attribute. The new-grant scenario
  recorded **50 passed and 5 failed expectations**. A separate JWT-bearer exchange reflected the
  static grant. Refresh success still does not prove permission recalculation.
- Two secondary scenarios initially had incorrect fixtures, not failed authorization boundaries:
  the single-target Viewer fixture expected `SAPTargets` (112 passed, 2 failed), and the unmapped
  IdP role expected an absent claim rather than a valid empty array (48 passed, 1 failed). The
  accepted specification already defines both behaviors. Corrected replays passed 116/116 and
  49/49 respectively, without changing production code. The harness examples now distinguish
  missing and empty attributes and document single-target reader catalog visibility.
- Adding static client 001 to the IAS-only secondary user did not update the earlier token's
  refresh result: it still held only client 100 (2,185 bytes; **97 passed, 17 failed union
  expectations**, including each operational schema enum). New JWT-bearer and authorization-code
  requests both obtained the two-value union. This difference is recorded, not hidden by changing
  the refresh fixture or broadening ARC authorization.
- The first post-mapping login exceeded the callback proxy's 10-minute signed-state lifetime
  while the local harness was still waiting under its separate 60-minute timeout. The expired
  callback did not reach the harness. Starting a new authorization request recovered without
  clearing cookies or relaxing expiry. Chrome then blocked display of the loopback landing page,
  but `login_received` and successful assertions independently proved completed token exchange.
- Source review confirms the harness's `forceLogin` query hint does not force reauthentication:
  the MCP SDK authorization handler strips `prompt`/`max_age` and the candidate proxy does not
  forward them. Therefore the successful post-sign-in IAS/union requests above are labeled new
  authorization-code requests in a reused private session, not repeated fresh credential logins.
  The final fresh-session removal control below is separate. Adding supported upstream
  reauthentication parameters is a separate change.
- After the verified IAS group removal, the old positive token still passed 116 positive
  assertions. Refresh at 19:32 UTC and a new authorization code in the reused private session
  both retained client 100; each failed 25 of the no-grant fixture's expectations. In particular,
  aggregate/pinned client 100 reads still succeeded. ARC was enforcing the issuer's signed old
  grant, not discovering current IAS membership or overriding the token.
- Closed the test's old private window and opened a fresh private session. Its IAS email/password
  form was observed before the callback. At 19:33 UTC the completed authorization-code flow
  yielded a verified empty `arc1_targets` array; all 59 denial/catalog/schema assertions passed.
  The IdP-backed role remained assigned until cleanup. Concurrent replay with the old positive
  token passed 116 + 59 assertions, and refreshing the fresh no-grant session at 19:38 UTC passed
  another 59. The account/group were not deleted to obtain that result.
- The stale refresh produced a new access token with a new one-hour lifetime. Therefore the
  descriptor's one-hour access-token validity is **not an upper bound on time from IAM removal
  to loss of access**. This fixture establishes fresh-session recovery, not the maximum stale
  session/refresh lifetime, an immediate-revocation mechanism, or the exact responsible cache.

Before customer rollout, verify the actual new token and reload the MCP catalog. Do not prescribe
JWT-bearer exchange as a user-facing recovery workaround or silently loop refresh. Use the existing
documented sign-out/new-sign-in workflow and measure the customer's revocation window.

The source scan used the existing security review workflow and preserved its architecture model.
It did not identify a source-backed candidate requiring a vulnerability write-up. The generic
public-denial hardening (`101c1427`) and subsequent test/docs/harness changes were reviewed
separately, outside that frozen scan range. Daybreak access was unavailable for the scan.

### Resuming live acceptance

Use the [persistent acceptance harness](../../scripts/spikes/pr677-target-authorization/README.md).
It keeps access/refresh tokens only in memory, verifies the expected login identity, exercises
actual HTTP initialize/list/call routes, and records assertion summaries rather than token/SAP
payloads. Rebuild/redeploy if the runtime source changes again before testing; a startup result
alone is not evidence of end-to-end behavior.

The static-grant, primary-user capability, issued-value scale and machine/wrong-app cases above
are already measured. The remaining work, in order, is:

1. Published auth 1.1.0 integration, clean local install/tests, remote CI on `d780e174`, and the
   static secondary-user role/target replays are complete. Finish the remaining authenticated
   IAS/principal/isolation cases on this registry-based build and recheck CI after evidence updates.
2. Complete the remaining secondary-user matrix; disjoint two-human concurrency now passed.
   Verify the actual mapped SAP user/client through an independently observed backend identity/marker.
3. IAS-only, static+IAS, nonmatching-group exclusion and fresh-session group-removal denial now
   pass. Agree the customer's acceptable stale-session/refresh window and verify its normal
   sign-out/re-login workflow; fresh private recovery alone is not an operational revocation SLA.
   Keep the optional IAS recipe gated by the remaining acceptance requirements.
4. Finish distinct-origin/tenant checks where available and two human application tokens with
   the same attribute name. Old token versus refresh/reused SSO/fresh private login is now
   measured, including refresh of the fresh no-grant session. The strengthened no-`read`
   denial-reason/challenge fixture also passed in the restarted harness.
5. Exercise 17+ **active** destinations and full catalog payload limits in a separate authorized
   registry fixture; the existing 50/100/256-value tokens are not a substitute. Test wildcard
   admission after an approved inventory reload, and capability/destination/instance ceilings
   using bounded positive data/SQL markers. Verify the live BTP Audit Log service if advertised.
6. Run the bounded LLM-driven and installed-client scenarios above (including callback UX), then
   repeat the critical matrix against the final deployed candidate and record exact versions.

Keep every result explicitly passed, failed or not run. Stop on a failed boundary, fix it, rerun
that case and its adjacent regressions, then continue. A rejected token request or unavailable
network connection is not an authorization pass.

## Findings during implementation

1. The SDK's SSE response writes its own `Cache-Control`, overriding ordinary Express pre-set
   headers. Enforced routes therefore apply the private/no-store policy at the final response
   header boundary while preserving `no-transform`. HTTP assertions cover the actual response.
2. The previous published auth API cannot expose verified attributes or distinguish a valid
   machine-token rejection. The companion change is additive and has its own live acceptance gate;
   do not fabricate `AuthInfo` or decode an unverified JWT to avoid this dependency.
3. Generic target denials previously echoed the caller's requested target/identity in structured
   errors. Strict denials now omit these public fields while retaining internal audit attribution;
   tests compare known-ungranted, quarantined and unknown IDs, including Admin callers.
4. Repeated HTTP tests exposed a macOS listener collision: Supertest implicitly bound IPv6 `::`
   but connected to IPv4 `127.0.0.1`, sometimes reaching an unrelated IPv4-specific service sharing
   that port. A two-server reproduction established the cause. The enforcement test now explicitly
   binds and awaits the IPv4 loopback listener, then deterministically closes it. No authentication
   assertion was weakened; production authentication did not need a workaround.
5. Final operator review corrected rollback instructions: deliberately deploy explicit `legacy`
   through the owning extension and verify the actual CF environment. Deleting a descriptor line
   can leave its previous deployed value intact. Ungranted target denial still precedes any
   registry-availability error.
6. The live harness initially checked tool schema shape without proving its complete target
   projection. Strict success scenarios now require an independently specified `schemaTargets`
   fixture. Aggregate and compatibility-route checks enforce a required string target, exact
   enums through 16 values, the canonical pattern without an enum above 16, and zero operational
   tools for no targets. Seven additional adversarial self-tests guard this acceptance logic.
7. Actual CF logs showed the central secret redactor removed the credential-like key
   `authorizationMode`, losing intended grant diagnostics. Commit `c49ae9b7` renames only this
   audit field to the fixed enum `targetAccessMode`; the redactor and authorization decision are
   unchanged. Four Logger/redactor tests failed before the fix and passed afterward, with an
   additional Logger-to-BTP-sink regression. The deployed recheck is recorded above.

## SAP guidance checked

- [Instance-based authorizations](https://help.sap.com/docs/authorization-and-trust-management-service/authorization-and-trust-management/setting-up-instance-based-authorizations):
  static/default/custom role attributes and IdP-fed values; application code enforces the values.
- [IAS user attributes](https://help.sap.com/docs/cloud-identity-services/cloud-identity-services/user-attributes):
  distinguish the authoritative source and federation/mapping behavior; mapping setup alone is not
  evidence of the final XSUAA application token.
- [IAS groups](https://help.sap.com/docs/cloud-identity-services/cloud-identity-services/groups?locale=en):
  do not confuse an unrelated group list with a dedicated target attribute.
- [IAS flexible expressions](https://github.com/SAP-docs/btp-cloud-identity-services/blob/main/docs/Operation-Guide/configuring-attributes-based-on-flexible-expressions-a2f1e46.md):
  `companyGroups:regex` filters group **Name**, not display name; filtering does not rename an
  arbitrary technical group into a target ID. Group attributes cannot be concatenated. This
  test uses the documented exact-name filter, not an assumed regex replacement or a Neo recipe.
- [Protecting your application](https://help.sap.com/docs/btp/sap-business-technology-platform/protecting-your-application?locale=en-us):
  application authorization artifacts and operator role management remain outside runtime routing.
- [BTP CLI role creation](https://help.sap.com/docs/btp/btp-cli-command-reference/btp-create-security-role?version=Cloud)
  and [specifying role attributes](https://help.sap.com/docs/btp/sap-business-technology-platform/specify-attributes-in-new-role):
  distinguish supported provisioning inputs and cockpit attribute semantics; an invented CLI
  enum is not an Unrestricted-token test.

Open live gates remain those in the accepted specification until measured and recorded here. A
CLI platform login, broker acceptance, mock token or successful Admin smoke test cannot close the
application-token, revocation, isolation, IAS-union or client-compatibility gates.
