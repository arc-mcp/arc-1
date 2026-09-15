# Use skills in VS Code

Keep the ARC-1 workflow skills in a normal local folder alongside your SAP ADT workspace folders.
You need GitHub Copilot, SAP's ABAP Development Tools extension, and a working ARC-1 MCP connection.

## Recommended Workspace Shape

Use a multi-root workspace with both:

- one normal local folder for AI assets, for example `~/ADT_VSCODE_ARC1` on macOS/Linux or `%USERPROFILE%\ADT_VSCODE_ARC1` on Windows
- one or more ABAP destinations or packages added by the SAP ADT extension

In VS Code:

1. Install **ABAP Development Tools for VS Code** and **GitHub Copilot**.
2. Use the Command Palette command **ABAP: New Destination**.
3. Add ABAP context to the workspace with **ABAP: Add Package as Folder to Workspace...** or **ABAP: Add Destination as Folder to Workspace...**.
4. Add a normal local folder with **File** → **Add Folder to Workspace...**. This folder holds skills, instructions, generated `system-info.md`, and optional local ABAP mirrors.
5. Save the workspace with **File** → **Save Workspace As...** so VS Code reopens both the ABAP package/destination and the local AI folder together.

Example local folder setup:

```bash
# macOS / Linux
mkdir -p ~/ADT_VSCODE_ARC1
cd ~/ADT_VSCODE_ARC1
npx skills add arc-mcp/arc-1 --agent github-copilot --list
npx skills add arc-mcp/arc-1 --agent github-copilot
```

```powershell
# Windows PowerShell
New-Item -ItemType Directory -Force "$env:USERPROFILE\ADT_VSCODE_ARC1"
Set-Location "$env:USERPROFILE\ADT_VSCODE_ARC1"
npx skills add arc-mcp/arc-1 --agent github-copilot --list
npx skills add arc-mcp/arc-1 --agent github-copilot
```

VS Code Copilot discovers project skills from `.github/skills/<name>/SKILL.md`, `.claude/skills/<name>/SKILL.md`, or `.agents/skills/<name>/SKILL.md`, and personal skills from `~/.copilot/skills/<name>/SKILL.md`, `~/.claude/skills/<name>/SKILL.md`, or `~/.agents/skills/<name>/SKILL.md`.

On Windows, those personal paths live under your user profile, for example `%USERPROFILE%\.copilot\skills\<name>\SKILL.md`.

Use **Chat: Open Customizations** or type `/skills` in Copilot Chat to inspect available skills. Start a new Agent Mode chat after adding or updating skills.

## ARC-1 MCP Or SAP ADT MCP

The ARC-1 skills in this repository are written against ARC-1 tool names such as `SAPRead`, `SAPWrite`, `SAPContext`, `SAPLint`, and `SAPDiagnose`. For best results, configure ARC-1 as an MCP server in VS Code when using these skills.

Workspace `.vscode/mcp.json` for a centrally hosted ARC-1 server:

```json
{
  "inputs": [
    {
      "id": "arc1-api-key",
      "type": "promptString",
      "description": "ARC-1 API key",
      "password": true
    }
  ],
  "servers": {
    "arc1": {
      "type": "http",
      "url": "https://arc1.company.com/mcp",
      "headers": {
        "Authorization": "Bearer ${input:arc1-api-key}"
      }
    }
  }
}
```

For a local server, install the [Agent Plugin](agent-plugin.md) or follow [Quickstart](quickstart.md).
Keep passwords in protected environment/configuration storage rather than command-line arguments.

SAP's bundled ADT MCP server is a separate MCP surface. Follow SAP's [Configuring ADT MCP Server](https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/configuring-adt-mcp-server-ed94320814734d97801f51a5b6deb802?locale=en-US) guide, then enable its tools in Copilot's tool picker. That is useful when you want Copilot to operate through SAP's extension-managed session. The ARC-1 skills still help as workflow guidance, but tool names and parameters differ; if you use SAP's ADT MCP server without ARC-1, adapt the skill wording or add a small Copilot instruction telling the agent to translate ARC-1 tool steps to the ADT MCP tools that are enabled in this workspace.

When both ARC-1 and SAP ADT MCP tools are enabled, be explicit in the prompt:

> Use the ARC-1 skills and ARC-1 MCP tools for the workflow. Use the SAP ADT VS Code extension workspace for editor context and manual review.

## Optional project instructions

Use `.github/copilot-instructions.md` in the local folder for short always-on guidance:

```markdown
For SAP work, load the ARC-1 skill that matches the task.
Use ARC-1 tools for steps naming SAPRead, SAPWrite, or SAPContext.
Read existing objects before editing and validate changes on the target system.
Use the SAP ADT workspace for editor navigation and manual review.
```

Keep detailed RAP, CDS, migration, and team rules in the relevant skill.

## Practical Workflow

1. Open the saved VS Code workspace containing the local AI folder and the ADT package/destination folders.
2. Log on to the ABAP destination through the SAP ADT extension.
3. Start or verify ARC-1 MCP in **MCP: List Servers**.
4. In Copilot Chat, switch to **Agent** mode and enable only the MCP tools needed for the task.
5. Ask for a skill-backed workflow, for example:

   > Use the ARC-1 `bootstrap-system-context` skill for this ADT workspace, then summarize which RAP/CDS generation skills fit this system.

6. Review generated ABAP in the ADT editor, then run activation, ABAP Unit, ATC, and transport checks before accepting the result.

## Troubleshooting

- If skills are not listed, make sure the local AI folder is an open VS Code workspace folder and the skills are under `.github/skills`, `.claude/skills`, `.agents/skills`, or a supported user folder.
- If the workspace has only ABAP package/destination folders, add a normal local folder for Copilot customizations and generated local files.
- If Copilot ignores a new skill, start a new Agent Mode chat or reload the window.
- If ARC-1 tools are missing, run **MCP: List Servers**, start the server, and use **MCP: Reset Cached Tools** after changing server versions or tool modes.
- If SAP ADT MCP tools are missing, check the SAP ADT extension settings, then enable the ADT MCP tools in Copilot's tool picker.
- Avoid enabling every write-capable tool by default. Keep ARC-1 server safety flags, package allowlists, and Copilot tool approvals aligned with the system you are working in.

References: [ABAP Development Tools for VS Code marketplace page](https://marketplace.visualstudio.com/items?itemName=SAPSE.adt-vscode), [SAP Help: ABAP Development Tools for VS Code](https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/abap-development-tools-for-visual-studio-code), [SAP Help: Configuring ADT MCP Server](https://help.sap.com/docs/abap-cloud/abap-development-tools-for-visual-studio-code/configuring-adt-mcp-server-ed94320814734d97801f51a5b6deb802?locale=en-US), [VS Code Agent Skills](https://code.visualstudio.com/docs/agent-customization/agent-skills), [VS Code MCP servers](https://code.visualstudio.com/docs/agent-customization/mcp-servers), and [VS Code MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

[All skills](skills.md)
