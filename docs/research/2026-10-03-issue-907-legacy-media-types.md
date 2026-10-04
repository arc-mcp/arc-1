# Issue #907: legacy repository media types

## Root cause

[Issue #907](https://github.com/arc-mcp/arc-1/issues/907): on SAP_BASIS 740 SP04, ADT discovery
lists no repository collections, so ARC-1 sends wildcard media types. Class metadata GETs reject
`Accept: */*` with HTTP 400 `ExceptionContentHandlerNotFound`, outside the existing 406/415 retry.
This blocks real-package resolution before class update, method editing, delete, and activation.
The package gate must continue to fail closed; locking and package configuration are not the cause.

The reporter also observed class/program create POSTs rejecting `Content-Type: application/*`.
Their empty-body replays reach XML validation with the unversioned vendor types:
`application/vnd.sap.adt.oo.classes+xml` and `application/vnd.sap.adt.programs.programs+xml`.
Program/interface metadata accept `*/*`; interface creates accept `application/*`.
The full structured error XML was supplied only for the class GET. The issue identifies the POST
error as the same exception, but its exact XML and successful creates still need 740 verification.

## Newer releases

Probes on 2026-10-03 via the local TypeScript client, HTTPS port 443, Basic authentication, client
001. Standard objects were read; empty create bodies tested handler selection without creating objects.

| Request | NPL 750 SP02 | A4H 758 SP02 |
|---|---|---|
| Class metadata, `Accept: */*` | 200 (v2) | 200 (v4) |
| Class or program metadata, unversioned Accept | 200 (v2) | 406 `ExceptionResourceNotAcceptable` |
| Class `/source/main`, unversioned class Accept | 200 | 406 |
| Class or program create, unversioned Content-Type, empty body | 400 `ExceptionInvalidData` (type accepted) | same |

## Decision

- Retry instead of changing the default: 758 rejects unversioned metadata, so a blanket default
  would break newer systems when discovery is missing.
- Retry only this structured 400, wildcard headers, and class metadata GETs or class/program
  collection POSTs (`src/adt/legacy-content-handler.ts`). Match the query-stripped negotiation key;
  preserve the original URL (including `corrNr`), body, identity, cookies, and CSRF token. Handler
  lookup rejects the media type before body processing, making this specific POST retry safe.
- Never cache the fallback. The header cache covers the URL subtree, so metadata types would leak
  into `/source/main`. The cost is one extra round trip per matching legacy request.

## Verification and gaps

Runtime commit `02d632866a2d7187082d0725294a3e9db049d0bf` (ARC-1 1.5.0, Node 22.21.1/macOS,
local `handleToolCall`, same connection/authentication route above) passed disposable `$TMP`
class/program/interface create, source read, activation, and deletion on both releases. Class update
and `edit_method` passed, with active-source read-back and no syntax errors. A separate NPL run with
empty discovery and ten locally injected legacy 400s passed the same lifecycle; fallback requests
reached real SAP. This is simulated 740 failure coverage against 750 handlers.

An initial NPL run stopped on a post-create metadata 404; a fresh client found and deleted the
fixture. That read failure was not diagnosed. Subsequent runs and cleanup used fresh-client
verification; final metadata GETs and repository searches confirmed all ten fixtures absent.

Review follow-up changes only rename the selector parameter and clarify comments; retry behavior
is unchanged. Unit regressions cover transport query preservation, bounded retries, source cache
isolation, unknown create outcomes, and allowed/denied/missing real-package metadata.

The actual 740 SP04 backend is unavailable; the reporter offered to test a patched build. Transported
writes have unit coverage only. BTP/principal propagation and external MCP-client execution were not
tested. The old backend's separate stateful-session enhancement prerequisite is unchanged.
