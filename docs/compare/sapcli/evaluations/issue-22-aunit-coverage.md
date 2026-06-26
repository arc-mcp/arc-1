# sapcli issue #22: AUnit code coverage

- Issue: https://github.com/jfilak/sapcli/issues/22
- State: Closed (2023-08-03)
- Topic: Statement-level coverage retrieval from ADT

## What sapcli implemented
Coverage retrieval through ADT runtime trace coverage endpoints, including paging behavior, and output formatting suitable for CI consumption.

## ARC-1 relevance
High. ARC-1 can run tests but currently lacks integrated AUnit coverage output.

## Suggested ARC-1 action
1. Add coverage retrieval in `src/adt/devtools.ts` after successful AUnit run.
2. Expose optional coverage output in SAPDiagnose.
3. Add fixture-driven parsing tests and one live integration test path.
