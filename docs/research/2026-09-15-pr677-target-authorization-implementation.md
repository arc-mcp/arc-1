# PR #677 — Target Authorization Implementation and Validation

Status: implemented and locally reviewed; **live acceptance and portable dependency integration
remain incomplete. Do not merge/deploy to a customer yet.**

## Baseline and scope

- PR: <https://github.com/arc-mcp/arc-1/pull/677>
- Latest main reviewed and merged: `5bc5310b` (2026-09-15); merge `96b3f381`.
- Accepted contract: [XSUAA target authorization](../plans/xsuaa-target-authorization.md).
- Architectural qualification: [ADR-0008](../adr/0008-opt-in-xsuaa-target-authorization.md).
- Runtime dependency: additive `@arc-mcp/xsuaa-auth` verified-attribute/principal API. The published
  `1.0.2` does not provide it. A local candidate is used for tests; release/portable dependency
  integration must be resolved before this PR is merge-ready.

The companion candidate is preserved on local branch `codex/verified-xsuaa-user-attributes`,
commit `32d32b4338f787a0f541421d3fbeb4c23aafb0ab`, in the `arc-mcp/xsuaa-auth` repository. It is not
published or pushed. ARC-1's committed manifest/lockfile still select the published dependency:
**a clean `npm ci` is not yet a reproducer for this implementation**. Tests and the isolated CF
bundle explicitly used the local candidate without adding a machine-specific dependency to the
repository. Publish/integrate the companion and repeat clean-install CI before removing this gate.

Main's newer instruction builder, tool-discovery filtering and runtime startup paths were reviewed.
Caller authorization must precede construction, selected configs must preserve the opt-in, and the
mixed-route guard must run before any startup network operation. Existing relation/tool-family
restrictions remain in force.

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
- Staged `arc1-ta-677-test` with the local auth candidate. It started as one 384 MiB instance and
  discovered four active targets plus one quarantined entry. It has **no mapped route**. The
  explicit HTTPS `ARC1_PUBLIC_URL` permits OAuth initialization but is not an allocated endpoint.
  Rebuilt and repushed the final runtime source through `101c1427`; CF reported one running
  instance on Node 24.18.0. The private manifest now retains the required explicit public URL.
- Obtained an actual XSUAA client-credentials token from the isolated service, validated its
  signature through the candidate SAP SDK verifier, and confirmed the user-only verifier rejected
  it as a machine principal. The token had zero ARC capability scopes and was 1,385 bytes. This
  proves neither the Admin-machine fixture nor HTTP/gorouter denial. The isolated descriptor
  temporarily allowed that grant for this check; the original three grant types were restored and
  the broker reported update success. No token was printed or saved.
- The organization currently has all ten permitted routes allocated. A spare route is unmapped;
  temporary use requires the owner's confirmation. Do not delete/reassign unrelated routes or
  stop unrelated applications to obtain quota.
- The IAS administrator browser session expired during inspection. Actual application-user login
  is still needed in a fresh incognito window; CF/BTP CLI logins cannot replace it.

All generated secrets, callbacks and fixture credentials belong outside the repository with
owner-only permissions. Record cleanup of test app/service/roles/temporary mappings when finished.
The isolated app, service/key, collection and exact roles are retained for the pending live matrix.
The app was stopped after its successful final startup check to release the remaining 384 MiB of
org capacity while route/login approval is pending; its staged droplet remains available to start.
No shared application binding, existing destination, unrelated role assignment or SAP data was
changed. No temporary route mapping exists to remove.

## Validation results

| Check | Result | Limitation |
|---|---|---|
| ARC-1 unit/HTTP suite | 6,936 tests in 226 files passed in three consecutive final runs, plus a Node 24.11.1 run | Local candidate dependency; external identity decisions mocked where documented |
| HTTP enforcement stress | All 29 cases passed with 50 repeats (1,479 executions) after listener correction | Real local HTTP/MCP SDK, not CF gorouter |
| Companion auth suite | 301 tests in 15 files passed, including real SAP SDK/JWKS fixtures | Fixtures are not IAS-issued user tokens |
| Harness self-tests | 19 passed | Harness parsing/assertion/redaction/schema logic only |
| Typecheck, Biome, build, file/schema budgets | Passed | Existing unrelated Biome informational notices remain |
| Strict MkDocs and deployment descriptor checks | Passed | No customer deployment implied |
| Security diff review | No reportable vulnerability found in `96b3f381..c73d56c5`; all 24 selected production/deployment surfaces reviewed | Single source-backed scan, not absence proof; dependency/live gates explicit |
| Baseline-to-additive XSUAA service update | Passed with pre-existing isolated Viewer assignment preserved | Real user claims/role unions not yet measured |
| Real technical-token signature and user-only rejection | Passed | No ARC scopes; verifier boundary only |
| CF startup and registry discovery | Passed | No routed MCP/IAS/SAP end-to-end call yet |
| User-token, IAS, revocation, origin/application isolation and live size matrix | **Pending** | Usable route, application-user login and IAS admin session needed |
| LLM-driven and installed-client acceptance | **Pending** | Run after deterministic live gates, not inferred from unit tests |

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

Resume in this order: missing grants; one exact target; two exact targets/role union; Admin without
grants; explicit `*`; scope/ceiling combinations; IAS-only and static+IAS unions; old token versus
refresh versus fresh login after removal; concurrent callers and wrong application/origin;
50/100/256 issued-value measurements; then the bounded LLM/client scenarios above. Keep each
result explicitly passed, failed or not run. Stop on a failed boundary, fix it, rerun the failing
case and its adjacent regression cases, then continue. Do not count a rejected token request or
unavailable network connection as an authorization pass.

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

## SAP guidance checked

- [Instance-based authorizations](https://help.sap.com/docs/authorization-and-trust-management-service/authorization-and-trust-management/setting-up-instance-based-authorizations):
  static/default/custom role attributes and IdP-fed values; application code enforces the values.
- [IAS user attributes](https://help.sap.com/docs/cloud-identity-services/cloud-identity-services/user-attributes):
  distinguish the authoritative source and federation/mapping behavior; mapping setup alone is not
  evidence of the final XSUAA application token.
- [IAS groups](https://help.sap.com/docs/cloud-identity-services/cloud-identity-services/groups?locale=en):
  do not confuse an unrelated group list with a dedicated target attribute.
- [Protecting your application](https://help.sap.com/docs/btp/sap-business-technology-platform/protecting-your-application?locale=en-us):
  application authorization artifacts and operator role management remain outside runtime routing.

Open live gates remain those in the accepted specification until measured and recorded below. A
CLI platform login, broker acceptance, mock token or successful Admin smoke test cannot close the
application-token, revocation, isolation, IAS-union or client-compatibility gates.
