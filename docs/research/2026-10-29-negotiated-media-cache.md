# Negotiated media types belong to one resource

Tracking: [#1133](https://github.com/arc-mcp/arc-1/issues/1133), fix
[#1126](https://github.com/arc-mcp/arc-1/pull/1126). Contributor implementation retained.

## Cause and scope

After a successful 406/415 retry, the HTTP client reused the negotiated Accept or Content-Type
for the resource and all descendants. Object metadata types could therefore override source,
structure or version media types. Single-target pooled transports retain this state across calls.

The lookup now uses the exact normalized path. Query, fragment and trailing-slash normalization,
explicit caller headers, discovery matching, retry limits and stateful cache copies are unchanged.
The #907 legacy 400 fallback remains uncached; #996 CSRF/legacy recovery remains intact.
This does not implement the unsupported VARIANTS endpoint tracked by #1125.

## Deterministic evidence

Compared with main `721755d51b9fa955becc50673f420eb3916c69f9`:

- The contributor's Accept regression fails on main and passes with the fix.
- The expanded tests produce 12 failures with main's HTTP implementation restored and pass with
  the fix. They cover Accept and Content-Type isolation, child discovery, collection-to-object
  discovery, independent child entries, stateful copies and pooled client reuse. Additional controls
  preserve path normalization, explicit overrides, failed-retry behavior and per-user separation.
- Full suite: 10,315 tests passed in 375 files on Node 24.11.1/macOS. Focused transport/#907
  checks passed (293 tests); additional collection and #996 checks passed (32 tests).
- Typecheck, Biome, policy validation, build and size/schema budgets passed. Biome reports two
  existing informational style suggestions outside this change. Tool-definition fixtures unchanged.
- Claude Code 2.1.308 / `claude-opus-5-5`, maximum effort, reviewed the plan and final patch and
  found no production correctness or regression issue. Its final test suggestion was applied:
  child discovery now distinguishes a cached wildcard from an uncached default. All 22 affected
  tests and typecheck passed after that adjustment; main still produces 12 failures.

An earlier full run passed 10,312 tests and timed out after 10 seconds in the untouched OIDC
metadata challenge test. All seven tests in that file passed in isolation; the subsequent full run
passed without changing assertions, adding retries or extending timeouts. The timeout's cause is
unresolved; the first full run overlapped a focused test process on the same host.

## Native read verification

Built ARC-1 revision: `5b40c9eda4104100445cae68fa70b8ce33cb2993` (1.9.0 package version).
Run: 2026-10-29, starting 15:37 UTC / 16:37 Europe/Berlin. Later changes add tests, documentation
and the file-size ratchet only; production TypeScript is unchanged from this revision.

A local script imported the built `dist/adt/client.js` and used its HTTP client for GETs only.
HTTPS on port 443, client 001, Basic authentication, TLS verification enabled. Undici diagnostic
channels passively recorded method/path, media headers and response status; no response was
injected and no endpoint was fabricated. No SAP objects were created or modified.

Each system read `/sap/bc/adt/system/components` to establish SAP_BASIS, then requested
`/sap/bc/adt/oo/classes/cl_abap_structdescr` with `Accept: application/xml`, followed by the same
metadata with `?version=active`, `/source/main` and `/objectstructure`, without explicit Accept.

| System | SAP_BASIS | Initial metadata and retry | Cache and follow-up reads |
| --- | --- | --- | --- |
| a4h.marianzeis.de | 758 SP02 | XML → 406; `*/*` retry → 200 | Actual cache contains `accept: '*/*'`; all three follow-ups send `*/*` and return 200 in one attempt |
| npl.marianzeis.de | 750 SP02 | XML → 200; no negotiation | No negotiated entry; all follow-ups return 200 |
| a4h-2025.marianzeis.de | 816 SP01 | XML → 406; `*/*` retry → 200 | Actual cache contains `accept: '*/*'`; all three follow-ups send `*/*` and return 200 in one attempt |

**Limits:** the successful native fallback is wildcard, identical to the child default, so this
proves native negotiation/cache insertion and successful child reads but cannot distinguish the
old inheritance from the fix on the wire. Deterministic tests prove that distinction for non-wildcard
Accept and Content-Type entries. No native 415 write negotiation, 740 SP04, BTP ABAP Environment
or principal-propagation route was exercised; pooled coverage uses a local synthetic proxy.

Earlier exploratory probes with a deliberately unsupported vendor Accept returned 406 twice on
758/816 (no cached result); 750 accepted it directly. An initial 758 component lookup hit a network
error. Program-objectstructure probes returned 422 on 758/816 and 404 on 750; these are separate
endpoint results, not evidence of negotiated cache reuse. No assertions were relaxed to hide them.

Roadmap checked at start and finish: no roadmap impact.
