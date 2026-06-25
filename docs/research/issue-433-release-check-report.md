# Issue #433 item 1 — Surface the transport release-check report

**Date:** 2026-06-25
**Source issue:** [#433](https://github.com/marianfoo/arc-1/issues/433) (srahemi) — item 1 "Surfacing Release Check Reports (High Priority)"
**Goal:** `SAPTransport action=release`/`release_recursive` currently discards the response body of the
`newreleasejobs` POST and reports a flat `"Released transport request: <id>"`. Parse and surface the
`chkrun` release report so an agent knows *whether the release actually succeeded* and *why it was
blocked* (ATC errors, locks) instead of trusting a misleading HTTP 200.

## The blind spot (why HTTP 200 ≠ released)

A blocked release returns **HTTP 200** with a report whose `chkrun:status` is **not** `"released"`
(e.g. `abortrelapifail`). The current code only checks for an HTTP error, so a blocked release is
reported to the agent as a success. This is the core bug, not just a missing-detail nicety.

## Verified ADT contract (LIVE on a4h — S/4HANA 2023, SAP_BASIS 758)

`POST /sap/bc/adt/cts/transportrequests/{id}/newreleasejobs` → **200**,
`Content-Type: application/vnd.sap.adt.transportorganizer.v1+xml`.

Captured live 2026-06-25 (two throwaway local requests, released with `Accept: application/*` and with
`Accept: application/vnd.sap.adt.transportorganizer.v1+xml` — **identical bodies**, so the server
ignores Accept here and the current organizer Accept needs no change). Real success body saved to
`tests/fixtures/xml/transport-release-report-success.xml`:

```xml
<tm:root tm:useraction="newreleasejobs" tm:number="A4HK906303" xmlns:tm="...">
  <atom:link href=".../A4HK906303/displayatcfindings" rel=".../displayatcfindings" title="Diplay ATC Findings"/>
  <tm:releasereports>
    <chkrun:checkReport chkrun:reporter="transportrelease"
      chkrun:triggeringUri="/sap/bc/adt/cts/transportrequests/A4HK906303"
      chkrun:status="released"
      chkrun:statusText="Transport request/task A4HK906303 was successfully released"
      xmlns:chkrun="http://www.sap.com/adt/checkrun"/>
  </tm:releasereports>
</tm:root>
```

Shape:
- `tm:releasereports` wraps **0..N** `chkrun:checkReport`.
- Each `checkReport` carries `@reporter`, `@triggeringUri`, `@status`, `@statusText`.
- **On success** the `checkReport` is self-closing — no message list.
- **On failure** it nests `chkrun:checkMessageList > chkrun:checkMessage` with `@uri`, `@type`
  (severity code: `E`/`W`/`I`/`S`/…), `@shortText`, and a nested `atom:link` (longtext) child the parser
  ignores. **Real a4h 758 capture** (releasing an empty/unclassified task — a genuine `abortrelapifail`):
  `tests/fixtures/xml/transport-release-report-blocked.xml`.
- Root also has `@releasetimestamp`, `@number`, and an `atom:link rel=".../displayatcfindings"` —
  a ready pointer for the ATC follow-up, not needed for this change.

### Parser mapping (ARC-1 uses fast-xml-parser with `removeNSPrefix: true`)

Namespaces are stripped, attrs prefixed `@_`: `chkrun:checkReport` → node `checkReport`;
`chkrun:status` → `@_status`; `chkrun:checkMessage` → `checkMessage`; `@_type`/`@_shortText`/`@_uri`.
`findDeepNodes(parsed, 'checkReport')` + `findDeepNodes(report, 'checkMessage')` is the idiom, matching
the existing precedent in `parseSyntaxCheckResult` (`src/adt/devtools.ts`, which already parses
`checkMessage` `@_type`/`@_shortText`/`@_uri` and the `#start=LINE,COL` fragment + the `E→error,
W→warning` severity map).

## How others call it

- **abap-adt-api** (`marcellourbani/abap-adt-api` `src/api/transports.ts`) — the lib the issue cites.
  `transportRelease(h, transportNumber, ignoreLocks=false, IgnoreATC=false)` POSTs to
  `/sap/bc/adt/cts/transportrequests/{n}/{action}` with `Accept: application/*`, where `action` is
  `relObjigchkatc` (ignore ATC) / `relwithignlock` (ignore locks) / `newreleasejobs` (default). Parses
  `tm:releasereports > chkrun:checkReport` → `TransportReleaseReport[]`:
  `{ "chkrun:reporter", "chkrun:triggeringUri", "chkrun:status": "released"|"abortrelapifail",
  "chkrun:statusText", messages: [{ "chkrun:uri", "chkrun:type": SAPRC, "chkrun:shortText" }] }`.
- **Eclipse ADT** (`~/DEV/arc-1-eclipse-adt/api/14-transports-cts.md`) explicitly lists
  *"Improve release job parsing and status reporting"* as an enhancement area — confirms the gap.
- **adt-ls** (`~/DEV/arc-1-lsp`) and `~/DEV/mcp-abap-adt*` — no release tool; nothing to compare.

## Per-release behavior

- **a4h 758 / a4h-2025 816** — returns the report (verified on 758; 816 shares the same TM stack).
- **NW 7.50/7.51 (npl)** — `newreleasejobs` is rejected outright (*"user action newreleasejobs is not
  supported"*, HTTP 4xx) **before** any body — see `tests/integration/transport-release.slow.integration.test.ts`
  (`isUnsupportedBackend` 400/405/501 → skip) and `docs/integration-test-skips.md`. So on 7.5x release
  throws as today; the new parsing never runs. **Graceful-degradation requirement:** an empty/unparseable
  200 body must yield `[]` reports and preserve today's plain success message (the existing unit mocks
  release with an empty body — they must stay green).

## Affected ARC-1 files

| File | Change |
|------|--------|
| `src/adt/types.ts` | New `TransportReleaseReport` + `TransportReleaseMessage` interfaces (near `TransportRequest`). |
| `src/adt/transport.ts` | `releaseTransport` returns `TransportReleaseReport[]` (was `void`); add `parseReleaseReports(xml)`; `releaseTransportRecursive` collects reports per released id → return `{ released, reports }` (or per-id map). |
| `src/handlers/transport.ts` | `release`/`release_recursive` cases: inspect reports; if any `status !== 'released'` → `errorResult` with reporter + messages (the "why blocked" path, even though HTTP was 200); else concise success (+ statusText). Graceful when reports `[]`. |
| `tests/unit/adt/transport.test.ts` | Parser unit tests vs both fixtures; assert `releaseTransport` returns parsed reports; keep URL/Accept/empty-body tests green. |
| `tests/unit/handlers/transport.test.ts` | Handler tests: success report → success text; blocked report (status≠released) → `isError` + messages; empty body → success (existing). |
| `tests/fixtures/xml/transport-release-report-{success,blocked}.xml` | Added (above). |
| `docs/dev-guide.md` | Update the SAPTransport release row with the report-parsing note. |

**Not touched:** input schema (`schemas.ts`/`tools.ts`) — no new params, so the tool-definition
snapshots stay byte-identical (this is an OUTPUT change). `src/authz/policy.ts` — release stays
`transports` scope. The `ignoreLocks`/`ignoreATC` overrides (`relwithignlock`/`relObjigchkatc`) are the
issue's explicit **follow-up** and are **out of scope** here (would add input params + the 7.5x gate);
the report this change surfaces is the prerequisite for them.

## Live finding (2026-06-25) — recursive release & "unclassified" tasks

Releasing a **task** on its own that is empty/"unclassified" returns HTTP 200 with
`status="abortrelapifail"`, message *"Task <id> is unclassified (it cannot be released)"* — but
releasing the **parent request** then succeeds (`status="released"`) and folds the task in (captured
live: task `A4HK906310` → abortrelapifail, parent `A4HK906309` → released). The original
"tasks-first, then parent" recursion only worked because it ignored the task-release response.

**Consequence:** a fail-fast on a blocked *task* release (the plan's first design) is WRONG — it aborts
the normal empty-task case. Corrected design: task releases are **best-effort** (a benignly-failed task
is just omitted from `released`, never fatal); the **parent request release is authoritative** (SAP only
releases a request once all its tasks are released, so its report is the real outcome) and is what
`releaseTransportRecursive` returns as `reports`. A genuine blocker still surfaces — the parent release
fails and its report explains why.

## Open questions / decisions for the plan

1. **Recursive return shape.** Keep `{ released: string[] }` and add `reports: Record<id, TransportReleaseReport[]>`, or a flat `reports: TransportReleaseReport[]`. Leaning per-id map so a partial failure points at the offending task. A failed task should abort the recursion (don't release the parent on top of a failed task).
2. **Success verbosity.** On clean success, keep the short line (token-lean per AGENTS.md #3) and append `statusText` only if it adds info; surface full structured JSON only when there are messages / non-released status.
