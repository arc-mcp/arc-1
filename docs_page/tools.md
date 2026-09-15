# Tool reference

Choose a tool by task. Each reference includes examples, parameters, and result limits.
For a first workflow, start with [Using the tools](mcp-usage.md).

| Tool | Task |
|---|---|
| <span id="sapread"></span>[SAPRead](tools/sap-read.md) | Read source, metadata, revisions, or table data |
| <span id="sapsearch"></span>[SAPSearch](tools/sap-search.md) | Find objects or search source |
| <span id="sapwrite"></span>[SAPWrite](tools/sap-write.md) | Create, update, or delete objects |
| <span id="sapactivate"></span>[SAPActivate](tools/sap-activate.md) | Activate objects or publish a service |
| <span id="sapnavigate"></span>[SAPNavigate](tools/sap-navigate.md) | Find definitions, references, or relationships |
| <span id="sapquery"></span>[SAPQuery](tools/sap-query.md) | Query data with ABAP SQL |
| <span id="saptransport"></span>[SAPTransport](tools/sap-transport.md) | Inspect and manage transports |
| <span id="sapgit"></span>[SAPGit](tools/sap-git.md) | Use abapGit or gCTS |
| <span id="sapcontext"></span>[SAPContext](tools/sap-context.md) | Understand dependencies and change impact |
| <span id="saplint"></span>[SAPLint](tools/sap-lint.md) | Check or format ABAP source |
| <span id="sapdiagnose"></span>[SAPDiagnose](tools/sap-diagnose.md) | Run tests, ATC, or diagnostics |
| <span id="sapmanage"></span>[SAPManage](tools/sap-manage.md) | Manage packages, APIs, and launchpad content |
| <span id="saptargets"></span>[SAPTargets](tools/sap-targets.md) | List configured targets (aggregate route only) |

Availability depends on your server settings, caller scope, and SAP system. Your connected
instance's schema is authoritative. Hyperfocused mode exposes supported operations through one
`SAP` tool; it does not support multi-target mode or live relations. See
[Tool modes](configuration-reference.md#tool-mode).
