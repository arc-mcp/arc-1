# SAP 816 integration → E2E session failures

## Resolution (2026-09-27, live on a4h-2025, SAP_BASIS 816)

**Cause.** Bursts of *new* HTTP security sessions for the test user make SAP drop freshly created
ones. A new stateful ADT context survives its first request (the CSRF HEAD, or the LOCK when a token
is already present) and returns `sap-contextid`; every later request into it — CSRF GET, PUT,
UNLOCK, close — gets ICF's HTML `400 Session not found` (the "Service cannot be reached" page).
Stateless requests keep working because Basic re-authenticates each one. ARC-1 surfaced this as
`No CSRF token in response (HTTP 400)` or as PUT/UNLOCK 400, plus `Failed to close stateful ADT session`.

ARC-1 produced the bursts itself: HTTP mode builds an MCP `Server` per request and `createServer`
built the shared-identity `AdtClient` inside it, so every tool call started with an empty cookie
jar — a new SAP logon, security session and CSRF round trip (more with parallel cold requests).
A CI E2E run opened ~277 security sessions (25–46 per minute; debug audit of
[run 36306257012](https://github.com/arc-mcp/arc-1/actions/runs/36306257012)); the lab repro opened
58 in 30 s immediately before failing. Integration mostly reuses one client per file (60 new
sessions over its ~6 min run).

**Evidence.**

- Discovery-only probes (no object writes) reproduced the exact signature. A prober opening 2 new
  sessions/s failed after 120 sessions in 60 s and then flapped; one opening ~4/s failed after 119.
  A gentle prober (1 context / 3 s) stayed clean for 4.5 min while a session that had hosted 60
  contexts expired and was reaped — long-lived sessions and their expiry are not the trigger.
- dpmon's session table showed the failed contexts still exist (all 3 requests reached them), so the
  missing piece is the security session they belong to, not the dispatcher session.
- Every window ends at the same phase of SAP's 60 s housekeeping (task-handler check at
  hh:mm:36.9 + ~21 s): all 8 CI windows (2026-09-21..26) and all lab windows recovered within
  ~2 s of it, so a window can last from under a second to a minute.
- Full sequence (`npm run test:integration` then `npm run test:e2e:full`, CI route over HTTP):
  integration passed; E2E failed 17 / passed 125. Snapshots every 20 s (dpmon session table,
  `sapcontrol EnqGetLockTable`): before the window 0–1 stateful sessions and 1–5 locks; during it up
  to 28 orphaned contexts and 9 ENQUEUE locks, released only by `rdisp/plugin_auto_logout` 2–3 min
  later — why cleanup of objects created in the window can fail too.
- Effective parameters (`sapcontrol ParameterValue`): `http/security_session_timeout=120`,
  `rdisp/plugin_auto_logout=120`, `rdisp/autothtime=60`, `http/security_context_cache_size=2500`,
  `rdisp/tm_max_no=1000`, `login/create_sso2_ticket=2`. No explicit session-count limit is set; the
  threshold is empirical (rate-dependent, ~120 new sessions per minute in the lab).

**Fix.** Build the default client once per process and pass it to the per-request factory
(`createServer` option `defaultClient`), as the semaphores already are. HTTP mode now behaves like
stdio: one SAP security session and CSRF token reused across tool calls. Per-user PP clients and
multi-target clients stay per request (roadmap OPS-06).

**Validation.** Unit test `reuses one provided default client across per-request HTTP servers` fails
without the fix. Live, the same integration → E2E sequence back to back (same user and HTTP route,
observation hook on undici's `undici:request:headers` channel counting `Set-Cookie: SAP_SESSIONID`):

| E2E phase | Before fix | With fix |
|---|---|---|
| New SAP security sessions | 157 | 13 |
| Stateful GET 400 / close 400 | 20 / 27 | 0 / 0 |
| Tests | 17 failed, 125 passed | 142 passed, 4 skipped |

Integration was identical in both runs (60 new sessions, 135 stateful contexts, only expected
business 400s).

**Open.** Failures (including two masked by the since-removed skip rule) appeared in 10 of 33 E2E
runs directly after integration and 0 of 11 after E2E (2026-09-21..27). Integration adds little
session churn and leaves no contexts or locks behind, so the ordering effect is not fully explained;
the fix removes the burst in either order.

## Earlier observations (2026-09-22..26)

Five historical CI failures followed integration; a test-only branch failed too, and the first
failing package LOCK did not involve #853's code. Example:
[run 36270329685](https://github.com/arc-mcp/arc-1/actions/runs/36270329685).

A local integration → E2E sequence on 816 failed GET `/sap/bc/adt/core/discovery` with 400 from
22:28:58 to 22:29:57 UTC while #857's CI integration overlapped; that job's PUT/UNLOCK/close also
failed at 22:29:03–05. A second sequence passed (227 integration / 142 E2E); its 142 CSRF HEADs
returned 400 and all GET fallbacks 200 — HEAD 400 alone is not a failure.

#860 stopped skipping LOCK/UNLOCK 400s as "backend instability" and added secret-free CSRF probe
audit events. It also shortened a BDEF-extension fixture name that exceeded 16 characters with a
four-letter run ID.

Ruled out: CSRF token-validation failure (that is HTTP 403), stale client contexts (every failing
context was brand new) and the unrelated outbound TLS errors in the ICM trace (Joule hub calls from
`/sap/bc/adt/aunit/dbtestdoubles/cds/testcases`).
