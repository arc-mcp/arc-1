# Independent DDIC/SDO correction review — request changes

Reviewer: Codex fallback following the confirmed actual Claude Opus 5.5 HIGH usage limit. This is not a Claude review.

Candidate: `7a1e8aefec0e33a4d279a31857aa43b0607990d7`
Base: `9e7ef606a8553d99f5e4d5e6d2d9381e9032fc98`
Immutable source: `/Users/marianzeis/.local/state/arc1-review/pr1142-ddic-sdo-review2-20261102-200950/source`

## Verdict

**Request changes / NO-GO for marking this private component ready to integrate:** the four original P2 findings are resolved, but the remaining P2 preservation issue below needs correction and focused regression coverage. I found no new public-admission or authorization bypass.

This verdict is limited to the private DDIC/server-driven candidate and its correction. It does not approve native execution, public admission, Principal Propagation qualification, the entire PR, or merge/release.

## DDIC-R5 — P2: Requested subtree patterns also authorize changes to unselected sibling fields

Location: [pinned-metadata-write.ts:44](/Users/marianzeis/.local/state/arc1-review/pr1142-ddic-sdo-review2-20261102-200950/source/src/handlers/write/pinned-metadata-write.ts:44). The same issue appears in the value-table matcher on line 43, TTYP matchers on lines 69–72, and ENQU matchers on lines 78–80. The matcher implementation is [pinned-metadata-projection.ts:119](/Users/marianzeis/.local/state/arc1-review/pr1142-ddic-sdo-review2-20261102-200950/source/src/adt/pinned-metadata-projection.ts:119).

The namespace corrections protect foreign namespaces, but these native subtree patterns still end at a name prefix without a path-segment boundary:

- `/^\/doma:content\/doma:valueInformation\/doma:fixValues/`
- `/^\/doma:content\/doma:valueInformation\/doma:valueTableRef/`
- `/^\/ttyp:rowType/`
- `/^\/enqu:content\/enqu:primaryTable/`, `secondaryTables`, and `lockParameters`

For a concrete source-proven path, add a nonempty native `<doma:fixValuesExtra>kept</doma:fixValuesExtra>` sibling next to `<doma:fixValues/>` in the stored domain document, and select `fixedValues: []`. The projection correctly retains the extra field. However, the shared merge extracts only supported properties, and `buildDomainXml` rebuilds a document without that sibling. Its removed path begins with the selected `fixValues` prefix, remains entirely in the DOMA namespace, and therefore passes `matches`. `assertOnlyRequestedChanges` accepts the removal, the handler sends the PUT, and a readback matching the rebuilt body can confirm success. The unknown sibling was not part of the selected fixed-values subtree.

Equivalent same-namespace siblings such as `ttyp:rowTypeOptions` or `enqu:lockParametersExtra` are also admitted by the corresponding patterns. This undermines the full-document preservation guard precisely when a backend returns a stored field the builder does not know. This is not an assertion that these example extension names currently occur on A4H; the code and documented contract explicitly preserve unknown native fields, and the examples demonstrate the uncovered matching class.

**Required correction:** match exact native path segments and their intended descendants/repeated entries, rather than arbitrary name prefixes. Review every subtree selector above. Add projection and real private-handler regressions with nonempty same-namespace sibling fields, asserting refusal before PUT and successful own-session cleanup. Retain positive coverage for legitimate selected subtrees and valid repeated-list entries.

This finding is based on the existing source path; I did not create or run a custom reproducer or edit the immutable snapshot. Existing tests cover unknown fields, namespace lookalikes and foreign extensions inside selected lists, but not these same-namespace prefix siblings.

## Original finding closure

| Finding | Disposition and evidence |
|---|---|
| DDIC-R1 | Closed. Only enumerated numeric dimensions/counts normalize padding, using string comparison without numeric precision loss. Text stays exact. Handler tests prove `007` → `7` sends one PUT and ignored text readback reports `metadata-save-unknown` with cleanup; long digit strings and padded dimensions have focused coverage. |
| DDIC-R2 | Closed for the reported namespace-loss defect. Stable aliases preserve exact known namespace identities; unknown namespaces use expanded names and retain empty-node presence. Namespace rebinding changes hashes, equivalent prefix renaming does not, and foreign extensions cannot be silently selected. The separate path-prefix defect above remains. |
| DDIC-R3 | Closed. Save and activation share mode-dependent derivation rules, based on target and captured metadata respectively. Built-in DTEL datatype/length/decimals, TTYP built-in fields and explicit ENQU parameters remain verified. Active-but-different handler regressions return `activation-not-confirmed`; legitimate domain/dictionary-derived dimensions and generated ENQU parameters still pass the offline model. |
| DDIC-R4 | Closed. MSAG updates require nonempty, unpadded and matching namespace-bound language/master-language evidence. Missing, blank, padded, ambiguous and mismatched cases send zero PUTs. The native XML identity helper rejects colliding or incorrectly bound language attributes. |

The inspected delta changes private projection/owner/metadata/activation code and related tests/docs; the shared legacy builders and public capability/schema admission remain unchanged. The focused suite includes public write/activation refusals, stale preconditions, identity/package drift, uncertain saves and own-session cleanup. Namespace identity now participates in private metadata hashes, so older private hashes require a fresh read; comparison-equivalent numeric padding still affects the representation hash, as documented.

## Independently executed checks

All checks below completed with exit code 0. Checks ran sequentially with explicit snapshot working directories. The executable was verified as Node `v22.21.1` using `PATH=/Users/marianzeis/.nvm/versions/node/v22.21.1/bin:$PATH`.

| Check | Observed result |
|---|---|
| Initial `/opt/homebrew/bin/python3 review-input/verify-snapshot.py` | Candidate revision matches; 4,556 files unchanged |
| `npm exec -- vitest run --silent=true` with the six focused files below | 6 files, 317 tests passed |
| `npm run typecheck` | Source, scripts and tests TypeScript projects passed |
| `npm run validate:policy` | 135 entries, 14 tool schemas passed |
| `npm run check:sizes` | 998 source/test files and all 12 schema scenarios within budget |
| Final snapshot verifier | Candidate revision matches; 4,556 files unchanged |

Focused files: `tests/unit/adt/pinned-metadata-projection.test.ts`, `tests/unit/adt/pinned-ddic-owner.test.ts`, `tests/unit/handlers/pinned-ddic-metadata.test.ts`, `tests/unit/handlers/pinned-ddic-activation.test.ts`, `tests/unit/handlers/pinned-ddic-table.test.ts`, and `tests/unit/handlers/pinned-server-driven.test.ts`.

The full suite was not rerun: no broader change or failure justified repeating it for this narrow correction. The author reports 506 files / 13,715 tests plus build, lint and strict MkDocs success; those are author-reported results, not independent results from this review. No historical qualification harness was rerun.

## Evidence limits and procedure

- No live SAP/BTP/native requests, network or browser actions, credentials, installs, source edits, manual Git operations or delegation were used. The approved size script performed its normal tracked-file check.
- The default shell initially reported Node 22.18.0; no tests were run with it. All executed checks used the explicit verified 22.21.1 PATH.
- First and last source actions were the supplied verifier. No source was read after final verification. This report was written outside the snapshot.
- The unit runner produced its normal ignored `test-results/unit.json`. All 4,556 attested files remained unchanged.
- Some read/tool output and verbose mocked HTTP test logs were truncated. The relevant current source/tests were read separately, and the completed test summary and exit code were observed. This did not justify assuming an unseen test outcome.
- I read the supplied prompt, author report, committed original independent verdict, correction delta, governing AGENTS/dev-guide/accepted-plan context and FEAT-93 roadmap. The roadmap was rechecked near completion; no roadmap edit was made.
- Fresh native stored/saved/active evidence, default/empty-value equivalence by family and release, transportable flows, two successful PP writers, refusal controls, public read companions, public admission and whole-PR acceptance remain open. Offline checks do not establish those behaviors.
