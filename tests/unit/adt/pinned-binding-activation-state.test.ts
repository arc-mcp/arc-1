import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bindingActivationMatches,
  bindingStableDocument,
  parsePinnedBinding,
  pinnedBindingSelection,
} from '../../../src/adt/pinned-service-binding-owner.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { managedHarness, packageXml } from './pinned-managed-harness.js';

const { handlePrivatePinnedBindingActivation } = await import('../../../src/handlers/write/pinned-activation.js');
const before = readFileSync(new URL('../../fixtures/xml/service-binding-v4-inactive.xml', import.meta.url), 'utf8');
const after = readFileSync(new URL('../../fixtures/xml/service-binding-v4-active.xml', import.meta.url), 'utf8');
const selected = pinnedBindingSelection('ZBIND_QUAL');
const nativeResult =
  '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties checkExecuted="true" activationExecuted="true" generationExecuted="true"/></chkl:messages>';
const data = '<srvb:bindingTypeData><adtcore:content adtcore:encoding="base64"/></srvb:bindingTypeData>';
async function replay(first = before, next = after, activeView = next, prompt = false, revalidated = first) {
  let sent = 0;
  const h = managedHarness((r) => {
    if (r.method === 'GET' && r.path.startsWith(selected.objectUrl))
      return mockResponse(
        200,
        !sent ? first : prompt && sent === 1 ? revalidated : r.path.endsWith('?version=active') ? activeView : next,
      );
    if (r.path === '/sap/bc/adt/packages/%24TMP') return mockResponse(200, packageXml('$TMP'));
    if (r.method === 'POST' && r.path.startsWith('/sap/bc/adt/activation?')) {
      sent++;
      if (prompt && sent === 1)
        return mockResponse(
          200,
          `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core"><ioc:entry><ioc:object ioc:deleted="false"><ioc:ref adtcore:uri="${selected.objectUrl}" adtcore:name="${selected.name}" adtcore:type="SRVB/SVB"/></ioc:object></ioc:entry></ioc:inactiveObjects>`,
        );
      return mockResponse(200, nativeResult);
    }
  });
  const result = await handlePrivatePinnedBindingActivation(h.client, { type: 'SRVB', name: selected.name });
  expect(h.calls.some((r) => r.method === 'PUT' || r.method === 'DELETE')).toBe(false);
  return { result, calls: h.calls, sent };
}

describe('source-backed SRVB activation getter derivations', () => {
  it.each([false, true])(
    'verifies native-shaped activation, prompt=%s, with one authorized activation job',
    async (prompt) => {
      const got = await replay(before, after, after, prompt);
      expect(got.result.isError, JSON.stringify(got.result)).not.toBe(true);
      expect(got.sent).toBe(prompt ? 2 : 1);
      expect(got.calls.some((r) => r.path.endsWith('?version=active'))).toBe(true);
      expect(JSON.stringify(got.result)).toContain('nativeMetadataVerified');
    },
  );
  it('retains the complete metadata hash and strict save/publication projections', () => {
    expect(bindingStableDocument(before)).not.toBe(bindingStableDocument(after));
    expect(parsePinnedBinding(before, selected).metadataHash).not.toBe(
      parsePinnedBinding(after, selected).metadataHash,
    );
    const derivedOnly = before.replace('<srvb:serviceBinding ', '<srvb:serviceBinding srvb:contract="C2" ');
    expect(parsePinnedBinding(before, selected).metadataHash).not.toBe(
      parsePinnedBinding(derivedOnly, selected).metadataHash,
    );
    expect(parsePinnedBinding(before, selected).publicationHash).not.toBe(
      parsePinnedBinding(derivedOnly, selected).publicationHash,
    );
  });
  it('uses the native UI category contract C1 without treating Web API C2 as universal', async () => {
    const first = before.replace('srvb:category="1"', 'srvb:category="0"');
    const next = after
      .replace('srvb:category="1"', 'srvb:category="0"')
      .replace('srvb:contract="C2"', 'srvb:contract="C1"');
    expect((await replay(first, next)).result.isError).not.toBe(true);
  });
  it('preserves unchanged opaque fields outside the narrowly derived paths', async () => {
    const extend = (xml: string) =>
      xml.replace(
        '</srvb:serviceBinding>',
        '<x:opaque xmlns:x="urn:retained" x:value="keep"><srvb:bindingTypeData x:note="keep"/></x:opaque></srvb:serviceBinding>',
      );
    expect((await replay(extend(before), extend(after))).result.isError).not.toBe(true);
  });
  it('supports namespace aliases without lexical matching', async () => {
    const alias = (xml: string) => xml.replaceAll('srvb:', 's:').replaceAll('xmlns:srvb=', 'xmlns:s=');
    expect((await replay(alias(before), alias(after))).result.isError).not.toBe(true);
  });
  it.each([
    ['wrong name', (s: string) => s.replace('adtcore:name="ZBIND_QUAL"', 'adtcore:name="ZOTHER"')],
    ['wrong type', (s: string) => s.replace('adtcore:type="SRVB/SVB"', 'adtcore:type="CLAS/OC"')],
    ['wrong package', (s: string) => s.replace('adtcore:name="$TMP"', 'adtcore:name="$NEW"')],
    ['description drift', (s: string) => s.replace('Qualification service binding', 'Unrequested title')],
    ['foreign service reference', (s: string) => s.replace('/sources/zservice_qual', '/sources/zforeign')],
    [
      'changed implementation',
      (s: string) =>
        s.replace('<srvb:implementation adtcore:name="ZBIND_QUAL"', '<srvb:implementation adtcore:name="ZOTHER"'),
    ],
    ['wrong contract', (s: string) => s.replace('srvb:contract="C2"', 'srvb:contract="C1"')],
    ['missing contract', (s: string) => s.replace('srvb:contract="C2"', '')],
    ['published', (s: string) => s.replace('srvb:published="false"', 'srvb:published="true"')],
    ['missing generated flag', (s: string) => s.replace('srvb:bindingCreated="true"', '')],
    ['missing release support', (s: string) => s.replace('srvb:releaseSupported="true"', '')],
    [
      'changed release state',
      (s: string) => s.replace('srvb:releaseState="NOT_RELEASED"', 'srvb:releaseState="RELEASED"'),
    ],
    ['different OData version', (s: string) => s.replace('srvb:version="V4"', 'srvb:version="V2"')],
    ['wrong version', (s: string) => s.replace('adtcore:version="active"', 'adtcore:version="inactive"')],
    [
      'remaining draft',
      (s: string) =>
        s.replace(
          '</srvb:serviceBinding>',
          `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="${selected.objectUrl}?version=inactive"/></srvb:serviceBinding>`,
        ),
    ],
    [
      'unknown root field',
      (s: string) => s.replace('<srvb:serviceBinding ', '<srvb:serviceBinding xmlns:x="urn:opaque" x:new="retained" '),
    ],
    [
      'wrapper attribute',
      (s: string) => s.replace('<srvb:bindingTypeData>', '<srvb:bindingTypeData xmlns:x="urn:opaque" x:keep="yes">'),
    ],
    [
      'content attribute',
      (s: string) =>
        s.replace('adtcore:encoding="base64"', 'adtcore:encoding="base64" xmlns:x="urn:opaque" x:keep="yes"'),
    ],
    [
      'nonempty payload',
      (s: string) =>
        s.replace(
          '<adtcore:content adtcore:encoding="base64"/>',
          '<adtcore:content adtcore:encoding="base64">YQ==</adtcore:content>',
        ),
    ],
    [
      'nested opaque payload',
      (s: string) =>
        s.replace(
          '<adtcore:content adtcore:encoding="base64"/>',
          '<adtcore:content adtcore:encoding="base64"><x:n xmlns:x="urn:opaque"/></adtcore:content>',
        ),
    ],
    ['duplicate wrapper', (s: string) => s.replace(data, data + data)],
    [
      'duplicate content',
      (s: string) =>
        s.replace('</srvb:bindingTypeData>', '<adtcore:content adtcore:encoding="base64"/></srvb:bindingTypeData>'),
    ],
    [
      'foreign wrapper namespace',
      (s: string) => s.replace('<srvb:bindingTypeData>', '<srvb:bindingTypeData xmlns:srvb="urn:foreign">'),
    ],
    [
      'foreign content namespace',
      (s: string) => s.replace('<adtcore:content ', '<adtcore:content xmlns:adtcore="urn:foreign" '),
    ],
    [
      'moved wrapper under opaque node',
      (s: string) => s.replace(data, `<x:opaque xmlns:x="urn:opaque">${data}</x:opaque>`),
    ],
    [
      'moved wrapper under sibling',
      (s: string) => s.replace(data, `<srvb:bindingTypeDataExtra>${data}</srvb:bindingTypeDataExtra>`),
    ],
  ] as const)('retains native success but refuses %s without another mutation', async (_label, change) => {
    const got = await replay(before, change(after));
    expect(got.result.isError).toBe(true);
    expect(got.sent).toBe(1);
    expect(JSON.stringify(got.result)).toContain('activation-not-confirmed');
    expect(JSON.stringify(got.result)).toContain('nativeActivation');
  });
  it('refuses a getter-derived-only full-hash drift before preaudit confirmation', async () => {
    const changed = before.replace('<srvb:serviceBinding ', '<srvb:serviceBinding srvb:contract="C2" ');
    const got = await replay(before, after, after, true, changed);
    expect(got.result.isError).toBe(true);
    expect(got.sent).toBe(1);
    expect(got.calls.some((r) => r.path.includes('preauditRequested=false'))).toBe(false);
  });
  it('independently verifies the explicit active view', async () => {
    const got = await replay(before, after, after.replace('Qualification service binding', 'Foreign active view'));
    expect(got.result.isError).toBe(true);
    expect(got.sent).toBe(1);
  });
  it.each([
    ['foreign owner', before.replace('adtcore:name="ZBIND_QUAL"', 'adtcore:name="ZOTHER"')],
    ['foreign reference', before.replace('/sources/zservice_qual', '/sources/zother')],
    ['unpublished state missing', before.replace('srvb:published="false"', '')],
  ])('refuses %s before any activation POST', async (_label, initial) => {
    const got = await replay(initial, after);
    expect(got.result.isError).toBe(true);
    expect(got.sent).toBe(0);
  });
  it('does not reinterpret an already-generated starting owner', async () => {
    const got = await replay(after, after);
    expect(got.result.isError).toBe(true);
    expect(got.sent).toBe(0);
  });
  it.each([
    ['service name', (xml: string) => xml.replace('<srvb:services srvb:name="ZBIND_QUAL"', '<srvb:services')],
    ['service version', (xml: string) => xml.replace('srvb:version="0001"', '')],
    ['definition', (xml: string) => xml.replace(/<srvb:serviceDefinition[^>]+\/>/, '')],
  ] as const)('does not confirm generated state without an explicit %s', async (_label, change) => {
    const got = await replay(change(before), change(after));
    expect(got.result.isError).toBe(true);
    expect(got.sent).toBe(1);
  });
  it('does not erase a preexisting non-derived contract', async () => {
    const first = before.replace('<srvb:serviceBinding ', '<srvb:serviceBinding srvb:contract="C1" ');
    const got = await replay(first, after);
    expect(got.result.isError).toBe(true);
    expect(got.sent).toBe(1);
  });
  it('keeps the same expanded empty-data key strict when preexisting content changes', async () => {
    const first = before.replace('</srvb:content>', data.replace('base64', 'opaque') + '</srvb:content>');
    expect(bindingActivationMatches(first, after, selected)).toBe(false);
  });
});
