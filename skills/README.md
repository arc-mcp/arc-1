# ARC-1 Skills

Best-practice agent skills for common SAP development workflows with ARC-1.

Each skill is a directory containing a `SKILL.md` file with YAML frontmatter — the format used by [Anthropic Agent Skills](https://code.claude.com/docs/en/skills) and consumed by the [`vercel-labs/skills`](https://github.com/vercel-labs/skills) CLI. Agents discover them by `description` and load them on demand.

## Install as a Claude Code plugin (MCP server + all skills in one step)

For **Claude Code**, the whole toolchain ships as a single plugin — the ARC-1 **MCP server** *and* every skill below — from a marketplace hosted in this repo:

```text
/plugin marketplace add arc-mcp/arc-1
/plugin install arc-1@arc-1
```

Claude Code prompts for your SAP connection (URL, user, password — the password goes to the OS
keychain) when the plugin is enabled, starts the `arc-1` MCP server via `npx`, and loads every skill
namespaced as `/arc-1:<skill>` (e.g. `/arc-1:generate-rap-service`). Manage it with `/plugin`; run
`/reload-plugins` after an update.

> Already running the ARC-1 server another way (Claude Desktop MCPB, `claude mcp add`, or a BTP
> custom connector)? Use the `skills` CLI below to add just the skills — the plugin is only needed
> when you also want it to wire up the bundled MCP server.

## Install the skills via the `skills` CLI (any agent)

The fastest way is `npx skills` — it auto-detects the agents installed in your project (Claude Code, Cursor, GitHub Copilot, OpenCode, Gemini CLI, Codex, …) and installs into the right paths.

```bash
# Install all ARC-1 skills into the current project
npx skills add arc-mcp/arc-1

# Install globally (available in every project)
npx skills add arc-mcp/arc-1 -g

# Install just one skill
npx skills add arc-mcp/arc-1 -s generate-rap-service

# Pin to a release tag
npx skills add arc-mcp/arc-1#v1.0.0
```

See the [`skills` CLI docs](https://github.com/vercel-labs/skills#readme) for `update`, `remove`, project-pinned lockfiles, and the full agent compatibility matrix.

## Manual install (without the CLI)

Copy the whole `skills/<skill-name>/` directory into your tool's skills directory. The agent reads `SKILL.md` and discovers the skill via its frontmatter `description`.

| Tool | Project install | Global install |
|---|---|---|
| Claude Code | `.claude/skills/<name>/` | `~/.claude/skills/<name>/` |
| Cursor | `.agents/skills/<name>/` | `~/.cursor/skills/<name>/` |
| GitHub Copilot (VS Code/Eclipse) | `.agents/skills/<name>/` | `~/.copilot/skills/<name>/` |
| OpenAI Codex (CLI) | `.agents/skills/<name>/` | `~/.codex/skills/<name>/` |
| Gemini CLI | `.agents/skills/<name>/` | `~/.gemini/skills/<name>/` |
| OpenCode | `.agents/skills/<name>/` | `~/.config/opencode/skills/<name>/` |

Example for Claude Code (project scope):

```bash
git clone https://github.com/arc-mcp/arc-1.git /tmp/arc-1
mkdir -p .claude/skills
cp -r /tmp/arc-1/skills/generate-rap-service .claude/skills/
```

For tools not listed above, copy the body of `SKILL.md` into your tool's system prompt, custom instructions, or project context file. The skills are self-contained — they work anywhere you can provide custom instructions.

## Eclipse ADT + GitHub Copilot

For Eclipse ADT, use GitHub Copilot **Agent Skills** in Agent Mode. Eclipse does not list skills in the **Custom Agents** table; that table is only for optional `.github/agents/<name>.agent.md` custom agents. Skills appear in chat as `/skill:<name>` entries when **Enable Skills** is turned on.

Keep skills in a normal local Eclipse project, not inside the ABAP system/package tree. ADT's ABAP projects are semantic repository views, so Copilot may not see local instruction files unless you import a real filesystem folder into the workspace.

Recommended setup:

```bash
# macOS / Linux
mkdir -p ~/ADT_ECLIPSE_ARC1
cd ~/ADT_ECLIPSE_ARC1
npx skills add arc-mcp/arc-1 --agent github-copilot
```

```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force "$env:USERPROFILE\ADT_ECLIPSE_ARC1"
Set-Location "$env:USERPROFILE\ADT_ECLIPSE_ARC1"
npx skills add arc-mcp/arc-1 --agent github-copilot
```

You can optionally create `.github/agents/arc1-abap.agent.md` with a short ARC-1 ABAP agent profile, but that is not required for `/skill:*` commands to work.

Then in Eclipse:

1. Import `~/ADT_ECLIPSE_ARC1` on macOS/Linux or `%USERPROFILE%\ADT_ECLIPSE_ARC1` on Windows with **File → Open Projects from File System...**.
2. If dot folders are hidden, disable the `.* resources` filter in Project Explorer.
3. Turn on **Window → Preferences → GitHub Copilot → Chat → Enable Skills**.
4. Use Copilot Chat **Agent Mode** and configure ARC-1 as an MCP server under **GitHub Copilot → MCP**.
5. Type `/` in chat and confirm entries such as `/skill:sap-unused-code` or `/skill:generate-rap-service` appear. If newly added skills do not show up, open a new Agent Mode chat and restart Eclipse.

Use **Window → Preferences → GitHub Copilot → Custom Instructions** only for short always-on workspace instructions or project `.github/copilot-instructions.md` files. Do not paste the full skill catalog there.

Full setup, including ARC-1 MCP JSON examples and troubleshooting, is in the published [Skills guide](https://docs.arc-1-mcp.com/skills/#github-copilot-in-eclipse-with-adt).

## VS Code ADT + GitHub Copilot

For SAP's ABAP Development Tools for VS Code, use a multi-root workspace:

1. Add your ABAP destination or package using the SAP ADT commands, such as **ABAP: New Destination** and **ABAP: Add Package as Folder to Workspace...**.
2. Add one normal local folder, for example `~/ADT_VSCODE_ARC1` on macOS/Linux or `%USERPROFILE%\ADT_VSCODE_ARC1` on Windows, to hold `.github/skills`, `.agents/skills`, Copilot instructions, `system-info.md`, and optional local ABAP mirrors.
3. Install skills from that local folder:

   ```bash
   # macOS / Linux
   mkdir -p ~/ADT_VSCODE_ARC1
   cd ~/ADT_VSCODE_ARC1
   npx skills add arc-mcp/arc-1 --agent github-copilot
   ```

   ```powershell
   # Windows PowerShell
   New-Item -ItemType Directory -Force "$env:USERPROFILE\ADT_VSCODE_ARC1"
   Set-Location "$env:USERPROFILE\ADT_VSCODE_ARC1"
   npx skills add arc-mcp/arc-1 --agent github-copilot
   ```

4. Configure ARC-1 in `.vscode/mcp.json` if you want to use these skills as written. SAP's bundled ADT MCP server is useful too, but its tool names differ, so ARC-1-specific skill steps may need adaptation unless ARC-1 is also enabled.

Full setup is in the published [VS Code Skills guide](https://docs.arc-1-mcp.com/skills/#github-copilot-in-vs-code-with-sap-adt).

## Prerequisites

These skills assume you have:
1. **ARC-1 MCP server** connected and configured (SAP system access). Required for every skill that touches ABAP.
2. **mcp-sap-docs MCP server** connected (optional but recommended — provides SAP documentation context). Used by most skills; required for the UI5 modernization skills to look up V4 binding patterns and FCL behaviour.
3. **SAPUI5 MCP server** (`@ui5/mcp-server`). Required for `modernize-ui5-app` and `convert-ui5-to-fiori-elements` — provides the authoritative TypeScript conversion guidelines, project scaffolding, ui5-linter, and manifest validation.
4. **Fiori MCP server** (`@sap-ux/fiori-mcp-server`). Required for `convert-ui5-to-fiori-elements` only — provides the LROP scaffold + annotation-aware page-template configuration.
5. **A browser MCP** — `Claude_in_Chrome` or `Claude_Preview`. Used by `modernize-ui5-app` for the final render verification step (HTTP 200 alone is not a sufficient acceptance gate — see the "blank page" traps in the skill).
6. **(Optional) Official SAP ABAP MCP server** — the `abap-mcp` server that ships with ABAP Development Tools for VS Code and is enabled in Eclipse ADT 3.60+. When connected *alongside* ARC-1, the RAP-build skills can offload the single-root managed+draft build to SAP's own *Generate ABAP Repository Objects* generators. Entirely optional and auto-detected — every skill falls back to the ARC-1 build when it's absent.

## Interop with the official SAP ABAP MCP server

`generate-rap-service`, `generate-rap-service-researched`, and `migrate-segw-to-rap` can each delegate the **single-root** build step to SAP's official generator framework (`abap_generators-list_generators` / `get_schema` / `generate_objects`) when the `abap-mcp` server is connected. The pattern, baked into each skill, is deliberately defensive:

1. **Probe the server** — no `abap_generators-list_generators` tool ⇒ official server absent ⇒ ARC-1 build.
2. **Resolve the generator by name, never by a hardcoded ID** — IDs are release-specific (`uiservice` / `webapiservice` on SAP_BASIS 758; `ui-service` / `webapi-service` / `x-ui-service` on 816). Call `list_generators`, match "OData UI Service" / "OData Web API Service" by display name, use the returned `id`. Not listed ⇒ ARC-1 build.
3. **Respect the generator's hard limits** — a single entity, managed+draft, a table with the modern timestamp fields (`abp_lastchange_tstmpl` / `abp_locinst_lastchange_tstmpl`), and one-shot (not for post-generation). ARC-1 owns discovery, multi-entity compositions, actions, custom logic, and every later edit.

Net effect with both servers in context: SAP's generator produces a blessed managed+draft baseline for the simple case; ARC-1 does everything around it and is the complete fallback when the generator isn't there.

## Available Skills

### Creating & Generating

| Skill | What it does | When to use |
|---|---|---|
| [generate-rap-service](generate-rap-service/SKILL.md) | Creates a complete RAP OData service stack (table, CDS views, BDEF, SRVD, SRVB, class) from a natural language description, with provider-contract-aware service generation. Optionally offloads the single-root managed+draft build to SAP's official `abap-mcp` generator when that server is connected (falls back to the ARC-1 build otherwise) | Quick prototyping, simple CRUD, standard UI service generation |
| [generate-rap-service-researched](generate-rap-service-researched/SKILL.md) | Same output as above, but researches the target system first (existing naming conventions, architecture patterns, revisions, docs, formatter settings, impact) and builds an approved plan before creating anything. The plan records a *Build engine* decision — ARC-1's manual stack, or SAP's official `abap-mcp` generator for the single-root seed when that server is connected | Production-quality services in transportable packages, complex domains, "measure twice, cut once" mode |
| [generate-rap-logic](generate-rap-logic/SKILL.md) | Implements determination and validation methods in an existing RAP behavior pool using structured class reads, version-aware edits, and quickfix-aware validation | After creating a RAP service — fills in the empty method stubs with ABAP Cloud logic |
| [generate-cds-unit-test](generate-cds-unit-test/SKILL.md) | Generates ABAP Unit tests for CDS entities using the CDS Test Double Framework | When a CDS view has calculations, CASE expressions, WHERE filters, JOINs, or aggregations worth testing |
| [generate-abap-unit-test](generate-abap-unit-test/SKILL.md) | Generates ABAP Unit tests for classes with dependency analysis and test doubles | When a class has non-trivial business logic and uses dependency injection |
| [generate-analytics-star-schema](generate-analytics-star-schema/SKILL.md) | Generates a CDS analytical model — cube + dimension + text views — on top of a RAP business object or DDIC table, written in one `batch_create` + `activateAtEnd` pass | Building embedded-analytics foundations; making a transactional model analytical (SAP Joule "CDS Analytical Model Generation" parity) |
| [generate-cds-analytical-query](generate-cds-analytical-query/SKILL.md) | Generates an analytical query (transient `provider contract analytical_query` projection view) on top of an existing analytical cube | Exposing a cube as a consumable KPI query for SAP Analytics Cloud / Analysis for Office / embedded analytics (SAP Joule "CDS Analytical Query Generation" parity) |

#### generate-analytics-star-schema → generate-cds-analytical-query

These two chain. The star-schema skill builds the **model** (cube + dimensions + texts); the analytical-query skill projects the consumable **query** on top of the cube. Run star-schema first when no cube exists yet, then the query skill. The model layer requires the analytics annotations (7.5x); the query layer requires `provider contract analytical_query` (SAP_BASIS 7.57+).

#### generate-rap-service vs generate-rap-service-researched

Both skills produce the same RAP artifact stack. The difference is how they get there:

| | generate-rap-service | generate-rap-service-researched |
|---|---|---|
| **Approach** | "Vibe code" — starts creating immediately | "Measure twice, cut once" — researches first |
| **Research** | None — uses SAP standard defaults | Deep — reads existing RAP projects, naming conventions, ATC config |
| **Questions** | Minimal — just the business object description | Targeted — asks only what research couldn't answer |
| **Plan approval** | Shows artifact table, asks to proceed | Full implementation plan with architecture decisions, requires explicit approval |
| **Best for** | Quick prototyping, proof of concept, simple CRUD | Production services, complex domains, teams with established conventions |
| **Guardrails** | Managed only, UUID, single entity, standard CRUD | Any scenario — managed/unmanaged, compositions, custom keys |

### Recent ARC-1 Features These Skills Use

- `SAPContext(action="impact")` for RAP/CDS reuse and "what breaks if I change this?" analysis
- `SAPDiagnose(action="cds_testcases")` for SAP-native CDS test-case discovery (CDS Test Double Framework) — powers `generate-cds-unit-test` Step 2 on SAP_BASIS 8.16+ (ABAP Platform 2025), returning per-semantic `testMethod`/`semanticType`/`calculatedField` suggestions; falls back to manual DDL semantic analysis on older releases (ARC-1 PR #351)
- `SAPRead(type="VERSIONS")` and `SAPRead(type="VERSION_SOURCE")` for pattern mining and safer edits of existing RAP stacks
- `SAPSearch(searchType="tadir_lookup", source="both")` for one-shot existence checks against both released and inactive variants, with a `splitBrain` warning when an object exists only in one source — used by `migrate-segw-to-rap` Phase 6a (ARC-1 v0.9.5+ / PR #270)
- `SAPWrite(action="batch_create", activateAtEnd: true)` for atomic CDS-composition activation — replaces per-file + manual terminal activation in `migrate-segw-to-rap` Step 2 (ARC-1 v0.9.5+ / PR #270)
- `SAPTransport(action="history")` for object-to-transport traceability during later iterations
- `SAPRead(action="diff", from=…, to=…)` for server-side single-system version diffs (active↔inactive, or revision↔active) returning only hunks — powers `sap-transport-review` (ARC-1 PR #445)
- `SAPTransport(action="list", summary=true)` for a headers-only transport overview (omits `objects[]`, keeps `objectCount`) — cheap scan before drilling in, also used by `sap-transport-review` (ARC-1 PR #448)
- `SAPLint(action="format" | "get_formatter_settings")` for SAP-native keyword case and indentation
- `SAPRead` / `SAPWrite` for `SKTD` so generated RAP services can carry attached Markdown documentation
- `SAPGit` when a package is already part of an abapGit or gCTS-backed delivery flow

### Analyzing & Understanding

| Skill | What it does | When to use |
|---|---|---|
| [explain-abap-code](explain-abap-code/SKILL.md) | Reads an ABAP object, fetches all dependencies via SAPContext, and produces a structured explanation — including behavior definitions (BDEF: parses `implementation in class`, reads the behavior pool CCIMP handlers, runs SAPContext impact on the bound CDS root) | Onboarding to unfamiliar code, investigating bugs, documenting undocumented objects, understanding a RAP behavior (SAP Joule "AI Explain for Behavior Definitions" parity) |
| [migrate-custom-code](migrate-custom-code/SKILL.md) | Runs ATC readiness checks, groups findings by priority, and generates replacement code | Preparing custom code for S/4HANA migration or ABAP Cloud readiness |
| [sap-object-documenter](sap-object-documenter/SKILL.md) | Batch-documents many custom objects at once — purpose, style (Classic/Modern/Mixed), dependencies — as Markdown | Onboarding packages, handoffs, seeding a repo wiki (vs. explain-abap-code which is single-object interactive) |
| [sap-transport-review](sap-transport-review/SKILL.md) | Reviews what *changed* — in a transport or in your unactivated drafts — as per-object unified diffs (`SAPTransport summary` to scan, `SAPRead action="diff"` to diff) plus risk flags and optional impact/ATC. The headless/whole-transport twin of Eclipse ADT 3.6's "Object Changes" | Pre-release/pre-activation gate, reviewing a transport (senior dev), "what have I changed since my last release?", change hand-off or audit |
| [sap-transport-overview](sap-transport-overview/SKILL.md) | System-wide inventory of every open transport (all users) — owner, size, and risk flags (object in two requests, $TMP, stale, empty) via `SAPTransport(list, summary=true, user="*")`. Breadth, no diffs — the companion to sap-transport-review | Basis/release manager: "what's open across the system and what's risky to import", backlog & cleanup, pre-go-live conflict check |

### Clean Core & Custom Code Retirement

| Skill | What it does | When to use |
|---|---|---|
| [sap-clean-core-atc](sap-clean-core-atc/SKILL.md) | Audits a package of custom code and buckets every Z/Y object into Clean Core Levels A–D using mcp-sap-docs + ATC | Planning an ECC→S/4HANA Cloud or BTP move; quarterly custom-code health check |
| [sap-unused-code](sap-unused-code/SKILL.md) | Finds Z/Y objects never called at runtime using SCMON or SUSG, then cross-references static where-used | Scoping a custom-code retirement project; pre-migration dead-code cleanup (requires `SAP_ALLOW_FREE_SQL=true` + `S_TABU_NAM` on `SCMON_*`/`SUSG_*`) |

### Legacy Migration (Backend + UI)

End-to-end conversion of legacy SAP stacks. `migrate-segw-to-rap` handles the OData V2 → RAP V4 backend; then **one of** the two UI skills runs in parallel against the new V4 service. Pick the UI path based on whether the target architecture is annotation-driven (Fiori Elements) or custom-controls freestyle (UI5 TypeScript).

| Skill | What it does | When to use |
|---|---|---|
| [migrate-segw-to-rap](migrate-segw-to-rap/SKILL.md) | Reverse-engineers a SEGW-built OData V2 service (MPC/DPC/MPC_EXT/DPC_EXT) into a modern RAP V4 service: tables, CDS views (interface + projection), behavior definitions, draft entities, service definition + binding. For the single-root case, can optionally seed the root BO via SAP's official `abap-mcp` generator, then layer the children/actions on with ARC-1 | S/4HANA modernization; ABAP Cloud readiness; replacing CASE_MANAGEMENT_API / SEGW services that need to land on a Fiori Elements or modern UI5 app |
| [convert-ui5-to-fiori-elements](convert-ui5-to-fiori-elements/SKILL.md) | Generates a Fiori Elements V4 LROP app (list report + object page) driven by `@UI.*` annotations on the V4 service, using the Fiori MCP server's 3-step (`list_functionalities` → `get_functionality_details` → `execute_functionality`) workflow | The legacy UI maps cleanly to a standard LROP pattern; you want minimum custom code and maximum SAP-managed consistency |
| [modernize-ui5-app](modernize-ui5-app/SKILL.md) | Converts a legacy UI5 freestyle JavaScript app (sync bootstrap, jQuery.sap.*, ES5, sap_belize) into a modern UI5 TypeScript app on UI5 1.147 with `sap.f.FlexibleColumnLayout`, typed event handlers, ES modules, `BaseController`, sap_horizon — with 5 documented "Critical Traps" up front to skip past common debugging detours | The legacy UI has custom controls / non-standard UX that don't fit a Fiori Elements template, or you want a TypeScript freestyle baseline for further customization |

#### convert-ui5-to-fiori-elements vs modernize-ui5-app

Both run against the same V4 RAP service produced by `migrate-segw-to-rap`. The difference is the target UI architecture:

| | convert-ui5-to-fiori-elements | modernize-ui5-app |
|---|---|---|
| **UI framework** | Fiori Elements V4 (`sap.fe.templates.*`) | UI5 1.147 freestyle (`sap.m.*` / `sap.f.*`) + TypeScript |
| **Layout pattern** | List Report → Object Page (FCL-ready via `allowDeepLinking`) | FlexibleColumnLayout with hand-authored views |
| **Customization mechanism** | OData annotations (`@UI.LineItem`, `@UI.HeaderInfo`, `@UI.DataPoint`, ...) on CDS projection / annotation views | Hand-authored XML views + TypeScript controllers |
| **Custom code** | Minimal — annotations only; controller extensions only when unavoidable | Full — every view, controller, formatter is hand-written TS |
| **Best for** | Standard CRUD, search/filter, sort, drilldown, value help, Approve/Submit action buttons | Non-standard UX, custom controls, dashboards, freeform layouts, anything `sap.fe.*` doesn't template |
| **Skill depends on** | ARC-1 + sap-docs + ui5-mcp-server + fiori-mcp | ARC-1 (optional) + sap-docs + ui5-mcp-server + browser MCP |
| **Maturity** | Driven by `@sap-ux/fiori-mcp-server` 3-step API + annotation-discovery via `mcp__sap-docs__search` | 5 documented Critical Traps from accumulated run learnings; teaches LLM to investigate via Self-help patterns |

### System Context & Local Workflow

| Skill | What it does | When to use |
|---|---|---|
| [bootstrap-system-context](bootstrap-system-context/SKILL.md) | Probes SID, release, installed components, feature flags, and lint preset; writes a local `system-info.md` | First step of a session against an unfamiliar system — grounds the assistant in real constraints before any code work |
| [setup-abap-mirror](setup-abap-mirror/SKILL.md) | Creates a local abapGit-style mirror of a package or object list for IDE context and `git diff` | Onboarding a codebase, pre-migration snapshotting, feeding local context to tools that can't call MCP per-read |

### Meta / Quality

| Skill | What it does | When to use |
|---|---|---|
| [analyze-chat-session](analyze-chat-session/SKILL.md) | Analyzes the current conversation's tool calls and produces a feedback report | After a complex session — identifies inefficiencies, anti-patterns, and improvement suggestions |
| [arc1-cursor-regression](../.claude/skills/arc1-cursor-regression/SKILL.md) | Generates a tailored Cursor MCP config and regression prompt set for ARC-1, derived from PR diff or chat findings | Verifying a specific ARC-1 PR/fix/feature against the live MCP surface |

### Typical Workflow

Skills are designed to chain together. A typical RAP development flow:

```
1. bootstrap-system-context         →  Capture SID, release, features, lint preset
2. generate-rap-service-researched  →  Create the service stack (uses system-info.md)
3. generate-rap-logic               →  Add business logic (validations, determinations)
4. generate-abap-unit-test          →  Generate tests for the behavior pool
5. generate-cds-unit-test           →  Generate tests for the CDS views
6. optional: attach SKTD docs / inspect revisions / inspect transport history
7. analyze-chat-session             →  Review what worked, file improvements
```

For embedded-analytics modeling (cube → query):

```
1. bootstrap-system-context        →  Confirm SAP_BASIS 7.57+ (analytical_query support)
2. generate-analytics-star-schema  →  Build the cube + dimensions + texts (batch_create + activateAtEnd)
3. generate-cds-analytical-query   →  Project the consumable KPI query on the cube
4. explain-abap-code               →  (optional) Document the model for handoff
```

For codebase onboarding or pre-migration work:

```
1. bootstrap-system-context  →  Know the system
2. setup-abap-mirror         →  Pull the target package(s) into abapGit-style files
3. explain-abap-code         →  Understand key objects with dependency context
4. migrate-custom-code       →  Run ATC readiness checks and group findings
```

For clean-core / custom-code retirement planning:

```
1. bootstrap-system-context  →  Know the system
2. sap-unused-code           →  Scope the retirement (what even runs?)
3. sap-clean-core-atc        →  Classify the USED code into Levels A–D
4. sap-object-documenter     →  Document the keepers before rewriting
5. migrate-custom-code       →  Fix the Level B/C/D findings one at a time
```

For end-to-end legacy SEGW + UI5 modernization (backend + UI):

```
1. bootstrap-system-context             →  Know the system
2. migrate-segw-to-rap                  →  Reverse-engineer SEGW V2 service to RAP V4
                                            (tables, CDS, BDEF, SRVD, SRVB, draft entities)
3. ONE of (parallel paths against the new V4 service):
   - convert-ui5-to-fiori-elements      →  Annotation-driven Fiori Elements V4 LROP
   - modernize-ui5-app                  →  Freestyle UI5 1.147 + TypeScript
4. analyze-chat-session                 →  Capture learnings; propose new skill traps
```

The three migration skills are explicitly designed as parallel paths after the backend lands. You don't run both UI skills — you pick the one whose architecture matches your legacy app's complexity and your team's preference.
