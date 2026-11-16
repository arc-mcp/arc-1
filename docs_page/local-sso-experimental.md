# Experimental Local SSO: Per-User SAP Identity Without BTP

> **Experimental, opt-in.** Use this on an authorized test system until your security team approves
> the signing-key trust. See [ADR-0011](https://github.com/arc-mcp/arc-1/blob/main/docs/adr/0011-local-saml-bearer-issuer.md) and the
> [security risk register](https://github.com/arc-mcp/arc-1/blob/main/docs/security-model.md).

This feature gives a self-hosted ARC-1 (Docker or npm) per-user SAP identity with an OIDC
identity provider and a trust entry on the ABAP system:

```
MCP client ──OIDC login──▶ Keycloak (or another OIDC IdP)
    │  Bearer <JWT>
    ▼
ARC-1 (Docker)   validates issuer + audience, maps scopes, reads the configured NameID claim
    │  Authorization: SAML2.0 <assertion signed by ARC-1, NameID = e-mail>
    ▼
ABAP system      SAML2 "SAML Bearer Assertion Provider" trusts ARC-1's certificate,
                 maps the e-mail to the SU01 user, runs the call as that user
```

The SAP side uses a documented ABAP Platform feature: [SAML Bearer Assertions for Principle Propagation](https://help.sap.com/docs/ABAP_PLATFORM_NEW/e815bb97839a4d83be6c4fca48ee5777/236960c96324416c8ed84b2666212d49.html)
(S/4HANA 2020 and later). The MCP-facing side is ARC-1's existing
OIDC support plus the new `SAP_PP_SAML_*` settings.

The final build is verified on SAP_BASIS 758 only and validated with Keycloak only. The original
contributor verified SAP_BASIS 816 on an earlier build; that is not final-build coverage.

## Prerequisites

- Docker Desktop or Docker Engine with Compose v2, and a build containing this feature.
- An ABAP system reachable over HTTPS from your machine, S/4HANA 2020 or later, with a user who can run
  transactions `SAML2`, `SICF` and `SU01` on the target client.
- `openssl` on your machine (Git Bash on Windows includes it).
- An MCP client with OAuth support: Claude Code or VS Code (GitHub Copilot). Copilot Studio and other
  cloud clients cannot reach `localhost`.

## 1. Build the experimental image

```bash
docker build -t arc1-saml-experimental .
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
- a realm-default scope `arc1` that adds the audience `arc1-local`, immutable `sub`, `email`,
  `preferred_username`, and boolean `email_verified` claims to every client's tokens;
- anonymous dynamic client registration, limited to clients whose redirect URIs are on `localhost`,
  `127.0.0.1` or `vscode.dev`. Claude Code and VS Code register themselves this way;
- a pre-registered public client `arc1-local` with the password grant enabled for curl tests;
- one test user. Replace `REPLACE_ME@example.com` and the password. The e-mail must equal the SU01 e-mail
  of the SAP user this person should become. Keycloak requires email verification and only an admin
  can edit the email attribute in this example.

Choose the NameID claim before configuring SAP user mapping:

| OIDC provider | Claim for NameID | Validation |
|---|---|---|
| Keycloak | Verified `email` with administrator-only edits, or a custom administrator-set attribute | Verified `email` on SAP_BASIS 758; custom attribute untested |
| Entra ID | An administrator-controlled stable claim; never `email` | Untested. Entra's `email` can be user-editable, so verification alone is insufficient. |
| SAP Cloud Identity Services | An administrator-controlled stable claim | Untested. Its tokens carry no `scope` claim; validate ARC-1 scope mapping separately before use. |

An IdP administrator can still assign a verified identity to another account; protect that
privilege and audit changes to the chosen claim.
On A4H 758/001, an administrator-set duplicate email with `email_verified=false` was rejected by
ARC-1 before SAP authentication; this does not prevent an IdP administrator from assigning a
verified identity.

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
| `SAP_PP_SAML_NAMEID_CLAIM` / `_FORMAT` | explicitly `email` / `email` | Which JWT claim becomes the NameID and in which format; `email` requires boolean `email_verified=true`. Use an administrator-controlled claim; `unspecified` can map to a SAP logon ID. |
| `SAP_PP_SAML_RECIPIENT` | unset (= `SAP_URL`) | `SubjectConfirmationData/@Recipient` |
| `SAP_PP_SAML_TTL_SECONDS` | `300` | Assertion validity, clamped to 30–3600 |

The key, certificate, issuer, audience and NameID claim are required together with
`SAP_PP_ENABLED=true` and an OIDC issuer. Multi-target and XSUAA mode are refused. Startup signs
and verifies a sample assertion; an invalid key, expired certificate or mismatch aborts startup.
If `SAP_INSECURE=true`, ARC-1 warns at startup: a captured assertion is a bearer credential until
it expires.

## 6. Trust on the ABAP system (transaction SAML2)

Do this on the target client. **Use a distinct signing key and certificate for each SAP target.**
The SAML2 local provider name must be unique across every system that trusts any ARC-1 certificate.
Check and rename copied systems before creating their ARC-1 trust; system copies can duplicate local
provider names. The provider category matters: only a **SAML Bearer Assertion Provider**
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
| ARC-1 logs "no usable email claim" or `email_verified` error | Token lacks a verified `email` | Verify the Keycloak user's e-mail; check the `arc1` scope mappers and account policy |
| SAP answers `401` with no detail although the signature verifies | Provider added under "Identity Providers" or "OAuth 2.0 Identity Providers", or SAML2 not enabled on that client | Add it under **SAML Bearer Assertion Providers**; check the `SICF` nodes; see `SEC_DIAG_TOOL` for the rejection reason |
| "Selected file does not contain PSEs to be imported" | Metadata uploaded in the Local Provider wizard | Create the local provider manually; upload the metadata under Trusted Providers |
| Login succeeds but SAP runs the call as the wrong or no user | SU01 e-mail missing, different, or shared by two users | Make the SU01 e-mail unique and equal to the IdP e-mail |
| ARC-1 refuses to start with a `SAP_PP_SAML_*` message | Incomplete setting group, or `SAP_PP_ENABLED`/`SAP_OIDC_ISSUER` missing | Set all of them together as in the template |

## Security notes and limits

- The signing key can assert every user mapped in the SAML2 trust. Store it outside the repository,
  grant file read access only to the ARC-1 process and mount it read-only. Treat it like a root credential.
- Keycloak here is a dev-mode test IdP over plain HTTP on loopback. It is not an IAS replacement and
  must never be exposed beyond `127.0.0.1`.
- ARC-1 scopes come from the token and restrict only; SAP authorizations of the propagated user still
  apply. `SAP_PP_STRICT=false` keeps the API key usable beside per-user identity; set it to `true` to
  refuse every non-JWT caller.
- A4H 758/001's effective `http/security_session_timeout` was 120 seconds. With no test-user
  sessions at baseline, 20 sequential SAML SAPRead calls created 20 `SECURITY_CONTEXT` rows: one
  per call. Their `START_TIMESTAMP` values were 10:03:44–46 UTC and `EOL_TIMESTAMP` values were
  10:05:44–46 UTC. All 20 still existed about 20 seconds after EOL and were gone by the next poll
  about 30 seconds later. A separate raw SAML request created one row; SAP's logoff request with
  the same cookie removed it immediately (1 → 0), and it remained absent after 10 seconds. ARC-1
  now sends that bounded, best-effort logoff after each local-SAML tool call. On the resulting build,
  50 sequential plus 10 parallel reads, one lock/modify/unlock write, and five parallel same-user
  writes all succeeded; the test user's row count was 0 immediately afterward and after 10 seconds.
  `http/security_context_cache_size=2500` is a **per-application-server cache capacity**, not a
  per-user session limit. When the cache fills, SAP documents missing session cookies and possible
  HTTP 401 responses. See [SAP's HTTP security session documentation](https://help.sap.com/saphelp_snc700_ehp01/helpdata/en/bb/1bcf2122fd4a76948816b1342f20d7/content.htm?no_cache=true)
  and [KBA 3083426](https://userapps.support.sap.com/sap/support/knowledge/en/3083426).
- A4H 7.58/001 rejected a wrong audience and an untrusted signing certificate, but accepted an
  assertion with an unrelated `SubjectConfirmationData/@Recipient`. Do not rely on this SAP release
  to enforce Recipient. One signing key/certificate per SAP target and a unique SAML2 local provider
  name across systems trusting ARC-1 certificates are required, including after system copies. See
  the PR validation record for exact inputs and results.
- The NameID claim must not be editable by end users. Entra's `email` claim is unsuitable for this
  mapping even if `email_verified=true`; use an administrator-controlled stable claim instead.

## Rotate the signing key

1. Generate a new RSA key and certificate in a private directory with `gen-saml-idp.sh`. Keep the old
   key available only for rollback until the cutover is verified.
2. In SAP transaction SAML2, replace the trusted SAML bearer provider certificate with the new
   certificate (or stage both certificates if your SAP configuration permits overlap). Record the
   issuer and local provider name; they must still match ARC-1's settings.
3. Replace the secret mount with the new key and certificate, then restart ARC-1. Its startup
   self-check must pass. Make a read call as a disposable user and confirm SAP sees that user.
4. Remove the old certificate from SAML2 and destroy old key copies after verification. If overlap
   is unavailable, schedule a brief cutover window because old assertions will fail after trust changes.
