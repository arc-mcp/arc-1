import { expect, it } from 'vitest';
import { functionActivationMetadata } from '../../../src/adt/function-activation-metadata.js';
import { pinnedFunctionSelection } from '../../../src/adt/pinned-repository-owner.js';
import fixture from '../../fixtures/function-owners/activation-default-states.json';

const selected = pinnedFunctionSelection('FUNC', 'ZARC1_FN', 'ZARC1_FG');
const { savedDefault, activeDefault, oldActive } = fixture.records;
const proof = (xml: string) => functionActivationMetadata(xml, selected, '$TMP');

it('compares native saved/default metadata while distinguishing the old active representation', () => {
  const saved = proof(savedDefault.xml),
    active = proof(activeDefault.xml),
    old = proof(oldActive.xml);
  expect(saved.version).toBe('inactive');
  expect(active).toMatchObject({ version: 'active', inactiveAlternative: false, hash: saved.hash });
  expect(old).toMatchObject({ version: 'active', inactiveAlternative: true });
});

it('normalizes namespace spellings, volatile attributes and the owned alternative only', () => {
  const renamed = activeDefault.xml
    .replaceAll('adtcore', 'coreAlias')
    .replaceAll('fmodule:', 'moduleAlias:')
    .replace('xmlns:fmodule=', 'xmlns:moduleAlias=');
  expect(proof(renamed).hash).toBe(proof(activeDefault.xml).hash);
  expect(proof(savedDefault.xml).hash).toBe(proof(activeDefault.xml).hash);
});

it.each(['Changed fixture', ' Owned test fixture', 'Owned test fixture '])(
  'retains a meaningful metadata value including whitespace: %j',
  (description) => {
    const changed = activeDefault.xml.replace('description="Owned test fixture"', `description="${description}"`);
    expect(changed).not.toBe(activeDefault.xml);
    expect(proof(changed).hash).not.toBe(proof(activeDefault.xml).hash);
  },
);

it('does not ignore a foreign namespaced volatile-looking field', () => {
  const add = (value: string) =>
    activeDefault.xml.replace('adtcore:name=', `xmlns:x="urn:foreign" x:changedAt="${value}" adtcore:name=`);
  expect(proof(add('one')).hash).not.toBe(proof(add('two')).hash);
});

it.each([
  (xml: string) => xml.replace('version="inactive"', 'version="unknown"'),
  (xml: string) => xml.replace('adtcore:version="inactive"', ''),
  (xml: string) => xml.replace('name="ZARC1_FN"', 'name="ZOTHER"'),
  (xml: string) => xml.replace('version="inactive"', 'version="inactive" xmlns:x="urn:foreign" x:version="active"'),
  (xml: string) => xml.replace('/source/main?version=active', '/source/main?version=inactive&amp;other=1'),
])('refuses a missing, foreign or unsupported native state', (change) => {
  const changed = change(savedDefault.xml);
  expect(changed).not.toBe(savedDefault.xml);
  expect(() => proof(changed)).toThrow();
});

it('refuses duplicate owned state links rather than dropping both from the comparison', () => {
  const link = savedDefault.xml.match(
    /<atom:link[^>]+rel="http:\/\/www.sap.com\/adt\/relations\/objectstates"[^>]*\/>/,
  )?.[0];
  expect(link).toBeDefined();
  expect(() => proof(savedDefault.xml.replace(link!, link! + link!))).toThrow();
});

it.each(['adtcore:version', 'adtcore:changedAt', 'etag'])('preserves nested %s metadata', (attribute) => {
  const add = (value: string) =>
    activeDefault.xml.replace('<adtcore:containerRef ', `<adtcore:containerRef ${attribute}="${value}" `);
  expect(add('one')).not.toBe(activeDefault.xml);
  expect(proof(add('one')).hash).not.toBe(proof(add('two')).hash);
});
