# AWS ABAP Accelerator for Amazon Q Developer

> **Repository**: https://github.com/aws-solutions-library-samples/guidance-for-deploying-sap-abap-accelerator-for-amazon-q-developer
> **Language**: Python 3.12 | **License**: MIT-0 | **Stars**: ~28
> **Status**: Active (last commit 2026-03-19)
> **Relationship**: AWS enterprise reference architecture for AI-assisted ABAP development

---

## Project Overview

An enterprise-grade MCP server enabling AI-powered ABAP development through Amazon Q Developer and Kiro. Built on FastMCP (Python) with FastAPI/Uvicorn for HTTP, aiohttp for async SAP ADT communication, and deep AWS service integration (Secrets Manager, SSM Parameter Store, IAM, CloudWatch, ECS Fargate).

Focused on SAP RAP stack objects (CLAS, DDLS, BDEF, SRVD, SRVB) with 15 tools.

## Architecture

```
Python 3.12 (async)
  ├── server/          -- FastMCP tool registration, OAuth, OIDC discovery
  ├── sap/             -- ADT client with sub-handlers per object type
  │   └── core/        -- Connection, object, source, activation managers
  ├── auth/            -- 5 SAP auth providers + principal propagation + RBAC
  ├── enterprise/      -- Enterprise context, middleware, usage tracker
  ├── utils/           -- Security sanitization, XML, logging, secret reader
  └── config/          -- Pydantic settings with env var binding
```

## Tool Inventory (15 tools)

| Tool | Description |
|------|-------------|
| `aws_abap_cb_connection_status` | Check SAP connection |
| `aws_abap_cb_get_objects` | Get objects from package |
| `aws_abap_cb_get_source` | Get source code by name + type |
| `aws_abap_cb_search_object` | Search objects (type/package filter) |
| `aws_abap_cb_create_object` | Create object (CLAS, DDLS, BDEF, SRVD, SRVB) |
| `aws_abap_cb_update_source` | Update source with auto lock/unlock |
| `aws_abap_cb_check_syntax` | Syntax check |
| `aws_abap_cb_activate_object` | Activate single object |
| `aws_abap_cb_activate_objects_batch` | Batch activate with circular dependency resolution |
| `aws_abap_cb_run_atc_check` | ATC quality checks (with summary mode) |
| `aws_abap_cb_run_unit_tests` | Unit tests (with optional coverage) |
| `aws_abap_cb_get_test_classes` | Get test class source |
| `aws_abap_cb_create_or_update_test_class` | Create/update test class |
| `aws_abap_cb_get_migration_analysis` | Custom code migration analysis |
| `aws_abap_cb_get_transport_requests` | Get transports for user |

## Authentication (Comprehensive)

### SAP-Side Auth (5 providers)
| Provider | Description |
|----------|-------------|
| Basic Auth | Username/password + CSRF |
| Certificate Auth | X.509 client certificates |
| Cookie-based | Browser/Playwright session cookies |
| Reentrance Ticket | Fallback for 401 responses |
| SAML SSO | SAML-based single sign-on |

### Credential Sources (5 modes)
ENV, KEYCHAIN (OS keyring), INTERACTIVE (prompt), INTERACTIVE_MULTI (multi-system YAML), AWS_SECRETS (Secrets Manager)

### MCP Endpoint Auth
OAuth 2.0/OIDC (AWS Cognito, Okta, Microsoft Entra ID), IAM Identity Center

### Principal Propagation
Ephemeral X.509 certificates (5-minute RSA 2048-bit, signed by CA in Secrets Manager). Certificate CN carries user identity for SAP CERTRULE mapping.

## Safety/Security

- **Input sanitization**: sanitize_for_logging, sanitize_for_xml, sanitize_file_path, sanitize_command_args, validate_object_name, validate_sap_host
- **defusedxml** for XXE prevention
- **In-memory Fernet encryption** for credentials
- **PBKDF2-SHA256** password hashing (100k iterations)
- **Sensitive data redaction** in all logs
- **Non-root container** execution
- **TLS 1.3** enforcement
- **No explicit read-only mode** -- relies on SAP authorization objects (S_DEVELOP, S_TRANSPRT)

## Transport (MCP Protocol)

| Transport | Supported |
|-----------|-----------|
| HTTP (FastAPI/Uvicorn, port 8000) | Yes |
| stdio | **No** |
| SSE | **No** |

## Testing

**No tests** in the repository. Dev dependencies (pytest, etc.) are commented out.

## Deployment

| Mode | Description |
|------|-------------|
| Local | Direct Python execution |
| Docker | python:3.12-slim, non-root, health check |
| ECS Fargate | ALB + VPC + IAM + CloudWatch + optional CloudFront/WAF |

## Known Issues

| Issue | Description | Relevant to ARC-1? |
|-------|-------------|-------------------|
| #1 | update_source reports failure when CDS update succeeds | Yes -- verify CDS update response handling |
| #4 | Self-signed cert errors in Docker on Windows/VPN | Yes -- document TLS troubleshooting |
| No read-only mode | No --read-only flag | ARC-1 already has this |
| No code navigation | No find-def, find-refs | ARC-1 already has this |
| RAP-focused types only | CLAS, DDLS, BDEF, SRVD, SRVB | ARC-1 supports more types |

---

## Features This Project Has That ARC-1 Lacks

| Feature | Priority | Effort | Place in ARC-1 or mcp-sap-docs? |
|---------|----------|--------|--------------------------------|
| Ephemeral X.509 certificates for PP | Medium | 3d | ARC-1 -- if deploying in AWS environments |
| AWS Secrets Manager credential source | Low | 2d | ARC-1 -- AWS-specific, low priority |
| Batch activation with dependency resolution | High | 2d | ARC-1 -- useful for RAP stacks |
| Unit tests with coverage data | Medium | 1d | ARC-1 -- extend SAPLint |
| Migration analysis tool | Medium | 1d | ARC-1 -- custom code migration |
| Usage tracker (per-user metrics) | Low | 2d | ARC-1 -- audit log already covers this |
| Multi-system support | Medium | 3d | ARC-1 -- multiple SAP connections |
| ResponseOptimizer (large result truncation) | Medium | 1d | ARC-1 -- smart result sizing |
| Enhanced class creation (interfaces, super, methods) | High | 2d | ARC-1 -- richer SAPWrite for classes |
| ATC summary mode (200+ findings) | Medium | 0.5d | ARC-1 -- extend SAPLint |

## Features ARC-1 Has That This Project Lacks

stdio transport, code intelligence (find def/refs/completion), free-form SQL, abaplint, caching, read-only mode, op filtering, package restrictions, intent-based routing, broader object type support (PROG, FUNC, INCL, TABL, etc.), npm/Docker distribution, 320+ tests.

---

## Changelog & Relevance Tracker

| Date | Change | Relevant? | Action for ARC-1 | Status |
|------|--------|-----------|-------------------|--------|
| 2026-03-19 | transport_request parameter additions | Yes | Review transport request patterns | TODO |
| 2026-03-10 | Batch activation improvements | Yes | Implement batch activate in ARC-1 | TODO |
| | | | | |

_Last updated: 2026-03-30_
