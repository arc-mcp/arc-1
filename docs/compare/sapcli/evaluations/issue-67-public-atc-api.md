# sapcli issue #67: migrate to public ADT ATC API

- Issue: https://github.com/jfilak/sapcli/issues/67
- State: Open (created 2022-04-22)
- Topic: ATC endpoint/API compatibility

## What sapcli surfaces
The project tracks migration to SAP's public ADT ATC API. This usually indicates pressure from API availability differences across releases/cloud landscapes.

## ARC-1 relevance
Medium. ARC-1 already supports ATC via ADT, but compatibility can drift between on-prem and BTP/public-cloud stacks.

## Suggested ARC-1 action
1. Add/expand integration tests for ATC on both classic and cloud-oriented backends.
2. Keep endpoint strategy pluggable in `src/adt/devtools.ts` for fallback behavior.
3. Document expected feature-probe behavior when ATC customizing endpoints differ.
