import { describe, expect, it } from 'vitest';
import { formatRapPreflightFindings, validateRapSource } from '../../../src/adt/rap-preflight.js';

describe('validateRapSource', () => {
  it('flags TABL curr fields without currency semantics annotation', () => {
    const source = `define table ztravel_req {
  key client : abap.clnt not null;
  key id     : sysuuid_x16 not null;
  total_cost : abap.curr(15,2);
}`;
    const result = validateRapSource('TABL', source, { systemType: 'onprem', abapRelease: '758' });
    expect(result.blocked).toBe(true);
    expect(result.errors.some((f) => f.ruleId === 'TABL_CURR_REQUIRES_CURRENCY_CODE')).toBe(true);
  });

  it('accepts TABL curr fields when currency semantics annotation exists', () => {
    const source = `define table ztravel_req {
  key client : abap.clnt not null;
  key id     : sysuuid_x16 not null;
  currency_code : abap.cuky;
  @Semantics.amount.currencyCode : 'ztravel_req.currency_code'
  total_cost : abap.curr(15,2);
}`;
    const result = validateRapSource('TABL', source, { systemType: 'onprem', abapRelease: '758' });
    expect(result.errors.some((f) => f.ruleId === 'TABL_CURR_REQUIRES_CURRENCY_CODE')).toBe(false);
  });

  it('flags TABL quan fields without unit semantics annotation', () => {
    const source = `define table ztravel_exp {
  key client : abap.clnt not null;
  key id     : sysuuid_x16 not null;
  qty        : abap.quan(13,3);
}`;
    const result = validateRapSource('TABL', source, { systemType: 'onprem', abapRelease: '758' });
    expect(result.errors.some((f) => f.ruleId === 'TABL_QUAN_REQUIRES_UNIT')).toBe(true);
  });

  it('flags on-prem 7.5x TABL forbidden types', () => {
    const source = `define table ztravel_req {
  key client : abap.clnt not null;
  created_by : abap.uname;
  created_at : abap.utclong;
  receipt_required : abap.boolean;
}`;
    const result = validateRapSource('TABL', source, { systemType: 'onprem', abapRelease: '758' });
    expect(result.errors.some((f) => f.ruleId === 'TABL_FORBIDDEN_ABAP_UNAME')).toBe(true);
    expect(result.errors.some((f) => f.ruleId === 'TABL_FORBIDDEN_ABAP_UTCLONG')).toBe(true);
    expect(result.errors.some((f) => f.ruleId === 'TABL_FORBIDDEN_ABAP_BOOLEAN')).toBe(true);
  });

  it('flags BDEF authorization master (none)', () => {
    const source = `managed implementation in class zbp_i_travel unique;
define behavior for ZI_Travel alias Travel
authorization master ( none )
{
}`;
    const result = validateRapSource('BDEF', source, { systemType: 'onprem', abapRelease: '758' });
    expect(result.blocked).toBe(true);
    expect(result.errors.some((f) => f.ruleId === 'BDEF_INVALID_AUTH_MASTER_NONE')).toBe(true);
  });

  it('flags projection BDEF use etag on on-prem 7.5x', () => {
    const source = `projection;
use etag;
define behavior for ZC_Travel alias Travel
{
  use update;
}`;
    const result = validateRapSource('BDEF', source, { systemType: 'onprem', abapRelease: '758' });
    expect(result.errors.some((f) => f.ruleId === 'BDEF_PROJECTION_USE_ETAG_UNSUPPORTED')).toBe(true);
    expect(result.errors.find((f) => f.ruleId === 'BDEF_PROJECTION_USE_ETAG_UNSUPPORTED')?.line).toBe(2);
  });

  it('does NOT flag per-entity "use etag" in projection BDEF (SAP /DMO/ pattern)', () => {
    // This is the exact pattern used by SAP's shipped /DMO/C_TRAVEL_PROCESSOR_M
    // — `use etag` attached to a `define behavior for X alias Y` block is the
    // supported modern form and MUST NOT be flagged. Earlier versions of the
    // rule matched `use etag` anywhere in the source, producing a false
    // positive on working SAP-delivered code.
    const source = `projection;
strict(2);

define behavior for /DMO/C_Travel_Processor_M alias TravelProcessor
use etag

{
  field ( readonly ) TotalPrice;
  use create;
  use update;
  use delete;
}

define behavior for /DMO/C_Booking_Processor_M alias BookingProcessor
use etag
{
  use update;
}`;
    const result = validateRapSource('BDEF', source, { systemType: 'onprem', abapRelease: '758' });
    expect(result.errors.some((f) => f.ruleId === 'BDEF_PROJECTION_USE_ETAG_UNSUPPORTED')).toBe(false);
  });

  it('adds warning for duplicate etag master names in BDEF', () => {
    const source = `define behavior for ZI_Travel alias Travel
{
  etag master LocalLastChangedAt;
}
define behavior for ZI_TravelItem alias Item
{
  etag master LocalLastChangedAt;
}`;
    const result = validateRapSource('BDEF', source, { systemType: 'onprem', abapRelease: '758' });
    expect(result.warnings.some((f) => f.ruleId === 'BDEF_DUPLICATE_ETAG_MASTER_NAME')).toBe(true);
  });

  for (const abapRelease of [undefined, 'unknown', '750', '752', '754', '758', '759', '816']) {
    it.each(["@UI.headerInfo: { typeName: 'Travel' }", '@Search.searchable: true'])(
      `allows supported DDLX annotation %s with release ${abapRelease}`,
      (annotation) => {
        const source = `@Metadata.layer: #CUSTOMER\n${annotation}\nannotate view ZC_Travel with {\n@UI.lineItem: [{ position: 10 }]\ntravel_id;\n}`;
        const result = validateRapSource('DDLX', source, { systemType: 'onprem', abapRelease });
        expect(result.blocked).toBe(false);
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
      },
    );
  }

  it.each(["@ObjectModel.semanticKey: ['travel_id']", "@ObjectModel.text.element: ['description']"])(
    'retains the on-prem ObjectModel scope guard for %s',
    (annotation) => {
      const result = validateRapSource('DDLX', `${annotation}\nannotate view ZC_Travel with {}`, {
        systemType: 'onprem',
        abapRelease: '758',
      });
      expect(result.blocked).toBe(true);
      expect(result.errors.some((f) => f.ruleId === 'DDLX_ANNOTATION_SCOPE_ONPREM_75X')).toBe(true);
    },
  );

  it('detects duplicate DDLX UI annotations for the same field', () => {
    const source = `annotate view ZC_Travel with {
  @UI.lineItem: [{ position: 10 }]
  travel_id;

  @UI.lineItem: [{ position: 20 }]
  travel_id;
}`;
    const result = validateRapSource('DDLX', source, { systemType: 'onprem', abapRelease: '758' });
    expect(result.errors.some((f) => f.ruleId === 'DDLX_DUPLICATE_UI_ANNOTATION')).toBe(true);
  });

  it('adds DDLS client-field warning', () => {
    const source = `define view entity ZI_Test as select from ztab {
  key client,
  key id
}`;
    const result = validateRapSource('DDLS', source, { systemType: 'onprem', abapRelease: '758' });
    expect(result.warnings.some((f) => f.ruleId === 'DDLS_CLIENT_FIELD_IN_SELECT_LIST')).toBe(true);
  });

  it('does not enforce on-prem-only DDLX scope checks on BTP', () => {
    const source = `@UI.headerInfo: { typeName: 'Travel' }
annotate view ZC_Travel with {
  travel_id;
}`;
    const result = validateRapSource('DDLX', source, { systemType: 'btp', abapRelease: 'cloud' });
    expect(result.errors.some((f) => f.ruleId === 'DDLX_ANNOTATION_SCOPE_ONPREM_75X')).toBe(false);
  });
});

describe('formatRapPreflightFindings', () => {
  it('formats finding entries with rule id, line and suggestion', () => {
    const formatted = formatRapPreflightFindings([
      {
        severity: 'error',
        ruleId: 'TABL_CURR_REQUIRES_CURRENCY_CODE',
        message: 'Missing currency annotation',
        line: 12,
        suggestion: 'Add @Semantics.amount.currencyCode',
      },
    ]);
    expect(formatted).toContain('[TABL_CURR_REQUIRES_CURRENCY_CODE]');
    expect(formatted).toContain('line 12');
    expect(formatted).toContain('Suggestion: Add @Semantics.amount.currencyCode');
  });
});
