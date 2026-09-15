# Skills

Skills are reusable instructions for SAP tasks such as explaining code, generating tests, or
building a RAP service. They tell an assistant how to use ARC-1's tools; they do not grant permissions.

## Install

If you also need the MCP server, install the [Agent Plugin](agent-plugin.md) or the
[Claude Code plugin](install-in-claude.md#claude-code-plugin-server-skills). Both include the skills.

If ARC-1 is already connected, run this in your local project folder:

```bash
npx skills add arc-mcp/arc-1
```

To inspect or select skills:

```bash
npx skills add arc-mcp/arc-1 --list
npx skills add arc-mcp/arc-1 --agent github-copilot --skill bootstrap-system-context
```

Add `--global` for a user-wide install. If `npx` is unavailable, copy the **whole skill folder**,
including `SKILL.md` and its supporting files, from
[`skills/`](https://github.com/arc-mcp/arc-1/tree/main/skills):

| Client | Project folder | Personal folder |
|---|---|---|
| Claude Code | `.claude/skills/<name>/` | `~/.claude/skills/<name>/` |
| GitHub Copilot | `.agents/skills/<name>/` or `.github/skills/<name>/` | `~/.copilot/skills/<name>/` |
| Cursor | `.agents/skills/<name>/` | `~/.cursor/skills/<name>/` |
| Codex | `.agents/skills/<name>/` | `~/.agents/skills/<name>/` |

For Eclipse, import the local project folder into the workspace. See the
[full installation list](https://github.com/arc-mcp/arc-1/blob/main/skills/README.md#manual-install-without-the-cli)
for other clients.

## Run a skill

1. Confirm ARC-1 works with `SAPRead(type="SYSTEM")`.
2. Start a new agent chat and select the skill, or name it in your request:

   > Use the explain-abap-code skill to explain ZCL_ORDER and its dependencies.

3. Review the result and validation output. `mcp-sap-docs` is optional for general use and provides
   SAP documentation lookup. Individual workflows can require it or other servers, such as UI5
   or Fiori MCP; check the selected skill's prerequisites.

| Client | Where to start |
|---|---|
| Claude Code plugin | `/arc-1:<skill-name>` |
| Copilot in Eclipse | [Eclipse setup](skills-eclipse.md); enable skills and use `/skill:<name>` |
| Copilot in VS Code | [VS Code setup](skills-vscode.md); inspect skills in Chat customizations |
| Other compatible clients | Their skill picker, or name the installed skill in your request |

<span id="github-copilot-in-eclipse-with-adt"></span>
<span id="github-copilot-in-vs-code-with-sap-adt"></span>

## Choose a workflow

For an unfamiliar system, start with `bootstrap-system-context`, then `explain-abap-code` before
editing. Use `generate-rap-service` for a straightforward prototype, or
`generate-rap-service-researched` when existing code and team conventions must guide the design.

### Create code and tests

| Skill | Use it to |
|---|---|
| [generate-rap-service](https://github.com/arc-mcp/arc-1/blob/main/skills/generate-rap-service/SKILL.md) | Creates a complete RAP service stack from a natural-language description, with provider-contract-aware UI/Web API generation |
| [generate-rap-service-researched](https://github.com/arc-mcp/arc-1/blob/main/skills/generate-rap-service-researched/SKILL.md) | Researches the target system first, then plans and creates the RAP stack using impact analysis, revision history, formatter settings, and SAP docs |
| [generate-rap-logic](https://github.com/arc-mcp/arc-1/blob/main/skills/generate-rap-logic/SKILL.md) | Implements RAP determinations and validations in an existing behavior pool with structured class reads and quickfix-aware validation |
| [generate-cds-unit-test](https://github.com/arc-mcp/arc-1/blob/main/skills/generate-cds-unit-test/SKILL.md) | Generates CDS unit tests using the CDS Test Double Framework |
| [generate-abap-unit-test](https://github.com/arc-mcp/arc-1/blob/main/skills/generate-abap-unit-test/SKILL.md) | Generates ABAP Unit tests with dependency analysis and test doubles |
| [generate-analytics-star-schema](https://github.com/arc-mcp/arc-1/blob/main/skills/generate-analytics-star-schema/SKILL.md) | Generates a CDS analytical model with cube, dimension, and text views |
| [generate-cds-analytical-query](https://github.com/arc-mcp/arc-1/blob/main/skills/generate-cds-analytical-query/SKILL.md) | Generates an analytical query projection on an existing cube |

### Understand and document code

| Skill | Use it to |
|---|---|
| [explain-abap-code](https://github.com/arc-mcp/arc-1/blob/main/skills/explain-abap-code/SKILL.md) | Reads an ABAP object, pulls dependency context, and explains it in structure |
| [debug-slow-sql](https://github.com/arc-mcp/arc-1/blob/main/skills/debug-slow-sql/SKILL.md) | Finds whether slow SQL/OData spends time in the database, ABAP, or framework, then inspects the relevant SQL or traces |
| [migrate-custom-code](https://github.com/arc-mcp/arc-1/blob/main/skills/migrate-custom-code/SKILL.md) | Runs migration-oriented checks and groups findings by priority |
| [sap-migration-dossier](https://github.com/arc-mcp/arc-1/blob/main/skills/sap-migration-dossier/SKILL.md) | Builds a scoped ECC to S/4HANA migration dossier with inventory, usage, ATC, Clean Core, dependency, and SAP Docs evidence |
| [sap-object-documenter](https://github.com/arc-mcp/arc-1/blob/main/skills/sap-object-documenter/SKILL.md) | Batch-documents custom objects as Markdown |

### Assess migration and retirement

| Skill | Use it to |
|---|---|
| [sap-clean-core-atc](https://github.com/arc-mcp/arc-1/blob/main/skills/sap-clean-core-atc/SKILL.md) | Audits custom code and buckets findings into Clean Core levels |
| [sap-unused-code](https://github.com/arc-mcp/arc-1/blob/main/skills/sap-unused-code/SKILL.md) | Combines runtime usage and static where-used analysis |

### Modernize services and UIs

| Skill | Use it to |
|---|---|
| [migrate-segw-to-rap](https://github.com/arc-mcp/arc-1/blob/main/skills/migrate-segw-to-rap/SKILL.md) | Reverse-engineers a SEGW OData V2 service into RAP V4 artifacts |
| [convert-ui5-to-fiori-elements](https://github.com/arc-mcp/arc-1/blob/main/skills/convert-ui5-to-fiori-elements/SKILL.md) | Generates a Fiori Elements V4 LROP app against a V4 service |
| [modernize-ui5-app](https://github.com/arc-mcp/arc-1/blob/main/skills/modernize-ui5-app/SKILL.md) | Modernizes a legacy UI5 freestyle JavaScript app to UI5 TypeScript |

### Set up system context

| Skill | Use it to |
|---|---|
| [bootstrap-system-context](https://github.com/arc-mcp/arc-1/blob/main/skills/bootstrap-system-context/SKILL.md) | Collects system context and writes `system-info.md` with known target details, component releases, feature flags, and lint preset; unavailable details must remain unknown |
| [setup-abap-mirror](https://github.com/arc-mcp/arc-1/blob/main/skills/setup-abap-mirror/SKILL.md) | Creates a local abapGit-style mirror of a package or object list using ARC-1's existing reads |

### Review tool usage

| Skill | Use it to |
|---|---|
| [analyze-chat-session](https://github.com/arc-mcp/arc-1/blob/main/skills/analyze-chat-session/SKILL.md) | Reviews a prior ARC-1 conversation and identifies inefficient tool usage or prompt patterns |


### Review transports

| Skill | Use it to |
|---|---|
| [sap-transport-overview](https://github.com/arc-mcp/arc-1/blob/main/skills/sap-transport-overview/SKILL.md) | Inventory modifiable transports, owners, and supported risk signals |
| [sap-transport-review](https://github.com/arc-mcp/arc-1/blob/main/skills/sap-transport-review/SKILL.md) | Review source changes in a transport or unactivated drafts |
