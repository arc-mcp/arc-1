# Identify outbound SAP requests (#796)

## Root cause and plan

The ADT transport sets no User-Agent, so direct undici fetches identify only as
`undici`. Ordinary calls and CSRF bootstrap construct headers separately; both
must use the same value, including stateful copies and Connectivity proxy calls.

## Implementation

One admin option (`SAP_USER_AGENT` / `--user-agent`) flows through server configuration,
AdtClient and both HTTP header builders. The default is `arc-1/<version>`; empty
uses that default. Overrides are trimmed printable ASCII, at most 256 characters.
Programmatic clients use the same validation. Stateful copies inherit the option.
The release-managed VERSION moved to `src/version.ts`, retaining the server export;
release-please now updates the new location. No runtime package-file lookup or
arbitrary-header facility was added.

Review: a product/version token follows [RFC 9110 §10.1.5](https://www.rfc-editor.org/rfc/rfc9110.html#section-10.1.5).
No hostname, SAP identity or MCP user data is added. This is an identification hint,
not authorization. SAP documents `%{user-agent}i` in
[ICM logging](https://help.sap.com/saphelp_em92/helpdata/en/48/442541e0804bb8e10000000a42189b/content.htm).
Roadmap checked: no existing idea is changed.

## Verification — 2026-09-27

A real local HTTP receiver confirms the default and override on ordinary reads,
CSRF bootstrap/403 refresh, stateful writes and close. Removing both header additions
makes the two wire cases fail with observed `undici`; configuration rejection and
precedence cases remain separate. Connectivity proxy forwarding is unit-tested.

All 7,299 unit tests plus typecheck/lint/policy/sizes/build/strict docs passed.
After the standalone-client assertion, the focused HTTP suite passed 193 tests.
Read-only SAP 758 and 816 checks accepted bootstrap and class reads with both
settings. ICM log configuration and live BTP proxy forwarding were not tested.

When this lands, allow release-please to regenerate #851 from main; its current
head still targets the old VERSION location. Reconcile the unreleased release notes
before publication. No roadmap impact.
