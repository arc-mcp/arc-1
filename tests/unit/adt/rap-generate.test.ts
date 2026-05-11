import { describe, expect, it, vi } from 'vitest';
import { AdtSafetyError } from '../../../src/adt/errors.js';
import {
  generateBehaviorImplementation,
  isRapGenerateResultSuccess,
  type RapGenerateResult,
} from '../../../src/adt/rap-generate.js';

// Minimal in-memory fixtures used across the suite.
const BDEF_SOURCE = `managed implementation in class ZBP_DM_PROJECT unique;
strict ( 2 );
with draft;

define behavior for ZR_DM_PROJECT alias Project
  persistent table zdm_project
  draft table zdm_project_d
  lock master
  authorization master ( instance )
{
  create;
  update;
  delete;
  action approve_project result [1] $self;
}`;

const CLASS_MAIN_BEHAVIOR_POOL = `CLASS zbp_dm_project DEFINITION
  PUBLIC ABSTRACT FINAL
  FOR BEHAVIOR OF zr_dm_project.
ENDCLASS.

CLASS zbp_dm_project IMPLEMENTATION.
ENDCLASS.`;

const PLACEHOLDER_DEFINITIONS = `*"* use this source file for any type of declarations (class
*"* definitions, interfaces or type declarations) you need for
*"* components in the private section
`;

const PLACEHOLDER_IMPLEMENTATIONS = `*"* use this source file for the definition and implementation of
*"* local helper classes, interface definitions and type
*"* declarations
`;

interface MockState {
  metadataResponse: {
    name: string;
    description: string;
    language: string;
    category: string;
    fixPointArithmetic: boolean;
    package: string;
    rootEntityRef?: { name: string; type: string; uri: string };
  };
  structuredResponse: {
    main: string;
    definitions: string | null;
    implementations: string | null;
    macros: string | null;
    testclasses: string | null;
  };
  bdefResponse: { source: string; etag?: string };
  /** Activation behaviour: 'success' | 'stale_active_failure' | 'generic_failure' | 'throws' */
  activationMode?: 'success' | 'stale_active_failure' | 'generic_failure' | 'throws';
  /** Tracks each PUT to a class include URL for assertions. */
  writes: Array<{ uri: string; bodyLength: number }>;
}

function makeClient(state: MockState): {
  client: any;
  state: MockState;
} {
  const safety = {
    allowWrites: true,
    allowedPackages: ['*'],
  };
  const writes = state.writes;

  // Stub: AdtHttpClient interface — we only need withStatefulSession + post + put.
  const session = {
    post: vi.fn(async (path: string) => {
      // Lock POST: return XML carrying the lockHandle the lockObject parser expects.
      if (path.includes('?_action=LOCK')) {
        return {
          status: 200,
          body: '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>LH-1</LOCK_HANDLE><CORR_NR>TR-1</CORR_NR></DATA></asx:values></asx:abap>',
          headers: {},
        };
      }
      if (path.includes('?_action=UNLOCK')) {
        return { status: 200, body: '', headers: {} };
      }
      // Activation POST
      if (path.includes('/sap/bc/adt/activation')) {
        switch (state.activationMode) {
          case 'stale_active_failure':
            // parseActivationOutcome looks for <msg> elements with severity/type carrying the
            // error. The shape mirrors what SAP emits live (verified via curl on a4h, 2026-05-10).
            return {
              status: 200,
              body: `<?xml version="1.0" encoding="UTF-8"?>
<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist">
  <msg objDescr="ZBP_DM_PROJECT" type="E" severity="error" shortText='Local classes of "CL_ABAP_BEHAVIOR_HANDLER" can only be derived in the "Local Definitions/Implementations" of a global BEHAVIOR class' uri="${path}#start=1,45"/>
</chkl:messages>`,
              headers: {},
            };
          case 'generic_failure':
            return {
              status: 200,
              body: `<?xml version="1.0" encoding="UTF-8"?>
<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist">
  <msg type="E" severity="error" shortText="Some other compile error"/>
</chkl:messages>`,
              headers: {},
            };
          case 'throws': {
            const error = new Error('boom') as Error & { name?: string; statusCode?: number };
            error.name = 'AdtApiError';
            error.statusCode = 500;
            throw error;
          }
          default:
            // success: empty body parses to { kind: 'success' }
            return { status: 200, body: '', headers: {} };
        }
      }
      return { status: 200, body: '', headers: {} };
    }),
    put: vi.fn(async (path: string, body: string) => {
      writes.push({ uri: path, bodyLength: body.length });
      return { status: 200, body: '', headers: {} };
    }),
    get: vi.fn(async () => ({ status: 200, body: '', headers: {} })),
  };

  const http = {
    withStatefulSession: vi.fn(async (fn: (s: any) => Promise<unknown>) => fn(session)),
    post: session.post,
    put: session.put,
    get: session.get,
  };

  const client = {
    http,
    safety,
    getClassMetadata: vi.fn(async () => state.metadataResponse),
    getClassStructured: vi.fn(async () => state.structuredResponse),
    getBdef: vi.fn(async () => state.bdefResponse),
  };

  return { client, state };
}

function defaultState(overrides: Partial<MockState> = {}): MockState {
  return {
    metadataResponse: {
      name: 'ZBP_DM_PROJECT',
      description: 'Behavior pool',
      language: 'EN',
      category: 'behaviorPool',
      fixPointArithmetic: true,
      package: 'ZDEMO_MIG_RAP',
      rootEntityRef: {
        name: 'ZR_DM_PROJECT',
        type: 'STOB/DO',
        uri: '/sap/bc/adt/ddic/ddl/sources/zr_dm_project/source/main',
      },
    },
    structuredResponse: {
      main: CLASS_MAIN_BEHAVIOR_POOL,
      definitions: PLACEHOLDER_DEFINITIONS,
      implementations: PLACEHOLDER_IMPLEMENTATIONS,
      macros: null,
      testclasses: null,
    },
    bdefResponse: { source: BDEF_SOURCE },
    writes: [],
    ...overrides,
  };
}

describe('generateBehaviorImplementation', () => {
  it('happy path: discovers BDEF from rootEntityRef, scaffolds, and reports success', async () => {
    const state = defaultState({ activationMode: 'success' });
    const { client } = makeClient(state);

    const result = await generateBehaviorImplementation(client, 'ZBP_DM_PROJECT');

    expect(result.discovery.bdefName).toBe('ZR_DM_PROJECT');
    expect(result.discovery.source).toBe('rootEntityRef');
    expect(result.discovery.classCategory).toBe('behaviorPool');
    expect(result.validation.mainHasForBehaviorOf).toBe(true);
    expect(result.validation.bdefBindsClass).toBe(true);
    expect(result.validation.mismatchReason).toBeUndefined();
    expect(result.scaffoldChanged).toBe(true);
    expect(result.inserted.signatures).toBeGreaterThan(0);
    // Two entity-handler skeletons: lhc_project (only entity in this BDEF)
    expect(result.inserted.autoCreatedSkeletons).toBeGreaterThan(0);
    expect(result.activation?.success).toBe(true);
    expect(state.writes.length).toBeGreaterThan(0);
  });

  it('uses explicit bdefName override and reports source=explicit', async () => {
    const state = defaultState();
    state.metadataResponse.rootEntityRef = undefined; // force explicit path
    const { client } = makeClient(state);

    const result = await generateBehaviorImplementation(client, 'ZBP_DM_PROJECT', {
      bdefName: 'ZR_DM_PROJECT',
      activate: false,
    });

    expect(result.discovery.source).toBe('explicit');
    expect(result.discovery.bdefName).toBe('ZR_DM_PROJECT');
    expect(result.activation).toBeUndefined();
  });

  it('rejects when class is not a behavior pool', async () => {
    const state = defaultState();
    state.metadataResponse.category = 'generalObjectType';
    const { client } = makeClient(state);

    await expect(generateBehaviorImplementation(client, 'ZCL_NOT_BP')).rejects.toThrow(/not a RAP behavior pool/i);
  });

  it('rejects when neither rootEntityRef nor explicit bdefName is available', async () => {
    const state = defaultState();
    state.metadataResponse.rootEntityRef = undefined;
    const { client } = makeClient(state);

    await expect(generateBehaviorImplementation(client, 'ZBP_DM_PROJECT')).rejects.toThrow(
      /cannot auto-discover BDEF/i,
    );
  });

  it('flags MAIN-missing-FOR-BEHAVIOR-OF as a validation mismatch (and refuses mutation)', async () => {
    const state = defaultState();
    state.structuredResponse.main = `CLASS zbp_dm_project DEFINITION PUBLIC. ENDCLASS.
CLASS zbp_dm_project IMPLEMENTATION. ENDCLASS.`;
    const { client } = makeClient(state);

    await expect(generateBehaviorImplementation(client, 'ZBP_DM_PROJECT')).rejects.toThrow(
      /cross-reference validation failed/i,
    );
  });

  it('flags BDEF-not-binding-this-class as a validation mismatch', async () => {
    const state = defaultState();
    state.bdefResponse.source = `managed implementation in class ZBP_OTHER unique;
define behavior for ZR_DM_PROJECT alias Project { create; }`;
    const { client } = makeClient(state);

    await expect(generateBehaviorImplementation(client, 'ZBP_DM_PROJECT')).rejects.toThrow(
      /BDEF .* binds class ZBP_OTHER but we are generating for ZBP_DM_PROJECT/i,
    );
  });

  it('returns the validation report without writing in dryRun mode', async () => {
    const state = defaultState();
    state.bdefResponse.source = `managed implementation in class ZBP_OTHER unique;
define behavior for ZR_DM_PROJECT alias Project { create; }`;
    const { client } = makeClient(state);

    const result = await generateBehaviorImplementation(client, 'ZBP_DM_PROJECT', {
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.validation.mismatchReason).toMatch(/binds class/i);
    expect(state.writes.length).toBe(0);
  });

  it('respects the targetAlias filter (scaffolds only one entity handler)', async () => {
    const state = defaultState({ activationMode: 'success' });
    // Multi-line BDEF: parseBehaviorBlocks line-scans for actions/determinations/validations,
    // so each declaration must sit on its own line (matches /^\s*action\s+/).
    state.bdefResponse.source = `managed implementation in class ZBP_DM_PROJECT unique;
define behavior for ZR_DM_PROJECT alias Project
{
  create;
  action approve result [1] $self;
}

define behavior for ZR_DM_TASK alias Task
{
  create;
  action approve_task result [1] $self;
}`;
    const { client } = makeClient(state);

    const result = await generateBehaviorImplementation(client, 'ZBP_DM_PROJECT', {
      targetAlias: 'task',
      activate: false,
    });

    expect(result.required.length).toBeGreaterThan(0);
    expect(result.required.every((r) => r.entityAlias.toLowerCase() === 'task')).toBe(true);
  });

  it('skips activation when activate=false', async () => {
    const state = defaultState({ activationMode: 'success' });
    const { client } = makeClient(state);

    const result = await generateBehaviorImplementation(client, 'ZBP_DM_PROJECT', {
      activate: false,
    });

    expect(result.activation).toBeUndefined();
    // Verify no activation POST was issued
    const activationCalls = (client.http.post as any).mock.calls.filter((call: unknown[]) =>
      String(call[0]).includes('/sap/bc/adt/activation'),
    );
    expect(activationCalls.length).toBe(0);
  });

  it('returns the stale-active recovery hint when SAP rejects activation with that error', async () => {
    const state = defaultState({ activationMode: 'stale_active_failure' });
    const { client } = makeClient(state);

    const result = await generateBehaviorImplementation(client, 'ZBP_DM_PROJECT');

    expect(result.activation?.success).toBe(false);
    expect(result.activation?.hint).toMatch(/stale.*active|placeholder.*comment/i);
    expect(result.scaffoldChanged).toBe(true);
  });

  it('returns activation failure without hint for unrelated activation errors', async () => {
    const state = defaultState({ activationMode: 'generic_failure' });
    const { client } = makeClient(state);

    const result = await generateBehaviorImplementation(client, 'ZBP_DM_PROJECT');

    expect(result.activation?.success).toBe(false);
    expect(result.activation?.hint).toBeUndefined();
    expect(result.activation?.messages?.some((m) => /Some other compile error/i.test(m))).toBe(true);
  });

  it('rejects empty className', async () => {
    const state = defaultState();
    const { client } = makeClient(state);

    await expect(generateBehaviorImplementation(client, '')).rejects.toBeInstanceOf(AdtSafetyError);
  });

  it('skips writes when scaffold reports no changes but still runs activation (idempotent rerun) — Codex P2a', async () => {
    // A populated-but-inactive class is a realistic rerun/recovery state after
    // earlier manual include writes (Codex review on PR #260). The default
    // contract is "generate + activate" — when activate=true, activation runs
    // even if scaffold has nothing to write.
    //
    // Per ABAP doc ABENABP_HANDLER_CLASS_GLOSRY and SAP demo BP_DEMO_RAP_STRICT,
    // the canonical layout is: CCDEF holds only the SAP placeholder; CCIMP holds
    // both DEFINITION and IMPLEMENTATION blocks of the handler class.
    const state = defaultState({ activationMode: 'success' });
    state.structuredResponse.definitions = PLACEHOLDER_DEFINITIONS;
    state.structuredResponse.implementations = `CLASS lhc_project DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS approve_project FOR MODIFY
      IMPORTING keys FOR ACTION Project~approve_project RESULT result.

    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION
      IMPORTING keys REQUEST requested_authorizations FOR Project RESULT result.
ENDCLASS.

CLASS lhc_project IMPLEMENTATION.
  METHOD approve_project.
  ENDMETHOD.
  METHOD get_instance_authorizations.
  ENDMETHOD.
ENDCLASS.`;
    const { client } = makeClient(state);

    const result = await generateBehaviorImplementation(client, 'ZBP_DM_PROJECT');

    expect(result.scaffoldChanged).toBe(false);
    expect(state.writes.length).toBe(0); // No write
    expect(result.activation?.success).toBe(true); // BUT activation ran
  });

  it('skips writes AND skips activation when activate=false and scaffold reports no changes', async () => {
    const state = defaultState();
    state.structuredResponse.definitions = PLACEHOLDER_DEFINITIONS;
    state.structuredResponse.implementations = `CLASS lhc_project DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS approve_project FOR MODIFY
      IMPORTING keys FOR ACTION Project~approve_project RESULT result.

    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION
      IMPORTING keys REQUEST requested_authorizations FOR Project RESULT result.
ENDCLASS.

CLASS lhc_project IMPLEMENTATION.
  METHOD approve_project.
  ENDMETHOD.
  METHOD get_instance_authorizations.
  ENDMETHOD.
ENDCLASS.`;
    const { client } = makeClient(state);

    const result = await generateBehaviorImplementation(client, 'ZBP_DM_PROJECT', { activate: false });

    expect(result.scaffoldChanged).toBe(false);
    expect(state.writes.length).toBe(0);
    expect(result.activation).toBeUndefined();
  });

  it('writes scaffold to CCIMP only when scaffolding from empty placeholders', async () => {
    // Verifies the ensureRapHandlerSkeletons fix end-to-end at the orchestrator level:
    // writes must hit /source/implementations and never /source/definitions.
    const state = defaultState({ activationMode: 'success' });
    // Default state already has placeholder CCDEF + CCIMP.
    const { client } = makeClient(state);

    const result = await generateBehaviorImplementation(client, 'ZBP_DM_PROJECT');

    expect(result.scaffoldChanged).toBe(true);
    expect(result.activation?.success).toBe(true);

    const writePaths = state.writes.map((w) => w.uri);
    expect(writePaths.some((p) => p.includes('/includes/implementations'))).toBe(true);
    // Critical: NO write to /includes/definitions (CCDEF must stay at the SAP placeholder).
    expect(writePaths.some((p) => p.includes('/includes/definitions'))).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────
// isRapGenerateResultSuccess truth table (Codex review on PR #260, P1).
// The handler in src/handlers/intent.ts delegates to this helper to decide
// whether to surface the orchestrator outcome via textResult or errorResult.
// ──────────────────────────────────────────────────────────────────────

function baseResult(activation?: RapGenerateResult['activation']): RapGenerateResult {
  return {
    discovery: {
      className: 'ZBP_X',
      bdefName: 'ZR_X',
      source: 'rootEntityRef',
      classCategory: 'behaviorPool',
    },
    validation: { mainHasForBehaviorOf: true, bdefBindsClass: true },
    scaffoldChanged: false,
    changedSections: [],
    inserted: { signatures: 0, stubs: 0, autoCreatedSkeletons: 0 },
    required: [],
    dryRun: false,
    ...(activation ? { activation } : {}),
  };
}

describe('isRapGenerateResultSuccess (Codex P1 result-code mapping)', () => {
  it('returns true when no activation block is present (dry-run / activate=false)', () => {
    expect(isRapGenerateResultSuccess(baseResult())).toBe(true);
  });

  it('returns true when activation succeeded', () => {
    expect(isRapGenerateResultSuccess(baseResult({ success: true, messages: [] }))).toBe(true);
  });

  it('returns true when activation failed BUT a recovery hint was attached (soft success)', () => {
    expect(
      isRapGenerateResultSuccess(
        baseResult({ success: false, hint: 'stale-active recovery instructions…', messages: ['…'] }),
      ),
    ).toBe(true);
  });

  it('returns false when activation failed without any hint (real compile error → hard failure)', () => {
    expect(isRapGenerateResultSuccess(baseResult({ success: false, messages: ['Type ZIF_MISSING is unknown.'] }))).toBe(
      false,
    );
  });

  it('returns false when activation failed and hint is empty string (treat empty as "no hint")', () => {
    expect(isRapGenerateResultSuccess(baseResult({ success: false, hint: '', messages: ['…'] }))).toBe(false);
  });
});
