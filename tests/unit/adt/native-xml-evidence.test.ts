import { expect, it } from 'vitest';
import { nativeActivationExecuted, nativeInactiveReferences } from '../../../src/adt/native-activation-evidence.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';

const core = 'http://www.sap.com/adt/core';
const ns = 'http://www.sap.com/adt/programs/includes';
const xml = `<i:abapInclude xmlns:i="${ns}" xmlns:a="${core}" a:name="ZINC" a:type="PROG/I"><a:packageRef a:name="$TMP" a:type="DEVC/K"/></i:abapInclude>`;
it('binds alternate prefixes by namespace, including inherited package attributes', () => {
  const root = nativeXmlRoot(xml, 'abapInclude', ns);
  expect(root.attribute('name', core)).toBe('ZINC');
  expect(root.child('packageRef', core)?.attribute('name', core)).toBe('$TMP');
});
it.each([
  ['malformed', xml.slice(0, -15)],
  ['doctype with otherwise valid owner', `<!DOCTYPE i:abapInclude>${xml}`],
  ['two document roots', `${xml}${xml}`],
  ['wrong root namespace', xml.replace(ns, 'urn:foreign')],
  ['unqualified identity', xml.replace('a:name="ZINC"', 'name="ZINC"')],
  [
    'foreign identity collision',
    xml.replace('a:name="ZINC"', 'a:name="ZA" xmlns:other="urn:foreign" other:name="ZINC"'),
  ],
  [
    'same-namespace duplicate identity',
    xml.replace('a:name="ZINC"', `a:name="ZA" xmlns:other="${core}" other:name="ZINC"`),
  ],
  ['shadowed package namespace', xml.replace('<a:packageRef ', '<a:packageRef xmlns:a="urn:foreign" ')],
  ['duplicate package', xml.replace('</i:abapInclude>', '<a:packageRef a:name="ZOTHER"/></i:abapInclude>')],
  ['oversized UTF-8 metadata', xml.replace('a:name="ZINC"', `a:name="${'é'.repeat(524288)}"`)],
])('refuses %s as identity evidence', (_label, body) => {
  expect(() => {
    const root = nativeXmlRoot(body, 'abapInclude', ns);
    root.attribute('name', core);
    root.child('packageRef', core)?.attribute('name', core);
  }).toThrow();
});
const prompt = `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:a="${core}"><ioc:entry/><ioc:entry><ioc:object ioc:deleted="true"><ioc:ref a:name="ZINC" a:type="PROG/I" a:uri="/sap/bc/adt/programs/includes/zinc"/></ioc:object></ioc:entry></ioc:inactiveObjects>`;
it('retains native type and deletion evidence, ignoring empty transport-only rows', () => {
  expect(nativeInactiveReferences(prompt)).toEqual([
    { uri: '/sap/bc/adt/programs/includes/zinc', name: 'ZINC', type: 'PROG/I', deleted: 'true' },
  ]);
});
it('refuses a foreign deletion attribute that could mask a native deletion draft', () => {
  expect(() =>
    nativeInactiveReferences(
      prompt.replace('ioc:deleted="true"', 'ioc:deleted="true" xmlns:other="urn:foreign" other:deleted="false"'),
    ),
  ).toThrow('identity attribute');
});
it('requires the native execution namespace and an unambiguous flag', () => {
  const body =
    '<c:messages xmlns:c="http://www.sap.com/abapxml/checklist"><c:properties activationExecuted="true"/></c:messages>';
  expect(nativeActivationExecuted(body)).toBe(true);
  expect(() => nativeActivationExecuted(body.replace('http://www.sap.com/abapxml/checklist', 'urn:foreign'))).toThrow();
  expect(() =>
    nativeActivationExecuted(
      body.replace(
        'activationExecuted="true"',
        'activationExecuted="false" xmlns:x="urn:foreign" x:activationExecuted="true"',
      ),
    ),
  ).toThrow();
  expect(nativeActivationExecuted(body.replace('true', 'false'))).toBe(false);
});
