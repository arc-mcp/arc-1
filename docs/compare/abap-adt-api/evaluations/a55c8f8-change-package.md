# Change Package Refactoring

> **Priority**: Medium
> **Source**: abap-adt-api commit a55c8f8 (v7.0.0, 2025-10-05)
> **ARC-1 component**: `src/adt/crud.ts` (new feature)

## What abap-adt-api added

Three-step refactoring pattern:
1. `changePackagePreview(objectUrl, newPackage)` — dry-run, returns what would change
2. `changePackageExecute(refactoring)` — actually moves the object

Uses ADT refactoring endpoints: `/sap/bc/adt/refactorings/changepackage`

## ARC-1 current state

- **Implemented** as `SAPManage(action="change_package")` — preview then execute via `/sap/bc/adt/refactorings`
- Supports moving objects between packages with automatic URI resolution and transport pre-flight
- Safety: respects read-only mode, package allowlists on both source and target packages

## Assessment

Useful for code organization — moving objects between packages (e.g., from $TMP to a proper package, or reorganizing package structures). Common development workflow that an AI could help with.

However, this is a refactoring operation with transport implications. Lower priority than basic CRUD improvements.

## Decision

**Implemented** — Shipped as standalone `SAPManage(action="change_package")` action. Rename and extract-method remain future work (FEAT-05).

**Effort**: S (1d — implemented as SAPManage action with refactoring module)
