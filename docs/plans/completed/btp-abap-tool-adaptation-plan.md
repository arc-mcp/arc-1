# BTP ABAP Environment — Tool Adaptation Plan

**Status:** Phases 1–3 implemented and tested. Phase 4 (JWT Bearer Exchange) deferred.
**PR:** #18 (`feat/btp-abap-direct-oauth-v2`)
**Date:** 2026-04-01
**Last updated:** 2026-04-01

## Executive Summary

When ARC-1 connects to a BTP ABAP Environment (Steampunk), several tools have wrong descriptions, unavailable operations, or fundamentally different behavior compared to on-premise. This document defines:

1. How to **detect** BTP vs on-premise (auto + manual override)
2. What **changes per tool** are needed
3. **Auth options** for all BTP scenarios
4. **Implementation plan** with phases
5. **Testing strategy**

---

## 1. System Detection

### 1.1 Primary: Component-Based Auto-Detection (recommended)

The `/sap/bc/adt/system/components` endpoint (already called for ABAP release detection) returns different components:

| Component | On-Premise | BTP ABAP |
|-----------|-----------|----------|
| `SAP_BASIS` | Yes | Yes |
| `SAP_ABA` | Yes | **No** |
| `SAP_CLOUD` | **No** | Yes |
| `DW4CORE` | No | Yes |

**Detection rule:** If `SAP_CLOUD` is in components → BTP. If `SAP_ABA` is in components → on-premise.

**Reliability:** 99%. Zero additional HTTP calls (reuses existing feature probe).

**fr0ster tried auto-detection via `/sap/bc/adt/core/discovery` and removed it as unreliable.** Our approach is different — we use components, not discovery XML. Component names are definitive.

### 1.2 Secondary: Manual Override (env var / CLI flag)

```
SAP_SYSTEM_TYPE=btp|onprem|auto  (default: auto)
--system-type btp|onprem|auto
```

This allows users to force the system type when auto-detection fails or for testing.

### 1.3 Where to Store

Extend `ResolvedFeatures` in `src/adt/types.ts`:

```typescript
export interface ResolvedFeatures {
  // ... existing fields ...
  systemType?: 'btp' | 'onprem';  // auto-detected from SAP_CLOUD component
}
```

Detected in `features.ts` → `detectAbapRelease()` (same HTTP call, zero overhead).
Cached in `intent.ts` → `cachedFeatures` (already exists).
Surfaced via `SAPManage` action="probe" / action="features".

---

## 2. Tool Adaptation Matrix

### 2.1 SAPRead — Types to Adapt

| Type | On-Premise | BTP | Action |
|------|-----------|-----|--------|
| `PROG` | Works | **Not available** (no executable programs) | Hide on BTP. Suggest: "Use CLAS with IF_OO_ADT_CLASSRUN for console apps" |
| `CLAS` | Works | Works | No change |
| `INTF` | Works | Works | No change |
| `FUNC` | Works | **Limited** (only custom/released RFC FMs) | Keep but adjust description: "On BTP: only custom and released function modules" |
| `FUGR` | Works | **Limited** (same as FUNC) | Keep but adjust description |
| `INCL` | Works | **Not available** (INCLUDE forbidden in ABAP Cloud) | Hide on BTP |
| `DDLS` | Works | Works (CDS is the primary data model) | No change, maybe promote in description |
| `BDEF` | Works | Works (RAP is the core model) | No change, maybe promote |
| `SRVD` | Works | Works | No change |
| `TABL` | Works | Works (definition only, custom tables) | Adjust description: "On BTP: custom tables only" |
| `VIEW` | Works | **Not available** (classic DDIC views forbidden) | Hide on BTP. Suggest: "Use DDLS (CDS views) instead" |
| `TABLE_CONTENTS` | Works | **Restricted** (custom tables and released CDS only) | Keep but adjust description: "On BTP: only custom tables and released CDS entities. SAP standard tables blocked." |
| `DEVC` | Works | Works | No change |
| `SOBJ` | Works | May not exist on BTP | Keep but mark as "on-premise focused" |
| `SYSTEM` | Works | Works (empty user field) | No change |
| `COMPONENTS` | Works | Works (different components) | No change |
| `MESSAGES` | Works | **Limited** (custom message classes only) | Adjust description |
| `TEXT_ELEMENTS` | Works | **Not available** (no programs) | Hide on BTP |
| `VARIANTS` | Works | **Not available** (no programs) | Hide on BTP |

**Summary:** Remove from enum on BTP: `PROG`, `INCL`, `VIEW`, `TEXT_ELEMENTS`, `VARIANTS`. Adjust descriptions for: `FUNC`, `FUGR`, `TABL`, `TABLE_CONTENTS`, `MESSAGES`.

### 2.2 SAPSearch — Adjustments

| Aspect | Change |
|--------|--------|
| Description | Add: "On BTP ABAP: only released SAP objects and custom Z/Y objects are returned. Classic programs, includes, and DDIC views are not searchable." |
| `objectType` filter | Some types (PROG, INCL) won't return results on BTP — not an error, just empty |
| Source code search | Works (SAP_BASIS >= 7.51 always true on BTP) |

### 2.3 SAPWrite — Adjustments

| Aspect | Change |
|--------|--------|
| Types | Remove `PROG` and `INCL` on BTP |
| Description | Add: "On BTP: only Z*/Y* namespace. Must use ABAP Cloud language version. No classic programs or includes." |
| Package | `$TMP` works but transport behavior differs (gCTS) |

### 2.4 SAPActivate — No Change

Works the same on both. No adaptation needed.

### 2.5 SAPNavigate — Minor Adjustments

| Aspect | Change |
|--------|--------|
| `definition` | Works, but only for released objects |
| `references` | Works, but scope limited to released/custom objects |
| Description | Add note about released API scope on BTP |

### 2.6 SAPQuery — Major Changes

| Aspect | On-Premise | BTP |
|--------|-----------|-----|
| Free SQL | Works on all tables | **Blocked** — only custom tables and released CDS entities |
| Description | "Query DD02L, DD03L, TADIR, TFDIR..." | **Completely wrong for BTP.** Must say: "On BTP: only custom Z/Y tables and released CDS views. SAP standard tables (MARA, VBAK, DD02L, etc.) are blocked." |
| Suggested tables | TADIR, DD02L, DD03L, SWOTLV, TFDIR | None of these work on BTP |

**Options:**
- A) Hide SAPQuery entirely on BTP (too restrictive)
- B) Keep but rewrite description for BTP context (recommended)
- C) Add BTP-specific query suggestions (released CDS views like I_LANGUAGE, I_COUNTRY)

### 2.7 SAPTransport — Fundamental Differences

| Aspect | On-Premise | BTP |
|--------|-----------|-----|
| `list` | Lists CTS requests | Works (CTS requests exist) |
| `get` | Gets request details | Works |
| `create` | Creates request | Works (but release triggers gCTS push, not TMS export) |
| `release` | Releases to TMS | **Different** — triggers Git push to software component repo |
| Import | Via TMS | **Not via ADT** — via Manage Software Components app or cTMS |
| Description | "Manage CTS transport requests" | Should explain gCTS context |

**Recommendation:** Keep all actions but rewrite description: "On BTP: transport release triggers gCTS push to the software component's Git repository. Import into target systems is done via the Manage Software Components app or Cloud Transport Management Service, not via this tool."

### 2.8 SAPLint — No Change

Runs client-side (abaplint). No BTP-specific issues.

### 2.9 SAPDiagnose — Minor Adjustments

| Action | Status on BTP | Notes |
|--------|--------------|-------|
| `syntax` | Works | |
| `unittest` | Works | May need `SAP_COM_0735` communication scenario for external API access |
| `atc` | Works | Default variant: `ABAP_CLOUD_DEVELOPMENT_DEFAULT`. May need `SAP_COM_0901` |

### 2.10 SAPContext — Adjustments

| Aspect | Change |
|--------|--------|
| Description | Currently says "SAP standard objects excluded." On BTP, SAP standard IS most of what exists initially. Change to: "On BTP: SAP released objects are included since they form the primary development API surface." |
| Filtering | Consider not excluding CL_ABAP_*/IF_ABAP_* on BTP since custom code directly depends on them |
| Types | Remove `PROG` and `FUNC` from enum on BTP (or handle gracefully) |

### 2.11 SAPManage — Enhancements

| Aspect | Change |
|--------|--------|
| `probe` | Add `systemType` to response |
| `features` | Add `systemType` to cached response |
| Description | Add: "Returns system type (btp/onprem) for understanding available capabilities" |

---

## 3. Authentication Options for BTP

### 3.1 Current: Service Key + Authorization Code (Browser OAuth)

**Status:** Implemented in PR #18. Tested and working.

| Aspect | Detail |
|--------|--------|
| **Use case** | Local developer use (stdio transport) |
| **Flow** | Service key → browser opens → user logs in → token cached |
| **Pros** | User identity preserved, per-user auth, simple setup |
| **Cons** | Requires interactive browser, not suitable for CI/CD or deployed scenarios |
| **Config** | `SAP_BTP_SERVICE_KEY_FILE` or `SAP_BTP_SERVICE_KEY` |

### 3.2 Planned: JWT Bearer Token Exchange (Deployed HTTP)

**Status:** Not implemented. Needed for deployed MCP server on BTP CF.

| Aspect | Detail |
|--------|--------|
| **Use case** | ARC-1 deployed on CF, user authenticates via MCP client → XSUAA, then token is exchanged for ABAP-scoped token |
| **Flow** | MCP client user JWT → `jwt-bearer` grant exchange → ABAP access token |
| **Pros** | Per-user identity, no browser needed at runtime, works for deployed multi-user |
| **Cons** | Requires Destination Service or manual XSUAA config, more complex setup |
| **Implementation** | Similar to existing PP code in `btp.ts` but targeting BTP ABAP XSUAA instead of Connectivity Service |

### 3.3 Not Recommended: Client Credentials

**Status:** Tested, returns 401 on ADT endpoints.

ADT requires user context. Client Credentials grant produces a "technical" token without user identity — ABAP rejects it. **Do not implement.**

### 3.4 Not Recommended: Password Grant (ROPC)

**Status:** Not tested. XSUAA may support it but it's deprecated in OAuth 2.1.

| Aspect | Detail |
|--------|--------|
| **Use case** | CI/CD pipelines without browser |
| **Flow** | username + password + client_id + client_secret → token |
| **Cons** | Deprecated, may not work with all IdPs, requires storing user passwords |

### 3.5 Future: X.509 Certificate Authentication

**Status:** Not implemented.

| Aspect | Detail |
|--------|--------|
| **Use case** | Enterprise, certificate-based auth instead of client secret |
| **Flow** | mTLS with client certificate during token exchange |
| **Cons** | Complex cert management, enterprise-only |

### 3.6 Existing: BTP Destination Service (On-Premise via Cloud Connector)

**Status:** Already implemented in `src/adt/btp.ts`. Works for on-premise SAP behind Cloud Connector.

| Aspect | Detail |
|--------|--------|
| **Use case** | ARC-1 on CF → Cloud Connector → on-premise SAP |
| **Not for** | Direct BTP ABAP connection (no Cloud Connector involved) |

### 3.7 Auth Decision Matrix

| Scenario | Recommended Auth | Config | Status |
|----------|-----------------|--------|--------|
| **Local dev → BTP ABAP** | Service Key + Auth Code (browser) | `SAP_BTP_SERVICE_KEY_FILE` | ✅ Implemented |
| **Local dev → On-Premise** | Basic Auth | `SAP_USER` + `SAP_PASSWORD` | ✅ Implemented |
| **CF deployed → On-Premise** | Destination Service + PP | `SAP_BTP_DESTINATION` + `SAP_BTP_PP_DESTINATION` | ✅ Implemented |
| **CF deployed → BTP ABAP (multi-user)** | JWT Bearer Exchange | Future: Destination Service with OAuth2SAMLBearerAssertion | ⏭️ Deferred (rare scenario, low demand) |
| **CI/CD → BTP ABAP** | Communication User + Client Credentials (via Comm. Arrangement) | Future: `SAP_BTP_COMM_USER` | ⏭️ Deferred (different use case) |

### 3.8 Communication Arrangements for CI/CD

For non-interactive (CI/CD) access to BTP ABAP, you need:

1. Create a **Communication System** in the ABAP admin launchpad
2. Create a **Communication User** (technical user)
3. Create **Communication Arrangements** for needed scenarios:
   - `SAP_COM_0901` — ATC check runs
   - `SAP_COM_0735` — ABAP Unit test execution
   - `SAP_COM_0763` — ATC configuration
4. The Communication User gets a client ID/secret that works with Client Credentials grant
5. This is a **different service key** from the ABAP Environment service key — it's scoped to specific APIs

---

## 4. Implementation Plan

### Phase 1: System Detection ✅ Completed

**Files:** `src/adt/types.ts`, `src/adt/features.ts`, `src/server/types.ts`, `src/server/config.ts`

1. Add `systemType?: 'btp' | 'onprem'` to `ResolvedFeatures`
2. Extend `detectAbapRelease()` to also detect `systemType` from SAP_CLOUD component (same HTTP call)
3. Add `systemType: 'auto' | 'btp' | 'onprem'` to `ServerConfig` with env var `SAP_SYSTEM_TYPE` and CLI flag `--system-type`
4. Pass manual override to `probeFeatures()` (if not `auto`, skip detection)
5. Surface `systemType` in `SAPManage` probe/features response

**Tests:** Unit test for detection logic, integration test on BTP system.

### Phase 2: Tool Description Adaptation ✅ Completed

**Files:** `src/handlers/tools.ts`

1. `getToolDefinitions(config)` already receives `ServerConfig`
2. Add `systemType` parameter (from cached features or config override)
3. On BTP:
   - Remove `PROG`, `INCL`, `VIEW`, `TEXT_ELEMENTS`, `VARIANTS` from SAPRead enum
   - Adjust descriptions for `FUNC`, `FUGR`, `TABLE_CONTENTS`, `MESSAGES`
   - Rewrite SAPQuery description (no SAP standard table suggestions)
   - Rewrite SAPTransport description (gCTS context)
   - Adjust SAPContext description (don't exclude SAP standard on BTP)
   - Adjust SAPWrite types (remove PROG, INCL)
4. Tool definitions become dynamic based on system type

**Challenge:** `getToolDefinitions()` is called at server registration time, before the first tool call and feature probe. Options:
- A) Probe features during server startup (before tool registration) — adds latency but gives correct tools from the start
- B) Use manual override (`SAP_SYSTEM_TYPE=btp`) for immediate correct tools, auto-detect adjusts on first probe — may show wrong tools initially
- C) Register all tools but adapt behavior/descriptions in handler — tools are always registered, handler adds BTP context to responses
- D) Re-register tools after first probe — MCP SDK may not support this cleanly

**Recommendation:** Option C (adapt in handler) as default, Option A (probe on startup) as opt-in via flag. This way:
- All tools are always registered (no confusion about missing tools)
- Handler adds a BTP context note to responses when relevant (e.g., "Note: On BTP ABAP, classic programs are not available. Use CLAS with IF_OO_ADT_CLASSRUN instead.")
- If `SAP_SYSTEM_TYPE=btp` is set explicitly, tool definitions are adapted at registration time

### Phase 3: Handler Behavior Adaptation ✅ Completed

**Files:** `src/handlers/intent.ts`

1. Check `cachedFeatures.systemType` in handlers
2. For blocked operations on BTP, return helpful error messages instead of cryptic 400/404:
   - `SAPRead PROG` on BTP → "Executable programs (reports) are not available on BTP ABAP Environment. Use CLAS with IF_OO_ADT_CLASSRUN for console applications."
   - `SAPQuery` with SAP standard table → "Free SQL queries against SAP standard tables are restricted on BTP ABAP. Only custom Z/Y tables and released CDS entities can be queried."
   - `SAPRead TABLE_CONTENTS` with SAP standard table → Similar message
3. For adapted operations, add context notes:
   - `SAPTransport release` → append note about gCTS behavior

### Phase 4: JWT Bearer Exchange for Deployed Scenarios ⏭️ Deferred

**Files:** `src/adt/oauth.ts`, `src/adt/btp.ts`, `src/server/server.ts`

1. When ARC-1 runs in HTTP transport mode with a BTP ABAP service key
2. Extract user JWT from MCP request headers (already validated by XSUAA middleware)
3. Exchange user JWT for ABAP-scoped token via `jwt-bearer` grant
4. Use resulting token as Bearer auth to BTP ABAP
5. Per-user identity preserved without browser

**Why deferred:** BTP ABAP adoption is still niche. Most users will use the local dev flow (service key + browser OAuth) which is already implemented. The CF deployed multi-user → BTP ABAP scenario is rare today — very few orgs have all the prerequisites. A shared service key (single technical user) works as a functional workaround. JWT Bearer Exchange can be implemented in a separate PR when there's actual demand. See the [connectivity report](btp-abap-environment-connectivity.md#10-deferred-jwt-bearer-exchange) for full reasoning.

---

## 5. Testing Strategy

### 5.1 Unit Tests (always run in CI)

| Test | Description |
|------|-------------|
| System type detection | Mock components response, verify BTP/onprem detection |
| Tool definitions for BTP | Verify PROG/INCL/VIEW removed from SAPRead enum |
| Tool definitions for onprem | Verify all types present |
| Handler BTP messages | Verify helpful error for PROG read on BTP |
| Config parsing | Verify `SAP_SYSTEM_TYPE` env var and CLI flag |

### 5.2 BTP Integration Tests (local only, existing + new)

| Test | Description |
|------|-------------|
| System type detected as 'btp' | Probe features, verify systemType='btp' |
| SAPRead PROG returns helpful error | Not a 500, but a user-friendly message |
| SAPRead INCL returns helpful error | Same |
| SAPQuery on SAP table returns helpful error | Not cryptic 400, but explains restriction |
| SAPTransport list works | Verify transport API works on BTP |
| SAPManage probe returns systemType | Verify 'btp' in response |
| Tool descriptions adapted | If SAP_SYSTEM_TYPE=btp, verify enum changes |

### 5.3 On-Premise Integration Tests (existing, verify no regression)

| Test | Description |
|------|-------------|
| System type detected as 'onprem' | Probe features, verify systemType='onprem' |
| All SAPRead types work | No types removed |
| SAPQuery works on standard tables | DD02L, T000, etc. |
| SAPTransport standard behavior | CTS, not gCTS |

### 5.4 Manual E2E Scenarios

| Scenario | How to Test |
|----------|-------------|
| Claude Desktop → BTP ABAP | Use service key config, ask "read program RSHOWTIM" → verify helpful error |
| Claude Desktop → On-premise | Use basic auth, ask "read program RSHOWTIM" → verify works |
| Cursor → BTP ABAP | Same as Claude Desktop test |
| MCP Inspector → BTP ABAP | Verify tool list shows BTP-adapted descriptions |

---

## 6. Common Use Cases and Recommendations

### 6.1 Developer building RAP apps on BTP (most common)

**Config:**
```json
{
  "mcpServers": {
    "arc-1": {
      "command": "arc1",
      "env": {
        "SAP_BTP_SERVICE_KEY_FILE": "~/.config/arc-1/service-key.json"
      }
    }
  }
}
```

**Expected behavior:**
- SAPSearch finds released classes, CDS views, BDEFs
- SAPRead reads class source, DDLS, BDEF, SRVD
- SAPWrite creates/updates Z* classes and CDS views
- SAPQuery queries custom tables and released CDS entities
- SAPLint checks ABAP Cloud rules
- SAPDiagnose runs ATC with ABAP_CLOUD_DEVELOPMENT_DEFAULT variant
- SAPTransport creates/releases requests (gCTS pushes to Git)
- No PROG, INCL, VIEW types shown in tool descriptions

### 6.2 Developer maintaining on-premise custom code

**Config:**
```json
{
  "mcpServers": {
    "arc-1": {
      "command": "arc1",
      "env": {
        "SAP_URL": "http://sap:50000",
        "SAP_USER": "DEVELOPER",
        "SAP_PASSWORD": "..."
      }
    }
  }
}
```

**Expected behavior:** All tools with full descriptions (no restrictions).

### 6.3 CI/CD pipeline running ATC checks on BTP

**Config:** Communication Arrangement with `SAP_COM_0901`.

**Not yet implemented.** Would need Communication User auth support.

### 6.4 Deployed ARC-1 on CF connecting to BTP ABAP (multi-user)

**Config:** JWT Bearer Exchange via Destination Service.

**Not yet implemented.** Phase 4 of implementation plan.

---

## 7. Competitor Comparison

| Feature | ARC-1 (implemented) | fr0ster/mcp-abap-adt | Eclipse ADT |
|---------|---------------------|---------------------|-------------|
| Detection method | Auto (SAP_CLOUD component) + manual override | Manual only (`SAP_SYSTEM_TYPE` env var) | Discovery XML |
| Tool filtering | Adapt descriptions + handler behavior | Remove tools entirely (`available_in`) | Hide UI elements |
| Error handling | Helpful BTP-specific messages with alternatives | Silent tool removal | Greyed-out options |
| System types | `btp`, `onprem`, `auto` | `cloud`, `onprem`, `legacy` | Implicit |
| Auth options | Service Key + Auth Code (browser) | 9 auth providers | SAML/OAuth |

**ARC-1's advantage:** Auto-detection (fr0ster removed theirs) + helpful error messages with actionable alternatives (better than silent removal) + adapted tool descriptions that guide LLMs away from unavailable operations.

---

## 8. Files Changed Per Phase

### Phase 1 (Detection)
| File | Change |
|------|--------|
| `src/adt/types.ts` | Add `systemType` to `ResolvedFeatures` |
| `src/adt/features.ts` | Extend `detectAbapRelease()` for systemType |
| `src/server/types.ts` | Add `systemType` to `ServerConfig` |
| `src/server/config.ts` | Parse `SAP_SYSTEM_TYPE` env var |
| `src/handlers/intent.ts` | Surface in SAPManage response |
| `tests/unit/adt/features.test.ts` | Detection unit tests |

### Phase 2 (Tool Descriptions)
| File | Change |
|------|--------|
| `src/handlers/tools.ts` | Dynamic tool definitions based on systemType |
| `tests/unit/handlers/tools.test.ts` | Verify BTP vs onprem tool sets |

### Phase 3 (Handler Behavior)
| File | Change |
|------|--------|
| `src/handlers/intent.ts` | BTP-aware error messages and context notes |
| `tests/unit/handlers/intent.test.ts` | Verify BTP error messages |
| `tests/integration/btp-abap.integration.test.ts` | New handler behavior tests |

### Phase 4 (JWT Bearer Exchange — separate PR)
| File | Change |
|------|--------|
| `src/adt/oauth.ts` | Add `jwtBearerExchange()` function |
| `src/server/server.ts` | Wire up per-request token exchange |
| `src/server/http.ts` | Extract user JWT from MCP request |
