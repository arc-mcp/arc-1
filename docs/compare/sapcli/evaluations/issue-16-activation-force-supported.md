# sapcli issue #16: activation result parsing + force activation

- Issue: https://github.com/jfilak/sapcli/issues/16
- State: Closed (2020-02-12)
- Topic: Activation diagnostics parsing

## What sapcli implemented
Activation responses are parsed into actionable messages, including whether "force" activation is supported for a finding.

## ARC-1 relevance
High. Better activation diagnostics reduce trial-and-error in agent-driven write flows.

## Suggested ARC-1 action
1. Expand activation response parsing in `src/adt/devtools.ts`.
2. Surface `forceSupported`-style hints in SAPActivate responses when available.
3. Keep current safety gates unchanged; only improve diagnostics.
