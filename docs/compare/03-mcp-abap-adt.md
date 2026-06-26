# mario-andreschak/mcp-abap-adt

> **Repository**: https://github.com/mario-andreschak/mcp-abap-adt
> **Language**: TypeScript | **License**: MIT | **Stars**: ~102
> **Status**: Dormant (last feature Feb 2025, URL encoding fix Sep 2025)
> **Relationship**: Minimal read-only ADT MCP server, predecessor to mcp-abap-abap-adt-api

---

## Project Overview

A minimal, read-only MCP server with 13 tools for retrieving ABAP source code and metadata. Each handler directly calls `makeAdtRequest()` with axios -- no abstraction layer, no `abap-adt-api` dependency. Positioned as a code exploration tool for Cline (VS Code AI assistant).

## Architecture

```
src/
  index.ts               # MCP server, tool registration
  handlers/handle*.ts    # 13 handler files (one per tool)
  lib/utils.ts           # Shared HTTP utility (makeAdtRequest)
```

Minimal single-file-per-tool design. Each handler constructs ADT URLs directly.

## Tool Inventory (13 tools -- all read-only)

| Tool | ADT Endpoint | Notes |
|------|-------------|-------|
| GetProgram | `/sap/bc/adt/programs/programs/{name}/source/main` | |
| GetClass | `/sap/bc/adt/oo/classes/{name}/source/main` | |
| GetFunction | `/sap/bc/adt/functions/groups/{group}/fmodules/{name}/source/main` | Requires function_group param |
| GetFunctionGroup | `/sap/bc/adt/functions/groups/{name}/source/main` | |
| GetInterface | `/sap/bc/adt/oo/interfaces/{name}/source/main` | |
| GetInclude | `/sap/bc/adt/programs/includes/{name}/source/main` | |
| GetTable | `/sap/bc/adt/ddic/tables/{name}/source/main` | |
| GetStructure | `/sap/bc/adt/ddic/structures/{name}/source/main` | |
| GetTypeInfo | `/sap/bc/adt/ddic/domains/{name}` → fallback `/ddic/dataelements/{name}` | Domain-first fallback |
| GetPackage | `/sap/bc/adt/repository/nodestructure` (POST) | XML body for package query |
| GetTableContents | `/z_mcp_abap_adt/z_tablecontent/{name}` | **Custom Z-service required!** |
| GetTransaction | `/sap/bc/adt/repository/informationsystem/objectproperties/values` | |
| SearchObject | `/sap/bc/adt/repository/informationsystem/search` | quickSearch operation |

## Authentication

| Method | Supported |
|--------|-----------|
| Basic Auth | Yes |
| CSRF token | Auto-fetch, auto-retry on 403 |
| TLS | Hardcoded `rejectUnauthorized: false` (not configurable!) |
| OIDC/OAuth/BTP | **No** |

## Safety/Security

**Read-only by nature** -- no write tools exist. No configurable safety system.

## Transport (MCP Protocol)

stdio only. No HTTP, no SSE.

## Testing

13 integration tests (one per tool). Requires live SAP system. No unit tests, no mocking.

## Dependencies

`@modelcontextprotocol/sdk` ^1.4.1, `axios` ^1.7.9, `dotenv` ^16.4.7, `xml-js` ^1.6.11 (unmaintained since 2018)

## Known Issues

| Issue | Description | Relevant to ARC-1? |
|-------|-------------|-------------------|
| #3 | Namespaced class names fail (e.g., /NAMESPACE/CLASS) | Yes -- verify namespace encoding in ARC-1 |
| #5 | No CLI arg support (env-only config) | ARC-1 has full CLI |
| Custom Z-service | GetTableContents requires deploying Z_MCP_ABAP_ADT | No -- ARC-1 uses standard datapreview |
| Hardcoded insecure TLS | Cannot enforce cert verification | ARC-1 has configurable --insecure |
| xml-js (2018) | Abandoned XML parser | ARC-1 uses fast-xml-parser v5 |

---

## Features This Project Has That ARC-1 Lacks

| Feature | Priority | Effort | Notes |
|---------|----------|--------|-------|
| GetTypeInfo (domain → data element fallback) | Medium | 0.5d | Pragmatic DDIC type resolution |
| GetStructure (DDIC structures) | Low | 0.5d | Add as SAPRead type |
| GetTransaction | Low | 0.5d | Transaction properties lookup |

## Features ARC-1 Has That This Project Lacks

Everything beyond read-only: write ops, activation, transport, code intelligence, linting, safety system, auth (OIDC, BTP, API key), HTTP transport, caching, audit logging, 320+ tests, npm/Docker distribution.

---

## Changelog & Relevance Tracker

| Date | Change | Relevant? | Action for ARC-1 | Status |
|------|--------|-----------|-------------------|--------|
| 2025-09-09 | URL encoding fix for parameters | Yes | Verify ARC-1 encodes all params | Done |
| 2025-02-19 | GetTransaction added | Maybe | Consider adding transaction lookup | TODO |
| | | | | |

_Last updated: 2026-03-30_
