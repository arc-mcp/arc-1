import { expect, it } from 'vitest';
import { enhoInterfaceContract } from '../../../scripts/qualification/pr1142/native-enho-dependencies.js';
import {
  ENHO_BADI,
  ENHO_INTERFACE,
  ENHO_STAGES,
  enhoFixtures,
} from '../../../scripts/qualification/pr1142/native-enho-fixtures.js';
import { checkEnhoRequest } from '../../../scripts/qualification/pr1142/native-enho-transport.js';

const f = enhoFixtures('0123456789AB');
const api =
  'interface IF_ADT_DISCOVERY_PROVIDER public . interfaces IF_BADI_INTERFACE . methods REGISTER_WORKSPACES importing !REGISTRY type ref to IF_ADT_DISCOVERY_REGISTRY . endinterface.';
it('fixes two fresh owners, an empty own interface stub and a disabled unique-filter implementation', () => {
  expect(f.map((v) => v.type)).toEqual(['CLAS', 'ENHO']);
  expect(f.every((v) => v.name.length <= 30 && v.packageName === '$TMP')).toBe(true);
  expect(f[1].dependencies).toEqual([f[0].owner]);
  expect(f[0].create.source.toLowerCase()).toContain(`interfaces ${ENHO_INTERFACE.toLowerCase()}.`);
  expect(f[0].create.source).toContain('METHOD if_adt_discovery_provider~register_workspaces.\n  ENDMETHOD.');
  expect(f[0].create.source).not.toMatch(/\b(?:CALL|SELECT|SUBMIT|EXEC|INSERT|MODIFY|DELETE)\b/i);
  const def = JSON.parse(f[1].create.source);
  expect(def.badiImplementations).toEqual([
    expect.objectContaining({
      badiDefinition: ENHO_BADI,
      implementingClass: f[0].name,
      active: false,
      default: false,
      filter: "URI = '/arc1/qualification/0123456789ab'",
    }),
  ]);
  expect(JSON.parse(f[1].update.source!).badiImplementations[0]).not.toHaveProperty('filter');
  expect(ENHO_STAGES.slice(-2)).toEqual(['delete-ENHO', 'delete-CLAS']);
  expect(enhoFixtures('BA9876543210').every((v) => !f.some((old) => old.owner === v.owner))).toBe(true);
});
it.each(['a'.repeat(12), '1'.repeat(11), '1'.repeat(13), '../0123456789AB', '0123456789AG'])(
  'rejects suffix %s',
  (suffix) => expect(() => enhoFixtures(suffix)).toThrow(),
);
it('qualifies the exact declaration contract and ignores only native full-line comments', () => {
  expect(() => enhoInterfaceContract('* synthetic declaration comment\r\n' + api + '\r\n')).not.toThrow();
});
it.each([
  api.replace('IF_BADI_INTERFACE', 'IF_OTHER'),
  api.replace('importing', 'changing'),
  api.replace('REGISTRY type', 'REGISTRY optional type'),
  api.replace('endinterface.', 'methods EXTRA . endinterface.'),
  api + ' unknown.',
  api.replace('IF_ADT_DISCOVERY_REGISTRY', 'IF_OTHER'),
])('refuses changed interface contract', (source) => expect(() => enhoInterfaceContract(source)).toThrow());
it.each([
  ['GET', '/sap/bc/adt/oo/classes/foreign'],
  ['DELETE', '/sap/bc/adt/enhancements/enhsxsb/sadt_rest_rfc_application?lockHandle=x'],
  ['PUT', '/sap/bc/adt/oo/interfaces/if_adt_discovery_provider'],
  ['POST', f[1].owner + '?_action=LOCK&accessMode=MODIFY&accessMode=MODIFY'],
  ['GET', f[0].owner + '?sap-client=002'],
  ['GET', f[0].owner + '?version=foreign'],
  ['GET', f[0].owner + '/../foreign'],
  ['GET', 'https://other.invalid' + f[0].owner],
  ['POST', f[0].owner + '?_action=UNLOCK&lockHandle=x&extra=1'],
])('refuses unowned/ambiguous wire request %s %s', (method, path) =>
  expect(() => checkEnhoRequest(f, 'create-ENHO', method, path)).toThrow(),
);
it('does not permit a stale update PUT or a supplied foreign document body', () => {
  const path = f[1].owner + '?lockHandle=synthetic';
  expect(() => checkEnhoRequest(f, 'stale-ENHO', 'PUT', path, 'compiled', 'empty', 'compiled')).toThrow();
  expect(() => checkEnhoRequest(f, 'update-ENHO', 'PUT', path, 'foreign', 'empty', 'compiled')).toThrow();
  expect(() => checkEnhoRequest(f, 'update-ENHO', 'PUT', path, 'compiled', 'empty', 'compiled')).not.toThrow();
});
