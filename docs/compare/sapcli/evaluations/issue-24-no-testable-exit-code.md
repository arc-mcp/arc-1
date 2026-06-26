# sapcli issue #24: "No testable objects found" should not fail

- Issue: https://github.com/jfilak/sapcli/issues/24
- State: Open (created 2020-05-12)
- Topic: CI result semantics for empty AUnit scope

## What sapcli surfaces
A transport/package can contain no unit-test-bearing objects. Returning a hard failure code makes CI pipelines brittle and forces log scraping.

## ARC-1 relevance
High. ARC-1 should distinguish between:
- execution failure,
- test failures,
- and "no testable objects".

## Suggested ARC-1 action
1. Add explicit status enum for AUnit outcomes in SAPDiagnose output.
2. Return structured machine-readable metadata for CI consumers.
3. Cover this behavior with integration tests for transport/package test runs.
