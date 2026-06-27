# BTP Package Create via ADT API — SOLVED (G-11 overturned)

**Date:** 2026-06-27
**System:** BTP ABAP Environment `H01`, SAP_BASIS 919, user `marian@zeis.de` (internal ABAP user `CB9980000000`).
**TL;DR:** Creating a package (DEVC) via the ADT REST API on the ABAP Environment **works** — proven live (`HTTP 201`). The earlier conclusion that it is "impossible via ADT REST, Eclipse-only" (G-11) was **wrong**: it stacked three separate mistakes. This supersedes the G-11 note in `2026-06-26-btp-live-validation-and-gaps.md` and the memory.

## The question
Eclipse can create a package on the ABAP Environment; ARC-1's `SAPManage create_package` (and prior raw attempts) could not. Why?

## Method
Live experiments with a developer JWT (browser auth-code+PKCE), POSTing to `/sap/bc/adt/packages` with `Content-Type: application/vnd.sap.adt.packages.v2+xml`, varying one factor at a time. Model = the package you created in Eclipse, `ZARC1_TEST`, read back via ADT: `responsible="CB9980000000"`, `masterSystem="H01"`, `<pak:superPackage adtcore:name="ZLOCAL">`, `<pak:softwareComponent pak:name="ZLOCAL">`.

## Experiments

| # | responsible | superPackage | Result | Meaning |
|---|-------------|--------------|--------|---------|
| V1 | `marian@zeis.de` (email) | — | 400 `ExceptionInvalidData` / `SPAK_ST_PACKAGES` deserialize fail | **The email breaks the ST** (invalid XUBNAME: >12 chars, `@`/`.`). *This is what the earlier session saw and misread as "ST rejects the responsible attribute".* |
| V2 | `CB9980000000` (internal) | — (empty) | 400 `ExceptionResourceCreationFailure` `TR/458` "ZLOCAL is not a valid software component" | Body **deserializes fine**; fails later because a new package can't name `ZLOCAL` as a root SC. |
| V3 | omitted (→`DEVELOPER`) | — (empty) | same `TR/458` | Deserializes fine too — the old "omit → PAK/049" claim did **not** reproduce here. |
| **V4** | **`CB9980000000`** | **`ZLOCAL`** | **✅ HTTP 201 CREATED** (`createdBy=CB9980000000`, then deleted) | **Works.** |
| V6 | **no `responsible` attr** | `ZLOCAL` | 400 "Enter a valid user, not , as the person responsible" | The package framework **requires** `responsible` and will **not** default it from the session (unlike object create). |

## Root cause (three stacked issues, not a platform limit)
1. **`responsible` value:** ARC-1 sends the **IAS email** (`normalizeAdtResponsible` uppercases `config.username` → `MARIAN@ZEIS.DE`). The package ST (`SPAK_ST_PACKAGES`) can't convert that to `XUBNAME` → 400 deserialize. Must be the **internal ABAP user** (`CB9980000000`).
2. **Parent nesting:** A new package must nest under the **structure package** (`<pak:superPackage name="ZLOCAL">`). ARC-1 sent an **empty** `superPackage` and named `ZLOCAL` only as the software component → `TR/458`.
3. **`responsible` is mandatory for packages** (cannot be omitted, unlike object create where cloud stamps the owner from the JWT).

`masterSystem` is irrelevant here (ARC-1's `buildPackageXml` doesn't emit it; the real package has `H01`).

## The working recipe (live-verified)
POST `/sap/bc/adt/packages`, `Content-Type: application/vnd.sap.adt.packages.v2+xml`, body:
```xml
<pak:package … adtcore:name="ZFOO" adtcore:type="DEVC/K"
    adtcore:responsible="CB9980000000">         <!-- internal user, NOT email, NOT omitted -->
  <pak:attributes pak:packageType="development" pak:recordChanges="false"/>
  <pak:superPackage adtcore:name="ZLOCAL"/>      <!-- nest under the structure package -->
  <pak:transport>
    <pak:softwareComponent pak:name="ZLOCAL"/>
    <pak:transportLayer pak:name=""/>
  </pak:transport> …
</pak:package>
```

## The one remaining piece: resolving the internal user
ARC-1 must turn the session identity into the internal ABAP user (`CB…`). Findings:
- `/sap/bc/adt/system/users` accepts **`application/atom+xml;type=feed`** (the 406 lists it). But it is indexed by the **internal username** — querying `CB99*` → `CB9980000000` "Initial Admin"; querying `marian@zeis.de`/`MARIAN`/`ZEIS` → **0 hits**. So it is **not** an email→`CB` mapper.
- No whoami endpoint exposes it (`security/reentranceticket`, `core/discovery`, `compatibility/graph` → 200, no `CB…`).
- **Reliable resolver — the `createdBy` trick:** a cloud **object** create (which omits `responsible`, G-3) makes SAP stamp `createdBy` = the session's internal user. ARC-1 can capture+cache it on the first cloud object create (or via a throwaway create in any writable dev package) and reuse it for package create. The internal user is stable per (user, system).

## Proposed ARC-1 fix (turns G-11 from "blocked" into a feature)
A `cloudifyPackageBody`/systemType-gated path for `SAPManage create_package` on `systemType=btp`:
1. **Resolve + cache the internal user** (createdBy trick or admin config); set `adtcore:responsible` to it — never the email, never empty.
2. **Require/derive `superPackage`** (the structure package, e.g. `ZLOCAL`) and set `softwareComponent` to the cloud SC; reject an empty super-package on BTP with a clear hint.
3. Keep `Content-Type: …packages.v2+xml`.
4. Classify `TR/458` and the email-deserialize 400 with actionable hints.

Only the **first-ever** package on a brand-new tenant (no objects yet) still needs a one-time Eclipse bootstrap (to mint the internal user) — and even that is avoidable once the createdBy-cache resolver lands.

## Artifacts
`scratchpad/btp-pkg-create.mjs`, `btp-pkg-create2.mjs` (experiments), `btp-pkg-zarc1.xml` (Eclipse-made model). No orphans: V4 created+deleted; V1/V2/V3/V6 never persisted.

## Addendum (2026-06-27, post-write live verifications)

- **Content type:** both `application/*` AND `application/vnd.sap.adt.packages.v2+xml` return **201** for the cloud body (`btp-pkg-ct.mjs`: created `ZARC1_CTSTAR` and `ZARC1_CTV2`, both deleted). ARC-1's `create_package` handler already posts with `application/*` — **no content-type change is needed**; the "Keep …v2+xml" note above is one valid option, not a requirement.
- **createdBy trick — verified live:** a cloud `CLAS` create whose body omits `adtcore:responsible` (`buildCreateXml(cloud=true)`) → the created object's `adtcore:createdBy` **and** `adtcore:responsible` = `CB9980000000` (`btp-createdby-verify.mjs`: created `ZCL_ARC1_WHOAMI` in `ZARC1_TEST`, read back, deleted). This is the resolver mechanism — ARC-1 caches the internal user from the createdBy of any cloud object it creates. NB: the create POST 201 body is **not** confirmed to contain createdBy; resolution reads it via a follow-up GET of the created object.
- **No whoami (re-confirmed):** `/sap/bc/adt/system/users` (Accept `application/atom+xml;type=feed`) lists ALL users (`CB9980000000`,`SAP_WFRT`); `/system/users/me` and `/$self` return empty feeds; the endpoint is indexed by internal username, not email. No email→`CB…` resolver exists → the createdBy trick (or an explicit `responsible`) is the only path.
- **recordChanges:** the working/model body uses `pak:recordChanges="false"` (local cloud package). The cloud create path must set it **false** — do not inherit the on-prem `LOCAL`→`recordChanges=true` heuristic, which a `ZLOCAL` cloud SC would otherwise trigger.
