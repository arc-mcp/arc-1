# PR #605 — `jwt-bearer` in XSUAA `grant-types`: why ARC-1's descriptor is the right place

**Status:** Validated 2026-07-22 against SAP documentation and a live deployed instance.
**Change:** [arc-mcp/arc-1#605](https://github.com/arc-mcp/arc-1/pull/605) — adds
`urn:ietf:params:oauth:grant-type:jwt-bearer` to `oauth2-configuration.grant-types` in
`xs-security.json`. One line.
**User-facing docs:** [`docs_page/xsuaa-setup.md`](../../../docs_page/xsuaa-setup.md) §"Calling ARC-1
from another BTP application".

## TL;DR

- `grant-types` is an allowlist on the OAuth client that authenticates the `POST /oauth/token` call.
  ARC-1 declared `["authorization_code","refresh_token"]`, so a `jwt-bearer` exchange performed with
  ARC-1's own client credentials was refused with `invalid_client / "Unauthorized grant type"`.
- **The grant belongs on ARC-1 because ARC-1's client is the one being authenticated.** In SAP's
  canonical app-to-app principal-propagation flow the caller authenticates at the token endpoint with
  the **target** application's clientid/secret and passes the user's JWT as `assertion`.
- Enables: a BTP app (AI assistant backend, CAP service, Fiori app) calling ARC-1 **as its logged-in
  users**, without a second browser login. Previously impossible — ARC-1 also declares no
  `granted-apps`, so the alternative route wasn't wired up either.
- **No existing path changes.** MCP client → DCR → `authorization_code` + `refresh_token` is untouched.
- **Security: additive, no escalation.** `client_credentials` and `password` stay excluded. The
  exchange still needs a real user JWT from a trusted same-subaccount issuer, and the minted token
  carries only the scopes that user's role collections grant.

## The rule

**The grant type is checked against whichever OAuth client authenticates the `POST /oauth/token`
request.** Everything else follows from that. Which client that is depends on topology:

| Topology | Authenticates at `/oauth/token` | Needs `jwt-bearer` in |
|---|---|---|
| MCP client (Claude / Cursor / Eclipse) → ARC-1 | the DCR client via ARC-1's OAuth proxy, `authorization_code` | nobody — works today |
| [mcp-hub](../../../docs_page/multi-system-hub.md) → ARC-1 backend | the **hub's** client + `granted-apps` / `foreign-scope-references` chain | the **hub's** descriptor |
| **BTP app → ARC-1 via a service key of ARC-1's XSUAA** | **ARC-1's own client** | **ARC-1's descriptor** ← this change |

Row 3 is the simplest shape: no `granted-apps` chain, and the returned token is already audienced to
`arc1-mcp!t…`. ARC-1 declares no `granted-apps` / `grant-as-authority-to-apps` on any scope, so row 2
requires manual descriptor work on both sides; row 3 requires only this one line.

Why row 3's token is accepted: it is minted **by** ARC-1's client, so `client_id` matches ARC-1's
own, and `@sap/xssec`'s audience validator takes the client_id-match path. (This is also why the
match does *not* rescue row 2 — there the token carries the hub's client_id.)

## `grant-types` is undocumented

It appears in neither the
[BTP](https://help.sap.com/docs/BTP/65de2977205c403bbc107264b8eccf4b/517895a9612241259d6941dbf9ad81cb.html)
nor the
[HANA Cloud](https://help.sap.com/docs/HANA_CLOUD_DATABASE/b9902c314aef4afb8f7a29bf8c5b37b3/6d3ed64092f748cbac691abc5fe52985.html)
`oauth2-configuration` property table — both list only `token-validity`, `refresh-token-validity`,
`redirect-uris`, `credential-types`, `autoapprove`, `system-attributes`, `allowedproviders`. It is
real and broker-honored (it round-trips through `btp get security/app`), just undocumented. Budget
live probing rather than doc-reading when touching it.

## Evidence

### SAP's reference walkthrough

*How grant-types keep your application secure —
[Exercise 3](https://community.sap.com/t5/technology-blog-posts-by-sap/how-grant-types-keep-your-application-secure-exercise-3/ba-p/13525513)*
(SAP-authored) sets up exactly this scenario. Two decisive details:

```yaml
# mta extension — the grant goes on the BUSINESS LOGIC APP's xsuaa, i.e. the TARGET
resources:
  - name: cf-application-uaa
    parameters:
      config:
        oauth2-configuration:
          grant-types:
            - urn:ietf:params:oauth:grant-type:jwt-bearer
```

```http
POST {{blApp_url}}/oauth/token
Authorization: Basic {{blApp_clientId}} {{blApp_clientSecret}}   # ← the TARGET's credentials

grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion={{user_jwt}}
```

The minted token returns `aud: [openid, sb-cf-application!t131271]` — audienced to the target.
Substitute `cf-application` → `arc1-mcp` and that is this change.

[Exercise 1](https://community.sap.com/t5/technology-blog-posts-by-sap/how-grant-types-keep-your-application-secure-exercise-1/ba-p/13525435)
proves the allowlist is enforced ("We broke something. This proves that it is necessary for the
clients to be configured to use the grants") and states the learning outright: *"How the
configuration parameter grant-types controls which token requests are accepted by XSUAA."*
Exercise 3 also confirms the authorization model survives the exchange: *"once the role collection is
added, additional scopes appear."*

### Live probe — 2026-07-22, `arc1-mcp!t498139` (`dev-9li7mzug`, us10)

Throwaway service keys on `arc1-mcp-xsuaa`, deleted afterwards.

| Probe | Result |
|---|---|
| `btp get security/app arc1-mcp!t498139` | `grant-types: [refresh_token, authorization_code]` — matches the descriptor |
| `grant_type=client_credentials` (also absent) | `401 invalid_client / "Unauthorized grant type"` — **the allowlist is live and enforcing** |
| `grant_type=refresh_token` + bogus token (allowed) | `401 invalid_token / "The token expired, was revoked…"` — passes the gate, fails later |
| `grant_type=jwt-bearer` + malformed assertion | `401 invalid_token / "Invalid token"` — **masked** |
| `grant_type=jwt-bearer` + valid same-issuer *non-user* token | `401 unauthorized / "Unable to map issuer: Origin claim is missing"` — **masked** |

**The masking matters more than the rejection.** For `jwt-bearer`, XSUAA validates the assertion
(signature → issuer → origin/user mapping) *before* consulting the grant-type allowlist. Only an
assertion that survives all of it reaches the gate — so testing with a malformed or non-user token
produces a misleading error and hides the real cause. This independently reproduces the caveat in
[`mcp-hub-multi-system.md`](../mcp-hub-multi-system.md) L4, where an earlier `"Unable to map issuer"`
had masked the same thing.

**Not verified here:** reaching the gate for `jwt-bearer` specifically needs a real **user**
assertion (carrying an `origin` claim), which requires an interactive browser login — not run. The
allowlist's existence and enforcement on this instance is proven via `client_credentials`; the
`jwt-bearer` rejection with a real user token (same `"Unauthorized grant type"` wording) was recorded
live 2026-06-17 in `mcp-hub-multi-system.md` L4.

### Credential types

x509 keys work on a stock instance despite `credential-types` not being declared:
`cf create-service-key … -c '{"credential-type":"x509"}'` → `certurl:
https://<subdomain>.authentication.cert.<region>.hana.ondemand.com`. Both binding-secret and mTLS
exchanges are available without further descriptor changes.

`credential-types` defaults to `binding-secret`, so each service key carries its **own** secret,
distinct from the app's binding. Handing a consumer a dedicated service key therefore does not expose
the app's credentials — relevant because ARC-1's stateless-DCR store HMACs `client_id`s with the
XSUAA `clientsecret` when `ARC1_DCR_SIGNING_SECRET` is unset ([config.ts:838](../../../src/server/config.ts)).
Issue a separate key per consumer so it can be rotated or revoked independently.

## Three things this is confused with

These came up while validating and are easy to get wrong.

**1. It is unrelated to [#301](https://github.com/arc-mcp/arc-1/issues/301).** #301 (closed
completed, 2026-06-11) was the *outbound* leg — ARC-1 → BTP ABAP environment via an
`OAuth2UserTokenExchange` destination, resolved by PR #315 plus pointing the destination at the
`.abap.` API host instead of `.abap-web.`. This change is the *inbound* leg. Different direction,
different XSUAA instance, different grant chain.

**2. `SAP_PP_STRICT` does not gate audience validation.** Audience is checked unconditionally by
`@sap/xssec`'s `createSecurityContext` on every XSUAA request. `ppStrict`'s only enforcement effect
is at [`server.ts:853`](../../../src/server/server.ts) — rejecting non-JWT (API-key) tool calls. The
audience requirement is real but always on, which strengthens the case for this change rather than
making it conditional.

**3. Two distinct failure modes, not one sequence.** A refused *exchange* means the caller never gets
a token, so ARC-1 is never called. ARC-1's `invalid_token: not a valid XSUAA, OIDC, or API key token`
(`@arc-mcp/xsuaa-auth` `verifiers.js:307`) appears when a caller presents a token ARC-1 rejects —
typically a wrong-audience token minted by the caller's own client without the `granted-apps` chain.
Both are real; they are alternatives, not stages.

## Deployment

`grant-types` takes effect only after `cf update-service arc1-mcp-xsuaa -c xs-security.json` (or an
MTA redeploy). Existing bindings and service keys inherit the change without rebinding.

## Related

- [`docs_page/xsuaa-setup.md`](../../../docs_page/xsuaa-setup.md) — the user-facing setup.
- [`mcp-hub-multi-system.md`](../mcp-hub-multi-system.md) L4 — the hub's different wiring; amended
  alongside this change, since it previously stated "the hub's xsuaa, not ARC-1's" as a general rule.
- [#434](https://github.com/arc-mcp/arc-1/issues/434) — cross-subaccount exchange fails at issuer
  mapping; unchanged by this.
