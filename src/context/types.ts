/**
 * Types for the SAPContext dependency compression pipeline.
 *
 * The pipeline works in three stages:
 * 1. deps.ts   — Extract dependency names from ABAP source (AST-based)
 * 2. contract.ts — Extract public API contracts from dependency source
 * 3. compressor.ts — Orchestrate: fetch sources, compress, format output
 */

/** A dependency found in CDS DDL source code */
export interface CdsDependency {
  /** Entity/table name (e.g., zsalesorder, ZI_CUSTOMER) */
  name: string;
  /** How the dependency is referenced in the CDS DDL */
  kind: 'data_source' | 'association' | 'composition' | 'projection_base';
}

/** A dependency found in ABAP source code */
export interface Dependency {
  /** Object name (e.g., ZCL_ITEM, ZIF_ORDER) */
  name: string;
  /** How the dependency is used */
  kind: DependencyKind;
  /** Source line where the reference was found (1-based) */
  line: number;
}

/** How a dependency is referenced in ABAP source */
export type DependencyKind =
  | 'inheritance' // INHERITING FROM
  | 'interface' // INTERFACES statement
  | 'type_ref' // TYPE REF TO, NEW, CAST
  | 'static_call' // ClassName=>method()
  | 'function_call' // CALL FUNCTION 'name'
  | 'exception'; // RAISING, CATCH

/** Compressed contract for a single dependency */
export interface Contract {
  /** Object name */
  name: string;
  /** Inferred object type */
  type: 'CLAS' | 'INTF' | 'FUNC' | 'UNKNOWN';
  /** Number of public methods (for stats line) */
  methodCount: number;
  /** Compressed source — public API only */
  source: string;
  /** Full uncompressed source — used for recursive dependency extraction */
  fullSource?: string;
  /** Whether fetching/extraction succeeded */
  success: boolean;
  /** Error message if fetch/extraction failed */
  error?: string;
}

/** Full context compression result */
export interface ContextResult {
  /** Target object name */
  objectName: string;
  /** Target object type */
  objectType: string;
  /** Root-source dependency candidates after filtering */
  depsFound: number;
  /** Contracts resolved across all explored levels */
  depsResolved: number;
  /** Root candidates not fetched; excludes failed attempts and deeper unexpanded work */
  depsFiltered: number;
  /** Failed source-resolution attempts across all explored levels */
  depsFailed: number;
  /** Total lines in output */
  totalLines: number;
  /** Formatted output prologue */
  output: string;
}
