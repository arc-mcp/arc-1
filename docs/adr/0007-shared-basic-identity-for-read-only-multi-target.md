# ADR 0007 — Shared Basic Identity for Read-Only Multi-Target

**Status:** Accepted — Experimental, default-off, and subject to the one-instance ceiling
**Date:** 2026-07-20
**Related:** [ADR-0006](0006-experimental-read-only-multi-target.md),
[implementation plan](../plans/destination-discovered-multi-target-v1.md)
**Qualifies:** ADR-0006's strict Principal Propagation requirement for explicitly enabled Basic
destinations only

## Context

Principal Propagation is the preferred multi-target identity model because SAP sees the real user
and applies that user's SAP authorizations. Some read-only customer landscapes cannot provide PP
for every system/client, but already operate reviewed, least-privileged BasicAuthentication BTP
destinations. Requiring one ARC-1 deployment per such destination would remove much of the
operational value of multi-target v1.

Basic Authentication changes the security boundary: XSUAA still identifies and authorizes the MCP
caller, but SAP sees one shared technical user. SAP logs therefore cannot attribute an operation to
the human without ARC-1 audit correlation. Destination credentials also become runtime secrets
whose rotation must not cause cross-target or cross-credential reuse.

## Decision

Multi-target v1 may accept an on-premise BTP destination with
`Authentication=BasicAuthentication` only when all of these conditions hold:

- the deployment owner explicitly sets `ARC1_MULTI_TARGET_ALLOW_BASIC_AUTH=true`; the default is
  false;
- the destination remains an enabled HTTP/OnPremise subaccount destination with explicit
  `sap-sysid` and `sap-client`, the existing recommended-description/fallback contract, and the
  same read/data/SQL policy contract as PP targets;
- `User` and `Password` come only from the uncached Destination Find response at request time and
  are never copied into the immutable registry, diagnostics, logs, audit payloads, errors, or
  feature-cache keys;
- `Preemptive` is absent or `true`; an explicit `false` is quarantined because challenge-driven
  authentication is not part of the v1 contract;
- exactly one accepted Basic destination claims a physical URL/client/Cloud Connector location;
  aliases cannot duplicate that shared credential path, and an actually shared bare `/mcp`
  connection cannot overlap it;
- XSUAA still authenticates the human and requires global read before target resolution; every
  authorized caller to that target then reaches SAP as the same technical user;
- there is no PP-to-Basic or Basic-to-PP fallback, and no destination-level target ACL;
- multi-target routes remain structurally mutation-free. Basic targets can expose source reads and,
  with the existing dual instance/destination consent plus XSUAA/SAP authorization, data and SQL;
  and
- an application with Basic multi-target enabled runs exactly one non-rolling CF app instance in v1.

PrincipalPropagation destinations retain strict per-user PP. PP and Basic targets may coexist in
one registry and are identified as `per-user` and `shared` respectively in `SAPTargets` and audit
context. `identity` is the compact active-target contract. Admin output adds only a passive,
secret-free `admin.sharedAuthentication` summary with aggregate counts and at most eight
exceptional targets; it never probes SAP or returns credentials.

The shipped MTA keeps one instance, startup warns about the restriction, and deployment tests/docs
require stop/start deployment without rolling or blue/green overlap. These are operator contracts;
a CF process cannot prove the application's desired scale from
`CF_INSTANCE_INDEX`. Within that one process, exactly one runtime guard is shared by all routes and
MCP transports. Before a Basic SAP request, ARC-1 resolves the exact destination, verifies its
non-secret snapshot fingerprint, and serializes credential-generation validation with the request.
The generation is represented only by a keyed digest. Recently superseded generations remain
blocked for 15 minutes in a bounded set so an eventually consistent old/new/old Destination response
cannot re-admit an older password. A credential change can therefore take effect on the next
request without a restart; every non-secret destination change remains restart-bound. Basic
authentication is attempted once per request and is not retried automatically with another
credential generation.

All Basic-auth response paths use the same centralized authentication classifier. Client-facing
errors and audit events contain a request ID, target, human XSUAA subject, shared-identity marker,
and safe failure code, but no authorization header, credential, raw SAP login response, or HTML
body. The authentication canary accepts the namespace-correct AtomPub service root, including the
valid empty service returned by SAP_BASIS 758. Only conclusive authentication or authorization
evidence (401/login behavior or a structured ADT authorization 403) blocks a credential generation;
an unrecognized non-login 2xx response fails closed but remains retryable.
Successful feature evidence is cleared when the credential generation changes.

## Security and operating requirements

- Use a dedicated communication/technical SAP user with only the ADT read permissions required by
  the enabled ARC-1 actions. Never use a dialog administrator or `SAP_ALL`.
- Prefer a separate technical user per SAP client and security boundary. Passwords should be strong
  ASCII values; usernames must not contain a colon or surrounding whitespace.
- Treat destination-admin access as credential-admin access. Restrict it, audit changes, rotate
  credentials regularly, and test the documented hot-rotation procedure.
- Keep data preview and SQL disabled unless separately approved. A shared user makes their SAP-side
  attribution shared as well.
- Do not use this exception where per-user SAP attribution or target-specific SAP authorization is
  required. Use PP or separate ARC-1 instances instead.

## Consequences

- A single read-only multi-target application can cover mixed PP and Basic-only on-premise systems.
- XSUAA remains useful: it authenticates the human, supplies ARC-1 scopes, rate limits, and audit
  identity, even though it cannot change the shared SAP identity.
- Operators must correlate ARC-1 audit records with SAP technical-user activity for investigations.
- Horizontal CF scaling is unsupported whenever Basic multi-target is enabled; PP-only deployments
  retain ADR-0006's existing behavior.
- Basic targets remain unsuitable for future writes. Adding multi-target writes requires a new ADR
  and may prohibit Basic Authentication entirely.

## Rejected alternatives

- **Implicitly accept Basic destinations:** a shared identity must be a conscious deployment-wide
  security decision, not a destination-admin side effect.
- **Fallback from failed PP to Basic:** this could silently replace a human identity with a more
  privileged shared user.
- **Cache plaintext credentials in target runtimes:** this expands secret lifetime and makes safe
  rotation and diagnostics harder.
- **Allow challenge-driven or repeated Basic attempts:** this increases backend login attempts and
  complicates deterministic credential-generation handling.
- **Support multiple CF instances immediately:** process-local generation guards cannot coordinate
  safe rotation across instances without a new shared-state design.
