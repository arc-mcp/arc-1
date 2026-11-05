# Independent DDIC/SDO review — request changes

Reviewer: Codex fallback after the actual Claude Opus 5.5 HIGH reviewer reached its usage limit. This is not a Claude verdict.

Candidate: `9e7ef606a8553d99f5e4d5e6d2d9381e9032fc98`  
Base: `13f5518a1c174aa702eff4e53c851fac508332f3`  
Immutable source: `/Users/marianzeis/.local/state/arc1-review/pr1142-ddic-sdo-review1-20261102-190339/source`

## Verdict and scope

Request changes for this private DDIC/server-driven component: four P2 correctness findings below. I found no new public route-admission or authorization bypass. Keeping these adapters inaccessible through public pinned routes is the correct current boundary, but their private implementation should not be marked review-complete until these findings are addressed.

The independent offline checks all passed. They do not establish native SAP mutation behavior or Principal Propagation qualification. This review does not approve all of PR #1142, public admission of these families, or release of broader multi-target parity.

I reviewed the delta, private owner/context/write/delete/activation paths, metadata builders/projection, relevant tests, author report, ADR-0011, plan, security model, research/inventory, dev-guide and FEAT-93 roadmap context. I did not treat unchanged native-harness issues in the base as DDIC delta findings.

## Findings

### DDIC-R1 — P2: Numeric comparison silently treats changed text as unchanged

Location: [pinned-metadata-projection.ts:69](/Users/marianzeis/.local/state/arc1-review/pr1142-ddic-sdo-review1-20261102-190339/source/src/adt/pinned-metadata-projection.ts:69); the no-write branch is [pinned-metadata-write.ts:199](/Users/marianzeis/.local/state/arc1-review/pr1142-ddic-sdo-review1-20261102-190339/source/src/handlers/write/pinned-metadata-write.ts:199).

`sameValue` converts every pair of digit-only strings to JavaScript numbers without considering the metadata field. A DOMA with description `007`, updated to description `7` with other values unchanged, is therefore considered unchanged. The handler sends no PUT and reports that the requested values were already stored. The same comparator is used for save verification, so it can also accept an incorrect readback of numeric-looking text. Large digit strings additionally lose integer precision through `Number`.

This is not merely normalization of SAP's padded dimension fields: descriptions, labels and character fixed values are text. Existing coverage verifies equivalent padded lengths but does not exercise changed numeric-looking text.

Requested fix: normalize only explicitly known numeric dimension/count fields, keep text exact, and avoid precision-losing number conversion. Add regressions for `007` to `7` descriptions, an ignored requested text change during readback, and distinct long digit strings; retain the legitimate padded-length case.

### DDIC-R2 — P2: Projection drops XML namespaces and can miss destruction of unknown stored fields

Location: [pinned-metadata-projection.ts:34](/Users/marianzeis/.local/state/arc1-review/pr1142-ddic-sdo-review1-20261102-190339/source/src/adt/pinned-metadata-projection.ts:34), also lines 36–40 and 48–56.

The native XML canonicalizer preserves expanded names, but `collect` discards the namespace and indexes fields only by local name. Distinct namespaced nodes or attributes can then overwrite one another in the projection. The subsequent omissions also match some fields by local name alone.

For example, a domain's normal `doma:datatype` and an additional `ext:datatype` in `urn:extension`, both containing `CHAR`, produce the same projected key/value. Rebuilding the document removes the unknown extension, but the preservation comparison can see no unrequested difference. A namespace-binding change with identical local names can likewise be invisible. This violates the explicit promise to refuse loss of unknown native fields before a full-document PUT.

Owner/root/package identity is separately namespace-checked; this finding concerns metadata preservation and hashing, not an asserted owner-authorization bypass.

Requested fix: preserve expanded namespace identity in comparison keys, or explicitly reject foreign/ambiguous fields before projecting to approved shorthand paths. Restrict exclusions to the known namespace and field. Add same-local-name namespace collisions, changed bindings, and equivalent-prefix-renaming tests.

### DDIC-R3 — P2: Activation can verify a different explicit DDIC definition as successful

Location: [pinned-ddic-activation.ts:25](/Users/marianzeis/.local/state/arc1-review/pr1142-ddic-sdo-review1-20261102-190339/source/src/handlers/write/pinned-ddic-activation.ts:25), used at line 118.

Activation unconditionally exempts all DTEL datatype/length/decimals, TTYP built-in row-type fields and ENQU lock parameters from post-activation comparison. These are not always derived values. For a DTEL whose native type kind is `predefinedAbapType`, its datatype and dimensions are its explicit definition; the analogous TTYP built-in row fields are explicit too. Explicit lock parameters also cannot universally be treated as generated.

Consequently, a captured built-in DTEL of CHAR length 10 can be read back as active NUMC length 20 in every checked view and still pass verification when the remaining fields match. The handler can then claim the captured definition was activated with native state verified. The existing successful derived-length test covers a domain-based DTEL, not the built-in case.

Requested fix: derive exclusions from the captured native shape, as the save-side `derivedOnSave` already does conditionally. Verify explicit built-in definitions and explicit lock parameters. Add adverse readback tests for built-in DTEL/TTYP and explicit ENQU parameters while all metadata views still report active; keep the legitimate domain/dictionary-derived cases.

### DDIC-R4 — P2: Missing message-language evidence bypasses the master-language-only gate

Location: [pinned-metadata-write.ts:178](/Users/marianzeis/.local/state/arc1-review/pr1142-ddic-sdo-review1-20261102-190339/source/src/handlers/write/pinned-metadata-write.ts:178); language defaults originate in [ddic-xml.ts:493](/Users/marianzeis/.local/state/arc1-review/pr1142-ddic-sdo-review1-20261102-190339/source/src/adt/ddic-xml.ts:493).

The MSAG guard checks only inequality. If both native `adtcore:language` and `adtcore:masterLanguage` are absent, they compare equal and the write proceeds without proving a master-language view. Both blank values have the same problem. The owner evidence currently permits missing master language.

The message builder defaults an unknown language to EN and emits that as `adtcore:language`; preserving stored root attributes removes or restores the missing/blank master-language attribute but does not undo the generated EN language. Since language is excluded from metadata comparison, the preservation check does not stop this transition. Thus an unproven native document can lead to a language-specific message write rather than an early refusal. A later readback failure would occur after the write.

Requested fix: require usable, nonempty native language and master-language evidence before an MSAG update, and require them to agree. Missing/blank values must fail closed rather than choose a builder default. Add missing-both, blank-both, and missing-one tests asserting zero PUTs. The existing present-but-different-language test should continue to pass.

All four findings are source-proven paths; I did not add or execute custom reproducer scripts or mutate the snapshot. The requested regressions were not already present in the reviewed tests.

## Independently executed checks

All commands completed with exit code 0:

| Check | Observed result |
|---|---|
| Initial snapshot verification | Revision matches; 4,554 files unchanged |
| `npm exec -- vitest run --silent=true` | 506 files, 13,671 tests passed |
| `npm run typecheck` | Source, scripts and tests TypeScript projects passed |
| `npm run validate:policy` | 135 policy entries and 14 schemas passed |
| `npm run check:sizes` | 998 source/test files and all 12 schema scenarios within limits |
| `npm run test:qualification:pr1142` | All 59 printed historical formatter/deletion regression scenarios passed |
| Final snapshot verification | Revision matches; 4,554 files unchanged |

The full unit command's verbose mocked HTTP output was truncated by the tool; its completed final summary and exit code were observed. The historical qualification harness is an offline regression check, not DDIC/SDO native qualification.

Full lint, build and documentation checks were not independently rerun here. Their earlier outcomes are author/orchestrator reports; the orchestrator reports the mechanical Biome corrections and lint success after the author's command-allowlist interruption.

## Evidence limits and procedure

- No live SAP/BTP execution, credentials, browser actions, external-service calls, installs, Git operations, source changes, or mutant scripts were performed by this review.
- The approved unit command generated its usual ignored `test-results/unit.json`; both manifest checks confirmed all 4,554 attested files remained unchanged.
- First and last source operations were the supplied snapshot verifier. There were no source reads after the final successful verification. This report is written outside the snapshot under the parent's explicit authorization.
- One initial read-only batch occurred before the detailed prompt was loaded; it included a mistaken read of nonexistent `review-input/author-result.md`. The correct `author-report.md` was subsequently read. No data was changed by that deviation. Checks themselves were run sequentially.
- FEAT-93 was checked at the start and again near completion. Its remaining public admission, native mutation, read-companion/precondition and PP qualification gaps remain open. No roadmap edit was made in this review.
- Public read companions, exact native response/activation behavior across supported releases, transportable flows, two successful PP writers and full refusal/control qualification remain separate work. Offline success and unchanged public gates do not close those gaps.
