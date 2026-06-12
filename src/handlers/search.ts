/**
 * SAPSearch handler — repository search (text, tadir lookup, info-system) + query transliteration
 * helpers. Extracted from intent.ts (Stage B; moved verbatim).
 */

import type { AdtClient } from '../adt/client.js';
import { AdtApiError } from '../adt/errors.js';
import { classifyTextSearchError } from '../adt/features.js';
import type { AdtObjectLookupResult, AdtSearchResult } from '../adt/types.js';
import { cachedFeatures } from './feature-cache.js';
import { normalizeObjectType } from './object-types.js';
import { errorResult, type ToolResult, textResult } from './shared.js';

// ─── Search Helpers ─────────────────────────────────────────────────

/**
 * Transliterate non-ASCII characters in search queries.
 * SAP object names are ASCII-only, so umlauts and accented characters
 * never appear in object names. This prevents wasted searches with
 * German terms like "*Schätzung*" that silently return empty results.
 */
export function transliterateQuery(query: string): { normalized: string; changed: boolean } {
  // Explicit German umlaut replacements (must come before NFD decomposition)
  let result = query
    .replace(/ä/g, 'AE')
    .replace(/Ä/g, 'AE')
    .replace(/ö/g, 'OE')
    .replace(/Ö/g, 'OE')
    .replace(/ü/g, 'UE')
    .replace(/Ü/g, 'UE')
    .replace(/ß/g, 'SS');

  // General fallback: strip remaining diacritics (é→e, ñ→n, etc.)
  result = result.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  return { normalized: result, changed: result !== query };
}

/**
 * Detect if a search query looks like a field/column name rather than
 * an object name. Field names are short, uppercase, and typically don't
 * start with Z/Y (which are custom object prefixes).
 */
export function looksLikeFieldName(query: string): boolean {
  // Wildcard patterns are object searches, not field names
  if (query.includes('*')) return false;
  if (query.length === 0 || query.length > 15) return false;
  // Must be uppercase letters, digits, underscores only
  if (!/^[A-Z0-9_]+$/.test(query)) return false;
  // Z/Y prefix → more likely an object name
  if (/^[ZY]/.test(query)) return false;
  return true;
}

export async function handleSAPSearch(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const rawQuery = String(args.query ?? '');
  const maxResults = Number(args.maxResults ?? 100);
  const searchType = String(args.searchType ?? 'object');

  if (searchType === 'tadir_lookup') {
    const names = extractLookupNames(rawQuery, args.names);
    if (names.length === 0) {
      return errorResult('SAPSearch(searchType="tadir_lookup") requires names[] or query with at least one name.');
    }
    const objectTypes = extractLookupObjectTypes(args.objectType, args.objectTypes);
    const rawSource = typeof args.source === 'string' ? args.source.toLowerCase() : 'adt';
    const source: 'adt' | 'db' | 'both' =
      rawSource === 'db' || rawSource === 'both' ? (rawSource as 'db' | 'both') : 'adt';

    // Stamp each match with provenance so a merged 'both' result is unambiguous and
    // viewer tooling can colour-code ghost rows. The DB path already stamps `_origin:'db'`
    // (see `lookupObjectsViaDb`); we stamp ADT matches here.
    const tagOrigin = (lookups: AdtObjectLookupResult[], origin: 'adt' | 'db'): AdtObjectLookupResult[] =>
      lookups.map((l) => ({
        ...l,
        matches: l.matches.map((m) => ({ ...m, _origin: m._origin ?? origin })),
      }));

    let finalLookups: AdtObjectLookupResult[];
    const wildcardNames = names.filter((name) => name.includes('*'));
    const warnings: string[] = [];
    let splitBrain: string[] = [];

    if (source === 'adt') {
      finalLookups = tagOrigin(await client.lookupObjects(names, { maxResults, objectTypes }), 'adt');
    } else if (source === 'db') {
      // The 'db' path bypasses ADT info-system entirely; `lookupObjectsViaDb` already
      // tags matches with `_origin:'db'`. Safety/scope gating runs at handleToolCall
      // and in client.runQuery (FreeSQL operation), so unauthorized callers never reach here.
      finalLookups = await client.lookupObjectsViaDb(names, { maxResults, objectTypes });
    } else {
      // 'both' — parallel ADT + DB, merge per name with dedupe.
      const [adtLookups, dbLookups] = await Promise.all([
        client.lookupObjects(names, { maxResults, objectTypes }).then((r) => tagOrigin(r, 'adt')),
        client.lookupObjectsViaDb(names, { maxResults, objectTypes }),
      ]);

      const dbByName = new Map(dbLookups.map((l) => [l.name.toUpperCase(), l]));
      const adtByName = new Map(adtLookups.map((l) => [l.name.toUpperCase(), l]));

      finalLookups = names.map((rawName) => {
        const upper = rawName.toUpperCase();
        const adt = adtByName.get(upper);
        const db = dbByName.get(upper);
        const adtMatches = adt?.matches ?? [];
        const dbMatches = db?.matches ?? [];

        // Dedupe by (baseObjectType, objectName) — TADIR stores bare types ('DDLS')
        // while ADT info-system returns slash-form ('DDLS/DF'). Stripping the suffix
        // keeps the same logical object from appearing twice in the merged matches.
        // Preserve the more-specific slash form when both originate from ADT+DB.
        const seen = new Map<string, AdtSearchResult>();
        const baseKey = (m: AdtSearchResult): string =>
          `${(m.objectType.split('/')[0] || m.objectType).toUpperCase()}\x00${m.objectName.toUpperCase()}`;
        for (const m of adtMatches) seen.set(baseKey(m), m);
        for (const m of dbMatches) {
          const k = baseKey(m);
          if (!seen.has(k)) seen.set(k, m);
        }
        const mergedMatches = [...seen.values()];

        // Split-brain detection: an object is divergent if exactly one source has matches.
        // (Zero matches on both sides = consistent absence; matches on both = consistent presence.)
        if (adtMatches.length > 0 !== dbMatches.length > 0) {
          splitBrain.push(rawName);
        }

        return { name: rawName, found: mergedMatches.length > 0, matches: mergedMatches };
      });

      // Compose human-friendly warnings per split-brain name. Keep them grounded in
      // the most common cause (TADIR ghost from aborted create/delete) so LLM clients
      // can suggest the right cleanup path without inventing a new pointer.
      for (const name of splitBrain) {
        const adt = adtByName.get(name.toUpperCase());
        const db = dbByName.get(name.toUpperCase());
        const adtHas = (adt?.matches.length ?? 0) > 0;
        const dbHas = (db?.matches.length ?? 0) > 0;
        if (dbHas && !adtHas) {
          warnings.push(
            `${name} exists in TADIR (DB) but ADT cannot resolve it — likely a TADIR ghost from an aborted create/delete cycle. Consider RS_DD_TADIR_CLEANUP or manual SE03 cleanup.`,
          );
        } else if (adtHas && !dbHas) {
          warnings.push(
            `${name} resolves via ADT but is not present in the TADIR row scan — likely a release-time mismatch or a type filter excluding the row. Re-run with broader objectTypes or no filter to confirm.`,
          );
        }
      }
    }

    // Dedupe split-brain names (defensive; merge loop should already avoid duplicates).
    splitBrain = [...new Set(splitBrain)];

    if (wildcardNames.length > 0) {
      warnings.push(
        `tadir_lookup performs exact-name lookup; wildcard characters are treated literally for: ${wildcardNames.join(', ')}`,
      );
    }

    const missing = finalLookups.filter((l) => !l.found).map((l) => l.name);
    const matchCount = finalLookups.reduce((count, lookup) => count + lookup.matches.length, 0);

    const payload: Record<string, unknown> = { count: matchCount, lookups: finalLookups, missing };
    if (splitBrain.length > 0) payload.splitBrain = splitBrain;
    if (warnings.length > 0) payload.warnings = warnings;

    return textResult(JSON.stringify(payload, null, 2));
  }

  if (searchType === 'source_code') {
    // Source code search: do NOT transliterate — source can contain umlauts in strings/comments
    if (cachedFeatures?.textSearch && !cachedFeatures.textSearch.available) {
      return errorResult(
        `Source code search is not available on this SAP system. ${cachedFeatures.textSearch.reason ?? ''}` +
          `\nUse SAPSearch with searchType="object" to search by object name instead, or use SAPQuery to search metadata tables.`,
      );
    }
    const objectType = args.objectType ? normalizeObjectType(String(args.objectType)) : undefined;
    const packageName = args.packageName as string | undefined;
    try {
      const results = await client.searchSource(rawQuery, maxResults, objectType, packageName);
      return textResult(JSON.stringify(results, null, 2));
    } catch (err) {
      if (err instanceof AdtApiError) {
        const permanentCodes = [401, 403, 404, 501];
        if (permanentCodes.includes(err.statusCode)) {
          const classified = classifyTextSearchError(err.statusCode);
          return errorResult(
            `Source code search is not available on this SAP system. ${classified.reason ?? ''}` +
              `\nUse SAPSearch with searchType="object" to search by object name instead, or use SAPQuery to search metadata tables.`,
          );
        }
      }
      throw err;
    }
  }

  // Object search: transliterate non-ASCII (SAP object names are ASCII-only)
  const { normalized: query, changed: wasTransliterated } = transliterateQuery(rawQuery);
  const transliterationNote = wasTransliterated
    ? `Note: Query contained non-ASCII characters. Transliterated "${rawQuery}" → "${query}" (SAP object names are ASCII-only).\n\n`
    : '';

  const results = await client.searchObject(query, maxResults);
  if (Array.isArray(results) && results.length === 0) {
    let hint =
      '[]' +
      '\n\n' +
      transliterationNote +
      'No objects found. If searching for custom objects, try Z* or Y* prefixes (e.g., "Z*ESTIM*"). ' +
      'If you already found objects in a package, use SAPRead with type=DEVC to list all package contents instead of more searches.';
    if (looksLikeFieldName(query)) {
      const stripped = query.replace(/\*/g, '');
      hint += `\nThis looks like a field/column name. Use SAPQuery("SELECT fieldname, rollname, domname FROM dd03l WHERE fieldname = '${stripped}'") or SAPRead(type='DDLS', include='elements') to find fields.`;
    }
    return textResult(hint);
  }
  return textResult(transliterationNote + JSON.stringify(results, null, 2));
}

function extractLookupNames(query: string, rawNames: unknown): string[] {
  const fromNames = Array.isArray(rawNames) ? rawNames.map((n) => String(n).trim()).filter(Boolean) : [];
  const fromQuery = query
    .split(/[,\s]+/)
    .map((n) => n.trim())
    .filter(Boolean);
  return [...new Set([...fromNames, ...fromQuery].map((n) => n.toUpperCase()))];
}

function extractLookupObjectTypes(rawObjectType: unknown, rawObjectTypes: unknown): string[] {
  const types = Array.isArray(rawObjectTypes)
    ? rawObjectTypes.map((t) => normalizeObjectType(String(t))).filter(Boolean)
    : [];
  if (typeof rawObjectType === 'string' && rawObjectType.trim()) {
    types.push(normalizeObjectType(rawObjectType));
  }
  return [...new Set(types)];
}
