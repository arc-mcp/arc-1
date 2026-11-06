# SAP 816 integration → E2E session failures

## Resolution (2026-09-27, live on a4h-2025, SAP_BASIS 816)

**Symptom.** A new stateful ADT context survives its first request (the CSRF HEAD, or the LOCK when
a token is already present) and returns `sap-contextid`; every later request into it — CSRF GET, PUT,
UNLOCK, close — gets ICF's HTML `400 Session not found` (the "Service cannot be reached" page).
Stateless requests keep working. ARC-1 surfaced this as `No CSRF token in response (HTTP 400)` or
PUT/UNLOCK 400, plus `Failed to close stateful ADT session`.

**Demonstrated trigger.** Bursts of new SAP logons by the test user (responses setting
`SAP_SESSIONID`); removing ARC-1's per-call logons removed the failures. **Leading explanation, not
proven inside SAP:** SAP drops freshly created HTTP security sessions under such bursts, orphaning
their contexts, while stateless requests simply re-authenticate. SM05 was not captured; the ICF 400
plus dpmon still listing the context support this reading but do not establish it.

ARC-1 produced the bursts itself: HTTP mode builds an MCP `Server` per request and `createServer`
built the shared-identity `AdtClient` inside it, so every tool call started with an empty cookie
jar — a new SAP logon and CSRF round trip (more with parallel cold requests). A CI E2E run made
~277 cold requests that start a logon (25–46 per minute; debug audit of
[run 36306257012](https://github.com/arc-mcp/arc-1/actions/runs/36306257012)); in the lab repro 58
responses set `SAP_SESSIONID` in the 30 s before failing. Integration mostly reuses one client per
file (60 such responses over its ~6 min run).

**Evidence.**

- Discovery-only probes (no object writes) reproduced the exact signature. A prober opening 2 new
  sessions/s failed after 120 sessions in 60 s and then flapped; one opening ~4/s failed after 119.
  A gentle prober (1 context / 3 s) stayed clean for 4.5 min while a session that had hosted 60
  contexts expired and was reaped — long-lived sessions and their expiry are not the trigger.
- dpmon's session table still listed the failed contexts (all 3 requests reached them), which points
  at the security session they belong to rather than the dispatcher session.
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

**Fix.** Reuse the shared identity's SAP transport (`AdtHttpClient`: login cookies, CSRF token)
across HTTP requests (`createServer` option `defaultHttp`), replacing it for new requests after
ten minutes. Each request still builds its own `AdtClient`, so its caches keep their
per-request lifetime: sharing the whole client (first revision of #871) let a structure replaced by
a transparent table between calls be written through `/ddic/structures/` (the TABL write-route cache
is removed in all modes by the separate #873), and it would have kept the 10-minute package-hierarchy cache
behind `SAP_ALLOWED_PACKAGES` subtree rules alive across HTTP requests.
Startup preflight/probe clients and parallel cold requests still log on separately, so this cuts
repeated logons rather than guaranteeing one session. Per-user PP clients and multi-target clients
stay per request (roadmap OPS-06).

**Validation.** `tests/unit/server/http-default-transport.test.ts` drives the real startup factory:
it fails on the base (no login reuse) and on the whole-client revision (stale TABL route), and passes
on the transport-only fix. Live, the same integration → E2E sequence back to back (same user and
HTTP route, observation hook on undici's `undici:request:headers` channel; it records cookie
presence only, so a renewal counts like a new session), run on the whole-client revision `238e301d`,
which established the benefit of transport reuse before the ten-minute renewal was added:

| E2E phase | Before fix | With fix |
|---|---|---|
| Responses setting `SAP_SESSIONID` | 157 | 13 |
| Stateful GET 400 / close 400 | 20 / 27 | 0 / 0 |
| Tests | 17 failed, 125 passed | 142 passed, 4 skipped |

Integration was identical in both runs (60 `SAP_SESSIONID` responses, 135 stateful contexts, only
expected business 400s).

**Open.** Failures (including two masked by the since-removed skip rule) appeared in 10 of 33 E2E
runs directly after integration and 0 of 11 after E2E (2026-09-21..27). Integration adds little
session churn and leaves no contexts or locks behind, so the ordering effect is not fully explained;
transport reuse reduces logon churn without fully explaining this ordering effect.

## Authentication and side-effect review (2026-09-28)

The independent live review reports that either `SAP_SESSIONID` or `MYSAPSSO2` alone authenticated
requests on 758/816 despite a Basic header naming a nonexistent user. This verifies cookie
precedence, **not** an actual password-change or account-lock test. It is consistent with
[SAP's security-session contract](https://help.sap.com/saphelp_gbt10/helpdata/en/c9/71e72f422b455993c47b132c408ef5/content.htm):
an existing session permits access without another logon. The measured 816 idle timeout and
ticket lifetime are system configuration, not product-wide guarantees. Operator consequences
and the retained credential-freshness risk are documented in
[R21](../security-model.md#r21-shared-login-credential-freshness).

The shared transport is replaced for new HTTP requests once it is ten minutes old, using
monotonic elapsed time. Already-created requests retain their transport, preserving active locks
and keeping late responses out of the replacement's jar. Factory regressions pause a read and a
PUT across rollover and verify those properties. Cookie-file tests verify both reload after a
file change and continued use of an unchanged ticket. Configured credentials are reloaded, not
revoked; no blanket ten-minute revocation or fixed logon-count guarantee follows.

The rotation follow-up was exercised live on SAP_BASIS 758 and 816 over public HTTPS on
2026-09-28, through the actual factory/dispatcher with real SAP HTTP calls. The harness advanced
the process's monotonic clock rather than waiting ten wall-clock minutes. A new request obtained
a different SAP session while an older request kept its original one. A temporary program update
held after LOCK completed PUT/UNLOCK across rollover; source readback matched, and deletion was
verified by HTTP 404 on both systems. No password or SAP-user lock was changed. This targeted
lifecycle check complements the earlier integration/E2E evidence; it is not a load test.

Other effects remain deliberately scoped:

- Only transport state is shared. Factory regressions check fresh TABL resolution and refusal
  after a package leaves the allowed subtree. PP requests neither inherit nor replace the shared
  login, and failed PP exchanges never fall back to it.
- A 401/CSRF/database-retry reset affects concurrent calls using the shared parent transport.
  Existing retries may recover; they do not guarantee success or exactly-once writes. Stateful
  children keep separate cookie maps for lock/save/unlock and close within the tool call.
- Same-host cookies from non-ADT SAP services also persist. Restricting collection to ADT URLs
  would change OData/FLP/plugin authentication and is not justified by a demonstrated defect.
  Cookie path/expiry handling remains a separate limitation; no hostile-service scenario was tested.
- MIME-negotiation entries live with their transport. Replacement ages them out for new requests,
  but running requests may retain them longer and there is no numeric capacity bound. Shared
  technical-user attribution relies on ARC-1's per-call audit, not distinct SAP login sessions.

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
