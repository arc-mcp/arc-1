# Final combined extension integration and review

The original CI result and subsequent live-test assertion repair are recorded in
[the follow-up](2026-11-01-bdef-summary-assertion-repair.md). Runtime source is unchanged.

Runtime `a2a86b74aee3b6e0b8882d70134d93f88717955c` integrates current main
`dd1893877` and class prerequisite `eec018270`. DDIC #1143 and source plug-in
#1158 have merged. Class #1146 incorporates and hardens #1124, retaining the
original author commit. This PR still depends on resolving #1146 before merge;
no PR was merged as part of this readiness work.

The final integration preserves the newer DDIC occurrence identities, observation
versions, bounded issues, source-provider classification and CSRF/auth recovery.
It also preserves the BDEF verification, native-action denials with independent
class hooks, uncertain DDIC scan reporting and aggregate provider failure statuses
at the summary output cap. Existing byte/token ceilings are unchanged.

## Automated and live checks

All 418 unit files / **11,297 tests passed** on Node 24.11.1. Typecheck, lint,
policy validation, build and file/schema sizes passed. The standard-full schema
is 74,945 bytes under the unchanged 75,000-byte ceiling. GitHub Node 22/24 and
MTA checks also passed at this runtime commit. The full workflow will run again
on this evidence/documentation head; its final result is recorded in PR #1145.

New reusable tests are `tests/integration/bdef-extensions.integration.test.ts`
and `tests/e2e/bdef-extensions.e2e.test.ts`. They assert original base preservation,
summary/source defaults, separately labelled authored extension bodies, repeated
calls with independent limits and partial-read behavior. Integration supports
both on-prem and BTP credentials; skipped environments are not live coverage.

Fresh read-only qualification at this exact runtime:

- **A4H SAP_BASIS 758**, client 001, HTTPS 443, existing Basic identity:
  public-dispatch BDEF integration passes. Two loopback HTTP/MCP tests pass against
  a new local source build, with writes, data preview and SQL disabled. Both
  `DEMO_RAP_EXTEND1` and `DEMO_RAP_EVENT_EXT` are verified as separate authored
  bodies. Automatic, explicit, repeated and source-window reads preserve the base.
- **A4H native denials:** each of `SAPNavigate.relations`, `SAPNavigate` and
  hyperfocused `SAP.navigate` passes through config parsing/validation and
  read-only scope intersection. Native discovery reports denied; all seven hook
  identities and eight rendered bodies remain in exactly two optional GETs.
  These are public-dispatch checks, not a deployed CF/PP qualification.
- **NPL SAP_BASIS 750**, client 001, HTTPS 443, existing Basic identity:
  public program replay preserves the base, all four nested implementation
  identities and qualified legacy provenance, with two optional sends.
- **BTP SAP_BASIS 920:** current discovery returns HTTP 503, system stopped.
  The fresh BTP test is not claimed. The integration file's BTP case was skipped
  in the A4H invocation. Historical named-user OAuth evidence at `adf699775`
  remains in [the earlier capture](2026-10-31-extension-final-runtime.json);
  it is not evidence of this runtime's BTP behavior.

[Machine-readable evidence](2026-11-01-extension-integration-readiness.json)
binds the source hash, successful cases, provider states and review to the
runtime. It contains no credentials, tokens or source bodies. No SAP object,
helper, SQL, RFC or business-table mutation was used for these read-only checks.

## Final Claude Code review

Claude Code 2.1.308, configured model `claude-opus-5-5`, reviewed an immutable
tracked-file archive of the runtime above. It had Read/Grep/Glob only, with
execution, edits, MCP, hooks/customizations and delegation disabled. The primary
diff was the integrated class prerequisite to this stage; the combined main diff
was supplied for boundary checks. The review completed successfully after
54 read/search calls and reported **no actionable findings**.

Its report below is static review; local and live execution evidence was produced
separately by Codex. The deliberately limited cold discovery, BDEF grammar,
non-active WUL, interface and deployment qualification remains explicit. See the
[previous review triage](2026-10-31-extension-claude-review.md) for earlier fixes.

**No actionable findings.**

This is a static review of the snapshot using Read, Grep and Glob only. I ran nothing, so the test, gate and live results you listed are your reported evidence, not something I reproduced.

## Checked with no defect found

**Trigger and base**
- Dispatch normalizes `type` before schema validation. `validateExtensionReadInput` and `EXTENSION_READ_TYPES` both include BDEF.
- The default-mode rules in `src/handlers/extension-read.ts:22-38` send partial reads to none and full reads to summary.
- `extensions=none`, `action` and `format=editable` make no optional sends. The CLI `source` and `read --flat` commands still select none through the shared set (`src/cli.ts:490,505`), so BDEF exports stay clean.
- The only other CLI SAPRead caller uses `action=diff`, which returns before discovery.
- `src/handlers/read.ts:772` captures the unfiltered source before grep or line slicing. Cached, revalidated and uncached reads all reach that capture.
- Failed base reads return early, and only cancellation rethrows out of the optional phase.

**Candidate selection and verification (`src/adt/bdef-extensions.ts`, `src/adt/bdef-extension-candidates.ts`, `src/adt/bdef-extension-parser.ts`)**
- Inactive bases and `provider_current` roots are rejected before any send, and all optional requests go through the session's shared budget.
- Candidates must be connected WUL rows of type `BDEF/BDO`, and fetch paths are rebuilt from the name.
- Sources are read with an explicit `version=active`, and only top-level `extend behavior for` heads matching the base's `define` entities qualify. Self edges are excluded.
- A candidate with no verifiable declaration becomes `incomplete`, not absent.
- Summary checks at most two candidates, and omitted ones are counted with `incomplete` status. An empty index stays `candidate_index` and never claims absence.

**Budgets and failure handling**
- Discovery, WUL, CSRF and candidate GETs all share one session's attempt, byte and deadline budgets.
- 401, 403, 429, 3xx, budget, safety and protocol failures stop the phase. Remaining candidates are counted as omitted.
- `RelationProtocolError` is converted to `ExtensionProtocolError` at line 160, and aborts propagate through every catch.
- A 404 or 5xx on one candidate leaves the provider `incomplete` and later candidates still run.

**Denials**
- `nativeRelationActionDenied` covers `SAPNavigate.relations`, whole `SAPNavigate`, globs and `SAP.navigate`.
- BDEF and CLAS/INTF skip only the native provider, with zero sends for that provider.
- CLAS hooks continue independently, and the POST sink guard is preserved. `SAPRead.BDEF` is enforced on hidden reads.

**Earlier review repairs (no regression)**
- `source-plugin-discovery.ts:146` now uses `break`, so `not_advertised` and 750 provenance finalization still run in summary mode.
- The DDIC comment and literal mask is intact, and nested or unfinished scans propagate as incomplete in both the adapter and structure context. Those are its only two callers.
- The class include handling and the exact active-revision (`00000`) path are preserved.
- Compact provider rendering still produces valid JSON within 2 KiB. Aggregate `providerStatuses` and omission counts survive provider dropping.

## Qualification limitations (not defects)

- **Cold BDEF discovery:** capability discovery spends the optional budget. A discovery document over 128 KiB ends summary as `incomplete` with a `wire_bytes` omission, and the base is preserved. Your integration test warms this cache with a 2 MiB allowance, so public cold summary on a real system isn't shown by it. The docs state this boundary.
- **BDEF block-comment nesting:** the lexer treats `/*` as nesting, and a scan that never closes stops silently (`bdef-extension-parser.ts:38`). If real BDL comments don't nest, a declaration after `/* /*  */` would be lost.
  - With no other declaration, the result stays explicit: `incomplete` for a candidate, `unsupported` for a base.
  - With an earlier declaration, the status stays `returned`, unlike the DDIC scanner's explicit incompleteness.
  - No grammar evidence shows this form is valid in active source, so I'm not raising it as a finding. If it is ever qualified, have the lexer report early termination.
- **Non-active WUL rows:** one such row stops the whole phase as `invalid_provider_response`. This fails safe, and live frequency remains the open question already noted in your triage.
- **Not assessed:**
  - The final BTP rerun, since BTP is stopped and only the historical `adf699775` evidence exists.
  - The GitHub CI run still in progress.
  - Your stated boundaries: positive interfaces, inactive snapshots, exhaustive indexes, runtime applicability, CF/PP/Cloud Connector and other releases.

## Roadmap

Checked `docs_page/roadmap.md` before and after integration. No roadmap impact;
FEAT-03 concerns enhancement authoring and remains unchanged.
