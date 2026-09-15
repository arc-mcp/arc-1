# PR #743 — `SAPRead method=` bypasses class-local includes (VALIDATED)

**Status:** Confirmed client-side bug on HEAD; root cause reproduced live on SAP_BASIS 816 and 758
(2026-09-02). This repository branch implements and validates the corrected routing, including the
`include="main"` precedence edge that remains in external PR #743.

**Classification:** Bug. Number 743 is an external pull request from `@jrodriguez-rc`, not an issue.
PR #744 supersedes it with the explicit-MAIN correction and full validation matrix. The original
author is credited as a co-author of #744's implementation commit.

## TL;DR

- HEAD (`3d890085`) reads `/source/main` whenever `SAPRead(type="CLAS", method=...)` is used without
  `include=`. A RAP behavior pool's MAIN is only its 152-byte `FOR BEHAVIOR OF` shell; the local
  handler and saver classes are in `/includes/implementations` (CCIMP). `extractMethod` is capable of
  resolving `lhc_travel~set_status_accepted`, but ARC-1 gives it the wrong source.
- HEAD also guards method extraction with `!args.include`. Supplying `method=` and `include=` therefore
  skips extraction and returns the complete include. On the live `/DMO/BP_TRAVEL_M` fixture that was
  34,466 characters and contained the requested method plus many unrelated methods.
- The behavior and endpoint bodies were byte-for-byte identical on SAP_BASIS 816 and 758. This is not
  an SAP release quirk; it is ARC-1 source-section routing.
- PR head `8386ff6a` returns only the requested 761-character method on both systems for the qualified
  local-class call and for `method=` plus `include="implementations"`.
- One patch edge remains: lines 339–341 convert explicit `include="main"` to `undefined` and then apply
  prefix auto-detection. Consequently `method="lhc_travel~set_status_accepted", include="main"` reads
  CCIMP and succeeds, even though the accepted input explicitly selected MAIN and the PR says an
  explicit include wins. Preserve the distinction between omitted `include` and explicit `main`, or
  reject that combination explicitly, and pin it with a unit test.
- The regression was introduced by `dbd27b9b` (`feat: method-level surgery and hyperfocused mode
  (#23)`) on 2026-04-02. The later `fef9afc3` commit only renamed `ts-src/` to `src/`; it did not
  introduce the condition. The handler split in #402 preserved it.

## Reported claim

The contributor reports that a documented qualified method read such as
`SAPRead(type="CLAS", method="lhc_x~method")` returns `Available methods: (none)` for RAP behavior
pools. The method reader always fetches the global class MAIN source, while the actual handler is a
class-local implementation in CCIMP. The same guard causes `method=` plus `include=` to ignore the
method and return the whole include. They propose selecting an explicit include first, otherwise
auto-detecting `lhc_*`/`lcl_*` as `implementations` and `ltc_*` as `testclasses`, then extracting the
method from that source.

The claim and primary root cause are correct.

## Implementation outcome

Branch `codex/fix-sapread-local-class-method-includes` now resolves the class source before method
parsing. Explicit `include=` values are authoritative, including `main`; only an omitted include uses
the existing `detectLocalHandlerInclude` convention. Non-MAIN reads use raw `getClassInclude` bodies
and bypass the MAIN-only source cache key.

Test-driven validation first added the complete routing matrix. On the unmodified handler, 8 new
cases failed while 136 existing/unchanged cases passed. After the handler change:

- `tests/unit/handlers/read.test.ts`: 145/145 passed, including a cached-MAIN isolation regression.
- Together with `tests/unit/context/method-surgery.test.ts`: 184/184 passed.
- Full unit suite: 182 files and 5,396 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed (with the repository's two existing Biome configuration notices).
- `npm run build`: passed.
- `npm run check:sizes`: passed without raising the file-size or MCP schema-token ratchets.

PR #744's first CI run also exposed newly published transitive dependency advisories in the root
lockfile. The minimal remediation updates `fast-uri` 3.1.5→3.1.7, `qs` 6.15.2→6.16.0, and its
`side-channel` dependency 1.1.0→1.1.1 without changing `package.json`. Clean installs and the full
5,396-test suite pass on local Node 22 and Node 24; root and AppRouter audits both report zero
findings. Independent review found no ARC-1-specific exploit path through these dependencies and no
compatibility or unrelated lockfile change.

Detailed review found that the LLM-visible tool description also needed to explain the new routing.
The first wording exceeded the BTP tool-schema ratchet by 57 estimated tokens and the `tools.ts`
line ratchet by one line. The wording was tightened instead of raising either budget, and all seven
affected standard-mode tool-definition snapshots were intentionally regenerated and reviewed. The
input schema remains unchanged.

The fixed product path was then replayed on SAP_BASIS 816 and 758. Both systems produced identical
results:

| Call | Result on both systems |
|---|---|
| qualified `lhc_travel~set_status_accepted`, no include | success; 761-character target method only |
| bare `set_status_accepted`, `include="implementations"` | success; same 761-character target method only |
| qualified target, explicit `include="main"` | error from MAIN: method not found; no CCIMP redirect |
| `method="*"`, `include="implementations"` | success; 1,711-character method catalog, no source wrapper |

None of the successful extraction responses contained the unrelated `validate_customer` method,
the `=== implementations ===` display wrapper, or a local `CLASS` block.

## Live validation

### Systems and object

| Target | SAP_BASIS | Object | Result |
|---|---:|---|---|
| A4H 2025 | 816 | `/DMO/BP_TRAVEL_M` | Reproduced on HEAD; branch fix validated |
| A4H 2023 | 758 | `/DMO/BP_TRAVEL_M` | Reproduced identically; branch fix validated |

The 7.50 system has no RAP behavior-pool fixture, so the RAP-specific scenario is not applicable
there. The underlying OO class-include contract is older than RAP and the defect has no release
branch in ARC-1.

### Commands

Credentials came from the local infrastructure configuration and are intentionally omitted here.
These are the product-path calls used on each target:

```bash
npm run cli -- call SAPRead --json \
  '{"type":"CLAS","name":"/DMO/BP_TRAVEL_M","method":"lhc_travel~set_status_accepted"}' \
  --output json

npm run cli -- call SAPRead --json \
  '{"type":"CLAS","name":"/DMO/BP_TRAVEL_M","method":"set_status_accepted","include":"implementations"}' \
  --output json
```

Direct ADT reads established which bytes SAP serves:

```bash
curl -u "$SAP_USER:$SAP_PASSWORD" \
  "$SAP_URL/sap/bc/adt/oo/classes/%2Fdmo%2Fbp_travel_m/source/main?sap-client=001&version=active"

curl -u "$SAP_USER:$SAP_PASSWORD" \
  "$SAP_URL/sap/bc/adt/oo/classes/%2Fdmo%2Fbp_travel_m/includes/implementations?sap-client=001&version=active"
```

### Captured behavior

| Check | HEAD on 816 | HEAD on 758 | PR head on 816 + 758 |
|---|---|---|---|
| Direct `source/main` | HTTP 200, `text/plain`, 152 bytes; global shell only | Same 152 bytes | unchanged |
| Direct `includes/implementations` | HTTP 200, `text/plain`, 34,446 bytes; contains `CLASS lhc_travel IMPLEMENTATION` and the target method | Same 34,446 bytes | unchanged |
| Qualified `method="lhc_travel~set_status_accepted"` | Error: `Available methods: (none)` | Same error | Success; only target method, 761 chars |
| `method="set_status_accepted"` + `include="implementations"` | Success but returns the entire 34,466-character wrapped include, including unrelated `validate_customer` | Same | Success; only target method, 761 chars |
| Qualified method + explicit `include="main"` | Method is ignored; complete MAIN is returned | Same | Auto-routes to CCIMP and returns target method; explicit MAIN is not honored |

The exact HEAD error on both systems was:

```text
Method "lhc_travel~set_status_accepted" not found in /DMO/BP_TRAVEL_M. Available methods: (none)
```

The direct MAIN body on both systems was:

```abap
CLASS /dmo/bp_travel_m DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF /dmo/i_travel_m.
ENDCLASS.

CLASS /dmo/bp_travel_m IMPLEMENTATION.
ENDCLASS.
```

### Submitted-patch verification

- Checked out PR head `8386ff6a` in a temporary detached worktree.
- `npx vitest run tests/unit/handlers/read.test.ts`: **140/140 tests passed**.
- Replayed the two product-path calls above against 816 and 758: both returned the requested method
  only.
- Replayed the explicit-MAIN edge: both systems returned the CCIMP method, confirming the unresolved
  precedence behavior in the patch itself rather than any backend variation.

## ADT contract and independent witnesses

### Eclipse ADT / live contract

- The active Eclipse bundle `com.sap.adt.oo_3.56.1` registers the canonical class collection at
  `/sap/bc/adt/oo/classes` (`~/DEV/arc-1-eclipse-adt/api/11-repository-search-and-object-paths.md`).
- The locally derived Eclipse/ADT contract records separate resources:
  - `GET /sap/bc/adt/oo/classes/{name}/source/main`
  - `GET|PUT /sap/bc/adt/oo/classes/{name}/includes/{definitions|implementations|macros|testclasses}`
  (`docs/compare/adt/apis/03-oo-classes-and-interfaces.md`).
- Live class metadata for `/DMO/BP_TRAVEL_M` on both releases advertised all five sources separately:
  `source/main`, `includes/definitions`, `includes/implementations`, `includes/macros`, and
  `includes/testclasses`; each child carried `adtcore:type="CLAS/I"`.
- Prior live type evidence independently records the same `CLAS/I` include URIs and a successful
  `GET .../includes/testclasses` (`docs/research/abap-types/types/clas.md`).

The endpoint behavior is correct: SAP serves the global class and its class-local includes as
different resources. No SAP Note is relevant because SAP returns the requested source correctly;
ARC-1 chooses the wrong resource before invoking its local method extractor.

### SAP ADT language server and other MCP implementations

SAP's own ADT language server exposes the same class as separate AFF files:
`*.clas.abap`, `*.clas.definitions.abap`, `*.clas.implementations.abap`, `*.clas.macros.abap`, and
`*.clas.testclasses.abap` (`~/DEV/arc-1-lsp/docs/adt-ls-reference.md`, “Class includes”). This is an
independent witness that a method reader must select the containing class file/include before
extracting a local-class method.

The reference `~/DEV/mcp-abap-adt/src/handlers/handleGetClass.ts` only reads
`/oo/classes/{name}/source/main`; it does not implement include-aware method extraction and therefore
does not provide an alternative fix.

## HEAD analysis and root cause

HEAD `src/handlers/read.ts:324-352` currently does this:

1. Enters method extraction only under `if (methodParam && !args.include)`.
2. Fetches `client.getClass(name, undefined, ...)`, which is `/source/main`.
3. Passes only that MAIN body to `listMethods` or `extractMethod`.
4. When `include` is present, falls through to the ordinary include read and returns its whole body.

The extractor is not the defect. `src/context/method-surgery.ts:448` supports a qualified
`<localclass>~<method>` lookup using `MethodInfo.containingClass`. ARC-1 also already has the required
section selector: `detectLocalHandlerInclude` in `src/handlers/object-types.ts:546`, used by
`SAPWrite edit_method` in `src/handlers/write/class-surgery.ts:77`.

The true root cause is therefore a missing read-side source-routing step. The feature originally
assumed every method implementation was in MAIN, then later gained local-class-aware extraction and
write routing without updating the `SAPRead method=` orchestration.

## Submitted patch: correct shape and remaining correction

The proposed use of `getClassInclude` is correct:

- it calls the exact CCIMP/CCAU ADT source resource;
- it avoids the `=== include ===` display wrapper before parsing;
- it bypasses the source cache, whose key is `(type, name, version)` and cannot distinguish MAIN from
  CCIMP;
- it reuses the already-tested `detectLocalHandlerInclude` convention rather than creating a second
  prefix table;
- it keeps the public schema unchanged because `SAPREAD_CLAS_READ_INCLUDES` already accepts these
  values.

The remaining edge is in PR `src/handlers/read.ts:339-341`:

```ts
const rawInclude = (args.include as string | undefined)?.toLowerCase();
const explicitInclude = rawInclude && rawInclude !== 'main' ? rawInclude : undefined;
const resolvedInclude = explicitInclude ?? detectLocalHandlerInclude(methodParam);
```

`include="main"` and an omitted include collapse to the same value before auto-detection. Yet the
`SAPRead` schema and `docs_page/tools.md` accept `main`, the existing grep path treats it as MAIN, and
the PR's own docs say “an explicit `include=` wins.” The branch needs to retain whether the argument
was present. Add a regression case with a qualified `lhc_*~method` plus `include="main"`; expected
behavior should be either a MAIN lookup/error or an explicit validation error, not a silent CCIMP
redirect.

The PR research note also needs its history sentence corrected: `git show dbd27b9b` contains the
original `if (methodParam && !args.include)` in `ts-src/handlers/intent.ts`; the rename commit came
afterward.

## Affected files

| File | Required impact |
|---|---|
| `src/handlers/read.ts` | Route method reads to an explicit or detected class source before extraction; preserve explicit MAIN semantics |
| `tests/unit/handlers/read.test.ts` | Pin qualified CCIMP routing, method+include extraction, list, missing include, MAIN miss hint, and explicit `include="main"` precedence |
| `src/handlers/tools.ts`, `tests/fixtures/tool-definitions/` | Describe the routing to LLM consumers and pin the intentional description-only surface change |
| `AGENTS.md` | Record read-side include routing after semantics are final |
| `docs/dev-guide.md` | Record the same implementation invariant and cache limitation |
| `docs_page/tools.md` | Document qualified local methods and explicit include selection for users |
| `docs/research/issues/743-sapread-local-class-method-include.md` | Preserve the research, corrected history, implementation decisions, and validation evidence |

No `schemas.ts` change is required because every accepted combination already validated correctly.
The behavior-changing `tools.ts` description was updated so the LLM-facing contract is complete;
the resulting description-only snapshot changes were intentionally regenerated and reviewed.

## Out of scope

- Extending prefix auto-detection beyond the existing `lhc_*`, `lcl_*`, and `ltc_*` contract (for
  example, additional RAP saver naming conventions). Explicit `include=` remains the escape hatch.
- Redesigning the object source-cache key to include class sections. Bypassing it for section reads is
  the safe current behavior.
- Defining interaction between `format="structured"` and `method=`; structured format is handled
  before method extraction today and is a separate input-combination question.
- Any SAP-side correction or release gate. The live endpoints behave consistently on 758 and 816.

## Closure rationale for PR #743

```markdown
Thanks @jrodriguez-rc — the bug and primary root cause both reproduce live, and your contribution is credited on the replacement implementation commit in #744.

On `/DMO/BP_TRAVEL_M`, SAP_BASIS **816 and 758 behave identically**: `/source/main` is only the 152-byte `FOR BEHAVIOR OF` shell, while `/includes/implementations` is the 34 KB CCIMP source containing `lhc_travel~set_status_accepted`. Current HEAD therefore returns:

> Method "lhc_travel~set_status_accepted" not found in /DMO/BP_TRAVEL_M. Available methods: (none)

Current HEAD also ignores `method=` when `include=` is present and returns the complete include. I replayed both calls against the PR head; each correctly returned only the requested 761-character method on both releases. The focused `read.test.ts` suite is green (140/140). The ADT contract and SAP's own ADT language server both model MAIN, CCDEF, CCIMP, macros, and testclasses as separate class sources, so reusing `detectLocalHandlerInclude` and reading the raw include is the right fix shape.

This PR still has one precedence edge: explicit `include="main"` is collapsed to `undefined` and then `detectLocalHandlerInclude(methodParam)` runs. A call with `method="lhc_travel~set_status_accepted", include="main"` therefore reads CCIMP and succeeds instead of honoring MAIN. That contradicts the “explicit include wins” contract and the accepted SAPRead input.

One documentation correction: the guard was introduced in `dbd27b9b` (`feat: method-level surgery …`, #23) on 2026-04-02. The later `fef9afc3` commit only renamed `ts-src/` to `src/`; the handler split in #402 then preserved it.

PR #744 carries the corrected routing, the explicit-MAIN regression test, the broader routing/cache matrix, user-facing documentation, and the live 758/816 validation. I am closing #743 in favor of #744 so there is one merge candidate. Thank you for the precise report and patch.
```

## Recommendation

**Supersede #743 with #744.** The replacement retains the contributor's core approach and credits
`@jrodriguez-rc` as a co-author, while adding the explicit-MAIN correction, broader regression
coverage, LLM-visible documentation, and full local/live validation.
