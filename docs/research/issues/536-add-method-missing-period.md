# Issue #536 — `add_method` fails confusingly when the METHODS clause lacks a terminating period (VALIDATED)

**Status:** Confirmed and **FIXED** (2026-06-30). Reporter's root cause is correct. Reproduced live on **NW 7.50 (NPL750)** and **S/4HANA 2023 / 758 (a4h)**; fix re-verified live on a4h (periodless `add_method` → success → activates clean). See "Fix implemented" below.
**Type:** Feature / input-hygiene (the issue is labelled `enhancement`). **Not** a SAP/ADT bug — SAP is right to reject the malformed source; ARC-1 feeds it.
**Symptom:** `SAPWrite action=add_method` with a `method` clause that has **no trailing `.`** fails with
`status 400 … The statement CLASS ... IMPLEMENTATION. is unexpected` + SAPscript longtext `OO_SOURCE_BASED038` ("The class can't be separated into its different source parts").

## TL;DR

- **The reporter is correct.** The only problem is a missing terminating period (`.`) at the end of the `method` clause. With the period, the identical call succeeds; without it, SAP rejects the PUT.
- **Root cause (client-side, release-independent):** `add_method` splices the caller's `method` clause into the class DEFINITION **verbatim** — no terminating-period normalization (`insertMethodPair`, `src/adt/class-structure.ts:150`). A clause without its closing `.` does not terminate, so the `METHODS …` statement swallows the following source lines (`ENDCLASS.` of the DEFINITION, then `CLASS … IMPLEMENTATION.`). SAP's source-based class separator can't split the parts → `OO_SOURCE_BASED038`.
- **Reproduces identically on 7.50 and 758** — it is pure ARC-1 string handling that runs *before* SAP sees anything, so release is irrelevant. On NPL 7.50 we even got the exact `LONGTEXT=…OO_SOURCE_BASED038…` HTML the reporter pasted.
- **Both error paths are confusing**, and neither mentions the period:
  - `lintBeforeWrite:false` (reporter's call) → raw SAP `400 OO_SOURCE_BASED038`.
  - lint ON (default) → abaplint `[parser_error] Statement does not exist … "METHODS"` pointing at "Line 6" of a *spliced* source the user never sees.
- **Sibling action shares the gap:** `edit_method_signature` splices its `source` clause verbatim too (`spliceMethodSignature`, `src/adt/class-structure.ts:105`) — same failure mode, same one-line fix.
- **Recommendation:** auto-append the missing terminating period (foolproof, matches the issue title and the reporter's "could also add the period itself" suggestion). A METHODS/CLASS-METHODS clause *must* end in `.`; there is no valid reading where its absence is intentional, so normalizing is safe.

## Live validation (2026-06-30)

Driven via the built `dist/cli.js` against both systems (a4h via repo `.env`; NPL via env overrides). Test class `ZCL_ARC1_I536` in `$TMP`, then deleted on both systems.

Same call twice — the **only** difference is the trailing `.`:

| Call (`add_method`, `visibility=private`, `lintBeforeWrite=false`) | a4h (758) | NPL (7.50) |
|---|---|---|
| `method: "METHODS my_method IMPORTING iv_in TYPE string RETURNING VALUE(rv_out) TYPE string"` (no period) | **400 OO_SOURCE_BASED038** | **400 OO_SOURCE_BASED038** (full LONGTEXT, = reporter's) |
| `method: "…TYPE string."` (period) | **success** ("Successfully added method MY_METHOD") | **success** |

Captured 400 (a4h):
```
ADT API error: status 400 at /sap/bc/adt/oo/classes/ZCL_ARC1_I536/source/main?lockHandle=…:
The statement CLASS ... IMPLEMENTATION. is unexpected
DDIC diagnostics:
  - [?/038] V1=CLASS ... IMPLEMENTATION.: The statement CLASS ... IMPLEMENTATION. is unexpected
```

What ARC-1 actually PUT (inactive source of the **with-period** success, read back — shows where the clause lands):
```
4    PRIVATE SECTION.
5  METHODS my_method IMPORTING iv_in TYPE string RETURNING VALUE(rv_out) TYPE string.   ← clause inserted verbatim, after PRIVATE SECTION.
6  ENDCLASS.
7
8  CLASS zcl_arc1_i536 IMPLEMENTATION.
9    METHOD my_method.
10   ENDMETHOD.
11 ENDCLASS.
```
Drop the `.` on line 5 and the `METHODS` statement runs on through lines 6 and 8 → `CLASS … IMPLEMENTATION.` is "unexpected" → 038. (Cosmetic aside: the spliced clause lands at column 0, not indented — separate, harmless.)

Default-lint path (a4h, lint ON):
```
Pre-write lint check failed for CLAS ZCL_ARC1_I536. Fix these errors before writing:
  Line 6: [parser_error] Statement does not exist in ABAPv702(or a parser error), "METHODS"
```
Blocks the write, but never says "missing period" and points at a line the user can't see.

## Root cause (code)

1. `src/handlers/write/class-surgery.ts` `writeActionAddMethod` (~L386) — `const clause = String(args.method ?? '')`, passed straight to `insertMethodPair({ decl: clause, … })` (L442). No period check. `extractMethodNameFromClause` (L392) tolerates a missing period, so the method *name* resolves fine and we sail into the bad splice.
2. `src/adt/class-structure.ts` `insertMethodPair` (L141) → `insertBeforeLine(source, anchor.afterLine + 1, opts.decl)` (L150) — inserts `decl` verbatim.
3. SAP `/sap/bc/adt/oo/classes/{name}/source/main` PUT runs the source-based class separator, which requires each section/part to be syntactically separable. The unterminated `METHODS` statement fuses DEFINITION-end + IMPLEMENTATION-start → `OO_SOURCE_BASED038`. **SAP behaviour is correct.**

This is the same "we feed SAP malformed source" class of problem as a missing `.` anywhere, but here ARC-1 *constructs* the source, so it owns the hygiene.

## Recommended fix (hand to `/deep-feature` or `/implement-feature` — small)

Lazy + complete: a tiny `ensureTrailingPeriod(clause)` normalization, applied where the clause is spliced.

- **Primary:** `src/handlers/write/class-surgery.ts` `writeActionAddMethod` — normalize `clause` right after the empty-check (before `extractMethodNameFromClause`/`insertMethodPair`). One-liner: if the comment-and-whitespace-stripped clause doesn't end with `.`, append `.`.
  - Common case (single-line, no comment): `if (!clause.trimEnd().endsWith('.')) clause = clause.trimEnd() + '.';`
  - Edge (no period **and** a trailing `" comment` on the last line) is pathological from an LLM; if not handled it degrades to *today's* behaviour (no regression). Mark the ceiling with a `ponytail:` comment.
- **Sibling (recommended, same helper):** `writeActionEditMethodSignature` `source` → `spliceMethodSignature`. Identical gap; apply the same normalization to prevent a near-identical future issue.
- **Most robust home (alternative):** normalize inside `insertMethodPair`/`spliceMethodSignature` themselves — both are only ever called with a METHODS clause, both *must* terminate in `.`, and both are already unit-tested. Make-it-true-by-construction; covers every caller.
- **Tests:** `tests/unit/adt/class-structure.test.ts` already has `describe('insertMethodPair')` (L153) and `describe('spliceMethodSignature')` — add a no-period case asserting the emitted source ends the clause with `.`. No live SAP needed.
- **No surface change:** no new param → no `tools.ts`/`schemas.ts` three-file sync, no tool-definition fixture churn. Behaviour-preserving for already-correct input → eligible for a `fix:` commit.

Optional polish (not required): note the auto-correction in the success text ("appended missing terminating period") so the agent learns; or, if auto-fix is deemed too magical, fall back to a clear `errorResult("METHODS clause must end with a period (…)")` — but auto-append better matches the "foolproof" ask.

## Fix implemented (2026-06-30)

`ensureClauseTerminator(clause)` added to `src/adt/class-structure.ts`, called inside the two pure
splice primitives that emit a user-supplied clause verbatim — `insertMethodPair` (→ `add_method`)
and `spliceMethodSignature` (→ `edit_method_signature`). Make-it-true-by-construction: every caller
of those primitives is now period-safe.

- **Implementation:** a single left-to-right scan (no backtracking regex). Finds the trailing `"`
  line comment, skips a `"` inside a `'…'` literal, and appends `.` after the last code char,
  preserving any comment + the whitespace before it. No-op when already terminated.
- **Tests:** `tests/unit/adt/class-structure.test.ts` — 11 new cases (pure-function + both splice
  integrations + the two review-caught edge cases below). Full suite green (4198).
- **Code-review caught two real bugs in the first regex draft (`/^(.*?)(\s*"[^\n]*)?$/`), both fixed
  by going regex-free:**
  1. **ReDoS** — catastrophic backtracking on long *interior* whitespace (measured 100k spaces ≈
     3.7s of event-loop-blocking CPU; input is unbounded `args.method`/`source`). The linear scan is
     O(n). Regression test asserts <1000ms on 100k spaces.
  2. **Char-literal mis-split** — `DEFAULT '"'` made the regex treat the `"` as a comment and inject
     the period inside the literal. The literal-aware scan appends after the literal. Test added.
- **Layer note (from review):** `delete_method`, `change_method_visibility`, `edit_class_definition`
  correctly do NOT route through this helper (they relocate existing source or whole DEFINITION
  blocks, not a single user clause). `edit_method`'s *body* splice (`src/context/method-surgery.ts`)
  shares the "missing terminator → activation error" class but is multi-statement body normalization
  — a separate, harder problem, deliberately out of #536's scope (follow-up candidate).

## Out of scope

- Full ABAP-syntax validation of the clause — only the terminating period is in scope (that is the reported failure; broader validation is abaplint's job via `lintBeforeWrite`).
- The cosmetic column-0 indentation of the spliced clause (pre-existing, separate).
- The NPL750 423 lock-handle gap (issue #293) did **not** trigger here — the 400 parse rejection is returned at PUT time before/independent of lock validation; no interaction.

## Duplicate check

None. `docs/research/issues/` holds only 293, 434, 520×2. No open/closed issue covers add_method period handling.

## Drafted GitHub reply (paste-able — author reviews & posts; do not auto-post)

````markdown
Thanks @samibouge — and nice debugging. You're exactly right: the only problem is the missing terminating period (`.`) at the end of the `METHODS` clause, and yes, ARC-1 should handle this for you.

I reproduced it on two systems today:

| `add_method` (`visibility=private`, `lintBeforeWrite=false`) | NW 7.50 | S/4HANA 2023 (758) |
|---|---|---|
| `"METHODS my_method IMPORTING iv_in TYPE string RETURNING VALUE(rv_out) TYPE string"` (no period) | ❌ 400 `OO_SOURCE_BASED038` | ❌ 400 `OO_SOURCE_BASED038` |
| `"…TYPE string."` (period added) | ✅ success | ✅ success |

**Why it happens:** `add_method` splices your clause into the class verbatim, right after `PRIVATE SECTION.`:

```abap
  PRIVATE SECTION.
METHODS my_method IMPORTING iv_in TYPE string RETURNING VALUE(rv_out) TYPE string   <-- no '.'
ENDCLASS.

CLASS … IMPLEMENTATION.
```

Without the `.`, the `METHODS` statement never ends — it runs on through `ENDCLASS.` and `CLASS … IMPLEMENTATION.`, so SAP can't separate the class into its parts and throws `OO_SOURCE_BASED038` ("The statement `CLASS ... IMPLEMENTATION.` is unexpected"). It's release-independent — the malformed source is built before SAP ever sees it.

(Side note: with the default `lintBeforeWrite` left on, abaplint *does* block it, but with an equally cryptic `[parser_error] … "METHODS"` message — so disabling lint isn't really the cause.)

**Fix:** I'll make `add_method` auto-append a terminating period when it's missing — a `METHODS` clause must end in `.`, so there's no ambiguity. I'll apply the same to `edit_method_signature`, which has the identical behavior. Tracking it for the next release; thanks for the clear report.
````
