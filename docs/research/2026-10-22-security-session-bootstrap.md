# Cold SAP security-session bootstrap (#1042)

Parallel requests from a new HTTP client can each create an unused SAP security session.
[SAP Note 2760552](https://me.sap.com/notes/2760552) describes the per-user limit (default 100):
a session remains unused until its cookie is returned; exhaustion suppresses new sessions.
[1322944](https://me.sap.com/notes/1322944) documents cookie reuse. This explains the reported
MCP startup burst, but does not establish the cause of every `400 Session not found`.

The corrected [issue evidence](https://github.com/arc-mcp/arc-1/issues/1042) distinguishes MCP
startup from CLI: CLI authentication preflight already warms its client. SM05 suppressed-request
timestamps identify requests after exhaustion, not necessarily its cause.

The per-client gate admits one cold wire request. Its response stores cookies and any successful
CSRF token together before waiting callers proceed. A network failure hands ownership to one
survivor. Without a session cookie, only a successful response (2xx or 304) allows parallel operation;
an HTTP error leaves one next caller in charge of bootstrap. Existing
internal retries and standalone CSRF fetches use the same gate. Resets invalidate old response
cookies/tokens; an interrupted CSRF bootstrap fails instead of restoring stale authentication state.
An eligible 401 resets at the headers boundary, before a waiting caller can establish a new session.
Waiting callers retain their own cancellation/deadline and refresh the cookie/token pair before sending.

Offline reproduction issued four sessions for four baseline reads and one with the contributor's
initial fix. Added regressions cover its recovery gaps: failed owners, reset retries, stale responses,
direct CSRF, slow bodies, cancellation/deadlines, matching token/cookie pairs and independent clients.
The gate adds no requests or retries. Warm clients retain concurrency and shared-Basic rejection
controls remain unchanged.

This does not pool clients or identities, change session limits, repair orphan locks, or resolve the
separate 816 session incident. Existing Connectivity response buffering is unchanged. OPS-06 session
reuse and OPS-08 general queue/outage policy remain separate roadmap work.
