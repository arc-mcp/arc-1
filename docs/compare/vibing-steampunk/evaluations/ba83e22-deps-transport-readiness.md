# Dependency Analysis with Transport Readiness

> **Priority**: Medium
> **Source**: VSP v2.30.0 — commit ba83e22 (2026-03-22)
> **ARC-1 component**: `src/context/deps.ts`, `src/adt/transport.ts`

## What VSP did
Package dependency analysis combined with transport readiness checking. Analyzes dependencies and determines if they're all properly included in a transport request.

## ARC-1 current state
Has dependency extraction in deps.ts and transport management in transport.ts but no connection between them. Can list deps and can manage transports, but doesn't check if all deps are in a transport.

## Assessment
Transport readiness is a practical development workflow feature — "are all my changes properly transported?" ARC-1 has the building blocks but doesn't combine them.

## Decision
**Consider future** — useful workflow feature combining existing capabilities.
