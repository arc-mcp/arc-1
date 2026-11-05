# PR #1142 at `7af4069a`: continue, but fix two Medium findings before freezing a live artifact

**Decision:** keep developing from this checkpoint, but don't freeze new live bytes until Findings 1 and 2 are fixed and reviewed. I found no stale save, save outside the lock, replay, read-only bypass or context forgery. **The PR stays draft and FEAT-93 stays open; this isn't final PR acceptance or a live artifact freeze.**

- **Findings:** no High, 2 Medium, 10 Low. Finding 1 is a false refusal on the new ownership check. Finding 2 is an incomplete fix for my earlier Low 7, and it adds a new single-target regression.
- **Prior findings:** of the 3 Medium and 6 Low, 4 are closed, 3 are closed for their reported triggers with new side effects, and 2 are only partly closed (table below).
- **Checks:** all allowed commands passed, with 435 files and 11,928 tests, matching the author's counts. The snapshot was unchanged at the first and last verifier runs.
- **How the findings were reached:** by reading ARC-1, abaplint and committed fixtures. Ad hoc scripts were barred, so **I executed no failing case for any finding**.
- **Live status:** nothing here is live or PP evidence for these bytes.

## Findings

### 1. Medium: ordinary single-use includes are refused as if they were function-group sources
**Where:** `src/handlers/write/pinned-program-owner.ts:35`. It requires a PROG/P context URI ending in `/source/main`.

**Evidence:** the repo's own A4H capture has no such suffix:
```xml
<include:contextRef adtcore:uri="/sap/bc/adt/programs/programs/prog_enh_subobj_check" adtcore:type="PROG/P" .../>
```
- **Fixture:** `tests/fixtures/extensions/source/incl-metadata-a4h.xml:1`, with provenance in `README.md:3` and `:22-23`. It has `contextRefCount="1"`.
- **New receipts:** they contain no returned PROG/P context. The only returned context is FUGR/I, which does end in `/source/main` (`program-owner-shapes-readonly-20261101.json:38`). `RSDBCOM4`, with a count of 20, returned none (`:73-75`).
- **Pattern:** one context is returned at count 1 and none at count 20. Counts 2–19 are not determined.

**Trigger:** `SAPWrite(action="update"|"edit_unit"|"add_unit", type="INCL")` on a standalone include that reports exactly one using program.

**Impact:**
- It refuses at preflight, before the lock, so nothing is unsafe and no PUT is sent.
- It likely blocks the common include used by one program, which qualification would hit.
- The error blames "Function-group, generated or ambiguous container sources", which is wrong.

**Why tests missed it:** the positive INCL mock never returns a context, and the only context fixture is FUGR (`pinned-procedural-source.test.ts:81-86`). The acceptance branch has no test.

**Fix:**
- Accept `^/sap/bc/adt/programs/programs/[^/]+(?:/source/main)?$`, or drop the URI check, since contexts aren't followed and the type check already refuses FUGR.
- Run this fixture verbatim through the handler, and add a multi-context array case.

### 2. Medium: `add_method` reads abstractness before adding the missing period
**Where:** `src/handlers/write/class-surgery.ts:293-298` parses the raw clause. `ensureClauseTerminator` only runs later (`src/adt/class-structure.ts:244`). abaplint only matches statements ending in punctuation (`statement_parser.js:233-236`), so `METHODS x ABSTRACT` stays `Unknown` and `Expressions.Abstract` is absent (`class-structure.ts:548`).

Both triggers apply on both routes:

| Call | Result | Was it this way before? |
|---|---|---|
| `add_method(method="METHODS x ABSTRACT")` | Declares ABSTRACT, inserts a `METHOD x` stub, reports `saved-inactive` | Yes, earlier Low 7 still applies to this input |
| `add_method(method="METHODS x ABSTRACT", abstract=true)` | Refused: "abstract flag must match ABSTRACT", with no PUT | **No, this checkpoint regressed it** |

**Impact:**
- Omitting the period is a supported input, added for issue #536. The new docs promise a stub "only for a concrete method" (`docs_page/multi-target-writes.md:135`).
- The first case should fail activation, though that isn't proven here.
- The second case's message doesn't explain the real cause.
- All tests use clauses with a period (`pinned-class-metadata.test.ts:578`, `:584`; `write-surgery-rap.test.ts:1765`).

**Fix:** use `parseDefinitionBlockDeclarations(ensureClauseTerminator(clause))`, and test both calls without a period on both routes.

### 3. Low: removing a composite interface is no longer refused on single-target
**Where:** `src/adt/class-structure.ts:512-517`. `parseClassStructure` drops bodies with no definition range (`xml-parser.ts:1515`), so `diff.removed` can't catch this either.

**Trigger:** old `INTERFACES zif_child.` with body `METHOD zif_parent~run.`, where the new definition drops the interface. `ZIF_PARENT` isn't a direct old declaration, so the check passes.

**Impact:** the orphan body is saved inactive. This checkpoint's narrowing removed the old refusal. Pinned should still refuse first, if native XML lists the body as I expect, which I have no capture for.

**Fix:** if any direct interface was removed, refuse any `~` body whose interface isn't declared by the new definition.

### 4. Low: `edit_method_signature` can flip ABSTRACT
**Where:** `src/handlers/write/class-surgery.ts:255` and `src/adt/class-structure.ts:183-193`. `edit_class_definition` refuses the same change (`class-structure.ts:487`).

**Trigger:** `edit_method_signature(method="run", source="METHODS run ABSTRACT.")` on a concrete method with a body, or the reverse, on either route.

**Impact:** a draft that should fail activation. This predates the checkpoint, but the symmetry guarantee has a side door.

**Fix:** compare `Expressions.Abstract` with `method.abstract` and refuse with the existing message.

### 5. Low: the `L*` name guard also refuses ordinary namespaced programs
**Where:** `src/adt/pinned-write-policy.ts:59`.

**Trigger:** `PROG /NS/LOAD_DATA`.

**Impact:** a false refusal. The error points to a "dedicated adapter" that wouldn't apply. This came from my own earlier suggestion and is documented, but it's broader than needed now that PROG/P metadata is checked.

**Fix:** keep `SAPL*` for both types and `L*` for INCL, and let `/programs/programs/` rely on the native PROG/P and program-kind check. Widen further only with more function-group captures.

### 6. Low: the replacement guard accepts boundary-shaped statements the inventory refuses
**Where:** `src/context/method-surgery.ts:335-338` compared with `src/context/method-inventory.ts:46-53`.

**Trigger:** an `edit_method` body containing `ENDMETHOD foo.` or `METHOD other extra.`, with lint off or on the include route, where lint is skipped (`class-surgery.ts:122`).

**Impact:** the save succeeds, then every method read and edit on that source refuses until a complete update. From memory, SAP treats these as syntax errors, so this should be a broken draft rather than an escape.

**Fix:** add `METHOD\b|ENDMETHOD\b` to the `Unknown` fallback, keeping the exact namespaced header allowed.

### 7. Low: qualified selectors lost the declaration-only message
**Where:** `src/context/method-surgery.ts:256-261`.

**Trigger:** `lcl_demo~execute` where only `METHODS execute.` exists, or a bare name matching only a declaration-only `zif~name`.

**Impact:** a generic "not found" instead of "declared without an implementation". The doc says declarations remain available for this guidance (`docs/research/2026-11-01-pinned-source-adapters.md:149-150`). The test calls the helper directly and misses this path (`tests/unit/context/method-suggestions.test.ts:95-97`).

**Fix:** look declarations up by qualified and unique-suffix match too, and test through `extractMethod`.

### 8. Low: the docs overstate namespaced-header edits and read guidance
**Where:** `docs/research/2026-11-01-pinned-source-adapters.md:143-146`.

**Trigger:** a main-source `edit_method(method="other")` on a class containing `METHOD zif_service~/ns/run.`, with default `lintBeforeWrite: true`.

**Impact:**
- The `Unknown` header should raise a blocking `parser_error` (`src/lint/config-builder.ts:116`, `parser_error.js:44-55`). Only `spliceMethod` is tested (`method-inventory-regressions.test.ts:62-70`), and another test turns lint off for this syntax (`write-surgery-rap.test.ts:1640-1641`).
- Pinned has no per-call override (`pinned-source-context.ts:73`), so reads are fixed but default main-source edits aren't.
- Only one of the six malformed-boundary errors actually gives read guidance, despite the test title (`method-inventory-regressions.test.ts:81-92`).

**Fix:** correct the claim and add a handler test with lint on. Decide separately whether this exact header should be exempt from lint.

### 9. Low: public guidance is stale
| Where | Problem |
|---|---|
| `src/handlers/tools.ts:620`, `:691`; `docs_page/tools.md:644` | Still say `abstract=true` skips the stub and that the default is `false`. A caller following this with `METHODS x.` is refused |
| `src/handlers/write/class-surgery.ts:201`, `:206` | Tell callers to add or remove `METHOD` blocks in the new source. `diffMethodSets` refuses anything outside the DEFINITION block (`class-structure.ts:480`), so that advice can't work |

**Fix:** reword both, and regenerate the tool-definition fixtures.

### 10. Low: owner evidence is checked less strictly than class evidence, and read twice
**Where:** `src/handlers/write/pinned-program-owner.ts:11` and `:18`. The class adapter rejects DOCTYPE and validates XML first (`class-structure-evidence.ts:41`). `resolveObjectPackage` then fetches the same URL and regex-parses it (`src/adt/client.ts:1691-1692`).

**Impact:**
- Each procedural write makes four metadata GETs, two before the lock and two under it.
- Two parsers read the same evidence.
- I couldn't determine whether truncated XML would parse as "no contexts", because `fast-xml-parser` sits outside the readable tree.

**Fix:** validate the XML as the class adapter does, return the verified package from one read, and run `checkPackage` on it.

### 11. Low: cleanup reporting is inconsistent
- **Wrong wording:** `src/adt/pinned-delete.ts:146-147` says "Unlock succeeded" even if LOCK was refused and only the session close failed.
- **Different shape:** source paths report a close-only failure through `phase` and `sessionClosed`, but not `cleanupFailed` (`src/handlers/write/pinned-result.ts:66-74`). Delete sets `cleanupFailed: true`. A caller checking that one field would miss it.

**Fix:** only mention unlock if a lock existed, and set `cleanupFailed` the same way on both paths.

### 12. Low: test gaps
**Assertions inside mocks are back in the new create tests:**
- The pattern is at `pinned-source-create.test.ts:64`, `:72`, `:84-85`, `:92-93` and `:98`.
- The positive CLAS/INTF cases do surface a violation.
- The `package`, `initial-read` and cancellation rows assert only the state, which any failure after the POST would also produce.
- The doc's claim about this (`:160-161`) is only true of the procedural file. Those rows should also assert `phase`, `statusCode` and the message.

**Missing cases:**
- **Create:**
  - recording drift under the new owner's lock;
  - cancellation before the POST;
  - `corrNr` on the POST;
  - real abaplint (`:184` mocks it with lint off);
  - a real `/checkruns` under the lock (`:174` spies on it).
- **Owner check:** PROG/P context acceptance, context arrays, and the native/resolver package disagreement guards (`pinned-source-context.ts:90-91`, `pinned-lock.ts:37`).
- **Definition symmetry:** chained and composite interfaces are tested only on the pure function (`class-structure.test.ts:614-633`), not through the handler on either route.

## Prior finding dispositions

| Prior finding | Disposition | Evidence |
|---|---|---|
| Medium 1: escape guard false refusals | **Closed** | Statement kinds are used, with the keyword fallback limited to `Unknown`. Tests run at v758 and, through both handler routes, under the default grammar. Residual in Finding 6 |
| Medium 2: false interface removal | **Closed for the reported triggers** | Names come from AST expressions and the check uses old direct declarations. The comma phantom in the inventory is gone. Side effect in Finding 3 |
| Medium 3: standalone unenforced | **Partly closed** | Names and owner identity are enforced before and under the lock, and I found no write path to a function-group alias. The false refusal is in Finding 1 |
| Low 4: unparsable METHOD header | **Closed for reads and pure splice** | Finding 8 covers default-lint edits |
| Low 5: declaration-only resolution | **Closed for the reported triggers** | False ambiguity and the lost fuzzy match are fixed. Side effect in Finding 7 |
| Low 6: statements after `ENDFORM` | **Closed** | The end-token column, line count and unit count all hold. Tests cover both unit kinds and both operations |
| Low 7: abstract symmetry | **Partly closed** | Interface modes are compared in both directions and contradictory flags refused. Finding 2 remains |
| Low 8: BTP narrowing | **Closed** | Described as defensive, the catalog text follows it, and the evidence wording is relabeled |
| Low 9: test gaps | **Mostly closed** | Malformed boundaries, procedural lint and cancellation, read-to-write hash and the `abapInclude` shape are covered. Remaining gaps are in Finding 12 |

## Assessment of your questions

**Sound by reading and the passing suite:**
- **Create convergence:**
  - The XML, `application/*` content type, single POST and `corrNr` match the removed orchestrator.
  - Lint now runs after the package and recording checks but still before the POST.
  - 5xx, 429 and network failures stay `creation-unknown`, because `postCreate` marks them before any error conversion.
  - The new initial read is discarded after its checks, and `expectedSourceHash` on create is refused at the raw-field gate.
- **State and result handling:**
  - Every failure phase I traced keeps its exact partial or unknown state, with no unverified hash.
  - The `transport` field is omitted only on definitive refusals.
  - Errors from `writeActionCreate` can only be returned before the POST for CLAS/INTF.
- **Context forgery:** the mutation context comes from a `WeakSet`, the pinned state from a `WeakMap` on a frozen context, and a single-target context is refused on a multi-target client. `saveCreatedSource` has no `createdOwner` guard, but it can only be reached after the POST today.
- **Delete:** the strict adapter is selected after the operation check. A close failure no longer reports success, and the primary state and phase survive.
- **Single-target:** `prepareCreationRecording`, `createRepositoryObject`, `saveCreatedSource` and `writeActionDelete` keep the legacy arguments and order. Finding 2 is the regression I found, and Findings 3 and 7 are smaller behavior changes.
- **Protections:** `multi-target-runtime.ts`, `dispatch.ts` and `write.ts` aren't in this diff. Hash and fresh read under lock, package and recording rechecks, bounded non-replayable HTTP and cancellation all stay in the shared lifecycle.
- **Ownership shapes:** exact root, name, type, DEVC/K package, program kind and container checks agree with the committed NPL and A4H fixtures and with the receipts. No check depends on `contextRefCount`, and returned contexts aren't followed.

**Architecture:**
- The convergence is a net improvement, and the duplicate orchestrator is gone.
- `writeActionCreate` still has branches that open their own locked sessions (MSAG, DTEL, TTYP). Only `assertPinnedOwner` keeps them unreachable on pinned, so the next family admission needs an explicit refusal there.
- `class-structure.ts` now imports from `context/`, and the namespaced-header regex exists in three places. Both are minor.

**Performance:**
- My benchmark run closely matched the committed sample: 5,000 FORMs took 63 ms to splice and 145 ms to lint, at about 199 MB RSS.
- I found no regression beyond the two extra metadata GETs per procedural write in Finding 10.
- The benchmark doesn't cover method splices, definition edits (several parses), real program shapes, large inputs or concurrency.

**Not determined:**
- Whether SAP's initial `GET source/main` before the first PUT succeeds on a new CLAS or INTF. It's a new step and has never run live.
- Whether SAP's PUT or activation rejects the broken payloads described above.
- SAP's PROG/INCL read bytes under different `Accept` headers.

## Checks and snapshot integrity

| Command | Result |
|---|---|
| `python3 review-input/verify-snapshot.py` (first, alone) | **Unchanged**, 4,259 files, revision `7af4069a…` |
| `npm run typecheck` | **Pass:** all three projects, no diagnostics |
| `npm exec -- vitest run --silent=true` | **Pass:** 435 files, 11,928 tests |
| `npm run check:sizes` | **Pass:** 888 files, all schema scenarios in budget |
| `npm run test:qualification:pr1142` | **Pass:** 59 of 59 |
| `node --import tsx …/source-parse-benchmark.mts` | **Ran once**, three samples, all with lint not blocked |
| `python3 review-input/verify-snapshot.py` (last, alone) | **Unchanged**, 4,259 files; nothing was read after it |

The four source and script hashes recorded in the benchmark JSON match the manifest.

## Evidence limits
- **Live:** I made no SAP, CF, browser or external network request. Run `77e41fdcd` doesn't cover these bytes, and the 59 simulations exercise the older formatter and deletion harness, not the new native adapters.
- **Native shapes:** the receipts and `incl-metadata-a4h.xml` are sanitized author observations from one system. Raw XML stays private, so I can't verify them independently. The receipts also aren't write or PP qualification.
- **Fixtures:** all new PROG/INCL and create behavior is mock-only, using authored XML.
- **From memory:** that SAP rejects `ENDMETHOD foo.`, and that the broken drafts in Findings 2–4 fail activation.
- **Snapshot history:** the manifest proves the snapshot, not that `followup.diff` is complete. I also read the affected current source directly.
- **Author-reported only:** the build, lint, policy and strict-docs results, and the 121 affected handler tests after the guidance change.

## Deviations
- **Refused out-of-root attempt:** one `Read` left out `source/` and pointed outside the working directory. It was refused and returned nothing, and I reissued it correctly.
- **Oversized read:** one `Read` of `followup.diff` exceeded the size limit and returned nothing, so I read it in parts.
- **Outside the working directory:** only `Grep` of my saved Vitest output, which your exception allows.
- **Internal Git:** `check:sizes` reports tracked files, so it probably uses Git internally, and the verifier may too. I read neither script.
- **Model:** `claude-opus-5-5`. I can't see the effort setting from inside the session, so "max" is unconfirmed by me.
- **Otherwise none:** no edits, installs, delegation, operator scripts, mutants, direct git, background shells, pipes or ad hoc scripts. Dependencies outside the snapshot weren't read through symlinks.