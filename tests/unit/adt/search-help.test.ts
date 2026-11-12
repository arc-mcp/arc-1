import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseSearchHelpMetadata } from '../../../src/adt/search-help.js';

const fixture = (name: string) => readFileSync(new URL(`../../fixtures/shlp/${name}.xml`, import.meta.url), 'utf8');
const root = (children = '', attrs = 'name="X" type="SHLP/DH"') =>
  `<elementInfo ${attrs}><properties/>${children}</elementInfo>`;
const parameter = (properties = '', name = 'ID') =>
  `<elementInfo name="${name}" type="SHLP/DHF"><properties>${properties}</properties></elementInfo>`;

describe.each(['750', '758'])('native SHLP %s', (release) => {
  it('preserves native interface flags and declares incomplete coverage', () => {
    const result = parseSearchHelpMetadata(fixture(`${release}-scustom`), 'scustom', 'EN');
    expect(result.availability).toBe('available');
    if (result.availability !== 'available') throw new Error('Expected metadata');
    expect(result.parameters).toHaveLength(4);
    expect(result.parameters.find((p) => p.name === 'ID')).toEqual({
      name: 'ID',
      dataElement: 'S_CUSTOMER',
      dataType: 'NUMC',
      length: '000008',
      import: false,
      export: true,
    });
    expect(result).toMatchObject({
      name: 'SCUSTOM',
      completeness: 'partial',
      sourceVersion: 'active',
      language: { requested: 'EN', effective: null },
      package: release === '758' ? 'SAPBC_DATAMODEL' : null,
    });
    expect(result.missing).toContain('collectiveInclusions');
    expect(result.missing).toContain('appendSearchHelps');
  });
  it('does not count nested data elements or packages as parameters', () => {
    const result = parseSearchHelpMetadata(fixture(`${release}-sflight`), 'SFLIGHT', 'DE');
    expect(result.availability === 'available' && result.parameters.length).toBe(13);
  });
  it('reads a real namespaced help', () => {
    const name = release === '758' ? '/AIF/ADDRESS_FIELDS' : '/BOBF/CONF_UI_BO_EXTENSION';
    const result = parseSearchHelpMetadata(fixture(`${release}-namespace`), name, 'EN');
    expect(result.availability).toBe('available');
    expect(result.name).toBe(name);
  });
  it('keeps unnamed native 200 distinct from a named empty interface', () => {
    expect(parseSearchHelpMetadata(fixture(`${release}-unavailable`), 'X', 'EN')).toMatchObject({
      availability: 'not_available',
      name: 'X',
    });
    expect(parseSearchHelpMetadata(root(), 'X', 'EN')).toMatchObject({ availability: 'available', parameters: [] });
  });
});

it.each([
  '<html>login</html>',
  '<elementInfo>',
  '<!DOCTYPE x><elementInfo/>',
  root('', 'name="OTHER" type="SHLP/DH"'),
  root('', 'name="X" type="DTEL/DE"'),
])('refuses malformed or mismatched native metadata: %s', (xml) => {
  expect(() => parseSearchHelpMetadata(xml, 'X', 'EN')).toThrow();
});
it('rejects oversized XML before parsing', () => {
  expect(() => parseSearchHelpMetadata(' '.repeat(2 * 1024 * 1024 + 1), 'X', 'EN')).toThrow(/size|large/i);
});
it('keeps missing flags unknown and rejects invalid or duplicate properties', () => {
  expect(parseSearchHelpMetadata(root(parameter()), 'X', 'EN')).toMatchObject({
    parameters: [{ import: null, export: null }],
  });
  for (const properties of [
    '<entry key="ddicSearchHelpInput">X</entry>',
    '<entry key="ddicSearchHelpInput">false</entry><entry key="ddicSearchHelpInput">true</entry>',
  ])
    expect(() => parseSearchHelpMetadata(root(parameter(properties)), 'X', 'EN')).toThrow();
});
it('rejects absent/duplicate parameter identities', () => {
  expect(() => parseSearchHelpMetadata(root(parameter('', '')), 'X', 'EN')).toThrow();
  expect(() => parseSearchHelpMetadata(root(parameter() + parameter()), 'X', 'EN')).toThrow();
});
