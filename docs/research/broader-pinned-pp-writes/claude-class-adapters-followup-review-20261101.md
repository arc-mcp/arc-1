# PR #1142 at `cee2a18e`: continue, but fix three Medium findings before freezing a live artifact

**Decision:** keep developing from this checkpoint, and don't freeze new live bytes until Findings 1–3 are fixed and reviewed. I found no stale save, save outside the lock, replay, or read-only route bypass. **The PR is not ready: it stays draft and FEAT-93 stays open.**

- **Findings:** no High, 3 Medium, 5 Low.
- **Checks:** all five commands passed, with 432 files and 11,783 tests as the author reported. The snapshot was unchanged at the first and last verifier runs.
- **How the findings were reached:** by reading ARC-1 and the abaplint source in the snapshot. Ad hoc scripts and mutants were barred, so **no failing case was executed**.
- **Live status:** nothing here is live or PP evidence for these bytes.

## Findings

### 1. Medium: formatting can hide a candidate from the ambiguity guard, so `edit_method` overwrites the wrong local class
Prior Finding 1 is fixed only for plainly formatted source.

**Where:**
- The guard at `src/context/method-surgery.ts:481` only sees what the method listing returns.
- abaplint's `ClassGlobal` allows one definition and one implementation (`node_modules/@abaplint/core/build/src/abap/3_structures/structures/class_global.js:42`).
- A multi-class include therefore fails structure parsing and falls back to line regexes (`method-surgery.ts:108`).
- Those regexes require an exact `ENDMETHOD.` line (`:390`) and a class header with nothing after it (`:372`).

**Trigger:** `edit_method(include="implementations", method="lif_x~run", expectedSourceHash=<include hash>)` on:
```abap
CLASS lcl_worker IMPLEMENTATION.
  METHOD lif_x~run.
  ENDMETHOD.                    "lif_x~run
ENDCLASS.
CLASS lcl_neighbor IMPLEMENTATION.
  METHOD lif_x~run.
  ENDMETHOD.
ENDCLASS.
```
The first method is never listed, so there is one candidate and no refusal. `ENDMETHOD .`, `CLASS lcl_worker IMPLEMENTATION. " note` and one-line `METHOD x. ENDMETHOD.` hide a candidate the same way. As I recall, trailing end-of-block comments like this are classic Pretty Printer output; nothing in this snapshot proves how common they are.

**Impact:**
- `lcl_neighbor` is overwritten and the result reports `saved-inactive` without naming the class.
- The hash covers the whole include and lint is skipped, so neither helps.
- Doubly qualified selectors are safe: `lcl_worker~lif_x~run` refuses as not found, and `lcl_neighbor~lif_x~run` selects correctly.

**Related defects:**
- **Duplicates on the normal path:** `metadata.md:123-125` says duplicate exact bodies refuse, but that only holds on the regex path. For a normal single-class source, the map at `method-surgery.ts:179-180` keeps only the last `METHOD run`, so the edit succeeds. The test at `tests/unit/context/method-surgery.test.ts:569` uses a source that fails `ClassGlobal`, so it never reaches this path.
- **Misleading test expectation:** `tests/unit/adt/class-surgery-formatting.test.ts:126-134` now expects "Ambiguous". That happens only because `method-surgery.ts:197` takes the name from the line's first `METHOD`, so `extra` is listed as `first`. It still refuses, but the message describes a duplicate that doesn't exist.

**Fix:** build the listing by walking parsed statements, which needs no class structure. Track `ClassImplementation`, `MethodImplementation` and `EndMethod`, take names from the statement, and keep duplicates as separate entries. Add parser and pinned-handler tests for each shape above.

### 2. Medium: `edit_method` replacement text can still leave the selected method and class
My last review was wrong to call this guard equivalent to the fix needed for the other actions.

**Where:** `method-surgery.ts:624-632` only counts `METHOD` and `ENDMETHOD`, and `:709-710` only checks the name. `src/handlers/write/class-surgery.ts:121` skips lint for includes.

**Trigger:** `edit_method(include="implementations", method="lcl_worker~run", source=" DATA(x) = 1.\nENDCLASS.\nCLASS lcl_foreign IMPLEMENTATION.", expectedSourceHash=<hash>)`.

**Impact:**
- The block passes the guard, reaches the PUT and reports `saved-inactive`. Include edits have no lint backstop.
- On main source, lint should block this when enabled. It won't when lint is off or parser errors are demoted (`src/lint/config-builder.ts:112`).
- The result should fail activation, because the method never closes, though that isn't proven here. The draft stays broken until a hash-guarded whole-include update. No authorization boundary is crossed.
- `tests/unit/context/method-splice-boundaries.test.ts:43-52` only covers extra `METHOD`/`ENDMETHOD` text.

**Fix:** refuse class, interface and other block-boundary statements between the method's first and last statements. Leave ordinary body syntax to lint. Test it on both routes.

### 3. Medium: full-definition symmetry misses interface bodies and abstract changes
`docs_page/multi-target-writes.md:132` says main edits "check method symmetry", but the check only compares declared method names.

**Where:** `src/adt/class-structure.ts:445-453` compares names against `structure.methods`, and `src/adt/xml-parser.ts:1515` drops interface bodies from that list. The pre-write rules at `config-builder.ts:115-124` have no semantic check that would catch the result.

**Triggers:**
- **Interface removed:** on the `pinned-interface` fixture, submit the same definition without `INTERFACES lif_x.`. The validator passes, nothing counts as added or removed, and the save reports `saved-inactive` while `METHOD lif_x~run.` remains.
- **Abstract changed:** `METHODS selected ABSTRACT.` keeps the old body, and removing `ABSTRACT` from a bodiless method adds no body. Neither refuses.
- **Abstract misdetected:** `class-structure.ts:474` treats any `ABSTRACT` token as the flag, so `METHODS added IMPORTING abstract TYPE i.` and `METHODS abstract.` skip the missing-body check at `class-surgery.ts:185`. The parameter case predates this checkpoint; the method-name case is new.

**Impact:**
- This is the same false success as the chain orphan just fixed.
- The interface case is newly reachable on pinned routes, because interface-implementing classes were refused at `aa4dfb14`.
- Activation should fail, and later metadata actions refuse at `src/adt/class-structure-evidence.ts:173-182` until a complete source update.
- Redefinitions are handled: removing one with a body refuses, and adding one without a body refuses.

**Fix:**
- For each `x~y` body, require `INTERFACES x` or `METHODS x~y` in the new block.
- Compare abstract state for methods that remain.
- Use `findFirstExpression(Expressions.Abstract)` to detect the flag.
- Leave newly added interfaces without bodies to SAP, since offline source can't prove which methods they need.

### 4. Low: definitive refusals still report a transport
**Where:** `src/handlers/write/pinned-result.ts:61` omits `transport` only for `unchanged`. `src/handlers/write/pinned.ts:177` feeds the same function.

**Trigger:** a 403 on the PUT for a transportable class.

**Impact:** the result has `error:"PINNED_WRITE_REFUSED"`, `state:"source-save-rejected"` and a `transport`, which can read as if the save was recorded there. `include-initialization-rejected` and `creation-rejected` behave the same way.

**Fix:** omit it for the states line 41 classifies as refused, keep it for `created-*`, and add a transportable rejection test.

### 5. Low: the namespace fallback is sound, but its tail is wider than documented and untested on handlers
**Where:** `src/adt/class-edit-boundaries.ts:52-65`.

**What holds:** it requires one statement with no colon, binds the name, and parses the tail as a method declaration. Only a throwaway copy is normalized, so submitted bytes don't change.

**Gaps:**
- `METHODS zif_service~/ns/run IMPORTING x TYPE i.` passes and reaches the PUT through `edit_method_signature`, which skips lint. The code comment describes this exception as being for redefinitions.
- The `(?:CLASS-)?` branch at `:57` can never match, because the lexer splits `CLASS-METHODS` into three tokens. This is harmless.
- Signature, delete and visibility actions on an existing namespaced declaration were refused at `aa4dfb14` and are now allowed on single-target, with no handler test. Handler coverage is one positive `add_method` case (`tests/unit/handlers/write-surgery-rap.test.ts:1641`). The negatives are helper-level only (`tests/unit/adt/class-edit-boundaries.test.ts:124-131`).
- Pinned routes still refuse these classes (`src/adt/class-source-evidence.ts:74-79`).

**Fix:** require a `[FINAL] REDEFINITION` tail, drop the dead branch, and add single-target handler tests.

### 6. Low: a bare carriage return is validated differently from what is saved
**Where:** abaplint removes every `\r` before lexing (`node_modules/@abaplint/core/build/src/abap/1_lexer/lexer.js:262`), but `src/adt/class-structure.ts:65` splits only on CRLF and LF.

**Trigger:** `METHODS selected. " x\rMETHODS neighbor.` validates as one declaration plus a comment, and is sent unchanged.

**Impact:** I don't know how SAP treats a bare CR. If it breaks the line, the neighbor declaration lands in the source. Read-back should then report `source-save-unknown` (`src/adt/source-precondition.ts:10-18`), so it wouldn't be silent.

**Fix:** refuse `\r` not followed by `\n` in all replacement text.

### 7. Low: single-target now refuses declarations abaplint can't parse, without saying why
**Where:** `class-edit-boundaries.ts:135-143`. By contrast, `config-builder.ts:107-112` deliberately demotes parser errors so such writes can proceed on releases newer than the grammar.

**Trigger:** by the grammar, `METHODS on_evt FINAL FOR EVENT evt OF zcl_x.` is `Unknown` (`node_modules/@abaplint/core/build/src/abap/2_statements/statements/method_def.js:31`, `.../expressions/event_handler.js:8`). I recall ABAP allowing it but couldn't verify that here. Single-target `edit_method_signature` accepted such a clause at `aa4dfb14`.

**Impact:** the refusal fails safe, but "Replacement must contain exactly one unchained…" is misleading and offers no remedy.

**Fix:** keep refusing, and have the message name the parser limit and point to a complete source update.

### 8. Low: important handler scenarios are still missing
- **Interface fixture:** no handler test runs any action on it; coverage is validator-only (`tests/unit/adt/class-structure-evidence.test.ts:113-127`). Add `add_method`, `delete_method`, definition replacement that keeps the interface, and the signature refusal with its hint.
- **Classic spacing:** `METHODS selected .` and `ENDCLASS .` are validator-only (`:128`). Add `add_method` end-of-class insertion through the handler, including a period on its own line.
- **Whole-include cancellation:** `tests/unit/handlers/pinned-class-includes.test.ts` has no cancellation case. The code path looks correct by reading.
- **Namespaced owner:** validator-only, so the `%2f` URL path has no handler test.

## Prior finding dispositions

| Prior finding | Disposition | Evidence |
|---|---|---|
| Medium 1: wrong-class edit | **Partly closed** | Plain source and doubly qualified selectors work; see Finding 1 |
| Medium 2: replacement not bound | **Closed for signature, add and definition; open for `edit_method`** | Name, owner and chain checks are in the shared helpers, with negatives on both routes; see Finding 2. Symmetry gaps are in Finding 3 |
| Low 3: lost refusal reason | **Closed** | `AdtSafetyError` is used for the known refusals, and pinned tests assert the messages |
| Low 4: real shapes refused | **Closed as author evidence** | Punctuation ranges and interface binding are implemented, and 7.50 is disclosed as unqualified. Native proof isn't independently verified |
| Low 5: missing tests | **Mostly closed** | Every listed row now has a test, though the namespaced class is validator-only. See Finding 8 |
| Low 6: transport on no save | **Mostly closed** | `unchanged` is fixed; rejected states remain (Finding 4) |
| Low 7: public docs | **Mostly closed** | Convergence is at `docs_page/roadmap.md:216`, and the language and historical wording are fixed. The duplicate claim is wrong (Finding 1) |

## Assessment of your questions

**Sound by reading and the passing suite:**
- **Old-text binding:** whole-line guards refuse neighbors, shared lines and individual chain edits.
- **Chains:** single-member and multi-member chains refuse, and insertion after a verified final member works. abaplint's line-splitting of `Unknown` statements loses the colon, but it always produces at least two statements, so the guards still refuse (`node_modules/@abaplint/core/build/src/abap/2_statements/statement_parser.js:145-173`).
- **Boundary grammar:** newest release with the normal language, and the shared config object is safe to reuse. Lint keeps its own configured version. `method-surgery.ts` still defaults to Cloud, but method header parsing is only restricted for key-user language (`.../statements/method_implementation.js:15`), so I found no issue.
- **Native XML:** it binds the source through ranges, plus owner, method and interface identifiers, inventory, visibility, level and flags. Interface-body `level` is only checked to be a valid value, because the source can't prove it. `final` and `constructor` aren't compared, and the surgery doesn't use them.
- **Direct interface bodies:** they need an exact body and a direct `INTERFACES` declaration, never become `METHODS`, and foreign links refuse. No returned URI is followed.
- **Range endpoints:** they match the period or comma start, including whitespace before it. The public 7.50 XML fits this arithmetically (`CLASS_CONSTRUCTOR` identifier ends at 33, block at 34), but it has no source to confirm against.
- **Quality exceptions:** signature edits and whole-include writes skip lint as documented, and whole-include writes also skip the advisory syntax check. Both skips are tested with both checks enabled. Other main-source metadata actions keep configured lint.
- **Empty and hash handling:** only `source=""` plus a hash clears an include. `update` PUTs `""` and the definition action PUTs `"\n"`, as documented. Live behavior for `"\n"` is unproven.
- **Initialization and partial outcomes:** initialized, rejected, unknown and read-back states are correct, and hashes appear only after confirmation.
- **No-op cleanup:** an unlock or close failure returns an error with `unchanged`, the failed phase and no PUT.
- **Shared lifecycle:**
  - Legacy cache-error behavior is preserved and tested (`tests/unit/handlers/class-surgery-concurrency.test.ts:191`, `tests/unit/handlers/edit-unit-concurrency.test.ts:204`).
  - Lock, fresh hash, one save, read-back, package and recording rechecks, no-replay HTTP and owning-session unlock all hold on pinned routes.
  - Procedural editing has no pinned capability row and refuses an unregistered context.
  - `handlePinnedWrite` no longer refuses `create` or `delete` with `include` itself. The route test still shows refusal before SAP I/O (`pinned-class-includes.test.ts:364-377`).
- **Security and performance:** I found no new authorization bypass or specific regression. There are more synchronous parses per action, and main source remains unbounded. No benchmark was run.

**Not determined:** whether SAP's PUT or activation rejects each bad payload, and how it treats a bare CR.

## Checks and snapshot integrity

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first, alone) | **Unchanged**, 4,243 files, revision `cee2a18e…` |
| `npm exec -- vitest run --silent=true` | **Pass:** 432 files, 11,783 tests |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 (20 formatter, 39 deletion) |
| `npm run typecheck` | **Pass:** all three projects, no diagnostics |
| `npm run check:sizes` | **Pass:** 878 files, all schema scenarios in budget |
| `python3 review-input/verify-snapshot.py` (last, alone) | **Unchanged**, 4,243 files; nothing was read after it |

From the manifest, I also confirmed two things:
- The verbatim prior review has the stated hash `69dc1f9a…`.
- The receipt's four validator-file hashes match this revision. That ties the receipt to these files but doesn't verify the replay.

## Evidence limits
- **Live:** I made no SAP, CF, browser or external network request. The `77e41fdcd` run doesn't qualify these bytes.
- **Native captures:** raw source and XML are withheld, so I can't verify their hashes or the 33/53, 7/7 and 12-method results. The receipt remains an author observation.
- **Fixtures:** the public chain and interface fixtures are authored. The private-section interface shape in particular has no native backing here.
- **Releases and simulations:** 7.50 remains unqualified, and the simulations don't exercise the new metadata mutations.
- **From memory:** the Pretty Printer comment shape and the validity of `FINAL FOR EVENT`.
- **Snapshot history:** the manifest proves the snapshot, not that `followup.diff` is complete. I also read the affected current source directly.
- **Author-reported only:** the build, lint, policy and strict-docs results.

## Deviations
- **Refused read:** one `Read` of `docs_page/roadmap.md` left out `source/` and pointed outside the working directory. It was refused and returned nothing, and I reissued it with the correct path.
- **Failed searches:** one `Grep` named a test file that doesn't exist, and one used an unsupported regex. Both returned nothing.
- **Outside the working directory:** besides that refused read, only `Grep` of my saved Vitest output, which your exception allows.
- **Internal Git:** the verifier runs read-only `git ls-files`. `check:sizes` reports tracked files, so it probably does too; I didn't read that script.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so "max" is unconfirmed by me.
- **Otherwise none:** no edits, installs, delegation, operator scripts, mutants, direct git, background shells or ad hoc scripts.