# PR #807: stateful Connectivity proxy client review

## Decision and evidence

Continue [PR #807](https://github.com/arc-mcp/arc-1/pull/807). Its reported live A/B
test is enough to justify a small transport fix: with unchanged ADT work and
authentication, a fresh proxy client per request failed, while one client per
stateful operation succeeded. This is contributor-reported evidence, not a live
reproduction by this review. The report includes save, inactive read, syntax
check, activation, ABAP Unit, and active read-back through BTP/Cloud Connector/PP.

The symptom is real, but the exact underlying cause remains unproven:

- [SAP Note 1301591](https://me.sap.com/notes/1301591) describes ICF HTTP 400
  session-not-found errors when reauthentication is invalid or identifies a
  different user. A context cookie alone does not establish valid authentication.
  The recommendation is to transmit valid logon data on each request. The note
  does **not** establish a requirement for one TCP connection.
- [SAP Web Dispatcher: ABAP load balancing](https://help.sap.com/docs/ABAP_PLATFORM_NEW/683d6a1797a34730a6e005d1e8de6f22/0328a906a7ed4ca998c12625703ec489.html)
  describes routing through external session identifiers or `sap-contextid`.
  Reusing a client cannot repair an incorrect backend route or identity mapping.
- [SAP Cloud SDK release notes](https://sap.github.io/cloud-sdk/docs/js/release-notes)
  document default keep-alive, destination-specific agents, and stronger
  subaccount isolation in 4.9.0. Reuse is normal practice, but a global pool keyed
  only by Connectivity host would require additional identity safeguards.
- [Undici Client](https://github.com/nodejs/undici/blob/main/docs/docs/api/Client.md)
  uses one connection at a time; server closes, idle expiry, and aborted bodies
  can still require a new connection. Client reuse is not hard socket pinning.
  [Dispatcher](https://github.com/nodejs/undici/blob/main/docs/docs/api/Dispatcher.md)
  supports request-level parser timeouts and separate graceful close/destruction.
  Those contracts were also checked in the installed Undici source and types.

The smallest appropriate boundary is the existing `withStatefulSession()` clone.
It already owns one operation, identity, cookie jar, and backend cleanup. Keep
authentication on every request; do not add a session manager, global pool,
settings, MCP arguments, retries of failed writes, or SAP security workarounds.
LLMs and humans continue using the existing tools and CLI. Setup is unchanged.

## Original patch review

The ownership design is sound: lazy client allocation; cleanup after SAP context
closure; operation-local state; dedicated clients for bounded and headers-only
responses. The latter can close/destroy their transport and must not own the
client used by subsequent ordinary requests. The #803 and #806 fixes remain
necessary and must be preserved.

One correctness gap: constructor timeouts depend on the **first** request. If a
normal request opens the client, a later `fetchTimeoutMs` override cannot disable
Undici's default 300-second parser timeouts. The configured longer timeout can
therefore be cut short. Move these overrides to `client.request()` so each request
keeps its own behavior. Current built-in CRUD callers do not request that longer
timeout; this is a transport-contract regression, not evidence of the reported
400's cause.

The five original tests mock every client with the same request/close functions.
They check allocation counts, but cannot establish actual keep-alive behavior,
socket closure, concurrent isolation, or survival after disposal of another
response. Replace them with focused real-Undici tests using the existing loopback
proxy harness, plus spies only where fault injection/timeout inspection requires
them.

## Implementation plan and review (before implementation)

1. Keep #807 and bring in current main by merge, preserving the contributor's
   commit. Add follow-up commits and push normally to the existing fork branch.
2. Retain the small session-owned client design. Explain why reuse outlives the
   final stateless SAP close request and why streaming/discard paths are separate.
3. Apply parser timeout overrides per request, retaining the existing abort
   signal and all default behavior for requests without an override.
4. Exercise actual sockets for LOCK/write/UNLOCK/context-close ordering,
   simultaneous sessions and PP identities, stateless behavior, dedicated
   streaming/discard ownership, null-body responses, cancellation, and failures.
   Cover cleanup error preservation and mixed timeout requests as well.
5. Verify regressions fail with the relevant fix disabled. Run focused and full
   unit suites, typecheck, lint, build, policy/schema/file budgets, and BTP
   descriptor validation. Run an existing disposable-object live CRUD lifecycle
   against the configured SAP test system if reachable.
6. Add a short unreleased operator note, record results and limitations here,
   review the complete diff, then update and push #807.

Plan review: accepted. No public API, security ceiling, credentials, or schema
changes are needed. Do not replace the response adapter or change body-disposal
semantics to retain sockets. Do not infer a universal SAP requirement from the
report. Real local sockets validate ARC-1's ownership behavior; a direct SAP test
validates backend compatibility. Neither substitutes for rerunning the reporter's
exact deployed BTP/Cloud Connector/PP route. No such writable PP test route is
configured in this workspace. Keep that deployment verification explicit.

## Validation

- Baseline on the contributor patch: 4 focused files, 218 tests passed.
- New timeout-order assertions failed on the contributor patch and passed with
  per-request parser overrides. Installed Undici reads request overrides before
  client defaults; no five-minute wall-clock timeout test was needed.
- With reuse temporarily disabled, the real LOCK/write/UNLOCK/close test failed:
  four sockets instead of one. Restoring reuse made it pass.
- Updated focused suite: 4 files, 226 tests passed. The real-Undici lifecycle
  file passed 20 consecutive runs, 24 tests per run (480 cases), without
  unhandled disposal errors or connections left open by successful cleanup.
- Full unit suite: 224 files, 6,892 tests passed.
- Typecheck, lint, build, policy validation, file/schema budgets, strict docs
  build, BTP descriptor validation (all five profiles), and diff checks passed.
  Lint reports three existing informational notices outside the changed files.
- Live a4h/client 001: the existing disposable program lifecycle passed create,
  read, update, read-back, activation, delete, and verification of deletion.
  Object `ZARC1_IT_IQWIQG0` was removed. Seven unrelated tests were excluded by
  the test-name filter, not skipped due to failed prerequisites.
- The local environment's old test URL was overridden with
  `https://a4h.marianzeis.de` and TLS verification enabled, following AGENTS.md.
  This is direct Basic-auth SAP validation, not a live Connectivity/PP test.

## Final review

The final production diff is 26 added / 4 removed lines in the existing HTTP
transport. It keeps the original ownership design and adds only per-request
timeout handling and explanatory comments. The five shared-mock tests are
replaced by 13 real-transport cases in the existing lifecycle test file.

The file-size gate exposed a pre-existing lack of headroom for this PR. Raise
only `src/adt/http.ts` from 1,550 to its measured 1,570 lines, with a comment.
Extracting a new pool/session abstraction solely to move these few lines would
add indirection without improving ownership. No schema or other budget changes.

Review of success, callback failure, cancellation, cleanup failure, dedicated
response ownership, identity/cookie isolation, and timeout transitions found no
remaining actionable issue in this scope. Parent/stateless behavior, auth headers,
write gates, response budgets, and #803/#806 cleanup contracts remain intact.

Remaining verification boundary: the contributor's exact CF/Cloud Connector/PP
deployment must still rerun its successful A/B scenario on the updated commit.
It is not available as a configured writable route here; no shared deployment
was changed. A continued HTTP 400 needs backend routing/reauthentication evidence,
not more connection flags or automatic replay of a partially completed write.
