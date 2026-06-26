# OData / SQL performance-insight tools (sap-statistics probe, CDS Show-SQL, ICF-inactive guard)

## Overview

Give an LLM three cheap, GUI-free signals for "why is this Fiori/OData request slow", all live-verified on
a4h (S/4HANA 2023, SAP_BASIS 758):

1. **`SAPDiagnose action=odata_perf`** — GET an OData URL with `?sap-statistics=true` + a wall-clock timer;
   return the server-side timing split (`gwtotal`/`gwapp`/**`gwappdb`**/`gwfw`/`icfauth`…) + a routing verdict
   (DB-bound vs ABAP vs framework vs auth). The missing "where did the time go" signal.
2. **`SAPDiagnose action=cds_sql`** — POST `…/ddic/ddl/createstatements/{ddls}`; return the native SQL `CREATE
   VIEW` the CDS view generates (so the LLM sees the joins/scan behind a slow entity).
3. **ICF-inactive activation guard** — detect SAP's `403 text/html "Service cannot be reached"` page (an
   un-activated SICF node, e.g. for OData) and return an actionable "activate the SICF service" hint instead of
   a raw 403. Reused by the PR-B ST05/TMC features.

All three are read/data-scoped, additive, and release-tolerant. Ponytail: no new files where a sibling module
already hosts the pattern; the parsers are pure functions with unit tests against captured real responses.

- `odata_perf` is `data` scope (reads business data via OData); `cds_sql` + the guard are `read` scope.
- No new env vars or config flags. No change to any existing action's behavior.
- Security: `odata_perf` fetches a caller-supplied path — it MUST be a host-relative path (`/sap/...`); reject
  absolute URLs / schemes (SSRF boundary). This is a trust boundary and is not simplified away.

## Context

### Current State

- `SAPDiagnose` (`src/handlers/diagnose.ts`, `handleSAPDiagnose` switch at ~line 38) has actions syntax,
  unittest, atc, cds_testcases, dumps, traces, system_messages, gateway_errors, object_state, quickfix,
  apply_quickfix. No OData-perf or CDS-SQL action.
- `AdtHttpClient.get()` returns `AdtResponse { status, headers: Record<string,string>, body }`
  (`src/adt/http.ts:163`) — response headers (incl. `sap-statistics`) are already accessible. `post()`
  auto-manages CSRF.
- `classifySapDomainError()` (`src/adt/errors.ts:535`) already classifies the ADT `404 "No suitable resource
  found"` case (`icf-handler-not-bound`, `errors.ts:639`) but NOT the ICF HTML `403 "Service cannot be
  reached"` page returned by un-activated non-ADT nodes.

### Target State

Two new SAPDiagnose actions (`odata_perf`, `cds_sql`) wired through the three-file schema sync + ACTION_POLICY,
and one new branch in `classifySapDomainError` for the ICF-inactive HTML page.

### Key Files

| File | Role |
|------|------|
| `src/adt/errors.ts` | `classifySapDomainError` — add `icf-service-inactive` branch (#3) |
| `src/adt/diagnostics.ts` | pure parsers: `parseSapStatistics`, `verdictFromStatistics`, `parseCdsCreateStatements` |
| `src/adt/client.ts` | `probeODataPerformance(url, method)` (#1) + `getCdsCreateStatements(name)` (#2), each `checkOperation`-guarded |
| `src/handlers/diagnose.ts` | `case 'odata_perf'` + `case 'cds_sql'`; update default-case action list |
| `src/handlers/schemas.ts` | `SAPDiagnoseSchema` action enum + `url`/`method` params (~line 695) |
| `src/handlers/tools.ts` | SAPDiagnose action enum (~line 1180) + descriptions + `url`/`method` properties |
| `src/authz/policy.ts` | `SAPDiagnose.odata_perf` (data/Query), `SAPDiagnose.cds_sql` (read/Read) (~line 134) |
| `tests/unit/adt/{diagnostics,errors}.test.ts`, `tests/fixtures/xml/createstatements-i-currency.xml` | tests + captured fixture |

### Verified Live Evidence

All captured 2026-06-25 on a4h (S/4HANA 2023, 758), user MARIAN:

- **#1 sap-statistics:** `GET /sap/opu/odata/IWFND/CATALOGSERVICE;v=2/ServiceCollection?$top=1&sap-statistics=true`
  → `200`, header `sap-statistics: total=459,fw=455,app=0,gwtotal=459,gwfw=455,gwrfcoh=0,gwnongw=4,gwapp=0,
  gwhub=455,gwbe=0,icftotal=557,icfauth=34,icfext=536,icmtotal=575,icmreqrcv=2,icmext=573` + `sap-perf-fesrec:`.
  On a real data OData call the dossier captured `gwappdb=100` (DB time). **Field set is variable** — parse the
  whole `k=v` map; surface known keys; don't assume any field exists.
- **#2 createstatements:** `GET …/createstatements/I_CURRENCY` → `405 ExceptionMethodNotSupported`. `POST` w/o
  CSRF → `403 x-csrf-token: Required`. `POST` w/ wrong Accept → `406` listing `application/vnd.sap.adt.ddl.
  createStatements+xml`. **`POST …/createstatements/I_CURRENCY` + CSRF + `Accept: application/vnd.sap.adt.ddl.
  createStatements+xml` + empty body → `200`**, body
  `<ddl:source adtcore:name="I_CURRENCY"…><ddl:createStatements><ddl:createStatement adtcore:name="I_CURRENCY"
  adtcore:type="1" state="A"><ddl:statement>CREATE OR REPLACE VIEW "IFICURRENCY" AS SELECT … FROM "TCURC" LEFT
  OUTER JOIN "TCURX" …</ddl:statement></ddl:createStatement></ddl:createStatements></ddl:source>`. Saved to
  `tests/fixtures/xml/createstatements-i-currency.xml`. (≥1 `<ddl:createStatement>` possible.)
- **#3 ICF-inactive:** `GET /sap/bc/bsp/sap/it00/default.htm` (un-activated node) → `403`,
  `content-type: text/html`, body `<html><head><title>Service cannot be reached</title>…<span
  class="errorTextHeader"> 403 Forbidden </span>…`. Distinct from ADT's XML
  `<exc:exception><type id="ExceptionResourceNotFound"/>…` (`404`, `application/xml`).

### Design Principles

1. **Release behavior (as-shipped, verified live on 750/758/816).** `odata_perf` + the ICF guard are
   release-invariant. `createstatements` works on **all three** — on 7.50 it returns a classic DB `VIEW/DV`
   `CREATE VIEW`, on 758/816 a `DDLS/DF` `CREATE OR REPLACE VIEW` (the "likely absent on 7.50" assumption was
   wrong — verify, don't guess). `sap-statistics` reports only `gwhub` (no `gwfw`/`gwappdb`) on 7.50, so the
   verdict maps `gwhub`→framework and returns `unknown` rather than guessing `db` when there's no breakdown.
2. **Three-file schema sync** (Rule 7): every new param/action lands in `tools.ts` + `schemas.ts` + the handler;
   ACTION_POLICY parity is CI-enforced (`npm run validate:policy`).
3. **All ADT/HTTP calls stay safety-guarded** — new client methods call `checkOperation()` first.
4. **SSRF boundary** on `odata_perf.url`: host-relative path only.

## Development Approach

TDD-ish: write the pure parser + its unit test (happy + malformed) first, then the client method, then wire the
handler. Fixtures are captured-live (`createstatements-i-currency.xml`) — do not hand-edit. The default-case
action list in `diagnose.ts` must list the new actions. Snapshot fixtures (`tests/fixtures/tool-definitions/`)
regenerate with `npx vitest run -u`; the schema-budget + file-size ratchets may need a bump in the same commit.
Live verification needs `TEST_SAP_URL` (creds in `INFRASTRUCTURE.md`) — runs in the Final task, not in
`## Validation Commands`.

## Validation Commands

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npm run validate:policy`

### Task 1: ICF-inactive activation guard (#3) in `classifySapDomainError`

**Files:**
- Modify: `src/adt/errors.ts` (`classifySapDomainError`, new branch near the `icf-handler-not-bound` block at ~line 639)
- Modify: `tests/unit/adt/errors.test.ts`

Context: an un-activated SICF node returns a `403 text/html` page titled "Service cannot be reached" (verified
above), which today surfaces as a bare 403. This guard turns it into an actionable hint and is reused by the
PR-B ST05/TMC features. Mirror the existing `icf-handler-not-bound` branch shape.

- [ ] Add a branch: when `(statusCode === 403 || statusCode === 404)` AND `/Service cannot be reached/i` tests
      true on the raw body (the HTML page) → return `{ category: 'icf-service-inactive', transaction: 'SICF',
      hint: … }`. The hint names the path's SICF node and tells the user to activate it in tcode SICF (e.g.
      "Activate the ICF service for `<path>` in tcode SICF (right-click → Activate Service); for ARC-1's ST05/TMC
      features activate `/sap/bc/stmc` and its sub-nodes."). Keep it terse (1–2 sentences).
- [ ] Place the branch BEFORE the generic auth/403 branch so the HTML page is matched first; confirm the ADT
      XML `ExceptionResourceNotFound`/`No suitable resource found` paths are unaffected (regression).
- [ ] Add ~3 unit tests in `describe('classifySapDomainError')`: the captured `403 "Service cannot be reached"`
      HTML → `icf-service-inactive`; an ADT `404 ExceptionResourceNotFound` XML → unchanged (NOT mis-classified);
      a plain `403 Forbidden` auth body → still `authorization`.
- [ ] Run `npm test`.

### Task 2: sap-statistics OData perf probe (#1)

**Files:**
- Modify: `src/adt/diagnostics.ts` (add `parseSapStatistics`, `verdictFromStatistics`)
- Modify: `src/adt/client.ts` (`probeODataPerformance(url, method)`)
- Modify: `src/handlers/diagnose.ts` (`case 'odata_perf'`)
- Modify: `src/handlers/schemas.ts` (enum + `url`/`method`), `src/handlers/tools.ts` (enum + props), `src/authz/policy.ts`
- Modify: `tests/unit/adt/diagnostics.test.ts`

Context: the header carries the server-side timing split; `gwappdb` is DB time. Pure parser first.

- [ ] `parseSapStatistics(header: string): Record<string, number>` — split on `,`, then `=`; keep numeric
      values; tolerate missing/extra fields and an empty header (`{}`).
- [ ] `verdictFromStatistics(m): { bound: 'db'|'app'|'framework'|'auth'|'unknown', note: string }` — route by
      the dominant component: `gwappdb` dominant → db (→ check the CDS query / cds_sql / ST05); `gwapp−gwappdb`
      dominant → app/SADL; `gwfw` dominant → metadata/first-call; `icfauth` dominant → auth. Be defensive when
      fields are absent.
- [ ] `probeODataPerformance(url, method='GET')` in client.ts: `checkOperation(this.safety,
      OperationType.Query, 'ProbeODataPerformance')`; **reject if `url` doesn't start with `/` or contains
      `://`** (SSRF); append `sap-statistics=true` (respect existing `?`); `const t0 = Date.now()`; `http.get`;
      return `{ status, wallClockMs, statistics: parseSapStatistics(headers['sap-statistics'] ?? ''),
      fesrecMicros?, verdict, bytes }`.
- [ ] Wire `case 'odata_perf'`: require `args.url` (string) else `errorResult` with guidance; call the client
      method; `textResult(JSON.stringify(result, null, 2))`.
- [ ] Three-file sync: add `'odata_perf'` to the `schemas.ts` enum (line ~695) + the `tools.ts` enum (~1180) +
      `url`/`method` properties (with the "host-relative path from the Fiori Network tab" description); add
      `'SAPDiagnose.odata_perf': { scope: 'data', opType: OperationType.Query }` to `policy.ts`; update the
      `diagnose.ts` default-case action list.
- [ ] Tests (~6) in `describe('parseSapStatistics')` / `describe('verdictFromStatistics')`: the captured header
      → correct map; empty/garbage header → `{}` / `unknown`; a `gwappdb`-dominant synthetic map → `db`; an
      `icfauth`-dominant map → `auth`. Plus a client-level guard test that an absolute URL is rejected.
- [ ] Run `npm test`.

### Task 3: CDS Show-SQL (#2) — `SAPDiagnose action=cds_sql`

**Files:**
- Modify: `src/adt/diagnostics.ts` (`parseCdsCreateStatements`)
- Modify: `src/adt/client.ts` (`getCdsCreateStatements(name)`)
- Modify: `src/handlers/diagnose.ts` (`case 'cds_sql'`)
- Modify: `src/handlers/schemas.ts`/`tools.ts`/`src/authz/policy.ts`
- Verify: `tests/fixtures/xml/createstatements-i-currency.xml` (captured live)
- Modify: `tests/unit/adt/diagnostics.test.ts`

Context: returns the native SQL the CDS view compiles to. POST-only + CSRF + a specific Accept (verified).

- [ ] `parseCdsCreateStatements(xml): { name: string; statements: { name?: string; type?: string; state?: string;
      sql: string }[] }` — parse each `<ddl:createStatement>` → its `<ddl:statement>` text; decode XML entities.
- [ ] `getCdsCreateStatements(name)` in client.ts: `checkOperation(this.safety, OperationType.Read,
      'GetCdsCreateStatements')`; `http.post('/sap/bc/adt/ddic/ddl/createstatements/' +
      encodeURIComponent(name), '', undefined, { Accept: 'application/vnd.sap.adt.ddl.createStatements+xml' })`
      (CSRF auto-managed); return `parseCdsCreateStatements(resp.body)`. Let a 404/405 surface (older releases).
- [ ] Wire `case 'cds_sql'`: require `args.name`; return the parsed statements as JSON.
- [ ] Three-file sync: add `'cds_sql'` to both enums + `'SAPDiagnose.cds_sql': { scope: 'read', opType:
      OperationType.Read }`; update the default-case action list.
- [ ] Tests (~3): parse the captured fixture → 1 statement containing `CREATE OR REPLACE VIEW`; an empty
      `<ddl:createStatements/>` → `[]`; a malformed body → no throw (empty list).
- [ ] Run `npm test`.

### Task 4: Snapshot, budgets, docs

**Files:**
- Modify: `tests/fixtures/tool-definitions/*.json` (regen), `scripts/ci/check-tool-schema-budget.ts`,
  `scripts/ci/check-file-sizes.mjs` (only if a ratchet trips)
- Modify: `docs_page/tools.md`, `docs_page/roadmap.md`, `docs/compare/00-feature-matrix.md`, `CLAUDE.md` (Key Files row)

- [ ] `npx vitest run -u tests/unit/handlers/tool-definitions-snapshot.test.ts`; review the fixture diff (only
      the two new actions + `url`/`method`).
- [ ] If `npm test` flags the schema-budget/file-size ratchet, bump it in THIS commit (and `npm test` again).
- [ ] Document the two actions in `docs_page/tools.md` (SAPDiagnose section) as **as-shipped**: note
      `createstatements` may 404/405 on NW 7.50; `odata_perf` needs the OData service on the same SAP host.
- [ ] Add a roadmap line + feature-matrix row; add a `CLAUDE.md` Key-Files row for the new actions.
- [ ] Run `npm test`, `npm run validate:policy`.

### Task 5: Final verification

- [ ] `npm test` / `npm run typecheck` / `npm run lint` / `npm run validate:policy` / `npm run build` /
      `node scripts/ci/check-file-sizes.mjs` — all green.
- [ ] Live verify on **758** (a4h): build the CLI, `arc1-cli call SAPDiagnose --action cds_sql --name
      I_CURRENCY` → SQL CREATE VIEW; `--action odata_perf --url '/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/
      ServiceCollection?$top=1'` → statistics+verdict; an inactive path → the SICF hint.
- [ ] Live verify on **7.50** (npl) and **816** (a4h-2025): confirm `odata_perf` + the guard work; record
      whether `cds_sql` is available (expected absent/❓ on 7.50) and that ARC-1 degrades gracefully.
- [ ] Move this plan to `docs/plans/completed/` and fix relative links.
