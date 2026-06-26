# Version History Tools

> **Priority**: Medium
> **Source**: VSP v2.33.0 — commit dd06202 (2026-04-02)
> **ARC-1 component**: `src/adt/client.ts`

## What VSP did
Three version history tools — list versions, compare versions, get specific version. Uses ADT version management API. 8 tests.

## ARC-1 current state
Does not have version history support. SAPRead reads current source only. The abap-adt-api library also has source version support (load specific version).

## Assessment
Version history is feature matrix gap #25 (Medium). Useful for understanding what changed, code review, and rollback decisions. Both VSP and abap-adt-api now have this.

## Decision
**Consider future** — maps to feature matrix gap #25. Both competitors now have this.
