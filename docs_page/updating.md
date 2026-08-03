# Updating ARC-1

## v1.0 — upgrading from 0.9.x

From `1.0` ARC-1 follows [semantic versioning](https://semver.org/): a breaking change to the MCP tool
surface, configuration, or the auth contract requires a major bump. Experimental default-off features are
excluded until they are promoted — today that is only
[multi-target mode](multi-target-setup.md).

Four things to check. Per-change context for the whole release is in the
[Release Notes](release-notes.md#100-semver-commitment-experimental-multi-target-bounded-tool-results-2026-07-31).

| What changed | Who is affected | Action |
|---|---|---|
| **Retired settings abort startup** | anyone who configured cache warmup or the unreleased multi-destination prototype | Remove `ARC1_CACHE_WARMUP`, `ARC1_CACHE_WARMUP_PACKAGES`, `--cache-warmup`, `--cache-warmup-packages` and `SAP_BTP_DESTINATIONS` — details in [Cache warmup removal](#v10-cache-warmup-removal) and [multi-target migration](#v10-experimental-destination-discovered-multi-target-migration) below. Setting them to `false` is not enough; the value is not read, the presence is |
| **Unknown tool parameters are rejected** | MCP clients and agent frameworks that send extra keys | A parameter outside a tool's schema now returns a validation error instead of being silently stripped. If a custom client injects its own keys into tool arguments, stop doing that before upgrading — previously the call succeeded while quietly ignoring them |
| **`SAPTransport(action="list")` returns headers only** | anything that reads the object list out of `list` | Pass `summary=false` to restore the previous full response |
| **The XSUAA descriptor gained a jwt-bearer grant** | BTP Cloud Foundry, and only if you want app-to-app propagation | `cf update-service arc1-mcp-xsuaa -c xs-security.json` (or an MTA redeploy). Existing bindings inherit it without rebinding, and every existing login path keeps working untouched |

Nothing else in 1.0 needs an action: the tool surface grew (procedural unit surgery, FUNC processing types,
new server-driven types, `atc_variants`), and the rest is fixes.

## v1.0 — Experimental destination-discovered multi-target migration

The unreleased PR #543 prototype setting `SAP_BTP_DESTINATIONS` is intentionally rejected. Replace
it with `ARC1_MULTI_TARGET_ENDPOINTS=true`, mark each eligible BTP subaccount destination with
`arc1.enabled=true`, and provide the standard `sap-sysid` and `sap-client` destination properties.
Routes are now `/<SYSTEM-OR-ALIAS>/<CLIENT>/mcp` and `/multi/mcp`; destination-name routes and a
discovered default `/mcp` alias do not exist. The optional `arc1.target_alias` distinguishes
independent systems that reuse a real SID/client. Per-destination data/SQL policy lives in `arc1.*`
destination properties, not `SAP_*_<DEST>` environment variables. See
[Multi-System Setup](multi-target-setup.md), then
[Multi-Target Administration](multi-target-administration.md) for diagnostics and operations.

The base `mta.yaml` is now target-free: all single-target settings and the experimental multi-target
block are commented examples. Existing deployments remain compatible because ARC-1 still reads the
same explicit environment variables or MTA extension values. Before updating a deployment that
previously relied on active values from the repository template, copy those values into your own
deployment-specific `.mtaext` or CF environment.

## v1.0 — Cache warmup removal

ARC-1 no longer performs a startup TADIR scan or keeps repository-wide node/edge indexes. The normal request-driven memory/SQLite cache remains, and `SAPContext(action="usages")` now queries SAP's live where-used index with the current caller's identity.

Before upgrading, remove `ARC1_CACHE_WARMUP`, `ARC1_CACHE_WARMUP_PACKAGES`, `--cache-warmup`, and `--cache-warmup-packages`. ARC-1 deliberately refuses to start when any retired setting is present, including `ARC1_CACHE_WARMUP=false`, so stale deployment configuration is visible instead of silently ignored.

Existing SQLite files need no manual migration. On first open, ARC-1 drops the retired `nodes` and `edges` tables while preserving sources, dependency graphs, released API metadata, and function-group mappings.

## v0.9.26 — JWT Principal Propagation Always Fails Closed

ARC-1 no longer changes a JWT-authenticated request to the shared SAP technical identity when
principal propagation fails. This closes an identity and audit-boundary gap in BTP Cloud Foundry
deployments.

### Who needs to act

- Deployments with `SAP_PP_ENABLED=true` that set `SAP_PP_STRICT=false` to fall back after a JWT
  destination, token-exchange, or user-mapping error must fix that PP configuration before updating.
- Custom deployments with PP enabled but no Destination Service runtime configuration will now return
  an MCP tool error for JWT requests instead of silently using the shared client.
- API-key / non-JWT requests still use the shared client unless `SAP_PP_STRICT=true` is set explicitly.
- The shipped BTP `mta.yaml` shows `SAP_PP_STRICT=true` in the commented strict-PP example. Existing
  combined deployments can preserve supported mixed operation by setting `SAP_PP_STRICT=false`
  explicitly; separating API-key automation into a non-PP instance remains the recommendation, not
  a requirement.

The application still starts and `/health` remains successful when a runtime-only PP mapping is broken.
Before rolling the version into production, make one JWT-authenticated SAP read in staging and verify
that SAP records the expected human user. Do not use `SAP_PP_STRICT=false` as a JWT fallback switch;
it now controls only whether mixed API-key / non-JWT access remains available.

The recommended production topology is one SAP identity model per ARC-1 instance: strict PP with
JWT/XSUAA for human users, and a separate non-PP instance with a least-privileged technical identity
for API-key automation. Mixed mode remains fully supported when operators intentionally choose one
instance for both identity models.

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
3. If you used `ARC1_PROFILE`, pick the matching recipe from the new [.env.example](https://github.com/arc-mcp/arc-1/blob/main/.env.example).
4. If you used single `ARC1_API_KEY`, switch to `ARC1_API_KEYS="your-key:admin"` (or choose a restricted profile).
5. If you used `SAP_ALLOWED_OPS` / `SAP_DISALLOWED_OPS`, see the [deny actions doc](authorization.md#advanced-deny-actions) for the `SAP_DENY_ACTIONS` equivalent.
6. Start the server. It will either start successfully (with a new `effective safety: ...` log line) or error with a migration hint for any legacy var you missed.

#### BTP Cloud Foundry

1. Update `xs-security.json` in your repo (already done in the ARC-1 v0.7 release).
2. Redeploy the XSUAA service: `cf update-service arc1-xsuaa -c xs-security.json`. This updates scopes and role templates, but does not create role collections from `mta.yaml`.
3. Run the full MTA deployment: `npm run btp:build-deploy-ext` (or `mbt build && cf deploy mta_archives/arc1-mcp_*.mtar -e mta-overrides.mtaext`). If you don't have a `mta-overrides.mtaext` yet, copy it from the tracked `mta-overrides.mtaext.example` first. The base `mta.yaml` is deliberately target-free; the extension preserves the existing single-target names or enables multi-target mode explicitly.
4. In BTP Cockpit, verify that all seven `ARC-1 … (<space>)` role collections exist and contain roles. Existing assignments survive, but collections added after an older deployment are not created by `cf update-service` alone and must be assigned explicitly.
5. Test with a developer user: `SAPTransport(action=check)` should succeed with a read-scoped user now; `SAPTransport(action=create)` should succeed for users in `ARC-1 Developer`.

### Debugging the new model

- `arc1 config show` prints the resolved effective safety with per-field source attribution. Run this if a flag isn't behaving as expected.
- Startup logs include `effective safety: writes=YES data=NO ...` one-liner plus `WARN: config contradiction: ...` lines for useless combos (like `allowTransportWrites=true` with `allowWrites=false`).
- Every denied action includes the specific layer in the error: "Insufficient scope" = Layer 2; "allowWrites=false" = Layer 1; "denied by server policy" = `SAP_DENY_ACTIONS`.

See the full [Authorization & Roles](authorization.md) doc for the complete model.

---

## Before you update

1. **Check what changed** — start with the annotated [Release Notes](release-notes.md): every release with its impact and the action it needs (usually none). The raw [CHANGELOG.md](https://github.com/arc-mcp/arc-1/blob/main/CHANGELOG.md) and the [Releases page](https://github.com/arc-mcp/arc-1/releases) list every merged PR.
2. **Pin to a version** — in production, use exact version tags (for example `:1.0.0`), never `:latest`. Prevents surprise upgrades. <!-- x-release-please-version -->
3. **Test first** — update a dev/staging instance before production. Verify MCP clients still connect and tools work as expected.
4. **Read the startup auth line after upgrade** — a drift-free instance will log the same `auth: MCP=[...] SAP=[...]` summary before and after. If it's different, the upgrade changed something you didn't expect.

---

## npx / npm

`npx` always pulls the latest version. To pin:

<!-- x-release-please-start-version -->
```bash
# Latest
npx arc-1@latest

# Pinned
npx arc-1@1.0.0

# Global install
npm install -g arc-1@1.0.0
```
<!-- x-release-please-end -->

Verify:

```bash
npx arc-1 --version
```

If you pin in MCP client config, update the `args`:

<!-- x-release-please-start-version -->
```json
{ "command": "npx", "args": ["-y", "arc-1@1.0.0"] }
```
<!-- x-release-please-end -->

---

## Docker (standalone)

<!-- x-release-please-start-version -->
```bash
# 1. Pull the new image
docker pull ghcr.io/arc-mcp/arc-1:1.0.0

# 2. Stop & remove the running container
docker stop arc1 && docker rm arc1

# 3. Start with the new image (same env vars / config)
docker run -d --name arc1 -p 8080:8080 \
  --env-file .env \
  ghcr.io/arc-mcp/arc-1:1.0.0

# 4. Verify
docker logs arc1 | head -20
curl -s http://localhost:8080/mcp
```
<!-- x-release-please-end -->

**Downtime:** brief interruption between stop and start. For zero-downtime, run two containers behind a reverse proxy (nginx / Traefik) and switch traffic after health check.

**Rollback:** start the previous image.

```bash
docker stop arc1 && docker rm arc1
docker run -d --name arc1 -p 8080:8080 --env-file .env ghcr.io/arc-mcp/arc-1:0.6.8
```

---

## BTP Cloud Foundry

Use the reviewed MTA and customer `.mtaext` described in
[BTP Cloud Foundry Deployment](btp-cloud-foundry-deployment.md). Before deploying, classify the SAP
identity mode; it determines whether process overlap is safe.

| Mode | Update strategy |
|---|---|
| Single target | Rolling may be used when release notes and stateful-operation tests allow it |
| Multi-target, PP only | Rolling may be used when old/new versions are compatible |
| Multi-target with any shared Basic destination | **Non-rolling stop/deploy/start; exactly one process** |
| Mixed multi-target PP + Basic | Basic restriction governs the entire application |

### Single-target or PP-only multi-target

```bash
git fetch origin
git checkout <reviewed-tag-or-commit>
npm ci
npm run btp:validate
npm run btp:build-deploy-ext
cf app arc1-mcp-server
cf logs arc1-mcp-server --recent
```

An organization's release pipeline may use rolling/blue-green deployment for these modes after
compatibility testing. Verify every process sees the same multi-target registry revision and include
all processes in the SAP concurrency calculation.

### Multi-target shared Basic

The lockout/credential-generation guard is process-local. Rolling or blue-green replacement can
temporarily run old and new processes together and is therefore not allowed, even when the desired
instance count is one. Use a maintenance window:

```bash
cf stop arc1-mcp-server
git checkout <reviewed-tag-or-commit>
npm ci
npm run btp:validate
npm run btp:build-deploy-ext
cf scale arc1-mcp-server -i 1
cf start arc1-mcp-server
cf app arc1-mcp-server
```

The normal MTA deploy may already start the app. The final check must show exactly one desired and
running process before clients reconnect. Do not pass a rolling strategy and do not use a blue-green
MTA deployment for this mode.

### Verification and rollback

For every mode:

1. confirm process health and the exact deployed version in startup logs;
2. inspect all expected XSUAA role collections/roles after a security-descriptor change;
3. obtain a fresh token when roles changed;
4. for multi-target, inspect Admin `SAPTargets` and registry revision; and
5. perform one Viewer `SAPRead SYSTEM` and verify the intended SAP identity.

Keep the previous reviewed MTAR, `.mtaext`, and DCR signing secret available. Roll back through the
same strategy as the update. Shared Basic rollback is also stop/deploy/start and must finish at one
process. See [BTP Administration](btp-administration.md#deployment-and-scaling-by-identity-mode).

### Keeping MCP clients signed in across updates

Updating the image is invisible to connected MCP clients **as long as the OAuth DCR signing key doesn't change** — they keep their cached `client_id` and reconnect on their own. How you deploy decides that:

- **The signing key remains stable:** cached stateless DCR `client_id`s remain valid across restart,
  push, restage, cell replacement, and scale-out.
- **The signer falls back to XSUAA `clientsecret`:** an MTA redeploy/rebind that rotates that secret
  also invalidates DCR clients.
- **A dedicated `ARC1_DCR_SIGNING_SECRET` is configured:** XSUAA binding rotation no longer revokes
  DCR clients. Rotate the dedicated key only for intentional global revocation.

**To make even MTA redeploys seamless, set a stable DCR signing key once** (via `cf set-env`, which survives deploys):

```bash
cf set-env arc1-mcp-server ARC1_DCR_SIGNING_SECRET "$(openssl rand -base64 48)"
cf set-env arc1-mcp-server ARC1_OAUTH_DCR_TTL_SECONDS 0
cf restage arc1-mcp-server
```

After this the signing key no longer tracks the rotating `clientsecret`, so no deploy invalidates client registrations. See [Stable DCR signing key](xsuaa-setup.md#stable-dcr-signing-key-recommended).

Do not put the key in the MTAR or customer extension, and do not paste unredacted `cf env` output in
support material. Restart behavior and cache effects remain mode-specific; multi-target requires
`ARC1_CACHE=none`.

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

Published simultaneously to **npm** (`arc-1`) and **GHCR** (`ghcr.io/arc-mcp/arc-1`).
