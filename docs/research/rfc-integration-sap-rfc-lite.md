# RFC Integration Research: sap-rfc-lite

**Date:** 2026-04-14
**Status:** Research / Not yet decided — build only when explicitly requested
**Package:** `@mcp-abap-adt/sap-rfc-lite` ([GitHub](https://github.com/fr0ster/sap-rfc-lite))

---

## 1. What is sap-rfc-lite?

A lightweight Node.js native addon (C++ / N-API) providing Promise-based bindings for the SAP NetWeaver RFC SDK. It is a modern, zero-vulnerability replacement for the archived [node-rfc](https://github.com/SAP-archive/node-rfc) by SAP.

| Property | Detail |
|----------|--------|
| Version | 0.1.1 (released 2026-04-01) |
| License | Apache-2.0 |
| Stars | 2 (very new) |
| Source | ~2,200 lines (vs. ~14,200 in node-rfc) |
| Runtime deps | 2 (`node-addon-api`, `node-gyp-build`) |
| Vulnerabilities | 0 (vs. 24 in node-rfc) |
| Node.js | >= 18 |
| **Native dependency** | **Requires SAP NetWeaver RFC SDK C library** |
| npm scope | `@mcp-abap-adt/sap-rfc-lite` (same org namespace) |

### Why not node-rfc?

SAP's original [node-rfc](https://github.com/SAP-archive/node-rfc) is archived, has 24 known vulnerabilities, 18 outdated dependencies (including `bluebird` — a Promise polyfill unnecessary since Node 8), and ~14,200 lines of code. SAP's proprietary replacement (`@sap-rfc/node-rfc-library`) requires a private npm registry and S-user with SAP Build Code license. `sap-rfc-lite` is the only viable open-source option.

### API surface

```typescript
import { Client } from '@mcp-abap-adt/sap-rfc-lite';

const client = new Client({
  ashost: '10.0.0.1',
  sysnr: '00',
  client: '100',
  user: 'USER',
  passwd: 'PASSWORD',
  lang: 'EN',
});

await client.open();
const result = await client.call('STFC_CONNECTION', { REQUTEXT: 'Hello' });
console.log(result.ECHOTEXT);
await client.close();
```

Three methods: `open()`, `call(rfmName, rfmParams?)`, `close()`. Properties: `id` (number), `alive` (boolean).

### Internal architecture

```
TypeScript (Promise API)  →  C++ N-API (AsyncWorker)  →  SAP NW RFC SDK (libsapnwrfc)
src/ts/                      src/cpp/                    /usr/local/sap/nwrfcsdk/lib/
```

Each `client.call()` flows through two N-API async workers:
1. **PrepareAsync** — gets function descriptor via `RfcGetFunctionDesc()`, sets parameters (worker thread)
2. **InvokeAsync** — calls `RfcInvoke()`, extracts results (worker thread)

Per-client `std::mutex` serializes operations within one connection. Multiple clients can run in parallel.

### Type system

```typescript
type RfcVariable = string | number | Buffer;
type RfcStructure = { [key: string]: RfcVariable | RfcStructure | RfcTable };
type RfcTable = Array<RfcVariable | RfcStructure>;
type RfcObject = { [key: string]: RfcVariable | RfcStructure | RfcTable };

// Error types
interface RfcLibError { name: 'RfcLibError'; code: number; key: string; message: string; ... }
interface AbapError { name: 'ABAPError'; abapMsgClass: string; abapMsgNumber: string; ... }
interface NodeRfcError { name: 'nodeRfcError'; message: string; }
```

### Hard requirements

- **SAP NetWeaver RFC SDK** — proprietary C library, downloaded from SAP Support Portal (S-user required)
- `SAPNWRFC_HOME` env var pointing to SDK root (containing `lib/` and `include/`)
- C++ build toolchain at install time: node-gyp, C++17 compiler (MSVC on Windows, GCC on Linux, Clang on macOS)
- Platform-specific: separate SDK downloads for Linux x64, macOS arm64/x64, Windows x64

---

## 2. Why RFC could be useful for ARC-1

ADT (ABAP Development Tools) REST API covers most development scenarios, but RFC provides access to capabilities that ADT does not expose or exposes incompletely.

### High-value use cases

| Use case | RFC function module(s) | ADT equivalent | Gap filled |
|----------|----------------------|----------------|------------|
| **Read any table data** | `RFC_READ_TABLE`, `BBP_RFC_READ_TABLE` | `/sap/bc/adt/datapreview` (limited) | Full SELECT with WHERE clause, no 512-byte row limit |
| **Execute ABAP report** | `RFC_ABAP_INSTALL_AND_RUN` | None | Run arbitrary ABAP code (**extremely dangerous**) |
| **Transport operations** | `TRINT_*`, `TR_*` FMs | `/sap/bc/adt/cts/` (limited) | Release, import, add objects to transport |
| **User info / authorization** | `BAPI_USER_GET_DETAIL`, `SUSR_*` | None | Check user authorizations programmatically |
| **System info** | `RFC_SYSTEM_INFO`, `TH_SERVER_LIST` | `/sap/bc/adt/discovery` (limited) | Kernel version, DB info, app server list |
| **DDIC metadata** | `DDIF_FIELDINFO_GET`, `DD_*` | ADT covers most | Some edge cases (append structures, search helps) |
| **Background job management** | `BAPI_XBP_*`, `JOB_*` | None | Schedule, monitor, read job logs |
| **Application log** | `BAL_*`, `APPL_LOG_READ_*` | None | Read SLG1 application logs |
| **Message class texts** | `MESSAGE_TEXT_BUILD` | Limited | Build message texts with variables |
| **Custom function modules** | Any customer Z* FM | None | Call customer-specific business logic |

### What makes RFC different from ADT

- **ADT = REST API** — HTTP-based, stateless (mostly), designed for Eclipse/VS Code tooling. ARC-1 controls which endpoints are exposed.
- **RFC = binary protocol** — Direct function module invocation, full SAP type system (structures, tables, BCD numbers), stateful connections. Can call **any** function module in the system.

RFC is fundamentally more powerful because it can call any of ~500,000+ function modules. This is both its strength and its danger.

---

## 3. Security analysis: Why RFC is dangerous

### 3.1 Blast radius

RFC access is essentially **remote code execution on the SAP system**. Key risks:

| Risk | Example | Severity |
|------|---------|----------|
| **Data exfiltration** | `RFC_READ_TABLE` on `USR02` (password hashes), `PA0008` (salary data) | Critical |
| **Arbitrary code execution** | `RFC_ABAP_INSTALL_AND_RUN` — runs any ABAP source | Critical |
| **OS command execution** | `SXPG_COMMAND_EXECUTE`, `SXPG_CALL_SYSTEM` | Critical |
| **System destabilization** | FMs that modify system tables, delete runtime data | Critical |
| **Authorization bypass** | FMs that skip authority checks internally | High |
| **Mass data modification** | BAPIs that update business objects (orders, invoices, master data) | High |
| **User manipulation** | `BAPI_USER_CREATE`, `BAPI_USER_CHANGE`, `BAPI_USER_ACTGROUPS_ASSIGN` | High |
| **Transport manipulation** | Releasing transports to production via `TRINT_RELEASE_REQUEST` | High |

### 3.2 SAP-side authorization

SAP checks RFC access via authorization object **S_RFC**:
- `RFC_TYPE` — `FUNC` (function module) or `FUGR` (function group)
- `RFC_NAME` — name pattern (supports wildcards like `Z*`)
- `ACTVT` — activity (`16` = Execute)

**Problem:** Many SAP systems have overly permissive `S_RFC` assignments. Dialog users often get `S_RFC` with `RFC_NAME = *` for convenience. The SAP user used by ARC-1 may have broad RFC access even if that wasn't intended for AI-driven automation.

### 3.3 Comparison with current ADT risk model

| Dimension | ADT (current) | RFC (proposed) |
|-----------|--------------|----------------|
| Protocol | HTTP REST | Binary RFC (proprietary) |
| Attack surface | ~40 endpoints ARC-1 implements | Any of ~500,000+ function modules |
| Safety model | Operation type checks + package filter | **Allowlist-only** (see section 4) |
| ARC-1 control | Full — we choose which endpoints to expose | Limited — FM behavior is opaque to us |
| Authentication | SAP user via HTTP Basic / OAuth | SAP user via RFC connection params |
| What can go wrong | Create/modify ABAP objects in allowed packages | **Anything** the SAP user's S_RFC allows |

**Key insight:** ADT's attack surface is bounded by the endpoints ARC-1 chooses to implement. RFC's attack surface is bounded only by what the admin puts in the allowlist — and by the SAP user's `S_RFC` authorizations. This is why the allowlist must be explicit and there must be no "allow all" default.

---

## 4. Integration design: Allowlist-only security model

### 4.1 Core principle: Everything blocked unless explicitly allowed

There is **no blocklist**. With ~500,000+ function modules in a typical SAP system, a blocklist is a losing strategy — you will always miss something dangerous. Instead:

- **Empty allowlist = all RFC calls blocked** (default state)
- Admin must explicitly list every function module that can be called
- Wildcards supported but discouraged (e.g., `BAPI_MATERIAL_GET*` — use with caution)

### 4.2 Activation requirements (defense in depth)

RFC requires **all three layers** to be active. If any is missing, RFC is completely unavailable — the tool does not even appear in MCP tool listings.

```
Layer 1 — Server config:     ARC1_ENABLE_RFC=true           (env var / CLI flag, default: false)
Layer 2 — Allowlist:         ARC1_RFC_ALLOWED_FMS="FM1,FM2" (must be non-empty)
Layer 3 — Auth scope:        'rfc' scope in JWT / API key profile
Layer 4 — SAP authorization: S_RFC on the SAP user          (enforced by SAP, not ARC-1)
```

### 4.3 New operation type

```typescript
// src/adt/safety.ts
export const OperationType = {
  // ... existing: R, S, Q, F, C, U, D, A, T, L, I, W, X ...
  Rfc: 'G',  // new: RFC function module invocation
} as const;
```

`G` is blocked by `readOnly` mode (RFC can modify data). It's also filterable via `allowedOps` / `disallowedOps`.

### 4.4 New config flags

```typescript
// src/server/types.ts — ServerConfig additions
enableRfc: boolean;           // default: false — master switch
rfcAllowedFMs: string[];     // default: [] — empty = block ALL calls
rfcMaxRows: number;           // default: 1000 — cap table read results
```

| Variable / Flag | Description | Default |
|-----------------|-------------|---------|
| `ARC1_ENABLE_RFC` / `--enable-rfc` | Master switch for RFC feature | `false` |
| `ARC1_RFC_ALLOWED_FMS` / `--rfc-allowed-fms` | Comma-separated list of allowed function modules (supports wildcards) | `""` (empty = block all) |
| `ARC1_RFC_MAX_ROWS` / `--rfc-max-rows` | Max rows returned by table-reading FMs | `1000` |

### 4.5 New scope: `rfc`

```typescript
// src/handlers/intent.ts
const TOOL_SCOPES: Record<string, string> = {
  // ... existing ...
  SAPRfc: 'rfc',  // new dedicated scope, separate from read/write/sql
};
```

The `rfc` scope is **not implied by any other scope**. Having `write` does not grant `rfc`. Having `sql` does not grant `rfc`. It must be explicitly assigned.

### 4.6 New profiles

```typescript
// src/server/config.ts — PROFILES additions
'developer-rfc': {
  readOnly: false,
  blockData: false,
  blockFreeSQL: true,
  enableTransports: true,
  enableRfc: true,
  allowedPackages: ['$TMP'],
},
'developer-rfc-sql': {
  readOnly: false,
  blockData: false,
  blockFreeSQL: false,
  enableTransports: true,
  enableRfc: true,
  allowedPackages: ['$TMP'],
},

// PROFILE_SCOPES additions
'developer-rfc': ['read', 'write', 'data', 'rfc'],
'developer-rfc-sql': ['read', 'write', 'data', 'sql', 'rfc'],
```

**No viewer profile gets RFC.** RFC is inherently a write-equivalent capability because many FMs modify data. Even "read-only" FMs like `RFC_READ_TABLE` can be used for data exfiltration.

### 4.7 New tool: SAPRfc

```typescript
{
  name: 'SAPRfc',
  description: 'Call SAP RFC function modules. Requires explicit server-side enablement and function module allowlisting by the administrator. Use RFC_GET_FUNCTION_INTERFACE to discover FM parameters before calling.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['call', 'describe'],
        description: 'call = invoke FM, describe = get FM interface/parameters'
      },
      functionModule: {
        type: 'string',
        description: 'Function module name (must be in server allowlist)'
      },
      parameters: {
        type: 'object',
        description: 'Import parameters as key-value pairs'
      },
    },
    required: ['action', 'functionModule'],
  },
}
```

The `describe` action calls `RFC_GET_FUNCTION_INTERFACE` to let the LLM discover what parameters an FM expects before calling it. This FM itself must also be in the allowlist.

The tool is **only registered** when `config.enableRfc === true` AND the RFC SDK is available. It does not appear in tool listings otherwise.

### 4.8 Safety check flow

```
SAPRfc call received
  │
  ├─ 1. Is enableRfc true?                    → No: error "RFC not enabled on this server"
  ├─ 2. Is RFC SDK loaded?                    → No: error "RFC SDK not installed"
  ├─ 3. Does user have 'rfc' scope?           → No: error "Missing 'rfc' scope"
  ├─ 4. checkOperation(safety, 'G', 'RfcCall') → No: error "RFC blocked by safety config"
  ├─ 5. Is rfcAllowedFMs non-empty?
  │     └─ No (empty):                        → error "No FMs allowed (set ARC1_RFC_ALLOWED_FMS)"
  ├─ 6. Does FM match any entry in allowlist? → No: error "FM 'X' not in allowlist"
  │
  ▼
  Execute RFC call via sap-rfc-lite Client
  (SAP-side S_RFC check happens here — may reject independently)
```

**No blocklist, no exceptions.** If a function module is not in `rfcAllowedFMs`, it cannot be called. Period.

### 4.9 Allowlist examples

```bash
# Minimal: system info only
ARC1_RFC_ALLOWED_FMS="RFC_SYSTEM_INFO,RFC_GET_FUNCTION_INTERFACE"

# Read-focused: table data + metadata
ARC1_RFC_ALLOWED_FMS="RFC_READ_TABLE,RFC_SYSTEM_INFO,DDIF_FIELDINFO_GET,RFC_GET_FUNCTION_INTERFACE"

# Custom business logic
ARC1_RFC_ALLOWED_FMS="Z_MY_CUSTOM_FM,Z_MY_OTHER_FM,RFC_GET_FUNCTION_INTERFACE"

# Background jobs (use with caution)
ARC1_RFC_ALLOWED_FMS="BAPI_XBP_JOB_SELECT,BAPI_XBP_JOB_STATUS_GET,BAL_LOG_READ,RFC_GET_FUNCTION_INTERFACE"

# Wildcard (discouraged — review what Z* FMs exist first!)
ARC1_RFC_ALLOWED_FMS="Z_SAFE_*,RFC_GET_FUNCTION_INTERFACE"
```

### 4.10 Audit logging

Every RFC call is audit-logged with:
- Function module name
- Parameter keys (not values — could contain sensitive data like passwords, salary, PII)
- User identity (from JWT / API key / SAP user)
- Timestamp
- Success/failure + error classification
- Whether the FM was in allowlist (for debugging denied calls)

---

## 5. Deployment considerations

### 5.1 Native dependency problem

sap-rfc-lite requires the SAP NetWeaver RFC SDK, which:
- Is **not open source** — requires SAP download from Support Portal (S-user or partner access)
- Must be present at **npm install time** for C++ compilation via node-gyp
- Is **platform-specific** (separate downloads for Linux x64, macOS arm64, macOS x64, Windows x64)
- Adds **~50 MB** to the deployment footprint
- Requires **C++17 compiler** and build tools

This fundamentally changes ARC-1's deployment model for RFC-enabled scenarios:

| Dimension | Current (ADT only) | With RFC |
|-----------|-------------------|----------|
| `npm install arc-1` | Just works | Needs RFC SDK pre-installed, or install succeeds but RFC unavailable |
| Docker image | Self-contained, ~30 MB | Needs RFC SDK baked in, ~80+ MB |
| Native dependencies | None (pure JS/TS) | C++ addon (node-gyp, node-addon-api) |
| Platform support | Any OS with Node 22+ | Limited to platforms with RFC SDK builds |
| BTP CF deployment | Standard `nodejs_buildpack` | Needs SDK bundled in app + extra env vars |

### 5.2 Optional dependency strategy

sap-rfc-lite is an **optional dependency** — ARC-1 installs and runs fine without it:

```json
// package.json
"optionalDependencies": {
  "@mcp-abap-adt/sap-rfc-lite": "^0.1.0"
}
```

**How `optionalDependencies` works in npm:**
- During `npm install`, npm **attempts** to install optional deps
- If the install **fails** (e.g., no C++ compiler, no RFC SDK), npm **skips it silently** and continues
- The rest of ARC-1 installs normally
- No error, no broken install

**At runtime**, ARC-1 loads the module dynamically:

```typescript
// src/rfc/loader.ts
export async function loadRfcClient(): Promise<typeof import('@mcp-abap-adt/sap-rfc-lite') | null> {
  try {
    return await import('@mcp-abap-adt/sap-rfc-lite');
  } catch {
    return null;  // RFC SDK not installed — feature unavailable
  }
}
```

**What happens in each scenario:**

| `ARC1_ENABLE_RFC` | SDK installed? | Behavior |
|-------------------|---------------|----------|
| `false` (default) | Doesn't matter | RFC feature completely hidden. No tool listed. No warning. |
| `true` | No | Startup **warning**: `"RFC enabled but @mcp-abap-adt/sap-rfc-lite not available — install SAP NW RFC SDK and npm install"`. Server starts normally, SAPRfc tool not registered. |
| `true` | Yes, but `rfcAllowedFMs` empty | Startup **warning**: `"RFC enabled but no function modules allowed — set ARC1_RFC_ALLOWED_FMS"`. SAPRfc tool registered but all calls rejected. |
| `true` | Yes, `rfcAllowedFMs` set | RFC fully operational. SAPRfc tool registered with listed FMs callable. |

**Key point:** The `import()` call is lazy — it only runs when RFC is enabled. No ARC-1 code path outside `src/rfc/` ever references the RFC module. If the package isn't installed, the `catch` block returns `null`, and ARC-1 treats it as "RFC not available."

### 5.3 Docker deployment

#### Standard image (no RFC) — unchanged

```dockerfile
# Dockerfile (existing, no changes)
FROM node:22-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
# ... no RFC SDK, no native compilation needed
```

#### RFC-enabled image — separate Dockerfile or build arg

```dockerfile
# Dockerfile.rfc
FROM node:22-slim AS builder

# --- RFC SDK layer ---
# SDK must be provided by the builder (not distributed publicly)
COPY nwrfcsdk/ /usr/local/sap/nwrfcsdk/
ENV SAPNWRFC_HOME=/usr/local/sap/nwrfcsdk
ENV LD_LIBRARY_PATH=/usr/local/sap/nwrfcsdk/lib

# Install build tools for native addon compilation
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev  # This now compiles sap-rfc-lite successfully
COPY dist/ ./dist/

# --- Runtime image ---
FROM node:22-slim
COPY --from=builder /usr/local/sap/nwrfcsdk/lib/ /usr/local/sap/nwrfcsdk/lib/
ENV LD_LIBRARY_PATH=/usr/local/sap/nwrfcsdk/lib
COPY --from=builder /app /app
WORKDIR /app
CMD ["node", "dist/index.js"]
```

**Image distribution:**

| Image | Tag | Size | RFC |
|-------|-----|------|-----|
| `ghcr.io/arc-mcp/arc-1:latest` | Standard | ~30 MB | No |
| `ghcr.io/arc-mcp/arc-1:rfc` | RFC-enabled | ~80+ MB | Yes |

**Note:** The RFC-enabled Docker image cannot be published publicly because it contains the proprietary SAP NW RFC SDK. It would need to be built privately by each organization with their own SDK copy.

### 5.4 BTP Cloud Foundry deployment (without Docker)

Based on [SAP's official blog](https://community.sap.com/t5/technology-blog-posts-by-sap/abap-rfc-connectivity-from-btp-node-js-buildpack-and-kyma/ba-p/13573993), RFC **does work** on BTP CF with the standard Node.js buildpack. Here's how:

#### How it works

1. **Bundle the RFC SDK in your app directory** — copy the `nwrfcsdk/` folder into the app root before `cf push`
2. **Set env vars** in `manifest.yaml` / `mta.yaml`:
   ```yaml
   env:
     SAPNWRFC_HOME_CLOUD: /tmp/app/nwrfcsdk       # Build-time: for node-gyp compilation
     LD_LIBRARY_PATH: /home/vcap/app/nwrfcsdk/lib  # Runtime: for loading .so libraries
   ```
3. **The buildpack compiles** the native addon during staging (just like any node-gyp module)
4. **At runtime**, the `.so` libraries are loaded from the bundled SDK

#### What would change in mta.yaml

```yaml
# Current ARC-1 module (unchanged for non-RFC deployments)
modules:
  - name: arc1
    type: nodejs
    path: .
    parameters:
      memory: 256M
      disk-quota: 512M

# RFC-enabled variant would need:
modules:
  - name: arc1-rfc
    type: nodejs
    path: .
    parameters:
      memory: 384M          # More memory for native addon
      disk-quota: 1024M     # RFC SDK adds ~50MB
    properties:
      SAPNWRFC_HOME_CLOUD: /tmp/app/nwrfcsdk
      LD_LIBRARY_PATH: /home/vcap/app/nwrfcsdk/lib
      ARC1_ENABLE_RFC: true
      ARC1_RFC_ALLOWED_FMS: "RFC_READ_TABLE,RFC_SYSTEM_INFO"
```

#### Practical issues with BTP CF + RFC

| Issue | Detail |
|-------|--------|
| **SDK bundling** | Must manually copy `nwrfcsdk/` into app root before every `cf push`. Not automatable via mta.yaml. |
| **Upload size** | App upload grows from ~5 MB to ~55+ MB (SDK binaries). Slower deploys. |
| **Platform lock-in** | SDK must be Linux x64 build (cflinuxfs4 = Ubuntu Jammy). Cannot use macOS/Windows SDK. |
| **Rebuild on every push** | `npm install` during staging recompiles the C++ addon every time. Adds ~30s to staging. |
| **No principal propagation for RFC** | BTP Destination Service supports HTTP destinations for PP, but **RFC destinations work differently** — they use connection parameters (ashost/sysnr), not HTTP proxy. Cloud Connector maps virtual hosts for RFC, but the PP flow (SAML assertion via `SAP-Connectivity-Authentication` header) is HTTP-only. RFC PP would need a different mechanism (SNC with X.509 certificates). |
| **Cloud Connector RFC config** | Requires separate Cloud Connector configuration for RFC (not just HTTP). The CC admin must expose the SAP system's RFC port (sapgw00, typically 3300) as a virtual host, in addition to the existing HTTP mapping. |
| **Licensing** | SAP NW RFC SDK is downloaded from SAP Support Portal. Uploading it as part of a CF app is redistribution within the BTP subaccount — should be covered by the customer's SAP license, but worth confirming. |

#### RFC connectivity through Cloud Connector

```
                              Cloud Connector
ARC-1 on BTP CF  ──RFC──►  [virtual host:3300]  ──RFC──►  SAP on-prem (sapgw00)
                              │
                              ├─ RFC mapping (separate from HTTP)
                              └─ Access control (function name patterns possible)
```

RFC connection parameters use **websocket RFC (WS-RFC)** through Cloud Connector:

```typescript
const client = new Client({
  dest: 'SAP_RFC_DEST',            // Or explicit parameters:
  wshost: 'virtual-host',          // Cloud Connector virtual host
  wsport: '443',                   // Cloud Connector port
  client: '100',
  // Authentication via Cloud Connector mapping
});
```

#### BTP Kyma (Kubernetes) — simpler

On Kyma, RFC works more naturally because you control the Docker image. The SDK is baked into the container image, and RFC connections go through Cloud Connector the same way. This is the recommended approach for RFC on BTP.

### 5.5 Deployment recommendation matrix

| Deployment model | RFC feasibility | Complexity | Recommended? |
|-----------------|----------------|------------|--------------|
| **Local stdio** (dev) | Works if SDK installed locally | Low | Yes (for development) |
| **Docker** (self-hosted) | Works — bake SDK into image | Medium | Yes |
| **BTP CF + Docker image** | Works — same as Docker | Medium | Yes |
| **BTP CF + Node.js buildpack** | Works but awkward — bundle SDK in app | High | No — use Docker instead |
| **BTP Kyma** | Works — SDK in container image | Medium | Yes |
| **npm global install** | Only if SDK installed on host | Low | Niche use case |

**Bottom line:** For BTP without Docker, it technically works but adds significant friction (manual SDK bundling, larger uploads, rebuild on every push, no PP for RFC). The Docker path is cleaner. For most BTP deployments, stick with the Docker image approach.

---

## 6. Codebase impact assessment

### New files

| File | Purpose |
|------|---------|
| `src/rfc/loader.ts` | Dynamic `import()` of sap-rfc-lite, availability check |
| `src/rfc/client.ts` | RFC client wrapper: connection lifecycle, allowlist enforcement, timeout |
| `src/rfc/safety.ts` | FM allowlist matching (exact match + wildcard support) |
| `tests/unit/rfc/safety.test.ts` | Unit tests for allowlist matching logic |
| `tests/unit/rfc/loader.test.ts` | Unit tests for dynamic import handling |
| `tests/integration/rfc.integration.test.ts` | Integration tests (needs SAP system + RFC SDK) |

### Modified files

| File | Change |
|------|--------|
| `src/adt/safety.ts` | Add `OperationType.Rfc = 'G'`, add to write-ops set |
| `src/server/types.ts` | Add `enableRfc`, `rfcAllowedFMs`, `rfcMaxRows` to `ServerConfig` |
| `src/server/config.ts` | Parse new flags + env vars, add `developer-rfc` / `developer-rfc-sql` profiles |
| `src/handlers/intent.ts` | Add `SAPRfc` to `TOOL_SCOPES`, add `handleSAPRfc()` routing |
| `src/handlers/tools.ts` | Add `SAPRfc` tool definition (conditional on `enableRfc` + SDK available) |
| `src/handlers/schemas.ts` | Add Zod schema for SAPRfc input validation |
| `src/server/server.ts` | Conditional RFC client initialization at startup |
| `src/server/audit.ts` | RFC-specific audit fields (FM name, parameter keys) |
| `package.json` | Add `@mcp-abap-adt/sap-rfc-lite` to `optionalDependencies` |

### Not modified

- No changes to any existing ADT operations or tools
- No changes to existing tool behavior when RFC is disabled (the default)
- No new required dependencies — RFC module is optional only
- No changes to existing Docker image or mta.yaml (RFC variants are additive)

---

## 7. Maturity and risk assessment

### Package maturity

| Factor | Assessment | Risk |
|--------|-----------|------|
| Age | 2 weeks old (created 2026-04-01) | High — too new to trust in production |
| Version | 0.1.1 | High — pre-1.0, API may change |
| Stars | 2 | High — no community validation |
| Contributors | 1 | High — bus factor of 1 |
| Downloads | Unknown (very low) | High — not battle-tested |
| Tests | Jest suite exists | Medium — quality/coverage unknown |
| C++ code origin | Derived from SAP's node-rfc | Medium — base code is proven, modernization is new |
| Maintenance | Active (commits in April 2026) | Medium — active now, sustainability unclear |

### Risks

1. **Immature package** — 0.1.1, 2 weeks old, single contributor. Could be abandoned at any time.
2. **Native addon instability** — C++ N-API addons can have memory leaks, segfaults, thread safety issues, or platform-specific bugs that are much harder to debug than pure JS issues.
3. **SAP RFC SDK licensing** — The SDK requires SAP licensing (S-user download). Distributing it in Docker images or CF apps may have legal implications depending on the customer's SAP contract.
4. **Breaking changes** — Pre-1.0 package, API may change without notice.
5. **Security of the C++ code** — Handles SAP Unicode strings, buffer conversions, pointer arithmetic. A bug here could be a memory safety issue. No security audit has been performed.
6. **No connection pooling** — Each call opens/closes a connection, or we must build our own pool. No built-in timeout mechanism.

### Mitigations

1. **Dynamic import isolation** — if the package breaks or is abandoned, ARC-1 still works perfectly (RFC just becomes unavailable)
2. **Pin exact version** in optionalDependencies to prevent surprise upgrades
3. **C++ core is derived from SAP's node-rfc** — the fundamental RFC SDK interaction code is battle-tested across years of SAP usage
4. **Wrap with timeout** — ARC-1 should enforce a configurable timeout per RFC call to prevent indefinite hangs
5. **Test independently** — ARC-1's RFC unit tests should mock the native module; integration tests can verify real behavior

---

## 8. Alternative approaches

### 8.1 Use ADT endpoints where possible

Before reaching for RFC, check if an ADT endpoint covers the use case:

| Scenario | ADT alternative | RFC needed? |
|----------|----------------|-------------|
| Table data | `/sap/bc/adt/datapreview` (current SAPQuery) | Only for 512-byte row limit workaround |
| System info | `/sap/bc/adt/core/discovery` | Only for detailed kernel/DB info |
| Transport ops | `/sap/bc/adt/cts/` (current SAPTransport) | Only for import/release edge cases |
| Background jobs | None | **Yes** |
| Application logs (SLG1) | None | **Yes** |
| Custom Z* FMs | None | **Yes** |
| User authorizations | None | **Yes** |

**Recommendation:** Only integrate RFC for use cases that ADT genuinely cannot cover. Don't duplicate existing ADT capabilities over RFC.

### 8.2 WebSocket RFC via HTTP

Some SAP systems expose RFC over WebSocket (ICF service `/sap/bc/srt/rfc/sap/`). This would avoid the native dependency entirely but:
- Not universally available
- Less documented
- Different authentication flow
- Would need a custom implementation

This is a long-term alternative worth investigating if the native dependency proves too burdensome.

---

## 9. Recommendation

### Short term: Do not integrate yet

1. **Package is too young** (2 weeks, v0.1.1) — wait for it to stabilize (target: v0.5+ with proven stability)
2. **No concrete user request** — build when someone explicitly needs RFC access
3. **High security risk** — this document captures the complete design for when the time comes
4. **Deployment complexity** — native dependency adds friction to every deployment model

### Medium term: Integrate as opt-in experimental feature

When the package matures and a user explicitly requests it:

1. Add as optional dependency with dynamic import
2. Implement the **allowlist-only** safety model (section 4)
3. Start with a recommended "safe starter" allowlist in documentation:
   ```
   RFC_SYSTEM_INFO, RFC_GET_FUNCTION_INTERFACE, DDIF_FIELDINFO_GET
   ```
4. Require explicit admin opt-in at every level (config + allowlist + scope)
5. Separate Docker image variant for RFC-enabled deployments
6. Do not support RFC in BTP CF buildpack mode — recommend Docker instead

### Configuration when ready

```bash
# Minimal RFC setup — system info only
ARC1_ENABLE_RFC=true
ARC1_RFC_ALLOWED_FMS="RFC_SYSTEM_INFO,RFC_GET_FUNCTION_INTERFACE"
ARC1_PROFILE=developer-rfc

# With table reads
ARC1_ENABLE_RFC=true
ARC1_RFC_ALLOWED_FMS="RFC_READ_TABLE,RFC_SYSTEM_INFO,DDIF_FIELDINFO_GET,RFC_GET_FUNCTION_INTERFACE"
ARC1_RFC_MAX_ROWS=500
ARC1_PROFILE=developer-rfc

# Via CLI
arc-1 --enable-rfc --rfc-allowed-fms "RFC_READ_TABLE,RFC_SYSTEM_INFO" --rfc-max-rows 500
```

### Key design principles

1. **Off by default** — RFC never activates without explicit `ARC1_ENABLE_RFC=true`
2. **Allowlist-only, no blocklist** — with ~500K FMs, a blocklist is a losing game. Admin must explicitly list every allowed FM.
3. **Empty allowlist = block all** — no "allow everything" shortcut exists
4. **Dedicated scope** — `rfc` scope is separate from `read`/`write`/`sql`, not implied by any other scope
5. **No tool listing when disabled** — `SAPRfc` tool is invisible when RFC is off or SDK is missing
6. **Full audit trail** — every RFC call logged with FM name, user identity, parameter keys
7. **Optional dependency** — ARC-1 installs and runs without RFC SDK present. Zero impact on non-RFC users.

---

## 10. Open questions

1. **Connection pooling?** sap-rfc-lite has no pool. Should ARC-1 manage a connection pool (reuse connections across calls), or open/close per call? Pooling is more efficient but adds complexity and statefulness.
2. **Timeout per call?** RFC calls can hang indefinitely if the SAP system is unresponsive. Should ARC-1 enforce a configurable timeout wrapper (e.g., `ARC1_RFC_TIMEOUT=30000`)?
3. **FM metadata introspection?** Could `RFC_GET_FUNCTION_INTERFACE` be called automatically when the LLM requests an unknown FM, to show available parameters? Or should `describe` be an explicit action?
4. **BTP principal propagation for RFC?** HTTP-based PP uses `SAP-Connectivity-Authentication` header through Cloud Connector. RFC PP would need SNC with X.509 certificates — different mechanism entirely. Is this a requirement or can RFC use a shared service account?
5. **Parameter value logging?** Currently proposed to log keys only (values could contain PII, passwords, salary data). Should there be an opt-in `ARC1_RFC_LOG_VALUES=true` for full audit trails?
6. **Wildcard allowlist safety?** Should wildcards like `Z*` or `BAPI_*` be allowed, or should the allowlist require exact FM names only? Wildcards are convenient but could accidentally allow dangerous FMs added later.
7. **Should RFC calls be read-only by default?** Could introduce `ARC1_RFC_READ_ONLY=true` that intersects the allowlist with a curated list of known read-only FMs. Adds complexity but reduces risk.
