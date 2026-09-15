# Roadmap

Use [open GitHub issues](https://github.com/arc-mcp/arc-1/issues) to follow proposed work and
[release notes](release-notes.md) to see what has shipped. An open issue is a proposal or reported
problem, not a delivery commitment.

## Open work

Reviewed against the issue tracker on **2026-09-15**:

| Work | Status and discussion |
| --- | --- |
| Let large source writes read a server-side file | [Feature request #777](https://github.com/arc-mcp/arc-1/issues/777) |
| Insert new FORM/MODULE units with `edit_unit` | [Feature request #776](https://github.com/arc-mcp/arc-1/issues/776) |
| Avoid blocking an `edit_unit` change because of unchanged surrounding code | [Bug report #775](https://github.com/arc-mcp/arc-1/issues/775) |
| Discuss how multi-target deployments should be configured | [Configuration RFC #577](https://github.com/arc-mcp/arc-1/issues/577) |

Check each issue for current status, constraints, and linked pull requests.

## Available features

| Area | Current documentation |
| --- | --- |
| ABAP objects, checks, transports, and Git | [Tool reference](tools.md) |
| Shared deployment and per-user SAP access | [BTP setup](btp-overview.md) |
| Experimental mutation-free access to several SAP targets | [Multi-target setup](multi-target-setup.md) |
| Custom tool extensions | [Extensions](extensions.md) |
| Task instructions for assistants | [Skills](skills.md) |

## Known limitation: direct HTTP proxy settings

<a id="compat-06"></a>

Direct ADT traffic does not currently honor `HTTPS_PROXY`, `HTTP_PROXY`, or `NO_PROXY`.
BTP Destination/Cloud Connector routing is separate. See the
[TLS and proxy reference](configuration-reference.md#tls-proxy-notes).
The earlier roadmap tracked this as COMPAT-06; there is no delivery date here.

## Propose a change

Search existing issues, then [open an issue](https://github.com/arc-mcp/arc-1/issues/new/choose)
with the task you need to complete, the SAP release, and a small example of the expected behavior.
For a bug, include the ARC-1 version and sanitized error details.

## Earlier planning notes

The previous roadmap mixed proposed work, completed features, implementation diaries, and competitor
research. Those dated notes remain available in the
[archived roadmap at the preceding source revision](https://github.com/arc-mcp/arc-1/blob/f23765f0/docs_page/roadmap.md).
Use them for historical context; verify current behavior in the tool reference or source.
