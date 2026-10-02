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

## Final verification and review

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

Final diff review found no further actionable findings. The runtime patch only
changes the shared prefix calculation; package resolution, mutation gates,
encoded URL/XML construction, and locking retain their existing implementations.
Regression tests cover denied and unresolved include packages before mutation.
All five snapshot changes are the same corrected `group` description; there are
no input or capability changes. Live namespaced deletion and transported writes
remain unverified, as stated above.

## Roadmap

Checked `docs_page/roadmap.md`: no roadmap impact. This fixes an existing supported
operation. The reported insertion difference is documented with its
verification gap rather than introducing an unverified feature.
