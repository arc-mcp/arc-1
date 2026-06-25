# Plan — Surface the transport release-check report (issue #433 item 1)

**Status:** ✅ Done (shipped). **Dossier:** [docs/research/issue-433-release-check-report.md](../../research/issue-433-release-check-report.md)
(all SAP facts below are live-verified there — a4h 758, captured 2026-06-25).
**Branch / commit:** `feat(transport): surface release-check report from SAPTransport release`.

## Problem (one line)

`SAPTransport release`/`release_recursive` discard the `newreleasejobs` response body and report a flat
`"Released transport request: <id>"`, so an agent can't see **why** a release was blocked — and worse,
a release that SAP **aborts** still returns HTTP 200, so it is currently reported as a success.

## Design decisions (locked)

1. **`releaseTransport` returns `TransportReleaseReport[]`** (was `void`). Empty/unparseable 200 body →
   `[]` (graceful; preserves today's behavior on the empty-body unit mocks and any non-report 200).
2. **A report with `status` present and `!== 'released'` = a blocked release**, surfaced as an
   `errorResult` even though HTTP was 200. This is the core fix.
3. **`releaseTransportRecursive` fails fast**: if a *task* release comes back blocked, do **not** release
   the parent; return what was released + the reports collected so far.
4. **Recursive return** becomes `{ released: string[]; reports: TransportReleaseReport[] }` (flat list —
   each report's `triggeringUri` already identifies its request/task; no per-id map needed).
5. **Token-lean output** (AGENTS.md #3): clean success → keep the one-line `Released transport request:
   <id>`; success-with-warnings → that line + a short warnings list; blocked → error with statusText +
   messages. Full pretty-printed JSON is NOT dumped.
6. **Out of scope (issue follow-up):** `ignoreLocks`/`ignoreATC` (`relwithignlock`/`relObjigchkatc`)
   input params — no schema/tools/policy changes in this PR. No Accept-header change (server ignores it).

## Tasks

### T1 — Types (`src/adt/types.ts`)
Add near `TransportRequest`:
```ts
export interface TransportReleaseMessage {
  severity: 'error' | 'warning' | 'info';
  type: string;       // raw chkrun severity code (E/W/I/S/…)
  text: string;       // chkrun:shortText
  uri?: string;       // chkrun:uri (may carry #start=LINE,COL)
}
export interface TransportReleaseReport {
  reporter: string;          // e.g. "transportrelease"
  status: string;            // "released" | "abortrelapifail" | …
  statusText: string;
  triggeringUri?: string;    // request/task this report is about
  released: boolean;         // status === 'released'
  messages: TransportReleaseMessage[];
}
```

### T2 — Parser + return-type change (`src/adt/transport.ts`)
- New `parseReleaseReports(xml: string): TransportReleaseReport[]`:
  `findDeepNodes(parseXml(xml), 'checkReport')` → map attrs (`@_reporter`/`@_status`/`@_statusText`/
  `@_triggeringUri`); nested `findDeepNodes(report, 'checkMessage')` → `@_type`/`@_shortText`/`@_uri`
  with severity map `E→error, W→warning, else info` (mirror `parseSyntaxCheckResult` in devtools.ts).
  `decodeXmlEntities` the text. Empty/garbage XML → `[]` (guard: wrap in try or rely on `findDeepNodes`
  returning `[]`).
- `releaseTransport(...)`: return `parseReleaseReports(resp.body)` instead of discarding. Keep the
  organizer Accept (verified equivalent).
- New exported helper `failedReleaseReports(reports): TransportReleaseReport[]` = `reports.filter(r => r.status && !r.released)`.
- `releaseTransportRecursive(...)`: collect `reports`; after each task release, if
  `failedReleaseReports(taskReports).length` → return `{ released, reports }` early (skip parent).
  Return `{ released, reports }`.

### T3 — Handler (`src/handlers/transport.ts`)
- Local `summarizeRelease(id: string, reports: TransportReleaseReport[], released?: string[]): ToolResult`:
  - `failed = failedReleaseReports(reports)`; if `failed.length` → `errorResult` —
    `Transport <id> was NOT released (SAP returned HTTP 200 but aborted the release):` + per failed
    report `• [<status>] <statusText>` + indented `- <severity>: <text> (<uri sans host>)`. Add a hint
    line: fix the ATC errors / locks, then retry.
  - else gather `warnings = reports.flatMap(r => r.messages)`; if any → success line + `Released with N
    warning(s):` list; else → `Released transport request: <id>` (unchanged).
- `case 'release'`: `const reports = await releaseTransport(...); return summarizeRelease(id, reports);`
- `case 'release_recursive'`: `const { released, reports } = await releaseTransportRecursive(...);`
  if no failures → keep returning the released list (now as a short text, e.g.
  `Released (recursive): <ids joined>`), else `summarizeRelease(id, reports, released)`. Preserve the
  existing assertion that the output contains the id.

### T4 — Unit tests (`tests/unit/adt/transport.test.ts`)
- `parseReleaseReports`: vs `transport-release-report-success.xml` → 1 report, `released:true`, 0 msgs;
  vs `transport-release-report-blocked.xml` → 1 report `released:false`, status `abortrelapifail`, 2 msgs
  (1 error + 1 warning, severities mapped, uris carry `#start=`); empty string → `[]`.
- `releaseTransport` returns the parsed reports (mock post body = success fixture). Keep existing
  URL/encode/Accept/blocked-by-safety/empty-body tests green (empty body now returns `[]`).
- `releaseTransportRecursive`: with a task whose release returns a blocked report → parent NOT released
  (assert the parent id is absent from `released` and the blocked report is in `reports`).

### T5 — Handler tests (`tests/unit/handlers/transport.test.ts`)
- `release` success fixture body → `isError` undefined, text contains "Released" + id.
- `release` blocked fixture body → `isError` true, text contains the statusText + a message shortText.
- `release` empty body → success (existing behavior preserved).
- Keep the existing `release_recursive` test green (empty release bodies → success with id).

### T6 — Docs (`docs/dev-guide.md`)
Add a row:
`| Surface transport release-check report | `src/adt/transport.ts` (`parseReleaseReports`, `releaseTransport`→`TransportReleaseReport[]`, `failedReleaseReports`, `releaseTransportRecursive` fail-fast), `src/adt/types.ts`, `src/handlers/transport.ts` (`summarizeRelease`). A blocked release returns HTTP 200 with `chkrun:status≠released` — surfaced as an error. Live-verified a4h 758; NW 7.5x rejects `newreleasejobs` pre-body (unchanged). Fixtures `tests/fixtures/xml/transport-release-report-*.xml`. |`

## Validation gate (every step)
`npm test` · `npm run typecheck` · `npm run lint` · `npm run validate:policy` · `npm run build` ·
`npm run check:sizes`. Tool-definition snapshots must stay **byte-identical** (no input-schema change).

## Live verification (Phase 6)
`TEST_TRANSPORT_RELEASE_TESTS=true npm run test:integration:slow -- tests/integration/transport-release.slow.integration.test.ts`
against a4h (extend it to assert the recursive result now carries a `released:true` report), plus a
throwaway `arc1-cli`/script create→release showing the surfaced report. NW 7.5x path stays skipped.
