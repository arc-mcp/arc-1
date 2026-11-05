import { expect, it } from 'vitest';
import { pinnedFunctionSelection } from '../../../src/adt/pinned-repository-owner.js';
import { validatePinnedFunctionActivationReferences } from '../../../src/handlers/write/pinned-function-activation.js';

const selected = pinnedFunctionSelection('FUNC', '/NS/ZFUNC', '/NS/ZGROUP');
it('accepts only slash-escape case equivalence for namespaced function references', () => {
  expect(() =>
    validatePinnedFunctionActivationReferences(selected, [
      { uri: selected.objectUrl.replace(/%2F/g, '%2f'), name: selected.name, type: 'FUGR/FF', deleted: 'false' },
    ]),
  ).not.toThrow();
});
it.each([
  `${selected.objectUrl}?version=active`,
  `${selected.objectUrl}/source/main`,
  `https://sap.example${selected.objectUrl}`,
  // Intentionally double-encode only the first namespace separator.
  '/sap/bc/adt/functions/groups/%252Fns%2Fzgroup/fmodules/%2Fns%2Fzfunc',
  selected.objectUrl.replace('zfunc', '%7afunc'),
  selected.groupUrl,
])('rejects another URI representation or scope: %s', (uri) => {
  expect(() => validatePinnedFunctionActivationReferences(selected, [{ uri }])).toThrow('unqualified reference');
});
it.each([{ name: '/NS/ZOTHER' }, { type: 'FUNC' }, { deleted: 'true' }, { deleted: 'unknown' }])(
  'rejects native identity mismatch %j',
  (fields) => {
    expect(() =>
      validatePinnedFunctionActivationReferences(selected, [{ uri: selected.objectUrl, ...fields }]),
    ).toThrow('unqualified reference');
  },
);
it('rejects empty and duplicate expansions', () => {
  expect(() => validatePinnedFunctionActivationReferences(selected, [])).toThrow('unqualified reference');
  expect(() =>
    validatePinnedFunctionActivationReferences(selected, [{ uri: selected.objectUrl }, { uri: selected.objectUrl }]),
  ).toThrow('unqualified reference');
});

const include = pinnedFunctionSelection('INCL', '/NS/LZGROUPF01', '/NS/ZGROUP');
it('accepts the exact namespaced structural include reference', () => {
  expect(() =>
    validatePinnedFunctionActivationReferences(include, [
      { uri: include.objectUrl.replace(/%2F/g, '%2f'), name: include.name, type: 'FUGR/I', deleted: 'false' },
    ]),
  ).not.toThrow();
});
it.each([
  { uri: include.groupUrl },
  { uri: selected.objectUrl, type: 'FUGR/FF' },
  { uri: include.objectUrl.replace('f01', 'f02') },
  { uri: '/sap/bc/adt/programs/includes/%2Fns%2Flzgroupf01' },
  { uri: `${include.objectUrl}?version=active` },
  { uri: `${include.objectUrl}/source/main` },
  { uri: include.objectUrl, type: 'FUGR/F' },
  { uri: include.objectUrl, type: 'FUGR/FF' },
  { uri: include.objectUrl, name: '/NS/LZGROUPF02' },
  { uri: include.objectUrl, deleted: 'true' },
])('refuses structural-include scope expansion or identity mismatch: %j', (reference) => {
  expect(() => validatePinnedFunctionActivationReferences(include, [reference])).toThrow('unqualified reference');
});
it('refuses empty, duplicate, and expanded include confirmations', () => {
  for (const refs of [
    [],
    [{ uri: include.objectUrl }, { uri: include.objectUrl }],
    [{ uri: include.objectUrl }, { uri: include.groupUrl }],
  ])
    expect(() => validatePinnedFunctionActivationReferences(include, refs)).toThrow('unqualified reference');
});
