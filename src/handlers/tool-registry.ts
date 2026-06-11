/**
 * Single source of truth for the per-tool object-type lists.
 *
 * Before this module these arrays were hand-duplicated in both `tools.ts` (JSON Schema enums
 * for LLM clients) and `schemas.ts` (Zod runtime validation), with no check that the two copies
 * agreed. Drift here is a correctness bug: a type advertised to the LLM but rejected by Zod (or
 * vice-versa). Both files now import from here, and `tests/unit/handlers/registry-sync.test.ts`
 * asserts the JSON-Schema enums, the Zod enums, and the dispatch switch all stay in agreement.
 *
 * To add/remove a SAPRead/SAPWrite/SAPContext type:
 *   1. Edit the relevant array here (BTP lists must stay a subset of the on-prem list).
 *   2. Add/remove the matching `case` in the handler (src/handlers/intent.ts).
 *   3. Add/remove the ACTION_POLICY entry if it needs a non-default scope (src/authz/policy.ts).
 * The registry-sync + validate:policy checks will fail loudly if any of these drift.
 *
 * Arrays are `as const` so both `z.enum(...)` (needs a readonly tuple) and the JSON-Schema
 * `enum: [...]` consume the exact same literal set.
 */

// ─── SAPRead ────────────────────────────────────────────────────────

/** All SAPRead object types available on on-premise (the superset). */
export const SAPREAD_TYPES_ONPREM = [
  'PROG',
  'CLAS',
  'INTF',
  'FUNC',
  'FUGR',
  'INCL',
  'DDLS',
  'DCLS',
  'DDLX',
  'BDEF',
  'SRVD',
  'SRVB',
  'SKTD',
  'TABL',
  'VIEW',
  'DOMA',
  'DTEL',
  'TRAN',
  'TABLE_CONTENTS',
  'TABLE_QUERY',
  'DEVC',
  'SOBJ',
  'SYSTEM',
  'COMPONENTS',
  // MSAG is the canonical TADIR R3TR type for message classes (table T100).
  // 'MESSAGES' is kept as a deprecated alias for one minor release; both
  // resolve to the same handler. See research/abap-types/types/msag.md and
  // docs/plans/completed/audit-symmetry-and-ftg2-rename.md.
  'MSAG',
  'MESSAGES',
  'TEXT_ELEMENTS',
  'VARIANTS',
  'BSP',
  'BSP_DEPLOY',
  'API_STATE',
  'INACTIVE_OBJECTS',
  'AUTH',
  // FTG2 is an ARC-1-private invented identifier (see research/abap-types/types/ftg2.md).
  // FEATURE_TOGGLE is the new canonical name; FTG2 stays as deprecated alias for one minor.
  'FEATURE_TOGGLE',
  'FTG2',
  'ENHO',
  'VERSIONS',
  'VERSION_SOURCE',
  // Server-driven objects (ABAP Platform 2025 / SAP_BASIS 8.16+) — generic AFF read path,
  // discovery-gated (src/adt/server-driven.ts). Read returns JSON metadata + AFF JSON source.
  'DESD',
  'DTSC',
  'CSNM',
  'EVTB',
  'EVTO',
  'COTA',
] as const;

/** SAPRead types available on BTP ABAP Environment (no PROG, INCL, VIEW, TEXT_ELEMENTS, VARIANTS). */
export const SAPREAD_TYPES_BTP = [
  'CLAS',
  'INTF',
  'FUNC',
  'FUGR',
  'DDLS',
  'DCLS',
  'DDLX',
  'BDEF',
  'SRVD',
  'SRVB',
  'SKTD',
  'TABL',
  'DOMA',
  'DTEL',
  'TABLE_CONTENTS',
  'TABLE_QUERY',
  'DEVC',
  'SYSTEM',
  'COMPONENTS',
  // MSAG canonical, MESSAGES deprecated alias (see research/abap-types/types/msag.md)
  'MSAG',
  'MESSAGES',
  'BSP',
  'BSP_DEPLOY',
  'API_STATE',
  'INACTIVE_OBJECTS',
  // Server-driven objects (8.16+ / ABAP Cloud) — generic AFF read path, discovery-gated.
  'DESD',
  'DTSC',
  'CSNM',
  'EVTB',
  'EVTO',
  'COTA',
] as const;

// ─── SAPWrite ───────────────────────────────────────────────────────

/** All SAPWrite object types available on on-premise (the superset). */
export const SAPWRITE_TYPES_ONPREM = [
  'PROG',
  'CLAS',
  'INTF',
  'FUNC',
  'FUGR',
  'INCL',
  'DDLS',
  'DCLS',
  'DDLX',
  'BDEF',
  'SRVD',
  'SRVB',
  'SKTD',
  'TABL',
  // Subtype routing for create — see docs/plans/completed/fix-tabl-ds-create-routing.md.
  'TABL/DT',
  'TABL/DS',
  'DOMA',
  'DTEL',
  'MSAG',
  // Server-driven objects (8.16+) — write via the generic blue:blueSource + AFF JSON engine.
  'DESD',
  'DTSC',
  'CSNM',
  'EVTB',
  'EVTO',
  'COTA',
] as const;

/** SAPWrite types available on BTP ABAP Environment (no PROG, INCL, FUNC, FUGR). */
export const SAPWRITE_TYPES_BTP = [
  'CLAS',
  'INTF',
  'DDLS',
  'DCLS',
  'DDLX',
  'BDEF',
  'SRVD',
  'SRVB',
  'SKTD',
  'TABL',
  'TABL/DT',
  'TABL/DS',
  'DOMA',
  'DTEL',
  'MSAG',
  // Server-driven objects (8.16+ / ABAP Cloud) — write via the generic blue:blueSource + AFF JSON engine.
  'DESD',
  'DTSC',
  'CSNM',
  'EVTB',
  'EVTO',
  'COTA',
] as const;

// ─── SAPContext ─────────────────────────────────────────────────────

/** SAPContext types on on-premise. */
export const SAPCONTEXT_TYPES_ONPREM = ['CLAS', 'INTF', 'PROG', 'FUNC', 'DDLS'] as const;
/** SAPContext types on BTP. */
export const SAPCONTEXT_TYPES_BTP = ['CLAS', 'INTF', 'DDLS'] as const;

// ─── Derived union types ────────────────────────────────────────────

export type SapReadType = (typeof SAPREAD_TYPES_ONPREM)[number];
export type SapWriteType = (typeof SAPWRITE_TYPES_ONPREM)[number];
export type SapContextType = (typeof SAPCONTEXT_TYPES_ONPREM)[number];
