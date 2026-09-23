# Issue #11: Not Able to Create or Update (Transport Required)

> **Priority**: Low
> **Source**: fr0ster issue #11 (closed, 2026-02-26)
> **ARC-1 component**: `src/adt/crud.ts`, `src/adt/errors.ts`

## Issue description

User could read objects but couldn't create or update. Root cause: the SAP system required a transport request for write operations, but the user didn't provide one. The error message wasn't clear about what was missing.

## ARC-1 current state

ARC-1 handles this by surfacing SAP's error clearly:
1. **Error messages**: `AdtApiError` surfaces SAP's error response, which typically includes "A transport request is required", so the agent knows exactly what is missing and can supply the transport and retry.
2. **Transport as a parameter**: the transport is passed on the write call; ARC-1 core does not interactively prompt for it. Destructive-op safety is the config ceiling (`allowWrites`/`allowedPackages`/`denyActions`), not interactive elicitation. (Plugin tools may opt into `ctx.elicit`, but core `SAPWrite`/`SAPTransport` do not use it.)

## Assessment

No action needed. ARC-1 surfaces SAP's transport-required error clearly, so the agent can supply the transport and retry. Neither ARC-1 core nor fr0ster interactively prompts for it.

## Decision

**No action needed** — ARC-1's clear transport-required error surfacing addresses the UX concern; the caller supplies the transport and retries.
