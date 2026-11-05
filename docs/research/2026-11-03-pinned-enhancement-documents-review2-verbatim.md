# ENHO/SKTD combined candidate — independent review 2

Date: 2026-11-02. Reviewer: Codex fallback after the confirmed Claude limit. I authored neither this candidate nor its committed tests. This review covers candidate `30580655f06d0948b2038bb452e7e8fa55bf77f6` against `5402630cb6e2260b379da6ac25d2390c776be705`.

**Private integration verdict: CHANGES REQUESTED.** The original demonstrated namespace/structural corruption cases and activation-label defect are corrected. Ordinary editable reads pass the package-independence checks. Two remaining P2 defects in the private KTD bridge prevent approval of the combined writer/read candidate. No native, PP, public-admission or whole-PR approval is given.

## Findings

### F3 — P2: valid root-identity spellings can route a root edit into a field

Location: `src/adt/pinned-ktd-document.ts:87–89`; interacting unchanged helpers: `src/adt/ddic-xml.ts:1076–1082` and `1102–1103`.

The wrapper validates native namespace and structural slots, then passes the original XML to the lexical shared writer. The shared `envelopeKtdName` recognizes only literal `adtcore:name="…"`. An equivalent core namespace alias (`c:name` with the core namespace binding), single-quoted owner name, or whitespace around `=` remains valid native metadata but yields the legacy placeholder `this KTD`. When every body is empty and a field precedes the actual root, `rootKtdElement` consequently selects the first field. The preservation comparison masks every native body, so it cannot detect that the wrong eligible node changed.

Reproduction through the real private handler and mocked ADT HTTP lifecycle: seed a valid two-node SKTD document, make both bodies empty, put `ZTEST.FIELD` before root `ZTEST`, apply one of the three root-attribute spellings above, and submit bare Markdown `new bare root body` with the current metadata hash. Each variant sends **one PUT**, leaves the root empty, changes the field body and reports `saved-inactive`. The control with normal double-quoted `adtcore:name` writes the root correctly. All unrelated opaque metadata stays intact, so this is specifically incorrect routing rather than the original opaque-slot corruption.

Preserve supported XML spellings by passing the already namespace/structure-validated root identity into shared routing and root selection. Thread it through route qualification as well as the empty-document fallback; do not normalize/rebuild the whole document merely to satisfy a regex. That semantic identity would resolve these three reproductions without blanket refusal of valid aliases, quotes or spacing. Add reordered-empty-node controls for all spellings and verify that only the intended root changes. Continue preserving explicit-node, single-documented-node and ambiguous-heading semantics.

### F4 — P2: valid native obligation spellings bypass the forbidden-body check

Location: `src/adt/pinned-ktd-document.ts:53–72` and `87–89`; interacting unchanged helper: `src/adt/ddic-xml.ts:977–985`.

The guard qualifies element/text ownership but does not bind the semantic attributes consumed by `canWriteKtdLongText`. That helper recognizes only literal double-quoted `sktd:longTextObligation="…"`. A native `forbidden` obligation expressed with single quotes, spacing around `=`, or an equivalent SKTD namespace alias is missed. The helper then accepts the existing `canHaveDocumentation="true"`/text slot, although a present obligation should determine writability.

Reproduction: in the ordinary valid fixture, change only the root's native long-text obligation to forbidden using each spelling, then submit the explicit root edit. Every alternate spelling sends **one PUT** and reports `saved-inactive`. The normal double-quoted forbidden control correctly fails with **zero PUTs**. All variants retain the forbidden attribute, so the broad masked-body comparison still passes. These results demonstrate the client-side eligibility failure; they do not establish that a real SAP backend accepts the forbidden edit.

Carry parsed native writability metadata into the shared writer, or equivalently qualify each selected node against that metadata before generating its edit. Preserve the documented precedence of a present obligation, the legitimate missing-attribute compatibility behavior, and byte preservation of unedited forbidden content. Do not solve F3 alone: root identity and writability are separate consumed semantics. Require alternate-spelling forbidden regressions to stop before PUT, alongside alternate-spelling optional/mandatory success controls and short-text regressions.

Raw reproductions and exact assertions are retained in [codex-probes.test.ts](codex-probes.test.ts); [codex-probes.log](codex-probes.log) contains **22 tests: 16 passed, 6 failed**. The six failures are the three F3 and three F4 variants. The normal controls pass.

## Disposition and inspected boundaries

- Original F1 reproductions now pass: a foreign-namespace KTD-looking element under an opaque extension, a genuine-native element under that opaque extension, and a foreign-namespace short-text slot all refuse with zero PUTs. Ordinary native edits preserve unrelated opaque state. The new findings concern semantic routing/eligibility that the structural guard still leaves to lexical parsing.
- An additional under-lock probe inserts dangerous comment markup after the initial read. Comments leave the complete canonical metadata hash unchanged, so this exercises the guard rather than a stale-hash rejection. It fails in `edit-preparation`, sends no PUT and performs the owning UNLOCK. Changed ENHO metadata after lock and opaque loss after PUT retain their existing honest failure behavior.
- Original F2 is corrected: ENHO/SKTD successful activation reports `selected-document-owner-only`; failed ENHO/SKTD/KTD verification reports that scope with `document-active-verification` and `activation-not-confirmed`. A separate binding probe explicitly verifies successful `selected-service-binding-owner-only`; its existing failed-verification phase remains `binding-active-verification`.
- The activation preparation union includes the private document grant. Private batch grant selection still does not grant document activation. Common prepared-context/deadline behavior remains shared; the document additions do not authorize public activation or arbitrary nested batch types.
- Ordinary `format=editable` document reads use the same complete native parser/hash as writers but bypass the write-package wrapper. Actual public-dispatch probes read ENHO/SKTD with only read scope, writes disabled, both package ceilings excluding `ZTEAM`, and obtain the exact metadata/hash through one GET. Committed tests also cover aliases, native versions, inactive alternatives, opaque-field hashes, freshness, read-to-writer preconditions, malformed metadata, response/cancellation bounds, read denials and public mutation refusal.
- The native read helper retains the unversioned developer view, native Accept, no-cache request, bounded response behavior and qualified ENHO/KTD identity/parent checks. No fabricated source URL/hash is returned. The existing lazy editable-reader import boundary is preserved. The seven tool snapshots change only the editable-format description; the unsupported editable-read control now uses DEVC.
- The prior report is preserved byte-for-byte in the snapshot: SHA-256 `d6f5a62dc8465aab8261cfe2c9580712467e25d13a1ce8d81c492ef8b0e03f38`. FEAT-93 was checked at the beginning and end; native/PP/public qualification remains open. No roadmap edit was made during this immutable review.

## Checks and integrity

All commands used the explicit Node 22.21.1 path and snapshot working directory. Logs/probes/configs were written outside the source tree.

- Focused Vitest: **15 files / 566 tests passed**, log [codex-focused.log](codex-focused.log). Files: handler `pinned-documents`, `editable-documents`, `editable-native`, `source-preconditions`, `write-ddic`, `write-ktd-smbc`, `write-ktd-parent-description`, `write-ktd-short-text`, `pinned-batches`; ADT `enhancement-impl`, `ktd-routing`, `ktd-short-text`, `mutation-client`, `mutation-compatibility`, `request-attempt-budget` (all `.test.ts`). Command: `./node_modules/.bin/vitest run --reporter=default` followed by these exact `tests/unit/{handlers,adt}/` paths.
- `./node_modules/.bin/vitest run --reporter=default tests/unit/adt/pinned-service-binding.test.ts`: **35 passed**, [codex-service-binding.log](codex-service-binding.log). Combined committed-test coverage: **16 files / 601 tests passed**.
- `./node_modules/.bin/vitest run --config ../codex-probes.config.mjs`: **16 passed / 6 failed**, all failures reproduced above. Every probe asserts no unexpected mocked HTTP paths.
- `./node_modules/.bin/vitest run --config ../codex-binding.config.mjs -t 'uses the shared private activation protocol|reports native activation as incomplete'`: **2 passed / 33 deselected**, [codex-binding.log](codex-binding.log). External copy adds the explicit binding-scope assertion; candidate tests remain unchanged.
- `npm run typecheck`: passed all source/scripts/tests projects; [codex-typecheck.log](codex-typecheck.log).
- `npm run lint`: passed with three informational diagnostics and no fixes; [codex-lint.log](codex-lint.log).
- `npm run validate:policy`: passed, 135 policy entries / 14 schemas; [codex-policy.log](codex-policy.log).
- `npm run check:sizes`: passed source/test ratchet and all tool-schema scenarios; [codex-sizes.log](codex-sizes.log).

First and last source actions ran `/opt/homebrew/bin/python3 review-input/verify-snapshot.py`: **4,665 files unchanged**, candidate **30580655f06d0948b2038bb452e7e8fa55bf77f6**. Final evidence is [codex-snapshot-final.log](codex-snapshot-final.log). No source reads or writes followed the final verification; this report and subsequent log inspection are outside the snapshot.

The author reports 529 unit files / 14,987 tests plus build/docs checks. I did not repeat the full suite, build or documentation build; my independently executed checks are enumerated above. All HTTP outcomes here are controlled fixtures or existing local-loopback unit infrastructure. No SAP/native request, credential inspection, browser action, install, deployment, manual Git operation or delegation was performed. Native release/layout support, transported behavior, current-build two-writer PP and public admission remain separate qualifications.
