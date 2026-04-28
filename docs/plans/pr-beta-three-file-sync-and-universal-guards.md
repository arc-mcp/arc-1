# PR-β — Three-file Sync, STRU First-class Write Support, and Universal Write-side Guards

## Overview

This PR ships the universal (i.e. not NW 7.50-specific) write-side improvements bundled in [PR #196](https://github.com/marianfoo/arc-1/pull/196). Each item fixes a real LLM-facing gap that applies on every supported SAP release:

- **Three-file sync gap for `messages`.** The `SAPWrite` handler already consumes `args.messages` for MSAG create/update, and Zod already validates it, but the JSON tool schema in [src/handlers/tools.ts](../../src/handlers/tools.ts) never exposed the property — so LLMs cannot discover or use it.
- **STRU as a first-class writable type.** DDIC structures (`/ddic/structures/`) are writable on every supported SAP release (verified live: A4H 758, NPL 750). PR #196 added STRU to the Zod schema and handler routing but only conditionally surfaced it in the tool enum (when TABL was filtered out by the release map). On modern systems, STRU writes are valid in handler+schema but invisible to LLMs. Make STRU a first-class entry in `SAPWRITE_TYPES_*` and the description blurb.
- **Mixed-case object name rejection.** SAP TADIR uses uppercase for all object names; mixed-case names are silently corrupted (e.g. DDLS created as "Zc_MyView" instead of "ZC_MYVIEW"). This is universal SAP convention, not 7.50-specific. Reject at the handler with a clear message that distinguishes between the object name (must be uppercase) and the source body (can be mixed case).
- **STRU update guard against transparent tables.** The `/sap/bc/adt/ddic/structures/` PUT endpoint silently converts a `TABL/DT` (transparent table) into a `TABL/DS` (structure) by creating an inactive `INTTAB` version. This corrupts DD02L and confuses SE11 on every release where the endpoint exists. Block STRU updates on objects that are actually transparent tables, with a single neutral error message that doesn't claim a specific release.

This PR is the second of three "ship-now" splits of [PR #196](https://github.com/marianfoo/arc-1/pull/196). Architectural decisions live under `docs/adr/0001..0003.md`. The NW 7.50-specific runtime behavior (lock-conflict reclassification, MSAG transport guard) ships separately in PR-γ.

## Context

### Current State

- [src/handlers/schemas.ts](../../src/handlers/schemas.ts) `SAPWriteSchema*` already includes `messages: z.array(messageClassMessageSchema).optional()` at four sites (top-level + 3 batch variants), so Zod validates the property. The handler in [src/handlers/intent.ts](../../src/handlers/intent.ts) already consumes `input.messages` in `getMetadataWriteProperties` (line ~2137) and merges them via `mergeMetadataWriteProperties` for MSAG (line ~2170).
- The JSON tool schema in [src/handlers/tools.ts](../../src/handlers/tools.ts) currently exposes other DDIC properties (`fixedValues`, `searchHelp`, `defaultComponentName`, etc.) but **does not expose `messages`** — so the LLM receives a tool definition that says nothing about MSAG message bodies, even though the handler accepts them.
- [src/handlers/tools.ts](../../src/handlers/tools.ts) `SAPWRITE_TYPES_ONPREM` and `SAPWRITE_TYPES_BTP` arrays do **not** include `'STRU'`. The `SAPWRITE_DESC_ONPREM`/`SAPWRITE_DESC_BTP` blurbs do not mention STRU writes.
- [src/handlers/intent.ts](../../src/handlers/intent.ts) `objectBasePath` already maps `STRU → /sap/bc/adt/ddic/structures/`, and `buildCreateXml` already has a `case 'STRU':` branch (delegated to the `case 'TABL'` blue-source envelope per PR #196). `createContentTypeForType` has the `STRU → application/vnd.sap.adt.blues.v1+xml` line. So the handler is ready — only the tool surface is missing.
- No mixed-case rejection exists today on `create` or `batch_create` paths.
- No STRU-update-vs-TABL guard exists. The `/ddic/structures/` PUT silent-corruption is documented in PR #196's comment but not enforced.

### Target State

- The `messages` property appears in the JSON tool schema for `SAPWrite` (top-level and inside the `batch_create` items schema).
- `'STRU'` is unconditionally a member of `SAPWRITE_TYPES_ONPREM` and `SAPWRITE_TYPES_BTP`. The descriptions mention STRU as a writable type with one sentence on usage.
- `SAPWrite(action='create', name='Zc_MyMixed')` returns a clear actionable error before reaching SAP, distinguishing object name (uppercase required) from source body (mixed case allowed). Same logic applies inside `batch_create` for each object.
- `SAPWrite(action='update', type='STRU', name='T000')` returns a clear actionable error before locking, when `T000` is actually a transparent table (`TABL/DT`). The error names the actual type and points to SE11 (or `SAPWrite type=TABL` if the endpoint is available).
- Unit tests cover all four behaviors. The mixed-case e2e test from PR #196 is cherry-picked.

### Key Files

| File | Role |
|------|------|
| `src/handlers/tools.ts` | Add `messages` property (top-level + batch); add `'STRU'` to `SAPWRITE_TYPES_ONPREM`/`SAPWRITE_TYPES_BTP`; update SAPWriteSchema description blurbs |
| `src/handlers/intent.ts` | Mixed-case rejection in `handleSAPWrite` create + `batch_create`; STRU-update-vs-TABL guard |
| `tests/unit/handlers/intent.test.ts` | Unit tests for mixed-case rejection + STRU-update-vs-TABL guard |
| `tests/unit/handlers/tools.test.ts` | (or create if not present) Tests asserting `messages` and `STRU` are in the resulting tool definitions |
| `tests/e2e/ddic-write.e2e.test.ts` | Cherry-pick the mixed-case rejection e2e test from PR #196 |
| `docs_page/tools.md` | SAPWrite reference — note STRU writes and `messages` parameter for MSAG |
| `CLAUDE.md` | Add note in "Tool schema three-file sync" invariant referencing the bug pattern this PR fixes |

### Design Principles

1. **Three-file sync is a hard invariant.** A property exists in `tools.ts` (LLM-visible JSON schema) iff it exists in `schemas.ts` (Zod validator) iff it is consumed by `intent.ts`. The `messages` and `STRU` fixes are pure synchronization — handler and Zod already agree, this PR aligns the LLM-visible schema.
2. **Universal first.** Each item in this PR ships behavior that is correct on every supported SAP release. Where PR #196 used `isRelease750()` to vary an error message, this PR uses a single neutral message that doesn't depend on release detection.
3. **Reject at the handler.** Pre-flight validations (mixed-case, STRU-vs-TABL) run in `handleSAPWrite` before the lock+modify+unlock sequence, so the operator sees a structured error without burning a lock cycle.
4. **STRU-update guard is best-effort.** `searchObject(name)` may fail on backends with restricted search; in that case proceed cautiously and let SAP's own validations catch the case (matches PR #196's `try/catch` behavior). The guard adds value when the search succeeds; it is not load-bearing.
5. **Don't break existing TABL writes.** TABL stays in `SAPWRITE_TYPES_ONPREM` exactly as it is today. Adding STRU is purely additive.

## Development Approach

Implement in three small passes: tool-schema sync first, then handler validations, then docs and tests. Each pass has its own task. The mixed-case rejection logic is shared between `create` and `batch_create` — extract it into a small helper to avoid duplication.

For the STRU-update guard, reuse the existing `searchObject` primitive ([src/adt/client.ts](../../src/adt/client.ts) `client.searchObject(name, 1)`). Match by uppercase name, accept-anything-but-`TABL/DS` as "wrong type". Emit specific guidance for the common case (`TABL/DT`).

## Validation Commands

- `npm test`
- `npm test -- tests/unit/handlers/intent.test.ts`
- `npm test -- tests/unit/handlers/tools.test.ts`
- `npm run typecheck`
- `npm run lint`
- `npm run test:e2e -- ddic-write` (when e2e is wired and TEST_SAP_URL is configured)

### Task 1: Expose `messages` in the SAPWrite JSON tool schema

**Files:**
- Modify: `src/handlers/tools.ts`

The handler and Zod already accept `messages`, but the LLM-visible JSON schema doesn't list it. Add the property to both the top-level SAPWrite schema and the `batch_create` items schema.

- [ ] In `getToolDefinitions`, locate the SAPWrite tool definition (`name: 'SAPWrite'`). After the existing DTEL/SRVB property entries inside `properties: {…}`, add:
    ```ts
    messages: {
      type: 'array',
      description: 'MSAG: message entries for create/update',
      items: {
        type: 'object',
        properties: {
          number: { type: 'string', description: 'Message number (e.g., "001")' },
          shortText: { type: 'string', description: 'Message short text (use & for placeholders: "&1", "&2")' },
        },
        required: ['number', 'shortText'],
      },
    },
    ```
- [ ] Locate the `batch_create` `items.properties` block (the inline JSON Schema for each object inside the batch array). Mirror the same `messages` property there.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm test -- tests/unit/handlers/tools.test.ts` — if no test file exists yet, skip this command and add it under Task 4.

### Task 2: Make STRU a first-class writable type

**Files:**
- Modify: `src/handlers/tools.ts`

PR #196 added STRU to the Zod schema (`SAPWRITE_TYPES_ONPREM` in [src/handlers/schemas.ts](../../src/handlers/schemas.ts)) and to the handler (`buildCreateXml` case, `createContentTypeForType`, `objectBasePath`). This task closes the three-file sync by adding STRU to the JSON-schema-side type lists and updating the description blurb.

- [ ] In `SAPWRITE_TYPES_ONPREM` (around line 79), add `'STRU'` immediately after `'TABL'`.
- [ ] In `SAPWRITE_TYPES_BTP` (around line 96), add `'STRU'` immediately after `'TABL'`.
- [ ] In `SAPWRITE_DESC_ONPREM` (around line 107), update the supported-types list: replace `..., TABL, DOMA, DTEL, MSAG.` with `..., TABL, STRU, DOMA, DTEL, MSAG.`.
- [ ] Append a sentence at the end of `SAPWRITE_DESC_ONPREM` (and `SAPWRITE_DESC_BTP` if it has the same structure): *"STRU uses source-based writes via /source/main with the same `define type` syntax as DDLS; structures and tables are different DDIC categories — use STRU for parameter/return-type composition, TABL for persistent transparent tables."*
- [ ] If `getToolDefinitions` previously had a conditional `if (!types.includes('TABL') && !types.includes('STRU')) types.push('STRU')` block (carry-over from PR #196), remove it — STRU is now in the static list.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm test` — all tests pass.

### Task 3: Mixed-case object name rejection in `handleSAPWrite` create + batch_create

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

SAP TADIR stores object names uppercase. Mixed-case names cause silent corruption (e.g. DDLS created as "Zc_MyView" registers as "ZC_MYVIEW" in TADIR but the source still contains "Zc_MyView", confusing every downstream tool). Reject at the handler so the operator gets a clean error before any HTTP traffic.

- [ ] Inside `handleSAPWrite`, immediately after `name` is parsed and the early `return errorResult('"type" and "name" are required …')` block, add a check:
    ```ts
    if (action === 'create' && name && name !== name.toUpperCase()) {
      return errorResult(
        `Object name "${name}" contains lowercase characters. SAP object names must be uppercase (e.g. "${name.toUpperCase()}").\n\n` +
        `Note: the object NAME in TADIR must be uppercase, but the source code inside the object can use mixed case ` +
        `(e.g. for DDLS: name="${name.toUpperCase()}" but source can contain "define view entity ${name}").`,
      );
    }
    ```
- [ ] Inside the `batch_create` loop, add the same check per object. If a mixed-case name is found, push a `failed` result for that object with the same explanation, and `break` (matches the PR #196 behavior of aborting the batch on first failure).
- [ ] Add unit tests (~3 tests) in `tests/unit/handlers/intent.test.ts`:
    - **Test 1**: `SAPWrite(action='create', type='DDLS', name='Zarc1_Mixed', package='$TMP', source='…')` returns an error result whose text contains "uppercase" and the suggested uppercase form.
    - **Test 2**: All-uppercase name proceeds past the check (mock the lock+create chain to assert no early return).
    - **Test 3**: `batch_create` with a mixed-case name in position 2 returns `results[1].status === 'failed'` and stops processing further objects.
- [ ] Run `npm test -- tests/unit/handlers/intent.test.ts` — all tests must pass.

### Task 4: STRU-update guard against transparent tables

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

The `/sap/bc/adt/ddic/structures/` PUT endpoint silently converts a transparent table (`TABL/DT`) into a structure (`TABL/DS`) by creating an inactive `INTTAB` version. This corrupts DD02L on every release where the endpoint exists. Pre-flight check using `client.searchObject` rejects the case before locking.

- [ ] Inside `handleSAPWrite` for `case 'update'` of `type === 'STRU'` (after the mixed-case check, before the lock+modify path), add:
    ```ts
    if (type === 'STRU' && action === 'update' && name) {
      try {
        const searchResults = await client.searchObject(name, 1);
        const match = searchResults.find((r) => r.objectName.toUpperCase() === name.toUpperCase());
        if (match && match.objectType !== 'TABL/DS') {
          if (match.objectType === 'TABL/DT') {
            return errorResult(
              `"${name}" is a transparent table (TABL/DT), not a structure. ` +
              `Use SAPWrite(type="TABL") instead, or SE11 if your SAP release does not expose the /ddic/tables/ endpoint.`,
            );
          }
          return errorResult(
            `"${name}" exists as ${match.objectType}, not a structure (TABL/DS). ` +
            `SAPWrite(type="STRU") only works with DDIC structures.`,
          );
        }
      } catch {
        // search failed — proceed cautiously; SAP-side validations will catch a wrong type
      }
    }
    ```
    The error message is **single and neutral** — no `isRelease750()` branch. The fallback hint mentions both `SAPWrite(type="TABL")` and SE11 so it covers all releases.
- [ ] Add unit tests (~3 tests) in `tests/unit/handlers/intent.test.ts`:
    - **Test 1**: `SAPWrite(action='update', type='STRU', name='T000')` where `searchObject` returns `[{ objectName: 'T000', objectType: 'TABL/DT' }]` returns an error result whose text contains "transparent table" and "TABL/DT".
    - **Test 2**: `searchObject` returns a non-`TABL/DS`, non-`TABL/DT` object (e.g. `'CLAS/OC'`) returns the second-branch error message containing the actual type.
    - **Test 3**: `searchObject` throws → guard swallows the error and the lock+update chain proceeds (mock the chain to assert it was reached).
- [ ] Run `npm test -- tests/unit/handlers/intent.test.ts` — all tests must pass.

### Task 5: Tool-definition sanity tests

**Files:**
- Create or modify: `tests/unit/handlers/tools.test.ts`

Lock the three-file sync invariant in tests so future regressions are caught immediately.

- [ ] If `tests/unit/handlers/tools.test.ts` exists, add tests to it. Otherwise create the file with the standard imports (`vitest`, `getToolDefinitions`, sample `ServerConfig`, sample `ResolvedFeatures`).
- [ ] Add unit tests (~4 tests):
    - **Test 1**: SAPWrite tool definition includes a `messages` property of type `array` with `number` and `shortText` items. Both top-level and `batch_create` items.
    - **Test 2**: `SAPWRITE_TYPES_ONPREM` contains `'STRU'` (verify by inspecting the resulting tool's `properties.type.enum` for the on-prem build).
    - **Test 3**: `SAPWRITE_TYPES_BTP` contains `'STRU'` (verify via the BTP build).
    - **Test 4**: SAPWrite description text mentions `STRU` and the `define type` usage hint.
- [ ] Run `npm test -- tests/unit/handlers/tools.test.ts` — all tests must pass.

### Task 6: E2E coverage for mixed-case rejection

**Files:**
- Modify: `tests/e2e/ddic-write.e2e.test.ts`

PR #196 added an e2e test that asserts mixed-case create returns an error. Cherry-pick that single test (without the `version`-related STRU lifecycle test, which is deferred per ADR-0003).

- [ ] Add a new `it('SAPWrite rejects mixed-case object names on create', …)` block inside the existing `describe('E2E DDIC metadata write tests', …)` block in `tests/e2e/ddic-write.e2e.test.ts`. Body:
    ```ts
    const result = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'DDLS',
      name: 'Zarc1_Mixed_Case',
      package: '$TMP',
      source: 'define view entity Zarc1_Mixed_Case as select from t000 { key mandt }',
    });
    expectToolError(result, 'uppercase');
    ```
- [ ] Verify the test runs cleanly via `npm run test:e2e -- ddic-write` when `TEST_SAP_URL` is configured (skip via `requireOrSkip` otherwise — match the surrounding test conventions).

### Task 7: Documentation

**Files:**
- Modify: `docs_page/tools.md`
- Modify: `CLAUDE.md`

Operator-facing surface (tools.md) and contributor-facing invariants (CLAUDE.md) both need to know about the new sync.

- [ ] In `docs_page/tools.md`, in the `SAPWrite` section, add a one-line entry under "Supported types" or equivalent: *"`STRU` — DDIC structures via `/ddic/structures/`. Same `define type` source syntax as DDLS."*
- [ ] In the same `SAPWrite` section, under the MSAG section (or add one), document `messages` as an array property: *"`messages: [{ number, shortText }]` — message entries for MSAG create/update. Use `&1`, `&2` placeholders inside `shortText` for parameterized messages."*
- [ ] In `CLAUDE.md` "Security & Architectural Invariants" section, append: *"**Tool schema three-file sync.** Every tool property must exist in all three files: `tools.ts` (JSON Schema for LLMs), `schemas.ts` (Zod validation), `intent.ts` (handler logic). A property missing from `tools.ts` is invisible to LLMs even though validation and the handler support it. When adding a new property, update all three files. Batch object schemas (e.g., `batch_create` items) are defined separately from the top-level schema — check both."*
- [ ] Run `npm run lint` — no new lint errors.

### Task 8: Final verification

- [ ] Run `npm test` — all unit tests pass (target: ~3 mixed-case tests, ~3 STRU-guard tests, ~4 tool-definition tests).
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors.
- [ ] When `TEST_SAP_URL` configured: run `npm run test:e2e -- ddic-write` and confirm the new mixed-case rejection test passes.
- [ ] Move this plan to `docs/plans/completed/`.
