# Table Content Pagination and Schema-Only Query

> **Priority**: Medium
> **Source**: VSP v2.33.0 — commit 9fb6c8a (2026-04-04)
> **ARC-1 component**: `src/adt/client.ts`, `src/handlers/intent.ts`

## What VSP did
Added offset and columns_only parameters to GetTableContents. Enables pagination through large tables and schema-only queries (get column names without data).

## ARC-1 current state
SAPQuery RunQuery has maxRows parameter but no offset for pagination. No columns_only mode. Table preview uses ADT data preview endpoint.

## Assessment
Pagination is useful for large tables. columns_only is valuable for schema introspection before querying. ARC-1's maxRows provides basic limiting but no cursor-style pagination. Closes VSP issue #34.

## Decision
**Consider future** — pagination and schema introspection are practical improvements. Maps to feature matrix.
