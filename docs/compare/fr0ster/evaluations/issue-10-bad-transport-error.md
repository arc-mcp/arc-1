# Issue #10: Dump When Changing with Wrong Transport Request Number

> **Priority**: Low
> **Source**: fr0ster issue #10 (closed, 2026-02-26)
> **ARC-1 component**: `src/adt/crud.ts`, `src/adt/errors.ts`

## Issue description

Providing an invalid transport request number caused a SAP short dump instead of a clean error. The ADT endpoint crashes when given a non-existent transport number.

## ARC-1 current state

ARC-1 passes the transport request to SAP ADT as-is. If SAP returns an error (including a dump), `AdtApiError` captures the HTTP response. The question is whether a 500 (short dump) response has a useful error body.

## Assessment

This is a SAP-side issue — the ADT endpoint should validate the transport number before using it. The client can't fully prevent it.

Possible client-side mitigation: Before writing, validate that the transport exists via `listTransports()`. But this adds a round trip for every write operation.

**Better approach**: Ensure ARC-1's error handling for 500 responses includes the SAP error body (which may contain dump details). The LLM can then suggest "invalid transport request" to the user.

## Decision

**Low priority** — Ensure 500 error responses include the SAP body (same fix path as issue #7/#6 — error detail extraction). No separate transport validation needed.
