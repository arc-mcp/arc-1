# ECC 7.40 discovery compatibility (#817)

## Evidence and root cause

The reporter's SAP_BASIS 740 SP04 returns empty HTTP 200 HTML for unimplemented
ADT paths. `/sap/bc/adt/core/discovery` has no token; `/sap/bc/adt/discovery`
returns one. Current CSRF bootstrap tries HEAD then GET only on the core path.
Startup separately accepts any successful GET, while CTS list/get parse any body
and turn an empty response into an empty list or missing request.

SAP's [ADT backend configuration guide](https://help.sap.com/doc/2e65ad9a26c84878b1413009f8ac07c3/201909.000/en-US/config_guide_system_backend_abap_development_tools.pdf)
documents both discovery resources and notes the older CTS prefix change. It
lists data preview from 7.40 SP05. Thus neither a release-number guess nor a
working CSRF bootstrap establishes support for every tool on SP04.

## Plan

1. Reproduce the exact empty-200 response using a real local HTTP server and the
   production ADT client. Verify cookies, identity headers, token use on POST,
   bounded fallback, auth refusals, cancellation, and modern fast-path behavior.
2. Keep HEAD core discovery and the existing GET/503 compatibility behavior.
   Try legacy discovery once after a missing endpoint or successful response
   without a usable token. Never fall through authentication failures or network
   and server errors. Preserve the same authentication, cookies and request budget.
3. Reuse CSRF bootstrap for startup preflight. A usable token establishes that
   bootstrap worked; lack of one is inconclusive and non-blocking for GET reads.
   Keep 401/403 blocking and the existing cookie-file recovery exception. Return
   the actual endpoint for diagnostics. Do not claim write authorization.
4. Reject empty/non-CTS transport list/get documents with an explicit unavailable
   or unexpected-response error. Preserve a valid empty CTS tree and existing
   missing-ID behavior. Do not invent or automatically use a second CTS API.
5. Test modern SAP through HTTPS on a4h client 001 without object writes, run the
   focused and full regression suites, review failures and simplify the patch.
6. Open a new PR with reproduction, limits and roadmap assessment. No new setting,
   generic endpoint resolver, capability cache or public tool schema is needed.

## Limits and roadmap

The reported 740 SP04 target is not available locally. A local HTTP reproduction
is not live ECC coverage; modern live controls cannot prove all old-backend tools.
No roadmap impact after checking ARCH-01 and OPS-02: this bounded compatibility
fix does not implement general endpoint routing or a deep health endpoint.

## Implementation and verification

- Kept the existing HTTP client and CTS parser boundaries. Bootstrap now returns
  its successful endpoint, allowing startup to reuse it without another probe or
  an endpoint cache. The HTTP client stays shorter than on main; its size budget was lowered.
- The initial loopback regression suite failed nine cases before the fix. The
  final 17 cases use a real HTTP server and production client, including positive
  and inconclusive startup, authentication refusals, session continuity and aborts.
- Live SAP_BASIS 758 SP02 on a4h, client 001, HTTPS/Basic authentication exposed
  another compatibility case: HEAD core discovery returns HTTP 400 with a token,
  while GET returns HTTP 200. Added a same-path GET retry and a regression test;
  tokens attached to unsuccessful responses are never accepted as proof of success.
- Current production TypeScript passed live startup, POST-based where-used for
  DSFD CALENDAR_OPERATION (five results, no fallback), and CTS list/read-back
  (68 requests; selected request ID matched). No SAP objects were mutated. These
  are direct client/helper checks, not a deployed MCP client end-to-end run.
- Full unit suite: 6,910 tests across 225 files. Typecheck, build, lint, policy,
  file/schema budgets and docs build pass; lint reports two existing informational
  suggestions outside this patch. No integration/e2e suite was claimed as run.
- Reviewed authentication refusal and cookie-file recovery behavior, HTML login
  classification, caller cancellation, valid empty CTS documents and missing-ID
  matching. Updated the one BDEF mock that incorrectly supplied its CSRF token on
  a failed HTTP 400 response. No change to tool schemas, write gates or defaults.

## Independent revalidation (second reviewer, 2026-09-21)

Probed `/sap/bc/adt/core/discovery`, `/sap/bc/adt/discovery` and the CTS endpoints directly on all
three authorized test systems, then ran the built client against each:

| System | `HEAD` core | `GET` core | `GET` legacy | bogus ADT path | CTS list root |
|---|---|---|---|---|---|
| 7.50 (NPL, client 001) | 400 + token | 200 + token, 132 B | 200 + token, 79 KB | 404 | `<tm:root>` |
| 7.58 SP02 (a4h, client 001) | 400 + token | 200 + token, 132 B | 200 + token, 293 KB | 404 | `<tm:root>` |
| 8.16 (a4h-2025, client 001) | 400 + token | 200 + token, 1.3 KB | 200 + token, 389 KB | 404 | `<tm:root>` |

- **All three tested on-premise systems returned HEAD 400 with a token.** This does not establish
  behavior for every installation of those releases. Requiring `response.ok` adds one GET on
  that bootstrap path (132 B response body on 7.50/7.58, 1.3 KB on 8.16, plus headers). Bootstrap
  can run again after token/session refresh; it is not limited to once per client. The tradeoff
  is accepted here: the
  old code accepted a token from *any* status, including a 401, which masked the authentication
  failure behind a later CSRF error. The comment in `fetchCsrfToken` records both facts so the
  retry is not mistaken for dead code.
- **The CTS root guard holds on the three tested systems.** `tm:root` is the list root on 7.50/7.58/8.16.
  A missing request answers 404 with `<exc:exception>` on 7.58/8.16 and HTTP 200 with the caller's
  full `tm:root` list on 7.50 — the existing missing-ID match still returns "not found" there.
- Built client, end to end: `SAPTransport list` returns 1,017 / 14 / 7 requests on 7.58 / 8.16 /
  7.50; `SAPTransport get` returns the matching request on 7.58 and the expected refusals for a
  bogus ID on the others; the CSRF-dependent `SAPNavigate references` POST returns 6,646 / 7,492 /
  26 entries. Startup logs `endpoint: /sap/bc/adt/core/discovery` on all three.
- BTP Steampunk could not be probed — the ABAP instance answers HTTP 503 with an HTML page for
  every path, including discovery. HEAD-first order is preserved, but this does not validate the
  stricter token/status behavior on that unavailable target.
- **Initial limitation of the CTS guard, corrected below:** it throws `AdtApiError(..., 200, path)`, and
  `ARC1_MINIMAL_ERRORS` (the HTTP default) replaces every `AdtApiError` message with
  `ADT API error: status 200.` plus the request-ID hint. The false negative is gone in every mode —
  the call fails instead of returning an empty list — but the explanation only reaches stdio and
  trusted-debug deployments. Preserving an ARC-1-authored message through minimal mode needs a
  disclosure decision. The follow-up below addresses it through the existing safe-hint path.
- The reported ECC 740 SP04 system remains unavailable; its sequence is only reproduced against a
  local HTTP server. Reporter confirmation on that backend is still the missing evidence.

## Follow-up plan after review

1. Reproduce the lost CTS explanation through the production tool dispatcher and real loopback
   HTTP responses for both list/get and minimal/detailed error modes. Assert that unexpected
   response content and the private request path never become the client-facing hint.
2. Attach an ARC-1-authored constant explanation with the existing `AdtApiError.extraHint` field.
   Keep raw SAP response text suppressed in minimal mode. No new exception class, generic
   disclosure flag or dispatch special case is needed.
3. Keep the cookie fixture's flags and the existing token/status checks. Qualify the measured
   HEAD behavior in comments; retain successful HEAD as the fast path.
4. Run the regression before/after, the full local unit suite, static checks and live read-only
   controls. Recheck the roadmap; this remains a bounded #817 fix, separate from ARCH-01/OPS-02.

## Follow-up results

The two new minimal-mode list/get cases failed before the correction; all 21 loopback cases now
pass, including detailed-mode controls and assertions against private body/path disclosure.
The focused suites passed 301 tests; all 6,914 unit tests across 225 files passed. Typecheck,
build, lint (two existing informational notices), policy, file/schema budgets and docs build pass.

Live read-only controls on a4h/758 SP02, client 001, HTTPS/Basic passed again with the changed
source: startup at core discovery, five DSFD where-used entries without fallback, and 68 own
transports with matching get read-back. No new multi-release or installed-client coverage is
claimed. GitHub CI runs were intentionally excluded from this follow-up review.
