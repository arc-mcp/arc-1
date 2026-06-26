# API Release State Checking

> **Priority**: High
> **Source**: VSP v2.33.0 — commit 7270ad7 (2026-04-05)
> **ARC-1 component**: `src/adt/client.ts`, `src/handlers/intent.ts`

## What VSP did
GetAPIReleaseState tool — checks if an ABAP object/API is released for cloud (S/4HANA Clean Core). Uses the ADT API release state endpoint. Critical for S/4HANA Cloud development.

## ARC-1 current state
Does not have API release state checking. SAPRead reads object source/metadata but doesn't check release state. This is a significant gap for S/4HANA Cloud/BTP ABAP Environment development.

## Assessment
High priority. API release state is essential for clean core compliance — determines whether an API can be used in cloud/extension scenarios. This should be added to SAPRead or as a new SAPRead operation.

## Decision
**Implement** — high-value feature for S/4HANA Cloud and BTP ABAP Environment development. Maps to clean core compliance requirements.
