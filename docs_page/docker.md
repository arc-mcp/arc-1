# Docker

<a id="docker-guide-for-arc1"></a>
<a id="table-of-contents"></a>

Run the published ARC-1 image as an authenticated HTTP MCP server, or let a local MCP client start it in stdio mode. Docker is required; the host must reach your SAP HTTPS endpoint.

For BTP Cloud Foundry, use the [MTA deployment runbook](btp-cloud-foundry-deployment.md).

## Quick start

### HTTP streamable (default — recommended)

1. Create a protected `arc1.env` file outside your repository and fill in your SAP values:

   ```dotenv
   SAP_URL=https://your-sap-host:44300
   SAP_CLIENT=100
   SAP_USER=<SAP-user>
   SAP_PASSWORD=<SAP-password>
   ARC1_API_KEYS=<random-key>:viewer
   ```

   Generate the key with `openssl rand -hex 32`, then set `chmod 600 arc1.env` on Unix. Keep the key for the MCP client's bearer-token setting.

2. Choose an exact version from [GitHub releases](https://github.com/arc-mcp/arc-1/releases). The examples use `1.2.0`; replace that tag consistently when deploying another release. Start the container:

   ```bash
   docker run -d --name arc1 \
     --memory=512m \
     -p 127.0.0.1:8080:8080 \
     --env-file arc1.env \
     -e NODE_OPTIONS=--max-old-space-size=384 \
     ghcr.io/arc-mcp/arc-1:1.2.0
   ```

3. Check process health, then connect your MCP client to `http://localhost:8080/mcp` with `Authorization: Bearer <random-key>`:

   ```bash
   curl -fsS http://localhost:8080/health
   docker logs arc1
   ```

4. Ask the client to call `SAPRead(type="COMPONENTS")` or search for a known object. A healthy process alone does not prove SAP access.

The example binds only to localhost and starts read-only. For a team endpoint, configure HTTPS at a reverse proxy and [API key](api-key-setup.md) or [OIDC](oauth-jwt-setup.md) authentication before exposing it. HTTP mode requires ARC-1 authentication.

### stdio mode (classic, pipe-based)

For a client that starts ARC-1 as a subprocess:

```bash
docker run -i --rm \
  --env-file arc1.env \
  -e SAP_TRANSPORT=stdio \
  ghcr.io/arc-mcp/arc-1:1.2.0
```

Use `-i` to keep stdin open; omit `-d` and port mapping. The container exits when the client disconnects.

## Pre-built images (GHCR)

<a id="image-location"></a>
<a id="available-tags"></a>
<a id="pulling"></a>
<a id="supported-platforms"></a>

Images are available from [GitHub Container Registry](https://github.com/arc-mcp/arc-1/pkgs/container/arc-1) for `linux/amd64` and `linux/arm64`. Docker selects the host architecture automatically.

| Tag | Use |
|---|---|
| Exact version, such as `1.2.0` | Reproducible team and production deployments |
| Minor version, such as `1.2` | Latest release in that minor line |
| `latest` | Updated by releases and development builds; can include unreleased `main` changes |

<a id="github-actions-automated-publishing"></a>
<a id="manual-re-publish-workflow_dispatch"></a>
<a id="visibility"></a>

Versioned images are published by the [release workflow](https://github.com/arc-mcp/arc-1/blob/main/.github/workflows/release.yml). The [Docker (dev) workflow](https://github.com/arc-mcp/arc-1/blob/main/.github/workflows/docker.yml) updates `latest` on pushes to `main`; maintainers can rerun it through **Actions → Docker (dev) → Run workflow**. GHCR package visibility is separate from repository visibility; private packages require `docker login ghcr.io`.

## Building the image

### From source

From a checked-out source revision:

```bash
docker build -t arc1:local .
```

The Dockerfile uses a Node.js 22 Alpine build stage and a runtime with production dependencies. The image version comes from the checked-out `package.json`; the Dockerfile has no version build arguments.

### Multi-platform build (for sharing)

```bash
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  -t ghcr.io/<your-org>/arc1:<version> \
  --push .
```

## How ARC-1 runs in Docker

<a id="http-streamable-default"></a>
<a id="stdio-mode-classic"></a>

| Mode | Docker flags | Client connection |
|---|---|---|
| HTTP, default | `-d` and port mapping | Shared URL ending in `/mcp` |
| stdio | `-i --rm -e SAP_TRANSPORT=stdio` | stdin/stdout of a client-started process |

### Transport / address options

| Setting | Default | Purpose |
|---|---|---|
| `SAP_TRANSPORT` | `http-streamable` | HTTP or `stdio` |
| `ARC1_HTTP_ADDR` | `0.0.0.0:8080` in the image | Container listen address; `SAP_HTTP_ADDR` is a legacy alias |
| `ARC1_UI` | `off` | Experimental console; `web` requires HTTP auth and admin scope |
| `ARC1_UI_ADDR` | `127.0.0.1:8711` | Local UI sidecar address inside the container |

### Response-memory sizing

The quick start pairs a 512 MiB container limit with 384 MiB Node old-space. The remaining memory is needed for native buffers, parsing and serialization.

Keep these settings together in the deployment definition:

| Setting | Initial value |
|---|---|
| Docker `--memory` | `512m` |
| `NODE_OPTIONS` | `--max-old-space-size=384` |
| `ARC1_MAX_DATAPREVIEW_RESPONSE_BYTES` | `2097152` (2 MiB per tool call) |
| `ARC1_MAX_CONCURRENT_DATA_RESULTS` | `2` process-wide slots |

Before increasing data limits, use the [RAM sizing model](btp-administration.md#data-preview-ram-sizing) and measure the widest expected result at full concurrency. A starting old-space allowance is about 75% of container RAM. Docker's numeric `NODE_OPTIONS` does not adjust when the container memory limit changes; the CF buildpack's `OPTIMIZE_MEMORY`/`MEMORY_AVAILABLE` behavior does not apply here.

## Passing configuration into Docker

### Env vars and env files

Pass settings with `--env-file arc1.env` or one `-e KEY=value` per variable. A host `.env` file is not loaded automatically inside the container. To use CLI flags, supply the command too: arguments after the image name replace the image's `CMD`. For example, append `node dist/index.js --transport stdio` after the image name. These ARC-1 flags then override environment values.

Use the [configuration recipes](configuration-reference.md#recipes) for approved capabilities. Quote shell-sensitive package patterns when passing them directly:

```bash
-e SAP_ALLOW_WRITES=true -e SAP_ALLOWED_PACKAGES='ZARC1_DEV,$TMP'
```

See [Configuration precedence](configuration-precedence.md) for all layers.

### Cookie files inside the container

Mount a Netscape-format cookie file read-only and point ARC-1 at its **container** path:

```bash
docker run -i --rm \
  -e SAP_TRANSPORT=stdio \
  -e SAP_URL=https://your-sap-host:44300 \
  -e SAP_COOKIE_FILE=/cookies/cookies.txt \
  -v /absolute/path/cookies.txt:/cookies/cookies.txt:ro \
  ghcr.io/arc-mcp/arc-1:1.2.0
```

### Proxy, TLS, and networking

#### Self-signed or internal CA certificates

Mount the trusted CA and tell Node to load it. Add these flags to your normal container command:

```bash
-v /absolute/path/company-ca.crt:/certs/company-ca.crt:ro \
-e NODE_EXTRA_CA_CERTS=/certs/company-ca.crt
```

Keep `SAP_INSECURE=false`. Setting it to `true` disables SAP certificate verification.

#### HTTP/HTTPS proxy

Direct ADT traffic does not support `HTTPS_PROXY`, `HTTP_PROXY`, or `NO_PROXY` yet. Use platform/network routing, or BTP Destination/Cloud Connector connectivity. Track [COMPAT-06](roadmap.md#compat-06).

#### Connecting to a SAP system on the same Docker host

Use `host.docker.internal` as the hostname on Docker Desktop. On Linux, `--network host` lets the container use the host's network. Match the SAP URL to the certificate and reachable HTTPS port.

#### Connecting to a SAP system in another Docker network

Attach both containers to the same Docker network with `--network <network>`, then use the SAP container's network hostname and HTTPS port.

## MCP client integration

### HTTP streamable (recommended)

Use the URL and bearer token from [Quick Start](#quick-start). Client-specific settings are in [Local development](local-development.md#mcp-client-configuration) and [API key setup](api-key-setup.md).

### Claude Desktop (stdio fallback)

Use an absolute env-file path in the client's server configuration:

```json
{
  "mcpServers": {
    "arc1": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "--env-file", "/absolute/path/arc1.env",
        "-e", "SAP_TRANSPORT=stdio",
        "ghcr.io/arc-mcp/arc-1:1.2.0"
      ]
    }
  }
}
```

### Gemini CLI / other agents

Choose HTTP or stdio according to the client's supported transport. See [MCP client configuration](local-development.md#mcp-client-configuration) for examples.

## Updating the image

<a id="quick-reference"></a>
<a id="pinning-a-version-recommended"></a>
<a id="rebuilding-from-source"></a>
<a id="staying-up-to-date-automatically"></a>

Follow [Updating](updating.md) to pull the selected version, recreate the container with the **same ports, limits, mounts, and env file**, and verify it. Keep the previous image tag for rollback. For a source build, check out the selected revision and rebuild; changing the running container's filesystem is not an update procedure.

## Security notes

- Supply credentials at runtime and protect env files with owner-only permissions.
- Mount session cookies read-only; never include them or passwords in an image.
- Keep writes, data and SQL disabled until needed; restrict allowed packages when enabling writes.
- Keep TLS verification on and protect the public MCP endpoint with HTTPS and authentication.
- A persistent SQLite cache contains unencrypted SAP source. Use memory/none or an encrypted volume when required.

The runtime uses a non-root user and exposes HTTP port 8080. See the [Security guide](security-guide.md) for deployment controls.

## Troubleshooting

<a id="container-exits-immediately"></a>
<a id="sap-url-is-required-error"></a>
<a id="tls-certificate-errors"></a>
<a id="authentication-required-error"></a>
<a id="enable-verbose-logging"></a>
<a id="tool-not-appearing-in-the-ai-client"></a>

| Symptom | Check |
|---|---|
| Container exits in stdio mode | Use `-i`, omit `-d`, and verify `SAP_TRANSPORT=stdio` |
| `HTTP transport requires ARC-1 authentication` | Set `ARC1_API_KEYS`, OIDC, or XSUAA; SAP credentials alone do not authenticate MCP clients |
| `SAP_URL is not configured — no SAP system connection available` | Check the env-file path and `SAP_URL`; the process can start without a target |
| Certificate error | Mount the CA and set `NODE_EXTRA_CA_CERTS`; verify hostname and certificate chain |
| SAP login fails | Inspect SAP credentials/client and the [authentication setup](enterprise-auth.md) |
| Tool or action missing | Check detected SAP features, user scopes and `SAP_DENY_ACTIONS` |

Use `docker logs arc1`; add `-e SAP_VERBOSE=true` when recreating the container for more diagnostic output. Logs use stderr so stdio protocol output stays separate.
