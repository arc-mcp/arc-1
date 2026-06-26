# sapcli issue #41: package create with explicit transport request

- Issue: https://github.com/jfilak/sapcli/issues/41
- State: Closed (2021-02-12)
- Topic: DEVC create transport control (`corrNr`)

## What sapcli implemented
Package creation accepts an explicit transport request so automation does not spawn a fresh request per package.

## ARC-1 relevance
Medium. ARC-1 should keep deterministic transport assignment for package creation flows.

## Suggested ARC-1 action
1. Verify/create tests for explicit transport propagation in DEVC create.
2. Ensure error messaging clearly differentiates missing vs invalid transport IDs.
