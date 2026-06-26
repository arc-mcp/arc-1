# Joule Roadmap Feature 8 — AI Explain for Behavior Definitions (skill)

> **Status (2026-06-03): Skill IMPLEMENTED + live-verified.** `skills/explain-abap-code/SKILL.md` was extended with a BDEF branch (Step 1f + Step 2 SAPContext note + Step 5 explanation structure + follow-ups + error rows). Verified end-to-end against live A4H via `arc1-cli` on `/DMO/I_TRAVEL_M`: BDEF read → `implementation in class /DMO/BP_TRAVEL_M` parse → pool-class CCIMP read (showed `lhc_travel` with `FOR VALIDATE ON SAVE` handlers) → `SAPContext(action=impact)` on the bound root CDS `/DMO/I_Travel_M`.
> **Two plan corrections applied to the skill (the plan referenced non-existent surface):** (1) `SAPDiagnose` has **no** `rap_preflight` action — that reference was dropped. (2) `SAPContext` does **not** accept `BDEF` (only `CLAS|INTF|PROG|FUNC|DDLS`) — the skill runs `SAPContext(action=impact, name=<root_cds>)` on the bound DDLS root instead. **Remaining (optional/deferred):** Task 2 (E2E test file), Task 3 (doc updates).

## Overview

SAP's Joule for Developers 2026 roadmap announces "ABAP AI Explain for Behavior Definitions" — explanations of *"the business purpose, business logic, and dependencies associated with behavior definitions."* Planned release: SAP BTP ABAP environment 2611 / S/4HANA Cloud Public 2702 / S/4HANA Cloud Private 2027 (note the later 2611/2702 dates compared to most siblings).

This is the RAP-native equivalent of the function-group explain feature: instead of digesting flow logic + screen flow, the model summarises a BDEF's CRUD/action graph, determinations, validations, side effects, and authorisation scopes. Behavior definitions are an ABAP RAP construct (SAP_BASIS 7.53+).

ARC-1 already has every primitive this feature needs. BDEF source read is wired (`SAPRead type='BDEF'`); the bound CLAS (behavior pool) can be discovered either via the BDEF source's `implementation in class` clause or via `<class:rootEntityRef>` on class metadata (`parseClassMetadata` in `src/adt/xml-parser.ts`, consumed in `src/adt/rap-generate.ts:200`); the handler CLAS source supports include-aware reading (CCDEF/CCIMP/testclasses); `src/adt/rap-preflight.ts` provides structured "what is wired / what is broken" signal; `SAPRead(WHERE_USED)` plus the cds-impact classifier in `src/adt/cds-impact.ts` enumerate consumers.

**No ARC-1 code change needed.** This plan adds a BDEF-specific branch to the existing `explain-abap-code` skill (the same skill extended in `joule-fugr-explain.md` for FUGR). On systems where adt-ls is available (arc-1-lsp), `hover` on a BDEF returns rich markdown — the skill can mention this as a sibling capability but doesn't depend on it.

See [`docs/research/2026-06-03-joule-2026-roadmap-feature-assessment.md §8`](../research/2026-06-03-joule-2026-roadmap-feature-assessment.md) for the full feature assessment.

## Context

### Current State

- `SAPRead(type='BDEF')` reads behavior definition source
- The behavior pool CLAS binding is parseable from the BDEF source (`implementation in class ZBP_*`) or via `<class:rootEntityRef>` on class metadata
- `SAPRead(type='CLAS', include='implementations')` reads CCIMP where the handler class lives (per `src/adt/rap-handlers.ts` design notes)
- `SAPDiagnose(action='rap_preflight')` returns deterministic findings about wired-up state
- `SAPRead(action='WHERE_USED')` plus `src/adt/cds-impact.ts` give downstream consumers
- `skills/explain-abap-code/SKILL.md` exists but has no BDEF-specific branch
- arc-1-lsp's adt-ls provides `hover` on BDEF (DDLS-style inline parse) but arc-1 itself does not

### Target State

- The existing `explain-abap-code` skill handles BDEF natively:
  1. Read BDEF source via `SAPRead`
  2. Parse `implementation in class` to discover the bound behavior pool
  3. Read the pool's CCDEF + CCIMP via `SAPRead(type='CLAS', include='implementations')` and `include='definitions'`
  4. Optionally run `SAPDiagnose action='rap_preflight'` for structural signal
  5. Optionally run `SAPRead WHERE_USED` to find consumers
  6. LLM composes the explanation covering CRUD graph + determinations + validations + side effects + authz
- E2E test exercises the skill's tool sequence on a fixture BDEF
- Documentation updated

### Key Files

| File | Role |
|------|------|
| `skills/explain-abap-code/SKILL.md` | Extend with a BDEF-specific Step 1 / Step 2 |
| `tests/e2e/explain-bdef.e2e.test.ts` | New: E2E test for the BDEF read + handler discovery flow |
| `tests/e2e/fixtures.ts` | Reference: existing BDEF fixture (or add one) |
| `README.md`, `docs/index.md`, `docs/compare/00-feature-matrix.md`, `CLAUDE.md`, `docs/roadmap.md` (if exists) | Documentation |

### Design Principles

1. **No ARC-1 code change.** All primitives ready; this is purely a skill extension.
2. **Reuse the existing `explain-abap-code` skill.** Don't create a parallel `explain-bdef` skill; extend the canonical one. Keeps single source of truth.
3. **BDEF parse stays in the skill's prompt.** `implementation in class ZBP_*` extraction is a short regex on the BDEF source — no need to wire a TypeScript parser. The skill prompts the LLM to extract it.
4. **Cross-link to RAP preflight.** When the skill detects RAP-specific issues during explanation (e.g. handler class missing), it should suggest `SAPDiagnose action='rap_preflight'` to the user.
5. **arc-1-lsp benefits automatically.** When wired against arc-1-lsp's MCP, the skill's `SAPRead type='BDEF'` resolves through adt-ls and `hover` becomes available as a complement. The skill must not assume hover is present — it's a bonus when available.

## Development Approach

- Task 1: Extend the existing `explain-abap-code` skill with a BDEF branch
- Task 2: E2E test for the BDEF read + handler discovery flow
- Task 3: Documentation
- Task 4: Final verification

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:e2e`

### Task 1: Extend `explain-abap-code` for BDEF

**Files:**
- Modify: `skills/explain-abap-code/SKILL.md`

Add a BDEF-specific branch. The existing skill already covers CLAS/PROG/DDLS — add BDEF alongside, sharing Steps 2-4 (dependency context, ATC, documentation lookup) but with BDEF-specific Step 1.

- [ ] Add a "BDEF (behavior definition)" branch in Step 1 of the skill:
  - 1a. `SAPRead(type='BDEF', name='<name>')` — get the source
  - 1b. Parse the source for `implementation in class\s+(\S+)\.` to discover the behavior pool class name. Examples:
    - `managed implementation in class ZBP_R_TRAVEL unique` → pool = `ZBP_R_TRAVEL`
    - `unmanaged implementation in class ZBP_X` → pool = `ZBP_X`
  - 1c. `SAPRead(type='CLAS', name='<pool>')` — main class source
  - 1d. `SAPRead(type='CLAS', name='<pool>', include='implementations')` — CCIMP where handlers live; if it returns empty, also try `include='definitions'`
  - 1e. (Optional) `SAPDiagnose(action='rap_preflight', name='<bdef>')` — structural sanity (returns deterministic findings)
  - 1f. (Optional) `SAPRead(action='WHERE_USED', name='<bdef>')` — downstream consumers (services, projection views)
- [ ] Add a "Smart Defaults" row for BDEF: `expand_includes` not used (BDEF doesn't have it); always discover bound class via source parse; ATC = no; WHERE_USED = no unless asked
- [ ] Update the skill `description` frontmatter to advertise BDEF: *"...including behavior definitions (BDEF — CRUD graph + determinations/validations + bound handler class)..."*
- [ ] Add a "BDEF explanation prompt" section showing the LLM-side prompt structure: cover (1) business purpose (from BDEF header comments + bound CDS root); (2) CRUD graph (which operations are exposed, draft/non-draft); (3) determinations + validations (from CCIMP method signatures); (4) side effects + authorization scopes; (5) bound projection views (from WHERE_USED if available)
- [ ] Cross-link: *"For pure RAP handler scaffolding, see `generate-rap-logic`. For the underlying CDS view explanation, run this skill on the bound CDS root entity."*
- [ ] Verify: `cat skills/explain-abap-code/SKILL.md | grep -i BDEF | head -5` shows BDEF references

### Task 2: E2E test for the BDEF read + handler discovery sequence

**Files:**
- Create: `tests/e2e/explain-bdef.e2e.test.ts`
- Modify: `tests/e2e/fixtures.ts` (if no existing BDEF fixture)

The skill content itself is prompt-engineering; the tool sequence it invokes is testable.

- [ ] Check `tests/e2e/fixtures.ts` for an existing BDEF fixture (`PERSISTENT_OBJECTS`); if absent, add a minimal BDEF + bound CLAS + bound CDS view (a fully wired RAP triple) following the `rap-write.e2e.test.ts` fixture pattern
- [ ] Create `tests/e2e/explain-bdef.e2e.test.ts`:
  - Connect MCP client
  - Use `requireOrSkip(ctx, rapAvailable, 'RAP_NOT_AVAILABLE')` for skip gating
  - Test: `SAPRead(type='BDEF', name='<fixture>')` returns source containing `implementation in class` clause
  - Test: extract the class name via regex on the BDEF source (in test code — verify the parse approach the skill uses works); `SAPRead(type='CLAS', name='<parsed>')` returns CCDEF (or main class)
  - Test: `SAPRead(type='CLAS', name='<parsed>', include='implementations')` returns CCIMP source (or empty if no impl yet)
  - Test: `SAPDiagnose(action='rap_preflight', name='<bdef>')` returns a structured result (no exception)
- [ ] Tag cleanup catches with `// best-effort-cleanup` (no cleanup needed — all reads)
- [ ] Run `npm run test:e2e -- explain-bdef` — passes or skips with valid reason

### Task 3: Documentation

**Files:**
- Modify: `README.md`, `docs/index.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`
- Modify: `docs/roadmap.md` (if exists)
- Modify: `skills/explain-abap-code/SKILL.md` (cross-link the BDEF branch in the skill index)

- [ ] In `README.md` / `docs/index.md`, update the `explain-abap-code` skill blurb to mention BDEF
- [ ] In `docs/compare/00-feature-matrix.md`, add or update a row "BDEF deep read + handler discovery" — ARC-1 ✅; SAP Joule "AI Explain for Behavior Definitions" GA window noted (BTP 2611 / S/4 Cloud Public 2702 / Private 2027)
- [ ] In `CLAUDE.md`, no new "Key Files" row needed (no code change), but if there's a "Skills inventory" section, ensure `explain-abap-code` is listed as covering BDEF
- [ ] Update the feature matrix "Last Updated" header
- [ ] If `docs/roadmap.md` exists, mark "AI Explain for BDEF parity" completed
- [ ] Run `npm run lint` — passes

### Task 4: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Run E2E: `npm run test:e2e -- explain-bdef` — passes or skips with valid reason
- [ ] Manually invoke `/explain-abap-code` on a real BDEF via Claude Code — verify the explanation covers the CRUD graph, the bound handler class methods, and any downstream consumers
- [ ] Move this plan to `docs/plans/completed/`
