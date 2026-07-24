# Multi-Target Basic Authentication V1

## Status

- **State:** implemented after independent security review; local validation complete, live acceptance pending
- **Date:** 2026-07-20
- **Depends on:** [ADR-0006](../adr/0006-experimental-read-only-multi-target.md),
  [ADR-0007](../adr/0007-shared-basic-identity-for-read-only-multi-target.md), and the
  [multi-target v1 specification](destination-discovered-multi-target-v1.md)
- **Target branch:** the existing experimental multi-target branch/PR unless review requires a
  separate PR
- **Target platform:** SAP BTP Cloud Foundry, subaccount destinations, XSUAA, and on-premise SAP
  systems through Cloud Connector
- **Security boundary:** multi-target remains structurally mutation-free

This plan adds an explicitly enabled shared SAP identity to the experimental multi-target mode. It
does not replace Principal Propagation (PP), weaken the XSUAA boundary, or introduce multi-target
writes. Existing PP targets and single-target deployments must behave exactly as they do today.

## Outcome

One ARC-1 Cloud Foundry application can serve a mixed registry of:

- `PrincipalPropagation` destinations, where every caller reaches SAP as their propagated SAP user;
  and
- `BasicAuthentication` destinations, where every authorized ARC-1 caller reaches that target as
  the technical SAP user stored in the BTP destination.

Both authentication modes use the existing pinned and aggregate endpoints:

```text
/<PUBLIC-SYSTEM>/<CLIENT>/mcp
/multi/mcp
```

The authentication mode belongs to the selected destination. There is no request argument, route
variant, fallback, or client-side choice that can change it.

Basic authentication is an experimental compatibility option for read-only targets that cannot use
PP yet. It is not the recommended production identity model. PP remains the recommended default,
especially when source/data access must be attributable to an individual SAP user. Any future
multi-target write design must go through a separate ADR and security review and may deliberately
remain PP-only.

## Locked Decisions

| Area | Decision |
|---|---|
| Activation | Add `ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH=true`; default is false. `ARC1_MULTI_TARGET_ENDPOINTS=true` remains the parent feature flag. |
| Scope | Basic is supported only for discovered multi-target BTP subaccount destinations. It does not alter single-target Basic support. |
| Network | V1 accepts only `Type=HTTP` and `ProxyType=OnPremise`; Internet, Private Link, service-key, and non-BTP discovery are deferred. |
| Mixed mode | PP and Basic destinations may coexist in one registry and one `/multi/mcp` endpoint. |
| Caller access | Every XSUAA user with the global `read` scope can see and attempt every active Basic target, exactly as for PP target identifiers. Deploy separate ARC-1 applications when target populations differ. |
| SAP identity | PP targets use a per-user identity. Basic targets use one shared technical identity from the selected destination. No PP-to-Basic or Basic-to-PP fallback is permitted. |
| Authorization | XSUAA scope checks, instance safety, destination policy, SAP authorization, and the mutation-free ceiling all remain mandatory. Basic does not add a role or scope. |
| Writes | Basic multi-target remains mutation-free. Writes, activation, transport/Git mutations, enqueue operations, and SAP-backed lint formatter/settings actions are structurally unavailable. The same explicit v1 additions as PP are available: offline SAPLint, read-only transport inspection, ATC, and ABAP Unit; ATC/Unit run as the shared technical user. |
| Data and SQL | Existing four-layer consent remains unchanged: instance ceiling, destination opt-in, XSUAA scope, and SAP authorization. |
| Credential rotation | Updating destination `User` or `Password` takes effect on a later request without app restart or redeployment. Other routing/configuration changes still require restart. |
| Lockout control | A process-local credential guard serializes Basic calls per target, runs one non-retrying authentication canary before each eligible tool invocation, and blocks repeated attempts after an authentication failure. |
| Duplicate shared paths | Exactly one accepted Basic destination may claim a physical URL/client/Cloud Connector location. Aliases cannot duplicate it; an actually shared bare `/mcp` overlap fails startup. Strict-PP `/mcp` remains compatible. |
| CF scale | An ARC-1 deployment containing Basic targets supports exactly one CF app instance in this beta. The shipped MTA remains at `instances: 1`. |
| Catalog | Reader `SAPTargets` results add `identity: "per-user" | "shared"`. Admin results also expose secret-safe Basic runtime health. |
| Audit | Audit records retain the human XSUAA subject and target and identify the shared identity mode, but never contain the destination username, password, authorization header, or credential fingerprint. |
| Recommendation | Shared Basic is acceptable for read-only compatibility but is explicitly not recommended where per-user attribution or target-specific user access is required. |

## Security Model

The effective permission remains an intersection:

```text
multi-target mutation-free ceiling
  ∩ instance safety ceiling
  ∩ destination target policy
  ∩ XSUAA scopes of the human caller
  ∩ SAP authorization of the effective SAP identity
```

For PP, the final identity is the propagated user. For Basic, it is the destination's technical
user. The human caller is still authenticated and audited by ARC-1, but SAP sees the shared user.

This has three unavoidable consequences that must be stated prominently in the end-user docs:

1. A Basic target cannot enforce different SAP authorizations for different ARC-1 users.
2. SAP-native change/access logs identify the technical user, not the human caller; ARC-1 audit logs
   provide the human-to-target correlation.
3. Target visibility is global to the ARC-1 deployment. Different populations require separate
   ARC-1 deployments, even if SAP would deny some operations later.

Basic also concentrates reusable SAP passwords behind one Destination service binding. A compromise
of the ARC-1 application identity or process can therefore affect every Basic target that binding
can resolve. JavaScript strings cannot be reliably zeroized; the implementation can only avoid
persistence, minimize lifetime, prevent logging/serialization, and isolate the credentials to the
per-call client. This is another reason PP remains preferred.

The read-only ceiling substantially limits the impact of a shared identity but does not eliminate
confidentiality risk from source, table data, or SQL. Basic destinations therefore remain explicit,
default-off, and clearly labelled in discovery instructions and `SAPTargets`.

## Architecture Decision Record

Create ADR-0007, **Shared Basic Identity for Experimental Read-Only Multi-Target**, rather than
silently editing away ADR-0006's strict-PP invariant. ADR-0007 must:

- narrowly qualify ADR-0006 for explicitly enabled on-premise `BasicAuthentication` destinations;
- record the shared-identity, audit-attribution, one-instance, and password-lockout risks;
- preserve every mutation-free and target-selection invariant from ADR-0006;
- state that Basic is not automatically eligible for future write support; and
- require a new ADR/security review before adding Basic destinations to any mutation-capable route.

Update ADR-0006's related/qualified-by metadata and the normative multi-target v1 plan so readers do
not encounter contradictory strict-PP statements.

## Configuration Contract

### Instance option

Add one default-false environment option:

```yaml
ARC1_MULTI_TARGET_ENDPOINTS: "true"
ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH: "true"
```

Rules:

- the Basic option has no effect unless multi-target endpoints are enabled;
- when absent or false, a marked Basic destination is quarantined with
  `BASIC_AUTH_DISABLED`, preserving the current PP-only behavior;
- the option is an instance ceiling only; it never converts a destination or supplies credentials;
- do not add a second target list, target-specific environment suffix, or YAML target file; and
- do not add a new XSUAA scope or role collection.

Add the option to:

- `src/server/types.ts` and `src/server/config.ts`;
- `.env.example`;
- the commented experimental block in `mta-overrides.mtaext.example` and relevant `mta.yaml`
  comments;
- `docs_page/configuration-reference.md`; and
- the configuration tables in `AGENTS.md` and `docs/dev-guide.md`.

The runtime cannot reliably discover the application's desired CF scale from its own process.
Enforce the one-instance contract through the shipped MTA descriptor, tests, deployment docs, and
an operator warning that explains the process-local guard. Basic-enabled upgrades must use a
non-rolling stop/start strategy, or disable/drain Basic before any rolling/blue-green replacement,
because a desired count of one can still overlap two processes. Do not pretend that checking
`CF_INSTANCE_INDEX=0` proves there is only one instance.

### Basic destination properties

A Basic candidate must satisfy the existing common destination contract plus the following:

```properties
Name=ARC1_A4H_100_BASIC
Type=HTTP
URL=https://a4h-abap.internal:50001
ProxyType=OnPremise
Authentication=BasicAuthentication
User=ARC1_READER
Password=<secret>
sap-sysid=A4H
sap-client=100
Description=A4H quality client 100 (shared read-only user)
arc1.enabled=true
```

Optional read/data/SQL configuration remains identical to PP:

```properties
arc1.allow_data_preview=true
arc1.allow_free_sql=true
```

Validation rules:

- `User` and `Password` must both be present and non-empty in the authoritative per-call Destination
  Find response;
- collection responses may mask or omit protected values, so startup discovery does not project
  credential values or credential-presence booleans and never treats the collection as proof that
  the runtime secret is usable;
- an otherwise valid Basic target is not quarantined solely because a collection API omitted a
  protected field; missing credentials become a safe runtime configuration status on first use;
- `Preemptive` may be absent or a valid boolean `true`; explicit `false` is rejected because ARC-1
  sends the Basic header preemptively and must not contradict the destination contract;
- `sap-sysid`, `sap-client`, description, alias, language, location ID, strict `arc1.*` allowlist,
  duplicate handling, target limit, and data/SQL policy follow the existing multi-target contract;
- no additional `arc1.allow_shared_identity` property is needed because
  `Authentication=BasicAuthentication` plus the instance flag is the explicit dual consent; and
- `arc1.allow_writes`, package, transport, and Git configuration remains a quarantine condition.

Add bounded, stable exclusion codes:

- `BASIC_AUTH_DISABLED`;
- `BASIC_PREEMPTIVE_DISABLED` (including an invalid explicit value).

`BASIC_CREDENTIALS_MISSING` is a runtime setup code, not a registry exclusion code, because only the
authoritative Find response can establish absence. It is re-evaluated on the next call, so
adding/fixing `User` and `Password` recovers without restart.

`BASIC_CREDENTIALS_INVALID` is the corresponding runtime code for a username containing `:` or
surrounding whitespace. It also recovers on the next request after the destination is corrected.

Keep generic `UNSUPPORTED_AUTH` for all other authentication types.

### Technical SAP user guidance

The administration page must recommend:

- a dedicated non-personal communication/service user for HTTP access;
- a separate technical user per SAP client or security boundary;
- only the minimum ADT and business-data authorizations needed by the enabled tools;
- no `SAP_ALL`, developer-wide role, transport/write authorization, or shared administrator user;
- a strong generated password managed in the BTP destination, with expiry/lock monitoring;
- an ASCII username and password for interoperable HTTP Basic encoding; ARC-1 rejects a username
  that is empty/whitespace-only or contains `:` and never trims or mutates the password;
- HTTPS from Cloud Connector to SAP as the expected production posture. An HTTP internal mapping
  exposes the reusable Basic password on that internal hop; ARC-1 cannot verify the mapping's
  internal protocol from Destination Service; and
- Cloud Connector resources restricted to the required ADT paths instead of exposing the complete
  backend indiscriminately.

Basic targets do not need CERTRULE mapping. They use a separate mapping with principal type None
(`NONE_RESTRICTED` in the API), while the Cloud Connector identity certificate is relevant to PP.
The SAP `/sap/bc/adt` ICF logon procedure must accept HTTP Basic; ARC-1 suppresses SAML and treats a
2xx HTML/SSO page as authentication failure.

## Data Model Changes

### Secret-free startup projection

Extend the projected discovered-destination type with only the safe non-secret setting needed for
startup validation:

```ts
interface ProjectedDestination {
  // existing safe fields
  preemptive?: string;
}
```

`src/server/destination-discovery.ts` must discard raw `User`, `Password`, tokens, headers, and
certificates without deriving or retaining a credential fingerprint/presence marker. Unit tests
must use sentinel secrets and prove they do not survive projection or serialization.

### Registry target descriptor

Replace the PP-only authentication literal with explicit identity metadata:

```ts
type TargetAuthentication = 'PrincipalPropagation' | 'BasicAuthentication';
type TargetIdentity = 'per-user' | 'shared';

interface TargetDescriptor {
  authentication: TargetAuthentication;
  identity: TargetIdentity;
  // existing immutable routing and policy fields
}
```

`identity` is derived, never accepted as an independent destination property:

```text
PrincipalPropagation -> per-user
BasicAuthentication  -> shared
```

The immutable registry fingerprint continues to include the authentication type, URL, proxy,
client, language, location ID, and target policy. It does not include credential presence, username,
or password. This deliberately lets credentials be added or rotated without changing the public
target snapshot while treating all non-secret routing/policy changes as restart-required drift.

## Destination-Service Dependency

ARC-1 already performs an uncached Destination Service **Find** lookup per target call through
`@arc-mcp/xsuaa-auth`. Reuse that API for both PP and Basic; do not add a second cache or fetch path.

Before ARC-1 consumes Basic credentials, harden the dependency:

1. Extend `DestinationServiceRequestError.operation` with `find`.
2. Route Find token acquisition through the existing body-free Destination Service token wrapper;
   do not call the raw token helper whose error currently includes a response-body excerpt.
3. Make Find network, non-2xx, JSON, and shape failures throw the typed, body-free error used by
   token/list operations.
4. Never include the Destination Service response body, destination object, `User`, `Password`,
   auth token, or headers in the error message/cause.
5. Validate that a successful Find response has the required shape before returning it and sanitize
   its success projection: `User` and `Password` may exist only in the explicit top-level credential
   fields, while `originalProperties` contains only the non-secret fields needed for drift checks.
   Strip known tokens, authorization material, client secrets, certificates, and private keys too.
6. Add tests with sentinel credentials in success, non-2xx, and malformed responses and assert that neither
   thrown errors nor serialized errors contain them.
7. Publish the hardened dependency to npm, then update ARC-1's exact package version and lockfile.
   A sibling checkout, tarball, or `file:` dependency is not acceptable for the PR's clean-install,
   MTAR, or customer-deployment evidence.

No token-verifier, DCR, scope, or role changes are required in `@arc-mcp/xsuaa-auth`.

## Runtime Design

### Authentication-specific client creation

Refactor `src/server/server.ts` so target lookup and immutable-drift validation are shared, then
branch explicitly by `TargetDescriptor.authentication`:

```text
resolve target
  -> PP: uncached Destination Find -> validate immutable fields -> exchange propagated identity
  -> Basic: acquire process-wide target gate -> uncached Destination Find
            -> validate immutable fields and credentials -> canary -> tool call -> release gate
```

PP behavior must remain byte-for-byte equivalent where practical:

- strict PP stays enabled;
- no shared-cookie fallback;
- `auth_pp_created` audit behavior remains compatible; and
- the existing per-user client/cache-isolation semantics remain unchanged.

For Basic:

- build a fresh ADT client from the currently resolved URL, client, language, location ID, `User`,
  and `Password`;
- create the BTP Connectivity proxy with the resolved `CloudConnectorLocationId` exactly as for PP;
- set `ppEnabled=false`, `ppStrict=false`, and `isPerUserClient=false` for that runtime;
- force the existing on-premise SAML-suppression header/query behavior for this internal Basic
  client so an HTML SAML login redirect cannot masquerade as successful Basic authentication;
- rely on the existing ADT HTTP layer's preemptive Basic `Authorization` header;
- set new internal HTTP options `retryUnauthorized=false` and an auth-failure callback for this
  client only; existing single-target and PP retry behavior remains unchanged;
- keep the server-wide SAP semaphore and rate limits;
- do not reuse an ADT client, cookie jar, or CSRF/session state across MCP requests; and
- keep raw credentials scoped to the lookup/client-call stack and eligible for garbage collection
  immediately after the request.

There must be no automatic authentication fallback. A PP failure is a PP failure; a Basic failure
is a Basic failure.

### Credential-attempt guard

Add a focused module such as `src/server/multi-target-shared-auth-state.ts`. Its purpose is to avoid
password lockout and to provide safe admin health, not to cache SAP sessions.

#### State

Use a process-random HMAC key created at startup. For each Basic target, compute an opaque credential
generation:

```text
HMAC-SHA-256(processRandomKey, User + NUL + Password)
```

Never log, return, persist, or expose this value. Do not use an unhashed username/password digest.
Keep the current generation plus at most four recently blocked generations for each target. Retain
blocked generations for 15 minutes and evict them least-recently-used after that bound. The overall
map is bounded by the existing 256-target maximum (at most 1,024 blocked HMAC values). This prevents
a temporarily inconsistent Destination Service sequence such as old -> new -> old from immediately
re-admitting a password that SAP already rejected, while still allowing eventual recovery without
persistent state.

Construct this guard exactly once in `createAndStartServer` and inject the same object into every
pinned and aggregate MCP server factory. A fresh MCP `Server` is created for each HTTP request, so a
guard constructed inside `createServer` would not serialize anything across routes or requests.

The per-target gate has a fixed queue limit of 32 and a 30-second acquisition timeout. Overflow or
timeout returns retryable `SAP_TARGET_BUSY` without contacting Destination Service or SAP. Always
release in `finally`. V1 does not claim disconnect cancellation because MCP cancellation is not yet
threaded into every SAP request.

Per target/generation, track only:

```ts
type SharedAuthHealth =
  | 'not_checked'
  | 'checking'
  | 'healthy'
  | 'configuration_invalid'
  | 'authentication_failed'
  | 'authorization_failed'
  | 'temporarily_unavailable';
```

Safe timestamps may be retained for admin diagnostics. Do not retain SAP response bodies or the
technical username.

#### Per-call authentication canary

For every Basic invocation, acquire the process-wide per-target gate before Destination Find and
hold it through feature probing and tool dispatch:

1. perform an uncached Destination Find and validate non-secret drift;
2. validate that `User` is non-empty/non-whitespace and contains no `:`, and that `Password` is
   non-empty, without trimming or mutating either value;
3. compare the resolved credential generation with current and recently blocked generations;
4. fail locally when that exact generation is still blocked;
5. when the generation changed, clear target-scoped feature/discovery evidence before probing with
   the new technical identity;
6. send a discovery canary to `/sap/bc/adt/core/discovery` with automatic 401 retry disabled;
   HTTP 429/503 transport retries may still occur, but one invocation must cause at most one
   rejected-credential (401) attempt;
7. reject an HTML/SAML login response or an invalid ADT discovery response even when its HTTP status
   is 2xx; do not require one exact MIME string across SAP releases—reject HTML and require
   parseable/recognizable ADT discovery evidence;
8. on success, mark the generation `healthy` and continue;
9. on HTTP 401, mark it `authentication_failed` and retain it in the bounded blocked set;
10. on an authorization-classified HTTP 403 from this discovery canary, mark it
   `authorization_failed`;
11. on network, timeout, 429, or 5xx failure, mark it `temporarily_unavailable`, release the gate,
   and allow a later caller to retry; and
12. let concurrent callers wait on the same bounded per-target gate rather than contact Destination
    Service or SAP independently.

The feature probe must start only after this canary succeeds. This is essential because the
current feature probe can fan out into many ADT requests and turn one bad password into a locked SAP
account.

Authorization-limited feature evidence is identity-sensitive. ARC-1 continues to discard it for
per-user PP, because another user may have different SAP authorization. For shared Basic it is
definitive for the reviewed technical user's current credential generation, so ARC-1 caches it to
avoid repeating the full probe on every call. A credential-generation change clears that evidence
before the next canary and probe.

Running the canary on every serialized invocation is a deliberate Basic-beta cost. It catches a
password that expired after an earlier healthy request before a feature probe or multi-request tool
can fan out. The expected workload normally touches only one or two targets per conversation, so
this safety request is preferable to a time-based health cache.

#### Calls after first use

Serialize complete Basic tool calls per target while allowing different targets and all PP targets
to run concurrently. This conservative v1 rule closes the remaining race where an expired password
could otherwise produce up to `ARC1_MAX_CONCURRENT` simultaneous 401 responses after a previously
healthy canary.

Within the per-target gate:

- a blocked generation fails locally without contacting SAP;
- a new credential generation is admitted to the next per-call canary and can recover without
  restart;
- a backend 401 during a normal call marks the current generation `authentication_failed` before
  releasing queued calls;
- an action-specific 403 during a normal tool call does **not** block the whole target, because the
  technical user may legitimately be allowed to perform other read operations; and
- feature-probe single-flight remains keyed by the immutable target fingerprint and runs only after
  authentication health is established.

The aggregate server remains authentication-neutral until it resolves the explicit target. Only a
selected Basic target sets `ppEnabled=false`, `ppStrict=false`, and shared-cache semantics. The
default-off path and every selected PP target retain the current strict-PP configuration exactly.

This serialization and canary are intentionally limited to shared Basic targets. They are acceptable
for the beta because all calls use the same SAP account and its primary purpose is safe
compatibility, not peak parallel throughput.

#### ADT HTTP integration

The current ADT HTTP client retries every 401 once as session-timeout recovery. Reusing it unchanged
would turn one bad Basic canary into two SAP login attempts. Add narrowly scoped internal options to
`AdtClientConfig`/`AdtHttpConfig`, carry them through `AdtClient`, and set them only for multi-target
Basic clients:

```ts
retryUnauthorized?: boolean; // default true for compatibility
onUnauthorized?: (context: { path: string; statusCode: 401 }) => void;
```

When `retryUnauthorized=false`, a 401 goes directly to normal error handling without the session
reset/retry. Invoke `onUnauthorized` only for the final 401, never with headers, body, username, or
password. The callback marks the current target/generation blocked. Apply the same rule to CSRF
fetch paths even though mutation operations are unavailable, because some read-like ADT POSTs can
still use CSRF/session infrastructure. Centralize notification so an ordinary 401, final retry 401,
CSRF 401, and synthetic `200 text/html` login-page 401 each notify exactly once.

The same retry-disabled per-call ADT client serializes its internal HTTP requests. Feature probes
and compound handlers can otherwise start parallel requests with one expired password before the
first 401 is observed. After the first 401, queued requests on that client fail locally without
contacting SAP. This is separate from, and nested inside, the process-wide per-target tool-call gate.

Suppress SAP response bodies for HTTP 401/403 in audit/log records (including HTTP debug mode) and
verify this with a sentinel. Authentication errors may expose usernames or SAP security details
even when request headers are already redacted.

#### Restart behavior

The guard is intentionally process-local and non-persistent:

- app restart clears health and any blocked generation;
- destination `User`/`Password` rotation creates a new generation and the next call runs a fresh
  canary;
- changing URL, authentication type, client, location, alias, SID, language, or target policy still
  produces `TARGET_CONFIG_CHANGED` until restart; and
- scaling to multiple CF app instances is unsupported because each process would have its own
  attempt budget.

## Error Contract

Use stable client-facing codes and do not leak destination or SAP response secrets:

| Condition | Code | Retry guidance |
|---|---|---|
| Basic disabled by instance | registry exclusion `BASIC_AUTH_DISABLED` | enable flag and restart |
| Missing Basic credentials | `BASIC_CREDENTIALS_MISSING` | repair destination User/Password; next call re-resolves it without restart |
| Invalid Basic username | `BASIC_CREDENTIALS_INVALID` | remove `:` or surrounding whitespace; next call re-resolves it without restart |
| Explicit/invalid preemptive false | registry exclusion `BASIC_PREEMPTIVE_DISABLED` | repair destination and restart |
| Destination Find/setup failed | `DESTINATION_AUTH_SETUP_FAILED` | retry only when classified transient; give request ID |
| Canary 401 or later backend 401 | `SAP_AUTHENTICATION_FAILED` | non-retryable for this credential generation; administrator rotates destination credentials, then the user may say “try again now” |
| Authorization-classified discovery canary 403 | `SAP_AUTHORIZATION_DENIED` | non-retryable for this generation; administrator fixes technical-user ADT authorization, then restarts or rotates credentials to recheck |
| Verified Cloud Connector denial | `CLOUD_CONNECTOR_ACCESS_DENIED` | repair the shared Basic OnPremise mapping; generation remains retryable |
| Inactive ICF, ambiguous 403, network, timeout, 429, or 5xx canary failure | `SAP_TARGET_TEMPORARILY_UNAVAILABLE` | retry later; generation remains retryable |
| Basic target gate full/timed out | `SAP_TARGET_BUSY` | retry after the active call completes |
| Non-secret config drift | existing `TARGET_CONFIG_CHANGED` | restart app after destination change |

The message for a blocked generation must be conclusive: ARC-1 did not retry the rejected shared
credentials, the target is temporarily unavailable to all callers, and an administrator must update
the destination before retrying. It must not claim that the human caller lacks a SAP user, because
Basic does not use the caller's SAP identity.

Make `classifyMultiTargetSapError` identity-aware. PP errors may continue to say “propagated user”;
Basic errors must say “shared technical user.” A normal action-specific 403 keeps
`SAP_AUTHORIZATION_DENIED` but must not poison Basic target health. Automatic LLM retry flags are
false for blocked credential generations and true only for transient connectivity/service failures.

Extend the multi-target preparation failure stage union with a Basic-specific stage such as
`shared_auth_failed`; do not report a Basic failure as `pp_exchange_failed`.

## Tool Catalog and MCP Instructions

### Reader output

For every active target, `SAPTargets` returns:

```json
{
  "target": "A4H/100",
  "description": "A4H quality client 100",
  "identity": "shared"
}
```

`identity` is `per-user` for PP and `shared` for Basic. Keep the compact reader output free of
destination names, URLs, usernames, health details, and internal configuration.

### Admin output

Admin output summarizes normal shared-auth state once:

```json
{
  "sharedAuthentication": {
    "targets": 2,
    "statusCounts": {
      "not_checked": 1,
      "healthy": 1
    }
  }
}
```

Targets that need attention appear in a bounded administrator exception list:

```json
{
  "exceptionTotal": 1,
  "exceptionReturned": 1,
  "exceptionsTruncated": false,
  "exceptions": [{
    "target": "A4H/100",
    "status": "authentication_failed",
    "checkedAt": "2026-07-20T12:34:56.000Z"
  }]
}
```

The runtime state is passive state from real calls. Keep it in the shared-auth-state component and
join it into the catalog at response time; never mutate the immutable destination registry or its
revision. To keep the 256-target result bounded, `healthy` and `not_checked` are represented only in
the fixed-size status summary. Return at most 8 deterministic exception rows and include total,
returned, and truncation metadata; an administrator can narrow `query` to inspect a specific target.
Do not repeat runtime state inside every public target row. `SAPTargets` must never probe SAP. It must not
return technical usernames, credential-presence fields, authentication (already represented by the
compact `identity` field), fingerprints, HTTP response bodies, or error stack traces. PP targets do
not receive a runtime block unless a separate safe PP health contract is accepted.

`healthy` means only that the last Basic canary authenticated and reached ADT discovery. It is not a
promise that every tool/action is authorized or that the target will remain reachable.

### Server instructions

Make instructions target-aware:

- a pinned Basic server says that calls run as a shared technical SAP user and SAP authorization is
  not per caller;
- a pinned PP server retains the per-user PP wording;
- the aggregate server tells the model to inspect `identity`, choose an explicit target, and never
  infer per-user SAP access for `shared` targets; and
- target descriptions remain untrusted labels, not instructions.

Do not add authentication as a tool argument and do not add a separate HTTP catalog endpoint.

## Audit and Logging

Add a distinct success event, for example `auth_shared_created`, or a backwards-compatible identity
field on a generic target-auth event. Prefer a distinct event so existing `auth_pp_created`
consumers remain stable.

Emit `auth_shared_created` only after the canary succeeds. Preparation failures retain the human
XSUAA subject, public target, tool, Basic-specific failure stage/code, and request ID without any
technical-user or response-body field.

Every Basic call must keep:

- human XSUAA subject/client identity already available to ARC-1;
- public target ID;
- tool/action and result;
- request/correlation ID; and
- safe identity mode (`shared`).

Never emit:

- destination `User` or `Password`;
- `Authorization` or proxy authorization headers;
- the credential-generation HMAC;
- raw Destination Service responses; or
- SAP authentication response bodies.

Update the BTP Audit Log sink's event union/mapping and add redaction tests for logger, error, audit,
and admin-catalog paths. Use unique sentinel credentials in tests and scan serialized output.

Log one operator warning at startup when Basic support is enabled, summarizing:

- shared SAP identity and loss of per-user SAP attribution;
- global target visibility for all read-scoped users;
- one-CF-instance requirement; and
- mutation-free beta status.

Do not log the number or names of Basic destinations before the secret-safe registry snapshot is
validated.

## Code Work Breakdown

### Phase 0 — Architecture and dependency safety

1. Add ADR-0007 and cross-link ADR-0006.
2. Update the normative multi-target plan's authentication, effective-permission, deployment, target
   availability, destination-change, catalog, and accepted-risk sections.
3. In `@arc-mcp/xsuaa-auth`, make Destination Find failures typed and body-free, add secret
   sentinel tests, and apply a bounded timeout to Destination/Connectivity token acquisition,
   Destination list/Find, and direct PP exchange (including response-body consumption). A stalled
   BTP service call must not hold ARC-1's per-target shared-auth gate indefinitely or poison the
   Connectivity token cache.
4. Publish the dependency containing both hardening changes and update
   `package.json`/`package-lock.json` to that exact version; verify a clean `npm ci` and MTAR build
   resolve only the registry release.

Exit criterion: ARC-1 cannot receive a raw Destination Service failure body through the dependency,
and every BTP service request used by multi-target preparation terminates within the dependency's
documented timeout.

### Phase 1 — Configuration, projection, and registry

1. Parse `ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH` with a default of false.
2. Project only the safe preemptive setting; discard credentials entirely during startup discovery.
3. Extend the target descriptor with authentication and identity unions.
4. Accept mixed PP/Basic candidates under the locked rules and add stable exclusion codes.
5. Keep duplicate quarantine, maximum-target handling, revision hashing, and zero-target startup
   behavior deterministic.
6. Ensure revision/fingerprints never incorporate secret values or unstable masked passwords.

Exit criterion: secret-free registry snapshots deterministically represent mixed target sets and PP
behavior is unchanged when the new flag is false.

### Phase 2 — Shared credential guard

1. Implement process-keyed HMAC credential generations.
2. Implement bounded per-target health state and admin-safe snapshots.
3. Implement a non-retrying ADT authentication canary and strict response validation.
4. Implement per-Basic-target complete-call serialization.
5. Feed final normal-call 401 failures back into the guard through the narrow HTTP callback.
6. Add the bounded queue/30-second acquisition timeout and guarantee release in `finally` on
   timeout and thrown handler errors. Do not claim client-disconnect cancellation in v1.

Exit criterion: each admitted Basic tool invocation performs one canary and at most one rejected
credential attempt; concurrent callers cannot create parallel login attempts; and after a later 401
all queued calls fail locally for the blocked credential generation.

### Phase 3 — Runtime and dispatch

1. Split shared destination lookup/drift validation from authentication-specific client creation.
2. Keep the PP construction path unchanged.
3. Add fresh per-request Basic ADT client construction.
4. Run the Basic canary before feature probing.
5. Cache authorization-limited feature evidence only for the shared Basic identity and clear it on
   credential-generation rotation; preserve per-user PP's discard-and-reprobe behavior.
6. Apply destination/instance read-data-SQL safety intersections exactly as for PP.
7. Add Basic-specific preparation failure stages and client errors.
8. Verify direct invocation of omitted mutation tools remains denied independently of list pruning.

Exit criterion: mixed PP/Basic pinned and aggregate calls work without changing `/mcp`, XSUAA, or
the multi-target mutation-free tool surface.

### Phase 4 — Catalog, instructions, audit, and observability

1. Add reader `identity` output.
2. Add admin-only passive runtime health.
3. Generate identity-correct pinned and aggregate MCP instructions.
4. Add Basic auth audit events/stages and BTP sink support.
5. Add one startup risk warning and runtime health transitions without secret fields.
6. Ensure `/health` retains registry semantics and does not probe SAP credentials.

Exit criterion: users and models can tell shared from per-user identity, while only admins see safe
runtime health and nobody sees credentials.

### Phase 5 — Documentation and deployment samples

Keep the existing maximum of two multi-target end-user pages:

- `docs_page/multi-target-setup.md`: quick start, mixed PP/Basic destination samples, flag,
  one-instance warning, client URL examples, and restart/rotation behavior.
- `docs_page/multi-target-administration.md`: threat model, technical-user design, least privilege,
  catalog/audit interpretation, lockout recovery, monitoring, troubleshooting, and rollback.

Also update:

- `docs_page/configuration-reference.md`;
- `docs_page/enterprise-auth.md` where the layered identity distinction is explained;
- `.env.example`, `mta.yaml`, and `mta-overrides.mtaext.example`;
- `AGENTS.md` and the matching `docs/dev-guide.md` routing/gotcha sections; and
- release notes/PR description with an explicit experimental warning.

Do not create a third overlapping multi-target guide.

Exit criterion: an administrator can configure a least-privilege Basic target, understand exactly
which identity SAP sees, rotate its password without restart, and recover from a blocked generation.

### Phase 6 — Verification and beta deployment

Run automated, integration, and live CF tests listed below. Deploy first with the Basic flag absent,
confirm PP regression behavior, then enable Basic only in the beta/customer test deployment.

Exit criterion: all acceptance criteria pass and log/audit scans contain no test credential sentinel.

## File-Level Change Map

| Concern | Primary files |
|---|---|
| ADR/spec | `docs/adr/0007-shared-basic-identity-for-read-only-multi-target.md`, `docs/adr/0006-experimental-read-only-multi-target.md`, `docs/plans/destination-discovered-multi-target-v1.md` |
| Config | `src/server/config.ts`, `src/server/types.ts`, `.env.example`, `mta.yaml`, `mta-overrides.mtaext.example` |
| Discovery/projection | `src/server/destination-discovery.ts`, `src/server/multi-target-destination-config.ts` |
| Registry/model | `src/server/destination-registry.ts`, `src/server/multi-target-identity.ts` if shared public types belong there |
| Credential guard | new `src/server/multi-target-shared-auth-state.ts` |
| Runtime/client construction | `src/server/multi-target-runtime.ts`, `src/server/server.ts`, `src/server/multi-target-server.ts`, `src/adt/config.ts`, `src/adt/client.ts`, `src/adt/http.ts` |
| Tool catalog | `src/server/multi-target-catalog.ts`, `src/server/multi-target-tools.ts` |
| Errors | `src/server/multi-target-runtime.ts`, `src/handlers/dispatch.ts`, `src/adt/errors.ts` only if a shared classifier is required |
| Audit/logging | `src/server/audit.ts`, `src/server/sinks/btp-auditlog.ts`, `src/server/logger.ts` only through existing redaction APIs |
| Dependency | `@arc-mcp/xsuaa-auth` repository `src/btp/destination.ts` and its tests, then ARC-1 package manifests |
| User docs | `docs_page/multi-target-setup.md`, `docs_page/multi-target-administration.md`, `docs_page/configuration-reference.md`, `docs_page/enterprise-auth.md` |
| Developer docs | `AGENTS.md`, `docs/dev-guide.md` |

Keep ADT HTTP changes narrow: the existing preemptive Basic header stays unchanged, while the new
internal retry/callback options are used only by multi-target Basic clients. Avoid changing XSUAA
scope negotiation, role templates, or `xs-security.json` because the authorization model is
intentionally unchanged.

## Automated Test Plan

### `@arc-mcp/xsuaa-auth`

- successful Find returns URL, non-secret properties, and Basic credentials only to the caller;
- token/list/find non-2xx errors use typed, body-free errors;
- Destination/Connectivity token, list/Find, and direct PP exchange requests time out within the
  documented bound, including stalled response-body reads;
- a timed-out Connectivity request does not populate or poison the token cache;
- malformed JSON and malformed success shape fail body-free;
- sentinel username/password/body/header values never appear in message, stack, cause, or JSON
  serialization; and
- existing PP exchange/list tests remain unchanged.

### Destination discovery and registry

- Basic flag absent/false quarantines Basic and accepts PP;
- flag true accepts valid OnPremise Basic and mixed PP/Basic registries;
- Internet, explicit false/invalid `Preemptive`, and unknown authentication types quarantine with
  the correct codes;
- missing/empty runtime credentials produce `BASIC_CREDENTIALS_MISSING` without quarantining an
  otherwise valid startup candidate, and adding them recovers without restart;
- Basic usernames containing `:` or leading/trailing whitespace produce
  `BASIC_CREDENTIALS_INVALID` without a SAP request and recover after correction;
- startup projection exposes neither credential values nor presence booleans;
- identity is derived correctly and cannot be overridden by a destination property;
- duplicate public IDs quarantine all duplicates regardless of authentication mode;
- 256/257 candidate behavior is unchanged;
- policy and immutable revision are secret-independent; and
- zero-target/failure health semantics are unchanged.

### Credential guard

- N concurrent requests for one target/generation serialize and produce one non-retrying canary per
  admitted tool invocation, never parallel login attempts;
- the same process-wide guard serializes pinned and aggregate calls even though HTTP constructs a
  fresh MCP `Server` for each request;
- requests to different Basic targets remain concurrent;
- PP calls are not serialized by the Basic guard;
- a canary 401 is not retried, blocks the generation, and makes later calls issue zero SAP requests;
- an old/new/old Destination Service sequence cannot re-admit the recently rejected old generation;
- an authorization-classified canary 403 blocks as authorization failure;
- a verified Cloud Connector denial, inactive ICF response, or ambiguous 403 remains retryable and
  does not poison the credential generation;
- an action-specific normal-call 403 does not block the target;
- timeout/network/429/5xx releases the flight and a later request retries;
- queue overflow and the 30-second acquisition timeout return `SAP_TARGET_BUSY` without contacting
  Destination Service or SAP;
- credential rotation changes the opaque generation and permits the next serialized canary without
  restart;
- blocked generation retention is capped at four per target, 15 minutes, and 1,024 values globally;
- credential generation change clears target-scoped feature/discovery evidence before reprobe;
- app restart/new guard instance starts at `not_checked`;
- thrown handlers and every acquired path release the per-target gate in `finally`;
- a 2xx HTML/SAML login page fails the canary and never starts feature probing;
- the synthetic HTML-login 401 invokes the same narrow unauthorized callback and blocks the
  generation;
- empty/whitespace-only and colon-containing usernames fail before SAP; passwords are never trimmed;
- the new HTTP callback contains only path/status and does not affect existing default 401 retry
  tests;
- map growth is bounded to 256 targets; and
- raw credentials/fingerprint never appear in health snapshots, debug output, or errors.

### Runtime, routing, and tools

- mixed PP/Basic pinned routes and `/multi/mcp` resolve the correct client;
- Basic aggregate calls require explicit `target` exactly like PP;
- no auth fallback occurs in either direction;
- resolved non-secret drift fails with `TARGET_CONFIG_CHANGED`;
- only credential-value rotation is hot-reloaded;
- feature probing never begins before the current call's successful Basic canary;
- Basic uses a fresh ADT client and no per-user/cache isolation claim;
- source read works with only read; data/SQL require all existing gates;
- mutation tools remain absent and direct mutation dispatch is denied for Basic and PP;
- `SAPTargets` remains aggregate-only and role-sensitive;
- `/mcp` single-target behavior is unchanged; and
- XSUAA auth-before-route-existence protections remain unchanged;
- the aggregate surface stays strict-PP/authentication-neutral until target resolution, and the
  Basic flag's default-off regression is exact.

### Catalog, instructions, errors, and audit

- reader target entries include only target, description, and identity;
- admin Basic entries contain bounded passive health with no username/fingerprint;
- reader/admin pagination and truncation budgets still pass at 256 targets;
- pinned PP/Basic and aggregate instructions describe identity accurately;
- 401, discovery 403, transient canary, and setup errors have stable codes/retry guidance;
- Basic failures never use `pp_exchange_failed`;
- human XSUAA subject and target remain in audit records;
- `auth_shared_created` is emitted only after a successful canary; preparation failures retain the
  human subject, target, tool, Basic stage, request ID, and a safe code;
- new audit events are accepted by the BTP sink;
- HTTP 401/403 response bodies are absent from stderr, file, and BTP Audit Log sinks even in debug
  mode; and
- sentinel credentials do not appear in logs, audit output, catalog output, errors, snapshots, or
  tool results.

### Configuration and deployment

- config parser default/off/on and invalid-value behavior;
- MTA descriptor keeps the server module at exactly one instance;
- deployment docs prohibit rolling/blue-green overlap while Basic is enabled;
- example override is valid and the Basic flag remains commented/default-off;
- plugin manifest/configuration docs remain synchronized where CI checks them; and
- existing PP-only multi-target tests pass without fixture changes except the additive identity
  field in experimental `SAPTargets` snapshots.

### Repository checks

Run at minimum:

```bash
npm ci
npm run typecheck
npm run lint
npm run build
npm test
```

Then run the focused multi-target suites identified in `AGENTS.md`, BTP validation, and any
integration/e2e suites for which the required SAP systems are available.

## Live Acceptance Test Plan

Use the existing CF beta app and 7.50, S/4HANA 2023, and S/4HANA 2025 systems where available.
Create a dedicated least-privilege Basic technical user rather than reusing a personal/SAP_ALL user.

### Regression baseline

1. Deploy with `ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH` absent.
2. Confirm all existing PP targets, pinned URLs, aggregate target selection, OAuth role matrix, and
   `SAPTargets` still work.
3. Confirm a marked Basic destination is quarantined and visible only in admin diagnostics with
   `BASIC_AUTH_DISABLED`.

### Basic happy path

1. Enable the flag and keep the CF app at one instance.
2. Add one OnPremise Basic destination with read-only ADT authorization.
3. Restart once to discover the new target.
4. Verify `SAPTargets` shows `identity=shared` to readers and safe health to admins.
5. Call `SAPSearch`, `SAPRead(SYSTEM)`, `SAPRead(COMPONENTS)`, and a source/DDIC read over both the
   pinned and aggregate endpoint.
6. Confirm `SAPRead(SYSTEM)` reports the technical SAP identity, while ARC-1 audit identifies the
   human XSUAA caller.
7. Enable and test data/SQL separately, including denial when any one of the four gates is absent.

### Lockout and rotation

1. Use a disposable Basic technical user whose lock counter can be observed in SAP.
2. Set an incorrect destination password.
3. Send multiple concurrent ARC-1 requests to the same target.
4. Confirm SAP records exactly one non-retried failed authentication attempt for that generation and later
   ARC-1 calls fail locally.
5. Correct only the destination password; do **not** restart ARC-1.
6. Say “try again now” from the same MCP client and confirm the next canary succeeds.
7. Rotate to another valid password and repeat to prove hot credential recovery.
8. After a healthy state, expire/change the SAP password behind ARC-1 and send concurrent calls;
   confirm the next call's canary records exactly one failure and per-target serialization prevents
   a burst.
9. Force/mock an old -> new -> old Destination Service sequence and confirm the rejected old HMAC
   remains locally blocked during its 15-minute retention window.

### Role and client matrix

Repeat with Viewer, Data Viewer, SQL, and Admin role collections:

- Viewer: read tools only;
- Data Viewer: read + allowed data operations;
- SQL: read/data/SQL where destination and instance allow them;
- Admin: same mutation-free tool ceiling plus detailed `SAPTargets` diagnostics.

Smoke-test at least one general MCP client end to end after token/catalog cache reset. Existing
client-specific PP/OAuth coverage does not need to be duplicated for every client because the Basic
choice occurs behind the same MCP transport.

### Secret and operational review

1. Use unique sentinel username/password strings.
2. Inspect CF application logs, BTP Audit Log, MCP errors, `SAPTargets`, health, crash output, and
   support diagnostics for those sentinels.
3. Confirm no secret appears.
4. Confirm one non-rolling CF app instance, expected semaphore/rate-limit behavior, and no
   cross-target blocking.
5. Confirm changing URL/client/policy without restart fails closed as drift, while password-only
   rotation does not.
6. Run a clean `npm ci` and MTAR build and confirm `@arc-mcp/xsuaa-auth` resolves from the published
   npm version rather than a local path.

## Documentation Acceptance Criteria

The quick start must answer, in order:

1. When should I use PP versus Basic?
2. Which instance flag enables Basic?
3. Which exact destination fields are required?
4. Which identity will SAP see?
5. Which tools/scopes are possible?
6. Why must the app remain at one instance?
7. How do I rotate a password and retry without restart?
8. What still requires restart?
9. How do I diagnose quarantine or blocked credentials with Admin `SAPTargets`?
10. How do I disable/roll back Basic safely?

The administration guide must include a prominent matrix:

| Property | PP target | Basic target |
|---|---|---|
| SAP identity | individual propagated user | shared technical user |
| SAP authorization | per user | same for all callers |
| SAP-native attribution | individual | technical user |
| ARC-1 audit attribution | individual caller + target | individual caller + target + shared mode |
| Recommended for production | yes | only as documented compatibility exception |
| Multi-target writes | no | no; may remain unsupported permanently |
| Credential rotation | PP/certificate lifecycle | hot destination User/Password lookup; use a second user for zero downtime or accept a same-user consistency window |
| CF instances | existing PP contract | exactly one non-rolling process for Basic beta |

## Compatibility and Rollback

- Default-off means existing installations do not change.
- Existing PP destination properties and route IDs do not change.
- Existing single-target Basic `/mcp` behavior does not change.
- XSUAA scopes, roles, role collections, and OAuth negotiation do not change.
- Reader `SAPTargets.identity` is an additive change to an experimental tool result.
- Removing/unsetting `ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH` and restarting quarantines Basic targets
  while PP targets remain active.
- Removing a Basic destination or changing its non-secret configuration still requires restart
  because the registry snapshot is immutable.
- If dependency release is delayed, do not work around it by copying a raw Destination Service
  fetch into ARC-1. Hold the ARC implementation until the body-free Find error contract is available.

## Pull Request and Rollout Sequence

1. Open and merge/release the scoped `@arc-mcp/xsuaa-auth` hardening PR.
2. Add ADR-0007 and the ARC-1 implementation on the existing multi-target feature branch while the
   feature is still experimental, unless maintainers prefer a stacked PR for review clarity.
3. Keep Basic disabled in the first deployment and run the complete PP regression baseline.
4. Enable Basic on the beta application only, with one disposable least-privilege technical user.
5. Complete live lockout/rotation, role matrix, secret scan, and mixed-target tests.
6. Update the PR with evidence and remaining limitations before customer CF testing.
7. Customer test deployment remains explicit opt-in and one instance.
8. Promote the flag as experimental on `main` only after the acceptance checklist passes.

## Definition of Done

The feature is complete only when all of the following are true:

- ADR-0007 is accepted and ADR/spec/docs agree;
- the new flag is default-off and PP-only behavior is regression-tested;
- mixed PP/Basic targets work on pinned and aggregate endpoints;
- Basic is OnPremise-only and structurally mutation-free;
- bad/expired credentials cannot create a concurrent authentication burst;
- credential rotation recovers without app restart;
- all other destination drift remains fail-closed until restart;
- reader/admin catalog and MCP instructions identify shared identity correctly;
- human caller/target correlation remains in audit without secret or technical-user leakage;
- one-instance deployment is documented and descriptor-tested;
- no new XSUAA role/scope or target ACL is introduced;
- automated tests and the live PP/Basic acceptance matrix pass; and
- ARC-1 exactly pins the published `@arc-mcp/xsuaa-auth` release that includes bounded BTP request
  timeouts, and a clean install/MTAR build proves the lockfile does not resolve a local dependency;
- end-user documentation makes the non-recommended shared-identity limitation impossible to miss.

## Plan Review Record

The 2026-07-20 second pass checked this plan against the current destination lookup, PP runtime,
feature probing, ADT HTTP retry, tool-error, catalog, audit, and MTA code paths. It made these
implementation-significant corrections:

1. **401 retry:** the existing ADT client retries a 401 once, so Basic needs an internal
   `retryUnauthorized=false` path or the promised one-attempt guard would be false.
2. **Expired credentials:** feature probes and some tools fan out; Basic now uses a serialized
   per-call canary instead of relying only on a one-time healthy state.
3. **Discovery secrecy:** Destination collection APIs may omit/mask protected fields; startup does
   not derive credential presence or quarantine from them. Authoritative Find validates credentials
   and supports hot recovery.
4. **Dependency errors:** Find must reuse the body-free token wrapper as well as return body-free
   request/parse errors.
5. **Error semantics:** current multi-target errors say “propagated user”; the classifier must receive
   identity mode so Basic failures describe the shared technical user correctly.
6. **Catalog integrity:** mutable runtime Basic health stays outside the immutable registry and is
   joined only for admin output.
7. **SAML false-positive:** the Basic canary forces on-premise SAML suppression and rejects HTML/invalid
   discovery responses without assuming one exact SAP-release MIME type.
8. **Rotation race:** the target gate begins before Destination Find and recently blocked HMAC
   generations survive an old/new/old propagation sequence in a bounded 15-minute/four-entry set.
9. **Process scope:** the guard is created once at application startup and injected into every fresh
   pinned/aggregate MCP server factory.
10. **Queue safety:** the per-target wait queue is capped at 32 with a 30-second acquisition timeout;
    v1 deliberately makes no disconnect-cancellation promise.
11. **Dependency release:** customer/BTP evidence is blocked until the hardened dependency is
    published and the ARC lockfile references that registry release.
12. **Success secrecy:** successful Find projections strip credential/secret properties, and
    authentication HTTP 401/403 bodies are not logged or audited.

No further product decision is blocking implementation. Exact discovery response evidence and
technical-user authorization details still require live validation on 7.50, 7.58, and 8.16 as part
of the acceptance plan; those are tests, not unresolved architecture choices.

## Deferred Work

- Basic authentication for Internet/Private Link destinations;
- more than one CF app instance with a distributed credential-attempt budget;
- dynamic non-secret destination reconfiguration without restart;
- target-specific XSUAA roles or entitlement-driven target visibility;
- per-user availability caching;
- SaaS/provider/subscriber discovery;
- a secondary design-time destination;
- multi-target writes, activation, transport/Git mutations, SAP-backed lint formatter/settings
  actions, or dedicated ATC/ABAP Unit workload grants/quotas; and
- allowing Basic shared identities on any future mutation-capable multi-target design.
