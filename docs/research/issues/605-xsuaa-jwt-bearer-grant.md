# PR #605 — add `jwt-bearer` to XSUAA `grant-types` (VALIDATED — change is correct, description is not)

**Status:** Verdict reached 2026-07-22. **The one-line change is correct and should be merged.**
Two of the three claims in the PR description are wrong and must not enter the commit history.
**PR:** [arc-mcp/arc-1#605](https://github.com/arc-mcp/arc-1/pull/605) by `@Prolls` (external contributor).
**Diff:** `xs-security.json`, +1/-1 — adds `urn:ietf:params:oauth:grant-type:jwt-bearer` to
`oauth2-configuration.grant-types`.

## TL;DR

- **What the change actually does:** `grant-types` is an allowlist on the OAuth client that
  authenticates the `POST /oauth/token` call. ARC-1 declares `["authorization_code","refresh_token"]`,
  so XSUAA refuses a `jwt-bearer` exchange performed **with ARC-1's own client credentials** with
  `invalid_client / "Unauthorized grant type"`. That is the entire mechanism. It is a config
  allowlist, not a code path.
- **Why it is needed:** in SAP's canonical "external app propagates a user into my BTP app" flow, the
  caller authenticates at the token endpoint with the **target application's** clientid/secret and
  presents the user's JWT as `assertion`. So the grant must be enabled on the **target** — ARC-1.
  This is SAP's own documented pattern, not the contributor's invention (see Evidence).
- **What it does NOT fix:** it has nothing to do with issue #301, and nothing to do with
  `SAP_PP_STRICT`. Both claims in the PR body are wrong.
- **Security:** additive and low-risk. `client_credentials` and `password` stay excluded — those are
  the dangerous ones. `jwt-bearer` still requires ARC-1's client secret **and** a real user JWT from
  a trusted issuer in the same identity zone, and the minted token carries only the scopes that
  user's role collections grant. No privilege escalation.
- **Effect on existing ARC-1 deployments:** none. Every current login path
  (MCP client → DCR → `authorization_code` + `refresh_token`) is untouched.

## What `grant-types` controls (the actual mechanism)

`grant-types` is **not documented** in the `oauth2-configuration` property table of either the
[BTP](https://help.sap.com/docs/BTP/65de2977205c403bbc107264b8eccf4b/517895a9612241259d6941dbf9ad81cb.html)
or the [HANA Cloud](https://help.sap.com/docs/HANA_CLOUD_DATABASE/b9902c314aef4afb8f7a29bf8c5b37b3/6d3ed64092f748cbac691abc5fe52985.html)
version of *Application Security Descriptor Configuration Syntax* — both list only `token-validity`,
`refresh-token-validity`, `redirect-uris`, `credential-types`, `autoapprove`, `system-attributes`,
`allowedproviders`. It is a real, broker-honored key (it round-trips through
`btp get security/app`), just an undocumented one. That is why this took live probing to settle.

The rule, once established: **the grant type is checked against the OAuth client whose
clientid/clientsecret authenticates the `/oauth/token` request.** Whoever is on the `Authorization:
Basic` header must have that grant in their allowlist.

Which client that is depends on the topology — and this is the crux the PR gets right and ARC-1's
own earlier research got half-wrong:

| Topology | Who authenticates at `/oauth/token` | Needs `jwt-bearer` declared in |
|---|---|---|
| MCP client (Claude / Cursor / Eclipse) → ARC-1 | the DCR client, via ARC-1's OAuth proxy, `authorization_code` | nobody — works today |
| [mcp-hub](../../../docs_page/multi-system-hub.md) → ARC-1 backend | the **hub's** client + `granted-apps` / `foreign-scope-references` | the **hub's** `xs-security.json` |
| **Third-party BTP backend → ARC-1, using a service key of ARC-1's XSUAA instance** | **ARC-1's own client** | **ARC-1's `xs-security.json`** ← **this PR** |

Row 3 is the simplest and most common integration shape: bind (or service-key) the consumer to
ARC-1's XSUAA instance, exchange the end user's JWT there, get back a token already audienced to
`arc1-mcp!tNNNNNN`. It needs no `granted-apps` wiring on ARC-1's scopes — and ARC-1 declares no
`granted-apps` / `grant-as-authority-to-apps` on any scope today, so row 2's route isn't wired up
in-tree anyway. **Row 3 is currently impossible; this PR is what makes it possible.**

## Evidence

### 1. SAP's own reference walkthrough (authoritative for the "whose client" question)

*How grant-types keep your application secure — [Exercise 3](https://community.sap.com/t5/technology-blog-posts-by-sap/how-grant-types-keep-your-application-secure-exercise-3/ba-p/13525513)*
(SAP-authored) sets up exactly this scenario: an external application propagating a user into a BTP
"Business Logic Application". The two decisive details:

```yaml
# mta extension — enables the grant on the BUSINESS LOGIC APP's xsuaa, i.e. the TARGET
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

The minted token comes back with `aud: [openid, sb-cf-application!t131271]` — audienced to the
target, which is precisely what `@sap/xssec` needs to accept it at ARC-1's `/mcp`. Substitute
`cf-application` → `arc1-mcp` and that is PR #605 verbatim.

The same series' [Exercise 1](https://community.sap.com/t5/technology-blog-posts-by-sap/how-grant-types-keep-your-application-secure-exercise-1/ba-p/13525435)
proves the allowlist is enforced ("We broke something. This proves that it is necessary for the
clients to be configured to use the grants") and states the key learning outright: *"How the
configuration parameter grant-types controls which token requests are accepted by XSUAA."*

It also confirms the authorization model is preserved: *"once the role collection is added,
additional scopes appear"* — the exchanged token gets only the user's real entitlements.

### 2. Live probe — deployed ARC-1, 2026-07-22

Against `arc1-mcp!t498139` (subaccount `dev-9li7mzug`, us10), using a throwaway service key on
`arc1-mcp-xsuaa` (deleted afterwards):

| Probe | Result |
|---|---|
| `btp get security/app arc1-mcp!t498139` | `grant-types: [refresh_token, authorization_code]` — **`jwt-bearer` absent, as declared** |
| `grant_type=client_credentials` (also absent from the list) | `401 invalid_client / "Unauthorized grant type"` — **the gate is live and enforcing on this exact instance** |
| `grant_type=refresh_token` + bogus token (allowed grant) | `401 invalid_token / "The token expired, was revoked…"` — passes the gate, fails later |
| `grant_type=jwt-bearer` + malformed assertion | `401 invalid_token / "Invalid token"` — **masked** |
| `grant_type=jwt-bearer` + validly-signed same-issuer *non-user* token | `401 unauthorized / "Unable to map issuer: Origin claim is missing in the token."` — **masked** |

**The masking is the finding, not a failed probe.** For `jwt-bearer`, XSUAA validates the assertion
(signature → issuer → origin/user mapping) *before* it reaches the grant-type allowlist. Only an
assertion that survives all of that reaches the gate. This independently reproduces the caveat
recorded in [`mcp-hub-multi-system.md`](../mcp-hub-multi-system.md) L4 — where the earlier
`"Unable to map issuer"` result had masked the real grant-type rejection.

Also verified in passing: **x509 / `certurl` credentials are available on a stock ARC-1 XSUAA
instance** (`cf create-service-key … -c '{"credential-type":"x509"}'` → `certurl:
https://dev-9li7mzug.authentication.cert.us10.hana.ondemand.com`) even though `credential-types` is
not declared in `xs-security.json`. So the reporter's mTLS-against-`certurl` exchange is achievable
on a stock deployment — no additional descriptor change needed. Their test report holds up.

**Not verified by me:** reaching the grant-type gate for `jwt-bearer` specifically requires a real
**user** assertion (one carrying an `origin` claim), which needs an interactive browser login. I did
not run that. The gate's existence and enforcement on this instance is proven via
`client_credentials`; the `jwt-bearer`-specific rejection with a real user token
(`invalid_client / "Unauthorized grant type"`, identical wording) was recorded live on 2026-06-17
in [`mcp-hub-multi-system.md`](../mcp-hub-multi-system.md) L4.

## Three corrections to the PR description

These matter because the PR body becomes the squash-merge commit message.

### ❌ "This is the root cause of the unresolved auth failure reported in #301."

[#301](https://github.com/arc-mcp/arc-1/issues/301) is **closed as completed** (2026-06-11) and was
never unresolved. It was a *different leg of the auth chain* entirely:

- **#301 = outbound (Layer B).** ARC-1 → BTP ABAP environment, via a Destination Service destination
  of type `OAuth2UserTokenExchange`. Fixed by PR #315 plus a config correction — the reporter had
  pointed the destination at the `.abap-web.` Fiori host instead of the `.abap.` API host. They
  confirmed `SAPRead` working, then closed it.
- **PR #605 = inbound (Layer A).** A third-party BTP app → ARC-1's `/mcp` endpoint.

Different direction, different XSUAA instance, different grant chain. No overlap.

### ❌ "…required when `SAP_PP_STRICT=true` is set, as arc-1 then enforces that the incoming token's audience matches its own XSUAA app name."

`SAP_PP_STRICT` does no such thing. Audience validation is done unconditionally by
`@sap/xssec`'s `createSecurityContext` in every XSUAA request, regardless of any ARC-1 setting
(`node_modules/@arc-mcp/xsuaa-auth/dist/xsuaa.js:56`). `ppStrict`'s only enforcement effect is at
[`src/server/server.ts:853`](../../../src/server/server.ts) — reject **non-JWT** (API-key) tool
calls. It never loosens or tightens audience checking.

The audience requirement the PR is really describing is real, it just isn't conditional: the token
must be audienced to `arc1-mcp` **always**. That is in fact a better argument for the change, not a
weaker one.

### ⚠️ "arc-1 returning `invalid_token: not a valid XSUAA, OIDC, or API key token` on every request"

Plausible but out of order. If the exchange is refused at XSUAA, the caller never obtains a token, so
ARC-1 is never called. That error string
(`node_modules/@arc-mcp/xsuaa-auth/dist/verifiers.js:307`) appears when a caller presents a token
ARC-1 rejects — a *wrong-audience* token, e.g. one minted by the caller's own client without the
`granted-apps` chain. Both symptoms are real; they're two different failure modes, not one sequence.

## Corrects prior in-repo research

[`docs/research/mcp-hub-multi-system.md`](../mcp-hub-multi-system.md) L4 currently reads:

> **Fix: add `urn:ietf:params:oauth:grant-type:jwt-bearer` to the grant-types of the app that
> INITIATES the exchange — the HUB's xsuaa, not ARC-1's.** ARC-1 only needs `granted-apps` +
> audience-validate.

That is correct **for the hub topology** (the hub authenticates with its own client), but it is
stated as a general rule and it is not one. The general rule is "whichever client authenticates the
token request". When the consumer uses ARC-1's own credentials — the simpler and more common shape —
the grant belongs on ARC-1. **L4 should be amended** rather than left to mislead the next reader;
`docs_page/multi-system-hub.md`'s troubleshooting row is fine as-is since it is hub-scoped.

## Merge mechanics

- `mergeable: MERGEABLE`. Branch is based on a pre-#383 `main` (its context still shows
  `refresh-token-validity: 43200`; `main` is now `2592000`), but the three-way merge is clean —
  the branch doesn't touch that line, so `main`'s value wins.
- `mergeStateStatus: BLOCKED` is the pre-existing `npm audit` CI failure the contributor already
  flagged (also red on `main`; #603 covers the axios bump). Unrelated to this diff.
- **Deployment note for the changelog:** `grant-types` only takes effect after
  `cf update-service arc1-mcp-xsuaa -c xs-security.json` (or an MTA redeploy). Existing bindings
  inherit the change without rebinding.

## Recommendation

**Merge**, after asking the contributor to rewrite the PR body (or rewriting it at squash time) so
the false #301 attribution and the `SAP_PP_STRICT` claim don't land in the commit history.

Follow-ups, both small and out of scope for this PR:

1. Amend `docs/research/mcp-hub-multi-system.md` L4 with the "whichever client authenticates"
   general rule.
2. Add a short section to `docs_page/xsuaa-setup.md` documenting the row-3 topology this unlocks:
   service-key ARC-1's XSUAA → `jwt-bearer` exchange → call `/mcp`. Right now nothing in the docs
   tells a consumer this is possible, which is presumably why an external contributor had to
   discover it by trial.

## Paste-able reply

````markdown
Thanks for this — the change is correct and I'm merging it. I went and validated the mechanism
end-to-end because the "why" wasn't obvious to me, so here's the full picture for the record.

**Why it's needed.** `grant-types` is an allowlist on the OAuth client that authenticates the
`POST /oauth/token` call. In SAP's canonical external-app-propagates-a-user flow, that client is the
**target** app — you authenticate with the target's clientid/secret and pass the user's JWT as
`assertion`. SAP's own walkthrough does exactly this
([How grant-types keep your application secure, Exercise 3](https://community.sap.com/t5/technology-blog-posts-by-sap/how-grant-types-keep-your-application-secure-exercise-3/ba-p/13525513)):
the mta extension enables `jwt-bearer` on the *Business Logic Application's* xsuaa, and the token
request carries `Authorization: Basic {{blApp_clientId}} {{blApp_clientSecret}}`. Swap
`cf-application` → `arc1-mcp` and that's this PR. So: correct target, correct key.

Worth noting `grant-types` isn't in SAP's documented `oauth2-configuration` property table at all
(neither the BTP nor the HANA Cloud version lists it) — it's real and broker-honored, just
undocumented. That's part of why this was hard to find.

**Verified live** against a deployed instance today: `grant-types` really is
`[refresh_token, authorization_code]`, and `client_credentials` (likewise absent) is refused with
`invalid_client / "Unauthorized grant type"` — so the gate is live and enforcing. One caveat future
readers should know: for `jwt-bearer` specifically, XSUAA validates the assertion *first*, so a test
with a malformed or non-user assertion gets `invalid_token` / `"Unable to map issuer"` and never
reaches the grant-type check. Only a real user token surfaces the actual error.

I also confirmed x509/`certurl` keys work on a stock arc-1 xsuaa without declaring
`credential-types`, so your mTLS exchange needs no further descriptor change. 👍

**Two corrections to the PR description**, since it becomes the commit message:

1. **This isn't the root cause of #301.** #301 was closed as completed back in June and was the
   *outbound* leg — arc-1 → BTP ABAP via an `OAuth2UserTokenExchange` destination, resolved by #315
   plus pointing the destination at the `.abap.` API host instead of `.abap-web.`. Your PR is the
   *inbound* leg (a BTP app → arc-1's `/mcp`). Different direction, different XSUAA instance.

2. **`SAP_PP_STRICT` doesn't gate audience validation.** `@sap/xssec` validates audience on every
   XSUAA request unconditionally; `ppStrict`'s only job is rejecting non-JWT (API-key) tool calls
   (`src/server/server.ts:853`). The audience requirement you're describing is real — it's just
   always on, which makes the case for this change stronger, not conditional.

Could you update the PR body to drop the #301 reference and reword the `SAP_PP_STRICT` sentence?
Happy to do it at squash time if you'd rather. The CI red is the known pre-existing `npm audit`
failure (#603), not your change.

Follow-up on me: documenting this topology in `xsuaa-setup.md`, since nothing currently tells a
consumer it's possible — which is presumably why you had to find it the hard way.
````
