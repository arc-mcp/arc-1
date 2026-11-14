# Prototype: per-user SAP identity without BTP via a local SAML bearer issuer

**Status:** prototype on branch `proto/saml-bearer-pp` (roadmap SEC-23). Not merged, not an ADR.
**Target system used:** A4H (ABAP Platform 2025), client 001, `https://a4h-2025.marianzeis.de:50001`.

## Problem

A self-hosted ARC-1 (Docker, npm) with OIDC authentication knows who the MCP caller is, but every
SAP request still runs as the shared `SAP_USER`. The only per-user paths (`createPerUserClient`) need a
BTP Destination Service binding (`VCAP_SERVICES`) and, on-premise, a Cloud Connector. Goal of the
spike: IAS (or any OIDC IdP) in front, the user's own SAP identity behind, no BTP in the middle.

## Mechanism

1. The MCP client obtains an OIDC token from IAS; ARC-1 validates issuer and audience as today.
2. For each JWT-authenticated tool call, ARC-1 mints a signed SAML 2.0 bearer assertion:
   `Issuer` = ARC-1's entity ID, `NameID` = the token's `email` claim (configurable claim and format),
   bearer `SubjectConfirmation` with `Recipient`, `AudienceRestriction` = the ABAP system's local SAML2
   provider name, `AuthnContextClassRef` = `PreviousSession`, RSA-SHA256 enveloped signature with the
   certificate in `KeyInfo`, 300 s validity.
3. The assertion rides the existing `samlAuthorization` path in `src/adt/http.ts`:
   `Authorization: SAML2.0 <base64>` plus `x-sap-security-session: create`. This is byte-for-byte the
   contract a BTP `SAMLAssertion` destination produces; SAP documents on-premise support from
   S/4HANA 2020 ([SAML Assertion Authentication](https://help.sap.com/docs/CP_CONNECTIVITY/cca91383641e40ffbe03bdc78f00f681/d81e1683bd434823abf3ceefc4ff157f.html)).
4. The ABAP system trusts ARC-1's certificate as a SAML identity provider (transaction SAML2) and maps
   the e-mail NameID to the SU01 user.

The shared `SAP_USER` remains only the single-target startup identity (discovery, feature probes, and
API-key calls when `SAP_PP_STRICT=false`). JWT calls never fall back to it.

## Code (branch `proto/saml-bearer-pp`)

| File | Role |
|------|------|
| `src/adt/saml-bearer.ts` | `loadSamlBearerIdp`, `resolveSamlNameId`, `buildSamlBearerAssertion` (xml-crypto) |
| `src/server/saml-bearer-client.ts` | Startup load + per-request client construction with `auth_pp_created` audit events |
| `src/server/server.ts` | `CreateServerOptions.samlBearerIdp`; the JWT branch prefers the local issuer when configured and single-target |
| `src/server/{config,types}.ts` | `SAP_PP_SAML_*` options (also CLI flags), fail-closed validation |
| `tests/unit/adt/saml-bearer.test.ts`, `tests/unit/server/config-saml-bearer.test.ts` | Signature round-trip, tampering, escaping, claim resolution, config gates |
| `tests/fixtures/saml/test-idp.{key,crt}` | Throwaway test-only signing pair |
| `package.json` | New dependencies `xml-crypto`, `@xmldom/xmldom` |
| `scripts/ci/check-file-sizes.mjs` | `server.ts` budget raised 1497 → 1520 for the hook |

Configuration:

| Variable | Meaning |
|----------|---------|
| `SAP_PP_SAML_IDP_KEY_FILE` / `SAP_PP_SAML_IDP_CERT_FILE` | PEM signing key and certificate (enables the issuer) |
| `SAP_PP_SAML_ISSUER` | SAML entity ID trusted by SAP |
| `SAP_PP_SAML_AUDIENCE` | SAP local provider name (SAML2 → Local Provider) |
| `SAP_PP_SAML_RECIPIENT` | Optional; defaults to `SAP_URL` |
| `SAP_PP_SAML_NAMEID_CLAIM` / `SAP_PP_SAML_NAMEID_FORMAT` | Default `email` / `email`; `unspecified` maps the claim to the SAP user name |
| `SAP_PP_SAML_AUTHN_CONTEXT`, `SAP_PP_SAML_TTL_SECONDS` | Defaults `PreviousSession`, 300 (clamped 30–3600) |

Validation refuses: partial configuration, `SAP_PP_ENABLED` unset, no `SAP_OIDC_ISSUER`, multi-target
or XSUAA mode, missing `SAP_URL`, non-PEM files.

## Verified so far (2026-11-14)

- Unit tests pass; `npm run typecheck`, Biome, `validate:policy` and `check:sizes` pass.
- Docker image `arc1-saml-proto` built from the branch; startup with the issuer configured logs
  `auth: MCP=[api-keys,oidc] SAP=pp (mixed: JWT per-user, API keys shared)` and the issuer parameters.
- Standalone script (`gen-assertion.mjs`, scratchpad) produced assertions whose signatures verify
  locally. A4H answered a plain 401 to a signed assertion because SAML 2.0 is not yet enabled on client
  001 (the SAML2 ICF nodes returned 403 "Service cannot be reached").

## Not yet verified

- A4H accepts the assertion and logs on the mapped user (the central claim of the spike).
- IAS OIDC application + an MCP client completing the flow (Claude Code supports `--client-id`).
- Scope claims: IAS tokens without `scope`/`scp` fall back to read-only in ARC-1.

## SAP-side setup for A4H (operator steps)

Source: SAP Help, ABAP Platform, "SAML Bearer Assertions for Principle Propagation"
(loio 236960c96324416c8ed84b2666212d49). SAP calls the `Authorization: SAML2.0 <b64>` binding
proprietary; it is consumed only by a trusted provider of the **SAML Bearer Assertion Providers**
category, not by the web-SSO "Identity Providers" list and not by "OAuth 2.0 Identity Providers".

1. SICF on client 001: activate `/sap/bc/saml2`, `/sap/public/bc/sec/saml2` and
   `/sap/bc/webdynpro/sap/saml2` (there is no `/sap/saml2` node).
2. Transaction SAML2 → Enable SAML 2.0 Support → Create SAML 2.0 Local Provider; the name you enter
   is `SAP_PP_SAML_AUDIENCE` (A4H: `A4H_WL`). Do not use the "upload" option of that wizard: it
   expects an exported local provider with PSEs and fails with "Selected file does not contain PSEs".
3. Trusted Providers → Show: **SAML Bearer Assertion Providers** → Add → Upload Metadata File →
   `arc1-local-saml-idp-metadata.xml` → Finish. The metadata only needs entity ID and signing
   certificate.
4. Edit → Identity Federation → Add: NameID format **E-mail**, user ID source e-mail (1:1 match with
   the SU01 e-mail). For `unspecified`, map NameID to the logon ID. Save, then Enable.
5. SU01: maintain the user's e-mail (`wouter@lemaire.tech` for the Keycloak test user).
6. Diagnose rejected assertions with the SAML2 troubleshooting tab or `SEC_DIAG_TOOL`.

## Decisions pending before this becomes a feature

- ADR + security review (design principle 7: new auth model, fail-closed, no shared fallback).
- Key lifecycle: generation, storage, rotation, metadata publication; certificate pinning on SAP side.
- Session handling: each call sends `x-sap-security-session: create`; reuse per user (OPS-06).
- Where it lives: core vs. extension; CLI surface; documentation in `docs_page/enterprise-auth.md`.
