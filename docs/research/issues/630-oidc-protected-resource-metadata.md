# Issue #630 — RFC 9728 protected-resource metadata in OIDC mode

**Status:** Confirmed gap, reproduced live 2026-07-27 on HEAD (`879376d9`, v0.9.27); **implemented** the
same day (branch `feat/oidc-protected-resource-metadata`). Reporter's diagnosis of the code is accurate.
Additionally: the shipped docs already claimed this worked — a doc/implementation divergence.
**Issue:** [arc-mcp/arc-1#630](https://github.com/arc-mcp/arc-1/issues/630) — external reporter (`vateseeb`).
**Classification:** `feature-request` (small, well-scoped) + `docs-bug` + **MCP spec conformance gap**.

## TL;DR

- In OIDC mode ARC-1 served **no** discovery and its `401` carried **no** `resource_metadata` pointer.
  XSUAA mode has both. Root cause: everything lives inside the `if (config.xsuaaAuth && …)` branch.
- The MCP authorization spec (2025-06-18 **and** 2025-11-25) says *"MCP servers **MUST** implement OAuth
  2.0 Protected Resource Metadata (RFC 9728)"*, so this was a conformance gap, not just a convenience ask.
- **The finding that shaped the design:** the MCP TS SDK sends the RFC 8707 `resource` parameter **only
  when PRM exists** (`selectResourceURL` returns `undefined` without it) — and **Microsoft Entra ID rejects
  that parameter outright**. Measured on a live tenant: `AADSTS9010010`; on `common`: `AADSTS901002: The
  'resource' request parameter is not supported`. The identical request without `resource` returns the
  login page. So publishing PRM naively would have *broken* the one client combination that works today
  (Claude Code + Entra) while fixing the others.
- Shipped: PRM on by default (spec MUST) + `SAP_OIDC_DISCOVERY=false` as a documented, evidence-backed
  opt-out + `SAP_OIDC_SCOPES` for the IdP scope names ARC-1 cannot derive.

## Live validation

### A. The reported symptoms — OIDC mode, HEAD before the fix

Local server, `SAP_OIDC_ISSUER=https://login.microsoftonline.com/<tid>/v2.0`,
`SAP_OIDC_AUDIENCE=api://arc1-demo`, `ARC1_PUBLIC_URL=https://arc1.example.com`:

| Request | Observed |
|---|---|
| `GET /.well-known/oauth-protected-resource` | `404 {"error":"Not found. Use /mcp …"}` |
| `GET /.well-known/oauth-protected-resource/mcp` | `404` |
| `GET /.well-known/oauth-authorization-server` | `404` |
| `POST /mcp` (no token) | `401`, `WWW-Authenticate: Bearer error="invalid_token", error_description="Missing Authorization header"` — **no `resource_metadata`** |
| `POST /mcp` (bogus token) | `401`, `… "Token validation failed: not a valid XSUAA, OIDC, or API key token"` — no pointer |

### B. XSUAA control, same build

```
GET /.well-known/oauth-protected-resource      → 404          (root path not served there)
GET /.well-known/oauth-protected-resource/mcp  → 200 {"resource":"https://arc1.example.com/mcp",
                                                      "authorization_servers":["https://arc1.example.com/"], …}
POST /mcp → 401  WWW-Authenticate: … resource_metadata="https://arc1.example.com/.well-known/oauth-protected-resource/mcp"
```

### C. Entra authorization-server behavior (the decisive measurements)

Probes against `login.microsoftonline.com` with a valid S256 challenge:

| Probe | Result |
|---|---|
| AS metadata, RFC 8414 insert — `/.well-known/oauth-authorization-server/<tid>/v2.0` | **404** |
| AS metadata, OIDC append — `/<tid>/v2.0/.well-known/openid-configuration` | **200** |
| `/authorize` **with** `resource=https://example.com/mcp` (real tenant) | **`AADSTS9010010`** — "The resource parameter provided in the request doesn't match with the requested scopes" |
| `/authorize` **with** `resource=…` + `scope=api://…/.default` (`common`) | **`AADSTS901002`** — "The 'resource' request parameter is not supported" |
| `/authorize` **without** `resource` (same tenant, same everything else) | **200** login page |
| `code_challenge_methods_supported` in Entra v2.0 metadata (tenant, `organizations`, `common`) | **absent** — SDK 1.29.0 tolerates absence; a spec-strict client (2025-11-25 says clients MUST refuse) would not |

The AS-metadata rows prove that advertising the bare `SAP_OIDC_ISSUER` is enough: the SDK client's fallback
chain ends with the OIDC append form, which is the one Entra answers. The `resource` rows are why the
opt-out exists.

### D. Post-fix, built `dist/`, same local server

```
GET /.well-known/oauth-protected-resource/mcp → 200
  {"resource":"https://arc1.example.com/mcp",
   "authorization_servers":["https://login.microsoftonline.com/<tid>/v2.0"],
   "bearer_methods_supported":["header"],"resource_name":"ARC-1 SAP MCP Server",
   "scopes_supported":["api://arc1-demo/access_as_user"]}
GET /.well-known/oauth-protected-resource     → 200 (same document, client's root fallback)
OPTIONS (Origin: https://claude.ai)           → 204 + Access-Control-Allow-Origin: *
POST  /.well-known/oauth-protected-resource/mcp → 405 (GET/OPTIONS only)
GET /.well-known/oauth-authorization-server   → 404 (ARC-1 is not the AS — intentional)
POST /mcp                                     → 401 + resource_metadata="…/.well-known/oauth-protected-resource/mcp"
SAP_OIDC_DISCOVERY=false                      → both well-known paths 404, 401 carries no pointer
```

End-to-end with the **real MCP SDK client** functions against the running server (localhost public URL,
Entra `common` issuer):

```
1. 401 →  resourceMetadataUrl: http://127.0.0.1:8199/.well-known/oauth-protected-resource/mcp
2. PRM   →  resource: http://127.0.0.1:8199/mcp | AS: https://login.microsoftonline.com/common/v2.0
3. RFC 8707 resource param the client will send: http://127.0.0.1:8199/mcp   ← the Entra hazard
4. AS metadata via issuer → https://login.microsoftonline.com/{tenantid}/v2.0 | authorize=…/oauth2/v2.0/authorize
5. scope the client will request: api://arc1-demo/access_as_user
```

## Root cause (pre-fix, `src/server/http.ts`)

- `:364` `if (config.xsuaaAuth && xsuaaCredentials) { … }` held the entire discovery surface —
  `resourceMetadataUrl` (`:429`) → `requireBearerAuth` (`:430`), prefix-aware well-known overrides
  (`:647`–`:658`), multi-target PRM routes (`:669`–`:685`), SDK `mcpAuthRouter` (`:694`).
- `:717`–`:740` (API key / OIDC) mounted only `/mcp` behind `requireBearerAuth`, with no
  `resourceMetadataUrl` and no well-known route; everything else fell to the catch-all 404 at `:744`.

Nothing regressed — the surface was never built for the non-XSUAA path. XSUAA gets it free because ARC-1
*is* the authorization server there; in OIDC mode ARC-1 is a pure resource server, so the SDK's auth
router does not apply.

## Docs divergence found on the way

- `docs_page/oauth-jwt-setup.md:184` — VS Code "will discover the Protected Resource Metadata at …".
- `docs_page/oauth-jwt-setup.md:282` — "How It Works" step 2 promises the `resource_metadata` challenge.
- `docs_page/auth-test-process.md:137` — OIDC manual-test recipe curls the endpoint; it 404'd.
- `docs/research/2026-07-20-mcp-2026-07-28-spec-impact.md:89,105` — records RFC 9728 as "already
  implemented" (true for XSUAA only).

## What shipped

`src/server/http.ts`, in the API-key/OIDC branch, gated on `oidcIssuer && oidcDiscovery`:

- `buildOidcResourceMetadata()` → `{ resource: "<publicBase>/mcp", authorization_servers: [issuer],
  bearer_methods_supported: ["header"], resource_name, scopes_supported? }`.
- `mountOidcResourceMetadata()` serves it through the SDK's own `metadataHandler` (CORS + GET/OPTIONS-only,
  identical treatment to the XSUAA path) at the RFC 9728 path-insertion URL, at the `ARC1_PUBLIC_URL`
  prefix variant, and at the root fallback — **in that mount order**, since the root path is a mount
  prefix that would otherwise swallow `/mcp`. Returns the URL fed to `requireBearerAuth` for both the MCP
  and UI guards.
- URLs come from `getAppUrl()` (`ARC1_PUBLIC_URL` / `VCAP_APPLICATION`), never the request `Host` header —
  a spoofed Host must not be able to point clients at an attacker-controlled IdP. Covered by a test.
- `SAP_OIDC_DISCOVERY` (default `true`) and `SAP_OIDC_SCOPES` (no default; error if set without an issuer)
  in `src/server/{config,types}.ts`.
- `tests/unit/server/http-oidc-metadata.test.ts` — 7 tests over a real `startHttpServer` boot.
- Docs: `docs_page/oauth-jwt-setup.md` (new "Auto-discovery (RFC 9728)" section + Entra caveat),
  `docs_page/auth-test-process.md`, `docs_page/configuration-reference.md`, `.env.example`.

### Decisions and what was deliberately not built

| Decision | Why |
|---|---|
| PRM **on** by default, opt-out flag | Spec MUST; the failure mode is loud, IdP-specific, and documented with the exact AADSTS codes. Owner's call (2026-07-27). |
| No `scope` parameter in the 401 challenge (spec 2025-11-25 SHOULD) | The SDK's `requiredScopes` both advertises *and enforces*; Entra scope names are not ARC-1 scopes, so enforcing them would break every request. PRM `scopes_supported` is the client's priority-2 path. Follow-up if a custom challenge is ever worth the code. |
| No configurable `resource` value | The client validates PRM `resource` against the server origin (`checkResourceAllowed`), so an `api://…` value is rejected client-side — a knob could only offer variants that still don't satisfy Entra. |
| No `/.well-known/oauth-authorization-server` | ARC-1 is not the AS in this mode; mirroring the IdP's metadata would add a fetch and a staleness failure mode for nothing (measured: clients reach Entra's own metadata from the issuer). |
| AppRouter untouched | `btp/approuter/xs-app.json` routes only `/` and `/ui`; `/mcp` and `.well-known` are served on the backend route directly. |

## Known limits (state these to the reporter)

1. **Entra + any SDK-based MCP client**: once PRM exists the client sends `resource`, and Entra answers
   `AADSTS9010010` / `AADSTS901002`. `SAP_OIDC_DISCOVERY=false` restores today's behavior (Claude Code with
   a manual `authServerMetadataUrl`). There is no server-side value that satisfies both the MCP client's
   origin check and Entra's registration model.
2. **Claude.ai custom connectors + Entra** have a separate, upstream-tracked failure:
   [anthropics/claude-ai-mcp#506](https://github.com/anthropics/claude-ai-mcp/issues/506) — discovery
   succeeds, the user authenticates, then the code is never exchanged at `/token`. Not something ARC-1
   can fix. **There is a working escape route**, raised by the reporter on PR #632 and verified against
   the thread: the **token-broker pattern**
   ([comment](https://github.com/anthropics/claude-ai-mcp/issues/506#issuecomment-4899697146), posted by
   `@jvitti93` 2026-07-07, confirmed working by `@brinawebb` the same day) — your own minimal
   OAuth 2.1 AS in front, federating to Entra privately as a confidential client, so the connector never
   sees Entra. ARC-1 needs no change (it stays a resource server validating the Entra token the broker
   attaches), but two ARC-1-specific conditions apply and are now in
   `docs_page/oauth-jwt-setup.md`: the broker owns discovery (so ARC-1 should run with
   `SAP_OIDC_DISCOVERY=false`), and the broker must federate the **user's** identity — a
   `client_credentials` shortcut collapses every MCP user into one identity and silently guts per-user
   scopes, the audit trail, and Destination principal propagation.
3. Entra's v2.0 metadata omits `code_challenge_methods_supported` (measured on tenant, `organizations`,
   `common`). SDK 1.29.0 tolerates the absence; a client that follows the 2025-11-25 "MUST refuse" rule
   would not.

So acceptance criteria 1 and 2 from the issue are met unconditionally; criterion 3 is met for IdPs that
tolerate the `resource` parameter (Keycloak, Okta, Cognito, Auth0 …), and for Entra depends on the two
upstream constraints above.

## Draft GitHub reply (do not post automatically)

```markdown
Confirmed and implemented — thanks for the unusually precise report; your reading of `http.ts` matches HEAD.

**Reproduced** on `879376d9` (v0.9.27) with a local OIDC-mode server:

| Request | OIDC mode (before) | XSUAA mode (control, same build) |
|---|---|---|
| `GET /.well-known/oauth-protected-resource/mcp` | `404` | `200` + RFC 9728 document |
| `POST /mcp` without a token | `401`, no `resource_metadata` | `401` **with** `resource_metadata` |

Root cause exactly where you pointed: `resourceMetadataUrl` and every well-known route sit inside the
`if (config.xsuaaAuth && xsuaaCredentials)` branch (`src/server/http.ts:364`, `:429`, `:647`–`:658`, `:694`);
the API-key/OIDC branch (`:717`–`:740`) mounted only `/mcp`. Our own docs already promised this behaviour for
OIDC mode (`docs_page/oauth-jwt-setup.md:184,282`, `docs_page/auth-test-process.md:137`), and the MCP spec makes
it a MUST for servers — so this was a conformance gap on our side, not a new capability.

**What's now in the PR** — resource-server-only, no token/authorize endpoints, no DCR:

- `/.well-known/oauth-protected-resource/mcp` (RFC 9728 §3.1 path insertion), the root fallback, and the
  `ARC1_PUBLIC_URL` prefix variant, all served through the MCP SDK's own metadata handler (CORS + GET/OPTIONS).
- `resource_metadata="…"` on every `401`.
- `SAP_OIDC_SCOPES` for `scopes_supported`. It can't be derived: `access_as_user` is a name your Entra admin
  chose, and Keycloak/Okta/Cognito differ — but it can't be dropped either, since the MCP client takes the
  authorize `scope` from `scopes_supported`. Set it to `api://<client-id>/access_as_user`.
- No `/.well-known/oauth-authorization-server`: I verified that
  `https://login.microsoftonline.com/.well-known/oauth-authorization-server/<tenant>/v2.0` 404s while
  `https://login.microsoftonline.com/<tenant>/v2.0/.well-known/openid-configuration` returns 200, and the MCP
  SDK's discovery chain ends with that append form. Publishing the raw `SAP_OIDC_ISSUER` is enough.

**One caveat you'll want before you deploy it**, found while validating your proposal against a live Entra
tenant. The MCP SDK sends the RFC 8707 `resource` parameter **only when protected-resource metadata exists**
(`selectResourceURL` returns `undefined` otherwise) — which is precisely why Claude Code works against your
setup today. Entra rejects that parameter:

```
/authorize …&resource=https://arc1.example.com/mcp   → AADSTS9010010: The resource parameter provided in the
                                                        request doesn't match with the requested scopes
/authorize …  (no resource, everything else identical) → 200 (login page)
```

(on the `common` endpoint the same probe returns `AADSTS901002: The 'resource' request parameter is not supported`.)

There's no server-side value that fixes this: MCP clients reject a `resource` that isn't same-origin with the
server they called, so an `api://<client-id>` value is impossible. Because of that the PR ships
`SAP_OIDC_DISCOVERY=false` as a documented escape hatch — it restores exactly today's behaviour (no metadata ⇒
no `resource` parameter ⇒ your working Claude Code flow) if your tenant hits the error. Default stays on, since
the spec requires the metadata and IdPs that ignore unknown authorization parameters are the common case.

Also worth knowing for the Claude.ai leg specifically: there's an open upstream issue where a connector behind
Entra discovers the metadata, the user authenticates, and the authorization code is then never exchanged at
`/token` — anthropics/claude-ai-mcp#506. That one is outside ARC-1.

If you can test the pre-release build against your tenant with a Claude Desktop / Claude.ai connector, that
would be very welcome — it's the leg we can't exercise in CI. I'll link the PR here.
```

## Next step

PR from `feat/oidc-protected-resource-metadata`. If the reporter confirms the Entra `resource` behavior in
their tenant, consider a docs note under `docs_page/oauth-jwt-setup.md` naming Keycloak/Okta as known-good.
