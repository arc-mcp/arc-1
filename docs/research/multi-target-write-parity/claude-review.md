# Claude Code review: broader pinned PP write plans

Date: 26 October 2026. Claude Code 2.1.308, model `claude-opus-5-5`, requested effort `max`.
The returned model usage confirms the exact model. Effort is established by the invoked CLI
argument; the reviewer correctly notes it cannot independently observe that setting.

The review completed in 115 turns / 23.3 minutes, with no permission denials. Read, Grep and Glob
were the only available tools; restricted mode, empty strict MCP configuration, disabled hooks,
no shell/edit tools and no session persistence were used. No tests or live SAP calls were made.

Code baseline: `e538bf71197ddb47ea74aca225c340a856d331af`.
These SHA-256 hashes identify the drafts reviewed, before dispositions were applied:

| File | SHA-256 |
| --- | --- |
| `docs/research/2026-10-26-multi-target-write-parity.md` | `7b38c144c5637da21b76ee10a755bce16f1f273e0a65d74a033df3c076335a5e` |
| `docs/plans/2026-10-26-shared-mutation-infrastructure.md` | `bb6eca2951c7367b428a034aa251517cbd092d32c2359d718cb62f4cf5d52e8e` |
| `docs/plans/2026-10-26-broader-pinned-pp-writes.md` | `beeffa80f47962aa9cc176dc5ffa7876133a9e2685525ae92bca1ebf9043443a` |
| `docs/research/multi-target-write-parity/author-review.md` | `57adf26699f301e70a442b5b95efb7670f8d5c1311bfede15f689d2232609663` |
| `docs_page/roadmap.md` | `1c2c67a178c3dd12c848a825af5c6e249523e6f7f3d4e0c0c57a51524e9e2791` |
| `docs/research/multi-target-write-parity/claude-review-prompt.md` | `50d6d1a0fe7a6a363ce408b8750d4460ecc7cf95d8b06fd30e79530f3603b2dc` |

The original report below is preserved verbatim. Its statements about fail-open CTS management
concern a naive future expansion: current multi-target transport mutations remain disabled.
See [dispositions](review-dispositions.md) for corrections and deliberate design choices.

## Original report

# Independent design review: multi-target write parity (PR 1 / PR 2 plans)

**Reviewer:** Claude Code, model `claude-opus-5-5`. I can't observe the effort setting from inside the session.

**Method:** static review at baseline `e538bf71` using only Read, Grep and Glob. I ran no commands or tests, edited nothing, and made no SAP or external calls. These tools can't compute file hashes, so the author should record them with `git hash-object` when filing this review.

**Reviewed:**
- The three planning documents, the author review, and FEAT-93.
- AGENTS.md, the security model, ADR-0010, the ADR-0010 plan and the multi-target write guide.
- The relevant source:
  - multi-target runtime, tools, server, registry, request projection and HTTP PRM routes;
  - `safety`, the pinned write pipeline and policy, `crud`, `http`, `devtools`;
  - CTS (adt layer and handler), `diagnostics`, `flp`, `text-elements`, `manage`, the create and RAP paths;
  - `xs-security.json`.

## Verdict

- **This documentation change: no blockers.** Everything is labelled as proposed, and owner decisions are kept separate from design proposals. The 38 non-Git write/transports actions match `src/authz/policy.ts:87-238`. All local links resolve.
- **PR 1 can proceed once two items are added to the plan.**
  - It needs to say how the pinned request policy reaches the low-level mutation calls (F4).
  - It needs to state what happens to the existing pinned pipeline (F9).
  - The code that is genuinely shared will be small: compare `crud.ts:241-270` with `write/pinned.ts:148-243`. Its real value is the required context type and the rule that a missing context refuses.
  - The characterization tests should pin two subtle legacy behaviours:
    - In `safeUpdateSource`, an unlock failure in `finally` replaces the primary error, and after a successful save it fails the whole call (`crud.ts:266-268`).
    - `localityKnown` is only present on the lock result when request options are passed (`crud.ts:79-85`).
- **PR 2 is not yet ready to guide implementation.**
  - If implemented as written, F1–F3 would produce, respectively:
    - CTS authorization that fails open;
    - text-element writes that can't be built under the current activation contract;
    - SAP user fields taken from the JWT.
  - F5 and F6 need explicit decisions.
  - PR 2 can build on PR 1 without a second mutation stack only if PR 1's context carries required slots for request policy, recording policy, identity mode and activation validator (F4, F9).
  - None of the corrections narrows the scope the owner selected.

**What holds up:**
- Every mutating operation is blocked whenever `multiTargetWrite.enabled` is false (`safety.ts:124`, `multi-target-runtime.ts:107-129`). So aggregate, Basic, standard-mode and writes-off destinations stay mutation-free even for admin, provided PR 2 keeps `multiTargetWrite` on every runtime and derives the new flags from `enabled`.
- The package check against both lists already composes correctly (`safety.ts:178-187, 257-267`).
- Admitting request creation before anything is sent, honest partial/unknown outcomes, and the machine-checked disposition for every action are all sound.

## Confirmed gaps (verified against code)

### High

**F1. The existing CTS write guards fail open under the pinned runtime, and the plan doesn't name this trap.**
- **Evidence:**
  - Every multi-target runtime sets `allowedTransports: []` so that transport reads stay unfiltered (`multi-target-runtime.ts:121`).
  - `checkTransport(…, isWrite=true)` only applies the allowlist when it is non-empty (`safety.ts:350`).
  - Request creation passes `''` as the request ID (`adt/transport.ts:228, 291`).
  - `checkRecursiveTransportReleaseScope` treats an empty list as "explicitly unrestricted" (`adt/transport.ts:550-552`).
  - Release, delete, reassign and remove_object rely only on `checkTransport` (`adt/transport.ts:438, 672, 698-699, 1042-1129`).
  - The destination list and `serverAllowedTransports` are only checked by `checkPinnedRequest` (`pinned-write-policy.ts:22-31`).
- **Impact:**
  - The obvious implementation is to derive `allowTransportWrites` from the global switch and add the actions to the route matrix. That would allow management of every request on the target and pass the recursive "unrestricted" check, ignoring both request lists.
  - The plan's warning ("Do not bypass the legacy … guards by passing an unrestricted fabricated safety object", `broader-pinned-pp-writes.md:221-223`) points the wrong way. The real pinned safety object is already unrestricted for these guards.
- **Correction:**
  - (a) `checkTransport(isWrite)` and `checkRecursiveTransportReleaseScope` should branch on `multiTargetWrite`, the same way `decidePackageAllowed`/`checkPackage` do. They should deny when writes are disabled or the destination list is empty, and check both lists.
  - (b) `checkTransport` is synchronous and checks per ID, while the pinned model works at parent-request level. The adapter should first resolve and freeze a verified request tree, as `inspectPinnedRequest` does (`pinned-write-policy.ts:43-98`), and the guard should accept only IDs from that tree. Otherwise an exact parent-only list denies every task, and a prefix list authorizes things by accident.
  - (c) Set `allowTransportWrites = enabled && base.allowTransportWrites` explicitly. Today it comes from `multiTargetSafety` and is always false (`destination-registry.ts:914`).
  - (d) Write the negative tests from `buildMultiTargetConfig`, not from a hand-built safety object.

**F2. Text-element writes conflict with the pinned activation contract.**
- **Evidence:**
  - `activateTextPool` deliberately uses `preaudit: false` so that SAP's suggested extra objects are not added (`text-elements.ts:201-207, 248-250`).
  - The low-level `activate` refuses `preaudit === false` whenever `multiTargetWrite` is present (`devtools.ts:228-232`).
  - PR 2 promises "whole-pool activation scope" (`:39`), forbids any input that disables activation validation (`:179-181`), and requires text-element callers to carry the pinned context without clearing `multiTargetWrite` (`:190-192`).
- **Impact:** as written, `edit_text_symbols` can't be implemented. Switching to preaudit with a strict validator would refuse whenever the owner has other inactive drafts, which is exactly the case the current code avoids.
- **Correction:**
  - Decide between two options and gate the choice on live evidence:
    - (a) Preaudit with a validator that accepts only the exact text-pool URI, and measure how often it refuses.
    - (b) A narrowly qualified pinned `preaudit=false` mode for the exact pool URI, confirmed afterwards with `readTextPoolState` (`text-elements.ts:219-238`), recorded in the new ADR.
  - Include the PROG/FUGR delete path, which takes a second lock on the text pool (`text-elements.ts:269-300`).
  - Until decided, mark these rows as named-unverified.

**F3. The PP-identity inventory names only the profiler, but several reused paths fill SAP user fields from the JWT.**
- **Evidence:**
  - PP clients set `username` to the JWT `user_name ?? email` (`server.ts:377-385, 443`; `client.ts:279`).
  - **CTS task owner:** explicit-target request creation writes `tm:owner` from it (`handlers/transport.ts:298-304` → `adt/transport.ts:293`).
  - **`adtcore:responsible`:**
    - create, batch create and metadata update use `config.username || getEffectiveUser()` (`write/create.ts:701, 1032`; `metadata-update.ts:54`);
    - `config.username` is empty in the runtime config (`types.ts:280`), so the JWT name is used (`client.ts:1500-1501`);
    - `normalizeAdtResponsible` accepts any non-email value of up to 12 characters (`ddic-xml.ts:185-189`).
  - **Profiler:** the default trace user comes from the same value (`diagnose.ts:1104` → `diagnostics.ts:551`).
  - The qualified pinned create deliberately omits `responsible` (`write/pinned.ts:137-141`).
- **Impact:** if the identity-provider login matches an existing SAP user other than the one Cloud Connector maps to, the reused adapters attribute objects or CTS tasks to that other user. Email values fail outright, and a correct match is coincidence. CTS ownership appears nowhere in the plan (research `:120`; PR 2 `:257-262, :329-330`).
- **Correction:**
  - Add a per-call-site inventory to work package P2-A.
  - Give the pinned context an explicit "mapped user unverified" mode, in which adapters:
    - omit optional responsible and owner fields, so SAP uses the logged-on user;
    - omit `user` when listing CTS requests (SAP then defaults to the logged-on user, per `adt/transport.ts:144-145`);
    - require an explicit native user where the field is mandatory, as for the profiler.
  - Fix the comments that call this username display-only (`server.ts:373-376, 406-408`).

### Medium

**F4. Suppressing replays and enforcing the deadline only reaches calls "that currently accept it", and most mutation calls don't.**
- **Evidence:**
  - Replay suppression is decided per request (`http.ts:539, 551, 707, 776, 800`), and `withStatefulSession` only applies its options when closing the session (`http.ts:287-323`).
  - These take no request options:
    - `updateSource`, `updateObject`, `deleteObject`, `unlockObject` and `initClassInclude` (`crud.ts:90-235, 294-309`);
    - the text-pool PUT (`text-elements.ts:184`);
    - the FLP calls (`flp.ts:229-310`);
    - the trace POSTs (`diagnostics.ts:563, 590`);
    - the ST05 PUT (`:1437`);
    - the formatter PUT (`devtools.ts:161`);
    - the CTS mutations.
  - `postCreate` only turns off transient retries (`create-request.ts:13`), so 401 session-reset, CSRF-403 and 406/415 negotiation replays still happen.
  - PR 1 limits this to calls that already accept options (`shared-mutation-infrastructure.md:68`), while PR 2 promises no replay of ambiguous mutations anywhere (`:154-156`).
- **Correction:**
  - PR 1 should choose a mechanism. One option is a pinned mutation scope that:
    - gives modifying requests `{noReplay, retryTransientErrors:false, deadline, signal}` by default;
    - marks read-like POSTs explicitly;
    - refuses any modifying request that arrives without a mutation policy.
  - Single-target defaults stay as they are.
  - PR 2 then tests, for each enabled matrix row, that every outgoing modifying request carries that policy.

**F5. The recursive CTS rules contradict each other.**
- **Evidence:**
  - R23 and ADR-0010 grant CTS access at parent-request level, including SAP-managed tasks (`security-model.md:311`; ADR-0010 `:30-31`), and PR 2 adopts request-level management (`:212-215`).
  - Yet PR 2 keeps the single-target rule that `release_recursive` needs `*` at both global and destination level (`:227-228`; research `:105-106`).
  - That rule exists only because single-target checks each task ID separately (`adt/transport.ts:549-560, 672`). Under request-level grants, a task attached concurrently to an allowed parent is already authorized.
  - "Stop on unauthorized additions" for recursive delete/reassign (`:229-230`) has no meaning when every child of an allowed parent is authorized.
- **Impact:** with an exact parent list, a writer can release each task and then the parent through plain `release`, but not through `release_recursive`. That is friction without added protection.
- **Correction:**
  - Pick one model in the ADR. I recommend request-level for all pinned CTS management, using the frozen tree to report concurrent additions rather than to authorize them. Single-target stays unchanged.
  - If the `*` rule is kept, name the specific risk it covers that the request-level grant does not.

**F6. Transport authorization granularity and the upgrade path are under-specified.**
- **Evidence:**
  - **Role merge:** XSUAA scopes apply app-wide, and attribute values from all assigned roles are merged into one token. The proposed `MCPTargetTransportDeveloper` reuses `arc1_write_targets` (`:104-106`). So a user holding it for target A plus `MCPTargetDeveloper` for A and B gets CTS management on B. The same happens for anyone holding `transports` through `MCPDeveloper` or `MCPAdmin` (`xs-security.json:57-65, 81-93`).
  - **Recording vs. management:** `arc1.allowed_transports` is already required for any transportable-package write (`multi-target-writes.md:63-70`). PR 2 also makes it the admission check for management (`:217-220`). With the global transport switch on, an operator can't enable transportable source writes without also enabling release, delete and reassign for every `transports` holder.
  - **Deny list:** `SAP_DENY_ACTIONS` applies instance-wide (`multi-target-runtime.ts:55`), including the single-target `/mcp`.
  - **Upgrade:** the shipped guide tells operators to manage requests through a separately authorized single-target connection (`multi-target-writes.md:39-40, 70`). Some deployments therefore already run `SAP_ALLOW_TRANSPORT_WRITES=true` and will gain pinned CTS management on upgrade.
  - **Truth table:** it has no transport rows (`:115-123`).
- **Correction:**
  - State the app-wide behaviour in the ADR, the docs and the role description.
  - Add truth-table rows for the combinations of:
    - the global transport switch;
    - the `transports` scope;
    - the destination list (absent, exact, `*`);
    - an existing single-target transport configuration.
  - Name that single-target case in the upgrade note.
  - Design options are in A2.

**F7. The existing batch limit doesn't fit the shared five-minute budget.**
- **Evidence:**
  - `BATCH_CREATE_MAX_OBJECTS = 100` (`batch-results.ts:4`), PR 2 keeps the existing limits (`:196`), and nested creates, saves and activation share one five-minute budget (`:154-156`).
  - The qualified pinned sequence is roughly ten SAP requests per item before activation checks (`write/pinned.ts:114-243`).
- **Impact:** ordinary 100-item batches would routinely hit the budget and end as partial or unknown outcomes.
- **Correction:** derive the pinned batch limit, and the proposed 100-owner activation limit, from measured per-item cost. Reject input that won't fit before the first mutation.

**F8. The ST05 default can widen to all users.**
- **Evidence:**
  - `setSqlTraceState` only replaces the user filter when a user is supplied (`diagnostics.ts:1432-1436`). Otherwise it keeps whatever filter is there, which may be empty, meaning all users.
  - Blank strings are stripped before dispatch (`object-types.ts:203, 222-224`).
  - The plan's "never silently widen" rule (`:257-262`) is written for the profiler. The ST05 paragraph (`:271-277`) sets no default.
- **Correction:** on pinned routes, `sqlOn=true` should either require an explicit SAP user, or refuse when the resulting filter would be empty unless a documented all-users input is given. Report the final filter from a read-back.

**F9. Neither plan says what happens to the existing pinned pipeline.**
- **Evidence:**
  - SAPWrite decides it is on a pinned route from config flags (`write.ts:65`); SAPActivate decides from `safety.multiTargetWrite` (`activate.ts:115`).
  - Neither plan says whether CLAS/INTF main-source writes stay in `handlePinnedWrite` while every other type goes through adapted single-target handlers.
- **Impact:** that split would leave two pinned code paths for overlapping operations, such as CLAS main source versus CLAS includes and surgery.
- **Correction:** state the target architecture, and use a single check for "pinned mutation context", derived from the PR 1 context.

### Low

- **F10. FLP replay wording is inaccurate.** "Keep the existing no-replay create behavior" (`:296-297`) isn't true today: FLP creates only turn off transient retries (`flp.ts:238, 254, 277, 298`), and `deleteCatalog` uses the default retries (`flp.ts:309`).
- **F11. The formatter adapter doesn't preserve fields.** "Preserve read/modify/write fields" (`:280`) isn't met by the current adapter:
  - it sends only two attributes (`devtools.ts:160-161`);
  - it turns unknown styles into `keywordUpper` (`devtools.ts:141-144`; `lint.ts:99-104`).
  - The code comments also call these settings "system-wide" (`devtools.ts:125, 152`).
- **F12. There are no freshness rules for delete or the RAP helpers.**
  - Delete has no content precondition (`editable-source.ts:36`).
  - The RAP helpers edit up to three class sources without a hash path (`rap-generate.ts:300-308`), and generation activates by default (`rap.ts:218`).
  - The plan should state the rule for each.
- **F13. Budget and package defaults collide.**
  - Release allows `timeoutSeconds` up to 1800 (`schemas.ts:1343`), against the five-minute pinned budget.
  - Creating a request without a package defaults to `$TMP` (`adt/transport.ts:230`). Combined with the plan's check of the routing package against both lists (`:238`), destinations that don't allow `$TMP` can't create a request without naming a package.
- **F14. Reader exposure and labelling are unclear.**
  - The plan doesn't say whether the new read companions (`flp_list_*`, `layers`, `targets`, `format`, `get_formatter_settings`) appear for readers and read-only destinations. `pruneDefinition` doesn't currently know which route it is pruning for (`multi-target-tools.ts:128-218`).
  - PR 2 `:252-253` states "no new per-operation permission system" as settled, while the research labels it as proposed (`:82-86`).

## Design alternatives (owner or design calls, not defects)

- **A1. Require the raw `transports` scope.**
  - Raw scopes are already available (`http.ts:513-520`), so this would mirror ADR-0010's raw-write rule (`multi-target-request-projection.ts:28-29`) instead of letting admin imply transports.
  - The practical difference is small, because `MCPAdmin` already includes raw `transports`.
- **A2. Per-target CTS control.** Either option is a capability control, not an upgrade acknowledgment, and either is the owner's call. If neither is adopted, document F6's behaviour.
  - (a) Add an exact-ID `arc1_transport_targets` attribute to the new role template.
    - It costs nothing extra for users who need the new role anyway.
    - It would hold back CTS management from users who already have `transports` through `MCPDeveloper` or `MCPAdmin`.
  - (b) Add a destination-level opt-out by reusing the reserved `arc1.allow_transport_writes`, which is currently quarantined (`multi-target-destination-config.ts:19-25`).
- **A3. Sequence PR 2 as several PRs.**
  - First, the ADR plus gate plumbing with no new capabilities.
  - Then one PR per domain, each enabling only fully qualified rows, with the parity claim at the end.
  - This is sequencing, not narrowing, and it allows deeper security review of an XL change.
- **A4. Document the explicit CTS `target`.** It lets callers route new requests to any configured TMS target or group. Workbench requests are cross-client, so request lists for two clients of the same SID overlap. An optional target allowlist is possible.

## Uncertain concerns (need SAP evidence)

- **U1. Implicit CTS recording by FLP, API state, publication and package moves.** Any request chosen implicitly bypasses "both request policies".
  - **What we know:**
    - FLP writes are client customizing (`flp.ts:272`) and pass no request.
    - API state accepts `?request=` (`api-release.ts:209`).
    - `change_package` takes a request assigned by SAP during its preview step (`refactoring.ts:143-148`).
  - **What to establish:** the recording behaviour of each. Then validate any SAP-chosen request before the executing call (possible between `change_package`'s preview and execute steps), or refuse when recording can't be established before sending.
- **U2.** How text-pool preaudit actually behaves on 750, 758 and 816; needed to decide F2.
- **U3.** Whether formatter settings are per user or system-wide when reached through PP.
- **U4. ABAP Unit becomes a direct execution path.**
  - PR 2 enables editing test classes and PROG/FUGR.
  - `SAPDiagnose.unittest` needs only read scope and is available to pinned readers (`multi-target-tools.ts:63-82`). So "harmless" tests that someone authored can run arbitrary code under whoever runs them.
  - R23 covers this in general terms (`security-model.md:309-310`). The new ADR should name this direct path and the deny-action mitigation.

## Pre-existing issues found (outside this change; record separately)

- **P1. Wrong default user on pinned read routes.** `SAPTransport.list` and `SAPDiagnose.trace_requests` default to the JWT name (`handlers/transport.ts:222`, `diagnose.ts:1114`). This returns another SAP user's data, or nothing. Fixing it is a deliberate change to read behaviour.
- **P2. Misleading comments.** Comments describe the PP username as display-only (`server.ts:373-376, 406-408`), which is false (see F3).
- **P3. Unpublish still replays.** `unpublishServiceBinding` keeps the default transient replay (`devtools.ts:641-650`), unlike publish (`:633-637`).

## Remaining qualification gates

| Gate | Evidence required before claiming the row |
|---|---|
| CTS policy (F1, F5) | **Unit:** pinned CTS guards built from the real runtime config; acceptance limited to the verified tree; empty, exact, prefix and `*` lists at both levels. **Live:** create under `*` at both levels; release, delete, reassign and remove under an exact parent list; a task attached concurrently; released and unknown states. Use a target with no downstream import routes, or record approved import-queue effects — release is irreversible, and the live plan (`:352-355`) doesn't address that. |
| Text pools (F2, U2) | The chosen activation mode, with state evidence on each release. |
| PP identity (F3) | For each call site, proof that omitting responsible/owner yields the mapped user; an explicit trace user; a negative test with a second identity. |
| No replay (F4) | Per-row assertion on outgoing requests; injected 401/403/415/429/5xx on every mutation call. |
| Budgets (F7, F13) | Measured per-item cost; chosen limits for batches, activation and release. |
| ST05 (F8) | Default and filter behaviour; read-back; restoring the previous state. |
| FLP (U1) | Cloud Connector exposes `/sap/opu/odata/UI2/PAGE_BUILDER_CUST`; CSRF works; behaviour in a client with automatic recording; group membership read back without `$filter` (`flp.ts:205-227`). |
| API state, publication, package move (U1) | Which request is selected and how it is recorded, per release. |
| OAuth (F6) | A fresh token with `transports`; pinned resource metadata advertises it; a two-role merge test that proves the documented app-wide behaviour. |
| Release matrix | Representative 750, 758 and 816 PP routes, distinguishing unsupported from unverified. |

**Limits of this review:** this is a static design review. I ran no tests, builds or SAP calls. SAP-side behaviour is inferred from code and comments only; the U-items mark where that matters. All findings are against baseline `e538bf71`.
