# BTP Cloud Package Create (SAPManage create_package on the ABAP Environment)

## Overview

`SAPManage(action="create_package")` does not work on the SAP BTP ABAP Environment (Steampunk). It builds an on-prem package body and sends the IAS **email** as `adtcore:responsible`, which SAP's package deserializer (`SPAK_ST_PACKAGES`) cannot convert to an ABAP `XUBNAME` → HTTP 400. This was misdiagnosed in a prior session as "package creation is impossible via ADT REST, Eclipse-only" (the G-11 note). **Live re-research on 2026-06-27 disproved that** — package create works via `POST /sap/bc/adt/packages` once the body is cloud-correct (proven: HTTP 201).

This plan makes `create_package` work on BTP by fixing three things in the body, all verified live:
1. `adtcore:responsible` must be the **internal ABAP user** (e.g. `CB9980000000`), not the email.
2. The new package must **nest under a structure package** (`<pak:superPackage adtcore:name="ZLOCAL">`), not name `ZLOCAL` only as a root software component.
3. `responsible` is **mandatory** (omitting it → "Enter a valid user…"), so ARC-1 must resolve the internal user.

The internal user is resolved via the **createdBy trick**: a cloud object create (which omits `responsible`) makes SAP stamp `createdBy`/`responsible` = the session's internal user; ARC-1 caches it. There is no whoami endpoint (verified). Resolution chain for `responsible` on BTP: explicit `responsible` arg → cached internal user → actionable error.

Success criteria (plain bullets, folded into Final verification as checkboxes):
- On BTP, `create_package` produces a body SAP accepts and creates the package (live 201, then deletable).
- On-prem package create behavior is **unchanged** (cloud transform is `systemType=btp`-gated only).
- A polluted/failure-path test exists (email value, missing `superPackage`, `responsible` unresolved).
- Docs that said "package create is Eclipse-only on BTP" are corrected.

## Context

### Current State

- `src/handlers/manage.ts` `case 'create_package'` (~line 99-189): parses `name`/`description`/`superPackage`/`softwareComponent`/`transportLayer`/`recordChanges`/`transport`/`packageType`, gates the allowlist, runs a transport pre-flight, then `buildPackageXml({ …, responsible: config.username })` and `createObject(client.http, client.safety, '/sap/bc/adt/packages', xml, 'application/*', effectiveTransport, undefined, cachedFeatures?.abapRelease)`. **`systemType` is not threaded; `superPackage` is optional; `responsible` is `config.username`** (empty on BTP → `normalizeAdtResponsible` defaults to `DEVELOPER`; or the email if set → deserialize 400).
- `src/adt/ddic-xml.ts` `buildPackageXml()` (the `buildPackageXml` symbol, ~line 489): emits a correct on-prem body shape (`<pak:package>` with `responsible` via `normalizeAdtResponsible`, `<pak:superPackage adtcore:name="…"/>`, `<pak:transport><pak:softwareComponent pak:name="…"/>…`). `normalizeAdtResponsible()` (~line 166) **uppercases** and defaults to `DEVELOPER` — fine on-prem, wrong for a cloud user (an email becomes an invalid `XUBNAME`). `softwareComponent` defaults to `'LOCAL'` (does not exist on BTP; the cloud local SC is `ZLOCAL`).
- `src/adt/client.ts` `AdtClient`: has `getEffectiveUser()` (added by #522; returns the JWT `user_name` = email on BTP). No internal-user cache. `withSafety()` clones via `Object.assign(Object.create(proto), this, {safety})` (#333) — any new instance field is shared automatically, but must be considered.
- `src/handlers/write/create.ts`: cloud object create path (`buildCreateXml(type, …, cloud)` + `createObject(…, '919'|release, 'btp', name)`), proven by #522. This is where the internal user can be captured (the created object's `createdBy` = the session user on cloud).
- `src/adt/errors.ts`: exception-type classification (#522 added an `ExceptionDataPreviewGeneral` → friendly-error branch). No branch for `SPAK_ST_PACKAGES` deserialize or `TR/458` "not a valid software component".

### Target State

- On BTP, `create_package` builds a cloud-correct body (internal-user `responsible`, nested under `superPackage`, cloud SC) and creates the package.
- A new optional `responsible` parameter on `SAPManage(create_package)` lets a caller pass the internal user explicitly.
- The internal user is auto-resolved (cached) from prior cloud object creates this session, so the common "create objects, then create a sub-package" flow needs no extra input.
- Clear, classified errors for the email-deserialize 400 and the `TR/458` missing-nesting case.
- On-prem behavior byte-identical (cloud path is `systemType=btp`-gated).

### Key Files

| File | Role |
|------|------|
| `src/adt/ddic-xml.ts` | `buildPackageXml()` + `normalizeAdtResponsible()` — add a `cloud` code path |
| `src/handlers/manage.ts` | `create_package` handler — systemType gate, responsible resolution, require `superPackage` on cloud |
| `src/adt/client.ts` | `AdtClient` — `internalUser` cache + `getInternalUser()` / `noteInternalUser()` |
| `src/handlers/write/create.ts` | hook to capture `createdBy` of cloud object creates into the cache |
| `src/handlers/schemas.ts` | Zod schema for `SAPManage` — add `responsible` |
| `src/handlers/tools.ts` | JSON Schema for `SAPManage` create_package — add `responsible` param |
| `src/adt/errors.ts` | classify `SPAK_ST_PACKAGES` 400 + `TR/458` |
| `tests/unit/adt/ddic-xml.test.ts`, `tests/unit/adt/client.test.ts`, `tests/unit/adt/errors.test.ts`, `tests/unit/handlers/manage.test.ts` | unit tests |
| `tests/integration/btp-abap.integration.test.ts` | live BTP create→delete + failure paths |
| `docs_page/btp-abap-environment.md`, `.env.example`, `AGENTS.md`, `docs_page/roadmap.md`, `docs/compare/00-feature-matrix.md` | docs |

### Verified Live Evidence

All captured 2026-06-27 against **BTP `H01`, SAP_BASIS 919**, user `marian@zeis.de` (internal ABAP user `CB9980000000`), with a browser-OAuth dev JWT. Full write-up: `docs/research/2026-06-27-btp-package-create-solved.md`. Scratch repro scripts: `btp-pkg-create.mjs`, `btp-pkg-create2.mjs`, `btp-pkg-ct.mjs`, `btp-createdby-verify.mjs`.

- **Works:** `POST /sap/bc/adt/packages` with `adtcore:responsible="CB9980000000"` + `<pak:superPackage adtcore:name="ZLOCAL">` + `<pak:softwareComponent pak:name="ZLOCAL">` → **HTTP 201** (created `ZARC1_PKGV4`, read back `createdBy=CB9980000000`, deleted). Content type **both** `application/*` **and** `application/vnd.sap.adt.packages.v2+xml` → 201 (so the handler's current `application/*` is fine — do **not** change it).
- **Email value fails:** `responsible="marian@zeis.de"` → 400 `ExceptionInvalidData` "An error occurred when deserializing in the simple transformation program SPAK_ST_PACKAGES" (`T100 00/001`).
- **Missing nesting fails:** internal user but empty `superPackage` → 400 `ExceptionResourceCreationFailure` "ZLOCAL is not a valid software component for package …" (`T100 TR/458`).
- **Omit responsible fails:** no `adtcore:responsible` attribute → 400 "Enter a valid user, not , as the person responsible".
- **Resolver (createdBy trick):** cloud CLAS create (body omits `responsible`) → the created object's `adtcore:createdBy` **and** `adtcore:responsible` = `CB9980000000`. Verified via `btp-createdby-verify.mjs` (created `ZCL_ARC1_WHOAMI` in `ZARC1_TEST`, read createdBy, deleted).
- **No whoami:** `/sap/bc/adt/system/users` (Accept `application/atom+xml;type=feed`) lists ALL users (here `CB9980000000`,`SAP_WFRT`); `/system/users/me` and `/$self` return empty feeds; `security/reentranceticket`, `core/discovery`, `compatibility/graph` carry no user id. So the createdBy cache is the only resolution path.
- **Model package** `ZARC1_TEST` (made in Eclipse): `adtcore:responsible="CB9980000000"`, `adtcore:masterSystem="H01"`, `<pak:superPackage adtcore:name="ZLOCAL" adtcore:type="DEVC/K">`, `<pak:softwareComponent pak:name="ZLOCAL" pak:type="J">`, `packageType="development"`. `ZLOCAL` itself is `packageType="structure"`, `responsible="_SAPSUPPORT"`.

### Design Principles

1. **Cloud transform is `systemType=btp`-gated.** On-prem `buildPackageXml`/`create_package` output and behavior must not change. Detect BTP the same way the write path does — mirror `resolveWriteSystemType()` in `src/handlers/write-helpers.ts` (uses `cachedFeatures?.systemType`, falling back to `'btp'` for bearer auth so a cold cache never emits on-prem XML for a BTP session).
2. **Do not mangle a cloud `responsible`.** `normalizeAdtResponsible` upper-cases and 12-char-truncates — correct for classic `XUBNAME`s but it must pass an internal cloud user (`CB9980000000`) through verbatim, and must never emit an email or `DEVELOPER` as the cloud `responsible`.
3. **`superPackage` is required on BTP.** A root package create is not valid on the ABAP Environment (`TR/458`). If `systemType=btp` and `superPackage` is empty, fail fast with an actionable error (don't send a doomed request).
4. **Resolution chain, no surprise side-effects.** `responsible` on BTP = explicit arg → `client.getInternalUser()` (cached from prior cloud object creates) → actionable error. Do **not** auto-create a throwaway object inside `create_package` to resolve the user (surprising; can orphan). The cache warms from the user's normal object-creation work.
5. **Content type unchanged.** `application/*` works for the cloud body (verified) — keep it; this keeps the diff minimal.
6. **Honest about the cold-start limit.** A brand-new tenant with no objects yet and no explicit `responsible` cannot resolve the internal user; the error must say exactly how to proceed (pass `responsible`, or create any object first). Docs state this.

## Development Approach

TDD where practical: for `buildPackageXml` and `errors.ts`, write the unit test (red) against the captured real shapes, then implement (green). Fixtures for the error classifier are the **real captured exception XML** from the evidence above (e.g. the `SPAK_ST_PACKAGES` and `TR/458` bodies in `docs/research/2026-06-27-btp-package-create-solved.md`) — do not hand-invent exception bodies.

Test strategy includes failure/negative paths everywhere (Design Principle 6 / ralphex Test Requirements): the email value, the missing-`superPackage` case, the unresolved-user case, and a polluted-payload test for the new `responsible` param (empty string, wrong-type). The BTP integration test mirrors the #522 pattern in `tests/integration/btp-abap.integration.test.ts` — a body-acceptance assertion that runs without a writable package (reaches `TR/458`/package-assignment, not a deserialize 400) plus an `it.skip`-gated full create→delete when `TEST_BTP_PACKAGE` is set.

Release note: this is BTP-only (cloud). On-prem (7.50/758/816) `create_package` is untouched and its existing tests must stay green — the cloud branch is gated, so no per-release live re-verification of on-prem is required beyond the existing suite.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add a cloud code path to `buildPackageXml`

**Files:**
- Modify: `src/adt/ddic-xml.ts` (`buildPackageXml` ~line 489; `PackageCreateParams` interface ~line 60; `normalizeAdtResponsible` ~line 166)
- Modify: `tests/unit/adt/ddic-xml.test.ts` (`describe('buildPackageXml')`)

Mirror how `buildCreateXml` gained its `cloud` boolean (see `src/handlers/write-helpers.ts` `cloudifyCreateBody`). The cloud package body differs from on-prem only in the `responsible` value handling and the SC default — the element structure is already correct.

- [ ] Add `cloud?: boolean` to `PackageCreateParams`.
- [ ] In `buildPackageXml`, when `cloud === true`: default `softwareComponent` to `'ZLOCAL'` (not `'LOCAL'`); default `recordChanges` to **false** when unset (the live model `ZARC1_TEST` has `pak:recordChanges="false"` — do NOT let the on-prem `LOCAL`→`recordChanges=true` heuristic fire for the `ZLOCAL` cloud SC, or the body diverges from the proven-201 one); pass `responsible` through verbatim (see the helper checkbox). Keep the existing element structure (`<pak:superPackage adtcore:name="…"/>`, `<pak:transport><pak:softwareComponent .../><pak:transportLayer .../></pak:transport>`, etc.).
- [ ] Add a NEW sibling helper `normalizeCloudResponsible(responsible)` — do NOT add a `{cloud}` flag to `normalizeAdtResponsible` (its existing upper-case + `@`-passthrough branch must stay intact for the other DDIC callers). The sibling returns the value **verbatim-trimmed** (cloud `XUBNAME`s like `CB9980000000` are already valid) and never injects `DEVELOPER`. The handler (Task 3) guarantees an email is never passed on the cloud path.
- [ ] Regression guard: with `cloud` unset/false, `buildPackageXml` output is byte-identical to today (existing on-prem tests must pass unchanged).
- [ ] Add unit tests (~6) in `describe('buildPackageXml')`: (a) cloud body contains `adtcore:responsible="CB9980000000"`, `<pak:superPackage adtcore:name="ZLOCAL"`, `<pak:softwareComponent pak:name="ZLOCAL"`, and `pak:recordChanges="false"`; (b) cloud body with no SC defaults to `ZLOCAL`; (c) on-prem body unchanged (snapshot/string-equality vs current — guard the `recordChanges` heuristic for `LOCAL`); (d) **failure path**: cloud helper does not emit `DEVELOPER` and does not upper-case-mangle the cloud user; (e) cloud body still nests `superPackage` when provided.
- [ ] Run `npm test`.

### Task 2: Internal-user cache on `AdtClient` (createdBy trick)

**Files:**
- Modify: `src/adt/client.ts` (`AdtClient` class; `constructor` ~line 320; the `withSafety()` clone ~line 372)
- Modify: `src/handlers/write/create.ts` (after a successful cloud object create)
- Modify: `tests/unit/adt/client.test.ts` (`describe('AdtClient')`)

There is no whoami endpoint (verified). The only reliable source of the session's internal ABAP user is the `createdBy` of an object the session just created on cloud (verified: `createdBy=CB9980000000`). Cache it so package create can use it without extra input.

- [ ] Add a private field `internalUser?: string` to `AdtClient` (TS `private`, never `#private`, per #333 so the `withSafety()` `Object.assign` clone shares it). Add `noteInternalUser(user: string): void` (sets the field if a plausible `XUBNAME` — non-empty, no `@`) and `getInternalUser(): string | undefined` (returns the field).
- [ ] In `src/handlers/write/create.ts`, on the cloud (`systemType==='btp'`) object-create success path, populate the cache once per session. NB (verified): the create path does NOT read the object back — `createObject` returns the POST body string which is only interpolated into the success message (`create.ts:~480` then `:~555`, never parsed), and the POST 201 body is NOT confirmed to contain `createdBy`. So, guarded by `if (!client.getInternalUser())`, do ONE best-effort GET of the just-created object's URL, parse `adtcore:createdBy`, and call `client.noteInternalUser(it)`. Runs at most once per session (skipped when already cached); wrap in try/catch so a failed resolve never breaks the create. Do NOT claim a zero-extra-call path.
- [ ] Confirm `withSafety()` still works: the clone must carry `internalUser` (it does via `Object.assign(…, this, …)`, but add an assertion test).
- [ ] Add unit tests (~4) in `describe('AdtClient')`: `noteInternalUser` sets the value; rejects an email/empty (**failure path**); `getInternalUser` returns it; the `withSafety()` clone preserves a cached internal user.
- [ ] Run `npm test`.

### Task 3: Wire cloud package create into the handler + add the `responsible` parameter

**Files:**
- Modify: `src/handlers/manage.ts` (`create_package` case ~line 99-189)
- Modify: `src/handlers/schemas.ts` (the `SAPManage` Zod schema — add `responsible`)
- Modify: `src/handlers/tools.ts` (the `SAPManage` JSON Schema / create_package param docs — add `responsible`)
- Modify: `tests/unit/handlers/manage.test.ts` (or create if absent — check `tests/unit/handlers/` first)

This is the three-file schema sync (Rule 7): `responsible` must exist in `tools.ts` (LLM-visible), `schemas.ts` (Zod), and be consumed in the `manage.ts` handler. Detect BTP exactly like the write path — mirror `resolveWriteSystemType()` in `src/handlers/write-helpers.ts`.

- [ ] Add an optional `responsible` string to the `SAPManage` Zod schema in `schemas.ts` (use the existing optional-string style; for an optional that LLMs may over-populate, follow the `looseOptional*` pattern already used in that file — empty string must be treated as absent).
- [ ] Add `responsible` to the `SAPManage` create_package parameter docs in `tools.ts` with a one-line description: "BTP only: internal ABAP user for the new package's person-responsible (e.g. CB9980000000). Auto-resolved from prior object creates when omitted." Do not hand-copy any object-type list — none changes here.
- [ ] In `manage.ts` `create_package`: compute `const systemType = resolveWriteSystemType(config, client)` (confirmed signature `resolveWriteSystemType(config: ServerConfig, client: AdtClient)` at `write-helpers.ts:317`; it reads `cachedFeatures` internally and uses `client.usesBearerAuth` for the bearer fallback — every call site uses `(config, client)`). When `systemType === 'btp'`:
      - require `superPackage` — if empty, return `errorResult` with a clear hint (cloud packages must nest under a structure package, e.g. `ZLOCAL`; cite that a root package create returns `TR/458`).
      - resolve the responsible: `const responsible = explicitResponsibleArg || client.getInternalUser()`. If still empty, return `errorResult`: "On the ABAP Environment, package creation needs your internal ABAP user. Pass `responsible` (e.g. CB9980000000 — find it via SAPRead on any object you own, field createdBy), or create any object first so ARC-1 can resolve it." Reject an email-shaped `responsible` with the same hint.
      - call `buildPackageXml({ …, cloud: true, responsible })`.
- [ ] Guard: on the BTP branch, `responsible` resolves ONLY from the explicit arg or `client.getInternalUser()` — NEVER from `client.getEffectiveUser()` (which returns the IAS email on BTP; the email is the V1 400 root cause). A test must assert the cloud branch never sends an `@`-containing `responsible`.
- [ ] On-prem path unchanged: when `systemType !== 'btp'`, keep `responsible: config.username` and `cloud` unset.
- [ ] Add unit tests (~5) in `describe('SAPManage create_package')` (mock the client; assert the XML passed to `createObject`): (a) BTP + cached internal user → body has `responsible="CB9980000000"`, `cloud:true`, nested superPackage; (b) BTP + explicit `responsible` arg → used; (c) **failure path** BTP + no superPackage → errorResult with the nesting hint, no HTTP call; (d) **failure path** BTP + unresolved user → errorResult with the responsible hint; (e) **polluted payload**: `responsible: ""` treated as absent, on-prem path with `responsible` set behaves as today.
- [ ] Run `npm test`.

### Task 4: Classify the BTP package-create errors

**Files:**
- Modify: `src/adt/errors.ts` (the exception-type classifier branch added by #522 for `ExceptionDataPreviewGeneral` — add sibling branches)
- Modify: `tests/unit/adt/errors.test.ts`

Ground the classifier on the **real captured exception bodies** (Verified Live Evidence). A `200 OK` proves nothing; these are real 400s seen live.

- [ ] Add a branch: exception type `ExceptionInvalidData` whose body names `SPAK_ST_PACKAGES` → a friendly message like "Package create body rejected — the person-responsible must be a valid internal ABAP user (XUBNAME), not an email. ARC-1 sends the wrong value only if `responsible` was forced; omit it to auto-resolve." (Only fires for the package endpoint / that ST name — keep it narrow.)
- [ ] Add a branch: exception type `ExceptionResourceCreationFailure` with message matching `/is not a valid software component/i` (`TR/458`) → "Package must nest under a structure package on the ABAP Environment — pass `superPackage` (e.g. ZLOCAL)."
- [ ] Add unit tests (~3) in the errors describe block using the captured XML strings: each exception body maps to the intended friendly message; an unrelated exception is untouched (**negative path**).
- [ ] Run `npm test`.

### Task 5: BTP integration test (live create→delete + failure paths)

**Files:**
- Modify: `tests/integration/btp-abap.integration.test.ts` (add a `describe('BTP package-create path')`, mirroring the existing `describe('BTP object-create path')` from #522)

Mirror the #522 pattern: a body-acceptance test that runs against the structure package without a writable target (asserts it reaches package-assignment, i.e. `TR/458`, not a deserialize 400), plus an `it.skip`-gated full lifecycle when `TEST_BTP_PACKAGE`/`TEST_BTP_STRUCTURE_PACKAGE` is set. Auth via the pre-acquired `TEST_BTP_ACCESS_TOKEN` or the service-key browser flow (same `getBtpTestClient()` helper).

- [ ] Add a test: build a cloud package body (`buildPackageXml({ cloud:true, responsible: <resolved internal user>, superPackage: <structure pkg, default ZLOCAL> })`) and `POST /sap/bc/adt/packages`; assert the body **deserialized** (got past `SPAK_ST_PACKAGES` to package-assignment) via `expectSapFailureClass(err, [400], [/TR\/458|not a valid software component/i])` and that the message does NOT match `/deserializ|SPAK_ST_PACKAGES/`. NB: unlike #522's object-create body-check (a **403** `ExceptionResourceNoAccess`), the package path lands on a **400** `TR/458` — use the 400 matcher, not 403.
- [ ] Add an `it.skip`-gated (on `TEST_BTP_PACKAGE`) full **create → read (assert createdBy = internal user) → delete** of a unique package (`generateUniqueName('ZARC1_PKG')`) nested under that package, cleaning up in `finally`.
- [ ] Add a **failure-path** test: posting the body with the email as `responsible` yields the `SPAK_ST_PACKAGES` 400 (guards the root cause and the Task 4 classifier), tolerated via `expectSapFailureClass(err, [400], [/SPAK_ST_PACKAGES|deserializ/i])`.
- [ ] Run the BTP suite locally (needs creds; throws without them — do NOT add to Validation Commands): `TEST_BTP_SERVICE_KEY_FILE=~/.config/arc-1/btp-abap-service-key.json npm run test:integration:btp`.

### Task 6: Documentation

**Files:**
- Modify: `docs_page/btp-abap-environment.md` (the "Writing objects on BTP" / package section — currently says package creation is Eclipse-only)
- Modify: `.env.example` (the BTP package note)
- Modify: `AGENTS.md` (Key Files row for `Package create/delete/move (DEVC)` — note the BTP cloud path + the internal-user resolution)
- Modify: `docs_page/roadmap.md` and `docs/compare/00-feature-matrix.md` (flip BTP package-create from blocked/❌ to supported/✅; refresh "Last Updated")

Write to **as-shipped** behavior (Design Principle 6): package create works on BTP; the internal user auto-resolves after any object create or via the `responsible` param; a brand-new tenant's first-ever package (no objects yet, no explicit `responsible`) still needs an Eclipse bootstrap or an explicit `responsible`.

- [ ] Replace the "Package creation is Eclipse-only" guidance in `docs_page/btp-abap-environment.md` with the working recipe + the internal-user note (cite `docs/research/2026-06-27-btp-package-create-solved.md`).
- [ ] Update `.env.example` BTP package note to match.
- [ ] Update the `AGENTS.md` Key Files row and any roadmap/feature-matrix entry that claimed BTP package create is blocked.
- [ ] Run `npm test` (docs-only, but confirms nothing broke).

### Task 7: Final verification

- [ ] Run full test suite: `npm test` — all pass.
- [ ] `npm run typecheck` — no errors.
- [ ] `npm run lint` — no errors.
- [ ] `npm run build` — succeeds (and `npm run check:sizes` if file-size budgets are touched).
- [ ] Live verification on BTP (creds per `INFRASTRUCTURE.md`; dev JWT via browser OAuth — `client_credentials` is rejected by ADT): create a uniquely-named cloud package nested under a writable dev package, assert HTTP 201 + `createdBy` = the internal user, then delete it. A throwaway script is fine; do not commit it.
- [ ] Confirm on-prem package create is unaffected (existing `manage`/`ddic-xml` unit tests green; if a live on-prem system is handy, one `arc1-cli call SAPManage --action create_package …` sanity check).
- [ ] Grep for any doc still claiming BTP package create is impossible/Eclipse-only — zero residual references.
- [ ] Move this plan to `docs/plans/completed/`, then fix any relative links inside it (`../` paths gain a level).
