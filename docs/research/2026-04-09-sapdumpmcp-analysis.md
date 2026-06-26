# Analysis: sapdumpmcp — Relevance to ARC-1

**Date:** 2026-04-09
**Repo:** https://github.com/marcellourbani/sapdumpmcp
**Author (of repo):** Marcello Urbani
**License:** MIT
**npm:** `sapdumpmcp` v1.1.0
**Status:** Research Complete

---

## 1. What sapdumpmcp Does

sapdumpmcp is a lightweight MCP server focused exclusively on **SAP short dump (ST22) analysis**. It exposes three tools to MCP clients (Claude Desktop, GitHub Copilot, etc.):

| Tool | Description |
|------|-------------|
| `list_sap_dumps` | Lists recent ABAP short dumps with ID, timestamp, error type, and program |
| `read_sap_dump_html` | Returns raw HTML representation of a single dump (thorough but noisy) |
| `read_sap_dump_sections` | Returns parsed, section-filtered dump summary (focused on specific chapters) |

The killer feature is the **chapter-based section filtering** in `read_sap_dump_sections`. It defines 29 named chapters (e.g., `Short_Text`, `What_happened`, `Source_Code_Extract`, `Active_Calls/Events`) and lets the LLM request only the relevant ones, dramatically reducing token usage for dump analysis.

### Architecture

```
MCP Client
  │
  ▼
sapdumpmcp (MCP server)
  │
  ├─ mcpserver.ts  → 3 tool definitions
  ├─ dump.ts       → DumpService (uses abap-adt-api for list, raw HTTP for detail)
  ├─ dumpparser.ts → XML + formatted text parser with chapter extraction
  ├─ httpserver.ts  → Express + StreamableHTTP transport
  └─ stdioserver.ts → Stdio transport
```

**Key dependency:** [`abap-adt-api`](https://github.com/marcellourbani/abap-adt-api) (also by Marcello Urbani) — a comprehensive TypeScript ADT client library used in the [VS Code ABAP Remote FS extension](https://github.com/marcellourbani/vscode_abap_remote_fs). sapdumpmcp uses it only for the `dumps()` listing, then drops down to raw HTTP for detail retrieval because `abap-adt-api` doesn't expose the `/formatted` endpoint.

### ADT Endpoints Used

| Endpoint | Method | Accept Header | Purpose |
|----------|--------|---------------|---------|
| `/sap/bc/adt/runtime/dumps` | GET | `application/atom+xml;type=feed` | List dumps (Atom feed) |
| `/sap/bc/adt/runtime/dump/{id}` | GET | `application/vnd.sap.adt.runtime.dump.v1+xml` | Dump XML metadata |
| `/sap/bc/adt/runtime/dump/{id}/formatted` | GET | `text/plain` | Formatted plain text |

---

## 2. Feature-by-Feature Comparison with ARC-1

### What ARC-1 Already Has (Superset)

ARC-1's `SAPDiagnose` tool with `action: "dumps"` already covers the same ADT endpoints:

| Capability | ARC-1 | sapdumpmcp |
|------------|-------|------------|
| List dumps | Yes — `listDumps()` in `diagnostics.ts` | Yes — via `abap-adt-api` `.dumps()` |
| Filter by user | Yes — `user` param | No |
| Limit results | Yes — `maxResults` param | No (returns all) |
| XML metadata | Yes — `parseDumpDetail()` | Yes — `parsexmlDump()` |
| Formatted text | Yes — fetches `/formatted` | Yes — fetches `/formatted` |
| Chapter extraction | **No** — returns raw `formattedText` as blob | **Yes** — parses into named chapters |
| Section filtering | **No** — full dump always returned | **Yes** — LLM picks sections |
| HTML dump view | No | Yes — `read_sap_dump_html` |
| Termination URI | Yes — extracts source location link | No |
| Parallel requests | Yes — `Promise.all` for XML + text | No — sequential |
| Safety checks | Yes — `checkOperation()` | No |
| BTP support | Yes — OAuth, destinations | No |
| Trace analysis | Yes — hitlist, statements, DB accesses | No |
| ATC / syntax check | Yes — via same `SAPDiagnose` tool | No |
| Unit tests | Yes — via same `SAPDiagnose` tool | No |

### What sapdumpmcp Has That ARC-1 Lacks

**One significant feature: structured chapter parsing and section-selective retrieval.**

sapdumpmcp's `dumpparser.ts` does two things ARC-1 doesn't:

1. **Chapter mapping**: Maps `kap0`–`kap29` chapter codes to human-readable names (`Short_Text`, `What_happened`, `Source_Code_Extract`, etc.)

2. **Text splitting**: Takes the monolithic formatted text dump, splits it at the line offsets declared in the XML metadata's `<dump:chapter line="N">`, cleans up each section, and returns only the requested chapters.

This is meaningful because a full formatted dump can be 150KB+ of text. The LLM typically only needs 5-8 sections (Short_Text, What_happened, Error_analysis, Source_Code_Extract, Active_Calls/Events). Section filtering can reduce tokens by 60-80%.

---

## 3. What ARC-1 Can Learn / Adopt — Detailed Evaluation

### 3.1 Chapter-Based Dump Section Filtering (High Value)

**Recommendation: Adopt this pattern into ARC-1's `getDump()` / `SAPDiagnose` handler.**

#### The Problem Today

When the LLM calls `SAPDiagnose(action="dumps", id="...")`, ARC-1 returns the full `DumpDetail` as JSON. The `formattedText` field is a single string containing the entire formatted dump — typically **1,800+ lines** and **100-180KB** of text. A real example from sapdumpmcp's test fixtures (dump1_summary.txt) is 1,805 lines / 180KB. After JSON serialization, this becomes an enormous MCP tool response.

The LLM doesn't need 90% of this text. For diagnosing a crash, it typically needs:
- **Short_Text** — 2 lines (the error headline)
- **What_happened** — 5-10 lines (the error narrative)
- **Error_analysis** — 10-15 lines (exception chain, root cause)
- **Source_Code_Extract** — 30-50 lines (code around the crash point)
- **Active_Calls/Events** — 20-40 lines (the ABAP call stack)

That's ~100-120 lines vs 1,800. The rest — system environment, kernel stack, memory details, database info, ABAP control blocks — is noise for AI analysis.

#### What sapdumpmcp Does

sapdumpmcp's `dumpparser.ts` splits the text using metadata from the XML response. The XML `<dump:chapter>` elements include a `line` attribute indicating where each chapter starts in the formatted text:

```xml
<dump:chapter name="kap5" title="System environment" category="ST22_CATEGORIES_INST"
              line="88" chapterOrder="1" categoryOrder="2"/>
<dump:chapter name="kap6" title="User and Transaction" category="ST22_CATEGORIES_INST"
              line="142" chapterOrder="2" categoryOrder="3"/>
```

The parser sorts chapters by line number, slices the text at those boundaries, strips the repeating title/separator lines, and creates a `Map<string, Chapter>` keyed by human-readable names like `Source_Code_Extract`.

#### How It Fits into ARC-1's Current Architecture

This is a clean enhancement that touches exactly 4 files, all within existing patterns:

**1. `src/adt/types.ts` — Extend the types**

Current state:
```typescript
interface DumpChapter {
  name: string;   // e.g., "kap8"
  title: string;  // e.g., "Source Code Extract"
  category: string;
}
interface DumpDetail {
  chapters: DumpChapter[];
  formattedText: string;  // monolithic blob
}
```

Proposed:
```typescript
interface DumpChapter {
  name: string;
  title: string;
  category: string;
  line: number;       // NEW: start line in formatted text
  chapterOrder: number; // NEW: ordering
}
interface DumpDetail {
  // ... existing fields ...
  chapters: DumpChapter[];
  formattedText: string;            // keep for backward compat
  sections: Record<string, string>; // NEW: chapter name → text content
}
```

**2. `src/adt/diagnostics.ts` — Parse `line` attribute, split text**

The existing `parseDumpDetail()` regex already matches `<dump:chapter>` — it just needs two more capture groups (`line` and `chapterOrder`) and a text-splitting function after XML parsing. The `splitFormattedText()` function follows sapdumpmcp's approach: sort chapters by line, slice the text between boundaries, map `kap*` codes to readable names, and apply the backslash line-joining for `Source_Code_Extract`.

Changes are ~60 lines: expand the chapter regex, add the chapter name map constant, add `splitFormattedText()`, add `joinSplitLines()`.

**3. `src/handlers/schemas.ts` — Add `sections` param to SAPDiagnoseSchema**

```typescript
export const SAPDiagnoseSchema = z.object({
  action: z.enum(['syntax', 'unittest', 'atc', 'dumps', 'traces']),
  // ... existing params ...
  sections: z.array(z.string()).optional(), // NEW
});
```

**4. `src/handlers/intent.ts` — Filter sections in the dumps handler**

```typescript
case 'dumps': {
  const id = args.id as string | undefined;
  if (id) {
    const detail = await getDump(client.http, client.safety, id);
    const sections = args.sections as string[] | undefined;
    if (sections) {
      // Return only requested sections
      const filtered = Object.fromEntries(
        sections.filter(s => s in detail.sections).map(s => [s, detail.sections[s]])
      );
      return textResult(formatDumpSections(detail, filtered));
    }
    // Smart default: return key debugging sections
    const defaults = ['Short_Text', 'What_happened', 'Error_analysis',
                      'Source_Code_Extract', 'Active_Calls/Events'];
    const filtered = Object.fromEntries(
      defaults.filter(s => s in detail.sections).map(s => [s, detail.sections[s]])
    );
    return textResult(formatDumpSections(detail, filtered));
  }
  // ... list dumps (unchanged) ...
}
```

The output format would be structured plain text (not JSON) for readability:

```
OBJECTS_OBJREF_NOT_ASSIGNED in program ZABAPGIT (CX_SY_REF_IS_INITIAL)
Timestamp: 2025-06-03T23:21:06 | User: DEVELOPER
Termination: /sap/bc/adt/programs/programs/ZABAPGIT/source/main#start=12345

--- Short_Text ---
Access using a 'ZERO' object reference is not possible.

--- What_happened ---
Error in the ABAP application program.
The current ABAP program "ZABAPGIT" had to be terminated because...

--- Source_Code_Extract ---
    (cleaned, line-joined source)

--- Active_Calls/Events ---
    (ABAP call stack)
```

#### Effort Estimate

| Task | Effort | Risk |
|------|--------|------|
| Add `line` + `chapterOrder` to chapter parsing | 30 min | None — just regex expansion |
| Chapter name registry (`kap*` → readable names) | 15 min | None — static data from sapdumpmcp |
| `splitFormattedText()` function | 1 hour | Low — straightforward text splitting |
| `joinSplitLines()` for source code | 15 min | None — direct port |
| Schema update (add `sections` param) | 15 min | None |
| Handler update (filter + format) | 1 hour | Low |
| Tool description update | 15 min | None |
| Unit tests | 1.5 hours | Low — use sapdumpmcp's test fixture as reference |
| **Total** | **~5 hours** | **Low** |

#### Token Savings Quantified

Using sapdumpmcp's example dump (1,805 lines, ~180KB):

| Approach | Approximate Size | Tokens (~4 chars/token) |
|----------|-----------------|------------------------|
| Full `formattedText` blob (current ARC-1) | ~180KB | ~45,000 tokens |
| 5 default sections (proposed) | ~15-25KB | ~4,000-6,000 tokens |
| Token reduction | | **85-90%** |

This is even better than the 60-80% estimate in the initial analysis because the full dump includes extremely verbose sections like kernel stack traces and ABAP control blocks.

### 3.2 Source Code Extract Line Joining (Low Effort, High Value)

sapdumpmcp's `joinSplitLines()` function handles a subtle formatting issue: the ST22 formatted text wraps long source lines with trailing backslashes. Without joining, the source code extract is broken across lines in a way that confuses LLMs.

Real example from the test fixture (lines 833-834 of the formatted dump):
```
dw.sapA4H_D00;0xc409cd;[S](rabax(char16_t const*, char16_t const*, int, char16_t const*, void con\
st*) [clone .cold]+0x1021)[0x55cb618409cd]
```

Without joining, the LLM sees this as two separate entries. The fix is a 15-line utility:

```typescript
function joinSplitLines(lines: string[]): string[] {
  const res: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    while (line.endsWith('\\') && lines[i + 1]?.match(/^[^\s]/)) {
      line = line.slice(0, -1) + lines[i + 1];
      i++;
    }
    res.push(line);
  }
  return res;
}
```

This should be applied to both `Source_Code_Extract` and `Active_Calls_in_SAP_Kernel` chapters where continuation lines appear. It's included naturally in the chapter-splitting work.

### 3.3 Chapter Name Registry (Reference Data)

sapdumpmcp defines a complete chapter code → name mapping with all 29 known dump sections. This is useful reference data:

| Code | Section Name |
|------|-------------|
| `kap0` | Short_Text |
| `kap1` | What_happened |
| `kap2` | What_can_you_do |
| `kap3` | Error_analysis |
| `kap4` | How_to_correct_the_error |
| `kap5` | System_environment |
| `kap6` | User_and_Transaction |
| `kap7` | Information_on_where_terminated |
| `kap8` | Source_Code_Extract |
| `kap9` | Contents_of_system_fields |
| `kap10` | Chosen_Variables |
| `kap11` | Active_Calls/Events |
| `kap12` | Internal_notes |
| `kap13` | Active_Calls_in_SAP_Kernel |
| `kap14` | List_of_ABAP_programs_affected |
| `kap16` | Directory_of_Application_Tables |
| `kap19` | ABAP_Control_Blocks |
| `kap21` | Spool_Error_Information |
| `kap22` | Application_Calls |
| `kap23` | Application_Information |
| `kap24` | Termination_Point_Information_in_transformation |
| `kap25` | Section_of_Source_Code_in_transformation_changed |
| `kap26` | VMC_Java_Trace |
| `kap27` | Lock_Shared_Objects |
| `kap28` | Chain_of_Exception_Objects |
| `kap29` | Database_Interface_Information |
| `kap6a` | Server-Side_Connection_Information |
| `kap6b` | Client-Side_Connection_Information |
| `kap6c` | AMC_Context_Information |
| `kap6d` | APC_Context_Information |

---

## 4. What ARC-1 Should NOT Adopt

### 4.1 `abap-adt-api` as a Dependency

sapdumpmcp depends on `abap-adt-api` (v6.2.1), which itself pulls in `axios`, `fp-ts`, `io-ts`, `html-entities`, and `sprintf-js`. ARC-1 intentionally maintains its own ADT HTTP layer (`src/adt/http.ts`) with `undici`, giving it:

- Direct control over CSRF token lifecycle
- Stateful session management (lock→modify→unlock)
- BTP Destination Service + Connectivity Proxy integration
- Principal propagation per-user sessions
- Custom cookie handling (Netscape format)

Adopting `abap-adt-api` would add ~500KB of dependencies, introduce a second HTTP layer, and lose all the above. **Not worth it.**

However, `abap-adt-api` is a valuable **reference** for discovering ADT endpoints. It covers areas ARC-1 may explore in the future: debugger API, abapGit integration, CDS views, refactoring operations, revisions.

### 4.2 HTML Dump Rendering

sapdumpmcp's `read_sap_dump_html` tool returns raw HTML from the dump endpoint. This is a poor fit for LLM consumption — HTML dumps are 10-30KB of markup that wastes tokens. The section-filtered plain text approach is strictly better for AI clients. ARC-1 should not add an HTML dump variant.

### 4.3 Per-Session SAP Connections via HTTP Headers

sapdumpmcp passes SAP credentials via HTTP headers (`abap-server`, `abap-user`, `abap-password`) per-request. This is a simpler but less secure model than ARC-1's approach (shared config + optional principal propagation). Not applicable.

---

## 5. The `abap-adt-api` Library as a Reference

While ARC-1 shouldn't depend on it, `abap-adt-api` v8.0.1 is the most complete open-source TypeScript ADT client (148 versions since 2019, 1K weekly downloads). It covers endpoints ARC-1 may want to explore:

| Module | ADT Capability | ARC-1 Status |
|--------|---------------|--------------|
| `feeds.ts` | Feed-based listings (dumps, etc.) | Covered differently |
| `debugger.ts` | ABAP Debugger API (breakpoints, step, inspect) | Not covered |
| `abapgit.ts` | abapGit repository management | Not covered |
| `refactor.ts` | Code refactoring (rename, extract, move) | Not covered |
| `revisions.ts` | Object version history | Not covered |
| `cds.ts` | CDS view operations | Partially covered |
| `discovery.ts` | ADT service discovery | Not covered (uses feature detection) |
| `objectcreator.ts` | Object creation templates | Covered (different approach) |
| `activate.ts` | Mass activation | Covered |
| `atc.ts` | ATC checks | Covered |
| `search.ts` | Object search | Covered |

### 5.1 Deep Dive: `cds.ts` — CDS View Operations

The `cds.ts` module in `abap-adt-api` exposes 5 distinct CDS-related endpoints. Below is a function-by-function analysis of what each does, what ARC-1 already covers, and what the gaps are.

#### `syntaxCheckCDS(url, mainUrl?, content?)`

**Endpoint:** `POST /sap/bc/adt/checkruns?reporters=abapCheckRun`
**What it does:** Runs a syntax check on a CDS entity by POSTing a `checkobjects+xml` body with optional inline source content (base64-encoded). Returns `SyntaxCheckResult[]` with errors/warnings/line numbers.

**ARC-1 status:** Partially covered. ARC-1's `SAPDiagnose` with `action: "syntax"` runs syntax checks via `POST /sap/bc/adt/programs/programs/{name}/source/main` (the general ABAP syntax check endpoint). For CDS (DDLS), ARC-1 uses the object-URL-based syntax check in `devtools.ts`, which submits the object URL to `/sap/bc/adt/checkruns`. The key difference is that `abap-adt-api` supports passing **inline modified source** (before saving) for CDS syntax checks, while ARC-1's syntax check only validates the saved/active version. This inline-check capability is not currently needed for ARC-1's MCP flow (the LLM writes first, then checks), but could be useful for a "dry-run syntax check" feature.

**Verdict:** No gap for current workflows. Nice-to-have for future "check before write" scenario.

#### `annotationDefinitions()`

**Endpoint:** `GET /sap/bc/adt/ddic/cds/annotation/definitions`
**What it does:** Returns the full catalog of valid CDS annotation definitions (all `@` annotations the system knows about). This is the metadata for annotation code completion.

**ARC-1 status:** Not covered. ARC-1 has no endpoint for CDS annotation discovery. When an LLM writes CDS views with annotations (`@UI`, `@ObjectModel`, `@Consumption`, etc.), it relies on its training data for valid annotation names and structures.

**Verdict:** Medium value. Useful for a CDS code completion / validation feature. Could be exposed via `SAPRead` with a new include like `type="DDLS", include="annotations"`, returning the system's valid annotation catalog. Reduces LLM hallucination of nonexistent annotations. Would be especially valuable on BTP where the annotation set differs from on-premise.

#### `ddicElement(path, getTargetForAssociation?, getExtensionViews?, getSecondaryObjects?)`

**Endpoint:** `GET /sap/bc/adt/ddic/ddl/elementinfo?path=...`
**What it does:** Returns deep DDIC element metadata for a CDS view column path (e.g., `I_SALESORDER/SalesOrder`). Returns:
- Column-level DDIC properties: data type, length, decimals, labels (short/medium/long/heading), whether it's a key
- Data element reference
- CDS annotations per element
- Recursive child elements for nested structures
- Association target resolution (`getTargetForAssociation`)

This is the **column-level metadata** API — the equivalent of F2 (element info) in ADT Eclipse.

**ARC-1 status:** Not covered. ARC-1 can read full DDLS source code via `SAPRead(type="DDLS")` and extract CDS elements via `SAPRead(type="DDLS", include="elements")` using regex-based extraction from DDL source. But this is syntactic — it gives field names and aliases, not the resolved DDIC metadata (data types, labels, annotations). The `ddicElement` API provides the **semantic** information that the DDL source alone cannot reveal (resolved types through view stacks, inherited annotations, data element labels).

**Verdict:** High value. This is the missing piece for FEAT-33 (CDS Impact Analysis) on the roadmap. Exposing this could:
- Give the LLM resolved field types/labels without reading intermediate views
- Enable annotation-aware CDS development (show what annotations are active on a field, including inherited ones)
- Support Fiori Elements development by revealing `@UI` annotation inheritance

**Fit in ARC-1:** Natural extension to `SAPRead` — `type="DDLS", include="element_info", name="I_SALESORDER"` with an optional `path` parameter for a specific column. Alternatively, extend `SAPNavigate` for CDS element metadata.

#### `ddicRepositoryAccess(path)`

**Endpoint:** `GET /sap/bc/adt/ddic/ddl/ddicrepositoryaccess?datasource=...`
**What it does:** Resolves a CDS entity name to its underlying DDIC object references — maps the CDS world to the DDIC world. Returns URI, type, name, and path for each referenced object. Supports single-path and batch multi-path queries.

**ARC-1 status:** Not covered directly, but ARC-1's `SAPContext` with CDS dependency extraction (`extractCdsDependencies()` in `cds-deps.ts`) does a regex-based version of this — parsing DDL source to find `FROM`, `ASSOCIATION TO`, `COMPOSITION` references. The `ddicRepositoryAccess` API would give the **authoritative** dependency graph from SAP rather than regex inference.

**Verdict:** Medium value. Could replace or augment the regex-based CDS dependency extraction in `SAPContext`. The regex approach works well for direct DDL source references, but the API would catch dependencies that regex misses (e.g., view extensions, secondary objects). However, adding a server roundtrip for something the regex already handles acceptably may not be worth it.

#### `publishServiceBinding(name, version)` / `unpublishServiceBinding(name, version)`

**Endpoint:** `POST /sap/bc/adt/businessservices/odatav2/publishjobs` (and `unpublishjobs`)
**What it does:** Publishes or unpublishes an OData service binding (SRVB) — the "Publish" button in ADT Eclipse. Returns severity, shortText, longText response. This is the final step in the RAP development workflow: define entity (DDLS) → define behavior (BDEF) → define service (SRVD) → bind service (SRVB) → **publish**.

**ARC-1 status:** Not covered. ARC-1 can read SRVB status (including publish status) via `SAPRead(type="SRVB")`, and it can create/update DDLS, DDLX, BDEF, SRVD. But the publish/unpublish step is missing. This means the LLM can build the entire RAP stack but cannot make the OData service actually available.

**Verdict:** High value. This completes the RAP end-to-end workflow. Already planned as phase 2 in `docs/plans/completed/2026-04-09-phase2-publish-srvb.md`. The `abap-adt-api` implementation confirms:
- The endpoint path: `/sap/bc/adt/businessservices/odatav2/publishjobs`
- Required parameters: `servicename` (URL-encoded) and `serviceversion`
- The XML body structure (a simple `publishData` envelope)
- It's an OData V2-specific endpoint (V4 may use a different path)

**Fit in ARC-1:** Belongs in `SAPManage` or `SAPWrite`. Natural candidate for `SAPManage(action="publish_service", name="Z_MY_SRVB", version="0001")`. Needs safety guard (write operation) and transport handling.

### 5.2 Deep Dive: `revisions.ts` — Source Version History

The `revisions.ts` module implements ADT's version history API. This is already on the ARC-1 roadmap as **FEAT-20** (P2, S effort).

#### How It Works

**Step 1 — Resolve the version link:**
```
Object structure (GET /sap/bc/adt/.../{object})
  → links[] → find rel="http://www.sap.com/adt/relations/versions"
  → follow the href to get the versions feed URL
```

For classes, version links live on individual includes (main, definitions, implementations, etc.), not the class root. The `getRevisionLink()` function handles this by looking up the correct include within the class structure.

**Step 2 — Fetch versions feed:**
```
GET {versionsUrl}
Accept: application/atom+xml;type=feed
```

Returns an Atom feed where each `atom:entry` represents a version:
- `atom:content @src` → URI to fetch that version's source code
- `atom:title` → version title (e.g., "Active", "Inactive", transport number)
- `atom:updated` → timestamp
- `atom:author/atom:name` → who saved it
- `atom:link @adtcore:name` → transport request number

**Result type:**
```typescript
interface Revision {
  uri: string;          // Source URI to fetch this version's content
  date: string;         // When saved
  author: string;       // Who saved
  version: string;      // Transport request or version ID
  versionTitle: string; // Human-readable label
}
```

#### ARC-1 Relevance

**What it enables:**
- "Show me the last 5 versions of this class" — version listing
- "What changed in the last transport?" — fetch two versions, diff them
- "Revert to the version before my change" — fetch old source, write it back
- "Who changed this and when?" — audit trail per object

**Competitive context:** vibing-steampunk added 3 version history tools in April 2026 (list versions, compare versions, get specific version). Both VSP and abap-adt-api now have this. ARC-1 is behind here.

**Fit in ARC-1:** Clean fit into `SAPRead` or `SAPNavigate`:

Option A — Extend `SAPRead`:
```json
{ "type": "CLAS", "name": "ZCL_MY_CLASS", "include": "versions" }
```
Returns the version listing. Then:
```json
{ "type": "CLAS", "name": "ZCL_MY_CLASS", "include": "version", "version": "T-00001234" }
```
Returns that version's source code.

Option B — Extend `SAPNavigate`:
```json
{ "action": "versions", "type": "CLAS", "name": "ZCL_MY_CLASS" }
```

**Implementation path:**
1. Add `objectStructure()` call to get links (ARC-1 doesn't currently have a general object-structure fetcher — it goes straight to source endpoints)
2. Parse the versions Atom feed (similar to existing dump/trace Atom parsers in `diagnostics.ts`)
3. Fetch individual version source by URI
4. For class includes, resolve the correct include link

**Key insight from `abap-adt-api`:** The version link resolution requires the object structure's `links[]` array. ARC-1 currently doesn't fetch object structures except for SRVB parsing. Adding a general `getObjectStructure()` method would unlock both revisions and other link-based features (like the refactoring relations).

**Effort estimate:** S (1-2 days). The Atom feed parsing is a solved pattern in ARC-1 (`parseDumpList`, `parseTraceList`). The main work is the object structure fetcher and include-aware link resolution.

### 5.3 Deep Dive: `refactor.ts` — Code Refactoring Operations

The `refactor.ts` module is the most complex in `abap-adt-api` (~500 lines). It implements three ADT refactoring operations plus the quickfix API. This maps to ARC-1 roadmap items **FEAT-05** (P3, L effort) and **FEAT-12** (P1, S effort).

#### Operations Implemented

**1. Quick Fix Proposals + Apply (`fixProposals` / `fixEdits`)**

**Endpoint:** `POST /sap/bc/adt/quickfixes/evaluation` (proposals) and `POST /sap/bc/adt/quickfixes/{id}` (apply)

**Flow:**
1. After a syntax check or ATC finding identifies a problem at a specific location (uri + line + column), call `fixProposals()` with the source URI, current source body, and position
2. SAP returns a list of `FixProposal` objects — each with a description, a fix URI, and `userContent` (opaque state for the fix engine)
3. To apply a fix, call `fixEdits()` with the chosen proposal + current source → SAP returns `Delta[]` (text replacements with ranges)

**ARC-1 relevance:** This is **FEAT-12** (P1, "High — safer than LLM-guessed fixes"). The fix proposal API is the single most impactful refactoring feature because:
- It chains with ARC-1's existing syntax check and ATC: check → get proposals → apply fix
- It's far safer than having the LLM guess corrections
- The response is structured deltas (range + old text + new text), perfect for programmatic application

**Fit in ARC-1:** Extends `SAPDiagnose` or gets a new action in `SAPWrite`:
```json
{ "action": "quickfix", "type": "CLAS", "name": "ZCL_FOO", "line": 42, "column": 10 }
```
Returns proposals, then:
```json
{ "action": "apply_quickfix", "type": "CLAS", "name": "ZCL_FOO", "proposal_index": 0 }
```
Applies the fix (lock → apply delta → unlock → activate).

**2. Rename Symbol (`renameEvaluate` / `renamePreview` / `renameExecute`)**

**Endpoint:** `POST /sap/bc/adt/refactorings?step=evaluate|preview|execute&rel=.../rename`

**Three-step flow:**
1. **Evaluate** — Given a source position (uri + line + column range), SAP identifies the symbol and returns a `RenameRefactoringProposal`: old name, new name (empty initially), affected objects with their text replace deltas, transport requirement, and whether syntax errors can be ignored
2. **Preview** — After the user fills in `newName` and `transport`, POST back the proposal → SAP returns updated affected objects showing all locations that would change across all dependent programs
3. **Execute** — POST the final proposal → SAP performs the rename across all affected objects

**Key data structures:**
```typescript
interface RenameRefactoringProposal {
  oldName: string;
  newName: string;
  transport?: string;
  adtObjectUri: UriParts;           // Source location of the symbol
  affectedObjects: AffectedObjects[]; // All objects that reference the symbol
  ignoreSyntaxErrorsAllowed: boolean;
}
interface AffectedObjects {
  uri: string; type: string; name: string;
  textReplaceDeltas: TextReplaceDelta[];  // Exact text changes
}
```

**ARC-1 relevance:** This is part of **FEAT-05** (P3). Rename is the most commonly needed refactoring in ABAP. The three-step evaluate→preview→execute pattern with affected-object tracking makes it safe for AI-driven rename operations. However, the complexity is significant:
- Requires the object structure link (same as revisions)
- Three HTTP roundtrips with XML serialization/deserialization
- Transport handling per affected object
- The preview step is essential for safety (show impact before execution)

**Competitive context:** vibing-steampunk added rename preview (Apr 6, 2026) — evaluate + preview but not execute. `abap-adt-api` has the full three-step flow.

**Fit in ARC-1:** Could be a `SAPWrite` action or a new `SAPManage` action:
```json
{ "action": "rename", "type": "CLAS", "name": "ZCL_FOO", "line": 10, "column": 5, "newName": "ZCL_BAR" }
```
With MCP elicitation for the preview step (show affected objects, ask for confirmation before execute).

**3. Extract Method (`extractMethodEvaluate` / `extractMethodPreview` / `extractMethodExecute`)**

**Endpoint:** `POST /sap/bc/adt/refactorings?step=evaluate|preview|execute&rel=.../extractmethod`

**Three-step flow (same pattern as rename):**
1. **Evaluate** — Given a source range (start/end line+column), SAP analyzes the selected code and proposes a method extraction: suggested name, visibility, parameters (with directions, types), exceptions, whether it should be static
2. **Preview** — User adjusts name/visibility/parameters → SAP returns the final text deltas (the new method definition in the class definition, the new method implementation, and the modified call site)
3. **Execute** — Apply the extraction

**ARC-1 relevance:** Also part of **FEAT-05** (P3). Extract method is powerful for AI-driven refactoring, but the interaction model is complex:
- The LLM needs to identify a code range (which requires understanding the source line/column mapping)
- The evaluate response has many tunable parameters (name, visibility, static, parameters, exceptions)
- The preview/execute steps modify multiple class includes (definition + implementation)

**Fit in ARC-1:** More complex than rename. Would work well with MCP elicitation:
1. LLM identifies code to extract, provides source range
2. ARC-1 calls evaluate → returns parameter proposal
3. Elicitation shows the user the proposal → user confirms/adjusts
4. ARC-1 calls preview → execute

**4. Change Package (`changePackagePreview` / `changePackageExecute`)**

**Endpoint:** `POST /sap/bc/adt/refactorings?step=preview|execute&rel=.../changepackage`

Moves an object from one package to another. Less relevant for AI workflows — package assignment is usually done at creation time.

#### Summary: Refactoring Priority for ARC-1

| Operation | Roadmap | Priority | Effort | Value for AI Workflows |
|-----------|---------|----------|--------|----------------------|
| Quick Fix Proposals | FEAT-12 | P1 | S (1-2 days) | Very High — chains with syntax/ATC, safer than LLM guessing |
| Rename Symbol | FEAT-05 | P3 | M (3-5 days) | Medium — useful but complex interaction model |
| Extract Method | FEAT-05 | P3 | L (1-2 weeks) | Medium — powerful but needs sophisticated source range selection |
| Change Package | — | P3 | S (1-2 days) | Low — rarely needed in AI workflows |

The quickfix API (FEAT-12) is the clear priority. The `abap-adt-api` source code provides a complete reference implementation for the XML request/response formats, which would save significant reverse-engineering time.

---

## 6. Summary Assessment

| Dimension | Score | Notes |
|-----------|-------|-------|
| **Direct code reuse** | Low | Different HTTP layer, different architecture, different safety model |
| **Feature gap identified** | **High** | Chapter-based dump section filtering is a meaningful improvement for ARC-1 |
| **Competitive risk** | None | sapdumpmcp is dump-only; ARC-1 is a comprehensive ABAP development toolkit |
| **Reference value** | Medium | Chapter name registry, line-joining logic, and `abap-adt-api` endpoint catalog |
| **Licensing** | Compatible | MIT license, no adoption concerns |

### Actionable Items for ARC-1

#### Immediate (can be done now, ~5 hours total)

1. **[Enhancement — Dump Section Filtering]** Add chapter-aware dump parsing to `src/adt/diagnostics.ts`:
   - Parse `line` and `chapterOrder` from `<dump:chapter>` XML (expand existing regex, 2 more capture groups)
   - Add `CHAPTER_NAMES` constant mapping `kap*` codes → readable names (from sapdumpmcp reference)
   - Add `splitFormattedText()` function: sort chapters by line, slice text, strip separator lines
   - Add `joinSplitLines()` for `Source_Code_Extract` and `Active_Calls_in_SAP_Kernel`
   - Extend `DumpChapter` type with `line` + `chapterOrder`, add `sections: Record<string, string>` to `DumpDetail`
   - Add optional `sections: string[]` to `SAPDiagnoseSchema` in `schemas.ts`
   - Update `intent.ts` dumps handler: smart default to 5 key sections, respect explicit `sections` param
   - Update tool description in `tools.ts` to document `sections` param
   - **Impact: 85-90% token reduction** for dump detail responses

#### Near-term (reference for upcoming roadmap items)

2. **[Reference — FEAT-12 Quickfix]** Use `abap-adt-api` `refactor.ts` as implementation reference:
   - Endpoint: `POST /sap/bc/adt/quickfixes/evaluation` + `POST /sap/bc/adt/quickfixes/{id}`
   - XML body/response format is documented in the source
   - Returns `FixProposal[]` with descriptions, then `Delta[]` with text replacements
   - Chains with existing syntax/ATC in `SAPDiagnose`

3. **[Reference — FEAT-20 Revisions]** Use `abap-adt-api` `revisions.ts` as implementation reference:
   - Requires object structure fetch → links → find `rel="...versions"` → follow href
   - Class includes need include-aware link resolution
   - Atom feed response → `Revision[]` with uri, date, author, transport
   - Same Atom parsing pattern as existing `parseDumpList()` / `parseTraceList()`

4. **[Reference — Service Binding Publish]** Use `abap-adt-api` `cds.ts` `publishServiceBinding()`:
   - Endpoint: `POST /sap/bc/adt/businessservices/odatav2/publishjobs`
   - Parameters: `servicename` + `serviceversion` as query string
   - XML body: simple `publishData` envelope
   - Already planned in `docs/plans/completed/2026-04-09-phase2-publish-srvb.md`

5. **[Reference — CDS Element Info]** Use `abap-adt-api` `cds.ts` `ddicElement()` for FEAT-33:
   - Endpoint: `GET /sap/bc/adt/ddic/ddl/elementinfo?path=...`
   - Returns column-level DDIC metadata: types, labels, annotations, key flags
   - Resolves through view stacks (no need to manually trace inheritance)
   - Potential `SAPRead(type="DDLS", include="element_info")` extension

6. **[Reference — CDS Annotation Definitions]** `annotationDefinitions()` in `cds.ts`:
   - Endpoint: `GET /sap/bc/adt/ddic/cds/annotation/definitions`
   - Returns full system annotation catalog — useful for CDS code completion validation
   - Lower priority — nice-to-have for reducing annotation hallucination
