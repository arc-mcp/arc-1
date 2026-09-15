# Documentation review — 15 September 2026

Reviewed and revised all original public documentation pages, then applied an independent second review and checked the integrated site.

## Problem and scope

The public docs mixed first-time setup, exhaustive reference, implementation history and repeated safety guidance. Readers had to infer the page's purpose and next action. Some examples had also drifted from runtime behavior.

The review covered all **47 original Markdown pages** in `docs_page/`, their navigation entries and local links. Detailed references were split where topics could stand alone. The internal review record stays outside public navigation; [the developer guide](../dev-guide.md#public-documentation) links it.

## Research and editing rules

- Separate tutorials, task guides, reference and explanation so each page serves a clear reader need. [Diátaxis: Start here](https://www.diataxis.fr/start-here/).
- Use direct, active instructions, descriptive headings and consistent terminology; remove unnecessary introductory narration. [Google developer documentation style highlights](https://developers.google.com/style/highlights).
- Put the important action first and use short sections readers can scan. [Microsoft: Scannable content](https://learn.microsoft.com/en-us/style-guide/scannable-content/).

Applied rules: one canonical procedure/table, prerequisites beside the action, expected results beside verification, complete parameter/default/error contracts, preserved old anchors, and source-checked examples. After each page, the reviewer recorded a lesson and revisited earlier related pages when it exposed duplication or an incorrect claim. Separate reviewers then followed the edited paths and checked concrete changes.

These principles informed editorial choices; passing checks or reducing words does not measure human or LLM usability. No controlled reader study was performed.

## Size

Baseline: `f23765f03b152a663f7f17e94fd588ea62dd83a8` (the revision at the start of the review). Counts use whitespace-separated tokens from Markdown, including code and tables, rather than rendered prose. All added pages are included so extraction does not appear as deletion.

| Measure | Whitespace words |
|---|---:|
| Original 47 pages at baseline | 172,330 |
| Current contents of those same 47 paths | 65,280 |
| 19 added Markdown pages | 22,433 |
| Current published Markdown total (66 pages) | 87,713 |
| Reduction including added pages | 84,617 (49.1%) |

Historical roadmap/comparison material is linked at immutable revisions; it is no longer included in the current-docs word count. `CNAME`, JavaScript, images and `llms.txt` are not Markdown pages and are excluded from these totals. `llms.txt` was reviewed separately for useful entry links.

## Review of all original pages

Word counts use the same method as above. A short page may grow when it needs usable fields or missing prerequisites; length alone was not the acceptance criterion.

| Page | Words before → current | Review action | Lesson / revisit |
|---|---:|---|---|
| [agent-plugin.md](../../docs_page/agent-plugin.md) | 1,083 → 683 | Install, credentials and a real SAP read lead; retained lifecycle and local-checkout testing. | A visible plugin is not SAP access; clarified that checkout metadata still launches the published package. |
| [api-key-setup.md](../../docs_page/api-key-setup.md) | 1,179 → 661 | One read-only example, canonical deploy links and a valid MCP Accept header replace duplicated starts. | Separate MCP authentication from SAP access; applied to authentication tests. |
| [arc-1-vs-sap-abap-mcp-server.md](../../docs_page/arc-1-vs-sap-abap-mcp-server.md) | 6,097 → 623 | Deployment/capability decisions replace ratings, snapshot counts and universal claims. | Link volatile capability facts to primary sources; preserve dated comparison history separately. |
| [architecture.md](../../docs_page/architecture.md) | 2,845 → 900 | One request flow and code map replace repeated diagrams and policy tables. | Diagrams must preserve identity branches; revisited PP/cache behavior and source paths. |
| [auth-test-process.md](../../docs_page/auth-test-process.md) | 1,327 → 872 | Shared credential tests and distinct backend-identity checks replace repeated build/setup blocks. | Organize acceptance by evidence; removed weak hardcoded keys and password-grant examples. |
| [authorization.md](../../docs_page/authorization.md) | 5,030 → 3,651 | Retained exact scope/profile/capability tables and blocklist contract; corrected stale errors. | Keep reference data complete and delegate recovery; revisited the auth overview. |
| [blog-series.md](../../docs_page/blog-series.md) | 156 → 167 | Kept the article catalog with a specific first article and current-setup route. | Separate dated articles from current instructions. |
| [btp-abap-environment.md](../../docs_page/btp-abap-environment.md) | 2,457 → 1,623 | Distinct shared/local paths, complete read-only MTA override and shorter platform differences. | Align instructions with artifact defaults; revisited local prerequisites and cloud identity claims. |
| [btp-abap-prerequisites.md](../../docs_page/btp-abap-prerequisites.md) | 995 → 766 | Actionable SAP prerequisites remain; volatile commercial limits and repeated caveats were removed. | Link vendor-owned policy instead of copying dates/limits; cloud guide keeps connection steps. |
| [btp-administration.md](../../docs_page/btp-administration.md) | 3,075 → 2,476 | Kept the change matrix, RAM model and Basic lifecycle; condensed role theory and acceptance. | Name evidence and limits; revisited backend identity and inspected-artifact deployment. |
| [btp-cloud-foundry-deployment.md](../../docs_page/btp-cloud-foundry-deployment.md) | 4,043 → 2,846 | Shorter topology/ownership sections; archive inspection moved to a named procedure. | Each step needs an observable result; removed rebuild-after-inspection and clarified cloud profiles. |
| [btp-destination-setup.md](../../docs_page/btp-destination-setup.md) | 1,669 → 1,434 | Kept templates and full field contract; reduced nearby procedures and repeated warnings. | Compact tables must stay precise; corrected SQL independence, booleans and Basic mapping changes. |
| [btp-overview.md](../../docs_page/btp-overview.md) | 963 → 484 | One setup choice and compact ownership/task maps replace repeated acceptance lists. | Entry pages route; revisited acronym expansion and deployment handoffs. |
| [btp-setup-worksheet.md](../../docs_page/btp-setup-worksheet.md) | 283 → 282 | Fillable input/result tables replace a prose checklist. | Templates collect outputs and owners; checked against runbook/admin acceptance. |
| [caching.md](../../docs_page/caching.md) | 1,168 → 1,018 | Current cache behavior and operator choices replace implementation/migration narrative. | Move history after the current task; retained startup-relevant migration rules. |
| [cli-guide.md](../../docs_page/cli-guide.md) | 3,157 → 2,778 | Added command lookup and delegated repeated mutation details; retained options and exit rules. | Automation exits are essential; corrected ATC completion-by-count claims and retained retry limits. |
| [configuration-precedence.md](../../docs_page/configuration-precedence.md) | 1,188 → 755 | Shorter precedence examples and durable BTP-change guidance replace repeated warnings. | Small accurate examples beat repetition; rechecked earlier shell/env examples. |
| [configuration-reference.md](../../docs_page/configuration-reference.md) | 6,406 → 5,189 | Removed duplicate contents/internal operation table; shortened setting cells and grouped exceptions. | Keep exact contracts; corrected nonblocking syntax checks, nonexistent system_info and PP defaults. |
| [deployment-best-practices.md](../../docs_page/deployment-best-practices.md) | 2,559 → 871 | Deployment decisions and capacity effects replace duplicate runbooks and schema copies. | Explain each tradeoff once; removed unsupported cache ratios and shared-SQLite scale advice. |
| [deployment.md](../../docs_page/deployment.md) | 1,573 → 636 | Host/identity decisions and guide links replace three competing setup procedures. | Maintain one runnable setup source; Docker now owns its authenticated quickstart. |
| [docker.md](../../docs_page/docker.md) | 2,788 → 1,291 | One authenticated, loopback-bound, version-pinned quickstart replaces duplicate variants. | Validate the canonical example; corrected CA loading, health URL and security claims. |
| [enterprise-auth.md](../../docs_page/enterprise-auth.md) | 4,479 → 1,584 | One decision table and technical reference replace overlapping setup/choice blocks. | A chooser leads to one next guide; revisited it after operations and authorization. |
| [extensions.md](../../docs_page/extensions.md) | 2,976 → 1,185 | A minimal complete plugin leads; grouped API/permission/deployment tasks and removed obsolete advice. | Short examples must execute; corrected the export to Plugin apiVersion/tools[] against the loader. |
| [index.md](../../docs_page/index.md) | 1,524 → 345 | Purpose, first-task choices and a short capability summary replace mixed setup/test inventory. | Entry pages route readers; revisited homepage links after tool and BTP changes. |
| [install-in-claude.md](../../docs_page/install-in-claude.md) | 974 → 682 | Kept distinct Desktop/Code/remote procedures; removed repeated choice and obsolete release commentary. | Choose once, then follow the procedure; removed brittle skill-count prose. |
| [live-relations.md](../../docs_page/live-relations.md) | 2,211 → 1,613 | Ordered first call, task choice, prerequisites, limits and interpretation around actual use. | Explain bounds beside results; retained fixed limits and absence/coverage/identity caveats. |
| [local-development.md](../../docs_page/local-development.md) | 2,104 → 889 | Kept local source, SSO and CLI tasks; removed repeated config recipes and corrected watch/.env claims. | Use canonical examples; revisited required HTTP auth and cookie output path. |
| [log-analysis.md](../../docs_page/log-analysis.md) | 1,689 → 1,812 | Kept useful jq recipes; corrected stale-scope diagnosis and inaccurate time-window commentary. | State exactly what a success signal proves; revisited auth/health acceptance. |
| [mcp-usage.md](../../docs_page/mcp-usage.md) | 2,220 → 1,028 | Connection checks and task workflows replace repeated diagrams/type catalogs. | Duplicate examples drift; corrected legacy filtering, local-class includes and syntax/activation order. |
| [multi-target-administration.md](../../docs_page/multi-target-administration.md) | 4,466 → 3,583 | Task routes, full error/action tables and field meanings replace repeated setup and sample JSON. | Operators need error-to-action lookup; setup/reference pages now link here. |
| [multi-target-setup.md](../../docs_page/multi-target-setup.md) | 5,069 → 1,926 | A target-setup workflow links canonical deploy, field and error references; action table retained. | Reference data belongs once; revisited SQL gates and separate identity evidence. |
| [newsletter.md](../../docs_page/newsletter.md) | 259 → 150 | Kept the subscription action and privacy facts; removed repeated promotion. | Focused short pages need small edits, not more headings. |
| [oauth-jwt-setup.md](../../docs_page/oauth-jwt-setup.md) | 2,458 → 1,334 | Shorter provider guidance; preserved existing IAM settings and corrected fallback/JWKS claims. | Explain MCP versus SAP identity early; verify token rules against source/provider docs. |
| [operations.md](../../docs_page/operations.md) | 452 → 322 | A five-step incident path replaces overlapping platform link lists and editorial commentary. | Route the task, not the document structure; revisited the auth chooser. |
| [principal-propagation-setup.md](../../docs_page/principal-propagation-setup.md) | 3,414 → 2,323 | One infrastructure procedure replaces parallel fast/full paths; trust and identity checks retained. | Put completion evidence beside setup; revisited durable config and cloud/on-prem handoffs. |
| [quickstart.md](../../docs_page/quickstart.md) | 1,030 → 536 | One read-first connection path, a real object search and a symptom table; removed insecure/write-enabled defaults. | Startup is not SAP-read evidence; applied to local and trial setup. |
| [rate-limiting.md](../../docs_page/rate-limiting.md) | 3,112 → 1,245 | Kept exact defaults/buckets; removed speculative workload multipliers and repeated tuning recipes. | Numeric advice needs assumptions; revisited process/SAP/memory capacity guidance. |
| [release-notes.md](../../docs_page/release-notes.md) | 2,812 → 3,019 | Upgrade actions lead current notes; retained historical release records and removed internal CI mechanics. | Compress the presentation, preserve operational history; rechecked PP defaults and XSUAA repair advice. |
| [roadmap.md](../../docs_page/roadmap.md) | 32,761 → 312 | Current open work and an immutable historical link replace a stale implementation diary. | Archive history by revision; restored the direct-proxy limitation for incoming links. |
| [s4hana-public-cloud.md](../../docs_page/s4hana-public-cloud.md) | 1,319 → 985 | Cloud-specific trust/destination fields use the canonical deployment flow. | Show only the distinct cloud setup; removed unsupported SM20 verification assumptions. |
| [sap-api-policy-and-architecture.md](../../docs_page/sap-api-policy-and-architecture.md) | 2,876 → 436 | Three operator questions and current primary-source pointers replace argumentative history and self-scoring. | Architecture controls do not establish contractual permission; revisited comparison claims. |
| [sap-trial-setup.md](../../docs_page/sap-trial-setup.md) | 4,675 → 1,109 | Retained ADT/HTTPS/verification and old lock compatibility; delegated image installation to its vendor. | Avoid a second product manual; revisited TEST_SAP variables, npm scripts and local-test links. |
| [security-guide.md](../../docs_page/security-guide.md) | 5,586 → 1,697 | Concrete controls replace repeated inventories, speculative compliance claims and dated toggle status. | Bound claims and name owners; revisited JWT fallback, proxy limits and token inspection. |
| [skills.md](../../docs_page/skills.md) | 3,496 → 705 | Install/run steps and workflow catalog lead; moved editor setup out and added two omitted transport skills. | Catalog completeness needs a source check; compared SKILL.md files and revisited client guides. |
| [tools.md](../../docs_page/tools.md) | 21,676 → 473 | A task-oriented index links per-tool references and focused write recipes; legacy anchors retained. | Split independent reference topics; cross-review corrected release, text-pool, lock, lint and SQL claims. |
| [updating.md](../../docs_page/updating.md) | 3,075 → 2,542 | Current update task precedes historical migrations; preserved compatibility and version markers. | Lead with today’s operation; revisited rollback, XSUAA changes and npm-cache claims. |
| [xsuaa-setup.md](../../docs_page/xsuaa-setup.md) | 5,576 → 3,439 | Existing-MTA setup leads; reduced repeated scope/DCR inventories and clarified rotation. | Separate setup from repair; authorization links here for owner-aware recovery. |

## Added page groups

| Group | Purpose |
|---|---|
| [BTP archive inspection](../../docs_page/btp-archive-inspection.md) | Reusable Bash/PowerShell inspection of the exact MTAR and every nested payload; keeps the release gate out of the deployment narrative. |
| [VS Code skills](../../docs_page/skills-vscode.md) and [Eclipse skills](../../docs_page/skills-eclipse.md) | Separate editor setup while the shared skills page keeps installation and workflow selection. |
| `docs_page/tools/sap-*.md` (13 pages) | One reference for each of the 12 core tools, plus aggregate-only `SAPTargets`. |
| `docs_page/tools/write-*.md` (3 pages) | Function modules, class members and text elements, with operation-specific prerequisites and examples. |

All 66 public pages appear exactly once in navigation. A recursive contract test compares every current `.md` path with `mkdocs.yml`, and strict MkDocs validation rejects omissions. Moved headings retain useful legacy IDs; old tool-index anchors open a collapsed group of links to their new destinations. This internal report is outside the public site.

## Independent review and follow-up corrections

| Finding | Follow-up |
|---|---|
| Docker HTTP examples omitted mandatory MCP authentication and used `/mcp` as a health probe. | Added authentication, `/health`, localhost binding and a protected env-file example; revisited local HTTP guidance. |
| Setup pages treated `SYSTEM.user` or successful PP-client creation as actual SAP identity proof. | Separated process health, safe reads, certificate mapping and correlated SAP user/client evidence throughout BTP acceptance. |
| A deploy command rebuilt after archive inspection, while inspection selected the newest archive. | Require an exact archive path and deploy that artifact without rebuilding; applied to the Basic update path. |
| Cloud guide recommended a manifest with writes/SQL enabled while promising a read-only start. | Use complete read-only cloud MTA overrides and the canonical runbook; retain the distinction between cloud and on-premise profiles. |
| SQL guidance incorrectly required the data-preview flag as well as the SQL flag. | Checked safety operations, tool visibility and registry policy; documented independent preview and SQL gates. |
| XSUAA repair and route examples risked replacing existing IAM state or inventing the route from the space. | Use owner-aware role repair and the observed app endpoint; rechecked release notes and editor setup. |
| Architecture/cache claims used stale source paths or implied overly broad PP caching behavior. | Rechecked implementation paths, source revalidation, user-keyed inactive lists and dependency-cache behavior. |
| Split tool recipes retained inconsistent 7.50 lock-error attribution, parser-ceiling claims and release/type labels. | Corrected by the tool reviewer against current source and existing compatibility guidance. |
| SQL manual chunking advice could change aggregate/DISTINCT/HAVING results. | Replaced blanket split-and-union advice with semantics-aware query handling. |
| Extension example exported one tool where the loader required a Plugin with `apiVersion` and `tools[]`. | Replaced it with a complete plugin verified against the loader/public types. |
| Tool-index legacy links recreated a long miniature reference. | Added a compact task table and moved legacy links into a collapsed section; replaced hidden headings with explicit anchors so they do not clutter the table of contents. |

BTP cross-review additionally identified hidden-file handling in the PowerShell archive scan (`Get-ChildItem -Force`) and the MTA/MTAR terminology distinction; these were handed to the integration owner. The final review must record their disposition and any later findings.

## Integration with current main

During final integration, `main` advanced to `5bc5310b`. The review preserves its unreleased 1.3.0 notes,
package CI actions and CLI exit rules, UIAD candidate-validation and save-state contract, and batch
activation's `unknown` outcomes. The affected references were reread against the merged implementation.
No application-source changes are introduced by this PR relative to that base.

## Validation

- `npm run docs:build`: passed. Strict MkDocs checks include omitted navigation pages and local file/anchor targets.
- Documentation-related unit tests: **329 passed across 8 files** (`docs-tools-parity`, `btp-docs-contract`, `btp-pp-profiles`, `mta-descriptor`, `approuter-config`, `release-notes`, `ui`, `config`). Tool parameter/action parity checks and their negative controls remain intact after the split.
- After integrating current main, 95 focused UIAD/activation tests also passed (`write-uiad`, `uiad-check`, `activate`).
- `npm run typecheck`: passed for source, scripts and tests.
- `npm run lint`: passed; existing Biome schema/deprecation/style informational messages remain outside this change.
- `git diff --check`: passed. All 47 original Markdown files changed; all 19 added pages are included in the navigation and word counts.
- All 26 fenced JSON examples parse. SAPWrite examples also passed the runtime schema; the procedural ABAP example parsed and spliced through the implementation.
- In-app browser: reviewed the homepage, homepage → BTP setup → deployment flow, tool chooser → SAPWrite, configuration tables, and a legacy class-edit anchor. Search found the new SAPTargets page. Rendered checks led to the compact chooser and revised table columns.

Checks cover documentation structure, references, examples and the existing runtime contracts they describe. No live SAP deployment or mutation was performed; PowerShell procedures were reviewed and guarded by static contract assertions, not executed on Windows. No human or LLM usability score is claimed.

## Reproduce the counts

For each original Markdown path from `git ls-tree -r --name-only <baseline> docs_page`, count `len(git_show_text.split())`; count `len(Path(path).read_text().split())` for its current contents. Add the same current count for every new `docs_page/**/*.md` path. Keep the baseline revision fixed when rechecking after a commit.
