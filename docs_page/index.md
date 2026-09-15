# ARC-1: connect AI assistants to SAP ABAP

ARC-1 lets MCP-compatible assistants search, read, and work with ABAP objects in your SAP system.
It translates Model Context Protocol (MCP) tool calls into SAP ABAP Development Tools (ADT) requests.
Run it on your laptop or host it for a team.

## Start here

| What you want to do | Start with |
| --- | --- |
| Connect your assistant to a development system | [Quickstart](quickstart.md) |
| Connect Claude to an existing ARC-1 server | [Install in Claude](install-in-claude.md) |
| Deploy ARC-1 for a team | [Choose a deployment](deployment.md) |
| Deploy on SAP BTP | [BTP setup](btp-overview.md) |
| Use an already connected assistant | [Workflows and example prompts](mcp-usage.md) |

For a local connection, you need Node.js 22.19 or later, network access to SAP, and an SAP user
authorized for ADT. The [quickstart](quickstart.md) walks through setup and a first read.

## What ARC-1 can do

- Find ABAP objects and read their source, documentation, and dependencies.
- Run code checks and inspect diagnostics where the SAP system supports them.
- Create or change objects when an administrator enables writes.

The [tool reference](tools.md) lists the available operations and inputs.
[Agent skills](skills.md) provide instructions for tasks such as explaining code or building RAP services.

<a id="admin-controls-safety"></a>
<a id="sap-api-policy-and-data-access"></a>

## Access and permissions

ARC-1 starts read-only. Object writes, table preview, SQL, transport mutations, and Git mutations
require explicit settings. Enabled object writes are restricted to `$TMP` by default.
Server settings, user scopes, and SAP authorizations determine what a request may do.

For a shared server, start with [authentication](enterprise-auth.md) and
[permissions](authorization.md). Review [SAP API policy considerations](sap-api-policy-and-architecture.md)
for your deployment.

<a id="documentation"></a>

## Find a reference

| Need | Page |
| --- | --- |
| Environment variables and CLI flags | [Configuration](configuration-reference.md) |
| Updates, logs, and troubleshooting | [Operations](operations.md) |
| How requests reach SAP | [Architecture](architecture.md) |
| Changes in a release | [Release notes](release-notes.md) |
| Contribute or run from source | [Local development](local-development.md) |

[GitHub](https://github.com/arc-mcp/arc-1) · [Product updates](newsletter.md) · MIT license
