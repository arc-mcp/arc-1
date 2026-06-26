# S/4HANA 757 Transport Endpoint Compatibility

> **Priority**: Medium
> **Source**: VSP issue #70, commit ca02f47 (2026-03-18)
> **ARC-1 component**: `src/adt/transport.ts`

## What VSP fixed

CreateTransport was failing on S/4HANA 757 because:
1. The endpoint `/sap/bc/adt/cts/transports` doesn't exist on 757 — it uses `/sap/bc/adt/cts/transportrequests`
2. Content-Type needed to be `application/vnd.sap.adt.transportrequests.v1+xml` instead of generic XML

Fix: Use the correct endpoint and content type for S/4HANA systems.

## ARC-1 current state

`src/adt/transport.ts` — check which endpoint is used for transport creation. If it hardcodes one endpoint, it may fail on S/4HANA 757.

## Decision

**Verify** — Read `src/adt/transport.ts` and confirm the transport creation endpoint. If ARC-1 uses the older endpoint, add fallback or use the newer one.

**Effort**: 0.5d
