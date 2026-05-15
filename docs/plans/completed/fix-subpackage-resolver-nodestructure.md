# Fix Subpackage Resolver — Use repository/nodestructure (Security Fix)

## Overview

The `allowedPackages` subtree-rule feature (`ZFOO/**`) shipped on branch
`claude/review-package-allowlist-0HDAx` uses
`GET /sap/bc/adt/repository/informationsystem/search?packageName=X&objectType=DEVC/K`
to enumerate the direct children of a package. **Live probing against
S/4HANA 2023 (a4h.marianzeis.de) proved this combination silently ignores
the `packageName` filter and returns up to 1000 unrelated DEVC packages
from across the system.** The two responses (with and without
`packageName=`) are byte-identical (MD5 match) on the test system.

The resolver's BFS treats the returned ~1000 packages as "children" of
the root, dedups them in subsequent BFS iterations (each returns the
same 1000), terminates after one frontier expansion, and stores the
~1000 unrelated packages as the subtree under `ZFOO`. Any later
`checkPackage(some-unrelated-pkg)` against a `ZFOO/**` rule then returns
**allowed**, silently over-granting writes. The `maxPackages=10000` cap
in the resolver is never tripped (dedup keeps the set bounded). This
is a security regression of the safety ceiling.

This plan replaces the broken endpoint with
`POST /sap/bc/adt/repository/nodestructure?parent_type=DEVC/K&parent_name=X`,
which is the canonical ADT primitive for "direct children of package X"
used by `marcellourbani/abap-adt-api` (the standard TS lib),
`fr0ster/mcp-abap-adt-clients`, `oisee/vibing-steampunk`,
`mario-andreschak/mcp-abap-adt`, and `jfilak/sapcli`. Live probing
against S/4HANA 2023 confirmed:

- BFS via `nodestructure` matches `SELECT devclass FROM tdevc WHERE parentcl = X`
  exactly for `SABP_TOOLS` (127 packages, depth 5), `/AIF/MAIN`
  (107, depth 3, namespace package), `SABP_UNIT` (19, depth 2), `SABP`
  (38, depth 2).
- Edge cases work: nonexistent package → HTTP 200 empty subtree;
  namespace packages (`/AIF/MAIN`) → correct percent-encoded URL;
  `$TMP` → API correctly returns only TADIR-active children
  (orphan TDEVC rows pointing at deleted packages are filtered out).

The change is small but security-critical. All existing safety
invariants — fail-closed on resolver error, dedup, cycle protection
via `visited` set, `maxDepth` and `maxPackages` caps, cache TTL,
invalidation on `create_package` / `delete_package` / `change_package`
— remain unchanged. Only the underlying HTTP endpoint and response
parser change. A research note also documents
`POST /sap/bc/adt/repository/informationsystem/virtualfolders/contents`
as an equally valid Option B (with richer per-child metadata) for
future reference; we do not implement it now to keep the diff minimal.

## Context

### Current State

- The branch `claude/review-package-allowlist-0HDAx` introduces the
  subtree-rule feature with all the safety scaffolding correct
  (parser, resolver, cache, intersect, call-site wiring,
  invalidation). The single broken piece is the SAP endpoint the
  resolver calls to enumerate direct children.
- `src/adt/client.ts:getSubpackages()` issues
  `GET /sap/bc/adt/repository/informationsystem/search?...&packageName=<pkg>&objectType=DEVC/K&...`.
  Live S/4HANA 2023 response: the `packageName` filter is silently
  ignored, the endpoint returns up to 1000 unrelated DEVC packages
  (verified via byte-identical MD5 vs. the same call without
  `packageName=`).
- `tests/unit/adt/client.test.ts` (lines 791–861) mocks the response
  with hand-crafted XML that contains only the "correct" children, so
  every test passes against a fiction. No integration test exercises
  this code path against a real SAP system.
- This is a known class of ADT quirk: the integration test file
  already carries a note at lines 585–605 that
  `informationsystem/search` "silently ignores unknown filters
  anyway." The bug is that `packageName` is one of those silently-
  ignored filters when combined with `objectType=DEVC/K`.

### Target State

- `getSubpackages(packageName)` issues
  `POST /sap/bc/adt/repository/nodestructure?parent_type=DEVC/K&parent_name=<pkg>&parent_tech_name=<pkg>&withShortDescriptions=true`
  with the ADT XML envelope body (`<asx:abap>…<TV_NODEKEY>000000</TV_NODEKEY>…`).
- Response parser filters `OBJECT_TYPE === 'DEVC/K'` AND non-empty
  `OBJECT_NAME` (drops package-interface `DEVC/KI` and placeholder
  rows). All other behavior (uppercasing, dedup, self-exclusion,
  error propagation as `AdtApiError`) is preserved.
- Unit tests use a fixture captured from live a4h and assert against
  real ADT response shapes — not hand-crafted XML.
- A new integration test hits `nodestructure` on a known parent
  (`SABP_UNIT`, which has stable children on every SAP_BASIS 7.5+
  system: `SABP_UNIT_CORE`, `SABP_UNIT_EXECUTION_API`,
  `SABP_UNIT_GUI`, `SABP_UNIT_SCRATCH`, `SABP_UNIT_SHARED`) and
  verifies the exact set.
- The configuration reference doc updates the prose that currently
  states the resolver uses `informationsystem/search` to reflect the
  actual endpoint.
- A research note (`docs/research/package-subtree-endpoints.md`)
  documents the two viable endpoints (`nodestructure` chosen as
  Option A; `virtualfolders/contents` documented as Option B) so the
  decision history is preserved and a future PR can adopt Option B
  if richer per-child metadata becomes useful.

### Key Files

| File | Role |
|------|------|
| `src/adt/client.ts` | Rewrite `getSubpackages()` (lines ~888–928) to POST `repository/nodestructure` and parse `<SEU_ADT_REPOSITORY_OBJ_NODE>` entries. |
| `src/adt/xml-parser.ts` | Add a small parser helper for nodestructure responses (one filtered XPath into `<asx:abap><asx:values><DATA><TREE_CONTENT>`). |
| `src/adt/package-hierarchy.ts` | No code changes — verify the resolver still composes correctly. |
| `src/adt/safety.ts` | No code changes — `checkPackage` already async. |
| `src/handlers/intent.ts` | No code changes — call sites already pass the resolver. |
| `tests/unit/adt/client.test.ts` | Rewrite `describe('getSubpackages …')` (lines 791–861) against the new endpoint shape; load fixture from `tests/fixtures/xml/`. |
| `tests/fixtures/xml/nodestructure-sabp_unit-devc.xml` | NEW — live-captured response from a4h for `parent_name=SABP_UNIT&parent_type=DEVC/K`. |
| `tests/fixtures/xml/nodestructure-empty.xml` | NEW — live-captured response for a leaf / non-existent parent. |
| `tests/integration/adt.integration.test.ts` | NEW test block exercising `getSubpackages` against `TEST_SAP_URL` with `SABP_UNIT` as the known stable parent. |
| `docs/research/package-subtree-endpoints.md` | NEW — research note documenting Option A (chosen) and Option B (`virtualfolders/contents`) plus the live evidence. |
| `docs_page/configuration-reference.md` | Update the `--allowed-packages` row (currently says "via ADT's `informationsystem/search?objectType=DEVC/K` endpoint") to reference `repository/nodestructure`. |
| `docs_page/security-guide.md` | Update the subtree-rule paragraph if it mentions the endpoint. |
| `docs_page/authorization.md` | Update the subtree-rule paragraph if it mentions the endpoint. |
| `CLAUDE.md` | The "Modify package listing" Key Files row mentions `informationsystem/search` — verify wording is still accurate post-change; add a new row for "Resolve allowedPackages subtree (`X/**`)" pointing at `getSubpackages` + `package-hierarchy.ts`. |

### Design Principles

1. **The broken endpoint is the only bug.** The resolver, parser of
   `decidePackageAllowed`, BFS, cache, intersection logic, and call-
   site wiring are all correct. Touch only the SAP-side primitive.
2. **Fail-closed on every error class.** Any HTTP error, parse
   error, or unexpected response shape from `nodestructure` must
   surface as an `AdtApiError` from `getSubpackages` (the resolver
   already converts that to `AdtSafetyError` and denies the package).
   Never silently return `[]`.
3. **Filter on `OBJECT_TYPE === 'DEVC/K'` AND `OBJECT_NAME != ''`.**
   `nodestructure` also returns `DEVC/KI` (package interface) rows
   and placeholder rows with empty `OBJECT_NAME`. Both must be
   dropped before returning to the BFS.
4. **Match other ABAP tooling conventions exactly.** Use the same
   request shape (`parent_name`, `parent_tech_name`, `parent_type`,
   `withShortDescriptions=true`, XML body with `TV_NODEKEY=000000`,
   `Accept: application/vnd.sap.as+xml`) that
   `marcellourbani/abap-adt-api`, `fr0ster/mcp-abap-adt-clients`,
   and `jfilak/sapcli` use. Don't invent a new request shape.
5. **Real fixtures, not hand-crafted XML.** Capture the actual SAP
   response and commit it under `tests/fixtures/xml/`. The previous
   broken implementation's tests passed only because they encoded an
   incorrect server behavior into mocks.
6. **One live-integration test is non-negotiable.** Pick a parent
   package whose children are stable across SAP_BASIS 7.5+ releases
   (`SABP_UNIT`), assert the exact expected set, and run against the
   real ADT endpoint. This is the missing safety net.
7. **Option B documented, not implemented.** The
   `virtualfolders/contents` endpoint works equally well and returns
   richer metadata (child counts, descriptions). Record the request
   shape and trade-offs in the research note; do not adopt now.

## Development Approach

Land Task 1 (client + parser + fixtures) and Task 2 (unit-test
rewrite) together as a coherent commit — the new fixtures only make
sense paired with the new endpoint and parser. Task 3 (integration
test) is independent and tests the same shape against live SAP.
Tasks 4–6 are doc updates and final verification. The whole change
sits on a fresh branch from `main` that also picks up the staged
subtree-feature files from `claude/review-package-allowlist-0HDAx`,
so the resulting PR is a single self-contained unit (subtree feature
with the correct endpoint from the start) rather than feature-then-
fix split across two PRs.

Unit-test mocking pattern: same as elsewhere in `tests/unit/adt/` —
`vi.mock('undici', …)` with `mockResponse()` from
`tests/helpers/mock-fetch.ts`. The new fixture file is read with
`fs.readFileSync` at test startup.

Integration tests follow the existing `getPackageContents` pattern
in `tests/integration/adt.integration.test.ts` (sequential
execution, `getTestClient()` factory, `requireOrSkip` for valid
skips). Choose `SABP_UNIT` as the parent because it is part of the
standard ABAP unit-test infrastructure and is present on every
SAP_BASIS 7.5+ system the project supports.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run test:integration -- tests/integration/adt.integration.test.ts` (with `TEST_SAP_URL` set)

### Task 1: Replace getSubpackages endpoint with repository/nodestructure

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `src/adt/xml-parser.ts`
- Create: `tests/fixtures/xml/nodestructure-sabp_unit-devc.xml`
- Create: `tests/fixtures/xml/nodestructure-empty.xml`

The current implementation at `src/adt/client.ts:888-928` issues
`GET /sap/bc/adt/repository/informationsystem/search?…&packageName=X&objectType=DEVC/K&…`
which the live S/4HANA 2023 system silently ignores the
`packageName` filter for and returns ~1000 unrelated DEVC packages.
This task replaces it with the canonical
`POST /sap/bc/adt/repository/nodestructure` and adds a small parser
helper.

- [ ] In `src/adt/xml-parser.ts`, add `parseSubpackageNodestructure(xml: string): string[]` that:
  - Parses the response with `fast-xml-parser` v5 (existing project parser instance pattern)
  - Reaches into `<asx:abap><asx:values><DATA><TREE_CONTENT>` and reads all `<SEU_ADT_REPOSITORY_OBJ_NODE>` entries
  - Filters to entries where `OBJECT_TYPE === 'DEVC/K'` AND `OBJECT_NAME` is non-empty after trimming
  - Returns the uppercased `OBJECT_NAME` values in insertion order, deduplicated
  - Returns `[]` if `TREE_CONTENT` is missing or empty (this is the legitimate "no children" case)
  - Throws if the outer envelope cannot be parsed at all (malformed XML)
- [ ] In `src/adt/client.ts:getSubpackages(packageName, maxResults = 1000)`:
  - Replace the GET to `informationsystem/search` with a POST to `/sap/bc/adt/repository/nodestructure` with these query params (URL-encode each): `parent_type=DEVC/K`, `parent_name=<packageName>`, `parent_tech_name=<packageName>`, `withShortDescriptions=true`
  - Set headers: `Accept: application/vnd.sap.as+xml`, `Content-Type: application/vnd.sap.as+xml; charset=UTF-8; dataname=null`
  - Body: `<?xml version="1.0" encoding="UTF-8"?><asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><TV_NODEKEY>000000</TV_NODEKEY></DATA></asx:values></asx:abap>`
  - Use the project's `http.post(url, body, contentType)` shape (see other POSTs in `client.ts` for the exact signature — e.g., `runQuery`)
  - Pass the parsed result through `parseSubpackageNodestructure`, then apply existing post-processing: exclude self-name, dedupe, return as `string[]`
  - Preserve the `maxResults` parameter shape for backward-compat but note in the doc-comment that `nodestructure` returns the full child set (no `maxResults` clamp on the SAP side); keep the clamp as a defense-in-depth post-filter in case the response is unexpectedly large
  - Update the doc-comment to reference `nodestructure` instead of `informationsystem/search`; cite ADT's request semantics and TDEVC.PARENTCL match
  - Preserve the "any error surfaces as exception, never empty list" contract: HTTP errors and parse errors must propagate as `AdtApiError`
- [ ] Capture `tests/fixtures/xml/nodestructure-sabp_unit-devc.xml`:
  - Use the live a4h system (`TEST_SAP_URL` from `.env`) and `curl`
  - Save the full raw XML response (do not edit/format/trim it; it's a fixture of what SAP returns)
  - Verify the file contains DEVC/K rows for `SABP_UNIT_CORE`, `SABP_UNIT_EXECUTION_API`, `SABP_UNIT_GUI`, `SABP_UNIT_SCRATCH`, `SABP_UNIT_SHARED`
- [ ] Capture `tests/fixtures/xml/nodestructure-empty.xml`:
  - Hit `nodestructure` for a non-existent parent (e.g., `ZNO_SUCH_PKG_999`)
  - Save the response (will be HTTP 200 with `<TREE_CONTENT/>` empty)
- [ ] Run `npm run typecheck` and `npm run lint`
- [ ] Run `npm test -- tests/unit/adt/client.test.ts` — note: existing tests for `getSubpackages` will fail at this point; that is expected and resolved in Task 2.

### Task 2: Rewrite getSubpackages unit tests against the live fixture

**Files:**
- Modify: `tests/unit/adt/client.test.ts`

The current unit tests at `tests/unit/adt/client.test.ts:791-861`
mock the broken `informationsystem/search` response. They pass
against a fiction. Rewrite them against the new `nodestructure`
endpoint and the live-captured fixture.

- [ ] Read the new fixture: `import { readFileSync } from 'node:fs'; const SABP_UNIT_FIXTURE = readFileSync(new URL('../../fixtures/xml/nodestructure-sabp_unit-devc.xml', import.meta.url), 'utf8');`
- [ ] Update the `describe('getSubpackages (direct DEVCLASS children)', …)` block:
  - Drop the `SUBPKG_RESPONSE`, `MIXED_RESPONSE`, `SELF_RESPONSE` hand-crafted XML literals
  - Add a new test that loads the fixture, mocks the POST to nodestructure, and asserts the returned array equals `['SABP_UNIT_CORE', 'SABP_UNIT_EXECUTION_API', 'SABP_UNIT_GUI', 'SABP_UNIT_SCRATCH', 'SABP_UNIT_SHARED']` (sorted for stability)
  - Add a test that asserts the URL is `POST /sap/bc/adt/repository/nodestructure` with the four expected query params (`parent_type=DEVC%2FK`, `parent_name=SABP_UNIT`, `parent_tech_name=SABP_UNIT`, `withShortDescriptions=true`)
  - Add a test that asserts the request body contains `<TV_NODEKEY>000000</TV_NODEKEY>` (the ADT envelope is required by SAP — if a future refactor strips the body, SAP returns HTTP 406 and the resolver fails closed)
  - Add a test that asserts `Accept: application/vnd.sap.as+xml` is in the request headers
  - Add a test that filters out `DEVC/KI` (package interface) rows — craft a minimal in-test XML literal containing one `DEVC/K` row and one `DEVC/KI` row; only the `DEVC/K` survives
  - Add a test that filters out rows with empty `OBJECT_NAME` (placeholders SAP includes for the package's own info)
  - Add a test using `nodestructure-empty.xml` fixture: empty `TREE_CONTENT` → returns `[]`
  - Add a test that namespace package names are URL-encoded in the query params (`/AIF/MAIN` → `parent_name=%2FAIF%2FMAIN`)
  - Preserve the "propagates SAP errors" test: HTTP 500 → throws `AdtApiError`
  - Preserve the "never returns the queried package itself" assertion (use an in-test XML containing `<OBJECT_NAME>SABP_UNIT</OBJECT_NAME>` alongside a real child; only the real child survives)
- [ ] Add unit tests for `parseSubpackageNodestructure` directly in `tests/unit/adt/xml-parser.test.ts` (~5 tests): full fixture parse, empty TREE_CONTENT, malformed envelope (throws), DEVC/KI filter, empty OBJECT_NAME filter
- [ ] Run `npm test` — all unit tests must pass

### Task 3: Add live-integration test for getSubpackages

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

The previous broken implementation slipped through because no
integration test hit the real ADT endpoint. Add one. `SABP_UNIT` is
the chosen stable target — its children are part of the standard
ABAP unit-test framework and present on every SAP_BASIS 7.5+ system
the project supports.

- [ ] In `tests/integration/adt.integration.test.ts`, locate the existing `describe('getPackageContents (search-endpoint based)', …)` block around line 300 and add a sibling block `describe('getSubpackages (nodestructure)', …)`:
  - Test 1: `getSubpackages('SABP_UNIT')` returns at least `['SABP_UNIT_CORE', 'SABP_UNIT_EXECUTION_API', 'SABP_UNIT_GUI', 'SABP_UNIT_SCRATCH', 'SABP_UNIT_SHARED']` (use `expect(arr).toEqual(expect.arrayContaining([...]))` — the exact superset may grow on newer SAP_BASIS releases)
  - Test 2: `getSubpackages('SABP_UNIT_CORE')` returns the 5 known sub-children (or whatever the live system has) — assert it returns a non-empty array of unique uppercased names
  - Test 3: `getSubpackages('ZNO_SUCH_PKG_999X')` returns `[]` (non-existent parent → empty list, NOT an error — SAP returns 200 with empty TREE_CONTENT)
  - Test 4: `getSubpackages('/AIF/MAIN')` returns a non-empty array (verifies namespace-package URL encoding works against live SAP)
  - Sequential execution (`describe.sequential` if used elsewhere; otherwise rely on the file-level sequential setting)
  - Use `requireOrSkip(ctx, …)` with `SkipReason.NO_FIXTURE` if `SABP_UNIT` is not on the system (extremely unlikely but defensive)
- [ ] Run `TEST_SAP_URL=http://a4h.marianzeis.de:50000 TEST_SAP_USER=MARIAN TEST_SAP_PASSWORD=<from .env> TEST_SAP_CLIENT=001 npm run test:integration -- tests/integration/adt.integration.test.ts -t "getSubpackages"` — all tests pass against live a4h

### Task 4: Documentation — update endpoint references

**Files:**
- Modify: `docs_page/configuration-reference.md`
- Modify: `docs_page/security-guide.md` (only if it references the endpoint)
- Modify: `docs_page/authorization.md` (only if it references the endpoint)
- Modify: `CLAUDE.md`

The current docs for the subtree rule (added in the
`claude/review-package-allowlist-0HDAx` branch) mention
`informationsystem/search?objectType=DEVC/K` as the resolution
endpoint. Update them to reflect the corrected `repository/nodestructure`.

- [ ] In `docs_page/configuration-reference.md`, replace the phrase `via ADT's \`informationsystem/search?objectType=DEVC/K\` endpoint` with `via ADT's \`repository/nodestructure\` endpoint (the canonical primitive for "direct children of package X" used by Eclipse ADT and other ABAP tooling)`
- [ ] Grep for any other reference to `informationsystem/search` in the context of subpackage resolution under `docs_page/`; update each
- [ ] In `CLAUDE.md`, locate the "Modify package listing (`SAPRead type=DEVC`)" row — keep it as-is because that's about `getPackageContents`, which still uses `informationsystem/search?packageName=X` WITHOUT `objectType=` and works correctly
- [ ] Add a new row to the "Key Files for Common Tasks" table in `CLAUDE.md`: `Resolve allowedPackages subtree (X/**)` → `src/adt/client.ts` (`getSubpackages` via `repository/nodestructure`), `src/adt/package-hierarchy.ts` (`AdtPackageHierarchyResolver`), `src/adt/safety.ts` (`decidePackageAllowed`/`checkPackage`), `tests/unit/adt/client.test.ts`, `tests/integration/adt.integration.test.ts`
- [ ] Run `npm run lint` and `npm run typecheck` (no code touched, but verify nothing broke)

### Task 5: Add research note documenting Option B (virtualfolders/contents)

**Files:**
- Create: `docs/research/package-subtree-endpoints.md`

Document the two viable endpoints for "direct children of package X"
and the rationale for choosing `nodestructure` (Option A) over
`virtualfolders/contents` (Option B). This preserves the decision
history and gives a future PR the request shape to adopt Option B
if richer per-child metadata becomes useful.

- [ ] Create `docs/research/package-subtree-endpoints.md` with these sections:
  - **Problem**: The `informationsystem/search?packageName=X&objectType=DEVC/K` endpoint silently ignores `packageName` and returns ~1000 unrelated packages. Cite the live evidence (byte-identical MD5 with/without `packageName=`).
  - **Option A — `repository/nodestructure` (chosen)**: Full request/response shape (URL, query params, headers, body, response filter). Note that this is the canonical primitive used by `marcellourbani/abap-adt-api`, `fr0ster/mcp-abap-adt-clients`, `oisee/vibing-steampunk`, `mario-andreschak/mcp-abap-adt`, `jfilak/sapcli`.
  - **Option B — `repository/informationsystem/virtualfolders/contents` (documented for future)**: Full request shape (POST with `<vfs:preselection facet="package"><vfs:value>X</vfs:value></vfs:preselection>` body, `Accept: application/vnd.sap.adt.repository.virtualfolders.result.v1+xml`). Advantage: returns child counts and descriptions per child in one round-trip. Disadvantage: a different XML envelope to parse. Used by `Artisan-Edge/Catalyst-Relay` (`src/core/adt/discovery/tree/childPackages.ts`).
  - **Decision**: Option A is simpler, lower-metadata, and matches the de-facto-standard ABAP tooling pattern. Option B is recorded as a follow-up if the safety layer ever wants to surface diagnostics like "rule grants writes to 127 packages including ZX, ZY, …". Either is a drop-in replacement at the `getSubpackages` boundary.
  - **Live evidence** (S/4HANA 2023, a4h.marianzeis.de): BFS via `nodestructure` exactly matches `SELECT devclass FROM tdevc WHERE parentcl = X` for `SABP_TOOLS` (127, depth 5), `/AIF/MAIN` (107, depth 3), `SABP_UNIT` (19, depth 2), `SABP` (38, depth 2). Edge cases: nonexistent → empty; namespace → correct URL encoding; `$TMP` → only TADIR-active children (orphan TDEVC rows are filtered by SAP, which is the desired behavior for a safety gate).
- [ ] Run `npm run lint` (no code touched)

### Task 6: Final verification

- [ ] Run full unit suite: `npm test` — all tests pass, including the new fixture-backed `getSubpackages` tests, `parseSubpackageNodestructure` tests, and any tests touching the resolver
- [ ] Run typecheck: `npm run typecheck` — no errors
- [ ] Run lint: `npm run lint` — no errors
- [ ] Run the new integration test against live SAP: `TEST_SAP_URL=http://a4h.marianzeis.de:50000 TEST_SAP_USER=MARIAN TEST_SAP_PASSWORD=<from .env> TEST_SAP_CLIENT=001 npm run test:integration -- tests/integration/adt.integration.test.ts -t "getSubpackages"` — all 4 sub-tests pass
- [ ] Manually verify the resolver end-to-end: with the implementation built (`npm run build`), start an MCP session with `SAP_ALLOWED_PACKAGES='$TMP,SABP_UNIT/**' SAP_ALLOW_WRITES=true` (the test system has SABP_UNIT and known children) and verify:
  - A write attempt to `SABP_UNIT_CORE` would pass the safety check (it's a true child via TDEVC) — note: SAP will reject the actual write because the package is SAP-owned, but the safety layer must return `allowed`, not `denied`
  - A write attempt to `SBDS` (an unrelated DEVC package that the broken endpoint used to spuriously include) must be denied by the safety layer with `Operations on package 'SBDS' are blocked` — this is the regression test for the security bug
- [ ] Move this plan to `docs/plans/completed/`
