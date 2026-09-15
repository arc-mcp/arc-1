# Tool reference

Choose a tool by task. Each reference includes examples, parameters, and result limits.
For a first workflow, start with [Using the tools](mcp-usage.md).

| Tool | Task |
|---|---|
| [SAPRead](tools/sap-read.md) | Read source, metadata, revisions, or table data |
| [SAPSearch](tools/sap-search.md) | Find objects or search source |
| [SAPWrite](tools/sap-write.md) | Create, update, or delete objects |
| [SAPActivate](tools/sap-activate.md) | Activate objects or publish a service |
| [SAPNavigate](tools/sap-navigate.md) | Find definitions, references, or relationships |
| [SAPQuery](tools/sap-query.md) | Query data with ABAP SQL |
| [SAPTransport](tools/sap-transport.md) | Inspect and manage transports |
| [SAPGit](tools/sap-git.md) | Use abapGit or gCTS |
| [SAPContext](tools/sap-context.md) | Understand dependencies and change impact |
| [SAPLint](tools/sap-lint.md) | Check or format ABAP source |
| [SAPDiagnose](tools/sap-diagnose.md) | Run tests, ATC, or diagnostics |
| [SAPManage](tools/sap-manage.md) | Manage packages, APIs, and launchpad content |
| [SAPTargets](tools/sap-targets.md) | List configured targets (aggregate route only) |

Availability depends on your server settings, caller scope, and SAP system. Your connected
instance's schema is authoritative. Hyperfocused mode exposes one `SAP` tool for these operations;
see [Tool modes](configuration-reference.md#code-quality-gates).

??? note "Previous section links"

    <span id="sapread"></span>

    **SAPRead**

    Read source, methods, metadata, revisions, or table data. [SAPRead reference](tools/sap-read.md).

    <span id="active-vs-inactive-source"></span>

    [Active vs Inactive Source](tools/sap-read.md#active-vs-inactive-source)

    <span id="cache-behaviour"></span>

    [Cache Behaviour](tools/sap-read.md#cache-behaviour)

    <span id="sapsearch"></span>

    **SAPSearch**

    Find objects by name or search ABAP source. [SAPSearch reference](tools/sap-search.md).

    <span id="tadir-lookup-source-modes"></span>

    [TADIR lookup source modes](tools/sap-search.md#tadir-lookup-source-modes)

    <span id="sapwrite"></span>

    **SAPWrite**

    Create, update, or delete objects; edit individual class members. [SAPWrite reference](tools/sap-write.md).

    <span id="server-driven-object-writes"></span>

    [Server-driven object writes](tools/sap-write.md#server-driven-object-writes)

    <span id="sapwrite-for-func-create-update-with-structured-parameters"></span>

    [SAPWrite for FUNC: create / update with structured parameters](tools/write-function-modules.md)

    <span id="procedural-unit-surgery"></span>

    [Procedural unit surgery](tools/sap-write.md#procedural-unit-surgery)

    <span id="class-section-surgery"></span>
    <span id="actionedit_class_definition-replace-the-definition-block-whole"></span>
    <span id="actionadd_method-atomic-definition-implementation-insert"></span>
    <span id="actionedit_method_signature-replace-one-methods-clause"></span>
    <span id="actiondelete_method-atomic-definition-implementation-remove"></span>
    <span id="actionchange_method_visibility-move-a-method-between-sections-body-preserved"></span>
    <span id="cross-release-notes"></span>

    [Edit class members](tools/write-class-members.md)

    <span id="text-elements"></span>

    [Text elements](tools/write-text-elements.md)

    <span id="sapactivate"></span>

    **SAPActivate**

    Activate objects or publish a service binding. [SAPActivate reference](tools/sap-activate.md).

    <span id="sapnavigate"></span>

    **SAPNavigate**

    Find definitions, references, completions, or relationships. [SAPNavigate reference](tools/sap-navigate.md).

    <span id="sapquery"></span>

    **SAPQuery**

    Query table data using ABAP SQL. [SAPQuery reference](tools/sap-query.md).

    <span id="saptransport"></span>

    **SAPTransport**

    Inspect transport requests, review changes, or manage their lifecycle. [SAPTransport reference](tools/sap-transport.md).

    <span id="actiondiff-reviewing-what-a-transport-changed"></span>

    [action="diff" — reviewing what a transport changed](tools/sap-transport.md#actiondiff-reviewing-what-a-transport-changed)

    <span id="sapgit"></span>

    **SAPGit**

    Use abapGit or gCTS repositories. [SAPGit reference](tools/sap-git.md).

    <span id="sapcontext"></span>

    **SAPContext**

    Understand dependencies, DDIC structure, consumers, and CDS change impact. [SAPContext reference](tools/sap-context.md).

    <span id="actiondeps-default-dependency-context"></span>

    [action="deps" (default) — Dependency context](tools/sap-context.md#actiondeps-default-dependency-context)

    <span id="actionstructure-ddic-includes-append-structures-tabl-only"></span>

    [action="structure" — DDIC includes + append structures (TABL only)](tools/sap-context.md#actionstructure-ddic-includes-append-structures-tabl-only)

    <span id="actionimpact-cds-upstream-downstream-impact-ddls-only"></span>

    [action="impact" — CDS upstream + downstream impact (DDLS only)](tools/sap-context.md#actionimpact-cds-upstream-downstream-impact-ddls-only)

    <span id="actionusages-reverse-dependency-lookup"></span>

    [action="usages" — Reverse dependency lookup](tools/sap-context.md#actionusages-reverse-dependency-lookup)

    <span id="saplint"></span>

    **SAPLint**

    Check and format ABAP source. [SAPLint reference](tools/sap-lint.md).

    <span id="sapdiagnose"></span>

    **SAPDiagnose**

    Run syntax checks, tests, ATC, and runtime diagnostics. [SAPDiagnose reference](tools/sap-diagnose.md).

    <span id="quickfix-workflow"></span>

    [Quickfix Workflow](tools/sap-diagnose.md#quickfix-workflow)

    <span id="sapmanage"></span>

    **SAPManage**

    Inspect capabilities and manage packages, API release state, and launchpad content. [SAPManage reference](tools/sap-manage.md).

    <span id="saptargets"></span>

    **SAPTargets**

    <span id="saptargets-aggregate-multi-target-only"></span>

    List configured targets on `/multi/mcp`. This catalog does not contact SAP or prove the caller can
    access a listed target. [SAPTargets reference](tools/sap-targets.md) · [Multi-system setup](multi-target-setup.md).
