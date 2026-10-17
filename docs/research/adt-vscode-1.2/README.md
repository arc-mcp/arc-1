# ADT for VS Code 1.2: ARC-1 adoption backlog

**Decision record · 17 October 2026.** Start with trustworthy transport review. Then evaluate
the notebook runner, policy explanations and verified diagnostics as separate changes.
This is the durable index for the research, including ideas we deliberately defer.

## Read in this order

1. This backlog: what is useful, what exists, and the next evidence needed.
2. [Transport plan](../../plans/2026-10-17-transport-review.md): scope, spikes and acceptance tests.
3. [Detailed handoff](evidence/ARC1_RESEARCH_HANDOFF.md): TD-01–10 and other acceptance criteria.
4. [Deep report](evidence/arc1-deep-adoption-and-transport-review.html): rationale and pinned source links.

## Baselines and confidence

| Evidence | Revalidated state | Limit |
|---|---|---|
| SAP extension | Marketplace Version History refreshed on October 17: **1.2.0**, published October 16; installed `sapse.adt-vscode-1.2.0-darwin-arm64` | A client feature does not establish backend availability |
| ARC-1 release | **v1.5.2**; [1.6 release PR #970](https://github.com/arc-mcp/arc-1/pull/970) still open | Main and deployed connectors are separate baselines |
| ARC-1 main | `b10acb15` (includes #1006) | Recheck before each implementation slice |
| Original research | `9775645400fdb27f37aff486f14fe9845ecf8639`; 181 unit tests and eight synthetic observations | Observation probes are not assertions or live coverage |
| Existing local prototype | `codex/post-1-6-review-workflows`; 67 uncommitted files preserved | Includes later stages; not shipped or included wholesale in the transport PR |
| Live prototype evidence | A4H/001, SAP_BASIS 758 SP02, local CLI over HTTPS 443 | Does not prove 750, 816, BTP or the deployed connector |

The installed transport/core/DDIC bundles are 3.62.0; language server is 1.2.0.202610161300.
Static client inspection establishes request intent, while captured SAP responses establish the
tested backend contract. Older comparison documents about 1.1.1/ADT 3.60.1 remain historical.

## Step-by-step delivery candidates

These are review checkpoints, not promises or an automatic execution queue. Local prototypes
must pass fresh review and tests before being treated as implemented product functionality.

| Step / ID | Useful outcome | Existing evidence / reuse | Acceptance before delivery |
|---|---|---|---|
| 1 · TD-01–04 | Transport results never hide missing parts or mislabel uncertain changes | Eight observation probes; existing request/task and main/CCIMP history | Mixed success/404, unattributed changes, text-only scope and undated work-state regressions |
| 2 · TD-05–09 | Explicit source mode, revision evidence, bounded collection and inventory drift detection | Existing revision reader/diff; local prototype | Modes cannot substitute work states for released history; bounded bytes/work; caller/target-bound continuation; invalid history differs from empty |
| 3 · REVIEW-01 | Reusable JSON and readable HTML review report | Existing intent dispatcher, SAPContext, syntax checks | Complete/partial/stale demos; real transport run; checks identify current source; no release-readiness verdict |
| 4 · NB-01 | Portable Markdown/SQL notebook and small runner | SAPQuery; observed `.abapsql` flight fixture; local prototype | Explicit target mapping; no auto-run; SQL gates; exact string values; blocked/failed/incomplete states; real allowed and denied run |
| 5 · POL-01 | Explain the caller's effective policy | ACTION_POLICY, dispatch, safety, package and target evaluators; prototype | Explanation agrees with enforcement; unresolved prerequisites explicit; never execute a mutation to test permission |
| 6a · SYN-01 / FEAT-69 | Bounded native multi-object syntax checks | Observed 758 `checkObjectList`, prototype | Missing/unattributed reports cannot become passes; deterministic per-object results; cross-release limits |
| 6b · FEED-01 / FEAT-74 | Discover diagnostic schema and validate focused dump filters | Existing feeds; 758/816 observations; prototype | Target-specific advertised attributes/operators; validated grammar; existing paging/time guards; denied differs from empty |
| 6c · DDIC-01 / FEAT-71 | Read the advertised Dictionary activation log | Observed relation/media-type GET on 758; prototype | Canonical same-target link, bounded hierarchy, denied/unsupported states; old log never attributed to the newest attempt |
| 7 · TD-10 / FEAT-86 | Broader historical transport coverage | Bounded metadata/history investigation | Per-family before/after fixtures and attribution proof; prioritize gaps seen in pilot reviews |

The broad report originally ranked notebooks first. The deeper transport probes supersede that
ordering. The earlier activation-log uncertainty is also superseded: the installed client follows
`http://www.sap.com/adt/relations/ddic/activationlog` with GET and
`application/vnd.sap.adt.logs+xml`. Attempt correlation remains unproven.

## All 19 workflow areas

| ADT area | ARC-1 decision | Next step / resume trigger |
|---|---|---|
| Destination restrictions | Reuse merged opt-in XSUAA target grants, #677 / ADR-0008 | Release and landscape acceptance; no second ACL engine or incidental writes |
| Package write restrictions | Reuse real-package exact/prefix/subtree checks | Explain clearly: write-package rules are not read/data restrictions |
| Effective access explanation | POL-01 above | Review the prototype against actual evaluators; complex actions stay unresolved |
| SQL notebooks | NB-01 above | Small runner first; editor only if repeated use identifies editing as the bottleneck |
| Timeline / comparisons | REVIEW-01 above | Preserve provenance and uncertainty; avoid another diff engine |
| Transport Organizer | Reuse list/get/history/mutations; build review workflow | Specific missing task/member action needs its own use case; owner fix #1003 is merged |
| Diagnostic feeds | FEED-01 above | Dumps first; Gateway/ATC/Unit feeds only with advertised, verified contracts |
| Dictionary activation log | DDIC-01 above | Reader before attempt correlation; never reactivate merely to get a log |
| Object checking | SYN-01 above | Syntax, ATC and Unit are distinct; run relevant checks explicitly |
| Source-code search | Reuse SAPSearch source_code | Reuse merged #1006; coordinate with open #1007; unavailable is not zero matches |
| Explanation / documentation | Reuse SAPContext, KTD and existing explanation skills | Improve citations/templates against a representative corpus; no core model-service dependency |
| Source/file editing | Reuse method surgery; review open #586 | Validate duplicate anchors, stale source and locks; editor buffers need an explicit client bridge |
| Object-action discovery | Conditional catalog of already classified operations | Concrete discovery use case; derive policy/capability-filtered catalog; never execute unknown advertised actions |
| ATC exemptions | Demand-driven governed workflow | Confirm classic/cloud family, approvers and CHKE contract; request preparation before explicit mutation |
| Service consumption models | Conditional SRVC/OData importer | Customer integration need, EDMX contract, generated ownership/package/transport/readback; RFC/WSDL later |
| Swagger / service testing | Conditional bounded OData inspection | Service-binding metadata and selected safe GETs first; no arbitrary write console |
| Additional repository objects | Per-family matrix below | Prove lifecycle and backend release; do not copy an enum list |
| RFC without SAP Logon Pad | No parity work | ARC-1 already connects through HTTP/BTP; RFC needs a separately justified workflow |
| Solution Manager systems | Customer-triggered compatibility investigation | Verify the exact managed transport flow; no blanket ChaRM claim |

## Repository object families

| Family | Current baseline / next useful work | Evidence gate |
|---|---|---|
| DEVC, DTEL, MSAG | Already supported; examples and specific compatibility fixes | Actual failing workflow, not registry parity |
| ENHO / ENHS | BAdI implementation writes on main; FEAT-03 covers broader authoring | Definition/container lifecycle, lock/package ownership and activation |
| TABL/DTT | Main has technical-settings support; FEAT-70 holds remaining fields | Partial updates preserve untouched values; parent package and active readback |
| DSFD, DTDC, DTSC | Existing registered support | Definition support does not prove scalar-function implementation support |
| DRTY and further CDS families | Reuse DRTY; FEAT-73 for specific additions such as DSFI/DRAS | Per-type discovery, MIME, source state and lifecycle |
| CDS indexes / TABL/DTI | Table indexes on main; FEAT-72 CDS indexes blocked | Existing seed object plus reproducible CDS index lifecycle |
| UIAD / UIPG / UIST | UIAD exists; page/space templates need research | Customer need and native lifecycle; legacy FLP groups/catalogs are different |
| SAJC / SAJT / APLO | Existing server-driven implementation | Backend gating and actual lifecycle; no duplicate type additions |
| SMBC | Read path on main | Authoring only for a concrete configuration workflow; read support is not CRUD |
| SRVC | No native authoring established | EDMX import and generated-object reporting first |
| CHKE | No native exemption workflow established | Governed classic/cloud contract, permissions and approver flow |
| SIA6 / SWCR / PCFN | No native lifecycle established | Specific use case plus each type's contract |
| TRAN | Metadata read; source/write remains FEAT-62 | Required endpoint absent on tested systems; resume on observed backend support |
| XSLT | Native lifecycle not established | Migration/customer requirement and source/lock/readback contract |

For each writable family, establish native identity, create schema, source representation,
lock owner, real package, transport, inactive/active state and readback. Use the generic
server-driven engine only when the observed type follows that contract.

## Historical coverage research queue

| Gap | Evidence so far | Next bounded spike / stop condition |
|---|---|---|
| Text pools / REPT | Current program/class metadata; no history relation in inspected samples | Two historical text-only versions, language and symbols/selections/headings; otherwise keep explicit gap |
| FUGR | Sample main history active-only; structural ownership incomplete | Two numbered include histories and owner mapping; whole main is not complete group coverage |
| DOMA / DTEL / TABL | Historical endpoints seen; at most one useful numbered demo snapshot | Two differing historical payloads, stable field meaning and deletion semantics |
| METH across requests | Existing class sample proves main/CCIMP changes only | Different methods in two requests; retain whole-part scope warning until attribution proven |
| Test transports | Client parses `isTestTransport`; none observed live | Intermediate flagged snapshot plus direct flagged-request/task review before filtering |
| History continuation | Synthetic `rel=next`; none observed live | Actual continuation contract before following links; partial evidence meanwhile |
| Deletion / Customizing keys | No representative before/after fixture | Capture operation/key metadata; a 404 never proves deletion |

## Research archive

Original files are preserved, not silently corrected. Local paths and dated status in them describe
the original session. Use this index for current decisions. No SAP binaries/disassembly are included.

| File | Purpose |
|---|---|
| [Release analysis](evidence/adt-vscode-1.2-analysis.html) | Original 1.1.2 versus 1.2 client comparison |
| [Broad adoption report](evidence/arc1-adt12-adoption-review.html) | All workflow/object families; prioritization partly superseded |
| [Deep transport report](evidence/arc1-deep-adoption-and-transport-review.html) | Correctness evidence, acceptance criteria and business hypotheses |
| [Handoff](evidence/ARC1_RESEARCH_HANDOFF.md) / [original prompt](evidence/ARC1_IMPLEMENTATION_PROMPT.txt) | Full requested stages and constraints |
| [Observation script](evidence/arc1-transport-diff-probes.mts) / [original results](evidence/arc1-transport-probe-results.json) | Eight mocked observations; run against an explicitly selected checkout |
| [Flight notebook](evidence/Flight_Capacity_Showcase.abapsql) / [screenshot](evidence/ADT_1.2_SQL_Notebook.png) | Observed SAP notebook format and real extension demonstration |
| [Prototype record](evidence/local-prototype-results.md) | Earlier local implementation and measured 758 results; later stages remain outside this PR |
| [Independent Claude review](evidence/claude-review-1.md) | Opus 5.5 Max GUI review of PR #1008 at `0244d4cc`; dispositions in the [validation log](../2026-10-17-transport-review-validation.md) |
| [Claude follow-up approval](evidence/claude-review-2.md) | Independent verification at `d83cf19b`; no must-fix findings; optional diagnostic notes followed up |
| [Claude final approval](evidence/claude-review-3.md) | Final product revision `f7598c33`; no remaining actionable findings; targeted tests and real HTTP timeout check |
| [Original manifest](evidence/HANDOFF_MANIFEST.json) / [archive hashes](evidence/archive-sha256.json) | Provenance and integrity |

Further repository evidence: [August transport plan](../../plans/2026-08-03-transport-diff.md),
[August comparison](../2026-08-03-transport-diff-comparison-and-plan.md),
[July VS Code probes](../2026-07-21-sap-vscode-roadmap-dtdc-dsfd-probe.md), and
[current idea roadmap](../../../docs_page/roadmap.md).

Primary sources: [SAP Marketplace](https://marketplace.visualstudio.com/items?itemName=SAPSE.adt-vscode),
[SAP MCP tools](https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/mcp-tools),
[SAP SQL console](https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/working-with-sql-console),
[VS Code Notebook API](https://code.visualstudio.com/api/extension-guides/notebook).
SAP Help pages needed browser rendering in the original research; the text fetch remained empty
or unavailable during revalidation. The archive records the original observations explicitly.

## Measure before expanding

Pilot 5–10 representative transports. Record reviewer preparation time, false-complete outcomes,
coverage gaps by family, backend calls/bytes/latency and report usefulness. Choose the next historical
adapter from those gaps. Savings and commercial demand remain hypotheses until measured.

## Follow-up implementation

The [eight-request transport pilot](../2026-10-17-transport-pilot.md) records actual coverage gaps
and bounded metrics. The [follow-up plan](../../plans/2026-10-17-adt-followups.md) separates the
notebook, policy and diagnostic slices. The notebook runner is implemented in this branch; its
[guide](../../../docs_page/sql-notebooks.md) documents explicit execution, narrow scalar assertions
and limits. Validation and independent-review results are recorded with its draft PR.
