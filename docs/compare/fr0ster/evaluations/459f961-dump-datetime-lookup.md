# Dump Lookup by Datetime+User, Structured Dump List

> **Priority**: Medium
> **Source**: fr0ster v4.8.0 — commit 459f961 (2026-04-02)
> **ARC-1 component**: `src/adt/diagnostics.ts`, `src/handlers/intent.ts` (SAPDiagnose)

## What fr0ster did

Enhanced their dump handlers in two ways:

### 1. Structured dump list response
`RuntimeListDumps` now returns a structured `dumps` array instead of raw Atom feed XML:
```json
{ "dumps": [{ "dump_id": "...", "datetime": "...", "error": "...", "title": "...", "user": "..." }] }
```
Plus `from`/`to` parameters for server-side time-range filtering (format: `YYYYMMDDHHMMSS`).

### 2. Dump lookup by datetime+user
`RuntimeGetDumpById` now accepts `datetime` + `user` instead of requiring the `dump_id`. Uses ±2-minute server-side window + ±60-second client-side match to find the dump.

Use case: After running a program that crashes, the LLM knows the approximate time and user but not the dump ID. This eliminates the list→find→get round trip.

## ARC-1 current state

`src/adt/diagnostics.ts` has:
- `listDumps(maxCount)` — returns formatted text (already parsed from Atom feed)
- `getDump(dumpId)` — requires the dump ID

## Assessment

**Structured dump list**: ARC-1 already parses the Atom feed and returns formatted text. Returning JSON would be marginally better for LLM consumption but the current format works fine. **Low value**.

**From/to time filtering**: Useful for narrowing dumps on busy systems. The ADT endpoint supports `from` and `to` query parameters natively. **Medium value** — easy to add.

**Datetime+user lookup**: Nice UX shortcut but adds client-side fuzzy matching complexity. The LLM can already list dumps and pick the right one. **Low value** — over-engineering for a 2-step flow.

## Decision

**Defer** — The from/to time filter on dump listing is the only part worth adding eventually. The datetime+user lookup adds complexity for marginal gain. ARC-1's existing dump flow (list → get by ID) is sufficient.
