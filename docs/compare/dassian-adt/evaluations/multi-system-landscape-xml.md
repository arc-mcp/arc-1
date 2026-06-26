# Evaluation: Multi-System via SAP UI Landscape XML

**Priority**: Medium  
**Source**: DassianInc/dassian-adt commit `a5bcbfc` (2026-04-12)  
**ARC-1 Component**: Not implemented (P3: OPS-03 Multi-System Routing)

## What They Did

Added `Map<string, SystemEntry>` to store multiple SAP systems. Configuration:

1. **`SAP_SYSTEMS_FILE`** — path to JSON file: `[{url, user, password, client, language, authType}, ...]`
2. **`SAP_SYSTEMS`** — inline JSON string (same format)
3. **`SAP_SYSTEMS_TEMPLATE`** — systems without credentials (for browser OAuth login per-system)
4. **`SAPUILandscapeGlobal.xml`** — SAP Logon Pad configuration file auto-discovery

**LLM Integration:**  
When multiple systems configured, `sap_system_id` is injected as a **required** parameter into every tool's JSON schema. The LLM must route each call to the correct system.

**Per-system handler instantiation:**  
Each system entry gets its own set of handler objects (SourceHandlers, ObjectHandlers, etc.) plus its own ADTClient. This duplicates the entire handler tree per system.

## SAP UI Landscape XML Format

The `SAPUILandscapeGlobal.xml` file (SAP Logon Pad config format) auto-populates system entries:
```xml
<Landscape>
  <Services>
    <Service name="S4H_DEV" url="http://s4hdev:50000" systemid="S4H"/>
    <Service name="S4H_QAS" url="http://s4hqas:50000" systemid="S4H"/>
  </Services>
</Landscape>
```

## ARC-1's Equivalent Approach

ARC-1 uses **one-instance-per-system model**:
- Each deployment instance connects to one SAP system
- BTP Destination Service names different systems
- Multiple instances can be orchestrated via MCP client config (different `serverUrl`)

**BTP-native alternative:** A single ARC-1 instance with multiple BTP Destination entries could serve multiple systems via `SAP_BTP_DESTINATION` routing. This is the enterprise-grade equivalent.

## Assessment

| Aspect | Dassian Approach | ARC-1 Approach |
|--------|-----------------|----------------|
| Configuration | Single instance, JSON config | Multiple instances OR BTP Destinations |
| LLM disambiguation | `sap_system_id` in every tool call | Separate MCP server entries per system |
| BTP support | No (env-var based only) | Yes (Destination Service) |
| Audit trail | Single log, all systems | Per-system instance logs |
| Safety gates | Shared config for all systems | Per-instance config (more granular) |

## Decision

**Not planned for ARC-1 (P3: OPS-03).** The BTP Destination Service approach is more enterprise-grade and secure. For on-premise, multiple instances is operationally cleaner than one instance with credential management for multiple systems. The SAP UI Landscape XML approach is pragmatic for small/medium on-premise setups but doesn't scale to BTP Principal Propagation.

Related: FEAT-29 P3 Backlog includes "Multi-System Routing".
