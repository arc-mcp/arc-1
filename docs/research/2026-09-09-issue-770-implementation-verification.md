# Issue #770: implementation research and verification

DDIC follow-up: [TABL, DTEL and DOMA verification](2026-09-10-issue-770-ddic-verification.md) extends the original type contract described below.

Review follow-up: [assessment and fixes for Claude's 15 findings](2026-09-10-pr772-claude-review.md).

## Decision

Use native ADT object references for a bounded explicit selection, retain the
existing ATC lifecycle, reconcile requested-object coverage, and allow at most
one verification batch for unreported objects. The [reviewed plan](../plans/2026-09-09-atc-object-batches.md)
limits the initial feature to 20 entries and established object-root routes.

The [request](https://github.com/arc-mcp/arc-1/issues/770) describes checking 20
freshly activated objects and asks for multiple object references in one call.
[SAP Project Piper](https://github.com/SAP/jenkins-library/blob/dd557a0ddf8869501782f793a3a1aab99f125528/cmd/gctsExecuteABAPQualityChecks.go#L688)
also constructs a native reference list. SAP's separate
[public ATC API](https://github.com/SAP-docs/btp-cloud-platform/blob/6cbd4232017ff56c21ade983df9dfb66f83d6e85/docs/30-development/running-atc-check-runs-d8cec78.md)
is not needed to implement this selection change. Sources checked 2026-09-09.

## Options evaluated

Three rotated rounds on SAP_BASIS 758, checking the same five abapGit classes with
variant DEFAULT, produced these median wall-clock times. Finding multisets were
equal across strategies; this is a small local benchmark, not a general SLA.

| Option | Median | Assessment |
|---|---:|---|
| One native batch | 8.53 s | Recommended; shares run setup and lifecycle |
| Two single runs at a time, in waves | 17.11 s | Repeats setup; more SAP requests |
| Native chunks of 2/2/1 | 20.16 s | Extra worklists without benefit at this size |
| Sequential single calls | 31.19 s | Compatible baseline; largest repeated overhead |
| Cache variant lookup | About 0.4 s avoidable in the serial trial | Too little benefit to justify identity-scoped caching here |

Native batching was 3.66 times as fast as sequential execution in that five-object
comparison. It does not remove SAP check execution time or the older system's
required worklist settlement interval. A package run has broader scope than the
requested activation batch and is not an equivalent optimization.

## Repeat research before implementation

All runs used read-only safety settings and HTTPS endpoints on client 001.
ATC creates transient worklists/results but no repository edits were performed.

- **Clean plus nonexistent class, 758:** 8.31 s, zero findings, one reported
  object, and the old executor's `complete=true`. Missing-object coverage must
  therefore be checked separately from successful run completion.
- **Only nonexistent class, 758:** 1.88 s, zero objects and incomplete evidence.
  No further run is justified after this outcome.
- **Twenty classes, 758:** 16.48 s, 150 findings, 13 reported records, terminal
  completion. The same seven clean classes were again absent. Earlier experiments
  found that a native batch of only those seven returned all seven with zero
  findings. Later worklist reads, the alternate result resource and increasing
  `maximumVerdicts` from 100 to 1000 did not restore the missing records.
- **URI contract:** captures from 750, 758 and 816 use
  `/sap/bc/adt/atc/objects/R3TR/CLAS/<name>` in returned worklists, rather than the
  original `/sap/bc/adt/oo/classes/<name>` selection URI. Coverage validates the
  requested type/name and one of those corresponding URI forms.

The checked-in [coverage projection](../../tests/fixtures/atc-batch-758-coverage.json)
retains the 20 identities and observed counts for an offline regression. The
test reconstructs XML and synthetic findings from that projection; it is not
presented as a byte-for-byte SAP response. Full local experimental captures and
timing logs were retained outside the committed change to avoid shipping a large
set of redundant backend responses.

## Production implementation tested live

These calls passed through the real `handleToolCall`, input normalization, schema,
read-only safety gate, handler, executor, and SAP HTTP client. They did not replace
the request XML as the earlier research adapter did.

| System / selection | Time | Outcome |
|---|---:|---|
| SAP_BASIS 750 SP02, three classes | 12.19 s | Complete; 3 records / 3 findings; legacy settlement |
| SAP_BASIS 758 SP02, three classes | 9.84 s | Complete; 3 records / 14 findings; async completion |
| SAP_BASIS 816 SP01, three classes | 12.00 s | Complete; 3 records / 14 findings; async completion |
| 758, twenty classes | 23.21 s | Complete; 20 records / 150 findings; first run 13 records, one verification run 7 |
| 750, real plus nonexistent class | 22.24 s | Incomplete; real object's finding retained; absent object unknown |
| 758, clean plus nonexistent class | 7.34 s | Incomplete; clean class has zero, absent class has null count |
| 816, clean plus nonexistent class | 9.49 s | Same incomplete/unknown outcome |
| 758, ten mixed object types | 84.60 s | Incomplete; 5 identities reported, 5 remain unknown after one verification |

The 150 findings from the production 20-class run matched the preceding native
research run as a multiset of priority, check title, message, URI and line. Finding
ownership is taken from the enclosing object record, including class-include
locations. Existing single-object default responses were exercised successfully
on all three systems and retain their original fields.

The mixed selection reported PROG, FUGR, INTF, BDEF and CLAS. It did not report its
DDLS, DCLS, SRVB, SRVD and DDLX selections. This does not establish that those
objects are nonexistent or universally unsupported: check applicability, object
state and system variant behavior can matter. The implementation reports the
evidence gap and stops. A namespaced SAP class `/UI2/CL_JSON` likewise returned
no processed object; namespace encoding and reconciliation have unit coverage,
but that live run is not evidence of a successfully checked namespace object.

A final live rerun after the parsing-review fixes completed in **21.74 s**,
again covering 20 objects with 150 matching findings across two runs.

## Review findings and fixes

1. **False clean coverage from absent records:** explicit per-request coverage,
   nullable counts, incomplete default responses, bounded verification.
2. **Duplicate processed identities:** mark batch evidence incomplete; do not
   launch a follow-up run based on ambiguous first-run evidence.
3. **Orphan or malformed findings:** retain valid findings, but refuse complete
   batch evidence when ownership or finding structure is invalid. Existing
   single-object parsing behavior is preserved.
4. **Second-run failure/deadline:** preserve the first findings; use the original
   deadline and variant resolution, with no recursive retry. Both runs retain
   separate worklist metadata. No atomic source snapshot is claimed.
5. **Cancellation:** explicitly forward the MCP request's cancellation signal
   into batch execution and every SAP request.
6. **Ambiguous inputs and routing:** reject empty/oversized arrays, unknown item
   properties, competing selectors, unsupported actions and types needing
   parent/group or DDIC-subtype resolution. Normalize aliases and names before
   deduplication; validate names, encode URI components and escape XML attributes.

The new unit tests cover these findings, no-progress verification, explicit and
unconfirmed variants, partial failed runs, namespace identities, wrong returned
identities, 750 settlement across two worklists, read-only authorization, action
denial and the 20-class capture projection. Seven schema snapshots were reviewed;
only the ATC description and `objects` property changed. Hyperfocused mode stayed
unchanged. All single/package ATC regression tests pass.

## Completed checks and limits

- Full unit suite: **5,912 tests passed across 198 files**.
- TypeScript checks for production, scripts and tests; production build; Biome;
  authorization policy validation; file-size and tool-schema budgets: passed.
- Documentation/schema parity, strict-schema parity and multi-target regression
  suites are included in the full unit run.
- Schema addition: approximately 547 wire bytes in the default tool set. The
  existing 50 kB read-only / 72 kB full-access wire ceilings remain unchanged.
  Deliberate small token and line-budget increases keep the schema inline.

The 816 target is on-premises, **not a BTP ABAP tenant**. No live BTP certification,
large/concurrent-user benchmark or arbitrary object-type coverage is claimed.
Twenty selected objects bounds selection size, not every possible ATC response
size. Run cancellation/deadline limits ARC-1's waiting; it does not promise to
cancel an already-started SAP job. Remaining unreported objects require caller
investigation of object state and check applicability, not automatic retry storms.
