# Namespace URL Encoding for ADT Operations

> **Priority**: Medium
> **Source**: VSP issue #18, commit 59b4b90 (2026-02-03)
> **ARC-1 component**: `src/adt/client.ts`, `src/adt/http.ts`

## What VSP fixed

ABAP namespaces use `/` as delimiters (e.g., `/NAMESPACE/CL_CLASS`). These forward slashes in object names conflicted with URL path segments, causing ADT to return 404.

Fix: Encode namespace slashes as `%2f` in all ADT URLs: `/sap/bc/adt/oo/classes/%2fNAMESPACE%2fCL_CLASS/source/main`

Applied to: all GetSource, WriteSource, SyntaxCheck, and CRUD operations.

## ARC-1 current state

`src/adt/client.ts` uses `encodeURIComponent()` for object names in URLs. `encodeURIComponent('/')` produces `%2F` — which should be correct.

**But**: Some URLs may be constructed by string concatenation without encoding. Need to audit all URL construction patterns.

## Decision

**Verify** — Audit `src/adt/client.ts` and `src/adt/crud.ts` for URL construction with object names. Confirm `encodeURIComponent` is used consistently, especially for namespaced objects.

**Effort**: 0.5d (audit only)
