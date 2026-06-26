# i18n / Translation Tools

> **Priority**: Medium
> **Source**: VSP v2.33.0 — commit 566f1f7 (2026-04-05)
> **ARC-1 component**: `src/adt/client.ts`, `src/handlers/intent.ts`

## What VSP did
7 translation/i18n tools with per-request language override. Covers text elements, OTR texts, message class management, translation status.

## ARC-1 current state
Has T100 message class read and text elements read via SAPRead. No write operations for translations, no per-request language override, no translation status/management.

## Assessment
Translation tools fill feature matrix gap for i18n. ARC-1 has the read basics but lacks management operations. Per-request language override is interesting — ARC-1 passes SAP_LANGUAGE globally but not per-request.

## Decision
**Consider future** — maps to VSP issue #40 (i18n tools). ARC-1 has basic read; management ops are a future enhancement.
