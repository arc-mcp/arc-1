# Updating ARC-1

Pin the new version, test it in staging, then follow the procedure for your deployment.
Keep the previous artifact and configuration until acceptance checks pass.

| Deployment | Procedure |
|---|---|
| Local package | [npx / npm](#npx-npm) |
| Container | [Docker](#docker-standalone) |
| BTP Cloud Foundry | [BTP update](#btp-cloud-foundry) |
| Source checkout | [Development checkout](#git-clone-development) |

For changes requiring action, read [Release Notes](release-notes.md) and the [migration notes below](#v110-clici-hardening-compatibility-changes).

## Before you update

<a id="release-cadence"></a>

Keep the last known-good artifact and configuration for rollback.

1. **Check what changed** — start with the annotated [Release Notes](release-notes.md): every release with its impact and the action it needs (usually none). The raw [CHANGELOG.md](https://github.com/arc-mcp/arc-1/blob/main/CHANGELOG.md) and the [Releases page](https://github.com/arc-mcp/arc-1/releases) list every merged PR.
2. **Pin to a version** — in production, use exact version tags (for example `:1.2.0`), never `:latest`. Prevents surprise upgrades. <!-- x-release-please-version -->
3. **Test first** — update a dev/staging instance before production. Verify MCP clients still connect and tools work as expected.
4. **Read the startup auth line after upgrade** — a drift-free instance will log the same `auth: MCP=[...] SAP=[...]` summary before and after. If it's different, the upgrade changed something you didn't expect.


## npx / npm

Choose an exact package version for predictable upgrades:

<!-- x-release-please-start-version -->
```bash
# Latest
npx arc-1@latest

# Pinned
npx arc-1@1.2.0

# Global install
npm install -g arc-1@1.2.0
```
<!-- x-release-please-end -->

Verify:

```bash
npx arc-1@1.2.0 --version  # x-release-please-version
```

If you pin in MCP client config, update the `args`:

<!-- x-release-please-start-version -->
```json
{ "command": "npx", "args": ["-y", "arc-1@1.2.0"] }
```
<!-- x-release-please-end -->


## Docker (standalone)

1. Save the previous image version and reviewed container/Compose configuration, including mounts,
   network, port bindings, environment and secret injection.
2. Pull the intended image:

   <!-- x-release-please-start-version -->
   ```bash
   docker pull ghcr.io/arc-mcp/arc-1:1.2.0
   ```
   <!-- x-release-please-end -->

3. Change only the image in that configuration and recreate the service using your existing deployment procedure.
4. Check process health, then one authenticated SAP read.

For rollback, restore the previous pinned image and its reviewed configuration.
See [Docker deployment](docker.md) for container setup.

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

Before retrying a deploy that failed or was interrupted, check `cf mta-ops`. A previous active or
`ERROR` operation can make a non-interactive deploy appear to hang while it waits for confirmation.
Abort only the operation ID for this MTA, then retry the reviewed deployment:

```bash
cf mta-ops --mta <mta-id>
cf deploy -i <operation-id> -a abort
```

Do not use `-f` to bypass this check: first inspect the operation and confirm that aborting it is
safe for the target space.

Before interrupting the running app, prepare the reviewed checkout and customer extension:

```bash
git fetch origin
git checkout <reviewed-tag-or-commit>
npm ci
npm run btp:validate
npx mbt validate -e mta-overrides.mtaext
npm run btp:build
```

Inspect the **exact MTAR that will be deployed**, including every nested payload, using
[archive inspection](btp-archive-inspection.md). Keep the artifact and approved extension together.
The commands below assume `mta-overrides.mtaext`; use the matching reviewed UI/extension path if applicable.

### Single-target or PP-only multi-target

After preparation and archive inspection pass:

```bash
cf target
npm run btp:deploy-ext
cf app arc1-mcp-server
cf logs arc1-mcp-server --recent
```

Rolling/blue-green replacement requires compatibility testing. Include overlapping processes in the SAP concurrency budget
and verify that multi-target processes use the same intended registry revision.

### Multi-target shared Basic

Before deployment, verify the effective descriptor keeps exactly one instance. Its process-local lockout guard
forbids rolling/blue-green overlap. Prepare and inspect the artifact above, then use a maintenance window:

```bash
cf target
cf stop arc1-mcp-server
npm run btp:deploy-ext
cf app arc1-mcp-server
```

The normal MTA deployment starts the app. Confirm exactly one desired and running process before clients reconnect.
If the deployment fails, inspect its operation before retrying or starting another process.

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

DCR registrations stay valid while the effective signing key is unchanged.
A dedicated `ARC1_DCR_SIGNING_SECRET` prevents XSUAA binding rotation from invalidating registrations;
access tokens can still require re-authentication.

Preserve the existing secret outside the MTAR and follow [DCR key management](xsuaa-setup.md#stable-dcr-signing-key-recommended).
Do not generate a new key as a routine upgrade step: that revokes every existing DCR registration.

## git clone (development)

```bash
git pull origin main
npm ci
npm run build
npm start    # or: npm run dev
```


## Monitoring after an update

Check the documented changes and verify:

1. **Startup logs** — errors, deprecation warnings, and the `auth:` summary line
2. **Tool listing** — expected tools visible to the MCP client
3. **Basic operation** — one `SAPRead` or `SAPSearch` succeeds
4. **Auth flow** — if using OIDC / XSUAA, verify a token-authenticated request
5. **Policy boundary** — confirm restricted tools/actions stay hidden or denied; run write tests only in an authorized development environment


## Older-version migration notes

Read the sections spanning your installed version and intended version.

## v1.1.0 — CLI/CI hardening compatibility changes

Review these changes when updating a pipeline that used the earlier CLI/CI commands:

| Area | Change | Migration |
|---|---|---|
| SAPGit | The unimplemented `commit` action is no longer advertised or accepted. All gCTS mutation names remain quarantined before HTTP. Accepted-but-unverifiable abapGit mutations return error/incomplete instead of optimistic success. | Use `push` for abapGit commits. Inspect repository/remote state before retrying any incomplete mutation. Do not depend on gCTS writes until the staged import/deploy design ships. |
| SAPGit `description` | The gCTS-only `description` parameter was removed with the unavailable `commit` action; strict input validation now rejects it. | Drop `description` from SAPGit callers. Use the staging comment supported by the abapGit `push` flow when applicable. |
| Recursive CTS release | `release_recursive` requires `SAP_ALLOWED_TRANSPORTS` to be the legacy unrestricted empty value or explicit `*`; exact/prefix lists cannot safely authorize a subtree that may gain a concurrent task. Success now waits for terminal CTS evidence; released tasks may be folded out of SAP's organizer tree and are confirmed by their accepted release or the terminal parent. | Use single `release` with exact transport grants, or explicitly authorize every current/concurrent child with `*` for recursive release. Set `timeoutSeconds` when the five-minute default is unsuitable. |
| Git egress | `SAPGit.external_info` now requires `git` scope plus `SAP_ALLOW_WRITES=true` and `SAP_ALLOW_GIT_WRITES=true`; Git URLs must be HTTPS and credential-free. | Move credentials out of URLs and enable the egress/write gates only on the instance intended to contact remote Git hosts. |
| Revision and diagnostic links | Caller-provided ADT links are restricted to canonical endpoint-specific paths. | Pass the exact revision/gateway/AUnit URI returned by ARC-1 or SAP; arbitrary `/sap/bc/adt/**` paths, traversal, and ambiguous encodings are rejected. |
| Dedicated CI checks | Non-evaluable AUnit/ATC/diff/lint evidence exits `3`; tool/SAP failures exit `1`; usage/config validation exits `2`. | Preserve the process exit code alongside JSON, JUnit, or Checkstyle reports and handle exit `3` as incomplete rather than success. |
| Dedicated lint preset | `arc1 lint` now uses ARC-1's CLI-safe abaplint preset instead of inheriting a repository-specific default config. Existing files may change from red to green when they only violated rules outside that preset. | Pass `SAP_ABAPLINT_CONFIG` when the CI job must enforce a repository-specific rule set. |
| CLI parsing | Unknown commands/options, missing values, and extra positional arguments are now usage errors instead of falling through to the default server command. | Fix misspelled commands and pass every boolean flag with an explicit value, such as `--allow-writes=true`. |

The generic `arc1 call` command keeps MCP `ToolResult` semantics. The stricter domain exit codes apply
to the dedicated `unittest`, `atc`, `diff`, and `lint` commands.

## v1.0 — upgrading from 0.9.x

From `1.0` ARC-1 follows [semantic versioning](https://semver.org/): a breaking change to the MCP tool
surface, configuration, or the auth contract requires a major bump. Experimental default-off features are
excluded until they are promoted; see [multi-target mode](multi-target-setup.md) for one example.

Four things to check. Per-change context for the whole release is in the
[Release Notes](release-notes.md#100-semver-commitment-experimental-multi-target-bounded-tool-results-2026-07-31).

| What changed | Who is affected | Action |
|---|---|---|
| **Retired settings abort startup** | anyone who configured cache warmup or the unreleased multi-destination prototype | Remove `ARC1_CACHE_WARMUP`, `ARC1_CACHE_WARMUP_PACKAGES`, `--cache-warmup`, `--cache-warmup-packages` and `SAP_BTP_DESTINATIONS` — details in [Cache warmup removal](#v10-cache-warmup-removal) and [multi-target migration](#v10-experimental-destination-discovered-multi-target-migration) below. Setting them to `false` is not enough; the value is not read, the presence is |
| **Unknown tool parameters are rejected** | MCP clients and agent frameworks that send extra keys | A parameter outside a tool's schema now returns a validation error instead of being silently stripped. If a custom client injects its own keys into tool arguments, stop doing that before upgrading — previously the call succeeded while quietly ignoring them |
| **`SAPTransport(action="list")` returns headers only** | anything that reads the object list out of `list` | Pass `summary=false` to restore the previous full response |
| **The XSUAA descriptor gained a jwt-bearer grant** | BTP Cloud Foundry, and only if you want app-to-app propagation | Update through the [XSUAA lifecycle owner](xsuaa-setup.md#updating-xs-securityjson). Existing bindings inherit grant changes without rebinding |



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

Fix PP configuration before upgrading if a deployment relied on falling back to the shared SAP user after a JWT/PP failure.
`SAP_PP_STRICT=false` still permits API-key/non-JWT shared access, but never JWT fallback.
Verify a JWT-authenticated SAP read and the mapped SAP identity in staging; `/health` alone can still succeed with broken PP.

## v0.7 — Authorization Refactor (breaking change)

<a id="why-the-rewrite"></a>

ARC-1 v0.7 rewrites the authorization layer around a **single source of truth** (`ACTION_POLICY`) with **positive opt-in** safety flags and **per-user scopes** that work for BTP, OIDC, and API-key auth modes consistently. **This is breaking — old env vars will error at startup**, pointing you here.

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

`MCPDeveloper` includes `read`, `write`, `transports`, `git`. Update the descriptor through the
[XSUAA lifecycle owner](xsuaa-setup.md#updating-xs-securityjson). Use a custom `read` + `write` role if CTS/Git must be excluded.

### Migration steps

#### Local / Docker

1. Open your `.env`.
2. For each old env var, replace per the table above. Remember: `SAP_READ_ONLY`/`SAP_BLOCK_*` flags flip polarity (`true` → `false` and vice versa).
3. If you used `ARC1_PROFILE`, pick the matching recipe from the new [.env.example](https://github.com/arc-mcp/arc-1/blob/main/.env.example).
4. If you used single `ARC1_API_KEY`, switch to `ARC1_API_KEYS="your-key:admin"` (or choose a restricted profile).
5. If you used `SAP_ALLOWED_OPS` / `SAP_DISALLOWED_OPS`, see the [deny actions doc](authorization.md#advanced-deny-actions) for the `SAP_DENY_ACTIONS` equivalent.
6. Start the server. It will either start successfully (with a new `effective safety: ...` log line) or error with a migration hint for any legacy var you missed.

#### BTP Cloud Foundry

1. Replace legacy settings in the landscape descriptor using the table above.
2. Update XSUAA through the existing MTA/manual lifecycle owner; a bare base descriptor must not overwrite MTA's merged configuration.
3. Deploy the reviewed artifact with the customer `.mtaext` and verify current role collections and assignments.
4. Test a source read and inspect the permitted actions. Perform mutation tests only in the intended development environment.

### Debugging the new model

- `arc1 config show` prints the resolved effective safety with per-field source attribution. Run this if a flag isn't behaving as expected.
- Startup logs include `effective safety: writes=YES data=NO ...` one-liner plus `WARN: config contradiction: ...` lines for useless combos (like `allowTransportWrites=true` with `allowWrites=false`).
- Every denied action includes the specific layer in the error: "Insufficient scope" = Layer 2; "allowWrites=false" = Layer 1; "denied by server policy" = `SAP_DENY_ACTIONS`.

See the full [Authorization & Roles](authorization.md) doc for the complete model.

---
