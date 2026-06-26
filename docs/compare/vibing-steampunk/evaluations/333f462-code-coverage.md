# Code Coverage and Check Run Results

> **Priority**: Medium
> **Source**: VSP v2.33.0 — commit 333f462 (2026-04-04)
> **ARC-1 component**: `src/adt/devtools.ts`

## What VSP did
GetCodeCoverage and GetCheckRunResults tools. Code coverage returns line-level coverage from unit test runs. Check run results return ATC/check variant findings.

## ARC-1 current state
Has unit test execution in devtools.ts but returns pass/fail results only, not coverage metrics. Has ATC run via SAPLint but not aggregated check run results.

## Assessment
Code coverage is a meaningful enhancement for test quality assessment. ARC-1 has the infrastructure (unit test runner) but doesn't capture coverage data from the ADT response. Would require parsing additional response fields.

## Decision
**Consider future** — valuable metrics but not a blocking gap.
