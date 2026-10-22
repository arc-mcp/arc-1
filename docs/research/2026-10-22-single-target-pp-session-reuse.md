# Single-target PP session reuse (#1085)

The repeated-login bug is confirmed. On main `2d097d31`, each PP tool call creates a fresh
HTTP cookie jar. A regression test using separate MCP server instances and a real loopback
Connectivity proxy receives four logins for four reads; the fix receives one.

The reported SAP session-limit failure remains an inference. [SAP Note 2760552](https://me.sap.com/notes/2760552)
describes suppressed session creation after the unused-session limit is reached. Neither our
test nor the reporter's evidence includes SM05 suppression records from the failure window.

## Implementation and review

[PR #1086](https://github.com/arc-mcp/arc-1/pull/1086) supplied the initial implementation.
The reviewed version reuses only the exact Cloud Connector PP JWT and route, for at most ten
minutes or credential expiry. It keeps at most 500 transports and fresh object/package caches
for every call. Destination resolution is still invoked before selecting a transport; the SAP
SDK can cache that lookup. Other authentication modes and multi-target routes remain unchanged.

Claude Code Opus 5.5 Max reviewed the plan. Follow-up changes restrict eligibility, handle
out-of-order expiry, discard inherited application-context cookies when opening a new write,
and add a credential-free `transportReuse` audit field. The implementation adds no retries.
Revocation limits and shared-session reset behavior are documented in the security guide.

## Live BTP qualification

Candidate `185c98e4`, Node 24.19.0, one disposable CF app, XSUAA authentication and single-target
Cloud Connector PP to A4H client 001; SAP_BASIS 758 SP0002. Calls used the MCP SDK against the
app through a local CF SSH tunnel. Writes were restricted to disposable `$TMP` objects;
transport, Git, SQL and data-preview permissions stayed disabled.

| Check | Observed result |
|---|---|
| 12 sequential and 3 concurrent program reads | All succeeded; the initial audit sample reported one new transport and 16 reuses, including two system reads |
| Class and DDLS create → update → activate → read | Both succeeded; changed source read back and activation reported active |
| Two simultaneous class updates under one user | Both succeeded, followed by activation and read-back |
| Refresh the XSUAA token | Five reads succeeded; the changed credential selected a new transport |
| Reuse the original token after ten minutes | Five reads and another class lifecycle succeeded; audit reported a replacement transport at 21:54:14 UTC |
| Idle for about 3 minutes 48 seconds | Subsequent reads and writes succeeded; SAP-side session expiry was not independently inspected |

The first CSRF HEAD probe returned 400; the existing GET fallback returned 200 without an
application context. A HEAD 400 alone therefore does not establish the reported failure.
Deletion of all four fixture names was followed by a SAPRead 404.
The temporary CF app and role collection were removed, and the test app paused for capacity
was restarted and returned healthy. In total, 72 calls succeeded and five expected cleanup reads
returned 404. Transport audit states do not count SAP security sessions.

The [reporter's test of `b1a0720e`](https://github.com/arc-mcp/arc-1/pull/1086#issuecomment-6351784010)
also passed: 33 tool calls across two short runs on the affected deployment. In its debug run,
only the first of 235 PP requests lacked cookies; both stateful closes succeeded.

## Limits and follow-up

- No deliberate session exhaustion, SAP user lock, or termination of other users' sessions.
- Identity isolation, credential-expiry rollover, and an in-flight write crossing renewal
  have automated coverage. Two distinct SAP users and those expiry/in-flight cases were not
  exercised against SAP in this run.
- SM05 suppression records, configured session limits/timeouts and the reporter's SAP_BASIS
  release remain needed to establish the cause of the original 400 responses.
- Other PP modes and multi-target reuse remain roadmap OPS-06 work.
