# Package Health Analysis

> **Priority**: Medium
> **Source**: VSP v2.38.0 — commit 74efe5e (2026-04-06)
> **ARC-1 component**: `src/adt/devtools.ts`, `src/context/compressor.ts`

## What VSP did
Package health analysis combining multiple metrics: test coverage percentage, code staleness (last modified date), complexity metrics, and overall health score. Available as both MCP tool and CLI command.

## ARC-1 current state
Has unit test execution (devtools.ts) and context compression (compressor.ts) but no aggregated health scoring. Individual metrics are available (tests pass/fail, ATC findings count) but not combined into a health dashboard.

## Assessment
Health analysis is a novel aggregation layer. ARC-1 has the building blocks (unit tests, ATC, dependency analysis) but doesn't combine them into a health score. Could be a valuable SAPDiagnose extension.

## Decision
**Consider future** — interesting aggregation but low priority vs core feature gaps.
