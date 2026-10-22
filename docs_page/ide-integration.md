# Open ARC-1 results in your editor

## VS Code with SAP ADT

**No extra ARC-1 configuration.** Keep your existing connection, whether ARC-1 runs on BTP or
locally through `npx`. Copilot uses ARC-1 to research and SAP's ADT extension to open the source.

1. Use **SAP ADT extension 1.2 or later**. In your ABAP workspace, enable
   [SAP's built-in MCP server](https://developers.sap.com/tutorials/abap-dev-adt-mcp-server-tools),
   allow your destination and log on. Your laptop needs access to SAP; navigation needs no object-change permissions.
2. In Copilot's **Configure Tools**, select ARC-1 and SAP's `abap_object_get_file_uri`
   (`abap_object_list_file_uris` for includes). VS Code discovers SAP's server automatically.
3. Tell Copilot which local ADT connection matches ARC-1, then ask for a link:

    > My ADT destination “My-Dev” connects to the same backend and SAP client as ARC-1.
    > Read CL_ABAP_TYPEDESCR through ARC-1 and give me a link to open its source in VS Code.

Already using both MCP servers? Only step 3 remains. You can save the connection confirmation in
your **personal Copilot instructions**. With multiple systems, name the ARC-1 connection and target
alongside each local destination. Colleagues can use different destination names.

The link opens SAP's ABAP editor. No bridge, destination-map header or copied localhost token is needed.
If you don't know your local destination name, use **ABAP: Open Destination Settings (JSON)**.
Check backend and client; a shared SID alone can select the wrong system.

## Eclipse

Open an ADT project for the same backend and SAP client. Then configure **only the applicable case**:

| Where ARC-1 runs | Configuration |
|---|---|
| **BTP / HTTP** | Admin enables `ARC1_IDE_LINKS=eclipse`. For a single-system server, also set `ARC1_IDE_SYSTEM_ID=DEV`; multi-target servers already have the SID. Add the header below to your Eclipse Copilot MCP entry. |
| **Local `npx`** | Add `"ARC1_IDE_LINKS": "eclipse"` and `"ARC1_IDE_SYSTEM_ID": "DEV"` to that MCP entry's `env`, then restart it. No HTTP header. |

For BTP / HTTP, merge this into your **existing** server entry:

```json
{
  "requestInit": {
    "headers": { "Arc1-Ide-Client": "eclipse" }
  }
}
```

Replace `DEV` with your real SAP SID. Ask Copilot to read an object and provide its Eclipse link.
If Eclipse shows a project chooser, select the matching backend and client.
If clicking does nothing, enable the `adt` link handler below or paste the link into **Open ADT Link**.

## If a link does not open

| Symptom | Next step |
|---|---|
| VS Code has no resolver tools | Check SAP MCP and tool selection. Close older ADT windows: their server can hold the MCP port even after installing 1.2. |
| VS Code says disconnected / no project / file not found | Log on locally in ADT and open an object with **ABAP: Open Object...**. Close the failed preview, then retry the same link. BTP sign-in is separate. |
| Copilot uses old tools after an update | **MCP: Reset Cached Tools**, then **Developer: Reload Window** and a fresh chat. |
| Browser cannot hand off to Eclipse | Enable `adt` in **Preferences → General → Link Handlers**. |

**Preview:** the ARC-1 guidance and Eclipse settings need a build containing
[PR #1025](https://github.com/arc-mcp/arc-1/pull/1025).
Tested on macOS with VS Code 1.142 / SAP ADT 1.2 and Copilot Local / Gemini 3.8 Flash,
including BTP pinned and aggregate opening. Include opening remains unverified.
Eclipse native opening passed; clicking directly from Eclipse Copilot is still unconfirmed.
Links open current source; editing and activation are separate workflows.

[All configuration options](configuration-reference.md#ide-navigation) ·
[Claude/plugin preferences](agent-plugin.md#optional-editor-links) ·
[Research and test results](https://github.com/arc-mcp/arc-1/blob/main/docs/research/ide-navigation-verification.md)
