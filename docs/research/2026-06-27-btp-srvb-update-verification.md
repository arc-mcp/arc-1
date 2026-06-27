# BTP SRVB (Service Binding) Update — Live Verification

**Date:** 2026-06-27
**System:** BTP ABAP Environment `H01`, SAP_BASIS 919, user `marian@zeis.de` (`SAP_BR_DEVELOPER`).
**Context:** the #522 review left item *"SRVB update on BTP"* and #529 explicitly deferred it (out of scope for the RAP-create verification). This pins the real behavior.

## TL;DR

**SRVB update already works on BTP — no production-code change required.** Like #529 (RAP create), the gap was missing verification + test coverage, not broken code. Deliverable = regression tests (unit + integration) + a doc line.

## How SRVB update is wired (already in the codebase)

Service bindings have **no `/source/main`** — `update` is a full metadata-XML replace:
- `isMetadataWriteType()` includes `SRVB` (`src/handlers/write-helpers.ts`), so `writeActionUpdate` (`src/handlers/write/update-delete.ts`) routes SRVB through the metadata path.
- `mergeMetadataWriteProperties(client, 'SRVB', …)` fetches the existing binding via `getSrvb()` → `parseServiceBinding()` and merges provided fields over `serviceDefinition / bindingType / category / version / odataVersion`.
- The body is rebuilt by `buildCreateXml('SRVB', …, cloud)` → `buildServiceBindingXml`, **cloudified on BTP** (drops `responsible`/`masterSystem`, adds `abapLanguageVersion="cloudDevelopment"`), and PUT with `SERVICEBINDING_V2_CONTENT_TYPE` via `safeUpdateObject`.

## Live results (H01 919, real ARC-1 code path)

`create → read → update(description only) → read → update(re-point SRVD) → read → delete`, all green:

| Step | Result |
|------|--------|
| create (`ZARC1_TEST`, SRVD ref `ZSRVD_DUMMY`, ODATA V2 UI) | 201; read-back `serviceDefinition=ZSRVD_DUMMY`, `impl=<bindingName>` |
| update #1 — description only | **200**; merge kept `serviceDefinition=ZSRVD_DUMMY`; description changed; **`implementation` preserved** |
| update #2 — re-point to `ZSRVD_DUMMY2` | **200**; read-back `serviceDefinition=ZSRVD_DUMMY2` |
| delete | 200 (no orphan) |

### Findings that retire earlier concerns
- **v2 content type with `; charset=utf-8` is fine on writes.** The known 406-on-charset issue (`client.ts`) applies only to the SRVB metadata *read* negotiation, not the update PUT.
- **The hardcoded `<srvb:implementation adtcore:name=""/>` does NOT wipe the implementation.** After both updates the binding read back with `implementation` intact — SAP derives/preserves it server-side. No fix needed.
- **`abapLanguageVersion="cloudDevelopment"` added by cloudify is accepted** on the SRVB v2 update ST (same as create under `application/*`).

## What shipped

- Unit (`tests/unit/handlers/build-create-xml-cloud.test.ts`): the SRVB merge contract (description-only preserves `serviceDefinition`/`bindingType`/`version`/`odataVersion`; re-point works; `Web API`→category `1`) + cloud body keeps the `serviceDefinition` ref through cloudify.
- Integration (`tests/integration/btp-abap.integration.test.ts`): `BTP SRVB update path (B3)` — full create→update→re-point→delete, gated on `TEST_BTP_PACKAGE` (writable cloud package).
- Doc: one line in `docs_page/btp-abap-environment.md`.

## Out of scope / unchanged
- On-prem SRVB behavior (cloud-gated; untouched).
- SRVB publish/unpublish (already shipped via `SAPActivate`).
- SRVB activation of a real exposed service (a RAP-scenario concern; needs a real SRVD/service).
