# lemaiwo/btp-sap-odata-to-mcp-server

> **Repository**: https://github.com/lemaiwo/btp-sap-odata-to-mcp-server
> **Language**: TypeScript | **License**: MIT | **Stars**: ~116
> **Status**: Moderate (last commit 2026-01-16, 12 open issues)
> **Relationship**: Complementary -- OData bridge, not ADT competitor

---

## Project Overview

A Node.js/TypeScript MCP server that dynamically discovers SAP OData services (V2 and V4) from a BTP-connected SAP system and exposes them as MCP tools for AI agents. **Not an ADT tool** -- it targets business data CRUD via OData, not ABAP development. Uses a unique 3-level progressive discovery pattern to avoid tool explosion.

Key architectural insight: Instead of coding tools per entity, it auto-generates tools from OData `$metadata` at startup.

## Architecture

```
TypeScript / Express / @modelcontextprotocol/sdk
  ├── OData Service Discovery (V2/V4 catalogs)
  ├── Metadata Parser ($metadata XML → entity schemas)
  ├── Progressive Tool Registration (3-level or flat)
  ├── BTP XSUAA OAuth 2.0 (role-based access)
  └── SAP Cloud SDK (connectivity, resilience)
```

### 3-Level Progressive Discovery (Default)
| Level | Tool | Purpose |
|-------|------|---------|
| 1 | `discover-sap-data` | Search across all services/entities (lightweight) |
| 2 | `get-entity-metadata` | Full schema for specific entity |
| 3 | `execute-sap-operation` | CRUD: read, read-single, create, update, delete |

### Flat Mode (Alternative)
5 tools per entity: `r-{ServiceId}-{Entity}`, `rs-{ServiceId}-{Entity}`, `c-{ServiceId}-{Entity}`, `u-{ServiceId}-{Entity}`, `d-{ServiceId}-{Entity}`

## Tool Inventory (3 tools in hierarchical mode)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `discover-sap-data` | query, category? | Search services/entities, multi-word fallback |
| `get-entity-metadata` | serviceId, entityName | Full entity schema with CRUD capabilities |
| `execute-sap-operation` | serviceId, entityName, operation, OData query options | CRUD with $filter, $select, $expand, $orderby, $top, $skip |

## Authentication

### BTP XSUAA OAuth 2.0
- Authorization Code flow with PKCE
- JWT validation via `@sap/xssec`
- Role-based: MCPViewer (read), MCPEditor (read+write), MCPAdmin (full)
- Token refresh, RFC 8414 discovery, RFC 7591 client registration
- OAuth redirect URIs for Claude.ai, localhost, Cursor IDE

### Dual Destination Model
- **Discovery destination**: Technical user for metadata (client credentials)
- **Execution destination**: JWT forwarding for user data (Principal Propagation)

### BTP Service Bindings
Destination Service (lite), Connectivity Service (lite), XSUAA (application)

## Safety/Security

- Helmet.js security headers
- CORS with configurable origins
- DNS rebinding protection
- Session management (24h expiry, secure UUID)
- Entity-level capability detection (respects sap:creatable/updatable/deletable annotations)
- `DISABLE_READ_ENTITY_TOOL` env var
- Service allowlisting/blocklisting via glob/regex patterns
- **No explicit read-only mode** -- relies on XSUAA scopes + SAP annotations

## Transport (MCP Protocol)

| Transport | Supported |
|-----------|-----------|
| HTTP Streamable | Yes (primary) |
| stdio | Yes |
| SSE | Partial (within sessions) |

MCP Protocol version: 2025-06-18 (latest spec)

## Testing

**No tests.** No test framework, no test directory, no test scripts.

## Deployment

BTP Cloud Foundry via MTA (mta.yaml). Requires Destination Service, Connectivity Service, XSUAA bindings.

## Dependencies

@modelcontextprotocol/sdk ^1.17.1, @sap-cloud-sdk/connectivity + http-client + odata-v2 + odata-v4 + resilience ^4.x, @sap/xsenv ^4.0.0, @sap/xssec ^3.6.1, @xmldom/xmldom + jsdom, express ^4.18, helmet ^7.0, axios ^1.12, zod ^3.22, winston ^3.8

## Known Issues

| Issue | Description | Relevant to ARC-1? |
|-------|-------------|-------------------|
| #17 | Composite key entities fail (update/read-single 404) | No -- ARC-1 uses ADT, not OData |
| #13 | Claude Desktop OAuth incompatibility | Yes -- track OAuth compatibility |
| #20 | OData V4 discovery incomplete | No |
| $select | Many SAP OData APIs don't support $select | No |
| No tests | Zero coverage | N/A |
| jsdom | Heavy XML parser | N/A |

---

## Relevance to ARC-1

This project is **complementary, not competitive**. It operates in a completely different space:

| Dimension | ARC-1 | btp-sap-odata-to-mcp |
|-----------|-------|---------------------|
| **Target API** | ADT (ABAP Development Tools) | OData V2/V4 services |
| **Target User** | ABAP developers | Business users / data consumers |
| **Use Case** | Code ABAP with AI | Query/modify business data with AI |
| **Object Types** | ABAP programs, classes, etc. | OData entities (BusinessPartner, SalesOrder, etc.) |

### What ARC-1 Can Learn

| Pattern | Priority | Notes |
|---------|----------|-------|
| 3-level progressive discovery | Medium | ARC-1's intent-based routing already solves this differently |
| Dual destination (discovery vs execution) | Medium | Useful pattern for PP -- technical user for metadata, user token for data |
| Service categorization | Low | Not applicable to ADT |
| Microsoft Copilot Studio compatibility | High | Review schema flattening, enum-to-string conversion |
| `@sap-cloud-sdk` for BTP connectivity | Medium | Evaluate vs ARC-1's custom BTP implementation |

### mcp-sap-docs Relevance

**None** -- this project is about runtime data access, not documentation.

---

## Changelog & Relevance Tracker

| Date | Change | Relevant? | Action | Status |
|------|--------|-----------|--------|--------|
| 2026-01-16 | Fix deploy path | No | -- | -- |
| 2025-11-04 | Copilot Studio support | Yes | Review Copilot Studio adjustments | TODO |
| 2025-11-02 | 3-level progressive discovery refactor | Low | Pattern reference only | -- |
| | | | | |

_Last updated: 2026-03-30_
