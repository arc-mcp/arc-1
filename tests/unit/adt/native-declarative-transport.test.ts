import { expect, it } from 'vitest';
import {
  declarativeFixtures,
  declarativeV2Fixtures,
} from '../../../scripts/qualification/pr1142/native-declarative-fixtures.js';
import {
  checkDeclarativeRequest,
  isDeclarativeOwnerUnlock,
} from '../../../scripts/qualification/pr1142/native-declarative-transport.js';
import { buildCreateXml } from '../../../src/handlers/write-helpers.js';

const fixtures = declarativeFixtures('0123456789ABCDEF');
const fixture = fixtures[0];
const core = 'http://www.sap.com/adt/core';
it.each([...fixtures, ...declarativeV2Fixtures('0123456789ABCDEF')])(
  'accepts only the generated $type creation and source packets',
  (f) => {
    const xml = buildCreateXml(f.type, f.name, '$TMP', f.description);
    expect(() =>
      checkDeclarativeRequest(
        f,
        'POST',
        f.owner.replace(/\/[^/]+$/, '') + (f.type === 'BDEF' ? '?_package=%24TMP' : ''),
        xml,
      ),
    ).not.toThrow();
    for (const source of [f.source, f.updatedSource])
      expect(() => checkDeclarativeRequest(f, 'PUT', `${f.owner}/source/main?lockHandle=owned`, source)).not.toThrow();
    expect(() =>
      checkDeclarativeRequest(f, 'PUT', `${f.owner}/source/main?lockHandle=owned`, '// foreign source'),
    ).toThrow();
  },
);
it.each(['true', 'false'])('allows only one selected native activation reference with preaudit=%s', (preaudit) => {
  const url = `/sap/bc/adt/activation?method=activate&preauditRequested=${preaudit}`;
  const ref = `<adtcore:objectReference adtcore:uri="${fixture.owner}" adtcore:name="${fixture.name}"/>`;
  expect(() =>
    checkDeclarativeRequest(
      fixture,
      'POST',
      url,
      `<adtcore:objectReferences xmlns:adtcore="${core}">${ref}</adtcore:objectReferences>`,
    ),
  ).not.toThrow();
  expect(() =>
    checkDeclarativeRequest(
      fixture,
      'POST',
      url,
      `<adtcore:objectReferences xmlns:adtcore="${core}">${ref}${ref}</adtcore:objectReferences>`,
    ),
  ).toThrow();
  expect(() =>
    checkDeclarativeRequest(
      fixture,
      'POST',
      url,
      `<adtcore:objectReferences xmlns:adtcore="${core}">${ref.replace(fixture.owner, fixtures[1].owner)}</adtcore:objectReferences>`,
    ),
  ).toThrow();
});
it.each([
  ['POST', `${fixture.owner}?_action=LOCK&accessMode=MODIFY`],
  ['POST', `${fixture.owner}?_action=UNLOCK&lockHandle=owned`],
  ['DELETE', `${fixture.owner}?lockHandle=owned`],
])('allows the selected owner lifecycle %s %s', (method, path) => {
  expect(() => checkDeclarativeRequest(fixture, method, path)).not.toThrow();
  expect(() => checkDeclarativeRequest(fixture, method, `${path}&sap-client=100`)).toThrow();
  expect(() => checkDeclarativeRequest(fixture, method, path.replace(fixture.owner, fixtures[1].owner))).toThrow();
});
it.each([
  'https://a4h.marianzeis.de/sap/bc/adt/test',
  '/sap/bc/adt/../../foreign',
  '/sap/bc/adt/test#x',
  '/sap/bc/adt/../adt/test',
  '/sap/bc/adt/\\foreign',
])('refuses ambiguous read or write paths: %s', (path) => {
  expect(() => checkDeclarativeRequest(fixture, 'GET', path)).toThrow();
});
it('does not permit a mutation without a selected fixture or an unrelated endpoint', () => {
  expect(() => checkDeclarativeRequest(undefined, 'DELETE', `${fixture.owner}?lockHandle=owned`)).toThrow();
  expect(() => checkDeclarativeRequest(fixture, 'POST', '/sap/bc/adt/runtime/traces')).toThrow();
});
it('checks the selected local CTS request packet', () => {
  const body = `<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0"><asx:values><DATA><DEVCLASS>$TMP</DEVCLASS>\n      <URI>${fixture.owner}</URI><OPERATION>I</OPERATION></DATA></asx:values></asx:abap>`;
  expect(() => checkDeclarativeRequest(fixture, 'POST', '/sap/bc/adt/cts/transportchecks', body)).not.toThrow();
  expect(() =>
    checkDeclarativeRequest(fixture, 'POST', '/sap/bc/adt/cts/transportchecks', body.replace('$TMP', 'ZOTHER')),
  ).toThrow();
});

it('exempts only the exact selected-owner UNLOCK shape', () => {
  expect(isDeclarativeOwnerUnlock(fixture, 'POST', `${fixture.owner}?_action=UNLOCK&lockHandle=owned`)).toBe(true);
  expect(isDeclarativeOwnerUnlock(fixture, 'POST', `${fixture.owner}?lockHandle=owned&_action=UNLOCK`)).toBe(true);
});
it.each([
  ['no selected fixture', undefined, 'POST', `${fixture.owner}?_action=UNLOCK&lockHandle=owned`],
  ['wrong method', fixture, 'GET', `${fixture.owner}?_action=UNLOCK&lockHandle=owned`],
  ['another fixture', fixture, 'POST', `${fixtures[1].owner}?_action=UNLOCK&lockHandle=owned`],
  ['a child path', fixture, 'POST', `${fixture.owner}/source/main?_action=UNLOCK&lockHandle=owned`],
  [
    'a normalized path',
    fixture,
    'POST',
    `${fixture.owner}/../${fixture.name.toLowerCase()}?_action=UNLOCK&lockHandle=o`,
  ],
  ['an absolute URL', fixture, 'POST', `https://a4h.marianzeis.de${fixture.owner}?_action=UNLOCK&lockHandle=owned`],
  ['no handle', fixture, 'POST', `${fixture.owner}?_action=UNLOCK`],
  ['an empty handle', fixture, 'POST', `${fixture.owner}?_action=UNLOCK&lockHandle=`],
  ['an extra field', fixture, 'POST', `${fixture.owner}?_action=UNLOCK&lockHandle=owned&corrNr=X`],
  ['a duplicate field', fixture, 'POST', `${fixture.owner}?_action=UNLOCK&_action=UNLOCK&lockHandle=owned`],
  ['a text match only', fixture, 'POST', `${fixture.owner}?_action=LOCK&accessMode=_action=UNLOCK`],
  ['the wrong action', fixture, 'POST', `${fixture.owner}?_action=LOCK&lockHandle=owned`],
])('does not exempt %s', (_label, selected, method, path) => {
  expect(isDeclarativeOwnerUnlock(selected, method, path)).toBe(false);
});
it.each(['sap-client=100', '%73ap-client=100', 'sap-user=OTHER'])(
  'rejects a read-side identity override: %s',
  (query) => {
    expect(() => checkDeclarativeRequest(fixture, 'GET', `${fixture.owner}?${query}`)).toThrow();
  },
);
