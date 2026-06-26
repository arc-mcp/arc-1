# Issue #293 — 423 "invalid lock handle" on ECC / NW < 7.51 (VALIDATED)

**Status:** Root cause confirmed and fix validated live (2026-05-29).
**Symptom:** Every ADT write (PROG/CLAS/INTF/DDIC/…) fails with
`status 423 … Resource … is not locked (invalid lock handle: …)` /
`type id="ExceptionResourceInvalidLockHandle"`. Reads work. S/4HANA works; ECC / NW 7.4x–7.50 fails.

## TL;DR

- The fix is **NOT SAP Note 2727890**. That note is a narrow bug for lock handles containing `+`
  characters. Reporter `@acmebcn` has it applied on SAP_BASIS 7.40 SP33 and still fails; the NPL
  handles we reproduced with had no `+`.
- **Real root cause:** on **SAP_BASIS < 7.51** the ADT REST handler `CL_REST_HTTP_HANDLER` does not
  honor the `X-sap-adt-sessiontype: stateful` HTTP header. The LOCK succeeds, but the session
  reverts to stateless, the ENQUEUE lock is released, and the next PUT is rejected as 423. The 7.51+
  mechanism that honors the header (`CONFIGURE_SESSION_STATE` in `CL_ADT_WB_RES_APP`) does not exist
  on older releases. Eclipse is unaffected because it uses RFC, which is stateful by default.
- **Fix:** install the [`abapfs_extensions`](https://github.com/marcellourbani/abapfs_extensions)
  enhancement on the SAP system (one implicit enhancement on `CL_REST_HTTP_HANDLER` that back-ports
  the header read). ARC-1 is doing the right thing on the wire; the gap is server-side.

## Live validation (2026-05-29)

| Test on NPL (NW 7.50 SP02) | Before | After installing `ZABAPFILESYSTEM_SESSION` |
|---|---|---|
| Raw lock→PUT (PROG/CLAS, correct handle, correct CSRF, no rotation) | 423 | **200** |
| ARC-1 `SAPWrite update` (product path) | 423 | **"Successfully updated"** (bytes verified on server) |

- Reproduced deterministically (6/6) before the fix; not transient.
- Direct-to-ICM (via SSH tunnel, bypassing nginx) failed identically to via-nginx → nginx is not the cause.
- a4h (S/4HANA 2023, kernel 7.58) works on both HTTP and RFC — it has the native 7.51 mechanism.

## The three independent causes of this 423 (don't conflate)

Researched across sibling ADT clients (abap-adt-api, vscode_abap_remote_fs, erpl-adt,
vibing-steampunk, fr0ster):

1. **(a) Server ignores the stateful header on < 7.51** — *this issue*. Fix: server-side
   `abapfs_extensions` (or, where allowed, a lockless "optimistic" write — but that does **not** work
   on NPL, which rejects a no-handle PUT with `400 Parameter lockHandle could not be found`).
2. **(b) Client omits the stateful flag on a write leaf** (vibing-steampunk #98; hit even on 758 in
   #110). **ARC-1 is immune** — it sets `X-sap-adt-sessiontype: stateful` at the *session-client*
   level (`src/adt/http.ts`), so every in-session request carries it. Pinned by a regression test in
   `tests/unit/adt/http.test.ts`.
3. **(c) A stateless hop between LOCK and PUT** retires the session (vibing-steampunk #125).
   **ARC-1 is immune** — `checkPackage` and pre-write lint run *before* the lock cycle; lock→PUT→unlock
   is a single `withStatefulSession` with nothing interleaved.

## What ARC-1 changed for this (PR for #293)

- **Release-aware 423 hint** (`src/adt/errors.ts` `classifySapDomainError`): on a detected < 7.51
  system the hint leads with `abapfs_extensions`; on ≥ 7.51 it gives transient/SM12 guidance; when the
  release is unknown it offers both. Note 2727890 is demoted to a "separate narrow bug" mention.
- **Startup warning** (`src/server/server.ts`): when `allowWrites` is on and the detected release is
  < 7.51, log a one-line warning pointing at `abapfs_extensions`.
- **Troubleshooting docs** (`docs_page/sap-trial-setup.md`, `docs_page/tools.md`): symptom, root cause,
  and both install paths (abapGit import + manual SE24 enhancement recipe).
- **Doc cleanup** (`docs/integration-test-skips.md`): `abapfs_extensions` is the primary fix; Note
  2727890 kept only as a secondary mention.

## Out of scope (separate follow-ups)

- abap-adt-api#42 — verify `SAPQuery` (`/datapreview/freestyle`) sends `Content-Type: text/plain` for `LIKE '%'`.
- vscode_abap_remote_fs#293 — guard `fast-xml-parser` against non-XML 4xx/5xx bodies (BASIS 731 `mainprograms` 500).
- vibing-steampunk#114 — `/system/components` 406 on kernel 758 release detection (has a fallback today).

---

## Drafted comment for GitHub issue #293

```markdown
Update — we reproduced this on a NW 7.50 system and **validated the actual fix**. Correcting my earlier reply: **SAP Note 2727890 is not the fix.**

**Root cause.** On SAP_BASIS < 7.51, the ADT REST handler `CL_REST_HTTP_HANDLER` does not honor the `X-sap-adt-sessiontype: stateful` header over HTTP. ARC-1 sends it correctly, but the server ignores it on older releases, so the LOCK is released before the PUT and you get `423 invalid lock handle`. The mechanism that honors the header (`CONFIGURE_SESSION_STATE` in `CL_ADT_WB_RES_APP`) only exists from 7.51 — which is why S/4HANA works and ECC/7.4x–7.50 doesn't, and why Eclipse (RFC, stateful by default) works while HTTP clients don't. Note 2727890 is a *separate, narrow* bug (lock handles containing `+`); @acmebcn confirmed it's applied on 7.40 SP33 and still fails — consistent with this.

**Fix (server-side, ~2 minutes).** Install the `abapfs_extensions` enhancement — it back-ports the 7.51 stateful-session handling to `CL_REST_HTTP_HANDLER`. No ICM restart; safe no-op on ≥ 7.51.

- **abapGit:** import https://github.com/marcellourbani/abapfs_extensions into your dev system and activate.
- **No abapGit (manual, SE24):** on `CL_REST_HTTP_HANDLER` → method `IF_HTTP_EXTENSION~HANDLE_REQUEST`, click *Enhance*, show implicit enhancement options, and at the **start of the method** create an implicit enhancement implementation `ZABAPFILESYSTEM_SESSION` containing:

  ```abap
  DATA: __abapfs_stateful TYPE string.
  __abapfs_stateful = server->request->get_header_field( 'X-sap-adt-sessiontype' ).
  IF __abapfs_stateful = 'stateful'.
    gv_stateful = abap_true.
  ELSEIF __abapfs_stateful = 'stateless'.
    gv_stateful = abap_false.
  ENDIF.
  ```

  Assign to `$TMP` (or a transport) and activate. Retry your write — it should succeed.

We validated this end-to-end on NW 7.50: the identical write that returned 423 returns 200 once the enhancement is active.

The next ARC-1 release makes this self-explanatory: the 423 hint now points at `abapfs_extensions` when it detects SAP_BASIS < 7.51, and ARC-1 logs a startup warning if writes are enabled on such a system. Thanks @abappdpatel and @acmebcn for the reports and the SP detail that pinned it down.
```
