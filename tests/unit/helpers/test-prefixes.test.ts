import { describe, expect, it } from 'vitest';
import { PERSISTENT_FIXTURE_NAMES, type SweepableObject, selectSweepCandidates } from '../../helpers/test-prefixes.js';

function hit(objectName: string, objectType = 'PROG/P'): SweepableObject {
  return {
    objectName,
    objectType,
    uri: `/sap/bc/adt/programs/programs/${objectName.toLowerCase()}`,
    packageName: '$TMP',
  };
}

describe('selectSweepCandidates', () => {
  it('keeps strict-prefix matches and drops substring-only matches', () => {
    const out = selectSweepCandidates([hit('ZARC1_ACT0AB'), hit('YZARC1_NOPE'), hit('ZARC360D_X')]);
    expect(out.map((c) => c.name).sort()).toEqual(['ZARC1_ACT0AB', 'ZARC360D_X']);
  });

  it('never sweeps persistent fixtures', () => {
    const fixture = PERSISTENT_FIXTURE_NAMES[0]; // e.g. ZARC1_TEST_REPORT — matches ZARC1 prefix
    const out = selectSweepCandidates([hit(fixture), hit('ZARC1_LEFTOVER')]);
    expect(out.map((c) => c.name)).toEqual(['ZARC1_LEFTOVER']);
  });

  it('strips NW 7.50 name decoration before excluding fixtures and matching prefixes', () => {
    const decoratedFixture: SweepableObject = {
      objectName: `${PERSISTENT_FIXTURE_NAMES[2]} (Interface)`, // ZIF_ARC1_TEST (Interface)
      objectType: 'INTF/OI',
      uri: '/sap/bc/adt/oo/interfaces/zif_arc1_test',
      packageName: '$TMP',
    };
    const decoratedLeftover: SweepableObject = {
      objectName: 'ZCL_ARC1_E303A (Class)',
      objectType: 'CLAS/OC',
      uri: '/sap/bc/adt/oo/classes/zcl_arc1_e303a',
      packageName: '$TMP',
    };
    const out = selectSweepCandidates([decoratedFixture, decoratedLeftover]);
    // The decorated fixture is still excluded; the decorated leftover is matched on its bare name.
    expect(out.map((c) => c.name)).toEqual(['ZCL_ARC1_E303A']);
  });

  it('deduplicates by type + name', () => {
    expect(selectSweepCandidates([hit('ZARC1_DUP'), hit('ZARC1_DUP')])).toHaveLength(1);
  });

  it('treats the same name under different types as distinct', () => {
    const out = selectSweepCandidates([hit('ZARC1_X', 'PROG/P'), hit('ZARC1_X', 'CLAS/OC')]);
    expect(out).toHaveLength(2);
  });

  it('ignores hits without a name or uri', () => {
    const out = selectSweepCandidates([
      { objectName: '', objectType: 'PROG/P', uri: '/x', packageName: '$TMP' },
      { objectName: 'ZARC1_NOURI', objectType: 'PROG/P', uri: '', packageName: '$TMP' },
    ]);
    expect(out).toHaveLength(0);
  });

  it('matches case-insensitively', () => {
    expect(selectSweepCandidates([hit('zarc1_lower')]).map((c) => c.name)).toEqual(['ZARC1_LOWER']);
  });
});
