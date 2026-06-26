# Fix hard-coded `EN` master language in object-creation XML (issue #343)

## Overview

ARC-1's object-creation XML builders hard-code `adtcore:masterLanguage="EN"` (and `adtcore:language="EN"` for SRVB/FUGR/SKTD) instead of deriving the language from the configured `SAP_LANGUAGE`. On the S/4HANA v2 DDIC handler this causes **data elements (DTEL) and domains (DOMA)** created with `SAP_LANGUAGE=DE` to be stored with English as their per-object master language (`DD04L-DTELMASTER` / `DD01L-DOMMASTER` = `E`) and their German labels/descriptions **mis-filed under the English language key** (`DD04T`/`DD01T` `DDLANGUAGE=E`), while the repository directory `TADIR-MASTERLANG` is German (`D`) — a split-brain. SAP's own documentation (`ABENORIGINAL_LANGU_GUIDL`) and SAP Note 727896 state the original language must be the logon language; abapGit enforces exactly this.

This plan threads the configured language (`config.language`, which ARC-1 already sends as the `sap-language` URL param on every request) into every create-XML builder, defaulting to `EN` when `SAP_LANGUAGE` is unset (no behavior change for the default case).

This was empirically proven on live systems — see `docs/research/2026-06-04-issue-343-masterlanguage-on-create.md` for the full evidence (HANA round-trip reads, real-binary reproduction, version matrix). The genuinely buggy types are **DTEL and DOMA** (DDIC types with a per-object master-language field + language-keyed text tables) on **S/4HANA (v2 handler)**; for source/container objects (PROG, CLAS, INTF, FUGR, …) the body attribute is ignored by SAP (cosmetic), and NW 7.50 (v1 handler) ignores it entirely. The fix is applied to **all** builders for consistency (it is harmless where cosmetic and corrects the Eclipse-visible echo), with acceptance testing focused on DTEL + DOMA.

## Context

### Current State

- `src/adt/ddic-xml.ts` — `buildDomainXml` (`:171`), `buildDataElementXml` (`:246`), `buildServiceBindingXml` (`:323-324`) hard-code `EN`.
- `src/handlers/intent.ts` — `buildCreateXml` (`:2870`) hard-codes `masterLanguage="EN"` for PROG/CLAS/INTF/INCL/DDLS/DCLS/TABL/BDEF/SRVD/DDLX/FUGR (and `language="EN"` for FUGR); the inline SKTD create body (`:4039`) hard-codes both.
- The three `buildCreateXml` call sites — update (`~:3827`), create (`~:4087`), batch_create (`~:5202`) — pass no language.
- `config.language` (the configured `SAP_LANGUAGE`, default `EN`) is already in scope in `handleSAPWrite` and is what `buildAdtConfig` sends as `sap-language` for both shared and per-user clients (`src/server/server.ts:187`).
- For `isMetadataWriteType` = {DOMA, DTEL, MSAG, SRVB} (`src/handlers/intent.ts:2550`), `buildCreateXml` output is reused for create, the DTEL/MSAG follow-up label PUT (`~:4122`), and metadata UPDATE (`~:3819`) — so one builder fix covers all three paths.

### Target State

- Every create-XML builder emits `adtcore:masterLanguage` (and `adtcore:language` where present) derived from the configured language, normalized to upper-case 2-char (e.g. `DE`), defaulting to `EN`.
- With `SAP_LANGUAGE=DE`, a created DTEL/DOMA has master language `DE` and its German texts filed under `D`, consistent with `TADIR`.
- With `SAP_LANGUAGE` unset (default `EN`), output is byte-identical to today.
- `MSAG`, `DEVC`, `FUNC` are untouched (they carry no language attribute by design).

### Key Files

| File | Role |
|------|------|
| `src/adt/ddic-xml.ts` | DOMA/DTEL/SRVB create-XML builders + their `*CreateParams` interfaces |
| `src/handlers/intent.ts` | `buildCreateXml`, inline SKTD body, the 3 call sites in `handleSAPWrite` |
| `tests/unit/adt/ddic-xml.test.ts` | Builder unit tests |
| `tests/unit/handlers/intent.test.ts` | `buildCreateXml` unit tests + handler request-body assertions (mocked undici) |
| `tests/integration/crud.lifecycle.integration.test.ts` | DTEL/DOMA CRUD lifecycle (live SAP) — add DE round-trip acceptance |
| `CLAUDE.md` | Key Files table + config table note |
| `docs/research/2026-06-04-issue-343-masterlanguage-on-create.md` | Full evidence (already written) |

### Design Principles

- **Single source of truth:** derive the body language from `config.language` only — the exact value already sent as `sap-language`. Do NOT add an `AdtClient` property and do NOT touch `withSafety()` (the issue's suggestion to expose it from the client adds a clone hazard for no benefit).
- **Default `EN` preserved:** normalize as `(language || 'EN').trim().toUpperCase()` so unset `SAP_LANGUAGE` keeps today's exact output.
- **Pure builders normalize internally** (testable in isolation); call sites pass `config.language` raw.
- **No new tool/schema parameter:** this is config-driven, not a per-call override (out of scope; possible future enhancement).
- **Do not add a language attribute to MSAG/DEVC/FUNC** — they intentionally have none.

## Development Approach

Foundation first (pure builders + their unit tests), then handler wiring (call sites + mocked-request unit tests), then live integration acceptance (DTEL + DOMA DE round-trip), then docs. Each task ends by running the unit suite. Integration tests hard-fail without `TEST_SAP_URL` (no silent skips) per the project skip policy.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Thread configured language into the DDIC builders (DOMA, DTEL, SRVB)

**Files:**
- Modify: `src/adt/ddic-xml.ts`
- Modify: `tests/unit/adt/ddic-xml.test.ts`

These three builders hard-code the master language. Add an optional `language` to their params and emit it instead of the literal `EN`, defaulting to `EN`.

- [ ] Add `language?: string` to `DomainCreateParams`, `DataElementCreateParams`, and `ServiceBindingCreateParams` (interfaces near the top of `src/adt/ddic-xml.ts`).
- [ ] In `buildDomainXml`, compute `const masterLanguage = (params.language || 'EN').trim().toUpperCase();` and replace `adtcore:masterLanguage="EN"` (line ~171) with `adtcore:masterLanguage="${masterLanguage}"`.
- [ ] In `buildDataElementXml`, do the same for `adtcore:masterLanguage="EN"` (line ~246).
- [ ] In `buildServiceBindingXml`, compute the same `masterLanguage` and replace BOTH `adtcore:language="EN"` and `adtcore:masterLanguage="EN"` (lines ~323-324) with `${masterLanguage}`.
- [ ] Add unit tests (~6 tests) in `tests/unit/adt/ddic-xml.test.ts`: for each of the three builders, (a) with `language: 'DE'` the XML contains `adtcore:masterLanguage="DE"` (and for SRVB also `adtcore:language="DE"`); (b) without `language` the XML still contains `adtcore:masterLanguage="EN"`. Also assert lower-case `language: 'de'` normalizes to `"DE"`.
- [ ] Run `npm test` — all tests must pass.

### Task 2: Thread configured language through `buildCreateXml`, the inline SKTD body, and the call sites

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

`buildCreateXml` (`src/handlers/intent.ts:2870`) builds the create XML for all remaining types and is reused for metadata updates and the DTEL/MSAG follow-up PUT. Add a `language` parameter, replace every literal `EN`, and pass `config.language` from the call sites.

- [ ] Change the signature to `buildCreateXml(type, name, pkg, description, properties?, language?: string)`. At the top of the function compute `const masterLanguage = (language || 'EN').trim().toUpperCase();`.
- [ ] Replace every `adtcore:masterLanguage="EN"` in the `buildCreateXml` switch (PROG, CLAS, INTF, INCL, DDLS, DCLS, TABL/DT/DS, BDEF, SRVD, DDLX) with `adtcore:masterLanguage="${masterLanguage}"`. For the FUGR case, replace both `adtcore:language="EN"` and `adtcore:masterLanguage="EN"`.
- [ ] In the DOMA/DTEL/SRVB cases of `buildCreateXml`, set `language: masterLanguage` on the `DomainCreateParams`/`DataElementCreateParams`/`ServiceBindingCreateParams` objects passed to the sub-builders (so they receive the threaded language).
- [ ] Leave the MSAG and FUNC cases unchanged (no language attribute).
- [ ] Update the inline SKTD create body (`ktdBody`, line ~4039) to use the configured language for `adtcore:language="..."` and `adtcore:masterLanguage="..."`. Derive it locally: `const ktdLang = (config.language || 'EN').trim().toUpperCase();`.
- [ ] Pass `config.language` as the new 6th arg at all three `buildCreateXml` call sites: the metadata-update path (`~:3827`), the create path (`~:4087`), and the batch_create path (`~:5202`). `config` is in scope in `handleSAPWrite` at all three.
- [ ] Add unit tests (~6 tests) in `tests/unit/handlers/intent.test.ts`: (a) `buildCreateXml('PROG', …, 'DE')` contains `masterLanguage="DE"`; `buildCreateXml('FUGR', …, 'DE')` contains both `language="DE"` and `masterLanguage="DE"`; `buildCreateXml('DTEL'/'DOMA', …, props, 'DE')` contains `masterLanguage="DE"`. (b) Calls without the language arg still contain `masterLanguage="EN"` (guard the existing default behavior — keep/confirm the existing FUGR `"EN"` test passes).
- [ ] Add a handler-wiring test (~2 tests) using the mocked-undici pattern (`vi.mock('undici', …)` + `mockResponse`): call `handleToolCall`/`handleSAPWrite` for a DTEL `create` with the client configured `language: 'DE'`, and assert the POSTed request body contains `adtcore:masterLanguage="DE"`. Add the same for `SAP_LANGUAGE` unset → body contains `"EN"`.
- [ ] Run `npm test` — all tests must pass.

### Task 3: Live DE round-trip acceptance for DTEL (automated) + DOMA (assertion note)

**Files:**
- Modify: `tests/integration/crud.lifecycle.integration.test.ts`

Prove on a live S/4HANA (v2 handler) system that a DTEL created with the German language comes back with master language `DE`. Read `tests/integration/helpers.ts` and the existing `DTEL`/`DOMA` lifecycle tests in this file first to reuse `getTestClient()`, `generateUniqueName()`, and the create/GET helpers.

**Assertion-method facts (verified live, see research doc §3-5):**
- **DTEL**: the ADT GET metadata `adtcore:masterLanguage` echoes the **body** value (`DD04L-DTELMASTER`). Created body=EN/url=DE → GET=`"EN"`; body=DE → GET=`"DE"`. So asserting GET=`"DE"` after the fix **is a valid discriminator** (it was `"EN"` before).
- **DOMA**: the ADT GET `adtcore:masterLanguage` echoes **`TADIR-MASTERLANG`** (the URL `sap-language`), which is already `DE`. So ADT GET **cannot** discriminate the DOMA fix — the DOMA fix lives in `DD01L-DOMMASTER` + `DD01T-DDLANGUAGE`, only readable via the DB. Do **not** write a DOMA integration assertion based on ADT GET (it would pass even unfixed and give false confidence). DOMA's deep fix is covered by the Task 2 unit test (POST body contains `masterLanguage="DE"`) plus the manual HANA verification recorded in the research doc.

- [ ] Build (or obtain) an `AdtClient` configured with `language: 'DE'` (construct from the same env credentials as `getTestClient()` but with `language: 'DE'`; if `getTestClient` takes no override, instantiate `new AdtClient({ ... , language: 'DE' })` from the test env vars). Skip via `requireOrSkip(ctx, …)` when `TEST_SAP_URL` is missing — never `if (!x) return`.
- [ ] DTEL test: create a uniquely-named DTEL with `buildCreateXml('DTEL', name, '$TMP', 'Sprachtest', { typeKind:'predefinedAbapType', dataType:'CHAR', length:10, shortLabel:'Kurz', mediumLabel:'Mittel', longLabel:'Lang', headingLabel:'Kopf' }, 'DE')` via the DE client (the DTEL follow-up label PUT also reuses this DE body), then GET the data element metadata and assert `adtcore:masterLanguage="DE"`. Clean up in `finally` (delete), tagged `// best-effort-cleanup`.
- [ ] DOMA test: create a uniquely-named DOMA with `language: 'DE'` and assert the **create succeeds** (HTTP 2xx / success result) as a non-regression smoke check; add a code comment that the master-language correctness for DOMA is verified by the Task 2 unit test + manual HANA read (ADT GET cannot discriminate it). Clean up in `finally`.
- [ ] Assert both success and expected-error paths (use `expectSapFailureClass` for any catch); do not leave empty catches.
- [ ] Run `npm run test:integration` against the configured `TEST_SAP_URL` — new tests pass. (CI without SAP creds hard-fails by policy, handled by the skip harness.)
- [ ] Run `npm test` — unit suite still green.

### Task 4: Documentation

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/research/2026-06-04-issue-343-masterlanguage-on-create.md` (mark status implemented once merged)

- [ ] Add a Key Files row to `CLAUDE.md`: e.g. *"Set created object master/original language from SAP_LANGUAGE | `src/adt/ddic-xml.ts` (DOMA/DTEL/SRVB builders), `src/handlers/intent.ts` (`buildCreateXml` + inline SKTD + 3 call sites pass `config.language`). Genuine effect on DTEL/DOMA (per-object master + text language) on S/4 v2 handler; cosmetic for source objects; NW 7.50 v1 ignores it. Default EN preserved. See `docs/research/2026-06-04-issue-343-masterlanguage-on-create.md`."*
- [ ] In `CLAUDE.md`, update the `SAP_LANGUAGE` config-table row to note it now also sets the master/original language of newly created objects (not just the request `sap-language`).
- [ ] Confirm no other doc references the hard-coded `EN` create behavior (grep `docs/` for `masterLanguage`); update any that do.
- [ ] Run `npm test` — all tests pass (docs-only task; sanity check the suite still builds).

### Task 5: Final verification

- [ ] Run full test suite: `npm test` — all tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Grep the source to confirm no remaining hard-coded `adtcore:masterLanguage="EN"` / `adtcore:language="EN"` in create paths except intentional defaults: `grep -rn 'masterLanguage="EN"\|adtcore:language="EN"' src/` should return only normalized-default expressions, not literals in builder output.
- [ ] Confirm `SAP_LANGUAGE` unset still yields `masterLanguage="EN"` (a builder unit test asserts this).
- [ ] Verify the live DTEL + DOMA DE round-trip (Task 3) passed against `TEST_SAP_URL`, and that all test objects were cleaned up.
- [ ] Move this plan to `docs/plans/completed/`.
