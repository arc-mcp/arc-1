# gCTS (git-enabled CTS) Tools

> **Priority**: Medium
> **Source**: VSP v2.33.0 — commit 81cce41 (2026-04-05)
> **ARC-1 component**: `src/handlers/intent.ts`

## What VSP did
10 gCTS (git-enabled Change and Transport System) tools. Covers repository management, branch operations, commit history, pull/push operations.

## ARC-1 current state
Has no gCTS support. SAPTransport covers traditional CTS (transport requests, tasks, release) but not the git-based overlay.

## Assessment
gCTS is a niche but growing feature — Medium #15 in feature matrix. Requires SAP_BASIS 7.50+ with gCTS enabled. Not all SAP systems have this. VSP closes the gap from their own issue #39.

## Decision
**Consider future** — maps to feature matrix gap #15. Niche but valuable for modern SAP workflows.
