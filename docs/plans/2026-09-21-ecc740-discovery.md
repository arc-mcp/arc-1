# ECC 7.40 discovery compatibility — #817 / #828

## Root cause and correction

The reporter's SAP_BASIS 740 SP04 returns empty HTTP 200 HTML for unimplemented ADT paths.
Core discovery has no token; legacy `/sap/bc/adt/discovery` returns one. The previous client
only bootstrapped on core discovery, startup treated any successful GET as authentication
success, and CTS parsing turned an empty response into an empty list or missing request.

Keep HEAD core discovery as the fast path, retry GET where needed, and try legacy discovery
once for a missing endpoint or successful response without a usable token. Tokens on unsuccessful
responses are not accepted; authentication refusals remain blocking. Startup reuses bootstrap
and its actual endpoint, leaving inconclusive GET-only access non-blocking. Cookies, identity,
cancellation and request budgets stay in the existing HTTP client.

CTS list/get require a transport-organizer root. A fixed ARC-1 explanation uses the existing
`extraHint` field so minimal mode preserves the reason without exposing SAP bodies or private
request paths. Detailed mode de-duplicates it. Valid empty CTS trees and missing-ID behavior remain.
No second CTS API, configuration switch, endpoint cache or generic resolver was introduced.

## Live measurements — 2026-09-21

| System | `HEAD` core | `GET` core | `GET` legacy | bogus ADT path | CTS list root |
|---|---|---|---|---|---|
| 7.50 (NPL, client 001) | 400 + token | 200 + token, 132 B | 200 + token, 79 KB | 404 | `<tm:root>` |
| 7.58 SP02 (a4h, client 001) | 400 + token | 200 + token, 132 B | 200 + token, 293 KB | 404 | `<tm:root>` |
| 8.16 (a4h-2025, client 001) | 400 + token | 200 + token, 1.3 KB | 200 + token, 389 KB | 404 | `<tm:root>` |

All three tested installations returned HEAD 400 with a token. Requiring `response.ok` adds a
GET on that path; it avoids accepting tokens from authentication errors. Bootstrap can recur
after token/session refresh. These observations do not establish behavior for every installation.

Missing IDs returned 404 with `<exc:exception>` on 7.58/8.16 and HTTP 200 with the caller's full
`tm:root` list on 7.50; existing ID matching still reports not found. Built-client checks returned
1,017 / 14 / 7 transports and 6,646 / 7,492 / 26 where-used entries on 7.58 / 8.16 / 7.50, with
startup using core discovery. These counts reflect those particular scopes and data snapshots.
After the minimal-mode fix, read-only a4h controls again passed: core startup, five DSFD
`CALENDAR_OPERATION` references without fallback, and 68 own transports with matching read-back.
No SAP objects were changed; these are client/handler checks, not installed MCP client sessions.

## Regression evidence and limits

Loopback HTTP regressions reproduce the reported empty-200 sequence through the production client,
including session continuity, POST token use, bounded fallback, auth failures and aborts. The
minimal-mode list/get checks failed before the safe-hint correction and now verify the explanation
appears once in both modes without private body/path disclosure. The empty CTS body remains a
separate regression for the reported symptom; unsupported XML roots use the public dispatcher cases.

ECC 740 SP04 was unavailable for live verification. BTP Steampunk returned HTTP 503 HTML on every
probed path, so stricter token/status behavior there remains unverified. SAP's
[ADT backend guide](https://help.sap.com/doc/2e65ad9a26c84878b1413009f8ac07c3/201909.000/en-US/config_guide_system_backend_abap_development_tools.pdf)
documents both discovery resources, the older CTS prefix change, and data preview from 7.40 SP05.
Successful bootstrap therefore does not establish support for every tool on SP04.

Roadmap: no impact; ARCH-01 (general routing) and OPS-02 (deep health) remain separate work.
