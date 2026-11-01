# Shared pinned class metadata surgery — implementation checkpoint

PR #1142 remains a draft. This checkpoint admits the existing class-action handlers for main-source
`edit_class_definition`, `edit_method_signature`, `add_method`, `delete_method` and
`change_method_visibility`. It does not qualify these new paths live or expand other type families.
The earlier local PP evidence at `77e41fdcd` remains tied to that revision.

## Shared protocol and evidence

The same `class-surgery.ts` callbacks serve single-target and pinned calls. The pinned context
supplies fresh package/recording preflight and under-lock checks, scoped non-replayable HTTP,
one editable-source save, exact read-back and bounded cleanup in the owning session. Metadata
and source reads use that same lock, deadline, selected owner and editable version. Every action
requires the editable main-source hash. `add_method` takes its declaration in `method`; deleting
or moving a method needs no submitted source. Signature edits keep the existing intermediate-save
behavior and deliberately skip whole-source lint. Other class actions retain configured lint;
the pinned result retains its warnings. No new per-call quality bypass is admitted.

`verifiedClassStructure` checks the native XML against an independent lexical source inventory:

- Exactly one CLAS/OC root for the requested uppercase owner and the expected namespaces.
- Only owner-relative main-source links; no source-version query, foreign origin or alternate
  resource. A supplied native base may carry the matching SAP client and language only.
- Complete global declaration and implementation inventories, names, visibility, static/instance,
  abstract/redefinition state and exact token ranges. Split CLAS/OO + CLAS/OM metadata is checked
  without permitting duplicate definitions or implementations.
- Optional identifier links must select the actual class/method-name expression, including a name
  on a later line of a chained declaration. Native block ranges end after the last non-punctuation
  token, as observed on A4H 758. A different unverified range contract refuses.
- The shared read parser's final result is checked again, so nested local-class metadata it ignores
  cannot overwrite an already verified global method. No returned URI is followed.

The shared splice helpers additionally prove that whole-line boundaries do not contain neighboring
statements. Individual chained declaration edits remain refused; insertion after a verified final
chain member is supported. Ambiguous metadata or unsupported syntax requires a complete editable
source update. The metadata response is bounded before XML parsing.

An already-correct visibility is an explicit `unchanged` result with the verified source hash and
no PUT. This marker is part of the shared callback protocol; it is not inferred from result prose.
It closes normally, and cleanup failure still returns an error. Confirmed saves retain hash,
transport and warnings on cleanup failure; unknown/rejected saves do not claim saved source.

`edit_class_definition` with a local include remains denied pending its whole-include replacement
adapter. Existing include `update` and `edit_method` keep their separate admitted behavior.
Git/custom plugins and all unimplemented families remain refused. Global-off, read-only destination,
missing raw scope/exact target grant, aggregate and Basic routes remain mutation-free.

## Evidence and limits

A local replay of the previously captured read-only A4H `CL_ABAP_CONTEXT_INFO` source/native XML
passes the validator with all 12 global methods. That fixture includes a native chained declaration
and nested local test-class metadata. It is source/metadata compatibility evidence, not an actual
pinned mutation. Source SHA-256:
`037130349153fb070b26334014df01c05c85eea67e7d0ccd74815b7ac014aa85`.
The private original capture is dated 1 November 2026; no SAP class was modified for this probe.

Author validation before the last two defensive URI/boolean cases: 432 files / 11,709 tests,
all three TypeScript projects, build, lint, policy, strict documentation and file/schema budgets.
The 59 existing qualifier simulations also pass; their scenarios do not exercise this new metadata
adapter. Focused native-evidence and real-handler tests pass after those two final cases.

Tests exercise all five callbacks, exact splices and neighbor preservation, no-op, absent/stale hash,
wrong owner/source/version/client/ranges/inventory, duplicate/ignored nested metadata, package and
recording drift, cancellation, ambiguous save/read-back, warnings and unlock/session-close failures.
The selected body stays under the owner lock; refusal asserts no PUT. Route/catalog tests cover
all five actions and the existing read-only combinations. Legacy class/RAP tests remain green.

Required next evidence: Opus review of the fixed revision; reviewed live harness expansion with
real include methods and metadata operations; a fresh build/run binding and two mapped writers;
then transportable-object qualification with the later CTS work. These are not waived by unit
coverage. FEAT-93 remains open for these qualifications, definition-include replacement, all other
object/procedural/DDIC/RAP/batch/package/API/CTS/trace/FLP families and the shared-engine convergence.
