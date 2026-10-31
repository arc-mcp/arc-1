import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ddicEnhancementLink, parseDdicAppendElements } from '../../../src/adt/ddic-extensions.js';
import { parseEmbeddedStructures } from '../../../src/adt/embedded-structures.js';

const fixtures = JSON.parse(
  readFileSync(new URL('../../fixtures/extensions/ddic.json', import.meta.url), 'utf8'),
) as Record<string, { body: string }>;
const body = (key: string) => fixtures[key]!.body;

describe('live DDIC evidence replay (750 and 758)', () => {
  it.each([
    ['a4h/dsh_meal-enhancement-elements', 'tables'],
    ['npl/dsh_meal-old-enhancements', 'structures'],
  ])('retains the DSH_MEAL append from %s', (key, collection) => {
    const nodes = parseDdicAppendElements(body(key), `/sap/bc/adt/ddic/${collection}/dsh_meal`, 'DSH_MEAL');
    expect(nodes).toMatchObject([{ name: 'DSH_S_MEAL_APPEND', version: 'provider_current', applicability: 'unknown' }]);
  });
  it('finds the structure append and preserves every repeated include occurrence/suffix', () => {
    expect(
      parseDdicAppendElements(
        body('npl/ddtest_stru_include-enhancements'),
        '/sap/bc/adt/ddic/structures/ddtest_stru_include',
        'DDTEST_STRU_INCLUDE',
      )[0]?.name,
    ).toBe('DDTEST_APPEND_ACTIVE');
    expect(parseEmbeddedStructures(body('a4h/ddtest_stru_include-base'))).toEqual([
      { name: 'DDTEST_STRU_CHAR', kind: 'include', attribute: null, suffix: 'a' },
      { name: 'DDTEST_STRU_CHAR', kind: 'include', attribute: null, suffix: 'b' },
      { name: 'DDTEST_STRU_CHAR', kind: 'include', attribute: null },
      { name: 'DDTEST_VIEW', kind: 'include', attribute: null, suffix: 'c' },
    ]);
  });
  it.each(['a4h/test_sbd_two_fields_class_intf-direct-appends', 'npl/test_sbd_two_fields_class_intf-enhancements'])(
    'retains value-help/foreign-key-only appends from %s',
    (key) => {
      const nodes = parseDdicAppendElements(
        body(key),
        '/sap/bc/adt/ddic/structures/test_sbd_two_fields_class_intf',
        'TEST_SBD_TWO_FIELDS_CLASS_INTF',
      );
      expect(nodes.map((node) => node.name)).toContain('TEST_SBD_APPEND_ADD_VH');
      expect(body('npl/test_sbd_append_add_vh')).toContain('extend class');
    },
  );
  it.each(['a4h/fdt_s_test_sfw-direct-appends', 'npl/fdt_s_test_sfw-enhancements'])(
    'does not infer runtime activation from append names: %s',
    (key) => {
      const nodes = parseDdicAppendElements(body(key), '/sap/bc/adt/ddic/structures/fdt_s_test_sfw', 'FDT_S_TEST_SFW');
      expect(nodes).toHaveLength(2);
      expect(nodes.every((node) => node.applicability === 'unknown')).toBe(true);
    },
  );
});

describe('DDIC response ownership and empty format', () => {
  const base = '/sap/bc/adt/ddic/tables/sflight';
  const anonymous = '<s:elementInfo xmlns:s="http://www.sap.com/adt/abapsource"><s:properties/></s:elementInfo>';
  it('accepts valid anonymous empty elementInfo, including self-closing', () => {
    expect(parseDdicAppendElements(anonymous, base, 'SFLIGHT')).toEqual([]);
    expect(parseDdicAppendElements('<elementInfo/>', base, 'SFLIGHT')).toEqual([]);
  });
  it.each([
    '<html/>',
    '<elementInfo>',
    '<!DOCTYPE elementInfo><elementInfo/>',
    '<elementInfo name="other"/>',
    '<elementInfo uri="/sap/bc/adt/ddic/tables/other"/>',
    '<elementInfo type="TABL/DS"/>',
    '<elementInfo version="inactive"/>',
    '<elementInfo><elementInfo name="zappend" type="TABL/DS" uri="/sap/bc/adt/ddic/structures/zappend/source/main"/></elementInfo>',
    '<elementInfo name="sflight"><elementInfo name="zappend" type="TABL/DS" uri="https://evil.invalid/sap/bc/adt/ddic/structures/zappend/source/main"/></elementInfo>',
    '<elementInfo name="sflight"><elementInfo name="zappend" type="TABL/DS" uri="/sap/bc/adt/ddic/structures/zother/source/main"/></elementInfo>',
  ])('rejects malformed or mismatched element data: %s', (xml) =>
    expect(() => parseDdicAppendElements(xml, base, 'SFLIGHT')).toThrow(),
  );
  it.each([
    'https://evil.invalid/x',
    '//evil.invalid/x',
    './other/enhancements',
    `${base}/../sflight/enhancements`,
    `${base}/enhancements?version=inactive`,
    `${base}/%2e%2e/enhancements`,
  ])('rejects unsafe metadata link %s', (uri) => expect(() => ddicEnhancementLink(uri, base)).toThrow());
  it('resolves the observed owner-relative relation and retains switch evidence', () => {
    expect(ddicEnhancementLink('./sflight/enhancement/elements', base)).toBe(`${base}/enhancement/elements`);
    expect(
      parseDdicAppendElements(
        '<elementInfo name="sflight"><elementInfo name="zappend" type="TABL/DS" uri="/sap/bc/adt/ddic/structures/zappend/source/main" switch="ZSWITCH"/></elementInfo>',
        base,
        'SFLIGHT',
      )[0],
    ).toMatchObject({ switch: 'ZSWITCH', applicability: 'unknown' });
  });
});
