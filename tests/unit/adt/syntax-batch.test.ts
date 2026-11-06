import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseSyntaxBatch } from '../../../src/adt/syntax-batch.js';

const objects = [
  { type: 'CLAS', name: 'ZCL_ARC1_TD_CALC', uri: '/sap/bc/adt/oo/classes/ZCL_ARC1_TD_CALC' },
  { type: 'PROG', name: 'ZARC1_TD_REPORT', uri: '/sap/bc/adt/programs/programs/ZARC1_TD_REPORT' },
];
const fixture = readFileSync(new URL('../../fixtures/xml/syntax-batch-758.xml', import.meta.url), 'utf8');
const report = (index = 0, content = '', attributes = '') =>
  `<checkReport reporter="abapCheckRun" triggeringUri="${objects[index]!.uri}" status="processed" ${attributes}>${content}</checkReport>`;
const parse = (body: string) => parseSyntaxBatch(`<checkRunReports>${body}</checkRunReports>`, objects, 'active');

it('replays native 758 reports and preserves input order when SAP returns a different order', () => {
  expect(parseSyntaxBatch(fixture, objects, 'active')).toMatchObject({ status: 'passed', checkedObjectCount: 2 });
  expect(parse(report(1) + report(0)).results.map((result) => result.name)).toEqual(objects.map((o) => o.name));
});
it('retains every requested object, including missing and duplicate reports', () => {
  for (const body of ['', report(0), report(0) + report(1) + report(1)]) {
    const result = parse(body);
    expect(result.status).toBe('incomplete');
    expect(result.results).toHaveLength(2);
    expect(result.results[1]).toMatchObject({ status: 'not-checked', checked: false });
  }
});
it('preserves errors in later message containers, element text, positions and T100 codes', () => {
  const result = parse(
    report(
      0,
      '<first><msg type="W" shortText="Warning"/></first><later><checkMessage type="E" uri="/sap/bc/adt/oo/classes/z/source/main#start=9,2" code="ERR"><shortText><txt>First</txt><txt>Second</txt></shortText><t100Key msgid="SY" msgno="123"/></checkMessage></later>',
    ) + report(1),
  );
  expect(result.status).toBe('failed');
  expect(result.results[0]!.messages).toContainEqual({
    severity: 'error',
    text: 'First — Second',
    line: 9,
    column: 2,
    uri: '/sap/bc/adt/oo/classes/z/source/main#start=9,2',
    code: 'ERR',
    t100: { id: 'SY', number: '123' },
  });
});
it.each(['notProcessed', '', 'unexpected'])('never treats native status %j as checked', (status) => {
  const result = parse(report(0).replace('status="processed"', `status="${status}"`) + report(1));
  expect(result.status).toBe('incomplete');
  expect(result.results[0]!.checked).toBe(false);
});
it('preserves a known failure even when another object is unchecked', () => {
  const result = parse(report(0, '<msg type="E" shortText="Bad source"/>'));
  expect(result.status).toBe('incomplete');
  expect(result.results[0]).toMatchObject({ status: 'failed', hasErrors: true, checked: true });
  expect(result.results[1]!.status).toBe('not-checked');
});
it.each(['X', '', 'error'])('refuses to certify an unknown severity %j', (severity) => {
  const result = parse(report(0, `<msg type="${severity}" shortText="Unknown finding"/>`) + report(1));
  expect(result.status).toBe('incomplete');
  expect(result.results[0]!.messages[0]!.text).toBe('Unknown finding');
  expect(result.results[0]!.checked).toBe(false);
});
it('retains foreign reports and global messages even after owned reports with messages', () => {
  const result = parse(
    report(0, '<msg type="W" shortText="Owned warning"/>') +
      report(1) +
      report(0, '<msg type="E" shortText="Foreign error"/>').replace('abapCheckRun', 'other') +
      '<checkMessage type="E" shortText="Global error"/>',
  );
  expect(result.status).toBe('incomplete');
  expect(result.unexpectedReports).toHaveLength(1);
  expect(result.unattributedMessages.map((m) => m.text)).toEqual(['Foreign error', 'Global error']);
});
it('matches only the requested namespace identity, allowing SAP literal and encoded names', () => {
  const object = { type: 'CLAS', name: '/ARC/ZDEMO', uri: '/sap/bc/adt/oo/classes/%2FARC%2FZDEMO' };
  for (const uri of [object.uri.toLowerCase(), '/sap/bc/adt/oo/classes//ARC/ZDEMO']) {
    const xml = `<checkRunReports>${report(0).replace(objects[0]!.uri, uri)}</checkRunReports>`;
    expect(parseSyntaxBatch(xml, [object], 'inactive').status).toBe('passed');
  }
  for (const suffix of ['/source/main', '?version=active', '#start=1,0', 'OTHER']) {
    const xml = `<checkRunReports>${report(0).replace(objects[0]!.uri, object.uri + suffix)}</checkRunReports>`;
    expect(parseSyntaxBatch(xml, [object], 'active').status).toBe('incomplete');
  }
});
it.each(['<html/>', '<checkRunReports>', '<feed/>', '<checkMessages/>'])(
  'rejects malformed or unrelated XML %s',
  (xml) => {
    expect(() => parseSyntaxBatch(xml, objects, 'active')).toThrow();
  },
);
it('bounds bytes, report count and nested containers', () => {
  expect(() => parse(' '.repeat(512 * 1024))).toThrow(/oversized/);
  expect(() => parse(report(0).repeat(101))).toThrow(/Too many/);
  expect(() => parse('<x>'.repeat(34) + '</x>'.repeat(34))).toThrow(/nesting/);
});
it('does not invent source identity or independent version confirmation', () => {
  const result = parseSyntaxBatch(fixture, objects, 'inactive');
  expect(result.requestedVersion).toBe('inactive');
  expect(result.sourceEvidence).toContain('no immutable source hash or independent version proof');
  expect(result).not.toHaveProperty('sourceHash');
});

it('refuses nested reports with ambiguous message ownership', () => {
  expect(() => parse(report(0, report(1)))).toThrow(/ownership/);
});
