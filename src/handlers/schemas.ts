/**
 * Zod v4 input schemas for all 12 MCP tools.
 *
 * These schemas provide runtime validation via safeParse() in handleToolCall().
 * JSON Schema generation via z.toJSONSchema() is planned for a future PR
 * (currently, JSON Schema is still hand-written in tools.ts).
 *
 * BTP variants exclude types not available on BTP ABAP Environment.
 * Numeric fields use z.coerce.number() for MCP client compatibility
 * (clients may send "100" as a string).
 */

import { z } from 'zod';

// ─── SAPRead ────────────────────────────────────────────────────────

const SAPREAD_TYPES_ONPREM = [
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
] as const;

const SAPREAD_TYPES_BTP = [
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
] as const;

const SAPREAD_CLAS_INCLUDES = ['main', 'testclasses', 'definitions', 'implementations', 'macros'] as const;
const SAPREAD_DDLS_INCLUDES = ['elements'] as const;
export const SAPWRITE_CLAS_INCLUDES = ['definitions', 'implementations', 'macros', 'testclasses'] as const;

function validateSapReadInput(
  input: { type: string; include?: string; versionUri?: string; sqlFilter?: string },
  ctx: { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void },
): void {
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

export const SAPReadSchema = z
  .object({
    type: z.enum(SAPREAD_TYPES_ONPREM),
    name: z.string().optional(),
    include: z.string().optional(),
    group: z.string().optional(),
    method: z.string().optional(),
    expand_includes: z.coerce.boolean().optional(),
    format: z.enum(['text', 'structured']).optional(),
    version: z.enum(['active', 'inactive', 'auto']).optional().default('active'),
    force_refresh: z.coerce.boolean().optional(),
    maxRows: z.coerce.number().optional(),
    /** For type=DEVC: max number of objects to list. Default 200, clamped to [1, 1000]. */
    maxResults: z.coerce.number().int().min(1).max(1000).optional(),
    sqlFilter: z.string().optional(),
    objectType: z.string().optional(),
    versionUri: z.string().optional(),
  })
  .superRefine((input, ctx) => validateSapReadInput(input, ctx));

export const SAPReadSchemaBtp = z
  .object({
    type: z.enum(SAPREAD_TYPES_BTP),
    name: z.string().optional(),
    include: z.string().optional(),
    group: z.string().optional(),
    method: z.string().optional(),
    format: z.enum(['text', 'structured']).optional(),
    version: z.enum(['active', 'inactive', 'auto']).optional().default('active'),
    force_refresh: z.coerce.boolean().optional(),
    maxRows: z.coerce.number().optional(),
    /** For type=DEVC: max number of objects to list. Default 200, clamped to [1, 1000]. */
    maxResults: z.coerce.number().int().min(1).max(1000).optional(),
    sqlFilter: z.string().optional(),
    objectType: z.string().optional(),
    versionUri: z.string().optional(),
  })
  .superRefine((input, ctx) => validateSapReadInput(input, ctx));

// ─── SAPSearch ──────────────────────────────────────────────────────

export const SAPSearchSchema = z.object({
  query: z.string(),
  maxResults: z.coerce.number().optional(),
  searchType: z.enum(['object', 'source_code']).optional(),
  objectType: z.string().optional(),
  packageName: z.string().optional(),
});

export const SAPSearchSchemaNoSource = z.object({
  query: z.string(),
  maxResults: z.coerce.number().optional(),
});

// ─── SAPQuery ───────────────────────────────────────────────────────

export const SAPQuerySchema = z.object({
  sql: z.string(),
  maxRows: z.coerce.number().optional(),
});

// ─── SAPWrite ───────────────────────────────────────────────────────

// Exported so tests/unit/handlers/schemas.test.ts can derive its read/write
// symmetry guard from a single source of truth (audit Plan B / PR #224).
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
  'DOMA',
  'DTEL',
  'MSAG',
] as const;
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
  'DOMA',
  'DTEL',
  'MSAG',
] as const;

const ddicFixedValueSchema = z.object({
  low: z.string(),
  high: z.string().optional(),
  description: z.string().optional(),
});

const messageClassMessageSchema = z.object({
  number: z.string(),
  shortText: z.string(),
});

function validateSapWriteInput(
  input: { action: string; type?: string; include?: string },
  ctx: { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void },
): void {
  if (!input.include) return;

  if (input.action !== 'update') {
    ctx.addIssue({
      code: 'custom',
      path: ['include'],
      message: 'SAPWrite include is only supported for action="update".',
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

const batchObjectSchemaOnprem = z.object({
  type: z.enum(SAPWRITE_TYPES_ONPREM),
  name: z.string(),
  source: z.string().optional(),
  description: z.string().optional(),
  dataType: z.string().optional(),
  length: z.coerce.number().optional(),
  decimals: z.coerce.number().optional(),
  outputLength: z.coerce.number().optional(),
  conversionExit: z.string().optional(),
  signExists: z.coerce.boolean().optional(),
  lowercase: z.coerce.boolean().optional(),
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
  changeDocument: z.coerce.boolean().optional(),
  messages: z.array(messageClassMessageSchema).optional(),
  serviceDefinition: z.string().optional(),
  bindingType: z.string().optional(),
  odataVersion: z.enum(['V2', 'V4']).optional(),
  category: z.enum(['0', '1']).optional(),
  version: z.string().optional(),
});

const batchObjectSchemaBtp = z.object({
  type: z.enum(SAPWRITE_TYPES_BTP),
  name: z.string(),
  source: z.string().optional(),
  description: z.string().optional(),
  dataType: z.string().optional(),
  length: z.coerce.number().optional(),
  decimals: z.coerce.number().optional(),
  outputLength: z.coerce.number().optional(),
  conversionExit: z.string().optional(),
  signExists: z.coerce.boolean().optional(),
  lowercase: z.coerce.boolean().optional(),
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
  changeDocument: z.coerce.boolean().optional(),
  messages: z.array(messageClassMessageSchema).optional(),
  serviceDefinition: z.string().optional(),
  bindingType: z.string().optional(),
  odataVersion: z.enum(['V2', 'V4']).optional(),
  category: z.enum(['0', '1']).optional(),
  version: z.string().optional(),
});

export const SAPWriteSchema = z
  .object({
    action: z.enum(['create', 'update', 'delete', 'edit_method', 'batch_create', 'scaffold_rap_handlers']),
    type: z.enum(SAPWRITE_TYPES_ONPREM).optional(),
    name: z.string().optional(),
    source: z.string().optional(),
    include: z.enum(SAPWRITE_CLAS_INCLUDES).optional(),
    method: z.string().optional(),
    description: z.string().optional(),
    package: z.string().optional(),
    transport: z.string().optional(),
    // Required for FUNC create (the parent function-group name); optional for FUNC
    // update/delete (auto-resolved via search). Ignored for other types.
    group: z.string().optional(),
    dataType: z.string().optional(),
    length: z.coerce.number().optional(),
    decimals: z.coerce.number().optional(),
    outputLength: z.coerce.number().optional(),
    conversionExit: z.string().optional(),
    signExists: z.coerce.boolean().optional(),
    lowercase: z.coerce.boolean().optional(),
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
    changeDocument: z.coerce.boolean().optional(),
    messages: z.array(messageClassMessageSchema).optional(),
    serviceDefinition: z.string().optional(),
    bindingType: z.string().optional(),
    odataVersion: z.enum(['V2', 'V4']).optional(),
    category: z.enum(['0', '1']).optional(),
    version: z.string().optional(),
    lintBeforeWrite: z.coerce.boolean().optional(),
    preflightBeforeWrite: z.coerce.boolean().optional(),
    checkBeforeWrite: z.coerce.boolean().optional(),
    refObjectType: z.string().optional(),
    refObjectName: z.string().optional(),
    refObjectDescription: z.string().optional(),
    bdefName: z.string().optional(),
    autoApply: z.coerce.boolean().optional(),
    targetAlias: z.string().optional(),
    objects: z.array(batchObjectSchemaOnprem).optional(),
  })
  .superRefine((input, ctx) => validateSapWriteInput(input, ctx));

export const SAPWriteSchemaBtp = z
  .object({
    action: z.enum(['create', 'update', 'delete', 'edit_method', 'batch_create', 'scaffold_rap_handlers']),
    type: z.enum(SAPWRITE_TYPES_BTP).optional(),
    name: z.string().optional(),
    source: z.string().optional(),
    include: z.enum(SAPWRITE_CLAS_INCLUDES).optional(),
    method: z.string().optional(),
    description: z.string().optional(),
    package: z.string().optional(),
    transport: z.string().optional(),
    // Same as on-prem; FUGR/FUNC write is on-prem-only but harmless to expose here.
    group: z.string().optional(),
    dataType: z.string().optional(),
    length: z.coerce.number().optional(),
    decimals: z.coerce.number().optional(),
    outputLength: z.coerce.number().optional(),
    conversionExit: z.string().optional(),
    signExists: z.coerce.boolean().optional(),
    lowercase: z.coerce.boolean().optional(),
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
    changeDocument: z.coerce.boolean().optional(),
    messages: z.array(messageClassMessageSchema).optional(),
    serviceDefinition: z.string().optional(),
    bindingType: z.string().optional(),
    odataVersion: z.enum(['V2', 'V4']).optional(),
    category: z.enum(['0', '1']).optional(),
    version: z.string().optional(),
    lintBeforeWrite: z.coerce.boolean().optional(),
    preflightBeforeWrite: z.coerce.boolean().optional(),
    checkBeforeWrite: z.coerce.boolean().optional(),
    refObjectType: z.string().optional(),
    refObjectName: z.string().optional(),
    refObjectDescription: z.string().optional(),
    bdefName: z.string().optional(),
    autoApply: z.coerce.boolean().optional(),
    targetAlias: z.string().optional(),
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
  preaudit: z.coerce.boolean().optional(),
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
  indentation: z.coerce.boolean().optional(),
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
    'dumps',
    'traces',
    'system_messages',
    'gateway_errors',
    'quickfix',
    'apply_quickfix',
  ]),
  name: z.string().optional(),
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
  includeFullText: z.coerce.boolean().optional(),
  analysis: z.enum(['hitlist', 'statements', 'dbAccesses']).optional(),
});

// ─── SAPTransport ───────────────────────────────────────────────────

export const SAPTransportSchema = z.object({
  action: z.enum(['list', 'get', 'create', 'release', 'delete', 'reassign', 'release_recursive', 'check', 'history']),
  id: z.string().optional(),
  description: z.string().optional(),
  name: z.string().optional(),
  package: z.string().optional(),
  user: z.string().optional(),
  status: z.string().optional(),
  type: z.string().optional(),
  owner: z.string().optional(),
  recursive: z.boolean().optional(),
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

const SAPCONTEXT_TYPES_ONPREM = ['CLAS', 'INTF', 'PROG', 'FUNC', 'DDLS'] as const;
const SAPCONTEXT_TYPES_BTP = ['CLAS', 'INTF', 'DDLS'] as const;
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
  ]),
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
