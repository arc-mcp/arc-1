# FEAT-20: Source Version / Revision History

## Overview

This plan adds two new read-only SAPRead types to ARC-1: `VERSIONS` (list revision history of an ABAP object) and `VERSION_SOURCE` (fetch the source at a specific revision). Together they give LLMs visibility into change history, enabling code-review, rollback, and diff workflows. Combined with upcoming FEAT-49 (object→transport reverse lookup) and FEAT-24 (client-side diff), these three features implement the transport-scoped code review use case requested in fr0ster#30 ("check only the code modified in the last Transport Request").

SAP ADT exposes revision history as an Atom-XML feed at `{sourceUrl}/versions`, where each `<atom:entry>` describes a single revision (ID, author, timestamp, and a `src` URI for fetching that revision's source). The feed's content URIs are opaque — callers pass them back verbatim to retrieve the version source. Revisions may not be available for every type on every SAP release: plain ABAP-trial A4H systems typically have revisions for PROG/CLAS/INTF/FUNC but return 404 for DDIC sources (DDLS/BDEF/SRVD). On S/4HANA the endpoint works for CDS artifacts as well.

The roadmap spec (`docs/roadmap.md` FEAT-20) contains one URL error: it lists the INTF versions endpoint as `/oo/interfaces/{name}/includes/main/versions`, but live probing on A4H confirms the correct path is `/oo/interfaces/{name}/source/main/versions` (the `/includes/main/` variant returns 404). This plan fixes that in the roadmap while implementing the feature.

## Context

### Current State

- `SAPRead` always returns the active source (or current inactive draft when present). There is no way to list prior revisions or to read source as of a specific revision.
- Competitors already have this: dassian-adt (`abap_get_revisions`, list-only), VSP v2.33.0 (3 tools: list / docs/compare / get specific), abap-adt-api (`revisions()` + `getObjectSource(url, { version })`).
- `docs/compare/00-feature-matrix.md` has no row for source version history today — this feature introduces the capability and the comparison row.
- `docs/roadmap.md` FEAT-20 line 634 has an incorrect INTF URL (`/includes/main/versions`). Live A4H probing: `GET /sap/bc/adt/oo/interfaces/ZIF_ARC1_TEST/includes/main/versions` → 404; `GET /sap/bc/adt/oo/interfaces/ZIF_ARC1_TEST/source/main/versions` → 200.

### Target State

- `SAPRead(type="VERSIONS", name="ZARC1_TEST_REPORT")` returns JSON `{ object: {...}, revisions: [{ id, author, timestamp, versionTitle, transport?, uri }, ...] }` — one entry per revision, ordered as received (SAP returns newest-first).
- `SAPRead(type="VERSIONS", name="ZCL_ARC1_TEST", include="main")` works for CLAS (accepts `main`, `definitions`, `implementations`, `macros`, `testclasses` — reuses the existing CLAS include enum).
- `SAPRead(type="VERSIONS", name="FOO", group="ZFG_BAR")` works for FUNC (reuses `group` param).
- `SAPRead(type="VERSION_SOURCE", versionUri="/sap/bc/adt/programs/programs/ZARC1_TEST_REPORT/source/main/versions/19700101101123/00000/content")` returns the raw source at that revision (text).
- When a type has no version history on this backend (404), return a friendly error that names the type and suggests the type-mapping/backend limitation (do NOT throw AdtApiError to the LLM verbatim).
- Safety: both actions are `OperationType.Read`. No write paths added.
- Documentation and roadmap updates across CLAUDE.md / `docs/tools.md` / `docs/roadmap.md` / `docs/compare/00-feature-matrix.md`. INTF URL typo fixed in roadmap.

### Key Files

| File | Role |
|------|------|
| `src/adt/types.ts` | Response type definitions. Add `RevisionInfo`, `RevisionListResult`. |
| `src/adt/xml-parser.ts` | XML parsers (`parseFunctionGroup`, `parseInactiveObjects`). Add `parseRevisionFeed` for the Atom feed produced by `{sourceUrl}/versions`. |
| `src/adt/client.ts` | ADT client facade. Add `getRevisions(type, name, opts)` and `getRevisionSource(versionUri)` plus a private `revisionsUrlFor(type, name, opts)` helper. |
| `src/handlers/schemas.ts` | Zod input schema. Add `VERSIONS`, `VERSION_SOURCE` to `SAPREAD_TYPES_ONPREM` (also BTP if probing confirms support — default to on-prem only). Add optional `versionUri` field. |
| `src/handlers/tools.ts` | JSON-Schema tool definition. Mirror schema changes; update `SAPREAD_DESC_ONPREM`/`SAPREAD_DESC_BTP` and the `type` enum description; document the new `versionUri` property. |
| `src/handlers/intent.ts` | `handleSAPRead` router (line 606). Add `case 'VERSIONS'` and `case 'VERSION_SOURCE'` with friendly 404 handling. |
| `tests/fixtures/xml/revision-feed-prog.xml` | Feed fixture — PROG with 1-2 entries. |
| `tests/fixtures/xml/revision-feed-clas-main.xml` | Feed fixture — CLAS main include (URL differs from source URL). |
| `tests/fixtures/xml/revision-feed-empty.xml` | Feed fixture — empty `<atom:feed>` with no entries. |
| `tests/unit/adt/xml-parser.test.ts` | Add parser tests for the revision feed. |
| `tests/unit/adt/client.test.ts` | Add mocked tests for `getRevisions` / `getRevisionSource`. |
| `tests/unit/handlers/intent.test.ts` | Add routing tests (if other SAPRead cases are tested here). |
| `tests/integration/adt.integration.test.ts` | Live SAP tests using persistent E2E fixtures (`ZARC1_TEST_REPORT`, `ZCL_ARC1_TEST`, `ZIF_ARC1_TEST`). |
| `tests/e2e/revisions.e2e.test.ts` | New E2E test file using the MCP client to invoke SAPRead via JSON-RPC. |
| `docs/tools.md` | Tool reference: add VERSIONS / VERSION_SOURCE rows and examples. |
| `docs/roadmap.md` | Flip FEAT-20 to Completed; correct the INTF endpoint URL in the spec table; update Phase B / completed matrix; update the "Current State" feature matrix at top. |
| `docs/compare/00-feature-matrix.md` | Add a new row "Source version history" with ARC-1 ✅ and competitor status. Refresh "Last Updated" header. |
| `CLAUDE.md` | "Key Files for Common Tasks" table — add row for VERSIONS / VERSION_SOURCE. |
| `.claude/commands/implement-feature.md` | Skill may mention VERSION reads as a workflow step for diff / review tasks — update if stale. |

### Design Principles

1. **URL per type (not a generic appending rule).** The path-to-versions differs from the path-to-source. For CLAS the versions endpoint lives under `/includes/{main|definitions|implementations}/versions` while the source endpoint is `/source/main` (GET on `{sourceUrl}/versions` for CLAS main returns 404). Implement a `revisionsUrlFor(type, name, opts)` helper that mirrors the existing read-URL patterns but with the versions-specific suffix per type.
2. **Verified URL mapping (live-probed on A4H).**
   - `PROG`: `/sap/bc/adt/programs/programs/{name}/source/main/versions`
   - `CLAS`: `/sap/bc/adt/oo/classes/{name}/includes/{include}/versions` — default `include=main`; other valid includes: `definitions`, `implementations`, `macros`, `testclasses` (testclasses is optional — returns 404 if the class has none).
   - `INTF`: `/sap/bc/adt/oo/interfaces/{name}/source/main/versions` (NOT `/includes/main/versions` as the roadmap currently says).
   - `FUNC`: `/sap/bc/adt/functions/groups/{group}/fmodules/{name}/source/main/versions`.
   - `INCL`: `/sap/bc/adt/programs/includes/{name}/source/main/versions`.
   - `DDLS`: `/sap/bc/adt/ddic/ddl/sources/{name}/source/main/versions`.
   - `DCLS`: `/sap/bc/adt/acm/dcl/sources/{name}/source/main/versions`.
   - `BDEF`: `/sap/bc/adt/bo/behaviordefinitions/{name}/source/main/versions`.
   - `SRVD`: `/sap/bc/adt/ddic/srvd/sources/{name}/source/main/versions`.
3. **Accept header for feed:** `application/atom+xml;type=feed`. Accept header for version source: `text/plain`. The server returns plain ABAP source for a version URI.
4. **Opaque version URIs.** Do NOT attempt to construct version content URIs client-side. Always use the `src` attribute from the feed entries verbatim. This isolates ARC-1 from SAP internal URI changes. `getRevisionSource(versionUri)` must validate the URI starts with `/sap/bc/adt/` to block SSRF to arbitrary hosts.
5. **Read-only, no CRUD.** Both operations are `OperationType.Read`. No new safety ops; the existing read gate covers them.
6. **Backend-variation handling.** Some types return 404 on plain A4H (DDLS/BDEF/SRVD). The handler must convert 404 into a friendly explanation naming the type, instead of surfacing the raw ADT error — follow the pattern in the existing `DDLX` case (intent.ts ~line 748).
7. **Do NOT add a `version=` query-string passthrough to existing source reads.** abap-adt-api lets callers append `?version=active|inactive|{id}` to the source URL. Our live probing showed `version=active` / `version=inactive` returns 404 on A4H for CLAS (the ADT URL shape differs there). Avoid introducing a half-working feature; keep `VERSION_SOURCE` explicit via the versions feed.
8. **BTP scope.** Do not add VERSIONS/VERSION_SOURCE to `SAPREAD_TYPES_BTP` in this plan. BTP ABAP Environment may expose the feed for released-cloud types but the endpoint set needs its own probing. A follow-up plan can extend after verification. Mention this explicitly in both the tool description and `docs/roadmap.md` completion note.
9. **Output format.** `VERSIONS` returns `JSON.stringify(result, null, 2)` — the standard DDIC pattern. `VERSION_SOURCE` returns the raw source string (like `PROG` / `INCL` reads).
10. **Caching:** Do NOT cache `VERSIONS` or `VERSION_SOURCE` via `CachingLayer`. The feed changes on every activation, and the version source is immutable per URI so caching is low value and adds invalidation complexity. This keeps the existing source-caching invariants intact.

## Development Approach

- Types first, then parser, then client methods, then handler cases, then schema/tool wiring, then tests, then docs.
- Follow `parseInactiveObjects` (xml-parser.ts ~line 1030) as the reference Atom-feed parser — it iterates `findDeepNodes(parsed, 'entry')` and pulls child attributes.
- Follow `getAuthorizationField` (client.ts ~line 346) for the client method shape: `checkOperation` → `http.get(url, { Accept })` → parse → return.
- Live probes confirmed these endpoints work on A4H for PROG/CLAS/INTF/FUNC. Integration tests use the persistent E2E fixtures (`ZARC1_TEST_REPORT`, `ZCL_ARC1_TEST`, `ZIF_ARC1_TEST`) — each has at least one revision entry (the activation performed by E2E setup). For DDIC reads (DDLS/BDEF/SRVD) use `requireOrSkip` with `SkipReason.BACKEND_UNSUPPORTED` on 404 — A4H trial doesn't version DDIC consistently.
- All logging goes to stderr via `src/server/logger.ts`. Never `console.log`.
- E2E test uses the MCP SDK client pattern from `tests/e2e/smoke.e2e.test.ts` and `tests/e2e/helpers.ts` (`connectClient`, `callTool`, `expectToolSuccess`).

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`

### Task 1: Add `RevisionInfo` / `RevisionListResult` types

**Files:**
- Modify: `src/adt/types.ts`

Add the response types consumed by the new parser and client methods. Mirror the JSDoc style of the existing DDIC types (e.g., `AuthorizationFieldInfo` at line 461).

- [ ] Open `src/adt/types.ts` and scroll to the end (after `EnhancementImplementationInfo` at ~line 508).
- [ ] Add a new "Source Revision / Version History Types" section header comment.
- [ ] Add `export interface RevisionInfo { id: string; author: string; timestamp: string; versionTitle?: string; transport?: string; uri: string; }`. JSDoc: "A single revision entry from the ADT `{sourceUrl}/versions` Atom feed."
- [ ] Add `export interface RevisionListResult { object: { name: string; type: string }; revisions: RevisionInfo[]; }`. JSDoc: "Parsed result of a revisions feed read — object metadata from `<atom:title>` plus one entry per revision."
- [ ] Run `npm run typecheck` — must pass (types-only change).

### Task 2: Add `parseRevisionFeed` XML parser

**Files:**
- Modify: `src/adt/xml-parser.ts`
- Create: `tests/fixtures/xml/revision-feed-prog.xml`
- Create: `tests/fixtures/xml/revision-feed-clas-main.xml`
- Create: `tests/fixtures/xml/revision-feed-empty.xml`
- Modify: `tests/unit/adt/xml-parser.test.ts`

Add a parser for the Atom feed returned by `{sourceUrl}/versions`. Real sample from live A4H probing:

```xml
<atom:feed xmlns:atom="http://www.w3.org/2005/Atom" xmlns:adtcore="http://www.sap.com/adt/core">
  <atom:title>Version List of ZARC1_TEST_REPORT (REPS)</atom:title>
  <atom:updated>1970-01-01T10:11:23Z</atom:updated>
  <atom:entry>
    <atom:author><atom:name>DEVELOPER</atom:name></atom:author>
    <atom:content type="text/plain" src="/sap/bc/adt/programs/programs/ZARC1_TEST_REPORT/source/main/versions/19700101101123/00000/content"/>
    <atom:id>00000</atom:id>
    <atom:updated>2026-04-10T18:58:51Z</atom:updated>
  </atom:entry>
</atom:feed>
```

The `<atom:title>` text follows the pattern `"Version List of {NAME} ({TYPE})"` where TYPE is the ADT short code (REPS/CLAS/CINC/INTF/FUNC/DDLS/DCLS/BDEF/SRVD). We parse this for the `object.name` and `object.type` metadata. Some feeds include a `version` attribute on `<atom:link rel="...">` when the revision was released via a transport — parse that into `transport` when present (string, optional).

Steps:

- [ ] Create `tests/fixtures/xml/revision-feed-prog.xml` with two entries. Use realistic author names (`DEVELOPER`, `MARIAN`) and timestamps. Include one entry with a `<atom:link rel="http://www.sap.com/adt/relations/transports" href="/sap/bc/adt/cts/transportrequests/A4HK900123" title="A4HK900123"/>` to cover the transport mapping; the other entry without that link.
- [ ] Create `tests/fixtures/xml/revision-feed-clas-main.xml` — single entry whose `src` attribute references `/sap/bc/adt/oo/classes/ZCL_X/includes/main/versions/.../content` (to prove the URL is opaque and class includes work).
- [ ] Create `tests/fixtures/xml/revision-feed-empty.xml` — a valid `<atom:feed>` with a `<atom:title>Version List of FOO (REPS)</atom:title>` and zero entries.
- [ ] In `src/adt/xml-parser.ts`, import `RevisionInfo`, `RevisionListResult` from `./types.js`.
- [ ] Add `export function parseRevisionFeed(xml: string): RevisionListResult`. Implementation: `if (!xml.trim()) return { object: { name: '', type: '' }, revisions: [] };` → `parseXml(xml)` → grab `<atom:title>` text via `findDeepNodes(parsed, 'title')[0]` and regex `/^Version List of (\S+) \(([A-Z]+)\)/` to extract name+type (fall back to empty strings when no match) → iterate `findDeepNodes(parsed, 'entry')` and map each entry's `atom:id` / `atom:author/name` / `atom:updated` / `atom:content @_src` / optional transport `atom:link[@_rel='http://www.sap.com/adt/relations/transports'] @_title`.
- [ ] Handle repeated atom namespaces: after `removeNSPrefix`, the keys are `title`, `entry`, `content`, `id`, `updated`, `author.name`, `link`. Use `toStringArray(...)` helper for `link` when multiple relations exist on one entry.
- [ ] Use `String(... ?? '')` for every string field. Empty `transport` means the revision was not released in a transport (active draft / local `$TMP` change).
- [ ] Add parser unit tests in `tests/unit/adt/xml-parser.test.ts` (~5 tests): (1) PROG feed with 2 entries parsed correctly; (2) transport field populated for the entry with the transport link, empty for the other; (3) CLAS-main feed `object.type === 'CINC'` or `'CLAS'` (whichever the feed states — whatever the fixture actually contains); (4) empty feed returns empty `revisions` array with title-derived metadata; (5) malformed XML returns empty result (not throw).
- [ ] Run `npm test -- tests/unit/adt/xml-parser.test.ts` — all tests pass.
- [ ] Run `npm test` — full unit suite still green.

### Task 3: Add `getRevisions` / `getRevisionSource` client methods

**Files:**
- Modify: `src/adt/client.ts`
- Modify: `tests/unit/adt/client.test.ts`

Expose the new operations on `AdtClient`. The URL-building logic is type-specific and lives in a private helper. Follow `getAuthorizationField` (line 346) for method shape.

Steps:

- [ ] Import the new types + parser at the top of `client.ts`: `import type { RevisionInfo, RevisionListResult } from './types.js';` and `import { parseRevisionFeed } from './xml-parser.js';`.
- [ ] Add a new section comment `// ─── Source Revision / Version History ──────────────────────────` after the Authorization section (~line 370).
- [ ] Add `private revisionsUrlFor(type: string, name: string, opts: { include?: string; group?: string })` returning the per-type URL. Throw `new Error(...)` with a clear message when the type is unsupported. Use the table in Design Principles §2. For CLAS default `include` to `'main'` when omitted; validate against the allowed set (`main`, `definitions`, `implementations`, `macros`, `testclasses`). For FUNC require `group` (throw if missing — let the handler resolve it). Use `encodeURIComponent` on `name` and `group` (matches existing patterns).
- [ ] Add `async getRevisions(type: string, name: string, opts: { include?: string; group?: string } = {}): Promise<RevisionListResult>` with `checkOperation(this.safety, OperationType.Read, 'GetRevisions')`. Build URL via `revisionsUrlFor`. Call `this.http.get(url, { Accept: 'application/atom+xml;type=feed' })`. Parse via `parseRevisionFeed`. Return the parsed result.
- [ ] Add `async getRevisionSource(versionUri: string): Promise<string>` with `checkOperation(this.safety, OperationType.Read, 'GetRevisionSource')`. Validate: `if (!versionUri.startsWith('/sap/bc/adt/')) throw new Error('versionUri must be an ADT path starting with /sap/bc/adt/');` — prevents arbitrary URL fetching. Call `this.http.get(versionUri, { Accept: 'text/plain' })` and return `resp.body`.
- [ ] In `tests/unit/adt/client.test.ts`, add a new `describe('getRevisions')` block:
  - `vi.resetAllMocks()` + `mockFetch.mockResolvedValue(mockResponse(200, readFixture('revision-feed-prog.xml'), { 'x-csrf-token': 'T' }))` → `const result = await client.getRevisions('PROG', 'ZARC1_TEST_REPORT')` → assert `result.revisions.length === 2`, `result.object.name === 'ZARC1_TEST_REPORT'`.
  - Separate test: CLAS with explicit `include='definitions'` asserts the URL contains `/includes/definitions/versions`.
  - Separate test: CLAS with no include defaults to `main` — assert URL `/includes/main/versions`.
  - Separate test: INTF URL is `/oo/interfaces/{name}/source/main/versions` (catches the roadmap typo).
  - Separate test: FUNC without `group` throws a descriptive error.
  - Separate test: unsupported type (e.g., `'TRAN'`) throws with the type name in the error message.
- [ ] Add a `describe('getRevisionSource')` block:
  - Non-ADT URI rejected (`await expect(client.getRevisionSource('https://evil.example/foo')).rejects.toThrow(/\/sap\/bc\/adt/)`).
  - Happy path: mock `text/plain` response, call with a valid ADT path, assert returned string.
- [ ] Run `npm test -- tests/unit/adt/client.test.ts` — must pass.
- [ ] Run `npm test` — full suite still passes.

### Task 4: Wire VERSIONS / VERSION_SOURCE into SAPRead schemas and tool definitions

**Files:**
- Modify: `src/handlers/schemas.ts`
- Modify: `src/handlers/tools.ts`
- Modify: `tests/unit/handlers/schemas.test.ts` (or add if missing — see schemas.ts tests directory)

Extend only the on-prem enum in this plan. BTP support is deferred.

Steps:

- [ ] In `src/handlers/schemas.ts`, add `'VERSIONS'` and `'VERSION_SOURCE'` to `SAPREAD_TYPES_ONPREM` at the end of the array (after `'ENHO'`). Keep `as const`.
- [ ] Add an optional `versionUri: z.string().optional()` field to both `SAPReadSchema` and `SAPReadSchemaBtp` object shapes. (BTP schema unchanged type-wise, but accepting `versionUri` as no-op lets forward-compat clients send it without rejection.)
- [ ] Extend `validateSapReadInclude` (or add a parallel `validateSapReadVersionSource`) to: when `type === 'VERSION_SOURCE'`, require `versionUri` to be present and start with `/sap/bc/adt/`. Add a Zod `ctx.addIssue` with a specific message when missing or malformed.
- [ ] When `type === 'VERSIONS'` and `type === 'CLAS'`-like include handling is needed — reuse the existing CLAS-include enum check (VERSIONS requesting `include` for CLAS should only accept the same set).
- [ ] In `src/handlers/tools.ts`, add the same two string literals to the `SAPREAD_TYPES_ONPREM` array (line 37-72) after `'ENHO'`.
- [ ] Update `SAPREAD_DESC_ONPREM` (line 102-103) by appending after ENHO: `VERSIONS (list revision history of an object — returns JSON array with id, author, timestamp, transport (if released); pass optional include for CLAS (main/definitions/implementations/macros/testclasses) or group for FUNC; on-prem only, may 404 for DDIC types on non-S/4 systems)`, `VERSION_SOURCE (fetch the source code at a specific revision — pass versionUri from a VERSIONS response entry; returns raw source text; on-prem only)`.
- [ ] In the SAPRead JSON-Schema `properties` block (around line 379), add `versionUri: { type: 'string', description: 'For VERSION_SOURCE: the URI of a specific revision (from a VERSIONS response .uri field). Must start with /sap/bc/adt/.' }`. Update the `type` parameter's `description` to include VERSIONS / VERSION_SOURCE in the enum list.
- [ ] Update the `description` string for the `include` property to mention VERSIONS (CLAS includes apply to both CLAS reads and VERSIONS).
- [ ] Update the `description` string for the `group` property to mention VERSIONS (FUNC group applies to both FUNC reads and VERSIONS).
- [ ] In `tests/unit/handlers/schemas.test.ts`, add ~4 tests: (1) VERSIONS accepted on-prem; (2) VERSION_SOURCE accepted on-prem only when `versionUri` is provided and ADT-scoped; (3) VERSION_SOURCE rejected when `versionUri` missing; (4) VERSION_SOURCE rejected when `versionUri` does not start with `/sap/bc/adt/`. If no existing test file exists, create the describe block in an appropriate location (e.g., `tests/unit/handlers/schemas.test.ts`).
- [ ] Run `npm run typecheck` — Zod enum changes must compile.
- [ ] Run `npm run lint` — must pass.
- [ ] Run `npm test` — all tests pass.

### Task 5: Handler cases in `handleSAPRead`

**Files:**
- Modify: `src/handlers/intent.ts`
- Modify: `tests/unit/handlers/intent.test.ts` (if it exists)

Route the new types in `handleSAPRead`. Add the cases near the read-only DDIC block (around line 793) after `ENHO`. Follow the friendly-404 pattern used in the `DDLX` case (line 748) for types that may be unsupported on older backends.

Steps:

- [ ] Locate `handleSAPRead` at line 606. Find the block where `AUTH`/`FTG2`/`ENHO` cases live (~line 801-811). Add the two new cases immediately after `ENHO` (before `TRAN`).
- [ ] Implement `case 'VERSIONS'`:
  ```typescript
  case 'VERSIONS': {
    const include = typeof args.include === 'string' ? args.include : undefined;
    let group = typeof args.group === 'string' ? args.group : undefined;
    const objectType = normalizeObjectType(String(args.objectType ?? '')) || inferObjectType(name) || 'PROG';
    if (objectType === 'FUNC' && !group) {
      const resolved = cachingLayer
        ? await cachingLayer.resolveFuncGroup(client, name)
        : await client.resolveFunctionGroup(name);
      if (!resolved) {
        return errorResult(
          `Cannot resolve function group for "${name}". Provide the group parameter explicitly.`,
        );
      }
      group = resolved;
    }
    try {
      const result = await client.getRevisions(objectType, name, { include, group });
      return textResult(JSON.stringify(result, null, 2));
    } catch (err) {
      if (isNotFoundError(err)) {
        return textResult(
          `No version history available for ${objectType} "${name}" on this SAP system. ` +
            `This typically means the object does not exist, or the ADT versions endpoint is not supported for ${objectType} on this release.`,
        );
      }
      throw err;
    }
  }
  ```
- [ ] Implement `case 'VERSION_SOURCE'`:
  ```typescript
  case 'VERSION_SOURCE': {
    const versionUri = String(args.versionUri ?? '');
    if (!versionUri) {
      return errorResult(
        'VERSION_SOURCE requires a versionUri parameter. Get it from a SAPRead(type="VERSIONS") response (.revisions[].uri).',
      );
    }
    try {
      const source = await client.getRevisionSource(versionUri);
      return textResult(source);
    } catch (err) {
      if (isNotFoundError(err)) {
        return errorResult(
          `Revision at URI "${versionUri}" was not found. The revision may have been pruned, or the URI is malformed. Fetch a fresh list via SAPRead(type="VERSIONS", name="..."). `,
        );
      }
      throw err;
    }
  }
  ```
- [ ] Add the two new type names to the "unknown type" error message in the `default` branch of the switch (~line 965-969) — keep it in sync with the enum.
- [ ] In `tests/unit/handlers/intent.test.ts`, add ~4 routing tests: (1) VERSIONS with PROG delegates to `client.getRevisions('PROG', name)`; (2) VERSIONS with CLAS + explicit include passes include through; (3) VERSIONS with FUNC auto-resolves group when not provided (mock `client.resolveFunctionGroup` returning a value); (4) VERSION_SOURCE without versionUri returns an error result (not throw); (5) VERSION_SOURCE happy path returns the raw text.
- [ ] Run `npm run typecheck` — no errors.
- [ ] Run `npm run lint` — no errors.
- [ ] Run `npm test` — all tests pass.

### Task 6: Integration tests against live SAP

**Files:**
- Modify: `tests/integration/adt.integration.test.ts`

Add live-SAP integration tests using the persistent E2E fixtures that exist on A4H (`ZARC1_TEST_REPORT`, `ZCL_ARC1_TEST`, `ZIF_ARC1_TEST`). Each has at least one revision (the initial activation).

Steps:

- [ ] Add a new `describe('Version history (VERSIONS / VERSION_SOURCE)')` block in `tests/integration/adt.integration.test.ts`.
- [ ] Test "lists revisions for PROG ZARC1_TEST_REPORT": `const r = await client.getRevisions('PROG', 'ZARC1_TEST_REPORT')`. Assert `r.revisions.length >= 1`, `r.object.name === 'ZARC1_TEST_REPORT'`, each entry has `uri.startsWith('/sap/bc/adt/')`.
- [ ] Test "lists revisions for CLAS ZCL_ARC1_TEST with include=main": assert non-empty and `uri` paths contain `/includes/main/versions/`.
- [ ] Test "lists revisions for CLAS ZCL_ARC1_TEST with include=definitions": similar — may skip with `SkipReason.NO_FIXTURE` if the class has no local definitions (assert via `expectSapFailureClass(err, [404], [/does not exist/i])` when 404).
- [ ] Test "lists revisions for INTF ZIF_ARC1_TEST": assert non-empty and asserts that the correct URL was used (`/oo/interfaces/ZIF_ARC1_TEST/source/main/versions`) — this regression-tests the roadmap typo fix by exercising the live endpoint.
- [ ] Test "fetches version source for the first PROG revision": call VERSIONS, take `r.revisions[0].uri`, call `client.getRevisionSource(uri)`, assert the returned text starts with `REPORT` (case-insensitive) for the E2E fixture.
- [ ] Test "VERSION_SOURCE rejects non-ADT URIs": `await expect(client.getRevisionSource('https://evil.example/foo')).rejects.toThrow();`.
- [ ] For DDLS: optional smoke test that captures a `SkipReason.BACKEND_UNSUPPORTED` on 404. Do not hard-fail — A4H trial is known to 404 here. Use `expectSapFailureClass(err, [404], [/not found|does not exist/i])`.
- [ ] All catches must assert expected shape or error class — no empty `catch {}` or silent returns (skip policy).
- [ ] Run `npm run test:integration` — all pass or documented skips.

### Task 7: E2E tests via MCP JSON-RPC

**Files:**
- Create: `tests/e2e/revisions.e2e.test.ts`

Add an E2E test file exercising SAPRead(VERSIONS / VERSION_SOURCE) through the MCP SDK client, like `tests/e2e/smoke.e2e.test.ts`. The test uses the PERSISTENT fixtures already synced by `tests/e2e/setup.ts` — no new fixture objects needed.

Steps:

- [ ] Create `tests/e2e/revisions.e2e.test.ts` following the structure of `tests/e2e/smoke.e2e.test.ts`.
- [ ] `beforeAll`: `client = await connectClient();`.
- [ ] Test "SAPRead VERSIONS returns a revision list for ZARC1_TEST_REPORT": `const result = await callTool(client, 'SAPRead', { type: 'VERSIONS', name: 'ZARC1_TEST_REPORT' })` → parse JSON → assert `parsed.revisions.length >= 1`, `parsed.object.name === 'ZARC1_TEST_REPORT'`.
- [ ] Test "SAPRead VERSIONS returns revisions for ZCL_ARC1_TEST": same pattern.
- [ ] Test "SAPRead VERSIONS returns revisions for ZIF_ARC1_TEST" (regression-asserts the INTF URL fix): same pattern.
- [ ] Test "SAPRead VERSION_SOURCE returns source at a specific revision": chain — first call VERSIONS, take the first `.uri`, call `SAPRead(type='VERSION_SOURCE', versionUri=uri)` → text response contains `REPORT` (for PROG fixture).
- [ ] Test "SAPRead VERSION_SOURCE without versionUri returns an error": `expectToolError(result, /versionUri/)`.
- [ ] Test "SAPRead VERSION_SOURCE with non-ADT URI is blocked": `expectToolError(result, /sap\/bc\/adt|must be an ADT path/i)`.
- [ ] `afterAll`: `await client?.close();` wrapped in try/catch tagged `// best-effort-cleanup`.
- [ ] Run `npm run test:e2e` (the developer runs the MCP server first via `npm run dev:http`). All tests pass.

### Task 8: Documentation updates

**Files:**
- Modify: `docs/tools.md`
- Modify: `docs/roadmap.md`
- Modify: `docs/compare/00-feature-matrix.md`
- Modify: `CLAUDE.md`
- Modify: `.claude/commands/implement-feature.md` (if it references version/diff workflows)

Keep every artifact that lists SAPRead types in sync. Fix the INTF URL typo in the roadmap spec while we're there.

Steps:

- [ ] `docs/tools.md`: update the `type` row description (line 19 area) to include `VERSIONS`, `VERSION_SOURCE`.
- [ ] `docs/tools.md`: add two rows in the per-type table (the section around line 49-53 where AUTH/FTG2/ENHO live): `VERSIONS` — "Revision history for an ABAP object. Returns JSON: `{ object: { name, type }, revisions: [{ id, author, timestamp, transport?, uri }] }`. Accepts optional `include` (CLAS) and `group` (FUNC). On-prem only." and `VERSION_SOURCE` — "Source code at a specific revision. Pass `versionUri` from a VERSIONS entry. Returns raw source text. On-prem only."
- [ ] `docs/tools.md`: add three SAPRead examples (around line 94 area): `SAPRead(type="VERSIONS", name="ZARC1_REPORT")`, `SAPRead(type="VERSIONS", name="ZCL_X", include="definitions")`, `SAPRead(type="VERSION_SOURCE", versionUri="/sap/bc/adt/...")` — with a one-line outcome comment each.
- [ ] `docs/tools.md`: document the new `versionUri` parameter in the SAPRead parameters table.
- [ ] `docs/roadmap.md` line 612 area (FEAT-20 detail section): **fix the INTF endpoint URL typo** — change `GET /sap/bc/adt/oo/interfaces/{name}/includes/main/versions` to `GET /sap/bc/adt/oo/interfaces/{name}/source/main/versions`. Flip status from `Not started` to `Completed (<today's date>)`. Add a "Completed" note with links to the implementation PR.
- [ ] `docs/roadmap.md` top matrix (line 49 area): strike-through the FEAT-20 row like other completed items (e.g., FEAT-43 on line 60).
- [ ] `docs/roadmap.md` "Overview: Completed" section (~line 84-): insert a new top row for FEAT-20 with today's date.
- [ ] `docs/roadmap.md` Phase B list (~line 183): strike-through the FEAT-20 bullet with completion date + implementation summary (list VERSIONS and VERSION_SOURCE as the new SAPRead types).
- [ ] `docs/roadmap.md`: also strike-through the duplicate FEAT-20 mention in the Phase C area (~line 207).
- [ ] `docs/compare/00-feature-matrix.md`: add a new row after the "Feature toggles (FTG2)" row (~line 95): `| Source version history | ✅ (VERSIONS list + VERSION_SOURCE fetch, `GET {sourceUrl}/versions` Atom feed) | ✅ (3 tools: list/compare/get) | ✅ (`revisions()` + `getObjectSource(url, {version})`) | ❌ | ❌ | ❌ | N/A | ✅ (`abap_get_revisions` list-only) | ❌ |`. Verify competitor columns against the source evaluation files under `docs/compare/abap-adt-api/evaluations/d3c6940-source-versions.md` and `docs/compare/vibing-steampunk/evaluations/dd06202-version-history.md`.
- [ ] `docs/compare/00-feature-matrix.md`: refresh the "Last Updated" header (line 5) to today's date with a "FEAT-20 implemented: VERSIONS/VERSION_SOURCE SAPRead support" note.
- [ ] `CLAUDE.md` "Key Files for Common Tasks" table: add a row `| Add source revision history read (VERSIONS / VERSION_SOURCE) | src/adt/client.ts, src/adt/xml-parser.ts, src/adt/types.ts, src/handlers/intent.ts, src/handlers/schemas.ts, src/handlers/tools.ts |`.
- [ ] `.claude/commands/implement-feature.md`: if the skill references a "read and diff" or "code review" workflow, add one line mentioning VERSIONS/VERSION_SOURCE as the supported primitive for change-history inspection. If no such reference exists, skip this step.
- [ ] Spot-check `README.md` — if there is a SAPRead type highlight list, add VERSIONS/VERSION_SOURCE. Skip if absent.
- [ ] Run `npm test` and `npm run typecheck` — no code touched, but ensure nothing regressed.

### Task 9: Final verification

- [ ] Run full test suite: `npm test` — all unit tests pass.
- [ ] Run typecheck: `npm run typecheck` — no errors.
- [ ] Run lint: `npm run lint` — no errors.
- [ ] Run `npm run test:integration` against `TEST_SAP_URL=http://a4h.marianzeis.de:50000` — all integration tests pass or skip with `SkipReason.BACKEND_UNSUPPORTED` for DDLS/BDEF/SRVD.
- [ ] Run `npm run test:e2e` (with the MCP server running locally via `npm run dev:http`) — all E2E tests pass.
- [ ] Manually invoke `SAPRead(type="VERSIONS", name="ZARC1_TEST_REPORT")` via `npm run dev` stdio against A4H; verify structured JSON output has at least one revision with a non-empty `uri`.
- [ ] Manually invoke `SAPRead(type="VERSION_SOURCE", versionUri="<uri from previous call>")` and verify the returned text starts with `REPORT`.
- [ ] `git grep -n 'interfaces/{name}/includes/main/versions' docs/` returns nothing (the INTF URL typo is removed).
- [ ] `docs/roadmap.md` FEAT-20 entry is marked Completed.
- [ ] `docs/compare/00-feature-matrix.md` "Source version history" row is present with ARC-1 ✅ and "Last Updated" reflects today's date.
- [ ] Move this plan to `docs/plans/completed/2026-04-17-feat-20-source-version-revision-history.md`.
