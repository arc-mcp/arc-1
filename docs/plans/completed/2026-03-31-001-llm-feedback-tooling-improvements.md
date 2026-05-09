# LLM Feedback Analysis: Tooling Improvements for ARC-1

> **Source:** Erfahrungsbericht STO-956267 — real-world SAP ISU analysis using arc-1 in Cursor
> **Date:** 2026-03-31
> **Goal:** Turn each piece of feedback into actionable implementation items with code-level analysis

---

## Overview

The experience report describes an SAP BPEM/MSCONS incident analysis performed entirely through arc-1 MCP tools, without SAP GUI. The analysis successfully identified the root cause, validating the core value proposition. However, several friction points were identified that caused unnecessary round-trips and required deep SAP internals knowledge.

This document researches each feedback item in detail, analyzes the current codebase, and proposes concrete implementation approaches.

---

## Issue 1: 401 Error Message Missing Client Information

**Impact:** High — caused ~15 minutes of debugging on first use
**Effort:** Low — localized change in error formatting

### Current Behavior

When authentication fails, the error flows through two paths:

1. **CSRF token fetch** (`src/adt/http.ts:401-406`):
   ```typescript
   throw new AdtApiError(
     'Authentication failed (401): check username/password',
     401,
     '/sap/bc/adt/core/discovery',
   );
   ```

2. **LLM error formatter** (`src/handlers/intent.ts:77-79`):
   ```typescript
   if (err.isUnauthorized || err.isForbidden) {
     return `${message}\n\nHint: Authorization error. The configured SAP user may lack permissions for this object.`;
   }
   ```

Neither path includes the configured `SAP_CLIENT`, even though the HTTP client has it available in `this.config.client` (`src/adt/http.ts:455-457`).

### Proposed Implementation

**Option A — Enrich AdtApiError at throw site** (recommended):

In `src/adt/http.ts:401-406`, include the client in the message:

```typescript
throw new AdtApiError(
  `Authentication failed (401): check username/password (sap-client=${this.config.client ?? '001'})`,
  401,
  '/sap/bc/adt/core/discovery',
);
```

**Option B — Add context field to AdtApiError**:

Extend `AdtApiError` (`src/adt/errors.ts:27-36`) with an optional `context` map:

```typescript
export class AdtApiError extends AdtError {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly path: string,
    public readonly responseBody?: string,
    public readonly context?: Record<string, string>,
  ) { ... }
}
```

Then in `formatErrorForLLM` (`src/handlers/intent.ts:77-79`), append context:

```typescript
if (err.isUnauthorized || err.isForbidden) {
  const client = err.context?.['sap-client'] ?? 'unknown';
  return `${message}\n\nHint: Authorization error using sap-client=${client}. Check SAP_CLIENT env variable (default: '001') and verify username/password.`;
}
```

**Recommendation:** Option A is simpler and sufficient. Option B is more extensible if we want to enrich other error types too.

### Files to Change

| File | Change |
|------|--------|
| `src/adt/http.ts:402-403` | Include `this.config.client` in 401 error message |
| `src/adt/http.ts:409` | Include `this.config.client` in 403 error message |
| `src/handlers/intent.ts:77-79` | Append client info hint to auth error messages |
| `tests/unit/adt/http.test.ts` | Update expected error message in 401 test |

---

## Issue 2: SAPRead FUNC Requires group Parameter (Auto-Resolve)

**Impact:** Medium — every FM read requires 2 calls instead of 1
**Effort:** Medium — needs a new lookup method + handler change

### Current Behavior

`getFunction()` (`src/adt/client.ts:117-123`) requires both `group` and `name`:

```typescript
async getFunction(group: string, name: string): Promise<string> {
  const resp = await this.http.get(
    `/sap/bc/adt/functions/groups/${encodeURIComponent(group)}/fmodules/${encodeURIComponent(name)}/source/main`,
  );
  return resp.body;
}
```

The handler (`src/handlers/intent.ts:251`) passes group as-is, defaulting to empty string:
```typescript
case 'FUNC':
  return textResult(await client.getFunction(String(args.group ?? ''), name));
```

The tool description (`src/handlers/tools.ts:28`) explicitly states "requires group param".

### Proposed Implementation

Add an auto-resolve method to `AdtClient`:

```typescript
/** Resolve function group for a function module via quickSearch */
async resolveFunctionGroup(fmName: string): Promise<string | null> {
  const results = await this.searchObject(fmName, 5);
  // Search results contain URIs like /sap/bc/adt/functions/groups/z_bpt1/fmodules/z_bcontact_input
  for (const r of results) {
    if (r.objectName.toUpperCase() === fmName.toUpperCase() && r.uri.includes('/groups/')) {
      const match = r.uri.match(/\/groups\/([^/]+)\//);
      if (match) return match[1].toUpperCase();
    }
  }
  return null;
}
```

Then update the handler:

```typescript
case 'FUNC': {
  let group = String(args.group ?? '');
  if (!group) {
    const resolved = await client.resolveFunctionGroup(name);
    if (!resolved) {
      return errorResult(`Cannot resolve function group for "${name}". Provide the group parameter explicitly, or use SAPSearch("${name}") to find it.`);
    }
    group = resolved;
  }
  return textResult(await client.getFunction(group, name));
}
```

Update the tool description to say "group param is optional — auto-resolved if omitted".

### Files to Change

| File | Change |
|------|--------|
| `src/adt/client.ts` | Add `resolveFunctionGroup()` method |
| `src/handlers/intent.ts:250-251` | Auto-resolve group when missing |
| `src/handlers/tools.ts:28` | Update description: group is optional |
| `tests/unit/handlers/intent.test.ts` | Test auto-resolve flow |
| `tests/unit/adt/client.test.ts` | Test `resolveFunctionGroup()` |

### Trade-offs

- Adds one extra HTTP call when group is omitted (search + read vs just read)
- But eliminates the need for the LLM to make two separate tool calls, saving a full round-trip
- Net improvement: 1 tool call instead of 2 (at the cost of 1 internal HTTP call)

---

## Issue 3: FUGR Includes Not Expandable

**Impact:** Medium — FUGR reads return only top-level include list, not actual code
**Effort:** Medium — needs orchestration logic to fetch includes

### Current Behavior

`getFunctionGroup()` (`src/adt/client.ts:126-130`) returns structure only:
```typescript
async getFunctionGroup(name: string): Promise<{ name: string; functions: string[] }> {
  const resp = await this.http.get(`/sap/bc/adt/functions/groups/${encodeURIComponent(name)}`);
  return parseFunctionGroup(resp.body);
}
```

`getFunctionGroupSource()` (`src/adt/client.ts:133-137`) returns top-level source with `INCLUDE` statements.

`getInclude()` (`src/adt/client.ts:140-144`) exists and uses the endpoint:
```
/sap/bc/adt/programs/includes/{name}/source/main
```

The report says this returned HTTP 406/404 — this may be an issue with specific include naming conventions (LZ_BPT1I01 vs standard includes) or Accept headers.

### Proposed Implementation

**Step 1: Investigate Include reading reliability**

The `getInclude()` method exists. The 406/404 errors reported may be due to:
- Include names needing different URL encoding
- Some includes (PAI/PBO modules) using a different ADT endpoint
- Missing Accept header (`text/plain` vs `application/xml`)

Need to test `getInclude()` against various include types (TOP, I01, O01, F01, etc.).

**Step 2: Add expand_includes option to FUGR read**

```typescript
case 'FUGR': {
  const expand = Boolean(args.expand_includes ?? false);
  if (expand) {
    const source = await client.getFunctionGroupSource(name);
    const includePattern = /INCLUDE\s+(\S+)\./gi;
    const parts: string[] = [`=== FUGR ${name} (main) ===\n${source}`];
    let m: RegExpExecArray | null;
    while ((m = includePattern.exec(source)) !== null) {
      try {
        const inclSource = await client.getInclude(m[1]);
        parts.push(`\n=== ${m[1]} ===\n${inclSource}`);
      } catch {
        parts.push(`\n=== ${m[1]} ===\n[Could not read include]`);
      }
    }
    return textResult(parts.join('\n'));
  }
  const fg = await client.getFunctionGroup(name);
  return textResult(JSON.stringify(fg, null, 2));
}
```

### Files to Change

| File | Change |
|------|--------|
| `src/adt/client.ts` | Investigate/fix `getInclude()` for PAI/PBO includes |
| `src/handlers/intent.ts:252-255` | Add `expand_includes` option |
| `src/handlers/tools.ts` | Add `expand_includes` param to SAPRead schema |
| `tests/integration/adt.integration.test.ts` | Add FUGR include expansion test |

---

## Issue 4: No Source Code Full-Text Search

**Impact:** Very High — "would save 30-40% of exploratory tool calls"
**Effort:** High — SAP ADT may not expose a direct code search endpoint

### Current Behavior

`searchObject()` (`src/adt/client.ts:184-190`) only searches by object **name** pattern:
```
/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=...
```

There is no method to search within source code content.

### SAP ADT API Analysis

SAP ADT offers several search-related endpoints:

1. **Quick Search** (currently used): `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch` — object name only
2. **Where-Used List**: `/sap/bc/adt/repository/informationsystem/usageReferences` — already exposed via SAPNavigate references
3. **Code Search** (if available on system): `/sap/bc/adt/repository/informationsystem/textSearch` — full-text search within ABAP source code. Availability depends on SAP kernel version (≥7.51 typically).

### Proposed Implementation

**Option A — ADT Text Search endpoint** (preferred if available):

```typescript
async searchSource(
  pattern: string,
  objectType?: string,
  packageName?: string,
  maxResults = 50,
): Promise<SourceSearchResult[]> {
  checkOperation(this.safety, OperationType.Search, 'SearchSource');
  let url = `/sap/bc/adt/repository/informationsystem/textSearch?searchString=${encodeURIComponent(pattern)}&maxResults=${maxResults}`;
  if (objectType) url += `&objectType=${encodeURIComponent(objectType)}`;
  if (packageName) url += `&packageName=${encodeURIComponent(packageName)}`;
  const resp = await this.http.get(url);
  return parseSourceSearchResults(resp.body);
}
```

This would be exposed as either:
- A new `SAPSearch` parameter: `SAPSearch(query="cl_lsapi_manager", searchType="source_code")`
- Or a new action in an existing tool

**Option B — Client-side search** (fallback):

Fetch all objects in a package, read their sources, and grep locally. This is slow and impractical for large codebases — only viable for targeted searches within a known small scope.

### Feasibility Assessment

The `/sap/bc/adt/repository/informationsystem/textSearch` endpoint needs to be validated against the target SAP systems. This is a feature detection scenario — should be gated behind the existing feature detection system (`src/adt/features.ts`).

### Files to Change

| File | Change |
|------|--------|
| `src/adt/client.ts` | Add `searchSource()` method |
| `src/adt/xml-parser.ts` | Add `parseSourceSearchResults()` |
| `src/adt/types.ts` | Add `SourceSearchResult` type |
| `src/adt/features.ts` | Add feature detection for text search capability |
| `src/handlers/intent.ts` | Route `searchType="source_code"` in SAPSearch handler |
| `src/handlers/tools.ts` | Add `searchType` param to SAPSearch schema |
| `tests/unit/adt/xml-parser.test.ts` | Add parser tests with fixture XML |

---

## Issue 5: BOR Object Methods Not Directly Readable

**Impact:** Medium — BOR objects are common in SAP ISU/Utilities
**Effort:** Medium — needs BOR-specific ADT endpoints or workaround

### Current Behavior

SAPSearch finds BOR objects (type SOBJ/MO, SOBJ/P) but SAPRead has no `SOBJ` type handler. The workaround requires:
1. Query `SWOTLV` table for method→program mapping
2. Read the program via `SAPRead(type="PROG", ...)`

### Proposed Implementation

**Option A — Add SOBJ type to SAPRead**:

BOR object implementations are stored as regular ABAP programs with the same name as the BOR object type. The method implementations are `FORM` routines in that program.

```typescript
case 'SOBJ': {
  // BOR object — read implementation program + method catalog from SWOTLV
  const source = await client.getProgram(name);
  // Optionally: query SWOTLV for method listing
  return textResult(source);
}
```

This is simple but doesn't provide the method catalog.

**Option B — Add SOBJ type with method catalog** (better):

```typescript
case 'SOBJ': {
  const method = String(args.method ?? '');
  if (method) {
    // Read specific BOR method via SWOTLV lookup
    const data = await client.runQuery(
      `SELECT progname, formname FROM swotlv WHERE lobjtype = '${name}' AND verb = '${method}'`, 1
    );
    if (data.rows.length > 0) {
      const prog = data.rows[0].PROGNAME;
      const source = await client.getProgram(prog);
      return textResult(source);
    }
    return errorResult(`BOR method "${method}" not found on object type "${name}".`);
  }
  // List all methods
  const methods = await client.runQuery(
    `SELECT verb, progname, formname, descript FROM swotlv WHERE lobjtype = '${name}'`, 100
  );
  return textResult(JSON.stringify(methods, null, 2));
}
```

**Note:** Option B uses SQL queries internally, which means it requires FreeSQL permission. This should be documented, or a dedicated ADT endpoint for BOR metadata should be investigated.

### Files to Change

| File | Change |
|------|--------|
| `src/handlers/intent.ts:243-293` | Add `SOBJ` case in SAPRead switch |
| `src/handlers/tools.ts:28` | Add SOBJ to supported types list, add `method` param |
| `tests/unit/handlers/intent.test.ts` | Add SOBJ handler tests |

---

## Issue 6: SAPQuery "Did You Mean?" for Unknown Tables

**Impact:** Low-Medium — quality-of-life improvement for exploratory queries
**Effort:** Low — add a DDIC lookup on 404

### Current Behavior

When a table doesn't exist, `runQuery()` (`src/adt/client.ts:225-229`) returns an `AdtApiError` with 404 status. The `formatErrorForLLM()` (`src/handlers/intent.ts:72-76`) suggests using SAPSearch but doesn't suggest similar table names:

```typescript
if (err.isNotFound) {
  return `${message}\n\nHint: Object "${name}" (type ${type}) was not found. Use SAPSearch with query "${name}" to verify...`;
}
```

### Proposed Implementation

In `handleSAPQuery` (`src/handlers/intent.ts:303-308`), catch 404 errors and perform a fuzzy DDIC lookup:

```typescript
async function handleSAPQuery(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const sql = String(args.sql ?? '');
  const maxRows = Number(args.maxRows ?? 100);
  try {
    const data = await client.runQuery(sql, maxRows);
    return textResult(JSON.stringify(data, null, 2));
  } catch (err) {
    if (err instanceof AdtApiError && err.isNotFound) {
      // Extract table name from SQL
      const tableMatch = sql.match(/FROM\s+(\S+)/i);
      if (tableMatch) {
        const tableName = tableMatch[1];
        try {
          const suggestions = await client.searchObject(`${tableName}*`, 5);
          const names = suggestions.map(s => s.objectName).join(', ');
          if (names) {
            return errorResult(
              `Table "${tableName}" not found.\n\nDid you mean: ${names}\n\nUse SAPSearch("${tableName}*") for more results.`
            );
          }
        } catch { /* ignore search errors */ }
      }
    }
    throw err;
  }
}
```

### Files to Change

| File | Change |
|------|--------|
| `src/handlers/intent.ts:303-308` | Add try/catch with DDIC suggestion lookup |
| `tests/unit/handlers/intent.test.ts` | Add "did you mean" test |

---

## Issue 7: SAPNavigate References Requires URI (No Symbolic Lookup)

**Impact:** Medium — references work but require knowing the full ADT URI
**Effort:** Low — add type/name → URI resolution

### Current Behavior

`findReferences()` (`src/adt/codeintel.ts:70-97`) accepts an `objectUrl` string. The handler (`src/handlers/intent.ts:444-450`) passes the URI directly from args.

The LLM must know the full ADT URI (e.g., `/sap/bc/adt/programs/programs/ZTEST`) to use references. For explorative analysis, the user wants to say "find all references to BAPI_EMMA_CASE_COMPLETE" without knowing the URI.

### Proposed Implementation

There's already a pattern for type→URI mapping in the codebase. Check if `objectUrlForType()` exists in the SAPDiagnose handler (`src/handlers/intent.ts:466`).

Add a fallback in the SAPNavigate references handler:

```typescript
case 'references': {
  let targetUri = uri;
  if (!targetUri && args.type && args.name) {
    targetUri = objectUrlForType(String(args.type), String(args.name));
  }
  if (!targetUri) {
    return errorResult('Provide either uri, or type+name to find references.');
  }
  const results = await findReferences(client.http, client.safety, targetUri);
  ...
}
```

This reuses the existing `objectUrlForType()` utility and makes the `uri` parameter optional when `type` + `name` are provided.

### Files to Change

| File | Change |
|------|--------|
| `src/handlers/intent.ts:444-450` | Add type/name → URI resolution fallback |
| `src/handlers/tools.ts` | Update SAPNavigate schema: uri optional when type+name given |
| `tests/unit/handlers/intent.test.ts` | Test symbolic reference lookup |

---

## Priority Matrix

| # | Issue | Impact | Effort | Priority |
|---|-------|--------|--------|----------|
| 1 | 401 error with client info | High | Low | **P1** |
| 2 | FUNC auto-resolve group | Medium | Medium | **P1** |
| 3 | FUGR include expansion | Medium | Medium | **P2** |
| 4 | Source code full-text search | Very High | High | **P1** (investigate ADT endpoint first) |
| 5 | BOR object reading (SOBJ) | Medium | Medium | **P2** |
| 6 | SAPQuery "did you mean?" | Low-Med | Low | **P3** |
| 7 | SAPNavigate symbolic refs | Medium | Low | **P2** |

### Suggested Implementation Order

1. **Issue 1** — 401 error message (quick win, immediate user impact)
2. **Issue 2** — FUNC auto-resolve (eliminates most common friction)
3. **Issue 7** — Symbolic reference lookup (low effort, reuses existing code)
4. **Issue 4** — Source code search (highest impact but needs ADT endpoint investigation)
5. **Issue 3** — FUGR include expansion (needs include reading reliability investigation)
6. **Issue 5** — BOR object support (domain-specific, ISU-heavy use cases)
7. **Issue 6** — Query suggestions (nice-to-have)

---

## Additional Observations from the Report

### What Worked Exceptionally Well

- **SAPSearch** structured JSON output (objectType, packageName, description, uri) enables immediate LLM-driven follow-up without human intervention
- **SAPQuery** on metadata tables (DD02L, SWOTLV, EMMAC_CCAT_SOP) is the most powerful reverse-engineering tool — this should be highlighted in documentation
- **SAPRead CLAS** delivering full source in one call (definition + implementation) is exactly the right granularity for LLM analysis

### Documentation Improvements

The report reveals that the LLM needed deep SAP internals knowledge (SWOTLV table, BOR architecture, DDIC discovery patterns). This suggests the tool descriptions in `src/handlers/tools.ts` could include more SAP-specific guidance:

- SAPQuery description should mention common metadata tables (DD02L, DD03L, SWOTLV, TADIR)
- SAPSearch description should mention that BOR objects appear as SOBJ type
- SAPRead FUGR description should mention that it returns structure only, not source

---

*Generated from user experience report analyzing SAP incident STO-956267 via arc-1 MCP tools*
