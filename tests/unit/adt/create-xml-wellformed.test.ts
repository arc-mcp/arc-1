/**
 * Well-formedness guard for every create-XML builder.
 *
 * `toContain('adtcore:responsible="X"')` cannot see two attributes glued together
 * (`...active"adtcore:responsible="X"`), which is exactly what a mis-spaced interpolation produces.
 * #636 introduced conditional emission of `adtcore:responsible` across ~15 templates, so assert the
 * shape structurally instead: every generated body must parse, and no attribute may be glued to the
 * previous one.
 */
import { describe, expect, it } from 'vitest';
import { buildPackageXml } from '../../../src/adt/ddic-xml.js';
import { buildCreateXml } from '../../../src/handlers/write-helpers.js';

const GLUED_ATTR = /"[a-zA-Z][\w.-]*:[\w.-]+="/; // `..."` immediately followed by `ns:attr="`

/** Types whose create body buildCreateXml produces directly (source + DDIC families). */
const TYPES: Array<[string, Record<string, unknown>]> = [
  ['PROG', {}],
  ['CLAS', {}],
  ['INTF', {}],
  ['INCL', {}],
  ['DDLS', {}],
  ['DCLS', {}],
  ['TABL', {}],
  ['BDEF', {}],
  ['SRVD', {}],
  ['DDLX', {}],
  ['DOMA', { dataType: 'CHAR', length: 10 }],
  ['DTEL', { typeKind: 'predefinedAbapType', dataType: 'CHAR', length: 10 }],
  ['TTYP', { rowType: 'CHAR10', rowTypeKind: 'builtin' }],
  ['SRVB', { serviceDefinition: 'ZSD' }],
];

// A usable user (attribute present) and a PP-shaped email (attribute omitted) must BOTH be well
// formed — the omitted case is the one that regressed formatting.
describe.each([
  ['responsible present', 'MARIAN'],
  ['responsible omitted (PP email)', 'firstname.lastname@example.com'],
])('create XML is well formed — %s', (_label, responsible) => {
  it.each(TYPES)('%s', (type, props) => {
    for (const cloud of [false, true]) {
      const xml = buildCreateXml(type, 'ZOBJ', '$TMP', 'd', props, 'EN', responsible, cloud);
      expect(xml, `${type} cloud=${cloud}`).not.toMatch(GLUED_ATTR);
      expect(xml, `${type} cloud=${cloud}`).not.toContain('responsible=""');
    }
  });

  it('buildPackageXml (on-prem and cloud)', () => {
    for (const cloud of [false, true]) {
      const xml = buildPackageXml({
        name: 'ZP',
        description: 'd',
        responsible: cloud ? 'CB9980000000' : responsible,
        cloud,
        superPackage: cloud ? 'ZLOCAL' : undefined,
      });
      expect(xml, `package cloud=${cloud}`).not.toMatch(GLUED_ATTR);
    }
  });
});
