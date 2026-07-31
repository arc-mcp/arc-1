# Fix: propagate `corrNr` to the class-include init POST (issue #645)

> **Completed 2026-07-31.** Execution notes / deviations:
> - `npm run build` failed as anticipated on the pre-existing `@arc-mcp/xsuaa-auth` type drift, and
>   the worktree's `node_modules` additionally could not *load* `dist/server/destination-discovery.js`
>   (missing `DestinationServiceRequestError` export). Worked around by compiling with bare `tsc`
>   (which emits despite type errors) and running the CLI from a throwaway copy of the main
>   checkout's working `dist/` with only `adt/crud.js` swapped in. Removed afterwards.
> - The "read the include back with `SAPRead version=inactive`" step was covered by the stronger
>   `SAPActivate` check: the class carries a `FOR TESTING` method in the include, so a successful
>   activation proves the include content landed and compiled.
> - Pre-existing red on this branch, unrelated to this change and unchanged by it: 2 unit failures
>   (`tests/unit/lint/config-builder.test.ts`, `tests/unit/lint/lint-enhanced.test.ts` — both
>   "Cloud version for BTP"), 18 `typecheck` errors in `src/server/*`, and 3 biome format errors in
>   `tests/unit/handlers/`. All confirmed present on a clean tree with this change stashed.

## Overview

`SAPWrite(action="update", type="CLAS", include="testclasses", …)` fails with HTTP 500
`Object LIMU CINC <CLASS>==========CCAU is already locked in request <REQ> of user <USER>` whenever
the class lives in a **transportable package** and is already recorded in a CTS request. Creating
the test include creates a new `LIMU CINC …CCAU` TADIR sub-object, which CTS must record in a
request; ARC-1's init POST sends only `lockHandle`, so CTS has no target request and reports the
sub-object as already locked by the covering `R3TR CLAS` entry instead of reusing it.

The fix is one line at one call site: `initClassInclude` must append `&corrNr=<transport>` the way
`createObject` / `updateSource` / `updateObject` / `deleteObject` already do. The enclosing
`safeUpdateClassInclude` **already** resolves `effectiveTransport = transport ?? lock.corrNr` and
passes it to the follow-up source PUT — the init POST between them is the only place that drops it.

This is deliberately a 3-task plan rather than the usual 5–12. The source change is a single
parameter; padding it into more tasks would add ceremony, not safety. The risk here is not
implementation complexity, it is *SAP truth*, and that has been retired up front by live
verification on all three releases (see Verified Live Evidence).

- Success: `include="testclasses"` succeeds on a class in a transportable package, on 7.50/758/816.
- Success: `$TMP` behavior is byte-identical to today (lock returns empty `CORRNR` → no `corrNr`).
- Non-goal: no tool-schema change, no new config, no error-hint rework (see Development Approach).

## Context

### Current State

- `initClassInclude()` in `src/adt/crud.ts` builds
  `` `${includeUrl}?lockHandle=${encodeURIComponent(lockHandle)}` `` and takes no transport
  parameter at all.
- `safeUpdateClassInclude()` in the same file computes
  `const effectiveTransport = transport ?? (lock.corrNr || undefined);`, calls
  `initClassInclude(session, safety, includeUrl, lock.lockHandle)` **without** it, then calls
  `updateSource(…, effectiveTransport)` **with** it.
- All three call sites already thread `transport` into `safeUpdateClassInclude`:
  `src/handlers/write/update-delete.ts` (the `args.include !== undefined` branch),
  `src/handlers/write/class-surgery.ts` (the `resolvedInclude` branch and the `include` ternary).
- `initClassInclude` is the only lock-scoped write in the codebase that omits `corrNr`.
- Existing unit coverage lives in `describe('safeUpdateClassInclude — auto-init missing class
  includes')` in `tests/unit/adt/crud.test.ts`. Its `mockHttpWithSession()` helper returns a
  `LOCK_BODY` const with an **empty** `<CORRNR></CORRNR>` — i.e. every existing test exercises only
  the `$TMP`-shaped path, which is exactly why this shipped.

### Target State

- `initClassInclude(http, safety, includeUrl, lockHandle, transport?)` appends
  `&corrNr=<encoded>` when `transport` is set, and is otherwise unchanged.
- `safeUpdateClassInclude` passes `effectiveTransport` to it.
- Unit tests cover: transport passed explicitly, transport derived from the lock's `CORRNR`, and no
  transport (`$TMP`) → URL unchanged.
- Live-verified on 7.50 and 816 (oldest + newest) with a real transportable package and request.

### Key Files

| File | Role |
|------|------|
| `src/adt/crud.ts` | `initClassInclude` (the defect) and `safeUpdateClassInclude` (the caller that already has the value) |
| `tests/unit/adt/crud.test.ts` | `describe('safeUpdateClassInclude — auto-init missing class includes')` + the `mockHttpWithSession` / `LOCK_BODY` helpers |
| `docs/research/issues/645-class-include-create-missing-corrnr.md` | The validated issue dossier this plan implements |

### Verified Live Evidence

Captured 2026-07-31 by raw ADT calls (stateful session, real response bodies) plus one end-to-end
run through the shipped `arc1-cli`. Full detail and commands in the dossier
`docs/research/issues/645-class-include-create-missing-corrnr.md`.

| Scenario | 7.50 (npl) | 758 (a4h) | 816 (a4h-2025) |
|---|---|---|---|
| Transportable pkg, class in own request — `POST …/includes/testclasses?lockHandle=…` | **500** | **500** | **500** |
| Same + `&corrNr=<REQ>` | **201** | **201** | **201** |
| `$TMP` class — `?lockHandle=…` (lock `CORRNR` empty) | **201** | — | — |
| `$TMP` class + a *bogus* `corrNr` (regression probe) | **201** (SAP ignores it) | — | — |
| Skip the init POST: PUT source straight to a missing include, with `lockHandle`+`corrNr` | **500** `…CCAU does not have any inactive version` | — | — |
| Fresh class, GET each include | — | — | `definitions`/`implementations`/`macros` **200**, `testclasses` **404** |

The 500 body is identical across releases:
`Object LIMU CINC <CLASS>=================CCAU is already locked in request <REQ> of user <USER>`
(`<type id="ExceptionResourceCreationFailure"/>`).

End-to-end through ARC-1 on npl 7.50, showing the wire URL carries `lockHandle` only:

    POST /sap/bc/adt/oo/classes/ZCL_ARC1_645C/includes/testclasses?lockHandle=Nn1kQ… 500
    AdtApiError: Object LIMU CINC ZCL_ARC1_645C=================CCAU is already locked in
    request NPLK900085 of user DEVELOPER

### Design Principles

1. **Mirror the existing shape.** `deleteObject` in the same file already does exactly
   `` let url = `${objectUrl}?lockHandle=…`; if (transport) url += `&corrNr=…`; `` — copy that, do
   not invent a params-array refactor.
2. **`transport` is optional and last.** Adding it as a trailing optional parameter keeps every
   existing caller and test compiling.
3. **Release-invariant.** The defect and the fix behave identically on 7.50, 758 and 816 (table
   above), so no release gate, no `abapRelease` plumbing, no feature probe.
4. **`$TMP` must not change.** With no transport the emitted URL must be byte-identical to today's.
   A test must pin this.
5. **No tool-surface change.** `transport` is already an accepted `SAPWrite` parameter and already
   reaches `safeUpdateClassInclude` from all three call sites. No `tools.ts` / `schemas.ts` edits,
   no tool-definition fixture regeneration.
6. **The init POST stays.** Deleting it was tested and ruled out live — a plain PUT to a missing
   include 500s with "does not have any inactive version" even with a valid `corrNr`.

## Development Approach

TDD, red→green: write the failing URL assertions first, then the one-line change.

**Test strategy.** The bug's whole cause is that the existing tests only ever saw an empty
`CORRNR`. So the new coverage must include a lock body that *has* one — extend
`mockHttpWithSession()` with an optional `corrNr` and keep the default `''` so existing tests are
untouched. Three cases matter, and the negative one is the important one:

- explicit `transport` argument → `corrNr` present on the init POST
- no `transport` argument, lock returns `CORRNR` → `corrNr` present, taken from the lock
- no `transport`, lock `CORRNR` empty (`$TMP`) → **no** `corrNr` on the URL (the regression guard)

Also update the existing `initClassInclude POSTs an empty body …` test — it pins the exact URL
string with `toBe()`, so it must keep asserting the no-transport URL exactly and gain a
with-transport sibling.

**Fixture provenance.** No new XML fixtures — the ADT responses here are bare 201/500 with no body
worth capturing. The 500 bodies are quoted in the dossier for the record.

**Scope declarations.**
- The misleading 500 hint in `src/handlers/dispatch.ts` ("often transient — wait 10-30 seconds and
  retry") is **out of scope**; it is still wrong when a class is legitimately locked in another
  user's request. Follow-up, not this PR.
- The secondary observation in the dossier (double-init POST returning
  `500 … could not be successfully created`) is unreachable through ARC-1's flow — do not chase it,
  but do not reorder probe/create in a way that would make it reachable.
- `npm run build` currently fails on this branch with **pre-existing** TS errors in
  `src/server/multi-target-destination-runtime.ts` and `src/server/server.ts` (`@arc-mcp/xsuaa-auth`
  type drift), unrelated to this change. `npm run typecheck` is the gate that matters here; if
  `build` fails only with those errors, that is not a regression from this plan.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Propagate the transport to `initClassInclude` and pin it with tests

**Files:**
- Modify: `src/adt/crud.ts` (`initClassInclude`, `safeUpdateClassInclude`)
- Modify: `tests/unit/adt/crud.test.ts` (`mockHttpWithSession`, `LOCK_BODY`, `describe('safeUpdateClassInclude — auto-init missing class includes')`)

Creating a class's `testclasses` include creates a new `LIMU CINC …CCAU` TADIR sub-object that CTS
must record in a transport request. `initClassInclude` sends only `lockHandle`, so on a
transportable package SAP raises `500 Object LIMU CINC …CCAU is already locked in request <REQ> of
user <USER>` instead of reusing the covering `R3TR CLAS` lock. Live-verified on 7.50/758/816; adding
`corrNr` returns 201 on all three. Mirror `deleteObject()` in the same file — it already builds
exactly this URL shape.

- [x] In `src/adt/crud.ts`, add a trailing optional `transport?: string` parameter to
      `initClassInclude()` and append the request when set. Keep the existing
      `checkOperation(safety, OperationType.Create, 'InitClassInclude')` guard as the first
      statement. Target shape (mirrors `deleteObject`):

      let url = `${includeUrl}?lockHandle=${encodeURIComponent(lockHandle)}`;
      if (transport) {
        url += `&corrNr=${encodeURIComponent(transport)}`;
      }
      await http.post(url, '', undefined);

- [x] In `safeUpdateClassInclude()` in the same file, pass the already-computed
      `effectiveTransport` (i.e. `transport ?? (lock.corrNr || undefined)`) as the new fifth
      argument to `initClassInclude`. Do not recompute it and do not reorder the
      probe → init → PUT sequence.
- [x] Update the doc comment above `initClassInclude`. It currently says the empty-POST mechanism is
      "Live-verified (a4h S/4HANA 2023)" without qualification — that verification was done in
      `$TMP`. State that a transportable package additionally requires `corrNr`, or SAP 500s with
      "already locked in request" (issue #645).
- [x] In `tests/unit/adt/crud.test.ts`, give `mockHttpWithSession()` an optional `corrNr` in its
      `opts` (default `''`) and build the lock body from it, so the helper can emulate a class
      recorded in a request. Keep `LOCK_BODY` and the existing default behavior intact so the four
      existing tests in this `describe` block are unaffected.
- [x] Add unit tests (~3) to `describe('safeUpdateClassInclude — auto-init missing class includes')`:
      (a) include missing + explicit `transport` argument → the init POST URL contains
      `corrNr=<that transport>`; (b) include missing + no `transport` argument but lock returns
      `corrNr: 'NPLK900085'` → the init POST URL contains `corrNr=NPLK900085`; (c) **negative /
      regression guard** — include missing, no `transport`, lock `CORRNR` empty (`$TMP`) → the init
      POST URL is exactly `` `${INCLUDE_URL}?lockHandle=SESS_HANDLE` `` with **no** `corrNr`
      substring.
- [x] Update the existing `it('initClassInclude POSTs an empty body to the include URL with the
      lock handle')` test: it asserts the full URL with `toBe()`, so keep that as the no-transport
      case and add a with-transport assertion
      (`` `${INCLUDE_URL}?lockHandle=LH99&corrNr=NPLK900085` ``).
- [x] Verify the `initClassInclude is gated by allowWrites` test still passes — the safety check
      must remain the first statement, before any URL building.
- [x] Run `npm test` — all tests must pass.
- [x] Run `npm run typecheck` and `npm run lint` — no errors. (`npm run build` may fail with the
      pre-existing `multi-target-destination-runtime.ts` / `server.ts` errors described in
      Development Approach; that is not caused by this task.)

### Task 2: Live verification on a transportable package (7.50 + 816)

**Files:**
- Verify: `src/adt/crud.ts` (no edits expected)

The unit tests pin the URL string, not SAP's acceptance of it. This task proves end-to-end that
SAP accepts the fixed request, on the oldest and newest systems, using the reporter's exact
scenario. After Task 1 the init POST should go out as
`POST …/oo/classes/<CLS>/includes/testclasses?lockHandle=<LH>&corrNr=<REQ>`.

No automated integration test is added: reproducing this needs a **transportable** package plus a
freshly created workbench request, which the `tests/integration` CRUD harness does not set up (it
works in `$TMP`-shaped flows, exactly the blind spot that let this ship). Manual live verification
here is the honest coverage; note that gap in the PR body.

Credentials and hosts are in `INFRASTRUCTURE.md`. **Requires live SAP access — if a system is
unreachable, follow the INFRASTRUCTURE.md runbook (Docker stop/start, Cloud Connector) before
concluding failure.**

- [x] Build the CLI (`npm run build`). If it fails **only** with the pre-existing
      `src/server/multi-target-destination-runtime.ts` / `src/server/server.ts` type errors noted in
      Development Approach, use the main checkout's prebuilt `dist/` at
      `/Users/marianzeis/DEV/arc-1/dist/cli.js` instead and say so in the notes.
- [x] On **npl (7.50)**, client `001`, user `DEVELOPER`: pick a transportable Z package (e.g.
      `ZDEMO_BOPF` — confirmed transportable) and create a workbench request for it (ADT:
      `POST /sap/bc/adt/cts/transports` with a `CreateCorrectionRequest` body naming that package,
      or `SAPTransport action=create` with `SAP_ALLOW_TRANSPORT_WRITES=true`). Then run the
      reporter's two steps. Environment for the CLI:

      SAP_URL=https://npl.marianzeis.de SAP_CLIENT=001 SAP_USER=DEVELOPER SAP_PASSWORD=<see INFRASTRUCTURE.md>
      SAP_INSECURE=true SAP_ALLOW_WRITES=true SAP_ALLOWED_PACKAGES=<PKG> SAP_LINT_BEFORE_WRITE=false

      node dist/cli.js call SAPWrite --json '{"action":"create","type":"CLAS","name":"<CLS>","package":"<PKG>","description":"issue 645","transport":"<TR>","activate":false}'
      node dist/cli.js call SAPWrite --json '{"action":"update","type":"CLAS","name":"<CLS>","include":"testclasses","transport":"<TR>","activate":false,"source":"CLASS ltc_t DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.\nENDCLASS.\nCLASS ltc_t IMPLEMENTATION.\nENDCLASS."}'

      Step 2 must now succeed. Confirm in the `[http_request]` log line that the POST URL carries
      **both** `lockHandle` and `corrNr`.
- [x] Repeat step 2 with the `transport` field **omitted** — it must still succeed, because
      `effectiveTransport` falls back to the lock's `CORRNR`. This is the reporter's step 3.
- [x] Read the include back (`SAPRead` with `version="inactive"`) and confirm the ABAP source landed.
- [x] **Activate** the class (`SAPActivate`) — activation is the definitive correctness check for a
      write feature, and it proves the include was recorded in the request properly.
- [x] Regression check on the same system: repeat the whole flow with a **`$TMP`** class and no
      transport. It must still succeed, and the init POST URL must carry `lockHandle` only.
- [x] Repeat the transportable-package flow on **a4h-2025 (816)**, client `001`, user `MARIAN`.
      Note: `ZCUSTOM_DEVELOPMENT` and `ZCLASSIC_DEVELOPMENT` are **structure packages** there and
      reject object creation with 403 "Structure packages cannot contain development objects" — use
      `Z_BADI_CHECK` or another leaf package.
- [x] Delete every class created during this task (lock → DELETE with `lockHandle`+`corrNr`) so the
      systems are left clean. Do not commit any throwaway scripts.
- [x] Record the observed results (system, release, HTTP status per step) in the plan notes or the
      PR body.

### Task 3: Final verification

- [x] Run full test suite: `npm test` — all tests pass
- [x] Run typecheck: `npm run typecheck` — no errors
- [x] Run lint: `npm run lint` — no errors
- [x] `grep -rn "initClassInclude" src/ tests/` — every call site passes a transport argument or is
      a deliberate no-transport test case; no caller left on the old 4-argument signature
- [x] Confirm no tool-definition fixture changed:
      `git status tests/fixtures/tool-definitions/` is clean (this change must not touch the
      LLM-visible surface)
- [x] Update `docs/research/issues/645-class-include-create-missing-corrnr.md`: flip Status to
      "Fixed" and add the PR link
- [x] Move this plan to `docs/plans/completed/`, then fix any relative links inside it (completed
      plans sit one directory deeper — `../` paths gain a level)
