# Evaluation: 51781d3 — ActivateServiceDefinition/ServiceBinding + ServiceBindingVariant

**Priority**: Medium
**Source**: fr0ster/mcp-abap-adt commit 51781d3 (2026-04-15) — v5.2.0
**ARC-1 Component**: `src/adt/devtools.ts`, `src/handlers/intent.ts`, `src/handlers/schemas.ts`

## What They Did

Two changes in one commit:

### 1. Activate handlers for SRVD and SRVB
Added `ActivateServiceDefinition` (low-level) and `ActivateServiceBinding` (low-level + high-level) handlers. These call the ADT activation endpoint specifically for SRVD and SRVB object types. Used to handle activation separately from the create/update flow.

### 2. ServiceBindingVariant enum replaces binding_type/service_type
Replaced two separate string parameters (`binding_type`, `service_type`) in `CreateServiceBinding` and `UpdateServiceBinding` with a single `binding_variant` enum (`ServiceBindingVariant`):
- `ODATA_V2_UI`
- `ODATA_V2_WEB_API`
- `ODATA_V4_UI`
- `ODATA_V4_WEB_API` (default: `ODATA_V4_UI`)

The underlying ADT publish/unpublish endpoints differ for V2 vs V4. Their code maps the variant to the correct publish endpoint.

## ARC-1 Current State

ARC-1 has:
- `publishServiceBinding()` and `unpublishServiceBinding()` in `src/adt/devtools.ts`
- These call `/sap/bc/adt/businessservices/publishjobs` with hardcoded `bindingtype=odatav2`
- `createServiceBinding()` in `src/adt/ddic-xml.ts` accepts `bindingType` and `serviceType` as separate fields
- `normalizeSrvbBindingType()` in `intent.ts` does fuzzy matching: `v2_ui` → OData V2, `v4_ui` → OData V4

**Known bug** (already logged in changelog): ARC-1 hardcodes `odatav2` in publish/unpublish endpoints. For V4 service bindings, the endpoint would need `odatav4`. This causes publish failures for V4 bindings.

## Assessment

### ServiceBindingVariant
ARC-1's `normalizeSrvbBindingType()` approach is actually more LLM-friendly than a strict enum — it accepts fuzzy inputs like "v4", "odata_v4_ui", "OData V4 UI". However ARC-1 needs to propagate the binding version to the publish/unpublish endpoint. The variant tells us whether to use `odatav2` or `odatav4` in the publish URL.

**Required fix**: In `publishServiceBinding()` and `unpublishServiceBinding()`, the `bindingtype` parameter must be `odatav4` when the binding is a V4 type. This is the bug already noted in the changelog.

### SRVD/SRVB separate activation
ARC-1's `SAPActivate` already handles SRVD/SRVB via the generic `activateObject()` call — no separate handlers needed.

## Decision

**fix-bug** — The V4 binding publish endpoint bug in `devtools.ts` should be fixed. Specifically:
1. `publishServiceBinding()` and `unpublishServiceBinding()` should accept a `bindingType` parameter (or detect from the binding metadata) to use `odatav4` vs `odatav2`
2. `handleSAPActivate` in `intent.ts` should pass binding type when publishing after activation
