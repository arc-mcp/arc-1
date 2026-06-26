# sapcli issue #20: CTS release via `newreleasejobs`

- Issue: https://github.com/jfilak/sapcli/issues/20
- State: Closed (2019-12-19)
- Topic: Transport release endpoint compatibility

## What sapcli implemented
Release flow aligned to ADT release job semantics for task/request release.

## ARC-1 relevance
Medium. ARC-1 already uses `newreleasejobs`; main value is continued compatibility testing across backend variants.

## Suggested ARC-1 action
1. Keep transport release integration tests for different SAP releases.
2. Ensure ARC-1 surfaces backend-specific release error details with remediation hints.
