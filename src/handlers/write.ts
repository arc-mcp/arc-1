/**
 * SAPWrite handler — create/update/delete ABAP source + DDIC metadata, class-section surgery,
 * RAP scaffolding, batch create.
 *
 * This file is the orchestrator: handleSAPWrite resolves the request prologue (object/source URLs
 * + the three shared closures), packs them into a SapWriteContext (./write/context.ts), and
 * dispatches to the per-action handlers in ./write/{create,update-delete,class-surgery,rap}.ts.
 * The context carries everything those action handlers reference.
 */

import type { AdtClient } from '../adt/client.js';
import { AdtSafetyError } from '../adt/errors.js';
import { isServerDrivenObjectType } from '../adt/server-driven.js';
import type { ClassStructure } from '../adt/types.js';
import type { CachingLayer } from '../cache/caching-layer.js';
import type { ServerConfig } from '../server/types.js';
import { type CacheSecurityContext, invalidateInactiveList } from './cache-security.js';
import { isTablesEndpointAvailable, isTableTypesEndpointAvailable } from './feature-cache.js';
import {
  canonicalTablType,
  normalizeClassWriteInclude,
  normalizeWriteObjectType,
  objectUrlForType,
  sourceUrlForType,
} from './object-types.js';
import { resolveVersionAndDraftInfo, type SourceVersion } from './read.js';
import { errorResult, type ToolResult } from './shared.js';
import {
  writeActionAddMethod,
  writeActionChangeMethodVisibility,
  writeActionDeleteMethod,
  writeActionEditClassDefinition,
  writeActionEditMethod,
  writeActionEditMethodSignature,
} from './write/class-surgery.js';
import type { SapWriteContext } from './write/context.js';
import { writeActionBatchCreate, writeActionCreate } from './write/create.js';
import { writeActionGenerateBehaviorImplementation, writeActionScaffoldRapHandlers } from './write/rap.js';
import { writeActionDelete, writeActionEditTextSymbols, writeActionUpdate } from './write/update-delete.js';
import {
  enforceAllowedPackageForObjectUrl,
  handleServerDrivenObjectWrite,
  NAME_CASE_GUARD_ACTIONS,
  TABL_DT_WRITE_UNAVAILABLE_HINT,
  TTYP_WRITE_UNAVAILABLE_HINT,
} from './write-helpers.js';

export async function handleSAPWrite(
  client: AdtClient,
  args: Record<string, unknown>,
  config: ServerConfig,
  cachingLayer: CachingLayer | undefined,
  cacheSecurity: CacheSecurityContext,
): Promise<ToolResult> {
  const action = String(args.action ?? '');
  const type = normalizeWriteObjectType(String(args.type ?? ''));
  const name = String(args.name ?? '');
  const source = String(args.source ?? '');
  const hasSource = typeof args.source === 'string';
  const include = normalizeClassWriteInclude(args.include);
  // Whether a non-empty include was actually requested. Some MCP clients serialize
  // an omitted optional string as "" — treat empty/whitespace as "not provided" so
  // those clients aren't rejected with a bogus "Invalid CLAS include" on the MAIN path.
  const includeProvided = typeof args.include === 'string' && args.include.trim() !== '';
  const transport = args.transport as string | undefined;
  const lintOverride = args.lintBeforeWrite as boolean | undefined;
  const preflightOverride = args.preflightBeforeWrite as boolean | undefined;
  const checkOverride = args.checkBeforeWrite as boolean | undefined;

  // type and name are required for all actions except batch_create
  if (action !== 'batch_create' && (!type || !name)) {
    return errorResult('"type" and "name" are required for this action.');
  }

  // SAP TADIR stores object names uppercase. Mixed-case names cause silent corruption
  // on create (e.g. DDLS "Zc_MyView" registers as "ZC_MYVIEW" in TADIR but the source body
  // still contains "Zc_MyView", confusing every downstream tool) and broken URL lookups on
  // mutate/delete — the lock is held against the canonical uppercase name while the request
  // URL carries the mixed-case one, which surfaces on ECC as 423 "... is not locked" (issue
  // #293, original report used name "Z_HELLO_world"). Reject pre-flight for every name-bearing
  // single-object action — universal SAP convention, not a 7.50 quirk. (batch_create validates
  // each item separately below.)
  // Note: source code INSIDE the object can use mixed case (e.g. for DDLS: name="ZC_MYVIEW"
  // but `define view entity Zc_MyView` is fine inside the source body).
  if (NAME_CASE_GUARD_ACTIONS.has(action) && name && name !== name.toUpperCase()) {
    return errorResult(
      `Object name "${name}" contains lowercase characters. SAP object names must be uppercase (e.g. "${name.toUpperCase()}").\n\n` +
        `Note: the object NAME in TADIR must be uppercase, but the source code inside the object can use mixed case ` +
        `(e.g. for DDLS: name="${name.toUpperCase()}" but source can contain "define view entity ${name}").`,
    );
  }

  // Server-driven objects (ABAP Platform 2025 / SAP_BASIS 8.16+): DESD, EVTB, DTSC, CSNM, EVTO, COTA
  // share one AFF generic-object write contract (POST blue:blueSource metadata → PUT AFF JSON source
  // → activate). They route through the dedicated engine instead of the per-type switch below —
  // objectBasePath(<sdo>) throws, so this MUST come before the objectUrl computation. Mirrors the
  // server-driven branch in handleSAPRead.
  if (isServerDrivenObjectType(type)) {
    return handleServerDrivenObjectWrite(client, action, type, name, args, cachingLayer, cacheSecurity);
  }

  // For TABL update/delete/edit_method, the existing object may live at /tables/
  // (transparent) or /structures/ (DDIC structure). Resolve once via the client's
  // cached URL probe. For 'create' the default /tables/ URL is correct (we only
  // create transparent tables today; structure creation is out of scope).
  //
  // For FUNC, the URL has the parent function group baked into the path:
  //   /sap/bc/adt/functions/groups/{group_lc}/fmodules/{name_lc}
  // `objectBasePath('FUNC')` deliberately throws (PR #223 — generic URL builders
  // must fail loudly for FM since they can't know the parent group). Issue #250:
  // we pre-resolve the URL here from `args.group` (required for create; auto-
  // resolved via search for update/delete) so the action switch downstream uses
  // the correct URL. We also mirror the resolved group back onto args so
  // `buildCreateXml('FUNC', …, properties)` finds it.
  let objectUrl: string;
  let srcUrl: string;
  if (
    (type === 'TABL' || type === 'TABL/DT' || type === 'TABL/DS') &&
    action !== 'create' &&
    action !== 'batch_create'
  ) {
    // All TABL forms route through the search-first resolver on update/delete/activate
    // so the PR #286 SE11-hint refusal applies even when callers pass an explicit slash form.
    try {
      objectUrl = await client.resolveTablObjectUrlForWrite(name, {
        tablesEndpointAvailable: isTablesEndpointAvailable(),
      });
    } catch (resolveErr) {
      if (resolveErr instanceof AdtSafetyError) {
        return errorResult(resolveErr.message);
      }
      throw resolveErr;
    }
    srcUrl = `${objectUrl}/source/main`;
  } else if (type === 'FUNC') {
    let group = String(args.group ?? '').trim();
    if (!group) {
      if (action === 'create') {
        return errorResult(
          '"group" is required to create a FUNC. Create the parent function group first (SAPWrite type=FUGR) or pass group explicitly.',
        );
      }
      // For update/delete try to auto-resolve the group via search
      const resolved = cachingLayer
        ? await cachingLayer.resolveFuncGroup(client, name)
        : await client.resolveFunctionGroup(name);
      if (!resolved) {
        return errorResult(
          `Cannot resolve function group for FM "${name}". Provide the "group" parameter explicitly, or use SAPSearch to find the parent group.`,
        );
      }
      group = resolved;
    }
    const groupLc = encodeURIComponent(group.toLowerCase());
    objectUrl = `/sap/bc/adt/functions/groups/${groupLc}/fmodules/${encodeURIComponent(name.toLowerCase())}`;
    srcUrl = `${objectUrl}/source/main`;
    // Pass the resolved group through to buildCreateXml via args.group
    (args as Record<string, unknown>).group = group;
  } else if (type === 'INCL' && String(args.group ?? '').trim()) {
    if (action !== 'update') {
      return errorResult(
        'SAPWrite type=INCL with group supports action="update" only; create/delete of FUGR structural includes is unsupported.',
      );
    }
    // FUGR structural include update (LZ<grp>TOP global data, form/PBO/PAI includes): addressed by
    // type=INCL + group=<FUGR>. The include OBJECT is the lock + package-resolution target — its
    // containerRef carries the group's packageName, and locking the GROUP 423s the source PUT
    // (live-verified a4h 816 + 758). A bare INCL with no group stays a standalone /programs/includes/.
    const groupLc = encodeURIComponent(String(args.group).trim().toLowerCase());
    objectUrl = `/sap/bc/adt/functions/groups/${groupLc}/includes/${encodeURIComponent(name.toLowerCase())}`;
    srcUrl = `${objectUrl}/source/main`;
  } else {
    // Discovery gate: refuse transparent-table creates upfront on systems that
    // don't expose /ddic/tables/ (NW 7.50/7.51). TABL/DS skips this — /structures/
    // is always available. See issue #285.
    if ((type === 'TABL' || type === 'TABL/DT') && (action === 'create' || action === 'batch_create')) {
      if (isTablesEndpointAvailable() === false) {
        return errorResult(TABL_DT_WRITE_UNAVAILABLE_HINT);
      }
    }
    // Discovery gate: TTYP (table type) create needs /ddic/tabletypes/, absent on NW 7.50 (FEAT-65).
    if (type === 'TTYP' && action === 'create' && isTableTypesEndpointAvailable() === false) {
      return errorResult(TTYP_WRITE_UNAVAILABLE_HINT);
    }
    objectUrl = objectUrlForType(type, name);
    srcUrl = sourceUrlForType(type, name);
  }

  const invalidateWrittenObject = (objType = type, objName = name): void => {
    // Source cache is keyed by canonical type (SAPRead collapses TABL/DT, TABL/DS).
    cachingLayer?.invalidate(canonicalTablType(objType), objName, 'all');
    invalidateInactiveList(cachingLayer, client, cacheSecurity);
  };

  // Helper: enforce allowedPackages for existing objects (update/delete/edit_method/scaffold_rap_handlers).
  // Only fetches metadata when package restrictions are configured — no extra HTTP call otherwise.
  // Fail-closed: if the package cannot be determined from ADT metadata, refuse the write
  // rather than silently passing through the allowlist gate.
  async function enforcePackageForExistingObject(): Promise<string | undefined> {
    return enforceAllowedPackageForObjectUrl(client, objectUrl, `Operations on ${type} '${name}'`);
  }

  // Helper for class-section surgery (issue #303): fetch the class structure AND
  // /source/main at the SAME effective version, so the spliced line ranges line
  // up with the bytes being edited. resolveVersionAndDraftInfo picks 'inactive'
  // when an unactivated draft exists. We pass that version to BOTH getClassStructure
  // (the /objectstructure?version= read) and the source read, AND to the cache opts
  // (so inactive bytes aren't cached under the 'active' key). Without this, a chained
  // surgery call on a draft would splice active-version line ranges into inactive
  // source and silently corrupt the draft.
  async function fetchClassStructureAndMain(
    clsName: string,
  ): Promise<{ structure: ClassStructure; main: string; effectiveVersion: SourceVersion }> {
    const { effectiveVersion } = await resolveVersionAndDraftInfo(
      client,
      cachingLayer,
      'CLAS',
      clsName,
      'auto',
      cacheSecurity,
    );
    const structure = await client.getClassStructure(clsName, effectiveVersion);
    const main = cachingLayer
      ? (
          await cachingLayer.getSource(
            'CLAS',
            clsName,
            (ifNoneMatch) => client.getClass(clsName, undefined, { ifNoneMatch, version: effectiveVersion }),
            { version: effectiveVersion },
          )
        ).source
      : (await client.getClass(clsName, undefined, { version: effectiveVersion })).source;
    return { structure, main, effectiveVersion };
  }

  const ctx: SapWriteContext = {
    client,
    args,
    config,
    cachingLayer,
    cacheSecurity,
    type,
    name,
    source,
    hasSource,
    include,
    includeProvided,
    transport,
    lintOverride,
    preflightOverride,
    checkOverride,
    objectUrl,
    srcUrl,
    invalidateWrittenObject,
    enforcePackageForExistingObject,
    fetchClassStructureAndMain,
  };

  switch (action) {
    case 'update':
      return writeActionUpdate(ctx);
    case 'create':
      return writeActionCreate(ctx);
    case 'edit_method':
      return writeActionEditMethod(ctx);

    // Class-section surgery actions (issue #303) — see write/class-surgery.ts.
    case 'edit_class_definition':
      return writeActionEditClassDefinition(ctx);

    case 'edit_method_signature':
      return writeActionEditMethodSignature(ctx);

    case 'add_method':
      return writeActionAddMethod(ctx);

    case 'delete_method':
      return writeActionDeleteMethod(ctx);

    case 'change_method_visibility':
      return writeActionChangeMethodVisibility(ctx);

    case 'scaffold_rap_handlers':
      return writeActionScaffoldRapHandlers(ctx);
    case 'generate_behavior_implementation':
      return writeActionGenerateBehaviorImplementation(ctx);
    case 'delete':
      return writeActionDelete(ctx);
    case 'batch_create':
      return writeActionBatchCreate(ctx);

    // Class text symbols (Textelemente) — write a global class's text pool (type=CLAS, on-prem).
    case 'edit_text_symbols':
      return writeActionEditTextSymbols(ctx);
    default:
      return errorResult(
        `Unknown SAPWrite action: ${action}. Supported: create, update, delete, edit_method, batch_create, scaffold_rap_handlers, generate_behavior_implementation`,
      );
  }
}
