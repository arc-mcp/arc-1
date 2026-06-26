# ADT API Audit: Documentation Accuracy & Unused APIs

**Date:** 2026-04-09
**Scope:** Documentation cross-check against actual API usage, plus evaluation of ADT APIs not currently used by ARC-1

---

## Part 1: Documentation Accuracy Check

### docs/tools.md — Tool Reference

#### SAPRead
- **Accurate:** Types PROG, CLAS, INTF, FUNC, FUGR, INCL, DDLS, DDLX, BDEF, SRVD, SRVB, TABL, VIEW, TABLE_CONTENTS, DEVC, SYSTEM, COMPONENTS, MESSAGES, TEXT_ELEMENTS, VARIANTS all match the code
- **Missing from docs:** 
  - `STRU` type (structure definitions) — supported in code (`client.getStructure()`) but not listed in the tool reference table
  - `DOMA` type (domain metadata) — supported in code (`client.getDomain()`) but not listed
  - `DTEL` type (data element metadata) — supported in code (`client.getDataElement()`) but not listed
  - `TRAN` type (transaction metadata) — supported in code (`client.getTransaction()`) but not listed
  - `SOBJ` type (BOR business objects) — supported in code via SQL lookup but not listed
  - `BSP` type (BSP/UI5 filestore) — supported in code (`client.listBspApps()`, `getBspAppStructure()`, `getBspFileContent()`) but not listed
  - `method` parameter for CLAS type — allows reading a specific method or `*` for listing all methods, not documented
  - `expand_includes` parameter for FUGR type — expands include source inline, not documented
- **Inaccurate:**
  - The `include` parameter for CLAS says "For CLAS: testclasses, definitions, implementations, macros" but doesn't mention that `main` is also valid
  - For DDLS: the `include` parameter can also take value `"elements"` to extract CDS view elements — not documented

#### SAPSearch
- **Missing from docs:**
  - `searchType` parameter — supports `"object"` (default) and `"source_code"` for text search within ABAP source
  - `objectType` parameter — filter source code search by object type
  - `packageName` parameter — filter source code search by package
- **Note:** The docs only describe object search, not the source code search capability

#### SAPDiagnose
- **Significantly inaccurate:** The documentation lists actions that don't match the code:
  - Listed: `dumps`, `dump_detail`, `traces`, `trace_detail`, `sql_traces`, `call_graph`, `object_structure`
  - Actual: `syntax`, `unittest`, `atc`, `dumps`, `traces`
  - `dump_detail` is not a separate action — it's `dumps` with an `id` parameter
  - `trace_detail` is not a separate action — it's `traces` with an `id` parameter and `analysis` sub-parameter
  - `sql_traces`, `call_graph`, `object_structure` don't exist in the code
  - `syntax`, `unittest`, `atc` are missing from docs entirely
- **Correct parameters for SAPDiagnose:**
  | Parameter | Type | Description |
  |-----------|------|-------------|
  | `action` | string | `syntax`, `unittest`, `atc`, `dumps`, or `traces` |
  | `name` | string | Object name (for syntax/unittest/atc) |
  | `type` | string | Object type (for syntax/unittest/atc) |
  | `id` | string | Dump ID (for dumps detail) or Trace ID (for traces detail) |
  | `user` | string | Filter dumps by user |
  | `maxResults` | number | Max dumps to return |
  | `variant` | string | ATC check variant |
  | `analysis` | string | For traces with id: `hitlist`, `statements`, or `dbAccesses` |

#### SAPManage
- **Inaccuracy:** "Blocked when --read-only is active" — this is wrong. SAPManage `probe` and `features` and `cache_stats` are read-only operations that should work regardless of read-only mode. Looking at the code, SAPManage requires `write` scope but the probe operation itself only makes read requests.

#### SAPContext
- **Mostly accurate** — docs correctly describe deps and usages modes
- **Missing:** `DDLS` type is supported for CDS-specific dependency analysis with a dedicated `compressCdsContext()` path, not mentioned in docs
- **Missing:** depth parameter max value is 3, correctly documented

#### SAPNavigate
- **Mostly accurate**
- **Note:** The `references` action documentation correctly describes the fallback behavior for older SAP systems

### CLAUDE.md — Codebase Structure

#### Key Files Table
- **Accurate** for most entries
- **Missing entry:** `src/context/cds-deps.ts` — CDS-specific dependency extraction
- **Missing entry:** `src/adt/btp.ts` — mentioned in structure but not in key files table for BTP-related tasks

#### Architecture: Request Flow
- **Accurate** — correctly describes the auth chain, safety checks, and request routing

#### Code Patterns
- **Accurate** — CRUD pattern, handler pattern, safety check pattern all match actual code

---

## Part 2: Unused ADT APIs — Evaluation for ARC-1

### Tier 1: High Value — Should Implement

#### 1. Class Hierarchy — `GET /sap/bc/adt/oo/classes/{name}/hierarchy`
- **What it does:** Returns class inheritance chain (superclass, subclasses, implemented interfaces)
- **Value for ARC-1:** High. When LLM is working with a class, understanding the inheritance hierarchy is critical for:
  - Knowing which methods are inherited vs overridden
  - Understanding polymorphism and method dispatch
  - Finding where interface methods are implemented
- **Effort:** Small — simple GET with XML parsing
- **Recommendation:** Add as SAPNavigate action `"hierarchy"` or SAPRead include `"hierarchy"`

#### 2. Object Where-Used in Package — `GET /sap/bc/adt/repository/informationsystem/usedObjects`
- **What it does:** Returns what objects are used BY a given object (forward dependencies via ADT, not AST)
- **Value for ARC-1:** Medium-High. Currently SAPContext extracts dependencies via abaplint AST parsing. The ADT endpoint could validate/supplement this:
  - Catches dependencies abaplint might miss (e.g., dynamic calls, macros)
  - Works for object types abaplint doesn't support (DDIC tables, data elements)
- **Effort:** Medium — GET request, parse objectReference response
- **Recommendation:** Consider as SAPNavigate action `"uses"` or enhancement to SAPContext

#### 3. Quick Fix / Code Assist — `POST /sap/bc/adt/quickfix/proposals`
- **What it does:** Returns SAP's suggested fixes for syntax errors (like IDE quick fixes)
- **Value for ARC-1:** High. After syntax check finds errors, the LLM could use SAP's own fix suggestions:
  - Add missing DATA declarations
  - Fix type mismatches
  - Add missing IMPORTING/EXPORTING parameters
- **Effort:** Medium — POST with error context, parse proposal response
- **Recommendation:** Add as SAPDiagnose action `"quickfix"` — call after syntax check errors

#### 4. Type Information — `POST /sap/bc/adt/abapsource/typeinformation`
- **What it does:** Returns the complete type of a variable/expression at a given position
- **Value for ARC-1:** Medium-High. The LLM often needs to know what type a variable has:
  - Critical for writing correct ABAP code (e.g., knowing if something is TABLE, STRUCTURE, or REF TO)
  - Helps with code completion and understanding complex nested types
- **Effort:** Medium — POST with source + position, parse type response
- **Recommendation:** Add as SAPNavigate action `"type_info"`

### Tier 2: Medium Value — Consider Implementing

#### 5. abapGit Repository Operations — `GET/POST /sap/bc/adt/abapgit/repos`
- **What it does:** List, clone, pull, push abapGit repositories
- **Value for ARC-1:** Medium. For teams using abapGit:
  - List what repos are linked
  - Trigger pull/push operations
  - Status of repo synchronization
- **Effort:** Medium-Large — multiple endpoints, complex workflows
- **Recommendation:** Add when abapGit integration is requested. Feature probe already exists.

#### 6. Enhancement Implementations — `GET /sap/bc/adt/enhancements/implementations/{name}`
- **What it does:** Read BADIs, enhancement spots, enhancement implementations
- **Value for ARC-1:** Medium. For understanding customizations:
  - Finding what enhancements modify standard SAP behavior
  - Reading enhancement implementation source code
- **Effort:** Small — similar to other read operations
- **Recommendation:** Add as SAPRead type `"ENHO"` (enhancement implementation)

#### 7. Message Class Details — Enhanced message class endpoint
- **What it does:** The current `/sap/bc/adt/msg/messages/{class}` returns raw XML. Could be parsed into structured format with message number, text, severity.
- **Value for ARC-1:** Medium. Currently returns raw XML — parsing would help LLM understand message texts better.
- **Effort:** Small — add XML parser for existing endpoint
- **Recommendation:** Parse the existing response into structured JSON

#### 8. ABAP Doc — `GET /sap/bc/adt/oo/classes/{name}/abapdoc`
- **What it does:** Returns ABAP documentation comments for class methods
- **Value for ARC-1:** Medium. Helps LLM understand method purpose and parameters without reading full source.
- **Effort:** Small
- **Recommendation:** Add as SAPRead include option `"abapdoc"`

#### 9. Data Element Search Help — `GET /sap/bc/adt/ddic/dataelements/{name}/searchhelp`
- **What it does:** Returns the search help configuration and possible values for a data element
- **Value for ARC-1:** Low-Medium. Useful for understanding what values a field can take.
- **Effort:** Small
- **Recommendation:** Low priority — the data element metadata already includes search help name

### Tier 3: Low Value — Not Recommended Now

#### 10. Debugger APIs — `/sap/bc/adt/debugger/`
- **What it does:** Set breakpoints, step through code, inspect variables
- **Value for ARC-1:** Low for MCP context. Debugging is interactive and doesn't fit the tool-call paradigm well.
- **Recommendation:** Skip. Use SAPDiagnose(action="dumps") for post-mortem debugging.

#### 11. Coverage Analysis — `/sap/bc/adt/abapunit/testruns` with `coverage active="true"`
- **What it does:** Returns code coverage data from unit test execution
- **Value for ARC-1:** Low-Medium. Could help LLM understand test quality.
- **Effort:** Small — change `active="false"` to `active="true"` in existing request
- **Recommendation:** Low priority but trivial to implement. Add as optional parameter to unittest action.

#### 12. Number Range Objects — `/sap/bc/adt/nummber_range/...`
- **What it does:** Manage number range objects and intervals
- **Value for ARC-1:** Low. Very specific use case.
- **Recommendation:** Skip unless specifically requested.

#### 13. Lock Management — `/sap/bc/adt/discovery/enqueues`
- **What it does:** View and manage SAP lock entries
- **Value for ARC-1:** Low. Could help diagnose locked objects.
- **Recommendation:** Skip. The CRUD lock/unlock flow already handles this.

#### 14. User Management — `/sap/bc/adt/system/users`
- **What it does:** List SAP users and their roles
- **Value for ARC-1:** Very low. Security concern — shouldn't expose user lists.
- **Recommendation:** Skip.

#### 15. Repository Tree — `/sap/bc/adt/repository/nodestructure` (full tree)
- **What it does:** Browse the full ABAP repository tree
- **Value for ARC-1:** Low. Package contents (`DEVC` type) already covers this use case.
- **Recommendation:** Skip — current package browsing is sufficient.

---

## Summary: Recommended Actions

### Documentation Fixes (High Priority)
1. **Fix SAPDiagnose docs** — completely rewrite to match actual actions (syntax, unittest, atc, dumps, traces) — ✅ **DONE**
2. **Add missing SAPRead types** — STRU, DOMA, DTEL, TRAN, SOBJ, BSP to the tools.md table — ✅ **DONE**
3. **Add SAPSearch source_code mode** — document searchType, objectType, packageName parameters — ✅ **DONE**
4. **Fix SAPManage read-only note** — probe/features/cache_stats are read operations — ✅ **DONE**

### New API Implementations (Prioritized)
1. Class hierarchy (`/hierarchy`) — High value, small effort — ✅ **DONE** (implemented via SEOMETAREL SQL; ADT `/hierarchy` endpoint returned 404 on A4H 7.52)
2. Quick fix proposals — High value, medium effort — tracked as FEAT-12
3. Type information — Medium-high value, medium effort — **Deferred** (endpoint returned 404 on A4H 7.52; tracked as FEAT-36)
4. Parse message class XML — Medium value, trivial effort
5. Enhancement implementations — Medium value, small effort
6. Test coverage (optional param) — Low priority, trivial effort — tracked as FEAT-31

### Implementation Notes (2026-04-10)

**Documentation fixes applied:**
- `docs/tools.md`: SAPDiagnose section rewritten with correct 5 actions + full parameter table; SAPRead updated with 6 missing types + 2 missing params; SAPSearch source_code mode documented; SAPManage read-only note corrected; SAPNavigate hierarchy action added
- `CLAUDE.md`: Added `cds-deps.ts` to structure tree, added 2 missing Key Files entries

**Class hierarchy implementation:**
- Added `hierarchy` action to SAPNavigate (intent.ts, tools.ts, schemas.ts)
- Uses SQL queries against SEOMETAREL table: reltype=1 → interface, reltype=2 → inheritance
- Returns `ClassHierarchy` type: `{ className, superclass, interfaces, subclasses }`
- SQL injection prevention via regex whitelist on class name input
- 5 unit tests added (intent.test.ts)
- ADT REST endpoint `/sap/bc/adt/oo/classes/{name}/hierarchy` returned 404 on test system (A4H 7.52)

**Type information (deferred):**
- `POST /sap/bc/adt/abapsource/typeinformation` returned 404 on A4H 7.52
- Also tested `/codeelementinformation` — 404
- Likely available on newer SAP NetWeaver or S/4HANA versions
- Tracked as FEAT-36 for future implementation
