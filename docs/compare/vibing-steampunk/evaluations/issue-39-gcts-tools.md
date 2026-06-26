# Issue #39: gCTS (git-enabled Change and Transport System) Tools

> **Priority**: Medium
> **Source**: VSP issue #39 (open, 2026-03-01)
> **ARC-1 component**: `src/adt/client.ts` (new feature)

## Issue description

Feature request for gCTS integration tools:
- List gCTS repositories
- Clone/pull/push repos
- Manage branches
- View commit history
- Compare local vs remote

## ARC-1 current state

- No gCTS support
- `src/adt/transport.ts` handles classic CTS only
- Feature matrix lists gCTS as Medium #15

## Assessment

gCTS is available on S/4HANA 1909+ and BTP ABAP. It's the strategic direction for SAP's version control, but adoption is still limited. The ADT REST API provides gCTS endpoints (`/sap/bc/adt/cts/repository*`).

For AI-assisted development, gCTS is most useful for:
- Checking if a package is under gCTS management
- Viewing git history of ABAP objects
- Comparing branches

However, most gCTS operations (clone, push, pull) are better handled by admins through the gCTS dashboard or Eclipse, not through an AI assistant.

## Decision

**Defer** — Medium priority (#15 in matrix) but low immediate demand. Most ARC-1 users are using classic CTS or abapGit. Revisit when gCTS adoption increases or enterprise customers request it.

**Effort**: 3d (read-only gCTS repository listing and history)
