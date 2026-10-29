import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSourcePluginElements, parseSourcePluginIdentities } from '../../../src/adt/source-plugin-parser.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/extensions/source/${name}`, import.meta.url), 'utf8');
const classUri = '/sap/bc/adt/oo/classes/cl_seef_adt_test_aunit_1';
describe('source plug-in wire parser', () => {
  it('retains four nested 750 implementations and their actual parents', () => {
    const graph = parseSourcePluginElements(fixture('nested-750.xml'), {
      mainObjectUri: '/sap/bc/adt/programs/programs/enh_nested_demo',
      sources: true,
    });
    expect(graph.implementations).toHaveLength(4);
    expect(graph.edges).toHaveLength(4);
    expect(
      graph.implementations.every((i) => i.version === 'active' && i.plugins[0]?.source?.includes('ENHANCEMENT')),
    ).toBe(true);
    expect(graph.implementations.filter((i) => i.parent.type === 'ENHO/XH')).toHaveLength(3);
  });
  it.each(['750', '758'])('preserves seven class identities and three replacement edges on %s', (version) => {
    const graph = parseSourcePluginElements(fixture(`class-${version}.xml`), {
      mainObjectUri: classUri,
      sources: true,
    });
    expect(graph.implementations).toHaveLength(7);
    expect(graph.edges.filter((e) => e.kind === 'replacement')).toHaveLength(3);
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        from: 'SEEF_ADT_TEST_ENHO_CLASS_1A_RR',
        to: 'SEEF_ADT_TEST_ENHO_CLASS_1A_R',
        kind: 'replacement',
      }),
    );
    expect(
      graph.implementations.every((i) => i.plugins.every((p) => p.fullName && p.source?.startsWith('ENHANCEMENT'))),
    ).toBe(true);
    expect(graph.omittedSources).toBe(0);
  });
  it('labels cheap identities separately from the element graph', () => {
    const identities = parseSourcePluginIdentities(fixture('class-identities-758.xml'));
    expect(identities).toHaveLength(2);
    expect(identities[0]?.switch).toEqual({ name: 'SEEF_ADT_TEST_SWITCH_01', state: 'off' });
  });
  it('retains implicit include attachment and full_name spelling', () => {
    const graph = parseSourcePluginElements(fixture('include-context-758.xml'), {
      mainObjectUri: '/sap/bc/adt/programs/programs/prog_enh_subobj_check',
      selectedObjectUri: '/sap/bc/adt/programs/includes/enh_prog_incl_implicit_opt',
      sources: true,
    });
    expect(graph.implementations[0]?.plugins[0]).toMatchObject({ mode: 'static', replacing: false });
    expect(graph.implementations[0]?.plugins[0]?.fullName).toContain('\\IC:ENH_PROG_INCL_IMPLICIT_OPT');
  });

  it('accepts selected-include ownership inside inherited FUGR context', () => {
    const xml = fixture('include-own-parent-758.xml');
    const opts = { mainObjectUri: '/sap/bc/adt/functions/groups/seef_adt_test_aunit_fugr1', sources: true };
    expect(() => parseSourcePluginElements(xml, opts)).toThrow();
    expect(
      parseSourcePluginElements(xml, {
        ...opts,
        selectedObjectUri: '/sap/bc/adt/programs/includes/seef_adt_test_aunit_include_3',
      }).implementations[0]?.name,
    ).toBe('SEEF_ADT_TEST_ENHO_31');
  });

  it('keeps the observed inactive implementation version under an active-base observation', () => {
    const graph = parseSourcePluginElements(
      fixture('class-758.xml').replaceAll('adtcore:version="active"', 'adtcore:version="inactive"'),
      {
        mainObjectUri: classUri,
        sources: false,
      },
    );
    expect(graph.implementations.every((i) => i.version === 'inactive')).toBe(true);
  });
  it('preserves FUGR replacement chains from a positive F01 response', () => {
    const graph = parseSourcePluginElements(fixture('fugr-f01-758.xml'), {
      mainObjectUri: '/sap/bc/adt/functions/groups/seef_adt_test_aunit_fugr1',
      selectedObjectUri: '/sap/bc/adt/programs/includes/lseef_adt_test_aunit_fugr1f01',
      sources: true,
    });
    expect(graph.implementations).toHaveLength(3);
    expect(graph.edges.filter((e) => e.kind === 'replacement')).toHaveLength(2);
  });
  it('bounds nodes and aggregate/per-source decoding and does no decoding for summaries', () => {
    const xml = fixture('class-758.xml');
    const limited = parseSourcePluginElements(xml, {
      mainObjectUri: classUri,
      sources: true,
      maxImplementations: 2,
      maxDecodedBytes: 8,
    });
    expect(limited.omittedImplementations).toBe(5);
    expect(limited.omittedSources).toBeGreaterThan(0);
    expect(limited.implementations[0]?.plugins[0]?.sourceOmitted).toBe('decoded_byte_limit');
    expect(
      parseSourcePluginElements(xml, { mainObjectUri: classUri, sources: false }).implementations[0]?.plugins[0]
        ?.source,
    ).toBeUndefined();
  });
  it('records malformed base64 and invalid UTF-8 without using permissive decoding', () => {
    for (const [encoded, reason] of [
      ['!!!=', 'invalid_base64'],
      ['/w==', 'invalid_utf8'],
    ]) {
      const xml = fixture('include-context-758.xml').replace(
        /<enh:source>[\s\S]*?<\/enh:source>/,
        `<enh:source>${encoded}</enh:source>`,
      );
      const graph = parseSourcePluginElements(xml, {
        mainObjectUri: '/sap/bc/adt/programs/programs/prog_enh_subobj_check',
        selectedObjectUri: '/sap/bc/adt/programs/includes/enh_prog_incl_implicit_opt',
        sources: true,
      });
      expect(graph.implementations[0]?.plugins[0]?.sourceOmitted).toBe(reason);
    }
  });
  it('retains decoded BOM, CRLF and trailing whitespace exactly', () => {
    const source = '\uFEFFENHANCEMENT 1 test.\r\n  WRITE / 1.  \r\nENDENHANCEMENT.\r\n';
    const xml = fixture('include-context-758.xml').replace(
      /<enh:source>[\s\S]*?<\/enh:source>/,
      `<enh:source>${Buffer.from(source).toString('base64')}</enh:source>`,
    );
    const graph = parseSourcePluginElements(xml, {
      mainObjectUri: '/sap/bc/adt/programs/programs/prog_enh_subobj_check',
      selectedObjectUri: '/sap/bc/adt/programs/includes/enh_prog_incl_implicit_opt',
      sources: true,
    });
    expect(graph.implementations[0]?.plugins[0]?.source).toBe(source);
  });
  it('accepts the valid anonymous empty response for this selected source only', () => {
    expect(
      parseSourcePluginElements('<enh:enhancements xmlns:enh="http://www.sap.com/adt/abapsource/enhancements"/>', {
        mainObjectUri: classUri,
        sources: true,
      }).implementations,
    ).toEqual([]);
  });
  it.each([
    (s: string) => s.replaceAll(classUri, '/sap/bc/adt/oo/classes/other'),
    (s: string) => s.replace('enh:uri="/sap', 'enh:uri="https://evil.invalid/sap'),
    (s: string) =>
      s.replace('adtcore:uri="/sap/bc/adt/oo/classes/', 'adtcore:uri="https://evil.invalid/sap/bc/adt/oo/classes/'),
    (s: string) =>
      s.replace('/source/main#start=25,0', '/source/main?context=%2Fsap%2Fbc%2Fadt%2Foo%2Fclasses%2Fother#start=25,0'),
    (s: string) => s.replace('adtcore:version="active"', 'adtcore:version=""'),
    () => '<enh:enhancements>',
    () => '<enhancements>not a valid empty list</enhancements>',
    () => '<enhancements><unknown/></enhancements>',
    () => '<!DOCTYPE a [<!ENTITY a "foo">]><enhancements/>',
  ])('rejects unsafe, malformed or wrong-owner evidence', (mutate) => {
    expect(() =>
      parseSourcePluginElements(mutate(fixture('class-758.xml')), { mainObjectUri: classUri, sources: true }),
    ).toThrow();
  });
});
