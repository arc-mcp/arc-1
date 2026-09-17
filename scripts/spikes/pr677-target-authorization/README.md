# PR 677 live authorization acceptance harness

This is a research/test harness, not a shipped ARC-1 setting or deployment tool. It sends real
OAuth and mutation-free MCP requests to an explicitly selected HTTPS ARC-1 instance. It does
not create/delete services, roles, assignments, destinations, or SAP objects.

It never opens a browser. The operator/LLM uses the approved browser tools to open the emitted
authorization URL. Always start a fresh incognito window for the secondary test identity.
No access/refresh token, authorization code, binding credential, or SAP response body is printed.
Tokens stay in process memory. Stopping the process forgets them but **does not revoke** them.
Runtime HTTP/TLS debug, inspector, and TLS key logging options are rejected before loading
private input; provider `DEBUG` logging is disabled. Run this only in a trusted local Node runtime.
These checks reduce accidental disclosure; they are not a sandbox against a malicious runtime or
operator. Session labels remain reserved during pending login and callback token exchange.

Offline oracles run with `npm run test:target-auth:harness` in CI on Node 22 and 24. They cover
schema projection, safe diagnostics and label reservations; Biome and the file-size ratchet also
include this directory. This JavaScript harness is not covered by the TypeScript compiler.

## Start

1. Run `npm ci` and build ARC-1 with its locked, published `@arc-mcp/xsuaa-auth` 1.1.0 dependency.
   Select an isolated test endpoint with
   the expected mode and test destinations; do not point destructive role-edit testing at a
   production service.
2. Put the matching XSUAA binding credentials in an owner-only (`0600`) JSON file **outside the
   repository**. Accepts the credential object directly or `{ "credentials": { ... } }`. Required
   fields are `clientid`, `clientsecret`, `url`, `xsappname`, and `uaadomain`. Never paste values
   into a shell argument or LLM response.
3. Copy one scenario object from `scenarios.example.json` into a private `0600` JSON file outside
   the repository. Adjust targets/scopes to the actual fixture. Add `expectedIdentity.email`
   and, when relevant, `origin`/`logonName` privately: a mismatch stops execution tests, preventing
   an accidentally reused browser identity from being counted as the requested test user.
   Set `expect.schemaTargets` to the **complete granted-active target projection** from the
   operator-maintained destination fixture and expected grants. Successful strict scenarios
   require it, including `[]` for no granted active targets. Do not copy it from a server result.
   A nonempty expectation requires at least one operational tool; an empty/catalog-only response
   cannot satisfy that positive schema-projection scenario.
4. Start in a persistent PTY so JSON commands can be sent through stdin:

   ```bash
   node scripts/spikes/pr677-target-authorization/live-harness.mjs \
     --base-url https://YOUR-ISOLATED-APP.cfapps.YOUR-REGION.hana.ondemand.com/ \
     --credentials-file /private/tmp/arc1-test/credentials.json \
     --auth-module "$PWD/node_modules/@arc-mcp/xsuaa-auth/dist/index.js"
   ```

To capture an **already-created** service key without displaying its content, use:

```bash
node scripts/spikes/pr677-target-authorization/prepare-credentials.mjs \
  arc1-ta-677-xsuaa pr677-live-harness /tmp/arc1-pr677-private xsuaa-credentials.json
```

The helper only reads the selected key via CF CLI, disables CF trace for that subprocess,
requires a private output directory, and creates a new `0600` file without overwriting one.
It prints the saved path and field count, never credential values. It does not create service
keys or services; the operator owns that explicit setup step.

The callback listens only on `127.0.0.1`, on a random port by default. An individual pending
login expires after **60 minutes**, but the process remains available for another login. Use
`--login-timeout-minutes` (5–720) or `--port` when required. The candidate auth module must export
the accepted new contract; an old package cannot silently produce misleading evidence.

That 60-minute timeout is only the **local callback wait**, not the server's OAuth state lifetime.
The candidate callback proxy defaults to a 10-minute signed state lifetime once the authorization
URL is opened. Prepare the browser/operator first, then start and promptly complete sign-in.
If the server reports expired state, request a new `login` with a new label and open its new
authorization URL; do not replay the old callback or weaken state expiry for the test. A browser
blocking the loopback success page is a different issue: check whether `login_received` and
`scenario_complete` already arrived before retrying.

## JSON-line commands

```json
{"command":"login","label":"viewer100","scenario":"/private/tmp/arc1-test/viewer100.json"}
{"command":"status"}
{"command":"run","label":"viewer100"}
{"command":"refresh","label":"viewer100","nextLabel":"viewer100-refreshed","scenario":"/private/tmp/arc1-test/after-change.json"}
{"command":"run","label":"viewer100","scenario":"/private/tmp/arc1-test/old-token.json"}
{"command":"login","label":"viewer100-new-login","scenario":"/private/tmp/arc1-test/after-change.json","forceLogin":true}
{"command":"concurrent","labels":["viewer100","viewer100-new-login"]}
{"command":"exchange-user","label":"viewer100-new-login","nextLabel":"viewer100-exchanged"}
{"command":"client-credentials","label":"machine","scenario":"/private/tmp/arc1-test/machine.json"}
{"command":"import-token","label":"machine","file":"/private/tmp/arc1-test/machine-token.json","scenario":"/private/tmp/arc1-test/machine.json"}
{"command":"forget","label":"machine"}
{"command":"finish"}
```

`login` emits `authorization_required` with the public PKCE authorization URL. Open that URL
using browser tooling; the harness retains the PKCE verifier and validates the callback state.
Successful exchange automatically runs the chosen scenario. A browser success page only means
the token was received: consult `scenario_complete.failed` for the actual test outcome.

`refresh` preserves the old access-token snapshot and stores the refreshed one under a new
label. This supports genuine revocation-window comparisons before and after an operator changes
roles/IAS membership. A fresh login remains a separate action. The harness's optional
`forceLogin: true` only appends `prompt=login&max_age=0` to the ARC authorization URL; the reviewed
MCP SDK handler and XSUAA proxy do **not forward those parameters**. It does not force a credential
prompt or refresh IAS membership. Use a genuinely fresh private session or the documented
sign-out workflow, and record whether credentials were actually requested. `concurrent`
interleaves separate users/snapshots to exercise
request-local isolation. `exchange-user` performs a real JWT-bearer exchange against the isolated
binding's XSUAA token endpoint, not against SAP. An exchanged token may contain a different
documented grant type; a classifier failure is evidence to investigate, not permission to loosen it.

`import-token` accepts a private JSON object containing `access_token` and optional `refresh_token`
and `client_id`. Use it for operator-obtained machine or other-application tokens. The file must
already be private and outside the repo; the harness never persists imported or exchanged tokens.

`client-credentials` requests a real machine token directly from the selected binding's XSUAA
service using the already-loaded private credentials. It needs no browser or user login, stores
the token only in memory, then verifies and exercises the supplied rejection scenario. Optional
`"scopes":["read","admin"]` requests these app-qualified scopes; XSUAA must already grant those
client authorities. A role collection assigned to a human does not automatically grant machine
authorities. A successful 403 test with a non-admin machine token does **not** prove the separate
Admin-machine fixture. The default omits `scope` to observe the service client's actual authorities.

## What configured scenarios check

- Real SAP SDK validation precedes all reported scope, attribute and classifier summaries.
- A valid user without `read` expects HTTP 403 `insufficient_scope`; an unsupported machine
  principal expects 403 `forbidden`. `expect.aggregateErrorCode` also checks compatibility and
  pinned routes, including the `read` challenge for insufficient scope. A denied token issuance
  is not a valid-user-without-read runtime test.
- Network/JWKS/configuration failures are unavailable verification, not a passing invalid-token
  test. Wrong-application scenarios require the SDK's specific wrong-audience rejection.
- MCP responses must match the request's JSON-RPC ID and version. SSE requests finish when their
  matching response arrives; the server need not close a long-lived stream first.
- Every actual MCP response is checked for `Cache-Control: private, no-store`, including
  initialize, tools/list, tool calls, initialized notifications, unauthorized requests, pinned
  denials, and the JSON-RPC `/authorize` compatibility alias. A deliberately selected legacy
  comparison scenario can set `expect.privateResponses: false`; enforced scenarios leave it on.
- Only counts, fixed status strings, local capability scope names, boolean shape evidence, and
  expected-identity matching leave the harness. It does not decode unverified JWTs for assertions.
- Aggregate and `/authorize` alias operational schemas independently require a string `target`:
  exact complete enums for 1–16 `schemaTargets`, the canonical SID-or-alias/client pattern and
  no enum for 17–256, and no operational tools for `[]`. `SAPTargets` has no target selector.
  `schemaTargets` is separate from `allowedTargets` (an execution-probe subset), `grantValues`
  (which can include inactive/unknown IDs or `*`), and Admin `catalogTargets` (diagnostic inventory
  including ungranted targets). The harness never uses actual responses to set the expected set.
- Catalog visibility, expected tool presence/counts, and catalog grant flags are checked when
  supplied in the scenario. Direct mutation-only tool names are checked as absent. Full mixed-tool
  action allowlists, capability-policy combinations and initialization prose are **not** exhaustively
  validated here; those require the implementation unit suite and separately specified live cases.
- A non-Admin reader with exactly one granted active target has operational tools with an
  explicit target selector, but **no `SAPTargets`**. Two or more granted active targets expose
  the reader catalog. Do not copy an Admin/two-target catalog expectation into a single-target
  reader scenario.
- `grantStatus` describes the verified attribute's **shape**, not permission to execute. An
  absent attribute uses `missing`; an IdP-backed role can instead produce a valid empty array
  (`grantStatus: "valid"`, `grantValues: []`). Both must deny target access. Use separate
  `viewer-no-targets` and `viewer-empty-idp-targets` fixtures to avoid mistaking this distinction
  for an authorization failure.
- When `allowedTargets` is supplied, `SAPRead(SYSTEM)` runs through aggregate and pinned routes.
  These checks assert response success, **not** independent SAP user/client identity. Correlate
  with backend identity evidence and a separately approved tiny client-marker query before
  claiming routing/PP identity acceptance. No application data, SQL, ATC, unit tests, writes or
  transports are run by this harness.
- Hidden existing and nonexistent targets are directly called: generic aggregate errors and
  pinned 404 bodies are compared. These tests demonstrate observable behavior; proving that a
  denied call made **zero outbound SAP/destination calls** additionally requires server-side
  audit/instrumentation or the deterministic unit suite.
- Denial comparison omits only a bounded top-level `requestId`; target, identity, error code,
  message and all other fields remain part of the comparison. Caller-target echoes still fail.
- Unpaged catalog schema/result and rejected `offset` are tested only for `unpaged: true`.
- Admin diagnostic inventory/granted flags are checked independently of execution rights.

For a scale run, supply 50, 100 or 256 *real issued* `grantValues` (or `grantCount` plus separate
assignment evidence), the complete independent `schemaTargets`, and retain a known configured
target in `allowedTargets`. Many issued grants with only one active destination test token size,
not the above-16 schema case. The reported
token bytes and successful CF requests are actual measurements. This harness never fabricates
a projected token and labels it a live scale test.

## Suggested operator-driven matrix

1. Exact static single-target and multi-target Viewer roles; Data and SQL capability combinations.
2. Missing/empty/Unrestricted/malformed target values: denied execution, no partial valid subset.
3. Admin with no target grants: full diagnostic catalog, no SAP execution. Explicit `*`, then
   add a new destination and verify the existing wildcard role reaches it after snapshot reload.
4. IAS-only and static+IAS unions, exact+`*` unions, unrelated IAS-group exclusion.
5. Role/group removal: old access token, refresh, reused session, fresh incognito login. Record
   stale claims honestly; refresh success alone is not proof of grant recalculation.
6. Concurrent different users; machine Admin and wrong-application tokens; same attribute name
   in two isolated XSUAA apps. Expected origin/email checks prevent identity mix-ups.
7. Real 50/100/256-value tokens and real CF request sizes; client-specific Inspector, Cursor,
   VS Code/Copilot and additional-client checks remain separate manual/LLM-driven acceptance.

The harness and fixture validator have local self-tests:

```bash
node --test scripts/spikes/pr677-target-authorization/*.test.mjs
```

Those mocked harness self-tests prove only the harness logic/redaction. They are **not live BTP
evidence**. No scenario passes merely because it could not run: transport/protocol failures create
failed assertions, and command/startup failures are explicit JSON events.
