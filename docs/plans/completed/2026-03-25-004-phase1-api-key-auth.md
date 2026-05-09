# Phase 1: API Key Authentication

**Date:** 2026-03-25
**Report ID:** 004
**Subject:** API Key authentication for centralized vsp MCP server
**Related Documents:** 2026-03-25-003-centralized-mcp-auth-architecture.md

---

## Goal

Allow MCP clients (Copilot Studio, VS Code, Cursor) to authenticate to a centralized vsp server using a shared API key. vsp authenticates to SAP using existing Basic Auth.

```
IDE/Copilot ──[Authorization: Bearer <api-key>]──► vsp ──[Basic Auth]──► SAP
```

## What Already Exists

- HTTP Streamable transport (`ServeStreamableHTTP`) with origin validation middleware
- All CLI flag infrastructure (cobra + viper)
- Basic Auth to SAP (fully working)

## What To Implement

### 1. Config Addition

Add `APIKey` field to `mcp.Config`:
```go
APIKey string // Shared API key for authenticating MCP clients (HTTP Streamable only)
```

### 2. CLI Flag + Env Var

```
--api-key / VSP_API_KEY    Shared API key for MCP client authentication
```

Note: Uses `VSP_` prefix (not `SAP_`) because this authenticates the MCP client to vsp, not vsp to SAP.

### 3. API Key Middleware (`internal/mcp/server.go`)

```go
func apiKeyMiddleware(apiKey string, next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        auth := r.Header.Get("Authorization")
        if auth == "" {
            w.Header().Set("WWW-Authenticate", "Bearer")
            http.Error(w, `{"error":"missing Authorization header"}`, http.StatusUnauthorized)
            return
        }
        token := strings.TrimPrefix(auth, "Bearer ")
        token = strings.TrimPrefix(token, "bearer ")
        if subtle.ConstantTimeCompare([]byte(token), []byte(apiKey)) != 1 {
            http.Error(w, `{"error":"invalid API key"}`, http.StatusUnauthorized)
            return
        }
        next.ServeHTTP(w, r)
    })
}
```

### 4. Middleware Wiring in `ServeStreamableHTTP`

Chain: API Key → Origin Validation → MCP Handler

```go
func (s *Server) ServeStreamableHTTP(addr string) error {
    mcpHandler := newStreamableHTTPServerFunc(s.mcpServer, ...)
    handler := originValidationMiddleware(addr, mcpHandler)

    // Add API key auth if configured
    if s.config.APIKey != "" {
        handler = apiKeyMiddleware(s.config.APIKey, handler)
    }

    mux := http.NewServeMux()
    mux.Handle(DefaultStreamableHTTPPath, handler)
    return listenAndServeFunc(addr, mux)
}
```

### 5. Health Endpoint

Add `GET /health` (unauthenticated) for load balancer health checks:
```go
mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
    w.Write([]byte(`{"status":"ok"}`))
})
```

## Test Plan

| Test | Description |
|------|-------------|
| `TestAPIKeyMiddleware_ValidKey` | Request with correct Bearer key → 200 |
| `TestAPIKeyMiddleware_InvalidKey` | Request with wrong key → 401 |
| `TestAPIKeyMiddleware_MissingHeader` | No Authorization header → 401 |
| `TestAPIKeyMiddleware_NonBearerScheme` | `Authorization: Basic ...` → 401 |
| `TestAPIKeyMiddleware_TimingResistant` | Uses constant-time comparison |
| `TestServeStreamableHTTP_WithAPIKey` | API key middleware wired when configured |
| `TestServeStreamableHTTP_WithoutAPIKey` | No middleware when APIKey empty |
| `TestHealthEndpoint` | `/health` returns 200 without auth |

## User Documentation

See `docs/phase1-api-key-setup.md`

## Effort

~1 day implementation + tests + docs
