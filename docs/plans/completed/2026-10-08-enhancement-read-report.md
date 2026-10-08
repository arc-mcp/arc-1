# Enhancement read type-conflict report

## Diagnosis

A source-code enhancement read returned HTTP 400 from `enhoxhb` with
`ST_ENH_ADT_ENHO_BADI` in the error. The accompanying editor screenshot showed
`ENHANCEMENT`, confirming a source-code plug-in rather than a BAdI implementation.
Customer names, source code, screenshots and system identifiers are not retained here.

ARC-1 before 1.5.0 sent every ENHO read to the BAdI collection. SAP then attempted
to serialize a hook implementation using the BAdI transformation. This is the
same failure addressed by [#901](https://github.com/arc-mcp/arc-1/pull/901), merged
on October 1 and first released in **1.5.0 on October 2, 2026**.

On October 8, the old endpoint reproduced the exact error on SAP_BASIS 758 SP02.
The current reader at `759ce116` recovered for both `/MFND/CORE_UPD_BDS_CONNECTION`
and `/SMFND/DEMO_DEL_BOOKING`: XHB error → exact repository search → XHH metadata →
XHH source. Each returned one hook and source identical to a direct source GET
(377 and 371 characters respectively). `/AIF/ANS_RESTART_EI` still needed one GET.
These checks used production `handleToolCall`, direct HTTPS/Basic and client 001;
all operations were reads.

The [error fixture](../../../tests/fixtures/xml/enhancement-type-conflict.xml) is
the unchanged HTTP 400 body captured from the test system's
`/sap/bc/adt/enhancements/enhoxhb/%2FMFND%2FCORE_UPD_BDS_CONNECTION` endpoint with
`Accept: application/vnd.sap.adt.enh.enhoxhb.v4+xml`. It contains no customer data.
The [ENHO contract record](../../research/abap-types/types/enho.md) explains the
supported subtypes and SAP's source-code plug-in documentation.

The reported deployment version is unknown. An older build is a plausible cause,
not a verified fact. The customer object, selected-target deployment and principal
propagation route have not been tested. A current build can still fail if exact
repository lookup cannot select a supported subtype or SAP rejects its own route.

## Plan

1. Preserve the existing runtime fix. A second resolver, broad endpoint probing,
   new tool parameters or a SAP Note workaround has no evidence-based benefit.
2. Replay the captured SAP XML error in the existing ENHO dispatcher tests. Verify
   recovery, preserved diagnostics when lookup cannot resolve the object, and
   propagation of hook-source failures without another subtype attempt.
3. Add concise troubleshooting to the enhancement-read documentation: verify the
   running server version, upgrade an older artifact to 1.5.0 or later through
   the normal deployment procedure, then retry the same read with `version`
   omitted or `auto`. If it still fails, collect exact lookup and route evidence
   using the same target and identity.
4. Demonstrate the regression tests reject the pre-#901 behavior. Run focused and
   full unit tests, typecheck, lint, policy/schema budgets, build and strict docs.
   Verify the built server through MCP against the authorized test system.
5. Review the final diff and evidence, create a test/docs PR, and hand off a
   focused Claude review prompt. Do not claim this PR introduces #901's fix.

## Plan review

The runtime is already correct for the reproduced failure. Keep this follow-up
limited to a real error fixture, existing tests and troubleshooting. Do not add a
new integration harness or change generic discovery, error parsing, identity,
caching, schemas or enhancement authoring. No customer environment is changed.

Roadmap checked: **No roadmap impact**. FEAT-03 concerns authoring and ARCH-01 a
general resolver; neither is required for this already-fixed read failure.

## Validation and final review

- The focused suite passes **31/31** tests with the captured XML. Temporarily
  restoring the pre-#901 always-XHB behavior makes **21 fail / 10 pass**; the
  original runtime file was restored unchanged before final checks.
- **8,008 tests in 267 files pass**. Typecheck, lint, policy validation, file/schema
  budgets, build and strict MkDocs pass. Biome reports two existing informational
  notices; no formatting or runtime changes were needed.
- Built server verified through **stdio MCP → HTTPS/Basic → SAP_BASIS 758 SP02**,
  client 001, on Node 22.21.1. The MCP handshake reports ARC-1 1.5.1. Both hooks
  again return source identical to a direct GET; the BAdI returns its implementation.
  The documented `SAPSearch` command returns `ENHO/XHH` for the test hook.
- The build uses `759ce116` with this PR's test/docs changes. The unchanged
  `src/adt/enhancements.ts` SHA-256 is
  `e2921552e1dad0e37c7c0273b32e463086798d4674a5244a427cec2d7d76aa7c`.
- Review checked the exact report and screenshots, prior fix/release history,
  dispatcher recovery, source-error propagation, documentation commands, fixture
  privacy and the final diff. No new runtime defect was found in the reproduced
  scenario. Customer-version confirmation and a read on that deployment remain
  outstanding; the local test does not establish PP or multi-target behavior.
- Final roadmap check: no change to FEAT-03 or ARCH-01, and no new deferred idea.
