# Issue #728 — ATC `FINDING_STATS` is not completeness evidence

**Status:** Confirmed ARC-1 bug. Root cause validated against ARC-1 1.1.1, the Eclipse ADT client,
and live SAP_BASIS 758 and 750 systems on 2026-08-31.

## TL;DR

ARC-1 sums the three `FINDING_STATS` values returned by a synchronous ATC run and treats the total
as the exact number of findings that must appear in the worklist. Eclipse ADT identifies those
values as the run's error, warning, and information counters, but never uses their sum to decide
whether a worklist is complete. Customer evidence shows that the counters can differ from the
visible worklist findings (for example, `47` versus `22`, and `44` versus `0`). ARC-1 consequently
marks correct findings as `truncated` and incomplete and waits through an unnecessary ten-second
settle interval.

The reporter's diagnosis of the faulty equality is correct. The narrower claim that the triple is
the number of checks in the variant is not supported by the client contract: Eclipse names the
three components errors, warnings, and infos. They are informational run statistics, not an exact
worklist cardinality contract.

The supported completion signal on SAP_BASIS 758 is already exposed by the ADT API: create the run
with `clientWait=false`, follow the returned host-relative `Location`, and poll its
`application/vnd.sap.atc.run.v1+xml` representation until `status="Completed"`. SAP_BASIS 750
accepts the same query parameter but responds synchronously without a location, so the existing
full-worklist quiescence rule remains necessary as a release-adaptive fallback.

## Claim and observed impact

[Issue #728](https://github.com/arc-mcp/arc-1/issues/728) reports correct ATC findings but incorrect
metadata on SAP_BASIS 758 SP0005:

| Object / variant | Worklist findings | `FINDING_STATS` sum | Independent UI result |
|---|---:|---:|---:|
| `Z_OBJECT_A` / customer variant | 22 | 47 | 22 |
| `Z_OBJECT_B` / customer variant | 0 | 44 | 0 |
| `Z_OBJECT_B` / `SYNTAX_CHECK` | 0 | 2 | not supplied |

The reporter repeated the checks on ARC-1 1.1.1 with fresh worklist IDs and saw the same result.
This rules out stale worklists and confirms that the current release is affected.

Relevant `origin/main` code at `d0bafda9aef5`:

- `src/adt/atc.ts` `parseAtcFindingStats()` requires three non-negative integers and sums them.
- `parseAtcRunResult()` derives `truncated` from `findings.length < expectedFindingCount` and
  requires equality for `complete=true`.
- `runAtcCheck()` stops early on that invented equality; otherwise it waits for ten seconds of
  unchanged worklist XML.
- `AtcRunResult.infos` contains only worklist infos, so the run's `FINDING_STATS` data is not
  otherwise visible to callers.

The behavior entered in PR #703 and survived the polling correction in PR #710. PR #710 already
recorded a customer SAP_BASIS 758 run where `FINDING_STATS=82` and the persisted worklist contained
81 findings. No open issue or pull request duplicates #728.

## Contract research

### Eclipse ADT semantics

The locally installed Eclipse ADT 3.58.1 bundles are the closest executable reference for the
legacy `/sap/bc/adt/atc` API used by ARC-1. Decompilation with the JDK's `javap` establishes:

- `IAtcInfoTypeConstants.FINDING_STATISTICS` is the string `FINDING_STATS`.
- `AtcWorklistExecutionFinishedHandler.processRunInfo()` splits the description on commas and maps
  element 0 to `setNumberOfErrors`, element 1 to `setNumberOfWarnings`, and element 2 to
  `setNumberOfInfos`. It does not compare their sum with the worklist.
- `AtcWorklistBackendAccess` discovers `/atc/runs{?worklistId,clientWait}`. For normal asynchronous
  execution it posts with `clientWait=false`, reads the response `Location`, and polls that run.
- `AtcWorklistJobManager.handleAsyncAtcRunResponse()` treats `Running` as non-terminal and retrieves
  the worklist after the run reaches a terminal state.

SAP's official asynchronous ATC documentation describes the same high-level protocol: start with
`clientWait=false`, follow the status resource, and retrieve results after completion. See
[Running ATC Check Runs](https://github.com/SAP-docs/btp-cloud-platform/blob/main/docs/30-development/running-atc-check-runs-d8cec78.md).
SAP Help also describes the completed ADT result as containing all findings; it does not define
`FINDING_STATS` as an expected result count. See
[Launching ATC Check from Project Explorer](https://help.sap.com/docs/SAP_NETWEAVER_AS_ABAP_FOR_SOH_740/c238d694b825421f940829321ffa326a/71d7ffbc6c2f48e888e89f0100ac345e.html?version=7.40.25).

### Reference implementations

- Eclipse ADT preserves the statistics as UI counters and uses the asynchronous run state for
  lifecycle completion.
- `abap-adt-api` passes the run infos through as data and does not turn their sum into a worklist
  completeness condition.
- The local `adt-ls` sources and the surveyed MCP ADT reference repositories have no competing ATC
  worklist implementation that supports ARC-1's equality rule.

No relevant SAP Note was found. The defect is in ARC-1's interpretation of a successful response,
not in an SAP correction instruction.

## Live validation

The checks used the repository's supported HTTP client with local test-system credentials. No SAP
development object was written or changed; ATC created its normal ephemeral run/worklist records.

### SAP_BASIS 758 (A4H)

Posting `/sap/bc/adt/atc/runs?worklistId=<id>&clientWait=false` returned:

- HTTP `201`
- an empty body
- `Location: /sap/bc/adt/atc/runs/<run-id>`

Polling that canonical host-relative URL with `Accept: application/vnd.sap.atc.run.v1+xml` could
start at `status="Not Yet Started"`, then returned `status="Running"` through the named phases, including `Link to Worklist` and
`Create Display Load`, followed by `status="Completed"` and links to the result and worklist.
The completed worklist then contained `objectSetIsComplete="true"` and the requested processed
object. A clean `SYNTAX_CHECK` run completed in about five seconds, without the current extra
ten-second quiet wait.

The exact customer count mismatch could not be reproduced on the available A4H object: the current
1.1.1 path returned a clean, internally matching zero-finding result. That does not invalidate the
bug: the issue supplies repeated fresh 758 captures, and PR #710 independently recorded an 82/81
mismatch. The live run instead validates the terminal protocol that removes the faulty dependency.

### SAP_BASIS 750 (NPL)

The same `clientWait=false` request returned HTTP `200`, no `Location`, and the legacy synchronous
`<worklistRun>` body with `FINDING_STATS`. The worklist shape can still lack processed objects.
Therefore the fix must not require the asynchronous status resource: synchronous/no-location
responses retain the existing ten-second full-response settlement fallback and fail closed when
the worklist lacks structural evidence.

## Root cause

ARC-1 inferred an exact-cardinality contract that SAP does not provide:

1. The run returns informational severity counters.
2. ARC-1 renames their sum `expectedFindingCount`.
3. The parser calls a worklist truncated whenever its finding array is shorter than that sum.
4. The completeness predicate requires equality, even after SAP has completed the run and the
   worklist contains the requested processed object.
5. The poller consequently waits for a value that may never equal the informational counters.

The fix is not to choose a different arithmetic interpretation of the three values. Completeness
must be based on lifecycle and worklist structure; the severity counters can remain visible as
informational metadata only.

## Recommended fix and affected files

1. In `src/adt/atc.ts`, request runs with `clientWait=false`. If SAP returns a canonical
   host-relative `/sap/bc/adt/atc/runs/…` location, poll it using its exact media type until
   `Completed`, then fetch the worklist. Reject unsafe locations and return explicit incomplete
   evidence on timeout or a non-success terminal state.
2. Preserve the synchronous/no-location path for older systems and use the existing full-worklist
   quiescence rule there.
3. Parse `FINDING_STATS` into named `{ errors, warnings, infos, total }` informational metadata.
   Keep `expectedFindingCount` as a deprecated compatibility alias for `total`, but remove it from
   `truncated`, polling termination, and completeness decisions.
4. Require terminal evidence plus the existing worklist structural checks (matching ID,
   `objectSetIsComplete=true`, one valid objects container, at least one processed object, and no
   malformed object or priority rows). `truncated` must not be synthesized from `FINDING_STATS`.
5. Add captured run-status fixtures and regression tests for the reported count mismatch, the 758
   asynchronous protocol, unsafe locations, timeouts/failures, and the 750 fallback.
6. Update `AGENTS.md`, `docs/dev-guide.md`, and `docs_page/tools.md` to state the actual contract.

No tool input schema changes are needed. The structured response additions are backward-compatible;
the existing `expectedFindingCount` field remains available but is explicitly informational.

## Out of scope

- Do not infer a truncation cap from `maximumVerdicts`; live 758 evidence shows SAP can return more
  than the requested 100 verdicts.
- Do not remove structural fail-closed checks. A completed run with no processed object must not be
  reported as a clean check.
- Do not replace the legacy settle rule with `objectSetIsComplete`; live 758 evidence already showed
  a worklist growing after that flag became true.
- Do not release-gate by `SAP_BASIS`. The HTTP status and presence of a safe `Location` advertise
  the supported path directly.

## Paste-able GitHub reply

```markdown
Confirmed on 1.1.1: this is an ARC-1 completeness bug.

The exact faulty condition is the equality with the summed `FINDING_STATS` triple. Eclipse ADT
maps those three values to error/warning/info counters and does not use their sum as the expected
number of visible worklist findings. Your repeated 47/22 and 44/0 captures therefore represent a
valid case that ARC-1 currently misclassifies. The narrower interpretation as “number of checks in
the variant” is not what Eclipse calls the values, but that does not change the bug: they are
informational counters, not worklist-completeness evidence.

I also verified the proper lifecycle on SAP_BASIS 758: posting the run with `clientWait=false`
returns a run-status `Location`; polling it reaches `status="Completed"` only after the worklist and
display-load phases complete. SAP_BASIS 750 responds synchronously without a location, so it needs
the existing quiet-worklist fallback.

The fix will adopt that release-adaptive protocol, expose the named severity statistics as
informational data, and remove them from `truncated`, polling, and `complete`. Existing structural
checks stay fail-closed, and regression coverage will include your mismatched-count case.
```

**Recommendation:** implement the lifecycle-based fix and close #728 through the resulting PR.
