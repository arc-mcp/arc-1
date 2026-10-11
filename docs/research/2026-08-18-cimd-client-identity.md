# CIMD client identity for the ARC-1 OAuth proxy

**Status:** Research and architecture recommendation, refined through implementation. T1–T3 are
delivered on companion branches, pending review; see [Implementation
roadmap](#implementation-roadmap).

**Date:** 2026-08-18

**Roadmap:** SEC-16 (proposed); materially changes the cost case for [SEC-15](../../docs_page/roadmap.md#sec-15)

**Trigger:** MCP specification revision **2026-07-28** formally deprecates RFC 7591 Dynamic Client
Registration in favour of **Client ID Metadata Documents** (SEP-991), with a deprecation window of
at least twelve months.

**Related research:** [Durable OAuth DCR signing-key lifecycle](2026-07-31-durable-dcr-signing-key-lifecycle.md)

## Executive conclusion

CIMD makes the `client_id` an HTTPS URL that the client hosts and the authorization server fetches.
For ARC-1 this is not a like-for-like replacement of stateless DCR (SEC-09). It trades one problem
for a different one:

- **What it removes:** client identity stops depending on ARC-1's HMAC signing key. A CIMD
  `client_id` is a stable URL, so it survives key rotation, `cf deploy`, rebinding, and every event
  SEC-15 exists to defend against. It is the structural exit from "the signing key is the
  registration database".
- **What it adds:** an authorization server that performs an **unauthenticated outbound HTTPS fetch
  to a URL chosen by an unauthenticated caller**, on a code path (`/authorize`) reachable before any
  user has authenticated. ARC-1 has never had such a primitive.

The second point dominates the risk assessment, and it is sharper for ARC-1 than for a generic
authorization server: ARC-1 is deployed on BTP Cloud Foundry beside a **Cloud Connector** whose
entire purpose is to make otherwise unreachable on-premises SAP networks reachable from the
application. An SSRF primitive in this process is not "read the cloud metadata endpoint" — it is
potentially "reach the customer's on-premises landscape". The hardened fetcher is therefore not a
supporting task for this project; it *is* the project, and everything else is wiring.

We recommend:

- **Add CIMD beside DCR, remove nothing.** DCR stays for the full deprecation window.
- **Disambiguate on the parsed URL, not a raw-string prefix**, and never fall back from a failed
  CIMD resolution to the DCR path.
- **Put the resolution in `@arc-mcp/xsuaa-auth`**, where `getClient`, `checkRedirectUri` and the
  redirect-URI canonicalization already live. Splitting client identity across two repositories
  would recreate exactly the drift the AGENTS.md playbook §3 warns about.
- **Ship the SSRF-hardened fetcher first and alone**, reviewed on its own merits, before any
  resolution code exists to call it.
- **Default the whole feature off**, with an optional host allowlist for customers whose egress
  policy requires one — but do not make the allowlist mandatory, because a server that must list
  every client in advance has reimplemented registration with extra steps.
- **Bound SEC-15 to its cheap phases.** CIMD removes the registration-database role of the signing
  key. Building a key ring with rolling rotation (SEC-15 Phase 3) to protect a population that is
  migrating away over twelve months is investment in the wrong place.

Two findings from source inspection changed the design and are not in the original brief; both are
detailed in [Normative requirements](#normative-requirements) and
[Conflicts between the draft and the SDK](#conflicts-between-the-draft-and-the-sdk):

1. **The SDK does not match redirect URIs the way the draft demands.** The MCP SDK's `/authorize`
   handler applies RFC 8252 loopback port relaxation; the CIMD draft requires exact simple string
   comparison. ARC-1's own `/oauth/callback` check is exact. CIMD makes this latent inconsistency
   load-bearing, because a hosted document cannot enumerate a native client's ephemeral port.
2. **Two of the three store changes are already true by construction.** `ensureRedirectUri` returns
   early for any client that is not the pre-registered XSUAA client, and `checkRedirectUri`'s generic
   branch already delegates to `getClient` and compares exactly. Correct CIMD behaviour on both falls
   out of a correct `getClient`; they need tests and comments, not logic.

## Decision requested

Maintainers need to settle five questions before implementation. Our recommendation is in bold.

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q1 | How is a CIMD `client_id` told apart from a DCR one? | Raw `startsWith('https://')` · **parsed-URL classification** · a new explicit parameter | **Parsed URL**, fail-closed, no fallback |
| Q2 | Where does resolution live? | **`@arc-mcp/xsuaa-auth`** · `arc-1` · split | **Package**, minor version, additive |
| Q3 | Which clients are admitted? | Any HTTPS URL · **any, with an optional host allowlist** · allowlist mandatory | **Optional allowlist, empty by default** |
| Q4 | How is the document cached? | None · **per-instance bounded LRU** · shared store | **Per-instance LRU**, RFC 9111 aware, clamped |
| Q5 | When is `client_id_metadata_document_supported` advertised? | Always · **only when CIMD is enabled** | **Only when enabled** — advertise ⟺ resolve |

Q3 is the one that is genuinely a product decision rather than an engineering one, because it
decides whether ARC-1's CIMD support is open (the spec's intent: any client, no pre-arrangement) or
curated (an enterprise's intent: only clients we chose). We recommend shipping the mechanism for
both and defaulting to open-once-enabled, for the reason developed in
[Q3 — admission policy](#q3--admission-policy): admitting a client identity is not an authorization
decision in ARC-1's architecture.

## Scope and non-goals

**In scope:** resolving an HTTPS-URL `client_id` to an `OAuthClientInformationFull`; validating the
fetched document; the outbound fetch and its hardening; caching; the metadata flag; configuration,
audit, rate limiting, and documentation for the above.

**Explicit non-goals**, all of which are out of scope for this project and must not be changed by it:

- **No DCR removal.** Stateless DCR (SEC-09) keeps working unchanged for the full deprecation
  window. This project adds a second path; it does not deprecate the first.
- **No change to the KDF labels or the client-id prefix.** `arc1-`, `arc1-dcr/v1`, and
  `arc1-oauth-state/v1` are on-the-wire contracts. Changing any of them invalidates every cached
  registration in the field.
- **No persistent store.** No database, no shared cache, no registration table.
- **No change to XSUAA token signing or validation**, SAP principal propagation, the MCP scope
  policy (`src/authz/policy.ts`), the safety ceiling, or any ADT gate.
- **No new outbound reachability for anything other than CIMD documents.** The fetcher is
  single-purpose and must not become a general HTTP utility for the rest of the codebase.
- **No fetching of URLs found inside a document** (`logo_uri`, `jwks_uri`, `client_uri`, …). The
  draft requires SSRF protection for them; ARC-1 answers by never dereferencing them at all.

**Deliberately deferred** (see [T4](#t4--unified-redirect-policy-measure-first)): unifying the
redirect-URI pattern policy across the default, DCR, and CIMD client families. It is a real
hardening opportunity and a real regression risk, and it needs measurement before design.

## Evidence method and confidence

We inspected the working copies of both repositories at `ClementRingot/arc-1` (`aa240db`,
v1.1.0) and `ClementRingot/xsuaa-auth` (v1.0.2), the `@modelcontextprotocol/sdk` sources at tag
`1.30.0`, the npm registry metadata for that package, and the IETF draft source. We did not deploy,
did not run a live OAuth flow, and did not modify either repository.

Labels used throughout, matching the SEC-15 document:

- **Observed** — confirmed in source or a primary specification text.
- **Inferred** — follows from observed behaviour but needs a live test to confirm.
- **Proposed** — a recommended design, not current behaviour.

**A caveat on source access.** The research environment's egress policy blocks
`modelcontextprotocol.io`, `datatracker.ietf.org`, `drafts.oauth.net`, `oauth.net`, and `ietf.org`.
The IETF draft was therefore read from the working group's GitHub source
(`oauth-wg/draft-ietf-oauth-client-id-metadata-document`) and the MCP spec from secondary
summaries plus the SDK implementation. The draft quotations below are verbatim from that source and
we assess them as reliable, but **the exact revision and its normative text must be re-confirmed on
datatracker before implementation begins**, and the MCP specification's own CIMD section must be
read directly rather than through this document.

The largest remaining uncertainty is behavioural, not textual: how real MCP clients that support
CIMD (Claude, VS Code, Copilot) actually populate `redirect_uris` in a static hosted document when
they are native applications with ephemeral loopback ports. That determines whether
[the redirect-matching conflict](#conflicts-between-the-draft-and-the-sdk) is an edge case or the
main compatibility story, and it is the first thing the experiment matrix measures.

## Current architecture

### Observed — where client identity is resolved today

```mermaid
flowchart TB
  C["MCP client"] -->|"GET /authorize?client_id=…"| RL["auth rate limiter<br/>20/min/IP"]
  RL --> MW["arc-1 /authorize middleware<br/>query→body merge<br/>ensureRedirectUri()"]
  MW --> SDK["SDK authorize handler"]
  SDK -->|"getClient(client_id)"| ST["StatelessDcrClientStore"]
  ST --> X{"client_id kind"}
  X -->|"== XSUAA binding id"| DEF["pre-registered default client"]
  X -->|"starts with arc1-"| VER["HMAC verify + TTL → payload"]
  X -->|"anything else"| U["undefined + audit"]
  SDK --> AUTHZ["provider.authorize()"]
  AUTHZ -->|"302 with proxy state"| XSUAA["XSUAA /oauth/authorize"]
  XSUAA -->|"302 code"| CB["arc-1 /oauth/callback<br/>checkRedirectUri()"]
  CB -->|"302 code to client"| C
```

**Observed** (`xsuaa-auth/src/dcr-client-store.ts:200`): `getClient` resolves in three steps —
exact match against the pre-registered XSUAA client, then a `startsWith(this.idPrefix)` gate
(`arc1-`), then HMAC verification and TTL. Anything else returns `undefined` after emitting
`oauth_client_lookup_failed` with a structured reason. The method is already `async`, so an
outbound fetch fits the signature without a breaking change.

**Observed** (`dcr-client-store.ts:313`): `ensureRedirectUri` begins
`if (clientId !== this.xsuaaClient.client_id) return;`. It is already a no-op for every non-default
client, DCR and CIMD alike.

**Observed** (`dcr-client-store.ts:354`): `checkRedirectUri` returns the allowlist verdict for the
default client, and for everything else calls `getClient` and tests
`info.redirect_uris.includes(uri)` — an exact string comparison.

**Observed** (`xsuaa-auth/src/oauth-provider.ts:114`): the `authorize` override consumes only
`_client.client_id` (sealed into the proxy state token) and the request parameters. It does not read
`client_secret` or `redirect_uris`. A CIMD client therefore flows through the XSUAA proxy unchanged,
and `params.resource` (RFC 8707) is already forwarded.

**Observed** (`dcr-client-store.ts:252`, `payloadToClientInfo`): a client whose
`token_endpoint_auth_method` is `none` is reported with no `client_secret`, because the SDK's token
endpoint demands a secret whenever `getClient` reports one. CIMD clients are public by definition —
the draft forbids `client_secret_post`, `client_secret_basic`, and `client_secret_jwt` — so they
take the identical code path that Cursor and VS Code already exercise. **No new token-endpoint
behaviour is required.**

### Observed — the two-repository split

| Repository | Owns |
|---|---|
| `arc-1` | Express wiring, OAuth metadata documents, rate limiting, audit, configuration, docs |
| `@arc-mcp/xsuaa-auth` (v1.0.2) | `StatelessDcrClientStore`, the XSUAA proxy provider, redirect-URI validation, state codec, callback handler |

`arc-1` pins `^1.0.2` and passes `clientIdPrefix: 'arc1-'`, `dcrKdfLabel: 'arc1-dcr/v1'`,
`stateKdfLabel: 'arc1-oauth-state/v1'` into `createXsuaaOAuthProvider` (`src/server/http.ts:419`).
Both repositories are accessible and modifiable in the current working environment.

### Observed — what the SDK provides and what it does not

At tag `1.30.0`, and `1.30.0` is still the `latest` dist-tag on npm:

- `shared/auth.ts` — `client_id_metadata_document_supported` **exists** in the metadata schemas.
- `client/auth.ts` — the **client side is implemented**. A client uses a URL `client_id` only when
  `metadata.client_id_metadata_document_supported === true` **and** the provider supplies a
  `clientMetadataUrl`; otherwise it silently falls back to DCR. It additionally requires
  `protocol === 'https:' && pathname !== '/'`.
- `server/auth/router.ts` — the **server side is not implemented**. `createOAuthMetadata` never
  emits the flag, and no code path resolves a URL-shaped `client_id`.
- `server/auth/handlers/authorize.ts` — `client_id` is validated as bare `z.string()`. **There is no
  format constraint that would reject a URL**, and the handler passes it straight to
  `clientsStore.getClient`.

Two consequences follow directly:

1. **Until ARC-1 advertises the flag, no client will ever attempt CIMD.** The SDK client
   deliberately falls back to DCR. Nothing else in this project has any observable effect until the
   metadata changes, which makes the metadata the true feature switch.
2. **`getClient` is the only integration point required.** The SDK will hand a URL `client_id`
   through unmodified. No fork, patch, or handler replacement is needed.

### Observed — the metadata asymmetry

`arc-1` serves a hand-built `customAuthMetadata` object **only when `basePath` is non-empty**
(`src/server/http.ts:642`), i.e. behind a path-prefixing proxy such as SAP API Management. At the
root path the document comes from the SDK's `mcpAuthRouter` (`http.ts:711`), which cannot emit the
flag. Advertising CIMD in every deployment mode is therefore a change to `arc-1`, and it is the one
change without which nothing else activates.

**The mechanism already exists in-tree.** The prefix-mode override works by registering its `app.get`
handlers *before* `mcpAuthRouter`, so they win Express's route match — the code says so explicitly.
And `arc-1` already imports the SDK's `metadataHandler` for the OIDC path (`http.ts:898`), which
supplies `cors()` and GET/OPTIONS-only handling. Combined with the fact that `createOAuthMetadata`
is **exported** from `server/auth/router.js`, this yields a drift-free root-mode fix:

```text
metadata = { ...createOAuthMetadata({…same args as mcpAuthRouter…}),
             client_id_metadata_document_supported: true }
app.use('/.well-known/oauth-authorization-server', metadataHandler(metadata))   // before mcpAuthRouter
```

The document stays derived from the SDK rather than hand-copied, so a future SDK field addition is
inherited instead of silently dropped.

### Observed — the outbound-fetch gap, and the prior art that partially fills it

There is no SSRF-hardened outbound HTTP client. `src/server/safe-http-client.ts` is unrelated: it
gates plugin writes to ADT paths.

The brief called the fetcher entirely net-new. That is very nearly right, with one useful
correction: `src/adt/abapgit.ts:162` already implements `literalHostIsPrivate()` and
`validateGitRemoteUrl()`, which enforce HTTPS-only, reject userinfo, and block loopback,
link-local, RFC 1918, CGNAT, and **both textual forms of IPv4-mapped IPv6** (`::ffff:127.0.0.1` and
the WHATWG-canonicalized `::ffff:7f00:1`). That is a tested, non-obvious core worth reusing.

What it does **not** do, and what the CIMD fetcher must add, is the entire difference between
validating a *string* and validating a *connection*: it inspects a literal hostname only, never
resolves DNS, never inspects the resolved address, and never pins the connection. For abapGit that
is adequate — SAP makes the outbound call, not ARC-1. For CIMD it is not, because ARC-1 makes the
call itself.

## Normative requirements

Quotations are verbatim from the working-group source of
`draft-ietf-oauth-client-id-metadata-document`, revision **-02** (history: -00 initial; -01 added
metadata-change security considerations, the HTTP 200 requirement, and SSRF considerations; -02
clarified the SSRF loopback exception, strengthened authentication recommendations, and renamed
"client identifier" to "Client Identifier URL"). SEP-991 references the earlier individual draft
`draft-parecki-oauth-client-id-metadata-document-03`; **confirm which revision the MCP 2026-07-28
specification normatively cites before implementing.**

### From the IETF draft

| # | Requirement | Text |
|---|---|---|
| N1 | Identity binding | "The Client ID Metadata Document MUST contain a `client_id` property whose value MUST match the Client Identifier URL, which MUST also match the URL that the authorization server used to fetch the document; comparisons MUST be made using simple string comparison." |
| N2 | Scheme | A Client Identifier URL "MUST use the `https` URL scheme" |
| N3 | Userinfo | "MUST NOT contain a userinfo component" |
| N4 | URL shape | Path component required; no single/double-dot path segments; no fragment; query discouraged; ports permitted **without normalization** (`https://x/c` ≠ `https://x:443/c` under N1's string comparison) |
| N5 | Redirect URIs | "The authorization server MUST require registration of redirect URLs, and MUST ensure that the redirect URL in an authorization request is an exact match, using simple string comparison, of a registered redirect URL." |
| N6 | SSRF | "Authorization servers MUST NOT fetch a Client ID Metadata Document URL **or any URLs contained within a Client ID Metadata Document** that resolve to special-use IP addresses as defined in RFC6890." |
| N7 | HTTP status | "The Client ID Metadata Document MUST be served with a 200 OK HTTP status code. The authorization server MUST treat all other HTTP status codes as an error response." |
| N8 | Size | "Authorization servers SHOULD limit the amount of data they read and process… The recommended maximum size to read is 5 kilobytes." |
| N9 | Caching | "The authorization server SHOULD respect HTTP cache headers [RFC9111] when caching client metadata, but MAY define its own upper and/or lower bounds on an acceptable cache lifetime as well." |
| N10 | Content type | JSON; "MAY also be served with more specific content types as long as the response is JSON" |
| N11 | Metadata fields | RFC 7591 registry values |
| N12 | No symmetric secrets | `client_secret_post`, `client_secret_basic`, and `client_secret_jwt` are forbidden |

Two absences matter. **The draft says nothing about `application_type`** — despite the brief listing
it as a draft concern, it is an MCP-layer (SEP-837) question, not an IETF one. And **the draft gives
no DNS-rebinding or connection-pinning guidance**; N6 is expressed in terms of resolution outcome,
not connection identity. The pinning requirement in this design is therefore a deliberate hardening
*beyond* the specification, adopted because validate-then-connect is a textbook TOCTOU, and it
should be documented as such rather than presented as compliance.

### From MCP 2026-07-28

- The authorization server advertises `client_id_metadata_document_supported: true`.
- DCR is deprecated, not removed; the deprecation policy guarantees at least twelve months.
- **RFC 9207** (`iss` validation) and **RFC 8707** (resource indicators) are hardened requirements —
  but both are obligations on the **client**. ARC-1's server-side duty is to keep forwarding
  `resource` (already done, `oauth-provider.ts:165`) and to ensure its metadata `issuer` is correct
  (already correct in both modes). **Neither is work created by this project**; the brief listed
  them as validations to implement, and they are not.
- SEP-991 is CIMD. **SEP-2352 is a different SEP** — credential binding, requiring clients to key
  stored credentials by issuer and re-register when the authorization server changes. The brief
  conflated the two. It is relevant context (it is the client-side counterpart of the same
  durability problem) but it creates no server-side requirement here.

### Conflicts between the draft and the SDK

**Finding, Observed.** N5 requires exact simple string comparison. The SDK's authorize handler
instead applies RFC 8252 loopback relaxation: "Port relaxation only applies when both URIs target a
loopback host… scheme, host, path, and query must still match exactly." ARC-1's own
`checkRedirectUri` at `/oauth/callback` uses `Array.includes` — exact.

So a native client that registers `http://127.0.0.1:5000/cb` and authorizes on
`http://127.0.0.1:61234/cb` passes `/authorize` and then **fails at `/oauth/callback`**. This
inconsistency exists today for DCR clients, where it is nearly unreachable: a DCR client registers
immediately before authorizing, in the same run, with the port it just bound.

CIMD makes it reachable, because a *hosted, static* document is written once and cannot know the
ephemeral port of a future run. Any native MCP client using loopback redirects hits this on every
authorization.

**Resolution — revised during T2 implementation.** The original proposal was to let the document's
`application_type` choose the rule: relaxation for `native`, exact comparison otherwise. Reading the
SDK's `redirectUriMatches` at 1.30.0 showed that to be wrong. The SDK applies the relaxation
**unconditionally** whenever both URIs are loopback; it never consults `application_type`. Gating on
it here would therefore make `/oauth/callback` *stricter* than `/authorize` for a `web` document
that lists a loopback URI — reintroducing exactly the disagreement the alignment exists to remove.

What shipped instead is a byte-for-byte mirror of the SDK's comparison, applied to CIMD and DCR
clients alike:

- Exact string equality, **or** — when both URIs target a loopback host (`localhost`, `127.0.0.1`,
  `[::1]`) — equality of scheme, host, path and query with the **port** free.
- `localhost` does not cross-match `127.0.0.1`; relaxation never applies to a non-loopback URI.
- `application_type` is parsed and recorded for observability, and obeyed by nothing.

**SEP-837 independently supports this.** The release-candidate post describes it as making clients
declare `application_type` during DCR *"so authorization servers stop rejecting `localhost`
redirects for desktop and CLI apps"* — i.e. the failure mode the MCP working group is legislating
against is an authorization server being **too strict** with loopback redirects for native clients.
Unconditional relaxation cannot commit that error. Gating on a declaration the SDK never transmits
could. The reversal therefore lands on the safer side of the SEP's own intent, and the fact that
SEP-837 attaches `application_type` to *DCR* rather than to CIMD is a further reason not to make
CIMD behaviour depend on it.

Applying it to DCR clients too is a deliberate widening of `checkRedirectUri`, which previously used
a bare `Array.includes`. It is safe in the strict sense that it cannot admit anything `/authorize`
had not already accepted: the authorization code has by then been minted for that exact URI, so
refusing it at the callback prevented no disclosure and merely dropped the code on the floor.

This is a conscious, documented deviation from N5's unqualified "exact match", justified by RFC 8252
§7.3, which is the long-standing OAuth answer for native applications and is what the SDK, and
therefore the wider MCP client ecosystem, already implements. The alternative — strict N5 — is
specification-pure and breaks every native client, which is most of them. Flag this to the working
group if the final MCP text does not already carve it out.

## Required invariants

Any implementation must satisfy all of these.

### Security

1. The fetch is unauthenticated. No cookies, no `Authorization` header, no ambient credential, no
   proxy credential, no client certificate.
2. Only `https` is dereferenced, in every environment including development. There is no
   "allow http for local testing" switch, because that switch is the vulnerability.
3. The connection is made to an IP address that was **validated and then pinned**. Validating a
   hostname and letting the stack re-resolve is a DNS-rebinding hole.
4. Every RFC 6890 special-use range is blocked in IPv4 and IPv6, including IPv4-mapped IPv6 in both
   textual forms, and including every hop of any redirect that is followed.
5. Nothing inside a fetched document is ever dereferenced.
6. Failure is closed and terminal. A `client_id` classified as CIMD that fails any check returns
   `undefined`; it never falls through to the DCR path, and it never yields a partially populated
   client.
7. Error messages returned to the caller never disclose resolved addresses, internal hostnames,
   ports, timing, or any other network-topology signal. Operators get detail in audit; callers get a
   generic failure.
8. A fetched document is untrusted input: strict schema validation, per-field length caps, bounded
   nesting, and no interpolation into a redirect target, log line, or HTML response without
   validation.
9. Redirect URIs from a document pass the existing `validateRedirectUri` / `matchesRedirectPattern`
   canonicalization. That code carries non-obvious fixes for authority-smuggling
   (`https://evil.com\@x.hana.ondemand.com/cb`) and must not be reimplemented.
10. Secrets never appear in logs, audit events, config output, or exceptions — unchanged from
    existing policy, restated because a new audit surface is being added.

### Reliability, cost, and abuse resistance

11. The fetch has a connect timeout, a global deadline, and a response-size cap enforced **while
    streaming**, never after buffering.
12. Concurrent resolutions of the same URL are coalesced into one in-flight request.
13. Total concurrent outbound CIMD fetches are capped process-wide, independent of the per-IP rate
    limit.
14. Failures are cached, so a hostile or broken URL cannot be replayed into unbounded outbound
    traffic.
15. Cache memory is bounded by an explicit entry count, and each entry is bounded by the size cap.
16. A CIMD outage degrades only CIMD. DCR, the default client, API-key auth, and OIDC are unaffected.

### Compatibility

17. DCR behaviour is bit-for-bit unchanged when CIMD is disabled, and unchanged for `arc1-` client
    ids when it is enabled.
18. The KDF labels, the client-id prefix, and the signed payload format are untouched.
19. `arc-1` continues to work against `@arc-mcp/xsuaa-auth` ^1.0.2 with CIMD unavailable; CIMD
    requires ^1.1.0. The package's public API only grows.
20. The metadata flag is advertised **if and only if** resolution is enabled and will succeed for a
    well-formed document. Advertising without resolving pushes every capable client onto a path that
    is guaranteed to fail.

### Operability

21. Resolution outcome, failure reason, cache hit/miss, and admission rejection are auditable
    through the existing typed `AuditEvent` union.
22. The effective configuration — enabled, allowlist, TTL bounds — is observable without exposing
    anything sensitive, following the existing `sources.*` tracing.
23. An operator can tell from audit alone whether a given authorization used the default client,
    DCR, or CIMD. This is the measurement that drives the SEC-15 scope decision.

## Evaluation of options

### Q1 — disambiguation

| Option | Assessment |
|---|---|
| **A. Raw `clientId.startsWith('https://')`** | The brief's proposal. Correct in the common case and trivially cheap. But it is a raw-string decision, and this codebase learned the hard way — in `matchesRedirectPattern` — that raw-string decisions about URLs diverge from how the URL later parses. It also accepts `https://` with no path, which the SDK client would never mint. |
| **B. Parsed-URL classification (recommended)** | `new URL(clientId)` succeeds **and** `protocol === 'https:'` → CIMD branch. Everything else falls to the existing logic. Costs one parse on a path that is about to do a network fetch. Decides on the same canonical form the rest of the pipeline sees. |
| C. A separate request parameter | Not permitted; the spec puts the URL in `client_id`. Rejected. |

**Recommended: B.** Ordering within `getClient` is: (1) exact match on the XSUAA default client —
unchanged and first, since its id is a binding identifier such as `sb-arc1!t123` and can never
parse as an `https:` URL; (2) the CIMD branch; (3) the existing `arc1-` prefix path.

Collision analysis: `arc1-` and `https://` are disjoint by construction, and the XSUAA client id is
matched before either. **Observed** — no `client_id` currently issuable by ARC-1 can be
misclassified.

The essential property is not the test but what follows it: once classified CIMD, resolution is
**terminal**. A malformed document, a blocked address, a timeout, or an admission rejection returns
`undefined` with an audit reason. It must never re-enter the DCR branch, because a fallback path is
how a blocked fetch becomes an unblocked one.

### Q2 — where resolution lives

| Option | Assessment |
|---|---|
| **A. `@arc-mcp/xsuaa-auth` (recommended)** | `getClient` is the SDK's only hook, and it lives here. `checkRedirectUri`, `ensureRedirectUri`, `matchesRedirectPattern`, and `validateRedirectUri` are all here. Keeping the client-identity decision in one module means one place to review and one place to test. |
| B. `arc-1`, via an injected resolver | Keeps the SSRF surface in the repository with the security docs and the audit union. But it splits one decision across a package boundary: the package would still have to branch in `getClient` and call out. Two half-implementations, versioned independently. |
| C. Split — fetcher in `arc-1`, validation in the package | The worst of both: the security-critical half is remote from the logic that calls it, and the injection seam becomes an API that must be kept compatible across two release cadences. |

**Recommended: A**, with configuration and observability injected from `arc-1`. The package receives
an options object — enabled flag, allowlist, TTL bounds, size and timeout caps, a logger with the
existing `emitAudit` hook — and owns the fetch, validation, and cache. `arc-1` owns the configuration
surface, the audit type definitions, the metadata flag, the rate limiting, and the documentation.

This also respects the `check-file-sizes` ratchet: the new code lands as new modules in the package
(`cimd-fetch.ts`, `cimd-document.ts`, `cimd-cache.ts`), not as growth in `http.ts`.

**Version and merge plan.** `@arc-mcp/xsuaa-auth` **1.1.0** — additive, minor, default-off; no
existing signature changes, `StatelessDcrClientStore`'s constructor gains one optional options field.
Merge order: package PR first, publish 1.1.0, then the `arc-1` PR bumping to `^1.1.0` and wiring
configuration and metadata. Compatibility window: the package's 1.0.x line stays supported; an
`arc-1` on `^1.0.2` simply has no CIMD and advertises no flag. Per the brief's inter-repository
rule, **no package change is made until this plan is approved.**

### Q3 — admission policy

The question is whether ARC-1 accepts any HTTPS URL as a client identity or only listed ones.

The instinct in an SAP enterprise context is to require an allowlist. We recommend against making
it mandatory, for a reason specific to ARC-1's architecture rather than to OAuth generally:

**A `client_id` is not an authorization decision in ARC-1.** Resolving one yields a redirect target
and a display name. It grants nothing. Every actual grant is decided downstream by controls this
project does not touch: XSUAA authenticates the human and issues the token; ARC-1 checks MCP scopes
against `ACTION_POLICY`; the safety ceiling bounds writes, packages, SQL, transports, and Git;
principal propagation gives SAP the real user, whose own `S_DEVELOP` and `S_ADT_RES` authorizations
apply. A newly admitted client identity cannot exceed what the authenticated user could already do
through any other client. Making admission the gate would place a control where it adds friction
rather than where it adds security — and it would forfeit the single property that makes CIMD worth
adopting, which is that a client ARC-1 has never seen can complete a flow without pre-arrangement.

There are nonetheless two legitimate reasons a deployment wants a list, and both are about
something other than authorization:

1. **Egress policy.** A BTP subaccount may be contractually or technically forbidden from making
   arbitrary outbound calls to the public internet. The allowlist is an egress control.
2. **Phishing surface.** Anyone can host a document claiming `client_name: "SAP Support Tool"`.
   CIMD provides no identity assurance whatsoever — only domain control. Where an operator shows
   client names to users, or wants a closed set for audit, the list is the answer.

**Recommended:** `ARC1_CIMD_ENABLED` default **false**. When enabled, `ARC1_CIMD_ALLOWED_HOSTS` is
optional and **empty by default, meaning open**. When set, it is an exact-host or single-label
wildcard list (`claude.ai`, `*.vscode.dev`) matched against the parsed, lowercased host — never a
substring test. A non-empty list is enforced **before** the fetch, so a rejected host produces no
outbound traffic at all. Document prominently that `client_name` is attacker-chosen and must never
be presented as a trusted identity. This mirrors the curated model (Clerk's explicit per-URL
authorization) while defaulting to the spec's intent once an admin has opted in.

**One caveat, added after implementation.** This recommendation rests on address validation doing
the real SSRF work. That holds for a direct connection and for the tunnelled proxy path
(Option C), but it would not hold under an unpinned proxy fallback — see
[Proxied deployments](#proxied-deployments), where the allowlist would stop being optional and
become the only remaining control.

### Q4 — cache

Constraints: ARC-1 is stateless by design; the existing rate limiters are per-instance and in
memory (ADR-0004); the non-goals forbid a shared store.

**Recommended:** a per-instance bounded LRU, keyed by the **exact `client_id` string** — not a
normalized URL, because N1 mandates simple string comparison and normalizing here would let
`https://x/c` and `https://x:443/c` share an entry when the specification says they are different
identities.

| Parameter | Value | Rationale |
|---|---|---|
| Positive TTL | RFC 9111 `Cache-Control: max-age` / `Expires`, **clamped to [300 s, 3600 s]**; 900 s when absent | N9 explicitly permits bounds. The floor stops a hostile `max-age=0` from making every authorization a fetch; the ceiling bounds staleness after a client legitimately rotates its redirect URIs. |
| Negative TTL — validation failure | 300 s | Deterministic; re-fetching cannot change the verdict soon. |
| Negative TTL — transient (timeout, DNS, 5xx) | 30 s | Blunts amplification without pinning a client out through a brief outage. |
| Entry cap | 256, LRU eviction | With the 5 KiB document cap, bounded at well under 2 MiB. |
| Single-flight | Yes, keyed identically | Prevents a thundering herd, and stops a burst of identical `/authorize` calls from multiplying into outbound requests. |

**Multi-instance behaviour:** each instance caches independently. This is correct rather than merely
acceptable — the document is public, idempotent, and cheap to re-fetch, and divergence is bounded by
the TTL ceiling. It matches how per-instance rate limiting already behaves, and it keeps the
"no durable state" property that distinguishes this design from a registration database.

**Interaction with `ARC1_CACHE`:** none. That setting governs the SAP/ADT response cache and its
per-user isolation under principal propagation (`src/cache/cache-security.ts`). The CIMD cache holds
public, user-independent documents, must not be keyed by user, and must not participate in that
subsystem. Keeping them separate avoids a category error in which public metadata inherits per-user
isolation semantics it does not need, or worse, in which a user-scoped cache is consulted for a
value that is not user-scoped.

### Q5 — metadata advertisement

Advertise `client_id_metadata_document_supported: true` **only when CIMD is enabled**, in **all**
deployment modes. Root mode uses `createOAuthMetadata` + spread + `metadataHandler` mounted before
`mcpAuthRouter`; prefix mode adds the field to the existing `customAuthMetadata` object.

Advertising unconditionally would be actively harmful: an SDK client that sees the flag and holds a
`clientMetadataUrl` stops using DCR. If resolution is disabled, every such client breaks, and the
failure looks like a server bug rather than a configuration state.

## Decision matrix

Relative scores; 5 is strongest.

| Approach | Spec conformance | Security | Compatibility risk | Operability | Effort |
|---|---:|---:|---:|---:|---:|
| Do nothing (DCR only) | 1 | 5 | 5 | 5 | 5 |
| CIMD, open, no hardened fetch | 4 | **1** | 4 | 2 | 4 |
| **CIMD, default-off, hardened fetch, optional allowlist** | 5 | 4 | 4 | 4 | 2 |
| CIMD, mandatory allowlist | 4 | 5 | 2 | 3 | 2 |
| CIMD replacing DCR now | 2 | 4 | **1** | 4 | 3 |

"Do nothing" is a genuine option for the next few months and its cost is deferred, not avoided:
clients migrate to CIMD over the deprecation window, and ARC-1 keeps carrying the signing key as a
registration database, including the observed behaviour that GitHub Copilot does not re-register
after `invalid_client`.

## Threat model of the outbound fetch

This is the section that justifies the project's shape.

### What makes ARC-1's position unusual

A generic authorization server that gains an SSRF primitive can typically reach its own cloud
metadata endpoint and its provider's internal network. ARC-1's deployment target adds a step: on BTP
Cloud Foundry it runs beside a **Cloud Connector**, whose function is to make on-premises SAP
systems — the ones behind the customer's firewall — reachable from the application. The same process
also holds XSUAA credentials, may hold a shared Basic credential under ADR-0007, and sits inside a
subaccount's internal network.

An unauthenticated `/authorize` request that causes this process to fetch an attacker-chosen URL is
therefore the highest-value primitive an attacker could ask ARC-1 for. Every control below exists
because of that, and it is why [T1](#t1--the-hardened-fetcher-package) is reviewed and merged
before any code that calls it exists.

### TH1 — internal and metadata-service access

**Vector:** `client_id=https://169.254.169.254/latest/meta-data/iam/…`, `https://10.x.x.x/…`,
`https://<app>.apps.internal/…`, `https://kubernetes.default.svc.cluster.local/…`, or an internal
SAP host reachable only through the Cloud Connector.

**Controls:** N6 enforced over the full RFC 6890 set, IPv4 and IPv6, applied to the **resolved**
address rather than the literal; `.localhost`, `.internal`, `.local`, and `.svc.cluster.local`
suffixes refused; the response body is never returned to the caller in any form, so even a
successful internal fetch yields no data to the attacker beyond timing.

**Residual:** timing differences between "blocked" and "fetched but invalid" leak coarse liveness.
Mitigate by making all failure paths return the same generic error to the caller and by not
short-circuiting the response on address rejection.

### TH2 — DNS rebinding (TOCTOU)

**Vector:** the attacker's DNS answers with a public address for the validation lookup and a private
one for the connection, or uses a very low TTL to flip between them.

**Control:** resolve once; validate every returned address; connect to a **pinned** address with the
original hostname preserved for SNI and certificate verification. `undici`'s dispatcher `connect`
option supports this, and `undici` is already a direct dependency. Certificate validation is never
relaxed to accommodate pinning.

**This is the single most important control in the design**, because it is the one that the
specification does not ask for and that a reasonable implementation would omit.

### TH3 — redirects

**Vector:** a public URL that 302s to `http://169.254.169.254/…`. Classic and effective, because
validation usually happens once, on the original URL.

**Control:** **refuse redirects by default.** If a follow-mode is later added it must cap at 3 hops
and re-run the entire validation — scheme, host, allowlist, resolution, address check, pinning — on
each hop, and N1 still requires the document's `client_id` to equal the **original** URL, which
makes redirect-following of limited practical value. Starting with refusal is both safer and
simpler, and the experiment matrix will show whether any real client needs more.

### TH4 — amplification and denial of service

**Vector:** `/authorize` is unauthenticated. Each call with a fresh URL can cause an outbound
request. This turns ARC-1 into a request amplifier aimed at a third party, or into a self-inflicted
resource exhaustion.

**Controls:** the existing per-IP limiter already covers `/authorize` (`http.ts:517`, default
20/min) — **but it skips Copilot Studio JSON-RPC traffic via `isCopilotJsonRpc`**, so that skip must
be verified not to expose an unlimited CIMD path. Add a dedicated process-wide cap on concurrent
outbound CIMD fetches and a separate per-minute ceiling on **distinct** URLs resolved, so a single
IP within its request budget still cannot fan out to unlimited destinations. Negative caching and
single-flight complete the picture.

**Resolved in T3.** `isCopilotJsonRpc` matches only a POST whose body carries `jsonrpc`, and
`http.ts` diverts exactly those to the MCP handler before the OAuth handler runs — so they never
reach `getClient` and cannot trigger a fetch. Genuine OAuth `/authorize` traffic and
`/oauth/callback`, the only two paths that can, are both already inside the per-IP limiter. No
dedicated cap was needed; the resolver's negative cache and single-flight remain as depth.

### TH5 — response-body attacks

**Vectors:** an endless body; a slow drip that holds a connection open; a compression bomb, since
`undici` transparently decompresses; deeply nested JSON aimed at the parser.

**Controls:** enforce the 5 KiB cap **on the stream**, aborting as soon as it is exceeded, and cap
the decompressed size, not merely the transferred bytes — refusing `Content-Encoding` outright is
the simplest defensible choice; a connect timeout plus a global deadline that covers the whole
read; a JSON size and depth limit before parsing; strict schema validation with per-field length
caps after.

### TH6 — untrusted document content

**Vector:** the document is attacker-authored. Its `redirect_uris` become 302 targets carrying an
OAuth `code`. Its `client_name` may reach logs, audit records, and any future consent UI.
`logo_uri` and `jwks_uri` are further fetch invitations.

**Controls:** every redirect URI passes `validateRedirectUri` and `matchesRedirectPattern`, reusing
the existing canonicalization rather than reimplementing it; a cap on the number of redirect URIs;
`client_name` length-capped, treated as display-only, never as identity, and redacted through the
existing audit pipeline; **no URL in the document is ever fetched**, which discharges the second
half of N6 by construction.

### TH7 — post-admission mutation

**Vector:** the document validates, then changes — adding a redirect URI after the client is known.
Draft -01 added this consideration explicitly.

**Controls:** the TTL ceiling bounds the window. More usefully, ARC-1 re-validates at
`/oauth/callback` through `checkRedirectUri`, so the code is only released to a URI that is
authorized at release time. **Design requirement:** that second check must resolve through the same
cache entry as the first, or a mid-flight document change turns a valid authorization into a
confusing failure. Both checks reading one cached snapshot is the intended behaviour.

### TH8 — impersonation

**Vector:** a document claiming to be a well-known vendor's client.

**Control:** none available at this layer; CIMD proves domain control and nothing more. This is
inherent to the mechanism, is the reason `client_name` must never be rendered as trusted, and is the
strongest argument for offering the optional allowlist.

### TH9 — egress and data protection

**Vector:** a fetch is an outbound connection from a customer's BTP subaccount to a
customer-chosen-by-an-attacker host, disclosing that the customer runs ARC-1, roughly when, and from
which egress address.

**Control:** the feature is default-off; the allowlist is available; the behaviour is documented in
the auth pages so a security reviewer can assess it before enabling. No client IP, user identity,
token, or SAP data is ever included in the outbound request — it carries no headers beyond the
minimum and no credentials.

## Proposed architecture

### Resolution flow

```mermaid
flowchart TB
  GC["getClient(clientId)"] --> D{"== XSUAA default id?"}
  D -->|yes| DEF["default client"]
  D -->|no| P{"parses as https: URL?"}
  P -->|no| DCR["existing arc1- DCR path (unchanged)"]
  P -->|yes| EN{"CIMD enabled?"}
  EN -->|no| FAIL["undefined + audit: cimd_disabled"]
  EN -->|yes| SHAPE["URL shape checks<br/>N2 N3 N4"]
  SHAPE --> AL{"host allowlist set?"}
  AL -->|"set and no match"| FAIL2["undefined + audit: host_not_allowed<br/>(no outbound request)"]
  AL -->|"open or match"| CACHE{"cache hit?"}
  CACHE -->|"positive"| INFO["OAuthClientInformationFull"]
  CACHE -->|"negative"| FAIL3["undefined + audit: cached_failure"]
  CACHE -->|"miss"| SF["single-flight"]
  SF --> FETCH["hardened fetch<br/>resolve → validate IPs → pin → stream-capped read"]
  FETCH --> VAL["document validation<br/>N1 N7 N10 N11 N12 + redirect-URI policy"]
  VAL -->|ok| STORE["cache (RFC 9111, clamped)"] --> INFO
  VAL -->|fail| NEG["cache negative"] --> FAIL4["undefined + audit: reason"]
```

`checkRedirectUri` needs no CIMD branch of its own: its generic path already calls `getClient` and
compares. It needs only the loopback-relaxation alignment from
[the conflicts section](#conflicts-between-the-draft-and-the-sdk), which is a change for DCR and
CIMD clients alike and must be assessed as such. `ensureRedirectUri` needs no code change at all —
only a comment recording that CIMD is intentionally a no-op, and a test that pins it.

### Fetcher contract

A single-purpose module. Not a general HTTP client, and not exported for other use.

```text
fetchClientIdMetadataDocument(url, opts) → { ok: true, body, cacheControl?, expires? }
                                         | { ok: false, reason }
  reason ∈ scheme | userinfo | shape | blocked_host | host_not_allowed | dns_failure
         | blocked_address | redirect_refused | tls_failure | timeout
         | too_large | bad_status | bad_content_type | content_encoding_refused
         | network_error
         | proxy_config_invalid | proxy_unreachable | proxy_refused
```

Delivered in `@arc-mcp/xsuaa-auth` as `src/cimd-fetch.ts`. Four reasons were added during
implementation and are not in the original sketch above: `blocked_host` (an internal-only name or
IP-literal target, refused pre-DNS, which deserves its own audit signal rather than hiding inside
`shape`), `content_encoding_refused` (a compression bomb is a distinct threat from a wrong content
type), `network_error` (an ordinary socket failure), and the three `proxy_*` reasons discussed
under [Proxied deployments](#proxied-deployments).

- `https` only; no userinfo; no fragment; path required; no dot segments — the dot-segment check
  runs on the **raw string**, because `new URL()` resolves `a/../b` away during parsing and a check
  against `pathname` is dead code. Percent-encoded spellings (`%2e%2e`) are covered.
- Resolve, validate **every** address against the RFC 6890 block set, pin the connection.
- Redirects refused.
- Connect timeout ~2 s, global deadline ~5 s, both configurable and clamped.
- Streaming size cap at 5 KiB; `Content-Encoding` refused; status must be exactly 200; content type
  must be JSON or `+json`.
- No credentials of any kind; a fixed, non-identifying `User-Agent`.
- Reasons are for audit only. The caller-visible error is generic, and a failure result carries
  **only** the reason — no exception text, no address, no hostname — so no topology can leak.
- Built on `node:https` rather than `undici`: a custom `lookup` is the exact pinning seam, Node
  core never auto-follows redirects, and it never auto-decompresses. `undici` is not a dependency
  of the auth package, so this also adds none.

Reuse `literalHostIsPrivate` from `src/adt/abapgit.ts` as the range-checking core — either lifted
into the package or duplicated with a comment pointing at the original and a shared test vector
list. Duplication with a pinned test corpus is acceptable here and preferable to exporting an
`adt/` internal across a package boundary; the vectors are the thing that must not drift.

### Proxied deployments

Some deployments — typically self-hosted or Docker inside a locked-down corporate network, rather
than BTP Cloud Foundry, which normally has direct egress — permit outbound traffic only through a
mandatory forward proxy. This interacts badly with the design, because **pinning a connection and
delegating a connection are structurally incompatible**: hand a proxy a hostname and the proxy, not
this process, resolves the name and chooses the peer, so a `CONNECT` aimed at an internal host
sails past every address check. Naive proxy support would silently downgrade the SSRF control to
"whatever the proxy's egress policy happens to allow".

Three ways out were considered.

**Option C — tunnel to the validated IP. Implemented.** Resolve and validate the address here, then
ask the proxy for a tunnel to that **IP**: `CONNECT 93.184.216.34:443`, never
`CONNECT client.example.com:443`. The proxy resolves nothing and substitutes nothing; it only opens
a pipe to an address this process already approved. TLS is then terminated locally inside the
tunnel with SNI and certificate validation bound to the real hostname. **The pin survives the
proxy**, which is what makes this the right answer rather than a compromise.

Two operator-visible consequences, both intentional:

- A proxy that refuses `CONNECT` to a bare IP — many policy-enforcing proxies do, because their
  filtering and logging want a name — cannot be used. That surfaces as `proxy_refused`, never as a
  silent downgrade to a direct or unpinned connection.
- A **TLS-intercepting** proxy fails certificate validation, because the certificate presented is
  the interceptor's. Failing is the correct outcome; such a deployment must trust the interception
  CA at process level (`NODE_EXTRA_CA_CERTS`) as an explicit, visible operator decision.

The proxy's own address is deliberately **exempt** from the RFC 6890 block set. A corporate proxy
legitimately lives on `10.x` or `127.0.0.1`, and it is operator-configured infrastructure; the
untrusted input in this design is the target, never the egress hop. Proxy credentials
(`http://user:pass@proxy`) ride the `CONNECT` only and never enter the tunnel, so the request to
the client's host stays unauthenticated.

The proxy URL is an explicit option rather than an implicit read of `HTTPS_PROXY`. Whether egress is
proxied is a deployment policy the consumer owns, and a transport that changes shape because an
environment variable happens to be set is exactly the kind of surprise this module exists to avoid.
A `proxyFromEnvironment()` helper (with `NO_PROXY` handling) lets `arc-1` opt in explicitly at T3.

**Option E — a locally supplied document mirror. Not implemented; documented as the airgapped
path.** An administrator supplies the CIMD documents out of band for the clients the deployment
supports. There is no outbound request at all, so the entire SSRF surface disappears, while the
benefit that matters is retained: `client_id` values that are stable URLs, immune to signing-key
rotation. It is a deliberate deviation from the draft, which requires the authorization server to
fetch, and it carries a staleness risk when a client rotates its redirect URIs. For a closed
enterprise deployment with a fixed client set it is coherent, and it is simply the curated
admission model of [Q3](#q3--admission-policy) taken to its conclusion. Build it only if a customer
needs it.

**Option A — proxy without pinning, plus a mandatory allowlist. Rejected in favour of C**, but kept
as the fallback if a customer's proxy refuses IP `CONNECT`. It is a different security model, not a
weaker version of the same one, so it would have to be opt-in and explicit — never a silent
fallback when C fails.

**This changes the answer to [Q3](#q3--admission-policy) for one class of deployment.** The
recommendation there — allowlist optional, empty by default — rests on address validation doing the
real work. Under Option A that validation does not exist, so the host allowlist stops being
optional and becomes the *only* remaining SSRF control. Option C does not have this problem, which
is the main reason to prefer it.

**Consequence for [T3](#t3--wiring-arc-1).** The startup guard originally envisaged here was
"proxy detected + CIMD enabled → refuse to advertise". With Option C implemented that is no longer
right: a proxied deployment is supported. The guard becomes a configuration-wiring question —
whether `arc-1` populates `proxyUrl` from the environment — plus a clear diagnostic when the
`proxy_*` reasons start appearing, since those indicate a proxy that cannot serve this feature.

### Document validation

Strict allowlist of fields, everything unknown ignored, everything present bounded:

1. Parse as JSON within the size cap; reject non-objects.
2. `client_id` present and **exactly** equal to the fetch URL string (N1).
3. `redirect_uris` present, non-empty, count-capped, each passing `validateRedirectUri` and the
   redirect policy from the conflicts section.
4. `token_endpoint_auth_method` absent or `none`; any symmetric method rejected (N12).
5. `grant_types` / `response_types` intersected with what ARC-1 supports
   (`authorization_code`, `refresh_token`, `code`).
6. `client_name` optional, length-capped, display-only.
7. `application_type` optional; recorded for observability only — see the revised resolution in
   [Conflicts between the draft and the SDK](#conflicts-between-the-draft-and-the-sdk).
8. Map to `OAuthClientInformationFull` with `client_secret: undefined` and
   `token_endpoint_auth_method: 'none'` — the existing public-client path.

### Configuration surface (`arc-1`)

Following the `resolveOptionalStr(flag, envVar, fieldName)` pattern with `sources.*` tracing and
end-of-file consistency warnings:

| Variable | Default | Meaning |
|---|---|---|
| `ARC1_CIMD_ENABLED` | `false` | Master switch. Also gates the metadata flag. |
| `ARC1_CIMD_ALLOWED_HOSTS` | empty | Optional CSV host allowlist; empty means open. |
| `ARC1_CIMD_CACHE_TTL_SECONDS` | `900` | Default TTL when the response carries no cache headers; clamped [300, 3600]. |

Warn at startup when `ARC1_CIMD_ALLOWED_HOSTS` is set while `ARC1_CIMD_ENABLED` is false, matching
the existing inert-configuration warnings.

### Audit surface

New members of the typed `AuditEvent` union in `src/server/audit.ts`, alongside the existing
`oauth_client_*` events, all flowing through `redactAuditEvent`:

| Event | Fields |
|---|---|
| `oauth_cimd_resolved` | `clientIdUrl`, `redirectUriCount`, `cacheHit` |
| `oauth_cimd_rejected` | `clientIdUrl`, `reason` (the fetch/validation vocabulary above, plus `cimd_disabled`), `cacheHit` |

`clientIdUrl` is attacker-controlled and must be documented as untrusted in the same style as the
existing `registeredClientId` and `redirectUri` comments.

**Revised during T3.** The two-event split above superseded the three-event design originally
proposed here (a dedicated `oauth_cimd_blocked` for `blocked_address` / `host_not_allowed` /
`redirect_refused`, separate from an `oauth_cimd_rejected` for everything else). A single rejected
event carries the full closed-vocabulary `reason`, and `dcr-client-store.ts`'s `emitCimdFailure` sets
`level: 'warn'` for `blocked_address` and `host_not_allowed` — the two that mean someone aimed ARC-1
at an address it refused to reach — and `level: 'info'` for every other reason, including an
ordinary malformed document. One event with a reason-driven level is simpler to consume from audit
tooling than a name split that an operator would otherwise have to know to watch both of, and it
avoids a second typed event whose field shape is identical to the first. The originally proposed
`durationMs` field on `oauth_cimd_resolved` was also dropped; this document does not have a recorded
reason for that, only the observation that the shipped event carries `clientIdUrl`, `redirectUriCount`,
and `cacheHit` and nothing else — flag it if timing-based audit turns out to matter later.

## What CIMD removes from SEC-15

**Observed:** the signing key currently serves two distinct purposes under two KDF labels —
`arc1-dcr/v1` for client identity and `arc1-oauth-state/v1` for the short-lived callback state.

CIMD removes the key from the first purpose entirely for every migrated client. A CIMD `client_id`
is a URL; no key verifies it; rotation cannot invalidate it; `cf deploy` cannot invalidate it; the
observed Copilot behaviour of not re-registering after `invalid_client` becomes irrelevant, because
there is no registration to lose.

The key remains necessary for state signing, but that changes the risk profile qualitatively: state
lives for the duration of one authorization. Rotating a state key costs in-flight authorizations
measured in seconds, not the entire registered client population. **The "signing key is the
database" property — the premise of SEC-15 — disappears for the CIMD share of traffic.**

**Recommended scope change for SEC-15:**

- **Keep Phases 0–2** — deterministic provider selection, fail-closed behaviour, mounted-file and
  exactly-named binding support, documented deployment profiles. These are cheap, they are correct
  regardless of CIMD, and they still protect state signing and the residual DCR population.
- **Defer Phase 3 (key ring, `kid`, rolling rotation) pending measurement.** It is the expensive
  phase, and its value is proportional to the surviving DCR population, which is designed to shrink
  to nothing over the deprecation window. Building seamless rotation for a population being retired
  is investment in the wrong asset.
- **Keep Phase 4 dormant.** A stateful registration store was always contingent on per-client
  revocation; CIMD provides revocation for free — the client deletes or edits the document — for the
  clients that adopt it.

**Make the decision data-driven, not calendrical.** The `oauth_cimd_resolved` event plus a
client-kind dimension on existing authorization audit gives the share of authorizations by identity
type. **Proposed gate:** re-evaluate at six months. If CIMD exceeds ~70 % of authorizations, close
SEC-15 at Phase 2 and document rotation as an intentional, announced, DCR-only revocation event. If
it is below ~30 %, Phase 3 is justified after all. This converts an architectural argument into a
measurement, which is the point of instrumenting it.

## Live experiment matrix

To run before and during implementation. Record URLs and verdicts; never record secrets.

| # | Test | Required result |
|---|---|---|
| X1 | Real client behaviour: which MCP clients send a `clientMetadataUrl`, and what their documents contain — especially `redirect_uris` and `application_type` for native clients | Determines whether the loopback conflict is an edge case or the main story |
| X2 | Flag off → client behaviour | No client attempts CIMD; DCR unchanged |
| X3 | Flag on, valid document, root-path deployment | Full flow succeeds; metadata carries the flag |
| X4 | Same, behind a `basePath` prefix proxy | Identical outcome; prefixed metadata carries the flag |
| X5 | Each blocked range: IPv4 private/loopback/link-local/CGNAT, IPv6 ULA/link-local, both IPv4-mapped forms | Refused before connect; `oauth_cimd_rejected` emitted at `level: 'warn'` |
| X6 | DNS rebinding: public A record on lookup, private on reconnect | Refused; connection pinned to the validated address |
| X7 | Redirect chain to an internal address | Refused at the first redirect |
| X8 | Oversized body, slow-drip body, gzip bomb | Aborted at the cap; memory flat |
| X9 | `client_id` inside document ≠ URL; port/no-port variants | Rejected (N1, string comparison) |
| X10 | Non-200 status; non-JSON content type | Rejected (N7, N10) |
| X11 | Document declaring a symmetric auth method | Rejected (N12) |
| X12 | Document mutation mid-flight | `/authorize` and `/oauth/callback` agree via one cached snapshot |
| X13 | Cache: honour `max-age`, clamp floor and ceiling, negative TTLs, LRU eviction, single-flight under concurrent load | Matches the table in Q4 |
| X14 | Allowlist set, non-matching host | Rejected with **zero** outbound traffic (verify at the socket) |
| X15 | Rate limiting incl. the `isCopilotJsonRpc` skip path | No client class reaches an unlimited CIMD fetch |
| X16 | CIMD backend unreachable | DCR, default client, API key, OIDC all unaffected |
| X17 | `arc-1` on package ^1.0.2 | Starts, no CIMD, no flag, no errors |
| X18 | **Real TLS fetch, direct** — a genuine public HTTPS document | Handshake, certificate validation, and the 200 path work end to end. Unit tests stop at the TLS boundary, so this is the one thing they cannot prove |
| X19 | **Real TLS fetch, tunnelled** — the same through a live forward proxy | `CONNECT <ip>:443` accepted, TLS validates against the real hostname inside the tunnel |
| X20 | Proxy that refuses `CONNECT` to a bare IP | `proxy_refused`, no downgrade to a direct or unpinned connection |
| X21 | TLS-intercepting proxy | Certificate validation fails closed; succeeds only once the interception CA is trusted via `NODE_EXTRA_CA_CERTS` |
| X22 | Dual-stack target (A + AAAA), resolver reordering | The pin holds; the address actually dialled is one that was validated |

## Implementation roadmap

Sequenced so that the risky part is reviewed alone, and nothing that could call it exists first.
One PR per task.

### T0 — confirm sources and decide

No code. Re-read the MCP 2026-07-28 authorization section and the IETF draft from primary sources on
an unrestricted network; pin the revision the MCP text cites; confirm the SDK still has no
server-side support; obtain a decision on Q1–Q5 and on the package change.

### T1 — the hardened fetcher (package) — **delivered, pending review**

The whole security case. Merged alone, with no caller. Delivers `src/cimd-fetch.ts` in
`@arc-mcp/xsuaa-auth`: the RFC 6890 range logic reusing the abapGit vectors, resolution + address
validation + connection pinning, refused redirects, timeouts, streaming caps, content-type and
status checks, and the reason vocabulary. 52 tests covering X5–X8 plus the abapGit vector corpus.

Scope grew by one item during implementation: **Option C proxy tunnelling**
([Proxied deployments](#proxied-deployments)) landed here rather than being deferred, because it is
a transport concern and belongs beside the pin it preserves.

Two defects were found by the suite and fixed in place: the dot-segment check was dead code against
`URL.pathname` (the parser resolves the segments away before it runs), and an IP-literal target
reached the resolver and reported `dns_failure` instead of a precise pre-DNS refusal.

**No other task starts until this is reviewed.**

### T2 — resolution, validation, cache (package) — **delivered, pending review**

`getClient` classification and the terminal CIMD branch; document validation; the LRU with RFC 9111
handling, negative entries, and single-flight; `checkRedirectUri` alignment; the `ensureRedirectUri`
no-op comment and its test. Tests X9–X14. Ships as 1.1.0.

### T3 — wiring (`arc-1`) — **delivered, pending review**

Bump to `^1.1.0`. Advertise the flag in **both** metadata modes via `createOAuthMetadata` +
`metadataHandler` before `mcpAuthRouter`. Add the three configuration variables with source tracing
and warnings. Decide whether `proxyUrl` is populated from `proxyFromEnvironment()` and expose it as
a fourth setting; the originally planned "proxy detected → refuse to advertise" guard is obsolete
now that Option C supports proxied deployments, and is replaced by a clear diagnostic when the
`proxy_*` reasons appear. Add the three audit events, carrying the proxy reasons through
`redactAuditEvent` — a proxy URL may contain credentials and must never reach a sink.
Rate limiting needed no change, and the open question above is answered: `isCopilotJsonRpc`
matches only a POST carrying a `jsonrpc` body, and those are diverted to the MCP handler before the
OAuth handler runs, so they never reach `getClient` and cannot trigger a fetch. Both paths that can
— `/authorize` and `/oauth/callback` — are already inside the per-IP limiter.
Update `docs_page/enterprise-auth.md` and the configuration reference; `npm run docs:build` (mkdocs
strict) must pass. Tests X2–X4, X15–X17.

### T5 — authorization SEPs this research did not examine

The 2026-07-28 release-candidate post lists six authorization SEPs. Three were analysed here
(**2468** = RFC 9207 `iss`, **837** = `application_type`, **2352** = issuer binding — all three are
client-side obligations creating no server work, as recorded above). **Three were not**, and each
should get its own look before ARC-1 claims conformance with the revision as a whole:

| SEP | Subject | Why it may touch ARC-1 |
|---|---|---|
| **2351** | `.well-known` discovery suffix documentation | **Most likely to matter.** T3 mounts a shadowing handler on `/.well-known/oauth-authorization-server` and ARC-1 already serves PRM at several paths, including prefixed and multi-target variants. If the revision pins a suffix convention, those routes need checking against it. |
| **2207** | Refresh-token guidance for OpenID-Connect-style servers | ARC-1 proxies refresh to XSUAA (`exchangeRefreshToken`) and has a separate OIDC verifier path. |
| **2350** | Scope accumulation during step-up | ARC-1 expands and enforces MCP scopes (`ACTION_POLICY`, `expandScopes`); step-up semantics were never considered. |

None of these blocks the CIMD work — they are orthogonal to client identity. They are listed so the
gap is explicit rather than silently assumed away.

### T4 — unified redirect policy (measure first)

SEC-15 observed that DCR validates redirect URIs at registration but later trusts the signed
payload, so a forged `client_id` carries its own redirect URI. Applying `matchesRedirectPattern` to
all three client families would close that, and CIMD makes the unification natural.

**Do not implement it in this project.** Measure first: how many redirect URIs currently accepted
for DCR clients would fail the pattern list? Until that number exists, the change is an unbounded
regression risk against real clients in the field. Deliver the measurement as its own artefact and
decide separately.

## Acceptance criteria

CIMD support is complete when:

- primary sources are confirmed and the pinned draft revision is recorded in this document;
- a CIMD `client_id` completes authorization end to end in both root and prefix deployment modes;
- the flag is advertised if and only if the feature is enabled, in every deployment mode;
- DCR, the default client, API-key, and OIDC behaviour are provably unchanged, with the existing
  OAuth tests green and unmodified;
- every experiment X1–X17 passes, with X5–X8 and X14 demonstrated at the socket level;
- no CIMD failure can reach the DCR path, and no failure returns a partially populated client;
- caller-visible errors carry no network-topology information, while audit carries the reason;
- the fetcher performs no authenticated request and dereferences no URL found inside a document;
- resolution and rejection (including the address/host-blocking reasons, at `level: 'warn'`) are
  observable through the typed audit union and documented as untrusted where applicable;
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `check:sizes`, and
  `npm run docs:build` all pass in both repositories; and
- the auth documentation states plainly that `client_name` is attacker-controlled and that CIMD
  proves domain control only.

## Impact assessment

**Security.** One new outbound primitive, on an unauthenticated path, in a process adjacent to the
Cloud Connector. This is a genuine increase in attack surface and the reason for the default-off
posture, the standalone [T1](#t1--the-hardened-fetcher-package) review, and the allowlist option.
Against that, CIMD removes a forgery surface: a client identity that cannot be minted from a stolen
signing key.

**Performance.** A cache miss adds one outbound HTTPS round trip to `/authorize` — bounded by the
5 s deadline, amortized by a ≥300 s cache floor, and off the MCP tool-call path entirely. Steady
state is one fetch per client per TTL per instance. Memory is bounded at under 2 MiB.

**Reliability.** A new external dependency on a *client-controlled* host, which is a novel
dependency direction: ARC-1's availability for a given client now depends on that client's own
hosting. Contained because failure is per-client and cannot affect DCR or any other auth path.

**Migration and rollback.** Additive and default-off; rollback is setting `ARC1_CIMD_ENABLED=false`,
after which capable clients fall back to DCR on their next attempt because the flag disappears with
it. No stored state to migrate, no wire format to version.

**Operability.** Three configuration variables, two audit events, one alertable condition
(`oauth_cimd_rejected` at `level: 'warn'`). Operators gain the measurement that decides SEC-15's
remaining scope.

## Primary sources

- MCP specification, revision 2026-07-28 — authorization
  (<https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization>) — **re-read
  directly; blocked by egress policy during this research**
- **The 2026-07-28 Specification** — <https://blog.modelcontextprotocol.io/posts/2026-07-28/>. This
  is the load-bearing citation, verified verbatim: *"Dynamic Client Registration itself is now
  formally deprecated in favor of CIMD. DCR continues to work for backward compatibility, but will
  be removed in a future version of the MCP spec."* and *"A formal deprecation policy with a
  twelve-month minimum window."*
- **The 2026-07-28 Release Candidate** — <https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/>.
  ⚠️ Do NOT cite this one for CIMD: the RC post **does not mention CIMD at all**. It covers six
  other authorization SEPs (2468, 837, 2352, 2207, 2350, 2351). CIMD appears only in the final
  specification post above. Neither post names SEP-991 or
  `client_id_metadata_document_supported` — those come from SEP-991's own issue and from the SDK
  source, both verified directly.
- SEP-991, URL-based client registration via CIMD —
  <https://github.com/modelcontextprotocol/modelcontextprotocol/issues/991>
- `draft-ietf-oauth-client-id-metadata-document`, revision **-02**, working-group source —
  <https://github.com/oauth-wg/draft-ietf-oauth-client-id-metadata-document> — **confirm the
  revision on datatracker before implementing**
- RFC 6890 (special-purpose address registries), RFC 9111 (HTTP caching), RFC 8252 §7.3 (native app
  loopback redirects), RFC 7591 (dynamic client registration), RFC 9207 (`iss`), RFC 8707 (resource
  indicators)
- `@modelcontextprotocol/sdk` v1.30.0 — `src/client/auth.ts`, `src/server/auth/router.ts`,
  `src/server/auth/handlers/authorize.ts`; npm `latest` = 1.30.0 as of 2026-08-18
- `@arc-mcp/xsuaa-auth` v1.0.2 — `src/dcr-client-store.ts`, `src/redirect-uris.ts`,
  `src/oauth-provider.ts`
- `arc-1` v1.1.0 — `src/server/http.ts`, `src/server/audit.ts`, `src/server/config.ts`,
  `src/adt/abapgit.ts`
- [SEC-15 research](2026-07-31-durable-dcr-signing-key-lifecycle.md) and
  [SEC-15 roadmap entry](../../docs_page/roadmap.md#sec-15)
