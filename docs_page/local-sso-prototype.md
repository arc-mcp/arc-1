# Local SSO Prototype: Per-User SAP Identity Without BTP

> **Prototype.** This guide describes roadmap item SEC-23 as it exists on branch
> `proto/saml-bearer-pp`. It is not in a released image, has no ADR or security review yet, and the
> settings may change. Use it on a personal or sandbox ABAP system only. The design and the open
> decisions are in the [plan document](https://github.com/arc-mcp/arc-1/blob/main/docs/plans/2026-11-14-local-saml-bearer-pp-prototype.md).

Every released per-user path in ARC-1 needs SAP BTP (Destination Service, Cloud Connector or XSUAA).
This prototype gives a self-hosted ARC-1 (Docker) per-user SAP identity with nothing but an OIDC
identity provider and a trust entry on the ABAP system:

```
MCP client ──OIDC login──▶ Keycloak (or another OIDC IdP)
    │  Bearer <JWT>
    ▼
ARC-1 (Docker)   validates issuer + audience, maps scopes, reads the e-mail claim
    │  Authorization: SAML2.0 <assertion signed by ARC-1, NameID = e-mail>
    ▼
ABAP system      SAML2 "SAML Bearer Assertion Provider" trusts ARC-1's certificate,
                 maps the e-mail to the SU01 user, runs the call as that user
```

The SAP side uses a documented ABAP Platform feature: [SAML Bearer Assertions for Principle Propagation](https://help.sap.com/docs/ABAP_PLATFORM_NEW/e815bb97839a4d83be6c4fca48ee5777/236960c96324416c8ed84b2666212d49.html)
(S/4HANA 2020 and later; verified on ABAP Platform 2025). The MCP-facing side is ARC-1's existing
OIDC support plus the new `SAP_PP_SAML_*` settings.

Verified on 2026-11-14 against an S/4HANA 2025 trial system: a Keycloak login in Claude Code and in
VS Code Copilot, `SAPRead`, and a `SAPWrite` whose object SAP recorded with the propagated user as
`responsible` and `changedBy`.

## Prerequisites

- Docker Desktop or Docker Engine with Compose v2, and a checkout of branch `proto/saml-bearer-pp`.
- An ABAP system reachable over HTTPS from your machine, S/4HANA 2020 or later, with a user who can run
  transactions `SAML2`, `SICF` and `SU01` on the target client.
- `openssl` on your machine (Git Bash on Windows includes it).
- An MCP client with OAuth support: Claude Code or VS Code (GitHub Copilot). Copilot Studio and other
  cloud clients cannot reach `localhost`.

## 1. Build the prototype image

```bash
git checkout proto/saml-bearer-pp
docker build -t arc1-saml-proto .
```

## 2. Create the working folder

Copy [`examples/local-sso/`](https://github.com/arc-mcp/arc-1/tree/main/examples/local-sso) to a folder
outside the repository, for example `~/.config/arc-1/local-sso/`. It contains the base `compose.yaml`,
the `compose.saml.yaml` overlay, a Keycloak realm, an env example and a key generator.

```bash
cp arc1-local.env.example arc1-local.env     # SAP_URL, SAP_USER, SAP_PASSWORD, SAP_CLIENT, ARC1_API_KEYS
```

The shared `SAP_USER` is still needed: ARC-1 uses it for startup discovery and for API-key calls.
Propagated calls never fall back to it.

## 3. Generate the signing key and the IdP metadata

```bash
./gen-saml-idp.sh                 # also works in Git Bash on Windows
```

This writes `saml/arc1-saml-idp.key`, `saml/arc1-saml-idp.crt` and
`saml/arc1-local-saml-idp-metadata.xml`. The key is what ARC-1 signs assertions with; whoever holds it
can log on to the ABAP system as any user whose e-mail is federated. Keep it with the same care as the
SAP password. The metadata file is what you upload into SAML2; it contains only the entity ID
`arc1-local-saml-idp` and the certificate.

## 4. Keycloak as the local identity provider

The realm file `keycloak/arc1-realm.json` is imported on every Keycloak start and contains:

- client scopes `read write data sql transports git`, which ARC-1 reads from the token's `scope` claim;
- a realm-default scope `arc1` that adds the audience `arc1-local` and the `email` and
  `preferred_username` claims to every client's tokens;
- anonymous dynamic client registration, limited to clients whose redirect URIs are on `localhost`,
  `127.0.0.1` or `vscode.dev`. Claude Code and VS Code register themselves this way;
- a pre-registered public client `arc1-local` with the password grant enabled for curl tests;
- one test user. Replace `REPLACE_ME@example.com` and the password. The e-mail must equal the SU01 e-mail
  of the SAP user this person should become.

Replace `KC_BOOTSTRAP_ADMIN_PASSWORD` in `compose.saml.yaml`. Keycloak runs in dev mode without a data
volume: anything you change in the admin console at `http://localhost:8180/admin/` is lost on the next
recreate. Edit the JSON instead.

**Why the issuer is `http://localhost:8180`.** The MCP SDK used by Claude Code and VS Code refuses to
send credentials to an `http` token endpoint unless the host is literally `localhost`, `127.0.0.1` or
`::1`. A `.localhost` alias is rejected. Inside the ARC-1 container, `localhost` would be the container
itself, so the overlay adds a small `socat` sidecar that shares ARC-1's network namespace and forwards
loopback port 8180 to Keycloak. The same issuer URL therefore works on your machine and inside the
container, and ARC-1 can fetch the signing keys from it.

## 5. Settings in `compose.saml.yaml`

| Setting | Value in the template | Meaning |
|---|---|---|
| `ARC1_PUBLIC_URL` | `http://localhost:8091` | Advertised in the OAuth protected-resource metadata; clients compare it with the URL they call |
| `SAP_PP_ENABLED` / `SAP_PP_STRICT` | `true` / `false` | Enable per-user identity; keep the API key usable beside it (strict mode would reject non-JWT callers) |
| `SAP_OIDC_ISSUER` / `SAP_OIDC_AUDIENCE` | `http://localhost:8180/realms/arc1` / `arc1-local` | Token validation |
| `SAP_PP_SAML_IDP_KEY_FILE` / `_CERT_FILE` | paths under `/home/arc1/saml` | Signing key pair, mounted read-only |
| `SAP_PP_SAML_ISSUER` | `arc1-local-saml-idp` | SAML Issuer; must equal the metadata entity ID |
| `SAP_PP_SAML_AUDIENCE` | **replace** | The ABAP system's SAML2 local provider name (step 6) |
| `SAP_PP_SAML_NAMEID_CLAIM` / `_FORMAT` | `email` / `email` | Which JWT claim becomes the NameID and in which format; `unspecified` maps to the logon ID instead |
| `SAP_PP_SAML_RECIPIENT` | unset (= `SAP_URL`) | `SubjectConfirmationData/@Recipient` |
| `SAP_PP_SAML_TTL_SECONDS` | `300` | Assertion validity, clamped to 30–3600 |

All `SAP_PP_SAML_*` settings must be set together, require `SAP_PP_ENABLED=true` and an OIDC issuer,
and are refused in multi-target or XSUAA mode. Startup fails on an incomplete set.

## 6. Trust on the ABAP system (transaction SAML2)

Do this on the target client. The provider category matters: only a **SAML Bearer Assertion Provider**
consumes an assertion sent in the HTTP `Authorization` header. The web-SSO "Identity Providers" list
and the "OAuth 2.0 Identity Providers" list both answer a bare `401` to it.

1. `SICF`: activate `/sap/bc/saml2`, `/sap/public/bc/sec/saml2` and `/sap/bc/webdynpro/sap/saml2`.
2. `SAML2` → **Enable SAML 2.0 Support** → **Create SAML 2.0 Local Provider**. The name you enter is the
   value for `SAP_PP_SAML_AUDIENCE`. Do not use the upload option of this wizard; it expects an export
   of another system's local provider and fails with "Selected file does not contain PSEs to be imported".
3. **Trusted Providers** tab → *Show:* **SAML Bearer Assertion Providers** → **Add** →
   **Upload Metadata File** → `saml/arc1-local-saml-idp-metadata.xml` → Finish.
4. Select the provider → **Edit** → **Identity Federation** → **Add**: NameID format **E-mail**, user ID
   source e-mail. Save, then **Enable**.
5. `SU01`: give each SAP user the e-mail address that their IdP account has. SAP requires exactly one
   user per address.

Put the local provider name into `SAP_PP_SAML_AUDIENCE` and start everything:

```bash
docker compose -f compose.yaml -f compose.saml.yaml up -d
docker logs arc1 | grep -E "SAML bearer issuer|OIDC JWKS"
```

## 7. Connect an MCP client

**Claude Code**

```bash
claude mcp add --transport http -s user arc1-sso http://localhost:8091/mcp
```

Start a new `claude` session (running sessions do not pick up new servers), run `/mcp`, choose
`arc1-sso` and log in on the Keycloak page that opens. Do not pass `--client-id`: dynamic registration
is enabled, and the pre-registered client option skipped discovery in our test and sent the browser to
ARC-1 instead of Keycloak.

**VS Code (GitHub Copilot)**

Add to the user `mcp.json` (Command Palette → *MCP: Open User Configuration*):

```json
"arc1-sso": { "type": "http", "url": "http://localhost:8091/mcp" }
```

Start the server from *MCP: List Servers* and accept the login prompt. VS Code registers itself with
Keycloak and opens the same login page.

**curl (no browser)** uses the pre-registered client and the password grant:

```bash
TOKEN=$(curl -s -X POST http://localhost:8180/realms/arc1/protocol/openid-connect/token \
  -d client_id=arc1-local -d grant_type=password -d scope=openid \
  -d username=developer -d password=REPLACE_ME | jq -r .access_token)
curl -s -X POST http://localhost:8091/mcp -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"SAPRead","arguments":{"type":"CLAS","name":"CL_ABAP_CHAR_UTILITIES","lineStart":1,"lineEnd":5}}}'
```

## 8. Verify that SAP sees the right user

- ARC-1's log shows one `auth_pp_created` event per call with `destination=local-saml-bearer` and the
  e-mail in `user`. API-key calls do not emit it.
- Create any object in `$TMP` through the propagated connection and read its properties: SAP records the
  SU01 user as `responsible` and `changedBy`. Transactions `SM04` and `SM05` list the HTTP session under
  that user while the call runs.
- The shared `SAP_USER` must appear only for startup discovery and for API-key calls.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Keycloak login works, then "Refusing to send credentials to non-https token endpoint" | Issuer host is not literally `localhost`, `127.0.0.1` or `::1` | Keep `KC_HOSTNAME` and `SAP_OIDC_ISSUER` on `http://localhost:8180`; the socat sidecar makes that reachable inside the container |
| Browser shows ARC-1's "Not found. Use /mcp …" page during login | Client skipped discovery and treated ARC-1 as the authorization server | Remove `--client-id` from the Claude Code entry; let the client register dynamically |
| Keycloak answers `Host not trusted` to a registration | Redirect URI host is not in the realm's trusted-hosts policy | Add the host to `trusted-hosts` in the realm JSON and recreate Keycloak |
| ARC-1 logs "no usable email claim" | Token lacks `email` | Give the Keycloak user an e-mail; check the `arc1` scope is a realm default |
| SAP answers `401` with no detail although the signature verifies | Provider added under "Identity Providers" or "OAuth 2.0 Identity Providers", or SAML2 not enabled on that client | Add it under **SAML Bearer Assertion Providers**; check the `SICF` nodes; see `SEC_DIAG_TOOL` for the rejection reason |
| "Selected file does not contain PSEs to be imported" | Metadata uploaded in the Local Provider wizard | Create the local provider manually; upload the metadata under Trusted Providers |
| Login succeeds but SAP runs the call as the wrong or no user | SU01 e-mail missing, different, or shared by two users | Make the SU01 e-mail unique and equal to the IdP e-mail |
| ARC-1 refuses to start with a `SAP_PP_SAML_*` message | Incomplete setting group, or `SAP_PP_ENABLED`/`SAP_OIDC_ISSUER` missing | Set all of them together as in the template |

## Security notes and limits

- The signing key is a credential for every federated user. Store it outside the repository, mount it
  read-only, rotate it by generating a new pair and re-uploading the metadata.
- Keycloak here is a dev-mode test IdP over plain HTTP on loopback. It is not an IAS replacement and
  must never be exposed beyond `127.0.0.1`.
- ARC-1 scopes come from the token and restrict only; SAP authorizations of the propagated user still
  apply. `SAP_PP_STRICT=false` keeps the API key usable beside per-user identity; set it to `true` to
  refuse every non-JWT caller.
- Each tool call sends a fresh assertion with `x-sap-security-session: create`. Session reuse per user,
  key lifecycle, IAS as issuer and an ADR are open items before this leaves prototype status.
