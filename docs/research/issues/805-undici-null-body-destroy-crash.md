# Issue #805 — proxy response disposal can terminate the process

**Status:** Confirmed ARC-1 1.2.0 regression; narrow fix implemented and validated on 2026-09-17.
**Issue:** [arc-mcp/arc-1#805](https://github.com/arc-mcp/arc-1/issues/805).
**Baseline:** `cfd399d2480b0d99baf87ccf3b10e1685ae9cd46` (also affected).
**Plan:** [safe proxy body disposal](../../plans/2026-09-17-issue-805-proxy-body-disposal.md).

## Summary

The report is correct. The BTP Connectivity adapter destroys an unread Undici `BodyReadable`
without an error listener for HTTP 204/205/304. Undici can then emit `UND_ERR_ABORTED`
asynchronously, after the adapter has returned. The unhandled stream event terminates Node.

SAP correctly returns 304 for an unchanged conditional source read. Caching triggers the faulty
cleanup, but is not itself defective. This is not a SAP-release-specific problem.

The implemented fix is one private helper that attaches an error listener before intentional
body destruction. Four existing cleanup paths use it. Connection ownership, original errors,
response limits, cache behavior, and public APIs remain unchanged.

The first investigation favored `dump()` for null responses. The second pass revised that choice:
draining waits for an unfinished 205 body; a listener before the existing `destroy()` preserves
immediate disposal and also covers cancellation before the first streaming read.

## Report and regression history

The reporter observed seven exits across two Cloud Foundry landscapes (SAP_BASIS 7.50 and ABAP
Platform 8.16) after upgrading to 1.2.0. Both use BTP Connectivity/Cloud Connector and source
caching. The reported stack points to `connectivityProxyResponse()` destroying a null-status
response body, followed by `UND_ERR_ABORTED` and process exit 1.

Issue and repository searches found no duplicate or existing fix at investigation time. There
were no issue comments or linked PRs before this work. The related history is:

| Version/history | Proxy behavior |
|---|---|
| 0.9.14 | Drains with `.text()`, but constructing `Response('', {status:304})` throws a caught request error. |
| PR #440 / 0.9.17 through 1.1.2 | Drains, then uses `Response(null, ...)` for null-body statuses. |
| PR #739 / 1.2.0 | Response-budget refactor replaces that drain with bare `body.destroy()`. |
| Baseline `cfd399d2` | Null-status and encoding branches remain affected; a later headers-only path already attaches a disposal listener. |

The npm `arc-1@1.2.0` tarball identifies git head
[`f492794d`](https://github.com/arc-mcp/arc-1/commit/f492794ddcd82bfbb4a726091e01d57567380d5a).
Its compiled `dist/adt/bounded-response.js:198` contains the exact bare destruction reported in
the issue. PR #739 (`e0320b33`) introduced it.

## Root cause and second-pass findings

1. The cache stores source text and its ETag.
2. A later read sends `If-None-Match`; SAP returns 304 with no body bytes.
3. BTP proxy requests use `Client.request()` and manually convert its Node body into a Fetch
   `Response`. Direct-fetch requests do not use this adapter.
4. `destroy()` runs before that unread body emits `end` and before any reader installs an error
   listener. Undici synthesizes an abort error during this early destruction.
5. The asynchronous stream error has no owner, so Node terminates the process.

The installed and [version-pinned Undici implementation](https://github.com/nodejs/undici/blob/v8.10.2/lib/api/readable.js)
sets `RequestAbortedError` in `_destroy()` when no error was supplied and `endEmitted` is false.
For an unused body it delays the callback with `setImmediate`. This explains the successful
response conversion followed by a later failure. Node's
[error-event contract](https://nodejs.org/api/events.html#error-events) requires an error listener
to prevent an emitted stream error from becoming an uncaught exception.

The second pass also found:

- **Unexpected encoding:** the bounded-response guard destroys an unread body before returning
  its intended encoding error. It has the same disposal problem.
- **Early cancellation:** creating an async iterator does not install its error listener until
  `next()` starts. An already-aborted signal can enter cleanup before that first read. The old
  comment incorrectly assumed the iterator already owned the error event.
- **Headers-only responses:** this later path already observes disposal errors. Reusing that
  behavior in the other paths is sufficient; it does not need a new cleanup mechanism.
- **Why mocks missed it:** `tests/unit/adt/http.test.ts` supplies generic `Readable.from()` bodies,
  which do not synthesize Undici's early-destruction abort error.

The cache and `AdtClient` correctly retain ETags, send validators, and reuse cached source on
`notModified`. No changes are needed there.

## Evidence

### SAP contract and baseline reproduction

Read-only GETs of `/sap/bc/adt/programs/programs/rsparam/source/main` were repeated with the first
response's ETag as `If-None-Match`. Both status and body length were checked.

| System | First response | ETag | Conditional response |
|---|---|---|---|
| NW 7.50 SP02 | 200, 202 bytes | `201507241141090011` | 304, 0 bytes |
| S/4HANA 2023 / SAP_BASIS 758 | 200, 200 bytes | `202308011726360011` | 304, 0 bytes |
| ABAP Platform 2025 / 816 | 200, 200 bytes | `202508011238180011` | 304, 0 bytes |

The local Eclipse ADT reference
`~/DEV/arc-1-eclipse-adt/api/22-inactive-source-locks-and-conditional-reads.md` independently
documents conditional source reads. The inspected reference MCP clients do not implement this
same ETag/disposal path. No SAP correction is needed for the observed response.

Isolated Node 22.21.1 processes using Undici 8.10.2 passed real 750 and 816 conditional response
bodies into the **baseline HEAD adapter**, whose null-body branch matches the published 1.2.0
branch. Both returned 304 and then exited 1 with the reported `UND_ERR_ABORTED`. The runtime test
was not an execution of the published tarball or a deliberate restart of a shared CF app.

Local HTTP controls reproduced the same failure for 204, 205, and bounded encoded responses.
The second-pass early-cancellation case also returned the original cancellation error before
the unhandled disposal error terminated the isolated process.

### Candidate comparison

| Candidate | Evaluation |
|---|---|
| Listener before the existing `destroy()` | **Selected.** Handles the expected teardown event, preserves immediate disposal, and covers all four paths with one helper. |
| `await body.dump()` for null statuses | Passed ordinary real 304 responses, but remained pending for an unfinished local 205 response. Changes existing timing and needs a separate abrupt-disposal path anyway. |
| Restore `await body.text()` | Restores consumption, but adds unnecessary string conversion and the same completion wait. |
| Only close the client | Does not explicitly consume or destroy the response body. |
| Disable cache | Temporary mitigation for 304 only; does not address 204/205, encoding rejection, or early cancellation. |
| Process-wide exception recovery | Does not fix response ownership and would affect unrelated errors. Out of scope. |

### Patched live adapter

After rebuilding, the same read-only probe ran in both bounded and ordinary modes. Each mode
performed one initial read and three conditional reads on each system:

| System | Ordinary mode | Bounded mode |
|---|---|---|
| 750 | 200/202 bytes, then 3 × 304/0 bytes | Same; passed |
| 758 | 200/200 bytes, then 3 × 304/0 bytes | Same; passed |
| 816 | 200/200 bytes, then 3 × 304/0 bytes | Same; passed |

All 24 reads passed; ETags survived, clients closed, and no delayed body errors escaped. Probes
used HTTPS with certificate verification and did not print credentials or source contents.

**Boundary:** live probes connect directly to the test SAP endpoints, then pass real Undici
bodies through the patched proxy converter. Automated tests separately exercise `AdtHttpClient`
and `CachingLayer` through a loopback HTTP proxy. Neither is a full deployed CF/XSUAA/principal
propagation/Cloud Connector smoke. No shared deployment or SAP object was changed.

## Implementation and review

[`src/adt/bounded-response.ts`](../../../src/adt/bounded-response.ts) adds a nine-line private
`destroyProxyBody()` helper and calls it from null statuses, headers-only disposal, encoding
rejection, and streaming error/cancellation cleanup. It deliberately does not take ownership of
the client or replace the error already being returned to the caller.

The review confirmed:

- the listener is installed before destruction and stays on the discarded per-response body;
- no normal body-read error is converted into a successful result;
- null statuses remain `Response(null, ...)`, with headers preserved;
- null-response client closing remains in `AdtHttpClient.doProxyRequest()`;
- bounded streaming completion/cancellation retains its existing close/destroy ownership;
- the existing late-data cancellation regression stays covered;
- no dependency, setting, release gate, schema, or cache-format changes are introduced.

The plan was simplified before implementation: one helper, no drain branch, no new state
machine, no global error handler, and no changes outside transport cleanup and its evidence.

## Regression tests and validation

[`tests/unit/adt/proxy-response-lifecycle.test.ts`](../../../tests/unit/adt/proxy-response-lifecycle.test.ts)
uses actual Undici bodies and ephemeral HTTP servers, with no body-error listener supplied by
the tests. It waits for deferred events and verifies connections close before test cleanup.

Coverage includes 204/205/304 in both modes, ETag preservation, both Set-Cookie values surviving
into the next request, zero budget use for empty responses, repeated cache revalidation,
unfinished 205 and headers-only disposal, original encoding/abort errors, cancellation before
and during reading, consumer cancellation, successful non-empty responses, byte limits, and
genuine transport errors.

Before the source fix, the initial 13 regression assertions passed but Vitest correctly failed
with **16 unhandled errors**. After the fix and additional review coverage, all **17 regression
tests** passed without unhandled errors. Test review corrected two assumptions in the harness:
the public header record is not a multi-cookie API (cookie round-trip is the meaningful check),
and Undici's Promise-based `destroy()` delegates to its callback overload (raw spy count is not
a count of logical cleanup attempts).

Commands used:

```bash
npx vitest run tests/unit/adt/proxy-response-lifecycle.test.ts tests/unit/adt/bounded-response.test.ts tests/unit/adt/http.test.ts tests/unit/cache
npm test
npm run typecheck
npm run lint
npm run build
npm run validate:policy
npm run check:sizes
```

Final validation counts and review completion are recorded in the linked implementation plan.

## Next steps and deployment check

Merge the reviewed PR and prioritize a release/backport for affected 1.2.x deployments. The
release notes use the existing unreleased heading; versioning remains release-please's job.
Do not restore a workaround-disabled cache until the deployed build contains the fix.

On a canary BTP deployment, read one unchanged source repeatedly with caching enabled. Confirm
the later reads are cache-revalidated, the process instance remains stable, and no unhandled
abort appears in logs. This operational check remains for the deployment owner; the PR does
not publish a release or redeploy a shared app.

## Draft issue reply (not posted)

```markdown
Confirmed: the regression is in ARC-1's BTP response cleanup, not SAP's 304 response or the cache. Baseline code matching the 1.2.0 null-body branch reproduced the reported abort and process exit with real SAP 7.50 and 8.16 responses.

The fix observes the response body's error event before intentional destruction. It covers 204/205/304, encoding rejection, headers-only disposal, and cancellation before the first streaming read without changing cache behavior, response limits, or client ownership.

Real-Undici regression tests now cover these paths, and patched conditional reads passed on SAP 7.50, 7.58, and 8.16. A full deployed Cloud Connector smoke remains a deployment check. Until your deployment includes the fix, ARC1_CACHE=none mitigates the common 304 trigger but not the other affected cleanup paths.
```
