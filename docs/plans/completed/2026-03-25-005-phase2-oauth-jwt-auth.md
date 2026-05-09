# Phase 2: MCP OAuth 2.1 / JWT Authentication

**Date:** 2026-03-25
**Report ID:** 005
**Subject:** OAuth 2.1 JWT validation for centralized vsp MCP server
**Related Documents:** 2026-03-25-003-centralized-mcp-auth-architecture.md, 2026-03-25-004-phase1-api-key-auth.md

---

## Goal

MCP clients authenticate to vsp using OAuth 2.1 (Authorization Code + PKCE). vsp validates JWT Bearer tokens and extracts user identity. SAP auth remains Basic Auth (service account).

```
IDE/Copilot ──[OAuth 2.1 / EntraID JWT]──► vsp (validates JWT) ──[Basic Auth]──► SAP
```

## What Already Exists

| Component | Status | File |
|-----------|--------|------|
| OIDC JWT Validator | ✅ Complete | `pkg/adt/oidc.go` (463 lines) |
| JWKS fetching + caching | ✅ Complete | `pkg/adt/oidc.go` |
| OIDC HTTP Middleware | ✅ Complete | `pkg/adt/oidc.go` (`OIDCMiddleware`) |
| Username extraction | ✅ Complete | `pkg/adt/oidc.go` (priority chain) |
| Username mapping | ✅ Complete | `pkg/adt/oidc.go` (map[string]string) |
| CLI flags | ✅ Complete | `--oidc-issuer`, `--oidc-audience`, `--oidc-username-claim`, `--oidc-user-mapping` |
| Unit tests | ✅ Complete | `pkg/adt/oidc_test.go` (12 tests) |
| Phase 1 API key middleware | ✅ (after Phase 1) | `internal/mcp/server.go` |

## What To Implement

### 1. Wire OIDC Middleware into ServeStreamableHTTP

When `--oidc-issuer` is configured, wrap the MCP handler with `OIDCMiddleware`:

```go
func (s *Server) ServeStreamableHTTP(addr string) error {
    mcpHandler := newStreamableHTTPServerFunc(s.mcpServer, ...)
    handler := originValidationMiddleware(addr, mcpHandler)

    // OIDC auth (takes precedence over API key)
    if s.config.OIDCIssuer != "" {
        validator := adt.NewOIDCValidator(adt.OIDCConfig{
            IssuerURL:     s.config.OIDCIssuer,
            Audience:      s.config.OIDCAudience,
            UsernameClaim: s.config.OIDCUsernameClaim,
            UsernameMapping: loadUsernameMapping(s.config.OIDCUserMapping),
        })
        handler = adt.OIDCMiddleware(validator, handler)
    } else if s.config.APIKey != "" {
        handler = apiKeyMiddleware(s.config.APIKey, handler)
    }

    mux := http.NewServeMux()
    mux.Handle(DefaultStreamableHTTPPath, handler)
    mux.HandleFunc("/health", healthHandler)
    return listenAndServeFunc(addr, mux)
}
```

### 2. Protected Resource Metadata Endpoint (MCP Spec Compliance)

Add `GET /.well-known/oauth-protected-resource`:

```go
mux.HandleFunc("/.well-known/oauth-protected-resource", func(w http.ResponseWriter, r *http.Request) {
    metadata := map[string]interface{}{
        "resource": fmt.Sprintf("https://%s", addr),
        "authorization_servers": []string{s.config.OIDCIssuer},
        "bearer_methods_supported": []string{"header"},
    }
    w.Header().Set("Content-Type", "application/json")
    json.NewEncoder(w).Encode(metadata)
})
```

This tells MCP clients where to get tokens (RFC 9728).

### 3. Username Mapping YAML File Loading

```go
func loadUsernameMapping(path string) map[string]string {
    if path == "" {
        return nil
    }
    data, err := os.ReadFile(path)
    if err != nil {
        fmt.Fprintf(os.Stderr, "[WARN] Failed to load username mapping: %v\n", err)
        return nil
    }
    var mapping map[string]string
    yaml.Unmarshal(data, &mapping)
    return mapping
}
```

YAML format:
```yaml
# oidc-username → SAP-username
alice@company.com: ALICE
bob@company.com: BOB_DEV
```

### 4. WWW-Authenticate Response

When OIDC is configured, 401 responses include proper MCP-compliant header:
```
WWW-Authenticate: Bearer resource_metadata="https://vsp.example.com/.well-known/oauth-protected-resource"
```

### 5. Per-Session User Context Logging

Log the authenticated user for each MCP request (audit trail):
```go
if username, ok := adt.OIDCUsernameFromContext(r.Context()); ok {
    fmt.Fprintf(os.Stderr, "[VERBOSE] MCP request from user: %s\n", username)
}
```

## Test Plan

| Test | Description |
|------|-------------|
| `TestServeStreamableHTTP_WithOIDC` | OIDC middleware wired when issuer configured |
| `TestProtectedResourceMetadata` | `/.well-known/oauth-protected-resource` returns correct JSON |
| `TestOIDCPrecedenceOverAPIKey` | OIDC takes priority when both configured |
| `TestLoadUsernameMapping` | Load YAML mapping file |
| `TestLoadUsernameMappingMissing` | Missing file returns nil (warning, not error) |
| `TestWWWAuthenticateHeader` | 401 includes resource_metadata URL |

## User Documentation

See `docs/phase2-oauth-setup.md`

## Go Dependencies

None new — OIDC validation uses stdlib `crypto/rsa`, `encoding/json`. No `coreos/go-oidc` needed (already implemented from scratch).

YAML parsing: `gopkg.in/yaml.v3` (already in go.mod for other features) or use JSON format instead.

## Effort

~3-4 days implementation + tests + docs
