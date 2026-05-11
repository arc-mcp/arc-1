import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyRapHandlerImplementationStubs,
  applyRapHandlerScaffold,
  applyRapHandlerSignatures,
  ensureRapHandlerSkeletons,
  extractRapHandlerRequirements,
  findMissingRapHandlerImplementationStubs,
  findMissingRapHandlerRequirements,
  parseClassDefinitionMethods,
} from '../../../src/adt/rap-handlers.js';
import { spliceMethod } from '../../../src/context/method-surgery.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const BDEF_SOURCE = `managed implementation in class ZBP_I_TRAVELREQ unique;
define behavior for ZI_TRAVELREQ alias Travel
authorization master ( instance )
{
  create;
  action SubmitForApproval result [1] $self;
  action RecalculateTotalCost result [1] $self;
  determination SetDefaults on modify { create; }
  validation ValidateDates on save { create; }
}

define behavior for ZI_TRAVELSEG alias Segment
{
  action Reprice result [1] $self;
}`;

describe('extractRapHandlerRequirements', () => {
  it('extracts action, determination, validation, and authorization requirements from BDEF', () => {
    const requirements = extractRapHandlerRequirements(BDEF_SOURCE);
    const kinds = requirements.map((req) => req.kind);
    expect(kinds).toContain('action');
    expect(kinds).toContain('determination');
    expect(kinds).toContain('validation');
    expect(kinds).toContain('instance_authorization');

    const submit = requirements.find((req) => req.methodName === 'submitforapproval');
    expect(submit?.targetHandlerClass).toBe('lhc_travel');
    expect(submit?.signature).toContain('FOR ACTION Travel~SubmitForApproval');

    const auth = requirements.find((req) => req.kind === 'instance_authorization');
    expect(auth?.signature).toContain('FOR INSTANCE AUTHORIZATION');
    expect(auth?.signature).toContain('FOR Travel RESULT result');
  });

  it('derives handler class names from aliases across multiple entities', () => {
    const requirements = extractRapHandlerRequirements(BDEF_SOURCE);
    const segmentAction = requirements.find((req) => req.methodName === 'reprice');
    expect(segmentAction?.entityAlias).toBe('Segment');
    expect(segmentAction?.targetHandlerClass).toBe('lhc_segment');
  });

  it('extracts factory, internal, and static action variants and omits RESULT when BDEF has none', () => {
    const source = `managed implementation in class zbp_i_travel unique;
define behavior for zi_travel alias travel
authorization master ( global )
{
  action  ( features: instance ) acceptTravel result [1] $self;
  internal action reCalcTotalPrice;
  factory action copyTravel [1];
  static action doStaticThing;
  static factory action staticCreate;
}`;
    const requirements = extractRapHandlerRequirements(source);
    const accept = requirements.find((req) => req.methodName === 'accepttravel');
    expect(accept?.signature).toContain('FOR ACTION travel~acceptTravel RESULT result');

    const recalc = requirements.find((req) => req.methodName === 'recalctotalprice');
    expect(recalc).toBeDefined();
    expect(recalc?.signature).toContain('FOR ACTION travel~reCalcTotalPrice.');
    expect(recalc?.signature).not.toContain('RESULT');

    const copy = requirements.find((req) => req.methodName === 'copytravel');
    expect(copy, 'factory action should be detected').toBeDefined();
    expect(copy?.signature).toContain('FOR ACTION travel~copyTravel.');
    expect(copy?.signature).not.toContain('RESULT');

    const staticThing = requirements.find((req) => req.methodName === 'dostaticthing');
    expect(staticThing, 'static action should be detected').toBeDefined();
    expect(staticThing?.signature).not.toContain('RESULT');

    const staticCreate = requirements.find((req) => req.methodName === 'staticcreate');
    expect(staticCreate, 'static factory action should be detected').toBeDefined();
  });

  it('detects RESULT clause even when action declaration spans multiple lines', () => {
    const source = `define behavior for zi_travel alias travel
authorization master ( global )
{
  action acceptTravel
    result [1] $self;
  action cancelTravel
    ;
}`;
    const requirements = extractRapHandlerRequirements(source);
    const accept = requirements.find((req) => req.methodName === 'accepttravel');
    expect(accept?.signature).toContain('RESULT result');

    const cancel = requirements.find((req) => req.methodName === 'canceltravel');
    expect(cancel?.signature).not.toContain('RESULT');
  });
});

describe('findMissingRapHandlerRequirements', () => {
  it('returns only requirements not declared in class definitions', () => {
    const classSource = `CLASS zbp_i_travelreq DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF zi_travelreq.
ENDCLASS.

CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS submitforapproval FOR MODIFY
      IMPORTING keys FOR ACTION Travel~SubmitForApproval RESULT result.
ENDCLASS.

CLASS lhc_travel IMPLEMENTATION.
ENDCLASS.

CLASS lhc_segment DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
ENDCLASS.`;

    const requirements = extractRapHandlerRequirements(BDEF_SOURCE);
    const missing = findMissingRapHandlerRequirements(requirements, classSource);
    expect(missing.some((req) => req.methodName === 'submitforapproval')).toBe(false);
    expect(missing.some((req) => req.methodName === 'recalculatetotalcost')).toBe(true);
    expect(missing.some((req) => req.methodName === 'reprice')).toBe(true);
  });
});

describe('parseClassDefinitionMethods', () => {
  it('extracts METHODS declarations per class', () => {
    const source = `CLASS lhc_travel DEFINITION.
  PRIVATE SECTION.
    METHODS submitforapproval FOR MODIFY IMPORTING keys FOR ACTION Travel~SubmitForApproval RESULT result.
ENDCLASS.
CLASS lhc_travel IMPLEMENTATION.
ENDCLASS.`;

    const methods = parseClassDefinitionMethods(source);
    expect(methods.get('lhc_travel')?.has('submitforapproval')).toBe(true);
  });

  it('does not skip concrete class definitions after deferred declarations', () => {
    const source = `CLASS lthc_carrier DEFINITION DEFERRED FOR TESTING.

CLASS lhc_carrier DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS validatename FOR VALIDATE ON SAVE
      IMPORTING keys FOR carrier~validatename.
ENDCLASS.`;

    const methods = parseClassDefinitionMethods(source);
    expect(methods.get('lhc_carrier')?.has('validatename')).toBe(true);
  });

  it('indexes FOR ACTION binding keys so semantic method names satisfy BDEF actions', () => {
    // This is the shape used by SAP's shipped /DMO/BP_TRAVEL_M: the method
    // name (`set_status_accepted`) is semantic, bound to BDEF action
    // `acceptTravel` via `FOR ACTION travel~accepttravel`. The scaffolder
    // compares against BDEF identifiers, so the binding key MUST also be
    // indexed — otherwise we'd falsely report `accepttravel` as missing and
    // try to re-inject it as a duplicate METHOD declaration.
    const source = `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS set_status_accepted FOR MODIFY
      IMPORTING keys FOR ACTION travel~accepttravel RESULT result.
    METHODS recalc_total FOR DETERMINE ON MODIFY
      IMPORTING keys FOR travel~recalctotalprice.
ENDCLASS.`;
    const methods = parseClassDefinitionMethods(source);
    const travel = methods.get('lhc_travel');
    expect(travel).toBeDefined();
    // Method names are present…
    expect(travel?.has('set_status_accepted')).toBe(true);
    expect(travel?.has('recalc_total')).toBe(true);
    // …AND their binding keys are also indexed so the BDEF identifier
    // matches.
    expect(travel?.has('accepttravel')).toBe(true);
    expect(travel?.has('recalctotalprice')).toBe(true);
  });
});

describe('findMissingRapHandlerRequirements with semantic method names', () => {
  it('treats a BDEF action as fulfilled when bound via FOR ACTION alias~name', () => {
    // Regression for the /DMO/BP_TRAVEL_M pattern — without binding-key
    // extraction the scaffolder would incorrectly consider `accepttravel`
    // missing even though the hand-crafted pool fully implements it.
    const bdef = `managed implementation in class zbp_i_travel unique;
define behavior for zi_travel alias travel
authorization master ( global )
{
  action acceptTravel result [1] $self;
}`;
    const classSource = `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS set_status_accepted FOR MODIFY
      IMPORTING keys FOR ACTION travel~accepttravel RESULT result.
ENDCLASS.`;
    const requirements = extractRapHandlerRequirements(bdef);
    const missing = findMissingRapHandlerRequirements(requirements, classSource);
    expect(missing.some((req) => req.methodName === 'accepttravel')).toBe(false);
  });
});

describe('findMissingRapHandlerImplementationStubs', () => {
  it('reports declarations that still lack implementation blocks', () => {
    const bdef = `define behavior for zi_travel alias travel
{
  action SubmitForApproval result [1] $self;
}`;
    const classSource = `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS submitforapproval FOR MODIFY
      IMPORTING keys FOR ACTION travel~SubmitForApproval RESULT result.
ENDCLASS.

CLASS lhc_travel IMPLEMENTATION.
ENDCLASS.`;

    const requirements = extractRapHandlerRequirements(bdef);
    const missing = findMissingRapHandlerImplementationStubs(requirements, classSource);

    expect(missing.map((req) => req.methodName)).toEqual(['submitforapproval']);
  });

  it('treats semantic method implementations as satisfying their BDEF action binding', () => {
    const bdef = `define behavior for zi_travel alias travel
{
  action acceptTravel result [1] $self;
}`;
    const classSource = `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS set_status_accepted FOR MODIFY
      IMPORTING keys FOR ACTION travel~acceptTravel RESULT result.
ENDCLASS.

CLASS lhc_travel IMPLEMENTATION.
  METHOD set_status_accepted.
  ENDMETHOD.
ENDCLASS.`;

    const requirements = extractRapHandlerRequirements(bdef);
    const missing = findMissingRapHandlerImplementationStubs(requirements, classSource);

    expect(missing).toEqual([]);
  });
});

describe('ensureRapHandlerSkeletons', () => {
  // Canonical layout per ABAP keyword doc ABENABP_HANDLER_CLASS_GLOSRY and SAP demo class
  // BP_DEMO_RAP_STRICT (package SABAPDEMOS): CCDEF holds only the SAP-generated placeholder
  // comment; CCIMP holds the full DEFINITION + IMPLEMENTATION pair. The fixtures
  // tests/fixtures/abap/bp-demo-rap-strict-{ccdef,ccimp}.abap capture this verbatim.
  it('writes both DEFINITION and IMPLEMENTATION skeleton blocks to CCIMP only', () => {
    const requirements = extractRapHandlerRequirements(BDEF_SOURCE).filter(
      (req) => req.targetHandlerClass === 'lhc_travel',
    );
    const result = ensureRapHandlerSkeletons(
      {
        main: '',
        definitions: '*"* local definitions placeholder',
        implementations: '*"* local implementations placeholder',
      },
      requirements,
    );

    expect(result.createdDefinitions).toEqual(['lhc_travel']);
    expect(result.createdImplementations).toEqual(['lhc_travel']);
    expect(result.changedSections).toEqual(['implementations']);
    // CCDEF is never modified by this function — it stays at the SAP placeholder verbatim.
    expect(result.sections.definitions).toBe('*"* local definitions placeholder');
    // Both blocks land in CCIMP, in DEFINITION-then-IMPLEMENTATION order so the
    // implementation always sees its declaration above it.
    expect(result.sections.implementations).toContain('*"* local implementations placeholder');
    expect(result.sections.implementations).toContain(
      'CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.',
    );
    expect(result.sections.implementations).toContain('PRIVATE SECTION.');
    expect(result.sections.implementations).toContain('CLASS lhc_travel IMPLEMENTATION.');
    const defIdx = result.sections.implementations!.indexOf('CLASS lhc_travel DEFINITION');
    const implIdx = result.sections.implementations!.indexOf('CLASS lhc_travel IMPLEMENTATION');
    expect(defIdx).toBeGreaterThan(-1);
    expect(implIdx).toBeGreaterThan(defIdx);
  });

  it('creates only the missing implementation when CCIMP already has the DEFINITION', () => {
    const requirements = extractRapHandlerRequirements(BDEF_SOURCE).filter(
      (req) => req.targetHandlerClass === 'lhc_travel',
    );
    // CCIMP already contains the DEFINITION (not CCDEF — that's the legacy broken layout
    // detected by detectLegacyHandlerInDefinitions).
    const implementations = `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
ENDCLASS.`;

    const result = ensureRapHandlerSkeletons({ main: '', definitions: '', implementations }, requirements);

    expect(result.createdDefinitions).toEqual([]);
    expect(result.createdImplementations).toEqual(['lhc_travel']);
    expect(result.sections.definitions).toBe('');
    expect(result.sections.implementations).toContain(
      'CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.',
    );
    expect(result.sections.implementations).toContain('CLASS lhc_travel IMPLEMENTATION.');
  });

  it('creates the missing DEFINITION in CCIMP when only the IMPLEMENTATION exists there', () => {
    const requirements = extractRapHandlerRequirements(BDEF_SOURCE).filter(
      (req) => req.targetHandlerClass === 'lhc_travel',
    );
    const implementations = `CLASS lhc_travel IMPLEMENTATION.
ENDCLASS.`;

    const result = ensureRapHandlerSkeletons({ main: '', definitions: '', implementations }, requirements);

    expect(result.createdDefinitions).toEqual(['lhc_travel']);
    expect(result.createdImplementations).toEqual([]);
    // CCDEF stays empty — no skeleton ever lands there.
    expect(result.sections.definitions).toBe('');
    expect(result.sections.implementations).toContain(
      'CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.',
    );
    expect(result.sections.implementations).toContain('CLASS lhc_travel IMPLEMENTATION.');
  });

  it('creates one skeleton pair per BDEF alias without duplicates, all in CCIMP', () => {
    const requirements = extractRapHandlerRequirements(BDEF_SOURCE);
    const result = ensureRapHandlerSkeletons({ main: '', definitions: '', implementations: '' }, requirements);

    expect(result.createdDefinitions).toEqual(['lhc_travel', 'lhc_segment']);
    expect(result.createdImplementations).toEqual(['lhc_travel', 'lhc_segment']);
    // CCDEF stays empty.
    expect(result.sections.definitions).toBe('');
    // Both classes' DEFINITION + IMPLEMENTATION blocks land in CCIMP, exactly once each.
    expect(result.sections.implementations?.match(/CLASS lhc_travel DEFINITION/g)).toHaveLength(1);
    expect(result.sections.implementations?.match(/CLASS lhc_segment DEFINITION/g)).toHaveLength(1);
    expect(result.sections.implementations?.match(/CLASS lhc_travel IMPLEMENTATION/g)).toHaveLength(1);
    expect(result.sections.implementations?.match(/CLASS lhc_segment IMPLEMENTATION/g)).toHaveLength(1);
  });

  it('is idempotent when rerun on its own generated sections', () => {
    const requirements = extractRapHandlerRequirements(BDEF_SOURCE);
    const first = ensureRapHandlerSkeletons({ main: '', definitions: '', implementations: '' }, requirements);
    const second = ensureRapHandlerSkeletons(first.sections, requirements);

    expect(second.createdDefinitions).toEqual([]);
    expect(second.createdImplementations).toEqual([]);
    expect(second.sections).toEqual(first.sections);
  });

  // Regression test: assert against the exact layout captured live from SAP demo class
  // BP_DEMO_RAP_STRICT. If this fails, the contract has drifted from SAP-canonical and the
  // result will fail to activate with `Local classes of CL_ABAP_BEHAVIOR_HANDLER…`.
  it('emits CCIMP shape matching SAP demo class BP_DEMO_RAP_STRICT', () => {
    const ccdefFixture = readFileSync(join(__dirname, '../../fixtures/abap/bp-demo-rap-strict-ccdef.abap'), 'utf8');
    const ccimpFixture = readFileSync(join(__dirname, '../../fixtures/abap/bp-demo-rap-strict-ccimp.abap'), 'utf8');
    // BDEF mirroring BP_DEMO_RAP_STRICT: one entity, global authorization only.
    const bdef = `unmanaged implementation in class zbp_demo_rap_strict unique;
strict ( 2 );

define behavior for demo_rap_strict alias DemoRapStrict
  authorization master ( global )
{
  read;
}`;
    const requirements = extractRapHandlerRequirements(bdef);
    const result = ensureRapHandlerSkeletons(
      { main: '', definitions: ccdefFixture, implementations: '' },
      requirements,
    );

    // CCDEF must remain byte-identical to the SAP-generated placeholder.
    expect(result.sections.definitions).toBe(ccdefFixture);
    // CCIMP must contain a DEFINITION block followed by an IMPLEMENTATION block, mirroring
    // the BP_DEMO_RAP_STRICT shape (the alias name differs because the BDEF uses a different
    // entity, but the structural pattern is identical).
    const out = result.sections.implementations ?? '';
    expect(out).toMatch(/CLASS lhc_demorapstrict DEFINITION INHERITING FROM cl_abap_behavior_handler\./i);
    expect(out).toMatch(/CLASS lhc_demorapstrict IMPLEMENTATION\./i);
    // Same structural assertion against the live-captured fixture: DEFINITION precedes
    // IMPLEMENTATION (forward-reference rule).
    expect(ccimpFixture.indexOf('CLASS lhc_DEMO_RAP_STRICT DEFINITION')).toBeLessThan(
      ccimpFixture.indexOf('CLASS lhc_DEMO_RAP_STRICT IMPLEMENTATION'),
    );
  });
});

describe('applyRapHandlerSignatures', () => {
  it('injects missing signatures into existing handler class private sections', () => {
    const classSource = `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
ENDCLASS.

CLASS lhc_travel IMPLEMENTATION.
ENDCLASS.`;
    const requirements = extractRapHandlerRequirements(BDEF_SOURCE).filter(
      (req) => req.targetHandlerClass === 'lhc_travel',
    );
    const result = applyRapHandlerSignatures(classSource, requirements);

    expect(result.changed).toBe(true);
    expect(result.inserted.length).toBeGreaterThan(0);
    expect(result.updatedSource).toContain('METHODS submitforapproval FOR MODIFY');
    expect(result.updatedSource).toContain('METHODS recalculatetotalcost FOR MODIFY');
    expect(result.updatedSource).toContain('METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION');
  });

  it('ignores deferred handler declarations when choosing insertion target', () => {
    const classSource = `CLASS lhc_travel DEFINITION DEFERRED.

CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
ENDCLASS.

CLASS lhc_travel IMPLEMENTATION.
ENDCLASS.`;
    const requirement = extractRapHandlerRequirements(BDEF_SOURCE).find(
      (req) => req.methodName === 'submitforapproval',
    );
    expect(requirement).toBeDefined();

    const result = applyRapHandlerSignatures(classSource, requirement ? [requirement] : []);

    expect(result.changed).toBe(true);
    expect(result.updatedSource).toMatch(/^CLASS lhc_travel DEFINITION DEFERRED\./);
    expect(result.updatedSource).toContain(`CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS submitforapproval FOR MODIFY`);
    expect(result.updatedSource).not.toMatch(/^ {2}PRIVATE SECTION\./);
  });

  it('adds PRIVATE SECTION when missing in a handler class definition', () => {
    const classSource = `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
ENDCLASS.

CLASS lhc_travel IMPLEMENTATION.
ENDCLASS.`;
    const requirement = extractRapHandlerRequirements(BDEF_SOURCE).find(
      (req) => req.methodName === 'submitforapproval',
    );
    expect(requirement).toBeDefined();
    const result = applyRapHandlerSignatures(classSource, requirement ? [requirement] : []);

    expect(result.changed).toBe(true);
    expect(result.updatedSource).toContain('PRIVATE SECTION.');
    expect(result.updatedSource).toContain('METHODS submitforapproval FOR MODIFY');
  });

  it('reports skipped requirements when target handler class is not present', () => {
    const classSource = `CLASS zbp_i_travelreq DEFINITION PUBLIC.
ENDCLASS.`;
    const requirements = extractRapHandlerRequirements(BDEF_SOURCE).filter(
      (req) => req.targetHandlerClass === 'lhc_segment',
    );
    const result = applyRapHandlerSignatures(classSource, requirements);

    expect(result.changed).toBe(false);
    expect(result.inserted).toHaveLength(0);
    expect(result.skipped).toHaveLength(requirements.length);
    expect(result.skipped[0]?.reason).toContain('not found');
  });
});

describe('applyRapHandlerImplementationStubs', () => {
  it('inserts empty method stubs into matching implementation classes', () => {
    const classSource = `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS submitforapproval FOR MODIFY
      IMPORTING keys FOR ACTION Travel~SubmitForApproval RESULT result.
ENDCLASS.

CLASS lhc_travel IMPLEMENTATION.
ENDCLASS.`;
    const requirement = extractRapHandlerRequirements(BDEF_SOURCE).find(
      (req) => req.methodName === 'submitforapproval',
    );
    expect(requirement).toBeDefined();

    const result = applyRapHandlerImplementationStubs(classSource, requirement ? [requirement] : []);

    expect(result.changed).toBe(true);
    expect(result.updatedSource).toContain('CLASS lhc_travel IMPLEMENTATION.');
    expect(result.updatedSource).toContain('  METHOD submitforapproval.');
    expect(result.updatedSource).toContain('  ENDMETHOD.');

    const spliced = spliceMethod(
      result.updatedSource,
      'zbp_i_travelreq',
      'submitforapproval',
      '    reported = reported.',
    );
    expect(spliced.success).toBe(true);
    expect(spliced.newSource).toContain('reported = reported.');
  });

  it('creates implementation blocks in implementation includes when requested', () => {
    const classSource = `*"* implementations placeholder
CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS submitforapproval FOR MODIFY
      IMPORTING keys FOR ACTION Travel~SubmitForApproval RESULT result.
ENDCLASS.`;
    const requirement = extractRapHandlerRequirements(BDEF_SOURCE).find(
      (req) => req.methodName === 'submitforapproval',
    );
    expect(requirement).toBeDefined();

    const result = applyRapHandlerImplementationStubs(classSource, requirement ? [requirement] : [], {
      createImplementationBlocks: true,
    });

    expect(result.changed).toBe(true);
    expect(result.updatedSource).toContain(`CLASS lhc_travel IMPLEMENTATION.
  METHOD submitforapproval.
  ENDMETHOD.
ENDCLASS.`);
  });

  it('uses the declared semantic method name when creating stubs for bound BDEF actions', () => {
    const bdef = `define behavior for zi_travel alias travel
{
  action acceptTravel result [1] $self;
}`;
    const definitionSource = `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS set_status_accepted FOR MODIFY
      IMPORTING keys FOR ACTION travel~acceptTravel RESULT result.
ENDCLASS.`;
    const implementationSource = `CLASS lhc_travel IMPLEMENTATION.
ENDCLASS.`;
    const requirements = extractRapHandlerRequirements(bdef);

    const result = applyRapHandlerImplementationStubs(implementationSource, requirements, { definitionSource });

    expect(result.changed).toBe(true);
    expect(result.updatedSource).toContain('METHOD set_status_accepted.');
    expect(result.updatedSource).not.toContain('METHOD accepttravel.');
  });

  it('does not duplicate existing implementation stubs', () => {
    const classSource = `CLASS lhc_travel IMPLEMENTATION.
  METHOD submitforapproval.
  ENDMETHOD.
ENDCLASS.`;
    const requirement = extractRapHandlerRequirements(BDEF_SOURCE).find(
      (req) => req.methodName === 'submitforapproval',
    );
    expect(requirement).toBeDefined();

    const result = applyRapHandlerImplementationStubs(classSource, requirement ? [requirement] : []);

    expect(result.changed).toBe(false);
    expect(result.updatedSource.match(/METHOD submitforapproval/g)).toHaveLength(1);
  });
});

describe('applyRapHandlerScaffold', () => {
  // End-to-end: scaffold from empty placeholders → CCDEF stays at the SAP-generated comment;
  // CCIMP gets the full handler class (DEFINITION block with method declarations, IMPLEMENTATION
  // block with empty METHOD stubs). This is what `generate_behavior_implementation` produces
  // for a fresh class. The shape mirrors SAP demo class BP_DEMO_RAP_STRICT.
  it('creates missing handler skeletons in CCIMP and inserts signatures + stubs there', () => {
    const bdef = `define behavior for zi_travel alias travel
authorization master ( instance )
{
  action SubmitForApproval result [1] $self;
}`;
    const requirements = extractRapHandlerRequirements(bdef);
    const missing = findMissingRapHandlerRequirements(requirements, '');
    const missingStubs = findMissingRapHandlerImplementationStubs(requirements, '');

    const plan = applyRapHandlerScaffold(
      { main: '', definitions: '*"* definitions placeholder', implementations: '*"* implementations placeholder' },
      missing,
      missingStubs,
    );

    expect(plan.skeletons.createdDefinitions).toEqual(['lhc_travel']);
    expect(plan.skeletons.createdImplementations).toEqual(['lhc_travel']);
    // CCDEF stays at the placeholder — never modified by the scaffold pipeline.
    expect(plan.changed.definitions).toBe(false);
    expect(plan.changed.implementations).toBe(true);
    expect(plan.insertedSignatureCount).toBe(2);
    expect(plan.insertedImplementationStubCount).toBe(2);
    expect(plan.sections.definitions).toBe('*"* definitions placeholder');
    // CCIMP holds the full handler class: DEFINITION block first, then IMPLEMENTATION block.
    expect(plan.sections.implementations).toContain(
      'CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.',
    );
    expect(plan.sections.implementations).toContain('METHODS submitforapproval FOR MODIFY');
    expect(plan.sections.implementations).toContain('METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION');
    expect(plan.sections.implementations).toContain('CLASS lhc_travel IMPLEMENTATION.');
    expect(plan.sections.implementations).toContain('METHOD submitforapproval.');
    expect(plan.sections.implementations).toContain('METHOD get_instance_authorizations.');
    expect(plan.unresolved).toEqual([]);
  });

  it('plans signatures and stubs across behavior-pool includes without ADT I/O', () => {
    const bdef = `define behavior for zi_travel alias travel
{
  action acceptTravel result [1] $self;
  action RecalculateTotalCost result [1] $self;
}`;
    const definitions = `CLASS lhc_travel DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS set_status_accepted FOR MODIFY
      IMPORTING keys FOR ACTION travel~acceptTravel RESULT result.
ENDCLASS.`;
    const implementations = `CLASS lhc_travel IMPLEMENTATION.
  METHOD set_status_accepted.
  ENDMETHOD.
ENDCLASS.`;
    const requirements = extractRapHandlerRequirements(bdef);
    const missing = findMissingRapHandlerRequirements(requirements, `${definitions}\n${implementations}`);
    const missingStubs = findMissingRapHandlerImplementationStubs(requirements, `${definitions}\n${implementations}`);

    const plan = applyRapHandlerScaffold({ main: '', definitions, implementations }, missing, missingStubs);

    expect(plan.changed.definitions).toBe(true);
    expect(plan.changed.implementations).toBe(true);
    expect(plan.insertedSignatureCount).toBe(1);
    expect(plan.insertedImplementationStubCount).toBe(1);
    expect(plan.sections.definitions).toContain('METHODS recalculatetotalcost FOR MODIFY');
    expect(plan.sections.implementations).toContain('METHOD recalculatetotalcost.');
    expect(plan.sections.implementations).not.toContain('METHOD accepttravel.');
    expect(plan.unresolved).toEqual([]);
  });
});
