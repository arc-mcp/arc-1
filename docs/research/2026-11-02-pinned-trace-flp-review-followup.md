# Trace and FLP review follow-up — 2 November 2026

The independent Claude Code Opus 5.5 high review of `fcb78914eb0df38a601d14692cd7c63f3eb9abcf`
accepted continued private development with two Medium and five Low findings. Its
[verbatim report](broader-pinned-pp-writes/claude-trace-flp-review-20261102.md) has SHA-256
`3449357860f4166dc5f5f3f42ea5ccc8dabc84effaef5ecc63635143b8c8c9dc`.
Codex applied this follow-up after Claude reached its session limit, as the user requested.
No SAP, BTP, browser, credential or native qualification operation ran for this component.

## Disposition

| Review finding | Correction and regression evidence |
| --- | --- |
| M1 — FLP-2 allowed arbitrary recorded requests | ADR-0011 and FLP-2 now require recording **and** pre-mutation selection checked against both request allowlists, or native selection proven constrained to them. The qualification matrix includes no-change clients and no/one/many open requests. Post-write CTS proof alone does not qualify admission. The public recording lock remains unchanged in effect |
| M2 — committed writes could say nothing changed | Incomplete page errors are phase-neutral. Separate 499-to-500 regressions verify one accepted POST, unconfirmed creation or membership, and preservation of the manual verification step |
| L3 — single-target empty trace user regression | The explicit-user refusal applies only when the PP option requires it. A real client with its default empty username still sends the original `user=` query |
| L4 — aggregate descriptions overstated PP requirements | The requirement is explicitly conditional on Principal Propagation. Tests pass Basic-only and mixed target sets through `buildAggregateToolSurfaceConfig` and the actual catalog projection |
| L5 — descriptions advertised scope-pruned FLP actions | The description refers to the action schema instead of copying action names before pruning. Reader and action-denied catalog tests assert absent mutation names |
| L6 — missing ownership fields were writable | Mutations require explicit recognized false flags and `CUSTOMIZING` scope on groups as well as catalogs. Missing, unknown or cross-client fields refuse before writes. FLP-3/4 must prove field presence and domains; a missing native field remains a qualification gap |
| L7 — list errors/truncation were misleading | Separate pinned list readers use an 8 MiB transport/parse bound and at most 500 output rows, mark full pages or native continuation/count incomplete and never follow continuation URLs. Only a successful OData collection establishes emptiness: **all collection 404s propagate**, including OData errors. The later Codex correction below also removes generic keyed-resource absence inference. Legacy list behavior is unchanged |

The profiler feed comment now identifies synthetic role-bearing data rather than calling it a
native 758 capture. TRC-4 explicitly requires multi-instance `server=*` evidence; the current
adapter accepts one response entry and cannot silently treat per-instance requests as one.

The shared bounded tile-page reader also refuses native pagination below 500 rows for mutation
verification. A readback failure never resets an accepted write to `unchanged`. Collection parse
and response limits do not introduce new schema fields or a single-target API change.

## Second independent review and corrections

The independent Codex review of `35242656dd64f3ffcb00c46e9f6146516b2ef2f2` verified all seven
closures above and found three additional P2 correctness issues in the private adapters:

| Finding | Correction and regression evidence |
| --- | --- |
| Foreign-page tile rows could prove membership | The bounded reader checks exact `pageId`, non-empty string instance/chip IDs and unique instance identity before mapping. Wrong or missing ownership refuses source/target preflight, never becomes `alreadyMember`, and keeps accepted writes unconfirmed during readback. Invalid rows are not filtered into apparent absence |
| Any OData-shaped keyed 404 proved entity absence | All keyed errors propagate. Successful entities must identify the requested key. No native absence discriminator is qualified, so private catalog/group creation refuses before I/O, its speculative write branches are removed, and accepted deletion cannot report `deleted`. Synthetic JSON/XML/HTML/malformed 404 regressions never count as native proof |
| ST05 validator said nothing was submitted after PUT | Shared validation messages are phase-neutral. Outcome text distinguishes no preflight submission, definitive native rejection and uncertain submission/readback, always retaining `sql_trace_state` guidance after an unconfirmed update. Malformed XML, unknown shapes and unexpected namespaces after an accepted PUT have regressions |

The handler regression now exercises successful private **tile** creation against an existing
catalog, and separately verifies that the typed recording acknowledgement cannot bypass the
catalog/group creation refusal. The legacy single-target FLP implementation and public capability
matrix are unchanged. This narrowing is an explicit qualification gap, not completion of FLP parity.

## Validation at the first follow-up revision

- Full unit suite: **507 files / 13,701 tests passed**. The focused preflight passed 320 tests.
- Typecheck: all three projects passed. Build, policy validation (135 entries / 14 schemas) and
  lint passed; lint retains the same three preexisting informational findings.
- Staged size/schema checks passed: **1,000 source/test files and 12 schema scenarios**.
  Strict documentation build passed. No tool-definition fixture changed.

## Validation of the second correction

Using Node **22.21.1**, the focused suites pass **9 files / 367 tests** and the full suite passes
**507 files / 13,727 tests**. Source, scripts and tests typecheck; build, full lint, policy and
source/schema size checks pass. Lint has three informational findings and applies no fixes.
Tool-definition fixtures remain unchanged. The initial focused run exposed two old synthetic
fixtures that relied on absent ownership or speculative catalog creation; both now exercise the
stricter contract, including successful private tile creation. No native scenario ran.

## Remaining qualification

Every candidate remains outside the admitted capability matrix. The independent public FLP
recording lock remains in force. All TRC/ST5/FLP live scenarios, current-code PP and recording
qualification remain outstanding. Independent reviews closed the first follow-up's seven
findings and the second correction's three findings; that is not native qualification. The entity-specific absence
contract and private catalog/group create implementation are now additional explicit gaps. Missing FLP recording
or allowed-request proof can leave mutations as a named gap; list reads may qualify separately.

Roadmap impact: FEAT-93 remains open with the stricter recording/request selection, native
ownership and entity-absence requirements. This does not declare full PR2 parity or readiness to merge.

## Independent integration review

The [second Codex review](broader-pinned-pp-writes/codex-trace-flp-review2-20261102.md)
found the page-row binding, generic-404 absence and ST05 outcome issues corrected above.
The [third review](broader-pinned-pp-writes/codex-trace-flp-review3-20261102.md) closed all
three findings at `f5930bece` and independently passed 494 focused tests. It accepts private
integration only. Native recording, absence, trace-scope and two-writer PP qualification remain
open; catalog/group creation still refuses and catalog deletion remains unconfirmed.
