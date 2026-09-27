# SAP 816 integration → E2E session failures

## Confirmed observations

The September 22–26 CI review counted five failures among fifteen E2E jobs directly
after integration, versus none among eight after E2E. These are observations from
that window, not a failure-rate estimate or proof of causation. Failures also occurred
on a test-only branch. The initial failing package LOCK did not involve #853's code.
Historical example: [run 36270329685](https://github.com/arc-mcp/arc-1/actions/runs/36270329685).
The failing server target was SAP_BASIS 816, not the separate 758 system.

On September 26 UTC (September 27 local), a local integration → E2E sequence on
816 observed GET `/sap/bc/adt/core/discovery` HTTP 400 without a usable CSRF token,
failed stateful close, and subsequent write failures. Fourteen failed GET probes
occurred from 22:28:58 to 22:29:57 UTC. This was **not isolated**: #857's CI integration
ran 22:23:15–22:29:11 and its E2E ran 22:29:14–22:36:23. No causal claim about ordering
can be made from this local run. It confirms that the failure was observed outside
GitHub's runner and through the target's HTTPS route.

A second sequence ran integration 22:37:29–22:42:09 and immediately started E2E,
which finished at 22:47:04 UTC: **227 integration passed / 89 skipped**, then
**142 E2E passed / 4 skipped**. An observation-only wrapper labeled cookie/token
values with process-local numbers (no values saved): all 142 CSRF HEAD probes
returned 400 and all 142 GET fallbacks returned 200. No failing bootstrap occurred
in that trace, so it cannot determine the failure mechanism. The first E2E run had
13 failures / 129 passes / 4 skips. Passing the second run is not a runtime fix. #859's CI integration started at
22:45:54, so the later part of that successful E2E also overlapped another client.

The overlapping #857 integration job independently failed two existing argument-
normalization cases with PUT/UNLOCK/close HTTP 400 around 22:29:03–22:29:05, within
the local failure window. Its later E2E passed. This broadens the affected clients
and operations; it does not identify what triggered the shared failure window.

The local integration run had a separate fixture failure: four-letter TEST_RUN_ID
made the BDEF-extension table name `ZARC1_BX_CSRFJHR3B` 18 characters (SAP limit 16).
The shorter prefix preserves the run ID and uniqueness suffix within the limit.

The patch exposes session failures rather than skipping them and records secret-free
CSRF probe outcomes at debug level. E2E's file sink retains every probe. Cookie
presence is not evidence of a valid context, and HEAD 400 alone is not a terminal failure.

## Hypotheses and next discriminating evidence

SAP documents that CSRF validity depends on the security session on newer releases
([ABAP Platform: CSRF Protection](https://help.sap.com/docs/ABAP_PLATFORM_NEW/753088fc00704d0a80e7fbd6803c8adb/5574ed6c93654ee4999b4d07cdda532c.html)).
[Gateway's CSRF guidance](https://help.sap.com/docs/SAP_NETWEAVER_740/68bf513362174d54b58cddec28794093/b35c22518bc72214e10000000a44176d.html)
also describes cookie binding and HTTP 403 on failed validation. Our failed discovery
GETs returned **400**, so that contract does not establish a token-validation failure.
Stateful context expiry, backend resource pressure and client context reuse remain
hypotheses needing discriminating evidence.

Read-only inspection of existing 816 ICM/worker traces found unrelated outbound TLS
errors and generic context messages, but no proven match to these failed requests.
Do not change trust stores, session limits or CI timing on that basis. A controlled
reproduction should correlate probe/mutation/close results with SAP session and lock
state. No arbitrary cooldown or automatic destructive replay is justified.
