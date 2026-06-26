# Extract Method Refactoring

> **Priority**: Medium
> **Source**: abap-adt-api commit 460200a (v6.2.0, 2024-10-26)
> **ARC-1 component**: `src/adt/crud.ts` (new feature — roadmap FEAT-05)

## What abap-adt-api added

Three-step refactoring:
1. `extractMethodEvaluate(url, selectionRange)` — analyzes selected code, returns `ExtractMethodProposal` with suggested method name, parameters, visibility
2. `extractMethodPreview(proposal)` — returns preview of the changes (new method + call site)
3. `extractMethodExecute(refactoring)` — applies the refactoring

Uses ADT endpoint: `/sap/bc/adt/refactorings/extractmethod`

### Also has Rename refactoring:
1. `renameEvaluate(url, line, position)` — analyze symbol at position
2. `renamePreview(proposal, newName)` — preview changes
3. `renameExecute(refactoring)` — apply

## ARC-1 current state

- No refactoring support at all
- Listed as FEAT-05 in roadmap (P3, L effort)
- ARC-1 has method-level surgery (read/write individual methods) but not extract/rename

## Assessment

Extract method is highly valuable for AI workflows — the LLM identifies a code block that should be a separate method and uses the refactoring API to cleanly extract it (with proper parameter detection, return values, etc). This is safer than manual source manipulation because SAP handles the AST transformation.

Rename is similarly valuable — rename a variable/method across all references system-wide.

## Decision

**Consider future** — Both extract method and rename are in roadmap FEAT-05. When implementing, the abap-adt-api code provides the exact API pattern. All three refactoring types (rename, extract method, change package) use the same evaluate → preview → execute pattern.

**Effort**: L (1-2 weeks for all three refactoring types)

**API pattern** (from abap-adt-api):
```
POST /sap/bc/adt/refactorings/extractmethod/evaluate
POST /sap/bc/adt/refactorings/extractmethod/preview
POST /sap/bc/adt/refactorings/extractmethod/execute
```
