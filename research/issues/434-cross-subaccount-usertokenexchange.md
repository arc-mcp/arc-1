# Issue #434 — OAuth2UserTokenExchange "kid references unknown signing key" (VALIDATED)

**Status:** Confirmed — **not an ARC-1 bug.** A BTP cross-subaccount XSUAA trust limitation;
ARC-1 faithfully surfaces the Destination Service's own error. Reproduced live end-to-end
2026-06-13 with a **byte-identical** error string.

**Symptom:** ARC-1 deployed on BTP CF, destination `BTP_T02` (`OAuth2UserTokenExchange`) to a BTP
ABAP Environment. MCP login works, but every tool call fails:

```
[auth_pp_created] success:false
errorMessage: Destination Service auth token error for 'BTP_T02': Retrieval of OAuthToken failed
due to: Unable to fetch refresh token from the specified token service URL. Response was:
Token header claim [kid] references unknown signing key : [default-jwt-key-8826357d37]
```

## TL;DR

- The reporter (`nst90`) deployed ARC-1 in a **dedicated "tools" subaccount** (`cxxx-tools`) and the
  ABAP Environment T02 is **in another subaccount** (`coyyyy-test`) — they say so explicitly, and the
  logged JWT proves it: `iss=https://cxxx-tools.authentication.eu10…` while the destination's
  `tokenServiceURL=https://coyyyy-test-….authentication.eu10…/oauth/token`.
- `OAuth2UserTokenExchange` performs a **jwt-bearer exchange**: the Destination Service sends the
  MCP user's JWT (minted by ARC-1's XSUAA in the *tools* subaccount) to the ABAP env's XSUAA token
  endpoint (the *other* subaccount). **XSUAA tokens are subaccount-scoped** — the ABAP env's XSUAA
  does not know the tools subaccount's signing key (`kid default-jwt-key-…`) → rejection.
- The destination config itself is **correct** (right `.abap.` host, right client creds + token URL
  from the ABAP env service key). The problem is purely **topological**: the two subaccounts don't
  share a trust zone.
- **Fix (reporter side) — two SAP-supported options:**
  1. **Same subaccount + `OAuth2UserTokenExchange`** (simplest; ARC-1's documented model + #377
     "one subaccount per system"). Move ARC-1 into the ABAP env's subaccount; keep the destination
     exactly as-is.
  2. **Different subaccounts + `OAuth2SAMLBearerAssertion`** (keep the central "tools" subaccount).
     SAP's official rule (see Best practice below) is: same subaccount → `OAuth2UserTokenExchange`;
     **different subaccounts → SAMLAssertion / `OAuth2SAMLBearerAssertion`** + trust. **ARC-1 already
     supports this** (`src/adt/btp.ts:292,400` extract the SDK bearer token for SAMLBearer too) — so
     it's a BTP-config change, not an ARC-1 change.
  `OAuth2UserTokenExchange` across subaccounts is simply the wrong type for the topology (no
  XSUAA→XSUAA cross-subaccount trust).
- ARC-1 has **no code bug**: it can only present a token from its own (tools-subaccount) XSUAA, and it
  surfaces the SDK/Destination-Service error verbatim.

## Live validation (2026-06-13, region us10)

Reproduced in my own global account using two real subaccounts, mirroring #434:

| Role in #434 | My subaccount | subdomain / identity zone |
|---|---|---|
| ARC-1 "tools" subaccount (`cxxx-tools`) | **Joule2** (A) | `joule2-7lrbs13d` |
| ABAP Environment subaccount (`coyyyy-test`) | **dev** (B) | `dev-9li7mzug` |

Created an isolated `destination lite` instance in **A** with an `OAuth2UserTokenExchange`
destination → **B**'s ABAP env (token service = B's XSUAA, client creds = the ABAP env service key),
minted a foreign (A-issued) token, and exercised the exchange three ways:

| Path | Assertion issuer | Result |
|---|---|---|
| **Real Destination Service** find-destination (= ARC-1's SAP Cloud SDK call) | A (Joule2) | `authTokens[].error = "Retrieval of OAuthToken failed … Token header claim [kid] references unknown signing key : [default-jwt-key-94eece787e]"` — **byte-identical to #434** |
| Direct `jwt-bearer` to B's token endpoint | A (Joule2) | `unauthorized — "Unable to map issuer: No identity provider found for issuer: https://joule2-7lrbs13d.authentication.us10…"` |
| **Control:** same call, **B-issued** assertion (same subaccount) | B (dev) | `unauthorized — "Unable to map issuer: Origin claim is missing"` — issuer **accepted**; fails only later (my control used a client-credentials token with no user) |

Key correlation: the `kid` in the error (`default-jwt-key-94eece787e`) is **exactly** the signing-key
id of the A-issued token I minted — proving the rejected key is the *tools* subaccount's key. The
control proves specificity: a **same-subaccount** token gets *past* the issuer/trust check and fails
only at a later (user-context) stage; the **cross-subaccount** token never gets past trust.

Two error wordings, one root cause: the Destination Service's `find-destination` (the path ARC-1
uses) surfaces `kid references unknown signing key` (the #434 wording); a raw `jwt-bearer` POST
surfaces `Unable to map issuer` (the wording in SAP community thread 12685232). Both = "the target
XSUAA does not trust a token issued by a different subaccount."

**Reproduction recipe** (fully torn down afterward — created only an isolated `arc1-repro-434-dest`
destination instance + key; never touched existing services):

```bash
# In subaccount A (≠ the ABAP env's subaccount B), CF space targeted:
jq '{init_data:{instance:{existing_destinations_policy:"update",destinations:[{
  Name:"ARC1_REPRO_434",Type:"HTTP",URL:.url,ProxyType:"Internet",
  Authentication:"OAuth2UserTokenExchange",tokenServiceURL:(.uaa.url+"/oauth/token"),
  clientId:.uaa.clientid,clientSecret:.uaa.clientsecret}]}}}' <abap-env-service-key.json> > dest.json
cf create-service destination lite arc1-repro-434-dest -c dest.json
cf create-service-key arc1-repro-434-dest k1
# read key: A_XSUAA=.credentials.url, DEST_URI=.credentials.uri, A_CID/.credentials.clientid, A_CSEC
A_TOKEN=$(curl -s -X POST "$A_XSUAA/oauth/token" -u "$A_CID:$A_CSEC" -d grant_type=client_credentials | jq -r .access_token)
curl -s "$DEST_URI/destination-configuration/v1/destinations/ARC1_REPRO_434" \
  -H "Authorization: Bearer $A_TOKEN" -H "X-user-token: $A_TOKEN" | jq '.authTokens'
# => error: "… Token header claim [kid] references unknown signing key : [default-jwt-key-…]"
# teardown: cf delete-service-key arc1-repro-434-dest k1 -f && cf delete-service arc1-repro-434-dest -f
```

## Root cause

`OAuth2UserTokenExchange` = JWT bearer grant (`urn:ietf:params:oauth:grant-type:jwt-bearer`). The
Destination Service exchanges the **caller's** JWT (here: ARC-1's MCP user token, minted by the
*tools*-subaccount XSUAA) at the destination's `tokenServiceURL` (the ABAP env's XSUAA, a *different*
subaccount). XSUAA validates the assertion's signature against keys it trusts (its own subaccount +
any registered IdP). A foreign subaccount's signing key is unknown → `kid references unknown signing
key`. There is no XSUAA→XSUAA cross-subaccount trust by default (SAP community: a JWT from subaccount
A is not valid in B; XSUAA can't be CF-shared — q&a 14341793; same wall in q&a 12685232).

ARC-1's role is correct end-to-end:
- `src/adt/btp.ts:375-383` — reads the SDK `authTokens`; if an entry has `.error`, throws
  `Destination Service auth token error for '<dest>': <error>` (verbatim).
- `src/server/server.ts:636-658` — catches it, emits `auth_pp_created success:false`, and (with
  `SAP_PP_STRICT=true`) returns `Principal propagation failed (SAP_PP_STRICT=true): …` to the client.
- ARC-1 cannot substitute a token: the MCP client authenticates against ARC-1's (tools-subaccount)
  XSUAA, so the only JWT available is a tools-subaccount one.

## Best practice (official SAP guidance)

SAP documents the rule explicitly for the BTP ABAP Environment — [Routing via Destination](https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/97d7a02cd6fd4f579fd96f41ee0d0c1d.html):

> "If the application and the instance of the ABAP environment reside in the **same subaccount**, use
> the **OAuth2UserTokenExchange** authentication type … If the application and the instance of the
> ABAP environment are deployed to **different subaccounts**, then use the **SAMLAssertion**
> authentication type."

| Topology | Destination auth type | Trust needed | ARC-1 support |
|---|---|---|---|
| ARC-1 + ABAP env **same subaccount** | `OAuth2UserTokenExchange` | none (shared identity zone) | ✅ documented |
| ARC-1 + ABAP env **different subaccounts** | `OAuth2SAMLBearerAssertion` | source subaccount's Destination Service registered as a **trusted IdP** in the ABAP env subaccount | ✅ already works (bearer token path) — undocumented |

Mechanism: `OAuth2UserTokenExchange` is an XSUAA→XSUAA exchange **within one subaccount/tenant** — the
target XSUAA only trusts its own subaccount's signing keys ([OAuth User Token Exchange Authentication](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/oauth-user-token-exchange-authentication)).
`OAuth2SAMLBearerAssertion` makes the source subaccount's Destination Service a **trusted SAML IdP**
in the target, so the user identity crosses the subaccount boundary ([User Propagation via SAML 2.0 Bearer Assertion Flow](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/user-propagation-via-saml-2-0-bearer-assertion-flow)).
Community confirms both the failure (q&a 12685232) and that cross-subaccount needs SAMLBearer + trust
(q&a 12532022, 12755429).

**Strategic note for ARC-1:** the "one central managed service for many SAP systems" vision
([[project_direction]]) is reachable across subaccounts **only** via `OAuth2SAMLBearerAssertion` with
per-backend trust setup; `OAuth2UserTokenExchange` is inherently one-subaccount-per-system.

## Not a duplicate

- **#301** (closed) — same error *family* but **same-subaccount**; resolved once the destination URL
  was changed from the `.abap-web.` Fiori host to the `.abap.` API host. Trust was never the issue.
- **#377** (closed) — layout advice; recommends "one subaccount per SAP system," which is exactly the
  fix here.

## Affected files (only if we add the optional UX improvement — there is no bug to fix)

- `src/handlers/dispatch.ts` — error formatting: recognize `unknown signing key` / `Unable to map
  issuer` from a PP/destination failure and add a hint ("ARC-1 and the ABAP Environment appear to be
  in different BTP subaccounts; `OAuth2UserTokenExchange` needs them in the same subaccount").
- `src/server/server.ts` — `auth_pp_created` failure path is where the message originates; could
  enrich the strict-mode client message.
- `docs_page/btp-abap-environment.md` — add an explicit "ARC-1's XSUAA and the ABAP Environment must
  be in the **same subaccount**" callout next to the destination recipe.
- Tests: a unit test asserting the new hint fires for the two error strings.

## Out of scope

- Making cross-subaccount `OAuth2UserTokenExchange` work — it's the wrong type for that topology;
  the supported cross-subaccount path is `OAuth2SAMLBearerAssertion` + trust (a BTP-config task the
  admin does once per backend; ARC-1 already supports the resulting bearer token).
- Any change to the token exchange itself — ARC-1 delegates this to the SAP Cloud SDK / Destination
  Service, which behaves correctly.

---

## Draft GitHub reply (review before posting — origin = `marianfoo`; do not auto-post)

```markdown
Thanks for the detailed logs — that's enough to pinpoint it, and I reproduced it end-to-end.

**This isn't an ARC-1 bug — it's a BTP cross-subaccount trust limitation, and ARC-1 is just
surfacing the Destination Service's own error.** You said it yourself: ARC-1 runs in your
`cxxx-tools` subaccount, but the ABAP Environment T02 is **in another subaccount**. Your destination
debug log confirms it — the user JWT is issued by the tools subaccount
(`iss=https://cxxx-tools.authentication…`), while the destination's Token Service URL points to the
T02 subaccount (`https://coyyyy-test-….authentication…/oauth/token`).

**Why it fails:** `OAuth2UserTokenExchange` does a JWT-bearer exchange — the Destination Service
sends the logged-in user's token (minted by ARC-1's XSUAA in the *tools* subaccount) to the ABAP
env's XSUAA in the *other* subaccount. XSUAA tokens are subaccount-scoped, so the T02 XSUAA doesn't
recognise the tools subaccount's signing key:

> Token header claim [kid] references unknown signing key : [default-jwt-key-8826357d37]

I reproduced this exactly in my own account with two subaccounts (A = "tools", B = the ABAP env). A
token minted in A and run through the real Destination Service against B's ABAP env returns the
**identical** error (only the kid hash differs — it's A's signing key). A token minted in B's own
subaccount sails past the trust check. So the destination config itself is correct; the issue is
purely that the two subaccounts don't share a trust zone. (SAP confirms this is expected: a JWT from
one subaccount isn't valid in another, and XSUAA can't be shared across subaccounts.)

This is actually SAP's documented behaviour. Per [Routing via Destination](https://help.sap.com/docs/ABAP_ENVIRONMENT/250515df61b74848810389e964f8c367/97d7a02cd6fd4f579fd96f41ee0d0c1d.html):
*same subaccount → `OAuth2UserTokenExchange`; different subaccounts → `SAMLAssertion`*. So you have
two supported options:

**Option 1 — simplest: move ARC-1 into the T02 ABAP env's subaccount.** Keep your
`OAuth2UserTokenExchange` destination exactly as-is (correct `.abap.` URL, client id/secret + token
URL from the service key); just create it and deploy ARC-1 in the ABAP env's subaccount. This is
ARC-1's recommended one-instance-per-system model (#377). The MCP user token is then issued in the
same trust zone the ABAP env validates against, and the exchange succeeds.

**Option 2 — keep your central "tools" subaccount: switch the destination to
`OAuth2SAMLBearerAssertion`.** For cross-subaccount, SAP uses the SAML bearer flow, where your tools
subaccount's Destination Service becomes a trusted IdP in the ABAP env's subaccount. This is more
BTP plumbing (you establish the trust once per backend), but **ARC-1 supports it with no changes** —
it already handles the bearer token the Destination Service returns for `OAuth2SAMLBearerAssertion`,
exactly as it does for `OAuth2UserTokenExchange`. See [User Propagation via SAML 2.0 Bearer Assertion Flow](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/user-propagation-via-saml-2-0-bearer-assertion-flow).

If you want one ARC-1 instance serving several ABAP systems across subaccounts, Option 2 is the path.
For a single backend, Option 1 is the least effort.

I'll also add a same-subaccount / SAMLBearer note + this troubleshooting to the BTP ABAP docs so the
next person gets clearer guidance. Let me know how it goes!
```
