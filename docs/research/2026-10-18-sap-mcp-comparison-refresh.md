# SAP ABAP MCP comparison refresh — 18 October 2026

## Scope and reproducibility

Updated public source: `docs_page/arc-1-vs-sap-abap-mcp-server.md`.

ARC-1 baseline inspected: main **15db42217a28634b3a64bed3dfd5fa90e432d942**.
Published release: **v1.6.0**, tag commit **041a9e48d7fbc0aaa573e952025ff30eda75de18**,
published 17 October 2026. The tag predates transport-review and stored-text changes even though
main's package version remains 1.6.0.

Independently rechecked:

- The published comparison page and its repository source.
- Live SAP Help rendered in a browser. The search/web extractor returned empty shells for Help
  pages; browser-rendered content supplied the actual catalog, restrictions and release matrix.
- Official Marketplace description.
- Installed official macOS ARM64 `SAPSE.adt-vscode` **1.2.0** manifest. Read only the package's
  static settings/schema; no user credentials or private destination settings were published.
- ARC-1 source/tool contracts, current roadmap, release notes, GitHub release and PR state.
- SAP API Policy PDF: still **v.4.2026a**.

No SAP mutation or new backend feature-qualification run was performed. No fresh SAP MCP
`tools/list` is claimed: the configured VS Code default port had no listening process during
this check. This refresh did not enable or reconfigure the user's MCP server.
Prior live results are explicitly attributed to their own recorded tests.

## Existing work recovered

The Codex chat **Analyze ABAP ADT extension 1.2** contained the original extension comparison,
19-area ARC-1 adoption analysis and transport review probes. Its saved outputs were inspected:

- `adt-vscode-1.2-analysis.html`
- `arc1-adt12-adoption-review.html`
- `arc1-deep-adoption-and-transport-review.html`
- `ARC1_RESEARCH_HANDOFF.md` and implementation handoff references.

These are research inputs, not authority to revive superseded recommendations.
The current [research index](adt-vscode-1.2/README.md) and merged decisions take precedence over
the original proposals for a notebook runner, broad policy preview or report framework.
The original material is preserved in the
[immutable archive](https://github.com/arc-mcp/arc-1/tree/19c728722e87b59f4915f6252af4ecee4dbf8e36/docs/research/adt-vscode-1.2/evidence).

The follow-up native-link chat and **draft #1025** supplied the previous #676/bridge requirements,
installed SAP tool-name differences and actual Copilot/native-opening evidence. Inspected head:
**adfae1e1addbe2b785089458316d0b5dae39e006**.
Its [initial native-link dossier](https://github.com/arc-mcp/arc-1/blob/adfae1e1addbe2b785089458316d0b5dae39e006/docs/research/2026-10-17-adt12-native-ide-links.md)
has deliberately narrower/older implementation claims than its
[later HTTP/BTP dossier](https://github.com/arc-mcp/arc-1/blob/adfae1e1addbe2b785089458316d0b5dae39e006/docs/research/2026-10-18-btp-native-ide-links.md)
and final PR description. Use the latter for HTTP implementation status.

No other chat was messaged, modified or restarted. Previous reviewer results are prior-PR evidence,
not independent review of this documentation change.

## Claim corrections and source map

| Earlier page claim | Current conclusion | Evidence |
|---|---|---|
| June's 20 tools describe SAP's current catalog | Current public reference lists 33 identifiers; actual advertised tools vary | [SAP MCP reference](https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/mcp-tools) |
| No SAP MCP source read/edit/search | These capabilities are documented; editing is separately enabled | Same reference; installed manifest and #1025 package inspection |
| No SAP MCP runtime diagnostics | Feed tools are documented | Same reference; keep IDE views distinct |
| SAP has no package allowlist | Destination/project restrictions and package change patterns exist | [Enabling MCP](https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/enabling-adt-mcp-server) and installed settings |
| SAP authorizations are the only write limit | MCP restrictions also apply; file-edit opt-in is not a global read-only switch | Same setup page and manifest |
| Package restrictions could imply read isolation | Neither product's write-package list is a source-read allowlist | SAP setup page; ARC-1 authorization contract |
| VS Code default port 2234 | VS Code 1.2 default is 2236; 2234 belongs to the old Eclipse observation | SAP setup page and manifest |
| Only two SAP AI-fix tools carry AI cost | Explanation and documentation retrieval are also flagged; MCP support entitlement is separate | Current SAP MCP reference |
| Classic object omissions from June establish present limits | Current IDE coverage includes DTEL/MSAG/packages/BAdIs and more; query actual MCP type support | [Marketplace](https://marketplace.visualstudio.com/items?itemName=SAPSE.adt-vscode), [release matrix](https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/what-s-new) |
| SAP has no SQL or transport release | Native IDE SQL notebook and Transport Organizer release exist; dedicated MCP SQL/release IDs are not in the inspected reference | Release matrix, [SQL notebook](https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/working-with-sql-console), MCP reference |
| ARC-1 latest is 1.5.0 | Published 1.6.0; later main changes need separate labels | [Release](https://github.com/arc-mcp/arc-1/releases/tag/v1.6.0), tag ancestry and release notes |
| Better tokens/speed can be inferred from tool counts | No comparative benchmark performed | No such evidence in the recovered work |
| Old adoption proposal is implemented | Decisions and status differ per extraction | PR reconciliation below |

SAP Help's 1.2 backend matrix includes ABAP environment 2611, Public Edition 2702, and varying
on-premise/private-cloud releases, including 2027. Some are future releases on the review date.
Client-package presence does not prove backend availability. The matrix contains duplicate
access-restriction rows and a source-search link pointing to transformation documentation;
the comparison avoids deriving a universal compatibility range from those rows.

## Settings checked directly in the installed package

| Setting | Shipped default / relevant scope |
|---|---|
| `adt.mcpServer.enabled` | `false` |
| `adt.mcpServer.port` | `2236`; configurable 1024–65535 |
| `adt.mcpServer.enableEditFileToolForABAPObjects` | `false`; warns of competing client edit tools |
| `adt.mcpServer.accessRestrictionsEnabled` | `true` |
| `adt.mcpServer.accessRestrictions.destinations` | Empty string |
| `adt.mcpServer.accessRestrictions.packages-objectChanges` | Empty string; creation/modification only |

The public example uses a fictitious destination alias and keeps native editing disabled.
It explains that other mutation tools can remain available.

## PR reconciliation

GitHub status checked 18 October 2026. Merged does not imply included in v1.6.0.

| PR | Observed status | Disposition |
|---|---|---|
| #970 | Merged release | v1.6.0 baseline |
| #677, #939, #963, #965, #966, #967, #979, #980 | Included in 1.6.0 release notes | Existing capabilities, qualified by their contracts |
| #1008 | Merged, commit `15db4221` | Post-release bounded source review |
| #1012 | Merged, commit `37fece94` | Post-release exact-key classic stored text |
| #1016 | Merged, commit `260c2b71` | Narrow deny-rule documentation/regression extraction |
| #1019 | Merged, commit `498c12bb` | Empty syntax report remains unchecked |
| #1023 | Merged, commit `2cb7b044` | Native notebook guidance/example and query regression |
| #1009 | Closed, unmerged | Runner rejected; do not advertise execution/import feature |
| #1010 | Closed, unmerged | Policy-preview tool rejected; do not advertise it |
| #1011 | Open draft | Broader diagnostics research; focused extractions assessed separately |
| #1020 | Open draft | Dump filters/schema; not on main |
| #1024 | Open draft | Saved SLG1 reader; not DDIC activation-log reader |
| #1025 | Open draft | Optional editor links; local HTTP/Copilot opening qualified, live CF gaps remain |
| #676 | Closed, unmerged | Historical bridge proposal; no automatic revival |

PR #1025 also changes the comparison page. This refresh supersedes that branch's limited
June-to-1.2 corrections, while keeping its editor-link functionality explicitly draft.
Reconcile the overlapping documentation when either branch merges; do not silently promote
#1025 to released status.

## ARC-1 source checks

Read `src/handlers/tools.ts` and public tool contracts for source search, the standard intent
surface, procedural-unit edits and relations. Cross-checked:

- `docs_page/release-notes.md`: release membership and 1.6.0 target-access availability.
- `docs_page/authorization.md`: independent write/data/SQL gates, real-package enforcement,
  read-policy limits and gCTS quarantine.
- `docs_page/multi-target-{setup,administration,authorization}.md`: mutation-free experimental
  boundary, shared Basic restrictions and optional IAM-assigned target grants.
- `docs_page/review-workflows.md`: post-1.6.0 source selection, unsupported historical scope,
  bounded work and lack of cross-page snapshot consistency.
- `docs_page/sql-notebook-authoring.md`: native format, no runner, separate ADT execution identity.
- ADR-0009: core report/class execution and direct RFC excluded; extension gates remain explicit.

Roadmap checked at start and finish. **No roadmap impact:** this reconciles existing evidence;
it does not implement, complete or create a new feature idea. Existing FEAT-03/62/70/71/72/73/74/90
remain scoped by their current evidence. Do not import draft-only roadmap edits from #1025 or #1020.

## Validation boundaries

This is a documentation-only change. Validation completed:

- `mkdocs build --strict`: passed after correcting a principal-propagation guide filename.
- Generated HTML inspection: 239 links inspected, no broken local targets or anchors.
- Catalog check: 33 documented SAP tool identifiers, all unique.
- Browser inspection in the existing documentation theme: introduction, comparison tables and
  rendered Mermaid architecture diagram display correctly.
- `git diff --check`: passed.

Runtime unit/integration/E2E suites were not rerun for this editorial change. No cross-product
performance, security certification, entitlement verification or fresh SAP feature execution
is claimed.

Future refreshes should obtain each live server's catalog and selected tool schemas before
promising callable names, recheck the backend release matrix, and compare the release tag with
main and open PRs. Native editor opening, dirty-buffer identity and editing/save/activation are
separate acceptance criteria.
