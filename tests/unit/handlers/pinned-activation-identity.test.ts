import { expect, it } from 'vitest';
import { nativeInactiveReferences } from '../../../src/adt/native-activation-evidence.js';
import { validatePinnedActivationReferences } from '../../../src/handlers/write/pinned-activation.js';

const owner = '/sap/bc/adt/oo/classes/zcl_test';
it.each(['definitions', 'implementations', 'macros', 'testclasses'])(
  'binds typed %s includes by their exact owner-relative URI',
  (include) => {
    for (const name of ['', 'ZCL_TEST', 'ZCL_TEST         SUBOBJECT'])
      expect(() =>
        validatePinnedActivationReferences(owner, 'CLAS', [
          { uri: `${owner}/includes/${include}`, type: 'CLAS/I', name },
        ]),
      ).not.toThrow();
  },
);
it('retains empty native include names while trimming padded object names', () => {
  const refs = nativeInactiveReferences(
    '<i:inactiveObjects xmlns:i="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:a="http://www.sap.com/adt/core"><i:entry><i:object><i:ref a:uri="' +
      owner +
      '" a:name="  ZCL_TEST  " a:type="CLAS/OC"/><i:ref a:uri="' +
      owner +
      '/includes/definitions" a:name="" a:type="CLAS/I"/></i:object></i:entry></i:inactiveObjects>',
  );
  expect(refs.map((r) => r.name)).toEqual(['ZCL_TEST', '']);
  expect(() => validatePinnedActivationReferences(owner, 'CLAS', refs)).not.toThrow();
});
it('still refuses a foreign owner identity, include type, or source fragment', () => {
  expect(() =>
    validatePinnedActivationReferences(owner, 'CLAS', [{ uri: owner, type: 'CLAS/OC', name: 'ZOTHER' }]),
  ).toThrow();
  expect(() =>
    validatePinnedActivationReferences(owner, 'CLAS', [
      { uri: `${owner}/includes/definitions`, type: 'PROG/I', name: '' },
    ]),
  ).toThrow();
  expect(() =>
    validatePinnedActivationReferences(owner, 'CLAS', [
      { uri: `${owner}/source/main#type=CLAS%2FOM;name=M`, type: 'CLAS/OM/public', name: 'ZCL_TEST M' },
    ]),
  ).toThrow();
});
