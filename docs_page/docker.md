# Docker Guide for arc1

arc1 ships as a Docker image (and npm package) that speaks MCP over **HTTP streamable**
(the default transport in the Docker image). This makes it easy to run as a
long-lived, port-accessible container that multiple MCP clients can connect to
without spawning a new process per session.

> **stdio mode is still supported.** Pass `-e SAP_TRANSPORT=stdio` and use
> `docker run -i` to revert to the classic pipe-based transport.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Pre-Built Images (GHCR)](#pre-built-images-ghcr)
3. [Building the Image](#building-the-image)
4. [How arc1 Runs in Docker](#how-arc1-runs-in-docker)
   - [Response-memory sizing](#response-memory-sizing)
5. [Passing Configuration into Docker](#passing-configuration-into-docker)
   - [Env vars and env files](#env-vars-and-env-files)
   - [Cookie files inside the container](#cookie-files-inside-the-container)
   - [Proxy, TLS, and networking](#proxy-tls-and-networking)
6. [MCP Client Integration](#mcp-client-integration)
   - [Claude Desktop](#claude-desktop-stdio-fallback)
   - [Gemini CLI / Other Agents](#gemini-cli-other-agents)
7. [Updating the Image](#updating-the-image)
8. [Security Notes](#security-notes)
9. [Troubleshooting](#troubleshooting)

---

## Quick Start

> **No Docker Hub needed.** Pre-built images are published automatically to
> [GitHub Container Registry (GHCR)](https://github.com/arc-mcp/arc-1/pkgs/container/arc-1) on every
> release. Pull them with `docker pull ghcr.io/arc-mcp/arc-1:latest`.

### HTTP streamable (default — recommended)

The Docker image defaults to `SAP_TRANSPORT=http-streamable` listening on
`0.0.0.0:8080`. Start the container, map the port, and connect any MCP client
to `http://localhost:8080/mcp`.

```bash
# Generate once and keep the value for the MCP client
export ARC1_LOCAL_KEY=$(openssl rand -hex 32)

# Start arc1 as a persistent HTTP MCP server
docker run -d --rm \
  --memory=512m \
  -p 127.0.0.1:8080:8080 \
  -e NODE_OPTIONS=--max-old-space-size=384 \
  -e ARC1_API_KEYS="$ARC1_LOCAL_KEY:admin" \
  -e SAP_URL=https://host:44300 \
  -e SAP_USER=developer \
  -e SAP_PASSWORD=secret \
  ghcr.io/arc-mcp/arc-1:latest

# Verify it is up
curl -s http://localhost:8080/health   # process health; does not verify SAP access
```

The experimental read-only UI is off by default. HTTP mode requires real HTTP auth before it will start, for example `-e ARC1_UI=web -e ARC1_API_KEYS="$ADMIN_KEY:admin"`. All `/ui/*` routes require an `admin`-scoped bearer token, so browser-first use should go through a local or enterprise reverse proxy that performs login and forwards the bearer token. For direct laptop use with Claude-style stdio clients, prefer `ARC1_UI=local`. The UI shows metadata only and does not return cached ABAP source bodies.

### stdio mode (classic, pipe-based)

```bash
docker run -i --rm -e SAP_TRANSPORT=stdio \
  -e SAP_URL=https://host:44300 \
  -e SAP_USER=developer \
  -e SAP_PASSWORD=secret \
  ghcr.io/arc-mcp/arc-1:latest
```

> **`-i` is required for stdio mode.** MCP communicates over stdin/stdout.
> Without `-i`, the MCP client cannot send requests over stdin.

---

## Pre-Built Images (GHCR)

Official images are built automatically by GitHub Actions and pushed to
**GitHub Container Registry** — no Docker Hub account is required for either
pulling or publishing.

### Image location

```
ghcr.io/arc-mcp/arc-1
```

### Available tags

| Tag | Example | Description |
|---|---|---|
| `latest` | `ghcr.io/arc-mcp/arc-1:latest` | Updated on every push to main (dev builds) and on every release |
| `x.y.z` | `ghcr.io/arc-mcp/arc-1:x.y.z` | Exact version (immutable, created on release) |
| `x.y` | `ghcr.io/arc-mcp/arc-1:x.y` | Latest patch within minor (created on release) |

**`latest`** is rebuilt on every push to `main`, so it always reflects the newest code — even unreleased changes. Use versioned tags for production. Replace `x.y.z` in the commands below with the release your team has reviewed; `x.y` denotes its major/minor tag.

### Pulling

```bash
# Latest (includes unreleased changes from main)
docker pull ghcr.io/arc-mcp/arc-1:latest

# Pinned version (recommended for production/team use)
docker pull ghcr.io/arc-mcp/arc-1:x.y.z
```

### Supported platforms

Each image is a multi-platform manifest covering:

| Platform | Architecture |
|---|---|
| `linux/amd64` | x86-64 servers, most CI runners |
| `linux/arm64` | Apple Silicon (native Linux VM), AWS Graviton |

Docker automatically selects the right variant for your host.

### GitHub Actions: automated publishing

`.github/workflows/docker.yml` publishes `latest` on pushes to `main` and manual runs.
The `publish-docker` jobs in `.github/workflows/release.yml` publish versioned images
when release-please creates a release. Both build amd64 and arm64 on native runners
and combine their digests into a multi-platform manifest; they do not use QEMU.

**No extra secrets are needed.** The workflow uses the built-in `GITHUB_TOKEN`
with `packages: write` permission. This token is automatically available in all
GitHub Actions runs.

```yaml
permissions:
  contents: read
  packages: write
```

### Manual re-publish (workflow_dispatch)

Run **Actions → Docker (dev) → Run workflow** to rebuild `latest` from the selected
ref. This workflow has no version-tag override and does not republish a versioned
release image.

### Visibility

GHCR container package visibility is configured separately from repository
visibility. The repository can be public while the package is still private.
Set the `ghcr.io/arc-mcp/arc-1` package visibility to public when images should
be pulled anonymously or published as Docker metadata in the MCP Registry;
otherwise authentication is required (`docker login ghcr.io`).

---

## Building the Image

### From source

```bash
# Version comes from the checked-out package.json
docker build -t arc1 .
```

The Dockerfile has no `VERSION`, `COMMIT`, or `BUILD_DATE` build arguments. Use
Docker `--label` options if you need custom image metadata.

### Multi-platform build (for sharing)

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/yourorg/arc1:x.y.z \
  --push .
```

> **Build note:** The image uses `node:22-alpine` as builder. The runtime image
> is `node:22-alpine` with only production dependencies installed.
> `better-sqlite3` requires native compilation during `npm install`.

---

## How arc1 Runs in Docker

### HTTP streamable (default)

The Docker image defaults to the **MCP streamable HTTP transport**, listening on
`0.0.0.0:8080`. This is the recommended mode for containerised deployments:

```
MCP Client (Claude Desktop, Cursor, etc.)
  │
  │  HTTP POST http://localhost:8080/mcp
  │
  ├─► docker container (long-lived, -d)
  │         │
  │    JSON-RPC over HTTP (streaming)
  │         │
  └─────────┴─► container keeps running; multiple clients can connect
```

Key differences from stdio mode:
- **Port 8080 is exposed** — map it with `-p 127.0.0.1:8080:8080`.
- **`-d` (detached) mode works** — the container stays alive between sessions.
- **No `-i` flag needed** — stdin is not used.
- **Multiple clients** can connect to the same container simultaneously.

### stdio mode (classic)

Set `SAP_TRANSPORT=stdio` to revert to the pipe-based model where an MCP client
spawns the container as a subprocess:

```
MCP Client
  │
  ├─► docker run -i --rm -e SAP_TRANSPORT=stdio -e SAP_URL=... arc1
  │         │
  │    JSON-RPC over stdin/stdout
  │         │
  └─────────┴─► stdio session ends when client disconnects
```

### Transport / address options

| Env variable | CLI flag | Default in image | Description |
|---|---|---|---|
| `SAP_TRANSPORT` | `--transport` | `http-streamable` | `stdio` or `http-streamable` |
| `ARC1_HTTP_ADDR` (legacy `SAP_HTTP_ADDR`) | `--http-addr` | `0.0.0.0:8080` | Listen address for http-streamable |
| `ARC1_UI` | `--ui` | `off` | Experimental read-only console. `web` mounts it at `/ui` and requires HTTP auth plus admin scope; `local` starts a loopback sidecar inside the container and is usually not useful unless you forward that port deliberately |
| `ARC1_UI_ADDR` | `--ui-addr` | `127.0.0.1:8711` | Sidecar bind address for `ARC1_UI=local` |

### Response-memory sizing

The data-preview byte allowance and data-result concurrency guard also apply in Docker. The image
starts `node dist/index.js` directly under `tini`; it does not use the Cloud Foundry Node.js
buildpack, so `OPTIMIZE_MEMORY` and the buildpack-provided `MEMORY_AVAILABLE` policy do not apply.
Give the container an explicit memory limit and, when predictable V8/native headroom matters, set a
numeric old-space ceiling in the same deployment definition:

```bash
docker run -d --rm \
  --memory=512m \
  -e NODE_OPTIONS=--max-old-space-size=384 \
  -e ARC1_MAX_DATAPREVIEW_RESPONSE_BYTES=2097152 \
  -e ARC1_MAX_CONCURRENT_DATA_RESULTS=2 \
  ... \
  ghcr.io/arc-mcp/arc-1:latest
```

For a different container limit, start with old-space at about 75% of RAM (for example 768 MiB at
1 GiB) and leave the rest for native HTTP buffers, XML input, and serialization. Use the
[data-preview RAM sizing model](btp-administration.md#data-preview-ram-sizing) for the two ARC-1
limits, then load-test the widest approved result at full configured concurrency. Keep
`--memory`, the numeric `NODE_OPTIONS` value, and the two data-result settings together; unlike the
shipped MTA buildpack path, the numeric Docker value does not follow a later memory override
automatically.

---

## Passing Configuration into Docker

All ARC-1 env vars, CLI flags, and safety recipes live in [configuration-reference.md](configuration-reference.md). This page only covers the Docker-specific part: how to pass that config into a container.

### Env vars and env files

!!! note "Where do values come from in Docker?"
    The image contains no `.env` file by default. Dotenv reads one only if you mount it in the container's working directory. Pass values explicitly with `-e KEY=VAL` or `--env-file path/to/file.env`. Arguments after the image replace its `CMD`; include the executable, for example `… arc1 node dist/index.js --allow-writes true`. These CLI flags override env. Full per-mode breakdown: [Configuration Precedence](configuration-precedence.md).

Use `-e` for short examples and `--env-file` when the list gets long. For HTTP mode, include `ARC1_API_KEYS=<generated-key>:admin` or another configured HTTP authentication method in that file:

```bash
# Keep connection/auth settings in .env, add extra safety opt-ins at runtime
docker run -d --rm \
  -p 127.0.0.1:8080:8080 \
  --env-file .env \
  -e SAP_ALLOW_WRITES=true -e SAP_ALLOW_TRANSPORT_WRITES=true \
  ghcr.io/arc-mcp/arc-1:latest
```

For the "everything on" local-dev path:

```bash
docker run -d --rm \
  -p 127.0.0.1:8080:8080 \
  --env-file .env \
  -e SAP_ALLOW_WRITES=true -e SAP_ALLOW_DATA_PREVIEW=true -e SAP_ALLOW_FREE_SQL=true -e SAP_ALLOW_TRANSPORT_WRITES=true \
  -e SAP_ALLOWED_PACKAGES='*' \
  ghcr.io/arc-mcp/arc-1:latest
```

Keep credentials and stable connection settings in `.env`; layer temporary overrides with `-e`.

For what `SAP_ALLOW_WRITES`, `SAP_ALLOW_TRANSPORT_WRITES`, `SAP_DENY_ACTIONS`, `SAP_ALLOWED_PACKAGES`, and the rest actually do, use [configuration-reference.md](configuration-reference.md). Ready-made read-only, sandboxed, and developer recipes live in [configuration-reference.md → Recipes](configuration-reference.md#recipes). That page shows raw `ENV=value` values: use them as-is in `.env` and `--env-file`, but quote shell-sensitive package patterns when you pass them via `-e`.

If you pass package patterns like `*` or `$TMP` through `-e SAP_ALLOWED_PACKAGES=...`, use single quotes so the shell does not expand them: `-e SAP_ALLOWED_PACKAGES='*'` or `-e SAP_ALLOWED_PACKAGES='Z*,$TMP'`.

### Cookie files inside the container

Mount a Netscape-format cookie file into the container and reference it with `SAP_COOKIE_FILE`:

```bash
docker run -i --rm -e SAP_TRANSPORT=stdio \
  -e SAP_URL=https://host:44300 \
  -e SAP_COOKIE_FILE=/cookies/cookies.txt \
  -v /path/to/local/cookies.txt:/cookies/cookies.txt:ro \
  ghcr.io/arc-mcp/arc-1:latest
```

The cookie file must use the Netscape format exported by browser extensions like *Edit This Cookie* or *Cookie-Editor*.

> **Never bake credentials into the image** with `ENV` in a downstream Dockerfile. Always pass them at runtime via `-e` or `--env-file`.
### Proxy, TLS, and networking

#### Self-signed or internal CA certificates

For SAP systems using self-signed certificates, either skip verification
(development only) or add your CA to the image:

```bash
# Option 1: skip verification (NOT for production)
-e SAP_INSECURE=true

# Option 2: mount your CA certificate
docker run -i --rm -e SAP_TRANSPORT=stdio \
  -e SAP_URL=https://internal-sap:44300 \
  -e SAP_USER=user -e SAP_PASSWORD=pass \
  -e NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/company-ca.crt \
  -v /etc/ssl/certs/company-ca.crt:/usr/local/share/ca-certificates/company-ca.crt:ro \
  arc1
```

For a permanent fix, extend the image:

```dockerfile
FROM ghcr.io/arc-mcp/arc-1:latest
USER root
COPY company-ca.crt /usr/local/share/ca-certificates/
RUN update-ca-certificates
ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/company-ca.crt
USER arc1
```

#### HTTP/HTTPS proxy

Direct ADT traffic does **not yet** honor the standard `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`
environment variables; setting them on the container does not route ARC-1's SAP requests. Track
[COMPAT-06](roadmap.md#compat-06) for native support. BTP Destination Service / Cloud Connector is a
different, platform-managed connectivity path. Until COMPAT-06 lands, provide network routing outside
ARC-1 (for example through the deployment platform) rather than assuming these environment variables
are active.

#### Connecting to a SAP system on the same Docker host

Use the host network or `host.docker.internal` (Docker Desktop):

```bash
# Linux — host network mode
docker run -i --rm -e SAP_TRANSPORT=stdio --network host \
  -e SAP_URL=http://localhost:50000 \
  -e SAP_USER=user -e SAP_PASSWORD=pass \
  arc1

# Docker Desktop (Mac/Windows)
-e SAP_URL=http://host.docker.internal:50000
```

#### Connecting to a SAP system in another Docker network

```bash
docker network create sap-net

docker run -i --rm -e SAP_TRANSPORT=stdio \
  --network sap-net \
  -e SAP_URL=http://sap-container:50000 \
  -e SAP_USER=user -e SAP_PASSWORD=pass \
  arc1
```

---

## MCP Client Integration

### HTTP streamable (recommended)

Using the key generated in Quick Start, start the container once and point an HTTP-capable MCP client at `http://localhost:8080/mcp`:

```bash
docker run -d --name arc1 \
  -p 127.0.0.1:8080:8080 \
  -e SAP_URL=https://my-sap-system:44300 \
  -e SAP_USER=developer \
  -e SAP_PASSWORD=secret \
  -e ARC1_API_KEYS="$ARC1_LOCAL_KEY:admin" \
  ghcr.io/arc-mcp/arc-1:latest
```

For example, configure Claude Code in `.mcp.json`, replacing `<generated-key>` with that key:

```json
{
  "mcpServers": {
    "arc1": {
      "type": "http",
      "url": "http://localhost:8080/mcp",
      "headers": { "Authorization": "Bearer <generated-key>" }
    }
  }
}
```

> Other clients have their own HTTP configuration format. For Claude Desktop, use the local stdio setup below or [remote connector setup](install-in-claude.md#remote-btp-cloud-foundry-custom-connector); a cloud connector cannot reach `localhost` on your laptop.

### Claude Desktop (stdio fallback)

For a Docker server running on your laptop, use stdio by overriding the transport:

```json
{
  "mcpServers": {
    "arc1": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "SAP_URL=https://my-sap-system:44300",
        "-e", "SAP_USER=developer",
        "-e", "SAP_PASSWORD=secret",
        "-e", "SAP_TRANSPORT=stdio",
        "ghcr.io/arc-mcp/arc-1:latest"
      ]
    }
  }
}
```

For a production system (read-only is already the default — no extra flags needed):

```json
{
  "mcpServers": {
    "arc1-prod": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "SAP_URL=https://prod-sap:44300",
        "-e", "SAP_USER=readonly_user",
        "-e", "SAP_PASSWORD=secret",
        "-e", "SAP_TRANSPORT=stdio",
        "ghcr.io/arc-mcp/arc-1:latest"
      ]
    }
  }
}
```

> **Tip:** Use `--env-file` instead of individual `-e` flags to keep credentials
> out of the config file. Reference the absolute path to the env file:
>
> ```json
> "args": ["run", "-i", "--rm", "-e", "SAP_TRANSPORT=stdio", "--env-file", "/Users/me/.arc1-prod.env", "ghcr.io/arc-mcp/arc-1:latest"]
> ```

### Gemini CLI / Other Agents

Clients that support HTTP MCP can connect to `http://localhost:8080/mcp` directly
once the container is running. For stdio-only clients use `docker run -i` with
`-e SAP_TRANSPORT=stdio`. See [local-development.md → MCP client configuration](local-development.md#mcp-client-configuration) for agent-specific
configuration examples.

---

## Updating the Image

For a comprehensive update guide covering all deployment modes (Docker, BTP, npm), see **[updating.md](updating.md)**.

### Quick reference

```bash
# Pull a specific version (recommended for production)
docker pull ghcr.io/arc-mcp/arc-1:x.y.z

# Pull latest (includes unreleased changes from main)
docker pull ghcr.io/arc-mcp/arc-1:latest

# Stop, remove, restart with new image
docker stop arc1 && docker rm arc1
docker run -d --name arc1 -p 127.0.0.1:8080:8080 --env-file .env ghcr.io/arc-mcp/arc-1:x.y.z

# Verify version
docker run --rm ghcr.io/arc-mcp/arc-1:x.y.z node dist/cli.js --version
```

### Pinning a version (recommended)

For production or shared team environments, always pin to a specific version
tag rather than `latest`:

```
ghcr.io/arc-mcp/arc-1:x.y.z
```

This ensures every team member uses the same binary regardless
of when the image was pulled. Check the
[GitHub releases page](https://github.com/arc-mcp/arc-1/releases)
for the latest version.

### Rebuilding from source

```bash
git pull
docker build -t arc1:latest .
```

### Staying up to date automatically

Teams that want automatic image updates can use tools like
[Renovate](https://docs.renovatebot.com/) or
[Dependabot](https://docs.github.com/en/code-security/dependabot) to open PRs
when a new `ghcr.io/arc-mcp/arc-1` image tag is published.

---

## Security Notes

1. **Never bake credentials into images.** Always pass `SAP_USER`,
   `SAP_PASSWORD`, `SAP_COOKIE_FILE` at runtime via `-e` or `--env-file`.

2. **Protect your `.env` file.** If using `--env-file`, ensure the file has
   restricted permissions (`chmod 600`) and is in `.gitignore`.

3. **Default is already read-only.** Writes, free SQL, table preview, transports,
   and Git are each off until you opt in (`SAP_ALLOW_WRITES`, `SAP_ALLOW_FREE_SQL`,
   `SAP_ALLOW_DATA_PREVIEW`, `SAP_ALLOW_TRANSPORT_WRITES`, `SAP_ALLOW_GIT_WRITES`).
   Enable them only on systems you are comfortable mutating, and pair writes with a
   tight `SAP_ALLOWED_PACKAGES`. ARC-1 feeds SAP-resident content to the LLM, which
   then issues tool calls — the package allowlist is the backstop that contains a
   prompt-injected model writing outside scope.

4. **The container runs as a non-root user** (`arc1:arc1`) inside Alpine. HTTP mode
   listens on port 8080; restrict the published interface and require HTTP authentication.

5. **Cookie files contain session tokens.** Mount them read-only (`:ro`) and
   use short-lived sessions where possible.

6. **Use `SAP_INSECURE=false` (the default).** Only set it to `true` in isolated
   development environments with no sensitive data — it disables SAP TLS
   verification entirely (any certificate accepted, MITM masked) with no startup
   warning. The bundled `manifest.yml` / `mta.yaml` ship `"false"`; keep that
   default on CA-signed landscapes.

7. **The SQLite cache stores SAP source in cleartext.** The default `auto` cache is
   in-memory, but explicitly setting `ARC1_CACHE=sqlite` creates `.arc1-cache.db`
   with full ABAP source, unencrypted, and a mounted volume persists it. ARC-1
   creates and repairs cache DB and file audit sink files with owner-only permissions
   (`0600`), but this is not encryption. For IP-sensitive landscapes keep
   `ARC1_CACHE=auto`/`memory` or `none`, or use an encrypted volume.

---

## Troubleshooting

### Container exits immediately

In **stdio mode**, use `-i` with `SAP_TRANSPORT=stdio` so the MCP client can communicate over stdin/stdout. Do not detach a stdio server. In the default HTTP mode, detached `-d` operation is supported; inspect `docker logs` for configuration or authentication errors.

<a id="sap-url-is-required-error"></a>
### No SAP connection configured

Without `SAP_URL` or a BTP connection, ARC-1 warns that no SAP connection is available; this alone does not stop the process. Destination and BTP service-key modes resolve their endpoint separately. For direct mode, pass `SAP_URL`:

```bash
docker run -i --rm -e SAP_URL=https://host:44300 ... arc1
```

### TLS certificate errors

```
UNABLE_TO_VERIFY_LEAF_SIGNATURE
SELF_SIGNED_CERT_IN_CHAIN
```

Either add your CA certificate (see [Network / TLS](#proxy-tls-and-networking)) or use
`SAP_INSECURE=true` in non-production environments.

### `authentication required` error

Distinguish MCP authentication from SAP authentication. HTTP clients need a configured API key or OAuth token. For SAP failures, check the selected method in the startup auth summary and remove unintended cookie or Basic settings; see [authentication precedence](enterprise-auth.md).

### Enable verbose logging

Add `-e SAP_VERBOSE=true` to see startup decisions including which features were
detected and which safety rules are active. Logs go to stderr; they will not
interfere with MCP over stdout.

```bash
docker run -i --rm -e SAP_TRANSPORT=stdio \
  -e SAP_URL=https://host:44300 \
  -e SAP_USER=user -e SAP_PASSWORD=pass \
  -e SAP_VERBOSE=true \
  arc1 2>arc1-debug.log
```

### Tool not appearing in the AI client

1. Check feature flags — features in `auto` mode may have been turned off because
   the SAP component was not detected. Force them on with e.g.
   `SAP_FEATURE_RAP=on`.
2. Check `SAP_DENY_ACTIONS` — deny rules hide matching actions from tool listings
   and block them again at call time.
