# BTP ABAP (Steampunk) — Object-Create Path Fix (G-2..G-5)

**Date:** 2026-06-26
**System:** BTP ABAP Environment `H01`, SAP_BASIS **919**, region us10, free tier, user `marian@zeis.de`.
**Companion:** `2026-06-26-btp-live-validation-and-gaps.md` (the gap inventory this fixes).
**Method:** live ADT calls with a real developer JWT, driving ARC-1's built `dist/` create path.

## What shipped

| Gap | Fix | File |
|-----|-----|------|
| **G-3** | Cloud-correct create body, driven by `systemType=btp` | `src/handlers/write-helpers.ts` (`cloudifyCreateBody`) |
| **G-4** | `ExceptionResourceNoAccess` on create → 403 package/authorization denial (not 409 "locked/SM12"); structure-package case detected | `src/adt/crud.ts` (`convertHtmlConflictToProperError`, `createObject`/`lockObject` thread `systemType`) |
| **G-5** | ABAP user derived from the JWT `user_name` when no `SAP_USER` | `src/adt/client.ts` (`getEffectiveUser`, used by `getSystemInfo`) |
| **G-2** | Docs: `$TMP`/`ZLOCAL` are unusable on BTP; use a regular cloud sub-package | `.env.example` |
| responsible casing | Email-style (cloud) users kept case-sensitive, not upper-cased | `src/adt/ddic-xml.ts` (`normalizeAdtResponsible`) |

## The key live finding (why "abapLanguageVersion alone wasn't enough")

The on-prem create body is wrong on cloud in **three** ways, only one of which the prior doc identified:

1. `adtcore:masterSystem="H00"` — invalid on cloud, must be dropped.
2. `adtcore:abapLanguageVersion="cloudDevelopment"` — required (cloud objects are ABAP for Cloud).
3. **`adtcore:responsible` must be OMITTED.** This was the real blocker. The cloud object-create
   simple transformations (`CLASS_TRANSFORMATION`, `INTF_TRANSFORMATION`, `SBD_*`, …) **reject the
   `adtcore:responsible` attribute**: when present, deserialization fails at the first child element
   with HTTP 400 `ExceptionInvalidData` "error deserializing in <ST>". Removing it makes the body
   deserialize; cloud assigns the object owner from the request JWT. (CLAS additionally needs explicit
   `class:final`/`class:visibility`/`class:category`.)

Triangulated via `XML_OFFSET` in the ST error: with `responsible` present the offset sits at the
first child (`<adtcore:packageRef>`); without it the body deserializes and SAP advances to
package-assignment.

## Live verification (this session)

Driving the real `dist/` `buildCreateXml(…, cloud=true)` + `createObject` against H01:

- **Body accepted (deserializes) for CLAS, INTF, DDLS, DTEL, DOMA, TTYP** — all reach
  package-assignment (403 "Structure packages cannot contain development objects") instead of a 400
  deserialization error. (INTF additionally hits a structure-package software-component check — a
  ZLOCAL artifact, not a body defect.)
- **G-4:** the structure-package create now returns `403` with
  *"…the target package is a structure package and cannot contain development objects. …create a
  regular sub-package…"* — no more misleading 409/SM12.
- **G-5:** `getEffectiveUser()` → `marian@zeis.de` (from the JWT); `getSystemInfo().user` no longer empty.
- **Full lifecycle GREEN (2026-06-26):** with a writable dev package (`ZARC1_TEST`, created in Eclipse
  under ZLOCAL), `CLAS create → activate → read → delete` passes live against H01 (11.5s) — class
  created, source written, activated, read back (`hello`), then deleted; no orphan objects left.
- Integration tests (`btp-abap.integration.test.ts` → "BTP object-create path") pass live against H01
  (**3 passed**) with a pre-acquired token (`TEST_BTP_ACCESS_TOKEN`); the lifecycle case is gated on
  `TEST_BTP_PACKAGE`.

## Remaining blocker — G-11: package creation on cloud (NEW, separate gap)

A full create→activate→read→delete needs a writable **regular** package. On a fresh Steampunk the
only package is `ZLOCAL`, a **structure package** that cannot hold objects — so a sub-package must be
created first. Package creation via plain ADT POST is blocked by a genuine SAP platform asymmetry,
now exhaustively confirmed live against H01 (SAP_BASIS 919):

- `SPAK_ST_PACKAGES` (the v2 deserialize ST) **rejects `adtcore:responsible` on the root** — the *only*
  place the serialize ST emits it (verified by GETting ZLOCAL as `…packages.v2+xml`). Offset
  triangulation shows the whole root open-tag incl. the responsible value is consumed, then the ST
  errors at the first child — i.e. responsible is simply **not in the deserialize content model**
  (value-independent: same failure for `marian@zeis.de` and bare names).
- Omit responsible → the body deserializes, but the package framework then rejects it at the app
  layer: `PAK/049 "Enter a valid user, not , as the person responsible"`. It is **not** defaulted from
  the session user (objects are; packages are not).
- The gap is **stateful-session-independent** (`X-sap-adt-sessiontype: stateful` → identical PAK/049),
  **content-type-independent** (`application/*` and `…packages.v2+xml` identical; v1 → 415), and there
  is **no `responsible` query param** (ADT discovery template exposes only `corrNr,lockHandle,version,
  accessMode,_action`).
- Both reference impls put `adtcore:responsible` on the root — `abap-adt-api` (`createBodyPackage`) and
  `oisee/vibing-steampunk` (Go ADT→MCP bridge) — so **both hit this identical wall on Steampunk**.

Conclusion: there is no body/header/query channel to set the package owner via REST on this release;
Eclipse's interactive (SSO) session evidently resolves it through a path the OAuth/bearer ADT session
does not. **Confirmed live:** the Eclipse-created `ZARC1_TEST` shows Responsible = `CB9980000000`
("Initial Admin") — a *technical* user the interactive session assigns, never the bearer JWT's
`marian@zeis.de`; the REST path has no way to supply it. This is a distinct, deeper gap (its own
create path, `SAPManage create_package` / `buildPackageXml`), **out of scope for G-2..G-5**, and
likely needs a SAP-side fix or the Eclipse flow. Until then, create the dev package in ADT/Eclipse and
point `SAP_ALLOWED_PACKAGES` at it.

## Running the positive lifecycle test

```bash
# 1. Create a regular (development) sub-package under ZLOCAL in ADT/Eclipse, e.g. ZARC1_TEST.
# 2. Provide a named-user dev JWT (client_credentials is rejected by ADT) + that package:
TEST_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-abap-service-key.json \
TEST_BTP_ACCESS_TOKEN=<dev-jwt> \
TEST_BTP_PACKAGE=ZARC1_TEST \
  npm run test:integration:btp -- -t "object-create path"
```

Without `TEST_BTP_PACKAGE` the lifecycle test skips; the body-acceptance + G-5 tests still run.

## Code-review follow-ups (Codex, 2026-06-26)

An adversarial Codex pass produced four findings; resolution:

- **#1 (systemType=auto race) — FIXED.** The startup probe sets `systemType='btp'` and ListTools
  awaits it before CallTool, so the normal flow is safe; but a probe failure/skip left the default
  `auto` unresolved → on-prem XML on BTP. `resolveWriteSystemType()` now falls back to `'btp'` for
  bearer-token auth (which is only ever the ABAP Environment). Also removes the 3× duplicated
  resolution. Unit-tested.
- **#2 (hard-coded `class:final="true"`) — VERIFIED non-issue.** Live-proven: a **non-final** source
  PUT overrides the create-metadata flag — the class activates and reads back non-final. The lifecycle
  test now creates a non-final class to lock this in.
- **#3 (`getEffectiveUser` memoized `''` on transient failure) — FIXED.** Now memoizes only resolved
  values; a transient token/decode error returns `''` without caching, so a later call still resolves.
  Unit-tested.
- **#4 (metadata-UPDATE reuses the cloud create body) — FOLLOW-UP (LOW).** The full-XML metadata
  replace (`writeActionUpdate`, and the DTEL/MSAG post-create-update) reuses `buildCreateXml(…, cloud)`.
  The cloudify transform only strips update-irrelevant attrs (`masterSystem`, `responsible`) and adds a
  valid `abapLanguageVersion`, and create-body acceptance is live-verified for CLAS/INTF/DDLS/DTEL/DOMA/
  TTYP — but the DDIC **update** STs (DOMA/DTEL/TTYP/SRVB/MSAG) are not yet live-verified on BTP. Track
  as a follow-up; CLAS/INTF (the common path) use source-PUT, not this path.

## Tier-1 cleanup (now live-disproven test assumptions + nits)

Live re-run of the BTP suite surfaced three integration tests asserting the wrong thing; all fixed and
re-verified against H01 (919):

- **T-1 — FIXED.** `getProgram('RSHOWTIM')` was asserted to be unavailable; it is **fully readable**
  (returns its `REPORT` source). Reframed to "classic PROG is readable, but creating a classic program
  is refused" (the create is attempted against a writable package and must reject).
- **T-2 / T-3 — FIXED + classified.** Standard-table preview and freestyle SQL were asserted as 403/500;
  BTP actually returns **HTTP 400 `ExceptionDataPreviewGeneral` "No authorization to view data"**
  (`ADT_DATAPREVIEW_MSG/023`; LONGTEXT cites auth object `S_ABPLNGVS` — the ABAP-language-version gate).
  Tests now assert the 400 shape, and `classifySapDomainError` gains a distinct
  `data-view-not-authorized` category + hint ("query a released CDS view / a custom Z\* table instead") —
  a separate code path from G-4's `ExceptionResourceNoAccess`. Unit-tested.

Three one-line nits: **G-6** AMDP probe path `/sap/bc/adt/debugger/amdp` → `/sap/bc/adt/amdp/debugger`
(the former resolves to the generic debugger node → 403; discovery advertises `/amdp/debugger/main`).
**G-7** `features.ts` comment claimed BTP reports release `"sap_btp"` — it reports a numeric SAP_BASIS
(`919`). **G-8** `AGENTS.md` referenced a non-existent `src/adt/btp.ts` — the BTP Destination Service is
`oauth.ts` + `server.ts` (`buildAdtConfig`) + the `@arc-mcp/xsuaa-auth` dep.

## Live smoke-test review (2026-06-27) — two more P1 create-path bugs

A full MCP smoke run surfaced two real create-path bugs (both reproduced and fixed against my build, H01 919):

- **INTF create — FIXED.** Cloud INTF create POSTed with `application/*` returned HTTP 500 `[?/537]
  "ABAP language version  is not allowed in this software component"` (blank version): `application/*`
  routes INTF to an older deserialize ST that drops `adtcore:abapLanguageVersion`. The body is correct
  (it carries `cloudDevelopment`) — the **content-type** is the fix. `createContentTypeForType(type, cloud)`
  now returns `application/vnd.sap.adt.oo.interfaces.v5+xml` for cloud INTF (on-prem keeps `application/*`).
  CLAS/DDLS are unaffected (their `application/*` ST is fine). Live-verified: `INTF create → activate →
  read → delete` green; unit + integration tested.
- **SM12 hint on a structure-package 403 — FIXED.** The G-4 message was correct, but
  `classifySapDomainError` then appended a contradictory *"Object is locked … check SM12"* hint, because
  the lock-conflict rule treated *any* `ExceptionResourceNoAccess` as a lock. Create-time
  `ExceptionResourceNoAccess` with package markers (structure package / `not authorized` / `S_DEVELOP`)
  and no lock markers now classifies as `authorization` (no SM12); a bare/409 `ExceptionResourceNoAccess`
  still classifies as a lock (ADR-0002 preserved). Unit-tested.

Deferred (verified-feasible / intentional, out of this PR's create-path scope):
- **TTYP on BTP** — the registry has `btp:false`, but a TTYP shell create POST **succeeds** on BTP
  (live, 200). Enabling `btp:true` needs the full 2-step (shell + row-type PUT + activate) verified —
  follow-up.
- **PROG read on BTP** — classic programs are readable via ADT (T-1), but BTP `SAPRead` intentionally
  drops PROG. `SAPSearch` still finds them, so the find-but-can't-read gap is a deliberate tool-surface
  choice; revisit if read-only classic-program inspection is wanted.

Note: the smoke run that surfaced these executed against `arc-1-lsp-local` (the configured `arc-1-btp`
server wasn't connected); both bugs were re-confirmed against this PR's `dist/` before fixing.

## Re-test (2026-06-27) — green on the real build + one small DX fix

A second smoke run, correctly on `arc-1-btp` (H01 919), passed **all 7 smokes**: INTF create works (no
language-version 500), the ZLOCAL package 403 carries *no* SM12 hint, the data gates return the 400 +
CDS hint, and a released-view query works. Both headline fixes are confirmed on the shipped build.

One clean DX fix taken from the feedback:
- **DOMA `outputLength` on update — FIXED.** Updating a domain's length (e.g. 10→20) without an explicit
  `outputLength` kept the old value, so SAP warned *"Output length (10) is less than the calculated
  output length (20)"*. The update merge now follows a changed length
  (`provided.outputLength ?? provided.length ?? existing.outputLength`), matching the create default.
  Unit-tested.

Deferred (pre-existing, cross-cutting cache/DX — not create-path, warrant their own focused PRs):
- **Post-activate read staleness** — after `SAPActivate`, a `SAPRead(version=active)` can return the
  stale empty shell until `force_refresh`, even though `activate.ts` already invalidates the
  inactive-list + source caches. Needs live cache/ETag investigation (cache key vs SAP eventual
  consistency); risky to touch shared read paths here.
- **DEVC ghost after delete** — a deleted object lingers in the package listing though `SAPRead` on it
  404s (package-index/cache lag).
