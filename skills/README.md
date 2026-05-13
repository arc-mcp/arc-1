# ARC-1 Skills

Best-practice prompt templates for common SAP development workflows with ARC-1.

## Usage

These skills are prompt templates that work with any AI coding assistant that supports custom instructions or commands. Pick your tool below.

### Claude Code (CLI / Desktop / Web)

Copy skill files into your commands directory, then invoke as slash commands:

```bash
cp skills/generate-cds-unit-test.md ~/.claude/commands/
```
```
/generate-cds-unit-test ZI_SALESORDER
```

Docs: https://docs.anthropic.com/en/docs/claude-code/slash-commands

### VS Code — GitHub Copilot

Add as a reusable prompt file in `.github/copilot-instructions.md` or use the **Copilot Chat prompt files** feature (`.github/prompts/*.prompt.md`). Reference in chat with `#<prompt-name>`.

Docs: https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot

### VS Code — Copilot Coding Agent (Copilot Workspace)

Place instructions in `.github/copilot-instructions.md` — the agent reads them automatically for task context.

Docs: https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot

### Cursor

Add as a **Rule** in `.cursor/rules/` (one `.md` file per skill). Rules are automatically included in context.

Docs: https://cursor.com/docs/rules

### OpenAI Codex (CLI)

Copy a .rules file under ./codex/rules/ (for example, ~/.codex/rules/default.rules)

Docs: https://developers.openai.com/codex/rules

### Generic / Other Tools

Copy the skill markdown content into your tool's system prompt, custom instructions, or project context file. The skills are self-contained prompt templates — they work anywhere you can provide custom instructions.

## Prerequisites

These skills assume you have:
1. **ARC-1 MCP server** connected and configured (SAP system access)
2. **mcp-sap-docs MCP server** connected (optional but recommended — provides SAP documentation context)

## Available Skills

### Creating & Generating

| Skill | What it does | When to use |
|---|---|---|
| [generate-rap-service](generate-rap-service.md) | Creates a complete RAP OData service stack (table, CDS views, BDEF, SRVD, SRVB, class) from a natural language description, with provider-contract-aware service generation | Quick prototyping, simple CRUD, standard UI service generation |
| [generate-rap-service-researched](generate-rap-service-researched.md) | Same output as above, but researches the target system first (existing naming conventions, architecture patterns, revisions, docs, formatter settings, impact) and builds an approved plan before creating anything | Production-quality services in transportable packages, complex domains, "measure twice, cut once" mode |
| [generate-rap-logic](generate-rap-logic.md) | Implements determination and validation methods in an existing RAP behavior pool using structured class reads, version-aware edits, and quickfix-aware validation | After creating a RAP service — fills in the empty method stubs with ABAP Cloud logic |
| [generate-cds-unit-test](generate-cds-unit-test.md) | Generates ABAP Unit tests for CDS entities using the CDS Test Double Framework | When a CDS view has calculations, CASE expressions, WHERE filters, JOINs, or aggregations worth testing |
| [generate-abap-unit-test](generate-abap-unit-test.md) | Generates ABAP Unit tests for classes with dependency analysis and test doubles | When a class has non-trivial business logic and uses dependency injection |

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
- `SAPRead(type="VERSIONS")` and `SAPRead(type="VERSION_SOURCE")` for pattern mining and safer edits of existing RAP stacks
- `SAPTransport(action="history")` for object-to-transport traceability during later iterations
- `SAPLint(action="format" | "get_formatter_settings")` for SAP-native keyword case and indentation
- `SAPRead` / `SAPWrite` for `SKTD` so generated RAP services can carry attached Markdown documentation
- `SAPGit` when a package is already part of an abapGit or gCTS-backed delivery flow

### Analyzing & Understanding

| Skill | What it does | When to use |
|---|---|---|
| [explain-abap-code](explain-abap-code.md) | Reads an ABAP object, fetches all dependencies via SAPContext, and produces a structured explanation | Onboarding to unfamiliar code, investigating bugs, documenting undocumented objects |
| [migrate-custom-code](migrate-custom-code.md) | Runs ATC readiness checks, groups findings by priority, and generates replacement code | Preparing custom code for S/4HANA migration or ABAP Cloud readiness |
| [sap-object-documenter](sap-object-documenter.md) | Batch-documents many custom objects at once — purpose, style (Classic/Modern/Mixed), dependencies — as Markdown | Onboarding packages, handoffs, seeding a repo wiki (vs. explain-abap-code which is single-object interactive) |

### Clean Core & Custom Code Retirement

| Skill | What it does | When to use |
|---|---|---|
| [sap-clean-core-atc](sap-clean-core-atc.md) | Audits a package of custom code and buckets every Z/Y object into Clean Core Levels A–D using mcp-sap-docs + ATC | Planning an ECC→S/4HANA Cloud or BTP move; quarterly custom-code health check |
| [sap-unused-code](sap-unused-code.md) | Finds Z/Y objects never called at runtime using SCMON or SUSG, then cross-references static where-used | Scoping a custom-code retirement project; pre-migration dead-code cleanup (requires `SAP_ALLOW_FREE_SQL=true` + `S_TABU_NAM` on `SCMON_*`/`SUSG_*`) |

### BTP CAP Modernization (Preview)

End-to-end greenfield migration from classic ABAP custom code (Z* packages) to BTP-native CAP applications. Side-by-side approach — leaves the source ABAP system untouched and produces a complete target CAP project (CDS schema, services, Fiori Elements V4 app, CF deployment artifacts) for review and manual activation.

| Skill | What it does | When to use |
|---|---|---|
| [modernize-abap-to-btp-cap](modernize-abap-to-btp-cap.md) | End-to-end migration orchestrator: Z package → BTP CAP scaffold (CDS + service + Fiori + xs-security + mta.yaml + ADRs) | Planning ECC / on-prem S/4 → BTP CAP greenfield migration |
| [modernize-abap-cap-schema](modernize-abap-cap-schema.md) | Z-tables (SE11) → CAP CDS entities with DDIC→CDS type mapping, FK→association inference, `cuid`/`managed` aspect auto-application | Data-model migration step; standalone for reverse-engineering Z tables to CDS |
| [modernize-abap-cap-service](modernize-abap-cap-service.md) | Z function modules / reports / classes → CAP service definitions + TypeScript handler stubs with TODO markers + ABAP source excerpts | Service-layer migration step; produces compile-clean scaffold ready for business-logic translation |

#### Modernization vs Cloud-Readiness skills

- [sap-clean-core-atc](sap-clean-core-atc.md) classifies whether code **can stay in ABAP and move to S/4HANA Cloud / ABAP Cloud**. Source system stays SAP.
- [migrate-custom-code](migrate-custom-code.md) **fixes ATC findings in place** to make ABAP cloud-ready. Source system stays SAP.
- [modernize-abap-to-btp-cap](modernize-abap-to-btp-cap.md) **rebuilds the application as BTP CAP** — leaves source ABAP untouched, produces a parallel BTP-native stack. Use when the target architecture is a CAP application, not just cloud-ready ABAP.

#### Typical BTP modernization workflow

```
1. bootstrap-system-context           →  Capture source SID, release, features
2. sap-unused-code                    →  Scope: skip dead code from migration
3. sap-clean-core-atc                 →  Risk assessment per Z object
4. modernize-abap-to-btp-cap          →  Generate target CAP scaffold (orchestrator)
   ├── modernize-abap-clean-core-gap  →  (sub-skill, planned) per-edition availability
   ├── modernize-abap-cap-schema      →  db/schema.cds
   ├── modernize-abap-cap-service     →  srv/*.cds + handlers stubs
   ├── modernize-abap-fiori-elements  →  (sub-skill, planned) app/<name>/
   ├── modernize-abap-auth-mapping    →  (sub-skill, planned) xs-security.json
   └── modernize-abap-btp-mta         →  (sub-skill, planned) mta.yaml + Dockerfile
5. Manual: implement handler TODOs    →  Translate ABAP business logic
6. generate-cds-unit-test             →  Test the new CAP entities
7. mbt build + cf deploy              →  Ship to BTP CF
```

> **Status**: Preview / Work-in-Progress. Orchestrator + schema + service skills available now. Remaining sub-skills (`clean-core-gap`, `fiori-elements`, `auth-mapping`, `btp-mta`) tracked in [#TBD upstream issue]. Feedback welcome on the [PR thread].

### System Context & Local Workflow

| Skill | What it does | When to use |
|---|---|---|
| [bootstrap-system-context](bootstrap-system-context.md) | Probes SID, release, installed components, feature flags, and lint preset; writes a local `system-info.md` | First step of a session against an unfamiliar system — grounds the assistant in real constraints before any code work |
| [setup-abap-mirror](setup-abap-mirror.md) | Creates a local abapGit-style mirror of a package or object list for IDE context and `git diff` | Onboarding a codebase, pre-migration snapshotting, feeding local context to tools that can't call MCP per-read |

### Meta / Quality

| Skill | What it does | When to use |
|---|---|---|
| [analyze-chat-session](analyze-chat-session.md) | Analyzes the current conversation's tool calls and produces a feedback report | After a complex session — identifies inefficiencies, anti-patterns, and improvement suggestions |

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
