# Enterprise Authentication Research for Go-based SAP ADT MCP Server

**Date:** 2026-03-25
**Report ID:** 001
**Subject:** X.509 mTLS, JWT/XSUAA, OIDC/Principal Propagation implementation patterns across SAP MCP server repositories
**Purpose:** Implementation reference for adding enterprise auth to vsp (Go binary)

---

## Table of Contents

1. [Repository Overview](#1-repository-overview)
2. [chandrashekhar-mahajan/abap-mcp-server — TypeScript Multi-Auth](#2-chandrashekhar-mahajanabap-mcp-server)
3. [AWS ABAP Accelerator — Principal Propagation with Ephemeral X.509](#3-aws-abap-accelerator)
4. [marcellourbani/abap-adt-api — Reference TypeScript Library](#4-marcellourbaniabap-adt-api)
5. [fr0ster/mcp-abap-adt — JWT/XSUAA + Service Keys](#5-fr0stermcp-abap-adt)
6. [mario-andreschak/mcp-abap-abap-adt-api — AuthBroker Pattern](#6-mario-andreschakmcp-abap-abap-adt-api)
7. [SAP-Side Configuration (STRUST, CERTRULE, ICM)](#7-sap-side-configuration)
8. [Go Implementation Patterns](#8-go-implementation-patterns)
9. [Implementation Recommendations for vsp](#9-implementation-recommendations-for-vsp)

---

## 1. Repository Overview

| Repository | Language | Auth Methods | Key Strength |
|-----------|----------|-------------|--------------|
| chandrashekhar-mahajan/abap-mcp-server | TypeScript | Basic, X.509, OAuth (PKCE), Kerberos/SPNEGO, Browser SSO | Clean strategy pattern, 5 auth methods |
| AWS ABAP Accelerator | Python | Principal Propagation (ephemeral X.509), OIDC/IAM Identity Center, Basic | Full ephemeral cert generation pipeline |
| marcellourbani/abap-adt-api | TypeScript | Basic, Bearer/OAuth (BearerFetcher callback) | Reference library, XSUAA test coverage |
| fr0ster/mcp-abap-adt | TypeScript | JWT/XSUAA (service keys), Basic, HTTP header auth | Production BTP auth with token mgmt |
| mario-andreschak/mcp-abap-abap-adt-api | TypeScript | AuthBroker pattern, JWT, Basic | Automatic token refresh, destination-based |

---

## 2. chandrashekhar-mahajan/abap-mcp-server

**Repo:** `github.com/chandrashekhar-mahajan/abap-mcp-server` (branch: `master`)
**Files:** `src/auth/{types.ts, index.ts, basic.ts, certificate.ts, oauth.ts, kerberos.ts, browser-sso.ts}`, `src/sap-client.ts`

### Architecture: Strategy Pattern

All auth methods implement a common `AuthStrategy` interface:

```typescript
interface AuthStrategy {
  name: string;
  isAuthenticated(): boolean;
  getAuthHeaders(): AuthHeaders;
  getHttpsAgent?(): https.Agent | undefined;  // For cert auth
  authenticate(): Promise<boolean>;
  refresh?(): Promise<boolean>;               // Optional token refresh
  getStatus(): AuthStatus;
}
```

The SAP client constructor picks the strategy and delegates:
- Auth headers injected per-request via `getAuthHeaders()`
- HTTPS agent from strategy used for mTLS (certificate auth)
- Automatic 401 retry with `refresh()` if available

### 2a. X.509 Certificate Auth (`certificate.ts`)

**Certificate Loading:**
- Reads PEM cert, PEM key, optional CA cert, optional passphrase from filesystem paths
- Creates `https.Agent` with `cert`, `key`, `ca`, `passphrase`, `rejectUnauthorized`
- Agent attached to all HTTPS requests via SAP client

**Config structure:**
```typescript
interface CertAuthConfig {
  certPath: string;       // Path to client certificate (PEM)
  keyPath: string;        // Path to private key (PEM)
  caPath?: string;        // Path to CA cert (for SAP's server cert)
  passphrase?: string;    // Private key passphrase
  skipSsl: boolean;
}
```

**Key detail:** No auth headers needed — the TLS handshake presents the certificate. SAP maps cert CN to SAP user via CERTRULE.

### 2b. OAuth 2.0 (`oauth.ts`)

**Flow:** Authorization Code + PKCE (browser-based)
- SAP endpoints: `/sap/bc/sec/oauth2/authorize`, `/sap/bc/sec/oauth2/token`
- PKCE: SHA-256 code_challenge from random code_verifier
- Targets SAP's AS ABAP OAuth provider directly (NOT XSUAA)
- Token refresh via `refresh_token` grant type to same token endpoint
- Bearer token sent as `Authorization: Bearer <token>`

### 2c. Kerberos/SPNEGO (`kerberos.ts`)

**Flow:**
1. Lazy-loads `kerberos` npm package (native module)
2. Constructs SPN: `HTTP/hostname@REALM`
3. `initializeClient()` with SPNEGO mechanism OID
4. Gets token via `client.step('')`
5. Sends `Authorization: Negotiate <token>` to SAP
6. Captures `MYSAPSSO2` session cookie
7. Subsequent requests use session cookies (not repeated SPNEGO)

### 2d. Browser SSO (`browser-sso.ts`)

**Flow:**
1. User opens SAP URL in browser, SAML/Kerberos SSO triggers
2. Bookmarklet extracts cookies (`MYSAPSSO2`, `SAP_SESSIONID_*`)
3. Cookies POSTed back to MCP server
4. MCP server stores cookies, uses for ADT API calls
5. Session validated via `/sap/bc/adt/discovery` endpoint
6. 30-min session timeout (cookies), 8-hour SSO ticket timeout

---

## 3. AWS ABAP Accelerator

**Repo:** `github.com/aws-solutions-library-samples/guidance-for-deploying-sap-abap-accelerator-for-amazon-q-developer`
**Files:** `src/aws_abap_accelerator/auth/{principal_propagation.py, providers/certificate_auth_provider.py, providers/certificate_auth.py, iam_identity_validator.py, session_manager.py, types.py, principal_propagation_middleware.py}`, `src/aws_abap_accelerator/server/oidc_discovery.py`

### 3a. Ephemeral X.509 Certificate Generation

**File:** `providers/certificate_auth_provider.py`

**RSA Key Generation:**
- RSA-2048 key pair generated per-request
- Private key exported as unencrypted PKCS8 PEM
- Random serial number per certificate

**Certificate Template:**
```
Subject: CN=<username>, OU=Principal-Propagation, O=ABAP-Accelerator, C=US
Validity: 5 minutes (with 1-minute clock skew buffer, so NotBefore = now - 1min)
Extensions:
  - Basic Constraints: critical, CA=false
  - Key Usage: digital signature + key encipherment
  - Extended Key Usage: client authentication
Signing: SHA-256 with CA private key
```

**CA Key Management:**
- CA certificate and private key stored in AWS Secrets Manager
- Loaded lazily via boto3 client
- CA subject tracked for audit logging

**Go equivalent pattern:**
```go
// Generate ephemeral cert in Go
key, _ := rsa.GenerateKey(rand.Reader, 2048)
template := &x509.Certificate{
    SerialNumber: big.NewInt(randomSerial),
    Subject: pkix.Name{
        CommonName:         username,
        OrganizationalUnit: []string{"Principal-Propagation"},
        Organization:       []string{"ABAP-Accelerator"},
        Country:            []string{"US"},
    },
    NotBefore:             time.Now().Add(-1 * time.Minute),
    NotAfter:              time.Now().Add(5 * time.Minute),
    KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
    ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
    BasicConstraintsValid: true,
    IsCA:                  false,
}
certDER, _ := x509.CreateCertificate(rand.Reader, template, caCert, &key.PublicKey, caKey)
```

### 3b. OIDC Token Validation (`iam_identity_validator.py`)

**Token Sources (priority order):**
1. JWT in `Authorization` header
2. OIDC identity in `x-amzn-oidc-identity` header
3. Development fallback via `x-user-id` header

**JWT Validation Process:**
1. Extract unverified header to get `kid` (key ID)
2. Fetch signing key from JWKS endpoint (`_get_signing_key()`)
3. Validate signature (RS256 or ES256)
4. Verify issuer and audience claims
5. Return None if JWKS URL not configured (security: fails closed)

**JWKS Management:**
- JWKS responses cached for 1 hour
- JWK-to-PEM conversion using `cryptography` library
- Handles RSA components (modulus `n`, exponent `e`)

**Login Identifier Extraction (claim priority):**
1. `login` (Okta-specific)
2. `upn` (Entra/Azure AD)
3. `preferred_username` (standard OIDC)
4. `unique_name` (Entra fallback)
5. `email` (common fallback)
6. `sub` (last resort)

**Environment Variables:**
```
IAM_IDENTITY_CENTER_JWKS_URL
IAM_IDENTITY_CENTER_ISSUER
IAM_IDENTITY_CENTER_AUDIENCE
```

### 3c. Principal Propagation Middleware

**Request Flow:**
1. Extract IAM identity from HTTP headers
2. Validate identity via `iam_identity_validator`
3. Retrieve SAP system configuration
4. Call `principal_propagation_service.get_sap_credentials_for_request()`
5. Generate ephemeral X.509 cert with login_identifier as CN
6. Return credential bundle: `{cert_pem, key_pem, sap_host, sap_port, sap_client}`
7. Create SAP HTTP client with cert as mTLS credentials

**Key Design Decision:** Pass-through CN approach. The login identifier goes directly into the certificate CN (truncated to 64 chars). SAP's CERTRULE handles the identity-to-user mapping, avoiding dual mapping logic.

### 3d. Session Management

- 4 auth providers: Basic, SAML SSO, Certificate, Reentrance Ticket
- Sessions stored as `Dict[mcp_session_id, Dict[session_name, UserAuthSession]]`
- Sessions store SAP tokens, NOT raw credentials
- 9-hour default session duration
- Periodic cleanup every 30 minutes
- Expired sessions cleaned asynchronously via `asyncio.create_task()`

### 3e. SAP Connection (`sap/core/connection.py`)

- SSL context: `ssl.create_default_context()` with custom CA support
- Custom CA via `CUSTOM_CA_CERT_PATH` or `SSL_CERT_FILE` env vars
- `ssl.CERT_REQUIRED` + `check_hostname = True` for production
- `SSL_VERIFY` env var to disable verification (dev only)
- Port calculation: HTTPS = 44300 + instance_number, HTTP = 8000 + instance_number
- 60-second timeout, TCP keepalive at 30 seconds

---

## 4. marcellourbani/abap-adt-api

**Repo:** `github.com/marcellourbani/abap-adt-api` (branch: `master`)
**Files:** `src/AdtHTTP.ts`, `src/AdtClient.ts`, `src/AxiosHttpClient.ts`, `src/test/cloudFoundry.test.ts`

### 4a. HTTP Client Architecture

**AdtHTTP** supports two auth modes:
1. **Basic Auth:** Username + password stored in `this.auth`
2. **Bearer Token:** `BearerFetcher` callback function for dynamic token retrieval

**Constructor signature:**
```typescript
constructor(
  baseUrlOrClient: string | HttpClient,
  username: string,
  password: string | BearerFetcher,  // string = basic, function = bearer
  client: string = "",
  language: string = "",
  options: ClientOptions = {}        // includes httpsAgent
)
```

**Bearer token caching:** `wrapFetcher` caches the Promise, so the token is fetched once and reused:
```typescript
private wrapFetcher = fetcher => {
  let fetchBearer: Promise<string>
  if (this.fetcher) return this.fetcher
  this.fetcher = () => {
    fetchBearer = fetchBearer || fetcher()
    return fetchBearer
  }
  return this.fetcher
}
```

**SSL Configuration helper:**
```typescript
function createSSLConfig(allowUnauthorized: boolean, ca?: string): ClientOptions {
  const httpsAgent = new https.Agent({
    keepAlive: true,
    ca,
    rejectUnauthorized: !allowUnauthorized
  })
  return { httpsAgent }
}
```

**Session types:** `stateful`, `stateless`, `keep` (adaptive)
**Keepalive:** 120-second periodic ping when enabled

### 4b. XSUAA / Cloud Foundry Test (`cloudFoundry.test.ts`)

**Library used:** `client-oauth2` npm package

**Token acquisition flow:**
```typescript
const fetchToken = async () => {
  oldToken = oldToken || (
    await new ClientOAuth2({
      authorizationUri: `${uaaUrl}/oauth/authorize`,
      accessTokenUri: `${uaaUrl}/oauth/token`,
      redirectUri: "http://localhost/notfound",
      clientId,
      clientSecret
    })
    .createToken(accessToken, refreshToken, tokenType, {})
    .refresh()
    .then(t => t.accessToken)
  )
  return oldToken
}
```

**XSUAA endpoints called:**
- `{uaaUrl}/oauth/authorize` — authorization endpoint
- `{uaaUrl}/oauth/token` — token endpoint (refresh flow)

**ADT Client with bearer:**
```typescript
const client = new ADTClient(url, user, fetchToken)  // fetchToken as BearerFetcher
```

The `fetchToken` function is lazy — creates token once from stored refresh token, caches it for session duration.

---

## 5. fr0ster/mcp-abap-adt

**Repo:** `github.com/fr0ster/mcp-abap-adt` (branch: `main`)
**Key docs:** `docs/user-guide/AUTHENTICATION.md`, `docs/installation/examples/SERVICE_KEY_SETUP.md`

### 5a. Authentication Methods

**1. Service Key / Destination (recommended for BTP):**
- Service key JSON files stored in `~/.config/mcp-abap-adt/service-keys/`
- Filename = destination identifier (case-sensitive)
- Server launched with `--auth-broker` flag
- On first request: reads service key, initiates OAuth2 via browser
- Tokens cached in `~/.config/mcp-abap-adt/sessions/[DESTINATION].env`

**2. Environment file (.env):**
```env
SAP_URL=https://your-abap-system.com
SAP_CLIENT=100
SAP_AUTH_TYPE=xsuaa          # or 'basic'
SAP_JWT_TOKEN=your_jwt_token
# SAP_USERNAME=... SAP_PASSWORD=...  (for basic)
SAP_SYSTEM_TYPE=cloud        # or 'onprem'
TLS_REJECT_UNAUTHORIZED=0    # for self-signed certs
```

**3. HTTP header-based (for HTTP/SSE transport):**
- JWT: `x-sap-url`, `x-sap-client`, `x-sap-auth-type=jwt`, `x-sap-jwt-token`
- Basic: `x-sap-url`, `x-sap-client`, `x-sap-login`, `x-sap-password`

### 5b. Token Management

- AuthBroker pattern manages token lifecycle
- `authBroker.getToken(destination)` returns JWT
- Populates env vars: `SAP_URL`, `SAP_JWT_TOKEN`, `SAP_REFRESH_TOKEN`, `SAP_UAA_URL`, `SAP_UAA_CLIENT_ID`, `SAP_UAA_CLIENT_SECRET`
- Automatic token refresh via provider

---

## 6. mario-andreschak/mcp-abap-abap-adt-api

**Repo:** `github.com/mario-andreschak/mcp-abap-abap-adt-api` (branch: `main`)
**Files:** `src/handlers/AuthHandlers.ts`, `src/handlers/BaseHandler.ts`

### Architecture

- Wraps `marcellourbani/abap-adt-api` as dependency
- `AuthHandlers` exposes `login`, `logout`, `dropSession` as MCP tools
- Delegates to `ADTClient.login()` / `ADTClient.logout()`
- Rate limiting: 1-second between requests per IP
- Performance metrics via `perf_hooks`

The actual auth complexity lives in the `abap-adt-api` dependency (see section 4).

---

## 7. SAP-Side Configuration

### 7a. Profile Parameters

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `icm/HTTPS/verify_client` | `1` (accept) or `2` (require) | Enable client certificate requests |
| `login/certificate_mapping_rulebased` | `1` (default) | Enable CERTRULE |
| `icm/HTTPS/client_sni_enabled` | `True` | Enable SNI |
| `ssl/ciphersuites` | (varies) | TLS cipher configuration |

Set via transaction **RZ10** (profile maintenance) or **RZ11** (dynamic parameter change).

### 7b. STRUST Configuration

1. Open transaction **STRUST** (Trust Manager)
2. Double-click **SSL server Standard** PSE
3. Switch to Edit mode
4. Import the **CA root certificate** (not the client cert) into the certificate list
5. For Cloud Connector: import the system certificate from the Cloud Connector
6. Save

**For principal propagation with custom CA:**
- Import your CA certificate into STRUST SSL server Standard
- SAP will trust any client cert signed by this CA

### 7c. CERTRULE Configuration

1. Open transaction **CERTRULE** (Rule-based Certificate Mapping)
2. Switch to Display/Change mode
3. Click "Upload certificate" — import a **sample certificate** (not the CA cert)
4. Click "Rule" to create a mapping rule:
   - **Certificate Entry:** `Subject`
   - **Certificate Attr:** `CN` (Common Name)
   - **Login As:** `ID` (SAP user ID) or `E-Mail`
5. Save

**Example rule for principal propagation:**
- Certificate Subject CN=`john.doe@company.com`
- Maps to SAP user `JOHNDOE` (or email lookup)

**Wildcard approach (AWS pattern):**
- Upload sample cert from your CA
- Create rule: Subject CN -> Login As ID
- Any cert signed by that CA with CN=<username> maps to SAP user <username>

### 7d. ICF Service Activation

- Ensure `/sap/bc/adt/*` services are active (transaction **SICF**)
- For OAuth: activate `/sap/bc/sec/oauth2/*` services
- For certificate auth: no additional ICF activation needed (handled at transport layer)

### 7e. Trusted Reverse Proxy (for Cloud Connector)

Profile parameters for accepting forwarded certificates:
```
icm/trusted_reverse_proxy_<n> = SUBJECT="CN=cloudconnector.company.com, O=SAP, C=DE", ISSUER="CN=cloudconnector.company.com, O=SAP, C=DE"
```

---

## 8. Go Implementation Patterns

### 8a. X.509 mTLS Client in Go

```go
import (
    "crypto/tls"
    "crypto/x509"
    "net/http"
    "os"
)

func createMTLSClient(certFile, keyFile, caFile string, insecure bool) (*http.Client, error) {
    // Load client certificate + private key
    cert, err := tls.LoadX509KeyPair(certFile, keyFile)
    if err != nil {
        return nil, fmt.Errorf("load client cert: %w", err)
    }

    tlsConfig := &tls.Config{
        Certificates: []tls.Certificate{cert},
    }

    // Load CA certificate for server verification
    if caFile != "" {
        caCert, err := os.ReadFile(caFile)
        if err != nil {
            return nil, fmt.Errorf("read CA cert: %w", err)
        }
        caCertPool := x509.NewCertPool()
        caCertPool.AppendCertsFromPEM(caCert)
        tlsConfig.RootCAs = caCertPool
    }

    if insecure {
        tlsConfig.InsecureSkipVerify = true
    }

    return &http.Client{
        Transport: &http.Transport{
            TLSClientConfig: tlsConfig,
        },
    }, nil
}
```

### 8b. Ephemeral Certificate Generation in Go

```go
import (
    "crypto/rand"
    "crypto/rsa"
    "crypto/x509"
    "crypto/x509/pkix"
    "encoding/pem"
    "math/big"
    "time"
)

func generateEphemeralCert(username string, caCert *x509.Certificate, caKey *rsa.PrivateKey) (certPEM, keyPEM []byte, err error) {
    // Generate RSA-2048 key pair
    key, err := rsa.GenerateKey(rand.Reader, 2048)
    if err != nil {
        return nil, nil, err
    }

    // Random serial number
    serialNumber, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))

    template := &x509.Certificate{
        SerialNumber: serialNumber,
        Subject: pkix.Name{
            CommonName:         username, // Maps to SAP user via CERTRULE
            OrganizationalUnit: []string{"Principal-Propagation"},
            Organization:       []string{"VSP-MCP-Server"},
            Country:            []string{"US"},
        },
        NotBefore:             time.Now().Add(-1 * time.Minute), // Clock skew buffer
        NotAfter:              time.Now().Add(5 * time.Minute),  // 5-minute validity
        KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
        ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
        BasicConstraintsValid: true,
        IsCA:                  false,
    }

    // Sign with CA
    certDER, err := x509.CreateCertificate(rand.Reader, template, caCert, &key.PublicKey, caKey)
    if err != nil {
        return nil, nil, err
    }

    // Encode to PEM
    certPEM = pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certDER})
    keyPEM = pem.EncodeToMemory(&pem.Block{
        Type:  "RSA PRIVATE KEY",
        Bytes: x509.MarshalPKCS1PrivateKey(key),
    })

    return certPEM, keyPEM, nil
}
```

### 8c. OIDC Token Validation in Go (using coreos/go-oidc)

```go
import (
    "context"
    "github.com/coreos/go-oidc/v3/oidc"
    "golang.org/x/oauth2"
)

func validateOIDCToken(ctx context.Context, rawToken, issuerURL, clientID string) (*oidc.IDToken, error) {
    // For Azure AD/Entra ID, use InsecureIssuerURLContext for issuer mismatch:
    // ctx = oidc.InsecureIssuerURLContext(ctx, issuerURL)

    provider, err := oidc.NewProvider(ctx, issuerURL)
    if err != nil {
        return nil, fmt.Errorf("create OIDC provider: %w", err)
    }

    verifier := provider.Verifier(&oidc.Config{
        ClientID: clientID,
    })

    token, err := verifier.Verify(ctx, rawToken)
    if err != nil {
        return nil, fmt.Errorf("verify token: %w", err)
    }

    return token, nil
}

// Extract username from claims (priority order from AWS accelerator)
func extractUsername(token *oidc.IDToken) (string, error) {
    var claims struct {
        Login             string `json:"login"`
        UPN               string `json:"upn"`
        PreferredUsername  string `json:"preferred_username"`
        UniqueName        string `json:"unique_name"`
        Email             string `json:"email"`
        Sub               string `json:"sub"`
    }
    if err := token.Claims(&claims); err != nil {
        return "", err
    }
    for _, v := range []string{claims.Login, claims.UPN, claims.PreferredUsername, claims.UniqueName, claims.Email, claims.Sub} {
        if v != "" { return v, nil }
    }
    return "", fmt.Errorf("no username claim found")
}
```

### 8d. XSUAA Token Acquisition in Go

```go
import "golang.org/x/oauth2/clientcredentials"

func getXSUAAToken(ctx context.Context, uaaURL, clientID, clientSecret string) (string, error) {
    config := &clientcredentials.Config{
        ClientID:     clientID,
        ClientSecret: clientSecret,
        TokenURL:     uaaURL + "/oauth/token",
    }
    token, err := config.Token(ctx)
    if err != nil {
        return "", err
    }
    return token.AccessToken, nil
}

// For authorization code flow with refresh:
func refreshXSUAAToken(ctx context.Context, uaaURL, clientID, clientSecret, refreshToken string) (string, error) {
    config := &oauth2.Config{
        ClientID:     clientID,
        ClientSecret: clientSecret,
        Endpoint: oauth2.Endpoint{
            TokenURL: uaaURL + "/oauth/token",
        },
    }
    token := &oauth2.Token{RefreshToken: refreshToken}
    newToken, err := config.TokenSource(ctx, token).Token()
    if err != nil {
        return "", err
    }
    return newToken.AccessToken, nil
}
```

---

## 9. Implementation Recommendations for vsp

### 9a. Proposed Auth Strategy Interface (Go)

```go
type AuthMethod interface {
    Name() string
    Authenticate(ctx context.Context) error
    IsAuthenticated() bool
    // Apply auth to an HTTP request
    ApplyAuth(req *http.Request) error
    // Return custom TLS config (for mTLS)
    TLSConfig() *tls.Config
    // Optional: refresh expired credentials
    Refresh(ctx context.Context) error
}
```

### 9b. Proposed CLI Flags

```
--auth-method        Auth method: basic (default), certificate, oauth, oidc, xsuaa
--cert-file          Path to client certificate PEM (for certificate auth)
--key-file           Path to client private key PEM (for certificate auth)
--ca-file            Path to CA certificate PEM (for server verification)
--key-passphrase     Private key passphrase
--oauth-client-id    OAuth client ID
--oauth-client-secret OAuth client secret
--uaa-url            XSUAA token URL (for xsuaa/oauth auth)
--oidc-issuer        OIDC issuer URL (for oidc/principal propagation)
--oidc-audience      OIDC audience (for token validation)
--ca-cert-file       CA certificate for signing ephemeral certs (principal propagation)
--ca-key-file        CA private key for signing ephemeral certs (principal propagation)
```

### 9c. Priority Order for Implementation

1. **X.509 mTLS** (simplest Go implementation, uses stdlib only)
   - Load cert/key from PEM files
   - Configure `tls.Config` with `Certificates` and `RootCAs`
   - No additional headers needed — TLS handshake handles auth

2. **JWT/XSUAA Bearer Token** (common for BTP)
   - Accept pre-obtained JWT via env var or flag
   - Add `Authorization: Bearer <token>` header
   - Use `golang.org/x/oauth2` for token refresh
   - Use `client-credentials` or `authorization-code` grant

3. **OIDC + Principal Propagation** (enterprise, complex)
   - Validate OIDC token with `coreos/go-oidc`
   - Extract username from claims
   - Generate ephemeral X.509 cert with `crypto/x509`
   - Use ephemeral cert for mTLS to SAP
   - Requires CA key management

### 9d. Go Dependencies Needed

| Package | Purpose |
|---------|---------|
| `crypto/tls` (stdlib) | mTLS client configuration |
| `crypto/x509` (stdlib) | Certificate parsing, generation |
| `crypto/rsa` (stdlib) | RSA key generation for ephemeral certs |
| `encoding/pem` (stdlib) | PEM encoding/decoding |
| `golang.org/x/oauth2` | OAuth2 token management, refresh |
| `golang.org/x/oauth2/clientcredentials` | Client credentials grant (XSUAA) |
| `github.com/coreos/go-oidc/v3` | OIDC provider discovery, JWKS validation |

### 9e. SAP Setup Checklist

For X.509 mTLS:
- [ ] Generate CA cert + key (or use existing enterprise CA)
- [ ] Import CA cert into SAP STRUST (SSL server Standard PSE)
- [ ] Set `icm/HTTPS/verify_client = 1` (via RZ10)
- [ ] Restart ICM (SMICM)
- [ ] Set `login/certificate_mapping_rulebased = 1` (verify via RZ11)
- [ ] Configure CERTRULE rules: Subject CN -> SAP User ID
- [ ] Test with sample cert

For XSUAA/BTP:
- [ ] Create XSUAA service instance in BTP
- [ ] Create service key with OAuth2 credentials
- [ ] Note: clientId, clientSecret, uaaUrl from service key JSON
- [ ] Token endpoint: `{uaaUrl}/oauth/token`

---

## Sources

### Repositories
- [chandrashekhar-mahajan/abap-mcp-server](https://github.com/chandrashekhar-mahajan/abap-mcp-server) — Multi-auth TypeScript MCP server
- [AWS ABAP Accelerator](https://github.com/aws-solutions-library-samples/guidance-for-deploying-sap-abap-accelerator-for-amazon-q-developer) — Principal propagation with ephemeral certs
- [marcellourbani/abap-adt-api](https://github.com/marcellourbani/abap-adt-api) — Reference TypeScript ADT library
- [fr0ster/mcp-abap-adt](https://github.com/fr0ster/mcp-abap-adt) — JWT/XSUAA MCP server
- [mario-andreschak/mcp-abap-abap-adt-api](https://github.com/mario-andreschak/mcp-abap-abap-adt-api) — ADT wrapper MCP server
- [aws-samples/aws-certificate-authorization-for-sap](https://github.com/aws-samples/aws-certificate-authorization-for-sap) — Lambda-based cert generation (archived)

### SAP Documentation
- [SAP: Configuring AS ABAP for X.509 Client Certificates](https://help.sap.com/doc/saphelp_nw75/7.5.5/en-US/4e/1260981e3d2287e10000000a15822b/content.htm)
- [SAP: Using X.509 Client Certificates on AS ABAP](https://help.sap.com/doc/saphelp_nw75/7.5.5/en-US/4e/125e0a1e3d2287e10000000a15822b/content.htm)
- [SAP Archive: Principal Propagation Exercises](https://github.com/SAP-archive/cloud-platform-connectivity-principal-propagation/blob/master/exercises/B2/README.md)
- [Setting up Principal Propagation (SAP Community)](https://blogs.sap.com/2021/09/06/setting-up-principal-propagation/)
- [X.509 ICM Configuration](https://www.itsfullofstars.de/2020/07/x509-based-logon-1-configure-icm-to-accept-client-certificates/)
- [SAP Gateway Client Certificate Auth](https://blogs.sap.com/2015/07/04/configuring-client-certificate-authentication-mutual-https-on-sap-gateway/)

### Go Resources
- [coreos/go-oidc v3](https://pkg.go.dev/github.com/coreos/go-oidc/v3/oidc) — OIDC client library
- [go-oidc Azure AD issue](https://github.com/coreos/go-oidc/issues/344) — Azure/Entra ID handling
- [Go mTLS Guide](https://venilnoronha.io/a-step-by-step-guide-to-mtls-in-go)
- [Go mTLS with Self-Signed Certs](https://www.bastionxp.com/blog/golang-mtls-client-self-signed-ssl-tls-x509-certificate/)
- [Go crypto/x509 package](https://pkg.go.dev/crypto/x509) — Certificate generation
- [Go generate_cert.go reference](https://go.dev/src/crypto/tls/generate_cert.go) — stdlib cert generation example
