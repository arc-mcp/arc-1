# Evaluation: abap_get_function_group — Parallel Fetch Pattern

**Priority**: High (reference implementation for FEAT-18)  
**Source**: DassianInc/dassian-adt `src/handlers/SourceHandlers.ts` (deep analysis 2026-04-16)  
**ARC-1 Component**: `src/adt/client.ts`, `src/handlers/intent.ts` — to implement FEAT-18

## What They Did

```javascript
async getFunctionGroup(groupName: string) {
  // 1. Fetch objectstructure
  const xmlData = await adtClient.objectStructure(
    `/sap/bc/adt/functions/groups/${encodeURIComponent(groupName)}`
  );
  
  // 2. Parse atom:link hrefs from objectstructure XML
  const links = parseObjectStructureLinks(xmlData);
  // Regex: href attributes matching /includes/|/fmodules/ with /source/main suffix
  // Extract readable name: last path segment, URL-decoded, uppercased
  
  // 3. Parallel fetch all sources
  const results = await Promise.all(
    links.map(async link => ({
      name: link.name,
      source: await adtClient.getObjectSource(link.href)
    }))
  );
  
  // 4. Return combined response
  return {
    sources: Object.fromEntries(results.map(r => [r.name, r.source])),
    errors: Object.fromEntries(results.filter(r => r.error).map(r => [r.name, r.error]))
  };
}
```

**Key ADT endpoint:**
`GET /sap/bc/adt/functions/groups/{encodedName}/objectstructure`

Returns XML with `abapsource:objectStructureElement` children containing `atom:link` hrefs for each include and function module.

## Implementation Guide for ARC-1 FEAT-18

The same pattern can be implemented in `src/adt/client.ts`:

```typescript
async getFunctionGroupBulk(name: string): Promise<FunctionGroupBulkResult> {
  checkOperation(this.safety, OperationType.Read, 'GetFunctionGroupBulk');
  
  // Fetch objectstructure
  const resp = await this.http.get(
    `/sap/bc/adt/functions/groups/${encodeURIComponent(name)}/objectstructure`
  );
  
  // Parse atom:link hrefs from XML
  const links = parseFugrObjectStructureLinks(resp.body);
  
  // Parallel fetch all sources (respects ARC1_MAX_CONCURRENT via semaphore)
  const results = await Promise.all(
    links.map(async link => {
      try {
        const src = await this.http.get(link.href);
        return { name: link.name, type: link.type, source: src.body };
      } catch (err) {
        return { name: link.name, type: link.type, error: String(err) };
      }
    })
  );
  
  return {
    groupName: name,
    includes: results.filter(r => r.type === 'INCL'),
    functionModules: results.filter(r => r.type === 'FUNC'),
  };
}
```

**Notes:**
- vibing-steampunk also added `GetFunctionGroupAllSources` (commit `edd94bc`, 2026-04-13) — same ADT endpoint
- `ARC1_MAX_CONCURRENT` (default 10) already handles concurrency for `Promise.all()`
- Cache invalidation: each include source should be cached independently (existing CachingLayer handles this)

## Decision

**Implement for FEAT-18 (P1).** Reference implementation confirmed. The objectstructure endpoint is already used by ARC-1 indirectly; extending to bulk fetch is straightforward.
