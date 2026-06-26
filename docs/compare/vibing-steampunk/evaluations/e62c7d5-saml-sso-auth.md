# SAML SSO Authentication for S/4HANA Public Cloud

> **Priority**: Low (ARC-1 has different auth model for cloud — BTP OAuth)
> **Source**: vibing-steampunk commit e62c7d5, PR #97 (2026-04-12) by blicksten
> **ARC-1 component**: `src/adt/oauth.ts`, `src/server/http.ts`

## What vibing-steampunk added

Three authentication enhancements:

1. **`--saml-auth`**: Programmatic SAML SSO without browser. Implements full SAP→IAS→SAP SAML flow. Doesn't support MFA.
2. **`--browser-auth` improvements**: Better cookie filtering, 500ms polling, verbose SAML redirect logging for browser-based SAML/IAS flows with MFA support.
3. **`--credential-cmd`**: External credential provider (git-credential-helper pattern). Commands return JSON `{"username":"...","password":"..."}`.

Security hardening:
- HTTPS→HTTP downgrade prevention (5 enforcement points)
- Host validation prevents credential exfiltration
- Credential zeroing after use
- No shell execution in credential commands (argv-based)
- 10-hop redirect/form chain limit
- Auto re-authentication on 401 with stampede protection

### Configuration

```bash
# Programmatic SAML (headless)
vsp --saml-auth --saml-user user@company.com --saml-password '***' \
    --url https://your-system.s4hana.cloud.sap

# Browser-based SAML (with MFA)
vsp --browser-auth --url https://your-system.s4hana.cloud.sap

# External credential provider
vsp --saml-auth --credential-cmd 'my-credential-helper get SAP' \
    --url https://your-system.s4hana.cloud.sap
```

## ARC-1 comparison

ARC-1 connects to S/4HANA Public Cloud differently:
- **BTP ABAP Environment**: OAuth 2.0 browser login via `src/adt/oauth.ts`
- **BTP Destination Service**: Service key + destination configuration
- **Principal Propagation**: Per-user JWT → BTP Destination → SAP session

ARC-1 doesn't need SAML for BTP because it uses OAuth 2.0 / service keys. However, for **on-prem S/4HANA systems behind IAS/SAML** (without BTP Destination Service), SAML auth could be relevant.

### Use case gap

If a customer has:
- S/4HANA on-prem
- IAS (Identity Authentication Service) as IdP
- Basic Auth disabled
- No BTP Destination Service available

Then ARC-1 can't connect. vibing-steampunk's SAML auth handles this scenario.

## Decision

**Low priority / defer.** ARC-1's target deployment is BTP-native (Destination Service + Cloud Connector). Customers without BTP access can use Basic Auth. SAML-only deployments are an edge case. If demand appears, study vibing-steampunk's implementation as reference.

The `--credential-cmd` pattern is independently interesting for credential rotation — could be considered for ARC-1's API key management.
