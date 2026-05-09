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
