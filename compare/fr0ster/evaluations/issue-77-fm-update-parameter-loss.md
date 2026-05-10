# Issue #77 — UpdateFunctionModule loses FM parameters

> **Priority**: High
> **Source**: fr0ster open issue #77 (2026-04-25); diagnostic probe `3a3fa65`
> **ARC-1 components**: `src/handlers/intent.ts` (FUNC update path), `src/adt/client.ts` (`getFunction`), `src/handlers/schemas.ts` (FUNC included in `SAPWRITE_TYPES_ONPREM`)

## What fr0ster reported

Issue #77 (still open as of 2026-04-26): when `UpdateFunctionModule` re-uploads source, the FM's parameter list is wiped. This is a read-modify-write parameter-loss bug specific to function modules: the function-module source `/source/main` returned by ADT does not include the parameter declarations (those live in a separate metadata document). PUTting just the source body therefore strips parameters when the object is reactivated.

Companion script `scripts/probe-update-fm.ts` (commit `3a3fa65`) was added to investigate the read-modify-write semantics — the maintainer is still characterising what ADT actually persists for `same` / `stripped` / `bare` source bodies.

## ARC-1 current state

- **Read path**: `getFunction(group, name)` in `src/adt/client.ts:216` → `GET /sap/bc/adt/functions/groups/{group}/fmodules/{name}/source/main`. Returns the body source only.
- **Write path**: `'FUNC'` is in `SAPWRITE_TYPES_ONPREM` (`src/handlers/schemas.ts:219`), but the URL machinery is broken:
  - `objectBasePath('FUNC')` (`src/handlers/intent.ts:2535`) returns `/sap/bc/adt/functions/groups/` — that is the **group** path, not the FM endpoint.
  - `objectUrlForType('FUNC', name)` therefore yields `/sap/bc/adt/functions/groups/{name}` (no group, no `fmodules` segment) — wrong URL for FM updates.
  - The `safeUpdateSource()` call in `handleSAPWrite('update')` doesn't take a `group` parameter, so even if the URL were fixed, the group is currently unreachable from the write path.

In other words: **ARC-1 cannot update function modules today** (read works because of the dedicated `case 'FUNC'` branch in SAPRead that takes `group`; update silently builds the wrong URL). No e2e test exercises this — there's no FUNC create/update integration test in `tests/integration/` or `tests/e2e/`.

## Assessment

This is two problems stacked:

1. **ARC-1 has a latent FUNC-update gap** unrelated to fr0ster. Either remove `'FUNC'` from `SAPWRITE_TYPES_ONPREM` until a proper FM update path exists, or implement it correctly — `objectBasePath('FUNC')` needs the group, and `safeUpdateSource()` would need a FUNC-specific URL builder that accepts `group` + `name`.
2. **Even if we fix the URL, fr0ster's parameter-loss bug applies**. PUTting only the source/main body without the parameter metadata wipes parameters on reactivation. Fixing this on the ADT side requires either:
   - a parallel POST/PUT to the FM metadata endpoint (parameters/exceptions), or
   - reading the metadata, rewriting source while preserving the parameter declarations in the source itself, then writing both halves.

Until the upstream investigation in fr0ster lands, ARC-1 should **not advertise FUNC update**.

## Decision

**verify-and-fix-or-remove**:

1. Audit whether anyone has actually called `SAPWrite(type='FUNC', action='update')` against ARC-1 — if not (likely, since no integration test covers it), the safest near-term action is to remove `'FUNC'` from `SAPWRITE_TYPES_ONPREM` with a clear schema error message ("FUNC update is not yet supported — use SAPRead with `objectType='FUNC'` and `group=` for reads; use ADT/Eclipse for FM maintenance").
2. Track fr0ster issue #77 — when they ship a fix, port the metadata-preserving update pattern.
3. If we want full FUNC CRUD, add a `case 'FUNC'` to `objectBasePath` that accepts the group, plumb `args.group` through `handleSAPWrite`, and add an integration test that exercises create→add-parameter→update-source→reactivate→verify-parameter-still-present.

**Cross-reference**: see [`795633a-fm-group-validation.md`](795633a-fm-group-validation.md) — a related FM read-side bug fr0ster hit where ADT silently resolves an FM by name regardless of the group segment in the URL.

## 2026-05-09 update — ARC-1 latent gap closed (issue #250)

ARC-1 issue [#250](https://github.com/marianfoo/arc-1/issues/250) reported that `SAPWrite(type='FUNC')` errored out at the URL builder. A live verification on a4h S/4HANA 2023 confirmed the ADT FM endpoints work end-to-end (FUGR + FM create, source update, activate, delete), and the gap was on the ARC-1 side — `objectBasePath('FUNC')` deliberately throws to keep generic URL builders from silently mis-routing. Closed by adding a FUNC-aware branch to `handleSAPWrite` (and to `SAPActivate` single + batch paths) that pre-resolves the URL from `args.group`, plus a `case 'FUNC'` in `buildCreateXml` returning the verified `<fmodule:abapFunctionModule>` envelope. `FUGR` was added to `SAPWRITE_TYPES_ONPREM` for the same release (FUGR is the prerequisite parent for FM creation).

The parameter-loss bug class fr0ster identified is **still upstream-blocked** and intentionally out of scope for ARC-1's MVP. ARC-1's tool description warns LLMs explicitly that FM signature/parameter management (IMPORTING/EXPORTING/EXCEPTIONS) is NOT handled — operators add parameters via SAPGUI/SE37 or Eclipse after activation. SAPGUI-style `*"…IMPORTING…"*` parameter comment blocks in source are auto-stripped before PUT (SAP rejects them with `FUNC_ADT028 "Parameter comment blocks are not allowed"`) and a warning is appended to the response.

When fr0ster's investigation lands a metadata-preserving update pattern, ARC-1 can add it as a follow-up (likely a `signature`/`parameters` payload field on `SAPWrite type=FUNC`).

## 2026-05-10 update — fr0ster #77 parameter-loss class CLOSED for ARC-1 (issue #252)

User-asked follow-up to ARC-1 issue #250: ghostxwheel asked "no parameters can be added via mcp — can direct parameter addition be added later? Maybe via SAPWrite update?" Live curl probing of a4h S/4HANA 2023 + NPL 7.50 SP02 settled the question that fr0ster's diagnostic probe (commit `3a3fa65`) was investigating: **FM parameters do NOT live in a separate metadata document. They live INLINE in `/source/main` as ABAP source-based signature syntax** (`IMPORTING VALUE(name) TYPE type [DEFAULT x] [OPTIONAL]`). Every standard FM (BAPI_USER_GETLIST, POPUP_TO_CONFIRM, STFC_CONNECTION, RFC_PING, ...) ships its parameters this way. PUTting an `<fmodule:parameter>` element to the root metadata endpoint silently no-ops (verified — XML element is accepted with HTTP 200, but a fresh GET shows no change). PUTting `*"IMPORTING"*` SAPGUI-comment-block syntax is rejected with HTTP 400 / `FUNC_ADT028 "Parameter comment blocks are not allowed"`.

The original "parameter loss" symptom fr0ster observed had a different cause than they suspected: `UpdateFunctionModule` lost parameters because the LLM-supplied source body omitted the IMPORTING/EXPORTING block (read returned just the source body, LLM rewrote it without preserving the signature lines, the PUT stripped them). The fix is structural, not metadata-endpoint based.

ARC-1 [PR #253](https://github.com/marianfoo/arc-1/pull/253) (issue [#252](https://github.com/marianfoo/arc-1/issues/252)) ships:

- `src/adt/fm-signature.ts` — pure-function `buildFmSignatureClause` / `parseFmSignature` / `spliceFmSignature` (~25 unit tests, including round-trip property test against real BAPI_USER_GETLIST + POPUP_TO_CONFIRM source bodies).
- `SAPWrite(type='FUNC', parameters=[{kind, name, type, byValue?, default?, optional?}, …])` — array-to-source generator. Splices the signature into the user's body before PUT. Backward-compat: omitting `parameters` runs the existing source-only path unchanged.
- `SAPRead(type='FUNC', includeSignature=true)` — parses the source and returns `{source, signature: {importing[], exporting[], changing[], tables[], exceptions[], raising[]}}` so an LLM can introspect a signature without re-parsing ABAP.
- Cross-release portability: verified live on a4h S/4HANA 2023 (write+read full lifecycle) + NPL 7.50 SP02 (read-only, six standard FMs). Both systems use the source-based form with no `*"` blocks.
- ARC-1's tool description for SAPWrite drops the "FM parameter signatures NOT managed" warning. The strip-and-warn for `*"` blocks remains as defense-in-depth.

Side fix: removed `FUNC` from `runPreWriteLint`'s `LINTABLE_TYPES`. abaplint's FM-source parser doesn't understand source-based signatures and emits a structural `parser_error` that would block every signature-bearing PUT. Pre-#252 lint coverage for FUNC was effectively trivial (only signature-less stubs passed). Validation falls back to SAP's server-side syntax check (opt-in via `SAP_CHECK_BEFORE_WRITE`) and the activate step.
