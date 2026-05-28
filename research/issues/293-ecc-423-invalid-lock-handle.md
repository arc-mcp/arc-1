# Issue #293 — ECC: status 423 "invalid lock handle" on every write

> **Status**: Open (reported 2026-05-21 by @abappdpatel)
> **GitHub**: https://github.com/marianfoo/arc-1/issues/293
> **ARC-1 components**: `src/adt/crud.ts`, `src/adt/errors.ts`, `src/handlers/intent.ts`
> **Classification**: SAP backend bug (not an ARC-1 defect) — `category: enqueue-error`

## Reported symptom

Write operations through ARC-1 succeed on S/4HANA but fail on **ECC** with:

```
ADT API error: status 423 at /sap/bc/adt/programs/programs/Z_HELLO_world/source/main?lockHandle=52DB307F4F437ADF85C4872C8840380C4A50FA75:
Resource INCLUDE ZPPD3_HELLO3 is not locked (invalid lock handle: 52DB307F4F437ADF85C4872C8840380C4A50FA75)
```

Reporter states the error hits **all write operations** on ECC. Already tried (no effect):
- Reopening the object
- Refreshing the ADT project
- Checking / clearing locks in SM12

## What the error means

The write flow is `LOCK → PUT(/source/main) → UNLOCK` on a single stateful session
(`src/adt/crud.ts` `safeUpdateSource` / `withStatefulSession`).

1. `LOCK` succeeds and returns a lock handle (`52DB307F…` here).
2. The next `PUT` against `/source/main` is rejected with **HTTP 423
   `ExceptionResourceInvalidLockHandle`** — SAP claims the resource is not locked
   even though the handle was just issued.
3. SM12 shows nothing because the enqueue lock was already released the instant the
   PUT failed — so "clearing locks in SM12" is a no-op for this bug.

### Why the message says "Resource INCLUDE …" on a `/programs/programs/` URL

TYPE-1 executable programs (reports) have an **implicit include** of the same name.
The ADT framework locks the PROG, but when the source PUT lands it looks the lock up
under the program's implicit include. On un-patched releases that lookup misses the
lock that was just registered → "Resource INCLUDE … is not locked". This INCLUDE-vs-PROG
phrasing is a fingerprint of this specific bug, not a sign the wrong URL was used.

(Note: the example pastes `Z_HELLO_world` in the URL but `ZPPD3_HELLO3` in the body —
likely two different attempts conflated, or partial anonymization. Irrelevant to the
root cause; both are the same 423 lock-handle failure.)

## Root cause

**SAP Note [2727890](https://me.sap.com/notes/2727890/E) — "ADT: fix unstable adt lock handle"**
- Component: `BC-DWB-AIE` (ABAP Development Tools, backend)
- Released: 2018-12-11
- Affected: **SAP_BASIS 7.40 – 7.54** (the un-patched ADT framework)

This is a known ABAP Development Tools backend bug where the lock handle is not stable
under certain conditions. It almost exclusively shows on **ECC / NetWeaver 7.40–7.51**
because S/4HANA stacks already ship the fix — which is exactly why the reporter sees it
on ECC but not on S/4HANA.

### Why ECC specifically

ECC stacks still in maintenance run `SAP_BASIS` 7.40 (EHP7) or 7.50 (EHP8) — squarely
inside the note's affected range. We have a probe fixture confirming this is the kind of
system in scope: `tests/fixtures/probe/ecc-ehp8-nw750-sp31-onprem-prod/meta.json`
(`SAP_BASIS 750 SP31`, `systemType: onprem`).

### Why Eclipse ADT might appear to work on the same box

Eclipse ADT can follow a slightly different request/timing sequence that happens to dodge
the unstable-handle window. This is consistent with the bug class, not a contradiction —
once the note is applied, both Eclipse and ARC-1/other clients work reliably.

## What ARC-1 already does

ARC-1 does **not** silently swallow this. The error path already classifies and explains it:

- **`src/adt/errors.ts:384`** — `classifySapDomainError()` maps
  `ExceptionResourceInvalidLockHandle` / status 423 → `category: 'enqueue-error'`
  with a hint that cites SAP Note 2727890 directly.
- **`src/adt/crud.ts:56`** — `lockObject()` parses `modificationSupport` from the lock
  response and fails early with a clear "released/non-modifiable transport" message for
  that *related* 423 sub-case (so it is not confused with the unstable-handle bug).
- **`src/handlers/intent.ts` `formatErrorForLLM` (~line 391)** — surfaces the
  classification hint + `SAP Transaction: SM12` line to the LLM/caller.
- **`docs/integration-test-skips.md`** — documents the same root cause as the
  `BACKEND_UNSUPPORTED: lock-handle session correlation differs on this release` skip
  category, with the note link.

The full LLM-facing message looks like:

```
ADT API error: status 423 at /sap/bc/adt/programs/programs/.../source/main?lockHandle=...:
Resource INCLUDE ... is not locked (invalid lock handle: ...)

Hint: Lock handle is invalid or expired. First, retry — transient expiry is the common case.
If 423 persists on the first PUT after a successful LOCK, see SAP Note 2727890
"ADT: fix unstable adt lock handle" (component BC-DWB-AIE) ...

SAP Transaction: SM12
```

If the reporter only saw the first line, the `Hint:` line was likely truncated by their
LLM/UI — that line carries the actionable guidance.

## Prior art in this repo (same bug class)

This is a recurring, cross-client SAP issue, already catalogued in `compare/`:

| File | Source | Note |
|---|---|---|
| `compare/vibing-steampunk/evaluations/issue-78-lock-handle-ecc.md` | VSP #78 | 423 on ECC 6.0 EHP7, Eclipse works on same box |
| `compare/vibing-steampunk/evaluations/issue-91-lock-handle-423.md` | VSP #91 | recurring `ExceptionResourceInvalidLockHandle` |
| `compare/vibing-steampunk/evaluations/22517d4-lock-handle-bug-class.md` | VSP commit | stateful-session + `modificationSupport` guard (ARC-1 already has this) |
| `compare/abap-adt-api/evaluations/issue-36-include-lock.md` | abap-adt-api #36 | "Resource INCLUDE is not locked" — include inherits parent lock |

Cross-referenced upstream issues: VSP #78/#88/#91/#92, abap-adt-api #30/#36, fr0ster #57/#58.

## Possible cause (ranked)

1. **(Primary, ~95%) Un-patched ADT framework — SAP Note 2727890 not applied.** Matches
   every observable: ECC-only, all writes, first PUT after LOCK, SM12 empty, INCLUDE phrasing.
2. **(Secondary) Mixed-case object name on `update`.** The example URL is `Z_HELLO_world`
   (mixed case). SAP TADIR stores names uppercase; mixed-case can cause a secondary lookup
   mismatch on older systems. ARC-1 rejects mixed-case on `create`
   (`src/handlers/intent.ts:3436`) **but not on `update`** — so a mixed-case update URL is
   passed through verbatim. This would not *cause* the unstable-handle bug, but it is one
   more variable to remove when verifying after the note.
3. **(Unlikely here) Session/cookie bleed across the LOCK→PUT pair.** ARC-1 uses
   `withStatefulSession()` to keep cookies+CSRF on one session, so this is covered. Only
   worth re-checking if the note is confirmed applied and 423 still fires.

## Possible solution

### Primary — apply the SAP Note (SAP side, the real fix)

Ask the customer's Basis team to:
1. Confirm `SAP_BASIS` release + SP (SAP GUI: **System → Status → Component information**).
2. In **SNOTE**, search `2727890`; if not "implemented", apply it (small, isolated to ADT
   framework) — or pull a Support Package that already contains it.
3. Re-test the same write through ARC-1.

There is **no safe pure-client workaround**: re-locking hits the same enqueue path, and
skipping the SAP enqueue would corrupt the development server. The note is the canonical fix.

### Secondary — ARC-1 hardening (optional, low effort, does NOT fix the bug)

These improve UX/diagnostics but do not substitute for the note:

1. **Uppercase object names on `update`/`edit_method`/`delete`, not just `create`.**
   Extend the guard at `src/handlers/intent.ts:3436` (or normalize the name when building
   the object URL) so a mixed-case `name` can't introduce a case-mismatch variable on
   older systems. Tests: `tests/unit/handlers/intent.test.ts`,
   `tests/unit/handlers/schemas.test.ts`.
2. **One-time automatic re-lock + retry on the first 423.** Catch the first
   `ExceptionResourceInvalidLockHandle` inside `safeUpdateSource`/`safeUpdateObject`,
   re-acquire the lock once on a fresh session, and retry the PUT. On a *patched* system
   this rides through a genuinely transient expiry; on an *un-patched* system it still
   fails (and we then surface the note hint). Must be a single bounded retry — never a
   loop — to avoid masking real enqueue contention. Tests in `tests/unit/adt/crud.test.ts`.
   ⚠️ Trade-off: a blind retry can hide the fact that the system needs the note. If added,
   keep the note hint on the *second* failure so operators still get pointed at 2727890.
3. **(Already done, keep)** Note-citing hint on 423 in `src/adt/errors.ts:384`.

> Recommendation: treat this issue as **"backend fix, document + close"**. Option 2.1
> (uppercase on update) is a reasonable small correctness improvement to land regardless.
> Option 2.2 (auto-retry) is debatable — it can mask the missing note, so only add it if we
> keep the note hint on the persistent failure.

## To confirm with the reporter

1. `SAP_BASIS` release + SP level.
2. Does it fail for **all** writable types (PROG/CLAS/INTF/INCL/DDIC) or only some?
3. Does the **first** PUT after LOCK fail, or only later PUTs in the same session?
4. Is the real object name mixed-case, or was that just the example?

## References

- SAP Note 2727890 "ADT: fix unstable adt lock handle" — https://me.sap.com/notes/2727890/E
- `src/adt/errors.ts:384` — 423 → `enqueue-error` classification + note hint
- `src/adt/crud.ts:24` `lockObject` / `:56` modificationSupport guard / `:210` `safeUpdateSource`
- `src/handlers/intent.ts:391` `formatErrorForLLM`, `:3436` create-only uppercase guard
- `docs/integration-test-skips.md` — "Root cause: persistent lock-handle 423 after successful LOCK"
- `docs/adr/0002-structured-exception-lock-conflict-reclassification.md`
- `tests/fixtures/probe/ecc-ehp8-nw750-sp31-onprem-prod/meta.json` — representative ECC stack
