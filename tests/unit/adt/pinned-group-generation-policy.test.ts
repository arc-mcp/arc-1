import { expect, it } from 'vitest';
import {
  assertPinnedGroupGenerationReferences,
  nativeFunctionGroupExecution,
} from '../../../src/adt/function-activation-metadata.js';
import { nativeActivationExecuted } from '../../../src/adt/native-activation-evidence.js';

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
