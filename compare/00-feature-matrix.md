# Cross-Project Feature Matrix

A comprehensive comparison of all SAP ADT/MCP projects against ARC-1.

_Last updated: 2026-05-08 — issue #218 audit + SEC-11 dependency security Tier 1._
_Plan A (PR #223): purged five invented `SLASH_TYPE_MAP` entries `FUNC/FM`, `CLAS/LI`, `VIEW/V`, `TRAN/O`; repointed `FUGR/FF → FUNC` (was `→ FUGR`); added real `VIEW/DV → VIEW`, `TRAN/T → TRAN`, `objectBasePath('VIEW')` VIT URL, citation guard `SLASH_TYPE_EVIDENCE`, exhaustiveness guard `KNOWN_BASE_TYPES`, slash-form throw + `objectBasePath('FUNC')` group-context throw. DDIC view reads were silently broken via fallthrough to `/programs/programs/`._
_Plan B (PR #224): `MSAG` added to `SAPREAD_TYPES_*` (was previously write-only / read-via-`MESSAGES` asymmetry); `FTG2` renamed to `FEATURE_TOGGLE` (ARC-1-invented short identifier per research/abap-types/types/ftg2.md). Both old aliases (`MESSAGES`, `FTG2`) accepted for one minor with stderr deprecation warning._
_Both verified live against a4h S/4HANA 2023 + npl NW 7.50 SP02 — both systems return identical `<adtcore:type>` values._

_Previously: 2026-04-28. Since 2026-04-23: PR #186 (in flight) adds **ETag-backed source cache revalidation**, **active/inactive SAPRead source versions** with `version='active|inactive|auto'`, rich `<ioc:object>` inactive-object parsing, and per-username inactive-list session cache — verified live on a4h (S/4HANA 2023) AND NPL (NW 7.50 SP02). Competitor scan (2026-04-27): **fr0ster v6.5.0/v6.5.1** (2026-04-24) hardening FM read against group-mismatch silent success (`<adtcore:containerRef adtcore:type='FUGR/F'/>` metadata validation, commit `795633a`) plus pluggable ReadOnly-vs-HighLevel dedup strategy (`1246cc2`), and **open issue #77** (2026-04-25) reporting `UpdateFunctionModule` loses parameters — see [`fr0ster/evaluations/issue-77-fm-update-parameter-loss.md`](fr0ster/evaluations/issue-77-fm-update-parameter-loss.md). ARC-1 has a **latent FUNC-update gap** — `objectBasePath('FUNC')` returns the group path instead of the `fmodules` endpoint, and `safeUpdateSource()` doesn't accept `group` — plus the same parameter-loss bug class would apply once URL is fixed. Recommend either removing `'FUNC'` from `SAPWRITE_TYPES_ONPREM` until upstream fix lands or implementing properly with metadata preservation. Same FM read-side issue in `getFunction(group, name)` — see [`fr0ster/evaluations/795633a-fm-group-validation.md`](fr0ster/evaluations/795633a-fm-group-validation.md) for hardening sketch. **abap-adt-api v8.1.0–v8.3.0** (2026-04-21 to 2026-04-26) added ENHO splicing/include expansion (`d8c4390`) — useful gap for "what enhancements affect this PROG/INCL/FUGR" reverse lookup, candidate for new `SAPRead(type='ENHO', target=...)` variant — plus structured DOMA/DTEL readers (ARC-1 already has these) and a textelements API (ARC-1 has read-only). **VSP issue #124** (2026-04-24) raises **SAP API Policy v.4.2026** as a strategic risk for every ADT-based MCP tool — productive-use of `/sap/bc/adt/*` may be off-limits unless SAP re-classifies the surface; tracked as project narrative, not code, in [`vibing-steampunk/evaluations/issue-124-sap-api-policy-v42026.md`](vibing-steampunk/evaluations/issue-124-sap-api-policy-v42026.md). Wins for ARC-1 confirmed by competitors hitting bugs we don't have: VSP issue #109 (DOMA/DTEL create), VSP issue #116 (INCL write), fr0ster issue #68 (PROG CRUD). Retains: FEAT-22 SAPGit; DOC-04 RAP/common-use-case skill refresh; SEC-09 Auth Safety; FEAT-20 VERSIONS/VERSION_SOURCE; FEAT-10 PrettyPrint; FEAT-49 object→transport reverse lookup; FEAT-33 CDS impact; FEAT-43 AUTH/FEATURE_TOGGLE/ENHO (renamed in audit Plan B); PR #134 SKTD; COMPAT-01/02/03 all fixed._

_2026-04-27 carry-over from 2026-04-23 update: PR #174 (2026-04-21) landed `SAPDiagnose` hardening with `system_messages` (SM02) + `gateway_errors` (/IWFND/ERROR_LOG); PR #163 (2026-04-20) added ADT type-availability probe (FEAT-50); PR #169 (2026-04-20) added DTEL v2→v1 Content-Type fallback + SICF-aware error classification; PR #177 (2026-04-22) extended `SAPContext(action="impact")` with sibling DDLS/DDLX consistency check; PR #176 (2026-04-23) landed CDS CRUD dependency guidance; PR #171 hardened data preview diagnostics; three new first-party workflow skills merged. Open PR review: PR [#179](https://github.com/marianfoo/arc-1/pull/179) fixes SAPActivate phantom success on NW 7.50 (BUG-01 P0). PR [#173](https://github.com/marianfoo/arc-1/pull/173) RAP on-prem preflight in flight._

## Legend
- ✅ = Supported
- ⚠️ = Partial / Limited
- ❌ = Not supported
- N/A = Not applicable

---

## 1. Core Architecture

| Feature | ARC-1 | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|---------|-------|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Language | TypeScript | Go 1.24 | TypeScript | TypeScript | Python 3.12 | TypeScript | TypeScript | JavaScript (compiled TS) | Python 3.10+ |
| Tool count | 12 intent-based | 1-99 (3 modes) | ~15 | 13 | 15 | 316 (4 tiers) | 3 (hierarchical) | 53 | 28+ CLI commands (not MCP) |
| ADT client | Custom (undici/fetch) | Custom (Go) | abap-adt-api | Custom (axios) | Custom (aiohttp) | Custom (axios) | SAP Cloud SDK | abap-adt-api | Custom (requests) |
| npm package | ✅ `arc-1` | ❌ (binary) | ❌ | ❌ | ❌ | ✅ `@mcp-abap-adt/core` | ❌ | ❌ (MCPB) | N/A (Python, git install) |
| Docker image | ✅ ghcr.io | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Stars | — | 295 | 125 | 103 | 35 | 43 | 120 | 37 | 79 |
| Active development | ✅ | ✅ Stable (v2.38.1; commits quiet since 2026-04-15, issues active #105–#124) | ❌ Dormant (Feb 2025) | ❌ Dormant | ⚠️ Stale (Mar 2026) | ✅ Very (v6.5.1, 6 releases in 9 days; open issue #77 FM-update parameter loss) | ⚠️ Dormant (Jan 2026) | ✅ Stable (53 tools, no commits since Apr 14) | ✅ Very (since 2018) |
| Release count | — | 32+ | — | — | — | 95+ (5 months) | — | rolling | rolling "latest" |
| NPM monthly downloads | — | N/A | — | — | — | 3,625 | — | N/A | N/A |

## 2. MCP Transport

| Transport | ARC-1 | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|-----------|-------|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| stdio | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | N/A (CLI) |
| HTTP Streamable | ✅ | ✅ (v2.38.0) | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ | N/A |
| SSE | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ⚠️ | ❌ | N/A |
| TLS/HTTPS | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ (v4.6.0) | ❌ | ❌ | N/A |

## 3. Authentication

| Auth Method | ARC-1 | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|-------------|-------|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Basic Auth | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| Cookie-based | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ (requests.Session) |
| API Key (MCP) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |
| OIDC/JWT (MCP) | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ❌ | ❌ |
| XSUAA OAuth | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ (Apr 2026) | ❌ |
| BTP Service Key | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Principal Propagation | ✅ | ❌ | ❌ | ❌ | ✅ (X.509) | ✅ | ✅ | ❌ | ❌ |
| MCP OAuth 2.0 per-user | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (Apr 2026) | ❌ |
| SAML | ❌ | ✅ (v2.39.0+, PR #97) | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ |
| X.509 Certificates | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| Device Flow (OIDC) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Browser login page | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ |
| Auth providers total | 4 | 2 | 1 | 1 | 5+ | 9 | 2 | 4 | 1 (Basic) |

## 4. Safety & Security

| Safety Feature | ARC-1 | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|----------------|-------|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Read-only mode | ✅ | ✅ | ❌ | N/A (read-only) | ❌ | ⚠️ exposition tiers | ❌ | ❌ | ❌ |
| Op allowlist/blocklist | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Package restrictions | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Block free SQL | ✅ | ✅ | ❌ | ❌ | N/A | ❌ | ❌ | ❌ | ❌ |
| Transport gating | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Dry-run mode | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Audit logging | ✅ | ❌ | ❌ | ❌ | ✅ (CloudWatch) | ❌ | ❌ | ❌ | ❌ |
| Input sanitization | ✅ (Zod) | ✅ | ❌ | ⚠️ | ✅ (defusedxml) | ✅ (Zod) | ✅ (Zod) | ⚠️ | ⚠️ (argparse) |
| MCP elicitation | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (10+ flows) | N/A |
| Try-finally lock safety | ✅ | ✅ | ❌ | N/A | ✅ | ✅ (v4.5.0) | N/A | ⚠️ (abap-adt-api) | ✅ |
| MCP scope system (OAuth) | ✅ (2D: scopes+roles+safety) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A |

### 4.1 Supply-Chain Security (SEC-11, Tier 1)

Where the rest of §4 covers *runtime* guardrails, this sub-table covers *build-time and distribution-time* guardrails — the controls that make the published npm package and Docker image trustworthy. Status for competitors is based on a 2026-05-08 inspection of their public `.github/`, `package.json`, and release-related workflow files; "—" means the project doesn't ship the relevant artifact (e.g. no Docker image to scan).

| Control | ARC-1 | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|---|---|---|---|---|---|---|---|---|---|
| Dependabot (or equivalent) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| `npm audit` PR gate | ✅ | N/A (Go) | ❌ | ❌ | N/A (Python) | ❌ | ❌ | ❌ | N/A (Python) |
| GitHub Dependency Review | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| CodeQL / SAST in CI | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Container image scanning | ✅ (Trivy) | — | — | — | ⚠️ (AWS-side) | — | — | — | — |
| Workflow `permissions:` minimum | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Third-party action SHA pinning | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| npm package provenance | ✅ | N/A (Go) | ❌ | ❌ | N/A (Python) | ❌ | ❌ | ❌ | N/A (Python) |
| `SECURITY.md` policy | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Private Vulnerability Reporting | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

Tier 2 (CycloneDX SBOM, Cosign image signing, OpenSSF Scorecard) and Tier 3 (Socket.dev malicious-package detection, vulnerability triage runbook) are tracked in `docs/plans/` and will move into this matrix as they land.

## 5. ABAP Read Operations

| Read Feature | ARC-1 | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|-------------|-------|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Programs (PROG) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | ✅ | ✅ |
| Classes (CLAS) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | ✅ | ✅ (incl. locals, test) |
| Interfaces (INTF) | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | N/A | ✅ | ✅ |
| Function modules (FUNC) | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | N/A | ✅ | ✅ (auto-group) |
| Function groups (FUGR) | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | N/A | ✅ (bulk) | ✅ |
| Includes (INCL) | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | N/A | ✅ | ✅ |
| CDS views (DDLS) | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | N/A | ✅ | ✅ |
| Behavior defs (BDEF) | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | N/A | ✅ | ✅ |
| Service defs (SRVD) | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | N/A | ✅ | ✅ |
| Service bindings (SRVB) | ✅ | ✅ | ❌ | ❌ | ✅ | ✅ | N/A | ❌ | ✅ |
| Tables (DDIC) | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ | N/A | ✅ | ✅ |
| Table contents | ✅ | ✅ | ✅ | ⚠️ Z-service | ❌ | ✅ | N/A | ✅ | ✅ (freestyle SQL) |
| Packages (DEVC) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | N/A | ✅ | ✅ |
| Metadata ext (DDLX) | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | N/A | ❌ | ❌ |
| Structures | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | N/A | ❌ | ✅ |
| Domains | ✅ | ❌ | ✅ | ⚠️ | ❌ | ✅ | N/A | ❌ | ⚠️ (PR #149 in progress) |
| Data elements | ✅ | ❌ | ✅ | ⚠️ | ❌ | ✅ | N/A | ❌ | ✅ |
| Enhancements (BAdI/ENHO) | ✅ (`GET /sap/bc/adt/enhancements/enhoxhb/{name}`) | ❌ | ❌ | ❌ | ❌ | ✅ (on-prem only; `GET /sap/bc/adt/programs/programs/{name}/source/main/enhancements/elements` + `GET /sap/bc/adt/enhancements/enhsxsb/{spot}`) | N/A | ❌ | ✅ (BAdI/enhancement impl) |
| Authorization fields (AUTH) | ✅ (`GET /sap/bc/adt/aps/iam/auth/{name}`) | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ✅ (`GET /sap/bc/adt/aps/iam/auth/{name}`) |
| Feature toggles (`FEATURE_TOGGLE`; deprecated alias `FTG2`) | ✅ (states only, `GET /sap/bc/adt/sfw/featuretoggles/{name}/states`; renamed from `FTG2` in audit Plan B) | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ✅ (states + toggle/check/validate) |
| Source version history | ✅ (`VERSIONS` list + `VERSION_SOURCE` fetch via `GET {sourceUrl}/versions` Atom feed) | ✅ (3 tools: list/compare/get) | ✅ (`revisions()` + `getObjectSource(url, {version})`) | ❌ | ❌ | ❌ | N/A | ✅ (`abap_get_revisions` list-only) | ❌ |
| Transactions | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ | N/A | ❌ | ❌ |
| Free SQL | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | N/A | ✅ | ✅ |
| System info / components | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ | N/A | ❌ | ✅ |
| BOR business objects | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Messages (T100, `MSAG`; deprecated alias `MESSAGES`) | ✅ (read+write; canonical short type `MSAG` from audit Plan B) | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Text elements | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Variants | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Structured class decomposition (metadata + includes) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ✅ (locals_def/imp/test/macros) |
| GetProgFullCode (include traversal) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (on-prem only; `GET /sap/bc/adt/repository/nodestructure?objecttype=PROG/P&objectname={name}` + recursive INCL fetch) | N/A | ❌ | ❌ |
| SKTD (Knowledge Transfer Documents) | ✅ (merged PR #134 2026-04-16; `GET/PUT/POST /sap/bc/adt/documentation/ktd/documents/`) | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |

## 6. Write / CRUD Operations

| Write Feature | ARC-1 | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|--------------|-------|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Create objects | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | N/A | ✅ | ✅ |
| Update source | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | N/A | ✅ | ✅ |
| Delete objects | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | N/A | ✅ | ❌ |
| Dependency-aware DDLS CRUD guidance (update/activate/delete hints) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Activate | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | N/A | ✅ | ✅ |
| Batch activate | ✅ | ✅ | ✅ | ❌ | ✅ (with dep resolution) | ✅ | N/A | ✅ (v2.0, Apr 2026) | ✅ (mass activation) |
| Lock/unlock | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | N/A | ✅ | ✅ |
| EditSource (surgical) | ✅ (edit_method) | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ✅ (edit_method, Apr 2026) | ❌ |
| CloneObject | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Execute ABAP | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ | N/A | ✅ | ✅ (abap run) |
| RAP CRUD (BDEF, SRVD, DDLX, SRVB) | ✅ (DDLS, DDLX, DCLS, BDEF, SRVD, SRVB write) | ⚠️ (some) | ❌ | ❌ | ✅ (BDEF, SRVD, SRVB) | ✅ (all incl. DDLX) | N/A | ⚠️ (BDEF create, SRVB publish) | ⚠️ (DDLS, DCL, BDEF write; SRVB publish) |
| Domain write (DOMA) | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | N/A | ❌ | ✅ (PR #149 merged) |
| Data element write (DTEL) | ✅ | ❌ | ✅ | ❌ | ❌ | ✅ | N/A | ❌ | ✅ |
| Multi-object batch creation | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Deterministic RAP preflight (TABL/BDEF/DDLX/DDLS static checks) | ⚠️ (in-flight PR [#173](https://github.com/marianfoo/arc-1/pull/173) — `preflightBeforeWrite` toggle) | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| RAP behavior-pool handler scaffolding | ⚠️ (in-flight PR [#173](https://github.com/marianfoo/arc-1/pull/173) — `SAPWrite action=scaffold_rap_handlers` with dry-run and autoApply) | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| AFF schema validation (pre-create) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Type auto-mappings (CLAS→CLAS/OC) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ✅ | ✅ (ADTObjectType) |
| Create test class | ❌ | ✅ | ❌ | ❌ | ✅ | ✅ | N/A | ✅ (abap_create_test_include) | ✅ (class write test_classes) |
| Table write (TABL) | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | N/A | ✅ | ✅ |
| Package create (DEVC) | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | N/A | ✅ | ✅ |
| Service binding create (SRVB) | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ | N/A | ❌ | ✅ |
| Message class write (MSAG) | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | N/A | ❌ | ✅ |
| DCL write (DCLS) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ✅ |
| SKTD write (Knowledge Transfer Docs) | ✅ (merged PR #134 2026-04-16; base64 Markdown in XML envelope; create requires refObjectType) | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |

## 7. Code Intelligence

| Feature | ARC-1 | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|---------|-------|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Find definition | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | N/A | ✅ (Apr 2026) | ❌ |
| Find references | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | N/A | ✅ | ✅ (where-used with scope) |
| Code completion | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Context compression | ✅ (SAPContext, 7-30x) | ✅ (auto, 7-30x) | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Method-level surgery | ✅ (95% reduction) | ✅ (95% reduction) | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| ABAP AST / parser | ⚠️ (abaplint for lint) | ✅ (native Go port) | ❌ | ❌ | ❌ | ✅ | N/A | ❌ | ❌ |
| Semantic analysis | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | N/A | ❌ | ❌ |
| Call graph analysis | ❌ | ✅ (5 tools) | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Type hierarchy | ✅ (via SQL) | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| CDS dependencies | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| CDS impact analysis (upstream+downstream) | ✅ (`SAPContext action=impact`, RAP-aware buckets) | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| CDS sibling DDLS/DDLX consistency | ✅ (PR #177 2026-04-22 — detects asymmetric metadata-extension coverage across sibling variants in same package) | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |

## 8. Code Quality

| Feature | ARC-1 | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|---------|-------|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Syntax check | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | N/A | ✅ | ✅ |
| ATC checks | ✅ | ✅ | ✅ | ❌ | ✅ (with summary) | ❌ | N/A | ✅ (severity grouping) | ✅ (checkstyle/codeclimate) |
| abaplint (local offline) | ✅ | ✅ (native Go port, 8 rules) | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Unit tests | ✅ | ✅ | ✅ | ❌ | ✅ (with coverage) | ✅ | N/A | ✅ (Apr 2026) | ✅ (with coverage + JUnit4/sonar) |
| CDS unit tests | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | N/A | ❌ | ❌ |
| API release state (clean core) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Fix proposals | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | N/A | ✅ (Apr 2026) | ❌ |
| PrettyPrint | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | N/A | ✅ (Apr 2026) | ❌ |
| Migration analysis | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | N/A | ❌ | ❌ |

## 9. Transport / CTS

| Feature | ARC-1 | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|---------|-------|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| List transports | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | N/A | ✅ | ✅ (-r/-rr/-rrr detail) |
| Create transport | ✅ (K/W/T) | ✅ | ✅ | ❌ | ❌ | ✅ | N/A | ✅ | ✅ (5 types: K/W/T/S/R) |
| Release transport | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | N/A | ✅ | ✅ (recursive) |
| Recursive release | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ✅ (recursive) |
| Delete transport | ✅ (recursive) | ❌ | ❌ | ��� | ❌ | ❌ | N/A | ❌ | ✅ |
| Transport contents | ⚠️ (forward lookup: `SAPTransport get`) | ❌ | ✅ | ❌ | ❌ | ❌ | N/A | ✅ | ✅ (-rrr objects) |
| Object → transport reverse lookup | ✅ (history action) | ❌ | ⚠️ (URI resolve only) | ❌ | ❌ | ❌ | N/A | ⚠️ (URI resolve only) | ❌ |
| Transport assign | ✅ (reassign owner) | ❌ | ❌ | ❌ | ❌ | ❌ | N/A | ✅ | ✅ (reassign owner) |
| Transport gating | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Inactive objects list | ✅ (rich user/deleted/transport metadata + flat fallback) | ✅ | ��� | ❌ | ❌ | ✅ | N/A | ❌ | ✅ |

## 10. Diagnostics & Runtime

| Feature | ARC-1 | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|---------|-------|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Short dumps (ST22) | ✅ (focused sections by default + `includeFullText` opt-in, PR #174) | ✅ | ✅ | ❌ | ❌ | ✅ | N/A | ✅ | ❌ |
| ABAP profiler traces | ✅ | ✅ | ✅ | ❌ | ❌ | ✅ | N/A | ✅ (8 tools: list/params/config/hit-list/statements/db-access/delete×2) | ❌ |
| System messages (SM02) | ✅ (`SAPDiagnose action=system_messages`, ADT feed, PR #174 2026-04-21) | ❌ | ❌ | ❌ | ❌ | ✅ (v5.0.0) | N/A | ❌ | ❌ |
| Gateway error log (IWFND) | ✅ (`SAPDiagnose action=gateway_errors`, on-prem, list + detailUrl/id detail modes, PR #174 2026-04-21) | ❌ | ❌ | ❌ | ❌ | ✅ (v5.0.0, on-prem) | N/A | ❌ | ❌ |
| ADT feed reader (unified) | ✅ (dumps + traces + system_messages + gateway_errors; all under `SAPDiagnose`) | ❌ | ❌ | ❌ | ❌ | ✅ (v5.0.0, 5 types) | N/A | ❌ | ❌ |
| SQL traces | ❌ | ✅ | ✅ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| ABAP debugger | ❌ | ✅ (8 tools) | ✅ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| AMDP/HANA debugger | ❌ | ✅ (7 tools) | ❌ | ❌ | ❌ | ❌ | N/A | ❌ | ❌ |
| Execute with profiling | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | N/A | ❌ | ❌ |

## 11. Advanced Features

| Feature | ARC-1 | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|---------|-------|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Feature auto-detection | ✅ (8 probes + ADT discovery/MIME + standalone type-availability probe with multi-signal classifier, PR #163) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (ADT discovery/MIME) |
| Caching (SQLite) | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| ETag source revalidation | ✅ (`If-None-Match`, active/inactive cache keys) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| UI5/Fiori BSP | ❌ | ⚠️ (3 read-only; 4 write tools disabled — ADT filestore returns 405) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (OData upload/download) |
| abapGit/gCTS | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ | N/A | ✅ | ✅ (full gCTS + checkout/checkin) |
| BTP Destination Service | ✅ | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |
| Cloud Connector proxy | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ |
| Multi-system support | ❌ | ❌ | ❌ | ❌ | ✅ | ✅ | ✅ | ✅ (SAP UI Landscape XML, Apr 2026) | ✅ (kubeconfig contexts) |
| OData bridge | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ (BSP, FLP via OData) |
| Lua scripting engine | ❌ | ✅ (50+ bindings) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| WASM-to-ABAP compiler | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| MCP client configurator | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (11 clients) | ❌ | ❌ | ❌ |
| CLI mode (non-MCP) | ⚠️ (generic `call`/`tools` entry points + 6 ergonomic shortcuts; 9 of 12 MCP tools lack shortcuts or expose fewer knobs than the Zod schema — tracked as [FEAT-60](../docs_page/roadmap.md#feat-60-cliserver-alignment-shortcut-parity-with-mcp-tool-schemas) + PR [#179](https://github.com/marianfoo/arc-1/pull/179)) | ✅ (28 commands) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (28+ commands, primary mode) |
| Health endpoint | ✅ | ❌ | ❌ | ❌ | ✅ | ✅ (v4.3.0) | ❌ | ✅ | ❌ |
| RFC connectivity | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (sap-rfc-lite) | ❌ | ❌ | ✅ (PyRFC, optional) |
| MCPB one-click install | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Lock registry / recovery | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Batch HTTP operations | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (multipart/mixed) | ❌ | ❌ | ❌ |
| RAG-optimized tool descriptions | ⚠️ (intent-based tool blurbs; compact 12-tool surface) | ❌ | ❌ | ❌ | ❌ | ✅ (v4.4.0; v6.2.0 extended to per-object-type context for 13 types — PR #66) | ❌ | ❌ | ❌ |
| Embeddable server (library mode) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (v6.4.0 adds per-instance `systemType` for multi-tenant) | ❌ | ❌ | ❌ |
| Error intelligence (hints) | ✅ (SAP-domain classification: lock-conflict/enqueue/auth/activation/object-exists/transport/method-not-supported/icf-handler-not-bound — last category added 2026-04-20 for SICF misconfiguration on DTEL create) | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (extensive) | ✅ (typed error hierarchy) |

## 12. Token Efficiency

| Feature | ARC-1 | vibing-steampunk | fr0ster | sapcli |
|---------|-------|-----------------|---------|--------|
| Schema token cost | ~200 (hyperfocused) / ~moderate (12 tools) | ~200 (hyperfocused) / ~14K (focused) / ~40K (expert) | ~high (303 tools) | N/A (CLI) |
| Context compression | ✅ SAPContext (7-30x) | ✅ Auto-append (7-30x) | ❌ | N/A |
| Method-level surgery | ✅ (95% source reduction) | ✅ (95% source reduction) | ❌ | N/A |
| Hyperfocused mode (1 tool) | ✅ (~200 tokens) | ✅ (~200 tokens) | ❌ | N/A |
| Compact/intent mode | ✅ (12 intent tools) | N/A | ✅ (22 compact tools) | N/A |

## 13. Testing & Quality

| Metric | ARC-1 | vibing-steampunk | mcp-abap-abap-adt-api | mcp-abap-adt (mario) | AWS Accelerator | fr0ster | btp-odata-mcp | dassian-adt / abap-mcpb | sapcli |
|--------|-------|-----------------|----------------------|---------------------|-----------------|---------|---------------|------------------------|--------|
| Unit tests | 1315 | 222 | 0 | 0 | 0 | Yes (Jest) | 0 | 163 | ~90 files (unittest) |
| Integration tests | ✅ (on-prem CI + BTP scheduled smoke) | ✅ | ❌ | 13 (live SAP) | ❌ | ✅ | ❌ | ⚠️ scaffold | ✅ (shell scripts) |
| CI/CD | ✅ (release-please + reliability telemetry) | ✅ (GoReleaser) | ❌ | ❌ | ❌ | ⚠️ (Husky + lint-staged) | ❌ | ❌ | ✅ (GitHub Actions + codecov) |
| Input validation | Zod v4 | Custom | Untyped | Untyped | Pydantic | Zod v4 | Zod | Manual | argparse |
| Linter | Biome | — | — | — | — | Biome | — | — | pylint + flake8 + mypy |

---

## Priority Action Items

> All prioritized items with evaluation details are maintained in the [roadmap](../docs_page/roadmap.md#prioritized-execution-order). The feature matrix tables above are the source of truth for _what exists_; the roadmap is the source of truth for _what to build next and why_.

---

## Corrections from Previous Matrix (2026-03-30)

The following items were incorrectly marked in the previous version and have since been updated:

| Item | 2026-03-30 | 2026-04-01 | 2026-04-02 | Reason |
|------|-----------|-----------|-----------|--------|
| ARC-1 Short dumps (ST22) | ✅ (wrong) | ❌ | ✅ | Implemented in PR #24 (SAPDiagnose dumps action) |
| ARC-1 ABAP profiler | ✅ (wrong) | ❌ | ✅ | Implemented in PR #24 (SAPDiagnose traces action) |
| ARC-1 SQL traces | ✅ (wrong) | ❌ | ❌ | Still not implemented |
| ARC-1 DDLX read | — | ❌ | ✅ | Implemented in PR #22 |
| ARC-1 SRVB read | — | ❌ | ✅ | Implemented in PR #22 |
| ARC-1 Batch activation | — | ⚠️ | ✅ | Implemented in PR #22 |
| ARC-1 RAP CRUD | — | ❌ | ✅ | DDLS/DDLX/BDEF/SRVD write in PR #22 |
| VSP tool count | 1-122 | 1-99 (54 focused, 99 expert per README_TOOLS.md) | Updated from actual tool documentation |
| fr0ster version | v4.5.2 | v4.7.1 → v4.8.1 | Updated to current release (85+ releases) |
| fr0ster TLS support | not listed | ✅ (v4.6.0) | New feature added Mar 31 |
| fr0ster sap-rfc-lite | not listed | ✅ (v4.7.0) | Replaced archived node-rfc |
| dassian column name | dassian-adt | dassian-adt / abap-mcpb | Successor repo albanleong/abap-mcpb created Mar 31 |
| VSP abaplint | ❌ (Go lexer) | ✅ (native Go port, 8 rules) | v2.32.0 added native linter |
| VSP HTTP Streamable | ❌ | ✅ (v2.38.0, mcp-go v0.47.0) | ARC-1 no longer unique on HTTP transport |
| VSP version | v2.32.0 | v2.39.0+ | Massive feature sprint Apr 2-8 (40+ commits) |
| fr0ster version | v4.8.1 | v4.8.7 | Continued iteration |
| fr0ster version | v4.8.7 | v5.0.8 (303 tools) | v5.0.7: 14 activation tools (+14), post-merge naming fix in v5.0.8 |
| fr0ster version | v5.0.8 (303 tools) | v5.1.1 (316 tools) | v5.1.0: 13 Check handlers, Node 22 minimum, stdio log fix, CSRF fix |
| fr0ster version | v5.1.1 (316 tools) | v6.1.0 (~320 tools) | v5.2.0: SRVD/SRVB activate + ServiceBindingVariant. v6.0.0 BREAKING: RuntimeListDumps removed, dump reads via RuntimeListFeeds; UpdateInterface BTP corrNr fix. v6.1.0: RFC decoupled from legacy. |
| fr0ster version | v6.1.0 | v6.4.1 (2026-04-21) | 4 releases in one week. v6.2.0: per-object-type tool descriptions across 13 types (PR #66). v6.4.0: per-instance `systemType` option for EmbeddableMcpServer (PR #69/#70, multi-tenant use case). v6.4.1: Dockerfile HTTP/header fix. Stars 35→43. |
| ARC-1 System messages (SM02) | ❌ | ✅ (PR #174 2026-04-21) | `SAPDiagnose action=system_messages` via ADT feed with user/from/to/maxResults filters. Closes the last fr0ster-v5-unique diagnostics gap. |
| ARC-1 Gateway error log (IWFND) | ❌ | ✅ (PR #174 2026-04-21) | `SAPDiagnose action=gateway_errors` (on-prem /IWFND/ERROR_LOG). Supports list mode and detail mode via `detailUrl` (preferred) or `id+errorType`. |
| ARC-1 ADT type-availability probe | not tracked | ✅ (PR #163 2026-04-20) | FEAT-50 base feature shipped as standalone diagnostic (`npm run probe`). Multi-signal classifier (discovery + collection GET + known-object GET + release floor). Fixture-driven replay tests. Synthetic 7.52 corpus + real NW 7.58 capture. No runtime gating — explicit design choice after PR #93/#96 regression. |
| ARC-1 DTEL v2→v1 content-type fallback | not tracked | ✅ (PR #169 2026-04-20) | Narrow static allowlist in `CONTENT_TYPE_FALLBACKS`; 415-only retry for DTEL create on older releases where `vnd.sap.adt.dataelements.v2+xml` is unsupported. |
| ARC-1 SICF-aware error hints | not tracked | ✅ (PR #169 2026-04-20) | New `icf-handler-not-bound` classification for DTEL create failures caused by missing SICF node (actionable hint points to SICF activation). |
| ARC-1 CDS sibling DDLS/DDLX consistency | not tracked | ✅ (PR #177 2026-04-22) | `SAPContext action=impact` additive sibling-consistency pass detecting asymmetric metadata-extension coverage across variants (common RAP bug: one DDLS has DDLX, sibling doesn't → missing UI fields on one routing path). Bounded (`siblingCheck`, `siblingMaxCandidates`), degrades to warnings on failure. |
| ARC-1 SAPManage scope split | not tracked | ✅ (PR #171) | Read sub-actions (features/probe/cache_stats) vs write sub-actions (package/FLP lifecycle) enforced via `SAPMANAGE_ACTION_SCOPES` in both standard and hyperfocused mode. Read-only clients keep diagnostic manage actions. |
| ARC-1 first-party skills | 4 (RAP + workflow) | 7 (added `sap-clean-core-atc`, `sap-unused-code`, `sap-object-documenter`) | Productization layer expanded beyond RAP into clean-core ATC review, dead-code detection, and object-level documentation capture. |
| dassian-adt | 33 stars | 37 stars | Still quiet — no commits since Apr 14. |
| abap-adt-api (mario) | 109 stars | 125 stars | Repo remains dormant (last commit Feb 2025). Star growth is retrospective, not activity-driven. |
| VSP stars | 279 | 295 | Quiet since 2026-04-15. Latest release v2.38.1 (2026-04-07). |
| dassian-adt | 0 stars, 25 tools, no OAuth | 33 stars, 53 tools, OAuth/XSUAA, multi-system | Explosive growth: 28 new tools, OAuth, multi-system in 2 weeks. No new commits since Apr 14. |
| dassian-adt transport tool count | 6 | 9 | Deep analysis: +transport_set_owner, +transport_add_user, +transport_delete in TransportHandlers.ts |
| dassian-adt trace tools | (unlisted) | 8 (TraceHandlers.ts) | Full profiler workflow: list/params/config/hit-list/statements/db-access/delete/delete-config |
| dassian-adt test include | ❌ | ✅ abap_create_test_include | TestHandlers.ts confirmed in deep analysis 2026-04-16 |
| VSP stars | 273 | 279 | New issues: 103 (SAProuter support), 104 (CSRF HEAD 403 on S/4HANA public cloud) |
| fr0ster stars | 29 | 35 | v6.1.0 |
| sapcli stars | 77 | 79 | PR #149 merged (domain support), PR #147 (auth fields), HTTP refactor |
| VSP lock-handle bug | ⚠️ (ongoing 423 errors) | ✅ (22517d4 — modificationSupport guard) | Root cause fixed in VSP; ARC-1 aligned with COMPAT-01 fix on 2026-04-16 (`lockObject` now checks `MODIFICATION_SUPPORT`/`modificationSupport`). |
| VSP version | v2.39.0+ | v2.40.0+ (Apr 13-15 sprint) | cr-config-audit CLI tools, RecoverFailedCreate primitive, lock-handle fix |
| S/4HANA Public Cloud CSRF | not tracked | ✅ fixed 2026-04-16 | VSP issue #104 confirmed the HEAD incompatibility. ARC-1 now retries CSRF fetch with GET when HEAD returns 403. |
| ARC-1 V4 SRVB publish endpoint | not tracked | ✅ fixed 2026-04-15 (PR #130) | `publishServiceBinding()`/`unpublishServiceBinding()` now use resolved binding type (`odatav2`/`odatav4`) instead of hardcoded v2. |
| ARC-1 SKTD (Knowledge Transfer Documents) | ❌ | ✅ (merged PR #134 2026-04-16) | PR #134 by lemaiwo — full SKTD read/write: `GET/PUT/POST /sap/bc/adt/documentation/ktd/documents/`, base64-decoded Markdown, create requires refObjectType, update preserves server-side metadata. |
| GetProgFullCode (include traversal) availability | ✅ fr0ster | ✅ fr0ster (on-prem only) | fr0ster v6.1.0 deep analysis: uses `GET /sap/bc/adt/repository/nodestructure?objecttype=PROG/P&objectname={name}` + recursive include fetch. NOT available on BTP Cloud (missing node API). |
| fr0ster Enhancements endpoint | noted | documented | fr0ster deep analysis: `GET /sap/bc/adt/programs/programs/{name}/source/main/enhancements/elements` (base64-encoded source, on-prem only); enhancement spot: `GET /sap/bc/adt/enhancements/enhsxsb/{spotName}`; on-prem only. |
| dassian-adt deep analysis | partial | complete | 2026-04-16 deep dive: 9 transport tools (was 6), 8 trace tools, abap_run endpoint `POST /sap/bc/adt/oo/classrun/{name}`, multi-system `sap_system_id` injection, OAuth self-hosted AS with PKCE. New folder: compare/dassian-adt/ |

---

## Competitive Positioning Summary

### ARC-1 Unique Strengths (no other project has all of these)
1. **Intent-based routing** — 12 tools vs 25-303. Simplest LLM decision surface.
2. **Declarative safety system** — Read-only, op filter, pkg filter, SQL blocking, transport gating, dry-run. Most comprehensive.
3. **MCP scope system** — OAuth scope-gated tool access (read/write/admin).
4. **BTP ABAP Environment** — Full OAuth 2.0 browser login, direct connectivity.
5. **Principal propagation** — Per-user SAP identity via Destination Service.
6. **MCP elicitation** — Interactive parameter collection for destructive ops.
7. **Audit logging** — BTP Audit Log sink for compliance.
8. **Context compression** — AST-based dependency extraction with depth control.
9. **First-party workflow skills** — researched RAP/common-use-case playbooks can encode provider-contract choices, clean-core guardrails, and recent primitives (`impact`, revisions, formatter settings, SKTD, `SAPGit`) on top of the compact intent-tool surface.
10. **npm + Docker + release-please** — Most professional distribution pipeline.

### Biggest Competitive Threats
1. **vibing-steampunk** (295 stars) — Community favorite but quiet since 2026-04-15 (latest release v2.38.1, 2026-04-07). Has Streamable HTTP (v2.38.0), SAML SSO (PR #97). Massive early-Apr sprint: i18n, gCTS, API release state, version history, code coverage, health analysis, rename preview, dead code analysis, package safety hardening, RecoverFailedCreate primitive. Defaults to hyperfocused mode (1 tool). Open issues: OAuth2 BTP request (#99), recurring lock handle bugs (fix in 22517d4), CSRF HEAD 403 on S/4HANA public cloud (#104), SAProuter support (#103).
2. **fr0ster** (v6.4.1, 100+ releases, 43 stars) — Closest enterprise competitor and the only active one this week (4 releases in 4 days, Apr 17-21). ~320 tools, 9 auth providers, TLS, RFC, embeddable. v6.2.0 shipped per-object-type tool descriptions (13 types) — same direction ARC-1 took with intent-based tools, but via per-type enrichment instead of collapsing to 12 intents. v6.4.0 added per-instance `systemType` to `EmbeddableMcpServer` (multi-tenant capability ARC-1 lacks — worth tracking for enterprise customers running one gateway per portfolio of SAP systems). v6.0.0 BREAKING: simplified dump API + fixed UpdateInterface on BTP (corrNr bug — not applicable to ARC-1 due to centralized safeUpdateSource). ARC-1 has already aligned on V4 SRVB publish endpoint support (PR #130, 2026-04-15) and closed the last unique diagnostics gap by adding SM02 + IWFND to `SAPDiagnose` (PR #174, 2026-04-21).
3. **dassian-adt** (37 stars, 53 tools) — Stabilized after explosive April sprint (0 → 37 stars, 25 → 53 tools in 2 weeks). OAuth/XSUAA/multi-system/per-user auth all added. Deep analysis (2026-04-16): 9 transport tools, 8 trace tools, abap_create_test_include confirmed. No new commits since Apr 14 — stable but stalled. Lacks: safety system, BTP Destination/PP, caching, linting.
4. **SAP Joule / Official ABAP MCP Server** — SAP announced Q2 2026 GA for ABAP Cloud Extension for VS Code with built-in agentic AI. Initial scope: RAP UI service development. Will reshape landscape — community servers become complementary.
5. **btp-odata-mcp** (120 stars) — Different category (OData not ADT). Dormant since Jan 2026. High stars but no recent development.

### Key Gaps to Close

**Closed gaps:**
- ~~Diagnostics~~ → ST22 + profiler traces + **SM02 system messages** + **/IWFND/ERROR_LOG gateway errors** all under `SAPDiagnose` (PR #174, 2026-04-21)
- ~~RAP completeness~~ → DDLX/SRVB read, DDLS/DDLX/BDEF/SRVD write, batch activation
- ~~DDIC completeness~~ → DOMA, DTEL, TRAN read; TABL covers transparent tables AND DDIC structures (Model B, 2026-05-07 — collapsed legacy STRU into TABL to match TADIR R3TR TABL and abapGit conventions)
- ~~Token efficiency~~ → method-level surgery, hyperfocused mode, context compression
- ~~Workflow/productization gap~~ → first-party skills now cover RAP workflows, clean-core ATC review, dead-code detection, object-level documentation capture, plus provider contracts / draft-auth defaults / impact analysis / revision history / formatter settings / SKTD docs / SAPGit delivery context.
- ~~Diagnostic compatibility visibility~~ → standalone ADT type-availability probe (`npm run probe`) with multi-signal classifier, fixture-driven replay tests (PR #163, 2026-04-20).

**Recently merged / productized:**
- ~~**SM02 + IWFND in `SAPDiagnose`**~~ — **✅ Merged PR #174 (2026-04-21)**. Added `system_messages` and `gateway_errors` actions, closing the last fr0ster-v5-unique diagnostics gap. Dumps action rewritten for focused sections (`kap0`/`kap3`/…) with `includeFullText` opt-in to reduce token usage.
- ~~**ADT type-availability probe (FEAT-50 base)**~~ — **✅ Merged PR #163 (2026-04-20)**. Standalone `npm run probe` command, multi-signal classifier, fixture-driven replay tests (synthetic 7.52 + real NW 7.58). Diagnostic-only, no runtime gating.
- ~~**DTEL v2→v1 fallback + SICF-aware error hints**~~ — **✅ Merged PR #169 (2026-04-20)**. Narrow static Content-Type fallback + new `icf-handler-not-bound` error category for SICF misconfig.
- ~~**SAPContext impact sibling DDLS/DDLX consistency**~~ — **✅ Merged PR #177 (2026-04-22)**. Catches the "one sibling has DDLX, the other doesn't" RAP bug that missing UI fields trace back to.
- ~~**SAPManage scope split + data preview hardening**~~ — **✅ Merged PR #171**. Read sub-actions (features/probe/cache_stats) vs write sub-actions (package/FLP), enforced in both standard and hyperfocused mode.
- ~~**Three new first-party skills**~~ — **✅ Merged PR #164 (2026-04-19)**. `sap-clean-core-atc`, `sap-unused-code`, `sap-object-documenter` — broadens the workflow layer from RAP into clean-core review, dead-code detection, and object-level documentation capture.
- ~~**SKTD (Knowledge Transfer Documents)**~~ — **✅ Merged PR #134 (2026-04-16)** by lemaiwo. Full read/write for Markdown docs attached to ABAP objects. Unique to ARC-1 among all competitors.
- **RAP/common-use-case skill refresh (2026-04-18)** — `generate-rap-service-researched`, `generate-rap-service`, and `generate-rap-logic` now explicitly use `SAPContext(action="impact")`, `SAPRead(type="VERSIONS")`, `SAPTransport(action="history")`, `SAPLint(action="format"/"get_formatter_settings")`, `SAPRead/SAPWrite(type="SKTD")`, and `SAPGit`.
- **Workflow research conclusion** — external steering/skill repos (`sap-abap-base`, `sap-skills`) reinforce that the next differentiation layer is codified workflows, not raw tool-count inflation. ARC-1 is now positioned to ship tighter first-party playbooks on top of its intent-tool model.

**P0 — production blockers:**
- ~~415/406 content-type auto-retry (SAP version compatibility)~~ — ✅ Implemented. [Deep dive](fr0ster/evaluations/v4.5.0-release-deep-dive.md)
- ~~ADT service discovery / MIME negotiation (FEAT-38)~~ — ✅ completed 2026-04-14
- ~~401 session timeout auto-retry (centralized gateway idle)~~ — ✅ Implemented in `src/adt/http.ts`
- ~~TLS/HTTPS for HTTP Streamable~~ — downgraded to P3: most deployments use reverse proxy
- ~~**modificationSupport guard in lockObject()**~~ — ✅ fixed 2026-04-16 in `src/adt/crud.ts`. Lock responses with explicit `MODIFICATION_SUPPORT=false`/`modificationSupport=false` now fail early with actionable 423 guidance. [Eval](vibing-steampunk/evaluations/22517d4-lock-handle-bug-class.md)
- ~~**CSRF HEAD fallback for S/4HANA Public Cloud**~~ — ✅ fixed 2026-04-16 in `src/adt/http.ts`. CSRF fetch now retries with GET when HEAD returns 403. [Eval](vibing-steampunk/evaluations/22517d4-lock-handle-bug-class.md) / VSP issue #104
- ~~**V4 SRVB publish endpoint bug**~~ — ✅ fixed 2026-04-15 in PR #130 (`9b0601c`). Publish/unpublish now respect resolved service binding type (`odatav2`/`odatav4`). [Eval](fr0ster/evaluations/51781d3-srvd-srvb-activate-variant.md)
- ~~**BTP transport omission in safeUpdateSource()**~~ — **Likely NOT applicable.** ARC-1's centralized `safeUpdateSource()` already uses `transport ?? (lock.corrNr || undefined)` for all types — fr0ster's bug was per-handler (only `UpdateInterface` was missing it). Verify with BTP INTF update integration test. [Eval](fr0ster/evaluations/c2b8006-dump-simplify-updateintf-fix.md)

**P1 — remaining high-value gaps:**
- Function group bulk fetch
- Documentation (Copilot Studio guide, Basis Admin guide)
- Expand first-party workflow skills beyond RAP into transport review, diagnostics, clean-core checks, and Git-backed change review

**P2+ — future gaps:**
- ~~System messages (SM02)~~ — **✅ shipped in PR #174 (2026-04-21)** as `SAPDiagnose action=system_messages`.
- ~~Gateway error log (IWFND)~~ — **✅ shipped in PR #174 (2026-04-21)** as `SAPDiagnose action=gateway_errors` (on-prem only).
- Compare/diff on top of FEAT-20 + FEAT-49
- ABAP documentation / F1 help, table pagination / offset
- SQL traces, coverage/reporting enhancements
- Cloud readiness assessment, enhancement framework
- Multi-system routing, rate limiting
- Per-instance `systemType` / embeddable multi-tenant (fr0ster v6.4.0 pattern) — track if enterprise customers need one gateway for multiple SAP systems
- Dynpro (screen) metadata — ADT endpoint `/sap/bc/adt/programs/programs/<PROG>/dynpros` (abap-adt-api #44)
- RecoverFailedCreate — partial-create recovery on 5xx (VSP f00356a)

**Not planned (intentional):**
- ABAP debugger (WebSocket + ZADT_VSP), execute ABAP (security risk), Lua scripting (VSP-unique)
