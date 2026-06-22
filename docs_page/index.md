# ARC-1 — SAP ADT MCP Server

**Enterprise-ready proxy between AI clients and SAP systems.**

ARC-1 is a TypeScript MCP server (distributed as an npm package and Docker image) that implements the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) and translates AI tool calls into [SAP ABAP Development Tools (ADT)](https://help.sap.com/docs/abap-cloud/abap-development-tools-user-guide/about-abap-development-tools) REST API requests. It works with Claude, GitHub Copilot, VS Code, and any MCP-compatible client.

## Why ARC-1?

As an **admin**, you control what the AI can and cannot do via positive-opt-in flags:

- Default deny for every mutation; admin explicitly enables writes, transport writes, git writes, data preview, and freestyle SQL separately
- Package allowlist restricts writes to `$TMP`, `Z*`, or any pattern
- `SAP_DENY_ACTIONS` blocks individual actions (e.g. `SAPWrite.delete`) for admins who need a finer scalpel
- Every tool call audited with user identity; per-user scopes (via XSUAA role collections, OIDC JWTs, or API-key profiles) tighten further
- **Layered rate limiting** out of the box — per-IP OAuth edge, per-user MCP quota, server-wide SAP-bound semaphore with `Retry-After` honoring. See the [Rate Limiting Guide](rate-limiting.md).

## Quick Start

```bash
# Run directly with npx (no install needed)
npx arc-1@latest --url https://your-sap-host:44300 --user YOUR_USER

# Or install globally
npm install -g arc-1
arc1 --url https://your-sap-host:44300 --user YOUR_USER

# Or use Docker
docker run -e SAP_URL=https://host:44300 -e SAP_USER=dev -e SAP_PASSWORD=secret \
  ghcr.io/arc-mcp/arc-1
```

### BTP ABAP Environment

For local SAP BTP ABAP (Steampunk) development, use a service key instead of username/password:

```bash
SAP_BTP_SERVICE_KEY_FILE=/path/to/service-key.json arc1
```

A browser opens for login (OAuth 2.0 Authorization Code flow). For deployed BTP Cloud Foundry servers, use a BTP Destination with `OAuth2UserTokenExchange` instead; it is headless and preserves per-user SAP identity. See **[btp-abap-environment.md](btp-abap-environment.md)** for both paths.

## Connect Your Client

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "sap": {
      "command": "npx",
      "args": ["-y", "arc-1@latest"],
      "env": {
        "SAP_URL": "https://your-sap-host:44300",
        "SAP_USER": "your-username",
        "SAP_PASSWORD": "your-password",
        "SAP_CLIENT": "100"
      }
    }
  }
}
```

**ARC-1 is read-only by default** — no writes, no free SQL, no table preview, no transport actions. To change that, edit the same `env` block that starts ARC-1. For example, `SAP_ALLOW_DATA_PREVIEW=true SAP_ALLOW_FREE_SQL=true` keeps the server read-only but enables SQL + named table preview. The example below shows the "everything on" variant (writes + SQL + transports + all packages):

```json
{
  "mcpServers": {
    "sap": {
      "command": "npx",
      "args": ["-y", "arc-1@latest"],
      "env": {
        "SAP_URL": "https://your-sap-host:44300",
        "SAP_USER": "your-username",
        "SAP_PASSWORD": "your-password",
        "SAP_CLIENT": "100",
        "SAP_ALLOW_WRITES": "true", "SAP_ALLOW_DATA_PREVIEW": "true", "SAP_ALLOW_FREE_SQL": "true", "SAP_ALLOW_TRANSPORT_WRITES": "true",
        "SAP_ALLOWED_PACKAGES": "*"
      }
    }
  }
}
```

Pick the lightest combination that gets your work done. Common starting points:

- **Read/search only**: nothing — defaults are already read-only.
- **Read + data preview + SQL**: `SAP_ALLOW_DATA_PREVIEW=true`, `SAP_ALLOW_FREE_SQL=true`.
- **Developer (writes to $TMP/Z*)**: `SAP_ALLOW_WRITES=true`, `SAP_ALLOWED_PACKAGES='$TMP,Z*'`, optionally `SAP_ALLOW_TRANSPORT_WRITES=true` for CTS.

See [authorization.md](authorization.md) for the three-layer model and the full [capability requirements](authorization.md#capability-requirements).

### Claude Code

Add `.mcp.json` to your project root:

```json
{
  "mcpServers": {
    "sap": {
      "command": "npx",
      "args": ["-y", "arc-1@latest"],
      "env": {
        "SAP_URL": "https://your-sap-host:44300",
        "SAP_USER": "your-username",
        "SAP_PASSWORD": "your-password",
        "SAP_CLIENT": "100"
      }
    }
  }
}
```

### GitHub Copilot / VS Code

For local stdio mode, use the same `npx` command shape shown above. VS Code's `servers` form looks like this:

```json
{
  "servers": {
    "sap": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "arc-1@latest"],
      "env": {
        "SAP_URL": "https://your-sap-host:44300",
        "SAP_USER": "your-username",
        "SAP_PASSWORD": "your-password",
        "SAP_CLIENT": "100"
      }
    }
  }
}
```

For HTTP Streamable mode, start arc1 as an HTTP server, then point your MCP client to it:

```bash
SAP_URL=https://host:44300 SAP_USER=dev SAP_PASSWORD=secret \
  npx arc-1@latest --transport http-streamable --http-addr 0.0.0.0:3000
```

Add to VS Code / Copilot MCP config:

```json
{
  "servers": {
    "sap": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

For VS Code / Copilot HTTP mode, safety flags go on the ARC-1 startup command, not in the MCP JSON. Example: `SAP_ALLOW_DATA_PREVIEW=true SAP_ALLOW_FREE_SQL=true npx arc-1@latest --transport http-streamable ...`

HTTP Streamable is also the transport for **Copilot Studio** (Microsoft Power Platform integrations).

### Other MCP Clients

All MCP clients that support stdio work out of the box — just point them at `npx arc-1`.

## Tools

ARC-1 exposes 12 intent-based tools via MCP, designed for AI agents like Copilot Studio.

For object understanding, start with `SAPContext(action="deps")` instead of raw `SAPRead`: ARC-1 prepends the object's Knowledge Transfer Document (`SKTD`, also accepted as `KTD`) when one exists, then returns compressed dependency contracts. Use `SAPRead` after that when you need exact source, a method body, grep output, drafts, revisions, or metadata.

Full reference: **[tools.md](tools.md)**

## Testing & CI

- **3,474 unit tests** run locally without SAP access (`npm test`)
- **Default integration + E2E lanes** run against the A4H 2025 SAP target on internal PRs and manual dispatch in GitHub Actions
- **Manual slow SAP profiles** cover expensive cache warmup, broad where-used, RAP full-stack, and recursive CTS release checks (`test:integration:slow`, `test:e2e:slow`, GitHub **SAP Slow Tests** workflow)
- **BTP tests** are local-only (`npm run test:integration:btp`, `npm run test:integration:btp:smoke`)
- **Reliability telemetry + coverage** are collected as informational CI signals

## Admin Controls (Safety)

Safe by default - read-only, no SQL, no data preview, no transport writes, no Git writes. Writes are restricted to `$TMP`.

Every capability is a separate positive opt-in flag:

- **Nothing**: read / search / navigate / lint / diagnose work out of the box.
- `SAP_ALLOW_DATA_PREVIEW=true` + `SAP_ALLOW_FREE_SQL=true`: enable named table preview and freestyle SQL.
- `SAP_ALLOW_WRITES=true` + `SAP_ALLOWED_PACKAGES='$TMP,Z*'`: enable object writes to `$TMP` and `Z*` packages.
- Add `SAP_ALLOW_TRANSPORT_WRITES=true` for CTS transport mutations, `SAP_ALLOW_GIT_WRITES=true` for abapGit / gCTS pushes.

The three-layer model (server flag + user scope + SAP authorization) is described in [authorization.md](authorization.md). Full flag reference: [configuration-reference.md](configuration-reference.md).

## SAP API Policy and data access

SAP's current [SAP API Policy](https://help.sap.com/doc/sap-api-policy/latest/en-US/API_Policy_latest.pdf) is v.4.2026a. It allows published/documented APIs for their documented purposes, while restricting unsupported internal APIs, misuse, unmanaged autonomous AI call patterns, and large-scale extraction outside endorsed paths. ARC-1 is designed as a governed development-tooling proxy around ADT behavior, not as a bulk data-extraction product. For normal internal developer workflows, the project is intended to be generally usable with real user identity, SAP authorization, audit logging, rate controls, and customer-side governance.

ARC-1's defaults are intentionally conservative: no writes, no named table preview, no freestyle SQL, no transport mutations, no Git mutations. Two capabilities are especially sensitive and are **off by default** behind explicit opt-in env vars:

| Capability | Env var to enable | Default | Why it is gated |
| ---------- | ----------------- | ------- | --------------- |
| Named table content preview (`SAPRead(type=TABLE_CONTENTS)`) | `SAP_ALLOW_DATA_PREVIEW=true` | `false` (off) | Can expose application-table data; keep off unless the use case is approved. |
| Freestyle ABAP SQL (`SAPQuery`) | `SAP_ALLOW_FREE_SQL=true` | `false` (off) | Executes ad-hoc ABAP SQL; keep off unless the use case is approved. |

For production, combine conservative tool exposure with real user identity, SAP-side authorization, audit logging, rate limits, and review against the current SAP policy.

## Documentation

| Doc | Description |
|-----|-------------|
| [quickstart.md](quickstart.md) | **Start here** — 5-minute npx + Claude Desktop setup |
| [local-development.md](local-development.md) | Full local dev — npx/npm/Docker/git, `.env`, SSO cookie extractor, MCP client configs |
| [deployment.md](deployment.md) | Multi-user deployment — Docker on a VM, BTP Cloud Foundry, BTP ABAP |
| [configuration-reference.md](configuration-reference.md) | Every flag and env var, one table |
| [updating.md](updating.md) | Update procedures (npx / Docker / BTP / git) |
| [enterprise-auth.md](enterprise-auth.md) | Auth internals — Layer A / Layer B, coexistence matrix |
| [authorization.md](authorization.md) | Scopes, roles, safety profiles |
| [tools.md](tools.md) | Complete tool reference (12 intent-based tools) |
| [mcp-usage.md](mcp-usage.md) | AI agent usage guide & workflow patterns |
| [architecture.md](architecture.md) | System architecture with Mermaid diagrams |
| [caching.md](caching.md) | Object caching — server-validated via `ETag`/`If-None-Match`, active/inactive source views, KTD source entries, pre-warmer, reverse dep lookup |
| [security-guide.md](security-guide.md) | Security hardening checklist for production |
| [cli-guide.md](cli-guide.md) | CLI commands and configuration |
| [docker.md](docker.md) | Full Docker reference |
| [btp-abap-environment.md](btp-abap-environment.md) | BTP ABAP Environment — local service-key OAuth and deployed per-user destination setup |
| [btp-cloud-foundry-deployment.md](btp-cloud-foundry-deployment.md) | BTP Cloud Foundry deployment details |
| [sap-trial-setup.md](sap-trial-setup.md) | SAP BTP trial setup |
| [roadmap.md](roadmap.md) | Planned features |
| [blog-series.md](blog-series.md) | Long-form blog series — AI for ABAP development, ARC-1 design, BTP / Copilot Studio / Joule walkthroughs |

## License

MIT — [GitHub Repository](https://github.com/arc-mcp/arc-1)
