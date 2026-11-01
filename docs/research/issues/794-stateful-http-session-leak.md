# Issue #794 — stateful HTTP sessions survive SAPWrite

**Issue:** [#794](https://github.com/arc-mcp/arc-1/issues/794).
**Fix:** [PR #803](https://github.com/arc-mcp/arc-1/pull/803).
**Investigation:** 2026-09-17, against ARC-1 1.2.0 at
`5bc5310bbd74cb43b962d4317e7f1a468ce4d472`.

## Root cause

The reporter used Basic authentication on SAP_BASIS 757 SP03. Each class write left one HTTPS
application session in SM04 until `rdisp/plugin_auto_logout`, even though SM12 held no lock.

At the reviewed revision, `AdtHttpClient.withStatefulSession()` cloned the client with
`sessionType: 'stateful'` and returned the callback without closing SAP's application context.
Repository `UNLOCK` and HTTP context teardown are separate operations. Both the normal and CSRF
request builders also omitted the header for a configured `stateless` session.

The fix keeps teardown in the owning wrapper's `finally`, using the existing isolated client's
authentication, cookies, proxy, and request handling. Cleanup failure must preserve the callback
result or exception because the write may already have persisted.

## SAP reference-client contract

Read-only inspection of SAP's `com.sap.adt.communication_3.58.1.jar`, bundled under
`~/DEV/arc-1-lsp/vendor/adt-ls/linux/gtk/x86_64/plugins/`, established the wire contract.

`IStatefulSystemSession` documents that clients must call `close()` before discarding a session.
`HttpStatefulSystemSession.CloseStatefulSessionJob` skips contexts without an id, changes the
session to `CLOSING`, dispatches the request below, and catches/logs close failures.
`IHttpSystemConnection.HTTP_SESSIONS_URI`, `getSessionTypeHeaderValue()`, and
`HttpRequestDispatcher` supply the endpoint, stateless transition, and context header.

```http
GET /sap/bc/adt/core/http/sessions
Accept: */*
sap-adt-purpose: close-session
sap-contextid: <context returned by SAP>
X-sap-adt-sessiontype: stateless
```

No public SAP Help page or applicable SAP Note for this internal exchange was found.
The shipped client contract and live observations below are the supporting evidence.

## Live reproduction and verification

The original investigation used A4H client 001, a disposable `$TMP` class
`ZCL_ARC794_260917`, public ARC-1 CLI handlers, and native SAP GUI SM04 inspection.

| SAP_BASIS 758 operation | Observed application sessions |
|---|---|
| Baseline | One owned GUI session. |
| Unfixed class create | One additional retained HTTPS row after the transient RFC row disappeared. |
| Unfixed update returning SAP HTTP 400 | A second retained HTTPS row, despite repository unlock. |
| Manual close without the stateless header | HTTP 200, but its context remained in SM04. |
| Identical close with the stateless header | Context disappeared after refresh; SAP returned `sap-contextid=0`. |
| Fixed public update, activation, failing update, and delete | No retained HTTPS row; the failing update preserved its original error. |

The retained rows pointed to `/sap/bc/adt/oo/classes/ZCL_ARC794_260917`.
The SAP session cookie did not rotate during the close probe. Post-delete read returned 404.

On SAP_BASIS 750 SP02, public create/update/activate/delete passed and the production session
wrapper returned with `sap-contextid=0`. Post-delete read returned 404. This system has the
documented `ZABAPFILESYSTEM_SESSION` / `abapfs_extensions` stateful-header backport installed.

An independent Claude review supplied by the maintainer additionally reports validation on 750,
758, and 816. It counted retained HTTP sessions through a temporary `TH_USER_LIST` console class:
the unfixed writes retained contexts on 758/816; the fixed success and failure paths did not after
settling. It also reproduced the stateless-header requirement on both releases. Its measured
cleanup cost was about 50 ms on 758/816 and 200 ms on 750. These additional results are attributed
to that review, not a second live run in this investigation.

All disposable objects were deleted and test sessions closed in both investigations. Credentials
and context values are excluded from repository artifacts.

## Compatibility and maintenance boundaries

SAP_BASIS 750 lacks the dedicated close resource (404). Its backport honors a stateless
`HEAD /sap/bc/adt/core/discovery`, but can return HTTP 400 after resetting `sap-contextid` to `0`.
That cookie confirms teardown; the fallback is used only after the dedicated resource returns 404.

Keep SAP's dedicated exchange as the primary path. A discovery transition also works in the
reported probes, but it is not the modern reference client's explicit close request. Closed,
unmerged [PR #676](https://github.com/arc-mcp/arc-1/pull/676) used discovery and parent-cookie merging;
the latter addresses a rotation issue not reproduced here.

Cleanup logs only the HTTP status and redacts context headers. The focused regression suite is
`tests/unit/adt/http-session.test.ts`; the PR carries current gate results.

The reporter's exact 757 SP03 system, BTP ABAP, S/4HANA Cloud, and principal propagation were not
live-tested. Unsupported or denied close requests remain best-effort: the callback result is
preserved, a warning is logged, and any surviving context remains subject to SAP's timeout.
