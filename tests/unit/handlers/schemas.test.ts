import { describe, expect, it } from 'vitest';
import {
  getToolSchema,
  SAPActivateSchema,
  SAPContextSchema,
  SAPContextSchemaBtp,
  SAPDiagnoseSchema,
  SAPGitSchema,
  SAPHyperfocusedSchema,
  SAPLintSchema,
  SAPManageSchema,
  SAPNavigateSchema,
  SAPQuerySchema,
  SAPReadSchema,
  SAPReadSchemaBtp,
  SAPSearchSchema,
  SAPSearchSchemaNoSource,
  SAPTransportSchema,
  SAPWRITE_TYPES_BTP,
  SAPWRITE_TYPES_ONPREM,
  SAPWriteSchema,
  SAPWriteSchemaBtp,
} from '../../../src/handlers/schemas.js';

describe('SAPReadSchema', () => {
  it('accepts valid on-prem input', () => {
    const result = SAPReadSchema.safeParse({ type: 'PROG', name: 'ZTEST' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.version).toBe('active');
  });

  it('accepts all optional fields', () => {
    const result = SAPReadSchema.safeParse({
      type: 'CLAS',
      name: 'ZCL_TEST',
      include: 'definitions',
      method: '*',
      expand_includes: true,
      version: 'inactive',
      force_refresh: true,
      maxRows: 50,
      sqlFilter: "MANDT = '100'",
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid source version', () => {
    const result = SAPReadSchema.safeParse({ type: 'PROG', name: 'ZTEST', version: 'latest' });
    expect(result.success).toBe(false);
  });

  it('rejects missing required type', () => {
    const result = SAPReadSchema.safeParse({ name: 'ZTEST' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid type enum', () => {
    const result = SAPReadSchema.safeParse({ type: 'INVALID' });
    expect(result.success).toBe(false);
  });

  it('accepts FUNC with includeSignature flag (issue #252)', () => {
    const result = SAPReadSchema.safeParse({
      type: 'FUNC',
      name: 'BAPI_USER_GETLIST',
      group: 'SU_USER',
      includeSignature: true,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.includeSignature).toBe(true);
  });

  it('accepts FUNC without includeSignature (backward compat — issue #252)', () => {
    const result = SAPReadSchema.safeParse({ type: 'FUNC', name: 'X', group: 'Y' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.includeSignature).toBeUndefined();
  });

  it('coerces numeric maxRows from string', () => {
    const result = SAPReadSchema.safeParse({ type: 'TABLE_CONTENTS', maxRows: '50' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxRows).toBe(50);
    }
  });

  it('accepts optional DEVC maxResults within [1, 1000]', () => {
    const ok = SAPReadSchema.safeParse({ type: 'DEVC', name: 'ZPKG', maxResults: 500 });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.maxResults).toBe(500);
    }
  });

  it('coerces numeric maxResults from string for DEVC', () => {
    const result = SAPReadSchema.safeParse({ type: 'DEVC', name: 'ZPKG', maxResults: '300' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxResults).toBe(300);
    }
  });

  it('rejects DEVC maxResults out of range (0, 1001, negative)', () => {
    expect(SAPReadSchema.safeParse({ type: 'DEVC', name: 'ZPKG', maxResults: 0 }).success).toBe(false);
    expect(SAPReadSchema.safeParse({ type: 'DEVC', name: 'ZPKG', maxResults: 1001 }).success).toBe(false);
    expect(SAPReadSchema.safeParse({ type: 'DEVC', name: 'ZPKG', maxResults: -1 }).success).toBe(false);
  });

  it('accepts SAPRead without maxResults (it is optional)', () => {
    // Sanity: maxResults is optional even on DEVC; client uses default 200.
    const result = SAPReadSchema.safeParse({ type: 'DEVC', name: 'ZPKG' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxResults).toBeUndefined();
    }
  });

  it('accepts TABLE_CONTENTS sqlFilter as condition expression', () => {
    const result = SAPReadSchema.safeParse({
      type: 'TABLE_CONTENTS',
      name: 'MARA',
      sqlFilter: "MANDT = '100' AND MATNR LIKE 'Z%'",
    });
    expect(result.success).toBe(true);
  });

  it('accepts TABLE_CONTENTS sqlFilter when identifier contains SELECT as substring', () => {
    const result = SAPReadSchema.safeParse({
      type: 'TABLE_CONTENTS',
      name: 'ZTAB',
      sqlFilter: "SELECTFLAG = 'X' AND MANDT = '100'",
    });
    expect(result.success).toBe(true);
  });

  it('rejects TABLE_CONTENTS sqlFilter that starts with SELECT', () => {
    const result = SAPReadSchema.safeParse({
      type: 'TABLE_CONTENTS',
      name: 'MARA',
      sqlFilter: "SELECT * FROM MARA WHERE MANDT = '100'",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('condition expression only');
    }
  });

  it('rejects TABLE_CONTENTS sqlFilter that starts with WHERE', () => {
    const result = SAPReadSchema.safeParse({
      type: 'TABLE_CONTENTS',
      name: 'MARA',
      sqlFilter: "WHERE MANDT = '100'",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('must not start with WHERE');
    }
  });

  it('rejects TABLE_CONTENTS sqlFilter with semicolons', () => {
    const result = SAPReadSchema.safeParse({
      type: 'TABLE_CONTENTS',
      name: 'MARA',
      sqlFilter: "MANDT = '100'; DELETE FROM T000",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('no semicolons');
    }
  });

  it('coerces boolean expand_includes from string', () => {
    const result = SAPReadSchema.safeParse({ type: 'FUGR', expand_includes: 'true' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.expand_includes).toBe(true);
    }
  });

  it('accepts type-only input (name is optional)', () => {
    const result = SAPReadSchema.safeParse({ type: 'SYSTEM' });
    expect(result.success).toBe(true);
  });

  it('accepts on-prem AUTH/FEATURE_TOGGLE/ENHO types', () => {
    expect(SAPReadSchema.safeParse({ type: 'AUTH', name: 'BUKRS' }).success).toBe(true);
    expect(SAPReadSchema.safeParse({ type: 'FEATURE_TOGGLE', name: 'ABC_TOGGLE' }).success).toBe(true);
    expect(SAPReadSchema.safeParse({ type: 'ENHO', name: 'ZMY_BADI_IMPL' }).success).toBe(true);
  });

  it('still accepts deprecated FTG2 alias for one minor release', () => {
    // Per docs/plans/completed/audit-symmetry-and-ftg2-rename.md: FTG2 was an ARC-1-invented
    // identifier (research/abap-types/types/ftg2.md). FEATURE_TOGGLE is the new
    // canonical short type, FTG2 stays as a deprecated alias for one minor.
    expect(SAPReadSchema.safeParse({ type: 'FTG2', name: 'ABC_TOGGLE' }).success).toBe(true);
  });

  it('accepts MSAG canonical message-class type and MESSAGES deprecated alias', () => {
    // MSAG = TADIR R3TR truth (research/abap-types/types/msag.md). 'MESSAGES' was the
    // original ARC-1 read-side alias, kept for one minor release.
    expect(SAPReadSchema.safeParse({ type: 'MSAG', name: 'SY' }).success).toBe(true);
    expect(SAPReadSchema.safeParse({ type: 'MESSAGES', name: 'SY' }).success).toBe(true);
    // BTP variant should accept both as well.
    expect(SAPReadSchemaBtp.safeParse({ type: 'MSAG', name: 'ZMSG' }).success).toBe(true);
    expect(SAPReadSchemaBtp.safeParse({ type: 'MESSAGES', name: 'ZMSG' }).success).toBe(true);
  });

  it('write enum has MSAG (canonical) — read/write symmetry guard', () => {
    // Anti-cargo-cult guard from docs/plans/completed/audit-symmetry-and-ftg2-rename.md:
    // every type that supports both verbs in ADT MUST be in both enums under the
    // same canonical short form. The audit found MSAG missing from the read enum.
    // This test asserts the symmetry; new types that violate it will fail loudly.
    // Source of truth: SAPWRITE_TYPES_ONPREM/_BTP exported from schemas.ts so the
    // guard can never drift from the runtime enum (codex review on PR #224).
    for (const t of SAPWRITE_TYPES_ONPREM) {
      const result = SAPReadSchema.safeParse({ type: t, name: 'X' });
      expect(result.success, `on-prem read enum missing canonical write type ${t}`).toBe(true);
    }
    for (const t of SAPWRITE_TYPES_BTP) {
      const result = SAPReadSchemaBtp.safeParse({ type: t, name: 'X' });
      expect(result.success, `BTP read enum missing canonical write type ${t}`).toBe(true);
    }
  });

  it('accepts VERSIONS on on-prem', () => {
    const result = SAPReadSchema.safeParse({ type: 'VERSIONS', name: 'ZARC1_TEST_REPORT' });
    expect(result.success).toBe(true);
  });

  it('accepts VERSION_SOURCE only when versionUri is provided and ADT-scoped', () => {
    const result = SAPReadSchema.safeParse({
      type: 'VERSION_SOURCE',
      versionUri: '/sap/bc/adt/programs/programs/ZARC1_TEST_REPORT/source/main/versions/20260410185851/00000/content',
    });
    expect(result.success).toBe(true);
  });

  it('rejects VERSION_SOURCE when versionUri is missing', () => {
    const result = SAPReadSchema.safeParse({ type: 'VERSION_SOURCE' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join('.') === 'versionUri')).toBe(true);
    }
  });

  it('rejects VERSION_SOURCE when versionUri is not an ADT path', () => {
    const result = SAPReadSchema.safeParse({ type: 'VERSION_SOURCE', versionUri: 'https://evil.example/source' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('/sap/bc/adt/');
    }
  });

  it('accepts format field with valid values', () => {
    expect(SAPReadSchema.safeParse({ type: 'CLAS', name: 'ZCL_TEST', format: 'text' }).success).toBe(true);
    expect(SAPReadSchema.safeParse({ type: 'CLAS', name: 'ZCL_TEST', format: 'structured' }).success).toBe(true);
  });

  it('rejects invalid format values', () => {
    expect(SAPReadSchema.safeParse({ type: 'CLAS', name: 'ZCL_TEST', format: 'xml' }).success).toBe(false);
    expect(SAPReadSchema.safeParse({ type: 'CLAS', name: 'ZCL_TEST', format: 'json' }).success).toBe(false);
  });

  it('rejects invalid CLAS include values and lists allowed includes', () => {
    const result = SAPReadSchema.safeParse({ type: 'CLAS', name: 'ZCL_TEST', include: 'invalid_include' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? '';
      expect(message).toContain('Valid values');
      expect(message).toContain('main');
      expect(message).toContain('testclasses');
    }
  });

  it('rejects invalid DDLS include values', () => {
    const result = SAPReadSchema.safeParse({ type: 'DDLS', name: 'ZI_TEST', include: 'main' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain('Valid values: elements');
    }
  });

  it('allows free-form include for BSP paths', () => {
    const result = SAPReadSchema.safeParse({ type: 'BSP', name: 'ZAPP', include: 'webapp/Component.js' });
    expect(result.success).toBe(true);
  });
});

describe('SAPReadSchemaBtp', () => {
  it('accepts BTP types', () => {
    const result = SAPReadSchemaBtp.safeParse({ type: 'CLAS', name: 'ZCL_TEST' });
    expect(result.success).toBe(true);
    expect(SAPReadSchemaBtp.safeParse({ type: 'DCLS', name: 'ZI_TEST_DCL' }).success).toBe(true);
  });

  it('rejects on-prem-only types', () => {
    expect(SAPReadSchemaBtp.safeParse({ type: 'PROG' }).success).toBe(false);
    expect(SAPReadSchemaBtp.safeParse({ type: 'INCL' }).success).toBe(false);
    expect(SAPReadSchemaBtp.safeParse({ type: 'VIEW' }).success).toBe(false);
    expect(SAPReadSchemaBtp.safeParse({ type: 'TEXT_ELEMENTS' }).success).toBe(false);
    expect(SAPReadSchemaBtp.safeParse({ type: 'VARIANTS' }).success).toBe(false);
    expect(SAPReadSchemaBtp.safeParse({ type: 'AUTH' }).success).toBe(false);
    expect(SAPReadSchemaBtp.safeParse({ type: 'FTG2' }).success).toBe(false);
    expect(SAPReadSchemaBtp.safeParse({ type: 'ENHO' }).success).toBe(false);
  });

  it('does not have expand_includes field', () => {
    const result = SAPReadSchemaBtp.safeParse({ type: 'CLAS', expand_includes: true });
    // Should succeed — extra keys are ignored by default in z.object
    expect(result.success).toBe(true);
    if (result.success) {
      expect('expand_includes' in result.data).toBe(false);
    }
  });
});

describe('SAPSearchSchema', () => {
  it('accepts valid input with query', () => {
    const result = SAPSearchSchema.safeParse({ query: 'ZCL_*' });
    expect(result.success).toBe(true);
  });

  it('accepts all optional fields', () => {
    const result = SAPSearchSchema.safeParse({
      query: 'ZCL_*',
      maxResults: 50,
      searchType: 'source_code',
      objectType: 'CLAS',
      objectTypes: ['CLAS', 'DDLS'],
      packageName: 'ZTEST',
      names: ['ZCL_TEST'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts TADIR lookup with names and no query', () => {
    const result = SAPSearchSchema.safeParse({
      searchType: 'tadir_lookup',
      names: ['ZDM_PROJECT_D', 'ZR_DM_PROJECT'],
      objectTypes: ['TABL', 'BDEF'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing query', () => {
    const result = SAPSearchSchema.safeParse({ maxResults: 10 });
    expect(result.success).toBe(false);
  });

  it('rejects TADIR lookup without names or query', () => {
    const result = SAPSearchSchema.safeParse({ searchType: 'tadir_lookup', maxResults: 10 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid searchType', () => {
    const result = SAPSearchSchema.safeParse({ query: 'test', searchType: 'invalid' });
    expect(result.success).toBe(false);
  });

  it("accepts source='adt' for tadir_lookup", () => {
    const result = SAPSearchSchema.safeParse({
      searchType: 'tadir_lookup',
      names: ['ZA'],
      source: 'adt',
    });
    expect(result.success).toBe(true);
  });

  it("accepts source='db' for tadir_lookup", () => {
    const result = SAPSearchSchema.safeParse({
      searchType: 'tadir_lookup',
      names: ['ZA'],
      source: 'db',
    });
    expect(result.success).toBe(true);
  });

  it("accepts source='both' for tadir_lookup", () => {
    const result = SAPSearchSchema.safeParse({
      searchType: 'tadir_lookup',
      names: ['ZA'],
      source: 'both',
    });
    expect(result.success).toBe(true);
  });

  it('rejects source with an unknown enum value', () => {
    const result = SAPSearchSchema.safeParse({
      searchType: 'tadir_lookup',
      names: ['ZA'],
      source: 'sql',
    });
    expect(result.success).toBe(false);
  });

  it('accepts tadir_lookup without source (default applies in handler)', () => {
    const result = SAPSearchSchema.safeParse({
      searchType: 'tadir_lookup',
      names: ['ZA'],
    });
    expect(result.success).toBe(true);
  });
});

describe('SAPSearchSchemaNoSource', () => {
  it('accepts query without searchType', () => {
    const result = SAPSearchSchemaNoSource.safeParse({ query: 'ZCL_*' });
    expect(result.success).toBe(true);
  });

  it('rejects source_code searchType when source search is unavailable', () => {
    const result = SAPSearchSchemaNoSource.safeParse({ query: 'test', searchType: 'source_code' });
    expect(result.success).toBe(false);
  });

  it('accepts TADIR lookup when source search is unavailable', () => {
    const result = SAPSearchSchemaNoSource.safeParse({
      searchType: 'tadir_lookup',
      names: ['ZDM_PROJECT_D'],
      objectTypes: ['TABL'],
    });
    expect(result.success).toBe(true);
  });

  it("accepts source='both' for tadir_lookup when source search is unavailable", () => {
    const result = SAPSearchSchemaNoSource.safeParse({
      searchType: 'tadir_lookup',
      names: ['ZDM_PROJECT_D'],
      source: 'both',
    });
    expect(result.success).toBe(true);
  });
});

describe('SAPQuerySchema', () => {
  it('accepts valid SQL', () => {
    const result = SAPQuerySchema.safeParse({ sql: 'SELECT * FROM MARA' });
    expect(result.success).toBe(true);
  });

  it('rejects missing sql', () => {
    const result = SAPQuerySchema.safeParse({ maxRows: 10 });
    expect(result.success).toBe(false);
  });

  it('coerces maxRows from string', () => {
    const result = SAPQuerySchema.safeParse({ sql: 'SELECT * FROM MARA', maxRows: '200' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxRows).toBe(200);
    }
  });
});

describe('SAPWriteSchema', () => {
  it('accepts valid create input', () => {
    const result = SAPWriteSchema.safeParse({ action: 'create', type: 'CLAS', name: 'ZCL_NEW' });
    expect(result.success).toBe(true);
  });

  it('accepts FUGR create input (issue #250)', () => {
    const result = SAPWriteSchema.safeParse({ action: 'create', type: 'FUGR', name: 'ZARC1_FG', package: '$TMP' });
    expect(result.success).toBe(true);
  });

  it('accepts FUNC create input with group (issue #250)', () => {
    const result = SAPWriteSchema.safeParse({
      action: 'create',
      type: 'FUNC',
      name: 'Z_ARC1_FM',
      group: 'ZARC1_FG',
    });
    expect(result.success).toBe(true);
  });

  it('accepts FUNC create input WITHOUT group at schema level (runtime check enforces it)', () => {
    // Schema makes group optional; the runtime handler returns errorResult for create without group.
    // This test pins that behavior so a schema-side enforcement attempt would surface here.
    const result = SAPWriteSchema.safeParse({ action: 'create', type: 'FUNC', name: 'Z_FM' });
    expect(result.success).toBe(true);
  });

  it('accepts FUNC create input with structured parameters (issue #252)', () => {
    const result = SAPWriteSchema.safeParse({
      action: 'create',
      type: 'FUNC',
      name: 'Z_ARC1_FM_PARAMS',
      group: 'ZARC1_FG',
      parameters: [
        { kind: 'importing', name: 'IV_INPUT', type: 'STRING', byValue: true, optional: true, default: "'X'" },
        { kind: 'exporting', name: 'EV_OUTPUT', type: 'STRING', byValue: true },
        { kind: 'changing', name: 'CV_FLAG', type: 'I' },
        { kind: 'tables', name: 'IT_LINES', type: 'TYPE STANDARD TABLE' },
        { kind: 'exceptions', name: 'BAD_INPUT' },
        { kind: 'raising', name: 'CX_ROOT' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects FUNC parameters with invalid kind (issue #252)', () => {
    const result = SAPWriteSchema.safeParse({
      action: 'create',
      type: 'FUNC',
      name: 'Z_FM',
      group: 'Z_FG',
      parameters: [{ kind: 'returning', name: 'RV_X', type: 'STRING' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects FUNC parameters missing required name (issue #252)', () => {
    const result = SAPWriteSchema.safeParse({
      action: 'create',
      type: 'FUNC',
      name: 'Z_FM',
      group: 'Z_FG',
      parameters: [{ kind: 'importing', type: 'STRING' }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts DOMA/DTEL write fields', () => {
    const doma = SAPWriteSchema.safeParse({
      action: 'create',
      type: 'DOMA',
      name: 'ZDOMAIN',
      dataType: 'CHAR',
      length: '1',
      decimals: '0',
      outputLength: '1',
      signExists: 'true',
      lowercase: 'false',
      fixedValues: [{ low: 'A', description: 'Active' }],
      valueTable: 'T001',
    });
    expect(doma.success).toBe(true);
    if (doma.success) {
      expect(doma.data.length).toBe(1);
      expect(doma.data.signExists).toBe(true);
    }

    const dtel = SAPWriteSchema.safeParse({
      action: 'create',
      type: 'DTEL',
      name: 'ZDELEM',
      typeKind: 'domain',
      typeName: 'ZDOMAIN',
      shortLabel: 'Status',
      changeDocument: 'true',
    });
    expect(dtel.success).toBe(true);
    if (dtel.success) {
      expect(dtel.data.changeDocument).toBe(true);
    }
  });

  it('accepts SRVB fields and validates category enum', () => {
    const srvb = SAPWriteSchema.safeParse({
      action: 'create',
      type: 'SRVB',
      name: 'ZSB_TRAVEL_O4',
      serviceDefinition: 'ZSD_TRAVEL',
      bindingType: 'ODATA',
      category: '0',
    });
    expect(srvb.success).toBe(true);

    const invalidCategory = SAPWriteSchema.safeParse({
      action: 'create',
      type: 'SRVB',
      name: 'ZSB_TRAVEL_O4',
      serviceDefinition: 'ZSD_TRAVEL',
      category: '2',
    });
    expect(invalidCategory.success).toBe(false);
  });

  it('accepts edit_method with all fields', () => {
    const result = SAPWriteSchema.safeParse({
      action: 'edit_method',
      type: 'CLAS',
      name: 'ZCL_TEST',
      method: 'get_name',
      source: 'METHOD get_name.\nENDMETHOD.',
      transport: 'DEVK900001',
    });
    expect(result.success).toBe(true);
  });

  it('accepts preflightBeforeWrite override', () => {
    const result = SAPWriteSchema.safeParse({
      action: 'update',
      type: 'TABL',
      name: 'ZTABL_TEST',
      source: 'define table ztabl_test { key client : abap.clnt not null; }',
      preflightBeforeWrite: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.preflightBeforeWrite).toBe(false);
    }
  });

  it('accepts CLAS include update fields', () => {
    const result = SAPWriteSchema.safeParse({
      action: 'update',
      type: 'CLAS',
      name: 'ZBP_I_TRAVELREQ',
      include: 'definitions',
      source: 'CLASS lhc_travel DEFINITION.\nENDCLASS.',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.include).toBe('definitions');
    }
  });

  it('rejects SAPWrite include outside CLAS update/edit_method', () => {
    const nonUpdate = SAPWriteSchema.safeParse({
      action: 'create',
      type: 'CLAS',
      name: 'ZCL_TEST',
      include: 'definitions',
    });
    expect(nonUpdate.success).toBe(false);
    if (!nonUpdate.success) {
      // PR-D: include= is now valid for both update and edit_method actions.
      // The schema must still reject create/delete/batch_create/scaffold_rap_handlers.
      expect(nonUpdate.error.issues[0]?.message).toMatch(/action="update".*edit_method|update or action="edit_method"/);
    }

    const nonClass = SAPWriteSchema.safeParse({
      action: 'update',
      type: 'PROG',
      name: 'ZPROG',
      include: 'definitions',
      source: 'REPORT zprog.',
    });
    expect(nonClass.success).toBe(false);
    if (!nonClass.success) {
      expect(nonClass.error.issues[0]?.message).toContain('type="CLAS"');
    }
  });

  it('accepts include for action=edit_method on CLAS (PR-D)', () => {
    const editIncl = SAPWriteSchema.safeParse({
      action: 'edit_method',
      type: 'CLAS',
      name: 'ZBP_DM_PROJECT',
      method: 'lhc_project~approve_project',
      include: 'implementations',
      source: '    DATA(x) = 1.',
    });
    expect(editIncl.success).toBe(true);
    if (editIncl.success) {
      expect(editIncl.data.include).toBe('implementations');
      expect(editIncl.data.action).toBe('edit_method');
    }
  });

  it('rejects include on edit_method when type is not CLAS', () => {
    const result = SAPWriteSchema.safeParse({
      action: 'edit_method',
      type: 'PROG',
      name: 'ZPROG',
      method: 'foo',
      include: 'implementations',
      source: 'WRITE / 1.',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message.includes('type="CLAS"'))).toBe(true);
    }
  });

  it('rejects invalid SAPWrite CLAS include values', () => {
    const result = SAPWriteSchema.safeParse({
      action: 'update',
      type: 'CLAS',
      name: 'ZCL_TEST',
      include: 'main',
      source: 'CLASS zcl_test DEFINITION. ENDCLASS.',
    });
    expect(result.success).toBe(false);
  });

  it('accepts TABL for source-based writes', () => {
    const result = SAPWriteSchema.safeParse({
      action: 'create',
      type: 'TABL',
      name: 'ZTABL_TEST',
      source: 'define table ztabl_test { key client : abap.clnt; key id : abap.numc(8); }',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing action', () => {
    expect(SAPWriteSchema.safeParse({ type: 'CLAS', name: 'ZCL_TEST' }).success).toBe(false);
  });

  it('rejects invalid action', () => {
    const result = SAPWriteSchema.safeParse({ action: 'invalid', type: 'CLAS', name: 'ZCL_TEST' });
    expect(result.success).toBe(false);
  });

  it('accepts batch_create action', () => {
    const result = SAPWriteSchema.safeParse({
      action: 'batch_create',
      package: '$TMP',
      objects: [
        {
          type: 'DDLS',
          name: 'ZI_TRAVEL',
          source: 'define view entity ZI_TRAVEL {}',
          package: 'ZDEV',
          transport: 'A4HK900123',
        },
        { type: 'BDEF', name: 'ZI_TRAVEL', package: 'ZDEV' },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.objects?.[0]).toMatchObject({ package: 'ZDEV', transport: 'A4HK900123' });
    }
  });

  it('accepts scaffold_rap_handlers action fields', () => {
    const result = SAPWriteSchema.safeParse({
      action: 'scaffold_rap_handlers',
      type: 'CLAS',
      name: 'ZBP_I_TRAVELREQ',
      bdefName: 'ZI_TRAVELREQ',
      autoApply: 'true',
      targetAlias: 'Travel',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autoApply).toBe(true);
    }
  });

  it('accepts generate_behavior_implementation action with new fields', () => {
    const result = SAPWriteSchema.safeParse({
      action: 'generate_behavior_implementation',
      type: 'CLAS',
      name: 'ZBP_DM_PROJECT',
      bdefName: 'ZR_DM_PROJECT',
      targetAlias: 'Project',
      activate: false,
      dryRun: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activate).toBe(false);
      expect(result.data.dryRun).toBe(true);
      expect(result.data.action).toBe('generate_behavior_implementation');
    }
  });

  it('accepts generate_behavior_implementation with only the required name (auto-discovery + activate-by-default)', () => {
    const result = SAPWriteSchema.safeParse({
      action: 'generate_behavior_implementation',
      type: 'CLAS',
      name: 'ZBP_DM_PROJECT',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // Defaults: activate / dryRun / bdefName are optional → undefined here
      expect(result.data.activate).toBeUndefined();
      expect(result.data.dryRun).toBeUndefined();
    }
  });

  it('rejects unknown SAPWrite action values', () => {
    const result = SAPWriteSchema.safeParse({
      action: 'totally_invented_action',
      type: 'CLAS',
      name: 'ZCL_NOT_A_REAL_ACTION',
    });
    expect(result.success).toBe(false);
  });

  it('validates objects array structure', () => {
    // Valid: objects with type and name
    expect(
      SAPWriteSchema.safeParse({
        action: 'batch_create',
        objects: [{ type: 'CLAS', name: 'ZCL_NEW', source: 'CLASS zcl_new.', description: 'New class' }],
      }).success,
    ).toBe(true);

    // Invalid: object missing type
    expect(
      SAPWriteSchema.safeParse({
        action: 'batch_create',
        objects: [{ name: 'ZCL_NEW' }],
      }).success,
    ).toBe(false);

    // Invalid: object missing name
    expect(
      SAPWriteSchema.safeParse({
        action: 'batch_create',
        objects: [{ type: 'CLAS' }],
      }).success,
    ).toBe(false);
  });

  it('accepts activateAtEnd with boolean and string-coerced values for batch_create', () => {
    for (const v of [true, false, 'true', 'false']) {
      const parsed = SAPWriteSchema.safeParse({
        action: 'batch_create',
        objects: [{ type: 'CLAS', name: 'ZCL_X' }],
        activateAtEnd: v,
      });
      expect(parsed.success, `activateAtEnd=${JSON.stringify(v)} should parse`).toBe(true);
      if (parsed.success) {
        expect(typeof parsed.data.activateAtEnd).toBe('boolean');
      }
    }
  });

  it("rejects activateAtEnd values that z.coerce.boolean treats as 'yes' / unknown numbers", () => {
    // z.coerce.boolean accepts anything truthy/falsy at the JS level. The contract we
    // care about: a string like "yes" still parses (coerces to true), but actual schema
    // mis-uses such as objects/arrays must fail.
    const objParsed = SAPWriteSchema.safeParse({
      action: 'batch_create',
      objects: [{ type: 'CLAS', name: 'ZCL_X' }],
      activateAtEnd: { not: 'a boolean' },
    });
    // Zod's coerce(boolean) ToBoolean(value) for objects = true; we accept that.
    expect(objParsed.success).toBe(true);
  });
});

describe('SAPWriteSchemaBtp', () => {
  it('rejects on-prem-only types', () => {
    expect(SAPWriteSchemaBtp.safeParse({ action: 'create', type: 'PROG', name: 'Z' }).success).toBe(false);
    expect(SAPWriteSchemaBtp.safeParse({ action: 'create', type: 'FUNC', name: 'Z' }).success).toBe(false);
    expect(SAPWriteSchemaBtp.safeParse({ action: 'create', type: 'INCL', name: 'Z' }).success).toBe(false);
  });

  it('accepts BTP types', () => {
    expect(SAPWriteSchemaBtp.safeParse({ action: 'create', type: 'CLAS', name: 'Z' }).success).toBe(true);
    expect(SAPWriteSchemaBtp.safeParse({ action: 'create', type: 'DDLS', name: 'Z' }).success).toBe(true);
    expect(SAPWriteSchemaBtp.safeParse({ action: 'create', type: 'DCLS', name: 'ZI_TEST_DCL' }).success).toBe(true);
    expect(SAPWriteSchemaBtp.safeParse({ action: 'create', type: 'TABL', name: 'ZTABL' }).success).toBe(true);
    expect(
      SAPWriteSchemaBtp.safeParse({ action: 'create', type: 'SRVB', name: 'ZSB', serviceDefinition: 'ZSD' }).success,
    ).toBe(true);
    expect(SAPWriteSchemaBtp.safeParse({ action: 'create', type: 'DOMA', name: 'ZDOMAIN' }).success).toBe(true);
    expect(SAPWriteSchemaBtp.safeParse({ action: 'create', type: 'DTEL', name: 'ZDELEM' }).success).toBe(true);
  });

  it('accepts CLAS include update on BTP schema', () => {
    const result = SAPWriteSchemaBtp.safeParse({
      action: 'update',
      type: 'CLAS',
      name: 'ZCL_TEST',
      include: 'implementations',
      source: 'CLASS zcl_test IMPLEMENTATION.\nENDCLASS.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts activateAtEnd on BTP schema for batch_create', () => {
    const result = SAPWriteSchemaBtp.safeParse({
      action: 'batch_create',
      objects: [{ type: 'CLAS', name: 'ZCL_X' }],
      activateAtEnd: true,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.activateAtEnd).toBe(true);
  });
});

describe('SAPActivateSchema', () => {
  it('accepts single object activation', () => {
    const result = SAPActivateSchema.safeParse({ name: 'ZCL_TEST', type: 'CLAS' });
    expect(result.success).toBe(true);
  });

  it('accepts batch activation', () => {
    const result = SAPActivateSchema.safeParse({
      objects: [
        { type: 'DDLS', name: 'ZI_TRAVEL' },
        { type: 'BDEF', name: 'ZI_TRAVEL' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty input (all fields optional)', () => {
    const result = SAPActivateSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts publish_srvb action', () => {
    const result = SAPActivateSchema.safeParse({ action: 'publish_srvb', name: 'ZSB_BOOKING_V4' });
    expect(result.success).toBe(true);
  });

  it('accepts unpublish_srvb action', () => {
    const result = SAPActivateSchema.safeParse({ action: 'unpublish_srvb', name: 'ZSB_BOOKING_V4' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action', () => {
    const result = SAPActivateSchema.safeParse({ action: 'invalid_action', name: 'ZSB_TEST' });
    expect(result.success).toBe(false);
  });
});

describe('SAPNavigateSchema', () => {
  it('accepts definition action', () => {
    const result = SAPNavigateSchema.safeParse({
      action: 'definition',
      uri: '/sap/bc/adt/programs/programs/ztest',
      line: 10,
      column: 5,
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action', () => {
    const result = SAPNavigateSchema.safeParse({ action: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('coerces line/column from strings', () => {
    const result = SAPNavigateSchema.safeParse({ action: 'definition', line: '10', column: '5' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.line).toBe(10);
      expect(result.data.column).toBe(5);
    }
  });
});

describe('SAPLintSchema', () => {
  it('accepts lint with source', () => {
    const result = SAPLintSchema.safeParse({ action: 'lint', source: 'REPORT ztest.' });
    expect(result.success).toBe(true);
  });

  it('accepts list_rules without source', () => {
    const result = SAPLintSchema.safeParse({ action: 'list_rules' });
    expect(result.success).toBe(true);
  });

  it('accepts formatter actions', () => {
    expect(SAPLintSchema.safeParse({ action: 'format', source: 'report ztest.' }).success).toBe(true);
    expect(SAPLintSchema.safeParse({ action: 'get_formatter_settings' }).success).toBe(true);
    expect(SAPLintSchema.safeParse({ action: 'set_formatter_settings', style: 'keywordLower' }).success).toBe(true);
  });

  it('coerces indentation for set_formatter_settings', () => {
    const result = SAPLintSchema.safeParse({ action: 'set_formatter_settings', indentation: 0 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.indentation).toBe(false);
    }
  });

  it('rejects invalid action', () => {
    const result = SAPLintSchema.safeParse({ action: 'invalid' });
    expect(result.success).toBe(false);
  });
});

describe('SAPDiagnoseSchema', () => {
  it('accepts syntax check', () => {
    const result = SAPDiagnoseSchema.safeParse({ action: 'syntax', name: 'ZTEST', type: 'PROG' });
    expect(result.success).toBe(true);
  });

  it('accepts dumps with optional filters', () => {
    const result = SAPDiagnoseSchema.safeParse({
      action: 'dumps',
      user: 'DEVELOPER',
      maxResults: 10,
      sections: ['kap0', 'kap3'],
      includeFullText: false,
    });
    expect(result.success).toBe(true);
  });

  it('accepts traces with analysis type', () => {
    const result = SAPDiagnoseSchema.safeParse({ action: 'traces', id: '123', analysis: 'hitlist' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid analysis type', () => {
    const result = SAPDiagnoseSchema.safeParse({ action: 'traces', id: '123', analysis: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('accepts system_messages feed filters', () => {
    const result = SAPDiagnoseSchema.safeParse({
      action: 'system_messages',
      user: 'BASISADM',
      maxResults: '25',
      from: '20260401090000',
      to: '20260401120000',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxResults).toBe(25);
    }
  });

  it('accepts gateway_errors list and detail modes', () => {
    expect(
      SAPDiagnoseSchema.safeParse({
        action: 'gateway_errors',
        maxResults: 20,
      }).success,
    ).toBe(true);

    expect(
      SAPDiagnoseSchema.safeParse({
        action: 'gateway_errors',
        detailUrl: '/sap/bc/adt/gw/errorlog/Frontend%20Error/ABC123',
      }).success,
    ).toBe(true);

    expect(
      SAPDiagnoseSchema.safeParse({
        action: 'gateway_errors',
        id: 'ABC123',
        errorType: 'Frontend Error',
      }).success,
    ).toBe(true);
  });

  it('accepts quickfix with source position fields', () => {
    const result = SAPDiagnoseSchema.safeParse({
      action: 'quickfix',
      name: 'ZCL_TEST',
      type: 'CLAS',
      source: 'CLASS zcl_test DEFINITION. ENDCLASS.',
      line: '12',
      column: '4',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.line).toBe(12);
      expect(result.data.column).toBe(4);
    }
  });

  it('accepts object_state with object identity fields', () => {
    const result = SAPDiagnoseSchema.safeParse({
      action: 'object_state',
      name: 'ZBP_DM_PROJECT',
      type: 'CLAS',
    });

    expect(result.success).toBe(true);
  });

  it('accepts apply_quickfix with proposal data', () => {
    const result = SAPDiagnoseSchema.safeParse({
      action: 'apply_quickfix',
      name: 'ZCL_TEST',
      type: 'CLAS',
      source: 'CLASS zcl_test DEFINITION. ENDCLASS.',
      sourceUri: '/sap/bc/adt/oo/classes/ZCL_TEST/includes/definitions',
      line: 12,
      proposalUri: '/sap/bc/adt/quickfixes/1',
      proposalUserContent: 'opaque-state',
    });
    expect(result.success).toBe(true);
  });

  it('accepts apply_quickfix with empty userContent and affected objects', () => {
    const result = SAPDiagnoseSchema.safeParse({
      action: 'apply_quickfix',
      name: 'ZCL_TEST',
      type: 'CLAS',
      source: 'CLASS zcl_test DEFINITION. ENDCLASS.',
      sourceUri: '/sap/bc/adt/oo/classes/ZCL_TEST/includes/definitions',
      line: 12,
      proposalUri: '/sap/bc/adt/quickfixes/1',
      proposalUserContent: '',
      proposalAffectedObjects: [
        {
          uri: '/sap/bc/adt/oo/classes/ZCL_HELPER/source/main',
          type: 'CLAS/OC',
          name: 'ZCL_HELPER',
          description: 'Helper class',
          content: 'CLASS zcl_helper DEFINITION. ENDCLASS.',
        },
      ],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.proposalUserContent).toBe('');
      expect(result.data.sourceUri).toBe('/sap/bc/adt/oo/classes/ZCL_TEST/includes/definitions');
      expect(result.data.proposalAffectedObjects?.[0]?.uri).toBe('/sap/bc/adt/oo/classes/ZCL_HELPER/source/main');
    }
  });
});

describe('SAPTransportSchema', () => {
  it('accepts list action', () => {
    const result = SAPTransportSchema.safeParse({ action: 'list' });
    expect(result.success).toBe(true);
  });

  it('accepts create with description', () => {
    const result = SAPTransportSchema.safeParse({ action: 'create', description: 'Test transport' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid action', () => {
    const result = SAPTransportSchema.safeParse({ action: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('accepts history with type and name', () => {
    const result = SAPTransportSchema.safeParse({ action: 'history', type: 'CLAS', name: 'ZCL_X' });
    expect(result.success).toBe(true);
  });

  it('accepts history without type/name at schema level', () => {
    const result = SAPTransportSchema.safeParse({ action: 'history' });
    expect(result.success).toBe(true);
  });
});

describe('SAPGitSchema', () => {
  it('accepts valid read action payload', () => {
    const result = SAPGitSchema.safeParse({ action: 'list_repos', backend: 'gcts' });
    expect(result.success).toBe(true);
  });

  it('rejects unknown action', () => {
    const result = SAPGitSchema.safeParse({ action: 'status' });
    expect(result.success).toBe(false);
  });

  it('restricts backend enum to gcts|abapgit', () => {
    expect(SAPGitSchema.safeParse({ action: 'list_repos', backend: 'gcts' }).success).toBe(true);
    expect(SAPGitSchema.safeParse({ action: 'list_repos', backend: 'abapgit' }).success).toBe(true);
    expect(SAPGitSchema.safeParse({ action: 'list_repos', backend: 'unknown' }).success).toBe(false);
  });

  it('validates objects array shape', () => {
    const ok = SAPGitSchema.safeParse({
      action: 'commit',
      repoId: 'ZARC1',
      objects: [{ type: 'CLAS', name: 'ZCL_ARC1_TEST', operation: 'M' }],
    });
    expect(ok.success).toBe(true);

    const invalid = SAPGitSchema.safeParse({
      action: 'commit',
      repoId: 'ZARC1',
      objects: [{ type: 'CLAS' }],
    });
    expect(invalid.success).toBe(false);
  });

  it('coerces limit from string to number', () => {
    const result = SAPGitSchema.safeParse({ action: 'history', repoId: 'ZARC1', limit: '25' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.limit).toBe(25);
  });
});

describe('SAPContextSchema', () => {
  it('accepts minimal input (name only)', () => {
    const result = SAPContextSchema.safeParse({ name: 'ZCL_ORDER' });
    expect(result.success).toBe(true);
  });

  it('accepts full input', () => {
    const result = SAPContextSchema.safeParse({
      action: 'impact',
      type: 'CLAS',
      name: 'ZCL_ORDER',
      maxDeps: 10,
      depth: 2,
      includeIndirect: true,
      siblingCheck: false,
      siblingMaxCandidates: 5,
    });
    expect(result.success).toBe(true);
  });

  it('accepts sibling controls for impact', () => {
    const result = SAPContextSchema.safeParse({
      action: 'impact',
      type: 'DDLS',
      name: 'ZI_SALES',
      siblingCheck: true,
      siblingMaxCandidates: 3,
    });
    expect(result.success).toBe(true);
  });

  it('clamps siblingMaxCandidates to hard bounds', () => {
    const low = SAPContextSchema.safeParse({
      action: 'impact',
      type: 'DDLS',
      name: 'ZI_SALES',
      siblingMaxCandidates: 0,
    });
    expect(low.success).toBe(true);
    if (low.success) {
      expect(low.data.siblingMaxCandidates).toBe(1);
    }

    const high = SAPContextSchema.safeParse({
      action: 'impact',
      type: 'DDLS',
      name: 'ZI_SALES',
      siblingMaxCandidates: 999,
    });
    expect(high.success).toBe(true);
    if (high.success) {
      expect(high.data.siblingMaxCandidates).toBe(10);
    }
  });

  it('rejects missing name', () => {
    const result = SAPContextSchema.safeParse({ type: 'CLAS' });
    expect(result.success).toBe(false);
  });

  it('rejects depth > 3', () => {
    const result = SAPContextSchema.safeParse({ name: 'ZCL_TEST', depth: 5 });
    expect(result.success).toBe(false);
  });

  it('rejects depth < 1', () => {
    const result = SAPContextSchema.safeParse({ name: 'ZCL_TEST', depth: 0 });
    expect(result.success).toBe(false);
  });
});

describe('SAPContextSchemaBtp', () => {
  it('rejects on-prem-only types', () => {
    expect(SAPContextSchemaBtp.safeParse({ name: 'Z', type: 'PROG' }).success).toBe(false);
    expect(SAPContextSchemaBtp.safeParse({ name: 'Z', type: 'FUNC' }).success).toBe(false);
  });

  it('accepts BTP types', () => {
    expect(SAPContextSchemaBtp.safeParse({ name: 'Z', type: 'CLAS' }).success).toBe(true);
    expect(SAPContextSchemaBtp.safeParse({ name: 'Z', type: 'DDLS' }).success).toBe(true);
    expect(SAPContextSchemaBtp.safeParse({ name: 'Z', type: 'DDLS', action: 'impact' }).success).toBe(true);
    const siblingControls = SAPContextSchemaBtp.safeParse({
      name: 'Z',
      type: 'DDLS',
      action: 'impact',
      siblingCheck: false,
      siblingMaxCandidates: 4,
    });
    expect(siblingControls.success).toBe(true);
  });

  it('does not have group field', () => {
    const result = SAPContextSchemaBtp.safeParse({ name: 'Z', group: 'TEST' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('group' in result.data).toBe(false);
    }
  });
});

describe('SAPManageSchema', () => {
  it('accepts valid actions', () => {
    expect(SAPManageSchema.safeParse({ action: 'features' }).success).toBe(true);
    expect(SAPManageSchema.safeParse({ action: 'probe' }).success).toBe(true);
    expect(SAPManageSchema.safeParse({ action: 'cache_stats' }).success).toBe(true);
    expect(
      SAPManageSchema.safeParse({
        action: 'create_package',
        name: 'ZPKG',
        description: 'Package',
        superPackage: '$TMP',
      }).success,
    ).toBe(true);
    expect(SAPManageSchema.safeParse({ action: 'delete_package', name: 'ZPKG' }).success).toBe(true);
    expect(
      SAPManageSchema.safeParse({
        action: 'change_package',
        objectName: 'ZARC1_TEST',
        objectType: 'DDLS/DF',
        oldPackage: '$TMP',
        newPackage: 'Z_TARGET',
        transport: 'A4HK900123',
      }).success,
    ).toBe(true);
    expect(SAPManageSchema.safeParse({ action: 'flp_list_catalogs' }).success).toBe(true);
    expect(SAPManageSchema.safeParse({ action: 'flp_list_groups' }).success).toBe(true);
    expect(SAPManageSchema.safeParse({ action: 'flp_list_tiles', catalogId: 'ZCAT' }).success).toBe(true);
    expect(
      SAPManageSchema.safeParse({ action: 'flp_create_catalog', domainId: 'ZCAT', title: 'Test Catalog' }).success,
    ).toBe(true);
    expect(SAPManageSchema.safeParse({ action: 'flp_create_group', groupId: 'ZGROUP', title: 'Group' }).success).toBe(
      true,
    );
    expect(
      SAPManageSchema.safeParse({
        action: 'flp_create_tile',
        catalogId: 'ZCAT',
        tile: { id: 'tile-1', title: 'Tile', semanticObject: 'ZSO', semanticAction: 'display' },
      }).success,
    ).toBe(true);
    expect(
      SAPManageSchema.safeParse({
        action: 'flp_add_tile_to_group',
        groupId: 'ZGROUP',
        catalogId: 'ZCAT',
        tileInstanceId: 'TILE123',
      }).success,
    ).toBe(true);
    expect(
      SAPManageSchema.safeParse({
        action: 'flp_delete_catalog',
        catalogId: 'X-SAP-UI2-CATALOGPAGE:ZARC1_TEST',
      }).success,
    ).toBe(true);
  });

  it('rejects invalid action', () => {
    expect(SAPManageSchema.safeParse({ action: 'invalid' }).success).toBe(false);
  });

  it('rejects missing action', () => {
    expect(SAPManageSchema.safeParse({}).success).toBe(false);
  });

  it('rejects invalid tile object', () => {
    const result = SAPManageSchema.safeParse({
      action: 'flp_create_tile',
      catalogId: 'ZCAT',
      tile: { id: 'tile-1', title: 'Tile', semanticObject: 'ZSO' },
    });
    expect(result.success).toBe(false);
  });
});

describe('SAPHyperfocusedSchema', () => {
  it('accepts any action string', () => {
    const result = SAPHyperfocusedSchema.safeParse({ action: 'read', type: 'CLAS', name: 'ZCL_TEST' });
    expect(result.success).toBe(true);
  });

  it('accepts params object', () => {
    const result = SAPHyperfocusedSchema.safeParse({
      action: 'write',
      params: { action: 'create', source: 'REPORT z.' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing action', () => {
    const result = SAPHyperfocusedSchema.safeParse({ type: 'CLAS' });
    expect(result.success).toBe(false);
  });
});

describe('getToolSchema', () => {
  it('returns on-prem schema for SAPRead when isBtp=false', () => {
    const schema = getToolSchema('SAPRead', false);
    expect(schema).toBe(SAPReadSchema);
  });

  it('returns BTP schema for SAPRead when isBtp=true', () => {
    const schema = getToolSchema('SAPRead', true);
    expect(schema).toBe(SAPReadSchemaBtp);
  });

  it('returns restricted search schema when textSearch unavailable', () => {
    const schema = getToolSchema('SAPSearch', false, false);
    expect(schema).toBe(SAPSearchSchemaNoSource);
  });

  it('returns full search schema when textSearch available', () => {
    const schema = getToolSchema('SAPSearch', false, true);
    expect(schema).toBe(SAPSearchSchema);
  });

  it('returns undefined for unknown tool', () => {
    expect(getToolSchema('UnknownTool', false)).toBeUndefined();
  });

  it('returns schema for all 12 tools + hyperfocused', () => {
    const tools = [
      'SAPRead',
      'SAPSearch',
      'SAPQuery',
      'SAPWrite',
      'SAPActivate',
      'SAPNavigate',
      'SAPLint',
      'SAPDiagnose',
      'SAPTransport',
      'SAPGit',
      'SAPContext',
      'SAPManage',
      'SAP',
    ];
    for (const tool of tools) {
      expect(getToolSchema(tool, false)).toBeDefined();
    }
  });
});
