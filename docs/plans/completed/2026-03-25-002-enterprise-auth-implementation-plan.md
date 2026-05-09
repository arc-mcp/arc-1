# Enterprise Authentication Implementation Plan

**Date:** 2026-03-25
**Report ID:** 002
**Subject:** Implementation plan for X.509 mTLS, OIDC, and principal propagation auth
**Related Documents:** 2026-03-24-002-enterprise-bridge-gap-analysis.md, 2026-03-25-001-enterprise-auth-research.md

---

## Overview

Three new auth methods to implement, building on the existing OAuth2/XSUAA infrastructure:

1. **X.509 mTLS Client Certificate** — vsp presents a client cert to SAP for TLS-level auth
2. **OIDC Token Validation** — vsp validates incoming EntraID/OIDC Bearer tokens on the MCP HTTP endpoint
3. **Principal Propagation** — combines OIDC + ephemeral X.509: extract user from OIDC token, generate short-lived cert, authenticate to SAP as that user

## Architecture

```
                  ┌──────────────────────────────────────────────────┐
                  │                 vsp binary                       │
                  │                                                  │
 MCP Client ─────┤  [OIDC Middleware] ──── validates Bearer token    │
 (Copilot/IDE)   │         │               extracts username         │
                  │         ▼                                        │
                  │  [Auth Provider] ──── selects auth strategy:     │
                  │         │              - Basic auth              │
                  │         │              - Cookie auth             │
                  │         │              - OAuth2/XSUAA            │
                  │         │              - X.509 mTLS (static)     │
                  │         │              - Principal propagation   │
                  │         ▼                                        │
                  │  [ADT Transport] ──── CSRF, sessions, retries   │
                  │         │                                        │
                  └─────────┼────────────────────────────────────────┘
                            ▼
                    SAP ABAP System (via HTTPS)
```

## Implementation Details

### 1. X.509 mTLS Client Certificate Auth

**Files modified:**
- `pkg/adt/config.go` — add `ClientCertFile`, `ClientKeyFile`, `CACertFile` to Config
- `pkg/adt/http.go` — no changes (TLS handled at http.Client level)
- `cmd/vsp/main.go` — add CLI flags and env var bindings

**Config additions:**
```go
// X.509 client certificate authentication (mTLS)
ClientCertFile string  // Path to PEM-encoded client certificate
ClientKeyFile  string  // Path to PEM-encoded private key
CACertFile     string  // Path to PEM-encoded CA certificate (optional, for custom CA)
```

**CLI flags:**
```
--client-cert    / SAP_CLIENT_CERT     Path to client certificate (PEM)
--client-key     / SAP_CLIENT_KEY      Path to client private key (PEM)
--ca-cert        / SAP_CA_CERT         Path to CA certificate (PEM, optional)
```

**NewHTTPClient changes:**
```go
func (c *Config) NewHTTPClient() *http.Client {
    tlsConfig := &tls.Config{
        InsecureSkipVerify: c.InsecureSkipVerify,
    }

    // Load client certificate for mTLS
    if c.ClientCertFile != "" && c.ClientKeyFile != "" {
        cert, err := tls.LoadX509KeyPair(c.ClientCertFile, c.ClientKeyFile)
        if err != nil {
            // Store error to surface during client creation
            // (same pattern as OAuthError)
        }
        tlsConfig.Certificates = []tls.Certificate{cert}
    }

    // Load custom CA certificate
    if c.CACertFile != "" {
        caCert, _ := os.ReadFile(c.CACertFile)
        caCertPool := x509.NewCertPool()
        caCertPool.AppendCertsFromPEM(caCert)
        tlsConfig.RootCAs = caCertPool
    }

    // ... rest
}
```

**Auth exclusivity:** X.509 mTLS counts as one auth method (like basic, cookie, OAuth). No basic auth headers sent when cert auth is active — TLS handshake handles authentication.

**Tests:**
- Unit test with `httptest.NewTLSServer` + custom CA
- Test certificate loading from PEM files
- Test error handling for missing/invalid certs
- Integration test against trial SAP server (manual setup)

---

### 2. OIDC Token Validation Middleware

**New file:** `pkg/adt/oidc.go`

**Purpose:** When vsp runs in HTTP Streamable mode, validate incoming Bearer tokens from Copilot Studio / EntraID before processing MCP requests.

**Configuration:**
```go
type OIDCConfig struct {
    IssuerURL    string   // OIDC issuer (e.g., https://login.microsoftonline.com/{tenant}/v2.0)
    Audience     string   // Expected audience claim (e.g., api://vsp-connector)
    UsernameClaim string  // Claim to extract SAP username from (default: "preferred_username")
    UsernameMapping map[string]string // email → SAP username overrides
}
```

**CLI flags:**
```
--oidc-issuer         / SAP_OIDC_ISSUER          OIDC issuer URL (EntraID tenant)
--oidc-audience       / SAP_OIDC_AUDIENCE        Expected token audience
--oidc-username-claim / SAP_OIDC_USERNAME_CLAIM   JWT claim for username (default: preferred_username)
--oidc-user-mapping   / SAP_OIDC_USER_MAPPING    Username mapping file (YAML)
```

**Middleware approach:**
- Placed BEFORE the MCP handler in the HTTP chain
- Validates JWT signature via JWKS (cached, auto-refreshing)
- Checks issuer, audience, expiry
- Extracts username from configured claim
- Stores username in request context for downstream use

**Dependencies:**
- No external dep needed — use `crypto/rsa`, `encoding/json` for JWKS + JWT
- Standard JWT validation: fetch JWKS from `{issuer}/.well-known/openid-configuration`,
  cache keys, validate RS256/ES256 signatures
- Or use lightweight `github.com/golang-jwt/jwt/v5` (very popular, maintained)

---

### 3. Principal Propagation (OIDC → Ephemeral X.509)

**New file:** `pkg/adt/principal_propagation.go`

**Purpose:** For each incoming MCP request, generate a short-lived X.509 certificate with the user's SAP username as CN, signed by a trusted CA. Use this cert for the SAP mTLS connection.

**Configuration:**
```go
type PrincipalPropagationConfig struct {
    Enabled       bool
    CAKeyFile     string        // Path to CA private key (PEM)
    CACertFile    string        // Path to CA certificate (PEM)
    CertValidity  time.Duration // Certificate validity (default: 5 minutes)
}
```

**CLI flags:**
```
--pp-ca-key     / SAP_PP_CA_KEY        CA private key for signing ephemeral certs
--pp-ca-cert    / SAP_PP_CA_CERT       CA certificate (must be trusted by SAP STRUST)
--pp-cert-ttl   / SAP_PP_CERT_TTL      Certificate validity duration (default: 5m)
```

**Flow:**
1. OIDC middleware extracts username from Bearer token
2. Principal propagation generates ephemeral cert: `CN={username}`, validity=5min
3. New `tls.Config` with ephemeral cert replaces the static one
4. ADT request goes to SAP with this ephemeral cert
5. SAP validates cert against trusted CA (STRUST), maps CN to SAP user (CERTRULE)

**Per-request HTTP client:**
Since each request may be for a different user, the HTTP client's TLS config must be created per-request. This means the `Transport.httpClient` needs to be a factory, not a singleton.

**Key design:** A `PrincipalPropagationDoer` that wraps `HTTPDoer`:
```go
type PrincipalPropagationDoer struct {
    caKey    crypto.PrivateKey
    caCert   *x509.Certificate
    validity time.Duration
    baseTransport *http.Transport // Template transport (proxy, timeouts)
}

func (d *PrincipalPropagationDoer) DoAs(req *http.Request, username string) (*http.Response, error) {
    // 1. Generate ephemeral cert with CN=username
    // 2. Create per-request TLS config with ephemeral cert
    // 3. Create per-request http.Client
    // 4. Execute request
}
```

**Certificate generation (all Go stdlib):**
```go
func generateEphemeralCert(caKey crypto.PrivateKey, caCert *x509.Certificate,
    username string, validity time.Duration) (tls.Certificate, error) {

    // Generate RSA-2048 key pair
    key, _ := rsa.GenerateKey(rand.Reader, 2048)

    template := &x509.Certificate{
        SerialNumber: big.NewInt(time.Now().UnixNano()),
        Subject:      pkix.Name{CommonName: username},
        NotBefore:    time.Now().Add(-1 * time.Minute), // Clock skew tolerance
        NotAfter:     time.Now().Add(validity),
        KeyUsage:     x509.KeyUsageDigitalSignature,
        ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
    }

    certDER, _ := x509.CreateCertificate(rand.Reader, template, caCert, &key.PublicKey, caKey)
    // Return as tls.Certificate
}
```

---

## SAP System Configuration Guide

### For X.509 mTLS (Static Certificate)

1. **Generate CA and client cert** (see appendix)
2. **Import CA into SAP STRUST:**
   - Transaction `/nSTRUST`
   - Navigate to SSL Server Standard PSE
   - Certificate → Import → paste CA cert PEM
   - Add to Certificate List
   - Save
3. **Enable certificate login:**
   - Transaction `/nRZ10` → edit instance profile
   - Set `login/certificate_mapping_rulebased = 1`
   - Set `icm/HTTPS/verify_client = 1` (accept) or `2` (require)
4. **Configure CERTRULE:**
   - Transaction `/nCERTRULE`
   - Import a sample cert
   - Create rule: `Subject CN` → `Login As` → `Use CN value as SAP username`
5. **Restart ICM** (not full system):
   - Transaction `/nSMICM` → Administration → ICM → Soft Restart

### For Principal Propagation

Same as X.509 mTLS setup above. The CA cert imported into STRUST is the same CA that signs the ephemeral certs.

### For OIDC (EntraID)

1. **Create App Registration in Azure EntraID:**
   - Azure Portal → App registrations → New registration
   - Name: "vsp SAP Connector"
   - Redirect URI: not needed (service-to-service)
   - Note: Application (client) ID and Directory (tenant) ID
2. **Expose an API:**
   - Set Application ID URI (e.g., `api://vsp-sap-connector`)
   - Add scope: `SAP.Access`
3. **Configure vsp:**
   ```
   --oidc-issuer https://login.microsoftonline.com/{tenant-id}/v2.0
   --oidc-audience api://vsp-sap-connector
   ```

---

## Test Strategy

### Unit Tests (no SAP system required)

| Test | Description |
|------|-------------|
| `TestLoadClientCertificate` | Load cert+key from PEM files |
| `TestLoadClientCertificateInvalid` | Error on invalid/missing PEM |
| `TestLoadCACertificate` | Load CA cert, build cert pool |
| `TestMTLSClientCreation` | Create http.Client with cert in TLS config |
| `TestMTLSAgainstTestServer` | Full mTLS handshake with httptest.NewTLSServer |
| `TestOIDCValidateToken` | Validate mock JWT with test JWKS |
| `TestOIDCExpiredToken` | Reject expired JWT |
| `TestOIDCWrongAudience` | Reject JWT with wrong audience |
| `TestOIDCExtractUsername` | Extract username from various claims |
| `TestOIDCUsernameMapping` | Map email to SAP username |
| `TestGenerateEphemeralCert` | Generate cert, verify CN and validity |
| `TestEphemeralCertSigning` | Verify cert is signed by CA |
| `TestEphemeralCertMTLS` | Use ephemeral cert for mTLS handshake |
| `TestPrincipalPropagationDoer` | Full flow: username → cert → mTLS request |
| `TestAuthMethodExclusivity` | Only one auth method at a time |

### Integration Tests (require SAP system with cert config)

| Test | Description |
|------|-------------|
| `TestIntegration_X509Auth` | Connect to SAP with static client cert |
| `TestIntegration_PrincipalPropagation` | OIDC user → ephemeral cert → SAP |

These are gated behind `integration` build tag and require the SAP trial system to be configured with STRUST/CERTRULE.

---

## Implementation Order

1. **X.509 mTLS** (simplest, foundation for #3)
   - Config fields + CLI flags + env vars
   - `NewHTTPClient()` TLS enhancement
   - Option functions
   - Unit tests
   - Documentation

2. **OIDC Token Validation** (middleware for HTTP Streamable)
   - JWT parsing + JWKS fetching
   - Middleware function
   - Username extraction + mapping
   - Unit tests
   - Documentation

3. **Principal Propagation** (combines #1 and #2)
   - CA key/cert loading
   - Ephemeral cert generation
   - Per-request HTTP client
   - `PrincipalPropagationDoer` wrapper
   - Unit tests
   - Documentation

4. **SAP Trial Setup** (manual, document steps)
   - Generate test CA
   - Import into STRUST
   - Configure CERTRULE
   - Test with curl

5. **Integration Tests** (after SAP setup)
   - End-to-end X.509
   - End-to-end principal propagation
