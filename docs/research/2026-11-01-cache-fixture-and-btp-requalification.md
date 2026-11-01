# Cache fixture repair and current BTP qualification

**Current branch status:** [Integration after class PR #1146 merged](2026-11-01-bdef-post-class-merge.md) records the resolved main ancestry, new guard tests and current validation. Earlier results below remain historical.

The complete [repair CI run on `234c2b26d`](https://github.com/arc-mcp/arc-1/actions/runs/41302288215)
passed both on-prem BDEF integration cases, all three BDEF MCP cases, both Node
unit jobs, and the other build/static/security checks. E2E finished with **160
passed / 0 failed / 11 skipped**. Integration finished with **276 passed / 5 failed /
117 skipped**: four cache assertions and the existing where-used issue
[#1057](https://github.com/arc-mcp/arc-1/issues/1057). No unchanged retry was used.

## Resource-specific conditional reads

Read-only probes on the actual SAP_BASIS 816 backend reproduced the cache failures:
`ZCL_ARC1_TEST` and `CL_ABAP_CHAR_UTILITIES` source endpoints returned HTTP 200 with
the same ETag and source hash after receiving the original tag as `If-None-Match`.
This occurred through public HTTPS 443 and the configured CI direct HTTP route,
with both explicit active and omitted versions. These probes used the existing
local configured identity; its equality with the CI secret identity is not established.

Bare Undici fetch in four cache modes and low-level `undici.request` reproduced
the class response. Diagnostic-channel request observations confirmed the matching
conditional tag on the wire, including a low-level request without automatic cache
directives. The report `ZARC1_TEST_REPORT` returned HTTP 304 for its original raw
tag through the same ADT client. These observations establish a resource-dependent
behavior on this backend; they do not identify its SAP-internal cause, establish
HTTP standards compliance, or imply every class/release behaves alike.

The production cache correctly treats an HTTP 200 response as fresh data. This
repair changes only tests and documentation:

- Keep strict MISS → 304-backed HIT, body equality, invalidation, stats, SQLite
  persistence and public SAPRead cache-marker assertions on the existing persistent
  report fixture. Use explicit active reads and `extensions=none` for the handler
  checks.
- Keep class coverage with a separate real conditional-read test. It requires two
  HTTP GETs, a nonempty first ETag, and that exact tag on the second call. A 304 must
  produce a revalidated hit with the original body; a 200 must produce a miss with
  the returned body and matching stored body/tag. Other statuses fail.
- The existing unit regression supplies different old/new bodies and ETags to
  verify replacement on HTTP 200. Identical live bodies alone cannot prove that
  replacement occurred.
- Update the skip taxonomy for the report and separate class fixtures. The existing
  CI summary regex already recognizes both names; no skip rule was broadened.

The whole cache integration file now passes **15/15, zero skips**, on both 758
(direct HTTPS 443) and 816 (configured CI direct HTTP, local configured identity).
All **419 unit files / 11,321 tests** pass on Node 24.11.1 with four workers;
typecheck, lint, policy, build and size/schema gates pass. No where-used assertion,
fixture, timeout, polling or retry was changed. Fresh full CI is required on the
new commit; the old failed run is retained as evidence.

## BTP became available

After the earlier HTTP 503 observations, the service responded and normal browser
OAuth succeeded with the existing named-user SSO session. Current read-only tests
ran against SAP_BASIS **920** using the same production source as the reviewed
combined runtime:

- **2 BDEF cases passed**: repeated bounded summaries and independent positive
  authored-source verification. Both summaries honestly returned incomplete deadline
  coverage with zero identities; the independent sources call returned four
  identities and four authored bodies. No time/request/byte limit was changed.
- **5 class/interface cases passed**, including the standard class, interface,
  enhanced-class fixture and both selected/full source forms of the hook fixture.
  The hook source test verifies seven extends edges, three replacement edges and
  eight rendered source bodies. Unsupported interface results, incomplete summaries
  and source denials remain explicit rather than being treated as global absence.
- **2 FUNC/FUGR cases passed** through public read dispatch with read-only scopes.
  They preserve the legacy base and respect optional budgets. FUNC's provider was
  not advertised. FUGR's advertised identity relation returned zero identities;
  that does not establish absence. Its elements relation was not advertised on the
  units read, and sources stopped incomplete at the 20-send limit with three
  sources omitted. These cases do not claim positive plug-in discovery or execution.

That is **9 BTP cases passed / 0 failed / 0 skipped**, plus two on-prem cases in the
mixed BDEF invocation. These are direct HTTPS/OAuth checks, not deployed
CF/principal-propagation/Cloud Connector qualification. Positive interface
extensions, exhaustive indexes and runtime applicability remain unqualified.
Authentication callback tabs were closed; no SAP objects were created or changed.

## Review and provenance

Claude Code 2.1.308 reviewed an immutable tracked-file snapshot of the cache test
patch with Read/Grep/Glob only, no execution, edits, MCP or local credentials. It
found no test/runtime regression and one P3 stale skip-documentation entry. That
entry and the old E2E example were corrected; the summary script already supports
both fixture names. The reviewed test diff SHA-256 is recorded in the
[machine-readable evidence](2026-11-01-cache-fixture-and-btp-requalification.json)
and checked against the staged/committed test patch.

Production `src/` remains unchanged from `a2a86b74a`, `92ca5bb41` and `234c2b26d`:
`5f8058ccc1b685e0875113e5a9f820d99f47cb234d4f8f822a5475ab661cf664`.
The previous final runtime review and BDEF-assertion confirmation remain applicable.
A subsequent final confirmation found one P3 reporting overstatement about FUGR;
the prose and qualification limit now distinguish its advertised identity relation
from the unadvertised elements relation and incomplete source traversal. The
original raw observations remain unchanged.
Evidence retains statuses, source/ETag hashes and bounded provider metadata, without
credentials, tokens, raw ETags or ABAP source bodies. Wire `if-none-match` values in
the JSON are SHA-256 digests.

Checked `docs_page/roadmap.md` before and after this repair: **No roadmap impact**;
FEAT-03 enhancement authoring is unchanged. Class PR #1146 remains the merge
prerequisite. No PR was merged by this work; #1057 still needs separate investigation.
