# ENHO mixed-usage correction review

**Verdict: GO for integration of `84e656fcbc1cdffcda27d6352dbf2e489613cfd8` against `2ee84c56c96067255206d632fd5c4c1cda2fe4f3`. No actionable blocker found.** This approves the narrow native reader/parser correction and its existing writer integration. It is not native mutation, Principal Propagation, public-capability, execution or whole-PR approval.

This is a Codex fallback review after the confirmed Claude limit. I did not author this ENHO correction, fixture or tests. I authored the earlier GET-only collector and several other shared/package/qualification components, and reviewed earlier ENHO/SKTD candidates. The original native GETs were executed by root, not by this reviewer. Those relationships do not replace the independent source and byte-level checks below.

## Evidence and behavior

The three saved native ENHO responses (default, active and requested inactive) are all 6,836 bytes, SHA-256 `471b96b403202e1024db5da4d62fb6ab6ccc424b75ce2204117ef4e7769a4368`. They each declare **active** state. The requested inactive response therefore remains an active fallback, not draft proof.

The actual body has four direct usage pairs: one `ENHS/XSB` spot, one `CLAS/OC` dependency and two `INTF/OI` dependencies. The former single-child lookup rejected this legitimate repeated-child shape. The new loop validates each direct object/main-object pair against its exact native name, supported type and canonical same-route URI, and selects exactly one spot. It does not follow the additional class/interface references or confer mutation authority on them. The existing single-spot form remains covered by shared regressions.

The original saved failure replay records three `Duplicate native XML metadata element` failures, exactly the three ENHO views. I replayed its original logic with only the source/output bindings and reported source revision changed for the immutable candidate: **33/33 retained read cases now pass**, including all three unchanged ENHO bodies. No original body, replay script or original failure report was modified. The full fixture byte comparison also proves that only the declared three author attributes and two timestamps differ from the real response; the complete native structure is retained.

The new references remain in the full metadata hash and stable readback value. No hash exemption, writer fork, new endpoint or capability switch was introduced. The ordinary editable read continues to work without write-package grants. Existing lock-time comparisons refuse changed dependencies before PUT; acknowledged saves with a changed usage in readback remain `document-save-unconfirmed` and are not replayed.

## Independent probes and checks

The external `independent-enho.test.ts` adds **17 tests** beyond the candidate's 26 new regressions. It verifies:

- Unchanged raw native bodies through the actual shared reader for default/active/inactive requested views, preserving native active state and making only the selected-owner GET.
- All **24 permutations** of the four usage rows select the same unique spot; each full ordering remains hash-significant.
- Duplicate usage containers/object references/main references, nested-only spot/main references, conflicting namespace-alias attributes, prototype-like type keys, newline-encoded names, fragments and double-encoded paths refuse before lock or PUT through the actual writer.
- Canonical namespaced class/interface dependencies are accepted, while raw slash substitutions are refused.
- An opaque nested foreign reference stays preserved and does not become spot authority or an HTTP target.
- A real private wrapper update of one BAdI's active flag retains all mixed common usages, both implementations and both native filter trees, with exactly one PUT and one owning unlock.

The author tests additionally cover foreign namespaces, mismatched pair identities/routes, missing/multiple spots, stale metadata, under-lock drift, post-save uncertainty, description-only opaque-field preservation and existing exact-owner activation.

Checks actually run in the immutable snapshot:

- **7 test files / 243 tests passed**, including the 17 external probes. Suites: new native usages, existing documents, editable native reads, enhancement implementation, native XML evidence and comparison budgets. No failed test run occurred in this review.
- Original retained-reader replay: **33 passed / 0 failed**; the original saved replay had 3 failures.
- All three TypeScript configurations passed (`npm run typecheck`).
- Full Biome lint passed, with 14 informational existing style suggestions and no fixes applied.
- Policy validation passed (135 policy entries / 14 schemas); file and schema size budgets passed.
- No full unit suite, build, packaging or documentation-site rebuild was repeated for this 22-insertion/6-deletion parser delta.
- Process-wide socket/TLS and `.env` guards remained active, with Vite environment loading disabled. All seven test worker checkpoints report zero network and `.env` attempts. Process logs report zero blocked network, zero `.env` reads and zero loopback network connections; four local TSX loader IPC connections occurred in replay/static commands. No global dotenv stub was added.
- First and final snapshot verifier: **4,856 unchanged files** at the exact candidate SHA. The final verifier was the last source action.
- All **98 bound capture/replay files** (96 original capture files plus original replay script/result) are unchanged byte-for-byte. The before ledger is `native-capture-before.json`.

## Limits and remaining acceptance

Only the observed direct ENHS/CLAS/INTF usage relationships are supported. Other native types, subobject/main-object mappings and existing lexical writer limitations remain refused or unqualified. A mocked spot dependency used in write tests is synthetic, not another captured SAP response. Native recomputation of usage dependencies after an edit can still produce an honest unconfirmed save; no normalization was invented to hide it.

This review establishes the positive read representation and offline preservation/gate behavior. It does not establish native ENHO create/update/activation/recording/delete behavior, current-code distinct-writer PP acceptance, rollout or merge readiness. FEAT-93 retains these gaps separately. The author's earlier blocked Vite `.env` attempt remains disclosed in its report; this review had no such attempt and did not erase that earlier incident.

No SAP request, native phase, browser operation, credential access, source edit, cherry-pick, install, push or delegation was performed. The only test writes were synthetic backend state and external review artifacts.

## Hashes

- Review manifest: `db3748a1f646e58733177c8221f7c7af7ee02b7981ebd0394209ac69270c97ef`.
- Candidate diff: `1862278820d02788c8911eb6305ae85e91bc2848863f2cf3f5a3ca3d284ea1de`.
- Bound author report: `f6510bd2e0fa2d09c714b4410733a638d664b763922f5d32f1ebb754dc13332f`.
- Production parser: `b2fc6fd73f7a8a6e0ced263a4f3ce84ec9798f2ef402affb0c8dcfb5c8a818b8`.
- Sanitized complete fixture: `ab0415d51dc9893247b052b3408b631551ef7d205a96223a34f61624bf815a7f`.
- External probes: `66a1bbe70bb9422e9b78387d9020fce566750de47094e0462ecc62c04a2ce7de`.

`review-hashes.json` binds the full test, replay and static-check logs, source artifacts and preserved evidence ledger. No proprietary standard SAP implementation source was copied into the repository.
