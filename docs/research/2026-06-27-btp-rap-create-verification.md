# BTP RAP-Stack Create (BDEF / SRVD / SRVB) — Live Verification & Plan

**Date:** 2026-06-27
**System:** BTP ABAP Environment `H01`, SAP_BASIS **919**, region us10, user `marian@zeis.de` (`SAP_BR_DEVELOPER`).
**Base:** `origin/main` @ `515b91fd` (PR #522, the cloud-create fix).
**Companion:** `2026-06-26-btp-object-create-fix.md` (#522 — the create path this builds on).
**Method:** live ADT POSTs with a real dev JWT, driving ARC-1's create body + content-type through the dist HTTP/CSRF layer.

---

## Goal & premise

The #522 review left item #2: *"RAP create (BDEF/SRVD/SRVB) on BTP is unverified and likely broken — BTP is RAP-first."* This feature pins the real behavior and ships the smallest correct change.

## Verified ADT contracts (SAP source: `~/DEV/arc-1-eclipse-adt/api/01-rap-object-types-and-uris.md`)

| Type | Create collection (POST) | ARC-1 content type (`createContentTypeForType`) | Body builder |
|------|--------------------------|--------------------------------|--------------|
| BDEF | `/sap/bc/adt/bo/behaviordefinitions` | `application/vnd.sap.adt.blues.v1+xml` | `blue:blueSource` (BDEF/BDO) |
| SRVD | `/sap/bc/adt/ddic/srvd/sources` | `application/*` | `srvd:srvdSource` (SRVD/SRV, `srvd:srvdSourceType="S"`) |
| SRVB | `/sap/bc/adt/businessservices/bindings` | `application/*` (special-cased) | `srvb:serviceBinding` (SRVB/SVB) via `buildServiceBindingXml` |

`abapLanguageVersion` is **not documented** anywhere in the Eclipse ADT api docs or the reference impls (`mcp-abap-adt*`, `vibing-steampunk`) — they are on-prem-shaped. So cloud behavior is **empirical only**.

## How the post-#522 code already treats these types

`buildCreateXml(type, …, cloud=true)` wraps every body in `cloudifyCreateBody` (`src/handlers/write-helpers.ts`), which is **generic**:
- strips `adtcore:masterSystem="H00"`,
- strips `adtcore:responsible="…"`,
- inserts `adtcore:abapLanguageVersion="cloudDevelopment"` after `adtcore:masterLanguage`.

All three RAP bodies carry `masterLanguage`/`responsible` (BDEF/SRVD also `masterSystem`), so cloudify **already rewrites them**. The open question (from the INTF precedent, where `application/*` + cloud language-version → HTTP 500 "ABAP language version is not allowed in this software component"): does adding `abapLanguageVersion` break BDEF/SRVD/SRVB?

## Live findings (BTP 919, this session)

### Deserialize check — POST to structure package `ZLOCAL` (correct body → 409 "structure package"; wrong body → 400/500 earlier)

| Type | +abapLanguageVersion | no abapLanguageVersion |
|------|----------------------|------------------------|
| BDEF | 409 structure-package (body OK) | 409 structure-package (body OK) |
| SRVD | 409 structure-package (body OK) | 409 structure-package (body OK) |
| SRVB | 409 structure-package (body OK) | 409 structure-package (body OK) |

No 400 deserialize, no 500 language-version at this stage; `abapLanguageVersion` made no difference.

### Full create — POST to writable dev package `ZARC1_TEST` (then deleted)

| Type | +abapLanguageVersion | no abapLanguageVersion |
|------|----------------------|------------------------|
| BDEF | **201 CREATED ✅** | **201 CREATED ✅** |
| SRVD | **201 CREATED ✅** | **201 CREATED ✅** |
| SRVB | **201 CREATED ✅** (with dummy serviceDefinition ref) | **201 CREATED ✅** |

**All three RAP types create successfully on BTP 919, with and without `abapLanguageVersion`.** The software-component language-version check (that 500'd INTF under `application/*`) does **not** fire for these types — their content types (`blues.v1` for BDEF, `application/*` for SRVD/SRVB) route to STs that accept the cloud body. All 6 probe objects were created and deleted; **no orphans** (verified by search).

### Error-classification observation (adjacent)

Creating a RAP object into a **structure** package returns `409 ExceptionResourceLockConflict` "Structure packages cannot contain development objects" — a **different** exception type than CLAS's `403 ExceptionResourceNoAccess`. Tracing `classifySapDomainError` (`src/adt/errors.ts`, post-#522): the SM12 lock-hint path requires a `lockPattern` match (it doesn't match "structure package"), and the #522 friendly-hint path is gated on `ExceptionResourceNoAccess`. So the RAP case **passes through with SAP's raw (clear) message and no misleading SM12 hint** — *not a bug*, just less friendly than CLAS's "create a regular sub-package" guidance.

## Conclusion (ponytail)

**The create body is already cloud-correct for BDEF/SRVD/SRVB — no production-code change is required to make RAP create work.** The genuine gap from the #522 review is **missing verification/coverage**, not broken code. So:

- **Rung 1 (does the fix need to exist?):** No code fix for the create body. ✋
- **Deliverable:** regression-locking **tests** + **docs** that this works, so a future cloudify change can't silently break RAP create.
- **Optional (tiny):** extend #522's structure-package friendly hint to the RAP `ExceptionResourceLockConflict` type for cross-type consistency — safe because it stays guarded by the structure-package markers + `!lockPattern`.

---

## Plan

### Affected files
| File | Change | Why |
|------|--------|-----|
| `tests/unit/handlers/build-create-xml-cloud.test.ts` | Add BDEF/SRVD/SRVB cases: cloud body has **no** `adtcore:responsible`/`masterSystem`, **has** `abapLanguageVersion="cloudDevelopment"`; on-prem body unchanged | Deterministic regression guard for the cloudify contract on RAP types (no live system needed) |
| `tests/integration/btp-abap.integration.test.ts` | Extend "BTP object-create path": (a) body-acceptance for BDEF/SRVD/SRVB against the structure package (reaches package-assignment, not a 400/500); (b) full create→delete in `TEST_BTP_PACKAGE` when set | Live proof RAP create works on cloud; mirrors the existing CLAS pattern |
| `docs_page/btp-abap-environment.md` | One line: RAP objects (BDEF/SRVD/SRVB) create is supported on the ABAP Environment | As-shipped user doc |
| `docs/research/2026-06-27-btp-rap-create-verification.md` | This dossier | Durable evidence |
| *(optional)* `src/adt/errors.ts` + `tests/unit/adt/errors.test.ts` | Add `ExceptionResourceLockConflict` to the structure-package friendly-hint guard (kept behind the structure-package markers + `!lockPattern`) | Cross-type consistency with #522 G-4 |

### Non-goals
- No change to `cloudifyCreateBody`/`createContentTypeForType` (already correct for RAP — proven live).
- No full RAP **activation** test: an empty BDEF/SRVD shell can't activate on any system (needs a real root entity + behavior source + service exposure). That is a RAP-scenario concern, not a create-body concern; the 201-create + deserialize checks are the create-correctness equivalents of #522's CLAS proof.
- SRVB **update** path on BTP stays a #522 follow-up (out of scope).

### Test commands
```bash
npm test -- build-create-xml-cloud          # unit (no SAP)
# live (needs dev JWT; client_credentials is rejected by ADT):
TEST_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-abap-service-key.json \
TEST_BTP_ACCESS_TOKEN=<dev-jwt> TEST_BTP_PACKAGE=ZARC1_TEST \
  npm run test:integration:btp -- -t "object-create path"
```

### Risk / release
- Tests + docs → `test:`/`docs:` (no release).
- Cloud-only; on-prem create bodies are untouched (cloudify is `cloud`-gated).

## Codex review (2026-06-27) — applied

An adversarial Codex pass confirmed **no production-code gap** and found 4 test-quality issues; all addressed in the same commit (tests only):

- **#1 (MEDIUM) structure-package false-green — FIXED.** The body-acceptance assertion allowed `[403, 409]` with loose markers (`/package/`, `/authoriz/`); an unrelated 403 could pass. Tightened to the specific markers `/structure package/` + `/cannot contain development objects/`, and broadened the negative checks (`System expected the element`, `Unsupported Media Type`, `not acceptable`).
- **#2 (MEDIUM) stale-object risk — FIXED.** Body-check objects now use `generateUniqueName(prefix)` (not a fixed name) and clean up in a `finally` with a `created` flag — so a prior run can't be silently re-deleted in the 409-expected path, masking the probe.
- **#3 (LOW) `_package` fidelity — FIXED.** The handler (`src/handlers/write/create.ts` `needsPackageParam`) sends `?_package=` only for BDEF (and TABL*); SRVD/SRVB carry the target via the body `packageRef` only. The test now mirrors this per-type (`needsPackage`). **Re-verified live on H01: SRVD/SRVB create→delete green without `_package`.**
- **#4 (LOW) negative checks — FIXED** alongside #1.

Confirmed *not* real issues: RAP needs no `cloudify`/content-type special-case; `abapLanguageVersion` is harmless on RAP (live-proven); direct-facade test layer matches #522; the SRVB dummy `serviceDefinition` does not mask body shape; three-file schema sync N/A (BDEF/SRVD/SRVB already in `tools.ts`/`schemas.ts`, no surface change).

Post-fix: unit + typecheck + lint green; **live BTP RAP suite 6/6 on H01**; no orphans.
