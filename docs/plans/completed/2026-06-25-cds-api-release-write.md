# CDS / object API-release WRITE (`SAPManage set_api_state`) — FEAT-02 write counterpart

## Overview

ARC-1 READ the API release state (`SAPRead type=API_STATE`, FEAT-02) but could not SET it. This adds
the clean-core **release** write: mark an object's C1 API contract RELEASED (or revoke it) for ABAP
Cloud / S/4 Clean Core. Parity with sapcli `apistate set` + vibing-steampunk. Implemented as
`SAPManage action=set_api_state` — the natural governance home (alongside package + FLP lifecycle).

Scope: any release **contract C0–C4** (default **C1**, the common clean-core one), state
RELEASED/NOT_RELEASED, visibility taken **verbatim from that contract's behaviour defaults** — never
broadened/invented, and ARC-1 does **not** pre-judge whether visibility is even required (it varies by
contract: C0/C1 demand ≥1, but C4 fails for unrelated reasons like "must be an AMDP method"), so it
sends the defaults and lets SAP return the contract-accurate error. The `contract` param was added
after live `meta/supportedcontracts` showed C1-only is insufficient — **SRVD supports only C0, classic
VIEW only C3** (so hardcoded C1 could not release them at all); BDEF/TABL also support C0. The matrix
is per-release, so ARC-1 stays live-driven: the transform/PUT path is generic over `c{n}Release`, and
the not-available error lists the object's actually-supported contracts. Explicit visibility/comment
override remains deferred (no demand). Idempotent:
SAP returns `400 "No changes were made"` when the contract is already in the requested state — treated
as a `changed:false` no-op success, not an error. Object-specific release prerequisites (e.g. a TABL
"quota", an SRVD "provider contract") surface as the verbatim SAP error.

## Live-reverse-engineered contract (a4h 758 + 816)

The hard part was the PUT payload — captured live over ~8 iterations (each 400 named the next missing
node), recorded here so nobody re-derives it:

- **PUT** `/sap/bc/adt/apireleases/{encoded-object-uri}/c1`, Content-Type/Accept
  `application/vnd.sap.adt.apirelease.v10+xml`. **v10, not v11** — v11 500s on 7.58. No lock.
- The GET (v10) returns a rich document; the PUT accepts only a **narrow, strictly-ordered subset**:
  - `ars:apiRelease` › the standalone contract block `ars:c1Release ars:contract="C1"` (its opening
    tag, with visibility attrs) › `ars:status ars:state="RELEASED"` › `useConceptAsSuccessor` ›
    `successors` › `successorConceptName`, then close.
  - a sibling `ars:apiCatalogData ars:isAnyAssignmentPossible="true" ars:isAnyContractReleased="true"`
    › `ars:ApiCatalogs/`.
  - Response-only nodes **must be dropped** or SAP 400s: `atom:link`, `stateTransitions`,
    `transportObject`, `authValueObject`, and the `releasableObject`/`behaviour` wrapper.
- Visibility is taken VERBATIM from the contract's behaviour `useInSAPCloudPlatformDefault` /
  `useInKeyUserAppsDefault` — never broadened. The ≥1-visibility rule ("At least one API visibility has
  to be selected", ARS_STATE_HANDLER/119) holds for C0/C1 but is **not universal** (C4 fails on "must be
  an AMDP method", not visibility), so ARC-1 does not pre-emptively reject a both-false contract — it
  sends both false and surfaces SAP's contract-accurate error. Still never invents visibility (the
  original over-exposure bug).
- `$TMP` objects ARE releasable (the `transportObject` packageName was `$TMP`).

## Implementation (shipped)

- `src/adt/xml-parser.ts` `buildApiReleasePutBody(getXml, contract, state)` — the pure GET→PUT
  transform (3 unit tests against a real captured fixture `tests/fixtures/xml/api-release-unreleased.xml`).
- `src/adt/client.ts` `setApiReleaseState(objectUri, {state, contract, transport})` — GET (v10) →
  build → PUT (v10) → GET read-back confirmation; guarded `checkOperation(Update)`.
- `src/handlers/manage.ts` `case 'set_api_state'` — address by `objectUri` or `name`+`objectType`
  (same inference as the API_STATE read); **fail-closed package gate** via the object's containerRef.
- Three-file sync: `schemas.ts` (action + `apiState` enum), `tools.ts` (action list + `apiState` +
  docs), `policy.ts` (`SAPManage.set_api_state` → write). Snapshot + schema-budget bumped.

## Verification

Full lifecycle (create class → release → read RELEASED via API_STATE → revoke → delete) live on
**a4h 758 (v10) AND a4h-2025 816 (v10)**. Unit: `buildApiReleasePutBody` (3). Integration: the live
lifecycle (1). 7.50: classic ADT endpoint; integration `requireOrSkip`s without creds.

Done — see PR.
