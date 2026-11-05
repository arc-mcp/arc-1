# Independent CTS candidate review

Candidate: `0ceb45fde67ce9ff575138804bd5ea703a43bbeb`  
Base: `4575b2cb2ee05283ff9fd5426c3551b94186bc1d`  
Reviewer: Codex, independently of the CTS implementation and tests. Actual Claude capacity was exhausted; the parent authorized the Codex fallback.

**Private integration verdict: changes required. Three P2 correctness findings remain.** Passing tests do not close the reproduced failure paths below. This verdict does not authorize native execution, public CTS admission, deployment, or whole-PR merge.

## Findings

### P2 — Incomplete or malformed inactive evidence can permit release

Location: `src/adt/pinned-cts-inactive.ts:13–22`, with the related identity comparison at `:30–34`.

The shape check rejects unknown child elements but ignores root attributes. An otherwise typed empty `inactiveObjects` response carrying `ioc:hasMore="true" ioc:totalCount="1"` is accepted as a clean inventory. A full private release invocation using that response made one release POST and returned `ok:true, state:"confirmed"`. This defeats the pre-release requirement for complete rich inactive evidence. A related reproduction supplied an inactive entry whose CTS assignment was `DEVK900001 ` (trailing space): the helper accepted it as unrelated instead of rejecting its malformed native identity.

These are synthetic unknown-shape regressions, not claims that a live SAP release emits these particular fields. The adapter promises to fail closed on unknown/incomplete evidence, so it must not convert these responses to a clean precheck. Validate completeness metadata at the root and relevant nested levels, and require canonical assignment identities before deciding an entry is unrelated. Missing, conflicting or malformed recording evidence must stop before the release POST. Add handler-level regressions proving zero submissions, plus qualified complete-empty and explicitly unrelated-entry positives.

### P2 — Create confirms success without the requested description

Location: `src/handlers/pinned-cts.ts:134–144`; missing field projection in `src/adt/pinned-cts-evidence.ts:8–17,85–109`.

The independent readback checks request type, modifiable state and an explicit target, but never reads or compares the required description. A request created with `description:"Requested description"` was returned by the fake native organizer with `tm:desc="Different description"`; the adapter still returned a confirmed completed create. Existing positive mocked readbacks also omit `tm:desc` entirely. The repository's retained native organizer fixture and the native create builder establish `tm:desc` as the authoritative field.

Read the namespace-bound description and require an exact match before reporting confirmed creation. Missing, foreign-namespace or different values must retain the submitted creation as incomplete/unverified, with no automatic retry or rollback. Cover matching, missing, changed and namespace/escaping cases for both supported creation routes.

### P2 — Release forgets child expansion observed during terminal verification

Location: `src/handlers/pinned-cts.ts:191–205`.

The strict terminal read verifies the selected node's released state but ignores new children. Only the final read contributes `unexpectedChildren`. A controlled release returned a new released child `DEVK900099` in the terminal snapshot, then omitted that child from the final snapshot. The invocation made one release POST and returned `state:"confirmed", unexpectedChildren:[]`. Thus an expansion that the adapter actually observed disappears from its result. The existing warning about non-atomic native child effects does not preserve this concrete evidence.

Accumulate observed expansion/uncertainty across all post-submission evidence reads and convergence results. Once expansion is observed, retain its IDs and the confirmed effects already known, stop further explicit mutations where applicable, and keep the overall result incomplete even if a later snapshot omits the child. Add a transient-expansion regression as well as stable-expansion and ordinary terminal-success paths.

## Evidence and checked boundaries

`codex-probes.log` contains the executable fake-transport reproductions' JSON results. They were run through the source helpers/private handler without modifying the snapshot or contacting SAP. The transient-expansion reproduction had seven organizer reads; the extra child appeared only in read six, the strict terminal read.

Reviewed the accepted plan's CTS section/P2-F, relevant ADR/security/AGENTS guidance, roadmap FEAT-93, candidate diff, author report and CTS research. Inspected all six mutation actions and private layer/target companions, independent server/destination request policies, generated-ID create admission, exact native parent/task membership and both low-level guards, object-entry keys/lock metadata, recursive preflight and retained partial outcomes, response/attempt/deadline/cancellation/no-replay controls, runtime configuration and optional role foundations, and single-target compatibility.

The actual runtime builder preserves the independent server list in `serverAllowedTransports` and the destination list separately; the empty transport read projection is not used as mutation authority. Pre-ID creation requires the unrestricted server policy and explicit destination `*`. Parent grants only cover proven native children. The raw authenticated `write` requirement and derived transport scope ceiling remain distinct from target grants. Native CTS target input is separate from the ARC-1 target identity; creation leaves native SAP owner selection to the mapped caller.

No public capability row or public dispatcher calls the private CTS entry. Protected-resource metadata does not advertise `transports` while the capability is closed. Aggregate, Basic, read-only and Copilot paths remain mutation-free in the reviewed code and tests. The optional role template does not assign a role or extend target grants. The legacy object-removal implementation was extracted without a behavioral rewrite, with a separate guarded private wrapper.

## Offline validation

All commands used Node `22.21.1` through the supplied PATH and the installed dependencies.

- Focused CTS/transport/runtime/descriptor/HTTP route suites: **9 files, 516 tests passed** (`codex-focused.log`).
- Full unit suite: **507 files, 13,681 tests passed** (`codex-full-unit.log`).
- `npm run typecheck`: passed (`codex-typecheck.log`).
- `npm run validate:policy`: passed, 135 policy entries / 14 tool schemas (`codex-policy.log`).
- `npm run check:sizes`: passed, 999 tracked source/test files and all schema scenarios (`codex-sizes.log`).
- `npm run lint`: passed, no changes, three informational diagnostics (`codex-lint.log`).

No source edits, installs, manual Git operations, live/native/SAP requests, credentials, browsers or delegated review were used. Build and documentation generation were not rerun in this immutable review; the author report records those checks, and they are not treated here as independently reproduced results. The synthetic failure probes are review evidence, not native qualification fixtures.

## Integrity and remaining qualification

The first source action and final source action were `/opt/homebrew/bin/python3 review-input/verify-snapshot.py`. Both verified all **4,564 files** as unchanged at the candidate revision. Final verifier output:

```json
{"revision":"0ceb45fde67ce9ff575138804bd5ea703a43bbeb","verifiedFiles":4564,"status":"unchanged"}
```

This report was written outside the snapshot after final verification. FEAT-93 correctly retains native contract qualification, two-writer PP and public admission as open work; its broad unknown-shape fail-closed statement needs the inactive-evidence fix above to be accurate. After the three findings are corrected and independently reviewed, a separate decision can assess private integration. Native contracts across supported SAP profiles, current-revision mutation/PP qualification, public admission and whole-PR readiness remain separate gates.
