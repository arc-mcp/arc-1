# Plan — FEAT-68: ATC check-variant listing

> Evidence: [docs/research/2026-07-24-feat68-atc-variant-listing.md](../research/2026-07-24-feat68-atc-variant-listing.md)
> (live-verified 758 + 816). Branch: `feat/atc-variant-listing` from `origin/main`.

## What ships

`SAPDiagnose action=atc_variants` → text result listing the system default check variant + the
available variants (name + description). Closes the "LLM must guess the `variant` string" gap for
`SAPDiagnose action=atc`. Read-only. Mirrors adt-ls's own `list_atc_variants` tool.

Input: reuses the existing `variant` param as the name filter (default `*` = all). Output: JSON via
`toolJson`:
```json
{ "systemDefault": "ZABAP_CLOUD_DEVELOPMENT", "filter": "*", "count": 215,
  "variants": [ { "name": "ABAP_CLOUD_DEVELOPMENT_3TIER", "description": "Variant 4 Cloud Development with 3 Tier Extensibility Model" }, … ] }
```
The list is fetched with `Accept: application/vnd.sap.adt.nameditems.v1+xml`.

## Verified contract (from dossier)

- List: `GET /sap/bc/adt/atc/variants?name=<pattern>` Accept `application/xml` → `<nameditem:namedItemList>` of `<nameditem:namedItem>{name,description}`. Filter honored (`*`→215, `ZABAP*`→1). Bare (no `name`) → empty.
- Default: `GET /sap/bc/adt/atc/customizing` Accept `application/xml` → `<atc:customizing>…<property name="systemCheckVariant" value="…"/>`.
- Both on 758 + 816.

## Design decisions

1. **New `SAPDiagnose` action `atc_variants`, NOT a new tool/type.** ATC is a diagnose concern; the
   action sits next to `atc`.
2. **Reuse the existing `variant` param as the name filter** (default `*`). No new schema property —
   minimises surface. (`variant` already exists on SAPDiagnoseSchema for `action=atc`.)
3. **Relocate `parseNamedItems` from `transport.ts` to `xml-parser.ts`** and import in both. It
   already parses `nameditem:namedItemList → {name,description,data}` exactly. Avoids a
   devtools→transport dependency and duplicate parsing. Pure move + re-import; transport behavior
   unchanged (guard with its existing tests).
4. **Combine default + list in one action** (two GETs). The default alone is the higher-value half
   (the LLM otherwise can't see it), so fetch customizing first; if it 404s, still return the list.

## Tasks

1. `src/adt/xml-parser.ts` — move `parseNamedItems` + `NamedItem` here (from transport.ts); export both.
   Add `parseAtcCustomizing(xml): { systemCheckVariant?: string }` (reads the `<atc:customizing>` property).
2. `src/adt/transport.ts` — import `parseNamedItems`/`NamedItem` from xml-parser instead of defining them.
3. `src/adt/devtools.ts` — `listAtcVariants(http, filter='*'): Promise<NamedItem[]>` (GET `/atc/variants?name=<enc>`,
   Accept `application/xml`) + `getAtcSystemDefaultVariant(http): Promise<string | undefined>` (GET `/atc/customizing`).
   Both `checkOperation(safety, Read, …)` guarded.
4. `src/handlers/diagnose.ts` — `case 'atc_variants'`: fetch default + list(filter=args.variant ?? '*'),
   format the text result.
5. `src/handlers/schemas.ts` — add `'atc_variants'` to the SAPDiagnose action enum (nothing else — `variant` exists).
6. `src/handlers/tools.ts` — add `atc_variants` to the JSON action enum + a terse description clause;
   **trim ~100 B of verbose SAPDiagnose prose to stay under `WRITE_WIRE_WALL`/`standard-full-git` 68,000**
   (candidates: the `authorization_trace` clause has a missing-period typo + redundant words; `odata_perf`
   "from the Network tab"/"+ a verdict"; measure with `check:sizes`, trim only as much as needed).
7. `src/authz/policy.ts` — `'SAPDiagnose.atc_variants': { scope: 'read', opType: OperationType.Read }`.
8. Tests:
   - `tests/unit/adt/xml-parser*.test.ts` — `parseAtcCustomizing` (+ parseNamedItems still covered).
   - `tests/unit/adt/devtools*.test.ts` — `listAtcVariants` sends `?name=` + parses; `getAtcSystemDefaultVariant`.
   - `tests/unit/handlers/diagnose*.test.ts` — `action=atc_variants` end-to-end (mock both GETs) + policy `read` scope.
   - Fixtures: use the saved 816 bodies (`variants` + `customizing`).
9. `tests/fixtures/tool-definitions/*.json` — regenerate (new action enum value). Diff-review: only the enum + SAPDiagnose desc change.
10. Docs: `docs_page/tools.md` (SAPDiagnose action table), `docs/dev-guide.md` (ATC row), `docs_page/roadmap.md` (mark FEAT-68 done).

## Live test plan (Phase 6)

Built CLI on **both** releases:
- `SAPDiagnose action=atc_variants` → default `ZABAP_CLOUD_DEVELOPMENT` + non-empty list (215 on 816, 184 on 758).
- `SAPDiagnose action=atc_variants variant="ABAP_CLOUD*"` → filtered subset (content check — not just non-error).
- Negative: `variant="ZZZ_NO_SUCH*"` → empty list, clean (no crash).
No writes → no SAPActivate needed.

## Risk

Low. Read-only, no mutation, reuses a proven parser and the existing `variant` param. Only real risks:
(a) the fixture/tool-definition diff must be SDO-clause-free (review it); (b) the trim must not degrade
meaning — tighten only genuinely redundant words.

## Out of scope
- Worklist lifecycle refactor (mint-worklist `?checkVariant=` → run) — the existing `runAtcCheck`
  hardcodes `worklistId=1` and works; not this PR.
- Creating/editing CHKV variant objects (Basis governance, not LLM work).
