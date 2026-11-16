# Local SSO experimental: per-user SAP identity without BTP

Templates for the setup described in [docs_page/local-sso-experimental.md](../../docs_page/local-sso-experimental.md):
a self-hosted ARC-1 container that validates OIDC tokens from a local Keycloak and signs a SAML 2.0
bearer assertion per user for an on-premise ABAP system. **Experimental** (roadmap SEC-23):
use an authorized S/4HANA 2020+ test system and protect the signing key as a root credential.

| File | Purpose |
|---|---|
| `compose.yaml` | Base ARC-1 container (API key, shared `SAP_USER`), loopback port 8091 |
| `compose.saml.yaml` | Overlay: experimental image, SAML issuer settings, Keycloak, loopback forwarder sidecar |
| `arc1-local.env.example` | SAP connection and API key. Copy to `arc1-local.env`; never commit the copy |
| `gen-saml-idp.sh` | Creates the signing key pair and the IdP metadata file for transaction SAML2 |
| `keycloak/arc1-realm.json` | Realm `arc1`: ARC-1 scopes, audience, verified admin-controlled email, dynamic client registration for loopback clients, one test user |
| `saml/` | Target folder for the generated key, certificate and metadata (content gitignored) |

Copy the folder somewhere outside the repository (for example `~/.config/arc-1/local-sso/`), replace
every `REPLACE_ME` value, then follow the guide. Secrets (SAP password, API key, Keycloak passwords,
the private key) stay in that folder and never in this repository.
