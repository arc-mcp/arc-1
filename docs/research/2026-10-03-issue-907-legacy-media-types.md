# Issue #907: legacy repository media types

## Root cause

[Issue #907](https://github.com/arc-mcp/arc-1/issues/907) supplies a captured
SAP_BASIS 740 SP04 `ExceptionContentHandlerNotFound` response and manual request
replays. That system advertises no repository media types in ADT discovery.
Class metadata GETs reject `Accept: */*`; class/program creates reject
`Content-Type: application/*`. Unversioned vendor types work in the reporter's
replays. The 740 system is not available in this test environment.

At base `4ad7d1659`, ARC-1 sends those wildcards without a matching discovery
entry. `resolveObjectPackage` reads class metadata before writes and activation,
so the error prevents the package gate from resolving the real package. The
gate must continue to fail closed. The HTTP negotiation branch handles 406/415,
but this backend reports 400. Locking and package configuration are not the cause.

## Live research before implementation

On 2026-10-03, tested through the local TypeScript client with Basic authentication:
NPL SAP_BASIS 750 SP02 and A4H SAP_BASIS 758 SP02. Standard class/program/interface
objects were only read. Empty create bodies were used to distinguish unsupported
media types from XML-body validation, without creating repository objects.

| Observation | NPL 750 | A4H 758 |
|---|---|---|
| Discovery MIME collections | 32 | 232 |
| Class metadata, wildcard Accept | 200, v2 | 200, v4 |
| Class metadata, unversioned Accept | 200, v2 | 406, not acceptable |
| Program metadata, unversioned Accept | 200, v2 | 406, not acceptable |
| Class/program create, unversioned Content-Type, empty body | 400 `ExceptionInvalidData` | 400 `ExceptionInvalidData` |

The empty-body create responses identify the expected XML root, confirming that
the content handler accepts the media type; they are not lifecycle tests.
The newer system's rejection rules out a blanket unversioned default. Neither
available system reproduces the 740 wildcard rejection naturally.

## Plan and review

1. Replay the reported structured 400 in regression tests through the HTTP client
   and tool dispatch, including package-denial cases.
2. Extend the existing bounded negotiation retry only for that exact exception,
   wildcard headers, and the reported operations: class metadata GET and
   class/program collection POST. Change only the rejected header.
3. Do not cache this legacy fallback in the existing subtree header cache:
   metadata media types must not leak into source reads, lock calls, or PUTs.
4. Verify modern discovery and explicit types remain unchanged, unrelated errors
   and operations are not retried, and a failed fallback cannot loop.
5. Test disposable class/program lifecycles on the available systems, including
   activation, source read-back, and cleanup. Record any injected failures
   separately from natural SAP behavior. Run repository checks and final review.

Plan review: reusing the negotiation branch preserves the original URL, body,
credentials, cookies, and CSRF handling. Exact exception/type/path conditions
avoid replaying unrelated mutations. No generic 400 retry, release-number guess,
package bypass, discovery-capability fabrication, or new configuration is needed.
The small compatibility selector stays separate from the already size-limited
HTTP transport; its integration is an explicit, small file-budget increase.

## Roadmap

Checked `docs_page/roadmap.md`. No roadmap impact: this corrects an existing
negotiation failure. ARCH-01's broader discovery-driven endpoint routing remains
separate and unchanged.
