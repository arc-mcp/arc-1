# Issue #907: legacy repository media types

## Root cause

[Issue #907](https://github.com/arc-mcp/arc-1/issues/907) supplies a captured
SAP_BASIS 740 SP04 `ExceptionContentHandlerNotFound` response and manual request
replays. That system advertises no repository media types in ADT discovery.
Class metadata GETs reject `Accept: */*`; class/program creates reject
`Content-Type: application/*`. Unversioned vendor types work in the reporter's
replays. The 740 system is not available in this test environment.

At base `4ad7d165`, ARC-1 sends those wildcards without a matching discovery
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

## Implementation and automated verification

Runtime commit: `02d632866a2d7187082d0725294a3e9db049d0bf` (ARC-1 1.5.0).
The 28-line selector in `legacy-content-handler.ts` changes only Accept or
Content-Type for the verified request shapes. `http.ts` reuses its existing
one-retry branch and excludes these results from the subtree header cache.
The transport budget increases by exactly 12 lines; no refactor or public schema
change is introduced.

- Full suite: **7,793 tests across 255 files passed**, using
  `npm test -- --maxWorkers=2` (47.87 seconds, no skips).
- HTTP, legacy discovery, and new handler regression suites: **246 passed**.
  The new suite has 39 cases covering recovery, unchanged headers/body/URL,
  no retry for unrelated errors or endpoints, bounded retries, an unknown
  creation outcome after a fallback 500, and fail-closed package enforcement.
- Removing the HTTP fix fails 20 of those 39 cases. Allowing legacy results into
  the subtree cache fails the source/read-isolation regression. Both mutations
  were reverted and verified against the committed source.
- Typecheck, build, lint, policy validation, file/schema budgets, strict MkDocs,
  and diff checks passed. Lint retains two pre-existing informational suggestions.
- `npm audit --audit-level=high --omit=optional` still fails on the existing
  `node-forge` advisory `GHSA-86w9-cpqp-85rv`, reporting no fix available on
  2026-10-03. Dependency manifests and the audit gate are unchanged.

## Live lifecycle verification

All runs used commit `02d63286`, Node 22.21.1 on macOS, local `handleToolCall`
dispatch, HTTPS port 443, Basic authentication, client 001, and disposable `$TMP`
objects. Each run recorded a clean working tree and verified that the commit and
SHA-256 hashes of both runtime files were unchanged before/after testing.

| Run | Fixture suffix | Result |
|---|---|---|
| A4H 758 SP02, normal discovery | `MUSUA979` | Class, program, and interface create/source read/activate/delete passed; class update and `edit_method` passed; active source contained the edited method; syntax check had no errors. |
| NPL 750 SP02, normal discovery | `MUSUDGAS` | Same complete lifecycle passed. |
| NPL 750 SP02, empty discovery and injected legacy errors | `MUSUEDPZ` | Same lifecycle passed, recovering from ten injected structured 400 responses; fallback requests and subsequent operations reached real SAP. |

Names are `ZCL_ARC907_<suffix>`, `ZARC907_<suffix>`, and `ZIF_ARC907_<suffix>`.
The injected run intercepted only wildcard class metadata GETs and class/program
create POSTs locally. It did not send the rejected request to SAP, fabricate
successes, or bypass the package gate. This exercises the fallback against real
750 handlers, **not** the inaccessible 740 backend.

The first NPL run (`ZCL_ARC907_MUSUA8ZP`) stopped when an immediate metadata read
returned 404 after successful creation. A fresh client found the object; it was
then deleted and independently verified absent. The cause of that first read
was not diagnosed. The harness was corrected to verify writes and cleanup using
fresh clients. A final pass confirmed all ten fixture names absent through both
fresh metadata GETs (404) and repository searches (empty).

Remaining verification: the reporter's actual 740 SP04 system, transported writes,
BTP/principal propagation, and external MCP-client execution. No stateful-session
enhancement is installed or changed by this fix; the older backend's separate
locking prerequisite remains applicable.

## Final review

Reviewed the code, tests, plan, and SAP evidence after verification. No further
actionable findings. Modern discovery and successful wildcard requests retain
their original behavior. The compatibility path cannot bypass real-package
resolution, change the request target/body/identity, add a second negotiation
retry, or spread metadata types into source/action requests. The existing
dependency audit failure and unavailable 740 verification remain explicit limits.

## Roadmap

Checked `docs_page/roadmap.md`. No roadmap impact: this corrects an existing
negotiation failure. ARCH-01's broader discovery-driven endpoint routing remains
separate and unchanged.
