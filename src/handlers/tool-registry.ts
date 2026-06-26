/**
 * Single source of truth for the per-tool object-type lists.
 *
 * Before this module these arrays were hand-duplicated in both `tools.ts` (JSON Schema enums
 * for LLM clients) and `schemas.ts` (Zod runtime validation), with no check that the two copies
 * agreed. Drift here is a correctness bug: a type advertised to the LLM but rejected by Zod (or
 * vice-versa). Both files now import from here, and `tests/unit/handlers/registry-sync.test.ts`
 * asserts the JSON-Schema enums, the Zod enums, and the dispatch switch all stay in agreement.
 *
 * Each tool has ONE `*_TYPE_TABLE` listing every type with a `btp` flag (true = available on BTP
 * ABAP Environment). The ONPREM (superset) and BTP arrays are DERIVED from that table, so they can
 * never disagree and there is no separate on-prem-only list to keep in sync.
 *
 * To add/remove a SAPRead/SAPWrite/SAPContext type:
 *   1. Add/remove ONE row in the matching `*_TYPE_TABLE` below, with its `btp` flag. (Exception:
 *      server-driven types — their rows derive from `SDO_TYPES`, so register the type in
 *      src/adt/server-driven.ts instead and both tables pick it up.)
 *   2. Add/remove the matching `case` in the tool's handler module: SAPRead → src/handlers/read.ts,
 *      SAPWrite → src/handlers/write.ts (note write routes by URL via objectBasePath/server-driven,
 *      not a per-type switch — see the registry-sync write-routing guard), SAPContext →
 *      src/handlers/context.ts.
 *   3. Add/remove the ACTION_POLICY entry if it needs a non-default scope (src/authz/policy.ts).
 * The registry-sync + validate:policy checks will fail loudly if any of these drift.
 *
 * The derived arrays keep literal element types (`.map`/`.filter` over an `as const` table), so both
 * `z.enum(...)` (needs a readonly string list) and the JSON-Schema `enum: [...]` consume the exact
 * same literal set, in table order.
 */

import { SDO_TYPES } from '../adt/server-driven.js';

/**
 * Pull the on-prem (all rows) + BTP (btp:true rows) type arrays out of an `as const` type table.
 * The return type is annotated explicitly — inside the generic body `r.type` is seen as plain
 * `string` (property access resolves via the constraint), so without the annotation every derived
 * array and union would silently widen from literal types to `string`, losing compile-time typo
 * protection for consumers. Throws on a duplicate `type` row at module load: Zod's z.enum would
 * silently dedupe it while the JSON-Schema `enum:` shipped to LLM clients would carry the
 * duplicate — strict clients reject such a schema, and no equality test could catch it because
 * every comparison derives from this same table.
 */
function deriveTypeArrays<const R extends { readonly type: string; readonly btp: boolean }>(
  table: readonly R[],
): { onprem: R['type'][]; btp: Extract<R, { btp: true }>['type'][] } {
  const seen = new Set<string>();
  for (const row of table) {
    if (seen.has(row.type)) throw new Error(`tool-registry: duplicate type row '${row.type}' in a *_TYPE_TABLE`);
    seen.add(row.type);
  }
  return {
    onprem: table.map((r) => r.type),
    btp: table.filter((r): r is Extract<R, { btp: true }> => r.btp).map((r) => r.type),
  };
}

// ─── SAPRead ────────────────────────────────────────────────────────

const SAPREAD_TYPE_TABLE = [
  { type: 'PROG', btp: false },
  { type: 'CLAS', btp: true },
  { type: 'INTF', btp: true },
  { type: 'FUNC', btp: true },
  { type: 'FUGR', btp: true },
  { type: 'INCL', btp: false },
  { type: 'DDLS', btp: true },
  { type: 'DCLS', btp: true },
  { type: 'DDLX', btp: true },
  { type: 'BDEF', btp: true },
  { type: 'SRVD', btp: true },
  { type: 'SRVB', btp: true },
  { type: 'SKTD', btp: true },
  // Friendly alias for Knowledge Transfer Documents; normalized to canonical SKTD at dispatch.
  { type: 'KTD', btp: true },
  { type: 'TABL', btp: true },
  { type: 'VIEW', btp: false },
  { type: 'DOMA', btp: true },
  { type: 'DTEL', btp: true },
  { type: 'TRAN', btp: false },
  { type: 'TTYP', btp: false },
  { type: 'TABLE_CONTENTS', btp: true },
  { type: 'TABLE_QUERY', btp: true },
  { type: 'DEVC', btp: true },
  { type: 'SOBJ', btp: false },
  { type: 'SYSTEM', btp: true },
  { type: 'COMPONENTS', btp: true },
  // MSAG is the canonical TADIR R3TR type for message classes (table T100). 'MESSAGES' is kept as a
  // deprecated alias for one minor release; both resolve to the same handler. See
  // docs/research/abap-types/types/msag.md and docs/plans/completed/2026-05-08-audit-symmetry-and-ftg2-rename.md.
  { type: 'MSAG', btp: true },
  { type: 'MESSAGES', btp: true },
  { type: 'TEXT_ELEMENTS', btp: false },
  { type: 'VARIANTS', btp: false },
  { type: 'BSP', btp: true },
  { type: 'BSP_DEPLOY', btp: true },
  { type: 'API_STATE', btp: true },
  { type: 'INACTIVE_OBJECTS', btp: true },
  { type: 'AUTH', btp: false },
  // FTG2 is an ARC-1-private invented identifier (see docs/research/abap-types/types/ftg2.md).
  // FEATURE_TOGGLE is the new canonical name; FTG2 stays as deprecated alias for one minor.
  { type: 'FEATURE_TOGGLE', btp: false },
  { type: 'FTG2', btp: false },
  { type: 'ENHO', btp: false },
  { type: 'VERSIONS', btp: false },
  { type: 'VERSION_SOURCE', btp: false },
  // Server-driven objects (ABAP Platform 2025 / SAP_BASIS 8.16+) — generic AFF read path,
  // discovery-gated (src/adt/server-driven.ts). Rows DERIVE from SDO_TYPES, so registering a type
  // there is the only step: btp is true by construction (SDO types are 8.16+; runtime availability
  // is discovery-gated), and deriveTypeArrays' duplicate guard throws if a hand row ever collides.
  ...SDO_TYPES.map((t) => ({ type: t, btp: true }) as const),
] as const;
const sapReadTypes = deriveTypeArrays(SAPREAD_TYPE_TABLE);
/** All SAPRead object types available on on-premise (the superset). */
export const SAPREAD_TYPES_ONPREM = sapReadTypes.onprem;
/** SAPRead types available on BTP ABAP Environment (the `btp: true` rows). */
export const SAPREAD_TYPES_BTP = sapReadTypes.btp;

// ─── SAPWrite ───────────────────────────────────────────────────────

const SAPWRITE_TYPE_TABLE = [
  { type: 'PROG', btp: false },
  { type: 'CLAS', btp: true },
  { type: 'INTF', btp: true },
  { type: 'FUNC', btp: false },
  { type: 'FUGR', btp: false },
  { type: 'INCL', btp: false },
  { type: 'DDLS', btp: true },
  { type: 'DCLS', btp: true },
  { type: 'DDLX', btp: true },
  { type: 'BDEF', btp: true },
  { type: 'SRVD', btp: true },
  { type: 'SRVB', btp: true },
  { type: 'SKTD', btp: true },
  // Friendly alias for Knowledge Transfer Documents; normalized to canonical SKTD at dispatch.
  { type: 'KTD', btp: true },
  { type: 'TABL', btp: true },
  // Subtype routing for create — see docs/plans/completed/2026-05-27-fix-tabl-ds-create-routing.md.
  { type: 'TABL/DT', btp: true },
  { type: 'TABL/DS', btp: true },
  { type: 'DOMA', btp: true },
  { type: 'DTEL', btp: true },
  { type: 'MSAG', btp: true },
  { type: 'TTYP', btp: false },
  // Server-driven objects (8.16+) — write via the generic blue:blueSource + AFF JSON engine.
  // Rows derive from SDO_TYPES exactly like the SAPRead table above.
  ...SDO_TYPES.map((t) => ({ type: t, btp: true }) as const),
] as const;
const sapWriteTypes = deriveTypeArrays(SAPWRITE_TYPE_TABLE);
/** All SAPWrite object types available on on-premise (the superset). */
export const SAPWRITE_TYPES_ONPREM = sapWriteTypes.onprem;
/** SAPWrite types available on BTP ABAP Environment (the `btp: true` rows). */
export const SAPWRITE_TYPES_BTP = sapWriteTypes.btp;

// ─── SAPContext ─────────────────────────────────────────────────────

const SAPCONTEXT_TYPE_TABLE = [
  { type: 'CLAS', btp: true },
  { type: 'INTF', btp: true },
  { type: 'PROG', btp: false },
  { type: 'FUNC', btp: false },
  { type: 'DDLS', btp: true },
  { type: 'TABL', btp: true },
] as const;
const sapContextTypes = deriveTypeArrays(SAPCONTEXT_TYPE_TABLE);
/** SAPContext types on on-premise. */
export const SAPCONTEXT_TYPES_ONPREM = sapContextTypes.onprem;
/** SAPContext types on BTP. */
export const SAPCONTEXT_TYPES_BTP = sapContextTypes.btp;

// ─── Derived union types ────────────────────────────────────────────

export type SapReadType = (typeof SAPREAD_TYPES_ONPREM)[number];
export type SapWriteType = (typeof SAPWRITE_TYPES_ONPREM)[number];
export type SapContextType = (typeof SAPCONTEXT_TYPES_ONPREM)[number];
