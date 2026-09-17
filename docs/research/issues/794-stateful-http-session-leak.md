# Issue #794 — stateful HTTP application sessions survive SAPWrite

**Status:** Fixed on `codex/fix-794-stateful-session-cleanup` and verified offline and live on
2026-09-17.

**Issue:** [#794](https://github.com/arc-mcp/arc-1/issues/794), opened by `lllxxy` on
2026-09-16 and labeled `bug`. The report uses ARC-1 1.2.0, Basic authentication, and SAP_BASIS 757
SP03. No comments, linked fix, or duplicate issue were present when checked.

**Fix:** [PR #803](https://github.com/arc-mcp/arc-1/pull/803).

**Reviewed base revision:** `5bc5310bbd74cb43b962d4317e7f1a468ce4d472` (ARC-1 1.2.0), which
matched `origin/main` before the investigation branch was created.

## TL;DR

The report is correct. `AdtHttpClient.withStatefulSession()` creates an isolated client that sends
`X-sap-adt-sessiontype: stateful`, but it simply discards that client after lock/modify/unlock. It
never closes the backend application context. SAP therefore retains one HTTPS application session
per write until `rdisp/plugin_auto_logout` reclaims it.

SAP's Eclipse ADT client closes such a context with a specific request on the same context:

```http
GET /sap/bc/adt/core/http/sessions
Accept: */*
sap-adt-purpose: close-session
sap-contextid: <context returned by SAP>
X-sap-adt-sessiontype: stateless
```

The reviewed ARC-1 base was missing the request, and its transport emitted the session-type header
only for `stateful` even though its `SessionType` type also declares `stateless`. A live probe showed that a
close request without the explicit stateless header returns HTTP 200 but itself remains in SM04;
the otherwise identical request with the header removes its context immediately.

The modern close resource is absent on SAP_BASIS 750. That release, with the documented
`abapfs_extensions` stateful-header backport installed, closes through a stateless discovery
transition instead: it returns HTTP 400 after setting `sap-contextid=0`. The implementation uses
that behavior only as a 404 fallback from the dedicated close resource.

## What the issue claims

The reporter observed a one-to-one relationship between completed class writes and retained HTTP
application sessions: six updates left six sessions and one create left another. Repository locks
were gone from SM12, ARC-1 had exited, and the sessions disappeared only after the configured plugin
auto-logout interval. Lowering `rdisp/plugin_auto_logout` from 1800 to 300 seconds shortened that
lifetime to about five minutes.

The report correctly separates two lifecycles:

- `UNLOCK` releases the repository enqueue lock.
- Closing the ADT stateful HTTP context releases the backend application session.

ARC-1 implements the first lifecycle but, at the reviewed revision, not the second.

## Live reproduction on SAP_BASIS 758

The reproduction used A4H client 001 and a disposable local class
`ZCL_ARC794_260917` in `$TMP`. SM04 was inspected through the native SAP GUI scripting bridge; ARC-1
calls used the public CLI and production handlers. Credentials and context values were not captured
in repository artifacts.

| Step | SM04 rows for the test user | Relevant observation |
|---|---:|---|
| Baseline | 1 | The owned GUI session only. |
| `SAPWrite create` with class source | 3 temporarily, then 2 durable | One HTTPS row remained; a short-lived RFC row disappeared normally. Last path was the class object. |
| `SAPWrite update` whose PUT returned SAP HTTP 400 | 3 durable | A second HTTPS row remained even though the write failed and ARC-1 unlocked in `finally`. |
| Manual official close request **without** the stateless header | 4 durable | HTTP 200, but the new SM04 row pointed to `/sap/bc/adt/core/http/sessions`. |
| Manual official close request **with** the stateless header | No new durable row | HTTP 200; the new context disappeared immediately after refresh. |

The retained rows were HTTPS application sessions owned by `MARIAN`. Example application info:

```text
R=3 P=/sap/bc/adt/oo/classes/ZCL_ARC794_260917
R=4 P=/sap/bc/adt/oo/classes/ZCL_ARC794_260917
```

The failed update is useful additional scope evidence: cleanup must be in the outer session
`finally`, not only on the successful write path.

The lock response's cookie names included `sap-contextid`, `sap-usercontext`, `MYSAPSSO2`, and the
system/client `SAP_SESSIONID`. The context id was 77 characters on this system. A successful close
returned `sap-contextid=0`; the SAP session cookie did not rotate during the probe.

### Post-fix product-path validation

The built fix was exercised through the public CLI and production handlers against the same class:

| Operation on SAP_BASIS 758 | Tool result | SM04 after refresh |
|---|---|---|
| Write active source back unchanged | `Successfully updated` | No HTTPS row; only GUI and a transient ADT RFC row. |
| Activate | `Successfully activated` | No HTTPS row. |
| Submit the known-invalid class comment | Expected SAP HTTP 400 preserved | No HTTPS row, proving cleanup on the callback-error path. |
| Delete | `Deleted` | No HTTPS row. |
| Read after delete | Expected 404 | Object confirmed absent. |

On SAP_BASIS 750 SP02, the same disposable class completed public create, update, activate, and
delete calls. A direct production-wrapper probe captured `sessionType=stateless` and
`sap-contextid=0` after return. The dedicated resource returned 404; the fallback transition reset
the context even though the old backend returned HTTP 400. The post-delete public read returned 404.
This system has the repository-documented `ZABAPFILESYSTEM_SESSION` enhancement installed; without
it, pre-7.51 HTTP writes fail before this cleanup lifecycle is relevant.

## SAP's reference-client contract

The active communication bundle in the read-only ADT language-server distribution was inspected:

```text
~/DEV/arc-1-lsp/vendor/adt-ls/linux/gtk/x86_64/plugins/
  com.sap.adt.communication_3.58.1.jar
```

This is implementation evidence from SAP's client, not copied source code.

### Public lifecycle contract

`IStatefulSystemSession` documentation says stateful connections are expensive, their count is
limited, and clients **must** call `close()` before making an instance eligible for garbage
collection. `close()` frees all associated resources. Dropping the client object is therefore not
a close operation.

### Exact close request

Decompilation of `HttpStatefulSystemSession.CloseStatefulSessionJob` establishes that Eclipse ADT:

1. skips the request only when there is no `sap-contextid`;
2. sends `GET` to `IHttpSystemConnection.HTTP_SESSIONS_URI`;
3. sets `Accept: */*` and `sap-adt-purpose: close-session`;
4. changes the session state from `OPEN` to `CLOSING` before dispatch;
5. catches/logs close failures rather than failing the already completed operation.

`IHttpSystemConnection` initializes `HTTP_SESSIONS_URI` to
`/sap/bc/adt/core/http/sessions`. `HttpStatefulSystemSession.getSessionTypeHeaderValue()` returns
`stateful` while open and `stateless` while closing. `HttpRequestDispatcher` sends both that value
as `x-sap-adt-sessiontype` and the recorded context as the `sap-contextid` header.

This exactly matches the live result: endpoint and purpose alone are insufficient; the transition
header is material.

No public SAP Help page or applicable SAP Note describing this internal ADT wire contract was found
through targeted searches. The shipped Eclipse API documentation, active bundle, and live backend
behavior provide mutually consistent primary evidence.

## Root cause in ARC-1

| Layer | Reviewed behavior | Consequence |
|---|---|---|
| Session wrapper | `src/adt/http.ts:293-305` creates a stateful clone and returns `fn(sessionClient)` directly. | The clone is discarded without any backend close request. |
| Request headers | `src/adt/http.ts:422-424` emits `X-sap-adt-sessiontype` only when the config equals `stateful`. | A configured `stateless` transition is silently omitted. |
| CSRF headers | `src/adt/http.ts:988-990` has the same one-sided condition. | The declared session type is inconsistently implemented across both request builders. |
| Cookie handling | `storeCookies()` retains `sap-contextid` in the isolated client's jar. | ARC-1 already has the identifier required to close the exact backend context. |
| CRUD callers | `safeUpdateSource()` and related helpers unlock in `finally` inside `withStatefulSession()`. | Enqueue cleanup works, but it cannot release the separate application session. |

The wrapper and omission date to the initial TypeScript implementation (`3b5fe6d5`, 2026-04-01).
Later session fixes addressed lock continuity and duplicate/stale cookies, but did not add the
backend close lifecycle.

## Prior related work

Closed PR [#676](https://github.com/arc-mcp/arc-1/pull/676) contained a never-merged commit named
`fix: release the stateful ADT session and keep a rotated cookie`. It sent a best-effort stateless
`HEAD` to ADT discovery and merged rotated cookies back into the parent. The PR bundled unrelated IDE
integration and was closed for later reconsideration.

That commit is useful historical confirmation that the missing lifecycle had been noticed, but it
should not be cherry-picked:

- it uses discovery rather than SAP's dedicated close-session resource and purpose header;
- it releases unconditionally rather than following the reference client's context-id guard;
- cookie merging addresses a separate hypothetical rotation concern that was not reproduced here;
- its tests assert only a stateless header, not the exact close URI, purpose, and context binding.

The current issue warrants a small standalone fix using the verified SAP contract.

The fr0ster comparison checkout centralizes stateful request headers and lock correlation, but the
reviewed code did not expose the dedicated close-session exchange. It is not independent evidence
for a solution.

## Fix options considered

### 1. Send a stateless request to discovery

This was the approach in closed PR #676. A transition request may release a context, but it is not
the current Eclipse ADT close contract and does not identify intent with `sap-adt-purpose`. Rejected
in favor of the exact endpoint verified above.

### 2. Add cleanup in every CRUD helper

This would duplicate lifecycle code across class, DDIC, RAP, server-driven, text-element, and future
write paths. It would be easy for one caller or error branch to omit. Rejected.

### 3. Close centrally in `withStatefulSession()`

Recommended. The wrapper owns the isolated client and is the single boundary shared by all current
stateful operations. In `finally`, close only when SAP supplied `sap-contextid`; switch the owned
client to `stateless`; send the dedicated GET with purpose and context headers; and treat close as
best-effort so cleanup failure cannot replace a successful result or the original write error.

Also make both header builders emit any configured session type, not only `stateful`. This is a
two-condition replacement at existing sites, not a new session abstraction.

### Implemented release adaptation

The dedicated request remains the primary path. If and only if it returns 404, ARC-1 sends a
stateless `HEAD /sap/bc/adt/core/discovery` through the same client. SAP_BASIS 750 returns 400 after
resetting the context cookie, so `sap-contextid=0` is treated as successful teardown. Other fallback
errors are logged once and remain best-effort. This narrowly preserves the oldest supported live
system without weakening the verified 757/758+ contract.

## Expected compatibility and failure semantics

- Existing lock/modify/unlock requests remain stateful and keep their current cookies, CSRF token,
  discovery map, semaphore, authentication, proxy, and retry behavior.
- The close request uses the same isolated client's authentication and cookies and therefore works
  for Basic, bearer, cookie, and principal-propagation configurations through existing transport
  code.
- If no stateful request established a `sap-contextid`, no close call is sent, matching Eclipse.
- SAP_BASIS 750 receives the stateless discovery transition only after the modern close endpoint
  proves absent with 404.
- A close failure is logged without context/cookie values and never masks the callback result or
  callback error, matching the reference client's best-effort lifecycle.
- No public tool schema, authorization surface, package gate, or SAP object contract changes.
- No server-wide session manager, background reaper, or cookie refactor is needed.

## Regression and live-validation results

The maintained HTTP-client suite now pins the exact successful request, direct stateless header
emission, callback-error cleanup, close-error isolation, no-context skip, and the 750 fallback's
404→400/reset sequence. The focused file passes 197 tests; the complete suite passes 219 files and
6,793 tests. Typecheck, build, lint, size checks, strict documentation build, touched-file Biome,
and diff checks pass. The reviewed size-budget increase keeps the lifecycle beside the transport
state it owns and avoids a one-feature adapter abstraction or a duplicated HTTP test harness.

Live validation covered public create/update/activate/delete and absence checks on 750 and 758. SM04
before the 758 fix showed one new retained HTTPS row per established context; the fixed success,
failure, and delete paths added none.

## Out of scope

- Changing SAP profile parameters or relying on a shorter auto-logout interval.
- Changing the repository `UNLOCK` sequence or lock-handle behavior.
- Solving unrelated IDE/debugger logout behavior discussed in PR #676.
- Persisting stateful contexts across ARC-1 processes.
- Broad cookie-jar semantics, session pooling, retries of a failed close, or a background reaper.

## Draft issue response

```text
Confirmed on current main and reproduced on SAP_BASIS 758.

ARC-1 correctly sent UNLOCK, but AdtHttpClient.withStatefulSession() discarded its isolated
stateful client without closing the backend HTTP application context. That left exactly one HTTPS
row in SM04 per stateful write until rdisp/plugin_auto_logout. The same leak occurred on a write
error after a context had been established.

SAP's Eclipse ADT client closes the context with GET /sap/bc/adt/core/http/sessions plus
sap-adt-purpose: close-session, the returned sap-contextid, and
X-sap-adt-sessiontype: stateless. A live probe verified that the stateless header is required.

The fix adds that best-effort close centrally in withStatefulSession(), including the error path,
without changing write/lock semantics or public schemas. SAP_BASIS 750 lacks the modern close
resource, so a 404-only stateless discovery fallback handles that release.

Verified live: public create/update/activate/delete on 758 left no HTTPS session in SM04, including
an intentionally failing update; 750 reset the context through its fallback. Both disposable test
classes were deleted and verified absent.
```
