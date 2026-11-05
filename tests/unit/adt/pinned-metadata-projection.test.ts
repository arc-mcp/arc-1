import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import {
  assertOnlyRequestedChanges,
  assertSavedFields,
  derivedMetadataFields,
  differingFields,
  metadataFields,
  metadataFieldsHash,
  metadataSubtree,
  withStoredRootAttributes,
} from '../../../src/adt/pinned-metadata-projection.js';

const domain = readFileSync(resolve(__dirname, '../../fixtures/xml/domain-metadata.xml'), 'utf8');
const ns = 'http://www.sap.com/dictionary/domain';
const fieldsOf = (xml: string) => metadataFields(nativeXmlRoot(xml, 'domain', ns, true), ns);

describe('metadata projection', () => {
  it.each([
    'http://www.sap.com/adt/core',
    'http://www.sap.com/dictionary/tabletype',
    'http://www.sap.com/adt/ddic/enqu',
    'http://www.w3.org/2005/Atom',
  ])('matches expanded namespace paths literally: %s', (namespace) => {
    const path = `/${JSON.stringify([namespace, 'link'])}`;
    const selected = metadataSubtree(path);
    for (const suffix of ['', '[12]', '[12]#present', '/child', '@attribute'])
      expect(selected.test(`${path}${suffix}`)).toBe(true);
    expect(selected.test(path.replace('www.', 'wwwX'))).toBe(false);
    for (const suffix of ['Extra', '[1x]', '[1][2]', '[1]Extra', '\n', '[1]\n'])
      expect(selected.test(`${path}${suffix}`)).toBe(false);
  });
  it('retains a lookalike Atom namespace instead of dropping it as derived link metadata', () => {
    const xml = `<d:domain xmlns:d="${ns}" xmlns:l="http://wwwXw3Xorg/2005/Atom"><l:link href="kept"/></d:domain>`;
    const fields = fieldsOf(xml);
    expect([...fields.keys()].some((path) => path.includes('wwwXw3Xorg'))).toBe(true);
    expect(metadataFieldsHash(fields)).not.toBe(metadataFieldsHash(new Map()));
    expect(fieldsOf(xml.replace('wwwXw3Xorg', 'www.w3.org')).size).toBe(0);
  });
  it.each([
    '/doma:content/doma:valueInformation/doma:fixValues',
    '/doma:content/doma:valueInformation/doma:valueTableRef',
    '/ttyp:rowType',
    '/enqu:content/enqu:primaryTable',
    '/enqu:content/enqu:secondaryTables',
    '/enqu:content/enqu:lockParameters',
  ])('bounds subtree selection to exact segments at %s', (path) => {
    const family = path.slice(1, path.indexOf(':'));
    const selected = metadataSubtree(path);
    for (const suffix of ['', `/${family}:field`, '@adtcore:name', `[1]/${family}:field`, '[2]@adtcore:name']) {
      const key = `${path}${suffix}`;
      const sibling = `${path}Extra`;
      const stored = new Map([
        [key, 'before'],
        [sibling, 'kept'],
      ]);
      const target = new Map([
        [key, 'after'],
        [sibling, 'kept'],
      ]);
      expect(assertOnlyRequestedChanges(stored, target, [selected])).toEqual([key]);
    }
    for (const suffix of [
      'Extra',
      'Options',
      'Extra@adtcore:name',
      `Extra/${family}:field`,
      `[1]Extra/${family}:field`,
      '[1x]',
    ]) {
      const key = `${path}${suffix}`;
      expect(() => assertOnlyRequestedChanges(new Map([[key, 'kept']]), new Map(), [selected])).toThrow(
        'cannot be preserved',
      );
      expect(() => assertSavedFields(new Map([[key, 'kept']]), new Map(), [selected])).toThrow('read-back differs');
    }
  });
  it('does not confuse a native sibling with explicit ENQU parameters or derived parameter evidence', () => {
    const sibling = '/enqu:content/enqu:lockParametersExtra';
    const parameter = '/enqu:content/enqu:lockParameters/enqu:lockParameter/enqu:parameterName';
    const captured = new Map([[sibling, 'kept']]);
    const derived = derivedMetadataFields('ENQU', captured);
    expect(derived).toHaveLength(1);
    expect(() => assertSavedFields(captured, new Map([...captured, [parameter, 'MANDT']]), derived)).not.toThrow();
    expect(() => assertSavedFields(captured, new Map([[parameter, 'MANDT']]), derived)).toThrow('lockParametersExtra');
    expect(derivedMetadataFields('ENQU', new Map([[parameter, 'MANDT']]))).toEqual([]);
  });
  it('retains same-namespace siblings of otherwise omitted derived lists', () => {
    const namespace = 'http://www.sap.com/dictionary/tabletype';
    const xml = `<t:tableType xmlns:t="${namespace}"><t:valueHelps><t:value>derived</t:value></t:valueHelps><t:valueHelpsExtra>kept</t:valueHelpsExtra></t:tableType>`;
    const fields = metadataFields(nativeXmlRoot(xml, 'tableType', namespace, true), namespace);
    expect([...fields]).toEqual([['/ttyp:valueHelpsExtra', 'kept']]);
  });
  it('keeps stored state and drops server bookkeeping, links and package decoration', () => {
    const fields = fieldsOf(domain);
    expect(fields.get('/doma:content/doma:typeInformation/doma:datatype')).toBe('CHAR');
    expect(fields.get('@adtcore:masterLanguage')).toBe('DE');
    expect(fields.get('/adtcore:packageRef@adtcore:name')).toBe('BF');
    expect(fields.get('/doma:content/doma:valueInformation/doma:valueTableRef@adtcore:type')).toBe('TABL/DT');
    for (const volatile of [
      '@adtcore:changedAt',
      '@adtcore:changedBy',
      '@adtcore:version',
      '@adtcore:language',
      '@adtcore:type',
      '/adtcore:packageRef@adtcore:uri',
    ])
      expect(fields.has(volatile)).toBe(false);
    expect([...fields.keys()].some((key) => key.includes('link'))).toBe(false);
    expect([...fields.keys()].some((key) => key.endsWith('@adtcore:uri'))).toBe(false);
  });

  it('hashes stored values independently of bookkeeping', () => {
    const touched = domain.replace(
      'adtcore:changedAt="1999-06-29T18:45:23Z"',
      'adtcore:changedAt="2030-01-01T00:00:00Z"',
    );
    expect(metadataFieldsHash(fieldsOf(touched))).toBe(metadataFieldsHash(fieldsOf(domain)));
    expect(metadataFieldsHash(fieldsOf(domain.replace('>000004<', '>000005<')))).not.toBe(
      metadataFieldsHash(fieldsOf(domain)),
    );
  });

  it('treats absent and empty values alike and zero padding as the same number', () => {
    const stored = fieldsOf(domain);
    const target = new Map(stored);
    target.set('/doma:content/doma:typeInformation/doma:length', '4');
    expect(assertOnlyRequestedChanges(stored, target, [])).toEqual([]);
  });

  it.each([
    '@adtcore:description',
    '/dtel:dataElement/dtel:shortFieldLabel',
    '/doma:content/doma:valueInformation/doma:fixValues/doma:fixValue/doma:low',
    '/mc:messages@mc:msgtext',
    '/mc:messages@mc:msgno',
  ])('keeps numeric-looking text exact at %s', (path) => {
    const stored = new Map([[path, '007']]),
      target = new Map([[path, '7']]);
    expect(differingFields(stored, target)).toEqual([path]);
    expect(() => assertSavedFields(target, stored, [])).toThrow(/read-back differs/);
  });

  it.each(['@adtcore:description', '/doma:content/doma:typeInformation/doma:length'])(
    'does not lose precision in long digit strings at %s',
    (path) => {
      expect(differingFields(new Map([[path, '9007199254740992']]), new Map([[path, '9007199254740993']]))).toEqual([
        path,
      ]);
      if (path.endsWith('doma:length'))
        expect(
          differingFields(new Map([[path, '0009007199254740993']]), new Map([[path, '9007199254740993']])),
        ).toEqual([]);
    },
  );

  it('retains equal local names with distinct namespaces and rejects dropping either', () => {
    const extra = domain.replace(
      '</doma:datatype>',
      '</doma:datatype><ext:datatype xmlns:ext="urn:extension">CHAR</ext:datatype>',
    );
    const stored = fieldsOf(extra);
    expect(stored.get('/doma:content/doma:typeInformation/doma:datatype')).toBe('CHAR');
    expect(stored.get('/doma:content/doma:typeInformation/["urn:extension","datatype"]')).toBe('CHAR');
    expect(() => assertOnlyRequestedChanges(stored, fieldsOf(domain), [/^\/doma:content/])).toThrow(
      /cannot be preserved/,
    );
    expect(metadataFieldsHash(stored)).not.toBe(metadataFieldsHash(fieldsOf(domain)));
  });

  it('detects namespace rebinding while ignoring equivalent prefix renaming', () => {
    const extra = domain.replace(
      '</doma:content>',
      '<ext:future xmlns:ext="urn:first">same</ext:future></doma:content>',
    );
    expect(metadataFieldsHash(fieldsOf(extra.replace('urn:first', 'urn:second')))).not.toBe(
      metadataFieldsHash(fieldsOf(extra)),
    );
    expect(
      metadataFieldsHash(
        fieldsOf(
          extra
            .replaceAll('ext:', 'other:')
            .replace('xmlns:ext', 'xmlns:other')
            .replaceAll('doma:', 'domain:')
            .replace('xmlns:doma', 'xmlns:domain'),
        ),
      ),
    ).toBe(metadataFieldsHash(fieldsOf(extra)));
  });

  it.each([
    '<ext:valueHelps xmlns:ext="urn:extension">stored</ext:valueHelps>',
    '<ext:lockModules xmlns:ext="urn:extension">stored</ext:lockModules>',
    '<ext:future xmlns:ext="urn:extension"/>',
    '<ext:future xmlns:ext="urn:extension" ext:uri="stored"/>',
    '<ext:future xmlns:ext="urn:extension" adtcore:uri="stored"/>',
    '<atom:future xmlns:atom="http://www.w3.org/2005/Atom">stored</atom:future>',
    '<ttyp:valueHelps xmlns:ttyp="http://www.sap.com/dictionary/tabletype">not a domain-derived list</ttyp:valueHelps>',
  ])('does not omit an unknown field merely because it resembles derived metadata: %s', (extra) => {
    const stored = fieldsOf(domain.replace('</doma:domain>', `${extra}</doma:domain>`));
    expect(() => assertOnlyRequestedChanges(stored, fieldsOf(domain), [])).toThrow(/cannot be preserved/);
  });

  it('retains foreign attributes colliding with root bookkeeping and package decoration', () => {
    const extra = domain
      .replace('adtcore:changedAt=', 'xmlns:ext="urn:extension" ext:changedAt="kept" adtcore:changedAt=')
      .replace('adtcore:type="DEVC/K"', 'adtcore:type="DEVC/K" ext:description="kept"');
    const stored = fieldsOf(extra);
    expect(stored.get('@["urn:extension","changedAt"]')).toBe('kept');
    expect(stored.get('/adtcore:packageRef@["urn:extension","description"]')).toBe('kept');
    expect(() => assertOnlyRequestedChanges(stored, fieldsOf(domain), [])).toThrow(/cannot be preserved/);
  });

  it('only excludes a generated native list at its exact definition path', () => {
    const namespace = 'http://www.sap.com/adt/ddic/enqu';
    const xml = `<e:lockobject xmlns:e="${namespace}"><e:content><e:lockModules><e:lockModule>derived</e:lockModule></e:lockModules></e:content><e:future><e:lockModules>stored</e:lockModules></e:future></e:lockobject>`;
    const fields = metadataFields(nativeXmlRoot(xml, 'lockobject', namespace, true), namespace);
    expect([...fields.keys()]).toEqual(['/enqu:future/enqu:lockModules']);
    expect(fields.get('/enqu:future/enqu:lockModules')).toBe('stored');
  });

  it('retains whitespace-only character fixed values as text', () => {
    const xml = domain.replace(
      '<doma:fixValues/>',
      '<doma:fixValues><doma:fixValue><doma:low> </doma:low></doma:fixValue></doma:fixValues>',
    );
    const stored = fieldsOf(xml);
    expect(stored.get('/doma:content/doma:valueInformation/doma:fixValues/doma:fixValue/doma:low')).toBe(' ');
    expect(differingFields(stored, fieldsOf(domain))).toHaveLength(1);
  });

  it.each([
    { type: 'DTEL', path: '/dtel:dataElement/dtel:typeKind', name: '/dtel:dataElement/dtel:typeName', mode: 'domain' },
    { type: 'TTYP', path: '/ttyp:rowType/ttyp:typeKind', name: '/ttyp:rowType/ttyp:typeName', mode: 'dictionaryType' },
  ])('does not exempt dimensions for an ambiguous or missing $type reference', ({ type, path, name, mode }) => {
    expect(derivedMetadataFields(type, new Map([[path, mode]]))).toEqual([]);
    expect(
      derivedMetadataFields(
        type,
        new Map([
          [path, mode],
          [name, 'BUKRS'],
          [`${path}[1]`, 'predefinedAbapType'],
        ]),
      ),
    ).toEqual([]);
  });

  it('refuses an unrequested reset, including a field the builder does not know', () => {
    const stored = fieldsOf(
      domain.replace('<doma:style>00</doma:style>', '<doma:style>01</doma:style><doma:unknown>x</doma:unknown>'),
    );
    const target = fieldsOf(domain);
    expect(() =>
      assertOnlyRequestedChanges(stored, target, ['/doma:content/doma:typeInformation/doma:length']),
    ).toThrow(/doma:outputInformation\/doma:style.*outputInformation\/doma:unknown|outputInformation\/doma:unknown/);
  });

  it('allows requested changes by exact path or pattern and returns them', () => {
    const stored = fieldsOf(domain);
    const target = fieldsOf(domain.replace('<doma:datatype>CHAR<', '<doma:datatype>NUMC<'));
    expect(assertOnlyRequestedChanges(stored, target, ['/doma:content/doma:typeInformation/doma:datatype'])).toEqual([
      '/doma:content/doma:typeInformation/doma:datatype',
    ]);
    expect(assertOnlyRequestedChanges(stored, target, [/doma:typeInformation/])).toHaveLength(1);
  });

  it('checks read-back with derived fields and the create-only target comparison', () => {
    const target = new Map([
      ['/a', '1'],
      ['/b', '2'],
    ]);
    expect(() =>
      assertSavedFields(
        target,
        new Map([
          ['/a', '1'],
          ['/b', '3'],
        ]),
        [],
      ),
    ).toThrow(/read-back differs at \/b/);
    assertSavedFields(
      target,
      new Map([
        ['/a', '1'],
        ['/b', '9'],
      ]),
      ['/b'],
    );
    const withDefault = new Map([...target, ['/c', 'native-default']]);
    expect(() => assertSavedFields(target, withDefault, [])).toThrow(/\/c/);
    assertSavedFields(target, withDefault, [], true);
    // Target-only still catches a requested value that did not survive.
    expect(() => assertSavedFields(target, new Map([['/a', '1']]), [], true)).toThrow(/\/b/);
  });

  it('replaces builder defaults with stored root attributes and removes values SAP does not store', () => {
    const root = nativeXmlRoot(domain.replace(' adtcore:abapLanguageVersion="standard"', ''), 'domain', ns, true);
    const body = withStoredRootAttributes(
      '<?xml version="1.0" encoding="UTF-8"?>\n<doma:domain xmlns:doma="x" adtcore:masterLanguage="EN" adtcore:masterSystem="H00" adtcore:abapLanguageVersion="cloudDevelopment" adtcore:name="A"><a/></doma:domain>',
      root,
    );
    expect(body).toContain('adtcore:masterLanguage="DE"');
    expect(body).toContain('adtcore:masterSystem="SAP"');
    expect(body).toContain('adtcore:responsible="SAP"');
    expect(body).not.toContain('H00');
    expect(body).not.toContain('abapLanguageVersion');
  });
});
