import { expect, it } from 'vitest';
import { assertDdicStateAlternatives } from '../../../scripts/qualification/pr1142/native-ddic-state.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';

const fixture = { type: 'TABL/DTI', name: 'ZTEST~001', owner: '/sap/bc/adt/ddic/db/indexes/ztest~001' };
const root = (href: string, type = 'TABL/DTI', name = 'ZTEST~001') =>
  nativeXmlRoot(
    `<b:blueSource xmlns:b="http://www.sap.com/wbobj/blue" xmlns:c="http://www.sap.com/adt/core" xmlns:a="http://www.w3.org/2005/Atom" c:name="${name}" c:type="${type}"><a:link rel="http://www.sap.com/adt/relations/objectstates" href="${href.replaceAll('&', '&amp;')}"/></b:blueSource>`,
    'blueSource',
    'http://www.sap.com/wbobj/blue',
    true,
  );
it.each([
  './ztest%7e001?version=active',
  './ZTEST%7E001?version=active',
  './ZTEST~001?version=active',
  fixture.owner + '?version=active',
])('admits literal exact index alternative %s', (href) =>
  expect(() => assertDdicStateAlternatives(root(href), fixture, false)).not.toThrow(),
);
it.each([
  './foreign%7e001?version=active',
  './ztest%257e001?version=active',
  './ztest%7e002?version=active',
  '../ztest%7e001?version=active',
  './x/../ztest%7e001?version=active',
  './ztest%7e001',
  './ztest%7e001?version=active&x=1',
  './ztest%7e001?x=1&version=active',
  './ztest%7e001?version=active&version=active',
  './ztest%7e001?version=new',
  './ztest%7e001?version=active#x',
  './ztest%7e001/source/main?version=active',
  '/sap/bc/adt/ddic/db/indexes/ztest%7e001?version=active',
])('refuses unobserved/foreign state spelling %s', (href) =>
  expect(() => assertDdicStateAlternatives(root(href), fixture, false)).toThrow(),
);
it('retains active-with-inactive-alternative refusal', () =>
  expect(() => assertDdicStateAlternatives(root('./ztest%7e001?version=inactive'), fixture, true)).toThrow());
it.each(['missing-type', 'other-type', 'wrong-native-type', 'wrong-native-name', 'wrong-owner'])(
  'encoded alias requires exact index identity %s',
  (fault) => {
    const f = { ...fixture };
    if (fault === 'missing-type') delete (f as { type?: string }).type;
    if (fault === 'other-type') f.type = 'ENQU';
    if (fault === 'wrong-owner') f.owner = '/sap/bc/adt/ddic/db/indexes/foreign~001';
    expect(() =>
      assertDdicStateAlternatives(
        root(
          './ztest%7e001?version=active',
          fault === 'wrong-native-type' ? 'ENQU/DL' : 'TABL/DTI',
          fault === 'wrong-native-name' ? 'OTHER~001' : 'ZTEST~001',
        ),
        f,
        false,
      ),
    ).toThrow();
  },
);
