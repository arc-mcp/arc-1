# Bind the ATC check variant ARC-1 claims to run

## Overview

`SAPDiagnose action="atc"` without a `variant` sends no `checkVariant` query parameter. SAP does **not**
fall back to the configured system check variant in that case — it runs the Code Inspector variant
literally named `DEFAULT`. Every ARC-1 doc, the tool description, two research dossiers and two skills
claim the opposite ("omit `variant` → system default"). The claim traces back to a misreading of an
adt-ls decompile note: `AtcCheckService.getSystemDefaultCheckVariant()` runs **client-side** in SAP's
own language server, not in the ABAP backend.

This plan makes the behavior match the documented contract: when the caller passes no `variant`,
`runAtcCheck` resolves `systemCheckVariant` from `/sap/bc/adt/atc/customizing` and sends it explicitly —
exactly what SAP's own adt-ls does. It also closes a second trap measured live: an unknown/misspelled
variant name is **not rejected** by SAP; the worklist silently binds `DEFAULT` and the run looks
successful. Finally it corrects every doc and skill location carrying the wrong claim.

Key decisions:
- Resolution happens inside `runAtcCheck` (`src/adt/atc.ts`), not in the handler — the integration test
  and the CLI both call it directly, and a handler-level fix would leave those paths wrong.
- `AtcRunResult.variant` becomes the **effective** variant (what was actually sent), with a new
  `variantSource: 'requested' | 'systemDefault' | 'sapFallback'` so a caller can tell how it was chosen.
- Variant validation is **fail-open**: if `/atc/variants` itself errors, the ATC run proceeds. A
  validation lookup must never break a working check run.
- No new config flags, no caching, no change to the legacy `{findings}` output shape.
- Release-invariant by construction: both endpoints the fix needs exist on 7.50, 758 and 816, and on
  7.50 `systemCheckVariant` is already `DEFAULT`, so the change is a behavioral no-op there.

## Context

### Current State

- `runAtcCheck()` in `src/adt/atc.ts` builds `worklistPath` as
  `/sap/bc/adt/atc/worklists?checkVariant=<v>` when `variant` is truthy, else the bare
  `/sap/bc/adt/atc/worklists`. It never resolves a default.
- `parseAtcRunResult()` and `incompleteAtcResult()` in the same file set `variant: context.variant ?? null`
  — i.e. they echo the **requested** variant, so a run that SAP silently redirected to `DEFAULT` still
  reports the caller's string.
- `getAtcSystemDefaultVariant()` and `listAtcVariants()` already exist in `src/adt/atc.ts` (added by
  FEAT-68) and are re-exported through `src/adt/devtools.ts`. Today they are used **only** by
  `case 'atc_variants'` in `src/handlers/diagnose.ts`.
- `case 'atc'` in `src/handlers/diagnose.ts` forwards `args.variant` verbatim and spreads the whole
  result for `resultFormat: 'structured'`; the legacy success path returns `{ findings }` only.
- `docs/dev-guide.md` (ATC-run row), `AGENTS.md` (ATC-run row), the `parseAtcSystemCheckVariant`
  docstring in `src/adt/xml-parser.ts`, the `atc_variants` comment in `src/handlers/diagnose.ts`,
  `src/handlers/tools.ts`, `src/cli.ts`, `docs_page/tools.md`, `docs_page/cli-guide.md`,
  `docs_page/roadmap.md`, two `docs/research/` dossiers, one `docs/plans/` file, and the
  `skills/migrate-custom-code` + `skills/sap-clean-core-atc` skills all state or imply that omitting
  `variant` runs the system default.

### Target State

- `SAPDiagnose(action="atc", type="CLAS", name="ZCL_X")` binds the system's configured check variant.
- `SAPDiagnose(action="atc", …, resultFormat="structured")` returns the effective variant plus how it
  was chosen:
  ```json
  { "findings": [], "variant": "ZABAP_CLOUD_DEVELOPMENT", "variantSource": "systemDefault", "...": "..." }
  ```
- `SAPDiagnose(action="atc", …, variant="S4HANA_READINES_2023")` (typo) fails fast with
  `Check variant "S4HANA_READINES_2023" does not exist on this system — SAP would silently run
  "DEFAULT" instead. List variants with SAPDiagnose(action="atc_variants").`
- A system without `/atc/customizing` degrades to today's behavior with `variantSource: "sapFallback"`.
- Every doc and skill states the corrected behavior.

### Key Files

| File | Role |
|------|------|
| `src/adt/atc.ts` | `runAtcCheck`, `listAtcVariants`, `getAtcSystemDefaultVariant`, `AtcRunResult`, `parseAtcRunResult`, `incompleteAtcResult` — the whole fix lives here |
| `src/handlers/diagnose.ts` | `case 'atc'` (forwards `variant`, spreads result) and `case 'atc_variants'` (comment to correct) |
| `src/adt/devtools.ts` | Re-export barrel for the ATC functions — no logic |
| `src/adt/xml-parser.ts` | `parseAtcSystemCheckVariant` + its (wrong) docstring |
| `src/handlers/tools.ts` | SAPDiagnose description text + the `variant` parameter description |
| `src/cli.ts` | `arc1-cli atc <type> <name>` CI command (~line 626) — calls `SAPDiagnose` with `resultFormat: 'structured'`, then `evaluateAtc`; owns the `--variant` help text (~line 628) |
| `src/cli-checks.ts` | `evaluateAtc` (structured-evidence CI gate, ~line 209), `atcToCheckstyle` (~line 382), `formatAtcText` (~line 411) — all typed on `AtcRunResult` |
| `tests/unit/cli/cli-checks.test.ts` | `atc()` factory (~line 33) builds a **complete** `AtcRunResult` literal — a new required field breaks typecheck here |
| `tests/unit/adt/devtools.test.ts` | `describe('runAtcCheck')` (~line 2022) and `describe('listAtcVariants + getAtcSystemDefaultVariant (FEAT-68)')` (~line 2576) |
| `tests/unit/handlers/lint-diagnose.test.ts` | `describe('SAPDiagnose action=atc_variants (FEAT-68)')` (~line 2281) and the ATC handler tests above it |
| `tests/integration/adt.integration.test.ts` | `describe('runAtcCheck (worklist + variant flow)')` (~line 2243) |
| `tests/fixtures/tool-definitions/*.json` | Frozen LLM-visible tool surface (6 files) — regenerate if `tools.ts` text changes |
| `AGENTS.md`, `docs/dev-guide.md`, `docs_page/{tools,cli-guide,roadmap,release-notes}.md` | Documentation carrying the wrong claim |
| `skills/migrate-custom-code/SKILL.md`, `skills/sap-clean-core-atc/SKILL.md` | Skills instructing agents to omit `variant` for "the system default" |

### Verified Live Evidence

Full dossier: `docs/research/2026-08-19-atc-default-check-variant.md`.

**2026-08-19, a4h (S/4HANA 2023 / SAP_BASIS 758)** — five consecutive `SAPDiagnose action=atc` runs against
`PROG Z_CREATE_BOOKING_SAMPLES`, then `SELECT check_run_ix, chk_profile_name FROM satc_ac_resulth`
(`SATC_AC_RESULTH.CHK_PROFILE_NAME` records the variant SAP really used):

| Run | Call | `CHK_PROFILE_NAME` |
|---|---|---|
| 734 | no `variant` | **`DEFAULT`** |
| 735 | `variant="ZABAP_CLOUD_DEVELOPMENT"` (= `systemCheckVariant`) | `ZABAP_CLOUD_DEVELOPMENT` |
| 736 | `variant="DEFAULT"` | `DEFAULT` |
| 737 | `variant="SAP_CLOUD_PLATFORM_DEFAULT"` | `SAP_CLOUD_PLATFORM_DEFAULT` |
| 738 | `variant="ZZZ_DOES_NOT_EXIST"` | **`DEFAULT`** — silent fallback, HTTP 200, no error |

Findings differ materially: no-variant → 3 findings (2× "Use of ROLLBACK WORK", 1× SLIN); the system
default → 2 findings including the prio-1 *"Objects of type PROG are not allowed in ABAP Cloud
Development"* that the bare run never surfaces.

**2026-08-19, an independent customer system (758 family)** — the discriminating case, because there the
three candidate names are all different: `SCICHKV_ALTER` maps `DEFAULT` → `/<NS>/FT_DEFAULT` while
`SATC_CI_CF.CHECKVARIANT` (= `systemCheckVariant`) is `/<NS>/DEFAULT`. An ARC-1 run without `variant`
recorded **`DEFAULT`** — proving the ADT worklist path uses the name **literally** and applies neither
`systemCheckVariant` nor the Code Inspector alias table. Same object with the configured variant returned
dozens of findings across four check groups versus 4 SLIN-only findings for the bare run.

**Endpoint availability (measured 2026-08-19 unless noted):**

| Release | `GET /atc/customizing` → `systemCheckVariant` | `GET /atc/variants?name=*` |
|---|---|---|
| NW 7.50 SP02 (`npl`) | 200, `DEFAULT` | 200, 178 variants |
| S/4HANA 2023 / 758 (`a4h`) | 200, `ZABAP_CLOUD_DEVELOPMENT` | 200, 184 variants |
| ABAP Platform 2025 / 816 | 200 (FEAT-68 dossier, live-verified 2026-07-24) | 200, 215 variants (same source) |

**Cross-source corroboration:** `~/DEV/arc-1-lsp/docs/research/adt-ls-capability-map.md` §3c — SAP's own
language server resolves the default **client-side** (`AtcCheckService.getSystemDefaultCheckVariant()`)
when `checkVariant` is empty, then sends it. `~/DEV/mcp-abap-adt-fr0ster/docs/adt-discovery.xml:4478` and
live discovery on 7.50/758 both show `/sap/bc/adt/atc/worklists{?checkVariant}` — an optional parameter
with no documented server-side default.

**Rejected alternative (do not re-litigate):** reading the effective variant back after the run.
`GET /sap/bc/adt/atc/results/{displayId}` does return `<atcresult:checkVariant>`, but `displayId ≠ worklistId`
(measured: worklist `…45B9F8A2` → display `…45BB58A2`) and there is no mapping endpoint —
`GET /sap/bc/adt/atc/result/worklist/{worklistId}` returns 404 and the discovery template requires both ids.

### Design Principles

1. **Send an explicit `checkVariant` on every run.** This removes the dependency on SAP's internal
   fallback, which was only ever measured on 758.
2. **Resolution lives in `runAtcCheck`,** so the MCP handler, the CLI, and the integration tests all get
   the corrected behavior from one place.
3. **Default resolution fails closed on real errors, open on absence.** Swallow only 404/406 from
   `/atc/customizing` (endpoint absent or not negotiable) → `variantSource: 'sapFallback'`. Rethrow 401,
   403, 5xx and network failures — a permissions problem must not masquerade as a missing endpoint.
   This mirrors the existing policy in `case 'atc_variants'` in `src/handlers/diagnose.ts`.
4. **Variant validation fails open in all cases.** `/atc/variants` is advisory; if the lookup throws for
   any reason, run ATC anyway. A guard that can break the primary operation is worse than the trap it
   guards.
5. **`incompleteReasons` must not grow.** `src/handlers/diagnose.ts` turns `!result.complete` into an
   `errorResult`; adding a variant note there would convert successful runs into errors.
6. **The legacy output shape is frozen.** The successful legacy path stays exactly `{ findings }`.
   The new fields are visible only via `resultFormat: "structured"` (and in the existing
   incomplete/error payload, which already spreads the full result).
7. **Release-invariant.** Both required endpoints exist on 7.50, 758 and 816. On 7.50
   `systemCheckVariant` is `DEFAULT`, so the effective variant is unchanged there — no regression risk
   on the oldest supported release.
8. **No new config.** No env vars, no flags, no cache. One extra ADT GET on a multi-second, multi-request
   operation is acceptable; revisit caching only if per-object ATC batching appears.

## Development Approach

Work TDD: for each behavior change write the failing unit test first, then the implementation.

`tests/unit/adt/devtools.test.ts` already has the helpers this needs — `mockHttp(responseBody)` (~line 35)
returns an `AdtHttpClient` whose `get`/`post` both resolve `{statusCode: 200, headers: {}, body}`, and
`mockHttpSequence(...)` (~line 46) sequences `post` responses. The existing ATC tests override `get`
separately (`{...mockHttp(createResp), get: vi.fn()...}`). Because `runAtcCheck` will now issue a `GET`
to `/atc/customizing` **before** the worklist POST, every existing `runAtcCheck` test whose `get` mock
returns the worklist body will also serve that customizing GET — the parser returns `undefined` for a
body without `systemCheckVariant`, which lands on `variantSource: 'sapFallback'` and the bare worklist
path. That keeps the existing assertions valid, but the tests that assert the worklist URL must be
updated deliberately, not left to coincidence: use a URL-dispatching `get` mock
(`u.includes('/atc/customizing') ? CUSTOMIZING : WORKLIST`) in the tests that care.

Fixture provenance: the `CUSTOMIZING` and `VARIANTS` XML constants in
`describe('listAtcVariants + getAtcSystemDefaultVariant (FEAT-68)')` are trimmed real 816 responses —
reuse them rather than inventing new shapes. The full real 758 customizing body is quoted in
`docs/research/2026-08-19-atc-default-check-variant.md` §3.

Failure paths that must be tested, not just the happy path: customizing 404 (fallback), customizing 403
(propagates), unknown variant (rejected), `/atc/variants` throwing (fail-open), and a polluted-payload
case (`variant: ""` must behave as "not supplied" — `stripLlmEmptyValues` already drops empty strings
before Zod, so the unit test asserts the `runAtcCheck` level directly with `variant: ''`).

Integration tests need `TEST_SAP_URL`; they must not be added to Validation Commands.

Scope boundary: this plan does not add caching, does not change the `atc_variants` action's output
shape, and does not touch the ATC parsing/completeness logic.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Resolve and send the system default check variant in `runAtcCheck`

**Files:**
- Modify: `src/adt/atc.ts` (`AtcRunResult`, `runAtcCheck`, `parseAtcRunResult`, `incompleteAtcResult`)
- Modify: `src/cli-checks.ts` (`formatAtcText`; verify `evaluateAtc` + `atcToCheckstyle` need no change)
- Modify: `tests/unit/adt/devtools.test.ts` (`describe('runAtcCheck')` at ~line 2022)
- Modify: `tests/unit/cli/cli-checks.test.ts` (the `atc()` factory at ~line 33)

SAP maps an empty `checkVariant` to the Code Inspector variant literally named `DEFAULT`, not to the
system's configured `systemCheckVariant` (measured on two 758 systems — see "Verified Live Evidence").
SAP's own adt-ls resolves the default client-side and sends it; ARC-1 must do the same so the run
matches the system's ATC configuration and so the reported variant is the one that actually ran.

- [ ] Add the source type next to `AtcRunResult` in `src/adt/atc.ts`:
      `export type AtcVariantSource = 'requested' | 'systemDefault' | 'sapFallback';`
- [ ] In `interface AtcRunResult`, add `variantSource: AtcVariantSource;` right after the existing
      `variant: string | null;` field, and update the doc comment on `variant` to say it is the
      **effective** variant that was bound at worklist creation
- [ ] In `runAtcCheck`, after the existing `checkOperation(safety, OperationType.Read, 'RunATCCheck')`
      and before `worklistPath` is built, resolve the effective variant. Treat a blank string as absent:

      const requested = variant?.trim() ? variant.trim() : undefined;
      let effectiveVariant = requested;
      let variantSource: AtcVariantSource = requested ? 'requested' : 'systemDefault';
      if (!effectiveVariant) {
        effectiveVariant = await getAtcSystemDefaultVariant(http, safety).catch((error) => {
          if (error instanceof AdtApiError && (error.statusCode === 404 || error.statusCode === 406)) return undefined;
          throw error;
        });
        if (!effectiveVariant) variantSource = 'sapFallback';
      }

- [ ] Build `worklistPath` from `effectiveVariant` (bare `/sap/bc/adt/atc/worklists` only when it is
      still undefined), and pass `effectiveVariant` + `variantSource` into the `context` object of
      `parseAtcRunResult` and into `incompleteAtcResult` instead of the raw `variant` parameter
- [ ] Update `parseAtcRunResult`'s `context` parameter type and its returned `variant`/`variantSource`
      fields, and update `incompleteAtcResult`'s signature the same way (it is called from two places:
      the run-POST deadline catch and the first-poll deadline catch — both must pass the resolved values)
- [ ] Regression guard: when a caller passes a variant, the worklist URL keeps today's shape
      (`/sap/bc/adt/atc/worklists?checkVariant=<encoded caller string>`) and **no** `/atc/customizing`
      request may be issued. (Task 2 later refines *which* string is sent — it canonicalises the case
      against the variant feed — but never changes the URL shape or reintroduces the customizing fetch.)
- [ ] `AtcRunResult` is consumed outside `src/adt/atc.ts` — a new **required** field is a compile error in
      the `atc()` factory at `tests/unit/cli/cli-checks.test.ts:~33`, which builds a full literal. Add
      `variantSource: 'sapFallback'` to that factory's defaults so existing CLI cases keep their meaning
- [ ] Verify (do not assume) that `evaluateAtc` in `src/cli-checks.ts:~209` still passes: its soundness
      gate reads named fields only and already accepts `result.variant === null || typeof … === 'string'`,
      so an added field is inert. `atcToCheckstyle` likewise needs no change — confirm by reading both
- [ ] Surface the bound variant in `formatAtcText` (`src/cli-checks.ts:~411`): append
      `, variant=<result.variant ?? 'DEFAULT (SAP fallback)'>` to the existing summary line. `arc1-cli atc`
      is the CI gate — the report must say which variant it gated on. Update the `formatAtcText`
      assertion in `tests/unit/cli/cli-checks.test.ts` (~line 270) accordingly
- [ ] Add unit tests (~6 tests) in `describe('runAtcCheck')` in `tests/unit/adt/devtools.test.ts`. Use a
      URL-dispatching `get` mock so the customizing GET and the worklist GET return different bodies;
      reuse the `CUSTOMIZING` constant shape from `describe('listAtcVariants + getAtcSystemDefaultVariant (FEAT-68)')`
      (~line 2576):
      - no `variant` → worklist POST URL is `?checkVariant=ZABAP_CLOUD_DEVELOPMENT`, result
        `variant === 'ZABAP_CLOUD_DEVELOPMENT'`, `variantSource === 'systemDefault'`
      - `variant: ''` (LLM-polluted empty string) behaves exactly like "not supplied"
      - explicit `variant: 'S4HANA_READINESS_2023'` → `variantSource === 'requested'`, and the
        customizing endpoint was never fetched
      - customizing returns 404 (`AdtApiError`) → bare worklist path, `variant === null`,
        `variantSource === 'sapFallback'`
      - customizing returns 403 (`AdtApiError`) → `runAtcCheck` rejects (does NOT silently degrade)
      - customizing body without `systemCheckVariant` → `variantSource === 'sapFallback'`
- [ ] Fix any existing `describe('runAtcCheck')` test that asserted the bare worklist URL for a
      no-variant call — that assertion is now wrong by design; make the intent explicit rather than
      relying on the customizing mock happening to return a non-matching body
- [ ] Run `npm test` — all tests must pass

### Task 2: Reject an unknown caller-supplied check variant

**Files:**
- Modify: `src/adt/atc.ts` (`runAtcCheck`)
- Modify: `tests/unit/adt/devtools.test.ts` (`describe('runAtcCheck')` at ~line 2022)

Measured live on a4h/758: `variant="ZZZ_DOES_NOT_EXIST"` returns HTTP 200 and runs `DEFAULT`
(`SATC_AC_RESULTH.CHK_PROFILE_NAME = DEFAULT`, run 738). Nothing in the worklist or run response reveals
the substitution, so a misspelled variant produces a confident, wrong compliance report. One
`GET /atc/variants?name=<exact>` before minting the worklist turns that into a clear error.

- [ ] This refines Task 1: for a caller-supplied variant, the string sent to SAP becomes the canonical
      feed name instead of the caller's verbatim input. The URL shape and the "no `/atc/customizing`
      fetch when a variant is given" guarantee both stay as Task 1 established them
- [ ] In `runAtcCheck`, when `requested` is set, call `listAtcVariants(http, safety, requested)` and look
      for a case-insensitive exact name match. Send the **canonical** matched name as `effectiveVariant`
      (SAP variant names are uppercase or namespaced; normalising a lowercase caller string prevents a
      second silent fallback)
- [ ] On zero matches, throw
      `new AdtApiError(\`Check variant "\${requested}" does not exist on this system — SAP would silently run "DEFAULT" instead. List variants with SAPDiagnose(action="atc_variants").\`, 400, '/sap/bc/adt/atc/variants')`
- [ ] Fail open: wrap the `listAtcVariants` call so that **any** thrown error (endpoint absent, auth,
      network) is swallowed and the run proceeds with the caller's verbatim string. Only a successful
      lookup that returns no match may reject. Add a one-line comment stating this is deliberate — a
      validation lookup must never break a working ATC run
- [ ] Note: `listAtcVariants` already defaults a blank filter to `*`; `requested` is guaranteed non-blank
      here because Task 1 trims it, so the lookup is always an exact-name query
- [ ] Add unit tests (~4 tests) in `describe('runAtcCheck')`:
      - known variant → proceeds, worklist bound to the canonical name from the feed
      - lowercase caller input matching a feed entry → worklist bound to the feed's uppercase name
      - unknown variant → rejects with `/does not exist on this system/` and **no** worklist POST is issued
      - `/atc/variants` throws → run proceeds with the caller's string (fail-open)
- [ ] Run `npm test` — all tests must pass

### Task 3: Wire the effective variant through the handler and correct the tool surface text

**Files:**
- Modify: `src/handlers/diagnose.ts` (`case 'atc'` and the comment above `case 'atc_variants'`)
- Modify: `src/handlers/tools.ts` (SAPDiagnose description; the `variant` property description)
- Modify: `tests/unit/handlers/lint-diagnose.test.ts` (ATC handler tests, above
  `describe('SAPDiagnose action=atc_variants (FEAT-68)')` at ~line 2281)
- Modify: `tests/fixtures/tool-definitions/*.json` (6 files — regenerate, do not hand-edit)

`case 'atc'` spreads the whole result for `resultFormat: "structured"`, so `variantSource` flows through
without a code change — but that must be proven by a test, and the LLM-visible description still tells
models that omitting `variant` uses the system default.

- [ ] Verify (do not assume) that `case 'atc'` in `src/handlers/diagnose.ts` needs no logic change: the
      structured branch returns `{...result}` and the incomplete branch returns `{...result, hint}`, both
      of which now carry `variant` + `variantSource`. The successful legacy branch must stay exactly
      `textResult(toolJson({ findings: result.findings }))`
- [ ] Correct the comment above `case 'atc_variants'` (~line 888) — `systemDefault` is what ARC-1 now
      binds when no `variant` is given, not something SAP applies on its own
- [ ] In `src/handlers/tools.ts`, update the SAPDiagnose action list line for `atc`/`atc_variants`
      (~line 1091) and the `variant` property description (~line 1197) so they describe the shipped
      behavior: `atc` binds the system's configured check variant when `variant` is omitted, and an
      unknown variant name is rejected. Keep the added bytes minimal — this text is part of the
      per-tool schema budget
- [ ] Add handler unit tests (~3 tests) in `tests/unit/handlers/lint-diagnose.test.ts` using the
      `mockFetch.mockImplementation` URL-dispatch pattern already used by
      `describe('SAPDiagnose action=atc_variants (FEAT-68)')`:
      - `action="atc"` with no `variant` and `resultFormat="structured"` → payload has
        `variantSource: "systemDefault"` and `variant` equal to the mocked `systemCheckVariant`; the
        request list contains `/atc/worklists?checkVariant=<that name>`
      - `action="atc"` with no `variant` and no `resultFormat` (legacy) → payload is exactly
        `{ findings: [...] }` with no `variant`/`variantSource` keys (shape-freeze guard)
      - `action="atc"` with an unknown `variant` → `result.isError` is set and the message matches
        `/does not exist on this system/`
- [ ] Regenerate the frozen tool-definition fixtures with `npx vitest run tests/unit/handlers/tool-definitions-snapshot.test.ts -u`
      and review the diff — only the SAPDiagnose description strings may change, in all 6 files
- [ ] Run `npm test` — all tests must pass

### Task 4: Extend the live ATC integration test

**Files:**
- Modify: `tests/integration/adt.integration.test.ts` (`describe('runAtcCheck (worklist + variant flow)')` at ~line 2243)

The existing test `'completes the flow with the system default variant (no variant passed)'` asserts only
that the flow completes. It must now assert *which* variant was bound, which is the whole point of the fix.

- [ ] Rename that test to reflect the corrected semantics (e.g. `'binds the system default variant when none is passed'`)
      and assert `result.variantSource === 'systemDefault'` and that `result.variant` equals the value
      returned by `getAtcSystemDefaultVariant(client.http, unrestrictedSafetyConfig())`. Import
      `getAtcSystemDefaultVariant` from `../../src/adt/devtools.js` alongside the existing `runAtcCheck` import
- [ ] Keep the existing `expectSoundResult(result)` assertion — completeness evidence must not regress
- [ ] Add a negative test: `runAtcCheck(..., KERNEL_CLASS_URL, 'ZZZ_ARC1_NO_SUCH_VARIANT', {timeoutMs: 30_000})`
      rejects. Assert the expected error class with `expectSapFailureClass` from
      `tests/helpers/expected-error.ts` (status `400`, message `/does not exist on this system/`) — never
      an empty `catch {}`, per `docs/testing-skip-policy.md`
- [ ] Do NOT add integration commands to `## Validation Commands` — `requireSapCredentials()` throws
      without `TEST_SAP_URL` and would fail every ralphex task
- [ ] Run `npm test` — the unit suite must still pass (integration tests are a separate lane)

### Task 5: Correct the internal documentation

**Files:**
- Modify: `AGENTS.md` (the `ATC run (SAPDiagnose action=atc)` row in "Key Files for Common Tasks")
- Modify: `docs/dev-guide.md` (~line 167, the `Modify ATC check run` row)
- Modify: `src/adt/xml-parser.ts` (`parseAtcSystemCheckVariant` docstring, ~line 1235)
- Modify: `docs/research/2026-06-03-atc-quickfix-surface-a4h.md` (~lines 31, 37)
- Modify: `docs/research/2026-07-24-feat68-atc-variant-listing.md` (~lines 10, 44)
- Modify: `docs/plans/2026-07-24-feat68-atc-variant-listing.md` (~line 8)
- Delete: `docs/plans/2026-08-19-atc-effective-check-variant.md` (superseded draft — this plan replaces it)

These all assert "omit `checkVariant` → system default", which is measurably false. The FEAT-68 dossier is
the origin of the error and must be marked disproven so the claim does not get re-derived.

- [ ] `AGENTS.md`: update the ATC-run row to state that SAP maps an empty `checkVariant` to the CI variant
      `DEFAULT` and that `runAtcCheck` therefore resolves and sends `systemCheckVariant` itself. Keep the
      row terse — one gotcha per row, per the file's own rule; depth belongs in `docs/dev-guide.md`
- [ ] `docs/dev-guide.md`: replace "(omit `checkVariant` → system default)" with the verified behavior and
      link `docs/research/2026-08-19-atc-default-check-variant.md`
- [ ] `src/adt/xml-parser.ts`: the docstring currently says "This is the variant ATC runs when
      `checkVariant` is empty" — it is not; say it is the system's configured ATC variant that ARC-1 sends
      explicitly
- [ ] Both `docs/research/` files and the FEAT-68 plan: correct the claim inline and add a pointer to the
      new dossier. In `2026-07-24-feat68-atc-variant-listing.md` mark the adt-ls-decompile conclusion
      **disproven on 758** and note that the resolution is client-side in adt-ls, not server-side in ABAP
- [ ] Delete the superseded draft `docs/plans/2026-08-19-atc-effective-check-variant.md`
- [ ] Grep the repo for `system default` near ATC content and confirm no internal doc still carries the
      wrong claim: `grep -rn "system default" AGENTS.md docs/ src/ | grep -i "variant\|atc"`
- [ ] Run `npm test` — no test should depend on the old wording

### Task 6: Correct the published docs and the skills

**Files:**
- Modify: `docs_page/tools.md` (the `atc` and `atc_variants` action bullets, ~line 1405)
- Modify: `docs_page/cli-guide.md` (~line 310, the `--variant` row)
- Modify: `src/cli.ts` (~line 628, the `--variant` option help string on `arc1-cli atc`)
- Modify: `docs_page/roadmap.md` (~lines 112, 723-724 — FEAT-68 wording)
- Modify: `skills/migrate-custom-code/SKILL.md` (~lines 17, 29, 36, 44, 262)
- Modify: `skills/sap-clean-core-atc/SKILL.md` (~lines 34, 88, 181)

The skills actively instruct agents to omit `variant` "to use the system default" and to expect an error
when a variant does not exist — both were wrong before this fix; after it, the first becomes true and the
second becomes true only because Task 2 adds the check. Documentation must describe as-shipped behavior.

- [ ] `docs_page/tools.md`: in the `atc` bullet, state that omitting `variant` binds the system's
      configured check variant (`systemCheckVariant`), that an unknown variant name is rejected rather
      than silently substituted, and that `resultFormat="structured"` reports `variant` + `variantSource`
      (`requested` | `systemDefault` | `sapFallback`). In the `atc_variants` bullet, keep "the system
      default" but make clear it is the variant `atc` binds, not a SAP-side fallback
- [ ] `docs_page/cli-guide.md` + `src/cli.ts`: `--variant` help becomes "ATC check variant; omit to use
      the system's configured default check variant". Keep both strings consistent
- [ ] `docs_page/roadmap.md`: adjust the FEAT-68 entries so they no longer imply SAP applies the system
      default on an empty `checkVariant`
- [ ] `skills/migrate-custom-code/SKILL.md`: lines 17/29/36/44 are correct **after** this fix — keep them
      but make the mechanism explicit ("ARC-1 resolves and sends the system's configured variant"). Line 262
      ("ATC variant not found → run default ATC, list available variants with `SAPDiagnose(action="atc")`")
      is wrong twice: the listing action is `atc_variants`, and an unknown variant now hard-fails instead
      of silently running `DEFAULT`. Fix both
- [ ] `skills/sap-clean-core-atc/SKILL.md`: same correction at lines 34/88/181 — an absent
      `ABAP_CLOUD_READINESS` now produces an explicit error, so the skill must list variants with
      `SAPDiagnose(action="atc_variants")` and pick a real one rather than assuming a silent fallback
- [ ] `docs/compare/00-feature-matrix.md`: verify the "ATC checks" row (~line 191) makes no claim about
      variant defaults; leave it unchanged if it does not
- [ ] Run `npm test` — all tests must pass

### Task 7: Add the annotated release-notes entry

**Files:**
- Modify: `docs_page/release-notes.md`

`tests/unit/server/release-notes.test.ts` asserts CHANGELOG ⊆ release notes, and CI fails while a released
version lacks an entry. This is a visible behavior change for anyone calling `action="atc"` without a
`variant`, so it needs a real entry, not a one-liner.

- [ ] Add an entry to `docs_page/release-notes.md` following the existing table format. It must state:
      bare `action="atc"` now runs the system's configured check variant instead of the CI variant
      `DEFAULT`, so **findings can differ from previous releases**; an unknown `variant` is now rejected
      instead of silently substituted; `resultFormat="structured"` gains `variantSource`
- [ ] Include the concrete measured example so the impact is legible: on a4h/758 the bare run gained the
      prio-1 *"Objects of type PROG are not allowed in ABAP Cloud Development"* finding and lost two
      `DEFAULT`-only *Critical Statements* hits
- [ ] Note the no-op case: on systems whose `systemCheckVariant` is already `DEFAULT` (e.g. NW 7.50)
      nothing changes
- [ ] Link `docs/research/2026-08-19-atc-default-check-variant.md`
- [ ] Run `npm test` — `tests/unit/server/release-notes.test.ts` must pass

### Task 8: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Run `npm run build` and `npm run check:sizes` — no size-budget regression in `src/adt/atc.ts`
- [ ] Confirm the frozen tool surface changed only where intended:
      `git diff tests/fixtures/tool-definitions/` shows nothing but SAPDiagnose description text
- [ ] Grep for residual wrong claims: `grep -rn "system default" AGENTS.md docs/ docs_page/ skills/ src/ | grep -i "variant\|atc"`
      — every remaining hit must describe the corrected behavior
- [ ] Live verification on a4h (S/4HANA 2023 / 758), creds per `INFRASTRUCTURE.md`:
      `npm run test:integration -- -t "runAtcCheck"` (requires `TEST_SAP_URL`). Both the
      system-default assertion and the unknown-variant rejection must pass against the real system
- [ ] Live cross-check through the CLI CI path: `arc1-cli atc PROG Z_CREATE_BOOKING_SAMPLES --format json`
      must report `variantSource: "systemDefault"` and `variant: "ZABAP_CLOUD_DEVELOPMENT"` on a4h, and
      the findings must include the prio-1 *"Objects of type PROG are not allowed in ABAP Cloud Development"*
      entry that the pre-fix bare run did not return. Do not commit throwaway smoke scripts
- [ ] Live verification on NW 7.50 (`npl`, oldest supported release): the same call must still succeed and
      report `variantSource: "systemDefault"` with `variant: "DEFAULT"` — proving the no-op property
- [ ] Move this plan to `docs/plans/completed/`, then fix any relative links inside it (completed plans sit
      one directory deeper — `../research/...` paths gain a level)
