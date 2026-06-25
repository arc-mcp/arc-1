/**
 * Zod v4 input schemas for all 12 MCP tools.
 *
 * These schemas provide runtime validation via safeParse() in handleToolCall().
 * The JSON Schema the LLM sees is hand-written in tools.ts (NOT generated from these). Generating
 * it via z.toJSONSchema() was evaluated and rejected — the 263 LLM-facing descriptions live only in
 * tools.ts (these schemas carry ~zero .describe()), and `.transform()` fields can't be represented;
 * see docs/research/zod-to-jsonschema-spike.md. The two are kept in sync by schema-key-sync,
 * registry-sync, zod-jsonschema-parity, and tool-definitions-snapshot tests, not by generation.
 *
 * BTP variants exclude types not available on BTP ABAP Environment.
 * Numeric fields use z.coerce.number() for MCP client compatibility
 * (clients may send "100" as a string).
 */

import { z } from 'zod';
import { MAX_GREP_PATTERN_LENGTH } from '../context/grep.js';
import { CLASS_WRITE_INCLUDES } from './object-types.js';
import {
  SAPCONTEXT_TYPES_BTP,
  SAPCONTEXT_TYPES_ONPREM,
  SAPREAD_TYPES_BTP,
  SAPREAD_TYPES_ONPREM,
  SAPWRITE_TYPES_BTP,
  SAPWRITE_TYPES_ONPREM,
} from './tool-registry.js';

// Re-exported so tests/unit/handlers/schemas.test.ts can assert the write-type matrix against
// the single source of truth. The lists themselves live in tool-registry.ts.
export { SAPWRITE_TYPES_BTP, SAPWRITE_TYPES_ONPREM };

/**
 * Optional boolean that accepts real JSON booleans AND string-serialized booleans from
 * MCP/LLM clients, but — unlike `z.coerce.boolean()` — correctly maps "false"/"0"/"no"/""
 * to `false` (`z.coerce.boolean()` runs `Boolean()`, so the string "false" becomes `true`,
 * silently inverting intent — live-proven DDIC corruption, issue #360). This is the standard
 * for EVERY optional boolean field in this file. Do NOT use `z.coerce.boolean()` (inverts
 * stringified false) or `z.stringbool()` (rejects real JSON booleans, which compliant clients
 * like Claude send). Defined at the top because the SAPRead/SAPSearch schemas below reference it.
 */
const looseOptionalBoolean = z
  .preprocess((v) => {
    if (typeof v === 'string') {
      const s = v.trim().toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
      if (s === 'false' || s === '0' || s === 'no' || s === 'off' || s === '') return false;
    }
    // Numeric 0/1 (some clients send numeric booleans). Other numbers fall through to
    // z.boolean() and are rejected — unlike z.coerce.boolean() which would map them to true.
    if (typeof v === 'number') {
      if (v === 0) return false;
      if (v === 1) return true;
    }
    return v;
  }, z.boolean())
  .optional();

// ─── SAPRead ────────────────────────────────────────────────────────

const SAPREAD_CLAS_INCLUDES = ['main', 'testclasses', 'definitions', 'implementations', 'macros'] as const;
const SAPREAD_DDLS_INCLUDES = ['elements'] as const;

function validateSapReadInput(
  input: { type: string; name?: string; action?: string; include?: string; versionUri?: string; sqlFilter?: string },
  ctx: { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void },
): void {
  if (input.action === 'diff' && !input.name) {
    ctx.addIssue({ code: 'custom', path: ['name'], message: 'SAPRead action="diff" requires a "name".' });
  }

  if (input.include) {
    const include = input.include.toLowerCase();
    if (
      (input.type === 'CLAS' || input.type === 'VERSIONS') &&
      !SAPREAD_CLAS_INCLUDES.includes(include as (typeof SAPREAD_CLAS_INCLUDES)[number])
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['include'],
        message: `Invalid include value "${input.include}" for type ${input.type}. Valid values: ${SAPREAD_CLAS_INCLUDES.join(', ')}`,
      });
    }

    if (input.type === 'DDLS' && !SAPREAD_DDLS_INCLUDES.includes(include as (typeof SAPREAD_DDLS_INCLUDES)[number])) {
      ctx.addIssue({
        code: 'custom',
        path: ['include'],
        message: `Invalid include value "${input.include}" for type DDLS. Valid values: ${SAPREAD_DDLS_INCLUDES.join(', ')}`,
      });
    }
  }

  if (input.type === 'VERSION_SOURCE') {
    const versionUri = String(input.versionUri ?? '');
    if (!versionUri) {
      ctx.addIssue({
        code: 'custom',
        path: ['versionUri'],
        message: 'VERSION_SOURCE requires versionUri.',
      });
      return;
    }
    if (!versionUri.startsWith('/sap/bc/adt/')) {
      ctx.addIssue({
        code: 'custom',
        path: ['versionUri'],
        message: 'VERSION_SOURCE versionUri must start with /sap/bc/adt/.',
      });
    }
  }

  if (input.type === 'TABLE_QUERY') {
    if (!('name' in input) || !input.name) {
      ctx.addIssue({ code: 'custom', path: ['name'], message: 'TABLE_QUERY requires a table or CDS view name.' });
    }
  }

  if (input.type === 'TABLE_CONTENTS' && input.sqlFilter) {
    const sqlFilter = input.sqlFilter.trim();
    if (/^select\b/i.test(sqlFilter)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sqlFilter'],
        message:
          'TABLE_CONTENTS sqlFilter must be a condition expression only (no SELECT statement). Example: "MANDT = \'100\'" or "MATNR LIKE \'Z%\'".',
      });
    }
    if (/^where\b/i.test(sqlFilter)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sqlFilter'],
        message:
          'TABLE_CONTENTS sqlFilter must not start with WHERE. Pass only the condition expression, for example: "MANDT = \'100\'".',
      });
    }
    if (sqlFilter.includes(';')) {
      ctx.addIssue({
        code: 'custom',
        path: ['sqlFilter'],
        message:
          'TABLE_CONTENTS sqlFilter must contain exactly one condition expression (no semicolons or multiple statements).',
      });
    }
  }
}

const TableQueryWhereItemSchema = z.object({
  field: z.string(),
  op: z.string(),
  value: z.string().optional(),
});

export const SAPReadSchema = z
  .object({
    type: z.enum(SAPREAD_TYPES_ONPREM),
    name: z.string().optional(),
    /** Set to "diff" for a unified source diff between two versions (uses from/to). */
    action: z.enum(['diff']).optional(),
    /** For action="diff": OLD side — "active" (default), "inactive", a revision id, or a /sap/bc/adt/ URI. */
    from: z.string().optional(),
    /** For action="diff": NEW side — defaults to "inactive". Same accepted values as from. */
    to: z.string().optional(),
    include: z.string().optional(),
    group: z.string().optional(),
    method: z.string().optional(),
    grep: z.string().max(MAX_GREP_PATTERN_LENGTH).optional(),
    expand_includes: looseOptionalBoolean,
    format: z.enum(['text', 'structured']).optional(),
    version: z.enum(['active', 'inactive', 'auto']).optional().default('active'),
    force_refresh: looseOptionalBoolean,
    maxRows: z.coerce.number().optional(),
    /** For type=DEVC: max number of objects to list. Default 200, clamped to [1, 1000]. */
    maxResults: z.coerce.number().optional(),
    sqlFilter: z.string().optional(),
    objectType: z.string().optional(),
    versionUri: z.string().optional(),
    /** For type=FUNC: when true, response is JSON {source, signature: {importing, exporting, ...}}. */
    includeSignature: looseOptionalBoolean,
    /** For TABLE_QUERY: columns to select (default: all). */
    columns: z.array(z.string()).optional(),
    /** For TABLE_QUERY: structured WHERE conditions ANDed together. */
    where: z.array(TableQueryWhereItemSchema).optional(),
  })
  .superRefine((input, ctx) => validateSapReadInput(input, ctx));

export const SAPReadSchemaBtp = z
  .object({
    type: z.enum(SAPREAD_TYPES_BTP),
    name: z.string().optional(),
    /** Set to "diff" for a unified source diff between two versions (uses from/to). */
    action: z.enum(['diff']).optional(),
    /** For action="diff": OLD side — "active" (default), "inactive", a revision id, or a /sap/bc/adt/ URI. */
    from: z.string().optional(),
    /** For action="diff": NEW side — defaults to "inactive". Same accepted values as from. */
    to: z.string().optional(),
    include: z.string().optional(),
    group: z.string().optional(),
    method: z.string().optional(),
    grep: z.string().max(MAX_GREP_PATTERN_LENGTH).optional(),
    format: z.enum(['text', 'structured']).optional(),
    version: z.enum(['active', 'inactive', 'auto']).optional().default('active'),
    force_refresh: looseOptionalBoolean,
    maxRows: z.coerce.number().optional(),
    /** For type=DEVC: max number of objects to list. Default 200, clamped to [1, 1000]. */
    maxResults: z.coerce.number().optional(),
    sqlFilter: z.string().optional(),
    objectType: z.string().optional(),
    versionUri: z.string().optional(),
    /** For type=FUNC: when true, response is JSON {source, signature: {importing, exporting, ...}}. */
    includeSignature: looseOptionalBoolean,
    /** For TABLE_QUERY: columns to select (default: all). */
    columns: z.array(z.string()).optional(),
    /** For TABLE_QUERY: structured WHERE conditions ANDed together. */
    where: z.array(TableQueryWhereItemSchema).optional(),
  })
  .superRefine((input, ctx) => validateSapReadInput(input, ctx));

// ─── SAPSearch ──────────────────────────────────────────────────────

export const SAPSearchSchema = z
  .object({
    query: z.string().optional(),
    maxResults: z.coerce.number().optional(),
    searchType: z.enum(['object', 'source_code', 'tadir_lookup']).optional(),
    objectType: z.string().optional(),
    objectTypes: z.array(z.string()).optional(),
    packageName: z.string().optional(),
    names: z.array(z.string()).optional(),
    source: z
      .enum(['adt', 'db', 'both'])
      .optional()
      .describe(
        'tadir_lookup data source: "adt" (default) uses the ADT info-system endpoint (workbench-visible only); ' +
          '"db" issues SQL against TADIR (also sees orphan "ghost" rows; requires sql scope and SAP_ALLOW_FREE_SQL=true); ' +
          '"both" runs both and reports divergence via a splitBrain array (requires sql scope).',
      ),
  })
  .superRefine((input, ctx) => {
    const searchType = input.searchType ?? 'object';
    if (searchType === 'tadir_lookup') {
      const hasNames = Array.isArray(input.names) && input.names.some((n) => n.trim());
      const hasQuery = typeof input.query === 'string' && input.query.trim().length > 0;
      if (!hasNames && !hasQuery) {
        ctx.addIssue({
          code: 'custom',
          path: ['names'],
          message: 'tadir_lookup requires either names[] or query.',
        });
      }
      return;
    }
    if (!input.query || input.query.trim().length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['query'],
        message: `${searchType} search requires query.`,
      });
    }
  });

export const SAPSearchSchemaNoSource = z
  .object({
    query: z.string().optional(),
    maxResults: z.coerce.number().optional(),
    searchType: z.enum(['object', 'tadir_lookup']).optional(),
    objectType: z.string().optional(),
    objectTypes: z.array(z.string()).optional(),
    names: z.array(z.string()).optional(),
    source: z
      .enum(['adt', 'db', 'both'])
      .optional()
      .describe(
        'tadir_lookup data source: "adt" (default) uses the ADT info-system endpoint (workbench-visible only); ' +
          '"db" issues SQL against TADIR (also sees orphan "ghost" rows; requires sql scope and SAP_ALLOW_FREE_SQL=true); ' +
          '"both" runs both and reports divergence via a splitBrain array (requires sql scope).',
      ),
  })
  .superRefine((input, ctx) => {
    const searchType = input.searchType ?? 'object';
    if (searchType === 'tadir_lookup') {
      const hasNames = Array.isArray(input.names) && input.names.some((n) => n.trim());
      const hasQuery = typeof input.query === 'string' && input.query.trim().length > 0;
      if (!hasNames && !hasQuery) {
        ctx.addIssue({
          code: 'custom',
          path: ['names'],
          message: 'tadir_lookup requires either names[] or query.',
        });
      }
      return;
    }
    if (!input.query || input.query.trim().length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['query'],
        message: 'object search requires query.',
      });
    }
  });

// ─── SAPQuery ───────────────────────────────────────────────────────

export const SAPQuerySchema = z.object({
  sql: z.string(),
  maxRows: z.coerce.number().optional(),
});

// ─── SAPWrite ───────────────────────────────────────────────────────

// Exported so tests/unit/handlers/schemas.test.ts can derive its read/write
// symmetry guard from a single source of truth (audit Plan B / PR #224).

const ddicFixedValueSchema = z.object({
  low: z.string(),
  high: z.string().optional(),
  description: z.string().optional(),
});

const messageClassMessageSchema = z.object({
  number: z.string(),
  shortText: z.string(),
});

/**
 * Actions that may target a CLAS local include (CCDEF/CCIMP/macros/testclasses).
 *
 * `update` + `edit_method` operate on a single include body/method. `edit_class_definition`
 * accepts include= to whole-replace a local include. The other three class-section
 * surgery actions (`add_method`, `edit_method_signature`, `delete_method`, issue #303)
 * are MAIN-only — they rely on the global-class `/objectstructure` line ranges, which
 * don't apply to a split CCDEF/CCIMP local class — so include= is rejected for them.
 */
const SAPWRITE_INCLUDE_AWARE_ACTIONS = new Set(['update', 'edit_method', 'edit_class_definition']);

function validateSapWriteInput(
  input: { action: string; type?: string; include?: string },
  ctx: { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void },
): void {
  // Treat empty/whitespace include as "not provided" — some MCP clients serialize
  // an omitted optional string as "" and shouldn't trip the include validation.
  if (!input.include || input.include.trim() === '') return;

  if (!SAPWRITE_INCLUDE_AWARE_ACTIONS.has(input.action)) {
    ctx.addIssue({
      code: 'custom',
      path: ['include'],
      message:
        'SAPWrite include is only supported for action in {update, edit_method, edit_class_definition}. add_method/edit_method_signature/delete_method operate on the global class /source/main only.',
    });
  }

  if (input.type !== 'CLAS') {
    ctx.addIssue({
      code: 'custom',
      path: ['include'],
      message: 'SAPWrite include is only supported for type="CLAS".',
    });
  }
}

// FM signature parameter (issue #252). One entry per IMPORTING/EXPORTING/CHANGING/
// TABLES/EXCEPTIONS/RAISING line in the FUNCTION signature region. ARC-1 builds
// the ABAP source from this array; SAP's own signature lives inline in /source/main.
const fmParameterSchema = z.object({
  kind: z.enum(['importing', 'exporting', 'changing', 'tables', 'exceptions', 'raising']),
  name: z.string(),
  /** ABAP type expression. Required for IMPORTING/EXPORTING/CHANGING/TABLES; ignored for EXCEPTIONS/RAISING. */
  type: z.string().optional(),
  /** Emit `VALUE(name)` wrapper. Default false (pass-by-reference). */
  byValue: looseOptionalBoolean,
  /** Raw ABAP literal — IMPORTING/CHANGING only. Emitted verbatim. */
  default: z.string().optional(),
  /** Emit `OPTIONAL` keyword. */
  optional: looseOptionalBoolean,
});

const batchObjectSchemaOnprem = z.object({
  type: z.enum(SAPWRITE_TYPES_ONPREM),
  name: z.string(),
  source: z.string().optional(),
  description: z.string().optional(),
  package: z.string().optional(),
  transport: z.string().optional(),
  dataType: z.string().optional(),
  rowType: z.string().optional(),
  rowTypeKind: z.enum(['builtin', 'structure']).optional(),
  length: z.coerce.number().optional(),
  decimals: z.coerce.number().optional(),
  outputLength: z.coerce.number().optional(),
  conversionExit: z.string().optional(),
  signExists: looseOptionalBoolean,
  lowercase: looseOptionalBoolean,
  fixedValues: z.array(ddicFixedValueSchema).optional(),
  valueTable: z.string().optional(),
  typeKind: z.enum(['domain', 'predefinedAbapType']).optional(),
  typeName: z.string().optional(),
  domainName: z.string().optional(),
  shortLabel: z.string().optional(),
  mediumLabel: z.string().optional(),
  longLabel: z.string().optional(),
  headingLabel: z.string().optional(),
  searchHelp: z.string().optional(),
  searchHelpParameter: z.string().optional(),
  setGetParameter: z.string().optional(),
  defaultComponentName: z.string().optional(),
  changeDocument: looseOptionalBoolean,
  messages: z.array(messageClassMessageSchema).optional(),
  serviceDefinition: z.string().optional(),
  bindingType: z.string().optional(),
  odataVersion: z.enum(['V2', 'V4']).optional(),
  category: z.enum(['0', '1']).optional(),
  version: z.string().optional(),
  /** FUNC structured signature parameters (issue #252). */
  parameters: z.array(fmParameterSchema).optional(),
});

const batchObjectSchemaBtp = z.object({
  type: z.enum(SAPWRITE_TYPES_BTP),
  name: z.string(),
  source: z.string().optional(),
  description: z.string().optional(),
  package: z.string().optional(),
  transport: z.string().optional(),
  dataType: z.string().optional(),
  rowType: z.string().optional(),
  rowTypeKind: z.enum(['builtin', 'structure']).optional(),
  length: z.coerce.number().optional(),
  decimals: z.coerce.number().optional(),
  outputLength: z.coerce.number().optional(),
  conversionExit: z.string().optional(),
  signExists: looseOptionalBoolean,
  lowercase: looseOptionalBoolean,
  fixedValues: z.array(ddicFixedValueSchema).optional(),
  valueTable: z.string().optional(),
  typeKind: z.enum(['domain', 'predefinedAbapType']).optional(),
  typeName: z.string().optional(),
  domainName: z.string().optional(),
  shortLabel: z.string().optional(),
  mediumLabel: z.string().optional(),
  longLabel: z.string().optional(),
  headingLabel: z.string().optional(),
  searchHelp: z.string().optional(),
  searchHelpParameter: z.string().optional(),
  setGetParameter: z.string().optional(),
  defaultComponentName: z.string().optional(),
  changeDocument: looseOptionalBoolean,
  messages: z.array(messageClassMessageSchema).optional(),
  serviceDefinition: z.string().optional(),
  bindingType: z.string().optional(),
  odataVersion: z.enum(['V2', 'V4']).optional(),
  category: z.enum(['0', '1']).optional(),
  version: z.string().optional(),
  /** FUNC structured signature parameters (issue #252). */
  parameters: z.array(fmParameterSchema).optional(),
});

export const SAPWriteSchema = z
  .object({
    action: z.enum([
      'create',
      'update',
      'delete',
      'edit_method',
      'edit_class_definition',
      'add_method',
      'edit_method_signature',
      'delete_method',
      'change_method_visibility',
      'batch_create',
      'scaffold_rap_handlers',
      'generate_behavior_implementation',
    ]),
    type: z.enum(SAPWRITE_TYPES_ONPREM).optional(),
    name: z.string().optional(),
    source: z.string().optional(),
    include: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.enum(CLASS_WRITE_INCLUDES).optional(),
    ),
    method: z.string().optional(),
    /**
     * Visibility section. For action="add_method": the section to insert into (default 'public').
     * For action="change_method_visibility": the TARGET section to move the method to (required).
     * (Issue #303)
     */
    visibility: z.enum(['public', 'protected', 'private']).optional(),
    /** For action="add_method": when true, no METHOD/ENDMETHOD stub is inserted into IMPLEMENTATION. (Issue #303) */
    abstract: looseOptionalBoolean,
    description: z.string().optional(),
    package: z.string().optional(),
    transport: z.string().optional(),
    // Required for FUNC create (the parent function-group name); optional for FUNC
    // update/delete (auto-resolved via search). Ignored for other types.
    group: z.string().optional(),
    dataType: z.string().optional(),
    rowType: z.string().optional(),
    rowTypeKind: z.enum(['builtin', 'structure']).optional(),
    length: z.coerce.number().optional(),
    decimals: z.coerce.number().optional(),
    outputLength: z.coerce.number().optional(),
    conversionExit: z.string().optional(),
    signExists: looseOptionalBoolean,
    lowercase: looseOptionalBoolean,
    fixedValues: z.array(ddicFixedValueSchema).optional(),
    valueTable: z.string().optional(),
    typeKind: z.enum(['domain', 'predefinedAbapType']).optional(),
    typeName: z.string().optional(),
    domainName: z.string().optional(),
    shortLabel: z.string().optional(),
    mediumLabel: z.string().optional(),
    longLabel: z.string().optional(),
    headingLabel: z.string().optional(),
    searchHelp: z.string().optional(),
    searchHelpParameter: z.string().optional(),
    setGetParameter: z.string().optional(),
    defaultComponentName: z.string().optional(),
    changeDocument: looseOptionalBoolean,
    messages: z.array(messageClassMessageSchema).optional(),
    serviceDefinition: z.string().optional(),
    bindingType: z.string().optional(),
    odataVersion: z.enum(['V2', 'V4']).optional(),
    category: z.enum(['0', '1']).optional(),
    version: z.string().optional(),
    lintBeforeWrite: looseOptionalBoolean,
    preflightBeforeWrite: looseOptionalBoolean,
    checkBeforeWrite: looseOptionalBoolean,
    refObjectType: z.string().optional(),
    refObjectName: z.string().optional(),
    refObjectDescription: z.string().optional(),
    bdefName: z.string().optional(),
    autoApply: looseOptionalBoolean,
    targetAlias: z.string().optional(),
    activate: looseOptionalBoolean,
    /** Applies only to action='batch_create'. Default `false` keeps the existing per-object inline
     * activation (each object is created → source written → activated, in sequence). When `true`,
     * ARC-1 writes inactive drafts for every object then issues a single terminal `activateBatch`
     * once the whole batch has been written. Use this for interdependent objects where parent →
     * child cross-references would fail per-object activation (e.g. composition-linked DDLS,
     * RAP behavior stacks where a BDEF references a not-yet-active SRVD). Has no effect on other
     * actions. Partial-failure semantics are unchanged: a write-phase failure still breaks the
     * loop and only the already-written subset is batch-activated. */
    activateAtEnd: looseOptionalBoolean,
    dryRun: looseOptionalBoolean,
    /** FUNC structured signature parameters (issue #252). When provided, ARC-1 builds the
     * IMPORTING/EXPORTING/CHANGING/TABLES/EXCEPTIONS/RAISING clause from the array and
     * splices it into the FM source body. Backward-compatible: when omitted, the existing
     * source-only path runs unchanged. */
    parameters: z.array(fmParameterSchema).optional(),
    objects: z.array(batchObjectSchemaOnprem).optional(),
  })
  .superRefine((input, ctx) => validateSapWriteInput(input, ctx));

export const SAPWriteSchemaBtp = z
  .object({
    action: z.enum([
      'create',
      'update',
      'delete',
      'edit_method',
      'edit_class_definition',
      'add_method',
      'edit_method_signature',
      'delete_method',
      'change_method_visibility',
      'batch_create',
      'scaffold_rap_handlers',
      'generate_behavior_implementation',
    ]),
    type: z.enum(SAPWRITE_TYPES_BTP).optional(),
    name: z.string().optional(),
    source: z.string().optional(),
    include: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.enum(CLASS_WRITE_INCLUDES).optional(),
    ),
    method: z.string().optional(),
    /**
     * Visibility section. For action="add_method": the section to insert into (default 'public').
     * For action="change_method_visibility": the TARGET section to move the method to (required).
     * (Issue #303)
     */
    visibility: z.enum(['public', 'protected', 'private']).optional(),
    /** For action="add_method": when true, no METHOD/ENDMETHOD stub is inserted into IMPLEMENTATION. (Issue #303) */
    abstract: looseOptionalBoolean,
    description: z.string().optional(),
    package: z.string().optional(),
    transport: z.string().optional(),
    // Same as on-prem; FUGR/FUNC write is on-prem-only but harmless to expose here.
    group: z.string().optional(),
    dataType: z.string().optional(),
    rowType: z.string().optional(),
    rowTypeKind: z.enum(['builtin', 'structure']).optional(),
    length: z.coerce.number().optional(),
    decimals: z.coerce.number().optional(),
    outputLength: z.coerce.number().optional(),
    conversionExit: z.string().optional(),
    signExists: looseOptionalBoolean,
    lowercase: looseOptionalBoolean,
    fixedValues: z.array(ddicFixedValueSchema).optional(),
    valueTable: z.string().optional(),
    typeKind: z.enum(['domain', 'predefinedAbapType']).optional(),
    typeName: z.string().optional(),
    domainName: z.string().optional(),
    shortLabel: z.string().optional(),
    mediumLabel: z.string().optional(),
    longLabel: z.string().optional(),
    headingLabel: z.string().optional(),
    searchHelp: z.string().optional(),
    searchHelpParameter: z.string().optional(),
    setGetParameter: z.string().optional(),
    defaultComponentName: z.string().optional(),
    changeDocument: looseOptionalBoolean,
    messages: z.array(messageClassMessageSchema).optional(),
    serviceDefinition: z.string().optional(),
    bindingType: z.string().optional(),
    odataVersion: z.enum(['V2', 'V4']).optional(),
    category: z.enum(['0', '1']).optional(),
    version: z.string().optional(),
    lintBeforeWrite: looseOptionalBoolean,
    preflightBeforeWrite: looseOptionalBoolean,
    checkBeforeWrite: looseOptionalBoolean,
    refObjectType: z.string().optional(),
    refObjectName: z.string().optional(),
    refObjectDescription: z.string().optional(),
    bdefName: z.string().optional(),
    autoApply: looseOptionalBoolean,
    targetAlias: z.string().optional(),
    activate: looseOptionalBoolean,
    /** Applies only to action='batch_create'. Default `false` keeps per-object inline activation;
     * `true` defers to a single terminal `activateBatch` so SAP resolves cross-references in one
     * pass. See SAPWriteSchema (on-prem) for the full contract. */
    activateAtEnd: looseOptionalBoolean,
    dryRun: looseOptionalBoolean,
    /** FUNC structured signature parameters — same shape as on-prem. Harmless on BTP since FUNC write
     * is on-prem-only. */
    parameters: z.array(fmParameterSchema).optional(),
    objects: z.array(batchObjectSchemaBtp).optional(),
  })
  .superRefine((input, ctx) => validateSapWriteInput(input, ctx));

// ─── SAPActivate ────────────────────────────────────────────────────

export const SAPActivateSchema = z.object({
  action: z.enum(['activate', 'publish_srvb', 'unpublish_srvb']).optional(),
  name: z.string().optional(),
  type: z.string().optional(),
  version: z.string().optional(),
  service_type: z.enum(['odatav2', 'odatav4']).optional(),
  preaudit: looseOptionalBoolean,
  objects: z
    .array(
      z.object({
        type: z.string(),
        name: z.string(),
      }),
    )
    .optional(),
});

// ─── SAPNavigate ────────────────────────────────────────────────────

export const SAPNavigateSchema = z.object({
  action: z.enum(['definition', 'references', 'completion', 'hierarchy']),
  uri: z.string().optional(),
  type: z.string().optional(),
  name: z.string().optional(),
  objectType: z.string().optional(),
  line: z.coerce.number().optional(),
  column: z.coerce.number().optional(),
  source: z.string().optional(),
});

// ─── SAPLint ────────────────────────────────────────────────────────

export const SAPLintSchema = z.object({
  action: z.enum(['lint', 'lint_and_fix', 'list_rules', 'format', 'get_formatter_settings', 'set_formatter_settings']),
  source: z.string().optional(),
  name: z.string().optional(),
  indentation: looseOptionalBoolean,
  style: z.enum(['keywordUpper', 'keywordLower', 'keywordAuto', 'none']).optional(),
  rules: z.record(z.string(), z.any()).optional(),
});

// ─── SAPDiagnose ────────────────────────────────────────────────────

const QuickfixAffectedObjectSchema = z.object({
  uri: z.string(),
  type: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  content: z.string().optional(),
});

export const SAPDiagnoseSchema = z.object({
  action: z.enum([
    'syntax',
    'unittest',
    'atc',
    'cds_testcases',
    'dumps',
    'traces',
    'trace_start',
    'trace_requests',
    'trace_cancel',
    'system_messages',
    'gateway_errors',
    'object_state',
    'quickfix',
    'apply_quickfix',
    'odata_perf',
    'cds_sql',
  ]),
  name: z.string().optional(),
  url: z.string().optional(),
  type: z.string().optional(),
  source: z.string().optional(),
  sourceUri: z.string().optional(),
  line: z.coerce.number().optional(),
  column: z.coerce.number().optional(),
  version: z.enum(['active', 'inactive']).optional(),
  proposalUri: z.string().optional(),
  proposalUserContent: z.string().optional(),
  proposalAffectedObjects: z.array(QuickfixAffectedObjectSchema).optional(),
  variant: z.string().optional(),
  id: z.string().optional(),
  detailUrl: z.string().optional(),
  errorType: z.string().optional(),
  user: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  maxResults: z.coerce.number().optional(),
  sections: z.array(z.string()).optional(),
  includeFullText: looseOptionalBoolean,
  coverage: looseOptionalBoolean,
  analysis: z.enum(['hitlist', 'statements', 'dbAccesses']).optional(),
  // trace_start / trace_requests (arm a profiler trace, then read it back via action="traces")
  traceUser: z.string().optional(),
  processType: z.enum(['any', 'http', 'dialog', 'batch', 'rfc']).optional(),
  objectType: z.enum(['any', 'url', 'transaction', 'report', 'functionModule']).optional(),
  maxExecutions: z.coerce.number().optional(),
  expiresHours: z.coerce.number().optional(),
  sqlTrace: looseOptionalBoolean,
  aggregate: looseOptionalBoolean,
  description: z.string().optional(),
});

// ─── SAPTransport ───────────────────────────────────────────────────

export const SAPTransportSchema = z.object({
  action: z.enum([
    'list',
    'get',
    'create',
    'release',
    'delete',
    'remove_object',
    'reassign',
    'release_recursive',
    'check',
    'history',
    'layers',
    'targets',
  ]),
  id: z.string().optional(),
  description: z.string().optional(),
  name: z.string().optional(),
  pgmid: z.string().optional(),
  package: z.string().optional(),
  target: z.string().optional(),
  transportLayer: z.string().optional(),
  user: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  owner: z.string().optional(),
  // looseOptionalBoolean (not z.boolean()) so GPT/OpenAI clients sending stringified
  // "true"/"false" coerce instead of erroring at validation (CLAUDE.md boolean guidance).
  recursive: looseOptionalBoolean,
  removeLockedObjects: looseOptionalBoolean,
  // For list: headers-only view — omit each transport's object lists (keep an objectCount).
  summary: looseOptionalBoolean,
});

// ─── SAPGit ─────────────────────────────────────────────────────────

export const SAPGitSchema = z.object({
  action: z.enum([
    'list_repos',
    'whoami',
    'config',
    'branches',
    'external_info',
    'history',
    'objects',
    'check',
    'stage',
    'clone',
    'pull',
    'push',
    'commit',
    'switch_branch',
    'create_branch',
    'unlink',
  ]),
  repoId: z.string().optional(),
  url: z.string().optional(),
  branch: z.string().optional(),
  package: z.string().optional(),
  transport: z.string().optional(),
  commit: z.string().optional(),
  message: z.string().optional(),
  description: z.string().optional(),
  objects: z
    .array(
      z.object({
        type: z.string(),
        name: z.string(),
        package: z.string().optional(),
        path: z.string().optional(),
        state: z.string().optional(),
        operation: z.string().optional(),
      }),
    )
    .optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  token: z.string().optional(),
  backend: z.enum(['gcts', 'abapgit']).optional(),
  limit: z.coerce.number().optional(),
});

// ─── SAPContext ─────────────────────────────────────────────────────

const SAPCONTEXT_SIBLING_MAX_CANDIDATES_CAP = 10;
const siblingMaxCandidatesSchema = z.coerce
  .number()
  .int()
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    return Math.min(Math.max(value, 1), SAPCONTEXT_SIBLING_MAX_CANDIDATES_CAP);
  });

export const SAPContextSchema = z.object({
  action: z.enum(['deps', 'usages', 'impact']).optional(),
  type: z.enum(SAPCONTEXT_TYPES_ONPREM).optional(),
  name: z.string(),
  source: z.string().optional(),
  group: z.string().optional(),
  maxDeps: z.coerce.number().optional(),
  depth: z.coerce.number().min(1).max(3).optional(),
  includeIndirect: z.boolean().optional(),
  siblingCheck: z.boolean().optional(),
  siblingMaxCandidates: siblingMaxCandidatesSchema,
  includeKtd: looseOptionalBoolean,
});

export const SAPContextSchemaBtp = z.object({
  action: z.enum(['deps', 'usages', 'impact']).optional(),
  type: z.enum(SAPCONTEXT_TYPES_BTP).optional(),
  name: z.string(),
  source: z.string().optional(),
  maxDeps: z.coerce.number().optional(),
  depth: z.coerce.number().min(1).max(3).optional(),
  includeIndirect: z.boolean().optional(),
  siblingCheck: z.boolean().optional(),
  siblingMaxCandidates: siblingMaxCandidatesSchema,
  includeKtd: looseOptionalBoolean,
});

// ─── SAPManage ──────────────────────────────────────────────────────

const flpTileSchema = z.object({
  id: z.string(),
  title: z.string(),
  icon: z.string().optional(),
  semanticObject: z.string(),
  semanticAction: z.string(),
  url: z.string().optional(),
  subtitle: z.string().optional(),
  info: z.string().optional(),
});

export const SAPManageSchema = z.object({
  action: z.enum([
    'features',
    'probe',
    'cache_stats',
    'create_package',
    'delete_package',
    'change_package',
    'flp_list_catalogs',
    'flp_list_groups',
    'flp_list_tiles',
    'flp_create_catalog',
    'flp_create_group',
    'flp_create_tile',
    'flp_add_tile_to_group',
    'flp_delete_catalog',
    'set_api_state',
  ]),
  apiState: z.enum(['RELEASED', 'NOT_RELEASED']).optional(),
  contract: z.enum(['C0', 'C1', 'C2', 'C3', 'C4']).optional(),
  catalogId: z.string().optional(),
  groupId: z.string().optional(),
  title: z.string().optional(),
  domainId: z.string().optional(),
  tileInstanceId: z.string().optional(),
  tile: flpTileSchema.optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  superPackage: z.string().optional(),
  softwareComponent: z.string().optional(),
  transportLayer: z.string().optional(),
  recordChanges: z.boolean().optional(),
  packageType: z.enum(['development', 'structure', 'main']).optional(),
  transport: z.string().optional(),
  objectUri: z.string().optional(),
  objectType: z.string().optional(),
  objectName: z.string().optional(),
  oldPackage: z.string().optional(),
  newPackage: z.string().optional(),
});

// ─── Hyperfocused SAP ───────────────────────────────────────────────

export const SAPHyperfocusedSchema = z.object({
  action: z.string(),
  type: z.string().optional(),
  name: z.string().optional(),
  params: z.record(z.string(), z.any()).optional(),
});

// ─── Schema Lookup ──────────────────────────────────────────────────

/**
 * Get the Zod schema for a given tool name.
 * Returns BTP or on-prem variant based on isBtp flag.
 * When textSearchAvailable is false, returns a restricted SAPSearch schema.
 */
export function getToolSchema(toolName: string, isBtp: boolean, textSearchAvailable?: boolean): z.ZodType | undefined {
  switch (toolName) {
    case 'SAPRead':
      return isBtp ? SAPReadSchemaBtp : SAPReadSchema;
    case 'SAPSearch':
      return textSearchAvailable === false ? SAPSearchSchemaNoSource : SAPSearchSchema;
    case 'SAPQuery':
      return SAPQuerySchema;
    case 'SAPWrite':
      return isBtp ? SAPWriteSchemaBtp : SAPWriteSchema;
    case 'SAPActivate':
      return SAPActivateSchema;
    case 'SAPNavigate':
      return SAPNavigateSchema;
    case 'SAPLint':
      return SAPLintSchema;
    case 'SAPDiagnose':
      return SAPDiagnoseSchema;
    case 'SAPTransport':
      return SAPTransportSchema;
    case 'SAPGit':
      return SAPGitSchema;
    case 'SAPContext':
      return isBtp ? SAPContextSchemaBtp : SAPContextSchema;
    case 'SAPManage':
      return SAPManageSchema;
    case 'SAP':
      return SAPHyperfocusedSchema;
    default:
      return undefined;
  }
}
