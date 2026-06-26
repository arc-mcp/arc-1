/**
 * SAPRead handler — read ABAP source + DDIC metadata, version/draft resolution, grep, table
 * preview. Exports version helpers shared with the write handler.
 */

import type { AdtClient, SourceReadResult } from '../adt/client.js';
import { decodeKtdText } from '../adt/ddic-xml.js';
import { extractUnknownColumn, formatUnknownColumnHint, isNotFoundError } from '../adt/errors.js';
import { mapSapReleaseToAbaplintVersion } from '../adt/features.js';
import { type FmParameter, type FmParameterKind, parseFmSignature } from '../adt/fm-signature.js';
import { isOperationAllowed, OperationType } from '../adt/safety.js';
import { getServerDrivenObject, isServerDrivenObjectType, supportsServerDrivenObject } from '../adt/server-driven.js';
import type { InactiveObject } from '../adt/types.js';
import { getAppInfo } from '../adt/ui5-repository.js';
import { getVersionDiff } from '../adt/version-diff.js';
import type { CachingLayer } from '../cache/caching-layer.js';
import { extractCdsElements } from '../context/cds-deps.js';
import { grepSource } from '../context/grep.js';
import { extractMethod, formatMethodListing, listMethods } from '../context/method-surgery.js';
import { logger } from '../server/logger.js';
import { type CacheSecurityContext, inactiveListUserKey, invalidateInactiveList } from './cache-security.js';
import { cachedFeatures, isBtpSystem } from './feature-cache.js';
import { inferObjectType, normalizeObjectType, objectUrlForTypeRaw } from './object-types.js';
import { errorResult, type ToolResult, textResult } from './shared.js';

const BTP_HINTS: Record<string, string> = {
  PROG: 'Executable programs (reports) are not available on BTP ABAP Environment. Use CLAS with IF_OO_ADT_CLASSRUN for console applications.',
  INCL: 'Includes are not available on BTP ABAP Environment. Use classes and interfaces instead — INCLUDE is forbidden in ABAP Cloud.',
  VIEW: 'Classic DDIC views are not available on BTP ABAP Environment. Use DDLS (CDS views) instead.',
  TEXT_ELEMENTS:
    'Text elements are not available on BTP ABAP Environment (no classic programs). Use message classes or constant classes instead.',
  VARIANTS: 'Variants are not available on BTP ABAP Environment (no classic programs).',
  SOBJ: 'BOR business objects (SOBJ) are not available on BTP ABAP Environment. Use RAP behavior definitions (BDEF) instead.',
  TRAN: 'Transaction codes (TRAN) are not available on BTP ABAP Environment. Use SAPSearch to find apps and services instead.',
};

export type SourceVersion = 'active' | 'inactive';
type RequestedSourceVersion = SourceVersion | 'auto';

const VERSIONED_SOURCE_READ_TYPES = new Set([
  'PROG',
  'CLAS',
  'INTF',
  'FUNC',
  'INCL',
  'DDLS',
  'DCLS',
  'BDEF',
  'SRVD',
  'DDLX',
  'SRVB',
  'SKTD',
  'TABL',
  'VIEW',
]);

function inactiveTypeMatches(readType: string, inactiveType: string): boolean {
  return (inactiveType.split('/')[0] ?? inactiveType).toUpperCase() === readType.toUpperCase();
}

export async function resolveVersionAndDraftInfo(
  client: AdtClient,
  cachingLayer: CachingLayer | undefined,
  type: string,
  name: string,
  requestedVersion: RequestedSourceVersion,
  cacheSecurity: CacheSecurityContext,
): Promise<{ effectiveVersion: SourceVersion; draft?: InactiveObject }> {
  if (!VERSIONED_SOURCE_READ_TYPES.has(type)) {
    return { effectiveVersion: requestedVersion === 'auto' ? 'active' : requestedVersion };
  }

  let draft: InactiveObject | undefined;
  if (cachingLayer || requestedVersion !== 'active') {
    try {
      const inactiveObjects = cachingLayer
        ? await cachingLayer.inactiveLists.getOrFetch(client, inactiveListUserKey(client, cacheSecurity))
        : await client.getInactiveObjects();
      const upperName = name.toUpperCase();
      draft = inactiveObjects.find(
        (object) => inactiveTypeMatches(type, object.type) && object.name.toUpperCase() === upperName,
      );
    } catch (err) {
      logger.debug('Inactive object list unavailable while resolving source version', {
        type,
        name,
        requestedVersion,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (requestedVersion === 'auto') {
    return { effectiveVersion: draft ? 'inactive' : 'active', draft };
  }
  return { effectiveVersion: requestedVersion, draft };
}

function sourceVersionWarning(effectiveVersion: SourceVersion, draft?: InactiveObject): string | undefined {
  if (effectiveVersion === 'active' && draft) {
    const deletion = draft.deleted ? ' deletion' : '';
    const transport = draft.transport ? ` (in transport ${draft.transport})` : '';
    return `Note: You have an unactivated${deletion} draft of this object${transport}. The source below is the LAST ACTIVATED version. To work with your draft, activate it first via SAPActivate or re-run with version='inactive' to read it directly.`;
  }
  if (effectiveVersion === 'inactive' && !draft) {
    return 'Note: No inactive draft exists for this object on the server. Returning the active version.';
  }
  return undefined;
}

export async function handleSAPRead(
  client: AdtClient,
  args: Record<string, unknown>,
  cachingLayer: CachingLayer | undefined,
  cacheSecurity: CacheSecurityContext,
): Promise<ToolResult> {
  const type = normalizeObjectType(String(args.type ?? ''));
  const name = String(args.name ?? '');
  const requestedVersion = (args.version ?? 'active') as RequestedSourceVersion;

  // BTP: return helpful error for unavailable types
  if (isBtpSystem() && BTP_HINTS[type]) {
    return errorResult(BTP_HINTS[type]);
  }

  // action="diff": unified diff between two source versions (single system). Bypasses the
  // cache/draft machinery below on purpose — both sides must be RAW source, or the no-draft
  // banner (sourceVersionWarning) would surface as a spurious hunk.
  // See docs/research/2026-06-15-version-diff-saved-read-action.md.
  if (args.action === 'diff') {
    if (!name) return errorResult('SAPRead action="diff" requires a "name".');
    const from = typeof args.from === 'string' && args.from ? args.from : 'active';
    const to = typeof args.to === 'string' && args.to ? args.to : 'inactive';
    try {
      const r = await getVersionDiff(client, type, name, from, to, {
        include: typeof args.include === 'string' ? args.include : undefined,
        group: typeof args.group === 'string' ? args.group : undefined,
      });
      if (r.identical) {
        return textResult(`No differences between ${from} and ${to} for ${type} ${name}.`);
      }
      return textResult(`Diff ${type} ${name}: ${from} → ${to}  (+${r.added} -${r.removed})\n\n${r.diff}`);
    } catch (err) {
      if (isNotFoundError(err)) {
        return errorResult(
          `Could not diff ${type} ${name}: object or revision not found.${err instanceof Error ? ` ${err.message}` : ''}`,
        );
      }
      throw err;
    }
  }

  // Server-driven objects (ABAP Platform 2025 / SAP_BASIS 8.16+): DESD, EVTB, DTSC, COTA, …
  // share one AFF generic-object contract (blue:blueSource metadata + AFF JSON source), read
  // via the discovery-gated generic engine instead of the per-type switch below. They bypass
  // the version/draft/cache machinery (no /source/main text; JSON output).
  if (isServerDrivenObjectType(type)) {
    if (!name) return errorResult(`"name" is required for SAPRead type=${type}.`);
    if (supportsServerDrivenObject(client.http, type) === false) {
      return errorResult(
        `SAPRead type=${type} (server-driven object) requires SAP_BASIS 8.16+ (ABAP Platform 2025 / S/4HANA 2025). ` +
          'This system does not expose this object type.',
      );
    }
    const sdo = await getServerDrivenObject(client.http, client.safety, type, name);
    return textResult(JSON.stringify(sdo, null, 2));
  }

  if (args.force_refresh === true && cachingLayer && VERSIONED_SOURCE_READ_TYPES.has(type)) {
    invalidateInactiveList(cachingLayer, client, cacheSecurity);
    cachingLayer.invalidate(type, name, 'all');
  }

  const { effectiveVersion, draft } = await resolveVersionAndDraftInfo(
    client,
    cachingLayer,
    type,
    name,
    requestedVersion,
    cacheSecurity,
  );
  const versionWarning = sourceVersionWarning(effectiveVersion, draft);

  // Helper: get source with cache support, returns cache hit status
  const cachedGet = async (
    objType: string,
    objName: string,
    version: SourceVersion,
    fetcher: (ifNoneMatch?: string) => Promise<SourceReadResult>,
  ): Promise<{ source: string; cacheHit: boolean; revalidated: boolean }> => {
    if (!cachingLayer) {
      const result = await fetcher(undefined);
      return { source: result.source, cacheHit: false, revalidated: false };
    }
    const { source, hit, revalidated } = await cachingLayer.getSource(objType, objName, fetcher, { version });
    return { source, cacheHit: hit, revalidated };
  };

  /** Prepend draft-awareness notes and cache indicator when the server revalidated a cached source. */
  const cachedTextResult = (source: string, cacheHit: boolean, revalidated: boolean, warning?: string): ToolResult => {
    const note = warning ? `${warning}\n\n` : '';
    const indicator = cacheHit && revalidated ? '[cached:revalidated]\n' : '';
    return textResult(`${note}${indicator}${source}`);
  };

  /** When args.grep is set, return only matching source lines (+context) instead of full source. */
  const grepText = (source: string): ToolResult => {
    const g = grepSource(source, String(args.grep));
    return g.invalidPattern ? errorResult(g.output) : textResult(g.output);
  };

  // Structured format is only supported for CLAS type
  if (args.format === 'structured' && type !== 'CLAS') {
    return errorResult('The "structured" format is only supported for CLAS type. Other types return text format.');
  }

  switch (type) {
    case 'PROG': {
      const { source, cacheHit, revalidated } = await cachedGet('PROG', name, effectiveVersion, (ifNoneMatch) =>
        client.getProgram(name, { ifNoneMatch, version: effectiveVersion }),
      );
      if (args.grep) return grepText(source);
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'CLAS': {
      // grep: return only matching source lines (+context), annotated with the owning class/method.
      if (args.grep) {
        if (args.method) {
          return errorResult(
            'Do not combine grep with method. Use grep to find code, then method="<name>" to read the full method.',
          );
        }
        const rawSection = args.include as string | undefined;
        // 'main' (and the default) live at /source/main, not /includes/main — read via the
        // cached main path; only real sub-includes go through the raw getClassInclude endpoint.
        const section = rawSection && rawSection.toLowerCase() !== 'main' ? rawSection : undefined;
        let clasSource: string;
        if (section) {
          try {
            clasSource = (await client.getClassInclude(name, section, { version: effectiveVersion })).source;
          } catch (err) {
            if (isNotFoundError(err)) {
              return textResult(
                `Include "${section}" is not available for class ${name}. Run grep without include= to search the full class source.`,
              );
            }
            throw err;
          }
        } else {
          clasSource = (
            await cachedGet('CLAS', name, effectiveVersion, (ifNoneMatch) =>
              client.getClass(name, undefined, { ifNoneMatch, version: effectiveVersion }),
            )
          ).source;
        }
        const abaplintVer = cachedFeatures?.abapRelease
          ? mapSapReleaseToAbaplintVersion(cachedFeatures.abapRelease)
          : undefined;
        // MethodInfo is a structural superset of grepSource's MethodRange — pass through directly.
        const listing = listMethods(clasSource, name, abaplintVer);
        const g = grepSource(clasSource, String(args.grep), listing.success ? { methods: listing.methods } : undefined);
        return g.invalidPattern
          ? errorResult(g.output)
          : textResult(`[${name} section=${rawSection ?? 'main'}]\n${g.output}`);
      }
      // Structured format: return JSON with metadata + decomposed source
      if (args.format === 'structured') {
        const structured = await client.getClassStructured(name);
        return textResult(JSON.stringify(structured, null, 2));
      }
      const methodParam = args.method as string | undefined;
      if (methodParam && !args.include) {
        // Method-level read — fetch full source then extract (no cache indicator for derived results)
        const { source: fullSource } = await cachedGet('CLAS', name, effectiveVersion, (ifNoneMatch) =>
          client.getClass(name, undefined, { ifNoneMatch, version: effectiveVersion }),
        );
        const abaplintVer = cachedFeatures?.abapRelease
          ? mapSapReleaseToAbaplintVersion(cachedFeatures.abapRelease)
          : undefined;
        if (methodParam === '*') {
          const listing = listMethods(fullSource, name, abaplintVer);
          return textResult(formatMethodListing(listing));
        }
        const extracted = extractMethod(fullSource, name, methodParam, abaplintVer);
        if (!extracted.success) {
          return errorResult(extracted.error ?? `Method "${methodParam}" not found in ${name}.`);
        }
        return cachedTextResult(extracted.methodSource, false, false, versionWarning);
      }
      // Only cache the full merged source (no include param), not individual includes
      if (!args.include) {
        const { source, cacheHit, revalidated } = await cachedGet('CLAS', name, effectiveVersion, (ifNoneMatch) =>
          client.getClass(name, undefined, { ifNoneMatch, version: effectiveVersion }),
        );
        return cachedTextResult(source, cacheHit, revalidated, versionWarning);
      }
      const includeResult = await client.getClass(name, args.include as string | undefined, {
        version: effectiveVersion,
      });
      return cachedTextResult(includeResult.source, false, false, versionWarning);
    }
    case 'INTF': {
      const { source, cacheHit, revalidated } = await cachedGet('INTF', name, effectiveVersion, (ifNoneMatch) =>
        client.getInterface(name, { ifNoneMatch, version: effectiveVersion }),
      );
      if (args.grep) return grepText(source);
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'FUNC': {
      let group = String(args.group ?? '');
      if (!group) {
        // Use cached func group resolution if available
        const resolved = cachingLayer
          ? await cachingLayer.resolveFuncGroup(client, name)
          : await client.resolveFunctionGroup(name);
        if (!resolved) {
          return errorResult(
            `Cannot resolve function group for "${name}". Provide the group parameter explicitly, or use SAPSearch("${name}") to find the function group.`,
          );
        }
        group = resolved;
      }
      const { source, cacheHit, revalidated } = await cachedGet('FUNC', name, effectiveVersion, (ifNoneMatch) =>
        client.getFunction(group, name, { ifNoneMatch, version: effectiveVersion }),
      );
      // Issue #252: when caller asks for includeSignature, return JSON with the
      // source body and the parsed structured signature.
      if (args.includeSignature === true) {
        const parsed = parseFmSignature(source);
        const grouped: Record<FmParameterKind, FmParameter[]> = {
          importing: [],
          exporting: [],
          changing: [],
          tables: [],
          exceptions: [],
          raising: [],
        };
        for (const p of parsed.params) grouped[p.kind].push(p);
        const payload = {
          source,
          signature: grouped,
        };
        return textResult(JSON.stringify(payload, null, 2));
      }
      if (args.grep) return grepText(source);
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'FUGR': {
      const expand = Boolean(args.expand_includes);
      if (expand) {
        // Recursive expansion: the function module bodies (FUNCTION…ENDFUNCTION) and
        // PBO/PAI modules live in nested includes (LZ<grp>U01, …O…, …I…) pulled in from
        // the UXX include — a one-level walk misses them. getFunctionGroupExpanded BFS-es
        // the include graph (depth/count-capped, cycle-guarded). Dynpros + GUI status are
        // not included: ADT doesn't expose them over REST (SAPGUI-only).
        const { blocks, truncated } = await client.getFunctionGroupExpanded(name, { version: effectiveVersion });
        const parts = blocks.map((b) => `=== ${b.name} ===\n${b.source}`);
        if (truncated) {
          parts.push(
            '=== [truncated] ===\nInclude cap reached; some nested includes were not expanded. ' +
              'Read remaining includes individually with SAPRead(type="INCL", name="...").',
          );
        }
        return textResult(parts.join('\n\n'));
      }
      const fg = await client.getFunctionGroup(name);
      return textResult(JSON.stringify(fg, null, 2));
    }
    case 'INCL': {
      const { source, cacheHit, revalidated } = await cachedGet('INCL', name, effectiveVersion, (ifNoneMatch) =>
        client.getInclude(name, { ifNoneMatch, version: effectiveVersion }),
      );
      if (args.grep) return grepText(source);
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'DDLS': {
      const {
        source: ddlSource,
        cacheHit,
        revalidated,
      } = await cachedGet('DDLS', name, effectiveVersion, (ifNoneMatch) =>
        client.getDdls(name, { ifNoneMatch, version: effectiveVersion }),
      );
      if (ddlSource.trim() === '') {
        return textResult(
          `DDLS ${name} exists in the object directory but has no source code stored. ` +
            `The DDL source may need to be written via SAPWrite(action="create" or "update", type="DDLS", name="${name}", source="...").`,
        );
      }
      if ((args.include as string | undefined)?.toLowerCase() === 'elements') {
        // Elements extraction is derived from source — no cache indicator
        return cachedTextResult(extractCdsElements(ddlSource, name), false, false, versionWarning);
      }
      if (args.grep) return grepText(ddlSource);
      return cachedTextResult(ddlSource, cacheHit, revalidated, versionWarning);
    }
    case 'DCLS': {
      const { source, cacheHit, revalidated } = await cachedGet('DCLS', name, effectiveVersion, (ifNoneMatch) =>
        client.getDcl(name, { ifNoneMatch, version: effectiveVersion }),
      );
      if (args.grep) return grepText(source);
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'BDEF': {
      const { source, cacheHit, revalidated } = await cachedGet('BDEF', name, effectiveVersion, (ifNoneMatch) =>
        client.getBdef(name, { ifNoneMatch, version: effectiveVersion }),
      );
      if (args.grep) return grepText(source);
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'SRVD': {
      const { source, cacheHit, revalidated } = await cachedGet('SRVD', name, effectiveVersion, (ifNoneMatch) =>
        client.getSrvd(name, { ifNoneMatch, version: effectiveVersion }),
      );
      if (args.grep) return grepText(source);
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'DDLX': {
      try {
        const { source, cacheHit, revalidated } = await cachedGet('DDLX', name, effectiveVersion, (ifNoneMatch) =>
          client.getDdlx(name, { ifNoneMatch, version: effectiveVersion }),
        );
        if (args.grep) return grepText(source);
        return cachedTextResult(source, cacheHit, revalidated, versionWarning);
      } catch (err) {
        if (isNotFoundError(err)) {
          return textResult(
            `No metadata extension (DDLX) found for "${name}". This means no @UI annotations are defined via DDLX for this view. The view may use inline annotations in the DDLS source, or the Fiori app may configure columns via manifest.json / app descriptor.`,
          );
        }
        throw err;
      }
    }
    case 'SRVB': {
      const { source, cacheHit, revalidated } = await cachedGet('SRVB', name, effectiveVersion, (ifNoneMatch) =>
        client.getSrvb(name, { ifNoneMatch, version: effectiveVersion }),
      );
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'SKTD': {
      try {
        // ADT returns a <sktd:docu> XML envelope with the Markdown body base64-encoded
        // inside <sktd:text>. Cache the raw envelope (update flow re-uses it) and
        // return the decoded Markdown to the LLM.
        const { source, cacheHit, revalidated } = await cachedGet('SKTD', name, effectiveVersion, (ifNoneMatch) =>
          client.getKtd(name, { ifNoneMatch, version: effectiveVersion }),
        );
        const markdown = decodeKtdText(source);
        if (args.grep) return grepText(markdown);
        return cachedTextResult(markdown, cacheHit, revalidated, versionWarning);
      } catch (err) {
        if (isNotFoundError(err)) {
          return textResult(
            `No Knowledge Transfer Document (SKTD) found for "${name}". KTD docs are optional Markdown documentation attached to ABAP objects — either one was never created for "${name}", or the name is wrong.`,
          );
        }
        throw err;
      }
    }
    case 'TABL': {
      // Unified TABL: covers transparent tables and DDIC structures (Model B).
      // client.getTabl() handles the /tables/ → /structures/ fallback internally
      // and caches the resolved URL for subsequent write/activate paths.
      const { source, cacheHit, revalidated } = await cachedGet('TABL', name, effectiveVersion, (ifNoneMatch) =>
        client.getTabl(name, { ifNoneMatch, version: effectiveVersion }),
      );
      if (args.grep) return grepText(source);
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'VIEW': {
      const { source, cacheHit, revalidated } = await cachedGet('VIEW', name, effectiveVersion, (ifNoneMatch) =>
        client.getView(name, { ifNoneMatch, version: effectiveVersion }),
      );
      if (args.grep) return grepText(source);
      return cachedTextResult(source, cacheHit, revalidated, versionWarning);
    }
    case 'DOMA': {
      const domain = await client.getDomain(name);
      return textResult(JSON.stringify(domain, null, 2));
    }
    case 'DTEL': {
      const dtel = await client.getDataElement(name);
      return textResult(JSON.stringify(dtel, null, 2));
    }
    case 'TTYP': {
      const ttyp = await client.getTableType(name);
      return textResult(JSON.stringify(ttyp, null, 2));
    }
    case 'AUTH': {
      const authField = await client.getAuthorizationField(name);
      return textResult(JSON.stringify(authField, null, 2));
    }
    case 'FTG2':
    case 'FEATURE_TOGGLE': {
      // FEATURE_TOGGLE is the canonical short type. 'FTG2' is a deprecated alias —
      // see docs/research/abap-types/types/ftg2.md (ARC-1-invented; zero hits in TADIR,
      // abap-file-formats, Eclipse apidoc). Removed in the next minor.
      if (type === 'FTG2') {
        logger.warn('SAPRead type "FTG2" is deprecated — use "FEATURE_TOGGLE" instead', {
          type: 'FTG2',
          replacement: 'FEATURE_TOGGLE',
        });
      }
      const toggle = await client.getFeatureToggle(name);
      return textResult(JSON.stringify(toggle, null, 2));
    }
    case 'ENHO': {
      const enhancement = await client.getEnhancementImplementation(name);
      return textResult(JSON.stringify(enhancement, null, 2));
    }
    case 'VERSIONS': {
      const include = typeof args.include === 'string' ? args.include : undefined;
      let group = typeof args.group === 'string' ? args.group : undefined;
      const objectType = normalizeObjectType(String(args.objectType ?? '')) || inferObjectType(name) || 'PROG';

      if (objectType === 'FUNC' && !group) {
        const resolved = cachingLayer
          ? await cachingLayer.resolveFuncGroup(client, name)
          : await client.resolveFunctionGroup(name);
        if (!resolved) {
          return errorResult(
            `Cannot resolve function group for "${name}". Provide the group parameter explicitly, or use SAPSearch("${name}") to find the function group.`,
          );
        }
        group = resolved;
      }

      try {
        const revisions = await client.getRevisions(objectType, name, { include, group });
        return textResult(JSON.stringify(revisions, null, 2));
      } catch (err) {
        if (isNotFoundError(err)) {
          return textResult(
            `No version history available for ${objectType} "${name}" on this SAP system. ` +
              `This usually means the object does not exist, or the ADT versions endpoint is not supported for ${objectType} on this backend release.`,
          );
        }
        throw err;
      }
    }
    case 'VERSION_SOURCE': {
      const versionUri = String(args.versionUri ?? '');
      if (!versionUri) {
        return errorResult(
          'VERSION_SOURCE requires a versionUri parameter. Get it from SAPRead(type="VERSIONS", name="...") response (.revisions[].uri).',
        );
      }
      try {
        return textResult(await client.getRevisionSource(versionUri));
      } catch (err) {
        if (isNotFoundError(err)) {
          return errorResult(
            `Revision at URI "${versionUri}" was not found. The revision may have been removed, or the URI is malformed. Fetch a fresh list via SAPRead(type="VERSIONS", name="...").`,
          );
        }
        throw err;
      }
    }
    case 'TRAN': {
      const tran = await client.getTransaction(name);
      // Enrich with program name via SQL — only if free SQL is allowed by safety config
      if (isOperationAllowed(client.safety, OperationType.FreeSQL)) {
        try {
          const safeName = name.toUpperCase().replace(/[^A-Z0-9_/]/g, '');
          const data = await client.runQuery(`SELECT TCODE, PGMNA FROM TSTC WHERE TCODE = '${safeName}'`, 1);
          if (data.rows.length > 0) {
            tran.program = String(data.rows[0]!.PGMNA ?? '').trim();
          }
        } catch {
          // SQL failed (e.g., TSTC not found on BTP) — still return metadata
        }
      }
      return textResult(JSON.stringify(tran, null, 2));
    }
    case 'API_STATE': {
      // Determine object type for URL construction — use explicit objectType, infer from name, or error
      const explicitType = normalizeObjectType(String(args.objectType ?? ''));
      const inferredType = explicitType || inferObjectType(name);
      if (!inferredType) {
        return errorResult(
          `Cannot infer object type from name "${name}". Please specify objectType explicitly (e.g., objectType="CLAS", "INTF", "PROG", "TABL", "DDLS", "DCLS", "FUGR", "DOMA", "DTEL", "SRVD", "SRVB", "BDEF").`,
        );
      }
      // Use raw URI (no name encoding) — getApiReleaseState encodes the full URI as a single path segment
      const objectUri = objectUrlForTypeRaw(inferredType, name);
      const releaseState = await client.getApiReleaseState(objectUri);
      return textResult(JSON.stringify(releaseState, null, 2));
    }
    case 'TABLE_CONTENTS': {
      const maxRows = Number(args.maxRows ?? 100);
      const data = await client.getTableContents(name, maxRows, args.sqlFilter as string | undefined);
      return textResult(JSON.stringify(data, null, 2));
    }
    case 'TABLE_QUERY': {
      const maxRows = Number(args.maxRows ?? 100);
      const columns = Array.isArray(args.columns) ? (args.columns as string[]) : undefined;
      const where = Array.isArray(args.where)
        ? (args.where as Array<{ field: string; op: string; value?: string }>)
        : undefined;
      try {
        const data = await client.runTableQuery(name, { columns, where, maxRows });
        return textResult(JSON.stringify(data, null, 2));
      } catch (err) {
        // Self-correct an unknown-column error (a bad entry in `columns`/`where`) by listing the
        // table's real columns (best-effort).
        const badColumn = extractUnknownColumn(err);
        if (badColumn) {
          try {
            const { columns: valid } = await client.getTableContents(name, 1);
            if (valid.length > 0) return errorResult(formatUnknownColumnHint(badColumn, name, valid));
          } catch {
            // best-effort — fall through to the original error
          }
        }
        throw err;
      }
    }
    case 'SOBJ': {
      const method = String(args.method ?? '');
      // Sanitize inputs to prevent SQL injection — BOR names are alphanumeric + underscore only
      const safeName = name.toUpperCase().replace(/[^A-Z0-9_/]/g, '');
      const safeMethod = method.toUpperCase().replace(/[^A-Z0-9_]/g, '');
      if (safeName !== name.toUpperCase().replace(/\s/g, '')) {
        return errorResult(
          `Invalid BOR object name: "${name}". Only alphanumeric characters, underscores, and slashes are allowed.`,
        );
      }
      if (safeMethod) {
        // Read specific BOR method implementation via SWOTLV lookup
        const data = await client.runQuery(
          `SELECT PROGNAME, FORMNAME FROM SWOTLV WHERE LOBJTYPE = '${safeName}' AND VERB = '${safeMethod}'`,
          1,
        );
        if (data.rows.length > 0) {
          const prog = String(data.rows[0]!.PROGNAME ?? '').trim();
          if (!prog) {
            return errorResult(`BOR method "${method}" on "${name}" has no program assigned.`);
          }
          const { source } = await client.getProgram(prog);
          return textResult(
            `=== BOR ${name}.${method} (program: ${prog}, form: ${String(data.rows[0]!.FORMNAME ?? '').trim()}) ===\n${source}`,
          );
        }
        return errorResult(
          `BOR method "${method}" not found on object type "${name}". Use SAPRead(type="SOBJ", name="${name}") without method to list all methods.`,
        );
      }
      // List all methods for this BOR object
      const methods = await client.runQuery(
        `SELECT VERB, PROGNAME, FORMNAME, DESCRIPT FROM SWOTLV WHERE LOBJTYPE = '${safeName}'`,
        100,
      );
      if (methods.rows.length === 0) {
        return errorResult(`No BOR methods found for object type "${name}". Verify the BOR object type name.`);
      }
      return textResult(JSON.stringify(methods, null, 2));
    }
    case 'DEVC': {
      const maxResults = args.maxResults != null ? Number(args.maxResults) : undefined;
      const contents = await client.getPackageContents(name, maxResults);
      return textResult(JSON.stringify(contents, null, 2));
    }
    case 'SYSTEM':
      return textResult(await client.getSystemInfo());
    case 'COMPONENTS': {
      const components = await client.getInstalledComponents();
      return textResult(JSON.stringify(components, null, 2));
    }
    case 'MESSAGES':
    case 'MSAG': {
      // MSAG is the canonical TADIR R3TR type for message classes; 'MESSAGES' is a
      // deprecated read alias kept for one minor release. See
      // docs/research/abap-types/types/msag.md.
      if (type === 'MESSAGES') {
        logger.warn('SAPRead type "MESSAGES" is deprecated — use "MSAG" instead', {
          type: 'MESSAGES',
          replacement: 'MSAG',
        });
      }
      try {
        const mcInfo = await client.getMessageClassInfo(name);
        return textResult(JSON.stringify(mcInfo, null, 2));
      } catch {
        // Fall back to legacy endpoint if messageclass endpoint unavailable
        return textResult(await client.getMessages(name));
      }
    }
    case 'TEXT_ELEMENTS':
      return textResult(await client.getTextElements(name));
    case 'VARIANTS':
      return textResult(await client.getVariants(name));
    case 'BSP': {
      if (cachedFeatures?.ui5 && !cachedFeatures.ui5.available) {
        return errorResult(
          'UI5/Fiori BSP Filestore is not available on this SAP system. Run SAPManage(action="probe") ' +
            'for the reason (often a missing S_ADT_RES authorization), or set SAP_FEATURE_UI5=on to force it on.',
        );
      }
      const include = args.include as string | undefined;
      if (!name) {
        // List all BSP apps (optional search via query param not used here since name is empty)
        const apps = await client.listBspApps();
        return textResult(JSON.stringify(apps, null, 2));
      }
      if (!include) {
        // Browse root structure of the app
        return textResult(JSON.stringify(await client.getBspAppStructure(name), null, 2));
      }
      // If include contains a dot, treat as file read; otherwise browse subfolder
      if (include.includes('.')) {
        return textResult(await client.getBspFileContent(name, include));
      }
      return textResult(JSON.stringify(await client.getBspAppStructure(name, `/${include}`), null, 2));
    }
    case 'BSP_DEPLOY': {
      if (cachedFeatures?.ui5repo && !cachedFeatures.ui5repo.available) {
        return errorResult(
          'ABAP Repository OData Service is not available on this SAP system. Run SAPManage(action="probe") ' +
            'for the reason, or set SAP_FEATURE_UI5REPO=on to force it on.',
        );
      }
      if (!name) {
        return errorResult('BSP_DEPLOY requires a name parameter (e.g., name="ZAPP_BOOKING").');
      }
      const info = await getAppInfo(client.http, client.safety, name);
      if (!info) {
        return textResult(`App "${name}" not found in ABAP Repository.`);
      }
      return textResult(JSON.stringify(info, null, 2));
    }
    case 'INACTIVE_OBJECTS': {
      const objects = await client.getInactiveObjects();
      return textResult(JSON.stringify({ count: objects.length, objects }, null, 2));
    }
    default:
      return errorResult(
        `Unknown SAPRead type: "${type}". Supported types: PROG, CLAS, INTF, FUNC, FUGR, INCL, DDLS, DCLS, DDLX, BDEF, SRVD, SRVB, SKTD, TABL, VIEW, DOMA, DTEL, MSAG, AUTH, FEATURE_TOGGLE, ENHO, VERSIONS, VERSION_SOURCE, TRAN, TABLE_CONTENTS, DEVC, SOBJ, SYSTEM, COMPONENTS, TEXT_ELEMENTS, VARIANTS, BSP, BSP_DEPLOY, API_STATE, INACTIVE_OBJECTS. Deprecated aliases: MESSAGES (use MSAG), FTG2 (use FEATURE_TOGGLE). ` +
          'Tip: Type aliases are auto-normalized (e.g., DDLS/DF → DDLS, DCLS/DL → DCLS, CLAS/OC → CLAS, PROG/P → PROG). ' +
          'Do not pass a URI — use the "type" and "name" parameters instead.',
      );
  }
}
