# Independent private FLP native-governed recording review

**Candidate:** `687fc44b487892487b766dc0ac3a099f360f9cf7`  
**Base:** `9c103ab74852d75db5f518e4d0f93e777d5cf8ca`  
**Author checkout:** `/Users/marianzeis/.codex/worktrees/pinned-trace-flp/arc-1`, branch `codex/pinned-flp-native-recording`  
**Verdict: GO for private integration.** No actionable new correctness, authorization or compatibility blocker was found in this delta. This is not native-execution, PP/public-admission or whole-PR merge approval.

I authored neither this implementation nor its tests. The snapshot was prepared from the specified clean candidate. The first and final reviewer source actions verified all **4,727 files unchanged**, bound to the exact candidate SHA. Probes, configuration, logs and this report are outside source. The old package/API author checkout was not used.

## Scope conclusions

- Both registered effective transport policies independently require an explicit unrestricted `*`. Missing, empty, narrow, malformed, sparse and deny-all forms refuse. Canonical additional rules cannot conceal deny-all or malformed entries. This does not reinterpret legacy empty-global policy or widen an existing list.
- The private entry requires registered context/policy identity, raw write plus read capability, the selected target/client, strict PP, enabled write/runtime feature/action policies and internal on-premise758 coverage. It rejects public argument overrides. Scope and exact-target grants remain projected by the existing real runtime; aggregate, shared Basic and absent exact/raw write grants cannot mint an enabled context. The global release override is deliberately not inherited; unknown selected-target coverage refuses before I/O.
- The guarded child allowance intersects the existing send allowance and shares the parent's bounded all-response budget, deadline, cancellation and cleanup state. Nested adapter options cannot replace those controls. Direct Fetch and Connectivity revalidate at their existing final send allowance after CSRF, authentication and semaphore waits. No shared HTTP implementation was changed. Late policy/coverage/identity changes or cancellation prevent a mutation from reaching mocked transport; successful valid per-user context still works.
- Source-backed native optional recording is kept separate from ARC-1 request membership and SAP authority. Both unrestricted policies cover possible native request/task selection. No additional transport-management permission, caller selector/header, helper or mandatory-recording rule is introduced. The result explicitly says `native-governed-unverified`, makes no verified CTS receipt claim and preserves possible CTS effects after submitted failure. No automatic compensation is performed.
- Existing lifecycle ownership/content validation, duplicate-protected create and truthful readback outcomes remain in use. Native604 is unknown lookup state, not absence. An accepted DELETE followed by604 stays unconfirmed. Public dispatch/capability admission and the independent public recording refusal remain closed. Ordinary single-target behavior and the separate disposable observation entry retain their prior semantics.

The full eight-file delta, relevant existing handler/adapter/runtime/budget boundaries and derived documentation were inspected. The supplied private source assessment was read, including its superseding inherited-handler addendum; its SHA-256 was independently verified as `6c6ed6574024b91cd558e60f3dd1426f80f25f42dda9579d866fc12c3f5a8915`. The author report matched `bee442c1cf46d2a6b5abcbae75220e8e5d9806a5e0d51a00a00f7670cdfb5498`. These establish source-review provenance, not fresh native runtime facts. No proprietary ABAP was copied into the repository or this report.

## Independent verification

All meaningful executable checks below used installed Node **22.21.1** and existing dependencies, without SAP or external-network execution.

| Check | Result |
| --- | --- |
| New profile plus relevant FLP/trace/create/readback/read/legacy/send-budget suites | **8 files / 331 tests passed**, including all 55 new author tests (`independent-focused.log`) |
| Additional actual HTTP adversarial probes | **14 passed** (`independent-probes.log`): direct and Connectivity paths; real semaphore queue waits; valid per-user ALS context; late destination/server restriction, lost release coverage, shared identity and cancellation; late auth/proxy-token revocation; positive controls |
| Isolated new profile import boundary | **1 passed** with Undici and dotenv replaced by throwing guards (`independent-purity-final.log`) |
| Source/scripts/tests TypeScript projects | All passed (`independent-typecheck.log`) |
| Policy validation | 135 entries /14 schemas passed (`independent-policy.log`) |
| File-size and tool-schema budgets | Passed (`independent-sizes.log`) |
| Delta Biome | All four TypeScript files passed (`independent-delta-lint.log`) |
| First/final immutable verifier | **4,727 unchanged** (`independent-first-verification.log`, `independent-final-verification.log`) |

The additional HTTP probes reuse the author fixture with source imports redirected and a one-slot semaphore added only in the external probe. Direct calls use MockAgent with sockets disabled; Connectivity uses the same mock pool while running its actual token-await/consume path. No native server was contacted.

The author reported **543 files /15,696 full-suite tests**, build, full lint, strict docs and other gates passing. I did not repeat unrelated full-suite/build work after the focused compatibility checks and independent boundary probes passed. Author results remain separately attributed rather than counted as new independent runs.

## Bounded import probe and tooling notes

An intentionally overbroad extra probe rejected any Undici import from the entire existing candidate/schema graph. It failed at the unchanged path `pinned-runtime-candidates → pinned-trace → diagnostics → authorization-trace → client → http`. None of those path files changes in this delta. The new profile module itself passes the throwing-guard check. Importing an existing HTTP module is not native I/O or a regression by itself; no new side effect or violated phase boundary was identified. Both initial and isolated logs remain (`independent-purity.log`, `independent-purity-isolated.log`), with the path recorded in `independent-existing-import-path.json`. The probe guard stopped module initialization before any transport/credential activity; no further legacy-graph audit was pursued.

A separate attempted read-only TypeScript-API trace used the shell's default Node22.18.0 and failed before graph analysis because that API shape was unavailable. It did not run source, phases or network calls. The path was then established by static local import/re-export reading; all listed tests and gates used the required Node22.21.1. Two harmless missing-path read/glob attempts produced errors without changing files.

## Remaining qualification

Private integration does not qualify the actual ordinary CUST/no-dialog native runtime or factory/FDM/cloud/no-transport/custom-handler variants merely from the758 label. Separately reviewed owned-fixture work must establish permitted recorded/unrecorded behavior, native denials, possible CTS effects and complete cleanup, followed by current-code two-writer PP and negative-route qualification. Narrow request lists still need a real pre-mutation selection/constraint contract. Authoritative catalog-deletion absence and group cleanup/absence remain named gaps. No native fixture or next execution is authorized by this verdict.

FEAT-93 and its changed derived/ADR/dev-guide wording remain accurate about those gaps. No source edits, manual Git commands, installations, real native phase, SAP/network/browser/.env/credential actions, delegation or push occurred during review. Final verification completed before writing this report; no later source operation was performed.
