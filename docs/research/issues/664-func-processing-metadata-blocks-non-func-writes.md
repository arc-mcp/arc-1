# Issue #664 — FUNC processing metadata hard-rejects every unrelated `SAPWrite`

**Status:** CONFIRMED BUG. Root cause validated live on **SAP_BASIS 816** (a4h-2025) on 2026-08-03,
with the reporter's exact payload. **Regression introduced in v1.0.0 by [#634](https://github.com/arc-mcp/arc-1/issues/634)**
(FUNC `processingType`/`updateTaskKind`); it re-opens the guarantee [#360](https://github.com/arc-mcp/arc-1/issues/360)
was built to provide.

## TL;DR

- **Symptom:** `SAPWrite action=create type=PROG` fails *before any SAP call* with
  `"processingType": processingType and updateTaskKind are only supported for type="FUNC".` +
  `"updateTaskKind": updateTaskKind requires processingType="update".` — every time, for any type.
- **Root cause:** #634 added two **enum-only, no-null** optional properties (`processingType`,
  `updateTaskKind`) to the top-level `SAPWrite` schema, plus a `superRefine` that **hard-rejects**
  them whenever `type !== "FUNC"`. Schema-filling clients (OpenAI/GPT strict mode and the MCP clients
  that emulate it — here Kilo Code + GPT-5.6) must emit a value for *every* advertised property. Since
  #526 made the default schema non-nullable, `null` is not a legal value, so the model has to pick an
  enum member — `"normal"` / `"startImmediate"`. `stripLlmEmptyValues` only removes `null` and empty
  strings, so a fabricated *enum-legal* value sails through and the `superRefine` kills the call.
- **ARC-1 does not inject these fields.** Nothing in `tools.ts` sets a `default`; no handler adds them.
  They arrive on the wire from the client. The reporter's "the tool schema automatically populated
  them" is the right observation with the wrong subject.
- **Blast radius:** every `SAPWrite` action/type for an affected client — not just PROG. Genuine
  `type=FUNC` creates break too (`processingType="rfc"` + a fabricated `updateTaskKind` is rejected).
  Reads are unaffected (the fields exist only on `SAPWrite`).
- **`ARC1_LOG_HTTP_DEBUG=true` writing no log is expected**, not a second bug: validation fails at the
  dispatch layer, so no SAP HTTP request is ever made.
- **Fix:** drop inapplicable FUNC processing metadata in `normalizeTypeArgsForValidation` before Zod —
  exactly the treatment `include` already gets for the same reason (#360). Real FUNC creates keep their
  values; the `superRefine` stays as defense-in-depth.
- **Interim workaround for the reporter (no upgrade needed):** `ARC1_SCHEMA_NULLABLE_OPTIONALS=on`.
  Verified: it re-emits `"type": ["string","null"]` for both fields, so a strict-mode client can send
  `null`, which `stripLlmEmptyValues` already removes.

## Live validation (a4h-2025, SAP_BASIS 816, 2026-08-03)

System confirmed via `SAPRead type=COMPONENTS` → `SAP_BASIS 816 / SAPK-81601INSAPBASIS` — the release
named in the report. Driven through the built CLI (`node dist/cli.js call SAPWrite --json -`),
Basic auth, `SAP_ALLOW_WRITES=true`, `SAP_ALLOWED_PACKAGES=*` (the reporter's config).

| # | Payload | Result |
|---|---|---|
| A | Reporter's JSON **+** `processingType:"normal"`, `updateTaskKind:"startImmediate"` | ❌ `safety_blocked / Input validation failed` — **error text byte-identical to the issue**; zero HTTP requests to SAP |
| B | Reporter's JSON verbatim (no extra fields) | ✅ `Created PROG ZPLU_HELLO_WORLD in package $TMP and wrote source code.` |

Case A output, verbatim:

```
[safety_blocked] {"requestId":"REQ-1","operation":"SAPWrite","reason":"Input validation failed"}
Invalid arguments for SAPWrite:
  - "processingType": processingType and updateTaskKind are only supported for type="FUNC".
  - "updateTaskKind": updateTaskKind requires processingType="update".
```

Note which message is **absent**: `Function-module processing metadata is creation-time only; use
action="create".` That branch only fires when `action !== "create"` — so the reporter's client did send
`action:"create"`, and the *only* difference between a working and a failing call is the two fabricated
fields. The two remaining messages appear in exactly the reported order.

### After the fix — same system, same day

| Payload | Result |
|---|---|
| Reporter's JSON + fabricated pair (case A) | ✅ `Created PROG ZPLU_HELLO_WORLD in package $TMP and wrote source code.` |
| `FUNC` create, genuine `processingType:"rfc"` **+ fabricated** `updateTaskKind:"startImmediate"` | ✅ created; read-back → `{processingType: "rfc"}`, no `updateTaskKind` — the real value survives, the fabricated one is dropped |
| `FUNC` create, genuine `processingType:"update"` + `updateTaskKind:"startDelayed"` | ✅ created; read-back → `{processingType: "update", updateTaskKind: "startDelayed"}` |
| `FUNC` create, `processingType:"update"` with no kind | ❌ still refused: `processingType="update" requires an explicit updateTaskKind.` (correct — not guessable) |

All probe objects (`ZPLU_HELLO_WORLD`, `ZPLU664_FG` + its modules) were deleted from `$TMP` afterwards.

Schema-level matrix (`normalizeTypeArgsForValidation` → `SAPWriteSchema.safeParse`, HEAD):

| Case | HEAD | After fix |
|---|---|---|
| PROG create, clean | PASS | PASS |
| PROG create + fabricated `normal`/`startImmediate` | **FAIL** | PASS (both dropped) |
| PROG create + `null` / `""` for both | PASS (already stripped) | PASS |
| CLAS update + fabricated pair | **FAIL** | PASS (both dropped) |
| `batch_create` PROG item + fabricated pair | **FAIL** | PASS (both dropped) |
| FUNC create `rfc` + fabricated `startImmediate` | **FAIL** | PASS (`rfc` kept, `updateTaskKind` dropped) |
| FUNC create `rfc` | PASS | PASS |
| FUNC create `update` + `startDelayed` | PASS | PASS |
| FUNC create `update`, no `updateTaskKind` | FAIL (correct) | FAIL (correct — cannot be guessed) |

## Root cause, in code

1. `src/handlers/tools.ts` (via `FUNCTION_PROCESSING_TOOL_PROPERTIES`,
   [src/handlers/function-processing.ts:16](../../../src/handlers/function-processing.ts#L16)) advertises
   `processingType: {type:"string", enum:["normal","rfc","update"]}` and
   `updateTaskKind: {type:"string", enum:["startImmediate","immediateStartNoRestart","startDelayed"]}`
   at the **top level** of `SAPWrite` and inside each `objects[]` item — with no `null` in the type
   (default `ARC1_SCHEMA_NULLABLE_OPTIONALS=auto` → `off` since #526).
2. A strict-mode client rewrites `required` to list every property, so the model must emit a value;
   with no `null` available it picks an enum member.
3. [src/handlers/object-types.ts:203](../../../src/handlers/object-types.ts#L203) `stripLlmEmptyValues`
   removes only `null` and empty strings — a fabricated *valid* enum value is not pollution it can see.
4. [src/handlers/schemas.ts:400](../../../src/handlers/schemas.ts#L400) `validateFunctionProcessingInput`
   then hard-rejects: `type !== "FUNC"` → issue on `processingType`; `processingType !== "update"` with
   `updateTaskKind` present → issue on `updateTaskKind`. Both fire; the call dies at dispatch.

Why the earlier hardening didn't catch it: #360's runtime backstop is value-shaped (`null`/`""`), and
#526 removed the nullable union that let strict clients express "absent" at all. #634 then added the
first pair of **mutually constrained, enum-only** optionals to `SAPWrite`, which is precisely the shape
that defeats both. The `include` field had already hit this and was fixed by *dropping* it when
inapplicable ([src/handlers/object-types.ts:243](../../../src/handlers/object-types.ts#L243)) — that
precedent was simply not applied to the new fields.

## Not the cause (checked)

- **ARC-1 injecting defaults.** No `default` in the JSON Schema for either field; no handler sets them.
- **Release / system.** Validation is pre-HTTP; 816 is irrelevant to the failure mode (reproduced at
  the schema layer with no SAP connection at all).
- **`npx arc-1@latest` / stdio transport.** Same code path as any other deployment.
- **Missing `ARC1_LOG_HTTP_DEBUG` output.** Correct behavior — no HTTP request is made.
- **Duplicate.** No other issue matches; #360 is the ancestor class, closed and released.

## The fix

**Approach:** apply the `include` precedent — normalize inapplicable FUNC processing metadata away
*before* Zod, in `normalizeTypeArgsForValidation`'s `SAPWrite` branch.

Drop rules (top level and per `objects[]` item):

| Condition | Action |
|---|---|
| not (`type === "FUNC"` and the call is a create) | drop **both** fields |
| `processingType !== "update"` | drop `updateTaskKind` |
| everything else | keep verbatim |

For `objects[]` items "the call is a create" is always true (`batch_create` only creates), so the item
rule reduces to `type === "FUNC"`.

`processingType === "update"` with no `updateTaskKind` keeps its hard error — SAP needs an explicit
update-task kind and ARC-1 must not guess one.

**Files**

| File | Change |
|---|---|
| `src/handlers/object-types.ts` | new local `dropInapplicableFunctionProcessing()`; call it for the top-level args and each `objects[]` item in the `SAPWrite` branch |
| `tests/unit/handlers/dispatch-misc.test.ts` | extend the `#360` describe block with the #664 cases (drop on non-FUNC, drop on FUNC non-create, drop orphan `updateTaskKind`, keep genuine `rfc` / `update`+kind, batch items) |
| `tests/unit/handlers/schemas.test.ts` | end-to-end guard: normalize→`SAPWriteSchema.safeParse` accepts a polluted PROG create and still rejects `update` without a kind |
| `docs/research/issues/664-*.md` | this dossier |

**Deliberately NOT changed**

- The `superRefine` in `schemas.ts` — it stays as defense-in-depth for direct schema users and tests,
  same as the `include` checks that the normalizer also pre-empts.
- Tool descriptions / JSON Schema shape — the failing clients fill fields regardless of description,
  and `SAPWRITE_MINIMAL_PAYLOAD_GUIDE` already states the rule. Runtime normalization is the backstop
  by design (#360). No fixture regeneration, no schema-size churn.
- `ARC1_SCHEMA_NULLABLE_OPTIONALS` default — unrelated; `off` stays the portable default (#520/#526).

**Risk:** a caller who *deliberately* sends `processingType` on a FUNC **update** now gets it silently
dropped instead of an error. Accepted: the metadata is creation-time only in ADT, the write itself is
what the user asked for, and it is the identical trade already made for `include`.

### Independent review (Codex, 2026-08-03)

No Critical or High findings. Explicitly cleared: no legitimate FUNC data loss (applicability reads the
*normalized* type, valid `rfc` and `update`+kind pairs are retained), `objects[]` handling, caller-arg
mutation/aliasing, and scope derivation (`invocationPolicyKey` reads only `action`, which the drop never
touches — no request moves into a weaker scope or deny-action key).

One **Medium**, accepted as designed: the drop cannot distinguish fabricated from deliberate input, so
it bypasses the schema's "creation-time only" and task-kind-dependency errors. Rejecting instead would
re-break the reported bug for FUNC updates, and the payload carries no signal that separates the two
cases — which is exactly why #360 chose drop-over-reject for `include`. Of the three examples raised,
only *deliberate* `processingType` on a FUNC **update** loses meaning; a fabricated `updateTaskKind`
alongside a real `rfc` and a garbage enum value on a non-FUNC write are inapplicable at any value.

Test gaps it raised were closed where they guard behavior that actually changed — three end-to-end
`handleToolCall` cases in `tests/unit/handlers/write-create-batch.test.ts` (polluted PROG create,
asserting nothing reaches the SAP payload; mixed polluted `batch_create`; batch FUNC `update` with no
kind still refused). Not added: scope/`SAP_DENY_ACTIONS` enforcement with metadata present, and enum
validation on inapplicable writes — the drop provably changes neither.

## Follow-ups / out of scope

- Any future mutually-constrained optional enum pair on `SAPWrite` needs the same drop rule at the
  point it is added. A generic "applicability" table would be the durable answer if a third pair
  appears; two cases do not justify it yet.
- `ZPLU_HELLO_WORLD` was created in `$TMP` on a4h-2025 during validation and deleted afterwards.
