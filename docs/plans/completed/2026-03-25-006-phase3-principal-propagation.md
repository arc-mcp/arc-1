# Phase 3: Principal Propagation (Per-User SAP Auth)

**Date:** 2026-03-25
**Report ID:** 006
**Subject:** OIDC → Ephemeral X.509 → SAP mTLS principal propagation
**Related Documents:** 2026-03-25-003-centralized-mcp-auth-architecture.md, 2026-03-25-005-phase2-oauth-jwt-auth.md

---

## Goal

Each MCP request authenticates to SAP as the actual end user. No shared SAP passwords.

```
IDE/Copilot ──[OAuth JWT]──► vsp (validate JWT, extract user) ──[Ephemeral X.509 cert, CN=user]──► SAP
```

## What Already Exists

| Component | Status | File |
|-----------|--------|------|
| Ephemeral cert generation | ✅ Complete | `pkg/adt/principal_propagation.go` (`GenerateEphemeralCert`) |
| CA key/cert loading | ✅ Complete | `pkg/adt/principal_propagation.go` (`LoadPrincipalPropagation`) |
| Per-user HTTP doer | ✅ Complete | `pkg/adt/principal_propagation.go` (`PrincipalPropagationDoer`) |
| ForUser() factory | ✅ Complete | Creates user-bound doer |
| OIDC middleware | ✅ Complete (Phase 2) | `pkg/adt/oidc.go` |
| CLI flags | ✅ Complete | `--pp-ca-key`, `--pp-ca-cert`, `--pp-cert-ttl` |
| Unit tests | ✅ Complete | `pkg/adt/principal_propagation_test.go` |

## What To Implement

### 1. Per-User ADT Client Creation

The current architecture creates one `adt.Client` at startup (singleton). For principal propagation, we need per-user clients:

```go
// In NewServer(), when PP is configured:
if cfg.PPCAKeyFile != "" && cfg.PPCACertFile != "" {
    ppConfig := adt.PrincipalPropagationConfig{
        CAKeyFile:    cfg.PPCAKeyFile,
        CACertFile:   cfg.PPCACertFile,
        CertValidity: parseDuration(cfg.PPCertTTL, 5*time.Minute),
    }
    ppDoer, err := adt.LoadPrincipalPropagation(ppConfig)
    // Store ppDoer in Server struct
    s.ppDoer = ppDoer
}
```

### 2. Request-Level User Context in Tool Handlers

Tool handlers need to use the OIDC username from request context to create per-user SAP connections:

**Option A: Per-request ADT client** (clean but heavy)
- Create a new `adt.Client` per MCP request with `ppDoer.ForUser(username)`
- Pros: Clean isolation
- Cons: No session/CSRF token reuse

**Option B: Shared client, per-request HTTP doer** (efficient)
- Single `adt.Client` but swap the HTTP transport per request
- Pros: Share CSRF tokens, session cookies
- Cons: Thread safety concerns

**Recommended: Option A** — Create per-user client. The ephemeral cert is only valid 5 minutes anyway, so session reuse isn't meaningful.

### 3. MCP Session → User Mapping

The MCP Streamable HTTP transport creates sessions (`mcp-session-id`). Each session should be bound to a user:

```go
type userSession struct {
    username  string
    client    *adt.Client
    createdAt time.Time
}

// Map mcp-session-id → userSession
sessions sync.Map
```

### 4. SAP-Side Configuration

Required SAP configuration (documented in `docs/phase3-principal-propagation-setup.md`):

1. **Generate CA key pair** (the CA that signs ephemeral certs)
2. **Import CA cert into SAP STRUST** (SSL Server Standard PSE)
3. **Configure ICM parameters:**
   - `icm/HTTPS/verify_client = 1` (request client cert)
   - `login/certificate_mapping_rulebased = 1`
4. **Configure CERTRULE:** Map Subject CN → SAP User ID
5. **Restart ICM**

For **BTP Cloud Connector** deployments (SAP on-prem behind CC):
1. Import CA cert as Cloud Connector system certificate
2. Configure `icm/trusted_reverse_proxy_<n>` with CC's subject/issuer
3. Enable principal propagation in CC access control
4. CC forwards `SSL_CLIENT_CERT` header to SAP

### 5. Integration with Phase 2

Chain: OIDC Middleware → extract username → PP creates ephemeral cert → SAP mTLS

```go
// In ServeStreamableHTTP:
if s.config.OIDCIssuer != "" && s.ppDoer != nil {
    // OIDC + Principal Propagation: full enterprise flow
    handler = adt.OIDCMiddleware(validator, handler)
    // PP is handled per-request in tool handlers via ppDoer.ForUser(username)
}
```

## Test Plan

| Test | Description |
|------|-------------|
| `TestPPWithOIDCMiddleware` | OIDC extracts user → PP generates cert → SAP mTLS |
| `TestPerUserClientCreation` | Each user gets separate ADT client |
| `TestSessionUserBinding` | MCP session bound to authenticated user |
| `TestEphemeralCertInMTLS` | Ephemeral cert works in httptest TLS server |
| `TestCACertRotation` | Reload CA cert without restart |

## User Documentation

See `docs/phase3-principal-propagation-setup.md`

## Effort

~1 week implementation + tests + SAP admin setup + docs

## Blockers / Risks

- SAP admin access needed for STRUST/CERTRULE/ICM configuration
- Docker trial container resets profile parameters on restart
- Cloud Connector adds complexity for on-prem SAP behind BTP
