# Updating ARC-1

## v0.7 — Authorization Refactor (breaking change)

ARC-1 v0.7 rewrites the authorization layer around a **single source of truth** (`ACTION_POLICY`) with **positive opt-in** safety flags and **per-user scopes** that work for BTP, OIDC, and API-key auth modes consistently. **This is breaking — old env vars will error at startup**, pointing you here.

### Why the rewrite

- The old model mixed negations (`readOnly`, `blockData`, `blockFreeSQL`) with opt-ins (`enableGit`, `enableTransports`). Admins repeatedly misconfigured one or the other.
- Op-code env vars (`SAP_ALLOWED_OPS`, `SAP_DISALLOWED_OPS`) overlapped with boolean flags — admin could accidentally block reads by typo.
- Six scope-vs-safety classification bugs caused `SAPLint.set_formatter_settings` to skip write authorization, `SAPTransport.check` to require write, and `SAPManage.flp_list_*` to require write despite being reads.
- `readOnly=true` did NOT block transport or git mutations (silent security gap).
- `admin` scope alone gave **most-restrictive** safety (counter-intuitive).

### What changed

#### Env vars — old → new mapping

| Old (removed)             | New                                                            | Notes                                                    |
| ------------------------- | -------------------------------------------------------------- | -------------------------------------------------------- |
| `SAP_READ_ONLY`           | `SAP_ALLOW_WRITES` (inverted)                                  | `SAP_READ_ONLY=true` → `SAP_ALLOW_WRITES=false`           |
| `SAP_BLOCK_DATA`          | `SAP_ALLOW_DATA_PREVIEW` (inverted)                            | Same                                                     |
| `SAP_BLOCK_FREE_SQL`      | `SAP_ALLOW_FREE_SQL` (inverted)                                | Same                                                     |
| `SAP_ENABLE_TRANSPORTS`   | `SAP_ALLOW_TRANSPORT_WRITES`                                   | Transport **reads** now always available                  |
| `SAP_ENABLE_GIT`          | `SAP_ALLOW_GIT_WRITES`                                         | Git **reads** now always available                        |
| `SAP_ALLOWED_OPS`         | `SAP_DENY_ACTIONS` (tool-qualified; see [authz doc](authorization.md#advanced-deny-actions)) | Op-code model removed            |
| `SAP_DISALLOWED_OPS`      | `SAP_DENY_ACTIONS`                                             | Same                                                     |
| `ARC1_PROFILE`            | Individual `SAP_ALLOW_*` flags (see recipes in [authz doc](authorization.md#recipes)) | Server-side profile concept removed |
| `ARC1_API_KEY` (single)   | `ARC1_API_KEYS="key:profile"` (multi-key only)                 | Profile names: `viewer` / `developer` / `admin` / etc.    |

#### CLI flag aliases — old → new

Same mapping as env vars, hyphenated: `--read-only` → `--allow-writes` (inverted); `--block-data` → `--allow-data-preview` (inverted); `--profile` → removed (use explicit flags); `--api-key` → `--api-keys="key:profile"`; `--allowed-ops` / `--disallowed-ops` → `--deny-actions`.

#### Scope model

Added two new scopes: `transports`, `git`. `admin` now **implies all other scopes** at extraction time (was: most-restrictive).

#### xs-security.json (BTP)

`MCPDeveloper` role template now bundles `[read, write, transports, git]`. Re-deploy `xs-security.json` to your XSUAA service:

```bash
cf update-service arc1-xsuaa -c xs-security.json
```

Users assigned to `ARC-1 Developer` role collection automatically gain transport and git write capability. If you want "developer without CTS/Git", create your own role template referencing just `[read, write]`.

### Migration steps

#### Local / Docker

1. Open your `.env`.
2. For each old env var, replace per the table above. Remember: `SAP_READ_ONLY`/`SAP_BLOCK_*` flags flip polarity (`true` → `false` and vice versa).
3. If you used `ARC1_PROFILE`, pick the matching recipe from the new [.env.example](https://github.com/marianfoo/arc-1/blob/main/.env.example).
4. If you used single `ARC1_API_KEY`, switch to `ARC1_API_KEYS="your-key:admin"` (or choose a restricted profile).
5. If you used `SAP_ALLOWED_OPS` / `SAP_DISALLOWED_OPS`, see the [deny actions doc](authorization.md#advanced-deny-actions) for the `SAP_DENY_ACTIONS` equivalent.
6. Start the server. It will either start successfully (with a new `effective safety: ...` log line) or error with a migration hint for any legacy var you missed.

#### BTP Cloud Foundry

1. Update `xs-security.json` in your repo (already done in the ARC-1 v0.7 release).
2. Redeploy the XSUAA service: `cf update-service arc1-xsuaa -c xs-security.json`.
3. Users keep the same role-collection assignments — no BTP admin action needed unless you want to customize role templates.
4. Redeploy the app: `npm run btp:build-deploy-ext` (or `mbt build && cf deploy mta_archives/arc1-mcp_*.mtar -e mta-overrides.mtaext`). If you don't have a `mta-overrides.mtaext` yet, copy it from the tracked `mta-overrides.mtaext.example` first; the base `mta.yaml` ships with placeholder destinations that fail fast on purpose.
5. Test with a developer user: `SAPTransport(action=check)` should succeed with a read-scoped user now; `SAPTransport(action=create)` should succeed for users in `ARC-1 Developer`.

### Debugging the new model

- `arc1 config show` prints the resolved effective safety with per-field source attribution. Run this if a flag isn't behaving as expected.
- Startup logs include `effective safety: writes=YES data=NO ...` one-liner plus `WARN: config contradiction: ...` lines for useless combos (like `allowTransportWrites=true` with `allowWrites=false`).
- Every denied action includes the specific layer in the error: "Insufficient scope" = Layer 2; "allowWrites=false" = Layer 1; "denied by server policy" = `SAP_DENY_ACTIONS`.

See the full [Authorization & Roles](authorization.md) doc for the complete model.

---

## Before you update

1. **Check the changelog** — review [CHANGELOG.md](https://github.com/marianfoo/arc-1/blob/main/CHANGELOG.md) or the [Releases page](https://github.com/marianfoo/arc-1/releases) for breaking changes.
2. **Pin to a version** — in production, use exact version tags (`:0.7.0`), never `:latest`. Prevents surprise upgrades.
3. **Test first** — update a dev/staging instance before production. Verify MCP clients still connect and tools work as expected.
4. **Read the startup auth line after upgrade** — a drift-free instance will log the same `auth: MCP=[...] SAP=[...]` summary before and after. If it's different, the upgrade changed something you didn't expect.

---

## npx / npm

`npx` always pulls the latest version. To pin:

```bash
# Latest
npx arc-1@latest

# Pinned
npx arc-1@0.7.0

# Global install
npm install -g arc-1@0.7.0
```

Verify:

```bash
npx arc-1 --version
```

If you pin in MCP client config, update the `args`:

```json
{ "command": "npx", "args": ["-y", "arc-1@0.7.0"] }
```

---

## Docker (standalone)

```bash
# 1. Pull the new image
docker pull ghcr.io/marianfoo/arc-1:0.7.0

# 2. Stop & remove the running container
docker stop arc1 && docker rm arc1

# 3. Start with the new image (same env vars / config)
docker run -d --name arc1 -p 8080:8080 \
  --env-file .env \
  ghcr.io/marianfoo/arc-1:0.7.0

# 4. Verify
docker logs arc1 | head -20
curl -s http://localhost:8080/mcp
```

**Downtime:** brief interruption between stop and start. For zero-downtime, run two containers behind a reverse proxy (nginx / Traefik) and switch traffic after health check.

**Rollback:** start the previous image.

```bash
docker stop arc1 && docker rm arc1
docker run -d --name arc1 -p 8080:8080 --env-file .env ghcr.io/marianfoo/arc-1:0.6.8
```

---

## BTP Cloud Foundry

CF supports rolling updates natively — no manual stop/start.

### Step 1 — update image tag in `manifest.yml`

```yaml
applications:
  - name: arc1-mcp-server
    docker:
      image: ghcr.io/marianfoo/arc-1:0.7.0   # ← update this
```

### Step 2 — rolling push

```bash
cf push arc1-mcp-server --strategy rolling
```

Starts a new instance with the new image, waits for health checks, then stops the old one. MCP clients see no interruption.

### Step 3 — verify

```bash
cf app arc1-mcp-server
cf logs arc1-mcp-server --recent | grep "auth:"
curl -s https://arc1-mcp-server.cfapps.us10.hana.ondemand.com/mcp
```

### Rollback

```bash
# Option 1 — re-push previous tag
# Update manifest.yml back, then:
cf push arc1-mcp-server --strategy rolling

# Option 2 — previous droplet
cf rollback arc1-mcp-server
```

### BTP specifics

- **Destination Service / Cloud Connector:** infrastructure config, not part of the image. No action on version bump.
- **XSUAA bindings:** persist across restages. No re-binding needed.
- **New required env vars in the release?** Set before pushing:
  ```bash
  cf set-env arc1-mcp-server NEW_VAR value
  cf push arc1-mcp-server --strategy rolling
  ```
- **Scaled > 1 instance (`cf scale -i 2`):** rolling update handles each instance sequentially.

---

## git clone (development)

```bash
git pull origin main
npm ci
npm run build
npm start    # or: npm run dev
```

---

## Monitoring after an update

Every release should behave identically for an unchanged config. Verify:

1. **Startup logs** — errors, deprecation warnings, and the `auth:` summary line
2. **Tool listing** — expected tools visible to the MCP client
3. **Basic operation** — one `SAPRead` or `SAPSearch` succeeds
4. **Auth flow** — if using OIDC / XSUAA, verify a token-authenticated request
5. **Package scope** — write to an allowed package, confirm write to a disallowed package is rejected

---

## Release cadence

Automated via [release-please](https://github.com/googleapis/release-please):

- `feat:` commits → minor bump
- `fix:` commits → patch bump
- `feat!:` / `BREAKING CHANGE:` → major bump
- `chore:` / `docs:` / `ci:` → no release

Published simultaneously to **npm** (`arc-1`) and **GHCR** (`ghcr.io/marianfoo/arc-1`).
