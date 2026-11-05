# RAP independent correction review3

2026-11-03. Root Codex reviewer; I authored neither the candidate nor its committed tests. Candidate **75dd49a16e9beb331b5dea723a331884042c164a**, base **755eb70a4f88a5e1c0a594ceca4e5d189619b71c**. I reviewed the bound delta and its actual runtime/shared-generator consumers, explicitly reusing preceding independent reviews for unchanged source/owner/context/recording/cleanup and BDEF-admission code.

**Changes requested: one narrow P2 in the new implementation-name proof.** The preceding collision finding is otherwise corrected: complete signatures, renamed parameters, actual class membership, duplicate declarations and missing plain implementations are checked, including the previous false-no-op case. The original18 review probes pass. This is private component review, not native/PP/public or whole-PR approval.

## F2 — P2: qualified interface method is mistaken for the plain handler implementation

`src/adt/pinned-rap-bindings.ts`, `members()` implementation branch uses `/^method\s+([a-z_]\w*)\b/i`. For the actual header `METHOD do_approve~other.`, it stores **do_approve**, truncating the qualified name at the word boundary. A different interface implementation therefore supplies false proof of the required plain handler body.

The real private adapter reproduction starts from the author's existing literal-induced missing-stub case: correct renamed `do_approve` declaration bound to `Item~approve`, same-name utility `approve`, and an unrelated constant containing the binding text that confuses the inherited stub detector. Add a declared local interface and `METHOD do_approve~other.` implementation; leave plain `METHOD do_approve.` absent. With sibling action reject, both scaffold_rap_handlers and generate_behavior_implementation send **one PUT**, add only reject and report **saved-inactive**. The required do_approve body remains absent. The new guard should catch this actual omission independently of the inherited parser, but the truncated name allows it.

Keep complete method identity when collecting implementations (or match a complete plain-method header where appropriate). A qualified interface method must not satisfy a plain handler. Preserve actual interface methods, utilities, renamed handlers and the shared generator's normal ability to add the missing plain method. Do not expand the fix into general ABAP compilation or automatic method renaming.

Reproduction/control files: `codex-variant-probes.test.ts`, `codex-original-probes.test.ts`, `root-probes.log`. Final **22 probes:20 pass/two fail**. Two positive qualified-interface controls correctly add the genuinely missing ordinary handler while preserving the interface body. The two failure assertions expose the compound masking case above through the complete real handler/HTTP mock boundary. This establishes an incomplete source plan; it does not claim native compilation success for the fixture or arbitrary source layouts.

## Checks and provenance

- First source verifier: exact candidate, **4,646 bound files unchanged**.
- Seven affected private/legacy RAP suites pass; see `root-focused.log` for exact count.
- All source/scripts/tests TypeScript projects pass, `root-typecheck.log`.
- Changed source/test Biome checks pass without fixes, `root-lint.log`.
- Final source action: verifier confirms **4,646 unchanged files**, `root-snapshot-final.log`.

The exact author candidate reports 528 files/14,933 full tests and complete static/build/docs gates; those are author evidence, not repeated independent checks. Unchanged prior18 probes were copied with import paths changed only. The first four newly appended probes accidentally contained double-escaped newlines; that construction-only run is retained in `root-probes-construction.log`. They were corrected outside the snapshot, and the final log/source above uses actual line breaks. Two guessed source/probe filenames in read commands were absent; actual files were subsequently read. No production or snapshot code was edited.

Review files/logs are outside the immutable source. Existing dependencies and Node22.21.1 only; no installs, manual Git, credentials, SAP/native/network or browser actions occurred during this review. No source action followed the final verifier. Native behavior-pool contracts, recorded lifecycles, current-source two-writer PP and public admission remain open; the reviewed correction does not alter those limits.
