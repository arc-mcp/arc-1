/**
 * Object-type normalization + ADT URL building (pure utilities, no project-internal imports).
 *
 * Slash-form alias maps, canonical-type normalization, the objectBasePath/URL builders,
 * LLM arg-stripping, and class-include helpers. Moved verbatim from intent.ts
 * (docs/plans/architecture-consolidation-plan.md, Stage B).
 */

// ─── Object URL Mapping ──────────────────────────────────────────────

// Every entry verified against either Eclipse ADT apidoc 3.58.1, live a4h S/4HANA
// 2023 + npl NW 7.50 ADT responses (captured 2026-05-08 — both systems agree), or
// abap-file-formats schemas. Per-entry evidence in research/abap-types/types/<x>.md.
// SLASH_TYPE_EVIDENCE below MUST stay key-equal (anti-cargo-cult guard, enforced by
// tests/unit/handlers/slash-type-map.test.ts — see issue #218 follow-up).
// Exported for tests only — the citation guard
// (tests/unit/handlers/slash-type-map.test.ts) needs to assert key-equality
// against SLASH_TYPE_EVIDENCE so a new entry without evidence fails CI.
// Production callers should keep using normalizeObjectType().
export const SLASH_TYPE_MAP: Record<string, string> = {
  'PROG/P': 'PROG', // research/abap-types/types/prog.md
  'PROG/I': 'INCL', // research/abap-types/types/incl.md
  'CLAS/OC': 'CLAS', // research/abap-types/types/clas.md
  // 'CLAS/LI' removed — invented; absent from Eclipse apidoc; no live ADT response
  // emits it. Pass-through means schema validation rejects it loudly.
  'INTF/OI': 'INTF', // research/abap-types/types/intf.md
  // 'FUNC/FM' removed — invented; ADT emits FUGR/FF for function modules, not
  // FUNC/FM. Function modules are LIMU FUNC under R3TR FUGR.
  'FUGR/F': 'FUGR', // function group container — research/abap-types/types/fugr.md
  // FUGR/FF is a function module (LIMU FUNC under FUGR), not the function group.
  // Live a4h: GET .../groups/su_user/fmodules/bapi_user_getlist returns
  // adtcore:type="FUGR/FF" with <adtcore:containerRef adtcore:type="FUGR/F"/>.
  'FUGR/FF': 'FUNC', // research/abap-types/types/fugr.md + func.md
  'DDLS/DF': 'DDLS', // research/abap-types/types/ddls.md
  'DCLS/DL': 'DCLS', // research/abap-types/types/dcls.md
  'BDEF/BDO': 'BDEF', // research/abap-types/types/bdef.md
  'SRVD/SRV': 'SRVD', // research/abap-types/types/srvd.md
  'SRVB/SVB': 'SRVB', // research/abap-types/types/srvb.md
  'DDLX/EX': 'DDLX', // research/abap-types/types/ddlx.md (live a4h + npl 2026-05-08)
  // DDIC TABL: ADT exposes /DT (transparent table) and /DS (DDIC structure)
  // subtypes. Both share TADIR R3TR TABL (DD02L-TABCLASS = TRANSP vs INTTAB).
  // ARC-1 collapses both into the canonical short type 'TABL' (Model B — see
  // docs/plans/completed/collapse-stru-into-tabl.md).
  'TABL/DT': 'TABL', // research/abap-types/types/tabl.md
  'TABL/DS': 'TABL', // research/abap-types/types/tabl.md
  // Legacy slash-form alias — ADT never actually returns this, but pre-Model-B
  // ARC-1 prompts learned it from older docs. Kept so they normalize to TABL
  // instead of producing a schema error. Bare 'STRU' is NOT aliased.
  'STRU/DS': 'TABL', // research/abap-types/types/tabl.md (legacy alias)
  'DOMA/DD': 'DOMA', // research/abap-types/types/doma.md
  'DTEL/DE': 'DTEL', // research/abap-types/types/dtel.md
  'MSAG/N': 'MSAG', // research/abap-types/types/msag.md
  'DEVC/K': 'DEVC', // research/abap-types/types/devc.md
  // TRAN/T (was TRAN/O — invented). Live a4h + npl 2026-05-08 both return
  // adtcore:type="TRAN/T" for SE38, SU01, etc.
  'TRAN/T': 'TRAN', // research/abap-types/types/tran.md
  // VIEW/DV (was VIEW/V — invented). Live a4h + npl 2026-05-08 both return
  // adtcore:type="VIEW/DV" for V_USR_NAME.
  'VIEW/DV': 'VIEW', // research/abap-types/types/view.md
  'SKTD/TYP': 'SKTD', // research/abap-types/types/sktd.md
};

/**
 * Citation guard companion for SLASH_TYPE_MAP. Keys MUST stay key-equal to
 * SLASH_TYPE_MAP (enforced by tests/unit/handlers/slash-type-map.test.ts). Each
 * value points at a research evidence file or a fixture that backs the slash code.
 * Adding an entry without evidence is the anti-cargo-cult guard.
 */
export const SLASH_TYPE_EVIDENCE: Record<string, string> = {
  'PROG/P': 'research/abap-types/types/prog.md',
  'PROG/I': 'research/abap-types/types/incl.md',
  'CLAS/OC': 'research/abap-types/types/clas.md',
  'INTF/OI': 'research/abap-types/types/intf.md',
  'FUGR/F': 'research/abap-types/types/fugr.md',
  'FUGR/FF': 'research/abap-types/types/fugr.md',
  'DDLS/DF': 'research/abap-types/types/ddls.md',
  'DCLS/DL': 'research/abap-types/types/dcls.md',
  'BDEF/BDO': 'research/abap-types/types/bdef.md',
  'SRVD/SRV': 'research/abap-types/types/srvd.md',
  'SRVB/SVB': 'research/abap-types/types/srvb.md',
  'DDLX/EX': 'research/abap-types/types/ddlx.md',
  'TABL/DT': 'research/abap-types/types/tabl.md',
  'TABL/DS': 'research/abap-types/types/tabl.md',
  'STRU/DS': 'research/abap-types/types/tabl.md',
  'DOMA/DD': 'research/abap-types/types/doma.md',
  'DTEL/DE': 'research/abap-types/types/dtel.md',
  'MSAG/N': 'research/abap-types/types/msag.md',
  'DEVC/K': 'research/abap-types/types/devc.md',
  'TRAN/T': 'research/abap-types/types/tran.md',
  'VIEW/DV': 'research/abap-types/types/view.md',
  'SKTD/TYP': 'research/abap-types/types/sktd.md',
};

/**
 * Set of canonical short types that MUST have a working `objectBasePath` case.
 * Drives the exhaustiveness guard inside `objectBasePath` so a new canonical type
 * added to SAPRead/SAPWrite enums without an URL builder fails loudly. The VIEW
 * silent-fallthrough bug (research/abap-types/types/view.md) is exactly what this
 * guard prevents from reoccurring.
 */
export const KNOWN_BASE_TYPES = new Set([
  'PROG',
  'CLAS',
  'INTF',
  'INCL',
  'FUGR',
  'FUNC',
  'DDLS',
  'DCLS',
  'BDEF',
  'SRVD',
  'SRVB',
  'DDLX',
  'TABL',
  'DOMA',
  'DTEL',
  'MSAG',
  'DEVC',
  'TRAN',
  'VIEW',
  'SKTD',
]);

/** Normalize ADT type codes and aliases to ARC-1 canonical short types. */
export function normalizeObjectType(type: string): string {
  const normalized = String(type).trim().toUpperCase();
  if (!normalized) return '';
  return SLASH_TYPE_MAP[normalized] ?? normalized;
}

/** TABL subtypes that SAPWrite preserves (instead of collapsing to bare 'TABL' via
 *  SLASH_TYPE_MAP) so the create path can route TABL/DT → /ddic/tables and
 *  TABL/DS → /ddic/structures. See docs/plans/completed/fix-tabl-ds-create-routing.md. */
const TABL_WRITE_SUBTYPES = new Set(['TABL/DT', 'TABL/DS']);

/** Legacy slash-form aliases SAPWrite remaps to a canonical subtype before
 *  SLASH_TYPE_MAP runs — otherwise STRU/DS would collapse to bare 'TABL' and
 *  route the structure create to /ddic/tables. */
const SAPWRITE_TABL_ALIAS: Record<string, string> = {
  'STRU/DS': 'TABL/DS',
};

/** SAPWrite-only normalizer: preserves TABL/DT and TABL/DS and remaps STRU/DS
 *  to TABL/DS. Every other tool keeps the global collapsing behaviour of
 *  `normalizeObjectType`. */
export function normalizeWriteObjectType(type: string): string {
  const normalized = String(type).trim().toUpperCase();
  if (!normalized) return '';
  const aliased = SAPWRITE_TABL_ALIAS[normalized];
  if (aliased) return aliased;
  if (TABL_WRITE_SUBTYPES.has(normalized)) return normalized;
  return SLASH_TYPE_MAP[normalized] ?? normalized;
}

/** Collapse TABL/DT and TABL/DS back to bare 'TABL' for downstream Set-membership
 *  checks (DDIC hints, RAP preflight, CDS dependency hints, cache invalidation)
 *  that only know about canonical types. The slash form survives at URL routing
 *  + XML envelope sites. */
export function canonicalTablType(type: string): string {
  return type === 'TABL/DT' || type === 'TABL/DS' ? 'TABL' : type;
}

/**
 * Fields whose handler INTENTIONALLY treats an explicit empty string as a meaningful
 * signal distinct from "omitted", so the pre-validation strip must keep an empty-STRING
 * value (a `null` is still stripped — the handlers treat null as omitted):
 *  - `target` — SAPTransport create rejects a "provided but empty" target as a caller
 *    mistake (vs omitted → local); see `targetProvided` in handleSAPTransport.
 *  - `proposalUserContent` — SAPDiagnose apply_quickfix forwards an empty
 *    `<userContent></userContent>` verbatim.
 * Keep this set minimal: it only needs entries where a handler distinguishes ""-present
 * from absent. Empty strings on enums/numbers/everything-else are safe to strip.
 */
const EMPTY_STRING_MEANINGFUL_FIELDS = new Set(['target', 'proposalUserContent']);

/**
 * Strip GPT/OpenAI "overpopulation" pollution before Zod validation:
 *  - `null` values — OpenAI Structured Outputs / `strict` mode (the default for the
 *    Responses API) emulates an optional field as a `["type","null"]` union and emits
 *    `null` for every unused optional. `z.X().optional()` rejects `null`, so a strict
 *    caller otherwise cannot make a clean call (every unused optional becomes null →
 *    rejected). `null` is ALWAYS stripped (handlers treat null as omitted).
 *  - empty / whitespace-only strings — many callers serialize an omitted optional as
 *    `""`. On optional enums that hard-rejects; on optional numbers `z.coerce.number("")`
 *    silently becomes `0`. Stripped, EXCEPT for the EMPTY_STRING_MEANINGFUL_FIELDS above.
 *
 * Preserves real `false` and `0` — ONLY `null` and empty/whitespace strings are removed.
 * Shallow at the top level, plus one level into each `objects[]` item (SAPWrite
 * `batch_create` / SAPActivate batch). Deliberately does NOT recurse into leaf data
 * arrays (`messages`/`fixedValues`/`parameters`/`where`) — those carry user data where
 * an empty string or null may be meaningful. See issue #360.
 */
export function stripLlmEmptyValues(args: Record<string, unknown>): Record<string, unknown> {
  const isStrippable = (key: string, v: unknown): boolean =>
    v === null || (typeof v === 'string' && v.trim() === '' && !EMPTY_STRING_MEANINGFUL_FIELDS.has(key));
  const cleanShallow = (obj: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (!isStrippable(k, v)) out[k] = v;
    }
    return out;
  };
  const cleaned = cleanShallow(args);
  if (Array.isArray(cleaned.objects)) {
    cleaned.objects = cleaned.objects.map((o) =>
      o && typeof o === 'object' && !Array.isArray(o) ? cleanShallow(o as Record<string, unknown>) : o,
    );
  }
  return cleaned;
}

/** Normalize type fields before schema validation so slash/case aliases are accepted.
 *  Also strips GPT/OpenAI pollution (null + empty strings) via stripLlmEmptyValues so the
 *  same normalization runs for every tool — standard, hyperfocused, and the CLI all route
 *  through handleToolCall, which calls this once before scope derivation + Zod (issue #360).
 *  Exported for unit tests (the include-drop + strip behavior). */
export function normalizeTypeArgsForValidation(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const cleaned = stripLlmEmptyValues(args);
  switch (toolName) {
    case 'SAPRead':
      return {
        ...cleaned,
        type: normalizeObjectType(String(cleaned.type ?? '')),
        objectType:
          cleaned.objectType === undefined ? undefined : normalizeObjectType(String(cleaned.objectType ?? '')),
      };
    case 'SAPWrite': {
      // SAPWrite preserves TABL/DT and TABL/DS so the create path can route by subtype.
      const normType = cleaned.type === undefined ? undefined : normalizeWriteObjectType(String(cleaned.type ?? ''));
      // Drop an inapplicable `include`: it is only meaningful for a CLAS local-include
      // write (update/edit_method/edit_class_definition). GPT/OpenAI callers frequently
      // attach include="definitions" to unrelated writes (DDLS/PROG/DTEL/delete/batch_create),
      // which validateSapWriteInput would otherwise hard-reject even though the requested
      // intent is valid. A garbage include VALUE on a real CLAS include path is still
      // rejected by the z.enum check downstream (issue #360).
      const action = String(cleaned.action ?? '');
      const includeApplies =
        normType === 'CLAS' && (action === 'update' || action === 'edit_method' || action === 'edit_class_definition');
      if (!includeApplies) delete cleaned.include;
      return {
        ...cleaned,
        type: normType,
        objects: Array.isArray(cleaned.objects)
          ? cleaned.objects.map((obj) =>
              typeof obj === 'object' && obj !== null
                ? {
                    ...obj,
                    type: normalizeWriteObjectType(String((obj as Record<string, unknown>).type ?? '')),
                  }
                : obj,
            )
          : cleaned.objects,
      };
    }
    case 'SAPActivate':
      return {
        ...cleaned,
        type: cleaned.type === undefined ? undefined : normalizeObjectType(String(cleaned.type ?? '')),
        objects: Array.isArray(cleaned.objects)
          ? cleaned.objects.map((obj) =>
              typeof obj === 'object' && obj !== null
                ? {
                    ...obj,
                    type: normalizeObjectType(String((obj as Record<string, unknown>).type ?? '')),
                  }
                : obj,
            )
          : cleaned.objects,
      };
    case 'SAPSearch':
      return {
        ...cleaned,
        objectType:
          cleaned.objectType === undefined ? undefined : normalizeObjectType(String(cleaned.objectType ?? '')),
      };
    case 'SAPNavigate':
      // Only normalize `type` (for URL building). `objectType` is passed to SAP's
      // where-used scope API in slash format (e.g., CLAS/OC) — normalizing it would break the filter.
      return {
        ...cleaned,
        type: cleaned.type === undefined ? undefined : normalizeObjectType(String(cleaned.type ?? '')),
      };
    case 'SAPDiagnose':
      return {
        ...cleaned,
        type: cleaned.type === undefined ? undefined : normalizeObjectType(String(cleaned.type ?? '')),
      };
    case 'SAPContext':
      return {
        ...cleaned,
        type: cleaned.type === undefined ? undefined : normalizeObjectType(String(cleaned.type ?? '')),
      };
    case 'SAPTransport':
      // Normalize `type` for SAPTransport actions that route through
      // objectBasePath (e.g. when a future action accepts a slash-form
      // workbench type). Codex review of PR #223 flagged this gap: without
      // normalization, a caller passing `type: 'FUNC/FM'` would slip past the
      // string-typed schema and hit the slash-form throw inside objectBasePath,
      // which is correct as a last-resort fence but not as a friendly error.
      return {
        ...cleaned,
        type: cleaned.type === undefined ? undefined : normalizeObjectType(String(cleaned.type ?? '')),
      };
    default:
      return cleaned;
  }
}

/**
 * Base path for an object type. Returns path prefix without trailing name segment.
 * Exported for tests (Plan A Task 4 — exhaustiveness guard regression test).
 */
export function objectBasePath(type: string): string {
  switch (type) {
    case 'PROG':
      return '/sap/bc/adt/programs/programs/';
    case 'CLAS':
      return '/sap/bc/adt/oo/classes/';
    case 'INTF':
      return '/sap/bc/adt/oo/interfaces/';
    case 'FUNC':
      // Codex review of PR #223 follow-up: function modules cannot be
      // addressed with a single base path — they live at
      // /sap/bc/adt/functions/groups/{group}/fmodules/{fm} and require the
      // parent function group. Returning the group prefix for FUNC was the
      // pre-PR behaviour and silently mis-routed a real ADT search result
      // `{ type: "FUGR/FF", name: "BAPI_USER_GETLIST" }` (which now
      // canonicalises to FUNC) to /functions/groups/BAPI_USER_GETLIST. Throw
      // so generic URL builders (SAPActivate / SAPDiagnose / SAPTransport via
      // objectUrlForType) fail loudly. SAPRead and SAPNavigate handle FUNC
      // through dedicated `case 'FUNC'` branches that take a `group` arg and
      // build the correct URL via client.getFunction(group, name) — those
      // paths do not call objectBasePath and remain unaffected.
      throw new Error(
        `objectBasePath: type 'FUNC' (function module) cannot be resolved to a ` +
          `single base path — it requires the parent function group via ` +
          `client.getFunction(group, name) or an explicit /sap/bc/adt/functions/` +
          `groups/{group}/fmodules/{name} URI. Caller must take the FUNC-aware ` +
          `path or pass 'uri' directly. See PR #223 codex follow-up.`,
      );
    case 'INCL':
      return '/sap/bc/adt/programs/includes/';
    case 'FUGR':
      return '/sap/bc/adt/functions/groups/';
    case 'DDLS':
      return '/sap/bc/adt/ddic/ddl/sources/';
    case 'DCLS':
      return '/sap/bc/adt/acm/dcl/sources/';
    case 'BDEF':
      return '/sap/bc/adt/bo/behaviordefinitions/';
    case 'SRVD':
      return '/sap/bc/adt/ddic/srvd/sources/';
    case 'DDLX':
      return '/sap/bc/adt/ddic/ddlx/sources/';
    case 'SRVB':
      return '/sap/bc/adt/businessservices/bindings/';
    case 'TABL':
    case 'TABL/DT':
      // Bare TABL defaults to transparent table. For reads, callers should use
      // AdtClient.resolveTablObjectUrl(name) which falls back to /structures/ on 404.
      return '/sap/bc/adt/ddic/tables/';
    case 'TABL/DS':
      // DDIC structures only route through this collection; see follow-up to #285.
      return '/sap/bc/adt/ddic/structures/';
    case 'DOMA':
      return '/sap/bc/adt/ddic/domains/';
    case 'DTEL':
      return '/sap/bc/adt/ddic/dataelements/';
    case 'MSAG':
      return '/sap/bc/adt/messageclass/';
    case 'DEVC':
      return '/sap/bc/adt/packages/';
    case 'TRAN':
      // VIT generic-object endpoint. The 'trant' infix is the ADT workbench type
      // for transactions; live a4h + npl 2026-05-08 confirm GET with this prefix
      // returns 200 for SE38/SU01.
      return '/sap/bc/adt/vit/wb/object_type/trant/object_name/';
    case 'VIEW':
      // VIT generic-object endpoint for DDIC views. /sap/bc/adt/ddic/views/
      // returns HTTP 500 on a4h + npl (verified 2026-05-08); only the VIT URL
      // works. Without this case, VIEW reads silently fell through to
      // /programs/programs/ — see research/abap-types/types/view.md.
      return '/sap/bc/adt/vit/wb/object_type/viewdv/object_name/';
    case 'SKTD':
      return '/sap/bc/adt/documentation/ktd/documents/';
    default:
      // Exhaustiveness guard: canonical types in KNOWN_BASE_TYPES MUST have a
      // switch case — that catches the silent-fallthrough bug class (VIEW pre-PR).
      if (KNOWN_BASE_TYPES.has(type)) {
        throw new Error(
          `objectBasePath: canonical type '${type}' is in KNOWN_BASE_TYPES but ` +
            `has no switch case. Add a case here or remove it from KNOWN_BASE_TYPES. ` +
            `See docs/plans/completed/audit-purge-invented-adt-types.md.`,
        );
      }
      // Slash-form guard: a normalized slash code (e.g. 'FUNC/FM', 'CLAS/LI',
      // 'VIEW/V', 'TRAN/O') must NEVER reach here. If it did, normalizeObjectType
      // failed to map it and we'd silently route the request to the program
      // endpoint. Tools like SAPNavigate/SAPActivate/SAPDiagnose/SAPTransport
      // accept `type: string` (no enum), so the schema layer can't catch this
      // for them — only this guard can. Throw with a hint pointing at the
      // citation guard so the contributor adds the alias correctly. Codex
      // review of PR #223 caught that the previous default-fallback could
      // still silently route removed aliases via these non-enum tools.
      if (type.includes('/')) {
        throw new Error(
          `objectBasePath: refusing to build URL for slash-form type '${type}' — ` +
            `this normally indicates an invented or unmapped ADT slash code. Add ` +
            `it to SLASH_TYPE_MAP + SLASH_TYPE_EVIDENCE (with a research entry) ` +
            `if it is real, or correct the caller. See ` +
            `docs/plans/completed/audit-purge-invented-adt-types.md and ` +
            `tests/unit/handlers/slash-type-map.test.ts.`,
        );
      }
      // Unknown raw inputs (no slash, not canonical) fall through to the
      // program path so legacy callers like inferObjectType keep working.
      return '/sap/bc/adt/programs/programs/';
  }
}

/** Map object type + name to the ADT object URL used by CRUD/DevTools/etc. Name is URI-encoded. */
export function objectUrlForType(type: string, name: string): string {
  // KTD endpoints require lowercase object names in the URL path (confirmed via Eclipse ADT trace).
  const effectiveName = type === 'SKTD' ? name.toLowerCase() : name;
  return `${objectBasePath(type)}${encodeURIComponent(effectiveName)}`;
}

/** Infer SAP object type from naming conventions. Returns empty string if type cannot be determined. */
export function inferObjectType(name: string): string {
  const upper = name.toUpperCase();
  if (upper.startsWith('IF_') || upper.startsWith('ZIF_') || upper.startsWith('YIF_')) return 'INTF';
  if (upper.startsWith('CL_') || upper.startsWith('ZCL_') || upper.startsWith('YCL_')) return 'CLAS';
  if (upper.startsWith('CX_') || upper.startsWith('ZCX_') || upper.startsWith('YCX_')) return 'CLAS';
  return '';
}

/**
 * Map object type + name to the ADT object URL WITHOUT encoding the name.
 * Used for API release state where the full URI is encoded as a single path segment by the caller.
 */
export function objectUrlForTypeRaw(type: string, name: string): string {
  const effectiveName = type === 'SKTD' ? name.toLowerCase() : name;
  return `${objectBasePath(type)}${effectiveName}`;
}

/** Get the source URL for an object (appends /source/main) */
export function sourceUrlForType(type: string, name: string): string {
  return `${objectUrlForType(type, name)}/source/main`;
}

export type ClassWriteInclude = 'definitions' | 'implementations' | 'macros' | 'testclasses';
export const CLASS_WRITE_INCLUDES: readonly ClassWriteInclude[] = [
  'definitions',
  'implementations',
  'macros',
  'testclasses',
];

/** Get a CLAS include URL (definitions/implementations/macros/testclasses) */
export function classIncludeUrl(name: string, include: ClassWriteInclude): string {
  return `/sap/bc/adt/oo/classes/${encodeURIComponent(name)}/includes/${include}`;
}

export function normalizeClassWriteInclude(include: unknown): ClassWriteInclude | undefined {
  if (typeof include !== 'string') return undefined;
  const normalized = include.toLowerCase() as ClassWriteInclude;
  return CLASS_WRITE_INCLUDES.includes(normalized) ? normalized : undefined;
}

/**
 * Auto-detect which class include a method specifier targets, based on the
 * local-class prefix on the LHS of `<localclass>~<method>`. Used by
 * `edit_method` so callers can pass `lhc_project~approve_project` and have
 * ARC-1 transparently route the read+write to `/includes/implementations`
 * instead of `/source/main`.
 *
 * Prefix → include mapping (intentionally narrow; extend via explicit
 * `include` parameter when a code-base uses other conventions):
 *   - `lhc_*`  → implementations (RAP behavior pool handler classes)
 *   - `lcl_*`  → implementations (local helper classes)
 *   - `ltc_*`  → testclasses    (ABAP Unit local test classes)
 *
 * Returns `undefined` for:
 *   - Specifiers with no `~` (route to MAIN)
 *   - Global-interface methods like `zif_order~create`, `if_oo_adt_classrun~main`
 *     (route to MAIN — the impl lives in a global class)
 *   - `lif_*` local interfaces (interfaces only declare methods — there's no
 *     impl in CCDEF; an `lhc_*`/`lcl_*` class implements them and the call
 *     site uses that class's prefix instead)
 */
export function detectLocalHandlerInclude(method: string): ClassWriteInclude | undefined {
  if (!method.includes('~')) return undefined;
  const lhs = method.slice(0, method.indexOf('~')).trim().toLowerCase();
  if (/^(lhc|lcl)_/.test(lhs)) return 'implementations';
  if (/^ltc_/.test(lhs)) return 'testclasses';
  return undefined;
}

/** Strip the leading "=== <include> ===\n" header that `client.getClass(name, include)` prepends. */
export function stripIncludeHeader(source: string): string {
  return source.replace(/^=== \w+ ===\n/, '');
}
