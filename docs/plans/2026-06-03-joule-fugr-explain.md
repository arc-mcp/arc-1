# Joule Roadmap Feature 7 — AI Explain for Function Groups

> **Status (2026-06-03): SELECTED AS THE NEXT FEATURE TO BUILD.** Fully live-verifiable on A4H (classic function groups with FUNC sub-modules, dynpros, and GUI status exist), and it's ARC-1's classic-type moat — SAP's `adt-ls` does not serve these types. Implementation tracked in its own branch/PR.

## Overview

SAP's Joule for Developers 2026 roadmap announces "ABAP AI Explain for Function Groups" — explanations of *"the flow logic, business purpose, and screen flow of function groups."* Planned release: SAP BTP ABAP environment 2608 / S/4HANA Cloud Public 2608 / S/4HANA Cloud Private 2027.

The high-value bit is "screen flow" — most legacy logic lives in function modules + SAPGUI dynpros, and explaining a function group requires walking the include tree: top FUGR include → all FUNC sub-modules → all dynpros (SCRP) → flow logic (PBO/PAI modules) → GUI status (CUA menu + function codes).

FUGR/FUNC are **classic** ABAP object types — `adt-ls` returns a `.jsonc` placeholder for them. This feature is **permanently ARC-1's domain**. ARC-1 already exposes FUGR/FUNC source reads but lacks:
1. **FUNC sub-module walk** when `expand_includes=true` (current implementation at `src/handlers/intent.ts:1505-1526` follows only explicit `INCLUDE` statements via regex + `client.getInclude()` — it does NOT enumerate the function group's FUNC children under `/sap/bc/adt/functions/groups/<name>/fmodules/`)
2. **Dynpro (SCRP) read**
3. **GUI status (CUA) read**

This plan delivers three small reader additions + a skill extension to `explain-abap-code` so the LLM has all four artifact classes in context when explaining a FUGR.

See [`docs/research/2026-06-03-joule-2026-roadmap-feature-assessment.md §7`](../research/2026-06-03-joule-2026-roadmap-feature-assessment.md) for the full feature assessment.

## Context

### Current State

- `SAPRead(type='FUGR')` exists; `getFunctionGroup(name)` at `src/adt/client.ts:345` returns `{ name, functions: string[] }`
- `getFunctionGroupSource(name, opts)` at `src/adt/client.ts:352` returns the top include source
- `getInclude(name, opts)` at `src/adt/client.ts:358` reads any INCL by name
- `expand_includes` is wired for FUGR in `handleSAPRead` at `src/handlers/intent.ts:1505-1526`:
  - regex-matches `^[^*\n]*\bINCLUDE\s+(\S+)\s*\.` lines
  - calls `getInclude()` per match
  - concatenates source with `=== <name> ===` separators
- This catches explicit `INCLUDE` statements but **NOT** FUNC sub-modules (which are not present as INCLUDE statements in the FUGR top include — they live under `/sap/bc/adt/functions/groups/<name>/fmodules/<func>/`)
- No SAPRead support for dynpros: there's no `case 'DYNPRO'` or `case 'SCRP'`
- No SAPRead support for GUI status / CUA
- `getFunction()` exists for reading individual FUNC modules (the `SLASH_TYPE_MAP` has FUNC → `/sap/bc/adt/functions/groups/<group>/fmodules/<name>`)
- `expand_includes` schema property declared at `src/handlers/schemas.ts:7141`
- `expand_includes` description at `src/handlers/tools.ts:519` says: *"For FUGR type only. When true, expands all INCLUDE statements and returns the full source of each include inline."*

### Target State

- `SAPRead(type='FUGR', expand_includes=true)` returns:
  - Top FUGR include source
  - All `INCLUDE <name>.` source (current behavior preserved)
  - All FUNC sub-modules' source (new)
  - All dynpros' source + flow logic (new)
  - All GUI status definitions (new)
- New SAPRead types `DYNPRO` (with composite name `<prog>:<dynnr>`) and `CUA` (with composite name `<prog>:<status>`) for standalone reads of dynpros/statuses outside the FUGR context
- `getFunctionGroupExpanded(name, opts)` in `src/adt/client.ts` orchestrates the multi-artifact read with cached + revalidation-friendly fetches
- Unit tests cover happy + per-artifact failure modes; integration test covers a fixture FUGR on a4h
- `explain-abap-code` skill extended to invoke `expand_includes=true` for FUGR
- Documentation updated

### Key Files

| File | Role |
|------|------|
| `src/adt/client.ts` | Add `getFunctionGroupExpanded()` near line 345; add `getDynpro()`, `getCuaStatus()` |
| `src/adt/xml-parser.ts` | Add `parseDynpro()`, `parseCuaStatus()` |
| `src/adt/types.ts` | New types: `FunctionGroupExpanded`, `DynproInfo`, `CuaStatusInfo` |
| `src/handlers/intent.ts` | Rewrite the FUGR `expand_includes=true` branch (line 1505-1526); add DYNPRO and CUA cases |
| `src/handlers/schemas.ts` | Add DYNPRO and CUA to SAPRead type enum |
| `src/handlers/tools.ts` | Update FUGR `expand_includes` description (line 519); add DYNPRO and CUA descriptions |
| `docs/research/abap-types/types/dynpro.md` | New evidence file (citation guard for new slash types) |
| `docs/research/abap-types/types/cua.md` | Same |
| `tests/unit/adt/client.test.ts` | Tests for the new client methods |
| `tests/unit/adt/xml-parser.test.ts` | Tests for the new parsers |
| `tests/unit/handlers/intent.test.ts` | Tests for the FUGR expand_includes + DYNPRO + CUA handlers |
| `tests/fixtures/xml/dynpro.xml`, `cua-status.xml`, `function-group-fmodules.xml` | New fixtures |
| `tests/integration/adt.integration.test.ts` | Integration test against a4h |
| `skills/explain-abap-code/SKILL.md` | Add FUGR explanation branch |
| `docs/tools.md`, `CLAUDE.md`, `README.md`, `docs/compare/00-feature-matrix.md` | Documentation |

### Design Principles

1. **Extend, don't fork.** The existing INCLUDE-statement regex loop at `intent.ts:1505` must keep working. Just add FUNC sub-modules + dynpros + CUA to the same bundle.
2. **Standalone DYNPRO/CUA reads are bonus.** The primary use case is FUGR expand_includes. Exposing DYNPRO/CUA standalone via slash types is a small additional surface for power users.
3. **Citation guard.** Adding new SAPRead slash types requires evidence files under `docs/research/abap-types/types/*.md` per the CLAUDE.md "Add new ADT slash alias" row. Each new type needs a verified Eclipse apidoc + `<adtcore:type>` capture.
4. **Cache + ETag-friendly.** Reuse the existing `cachedGet()` pattern in `intent.ts` so each individual sub-artifact participates in source caching independently.
5. **Per-artifact failure tolerance.** If a single dynpro or CUA status fails to read (deleted, locked, etc.), the bundled response includes a placeholder `[Could not read X: <reason>]` — never aborts the whole FUGR read.
6. **Cache key disambiguation.** When multiple artifacts share a key (e.g. dynpro 0100 vs dynpro 0200 of the same program), the cache key must include the disambiguator (programName + dynproNumber).

## Development Approach

- Task 1: Types + `getFunctionGroupExpanded()` (FUNC sub-module walk)
- Task 2: `getDynpro()` + parser + fixture
- Task 3: `getCuaStatus()` + parser + fixture
- Task 4: Rewrite FUGR `expand_includes=true` handler branch
- Task 5: Add DYNPRO and CUA standalone SAPRead types
- Task 6: Integration test
- Task 7: Skill extension
- Task 8: Documentation
- Task 9: Final verification

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:integration` (requires TEST_SAP_URL)

### Task 1: Add `getFunctionGroupExpanded()` for FUNC sub-module walk

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `src/adt/types.ts`
- Modify: `tests/unit/adt/client.test.ts`
- Create: `tests/fixtures/xml/function-group-fmodules.xml`

The FUGR object metadata at `/sap/bc/adt/functions/groups/<name>` returns a list of child FUNC modules via discovery. This task extends `getFunctionGroup()` to enumerate them and read each source.

- [ ] In `src/adt/types.ts`, add:
  - `interface FuncSubmodule { name: string; source: string }`
  - `interface DynproEntry { number: string; source: string; flowLogic: string }`
  - `interface CuaStatusEntry { name: string; menu: string; functionCodes: string[] }`
  - `interface FunctionGroupExpanded { groupSource: string; explicitIncludes: { name: string; source: string }[]; functions: FuncSubmodule[]; dynpros: DynproEntry[]; statuses: CuaStatusEntry[] }`
- [ ] In `src/adt/client.ts`, add `async getFunctionGroupExpanded(name: string, opts?: SourceReadOptions): Promise<FunctionGroupExpanded>` near line 360. Body:
  - Read top source via `this.getFunctionGroupSource(name, opts)`
  - Regex-match explicit `INCLUDE` statements (mirror the existing `intent.ts:1505` pattern) and read each via `this.getInclude(inclName, opts)`
  - Enumerate FUNC children via `this.getFunctionGroup(name)` (which currently returns `{ functions: string[] }`), then read each via `this.getFunction(group, funcName)` — keep the existing pattern; do not invent a new endpoint
  - Best-effort dynpro list: GET `/sap/bc/adt/programs/programs/SAPL<name>/dynpros/` (catalog) and enumerate; for each dynpro, call `this.getDynpro()` (added in Task 2). Catalog endpoint TBD against a4h — verify on first integration run.
  - Best-effort CUA list: GET `/sap/bc/adt/programs/programs/SAPL<name>/cuastatus/` (catalog); for each, call `this.getCuaStatus()` (added in Task 3)
  - Per-artifact failures resolve to a placeholder entry with `source: '[Could not read: ...]'`, not a thrown error
- [ ] Add a fixture: `tests/fixtures/xml/function-group-fmodules.xml` capturing a real FUGR's FUNC children list
- [ ] Add unit tests to `tests/unit/adt/client.test.ts` (~6 tests): happy path with all artifacts, empty FUNC list, dynpro catalog 404 yields empty list, CUA catalog 404 yields empty list, per-FUNC read failure yields placeholder, INCLUDE statement plus FUNC sub-module both expanded
- [ ] Run `npm test -- client` — all tests pass

### Task 2: Add `getDynpro()` and parser

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `src/adt/xml-parser.ts`
- Create: `tests/fixtures/xml/dynpro.xml`
- Create: `docs/research/abap-types/types/dynpro.md`
- Modify: `tests/unit/adt/client.test.ts`, `tests/unit/adt/xml-parser.test.ts`

Adds the per-dynpro read primitive used by the FUGR expand_includes bundle and standalone reads.

- [ ] In `src/adt/client.ts`, add `async getDynpro(programName: string, dynproNumber: string, opts?: SourceReadOptions): Promise<DynproEntry>` near the existing getInclude. Endpoint: `/sap/bc/adt/programs/programs/<prog>/dynpros/<dynnr>` (verify against `abap-adt-api` if uncertain; capture the exact response on first call). Returns the parsed `DynproEntry`.
- [ ] In `src/adt/xml-parser.ts`, add `parseDynpro(xml: string): DynproEntry`. Expected XML shape (verify on first live call):
  ```xml
  <dynpro:dynpro xmlns:dynpro="...">
    <dynpro:source>...</dynpro:source>
    <dynpro:flowLogic>...</dynpro:flowLogic>
    <dynpro:elements>...</dynpro:elements>
  </dynpro:dynpro>
  ```
- [ ] Create `tests/fixtures/xml/dynpro.xml` with a minimal real dynpro response
- [ ] Create `docs/research/abap-types/types/dynpro.md` with evidence per CLAUDE.md "Add new ADT slash alias" guard: cite Eclipse apidoc URL, capture a real `<adtcore:type>` value from a4h
- [ ] Add unit tests (~3 each): client (happy + 404 + parse error), parser (happy + missing flowLogic + malformed)
- [ ] Run `npm test -- (client|xml-parser)` — all pass

### Task 3: Add `getCuaStatus()` and parser

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `src/adt/xml-parser.ts`
- Create: `tests/fixtures/xml/cua-status.xml`
- Create: `docs/research/abap-types/types/cua.md`
- Modify: `tests/unit/adt/client.test.ts`, `tests/unit/adt/xml-parser.test.ts`

Mirror Task 2 for CUA status.

- [ ] In `src/adt/client.ts`, add `async getCuaStatus(programName: string, statusName: string, opts?: SourceReadOptions): Promise<CuaStatusEntry>`. Endpoint: `/sap/bc/adt/programs/programs/<prog>/cuastatus/<status>`.
- [ ] In `src/adt/xml-parser.ts`, add `parseCuaStatus(xml: string): CuaStatusEntry`. Extract `name`, `menu`, `functionCodes`.
- [ ] Create `tests/fixtures/xml/cua-status.xml`
- [ ] Create `docs/research/abap-types/types/cua.md` evidence file
- [ ] Add unit tests (~3 each): same shape as Task 2
- [ ] Run `npm test` — all pass

### Task 4: Rewrite FUGR `expand_includes=true` handler

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Replace the INCLUDE-statement regex loop at `intent.ts:1505-1526` with a call to `getFunctionGroupExpanded()`. Preserve the existing output format (`=== <name> ===\n<source>` markdown blocks) so existing skill prompts keep working.

- [ ] In `src/handlers/intent.ts` at line 1505, find `case 'FUGR':` and rewrite the `expand_includes=true` branch:
  ```ts
  case 'FUGR': {
    const expand = Boolean(args.expand_includes);
    if (expand) {
      const bundle = await client.getFunctionGroupExpanded(name, { version: effectiveVersion });
      const parts: string[] = [`=== FUGR ${name} (main) ===\n${bundle.groupSource}`];
      for (const incl of bundle.explicitIncludes) parts.push(`\n=== ${incl.name} ===\n${incl.source}`);
      for (const fn of bundle.functions) parts.push(`\n=== FUNC ${fn.name} ===\n${fn.source}`);
      for (const dyn of bundle.dynpros) parts.push(`\n=== DYNPRO ${dyn.number} ===\n${dyn.source}\n\n--- Flow logic ---\n${dyn.flowLogic}`);
      for (const cua of bundle.statuses) parts.push(`\n=== CUA ${cua.name} ===\n${cua.menu}`);
      return textResult(parts.join('\n'));
    }
    const fg = await client.getFunctionGroup(name);
    return textResult(JSON.stringify(fg, null, 2));
  }
  ```
- [ ] Update `src/handlers/tools.ts` line 519 description from *"expands all INCLUDE statements"* to *"For FUGR type only. When true, expands the function group's full artifact tree: explicit INCLUDE statements, FUNC sub-modules, dynpros (SCRP), and GUI status (CUA). Each artifact prefixed with === name === markers."*
- [ ] Add unit tests to `tests/unit/handlers/intent.test.ts` (~4 tests): expand_includes=true returns bundled markdown with all 4 artifact types; expand_includes=false returns the lightweight JSON (existing behavior preserved); per-artifact failure yields a placeholder; expand_includes=false on a FUGR with no INCLUDE still returns the group source
- [ ] Run `npm test` — all tests pass

### Task 5: Add DYNPRO and CUA standalone SAPRead types

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/intent.test.ts`

Expose `getDynpro()` and `getCuaStatus()` via SAPRead for power users. Use composite name `<programName>:<dynproNumber>` and `<programName>:<status>` per the existing CLAUDE.md pattern for composite names.

- [ ] In `src/handlers/intent.ts` `handleSAPRead`, add `case 'DYNPRO': { const [prog, dynnr] = name.split(':'); if (!prog || !dynnr) throw ...; const dyn = await client.getDynpro(prog, dynnr, { version: effectiveVersion }); return textResult(JSON.stringify(dyn, null, 2)); }` and similar for `case 'CUA':`
- [ ] In `src/handlers/schemas.ts`, add `'DYNPRO'` and `'CUA'` to the SAPRead `type` enum + validation that the name follows the `prog:dynnr` (or `prog:status`) composite pattern
- [ ] In `src/handlers/tools.ts`, add DYNPRO and CUA to the SAPRead type enum with descriptions explaining the composite name format
- [ ] In `src/handlers/intent.ts`, add the new types to `SLASH_TYPE_MAP` (and `SLASH_TYPE_EVIDENCE` + `KNOWN_BASE_TYPES`) per CLAUDE.md "Add new ADT slash alias" row
- [ ] Add unit tests (~4): happy path each, malformed composite name rejected, 404 surfaces cleanly
- [ ] Verify the citation guard test in `tests/unit/handlers/slash-type-map.test.ts` passes (it checks each new short type has an evidence file under `docs/research/abap-types/types/`)
- [ ] Run `npm test` — all tests pass

### Task 6: Integration test

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

Live test against a4h. Pick a real function group with at least one dynpro + GUI status (e.g. `BAPI_USER_CREATE`'s SAP-shipped FUGR — verify which FUGR has all four artifact classes on a4h before locking in the choice).

- [ ] Add `describe('SAPRead FUGR expand_includes deep bundle')`:
  - Pick a FUGR with FUNC + dynpro + CUA artifacts (use `SAPSearch` to discover candidates; document the choice)
  - Call `SAPRead(type='FUGR', name=<choice>, expand_includes=true)`
  - Assert the response contains `=== FUGR `, `=== FUNC `, `=== DYNPRO `, `=== CUA ` headers
  - Assert the total response length > 200 chars (sanity)
- [ ] Add tests for standalone DYNPRO and CUA reads if a test program with dynpros + statuses is available
- [ ] Skip via `requireOrSkip(ctx, fugrPresent, 'TEST_FUGR_NOT_AVAILABLE')` if the chosen FUGR isn't on the test system
- [ ] On first integration run, capture the actual response XML shapes — if they differ from the placeholders in Tasks 2 and 3, update the parsers and re-run
- [ ] Tag cleanup catches with `// best-effort-cleanup` (no cleanup needed — all reads)
- [ ] Run `TEST_SAP_URL=... npm run test:integration -- FUGR` — passes

### Task 7: Extend `explain-abap-code` skill for FUGR

**Files:**
- Modify: `skills/explain-abap-code/SKILL.md`

Add a FUGR-specific branch to the existing skill so it pulls the expanded artifact bundle and structures the LLM prompt accordingly.

- [ ] In the existing `skills/explain-abap-code/SKILL.md`, add a FUGR-specific Step 1 variant:
  - For type FUGR: `SAPRead(type='FUGR', name=<name>, expand_includes=true)` — bundle includes group source, FUNCs, dynpros, GUI statuses
  - Prompt structure: "Explain this function group covering (1) overall business purpose; (2) per-FUNC responsibility; (3) screen flow (dynpros + flow logic); (4) GUI status / function-code dispatch."
- [ ] Add a "Smart Defaults" row for FUGR: `expand_includes=true`
- [ ] Update the skill's `description` frontmatter to mention FUGR explicitly: *"...including function groups (FUGR — bundles FUNC + dynpros + GUI status)..."*
- [ ] Note: the skill is prompt-engineering; tests for the underlying tool path are in Task 6

### Task 8: Documentation

**Files:**
- Modify: `docs/tools.md`
- Modify: `CLAUDE.md`
- Modify: `README.md`, `docs/index.md`
- Modify: `docs/compare/00-feature-matrix.md`

- [ ] In `docs/tools.md`, update the SAPRead FUGR section to describe the expand_includes bundle (4 artifact classes); document DYNPRO and CUA types
- [ ] In `CLAUDE.md`, add to "Key Files for Common Tasks":
  - `| Extend FUGR expand_includes to enumerate FUNC sub-modules + dynpros + GUI status | src/adt/client.ts (getFunctionGroupExpanded, getDynpro, getCuaStatus), src/adt/xml-parser.ts (parseDynpro, parseCuaStatus), src/handlers/intent.ts (case 'FUGR' expand branch line 1505), src/handlers/schemas.ts, src/handlers/tools.ts (description line 519), docs/research/abap-types/types/{dynpro,cua}.md, tests/unit/adt/* |`
  - `| Add Dynpro (SCRP) SAPRead | src/adt/client.ts (getDynpro), src/adt/xml-parser.ts (parseDynpro), src/handlers/intent.ts (case 'DYNPRO'), src/handlers/{schemas,tools}.ts, docs/research/abap-types/types/dynpro.md |`
  - `| Add CUA / GUI status SAPRead | src/adt/client.ts (getCuaStatus), src/adt/xml-parser.ts (parseCuaStatus), src/handlers/intent.ts (case 'CUA'), src/handlers/{schemas,tools}.ts, docs/research/abap-types/types/cua.md |`
- [ ] Update README/docs/index to mention "AI Explain for Function Groups parity" capability
- [ ] In `docs/compare/00-feature-matrix.md`, update or add a row for "Function Group deep read (FUNC + dynpros + CUA)" — ARC-1 ✅, most competitors ❌ (adt-ls doesn't serve classic types)
- [ ] Update the "Last Updated" header
- [ ] If `docs/roadmap.md` exists, mark this feature completed
- [ ] Run `npm run lint` — passes

### Task 9: Final verification

- [ ] Run full test suite: `npm test` — all tests pass
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Run integration: `npm run test:integration -- FUGR` — passes or skips
- [ ] Verify citation guard: every new short type (`DYNPRO`, `CUA`) has an evidence file under `docs/research/abap-types/types/` and the `tests/unit/handlers/slash-type-map.test.ts` guard passes
- [ ] Manually invoke `/explain-abap-code` on a real FUGR via Claude Code — verify the explanation covers all four artifact classes
- [ ] Move this plan to `docs/plans/completed/`
