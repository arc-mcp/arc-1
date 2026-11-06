# Independent review: multi-target pinned-write plan

**Date:** 22 October 2026. **Reviewer:** Claude Code 2.1.299, model
`claude-opus-5-5`, effort **max**. The successful CLI result confirmed that exact model;
124 turns, no permission denials. Only Read, Grep and Glob were enabled; MCP servers,
write/shell tools and hooks were disabled. No SAP or deployment operations were performed.

**Code baseline:** `565e6c68db0de3355da94dd5338cf83289fe5e06`.
**Checkout HEAD:** `d146c1b0afd688f8e1c6750746d0bf9e84234c64` (research-only commit).
The first plan and proposed ADR were untracked files during review. The hashes identify the
reviewed drafts, not the revised documents in this PR:

| Reviewed file | SHA-256 |
|---|---|
| `docs/plans/2026-10-22-multi-target-pinned-writes.md` | `e634cd7392928d25043383ee664f5b7961b20bdebf376fda868e0b71a9dc2b8e` |
| `docs/adr/0010-pinned-pp-multi-target-writes.md` | `59fda3472fb61adfb9e613b919672eab8530ec427e18cedd8a07013cd8821218` |
| `docs/research/2026-10-22-multi-target-write-strategy.md` | `83dd7a001f5e41b9a383df825011d8e7ab7d38031baaf828326ac61fa73eaa32` |

[Revised implementation plan](../../plans/2026-10-22-multi-target-pinned-writes.md) ·
[Proposed ADR](../../adr/0010-pinned-pp-multi-target-writes.md)

The review below is preserved as returned. Its deny-actions path reference should be
`src/server/deny-actions.ts`, not `src/authz/deny-actions.ts`. Findings are design
corrections for an upcoming write feature, not claims of reachable multi-target writes today.
See the disposition at the end for accepted changes and adjusted recommendations.

## Verdict

**Changes are needed before implementation goes past the Stage 1 spikes.** The architecture matches every decision you fixed: existing pinned URL only, `/multi/mcp` permanently mutation-free, PP required, `SAP_ALLOW_WRITES` reused, destination opt-in, both restriction layers applied. The new `arc1_write_targets` attribute correctly fixes the "write A, read B" problem. Two plan statements are wrong against current code, and Stage 2/4 tests would lock them in if left. Neither needs a redesign.

**Claims I checked and found correct:**
- xsuaa-auth 1.1.0 already has the `expandScopes`, `userAttributeNames` and `requireUserToken` options the plan relies on (`node_modules/@arc-mcp/xsuaa-auth/dist/xsuaa.js:41-118`).
- `hasRequiredScope` expands scopes itself (`src/authz/policy.ts:330`). Passing raw scopes on the request therefore won't break read checks.
- `MCPAdmin` really carries the raw `write` scope (`xs-security.json:69-80`).
- SAPWrite and SAPActivate input schemas are strict (`src/handlers/schemas.ts:853,953,982`).
- The source hash is compared while the lock is held (`src/adt/crud.ts:238-241`, `src/handlers/write/class-edit.ts:29-35`).
- Activation confirmation sends SAP's own reference list unchanged. The first request can already activate without a prompt (`src/adt/devtools.ts:220-225,299-336`).
- Target-authorization mode is multi-only (`src/server/multi-target-authorization-startup.ts:31-53`).
- Strict PP has no fallback: it throws when no PP token comes back (`src/server/server.ts:425-431`).
- The per-call config builder is shared by the aggregate route (`src/server/multi-target-server.ts:575`). The plan's "write capability is unconditionally false in aggregate mode, including after selecting a target" addresses this correctly.

## Findings

### P1 — fix in the plan before Stage 2

**P1-1. In multi-target mode, uncertain and partial writes are reported to the model as retryable.**
- **Where:** `src/handlers/dispatch.ts:1157-1190` runs a multi-target error classifier *before* the normal error formatter at `:1192`.
  - Network errors become "try again now" (`:748-753`); 5xx becomes "Retry once" (`:809-814`).
  - Both come back with `retryable: failure.retryable ?? true`.
- **Why it matters:** the existing "completion is unconfirmed, do not repeat" messages for uncertain creates and activations (`dispatch.ts:173-207`) are never reached on multi-target routes. Separately, CLAS/INTF create writes the source after the create request without any partial handling (`src/handlers/write/create.ts:839-852`). A failure there takes the same path.
- **Why it's a plan defect:** the plan says to preserve these controls (plan §5 l.200-205; ADR l.23-24). On multi-target routes they are currently overridden, and `dispatch.ts` is in no stage's file list.
- **Correction:**
  - Add `src/handlers/dispatch.ts` to Stage 4.
  - When an outcome is unknown or a write is partial, return a dedicated response with `retryable:false` and the inspection guidance.
  - Add acceptance rows for network errors and 5xx on: the create request, the activation request, and the source save after create.

**P1-2. In standard mode, a destination setting can now stop the whole app from starting.**
- **Where:** plan l.85-90 and ADR l.39-41 refuse startup in `standard` mode when `SAP_ALLOW_WRITES=true` and any enabled PP destination requests writes.
- **What happens today:** such keys only quarantine that one destination (`src/server/destination-registry.ts:268-302`), and discovery failures only degrade the multi-target routes (`multi-target-authorization-startup.ts:21-28`, `server.ts:1240-1264`).
- **Consequences:**
  - A destination owner, or a stale `arc1.allow_writes=true` left over from testing PR #906 that is harmlessly quarantined today, would put an upgraded mixed deployment into a CF crash loop.
  - That outage includes its own writable single-target `/mcp`.
  - Refusing startup adds no security: standard mode can never write to multi-target destinations anyway.
- **Correction:**
  - In `standard` mode, never fail startup because of destination contents.
  - Preferably keep today's per-destination quarantine under a stable reason code, so upgrades change nothing.
  - Update the ADR consequence sentence and add a matrix row.
  - Release notes should also say that in `xsuaa-attribute` mode, destinations quarantined only for write keys become readable for granted users after upgrade.

### P2 — resolve in the plan or at Stage 1–2

**P2-1. The plan doesn't say where the second package list is enforced.**
- `SafetyConfig` holds one `allowedPackages` list (`src/adt/safety.ts:63-75`), and an empty list means unrestricted.
- `enforceAllowedPackageForObjectUrl` returns early when that one list is empty (`src/handlers/write-helpers.ts:940`).
- The real package of an existing object is only resolved inside the handlers (`write.ts:225`, `activate.ts:300-309,412-417`; create checks at `create.ts:524`). A check before dispatch therefore cannot see it.
- **Correction:** carry the destination list in the safety config as a *required* field for multi-target. Make `decidePackageAllowed`, `checkPackage` and `enforceAllowedPackageForObjectUrl` require both lists to pass, so every existing call site enforces both. A missing destination list must mean "deny all", never `[]` (unrestricted).

**P2-2. Admin diagnostics can blow the catalog size limit and take down every target.**
- In enforced mode the complete admin catalog must fit 512 KiB at startup (`src/server/multi-target-catalog-enforced.ts:7,171-190`). If it doesn't, the whole registry becomes unavailable (`destination-registry.ts:790-797`) — reads included.
- The plan allows 8 KiB of package rules per destination (l.76) and up to 256 destinations.
- **Correction:** show only fixed-size fields in the admin target list (`SAPTargets`): requested/effective booleans, rule count, a policy digest and a reason code. Add a startup test with maximum-size lists.

**P2-3. Revocation is weaker than the plan's wording suggests.**
- Measured during PR #677: after a role was removed, both a replayed token and a refreshed one still worked, and a refresh did not pick up newly added scopes (`docs/research/2026-10-13-pr677-final-build-acceptance.md:127-137`).
- Refresh tokens last 30 days (`mta.yaml:302`).
- Plan l.184 ("follows existing token lifetime and qualified refresh behavior") understates this, and l.270 ("refresh client tokens") contradicts the documented role-change procedure (`docs_page/multi-target-administration.md:137-162`).
- **Correction:**
  - State that a removed writer can keep writing until they sign out or the refresh token expires.
  - Document the containment options:
    - **Per user, immediate:** under PP, remove S_DEVELOP from or lock that user's SAP account.
    - **Per target:** set `arc1.allow_writes=false` on the destination and restart every instance.
    - **Global:** set `SAP_ALLOW_WRITES: "false"`.
  - Require sign-out plus a fresh login both to gain and to lose write grants.
  - Decide whether write deployments should use a shorter refresh-token validity.

**P2-4. SAPActivate with no `action` is not handled.**
- `action` is optional and defaults to `activate` (`src/handlers/tools.ts:974-981`, `activate.ts:114`). The policy lookup returns nothing for it (`policy.ts:290-291`).
- The multi-target allowlist rejects calls with no action (`multi-target-tools.ts:109`). So the common call form would fail.
- If an implementer "fixes" that by allowing it, `SAP_DENY_ACTIONS=SAPActivate.activate` would not match, because `deny-actions.ts:166-169` skips action-level patterns when the call has no action. Single-target already behaves this way today.
- **Correction:** treat a missing action as `activate` before the allowlist, scope, deny and audit checks on the multi-target path. Handle the single-target deny gap as a separate fix.

**P2-5. Write tools would be advertised as read-only.**
- The multi-target tool pruning forces `readOnlyHint:true, destructiveHint:false` on every tool (`multi-target-tools.ts:139`). Single-target SAPWrite uses `readOnlyHint:false, destructiveHint:true` (`tools.ts:80-82`).
- Some clients auto-approve tools marked read-only, so writes could run without a confirmation prompt.
- **Correction:** state the annotation rule for the pinned write tools and add it to the acceptance matrix.

**P2-6. "Inspect retries" should name the concrete lock and cleanup risks.**
- Lock, save and unlock pass no request options (`crud.ts:40,164,72`), so transient retries are on by default.
- The retry on a 500 "DB connection broken" calls `resetSession()` (`src/adt/http.ts:545-603`). That clears the cookie jar (`:1223-1227`), which can throw away the SAP session that owns the lock.
- An unlock failing in a `finally` block replaces the original error (`crud.ts:247-249`, `class-edit.ts:58-61`).
- The HTTP layer only honors an explicitly passed cancel signal (`src/adt/http-deadline.ts:68-88`). CRUD passes none, so unlock already always runs.
- **Correction for Stage 4:**
  - Turn off transient retries for lock and save in beta write paths.
  - Keep the session intact during unlock.
  - Attach cleanup status to the result instead of replacing the primary error.
  - Check cancellation only before taking the lock.

### P3 — implementation notes and documentation

- **edit_method include routing:** a method name like `lhc_*`, `lcl_*` or `ltc_*` routes the edit to a class-local include even without an `include` argument (`src/handlers/write/class-surgery.ts:74-75`). The runtime check must reject that derived include, not just the explicit key.
- **Attribute size coupling:** the auth library's 64 KiB limit applies across *all* requested attributes together (`xsuaa-user-attributes.js:97-101`). An oversized write attribute therefore also invalidates the read grant. Plan l.163-164 says the read grant survives; correct it (both fail closed).
- **Wrong "responsible" on PP creates:** create sets the object's responsible user from `client.getEffectiveUser()` (`create.ts:701`). Under PP that returns the XSUAA display name (`client.ts:1493`, `server.ts:433`). Only emails and names over 12 characters are dropped (`src/adt/ddic-xml.ts:185-189`). Omit `responsible` for PP clients, and include it in the "independently confirmed SAP author" check.
- **Local-package proof:** name the concrete checks — `IS_LOCAL` from the lock response plus an empty transport number (`crud.ts:52-54,235`). If non-`$TMP` local packages are ever allowed, use `getTransportInfo` failing closed (`src/adt/transport.ts:1196-1237`), not `resolveCreateTransport`, which skips the check for any `$` package and is best-effort otherwise (`create-transport.ts:14,22-27`).
- **Activation callers:** the plan makes a validation context required at the low-level activation functions. Every existing caller needs an explicit legacy context: `activate.ts:317,422`, `write/create.ts:1182,1206`, `text-elements.ts:250` (deliberately skips the pre-activation check), `rap-generate.ts:327`.
- **Route parameter placement:** make the route a required parameter of `buildMultiTargetConfig` itself, which runs in both `multi-target-server.ts:575` and `server.ts:1441`.
- **Missing from stage file lists:**
  - `handlers/tools.ts` (annotations, descriptions).
  - A pinned-writable scenario in `scripts/ci/check-tool-schema-budget.ts`; today it only covers aggregate (`:162-307`).
- **Role template placement:** note that `MCPTargetDeveloper` must stay out of the `mta.yaml` role collections (`mta.yaml:308-346`). Roles from templates with required attributes are created in the Cockpit.
- **Write scope in OAuth metadata:** define "deployment capability" for advertising `write` as instance-only: `SAP_ALLOW_WRITES` plus `xsuaa-attribute` (`src/server/http.ts:337,769-777`).
- **"Meaningful" inputs:** define it as anything left after empty-value stripping that differs from its default. Also remove prohibited properties from the pinned schema as guidance for strict-schema clients.
- **Ordering wording:** step 2 (l.175-176) says write checks happen before the registry lookup. In code they would run per call in `prepareMultiTargetCall`, after the HTTP route's grant and registry check. That's harmless; reword it.
- **Docs:**
  - Put the cross-client repository impact in the guide's "What works" section.
  - Repointing a destination under the same public ID silently carries over write grants after a restart (`multi-target-administration.md:122`).
  - Link FEAT-93 in the roadmap to the plan and ADR.
  - The research note records baseline `7b210cbf`, while the plan says `565e6c68`. State the gap, which appears docs-only from commit titles, or re-run the focused tests.

## Simplifications consistent with your decisions

1. **Packages:** limit the beta to `$TMP`, and allow only exact names (≤16) in `arc1.allowed_packages`. Prefix and subtree rules and destination-side hierarchy lookups move to Stage 6. This also removes the P2-2 size risk.
2. **Local proof:** for `$TMP`, the lock response (`IS_LOCAL` plus empty transport) is enough. Drop "authoritative evidence for other local packages" from the beta.
3. **Activation validation:** accept only references whose path is the owner's own object URI or one of its includes; reject everything else. No package lookup per reference is needed.
4. **No re-read under lock:** the lock-time locality check already catches an object being moved to a transportable package. Document the remaining move between two local packages as a known gap.
5. **Standard mode:** per-destination quarantine with no startup failure (see P1-2). This means fewer failure modes.
6. **Diagnostics:** fixed-size fields in `SAPTargets` plus the existing startup effective-policy log. Make the separate offline config checker optional.
7. **Raw scopes:** pass identity expansion to the existing multi-target verifier and re-expand once in `requireXsuaaUserBearerAuth`. No wrapper module, no library change.
8. **Stage 6 transport rules:** move them to a non-normative appendix.

## Live evidence this review cannot replace

- **XSUAA:** deploying the new attribute and role template. Role unions across collections (write A/read B; Admin without a write grant; a read `*` grant plus write A). The write attribute's presence in login, refresh and token-exchange tokens. Scope-minimized and old tokens. Token and header size with both attributes. Timing of adding and removing write grants.
- **Clients:** for each supported client — scope requests once the pinned metadata advertises `write`, token reuse between `/multi/mcp` and pinned routes, scope step-up, and cached tool lists.
- **PP and SAP on every target release:**
  - The propagated user recorded as creator/changer and as TADIR responsible.
  - `$TMP` lock responses (`IS_LOCAL`, transport number).
  - Real pre-activation response shapes for CLAS/INTF with includes, other users' inactive drafts, and dependent objects.
  - Uncertain-outcome behavior under timeouts.
  - Lock release after failures and cancellation.
  - Cross-client repository effects.
- **Operations:** rollout and restart across all instances, BTP audit-log entries, and the walkthrough with an unfamiliar operator.

I made no edits and used only Read, Grep and Glob, as you asked.

## Disposition by the plan author

The reviewer identified planning gaps, not an implemented write feature. Source checks confirmed
the issues below; the implementation plan now requires their fixes and corresponding tests.

| Finding | Decision and correction |
|---|---|
| P1-1: misleading retry advice and partial creates | Accepted. Stage 4 now includes `handlers/dispatch.ts` and explicit partial create handling. Unknown/partial mutations must bypass generic read retry guidance and return `retryable:false` in normal/minimal-error paths; test network/5xx at create, activation and post-create source save. |
| P1-2: destination-triggered app outage | Accepted. Standard mode retains per-destination quarantine for write properties. Independent `/mcp` and unrelated targets must stay available. Added the target-filtered upgrade visibility change to the contract/tests. |
| P2-1: second package policy has no enforcement seam | Accepted. Required discriminated safety context, checks in shared package primitives and real-package helper, no empty-global-list shortcut, preservation through per-user/cloned safety. Missing multi-target policy denies. |
| P2-2: complete catalog size | Accepted. Fixed-size flags/counts/digest/reasons only, no policy arrays in the complete catalog; maximum-target/maximum-policy budget regression. The beta is additionally narrowed to `$TMP`. |
| P2-3: revocation | Accepted with qualification. Document measured stale refresh grants and require fresh authorization plus verified permissions. Existing one-hour/30-day settings are not revocation guarantees. Sign-out does not invalidate every outstanding token. SAP-side containment requires owner verification, not a promise of instant session revocation. IAM reviews lifetime settings before pilot without changing single-target defaults. |
| P2-4: omitted activation action | Accepted. Normalize to `activate` before multi-target policy, denies and audit; test both forms. Do not silently fix/redefine single-target semantics in this feature. |
| P2-5: read-only tool annotations | Accepted. Mutation annotations and schema tests are explicit. Added pinned-writable schema-budget coverage and `handlers/tools.ts` to stage 5. |
| P2-6: retries/session reset/error replacement | Accepted in substance. Disable transient beta lock/save replay, retain owning session, preserve primary error plus bounded cleanup status, explicitly thread request options. Retain cancellation checks before later unstarted mutation phases rather than limiting checks solely to pre-lock. In-flight completion can remain unknown. |
| P3: derived include | Accepted. Reject method-name-derived local includes as well as explicit include input. |
| P3: shared attribute limit | Accepted. Attribute-local failure may preserve read grants; exceeding the auth library's shared 64 KiB bound invalidates both. Added a specific matrix case. |
| P3: PP responsible user | Accepted as an implementation qualification. Do not use XSUAA display identity as SAP responsible; omit where SAP supports assignment or require authoritative SAP identity. Verify creator/changer and responsible live. |
| P3: locality | Accepted and simplified. `$TMP` only in the beta; locked saves require affirmative `IS_LOCAL` and empty `corrNr`. Creation still requires live qualification before POST; a lock cannot prove eligibility before an object exists. |
| P3: required activation/route contexts | Accepted. Named both runtime factory callers and all legacy activation call families; explicit legacy context, never missing-context fallback. |
| P3: role placement/OAuth/default inputs/ordering | Accepted. Attribute-bearing roles are created explicitly in Cockpit, not predefined MTA collections. PRM depends on global write switch plus target-filtered mode and syntax. Define meaningful input/default normalization and correct per-call versus HTTP lookup ordering. |
| P3: docs/baseline/remapping | Accepted. Cross-client impact enters the setup introduction. New physical backends require new public target IDs and explicit grants. Added plan/ADR roadmap links, baseline revalidation and 307 rerun tests on the newer main. |

Simplifications retained: `$TMP`-only beta, fixed-size diagnostics, existing bearer boundary rather
than a new auth framework, optional standalone config checker, and transportable writes as a
separate follow-on contract. Existing global package pattern semantics still apply; simplifying the
destination cannot weaken them.

Simplifications adjusted: locality alone is insufficient to replace a real-package check because
an object can move between local packages. Activation can reuse the checked owner's package only
when an exact canonical owner/component relationship is proven; broad URI-prefix acceptance is
insufficient. Cancellation remains checked between not-yet-started phases, with independent bounded
cleanup; review did not establish that all post-lock cancellation must be ignored.

An additional author check clarified that `expectedSourceHash` is content-only and cannot distinguish
identical source on different targets; pinned identity/grants provide that boundary. No new hash or
deployment parameter was added.

No finding is treated as evidence of live PP write acceptance. Stage 1 retains the explicit XSUAA,
client, local-create/lock, activation and identity evidence gates. ADR-0010 remains proposed.
