import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sourcePluginFunctionName, sourcePluginResources } from '../../../src/adt/source-plugin-resources.js';

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/extensions/source/${name}`, import.meta.url), 'utf8');
const root = { type: 'CLAS' as const, name: 'CL_SEEF_ADT_TEST_AUNIT_1' };
const uri = '/sap/bc/adt/oo/classes/cl_seef_adt_test_aunit_1';
describe('class source plug-in metadata resources for stage 3', () => {
  it.each(['750', '758'])('selects only class main and local sections on %s', (version) => {
    const xml = fixture(`class-metadata-${version}.xml`);
    for (const section of ['main', 'definitions', 'implementations', 'macros', 'testclasses'] as const) {
      const resources = sourcePluginResources(xml, { ...root, section });
      const source = `${uri}/${section === 'main' ? 'source/main' : `includes/${section}`}`;
      expect(resources.sourceUri).toBe(source);
      expect(resources.elements?.uri).toBe(`${source}/enhancements${version === '758' ? '/elements' : ''}`);
      expect(resources.identities === undefined).toBe(section !== 'main' || version === '750');
      expect(resources.legacyUnadvertised).toBeUndefined();
    }
  });
  it('does not infer a legacy route from an unrelated grammar release', () => {
    const xml = fixture('prog-metadata-npl.xml').replaceAll('etag="750"', 'etag="749"');
    expect(sourcePluginResources(xml, { type: 'PROG', name: 'ENH_NESTED_DEMO' }).elements).toBeUndefined();
  });
  it('validates the owner before selecting child-section links', () => {
    const xml = fixture('class-metadata-758.xml').replace(
      'adtcore:name="CL_SEEF_ADT_TEST_AUNIT_1"',
      'adtcore:name="OTHER"',
    );
    expect(() => sourcePluginResources(xml, { ...root, section: 'definitions' })).toThrow();
  });
});

describe('bounded first FUNCTION header scan', () => {
  it('scans 256 KiB of blank lines in linear time', () => {
    const source = '\n'.repeat(256 * 1024);
    const started = performance.now();
    expect(sourcePluginFunctionName(source)).toBeUndefined();
    expect(performance.now() - started).toBeLessThan(1000);
  });
  it('accepts leading blank/comments and rejects a header inside a string', () => {
    expect(sourcePluginFunctionName('* comment\r\n\n  " comment\nFUNCTION\n /NS/FM.')).toBe('/NS/FM');
    expect(sourcePluginFunctionName('DATA(text) = |\nFUNCTION fm.\n|.')).toBeUndefined();
  });
});
