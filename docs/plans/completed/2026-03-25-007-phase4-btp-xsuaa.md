# Phase 4: BTP Deployment with XSUAA

**Date:** 2026-03-25
**Report ID:** 007
**Subject:** BTP Cloud Foundry deployment with XSUAA OAuth and Destination Service
**Related Documents:** 2026-03-25-003-centralized-mcp-auth-architecture.md

---

## Goal

Deploy vsp on SAP BTP Cloud Foundry. XSUAA handles MCP client auth. BTP Destination Service handles SAP backend auth via Cloud Connector.

```
IDE/Copilot ──[XSUAA OAuth]──► vsp on BTP CF ──[Destination Service + Cloud Connector]──► SAP on-prem
```

## Reference Implementation

Wouter's `lemaiwo/btp-sap-odata-to-mcp-server`:
- TypeScript, uses `@sap/xssec` for JWT validation
- Proxies OAuth endpoints to XSUAA
- Uses BTP Destination Service for SAP connectivity
- Per-session MCPServer with user JWT context

## What To Implement

### 1. XSUAA JWT Validation (Go)

No official SAP Go SDK for xssec. Options:
- **Use Phase 2 OIDC validator** — XSUAA exposes standard OIDC endpoints
  - Issuer: `https://<subdomain>.authentication.<landscape>.hana.ondemand.com`
  - JWKS: standard `.well-known/openid-configuration`
  - This should work without xssec-specific code
- **Parse VCAP_SERVICES** to extract XSUAA binding credentials

### 2. BTP Destination Service API (Go)

REST API to look up destinations:
```
GET /destination-configuration/v1/destinations/{name}
Authorization: Bearer <xsuaa-token>
```

Returns connection details + auth tokens for the SAP backend.

### 3. Cloud Connector Integration

Not vsp's concern directly — Cloud Connector is configured separately by SAP admins. vsp uses the Destination Service URL which routes through CC transparently.

### 4. MTA Deployment Descriptor

```yaml
_schema-version: "3.1"
ID: vsp-mcp-server
version: 1.0.0
modules:
  - name: vsp
    type: custom
    path: .
    parameters:
      buildpack: binary_buildpack  # Go binary
      memory: 256M
      command: ./vsp --transport http-streamable --http-addr 0.0.0.0:$PORT
    requires:
      - name: xsuaa-service
      - name: destination-service
      - name: connectivity-service
resources:
  - name: xsuaa-service
    type: org.cloudfoundry.managed-service
    parameters:
      service: xsuaa
      service-plan: application
      path: xs-security.json
  - name: destination-service
    type: org.cloudfoundry.managed-service
    parameters:
      service: destination
      service-plan: lite
  - name: connectivity-service
    type: org.cloudfoundry.managed-service
    parameters:
      service: connectivity
      service-plan: lite
```

### 5. xs-security.json

```json
{
  "xsappname": "vsp-mcp-server",
  "tenant-mode": "dedicated",
  "scopes": [
    {"name": "$XSAPPNAME.read", "description": "Read SAP objects"},
    {"name": "$XSAPPNAME.write", "description": "Write SAP objects"}
  ],
  "role-templates": [
    {"name": "Viewer", "scope-references": ["$XSAPPNAME.read"]},
    {"name": "Developer", "scope-references": ["$XSAPPNAME.read", "$XSAPPNAME.write"]}
  ]
}
```

## Effort

~2 weeks (significant, requires BTP account + testing)

## Dependencies

- BTP subaccount with XSUAA, Destination, Connectivity services
- Cloud Connector configured for SAP on-prem
- Go binary cross-compiled for Linux (CF buildpack)

## Risk Assessment

- No official SAP Go SDK — must implement Destination API client from scratch
- VCAP_SERVICES parsing for Go
- BTP-specific, not portable to non-BTP environments
- Consider: is Phase 2+3 (OIDC + PP) sufficient without BTP?

## Recommendation

**Defer Phase 4** unless customers specifically require BTP deployment. Phases 1-3 cover all non-BTP scenarios. Phase 2's OIDC validation works with XSUAA tokens (same OIDC standard), so partial BTP compatibility exists without Phase 4.
