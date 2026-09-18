# PR #677 — Claude review disposition

Date: 2026-09-17. Review supplied by the maintainer against `1a9ab4e6`; evaluated against
`91839ad5` and the accepted [ADR-0008](../adr/0008-opt-in-xsuaa-target-authorization.md).
This records the applicable fixes, not a new design or a claim of customer readiness.

## Outcome

**Applicable findings fixed locally and regression-tested.** The narrow changes preserve legacy
opt-in behavior, explicit IAM `*`, Admin diagnostics without execution bypass, and the explicitly
requested complete/unpaged enforced catalog. Neither the blanket “35 findings confirmed” verdict
nor the proposed 4,500-line deletion is adopted without checking the accepted contracts.

The review found useful bugs and test gaps around the existing enforcement path. The optional
internal arguments were a hardening issue, not a demonstrated production authorization bypass:
the prior production startup supplied the mode and earlier tool checks rejected missing grants.
The new contracts nevertheless refuse omissions and contradictions explicitly.

## Applied

| Review claim | Decision and evidence |
|---|---|
| Overlay extends the wrong parent | Confirmed. It now extends `arc1-multi-pp-example`. Reproducing the former sibling-parent chain with SAP `mbt mtad-gen` fails; the corrected chain produces the expected mode, cache and safety properties. CI checks the generated descriptor, not just YAML validity. No live `cf deploy` was performed, so silent-dropping behavior is not claimed as locally observed. |
| Restricted roles broaden access during rollout/rollback | Confirmed operational gap. Keep the tested additive role templates and their `read` scope; prepare unassigned roles, enable/verify enforcement, then assign restricted users. Pilot isolation and no old-mode overlap are explicit. Downgrade reviews the whole reader population and outstanding token/refresh sessions, not only target grants. |
| Unicode normalization manufactures grants | Confirmed with five failing pre-fix regressions. Raw byte limits run first, then an ASCII gate before trim/case conversion. Long-s, BOM/invisible-star and Unicode-whitespace cases now deny the entire set. Existing ASCII lowercase/whitespace, exact IDs and literal `*` remain supported. |
| Invisible label characters reach instructions | Confirmed. Share the existing display-only NFKC/control/format-character normalization between registry labels and diagnostic projection. HTTP initialize/catalog tests cover bidi, zero-width and Unicode tag characters. Connection fields and IAM grants are not display-normalized. |
| Outage reported as an IAM problem | Confirmed. The caller-safe no-target message directs the ARC-1 administrator to check grants **and** target configuration/availability, without disclosing hidden target IDs. Unavailable/quarantined cases are tested. |
| Optional routing mode / conflicting modes | Hardened. The internal routing mode is required and runtime-validated; it must match configuration before routes mount. Direct handler factories also reject an omitted mode. Legacy callers pass `legacy` explicitly. |
| Optional catalog enforcement fallback | Hardened and simplified. Removed the optional legacy/enforced catalog adapter. The enforced handler calls the enforced builder directly and requires its request projection. No silent legacy branch remains there. |
| Verifier wiring not tested | Confirmed. The HTTP mock now emits attributes only when the allowlist is requested. Tests also assert `requireUserToken`, the exact allowlist, and unchanged baseline verifier options. |
| Startup wiring not tested | Confirmed gap. New tests exercise real startup orchestration with only external boundaries mocked: discovery/registry/HTTP mode flow, 257-candidate handling and mixed-route rejection before network access. |
| Per-user one-target instructions untested | Confirmed. Interleaved/concurrent HTTP initialize calls for disjoint grants verify each instruction set includes only its own target. |
| Empty tools can pass the harness | Confirmed. A nonempty positive schema projection now requires operational tools; empty/catalog-only responses fail. Zero-grant cases still permit the specified empty result. |
| Pending/callback label collision | Confirmed. A shared reservation spans registration, pending login and callback exchange; imports/refresh/exchange/machine flows use the same check. Failure/expiry releases the reservation; established sessions cannot be overwritten. Offline tests cover the label lifecycle and combined 32-session bound. |
| TLS diagnostic flag aliases | Confirmed. Guard hyphen/underscore aliases and quoted `NODE_OPTIONS` before private input. This is accidental-disclosure protection in a trusted runtime, not a malicious-runtime sandbox. |
| Harness absent from CI | Confirmed. Add offline tests on both Node CI versions, syntax-check every maintained harness entry point, and include the directory in Biome and the size ratchet. It remains JavaScript, not purportedly TypeScript-checked. Live credentials are unnecessary for these checks. |
| Prose tests depend on line wrapping | Confirmed. Normalize whitespace before semantic documentation assertions. Keep checks protecting opt-in, rollout, capability and readiness statements. |
| Literal target limits / duplicated text sanitization / stale comments | Consolidate the deployment limit without conflating the separately specified grant-count limit; share display normalization; restore the native SQLite dynamic-import explanation; tighten the reduced startup file budget. |
| Agent instructions contradict the new feature | Qualify the v1 prohibition with ADR-0008 and route agents to the accepted contract. Remove volatile dependency/test status from the terse configuration row. |
| Temporary-branch documentation links | Replace the operator page's branch URLs with immutable reviewed-commit links; deleting the working branch must not break them. |
| SQL can address another client's rows | Document the pre-existing capability limitation. Grants govern destination/logon-client selection, not row isolation. SQL remains default-off; strict client-row isolation needs a separately reviewed backend solution. No cross-client SAP query was run during this review. |

## Not adopted, and why

| Proposal | Disposition |
|---|---|
| Delete the bearer adapter because the SDK returns 403 | Not equivalent. The adapter intentionally omits the SDK's `insufficient_scope`/`WWW-Authenticate` challenge for a supported-user-principal denial. The accepted contract forbids inviting futile re-login. Correct the obsolete 500 rationale, retain behavior and tests. |
| Replace the grant parser with the tool-input normalizer | Rejected: tool inputs are forgiving, IAM grants must not Unicode-fold into privileges. The newly reproduced finding makes this distinction intentional. Raw/UTF-8/unique bounds also remain policy. |
| Replace the whole implementation with a filtered legacy registry | Not adopted. The proposed passing subset is not proof of the accepted full contract: complete Admin diagnostics, separate reader projection, unknown/partial counts, finite serialization and zero/one/many schemas matter too. Removing those requires a new product/ADR decision. |
| Remove the unpaged catalog, 256-candidate ceiling, 512 KiB budget and size preflight | Rejected for this task: complete unpaged `SAPTargets` was explicitly requested for multi-system debugging. Its bounded-resource controls stay with it. Runtime checks still protect construction/serialization boundaries. |
| Merge catalogs because they give different health totals/order | Their contracts differ deliberately: legacy pagination versus enforced complete totals, projected grants and deterministic diagnostics. Removed only the unnecessary switching adapter, not the contractual differences. |
| Derive completeness solely from `registry.failure` | Retained evidence fields: interrupted discovery knows a lower bound, not an exact total; other failures have different completeness. Do not replace explicit evidence with inference from a failure code merely to shorten the code. |
| Remove projection/read checks, startup validation or private-header layers | Retained boundary checks for direct constructors, runtime setup and HTTP entry points. Middleware order alone is not the only supported path; `on-headers` protects final SDK writes, and its idempotence guard prevents duplicate hooks. |
| Delete audit grant context, safe diagnostic reprojection, or empty enforced precompute | Retained accepted debugging, secret-safe projection and default-deny construction contracts. Admin diagnostics must not become execution grants or expose unsafe destination metadata. |
| Delete test matrices/harness/history wholesale | Not justified by a finite mutation sample. Keep named regressions and reproducible live acceptance tools; now run their offline oracles in CI. Preserve historical build-specific evidence while outstanding gates remain. Larger documentation consolidation can follow release, with links and evidence retained. |
| Remove candidate/readiness banners now | Not yet: final-build live acceptance is still incomplete. Removing them would imply readiness the evidence does not support. |
| Remove legacy startup-mode log | Already refuted: the accepted opt-in/rollback contract requires observable effective mode. |
| Alias/public-ID takeover is a new bypass | Not a new defect: ADR-0008 explicitly trusts destination/IAM administrators and binds grants to public IDs. Repointing/reusing one requires the operator's security review. |
| Rewrite repeated type unions | No demonstrated behavior defect; TypeScript checks their compatibility. Leave unrelated refactoring out of this security/deployment follow-up. |

## Verification

Node 24.11.1, published locked `@arc-mcp/xsuaa-auth` 1.1.0:

- Pre-fix focused reproduction: five Unicode cases failed; after the fix they pass.
- Focused runtime/startup/descriptor/docs suite: **185 tests / 9 files passed**.
- Full unit suite: **7,040 tests / 232 files passed**.
- Offline harness: **24 tests passed**, including syntax checks without executing live requests.
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run validate:policy`, and
  `npm run check:sizes`: passed. Lint retains three pre-existing informational notices.
- `npm run btp:validate`: all existing profiles plus actual merged-descriptor assertions passed.
- Old sibling-parent overlay in a temporary fixture: expected MBT failure reproduced; no CF deployment.
- `mkdocs build --strict`: passed.
- `npm run test:npx-smoke`: built-bin and package-name executable smoke tests passed.

An independent read-only security-boundary investigation preceded the patch; a fresh candidate
review found no concrete surviving bypass or regression in scope and independently repeated the
focused runtime/harness/MTA checks. This is source/local verification, not live acceptance.

## Remaining gates

No IAS membership, role collection, XSUAA service, destination, CF app or SAP data was changed here.
The earlier deployed build/results remain historical evidence, not a test of this new patch.
Keep PR #677 draft until the [remaining final-build acceptance](2026-09-15-pr677-target-authorization-implementation.md)
is satisfied, including independent SAP identity/client evidence, relevant live capability/scale
coverage, durable audit and installed MCP/LLM-client checks. Do not infer merge/customer readiness
from the local suite alone.

## Primary references

- [SAP MTA build-tool usage](https://github.com/SAP/cloud-mta-build-tool/blob/master/docs/docs/usage.md): generated deployment descriptor checks complement schema validation.
- [SAP client-handling guideline](https://help.sap.com/doc/abapdocu_816_index_htm/8.16/en-US/ABENCLIENT_HANDLING_GUIDL.html): implicit logon-client handling can be overridden; not a row-security guarantee.
- [Node CLI option syntax](https://nodejs.org/api/cli.html#options): dash/underscore aliases are supported.

## Follow-up review — 2026-09-18

Reviewed the supplied follow-up against `d5a2ceb5`. Its defects and test gaps are separated below
from proposed simplifications; none established a runtime target-authorization bypass.

| Claim | Disposition |
|---|---|
| Factory mode guards lack regression tests | Added omitted/empty/unknown/null direct-factory cases. Temporarily disabling the guard fails four cases; restored before final checks. Retain startup validation too: programmatic configuration can be invalid on both sides of an equality check. |
| Startup test confuses discovery and registry caps; logger spies ineffective | Assert the actual discovery options and its empty over-limit snapshot, plus the HTTP bootstrap arguments (not purported route execution). Spy on the Logger prototype across startup reinitialization. Real HTTP routing remains covered separately. Removing discovery options fails two cases. |
| Discovery-failure options untested | Add both modes through real failing discovery and unavailable-registry construction, asserting options and completeness. Removing failure options fails two cases. |
| Internal catalog projection throw untested | Its private caller already denies a missing projection before dispatch. Strengthen the reachable HTTP test to call `SAPTargets` explicitly and require `INSUFFICIENT_SCOPE`; retain the internal assertion rather than export a private helper or fabricate an impossible public call. |
| Whitespace normalization weakens prose assertions | Preserve paragraph boundaries; pin complete normative paragraphs for defaults, all-target assignment and zero/one-target discovery. Negative examples reject prefixed/suffixed negation and cross-paragraph joining. Remaining presence/link checks are explicitly smoke tests, not semantic proof of arbitrary prose. |
| Seven/eight collections, audit code and ADR links stale | Correct canonical deployment/XSUAA guidance: seven functional plus one unassigned collection granting `read` and `*`. Document audit-only `TARGET_NOT_GRANTED`; qualify ADR-0006/0007 with ADR-0008. Also correct the spec's short rollout summary: verify enforcement before assigning restricted users. |
| One non-ASCII value denies the entire grant set silently | Whole-set rejection is intentional and retained, including alongside `*`. Fix observability: aggregate `initialize`/`tools/list` now audit missing/malformed/limited grants with safe codes and no raw values or target inventory, including the Copilot alias. Three new tests failed before this fix. Valid and legacy discovery remain unaffected. |
| Legacy display normalization changes descriptions/revisions | Confirmed intentional shared label hygiene, not an authorization change. Document the exception to broad “unchanged” wording and verify identical normalized labels/fingerprints/revisions across modes. Ordinary descriptions and routing remain unchanged. |
| Heap/profiling/report flags bypass harness guard | Extend startup rejection to the artifact-generating flags and underscore aliases in `execArgv`/`NODE_OPTIONS`. Regression failed before the fix. Real child processes reject heap snapshot, heap/CPU profiling and report flags before loading credentials; temporary profiler artifacts contain no loaded credentials and are cleaned up. This remains accidental-disclosure hardening, not a runtime sandbox. |
| `forget` leaves pending/exchanging logins alive | Add identity-backed reservation commits/releases. Forget clears pending state/timers and invalidates exchanging callbacks; old completions/releases cannot overwrite or release a newer same-label login. Shutdown invalidates pending commits too. Tests cover deferred exchange, reuse, saved-session removal and the combined bound. Already-running requests and issued tokens are not revoked. |
| MTA assertions pass against the base | Those assertions protect effective safety, not overlay presence; label them accordingly. Add a profile-specific deny-action assertion alongside mode/endpoints/cache assertions and a separate PP safety check. Keep parsed generated YAML: validating a source `extends:` token alone does not prove the effective chain. Document the check's POSIX/WSL scope with an explicit Windows diagnostic. |
| MTA tool install/network cost | Existing `npx mbt` workflow can require network and is not version-pinned. Retain the lockfile-installed YAML parser and isolated CI check for now; toolchain pinning/CI installation optimization is a separate repository-wide task, not a reason to weaken descriptor validation. |
| Remaining complexity cuts | Adopt the equivalent ASCII regex spelling. Retain explicit empty projection and defense-in-depth checks; keep boundary matrices and credential capture (owner-only directory/file, exclusive creation, sanitized CF errors), not a bare shell redirect. SDK harness redesign, fixture consolidation and post-release documentation/history consolidation are deferred, not correctness fixes. |
| Replace union-count allocation with `sessions.size + reserved.size` | Reject: a committed session remains reserved while its automatic test runs, so adding sizes double-counts it. A new regression proves the union bound permits a free slot and rejects overflow. |

Verification on Node 24.11.1: 175 focused tests, all **7,054 unit tests / 232 files**, and **27 offline
harness tests** pass. Typecheck, lint (three existing informational notices), build, policy and
file/schema budgets pass; all MTA profiles and effective-descriptor checks pass; strict MkDocs passes.
Temporary guard/options mutations were restored. No live BTP, IAS, SAP, credentials or memberships
were used or changed; the remaining final-build live gates above still apply.

The independent candidate review found a sibling V8 heap-dump route: `--heap-snapshot-on-gc=1`
could persist a generated synthetic secret after the initial guard accepted it. Added that switch,
`--heap-snapshot-on-oom` and underscore aliases to the same guard and real child-process regression.
The review used no real credentials and removed its temporary snapshot. Package/npx smoke also passes.
