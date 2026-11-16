# ADR-0011: Experimental local SAML bearer issuer

**Status:** Accepted for experimental, opt-in use (2026-11-16)

## Context

Single-target ARC-1 deployments outside BTP need per-user SAP identity. An on-premise ABAP
system from S/4HANA 2020 can trust a SAML bearer assertion provider in transaction SAML2.
ARC-1 already validates OIDC caller tokens and has an outbound `Authorization: SAML2.0` path.

## Decision

When the local issuer settings are complete, ARC-1 reads an **explicitly configured** NameID
claim from an already verified OIDC JWT, signs a short-lived assertion with a local RSA key, and
sends it to one configured SAP target. The claim must be administrator-controlled and immutable
to end users. Selecting `email` additionally requires boolean `email_verified=true`; that bit
does not make an editable email safe. Entra's `email` claim is unsuitable for this mapping.
Missing, malformed, control-bearing and over-256-character NameIDs fail before signing.

The signing key and currently valid certificate must be a matching RSA pair. Startup signs a
sample assertion and verifies it against the certificate. Operators mount the key privately
outside the repository, protect it like a root credential and rotate it with the SAML2 trust.
Any holder of the key can assert an identity mapped in the trusted provider.
Use one signing key and certificate per SAP target. The SAML2 local provider name must be unique
across all systems that trust any ARC-1 certificate. System copies can duplicate that name, so
operators must check and rename it before establishing the copied system's ARC-1 trust. This is
required because SAP_BASIS 758 accepted an unrelated SAML bearer Recipient (R25).

JWT propagation failures always return a tool error; they never fall back to `SAP_USER`.
An API-key caller uses the shared SAP identity only when `SAP_PP_STRICT=false` explicitly permits
mixed operation. Existing scope, safety, SAP authorization and per-user cache isolation gates
continue to apply.

## Scope and limits

The route is single-target and OIDC-only. Multi-target, XSUAA and BTP destination combinations
are rejected at startup. There is no user-to-user transport reuse, automatic trust provisioning,
claim transformation, alternate signing algorithm, or fallback credential. The final build was
verified on SAP_BASIS 758 only. The original contributor verified 816 on an earlier build; IAS and
final-build 816 qualification remain in SEC-23. Keycloak is the only validated IdP.
On A4H 758/001, 20 sequential reads created 20 `SECURITY_CONTEXT` rows (one per call) with a
120-second effective security-session timeout. A raw same-cookie SAP logoff removed its row
immediately, so the local-SAML call boundary now performs bounded, best-effort logoff after
dispatch returns. The resulting build passed 50 sequential plus 10 parallel reads and six updates,
including five parallel same-user updates, with the test user's row count back at baseline
immediately and after 10 seconds. Other releases and IdPs remain unqualified in SEC-23.

See the [operator guide](../../docs_page/local-sso-experimental.md),
[completed design plan](../plans/completed/2026-11-14-local-saml-bearer-pp-experimental.md),
[R24](../security-model.md) and [R25](../security-model.md).
