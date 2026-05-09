# BTP Cloud Foundry Deployment + Copilot Studio Connection

**Date:** 2026-03-25
**Report ID:** 001
**Subject:** Deploy vsp MCP server to SAP BTP CF and connect Microsoft Copilot Studio
**Related Documents:** `docs/phase4-btp-deployment.md`, `docs/sap-trial-setup.md`

---

## Architecture

```
Microsoft Copilot Studio                SAP BTP Cloud Foundry (us10)              On-Premises (Hetzner)
┌─────────────────────┐     HTTPS     ┌──────────────────────────────┐          ┌──────────────┐
│  Copilot Studio     │──────────────►│  vsp (Docker image)          │          │  SAP ABAP    │
│  MCP Connector      │  API Key      │  - /mcp endpoint             │          │  Trial 2023  │
│                     │  Bearer token │  - /health for CF health     │ CC tunnel│  port 50000  │
└─────────────────────┘               │  - Destination + Connectivity│─────────►│              │
                                      └──────────────────────────────┘          └──────────────┘
```

**Traffic flow:**
1. Copilot Studio sends MCP requests (HTTP POST) to `https://vsp-mcp-server.cfapps.us10.hana.ondemand.com/mcp`
2. vsp authenticates via API key (Phase 1) or XSUAA JWT (Phase 2)
3. vsp connects to SAP system via Cloud Connector tunnel (Connectivity Service)
4. SAP ADT responses flow back through the same path

## Decisions

### Docker Image vs Binary Buildpack

**Decision: Docker image.**
- The Docker image already exists with CGO support for go-sqlite3
- Dockerfile defaults to `http-streamable` on `0.0.0.0:8080`
- CF supports Docker images via `cf push --docker-image`
- Binary buildpack would require complex CGO cross-compilation

**Fallback:** If CF trial doesn't support Docker, use `CGO_ENABLED=0` binary (loses SQLite cache, acceptable).

### Authentication: API Key First

**Decision: API key for Phase 1, XSUAA OAuth for Phase 2.**
- API key is simplest: `Authorization: Bearer <token>` with constant-time comparison
- No XSUAA service instance needed
- Copilot Studio supports Bearer token auth
- XSUAA added later for proper OAuth with scopes/roles

### Origin Validation

**Decision: Skip origin check when bound to 0.0.0.0.**
- The MCP spec requires origin validation to prevent DNS rebinding
- When server binds to wildcard (0.0.0.0), origin check against "0.0.0.0" never matches
- Server-to-server calls (Copilot Studio) don't send Origin headers anyway
- API key auth protects the endpoint regardless

## Code Changes Required

### 1. CF PORT env var support (`cmd/vsp/main.go`)

Cloud Foundry sets a plain `PORT` env var (not `SAP_PORT`). vsp only reads `SAP_HTTP_ADDR`.

```go
// After SAP_HTTP_ADDR resolution:
if cfg.HTTPAddr == "" || cfg.HTTPAddr == "127.0.0.1:8080" {
    if cfPort := os.Getenv("PORT"); cfPort != "" {
        cfg.HTTPAddr = "0.0.0.0:" + cfPort
    }
}
```

### 2. Origin validation fix (`internal/mcp/server.go`)

```go
// In originValidationMiddleware, after extracting serverHost:
if serverHost == "0.0.0.0" || serverHost == "::" || serverHost == "" {
    return next
}
```

## Deployment Artifacts

### manifest.yml

```yaml
applications:
  - name: vsp-mcp-server
    docker:
      image: ghcr.io/marianfoo/vsp:latest
    instances: 1
    memory: 256M
    disk_quota: 512M
    health-check-type: http
    health-check-http-endpoint: /health
    env:
      SAP_URL: "http://<cc-virtual-host>:50000"
      SAP_CLIENT: "001"
      SAP_INSECURE: "true"
      SAP_MODE: "focused"
      SAP_READ_ONLY: "true"
      SAP_BLOCK_FREE_SQL: "true"
      SAP_DISABLED_GROUPS: "DHT"
      SAP_VERBOSE: "true"
    services:
      - vsp-connectivity
```

Credentials set separately via `cf set-env` (not in manifest):
- `SAP_USER`, `SAP_PASSWORD` — SAP system credentials
- `VSP_API_KEY` — API key for MCP client authentication

## Deployment Steps

| # | Step | Type | Notes |
|---|------|------|-------|
| 1 | `cf login` | Manual | Select org/space |
| 2 | Create Connectivity service | CLI | `cf create-service connectivity lite vsp-connectivity` |
| 3 | Verify CC virtual host mapping | Manual | Check CC admin panel |
| 4 | Build & push Docker image | CLI | `docker buildx build --push` |
| 5 | Set env vars (credentials) | CLI | `cf set-env` for SAP_USER, SAP_PASSWORD, VSP_API_KEY |
| 6 | `cf push` | CLI | Deploys Docker image |
| 7 | Verify /health | CLI | `curl .../health` |
| 8 | Test MCP endpoint | CLI | `curl -X POST .../mcp` with API key |
| 9 | Test SAP connectivity | CLI | GetSystemInfo via MCP |
| 10 | Configure Copilot Studio | Manual | Add MCP connector in Copilot Studio UI |

## Copilot Studio Configuration

1. Open Copilot Studio portal
2. Create or open a copilot
3. Add MCP Server action/connector
4. Configure:
   - **Server URL:** `https://vsp-mcp-server.cfapps.us10.hana.ondemand.com/mcp`
   - **Authentication:** API Key / Bearer Token
   - **API Key:** Value from `VSP_API_KEY`
5. Test tool discovery (tools/list)
6. Test a read tool (SearchObject or GetSystemInfo)

### Safety Configuration for Copilot Studio

```
SAP_READ_ONLY=true           # No writes
SAP_BLOCK_FREE_SQL=true      # No arbitrary SQL
SAP_MODE=focused             # 81 tools (not 122)
SAP_DISABLED_GROUPS=DHT      # No debugger, HANA, tests
```

## Phase 2: OAuth with XSUAA (Future)

When ready to move beyond API key auth:

1. Create `xs-security.json` with scopes (read, write, admin)
2. `cf create-service xsuaa application vsp-xsuaa -c xs-security.json`
3. Bind to app in manifest.yml
4. vsp auto-detects XSUAA via VCAP_SERVICES
5. Use `--oidc-issuer` pointing at XSUAA issuer URL
6. Configure Copilot Studio with OAuth flow

## Risks

| Risk | Mitigation |
|------|------------|
| CF trial may not support Docker images | Fallback to binary buildpack with CGO_ENABLED=0 |
| CC path filter may block ADT endpoints | Verify /sap/bc/adt/* is allowed in CC |
| 81 tools may overwhelm Copilot Studio LLM | Use --disabled-groups to reduce further |
| CF assigns ephemeral URLs | Use CF route or custom domain |
