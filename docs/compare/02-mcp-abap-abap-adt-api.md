# mario-andreschak/mcp-abap-abap-adt-api

> **Repository**: https://github.com/mario-andreschak/mcp-abap-abap-adt-api
> **Language**: TypeScript | **License**: ISC | **Stars**: ~107
> **Status**: Dormant (last commit Feb 2025, ~13 months inactive)
> **Relationship**: Thin MCP wrapper around `abap-adt-api` npm package (by Marcello Urbani)

---

## Project Overview

A 1:1 MCP wrapper around the `abap-adt-api` npm package (v6.2.0). Every method of that library is exposed as an individual MCP tool, resulting in ~95+ tools with no intent-based abstraction. Uses a BaseHandler pattern with 26 domain-specific handler files.

## Architecture

```
src/
  index.ts           # AbapAdtServer (extends MCP Server), large switch router
  lib/logger.ts      # Logging utility
  types/tools.ts     # ToolDefinition interface
  handlers/          # 26 handler files, each extending BaseHandler
    BaseHandler.ts   # Abstract base with rate limiting, metrics, error handling
    ...26 domain handlers...
```

**Key dependency**: `abap-adt-api` by Marcello Urbani — the entire project delegates to this library. Note: while this MCP wrapper is dormant, the underlying library is **actively maintained** (v8.0.0 released 2026-04-04, with new DDIC write ops, documentation API, and refactoring support). See [`docs/compare/abap-adt-api/`](abap-adt-api/) for detailed commit/issue tracking of the library.

## Tool Inventory (~95+ tools)

### Auth (3): login, logout, dropSession
### Object Management (5): objectStructure, searchObject, findObjectPath, objectTypes, reentranceTicket
### Source (2): getObjectSource, setObjectSource
### Lock (2): lock, unLock
### Deletion (1): deleteObject
### Activation (3): activateObjects, activateByName, inactiveObjects
### Registration (3): objectRegistrationInfo, validateNewObject, createObject
### Transport (15): transportInfo, createTransport, hasTransportConfig, transportConfigurations, getTransportConfiguration, setTransportsConfig, createTransportsConfig, userTransports, transportsByConfig, transportDelete, transportRelease, transportSetOwner, transportAddUser, systemUsers, transportReference
### Class (3): classIncludes, classComponents, createTestInclude
### Code Analysis (14): syntaxCheckCode, syntaxCheckCdsUrl, codeCompletion, findDefinition, usageReferences, syntaxCheckTypes, codeCompletionFull, runClass, codeCompletionElement, usageReferenceSnippets, fixProposals, fixEdits, fragmentMappings, abapDocumentation
### Unit Tests (4): unitTestRun, unitTestEvaluation, unitTestOccurrenceMarkers, createTestInclude
### ATC (10): atcCustomizing, atcCheckVariant, createAtcRun, atcWorklists, atcUsers, atcExemptProposal, atcRequestExemption, isProposalMessage, atcContactUri, atcChangeContact
### Git/abapGit (10): gitRepos, gitExternalRepoInfo, gitCreateRepo, gitPullRepo, gitUnlinkRepo, stageRepo, pushRepo, checkRepo, remoteRepoInfo, switchRepoBranch
### Debugger (13): debuggerListeners, debuggerListen, debuggerDeleteListener, debuggerSetBreakpoints, debuggerDeleteBreakpoints, debuggerAttach, debuggerSaveSettings, debuggerStackTrace, debuggerVariables, debuggerChildVariables, debuggerStep, debuggerGoToStack, debuggerSetVariableValue
### Refactoring (3): extractMethodEvaluate, extractMethodPreview, extractMethodExecute
### Rename (3): renameEvaluate, renamePreview, renameExecute
### Discovery (7): featureDetails, collectionFeatureDetails, findCollectionByUrl, loadTypes, adtDiscovery, adtCoreDiscovery, adtCompatibiliyGraph
### DDIC (4): annotationDefinitions, ddicElement, ddicRepositoryAccess, packageSearchHelp
### Query (2): tableContents, runQuery
### Feed (2): feeds, dumps
### Node (2): nodeContents, mainPrograms
### PrettyPrinter (3): prettyPrinterSetting, setPrettyPrinterSetting, prettyPrinter
### Revision (1): revisions
### Service Binding (3): publishServiceBinding, unPublishServiceBinding, bindingDetails
### Trace (9): tracesList, tracesListRequests, tracesHitList, tracesDbAccess, tracesStatements, tracesSetParameters, tracesCreateConfiguration, tracesDeleteConfiguration, tracesDelete

## Authentication

| Method | Supported |
|--------|-----------|
| Basic Auth | Yes |
| OIDC/OAuth/JWT | **No** |
| BTP | **No** |
| API Key | **No** |

## Safety/Security

**None.** No read-only mode, no operation filtering, no package restrictions, no audit logging.

## Transport (MCP Protocol)

stdio only. No HTTP or SSE.

## Testing

**Zero tests.** Jest is configured but no test specs exist.

## Known Issues

| Issue | Description | Relevant to ARC-1? |
|-------|-------------|-------------------|
| #4, #6, #9 | getObjectSource truncates large source files | Yes -- verify ARC-1 handles large sources |
| #11 | JSON parse errors in responses | Yes -- ensure robust XML/JSON parsing |
| #10 | Requests XSUAA OAuth 2.0 support | ARC-1 already has OIDC |
| ~95 tools | LLMs struggle with tool selection | ARC-1 solved with intent-based routing |
| No caching | Every request hits SAP | ARC-1 has SQLite + memory cache |

---

## Features This Project Has That ARC-1 Lacks

| Feature | Priority | Effort | Status |
|---------|----------|--------|--------|
| ABAP Debugger (13 tools) | Low | 5d | Not planned — complex, needs WebSocket |
| Full ATC management (exemptions) | Medium | 2d | Open — exemption mgmt useful |
| abapGit integration (10 tools) | Medium | 3d | Open — repo management |
| Refactoring — extract method | Medium | 2d | Open — roadmap FEAT-05, [API ref](abap-adt-api/evaluations/460200a-extract-method.md) |
| Refactoring — rename | Medium | 2d | Open — roadmap FEAT-05 |
| Refactoring — change package | Medium | 1d | Open — [API ref](abap-adt-api/evaluations/a55c8f8-change-package.md) |
| PrettyPrinter | Medium | 0.5d | Open — roadmap FEAT-10 |
| Revision history | Medium | 1d | Open — [API ref](abap-adt-api/evaluations/d3c6940-source-versions.md) |
| Fix proposals / fix edits | High | 2d | Open — [API ref](abap-adt-api/evaluations/issue-37-quickfix.md) |
| abapDocumentation (F1 help) | Medium | 0.5d | Open — [API ref](abap-adt-api/evaluations/7d5c653-abap-documentation.md) |
| DDIC domain/data element write | High | 1d | Open — [API ref](abap-adt-api/evaluations/646bb9b-dtel-doma-write.md) |
| Reentrance ticket | Low | 0.5d | Not planned |
| ADT compatibility graph | Low | 0.5d | Not planned |

### Closed Gaps (ARC-1 now has these)

| Feature | Was Listed As | Implemented In |
|---------|-------------|---------------|
| ~~Trace/perf analysis~~ | Medium, 2d | `src/adt/diagnostics.ts` (SAPDiagnose traces) |
| ~~Service binding read~~ | Medium, 1d | `src/adt/client.ts` (getSrvb) |
| ~~DDIC exploration~~ | Medium, 1d | `src/adt/client.ts` (getDomain, getDataElement, getStructure) |

## Features ARC-1 Has That This Project Lacks

HTTP Streamable, OIDC/JWT auth, BTP support, principal propagation, API key auth, safety system (read-only, op filter, pkg filter, SQL blocking, transport guard), caching (SQLite + memory), abaplint integration, audit logging (multi-sink), MCP elicitation, Docker/npm distribution, 707+ unit tests, intent-based routing (11 tools vs 95+), hyperfocused mode, method-level surgery, context compression.

---

## Changelog & Relevance Tracker

| Date | Change | Relevant? | Action for ARC-1 | Status |
|------|--------|-----------|-------------------|--------|
| 2025-02-27 | MCP wrapper: last commit | N/A | Wrapper appears abandoned | — |

**Note**: The underlying `abap-adt-api` library (not the MCP wrapper) is actively maintained:

| Date | Library Change | Relevant? | Decision | Status |
|------|---------------|-----------|----------|--------|
| 2026-04-05 | v8.0.1 — continued error handling improvements | Low | ARC-1 has own error handling in adt/errors.ts | -- |
| 2026-04-04 | v8.0.0 — improved error handling | Yes | [Verify](abap-adt-api/evaluations/cffc79a-error-handling.md) | Verify |
| 2026-03-03 | v7.1.1 — DDIC domain/data element write, structure/domain support, language attributes | Yes | [Implement DDIC write](abap-adt-api/evaluations/646bb9b-dtel-doma-write.md) | Open |
| 2025-12-19 | v7.1.0 — ABAP documentation API | Yes | [Consider](abap-adt-api/evaluations/7d5c653-abap-documentation.md) | Open |
| 2025-10-05 | v7.0.0 — Change package refactoring | Yes | [Consider](abap-adt-api/evaluations/a55c8f8-change-package.md) | Open |
| 2024-10-26 | v6.2.0 — Extract method refactoring | Yes | [Consider](abap-adt-api/evaluations/460200a-extract-method.md) | Open |
| 2024-05-07 | v6.0.0 — Source version loading | Yes | [Consider](abap-adt-api/evaluations/d3c6940-source-versions.md) | Open |

> **Detailed tracking**: See [`docs/compare/abap-adt-api/`](abap-adt-api/) for per-commit and per-issue evaluations of the underlying library.

_Last updated: 2026-04-27_
