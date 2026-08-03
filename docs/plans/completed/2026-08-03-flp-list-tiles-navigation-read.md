# Plan: read FLP tiles through the `Pages` association (stop short-dumping the backend)

## Evidence

Use the verified findings in `docs/research/2026-08-03-flp-tile-listing-assertion-failed.md`.

Load-bearing facts from that dossier, all live-verified:

- `PageChipInstances` is a navigation-only child of `Pages`. `/UI2/CL_EDM_DA_V06_USAGE~get_entityset`
  derives the page **only** from `previous_entity_keytab`, and passes any `$filter` select-options to
  `_get_filter_from_gw_selopt`, whose `when others.` arm is `assert 1 = 2.` (source read live from `a4h`).
- Therefore **no** `$filter` is safe on `PageChipInstances`: `pageId` dumps from the top-level entity
  set, and `chipId` dumps even under the association. Both reproduced live.
- `Pages('<encoded pageId>')/PageChipInstances` returns the complete set, row counts matching the
  catalog's own `chipCount`, on NW 7.50, 758 and 816 — with zero ST22 entries.
- `$select` and `$top` are genuinely honored (verified by response content, not status), so the
  existing `$top=500` is a real cap that can truncate.
- A missing catalog returns OData 404 `Resource Page not found` (no dump).
- SAP's own `PageBuildingService.js` reads the same way, including `encodeURIComponent` on the key.

## Implementation

1. `src/adt/flp.ts` — rewrite `listTiles` to `GET`
   `${FLP_SERVICE_PATH}/Pages('${encodeURIComponent(pageId)}')/PageChipInstances?$format=json&$top=500&$select=pageId,instanceId,chipId,title,configuration`,
   where `pageId` is `X-SAP-UI2-CATALOGPAGE:` + `normalizeCatalogId(catalogId)`. No `$filter`.
   Carry a short comment naming the assert so the filter is never reintroduced.
2. `src/adt/flp.ts` — delete `isAssertionFailedError` and the `backendError` catch. Both existed only to
   absorb a dump ARC-1 was itself causing; the message they produced ("known SAP issue with certain
   catalogs… do NOT attempt alternative queries") is false on every clause and actively misleading.
   Return `FlpTileInstance[]` and let real failures propagate as typed `AdtApiError`s.
3. `src/adt/types.ts` — remove `FlpTileResult`; it only ever wrapped `tiles` + `backendError`.
4. `src/handlers/manage.ts` — `flp_list_tiles` consumes the array directly; drop the `backendError` branch.
5. `src/handlers/manage.ts` — do not report a truncated count as complete: when exactly `$top` rows come
   back, say the listing may be truncated. One line; no new option, no pagination.
6. `docs_page/roadmap.md` — the FLP bullet advertises "Graceful ASSERTION_FAILED handling for problematic
   catalogs" as a feature. Replace with the access rule that actually holds.
7. `tests/integration/adt.integration.test.ts` — the FLP tile test wraps the call in a `try/catch` that
   treats a 500 as "a backend bug, not an ARC-1 bug" and skips. That diagnosis is what this change
   disproves. Drop the escape hatch and assert the returned row count equals the catalog's own
   `chipCount`, so a reintroduced `$filter` fails the suite instead of silently skipping it.
8. **Added during Phase 6 live verification:** a missing catalog now reaches `dispatch.ts`'s generic 404
   hint, which tells the LLM to `SAPSearch with query ""` — `SAPManage` has no name/type args to fill it.
   Catch the 404 in `flp_list_tiles` and name the catalog, pointing at `flp_list_catalogs`. Kept local to
   this action rather than touching dispatch's shared hinting.

Deliberately out of scope: `createTile` / `addTileToGroup` / `deleteCatalog` (POST/DELETE by key, no
`$filter`, no dump risk), `listCatalogs` / `listGroups` (different accessors; `listGroups`' `$filter` on
`Pages` is live-verified working), and the richer `$expand` shape SAP uses for chip bags — `flp_list_tiles`
reports instance metadata only.

## Tests

1. Replace the "handles ASSERTION_FAILED gracefully" unit test — it asserted the misleading message as
   contract — with a test pinning the request shape: the URL contains
   `/Pages('X-SAP-UI2-CATALOGPAGE%3AMY_CATALOG')/PageChipInstances?` and contains **no** `$filter`.
2. Add a unit test for a slash-bearing catalog ID (`/UI2/FLP_ADMIN` → `%2FUI2%2FFLP_ADMIN`) — the
   encoding of the key is the part most likely to regress.
3. Update the existing normalization test, which asserted the raw `'X-SAP-UI2-CATALOGPAGE:MY_CATALOG'`
   that only appeared in the old `$filter` literal, to the encoded association form.
4. Update the two `listTiles` parsing tests to the array return.
5. Focused run: `npx vitest run tests/unit/adt/flp.test.ts tests/unit/handlers`
6. Broader gates: `npm run typecheck`, `npm run lint`, `npm test`.
7. Live verification (no integration-test fixture exists for FLP; do it by hand and record it in the
   dossier): on `a4h`, drive the built CLI — `arc1-cli call SAPManage --arg action=flp_list_tiles --arg
   catalogId=…` for a normal catalog, a slash-bearing catalog, and a non-existent one; snapshot
   `/sap/bc/adt/runtime/dumps` before and after and require **no** new ST22 entry. Repeat the read on
   `npl` (7.50) and `a4h-2025` (816) since the area is release-sensitive.

## Plan Review

- **Root cause, not symptom.** The dump is caused by ARC-1's own request shape; the catch block is
  removed rather than reworded, so there is no path left that can produce it.
- **The rule in the code is the rule the evidence supports.** "No `$filter` on `PageChipInstances`" is
  stronger than "filter under the association" — verified by the `chipId` reproduction, not assumed.
- **Release coverage.** Behavior is identical on 7.50 / 758 / 816, so no discovery gate or release
  branch is warranted; a gate here would add a probe for a difference that does not exist.
- **No schema surface change.** `flp_list_tiles` keeps its action name and its single `catalogId`
  parameter, so the three-file sync (`tools.ts` / `schemas.ts` / handler) and the tool-definition
  fixtures are untouched. Only the tool's text output changes.
- **Error behavior change is deliberate and an improvement.** A missing catalog previously produced a
  fabricated "backend crashed" narrative with 0 tiles; it now surfaces the backend's own
  `Resource Page not found` through the normal typed-error path. `AdtApiError` is what `dispatch.ts`
  already formats for LLM clients.
- **Removing `FlpTileResult` is safe.** Its only two consumers are `listTiles` and the one `manage.ts`
  branch; the type is not exported from the package entry point or referenced by fixtures.
- **The truncation line is the smallest honest fix.** `$top` is provably enforced, so a 500-row result
  is ambiguous; nothing observed comes near 500, which is why this is one line and not pagination.
