# Issue #645 — `initClassInclude` POST omits `corrNr` → 500 "already locked in request" (FIXED)

**Status:** **Fixed** — see the branch `claude/deep-issue-645-f616de`. Root cause validated live
2026-07-31 on **all three** test systems (**NW 7.50**, **S/4HANA 2023 (758)**, **ABAP Platform 2025
(816)**), fix re-verified end-to-end on 7.50 and 816 including activation. Reporter's diagnosis is
correct; their *scope* is not.
**Symptom:** `SAPWrite(action="update", type="CLAS", include="testclasses", …)` fails with
`HTTP 500 … Object LIMU CINC <CLASS>==========CCAU is already locked in request <REQ> of user <USER>`
whenever the class lives in a **transportable package** and is already recorded in a CTS request.

## TL;DR

- **Real and reproducible.** Confirmed end-to-end through ARC-1's own CLI, byte-identical to the
  report.
- **Root cause is exactly what the reporter says:** [`initClassInclude`](src/adt/crud.ts:264) builds
  `POST …/includes/{include}?lockHandle=<LH>` and **never appends `corrNr`**, even though the
  enclosing [`safeUpdateClassInclude`](src/adt/crud.ts:296) has already resolved
  `effectiveTransport = transport ?? lock.corrNr` and correctly passes it to the follow-up
  `updateSource` PUT. One-line omission at a single call site.
- **The reporter's scope is wrong, and this matters.** It is **not** a 7.40/"older NetWeaver"
  problem. It reproduces identically on **758 (S/4HANA 2023)** and **816 (ABAP Platform 2025)**. The
  real trigger is **transportable package + covering CTS lock**. Every release is affected; nobody
  noticed because the original live verification of this code path was done in `$TMP`, where the
  lock returns an empty `CORRNR` and no CTS record is needed.
- **Fix validated live:** adding `corrNr=<REQ>` to the same POST returns **201** on 7.50, 758 and
  816; the include is created, and the subsequent source PUT + read-back succeed.
- **The init POST is genuinely required — the lazier "just delete it" fix is ruled out.** Verified
  live on 7.50: a plain PUT to a non-existent `testclasses` include, *with* `lockHandle` **and**
  `corrNr`, still fails `500 … ZCL_ARC1_645P=…CCAU does not have any inactive version`. The
  probe→init→PUT design stands; only the missing `corrNr` is wrong.
- **Blast radius is exactly CCAU.** On a fresh class, `definitions`/`implementations`/`macros`
  already exist (GET 200) — only `testclasses` is 404 — so `initClassInclude` only ever fires for
  the test include. Verified on 816.
- **No regression risk:** on `$TMP` the lock returns an empty `CORRNR`, so `effectiveTransport` is
  `undefined` and the URL is byte-identical to today's. Even a *bogus* `corrNr` on a `$TMP` object
  returns 201 (SAP ignores it) — verified.
- Not an SAP defect; no SAP Note applies. SAP's CTS check is behaving correctly — ADT's
  include-creation handler asks CTS to record `LIMU CINC …CCAU` and, given no target request, CTS
  refuses rather than inferring the covering `R3TR CLAS` lock. Eclipse works because it sends
  `corrNr`.

## Live validation (2026-07-31)

Raw ADT calls (curl, stateful session, real response bodies captured) plus one end-to-end run
through the shipped `arc1-cli`.

| Test | System | POST `…/includes/testclasses` | Result |
|---|---|---|---|
| Class in transportable pkg, recorded in own request — **no `corrNr`** (ARC-1 HEAD) | npl **7.50** | `?lockHandle=…` | **500** `ExceptionResourceCreationFailure` — *"Object LIMU CINC ZCL_ARC1_645A=…CCAU is already locked in request NPLK900085 of user DEVELOPER"* |
| Same — **with `corrNr`** | npl **7.50** | `?lockHandle=…&corrNr=NPLK900085` | **201** → PUT source 200 → read-back OK |
| Same — **no `corrNr`** | a4h **758** | `?lockHandle=…` | **500**, same message (`…is already locked in request A4HK906359 of user MARIAN`) |
| Same — **with `corrNr`** | a4h **758** | `?lockHandle=…&corrNr=A4HK906359` | **201** → PUT source 200 → read-back OK |
| Same — **no `corrNr`** | a4h-2025 **816** | `?lockHandle=…` | **500**, same message (`…is already locked in request A4HK904954 of user MARIAN`) |
| Same — **with `corrNr`** | a4h-2025 **816** | `?lockHandle=…&corrNr=A4HK904954` | **201** |
| Class in **`$TMP`** — no `corrNr` (lock returns empty `CORRNR`) | npl **7.50** | `?lockHandle=…` | **201** — unaffected today, unaffected by the fix |
| **`$TMP`** object with a bogus `corrNr` (regression probe) | npl **7.50** | `?lockHandle=…&corrNr=NPLK900085` | **201** — SAP ignores it |
| **Skip the init POST entirely** — PUT source straight to a missing include, with `lockHandle`+`corrNr` | npl **7.50** | *(PUT, no POST)* | **500** `…CCAU does not have any inactive version` — init POST is required |
| Fresh class, probe all four includes | a4h-2025 **816** | *(GET)* | `definitions`/`implementations`/`macros` **200**, `testclasses` **404** — only CCAU is ever init'd |

End-to-end through ARC-1 (`dist/cli.js`, npl 7.50, `SAP_ALLOWED_PACKAGES=ZDEMO_BOPF`):

```
1. SAPWrite create CLAS ZCL_ARC1_645C, package=ZDEMO_BOPF, transport=NPLK900085 → success
2. SAPWrite update CLAS ZCL_ARC1_645C, include=testclasses, transport=NPLK900085 →
   [http_request] POST /sap/bc/adt/oo/classes/ZCL_ARC1_645C/includes/testclasses?lockHandle=Nn1kQ… 500
   AdtApiError: Object LIMU CINC ZCL_ARC1_645C=================CCAU is already locked in
   request NPLK900085 of user DEVELOPER
```

Note the wire URL: **`lockHandle` only** — confirming the reporter's audit-log finding that
`transport` never reaches the POST.

All test objects (`ZCL_ARC1_645A/C/T/X` on npl, `ZCL_ARC1_645A` on a4h) were deleted after the run.
Empty scratch requests `NPLK900085` / `A4HK906359` remain.

## Root cause

`safeUpdateClassInclude` resolves the transport correctly and uses it for the content PUT, but the
init POST between them drops it:

```ts
// src/adt/crud.ts:296 — resolves it …
const effectiveTransport = transport ?? (lock.corrNr || undefined);
…
if (!exists) {
  await initClassInclude(session, safety, includeUrl, lock.lockHandle);   // ← effectiveTransport not passed
}
await updateSource(session, safety, includeUrl, source, lock.lockHandle, effectiveTransport);  // ← used here

// src/adt/crud.ts:264 — the omission
const url = `${includeUrl}?lockHandle=${encodeURIComponent(lockHandle)}`;
```

Creating the `testclasses` include creates a **new TADIR sub-object** (`LIMU CINC …CCAU`), which CTS
must record in a request. With no `corrNr` the ADT handler cannot name a target request; CTS finds
the sub-object already covered by the `R3TR CLAS` lock in the user's own request and raises
"already locked" instead of reusing it. In `$TMP` there is no CTS record at all, so the POST
succeeds — which is why the code path's original live verification (documented in the
`initClassInclude` doc comment as "live-verified on a4h S/4HANA 2023") passed and this stayed hidden.

`initClassInclude` is the **only** lock-scoped write in the codebase that omits `corrNr` —
`createObject` (crud.ts:104), `updateSource` (crud.ts:152), `updateObject` (crud.ts:176) and
`deleteObject` (crud.ts:206) all handle it. The FUGR structural-include create goes through
`createObject`, so it is not affected.

### Secondary observation (not a reachable bug)

Immediately after a successful init POST, a `GET …/includes/testclasses` *inside the same stateful
session* returns 404 (only the inactive version exists yet); outside the session it returns 200. A
second init POST on an existing include returns
`500 … CLASS_INCLUDE …/TESTCLASSES could not be successfully created` (subType
`TestclassGeneration`). ARC-1's flow never hits this — it probes before creating, in a fresh session
per tool call — but a fix must not reorder probe/create in a way that would.

## Affected files (for the fix)

| File | Change |
|---|---|
| `src/adt/crud.ts` | `initClassInclude`: add optional `transport` param, append `&corrNr=…` when set (mirror `deleteObject`); `safeUpdateClassInclude`: pass `effectiveTransport`. Update the doc comment — the "live-verified" note must say `$TMP`-only and record the transportable-package requirement |
| `tests/unit/adt/crud.test.ts` | Extend the `safeUpdateClassInclude — auto-init missing class includes` block (line ~926): assert the init POST URL carries `corrNr` when a transport is supplied *and* when it comes from the lock's `CORRNR`, and carries none for `$TMP` |
| `tests/unit/handlers/write-surgery-rap.test.ts` | Check whether the class-surgery callers' expectations need the same assertion |

No tool-surface change → no `tools.ts`/`schemas.ts` edits, no tool-definition fixture regeneration.
`transport` is already accepted and already threaded to `safeUpdateClassInclude` from all three call
sites (`write/update-delete.ts:94`, `write/class-surgery.ts:154`, `write/class-surgery.ts:271`).

## Out of scope

- The 500 error hint (`dispatch.ts`) currently advises *"often transient — wait 10-30 seconds and
  retry"* for this error, which is actively misleading here. Worth a targeted hint keyed on the
  "is already locked in request" message, but as a separate change.
- The secondary double-init 500 described above — unreachable today; note it, don't chase it.
- `npm run build` on this branch fails with pre-existing TS errors in
  `src/server/multi-target-destination-runtime.ts` and `src/server/server.ts` (`@arc-mcp/xsuaa-auth`
  type drift), unrelated to this issue. Live validation used the main repo's prebuilt `dist/`.

## Fix as shipped

`initClassInclude` gained a trailing optional `transport?: string` and appends
`&corrNr=<encoded>` when set (mirroring `deleteObject`); `safeUpdateClassInclude` passes the
`effectiveTransport` it already computes. Three unit tests in
`describe('safeUpdateClassInclude — auto-init missing class includes')` pin the explicit-transport,
lock-derived-transport, and `$TMP`-unchanged-URL cases; the first two fail without the fix.

Re-verified live 2026-07-31 through `arc1-cli` after the change:

| Step | 7.50 (npl) | 816 (a4h-2025) |
|---|---|---|
| `create` CLAS in transportable pkg with `transport` | ✅ | ✅ |
| `update … include="testclasses"` **with** `transport` (was 500) | ✅ | ✅ |
| Same with `transport` **omitted** (lock `CORRNR` fallback — reporter step 3) | ✅ | — |
| `SAPActivate` the class | ✅ | ✅ |
| `$TMP` class, no transport anywhere (regression) | ✅ | — |

All test objects deleted afterwards; both systems left clean.

## Drafted comment for GitHub issue #645

```markdown
Confirmed — thanks for the unusually precise report. Your diagnosis is exactly right, and the
audit-log observation ("the POST goes out without `corrNr` regardless of whether `transport` is
passed") is what made this quick to pin down.

**Reproduced live**, end-to-end through ARC-1's own CLI, byte-identical to your error:

```
POST /sap/bc/adt/oo/classes/ZCL_ARC1_645C/includes/testclasses?lockHandle=Nn1kQ… 500
Object LIMU CINC ZCL_ARC1_645C=================CCAU is already locked in
request NPLK900085 of user DEVELOPER
```

**Root cause** — `initClassInclude` (`src/adt/crud.ts:264`) builds the include-creation POST with
only `lockHandle`. The enclosing `safeUpdateClassInclude` already resolves
`effectiveTransport = transport ?? lock.corrNr` and correctly passes it to the follow-up source PUT
— the init POST between them is the one place that drops it. It's the only lock-scoped write in the
codebase that does; `createObject`, `updateSource`, `updateObject` and `deleteObject` all handle
`corrNr`.

Creating the `testclasses` include creates a new `LIMU CINC …CCAU` TADIR sub-object, which CTS has
to record in a request. Without a `corrNr` the handler can't name a target, so CTS reports the
sub-object as already locked by the covering `R3TR CLAS` entry instead of reusing it. Eclipse sends
`corrNr`, which is why it works there.

**One correction to the scope, and it's in your favour:** this isn't specific to 7.40 or to older
NetWeaver. I reproduced it identically on **S/4HANA 2023 (SAP_BASIS 758)**. The actual trigger is
*transportable package + the class already recorded in a request* — on any release. It stayed
hidden because this code path was originally verified in `$TMP`, where the lock returns an empty
`CORRNR` and no CTS record is needed, so the POST succeeds.

**Your proposed fix is the right one and is validated:**

| | 7.50 | 758 |
|---|---|---|
| POST `?lockHandle=…` (today) | 500 | 500 |
| POST `?lockHandle=…&corrNr=<REQ>` | **201** | **201** |

…followed by a successful source PUT and read-back on both. `$TMP` is unaffected either way — the
lock's `CORRNR` is empty there, so the URL stays byte-identical to today's.

One note on your workaround: until this ships, `include="testclasses"` should work on a class in
`$TMP`, so a local-package scratch class is a lighter workaround than a separate global test class
if that fits your flow.

Also flagging that the `500` hint ARC-1 prints for this ("often transient — wait 10-30 seconds and
retry") is misleading here; I'll make that message-specific separately.

Fix incoming.
```
