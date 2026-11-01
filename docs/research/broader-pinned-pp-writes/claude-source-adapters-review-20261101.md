# PR #1142 at `10b131e9`: continue, but fix three Medium findings before freezing a live artifact

**Decision:** keep developing from this checkpoint, but don't freeze new live bytes until Findings 1–3 are fixed and reviewed. I found no stale save, save outside the lock, replay or read-only bypass. **The PR stays draft and FEAT-93 stays open.**

- **Findings:** no High, 3 Medium, 6 Low. Two of the Mediums are false refusals introduced by the fixes for my last review.
- **Prior findings:** all eight of the reported defects are fixed, but Medium 3 remains partly open because the symmetry fix has new gaps.
- **Checks:** all allowed commands passed, with 434 files and 11,860 tests, matching the author's counts. The snapshot was unchanged at the first and last verifier runs.
- **How the findings were reached:** by reading ARC-1 and the abaplint source. Ad hoc scripts were barred, so **I executed no failing case for any finding**.
- **Live status:** nothing here is live or PP evidence for these bytes.

## Findings

### 1. Medium: the escape guard refuses ordinary assignments on every route
**Where:** `src/context/method-surgery.ts:306-312`. The regex at `:309` matches the statement's first word, whatever kind of statement it is.

**Trigger:** any `edit_method` where the old or new body contains a statement like one of these:
```abap
program = sy-repid.
class = 'ZCL_X'.
function = 'Z_FM'.
```
- The same applies to `form`, `module`, `report` and `interface` when whitespace follows the name, including `?=`.
- Parsed body statements such as `CLASS zcl DEFINITION LOAD.` and `INTERFACE zif LOAD.` (both in `.../3_structures/structures/normal.js:44-45`) also match.

**Impact:**
- `methodBoundaries` runs on the existing method too (`:372`), so a method already containing such a statement can't be edited at all.
- The error says "Put neighboring statements on separate lines" (`:379`), which is wrong and gives no way forward.
- This regresses shipped single-target `edit_method`. It refuses safely and sends no PUT. No test covers it.

**Fix:** use the statement type (`Statements.ClassDefinition`, `EndClass`, `Form` and so on). Apply a keyword-shaped text check only to `Unknown` statements, because the default Cloud grammar makes `FORM`/`MODULE` `Unknown`. Add positive tests for these assignments and keep the current escape tests.

### 2. Medium: definition symmetry reports a removed interface that wasn't removed
**Where:** `src/adt/class-structure.ts:471` and `:508-511`.

**Trigger A, chained interfaces (both routes):** a no-op `edit_class_definition` on this class:
```abap
PUBLIC SECTION.
  INTERFACES: lif_a, lif_b.
...
METHOD lif_a~run.
```
abaplint splits the chain and keeps the comma (`statement_parser.js:327-329`). The regex therefore stores `LIF_A,` and `interfaces.has('LIF_A')` is false.

**Trigger B, composite interfaces (single-target):** `INTERFACES zif_child.`, where `zif_child` includes `zif_parent`, with the legal body `METHOD zif_parent~run.` Source alone can't show that relationship, so the check refuses. On pinned, `class-structure-evidence.ts:173-182` should refuse first with a different message, assuming the native XML lists such a body as `ZIF_PARENT~RUN`. I have no capture of that shape.

**Impact:** an unchanged definition is refused with "removes the interface declaration", which is false. Single-target `edit_class_definition` accepted both shapes before this checkpoint, and no test covers either.

**Fix:**
- Read `Expressions.InterfaceName`, as `class-source-evidence.ts:61` already does.
- Refuse only when an interface present in the **old** definition is missing from the new one, which also handles Trigger B.
- Add tests for both shapes.

The same comma appears in `src/context/method-inventory.ts:48` and `:52`. For `METHODS: foo, bar.`, `SAPRead(method="*")` lists a phantom `foo,`, and `foo`'s body falls back to the default signature and public visibility. That predates this checkpoint, but the rewrite kept it.

### 3. Medium: "standalone" PROG/INCL is claimed but never enforced
**Where:** the claim is at `docs_page/multi-target-writes.md:130-131` and `src/server/multi-target-tools.ts:146`. Admission is at `src/handlers/write/pinned-source-input.ts:16-23` and `src/adt/pinned-write-policy.ts:54-60`, and only refuses `group` and invalid names.

**Trigger:** `SAPWrite(action="edit_unit", type="INCL", name="LZFOOF01", ...)` with no `group`. `update`/`add_unit` and `SAPLZFOO` as a PROG pass the same check. As I recall, `SAPL*` is the function-pool main program prefix.

**Impact:**
- Nothing checks owner, container or object type. Preflight only checks package and recording (`pinned-source-context.ts:74-93`).
- If SAP serves that URL with a package, the adapter locks and saves a function-group include through `/programs/includes/`. That function-group path is what this draft says is still pending.
- Activation isn't available on this route, so an inactive draft in the function group could be left behind.
- The package and transport checks still apply, so this isn't an authorization bypass.

**Evidence from the repo:**
- `src/handlers/activate.ts:394-398` calls this path an "alias" and records a 7.50 activation failure.
- `src/handlers/write.ts:182-188` guards `L*` names only for legacy create/delete.
- `src/handlers/write-helpers.ts:944-948` suggests the alias can return no package, which would fail closed at preflight.

**Not determined:** whether SAP accepts this on any release. That needs a native capture.

**Fix:**
- Refuse `L*`, `/NS/L*` and `SAPL*` names now.
- Add a native owner check from the object metadata, built from a real capture.
- Add handler tests for function-group shapes. The new test list has none.

### 4. Low: one unparsable METHOD header blocks all method reads and edits on that class
**Where:** `src/context/method-inventory.ts:24-28`. abaplint's `MethodName` rejects a namespaced right-hand side (`.../expressions/method_name.js:7`), so the statement is `Unknown`.

**Trigger:** a class containing `METHOD zif_service~/ns/run.`, then `SAPRead(method="*")`, `SAPRead(method="other")` or `edit_method(method="other")`.

**Impact:** all three worked through the removed regex fallback and now fail, including on read-only routes. "Use a complete source update" is the wrong advice for a read. No test asserts the message.

**Fix:** accept this exact shape by token, as `class-edit-boundaries.ts:58` does for declarations. Refuse only when the selected method can't be bounded, and give reads their own message.

### 5. Low: declaration-only entries change how names resolve
**Where:** `src/context/method-surgery.ts:155` and `:189`, using entries added at `method-inventory.ts:93-94`.

**Triggers:**
- **False ambiguity:** in one source, `lcl_base` declares `METHODS run ABSTRACT.` and `lcl_child` has the only `METHOD run.` A bare `run` now reports "Multiple local classes define it". `lcl_child~run` still works.
- **Lost fuzzy match:** `METHODS value ...` with only `METHOD zif_example~value.` now reports not found for `value`.

**Impact:** both refuse safely, but both worked before. The test at `tests/unit/context/method-splice-boundaries.test.ts:83-85` was rewritten to avoid the second case rather than assert the new behavior, and the research doc doesn't mention it.

**Fix:** count only entries with real line ranges when checking ambiguity and exact matches, then fall back to declarations for the not-found message. Assert the chosen behavior explicitly.

### 6. Low: statements after `ENDFORM` pass the "exactly one block" guard
**Where:** `src/context/unit-surgery.ts:132-135` and `:146-153`.

**Trigger:** `edit_unit` or `add_unit` with:
```abap
FORM selected.
ENDFORM. PERFORM foreign. " ENDFORM.
```
The terminator regex matches the comment. There is one unit, and it ends on the last line. `DATA endform.`, or a local class on the same line, passes the same way.

**Impact:** extra program-level statements are saved even though the error text and docs promise one complete block. The caller could already write any code through `update`, so this crosses no authorization boundary. The check predates this checkpoint but is newly reachable on pinned. `edit_method` is stricter because it requires the last statement to be `ENDMETHOD`.

**Fix:** have `replacementError` use the located end column, and allow only whitespace after it. Add the `MODULE` equivalent.

### 7. Low: abstract symmetry covers `METHODS` only
**Where:** `src/adt/class-structure.ts:508-516` ignores interface options (`.../statements/interface_def.js:11`). `src/handlers/write/class-surgery.ts:292` and `:334-339` trust only the `abstract` argument.

**Triggers:**
- `INTERFACES lif_x.` changed to `INTERFACES lif_x ABSTRACT METHODS run.` or `ALL METHODS ABSTRACT`, keeping the body. The reverse change leaves no body.
- `add_method(method="METHODS x ABSTRACT.")` without the flag inserts a stub. `add_method(method="METHODS x.", abstract=true)` omits it.

**Impact:** the save reports `saved-inactive`, and activation should then fail, though that isn't proven here. `docs_page/multi-target-writes.md:133` overstates the check by promising refusal of "changes to ABSTRACT that need a body change".

**Fix:** compare the interface options for interfaces that remain. Derive the `add_method` state from `Expressions.Abstract` and refuse when it disagrees with the flag.

### 8. Low: BTP narrowing can't be reached in production
**Where:**
- `src/server/multi-target-write-surface.ts:42-48` is the gate.
- `src/server/multi-target-runtime.ts:65` hardcodes `systemType: 'onprem'`, and `buildMultiTargetConfig` keeps that value.
- `src/server/destination-registry.ts:427-434` requires `ProxyType=OnPremise`.

**Impact:** nothing is at risk today. But the "BTP refusal" evidence comes from configs forged at `tests/unit/handlers/pinned-procedural-source.test.ts:265` and `tests/unit/server/pinned-mutation-capabilities.test.ts:229` and `:235`. The tool description also still mentions PROG/INCL whatever the system type.

**Fix:** describe the gate as defensive only and drop "BTP refusal" from the evidence. If BTP targets are ever planned, derive the type from the target and test through `buildMultiTargetConfig`.

### 9. Low: test gaps beyond the findings above
- **Malformed inventory boundaries:** none of the inventory's refusal messages (`method-inventory.ts:11`, `:28`, `:30`, `:38`, `:69`, `:71`, `:74`, `:92`) appears in any test, and the new regression file has no malformed-boundary case. I didn't measure branch coverage, so a test could still reach those paths by asserting failure only.
- **Procedural quality and cancellation:** `pinned-procedural-source.test.ts` has no `lintBeforeWrite: true` case and no cancellation case. `edit_unit` lint runs at its own call site (`src/handlers/write/unit-surgery.ts:53-54`), so the metadata route's tests don't cover it.
- **Read-to-write path:** that file computes hashes directly instead of reading through `SAPRead(format="editable")`.
- **Assertions inside mocks:** `expect(locked)` inside the fetch mock throws into the handler, so it can't fail a test that expects refusal. Only the positive tests enforce lock order.
- **Unrealistic INCL metadata:** the INCL mock returns a `program:abapProgram` root (`:68-72`), so it can't support the ownership check Finding 3 needs.

## Prior finding dispositions

| Prior finding | Disposition | Evidence |
|---|---|---|
| Medium 1: formatting-hidden ambiguity | **Closed** | All reported shapes and single-class duplicates are tested. Both routes refuse at the handler for three body shapes, each with the annotated class header. Side effects are in Findings 4 and 5 |
| Medium 2: replacement escape | **Closed for the reported escape** | Body-only and complete-block escapes refuse on both routes with no PUT. The guard is too broad (Finding 1) |
| Medium 3: definition symmetry | **Partly closed** | Every reported trigger now refuses and `Expressions.Abstract` is correct, including the `testing` and event-handler paths in `method_def.js:14` and `:31`. See Findings 2 and 7 |
| Low 4: transport on refusal | **Closed** | `pinned-result.ts:61-65` omits it for all refused states and keeps it for `created-*` and uncertain states |
| Low 5: namespace tail | **Closed** | The tail is exact and the dead branch is gone. **My prediction was wrong:** deletion refuses because `METHOD zif~/ns/run.` is `Unknown` (`class-edit-boundaries.ts:103`), as the author found |
| Low 6: bare CR | **Closed** | All structural parsers refuse it. Whole-source updates rely on exact read-back, as documented |
| Low 7: parser limit message | **Closed** | The message names the parser and gives the remedy |
| Low 8: handler coverage | **Mostly closed** | Interface, spacing, split `ENDCLASS`, namespaced owner and cancellation cases run through the handler. Remaining gaps are in Finding 9 |

The newly admitted cancellation reporting issue is **fixed** by my reading. Checks run before the state changes, and `created-include-source-not-saved` appears only after initialization, with no hash.

## Assessment of your questions

**Sound by reading and the passing suite:**
- **Shared update:** the single-target path passes the same arguments to `safeUpdateSource` as before, and cache invalidation is unchanged. The pinned branch is gone and its checks now live in the shared lifecycle.
- **Hash and read under lock:** `pinned-source-lifecycle.ts:28-37` checks the hash on fresh bytes for the exact admitted URL, and it allows one save only.
- **Drift:** package and recording are rechecked under the lock (`pinned-lock.ts:25-39`). The tests also cover local-to-recorded drift.
- **HTTP:** every session call, including the syntax check, goes through the bounded no-replay facade (`mutation-http.ts:43-57`). Unlock uses its own budget.
- **Quality timing:**
  - Whole-source lint runs before the lock, on submitted text.
  - Procedural lint and pinned syntax checks run under the lock, on fresh bytes.
  - Lint skips for signature and include edits, and the syntax-check skips for includes, are unchanged.
  - No per-call override reaches pinned.
  - Advisory warnings are retained only after read-back.
- **Transport:** the verified parent request is used on save, and refused states omit it.
- **Admission:** the raw-field gate, read-only, Basic and aggregate rules are unchanged (`multi-target-runtime.ts:107-116`).
- **`ENDCLASS` insertion:** the row arithmetic is correct and split statements are preserved.
- **Procedural boundaries:**
  - A boundary shared with another statement refuses.
  - Macro-generated FORMs refuse because their virtual columns leave text on the line. Method macros refuse on re-parse.
  - abaplint drops `Unknown` statements from structure matching (`structure_parser.js:47-52`). A macro from another include therefore doesn't block editing, while a broken FORM boundary leaves the pair unmatched and refuses.
  - Unterminated `MODULE`s are caught by the count at `unit-surgery.ts:95`.
- **Escape guard strength:** apart from Finding 1, it holds. Line-splitting exposes `ENDCLASS`, and an unterminated statement can't close a class in SAP's own parsing.

**Performance:** I found no specific regression, and removing the old per-method `split` helps. A method splice still does three parses and a unit edit two, plus lint when enabled, all synchronously on the event loop. PROG sources can be larger than classes and input size isn't capped (`schemas.ts:324`). I ran no benchmark, so qualification should measure a large program.

**Not determined:**
- SAP's behavior on `/programs/includes/` for function-group includes.
- Whether SAP's PUT or activation rejects the broken payloads.
- Native PROG/INCL read bytes under the two different `Accept` headers.

## Checks and snapshot integrity

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first, alone) | **Unchanged**, 4,251 files, revision `10b131e9…` |
| `npm exec -- vitest run --silent=true` | **Pass:** 434 files, 11,860 tests |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 (20 formatter, 39 deletion) |
| `npm run typecheck` | **Pass:** all three projects, no diagnostics |
| `npm run check:sizes` | **Pass:** 884 files, all schema scenarios in budget |
| `python3 review-input/verify-snapshot.py` (last, alone) | **Unchanged**, 4,251 files; nothing was read after it |

## Evidence limits
- **Live:** I made no SAP, CF, browser or external network request. The `77e41fdcd` run doesn't cover these bytes.
- **Simulations:** the 59 runs exercise the older formatter and deletion harness, not the new class or procedural operations.
- **Fixtures:** all public source and XML is authored, and PROG/INCL HTTP behavior is mock-only. `tests/integration/edit-unit-edge.integration.test.ts` exists, but I didn't run it.
- **Native captures:** raw SAP captures remain private, so I can't verify earlier receipts. The `PROGNAME` CHAR 40 result stays an author observation.
- **From memory:** the `SAPL*` prefix, and that interface-level `ABSTRACT METHODS` conflicts with an existing body.
- **Snapshot history:** the manifest proves the snapshot, not that `followup.diff` is complete. I also read the affected current source directly.
- **Author-reported only:** the build, lint, policy and strict-docs results.

## Deviations
- **Extra verifier run:** I ran the verifier a second time in the same batch as other reads, which breaks "first by itself". I also gave it a meaningless description ("Placeholder removed") and a 1-second timeout. It was read-only and returned the same unchanged result. The true first and last runs were alone.
- **Refused out-of-root attempts:** one `Read` and one `Grep` left out `source/` and pointed outside the working directory. Both were refused and returned nothing. I reissued the `Grep` correctly and didn't need the `Read`.
- **Failed search:** one `Grep` named `docs_page/metadata.md`, which doesn't exist at that path, and returned nothing.
- **Outside the working directory:** otherwise only `Grep` of my saved Vitest output, which your exception allows.
- **Internal Git:** `check:sizes` reports tracked files, so it probably uses Git internally, and the verifier may too. I read neither script.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so "max" is unconfirmed by me.
- **Otherwise none:** no edits, installs, delegation, operator scripts, mutants, direct git, background shells or ad hoc scripts.