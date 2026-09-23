# SAPDiagnose `action="syntax"` reports "clean" when SAP checked nothing

**Status:** CONFIRMED BUG. Root cause validated live on **7.50 (npl)**, **758 (a4h)** and **816
(a4h-2025)** on 2026-08-05. **Fixed on branch `claude/adoring-antonelli-1b845b`** (see *Fix* below).
Reported in-session; no GitHub issue exists and none is planned — **this dossier is the record**,
written to the same bar as the numbered ones so it reads standalone.

## TL;DR

- **Symptom:** `SAPDiagnose action="syntax"` with an inline `source` returns `{"hasErrors":false,
  "messages":[]}` for an object that does not exist on the system — even when the source contains
  blatant syntax errors. Consumers (the `arc1-abap-bridge` VS Code extension's `arc1_abap_validate`
  tool) render that as "SAP accepts this source" — a false green light on every not-yet-created object.
- **The reporter's root cause is wrong in one important respect.** SAP does **not** return an empty
  result. It returns an explicit refusal:
  `<chkrun:checkReport chkrun:status="notProcessed" chkrun:statusText="Resource CLASS ZCL_X does not exist."/>`.
  ARC-1's `parseSyntaxCheckResult` only ever looked at `<chkrun:checkMessage>` / `<msg>` nodes and
  **discarded the report status**, collapsing "SAP refused to check" into "checked, zero findings".
- **It is type-dependent, not universal.** A missing **PROG** is checked normally (SAP compiles the
  supplied artifact and reports the error) on all three releases. A missing **CLAS** is refused on all
  three. A missing **DDLS** is refused on 758/816 but *checked* on 7.50. So "any new object gets a
  false green" is too broad — the false green hits CLAS everywhere and DDLS on modern releases.
- **Independent corroboration:** `mcp-abap-adt-fr0ster` (`src/lib/checkRunParser.ts:125`) already
  reads the same attribute and fails closed: `has_errors = errors.length > 0 || status === 'notProcessed'`,
  `success = status === 'processed' && errors.length === 0`. ARC-1 now matches those semantics.
- **No SAP Note and no community post covers this** (`sap-notes` search: 0 results; SAP Community: no
  hit). It is undocumented wire behavior; the Eclipse public API (`IAdtCheckResult`) exposes only
  issues, never the report status, because Eclipse only ever checks objects that already exist.

## Live validation (2026-08-05)

Raw `POST /sap/bc/adt/checkruns?reporters=abapCheckRun` with a base64 artifact, driven straight over
undici (no ARC-1 in the path) so the response is SAP's, unfiltered. Broken source used throughout:

```abap
CLASS zcl_x DEFINITION PUBLIC FINAL CREATE PUBLIC.
 PUBLIC SECTION.
 METHODS greet RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_x IMPLEMENTATION.
 METHOD greet.
 rv = 42 +.          " <- incomplete expression
 ENDMETHOD.
ENDCLASS.
```

| # | Scenario | 7.50 (npl) | 758 (a4h) | 816 (a4h-2025) |
|---|----------|------------|-----------|----------------|
| A | **CLAS missing** + inline source | `notProcessed`, 0 msg | `notProcessed`, 0 msg | `notProcessed`, 0 msg |
| B | CLAS exists + broken inline source | `processed`, 1 msg | `processed`, 1 msg | `processed`, 1 msg |
| C | CLAS exists, URI-only (true clean) | `processed`, 0 msg | `processed` ¹ | `processed`, 0 msg |
| D | **CLAS missing**, URI-only (no source) | `notProcessed`, 0 msg | `notProcessed`, 0 msg | `notProcessed`, 0 msg |
| E | **PROG missing** + inline source | `processed`, **1 msg** | `processed`, **1 msg** | `processed`, **1 msg** |
| F | **DDLS missing** + inline source | `processed`, **2 msg** | `notProcessed`, 0 msg | `notProcessed`, 0 msg |

¹ 758 timed out on `CL_ABAP_TYPEDESCR` (large class, loaded system); the `processed` path on 758 is
proven by row B and by the end-to-end run below.

Every row is **HTTP 200**. Status alone distinguishes "checked" from "refused" — a `200 OK` here means
nothing, exactly the trap the ARC-1 guide warns about.

`statusText` verbatim (the wording is per-type and per-release, so never pattern-match it):

- CLAS, all releases: `Resource CLASS ZCL_DOES_NOT_EXIST_ARC1 does not exist.`
- DDLS 758: `DDL Source ZI_… of version  does not exist` — note double space, no trailing period
- DDLS 816: `Data definition ZI_… of version  does not exist`
- processed: `Object CL_ABAP_TYPEDESCR has been checked`

### End-to-end through the ARC-1 handler (758, a4h)

Same source, before → after the fix, via `handleToolCall('SAPDiagnose', {action:'syntax', type:'CLAS', …})`:

| Object | Before | After |
|--------|--------|-------|
| `ZCL_DOES_NOT_EXIST` (missing) | `{"hasErrors":false,"messages":[]}` | `{"hasErrors":true,"checked":false,"statusText":"Resource CLASS ZCL_DOES_NOT_EXIST does not exist.","messages":[{"severity":"error","text":"Not checked — Resource CLASS ZCL_DOES_NOT_EXIST does not exist. The source was NOT validated; create the object first (SAPWrite action=\"create\"), then re-run the syntax check.","line":0,"column":0}]}` |
| `ZCL_ABAPGIT_AJSON_MAPPING` (exists) | `hasErrors:true` + real error | unchanged, plus `"checked":true` |

## Root cause

`src/adt/devtools.ts` `parseSyntaxCheckResult` built its verdict purely from message nodes:

```ts
const msgs = [...findDeepNodes(parsed, 'msg'), ...findDeepNodes(parsed, 'checkMessage')];
return { hasErrors: messages.some((m) => m.severity === 'error'), messages };
```

`<chkrun:checkReport chkrun:status=…>` — the only element SAP sends when it refuses — was never read.
Zero messages therefore had two irreconcilable meanings ("clean" and "not checked") that collapsed
into the reassuring one. Nothing about the request is wrong: the URI, the media types and the
base64 artifact envelope all match Eclipse ADT's contract (`POST /sap/bc/adt/checkruns`,
`api/06-activation-checkruns-inactive-objects.md:12`). SAP's answer was simply being under-read.

Why SAP refuses at all: for CLAS (and DDLS on 758/816) the `abapCheckRun` reporter resolves the
object from the repository before compiling, so a missing object has no context to check against.
For PROG the reporter compiles the free-standing artifact, which is why row E works everywhere.

## Fix (branch `claude/adoring-antonelli-1b845b`)

| File | Change |
|------|--------|
| [src/adt/devtools.ts](../../../src/adt/devtools.ts) | `parseSyntaxCheckResult` reads `<chkrun:checkReport>`; any `status` other than `processed` ⇒ `checked:false` + `statusText`. Absent report (legacy `<msg>` shape) ⇒ `checked:true`, so 7.50-era responses are unaffected. |
| [src/adt/types.ts](../../../src/adt/types.ts) | `SyntaxCheckResult` gains `checked: boolean` (required — a missed call site is a compile error) and `statusText?`. |
| [src/handlers/diagnose.ts](../../../src/handlers/diagnose.ts) | `!checked` ⇒ fail closed at the tool boundary: `hasErrors:true` plus one explanatory error message. Consumers keying on either `hasErrors` or `messages` stop seeing a green light, with no change on their side. |
| [src/handlers/write-helpers.ts](../../../src/handlers/write-helpers.ts) | `runPreWriteSyntaxCheck` and `inactiveSyntaxDiagnostic` early-return on `!checked`. Without this, `SAP_CHECK_BEFORE_WRITE=true` would emit "does not exist" on every legitimate create. |
| tests | `tests/unit/adt/devtools.test.ts` (both parser branches, fixture = the live bytes above), `tests/unit/handlers/lint-diagnose.test.ts` (fail-closed handler shape). |

**Not changed, deliberately:**

- `hasErrors` stays `false` inside `SyntaxCheckResult` when SAP found no messages — the client layer
  reports SAP literally; only the tool boundary fails closed. `checked` is the field to branch on.
- No pre-flight existence probe. SAP's own `status` is free; a second round-trip is not.
- No bridge change. `~/DEV/arc1-abap-bridge/extension.js:1055` only prints "SAP accepts …" when
  `messages` is empty, and the synthetic message fills it. Verified by reading the code, not assumed.

## Residual assumptions

- Only `processed` and `notProcessed` were observed. Any other future status is treated as
  "not checked" (fail-closed) — matches fr0ster, and errs toward blocking rather than approving.
- ARC-1 sends exactly one `<chkrun:checkObject>`, so the first non-`processed` report decides. A
  future multi-object caller would need per-object attribution.

## What callers should do for a not-yet-created object

There is no ADT endpoint that syntax-checks a class that does not exist — Eclipse never needs one
(its buffers are always existing objects; new objects go through a separate creation-check service).
The working order is: `SAPLint` (abaplint, local, needs no SAP object) → `SAPWrite action="create"` →
`SAPDiagnose action="syntax"` / `SAPActivate` for the authoritative verdict. For **PROG** the inline
check already works before creation (row E).

## Reproduction commands

```bash
# raw wire (any release) — swap host/creds; note sap-client=100 for MARIAN on a4h, not 001
curl -s -u USER:PASS -H 'Content-Type: application/*' \
  -H 'Accept: application/vnd.sap.adt.checkmessages+xml' -H 'x-csrf-token: TOKEN' \
  --data @body.xml 'http://a4h.marianzeis.de:50000/sap/bc/adt/checkruns?reporters=abapCheckRun&sap-client=100'
```

```bash
npx vitest run tests/unit/adt/devtools.test.ts tests/unit/handlers/lint-diagnose.test.ts
```

## Ready-to-send explanation

No issue thread to post to. Kept because this is the shape of the answer if a user ever reports the
same symptom — paste it, or lift the correction paragraph into a release note.

```markdown
Confirmed, and thank you — this is a real false-green. Validated live on three releases today
(NW 7.50, S/4HANA 2023 / SAP_BASIS 758, ABAP Platform 2025 / 816).

One correction to the diagnosis: SAP does **not** return an empty result. It answers HTTP 200 with an
explicit refusal that ARC-1 was discarding:

    <chkrun:checkReport chkrun:reporter="abapCheckRun" chkrun:status="notProcessed"
                        chkrun:statusText="Resource CLASS ZCL_DOES_NOT_EXIST does not exist."/>

`parseSyntaxCheckResult` only collected `<chkrun:checkMessage>` / `<msg>` nodes, so "SAP refused to
check" and "checked, nothing found" both came out as `{"hasErrors":false,"messages":[]}`.

It is also narrower than "any new object": a missing **PROG** is checked normally on all three
releases (SAP compiles the supplied artifact); a missing **CLAS** is refused on all three; a missing
**DDLS** is refused on 758/816 but checked on 7.50.

Fix: the parser now reads the report status, `SyntaxCheckResult` carries `checked` + `statusText`,
and the tool boundary fails closed — a refused check returns `hasErrors:true`, `checked:false` and
one message saying the source was **not** validated. That keeps existing consumers safe whether they
key on `hasErrors` or on `messages`, so no client change is required. The pre-write and post-save
check paths skip refused checks so ordinary object creation stays quiet.

For validating a class that does not exist yet, there is no ADT endpoint that can do it — Eclipse
doesn't need one either. Use `SAPLint` (abaplint, purely local) first, then create the object and run
`SAPDiagnose action="syntax"` / `SAPActivate` for SAP's authoritative verdict.
```

## Recommendation

Fix is implemented and live-verified — no `/deep-feature` pass needed; ship it as a `fix:` commit.

The one follow-up considered and **rejected**: documenting the create-first ordering in the
`SAPDiagnose action="syntax"` tool description. It would cost schema tokens on every LLM call (the
payload is under a CI budget) to pre-warn about a case the fail-closed message now explains at the
exact moment it happens. Not worth it.
