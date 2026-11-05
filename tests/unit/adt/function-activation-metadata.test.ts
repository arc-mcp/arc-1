import { expect, it } from 'vitest';
import {
  assertPinnedGroupGenerationReferences,
  functionActivationMetadata,
  nativeFunctionGroupExecution,
} from '../../../src/adt/function-activation-metadata.js';
import { nativeActivationExecuted } from '../../../src/adt/native-activation-evidence.js';
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

// Exact retained response body from the 1bb2eb43 native FUGR preaudit (record 00154).
const generated =
  '<?xml version="1.0" encoding="utf-8"?><chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties checkExecuted="false" activationExecuted="false" generationExecuted="true"/></chkl:messages>';
const group = '/sap/bc/adt/functions/groups/zarc1_fg';

it('keeps the observed native generation separate from activation evidence', () => {
  expect(nativeFunctionGroupExecution(generated)).toBe('generation');
  expect(nativeActivationExecuted(generated)).toBe(false);
  expect(
    nativeFunctionGroupExecution(generated.replace('activationExecuted="false"', 'activationExecuted="true"')),
  ).toBe('activation');
});

it.each([
  generated.replace('generationExecuted="true"', 'generationExecuted="false"'),
  generated.replace('generationExecuted="true"', 'generationExecuted="True"'),
  generated.replace('generationExecuted="true"', ''),
  generated.replace('activationExecuted="false"', ''),
])('does not infer generation from incomplete execution fields', (xml) => {
  expect(nativeFunctionGroupExecution(xml)).toBeUndefined();
});

it.each([
  generated.replace('http://www.sap.com/abapxml/checklist', 'urn:foreign'),
  generated.replace('checkExecuted="false"', 'generationExecuted="false"'),
  generated.replace('/></chkl:messages>', '/><chkl:properties generationExecuted="true"/></chkl:messages>'),
  generated.replace(
    'generationExecuted="true"',
    'xmlns:x="urn:foreign" generationExecuted="true" x:generationExecuted="true"',
  ),
  generated.replace('generationExecuted=', 'xmlns:x="urn:foreign" x:generationExecuted='),
])('refuses foreign or ambiguous native evidence', (xml) => {
  expect(() => nativeFunctionGroupExecution(xml)).toThrow();
});

it('accepts exactly the selected group and encoded namespace hex equivalence', () => {
  expect(() =>
    assertPinnedGroupGenerationReferences(group, 'ZARC1_FG', [
      { uri: group, name: 'ZARC1_FG', type: 'FUGR/F', deleted: 'false' },
    ]),
  ).not.toThrow();
  const namespaced = '/sap/bc/adt/functions/groups/%2fns%2fgroup';
  expect(() =>
    assertPinnedGroupGenerationReferences(namespaced, '/NS/GROUP', [
      { uri: namespaced.replaceAll('%2f', '%2F'), name: '/NS/GROUP' },
    ]),
  ).not.toThrow();
});

it.each(
  [
    [],
    [{ uri: group }, { uri: group }],
    [{ uri: `${group}/fmodules/zmodule` }],
    [{ uri: `${group}/includes/lzarc1_fgtop` }],
    [{ uri: `${group}/source/main` }],
    [{ uri: `${group}?version=active` }],
    [{ uri: `${group}#fragment` }],
    [{ uri: `https://sap.example${group}` }],
    [{ uri: group, name: 'ZOTHER' }],
    [{ uri: group, type: 'PROG/P' }],
    [{ uri: group, deleted: 'true' }],
  ].map((refs) => ({ refs })),
)('refuses an expanded or inconsistent generation scope $refs', ({ refs }) => {
  expect(() => assertPinnedGroupGenerationReferences(group, 'ZARC1_FG', refs)).toThrow();
});

it.each([
  '/sap/bc/adt/oo/classes/zarc1_fg',
  '/sap/bc/adt/programs/programs/zarc1_fg',
  `${group}/fmodules/zmodule`,
  `${group}?x=1`,
])('cannot grant generation evidence to a different owner %s', (owner) => {
  expect(() => assertPinnedGroupGenerationReferences(owner, 'ZARC1_FG', [{ uri: owner }])).toThrow();
});
