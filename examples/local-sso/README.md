# Local SSO prototype: per-user SAP identity without BTP

Templates for the setup described in [docs_page/local-sso-prototype.md](../../docs_page/local-sso-prototype.md):
a self-hosted ARC-1 container that validates OIDC tokens from a local Keycloak and signs a SAML 2.0
bearer assertion per user for an on-premise ABAP system. **Prototype** (roadmap SEC-23): the feature
lives on branch `proto/saml-bearer-pp` and is not in a released image.

| File | Purpose |
|---|---|
| `compose.yaml` | Base ARC-1 container (API key, shared `SAP_USER`), loopback port 8091 |
| `compose.saml.yaml` | Overlay: prototype image, SAML issuer settings, Keycloak, loopback forwarder sidecar |
| `arc1-local.env.example` | SAP connection and API key. Copy to `arc1-local.env`; never commit the copy |
| `gen-saml-idp.sh` | Creates the signing key pair and the IdP metadata file for transaction SAML2 |
| `keycloak/arc1-realm.json` | Realm `arc1`: ARC-1 scopes, audience and e-mail mappers, dynamic client registration for loopback clients, one test user |
| `saml/` | Target folder for the generated key, certificate and metadata (content gitignored) |

Copy the folder somewhere outside the repository (for example `~/.config/arc-1/local-sso/`), replace
every `REPLACE_ME` value, then follow the guide. Secrets (SAP password, API key, Keycloak passwords,
the private key) stay in that folder and never in this repository.
