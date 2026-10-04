import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readPublishState } from '../../../src/adt/publish-state.js';

const xml = readFileSync(new URL('../../fixtures/xml/publish-failure/active.xml', import.meta.url), 'utf8');
const name = 'ZARC1_PUBLISH';
describe('strict active V4 UI publication state', () => {
  it('distinguishes explicit true and false without treating bindingCreated as readiness', () => {
    expect(readPublishState(xml, name, '0001')).toBe('unpublished');
    expect(readPublishState(xml.replace('published="false"', 'published="true"'), name, '0001')).toBe('published');
    expect(readPublishState(xml.replace('bindingCreated="true"', 'bindingCreated="false"'), name, '0001')).toBe(
      'unpublished',
    );
  });
  it('uses namespace identity, allowing alternate prefixes and unrelated local declarations', () => {
    expect(readPublishState(xml.replaceAll('srvb:', 'b:').replace('xmlns:srvb=', 'xmlns:b='), name, '0001')).toBe(
      'unpublished',
    );
  });
  it.each([
    ['missing flag', xml.replace('srvb:published="false"', '')],
    ['non-boolean flag', xml.replace('published="false"', 'published="0"')],
    ['inactive', xml.replace('adtcore:version="active"', 'adtcore:version="inactive"')],
    ['wrong name', xml.replace('adtcore:name="ZARC1_PUBLISH"', 'adtcore:name="ZOTHER"')],
    ['wrong type', xml.replace('SRVB/SVB', 'SRVD/SRV')],
    ['wrong binding kind', xml.replace('srvb:type="ODATA"', 'srvb:type="OTHER"')],
    ['V2', xml.replace('srvb:version="V4"', 'srvb:version="V2"')],
    ['Web API', xml.replace('srvb:category="0"', 'srvb:category="1"')],
    ['different service', xml.replace('srvb:name="ZARC1_PUBLISH"', 'srvb:name="ZOTHER"')],
    ['wrong service version', xml.replace('srvb:version="0001"', 'srvb:version="0002"')],
    ['multiple versions', xml.replace('</srvb:services>', '<srvb:content srvb:version="0002"/></srvb:services>')],
    ['wrong namespace', xml.replace('http://www.sap.com/adt/ddic/ServiceBindings', 'urn:wrong')],
    ['prefix rebound', xml.replace('<srvb:binding ', '<srvb:binding xmlns:srvb="urn:wrong" ')],
    ['invalid XML', xml.slice(0, -15)],
    ['DTD', `<!DOCTYPE x>${xml}`],
    ['too large', xml + ' '.repeat(256 * 1024)],
  ])('leaves %s unknown', (_label, body) => {
    expect(readPublishState(body, name, '0001')).toBe('unknown');
  });
});
