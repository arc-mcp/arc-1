# PR-D: edit_method support for local handler classes (CCDEF / CCIMP)

## Overview

`SAPWrite(action="edit_method")` does method-level surgery on a CLAS today, but it
only ever reads and writes `/source/main`. RAP behavior pools keep their real
implementation in `/includes/implementations` (CCIMP) — local handler classes such
as `lhc_project` whose methods (`approve_project`, `get_instance_authorizations`,
…) live there. Calling `edit_method` on `lhc_project~approve_project` today fails
with *"Method not found"* because the parser only sees the empty `MAIN`. Users
are forced to round-trip through Eclipse or hand-craft full CCIMP rewrites.

This plan extends `edit_method` to splice a single method body inside any class
include — `definitions`, `implementations`, `macros`, or `testclasses` — using
the include= write path that PR #257 added. Two routes are supported:

- **Auto-detection (no breaking change).** When the method specifier looks like
  a local-class qualified name (`<localclass>~<method>` where `<localclass>`
  starts with `lhc_`, `lcl_`, or `ltc_`), ARC-1 routes the read+write to the
  right include (`implementations` for `lhc_*`/`lcl_*`, `testclasses` for
  `ltc_*`). Today's call shape stays the same; existing `zif_X~method` /
  `if_X~method` global-interface splices still go through MAIN. Note: `lif_*`
  (local interface) is intentionally NOT in the auto-detect list — local
  interfaces only declare methods; their implementations live inside an
  `lhc_*`/`lcl_*` class in CCIMP, so the existing `lhc_*~method` rule already
  covers the call site.
- **Explicit override.** Callers can pass `include="implementations"` (or
  `definitions`/`macros`/`testclasses`) to force routing to that include — useful
  for non-`lhc_*` patterns (e.g. test classes named `tc_*`, helpers named
  `helper_*`).

The splice itself reuses the existing `spliceMethod` from `src/context/method-surgery.ts`.
It already handles CCIMP-only source correctly (verified empirically against the
real `ZBP_DM_PROJECT` CCIMP from a4h on 2026-05-10). The remaining gap is a
**class-qualified lookup**: extending `extractMethod` so a method specifier
`lhc_project~approve_project` is matched to a `METHOD approve_project.` block
inside a `CLASS lhc_project IMPLEMENTATION.` containing block. This also closes
the latent ambiguity bug today where the same bare method name in two different
local classes silently picks the first one.

## Context

### Current State

- `case 'edit_method'` in `src/handlers/intent.ts` (lines 3721–3776) calls
  `client.getClass(name)` (which reads `/source/main` only) → `spliceMethod` →
  `safeUpdateSource(http, safety, objectUrl, srcUrl, ...)` where `srcUrl` is
  hard-coded to `/source/main`.
- `spliceMethod` / `extractMethod` in `src/context/method-surgery.ts` work on
  whatever source is passed in. Empirical test 2026-05-10:
  - `listMethods(ccimpSource, anyName)` → finds all 3 methods across two local
    classes ✅
  - `extractMethod(ccimpSource, anyName, "approve_project")` → returns the right
    block ✅
  - `extractMethod(ccimpSource, anyName, "lhc_project~approve_project")` →
    fails *"Method not found"* ❌
  - When two local classes have the same method name, the bare lookup silently
    picks the first one — no error ⚠️
- `SAPWriteSchema` in `src/handlers/schemas.ts` (lines 427–479) accepts
  `include` only via the existing `validateSapWriteInput` superRefine which
  restricts include to `action="update"` + `type="CLAS"` (lines 332–353).
  Need to extend that gate to allow `action="edit_method"` too.
- PR #257 added the include= write path:
  - `classIncludeUrl(name, include)` in `intent.ts` line 3212 builds
    `/sap/bc/adt/oo/classes/{name}/includes/{include}`.
  - The `case 'update'` branch (lines 3322–3354) shows the canonical flow:
    `safeUpdateSource(http, safety, objectUrl, classIncludeUrl(name, include), source, transport, abapRelease)`.
  - `client.getClass(name, include)` already exists (`src/adt/client.ts:163`) and
    reads `/includes/{include}` when an include is passed.

### Target State

- `SAPWrite(action="edit_method", type="CLAS", name="ZBP_DM_PROJECT", method="lhc_project~approve_project", source="...")`
  succeeds end-to-end:
  1. Parser detects the `lhc_*~` prefix → resolves include = `implementations`.
  2. Reads CCIMP via `client.getClass(name, "implementations")`.
  3. Splices the body into the right `lhc_project IMPLEMENTATION` block,
     disambiguated by class name.
  4. Writes back via `safeUpdateSource` with `classIncludeUrl(name, "implementations")`.
- Explicit `include="implementations"` (or `definitions` / `macros` /
  `testclasses`) overrides auto-detection. `include` is REJECTED for non-CLAS
  edit_method (mirror existing update behavior).
- `extractMethod` now accepts a `<localclass>~<method>` specifier and matches
  it to the implementation block whose containing class equals `<localclass>`.
  This is also exposed for any CCIMP/MAIN source — disambiguates same-named
  methods across local classes regardless of include.
- Package check, audit, and caching invalidation continue to apply.
- **Pre-write lint and SAP-side syntax check are intentionally skipped for
  include= writes.** CCDEF/CCIMP/macros/testclasses fragments don't parse as a
  complete class on their own (the DEFINITION/IMPLEMENTATION halves live in
  separate include files), so abaplint reports false positives like *"Expected
  CLASSDEFINITION"*. The existing `case 'update'` include= branch already
  skips these checks for the same reason. **Activation (`SAPActivate`) is the
  authoritative syntax check after an include write** — the user activates the
  parent class once they're done iterating, and the full merged source goes
  through the SAP-side compile. MAIN-targeted `edit_method` calls retain the
  pre-write lint + syntax check.
- All paths covered by unit tests (~12 new tests) and one integration smoke that
  edits a method in a `$TMP` test pool on the live system. NW 7.50 compatibility
  is in scope: the include= URL pattern is identical to what PR #257 verified
  on `npl.marianzeis.de`.

### Key Files

| File | Role |
|------|------|
| `src/context/method-surgery.ts` | Add containing-class tracking to `MethodInfo`; teach `extractMethod` the `<localclass>~<method>` lookup |
| `src/handlers/intent.ts` | `case 'edit_method'` — auto-detect local class prefix, explicit include override, route read + write to `/includes/{include}` |
| `src/handlers/schemas.ts` | `validateSapWriteInput` — allow `include` for `action="edit_method"` (CLAS only) |
| `src/handlers/tools.ts` | Tool description for `edit_method` mentions local-class support + new include parameter |
| `tests/unit/context/method-surgery.test.ts` | Tests for CCIMP-only source, qualified method lookup, multi-local-class disambiguation |
| `tests/unit/handlers/intent.test.ts` | Tests for auto-detection, include override, write URL routing |
| `tests/unit/handlers/schemas.test.ts` | Test that include is allowed for edit_method + CLAS |
| `tests/integration/adt.integration.test.ts` | Smoke test: round-trip edit a method in a `$TMP` behavior pool |
| `docs/compare/00-feature-matrix.md` | Update `EditSource (surgical)` row — note local-class handler support |
| `docs_page/roadmap.md` | Mark PR-D ("edit_method local handler") as completed |
| `docs/plans/completed/2026-04-21-rap-onprem-agent-gap-closure.md` | Already-completed adjacent plan; no changes needed but referenced |
| `CLAUDE.md` | Update `Add method-level surgery` row in Key Files table |

### Design Principles

1. **No breaking change.** Existing `edit_method` calls against MAIN keep
   working with identical semantics. Auto-detection only triggers on the
   recognized local-class prefix set; everything else falls through to MAIN.
2. **Reuse PR #257 infrastructure.** No new HTTP helpers, no new XML payloads,
   no new lock/unlock contract. Same `safeUpdateSource` + same `classIncludeUrl`
   the update path uses.
3. **Disambiguation by qualified name.** When two local classes have the same
   method, the ONLY safe behavior is to require the qualified specifier or
   error with a list of candidates. No silent first-match wins.
4. **Auto-detection is a heuristic, override is authoritative.** If a caller
   passes `include` explicitly, that wins — no second-guessing. The
   auto-detection prefix list (`lhc_`, `lcl_`, `ltc_`, `lif_`) is documented
   inline and easy to extend.
5. **Tests at every layer.** Unit tests for the parser change (pure function),
   unit tests for the handler routing, schema test, and one integration test
   that exercises the live ADT path on the a4h system.
6. **Eclipse evidence followed.** Per `docs/compare/eclipse-adt/api/05-lock-create-update-transport.md`
   class-include writes inherit the parent class lock — already what
   `safeUpdateSource(..., objectUrl, classIncludeUrl(...), ...)` does.
7. **Safety guards unchanged.** `enforcePackageForExistingObject`, lint,
   syntax check, audit, and cache invalidation all run regardless of which
   include is targeted.

## Development Approach

- **Foundation first** — extend `MethodInfo` and `extractMethod` in `method-surgery.ts`
  with optional `containingClass` tracking and qualified-name lookup.
- **Wiring second** — update `case 'edit_method'` in `intent.ts` to detect
  local-class prefixes, route read via `client.getClass(name, include)`, and
  write via `classIncludeUrl(name, include)`.
- **Schema third** — relax `validateSapWriteInput` so `include` is also valid
  for `edit_method` + CLAS.
- **Tool description fourth** — describe new behavior in `tools.ts`.
- **Tests fifth** — unit + integration coverage.
- **Documentation sixth** — feature matrix, roadmap, CLAUDE.md, plan archive.

Tests must follow the conventions in `CLAUDE.md` "Testing" and
`docs/testing-skip-policy.md`. Use `mockResponse()` from
`tests/helpers/mock-fetch.ts` for HTTP mocking. Integration test must use
`requireOrSkip()` from `tests/helpers/skip-policy.ts` and clean up the test
class in a `try/finally` block.

The 7.50 compatibility surface is the same `/sap/bc/adt/oo/classes/{name}/includes/{include}`
URL PR #257 already validated on NPL750. No new release-gated workarounds expected.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run build`

### Task 1: Track containing class in MethodInfo and add qualified lookup

**Files:**
- Modify: `src/context/method-surgery.ts`
- Modify: `tests/unit/context/method-surgery.test.ts`

Today `MethodInfo` only stores the bare method name (`approve_project`) and has
no record of the local class it belongs to. This means `extractMethod` cannot
disambiguate when two local classes in a CCIMP define methods with the same
name, and cannot resolve qualified specifiers like `lhc_project~approve_project`.
Extend the parser to record the containing class for each method block, and
teach `extractMethod` to honor `<class>~<method>` syntax against that record.

- [ ] Add an optional `containingClass?: string` field to `MethodInfo`
      (after `isInterfaceMethod`). Document inline that this is the local class
      name from `CLASS xxx IMPLEMENTATION.` (e.g. `lhc_project`, `lcl_helper`),
      not the global class (which is the `MethodListResult.className`).
- [ ] In `listMethodsAST` (~lines 138–155): when iterating
      `findAllStructuresRecursive(Structures.ClassImplementation)`, capture the
      class name from the first statement (`CLASS <name> IMPLEMENTATION.`) and
      stamp it onto each emitted method via the implementations map. Update the
      map value type to `{ startLine, endLine, containingClass }`.
- [ ] In `listMethodsRegex` (~lines 333–373): when entering an IMPLEMENTATION
      block (`/^CLASS\s+(\S+)\s+IMPLEMENTATION/i`), capture the class name and
      stamp it on emitted methods.
- [ ] In `extractMethod` (~lines 398–478): add qualified-name handling with
      an EXACT lookup ordering — this ordering is critical to preserve the
      existing global-interface fuzzy match. The order MUST be:
      1. **Exact match first** — `m.name.toUpperCase() === upperName`. This
         catches today's `zif_order~create` case where the method is stored as
         `zif_order~create` in the listing (the implementation method name
         contains the `~`). MUST NOT be skipped.
      2. **Qualified-class match second** — only when the method specifier
         contains `~` AND the exact match above failed. Split into
         `[lhsUpper, rhsUpper]`, look up
         `m => (m.containingClass ?? '').toUpperCase() === lhsUpper && m.name.toUpperCase() === rhsUpper`.
         If exactly one match, return it. If zero, fall through.
      3. **Existing fuzzy interface match third** — unchanged. The current
         logic at lines 424-444 (filter `m => m.name.split('~')[1] === upperName`)
         continues to work as a last-resort suffix match for callers passing
         a bare interface method name.
- [ ] Add explicit ambiguity error: when an unqualified `methodName` matches
      methods in two or more different `containingClass` values, return a
      structured error listing the qualified candidates
      (e.g. *"Ambiguous method name 'approve_project'. Multiple local classes
      define it: lhc_project, lhc_task. Use a qualified name like
      'lhc_project~approve_project'."*). Detect this BEFORE returning step 1's
      exact match — i.e. if multiple methods named `approve_project` exist
      across different containing classes and the caller passed the bare name
      with no `~`, error out instead of returning the first.
- [ ] Add unit tests (~9 tests):
      1. `listMethods` on the real `ZBP_DM_PROJECT` CCIMP source captures
         `containingClass='lhc_project'` for both methods.
      2. `listMethods` on a CCIMP source with two local classes captures the
         right `containingClass` per method.
      3. `extractMethod` with qualified `lhc_project~approve_project`
         returns the right block.
      4. `extractMethod` with bare `approve_project` returns the only matching
         method when there is exactly one across local classes.
      5. `extractMethod` with bare `approve_project` returns the ambiguity
         error when two local classes both define it.
      6. `extractMethod` with qualified `lhc_task~approve_project` (when both
         exist) returns the second one specifically.
      7. **Regression test** — `extractMethod` with `zif_order~create` against
         the existing `INTERFACE_CLASS` fixture still resolves via the EXACT
         match path (step 1 of the ordering above). Lookup ordering MUST NOT
         intercept this with the qualified-class path.
      8. **Mixed-case test** — `extractMethod('lhc_PROJECT~Approve_Project')`
         on the standard CCIMP fixture works (LHS+RHS both uppercased).
      9. **Cross-include disambiguation** — given a CCIMP that has both
         `lhc_x IMPL` with `METHOD foo.` AND `lhc_x IMPL` with
         `METHOD zif_order~create.` (i.e. an lhc class that implements an
         interface), passing `zif_order~create` matches the interface impl
         (step 1 exact), passing `lhc_x~foo` matches the local foo (step 2
         qualified). Both work without colliding.
- [ ] `spliceMethod` requires no signature change — it consumes whatever
      `extractMethod` returns. Verify the existing splice test still passes
      and add one new test that splices `lhc_project~approve_project` against a
      CCIMP source.
- [ ] Run `npm test` — all method-surgery tests must pass.

### Task 2: Route edit_method through include= for local handler classes

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

The `case 'edit_method'` handler at intent.ts:3721 currently reads
`/source/main` and writes back to `/source/main`. Extend it to optionally route
through any class include — auto-detecting local-class prefixes (`lhc_`, `lcl_`,
`ltc_`, `lif_`) on the LHS of `<class>~<method>`, and respecting an explicit
`include` parameter as the override. Reuse `classIncludeUrl` and the
`safeUpdateSource` flow that the `case 'update'` branch already established (see
intent.ts:3341–3349).

- [ ] Add a small helper `detectLocalHandlerInclude(method: string): ClassWriteInclude | undefined`
      near the existing `normalizeClassWriteInclude` helper (~line 3216):
      - If `method` does NOT contain `~`, return `undefined` (route to MAIN).
      - Split by `~`; trim/lowercase the LHS; match against:
        - `^(lhc|lcl)_` → `'implementations'` (RAP behavior pool handlers and
          local helper classes)
        - `^ltc_` → `'testclasses'` (ABAP Unit local test classes)
      - Otherwise return `undefined` (e.g. `zif_order~create`,
        `if_oo_adt_classrun~main`, `lif_foo~bar` all stay MAIN). `lif_*` is
        intentionally NOT mapped — local interfaces only declare methods, so
        there's nothing to splice in CCDEF; their implementations live in an
        `lhc_*`/`lcl_*` class which is already handled.
      - Document the prefix→include mapping inline; this is intentionally
        narrow and can be extended later via explicit `include` if a code-base
        uses other naming conventions.
- [ ] In `case 'edit_method'` (~line 3721), after the existing required-args
      checks but before reading source, resolve the include:
      ```
      const explicitInclude = normalizeClassWriteInclude(args.include);
      const detectedInclude = detectLocalHandlerInclude(method);
      const resolvedInclude = explicitInclude ?? detectedInclude;
      ```
      If `args.include` was passed but normalization rejected it, return
      `errorResult(...)` matching the existing message in the update branch.
- [ ] When `resolvedInclude` is set:
      - **Skip the source cache for include reads.** The current
        `cachingLayer.getSource('CLAS', name, ...)` cache key is
        `(type, name, active|inactive)` and does NOT differentiate by include
        (per CLAUDE.md: "ETag-revalidated source cache (key
        `(type, name, active|inactive)`)"). Reusing it would silently mix
        MAIN and CCIMP bytes. Direct call:
        `const fetched = await client.getClass(name, resolvedInclude);`
      - **Strip the `=== {include} ===\n` header** that
        `client.getClass(name, include)` prepends (see `client.ts:177-183`,
        `parts.push('=== ${inc} ===\n' + result.source)`). Use a precise
        regex stripping ONLY the leading occurrence:
        `const ccimpSource = fetched.source.replace(/^=== \w+ ===\n/, '');`
        Do NOT use a global flag — only strip the first header. Add a unit
        test asserting the stripped source begins with `CLASS lhc_…` or
        the include's expected first non-comment token.
      - Compute the writeback URL: `const writeUrl = classIncludeUrl(name, resolvedInclude);`
      - Pass `writeUrl` to `safeUpdateSource` instead of `srcUrl`.
      - After write, invalidate cache: `cachingLayer?.invalidate(type, name, 'all')`
        (existing `invalidateWrittenObject` already does this — confirm it
        clears all per-include entries; if cache support for include= is
        added later, the 'all' bucket should still cover it).
- [ ] **Note for follow-up (do NOT do in this PR):** extending
      `cachingLayer.getSource` to accept an include discriminator so include
      reads can be cached too. Track in the PR description as a follow-up.
      Skipping cache for include reads is acceptable because edit_method
      is a relatively rare, mutation-adjacent call.
- [ ] When `resolvedInclude` is undefined: fall through to the existing MAIN
      flow unchanged (read `client.getClass(name)`, write to `srcUrl`).
- [ ] Update the success message to include the include name when it's not
      MAIN: *"Successfully updated method "lhc_project~approve_project" in
      CLAS ZBP_DM_PROJECT (include: implementations)."*
- [ ] Make sure cache invalidation (`invalidateWrittenObject`) still runs and
      that lint + syntax checks (`runPreWriteLint`, `runPreWriteSyntaxCheck`)
      still apply to the spliced source.
- [ ] Add unit tests (~7 tests):
      1. `edit_method` with `method='lhc_project~approve_project'` (no
         explicit `include`) reads `/includes/implementations` and writes back
         to the same URL. Assert the `mockFetch` call args (URL + method).
      2. `edit_method` with `method='approve_project'` and explicit
         `include='implementations'` routes to CCIMP regardless of method name.
      3. `edit_method` with `method='zif_order~create'` (interface method, not
         local-class) keeps using `/source/main` — regression coverage.
      4. `edit_method` with `include='implementations'` but `type='PROG'`
         returns the existing 'edit_method only supported for type=CLAS' error
         (or the schema-level rejection — whichever fires first).
      5. `edit_method` with bad `include='garbage'` returns the existing
         `Invalid CLAS include "garbage"` error message.
      6. **Negative path: method not found in selected include.** When
         `method='lhc_typo~foo'` (auto-routes to implementations) and the CCIMP
         doesn't contain `lhc_typo`, the error message tells the LLM which
         include was searched and suggests trying without auto-detection
         (e.g. *"Method 'lhc_typo~foo' not found in CLAS X include
         implementations. Available local classes: lhc_project. To override
         routing, pass include explicitly."*).
      7. **Cache isolation.** After a `case 'update'` update to MAIN, a
         subsequent `edit_method` on a CCIMP method must read fresh CCIMP
         bytes, not stale MAIN cache. (Prove by mocking two separate
         responses and asserting both reads happened.)
- [ ] Run `npm test -- tests/unit/handlers/intent.test.ts` — all SAPWrite tests
      must pass.
- [ ] Run `npm test` — full unit suite must still pass.

### Task 3: Schema gate — allow include for edit_method + CLAS

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `tests/unit/handlers/schemas.test.ts`

The current `validateSapWriteInput` superRefine (schemas.ts:332-353) rejects
`include` for any action other than `update`. Relax that gate so `edit_method`
also accepts include — but keep the CLAS-only restriction. The handler-level
checks already produce a useful message for bad combinations; this just lets
the schema not block a valid call.

- [ ] In `validateSapWriteInput` (~line 332): change the action check to allow
      both `update` and `edit_method`. Update the message to read
      *"SAPWrite include is only supported for action=\"update\" or action=\"edit_method\"."*
- [ ] Confirm both `SAPWriteSchema` (line 427) and `SAPWriteSchemaBtp` (line
      481) pick up the change automatically because both call the shared
      superRefine.
- [ ] Add unit tests (~3 tests) to `tests/unit/handlers/schemas.test.ts`:
      1. `SAPWriteSchema.parse({ action: 'edit_method', type: 'CLAS', name:
         'X', method: 'lhc~m', source: 's', include: 'implementations' })`
         succeeds.
      2. `SAPWriteSchema.parse({ action: 'edit_method', type: 'PROG', name:
         'X', source: 's', include: 'implementations' })` fails with the
         "include is only supported for type=CLAS" message.
      3. `SAPWriteSchema.parse({ action: 'create', ..., include:
         'implementations' })` still fails with the action restriction.
- [ ] Run `npm test` — schema tests must pass.

### Task 4: Tool description + AGENTS.md mention

**Files:**
- Modify: `src/handlers/tools.ts`
- Modify: `AGENTS.md` (if it has a "common tasks" section that lists edit_method; otherwise skip)

The tool description guides LLM callers. Update the `edit_method` lines so an
LLM knows it can pass `lhc_project~approve_project` as the method name and have
it Just Work. Mention the new include= option for explicit routing.

- [ ] Find the two `edit_method` description blocks in `tools.ts` (one in the
      on-prem variant ~line 167, one in the BTP variant ~line 183). Update
      each to:
      *"For edit_method: surgically replace a single method body in a CLAS
      without sending the full class source. For local handler classes (RAP
      behavior pools), pass `lhc_project~approve_project` as the method name —
      ARC-1 routes the read+write to /includes/implementations automatically.
      Override with include=\"definitions\"|\"implementations\"|\"macros\"
      |\"testclasses\" for explicit control (e.g. local helper classes named
      lcl_* or test classes ltc_*). Auto-detection prefixes: lhc_/lcl_ →
      implementations, ltc_ → testclasses, lif_ → definitions."*
- [ ] Update the `include` field description (~line 581) to add: *"For
      action=edit_method on a CLAS: targets the include where the method body
      lives. Auto-detected from method name prefix when omitted (lhc_*/lcl_* →
      implementations)."*
- [ ] Update the `method` field description (~line 588): *"For edit_method
      action: method name to replace (e.g., 'get_name', 'zif_order~process'
      for a global interface method, or 'lhc_project~approve_project' for a
      local handler method in a RAP behavior pool)."*
- [ ] Run `npm run lint` and `npm test` — tool description schema tests
      should pass without changes (descriptions are free text).

### Task 5: Integration smoke against live a4h

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

Add one round-trip test that creates a `$TMP` behavior-pool-style class with a
populated CCIMP, edits a single method body via `edit_method`, reads back, and
asserts the body changed. This exercises the same lock+PUT flow PR #257
verified — but for `edit_method` instead of `update`. NW 7.50 compatibility is
already covered by PR #257's include= path; no separate NPL test needed for
this PR.

- [ ] In `tests/integration/adt.integration.test.ts`, add a new `describe`
      block "edit_method against class includes (CCIMP)". Use
      `requireOrSkip(ctx, ...)` from `tests/helpers/skip-policy.ts` to skip
      cleanly when SAP credentials are missing.
- [ ] Test body:
      1. Generate a unique `$TMP` class name with `generateUniqueName('ZCL_PRD_')`.
      2. Create the class via the integration `getTestClient()` factory using
         the standard create flow.
      3. Update CCDEF to add a local class with one METHOD signature; update
         CCIMP to add the implementation. Use the existing
         `SAPWrite update include=` path (PR #257) for both writes.
      4. Activate the class.
      5. Call `SAPWrite action=edit_method method='lhc_x~hello' source=' " new body\n  WRITE / 99.'`. Expect success.
      6. Read CCIMP via `SAPRead include='implementations'`; assert the new
         body is present and the old body is gone.
      7. Cleanup: delete the class in a `finally` block (best-effort).
- [ ] Tag transient cleanup with `// best-effort-cleanup` per the testing
      skip policy.
- [ ] Run `npm run test:integration -- -t "edit_method against class includes"`
      against a4h and confirm pass.
- [ ] Capture the lock URL, the PUT URL, and the PUT body in a brief test
      comment so future readers can verify against Eclipse evidence per
      `pr-review-guide.md`.

### Task 6: Documentation, feature matrix, roadmap, CLAUDE.md

**Files:**
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `docs_page/roadmap.md`
- Modify: `CLAUDE.md`
- Modify: `docs_page/tools.md` (if present and lists edit_method semantics)
- Move: this plan from `docs/plans/` to `docs/plans/completed/` (last task)

Sync every doc surface that references `edit_method` so the new local-class
support is discoverable and so the roadmap reflects the merged state.

- [ ] In `docs/compare/00-feature-matrix.md` find the `EditSource (surgical)` row
      (verified present at line 119 as of 2026-05-10:
      `| EditSource (surgical) | ✅ (edit_method) | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ✅ (edit_method, Apr 2026) | ❌ |`).
      Update the first ARC-1 cell from *"✅ (edit_method)"* to
      *"✅ (edit_method, local handlers May 2026)"*. Refresh the "Last Updated"
      line at the top of the file.
- [ ] In `docs_page/roadmap.md` (canonical roadmap path — verified present)
      find any PR-D / "edit_method local handler" / "method-level surgery for
      CCIMP" entry. If present, mark it completed with the merge date. If
      absent, add one row under "Recently completed" referencing this plan
      with the date. Note: the roadmap also lives at `docs/roadmap.md` in
      some worktrees — only edit `docs_page/roadmap.md` (the published one).
- [ ] In `CLAUDE.md` "Key Files for Common Tasks" table, find the
      *"Add method-level surgery"* row and update the description to mention
      `containingClass` tracking and local-class qualified names. Verify the
      "Add new tool type" row is still accurate.
- [ ] If `docs_page/tools.md` documents the SAPWrite tool, add a paragraph
      under the edit_method section describing the local-handler routing.
- [ ] Confirm `docs/plans/completed/2026-04-21-rap-onprem-agent-gap-closure.md` is still
      accurate; do not modify (it predates this work and is correctly archived).
- [ ] Spot-check (during this task, do not modify in this PR but note in the
      PR description as bonus follow-ups): scan `docs_page/architecture.md`
      and `docs_page/authorization.md` for outdated references to
      "edit_method only writes /source/main" — if you find any, list them in
      the PR body's "Documentation follow-ups" section so they can be fixed
      separately.

### Task 7: Final verification

**Files:** none

Final pass that gates the PR-ready state.

- [ ] Run `npm test` — full unit suite must pass.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors.
- [ ] Run `npm run build` — produces `dist/` cleanly.
- [ ] Run `npm run test:integration -- -t "edit_method"` against a4h and
      confirm the new integration test passes (or skips cleanly when
      `TEST_SAP_URL` is unset).
- [ ] Smoke-test the ZBP_DM_PROJECT case from RUN-NOTES Run 3 manually:
      ```
      cd /Users/marianzeis/DEV/arc-1
      node dist/cli.js call SAPWrite --json '{
        "action":"edit_method",
        "type":"CLAS",
        "name":"ZBP_DM_PROJECT",
        "method":"lhc_project~approve_project",
        "source":"    \" reverted to no-op for smoke test\n    READ ENTITIES OF zr_dm_project IN LOCAL MODE ENTITY Project FIELDS ( ProjectId ) WITH CORRESPONDING #( keys ) RESULT DATA(p).\n    result = VALUE #( FOR x IN p ( %tky = x-%tky %param = VALUE #( ProjectId = x-ProjectId Status = ''A'' ) ) )."
      }'
      ```
      Assert no error, then `SAPRead include=implementations` and confirm the
      body changed.
- [ ] Move this plan from `docs/plans/completed/2026-05-10-edit-method-local-handler-classes.md` to
      `docs/plans/completed/2026-05-10-edit-method-local-handler-classes.md`.
