# feat: ActivateObjects tool for group/mass activation

> **PR**: [#51](https://github.com/fr0ster/mcp-abap-adt/pull/51) | **Issue**: [#49](https://github.com/fr0ster/mcp-abap-adt/issues/49)
> **Merged**: 2026-04-13 | **Release**: v5.0.7 (+ v5.0.8 post-merge fix)
> **Priority**: Medium | **Decision**: no-action (ARC-1 already has equivalent)

---

## What fr0ster Added

### Problem Statement (Issue #49)

No standalone activation tool existed. The only way to activate was via `Create*`/`Update*` handlers with `activate: true`, but:
1. `CreateDomain` didn't activate on on-prem (#47)
2. `UpdateDomain` failed when domain references were inactive
3. No way to group-activate multiple objects together

`GetInactiveObjects` returned 11 inactive objects but no tool could activate them.

### Solution: 14 New Tools

| Tool | Tier | Purpose |
|------|------|---------|
| `ActivateObjects` | High | Group/mass activation (any types mixed) |
| `ActivateObjectLow` | Low | Same, raw ADT types (`CLAS/OC`, `PROG/P`) |
| `ActivateDomain` | High | Single domain activation |
| `ActivateDataElement` | High | Single data element activation |
| `ActivateTable` | High | Single table activation |
| `ActivateStructure` | High | Single structure activation |
| `ActivateView` | High | Single CDS view activation |
| `ActivateClass` | High | Single class activation |
| `ActivateInterface` | High | Single interface activation |
| `ActivateProgram` | High | Single program activation |
| `ActivateFunctionModule` | High | Single FM activation |
| `ActivateFunctionGroup` | High | Single FUGR activation |
| `ActivateBehaviorDefinition` | High | Single BDEF activation |
| `ActivateMetadataExtension` | High | Single DDLX activation |

**Post-merge fix (v5.0.8)**: Per-type handlers initially used low-level names (`ActivateDomainLow`) and descriptions (`[low-level] ...`). Fixed to use high-level names and descriptions for LLM discoverability.

### Key Implementation Details

1. **Both high + low delegate to same function**: `handleActivateObjects` → `handleActivateObject` (the low-level handler)
2. **`preaudit` parameter**: Boolean, defaults to `true`. Controls SAP pre-audit before activation.
3. **Response parsing**: Separates warnings vs errors from activation messages, reports activated/checked/generated counts
4. **Auto URI generation**: Converts `{name, type}` to ADT URI automatically
5. **GetInactiveObjects**: Already existed — `GET /sap/bc/adt/activation/inactive` returns list of pending objects

### Their Tool Count Impact

Total tools: 289 → 303 (+14 activation tools). This is the exact pattern ARC-1's intent-based design avoids.

---

## Comparison with ARC-1

### ARC-1's Approach: 1 Tool, 2 Actions

ARC-1 handles all activation via **SAPActivate** with two actions:
- `action: "activate"` — single object
- `action: "batch_activate"` — multiple objects with `objects: [{url, name}]`

Both use the same ADT endpoint (`POST /sap/bc/adt/activation?method=activate&preauditRequested=true`).

### Feature Comparison

| Feature | ARC-1 | fr0ster |
|---------|-------|---------|
| Single activation | ✅ `SAPActivate` | ✅ `ActivateObjects` (1 item) or per-type tool |
| Batch activation | ✅ `SAPActivate batch_activate` | ✅ `ActivateObjects` (N items) |
| SRVB publish | ✅ `SAPActivate publish_service` | ❌ |
| SRVB unpublish | ✅ `SAPActivate unpublish_service` | ❌ |
| `preaudit` control | ❌ Hardcoded `true` | ✅ Optional parameter |
| GetInactiveObjects | ❌ Not implemented | ✅ `GetInactiveObjects` |
| Tool count | 1 | 14 |
| Schema tokens | ~500 | ~7,000+ (14 × ~500) |
| Safety guards | ✅ `checkOperation(OperationType.Activate)` | ❌ No safety system |
| Error parsing | ✅ `extractShortText()` (attr + element) | ✅ `parseActivationResponse()` |

### What ARC-1 Could Adopt

1. **GetInactiveObjects** (Medium priority)
   - Endpoint: `GET /sap/bc/adt/activation/inactive`
   - Returns list of objects pending activation with name, type, URI
   - Natural fit as `SAPRead` action: `inactive_objects` or `SAPDiagnose` action
   - Useful for: LLM workflow "show me what's inactive → batch activate them"
   - Effort: 0.5 day

2. **`preaudit` parameter** (Low priority)
   - ARC-1 hardcodes `preauditRequested=true` which is the safe default
   - Could add as optional parameter on SAPActivate
   - Marginal value — pre-audit is almost always desired
   - Effort: trivial (add query param toggle)

### What ARC-1 Already Does Better

1. **Token efficiency**: 1 tool (~500 tokens) vs 14 tools (~7,000+ tokens)
2. **SRVB publish/unpublish**: fr0ster has no equivalent — critical for RAP stack completion
3. **Safety system**: `checkOperation(OperationType.Activate)` blocks activation in read-only mode
4. **Error extraction**: `extractShortText()` handles both XML attribute and child element formats (discovered during DDIC testing)
5. **Batch with names**: `activateBatch()` accepts `{url, name}` pairs — name helps SAP resolve correctly

### LLM UX Lesson

fr0ster's 14-tool approach optimizes for LLM **discoverability** ("I need to activate a domain → I'll use ActivateDomain"). ARC-1's 1-tool approach optimizes for **token efficiency** and **decision simplicity** ("I need to activate → SAPActivate"). The v5.0.8 post-merge fix (renaming low-level names for discoverability) shows the maintenance burden of the per-type approach.

ARC-1's tool description improvement (PR #86: "ALWAYS prefer batch activation when activating 2+ objects") addresses the discoverability concern without tool proliferation.

---

## Verdict

**No action needed** for the core activation feature — ARC-1's `SAPActivate` already covers single + batch activation with better token efficiency and safety.

**Consider implementing** `GetInactiveObjects` as a new read action — it fills a real workflow gap (see what's pending → batch activate). Added to roadmap as P2.
