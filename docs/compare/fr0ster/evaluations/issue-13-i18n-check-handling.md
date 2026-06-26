# Issue #13: Check Runs Fail with Non-EN Languages

> **Priority**: Medium
> **Source**: fr0ster issue #13 (closed, 2026-03-08)
> **ARC-1 component**: `src/adt/devtools.ts`, `src/adt/http.ts`

## Issue description

When connecting with `DE` (German) language, code check runs fail with `MCP error -32603: Error: New code check failed`. The ADT check endpoint returns localized error messages/statuses that the parser doesn't expect.

Fix in fr0ster: Updated `adt-clients` to v3.8.7 with i18n-aware check handling — the parser now handles localized status codes and messages.

## ARC-1 current state

ARC-1 sets `SAP_LANGUAGE` (default: EN) and sends it via `sap-language` header in `src/adt/http.ts`. Syntax check and ATC in `src/adt/devtools.ts` parse XML responses with expected English status values.

**Potential risk**: If a user sets `SAP_LANGUAGE=DE`, check responses may contain German status codes that ARC-1's parser doesn't handle.

## Assessment

### Verify scope
Check what ARC-1 parses from check responses:
- `src/adt/devtools.ts` — `syntaxCheck()` parses `chkrun:checkReport` XML
- `src/adt/devtools.ts` — `runAtc()` parses ATC results XML

Key question: Are the parsed fields language-dependent (e.g., severity labels "Error"/"Warning") or language-independent (e.g., numeric severity codes)?

### Likely impact
- **Syntax check**: ADT returns structured XML with `severity` attribute (numeric or code). Likely language-independent. **Low risk**.
- **ATC results**: ADT returns findings with `messageTitle` (localized) and `priority` (numeric). The priority is language-independent, but the title will be in the configured language. **Low risk** — ARC-1 passes through the message text.

## Decision

**Verify** — Read `src/adt/devtools.ts` to confirm ARC-1 doesn't compare against hardcoded English strings in check result parsing. If all parsing uses language-independent attributes (severity codes, priorities), no action needed. If any string comparison exists, fix it.

**Effort**: 0.5d (investigation + potential fix)
