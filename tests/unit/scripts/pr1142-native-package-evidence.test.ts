import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { absent, graph, harness, nonempty, packageMetadata } from './pr1142-native-package-harness.js';

const { packageSnapshot, nativePackageNonempty, packageOwnerAbsent } = await import(
  '../../../scripts/qualification/pr1142/native-package-evidence.js'
);
const { AdtApiError } = await import('../../../src/adt/errors.js');
const options = () => ({ deadline: Date.now() + 30000, noReplay: true, retryTransientErrors: false });
function actualRoot() {
  return readFileSync(new URL('../../fixtures/xml/package-local-root-native.xml', import.meta.url), 'utf8')
    .replaceAll('$NEW', graph.root.name)
    .replace('Owned root', graph.root.description)
    .replaceAll('By="SAP"', 'By="MARIAN"');
}
const snapshot = (body: string, child = false) => {
  const h = harness();
  h.hooks.reply = () => ({ statusCode: 200, data: body });
  return packageSnapshot(h.client, graph.root, graph, options(), () => {}, true, child);
};
it('reads sanitized captured empty-parent metadata without inventing an empty subpackage inventory', async () => {
  expect(await snapshot(actualRoot())).toMatchObject({ active: true, children: undefined });
});
it('accepts only the source-observed exact lowercase native child URI alias', async () => {
  const xml = packageMetadata(graph.root, true).replace(graph.child.owner, graph.child.owner.toLowerCase());
  expect(await snapshot(xml, true)).toMatchObject({ children: [graph.child.owner] });
});
it('does not treat an omitted subpackages view as absence of the directly proven child', async () => {
  expect(await snapshot(actualRoot(), true)).toMatchObject({ children: undefined });
});
it.each([
  ['missing parent', (x: string) => x.replace('<pak:superPackage/>', '')],
  ['foreign parent', (x: string) => x.replace('<pak:superPackage/>', '<x:superPackage xmlns:x="urn:foreign"/>')],
  ['duplicate parent', (x: string) => x.replace('<pak:superPackage/>', '<pak:superPackage/><pak:superPackage/>')],
  [
    'nonempty unnamed parent',
    (x: string) => x.replace('<pak:superPackage/>', '<pak:superPackage>unknown</pak:superPackage>'),
  ],
  ['different parent', (x: string) => x.replace('<pak:superPackage/>', '<pak:superPackage adtcore:name="$TMP"/>')],
  ['wrong creator', (x: string) => x.replace('createdBy="MARIAN"', 'createdBy="OTHER"')],
  ['missing creator', (x: string) => x.replace('adtcore:createdBy="MARIAN"', '')],
  ['wrong owner', (x: string) => x.replace(`name="${graph.root.name}"`, 'name="$FOREIGN"')],
  ['wrong component', (x: string) => x.replace('pak:name="LOCAL"', 'pak:name="HOME"')],
  ['wrong recording', (x: string) => x.replace('recordChanges="false"', 'recordChanges="true"')],
  [
    'foreign positive child',
    (x: string) =>
      x.replace(
        '</pak:package>',
        '<pak:subPackages><pak:packageRef adtcore:name="$FOREIGN" adtcore:type="DEVC/K" adtcore:uri="/sap/bc/adt/packages/%24foreign"/></pak:subPackages></pak:package>',
      ),
  ],
  [
    'opaque child-view slot',
    (x: string) => x.replace('</pak:package>', '<pak:subPackages><pak:unknown/></pak:subPackages></pak:package>'),
  ],
] as const)('refuses native root evidence with %s', async (_label, change) => {
  await expect(snapshot(change(actualRoot()))).rejects.toThrow();
});
it('preserves unknown root metadata outside the declared subpackage slot', async () => {
  const a = await snapshot(actualRoot()),
    b = await snapshot(actualRoot().replace('</pak:package>', '<pak:opaque pak:mode="changed"/></pak:package>'));
  expect(a.metadataHash).not.toBe(b.metadataHash);
});
it('requires a strict native exception envelope for absence, rejecting regex decoys', async () => {
  for (const body of [
    '<html><type id="ExceptionResourceNotFound"/></html>',
    absent.replace('http://www.sap.com/abapxml/types/communicationframework', 'urn:foreign'),
    absent.replace('<namespace id="com.sap.adt"/>', ''),
    absent.replace('ExceptionResourceNotFound', 'ExceptionNoAuthorization'),
  ]) {
    const h = harness();
    h.hooks.reply = () => ({ statusCode: 404, data: body });
    await expect(packageOwnerAbsent(h.client.http, graph.root, () => {}, options())).rejects.toThrow();
  }
});
it.each([400, 409, 422, 500])('recognizes exact native PAK051 for this package at status %s', (status) => {
  expect(
    nativePackageNonempty(new AdtApiError('native', status, graph.root.owner, nonempty(graph.root)), graph.root),
  ).toMatchObject({ status, messageClass: 'PAK', messageNumber: '051', package: graph.root.name });
});
it('recognizes the exact documented English native message only when structured keys are absent', () => {
  const body = nonempty(graph.root).replace(/<properties>.*<\/properties>/, '');
  expect(nativePackageNonempty(new AdtApiError('native', 500, graph.root.owner, body), graph.root)?.basis).toBe(
    'exact-source-documented-English-PAK051',
  );
});
it.each([
  [
    'wrong namespace',
    (x: string) => x.replace('http://www.sap.com/abapxml/types/communicationframework', 'urn:foreign'),
  ],
  ['wrong package', (x: string) => x.replaceAll(graph.root.name, graph.child.name)],
  ['wrong class', (x: string) => x.replace('>PAK<', '>EU<')],
  ['wrong number', (x: string) => x.replace('>051<', '>510<')],
  [
    'duplicate property',
    (x: string) => x.replace('</properties>', '<entry key="T100KEY-MSGNO">051</entry></properties>'),
  ],
  ['ambiguous aliases', (x: string) => x.replace('</properties>', '<entry key="T100KEY-ID">PAK</entry></properties>')],
  ['missing owner key', (x: string) => x.replace(/<entry key="T100KEY-V1">[^<]*<\/entry>/, '')],
  ['partial key bag', (x: string) => x.replace(/<entry key="T100KEY-MSGNO">[^<]*<\/entry>/, '')],
  ['orphan owner key', (x: string) => x.replace(/<entry key="T100KEY-MSG(?:ID|NO)">[^<]*<\/entry>/g, '')],
  [
    'conflicting orphan owner key',
    (x: string) =>
      x
        .replace(/<entry key="T100KEY-MSG(?:ID|NO)">[^<]*<\/entry>/g, '')
        .replace(
          `<entry key="T100KEY-V1">${graph.root.name}</entry>`,
          `<entry key="T100KEY-V1">${graph.child.name}</entry>`,
        ),
  ],
  [
    'foreign property',
    (x: string) =>
      x.replace(
        '<entry key="T100KEY-MSGID">PAK</entry>',
        '<f:entry xmlns:f="urn:foreign" key="T100KEY-MSGID">PAK</f:entry>',
      ),
  ],
] as const)('does not accept PAK051 text beside %s', (_label, change) => {
  expect(
    nativePackageNonempty(new AdtApiError('native', 500, graph.root.owner, change(nonempty(graph.root))), graph.root),
  ).toBeUndefined();
});
it.each([200, 401, 403, 404, 429, 503])(
  'does not classify native status %s as the expected nonempty refusal',
  (status) => {
    expect(
      nativePackageNonempty(new AdtApiError('native', status, graph.root.owner, nonempty(graph.root)), graph.root),
    ).toBeUndefined();
  },
);

it.each([
  '<entry key="NATIVE_EXTRA"/>',
  '<entry key="NATIVE_EXTRA"><x:details xmlns:x="urn:opaque">retained by native error</x:details></entry>',
  '<entry key="NATIVE_EXTRA" hint="opaque"/>',
])('recognizes exact native PAK051 beside non-authoritative error metadata: %s', (extra) => {
  const body = nonempty(graph.root)
    .replace('T100KEY-MSGID', 'T100KEY-ID')
    .replace('T100KEY-MSGNO', 'T100KEY-NO')
    .replace('<properties>', `<properties>${extra}`);
  expect(nativePackageNonempty(new AdtApiError('native', 400, graph.root.owner, body), graph.root)).toMatchObject({
    basis: 'native-T100-PAK051',
    package: graph.root.name,
  });
});
it('keeps duplicate non-authoritative diagnostic keys ambiguous', () => {
  const body = nonempty(graph.root).replace('<properties>', '<properties><entry key="EXTRA"/><entry key="EXTRA"/>');
  expect(nativePackageNonempty(new AdtApiError('native', 400, graph.root.owner, body), graph.root)).toBeUndefined();
});
it.each([
  '<entry key="T100KEY-MSGID"/>',
  '<entry key="T100KEY-MSGID"><x:value xmlns:x="urn:opaque">PAK</x:value></entry>',
])('never derives authority from missing or structured T100 values: %s', (replacement) => {
  const body = nonempty(graph.root).replace('<entry key="T100KEY-MSGID">PAK</entry>', replacement);
  expect(nativePackageNonempty(new AdtApiError('native', 400, graph.root.owner, body), graph.root)).toBeUndefined();
});

it.each(['V2', 'V3', 'V4', 'UNUSED'])(
  'ignores unused native T100 %s values without deriving authority from them',
  (name) => {
    for (const value of ['', '<x:opaque xmlns:x="urn:opaque">ignored</x:opaque>']) {
      const body = nonempty(graph.root).replace(
        '</properties>',
        `<entry key="T100KEY-${name}">${value}</entry></properties>`,
      );
      expect(nativePackageNonempty(new AdtApiError('native', 400, graph.root.owner, body), graph.root)).toMatchObject({
        basis: 'native-T100-PAK051',
        package: graph.root.name,
      });
    }
  },
);
it.each(['T100KEY-V&#49;', 'T100KEY-V&#x31;', 'EXTR&#65;', 'EXTR&#x41;'])(
  'refuses unqualified numeric-reference property identities: %s',
  (key) => {
    const plain = key.startsWith('T100') ? '' : '<entry key="EXTRA"/>';
    const body = nonempty(graph.root).replace(
      '</properties>',
      `${plain}<entry key="${key}">$FOREIGN</entry></properties>`,
    );
    expect(nativePackageNonempty(new AdtApiError('native', 400, graph.root.owner, body), graph.root)).toBeUndefined();
  },
);
