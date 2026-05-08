/**
 * Catalog of ADT object types that the probe checks.
 *
 * For each type we record:
 *   - the collection URL (what /discovery lists)
 *   - an object-level URL template for the "known-object" authoritative probe
 *   - one or more SAP-shipped objects that should exist on any healthy system
 *   - a release floor, derived from public SAP documentation
 *
 * Release floors are deliberately conservative ("this type is known to work
 * at this release or higher") and are used only as a weak tie-breaker signal —
 * they never alone mark a type unavailable. They exist mostly so the
 * `release-below-floor` branch can upgrade a "likely unavailable" verdict
 * to "high confidence", not to invent negatives.
 *
 * Known-object lists: these are SAP-shipped objects the probe reads without
 * side effects. Some types (BDEF, SRVD, DDLX, DCLS) have no universally-shipped
 * object, which is exactly the blind spot the quality metrics surface.
 */

import type { CatalogEntry } from './types.js';

/** Build the object URL from a template, url-encoding the name safely. */
export function buildObjectUrl(template: string, name: string): string {
  return template.replace('{name}', encodeURIComponent(name));
}

/**
 * Probe catalog. Order matters only for the report display order.
 * Keep grouped by category for reviewability.
 */
export const CATALOG: CatalogEntry[] = [
  // ─── Core ABAP (available on every release) ─────────────────────────
  {
    type: 'PROG',
    collectionUrl: '/sap/bc/adt/programs/programs',
    objectUrlTemplate: '/sap/bc/adt/programs/programs/{name}/source/main',
    knownObjects: ['SAPMSSY0', 'SAPMSSY1', 'RSPARAM'],
    minRelease: 700,
  },
  {
    type: 'CLAS',
    collectionUrl: '/sap/bc/adt/oo/classes',
    objectUrlTemplate: '/sap/bc/adt/oo/classes/{name}',
    knownObjects: ['CL_ABAP_TYPEDESCR', 'CL_GUI_FRONTEND_SERVICES'],
    minRelease: 700,
  },
  {
    type: 'INTF',
    collectionUrl: '/sap/bc/adt/oo/interfaces',
    objectUrlTemplate: '/sap/bc/adt/oo/interfaces/{name}/source/main',
    knownObjects: ['IF_SERIALIZABLE_OBJECT', 'IF_MESSAGE'],
    minRelease: 700,
  },
  {
    type: 'FUGR',
    collectionUrl: '/sap/bc/adt/functions/groups',
    objectUrlTemplate: '/sap/bc/adt/functions/groups/{name}',
    knownObjects: ['SPOP', 'SUNI'],
    minRelease: 700,
  },
  {
    type: 'INCL',
    collectionUrl: '/sap/bc/adt/programs/includes',
    objectUrlTemplate: '/sap/bc/adt/programs/includes/{name}/source/main',
    // LSLOGTOP ships on NW 7.50 kernels where RSDBCPRE is not always present
    // (contributed from #162 probe run against SAP_BASIS 750 SP 0031).
    knownObjects: ['RSDBCPRE', 'LSLOGTOP'],
    minRelease: 700,
  },
  {
    type: 'MSAG',
    collectionUrl: '/sap/bc/adt/messageclass',
    objectUrlTemplate: '/sap/bc/adt/messageclass/{name}',
    knownObjects: ['00', 'SY'],
    minRelease: 700,
  },

  // ─── DDIC (domains/data elements/tables) ────────────────────────────
  {
    // TABL covers both transparent tables (TABCLASS=TRANSP, served via /tables/)
    // and DDIC structures (TABCLASS=INTTAB/APPEND, served via /structures/).
    // The probe still hits /tables/ as the primary collection endpoint; the
    // structure URL is exercised at runtime via AdtClient.getTabl() fallback.
    type: 'TABL',
    collectionUrl: '/sap/bc/adt/ddic/tables',
    objectUrlTemplate: '/sap/bc/adt/ddic/tables/{name}/source/main',
    knownObjects: ['T000', 'USR01'],
    minRelease: 700,
    note: 'Source endpoint may require SAP_BASIS >= 7.52 on some systems. TABL covers transparent tables AND DDIC structures (the latter served at /sap/bc/adt/ddic/structures/{name}).',
  },
  {
    type: 'VIEW',
    // DDIC views go through the VIT generic-object endpoint, NOT /ddic/views/.
    // Live a4h S/4HANA 2023 + npl NW 7.50 (2026-05-08): /ddic/views/{name}
    // returns HTTP 500 and /ddic/views/{name}/source/main returns HTTP 404.
    // Only /sap/bc/adt/vit/wb/object_type/viewdv/object_name/{name} returns
    // 200 (with metadata XML — VIEW does not expose a /source/main
    // sub-resource). See research/abap-types/types/view.md and PR #223.
    collectionUrl: '/sap/bc/adt/vit/wb/object_type/viewdv',
    objectUrlTemplate: '/sap/bc/adt/vit/wb/object_type/viewdv/object_name/{name}',
    knownObjects: ['V_USR_NAME'],
    minRelease: 700,
  },
  {
    type: 'DOMA',
    collectionUrl: '/sap/bc/adt/ddic/domains',
    objectUrlTemplate: '/sap/bc/adt/ddic/domains/{name}',
    knownObjects: ['ABAP_BOOL', 'MANDT', 'XFELD'],
    minRelease: 700,
  },
  {
    type: 'DTEL',
    collectionUrl: '/sap/bc/adt/ddic/dataelements',
    objectUrlTemplate: '/sap/bc/adt/ddic/dataelements/{name}',
    knownObjects: ['MANDT', 'SPRAS', 'ERDAT'],
    minRelease: 700,
  },

  // ─── CDS / RAP ──────────────────────────────────────────────────────
  {
    type: 'DDLS',
    collectionUrl: '/sap/bc/adt/ddic/ddl/sources',
    objectUrlTemplate: '/sap/bc/adt/ddic/ddl/sources/{name}/source/main',
    // I_LANGUAGE is SAP-shipped on every release with CDS support (contributed
    // from #162 probe run — fills what was previously a known blind spot).
    knownObjects: ['I_LANGUAGE'],
    minRelease: 740,
    note: 'CDS introduced in 7.40 SP05; full ADT read support from 7.50+',
  },
  {
    type: 'DCLS',
    collectionUrl: '/sap/bc/adt/acm/dcl/sources',
    objectUrlTemplate: '/sap/bc/adt/acm/dcl/sources/{name}/source/main',
    // P_USER002 is SAP-shipped on NW 7.50+ (contributed from #162 probe run
    // against SAP_BASIS 750 SP 0031). DCLS is available on 750 with a more
    // limited CDS syntax — floor lowered from 751 accordingly.
    knownObjects: ['P_USER002'],
    minRelease: 750,
    note: 'CDS access controls — available on NW 7.50+ with limited syntax vs. newer releases',
  },
  {
    type: 'DDLX',
    collectionUrl: '/sap/bc/adt/ddic/ddlx/sources',
    objectUrlTemplate: '/sap/bc/adt/ddic/ddlx/sources/{name}/source/main',
    knownObjects: [],
    minRelease: 751,
    note: 'Metadata extensions — no universally-shipped DDLX',
  },
  {
    type: 'BDEF',
    collectionUrl: '/sap/bc/adt/bo/behaviordefinitions',
    objectUrlTemplate: '/sap/bc/adt/bo/behaviordefinitions/{name}/source/main',
    knownObjects: [],
    minRelease: 754,
    note: 'RAP behavior definitions — no universally-shipped BDEF',
  },
  {
    type: 'SRVD',
    collectionUrl: '/sap/bc/adt/ddic/srvd/sources',
    objectUrlTemplate: '/sap/bc/adt/ddic/srvd/sources/{name}/source/main',
    knownObjects: [],
    minRelease: 754,
    note: 'Service definitions — no universally-shipped SRVD',
  },
  {
    type: 'SRVB',
    collectionUrl: '/sap/bc/adt/businessservices/bindings',
    objectUrlTemplate: '/sap/bc/adt/businessservices/bindings/{name}',
    knownObjects: [],
    minRelease: 754,
    note: 'Service bindings — collection URL differs from /ddic/srvb',
  },

  // ─── Authorization & Switch Framework ───────────────────────────────
  {
    type: 'AUTH',
    collectionUrl: '/sap/bc/adt/aps/iam/auth',
    objectUrlTemplate: '/sap/bc/adt/aps/iam/auth/{name}',
    knownObjects: ['ACTVT', 'MANDT'],
    minRelease: 751,
    note: 'Authorization field read — may require newer ICF activation',
  },
  {
    type: 'FTG2',
    collectionUrl: '/sap/bc/adt/sfw/featuretoggles',
    objectUrlTemplate: '/sap/bc/adt/sfw/featuretoggles/{name}/states',
    knownObjects: [],
    minRelease: 752,
    note: 'Switch Framework feature toggles — no universally-shipped toggle',
  },
  {
    type: 'ENHO',
    collectionUrl: '/sap/bc/adt/enhancements/enhoxhb',
    objectUrlTemplate: '/sap/bc/adt/enhancements/enhoxhb/{name}',
    knownObjects: [],
    minRelease: 702,
    note: 'Enhancement implementations — no universally-shipped ENHO',
  },
];

/** Get a catalog entry by type code (case-insensitive). */
export function getCatalogEntry(type: string): CatalogEntry | undefined {
  const upper = type.toUpperCase();
  return CATALOG.find((e) => e.type === upper);
}
