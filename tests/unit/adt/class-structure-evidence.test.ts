import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verifiedClassStructure } from '../../../src/adt/class-structure-evidence.js';

const fixture = (file: string) =>
  readFileSync(new URL(`../../fixtures/class-surgery/pinned.${file}`, import.meta.url), 'utf8');
const source = fixture('abap'),
  xml = fixture('xml');
const owner = '/sap/bc/adt/oo/classes/zcl_proof';
const verify = (metadata = xml, text = source) => verifiedClassStructure(metadata, text, 'ZCL_PROOF', owner, '001');
const selected = xml.match(
  /<abapsource:objectStructureElement adtcore:type="CLAS\/OM" adtcore:name="SELECTED"[\s\S]*?<\/abapsource:objectStructureElement>/,
)![0];

describe('pinned native class structure evidence', () => {
  it('binds exact owner, declarations, implementations and columns', () => {
    const result = verify();
    expect(result.className).toBe('ZCL_PROOF');
    expect(result.methods.map((m) => [m.name, m.visibility])).toEqual([
      ['SELECTED', 'public'],
      ['NEIGHBOR', 'private'],
    ]);
  });
  it('accepts the observed parent-relative link form and CRLF', () => {
    expect(
      verify(xml.replaceAll('./source/main', './../zcl_proof/source/main'), source.replaceAll('\n', '\r\n')).methods,
    ).toHaveLength(2);
  });
  it('accepts split definition/implementation nodes without merging duplicate ranges', () => {
    const split = selected.replace('CLAS/OM', 'CLAS/OO').replace(/<atom:link rel="[^"]*\/implementation[^\n]*\n/g, '');
    const implementation = selected.replace(/<atom:link rel="[^"]*\/definition[^\n]*\n/g, '');
    expect(verify(xml.replace(selected, split + implementation)).methods[0]?.implementation).toEqual({
      sr: 8,
      sc: 2,
      er: 9,
      ec: 11,
    });
  });
  it.each([
    [
      'absolute synthetic origin',
      (x: string) =>
        x.replace('./source/main#', 'https://class-evidence.invalid/sap/bc/adt/oo/classes/zcl_proof/source/main#'),
    ],
    [
      'invalid native boolean',
      (x: string) => x.replace('adtcore:name="SELECTED"', 'adtcore:name="SELECTED" abstract="unknown"'),
    ],
    ['owner', (x: string) => x.replace('adtcore:name="ZCL_PROOF"', 'adtcore:name="OTHER"')],
    ['source resource', (x: string) => x.replace('./source/main#', './includes/testclasses#')],
    ['source version', (x: string) => x.replace('./source/main#', './source/main?version=active#')],
    ['foreign URI', (x: string) => x.replace('./source/main#', 'https://foreign.example/source/main#')],
    ['wrong client', (x: string) => x.replace('sap-client=001', 'sap-client=002')],
    ['active base', (x: string) => x.replace('sap-client=001', 'version=active')],
    ['nested base', (x: string) => x.replace('adtcore:name="SELECTED"', 'adtcore:name="SELECTED" xml:base="/other/"')],
    [
      'renamed namespace',
      (x: string) =>
        x.replace('xmlns:adtcore="http://www.sap.com/adt/core"', 'xmlns:adtcore="http://foreign.example/core"'),
    ],
    ['column mismatch', (x: string) => x.replace('start=3,4;end=3,20', 'start=3,4;end=3,21')],
    ['identifier mismatch', (x: string) => x.replace('start=3,12;end=3,20', 'start=3,13;end=3,20')],
    ['visibility mismatch', (x: string) => x.replace('visibility="public"', 'visibility="private"')],
    ['level mismatch', (x: string) => x.replace('level="instance"', 'level="static"')],
    [
      'abstract mismatch',
      (x: string) => x.replace('adtcore:name="SELECTED"', 'adtcore:name="SELECTED" abstract="true"'),
    ],
    [
      'redefinition mismatch',
      (x: string) => x.replace('adtcore:name="SELECTED"', 'adtcore:name="SELECTED" redefinition="true"'),
    ],
    ['missing method', (x: string) => x.replace(selected, '')],
    ['duplicate method', (x: string) => x.replace(selected, selected + selected)],
    [
      'duplicate relation',
      (x: string) =>
        x.replace(
          'end=6,8"/>',
          'end=6,8"/><atom:link rel="http://www.sap.com/adt/relations/source/definitionBlock" href="./source/main#start=1,0;end=6,8"/>',
        ),
    ],
    ['DTD', (x: string) => `<!DOCTYPE x [<!ENTITY secret "other">]>${x}`],
    ['duplicate roots', (x: string) => x + x],
  ] as const)('refuses %s', (_label, change) => {
    expect(() => verify(change(xml))).toThrow();
  });
  it.each([
    source.replace('METHODS selected.', 'METHODS renamed.'),
    source.replace('METHOD selected.', 'METHOD renamed.'),
    source.replace('  PUBLIC SECTION.', '  PROTECTED SECTION.'),
    source.replace('    METHODS selected.', '    METHODS selected.\n    METHODS hidden.'),
    source.replace('  METHOD selected.', '  METHOD selected.\n  METHOD selected.'),
    source.replace('METHODS selected.', 'METHODS selected GARBAGE.'),
  ])('refuses stale or unparseable source inventory %#', (changed) => expect(() => verify(xml, changed)).toThrow());
  it('checks the final shared-parser projection against ignored nested metadata', () => {
    const nested = `<abapsource:objectStructureElement adtcore:type="CLAS/OCL" adtcore:name="LOCAL"><abapsource:objectStructureElement adtcore:type="CLAS/OLD" adtcore:name="DUMMY"></abapsource:objectStructureElement>${selected.replace('start=3,4;end=3,20', 'start=5,4;end=5,20')}</abapsource:objectStructureElement>`;
    expect(() =>
      verify(xml.replace(/<\/abapsource:objectStructureElement>\s*$/, `${nested}</abapsource:objectStructureElement>`)),
    ).toThrow();
  });
});

const shape = (name: string, extension: string) =>
  readFileSync(new URL(`../../fixtures/class-surgery/pinned-${name}.${extension}`, import.meta.url), 'utf8');
it('binds every member of an authored chain fixture using punctuation-start coordinates', () => {
  const result = verify(shape('chain', 'xml'), shape('chain', 'abap'));
  expect(result.methods.map((method) => [method.name, method.definition])).toEqual([
    ['SELECTED', { sr: 3, sc: 4, er: 4, ec: 14 }],
    ['NEIGHBOR', { sr: 3, sc: 4, er: 5, ec: 14 }],
  ]);
});
it('binds an interface body identifier to its local INTERFACES declaration without treating it as METHODS', () => {
  const result = verify(shape('interface', 'xml'), shape('interface', 'abap'));
  expect(result.methods.map((method) => method.name)).toEqual(['SELECTED']);
});
it.each([
  ['foreign interface name', (x: string) => x.replace('LIF_X~RUN', 'LIF_Y~RUN')],
  ['wrong interface identifier', (x: string) => x.replace('start=5,15;end=5,20', 'start=3,12;end=3,20')],
  [
    'foreign interface source',
    (x: string) => x.replace('./source/main#start=5,15', '../interfaces/lif_x/source/main#start=5,15'),
  ],
  ['wrong interface visibility', (x: string) => x.replace('visibility="private"', 'visibility="public"')],
] as const)('refuses %s on an interface-supplied body', (_label, change) => {
  expect(() => verify(change(shape('interface', 'xml')), shape('interface', 'abap'))).toThrow();
});
it('uses the actual period position when a declaration has whitespace before it', () => {
  const text = source.replace('METHODS selected.', 'METHODS selected .');
  expect(verify(xml.replace('start=3,4;end=3,20', 'start=3,4;end=3,21'), text).methods).toHaveLength(2);
  expect(() => verify(xml, text)).toThrow();
});
it('supports ordinary on-premises declarations without imposing the Cloud syntax dialect', () => {
  const text = source.replace('METHODS selected.', 'METHODS selected EXPORTING value TYPE any.');
  const x = xml.replace('start=3,4;end=3,20', 'start=3,4;end=3,45');
  expect(verify(x, text).methods[0]?.name).toBe('SELECTED');
});
it('validates a namespaced class without changing native identifier columns', () => {
  const text = source.replaceAll('zcl_proof', '/nsp/demo');
  const x = xml.replaceAll('ZCL_PROOF', '/NSP/DEMO').replaceAll('zcl_proof', '%2fnsp%2fdemo');
  expect(verifiedClassStructure(x, text, '/NSP/DEMO', '/sap/bc/adt/oo/classes/%2fnsp%2fdemo', '001').className).toBe(
    '/NSP/DEMO',
  );
});
it('accepts a concrete redefinition and checks the true flag', () => {
  const text = source.replace('METHODS selected.', 'METHODS selected REDEFINITION.');
  const x = xml
    .replace('adtcore:name="SELECTED"', 'adtcore:name="SELECTED" redefinition="true"')
    .replace('start=3,4;end=3,20', 'start=3,4;end=3,33');
  expect(verify(x, text).methods[0]?.redefinition).toBe(true);
});
it('accepts an abstract declaration with no implementation and checks the true flag', () => {
  const text = source
    .replace('CLASS zcl_proof DEFINITION.', 'CLASS zcl_proof DEFINITION ABSTRACT.')
    .replace('METHODS selected.', 'METHODS selected ABSTRACT.')
    .replace('  METHOD selected.\n  ENDMETHOD.\n', '');
  const child = selected
    .replace('adtcore:name="SELECTED"', 'adtcore:name="SELECTED" abstract="true"')
    .replace(/<atom:link rel="[^\n]*\/implementation[^\n]*\n/g, '')
    .replace('start=3,4;end=3,20', 'start=3,4;end=3,29');
  const x = xml
    .replace(selected, child)
    .replace('end=12,8', 'end=10,8')
    .replace('start=10,2;end=11,11', 'start=8,2;end=9,11');
  const method = verify(x, text).methods[0];
  expect(method?.abstract).toBe(true);
  expect(method?.implementation).toBeUndefined();
});
it('refuses metadata exceeding the bounded XML size', () => {
  expect(() => verify(xml.replace('>', '>' + ' '.repeat(1024 * 1024)))).toThrow();
});
