# Issue #37: Quick Fix (Fix Proposals) API

> **Priority**: Medium
> **Source**: abap-adt-api issue #37 (open, 2025-07-29)
> **ARC-1 component**: `src/adt/devtools.ts` (new feature)

## Issue description

User requesting an example of how to use the fix proposals / quick fix API. The API exists in abap-adt-api:
- `fixProposals(url, line, column, content)` — get available fixes for a given position
- `fixEdits(proposal, source)` — apply a fix to source code

These work with ATC findings — when ATC reports an issue at a specific location, the fix proposal API can suggest automatic corrections.

## ARC-1 current state

- ARC-1 has ATC check execution (`syntaxCheck`, `runAtcChecks` in devtools.ts)
- ARC-1 returns ATC findings with locations (line, column, message, severity)
- **No fix proposal or auto-fix capability** — the LLM must manually edit the code

## Assessment

This is a high-value gap. The workflow would be:
1. LLM runs ATC checks → gets findings
2. For each finding, LLM calls fix proposals → gets suggested corrections
3. LLM applies fixes automatically

This is much safer than having the LLM guess the fix — SAP's own fix proposal system knows the exact change needed.

## Decision

**Implement** — Add fix proposals to SAPLint or SAPWrite. The ADT endpoint is:
```
POST /sap/bc/adt/quickfixes/evaluation
POST /sap/bc/adt/quickfixes/application
```

**Effort**: S (1-2d — two endpoints + integration with ATC results)
