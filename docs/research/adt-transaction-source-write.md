# ADT Transaction (`TRAN/T`) Source/Write Support Research

**Date:** 2026-04-28
**Status:** Research complete; implementation not started
**Roadmap:** FEAT-62

## Executive Summary

ARC-1 already supports `SAPRead(type="TRAN")`, but only as metadata read through the classic VIT endpoint:

`/sap/bc/adt/vit/wb/object_type/trant/object_name/{name}`

That endpoint returns an `adtcore:mainObject` with `adtcore:type="TRAN/T"`, description, and package reference. It does not expose the transaction source JSON or a writeable ADT object lifecycle.

[`jfilak/sapcli` PR #156](https://github.com/jfilak/sapcli/pull/156), merged on 2026-04-28, shows a separate ADT object implementation for transactions:

`TRAN/T` at `/sap/bc/adt/aps/iam/tran`, with `blue:blueSource` XML and JSON source at `source/main`.

The implementation path for ARC-1 should not replace the existing VIT metadata read. Live read-only probes against the configured SAP test systems show that the current 7.58 backend returns VIT metadata for `SE38`, but does not expose `/sap/bc/adt/aps/iam/tran` in discovery and returns 404 for the collection, object, and source paths. The configured NW 7.50 NPL profile was reachable but auth-blocked with 401 before endpoint-specific probing; the existing recorded NPL 7.50 SP02 probe fixture also lacks `/sap/bc/adt/aps/iam/tran` in discovery.

Recommendation: add `TRAN/T` source/write support as a feature-detected on-prem capability, keep metadata read behavior unchanged, and return a backend-unsupported diagnostic when the real transaction endpoint is missing.

## Current ARC-1 State

ARC-1 has transaction metadata read support from PR [#21](https://github.com/marianfoo/arc-1/pull/21), merged 2026-04-02.

Relevant code:

- `src/adt/client.ts`: `getTransaction()` calls `/sap/bc/adt/vit/wb/object_type/trant/object_name/{name}`.
- `src/adt/xml-parser.ts`: `parseTransactionMetadata()` parses the VIT `adtcore:mainObject`.
- `src/handlers/intent.ts`: `SAPRead(type="TRAN")` returns metadata JSON and optionally enriches `program` from `TSTC` when free SQL is allowed.
- `src/handlers/schemas.ts`: `TRAN` is included for on-prem `SAPRead`, excluded from BTP read types.
- `src/handlers/tools.ts`: tool text describes `TRAN` as transaction-code metadata.

What is not present today:

- `TRAN` is not in on-prem `SAPWrite` types.
- `TRAN/T` is mapped in `SLASH_TYPE_MAP` (corrected in PR #223 — was `TRAN/O` pre-audit per issue #218; live a4h + npl 2026-05-08 confirm ADT emits `TRAN/T`).
- `objectBasePath('TRAN')` points at the VIT metadata endpoint, which is not the writeable source-object endpoint.
- `updateSource()` always writes `text/plain`; transaction source writes require `application/json`.
- There is no transaction creation payload builder for `blue:additionalCreationProperties`.

## External Implementation: sapcli

Primary source: [`jfilak/sapcli` PR #156](https://github.com/jfilak/sapcli/pull/156).

The PR adds transaction support across ADT object mapping, CLI commands, fixtures, and tests. Key implementation details from [`sap/adt/transaction.py`](https://github.com/jfilak/sapcli/blob/df954a31d61cefd32eda2477db046731c5691978/sap/adt/transaction.py):

- Object code: `TRAN/T`
- Base path: `aps/iam/tran`
- XML root: `blueSource`
- Namespace: `http://www.sap.com/wbobj/blue`
- Accepted object MIME types:
  - `application/vnd.sap.adt.blues.v2+xml`
  - `application/vnd.sap.adt.blues.v1+xml`
- Source MIME type: `application/json`
- Source link: `source/main`
- Creation content MIME type: `application/vnd.sap.adt.serverdriven.content.v1+json`

Creation is the unusual part. The outer object is ADT blue XML, but the transaction-specific creation definition is compact JSON, base64 encoded, and inserted under:

`blue:additionalCreationProperties/adtcore:content`

The transaction definition fields implemented by sapcli are:

| Transaction kind | Fields |
| --- | --- |
| Common | `transactionType`, `abapLanguVersionText`, `updateMode`, `metadata.name`, `metadata.description`, `metadata.package` |
| Report | `reportName`, `reportDynnr`, optional `reportVariantName` |
| Parameter | `parParentTransactionCode` |
| Dialog | `programName`, `programDynnr` |
| OO | `className`, `methodName`, optional `classProgramName`, `localInProgramIndi`, `ooTransactionModelIndi` |
| Variant | `varParentTransactionCode`, optional `transactionVariantCiIndi`, `transactionCiVariantName` |

Relevant tests and fixtures:

- [`test/unit/test_sap_adt_transaction.py`](https://github.com/jfilak/sapcli/blob/df954a31d61cefd32eda2477db046731c5691978/test/unit/test_sap_adt_transaction.py)
- [`test/unit/fixtures_adt_transaction.py`](https://github.com/jfilak/sapcli/blob/df954a31d61cefd32eda2477db046731c5691978/test/unit/fixtures_adt_transaction.py)

The sapcli PR also generalized source editors to support JSON content. That maps directly to an ARC-1 change in `updateSource()`: source writes need a content-type parameter instead of hard-coded `text/plain`.

## Other Repository Search

GitHub code search was run for:

- `serverdriven.content.v1+json`
- `additionalCreationProperties TRAN`
- `TRAN/T aps/iam/tran`
- `aps/iam/tran`

Findings:

- `jfilak/sapcli` is the only public result found that implements transaction `TRAN/T` against `/sap/bc/adt/aps/iam/tran`.
- [`SAP/open-ux-tools`](https://github.com/SAP/open-ux-tools/blob/33a479c8fd5ae654b1cd8d4e5b2d5caa106647b1/packages/axios-extension/test/abap/abap-service-provider.test.ts) also references `application/vnd.sap.adt.serverdriven.content.v1+json`, but for RAP generator content (`framework=generators.v1`), not transaction objects.
- No ARC-1 issue or PR was found for `TRAN/T`, `/aps/iam/tran`, transaction source, or `SAPWrite` transaction support. The only related ARC-1 PR is [#21](https://github.com/marianfoo/arc-1/pull/21), which explicitly implemented `TRAN` metadata through VIT plus optional `TSTC` SQL.

## Live Probe Results

All live probes below were read-only `GET` requests. No transaction was created, locked, updated, activated, or deleted.

### SAP Test Profiles

Both configured `SAP_*` and `TEST_SAP_*` profiles connected successfully. Both reported:

- `SAP_BASIS` release `758`, SP `0002`
- `SAP_ABA` release `75I`, SP `0002`
- on-prem/classic system shape

Probe summary for `SE38`:

| Probe | `SAP_*` profile | `TEST_SAP_*` profile |
| --- | --- | --- |
| `/sap/bc/adt/vit/wb/object_type/trant/object_name/SE38` | 200, `adtcore:type="TRAN/T"`, has `mainObject` | 200, `adtcore:type="TRAN/T"`, has `mainObject` |
| `/sap/bc/adt/aps/iam/tran/SE38` | 404, resource does not exist | 404, resource does not exist |
| `/sap/bc/adt/aps/iam/tran/SE38/source/main` | 404, resource does not exist | 404, resource does not exist |

Additional `SAP_*` endpoint-shape probes:

| Probe | Result |
| --- | --- |
| `/sap/bc/adt/discovery` | 200, but no `/sap/bc/adt/aps/iam/tran` entry |
| `/sap/bc/adt/aps/iam/tran` | 404 |
| `/sap/bc/adt/aps/iam/tran/se38` | 404 |
| `/sap/bc/adt/aps/iam/tran/se38/source/main` | 404 |
| `/sap/bc/adt/vit/wb/object_type/trant/object_name/se38` | 200, `adtcore:type="TRAN/T"` |

Interpretation: on this 7.58 backend, `TRAN/T` exists as a VIT object type for metadata, but the real `/aps/iam/tran` ADT object endpoint is not exposed.

### NW 7.50 Test Profile

The infrastructure profile contains an NPL 7.50 configuration (`SAP_NPL_*`). Both primary and alternate configured NPL users reached the system but received HTTP 401 `Logon Error Message` responses for:

- `/sap/bc/adt/system/components`
- `/sap/bc/adt/vit/wb/object_type/trant/object_name/SE38`
- `/sap/bc/adt/aps/iam/tran/SE38`
- `/sap/bc/adt/aps/iam/tran/SE38/source/main`

That prevents a fresh endpoint-specific live result from the 7.50 system in this run.

Existing recorded fixture context:

- `tests/fixtures/probe/npl-750-sp02-dev-edition/meta.json` was recorded from real NPL 7.50 SP02 on 2026-04-20.
- It reports `SAP_BASIS` `750`, SP `0002`.
- Its discovery map does not include `/sap/bc/adt/aps/iam/tran`.
- The fixture does not contain transaction-specific VIT or `/aps/iam/tran` responses, so it is supporting evidence only, not a substitute for the failed live transaction probe.

## Implementation Plan for ARC-1

### 1. Preserve Existing Metadata Read

Keep the current default `SAPRead(type="TRAN", name="SE38")` behavior as metadata-only through VIT. This path works on the tested 7.58 backend and is already documented.

Do not switch `getTransaction()` to `/sap/bc/adt/aps/iam/tran/{name}`. That would regress systems where VIT works but the real endpoint is absent.

Add source read as an explicit path, for example:

- `SAPRead(type="TRAN", name="ZFOO", include="source")`
- or a new internal `getTransactionSource(name)` used when `format/source` semantics are requested

The returned source should be raw JSON text, not parsed and reserialized by ARC-1. sapcli treats transaction JSON as opaque source; ARC-1 should do the same unless a later feature adds structured editing.

### 2. Add Endpoint Constants and Type Mapping

Add a real transaction object base path distinct from the VIT metadata path:

- Metadata: `/sap/bc/adt/vit/wb/object_type/trant/object_name/{name}`
- Source/write object: `/sap/bc/adt/aps/iam/tran/{name}`

Add:

- `SLASH_TYPE_MAP['TRAN/T'] = 'TRAN'`
- A helper such as `realObjectBasePathForWrite('TRAN')` or a write-specific branch so activation/write/delete use `/aps/iam/tran/`, while metadata read keeps VIT.

sapcli lowercases transaction object URIs in tests (`aps/iam/tran/zabapgit`). ARC-1 should either lowercase `TRAN` names for the real endpoint or probe both; the VIT endpoint accepted both `SE38` and `se38` on the tested 7.58 system, while `/aps/iam/tran` returned 404 for both.

### 3. Feature-Detect `/aps/iam/tran`

Use feature detection before exposing or attempting source/write flows:

1. Prefer `/sap/bc/adt/discovery` when available. If `/sap/bc/adt/aps/iam/tran` is absent, mark transaction source/write as unsupported.
2. If discovery is inconclusive, fall back to a read-only known-object probe against `/sap/bc/adt/aps/iam/tran/{name}` when a source/read request is made.
3. Convert 404 for the collection/object path into a clear backend-unsupported message:

`This SAP system exposes TRAN metadata through VIT but does not expose the ADT transaction source endpoint /sap/bc/adt/aps/iam/tran. Use SAPRead(type="TRAN") for metadata only.`

Do not use release number alone as the gate. The tested 7.58 backend lacks the endpoint, while sapcli's captured implementation proves the endpoint exists somewhere. Discovery/probing is safer than a SAP_BASIS table.

### 4. Add Source MIME Awareness

Update the CRUD source write path so it accepts a source MIME type:

- Current: `updateSource(...): http.put(url, source, 'text/plain')`
- Needed: `updateSource(..., contentType = 'text/plain')`

Transaction source writes should use:

`application/json`

This change also aligns with sapcli's generalized source editor factories (`plain_text()` and `json()`).

### 5. Add Transaction Create Definition

Add an on-prem-only transaction creation schema under `SAPWrite(action="create", type="TRAN")`. Keep it explicit; do not overload generic ABAP `source` as the create definition.

Suggested input shape:

```json
{
  "action": "create",
  "type": "TRAN",
  "name": "ZFOO",
  "package": "$TMP",
  "description": "Run report ZFOO",
  "transaction": {
    "transactionType": "reportTransaction",
    "reportName": "ZFOO",
    "reportDynnr": "1000",
    "updateMode": "notSet",
    "abapLanguVersionText": "Standard ABAP"
  }
}
```

Supported `transactionType` values should mirror sapcli:

- `reportTransaction`
- `parameterTransaction`
- `dialogTransaction`
- `ooTransaction`
- `variantTransaction`

Build compact JSON with `metadata` included:

```json
{
  "abapLanguVersionText": "Standard ABAP",
  "transactionType": "reportTransaction",
  "reportName": "ZFOO",
  "reportDynnr": "1000",
  "updateMode": "notSet",
  "metadata": {
    "name": "ZFOO",
    "description": "Run report ZFOO",
    "package": "$TMP"
  }
}
```

Then base64-encode that JSON and inject it into the blue XML envelope:

```xml
<blue:additionalCreationProperties>
  <adtcore:content
    adtcore:encoding="base64"
    adtcore:type="application/vnd.sap.adt.serverdriven.content.v1+json">...</adtcore:content>
</blue:additionalCreationProperties>
```

Outer create request:

- Method: `POST`
- Path: `/sap/bc/adt/aps/iam/tran`
- Content-Type: `application/vnd.sap.adt.blues.v2+xml; charset=utf-8`
- Optional transport query: `corrNr={transport}`

### 6. Update Write, Activate, Delete, and Navigate Behavior

If `TRAN` is added to `SAPWrite`, object lifecycle operations must use the real object URL:

`/sap/bc/adt/aps/iam/tran/{name}`

Affected paths:

- Create: collection `POST`
- Update: lock object, `PUT source/main` with JSON, unlock
- Delete: object delete path
- Activate: activation payload object URL
- Where-used/navigation if routed through `objectUrlForType()`

Important: existing unit tests that expect transaction activation/delete/navigation to use the VIT URL should be updated. VIT is valid for metadata read only, not lifecycle source operations.

### 7. Keep Safety and Scope Rules Tight

`TRAN` writes should remain on-prem only and should require all existing write gates:

- `allowWrites=true`
- `SAPWrite` write scope when auth is present
- package allowlist check
- transport write behavior only when writes and transport usage are allowed
- audit logging like other writes

Do not expose `TRAN` write on BTP unless separately verified. Current BTP schema excludes `TRAN`, and that should remain true.

### 8. Skip ABAP Lint and Syntax Check for Transaction JSON

Transaction source is JSON, not ABAP source. Pre-write ABAP lint and syntax-check paths should skip `TRAN`.

Recommended behavior:

- Validate JSON syntax locally for transaction source writes.
- Validate required creation fields with Zod.
- Let SAP validate semantic correctness of report/program/class references.
- Do not call abaplint.
- Do not call ABAP syntax check/checkruns for `TRAN` source.

### 9. Test Plan

Unit tests:

- Parse current VIT metadata response unchanged.
- Build each transaction creation JSON kind.
- Base64 creation JSON is embedded under `blue:additionalCreationProperties`.
- Create XML uses `blue:blueSource`, `adtcore:type="TRAN/T"`, and package reference.
- `TRAN/T` normalizes to `TRAN`.
- Transaction source update uses `application/json`, while ABAP types keep `text/plain`.
- `SAPWrite` schema accepts `TRAN` on-prem and rejects it on BTP.
- `SAPRead(type="TRAN")` default still uses VIT metadata.
- `SAPRead(type="TRAN", include="source")` or equivalent source mode uses `/aps/iam/tran/{name}/source/main`.
- Backend 404 on `/aps/iam/tran` is returned as unsupported, not as generic object-not-found when VIT metadata succeeds.

Integration tests:

- Use `requireOrSkip()` with a new skip reason or `SkipReason.BACKEND_UNSUPPORTED` when `/aps/iam/tran` is not exposed.
- First integration test should be read-only source probe if a known custom transaction exists.
- CRUD lifecycle test should create in `$TMP`, update JSON source, activate if needed, delete in `finally`.
- Never silently pass when the backend lacks the endpoint.

Live-system caveat from this research: the currently configured 7.58 test backend and the recorded NPL 7.50 discovery fixture do not expose `/aps/iam/tran`. The first implementation PR should be fixture-heavy and skip live CRUD unless a backend with the endpoint is configured.

## Open Questions

1. Which SAP releases/products expose `/sap/bc/adt/aps/iam/tran`? The current 7.58 and recorded 7.50 evidence says "not these systems"; sapcli proves "some system does."
2. Does activation always apply to `TRAN/T`, or do some transaction changes persist without activation?
3. Is lowercasing transaction object paths required, recommended, or incidental in sapcli?
4. Should ARC-1 expose structured transaction creation only, opaque JSON source update only, or both?
5. Can a safe public known-object probe be found for `/aps/iam/tran`, or is endpoint detection necessarily collection/discovery based?

## Recommendation

Implement FEAT-62 as feature-detected on-prem transaction source/write support:

- keep existing metadata read intact;
- add `/aps/iam/tran` only for source and lifecycle operations;
- add JSON source MIME support in the shared CRUD layer;
- special-case transaction create with base64 server-driven JSON;
- skip ABAP lint/checkruns for transaction JSON;
- make unsupported backend diagnostics explicit.

This is worth tracking because sapcli has a real, merged implementation, but it should not be treated as universal ADT coverage until a backend exposing `/aps/iam/tran` is available for live ARC-1 integration tests.
