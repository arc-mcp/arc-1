# Improved Error Handling (v8.0.0)

> **Priority**: Medium
> **Source**: abap-adt-api commit cffc79a (v8.0.0, 2026-04-04)
> **ARC-1 component**: `src/adt/errors.ts`, `src/adt/http.ts`

## What abap-adt-api changed

Major version bump (v8.0.0) with improved error handling. The library has `AdtException` class that parses ADT error XML responses into structured error objects with:
- Error type, message, namespace
- HTTP status code
- Detailed error properties from XML body

## ARC-1 current state

- `src/adt/errors.ts` defines `AdtApiError` (HTTP errors) and `AdtSafetyError` (safety violations)
- `src/adt/http.ts` catches axios errors and wraps them in `AdtApiError`
- XML error parsing extracts message from ADT error responses
- LLM-friendly error hints added for common errors (409, 423, etc.)

## Assessment

ARC-1's error handling is already good — structured error types, LLM hints, safety errors. The main gap vs abap-adt-api is parsing the full XML error body with all properties (some SAP errors include additional context like affected objects, authorization details, etc.).

## Decision

**Verify** — Review ARC-1's XML error parsing in http.ts to ensure it extracts all useful properties from ADT error responses. The v8.0.0 changes in abap-adt-api may reveal error patterns we miss.

**Effort**: XS (review + minor parsing improvements if needed)
