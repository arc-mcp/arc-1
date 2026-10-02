# Issue #904: namespaced function-group include create/delete

## Root cause and evidence

[Issue #904](https://github.com/arc-mcp/arc-1/issues/904) reports ARC-1 1.5.0 rejecting
`/ABC/LNAMEB03` in group `/ABC/NAME` on SAP_BASIS 752 SP06 before contacting SAP.
The shared create/delete guard in `src/handlers/write.ts` prepended `L` to the entire
group name, producing `L/ABC/NAME`. Both actions reproduced that rejection locally
on base commit `1f00c7ac`.

SAP's [Creating an ABAP Function Group Include](https://help.sap.com/docs/SAP_NETWEAVER_AS_ABAP_FOR_SOH_740/c238d694b825421f940829321ffa326a/4ec69a576e391014adc9fffe4e204223.html?version=7.40.21)
documents the order: optional namespace, `L`, group name, suffix. Read-only ADT
inspection of A4H confirmed `/AIF/ADV_MSG_SUM_UI` contains
`/AIF/LADV_MSG_SUM_UIF01`, `/AIF/LADV_MSG_SUM_UITOP`, and other matching includes.
The existing URL builders already encode the whole group/include path segment;
the XML builder already escapes names. Neither needs a namespace-specific path.

The reporter verified namespaced create, source write, and activation after
patching this guard on 752 SP06. That is reporter evidence, not a run of this PR.

## Main-program insertion is a separate verification gap

On A4H (SAP_BASIS 758 SP02), read-only inspection of
`CL_FB_ADT_RES_FUGR_INCLUDE` found:

- `CREATE_SOURCE_OBJECT` reads the insertion flag and passes it to
  `RS_CREATE_NEW_INCLUDE`.
- `READ_FLAG_INSERT_INCLUDE` defaults to true. A supplied ADT template property
  named `createIncludeStatement` with value `false` disables insertion.
- The same method derives the main-program identity with
  `FUNCTION_INCLUDE_CONCATENATE` and takes the lifecycle package from the
  container reference.

A disposable `$TMP` group `ZARC904A` confirmed the current XML creates
`LZARC904AF01`, appends its `INCLUDE` statement, and comments the line out when
the include is deleted. The include returned 404 after deletion; the parent was
also deleted. This corroborates the earlier 7.50/758 research. The reporter's
752 SP06 result differs; its cause was not verified on that system. Documentation
must therefore not promise universal insertion.
This fix does not change XML flags, package handling, or source insertion.

## Fix plan and review

1. In the existing create/delete guard, split an optional leading `/namespace/`
   from the group and insert `L` after it. Keep the existing trim/case behavior.
2. Extend handler tests for ordinary and namespaced create with source, delete,
   encoded URLs and include locks, incorrect namespace/group rejection before
   HTTP, and package restrictions.
3. Correct the tool description and user/contributor guidance. Keep the public
   input schema unchanged; refresh and review only the description snapshots.
4. Run a failing-before/passing-after regression, repository checks, and a
   disposable live lifecycle, then review the final diff.

Plan review: the change belongs in the shared guard, so both affected actions
are fixed together. A new helper, naming framework, schema option, or ADT call
would add no value. Preserve the real-parent-package create gate, include-package
delete gate, and existing lock/CSRF/transport behavior. Batch creation already
refuses structural includes and remains unchanged.

## Live-test scope

- Target: A4H, S/4HANA 2023, SAP_BASIS 758 SP02, client 001.
- Route: HTTPS reverse proxy on port 443, Basic authentication, local TypeScript
  tool dispatch through `handleToolCall`; no MCP desktop or BTP/PP claim.
- Namespace limitation: bounded `TRNSPACE` inspection found only `/0CUST/` with
  producer role. SAP rejected disposable FUGR `/0CUST/ARC904A` with TK/103,
  "This syntax cannot be used for an object name". No namespace configuration
  was changed. Namespaced create/delete therefore need live confirmation in
  a usable customer namespace; encoded routing and both actions are tested locally.
- All write fixtures are disposable `$TMP` objects. Standard namespaced objects
  were only read.

## Initial verification and review

Tested ARC-1 1.5.0, base `1f00c7ac` plus this PR's runtime patch, on 2026-10-02.

- Removing only the prefix fix makes 15 focused regression cases fail; restoring
  it passes all 129 tests across `write-surgery-rap.test.ts` and
  `tool-definitions-snapshot.test.ts`. The pre-fix focused run intentionally
  filters out the file's unrelated cases.
- `npm test`: 254 files, 7,753 tests passed, no skips.
- `npm run typecheck`, `npm run build`, `npm run lint`,
  `npm run validate:policy`, and `npm run check:sizes`: passed. Lint reports two
  pre-existing informational suggestions outside this change.
- Final live fixture: `ZARC904_MURA7N0V` in `$TMP`, with structural include
  `LZARC904_MURA7N0VF01`. Tool-dispatch create with `source="FORM issue904.\nENDFORM."`
  passed; read-back matched after normalizing SAP's CRLF line endings. Include and
  group activation passed, active source matched, and the FUGR syntax result was
  `checked=true`, `hasErrors=false`, with no messages. Include deletion returned
  success and a subsequent metadata GET returned 404; the main-program line was
  commented. Parent deletion and its subsequent 404 confirmed cleanup.
- A final bounded TADIR query confirmed all four attempted fixture groups were
  absent, including the rejected namespace probe and an earlier run whose
  read-back assertion needed CRLF normalization.

The initial diff review found no further actionable findings. That runtime patch only
changes the shared prefix calculation; package resolution, mutation gates,
encoded URL/XML construction, and locking retain their existing implementations.
Regression tests cover denied and unresolved include packages before mutation.
All five snapshot changes are the same corrected `group` description; there are
no input or capability changes. Live namespaced deletion and transported writes
remain unverified, as stated above.

## Claude review reassessment

Reviewed the supplied findings against PR head `ff8a8fd1`, then tested the
lowercase-parent scenario on the same A4H/758 SP02 system.

| Finding | Assessment and action |
|---|---|
| Main SAPWrite description still promises `L<GROUP>` and automatic insertion | Confirmed. Corrected `tool-descriptions.ts` and its four on-prem snapshots to show `[/NS/]L<GROUP>` and require checking the main-program line. The earlier change only covered the `group` property's description. |
| Lowercase `containerRef` can break include creation | Confirmed live, with a stronger failure than the proposed missing-insertion explanation: HTTP 500 and no include created. Uppercase the trimmed group in the INCL XML builder; leave URL encoding and package resolution unchanged. Assert uppercase parent XML for ordinary and namespaced groups. |
| `SAPLX…` can suppress insertion | Confirmed by read-only SAP source inspection. In `RS_CREATE_NEW_INCLUDE`'s new-include branch, the namespace is stripped before the `SAPLX` comparison; that branch passes a false insertion flag. Document this exception without claiming it explains the reporter's 752 result. |
| Standalone/batch `L*` guards miss namespaced names | Confirmed code shape, but whether SAP reserves every `/NS/L*` name for structural includes is not established here. Keep the existing guards; verify the backend contract in a usable customer namespace before widening a rejection rule. |
| One-line prefix rewrite / shared helper | Not adopted. The existing match and conditional are explicit and small. Combining separate naming routines or changing longer-sibling matching would add unverified scope. |
| FUNC has a similar raw parent reference | Confirmed code pattern only; its SAP create path was not tested. No FUNC changes in this INCL fix. |

No explicit `createIncludeStatement=true` flag was added: it is already the 758
default and would not override that release's `SAPLX` exception. Its behavior on
the reporter's 752 system remains unverified.

Before the XML correction, disposable group `ZARC904CMURDX3MI` existed in `$TMP`.
Creating `LZARC904CMURDX3MIF01` with `group=" zarc904cmurdx3mi "` returned
HTTP 500, "Object R3TR FUGR zarc904cmurdx3mi cannot be created without a package".
The include GET returned 404 and the main program had no matching statement.
The two new parent-XML assertions also failed before the fix.

After correction, the same lowercase/whitespace request shape on disposable group
`ZARC904CMURE01WI` succeeded: include exists, source matches, and main program
contains its `INCLUDE` statement. Include and group activation succeeded and
the syntax check returned `checked=true`, `hasErrors=false`, no messages.
Both runs cleaned up successfully: metadata GETs returned 404 and a bounded
TRDIR query confirmed no main program, TOP/UXX include, or test include remained.
This verifies lowercase ordinary-group behavior; live namespaced writes remain
limited by the namespace setup described above.

The original PR CI run `37046518149` stopped its Node test jobs at the dependency
audit, with the existing `node-forge` advisory `GHSA-86w9-cpqp-85rv`; downstream
SAP jobs were skipped. The local audit reproduced the failure and reported no
fix available on 2026-10-02. `package.json` and `package-lock.json` are unchanged
from `main`. The audit gate was not bypassed and dependency remediation is outside
this include fix.

Follow-up validation: 130 focused handler/snapshot tests passed; the two added
parent-XML assertions failed before uppercasing and pass afterward. Typecheck,
build, lint, policy validation, file/schema budgets, strict MkDocs, and diff checks
passed. Lint retains the same two unrelated informational suggestions.

The default-concurrency full run was interrupted under severe host load. The
completed two-worker run had 7,751 passing tests and three startup/deadline
failures in the CLI subprocess and shutdown signal tests. All three subsequently
passed in isolated reruns without changing source, test assertions, or timeouts;
one shutdown case needed a single-case rerun, with the other 11 intentionally
filtered out. The unmodified PR code also passed the shutdown tests. These
results do not constitute a clean single full-suite run and are recorded as
timing-sensitive validation, separately from the passing include regression and
live SAP lifecycle. Final review found no additional actionable patch findings.

## Roadmap

Checked `docs_page/roadmap.md`: no roadmap impact. This fixes an existing supported
operation. The reported insertion difference is documented with its
verification gap rather than introducing an unverified feature.
