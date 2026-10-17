import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { parseSyntaxCheckResult } from '../../../src/adt/devtools.js';
import { compileDumpFilters, parseDumpFeedSchema } from '../../../src/adt/feed-schema.js';
import { parseSyntaxBatch } from '../../../src/adt/syntax-batch.js';

const schema = parseDumpFeedSchema(
  readFileSync(new URL('../../fixtures/xml/dumps-schema-758.xml', import.meta.url), 'utf8'),
);
it.each([
  ['<checkRunReports/>', false],
  ['<checkRunReports></checkRunReports>', false],
  ['<checkMessages/>', true],
] as const)('distinguishes empty native reports from legacy message-only success: %s', (xml, checked) => {
  const result = parseSyntaxCheckResult(xml);
  expect(result.checked).toBe(checked);
  if (!checked) expect(result.statusText).toContain('no syntax-check report');
});
it('parses the captured 758 schema without exposing caller-specific variants', () => {
  expect(schema.attributes.find((a) => a.id === 'runtimeError')).toMatchObject({ type: 'string' });
  expect(schema.queryDepth).toBe(2);
  expect(JSON.stringify(schema)).not.toContain('DEVELOPER');
});
it('compiles only target-advertised typed filters and rejects grammar injection and rolled-over dates', () => {
  expect(compileDumpFilters(schema, [{ attribute: 'objectName', operator: 'contains', values: ['ZCL_'] }])).toBe(
    'and(contains(objectName,ZCL_))',
  );
  for (const value of ['x),equals(user,ADMIN)', 'x\\y', "x'y", 'x"y', ' leading'])
    expect(() =>
      compileDumpFilters(schema, [{ attribute: 'objectName', operator: 'equals', values: [value] }]),
    ).toThrow();
  expect(() => compileDumpFilters(schema, [{ attribute: 'unknown', operator: 'equals', values: ['x'] }])).toThrow(
    /advertised/,
  );
  expect(() =>
    compileDumpFilters(schema, [{ attribute: 'datetime', operator: 'equals', values: ['20260231000000'] }]),
  ).toThrow(/Invalid/);
});
it('maps native syntax reports by triggering URI, preserving missing-object coverage', () => {
  const objects = [
    { type: 'CLAS', name: 'ZCL_ARC1_TD_CALC', uri: '/sap/bc/adt/oo/classes/ZCL_ARC1_TD_CALC' },
    { type: 'PROG', name: 'ZARC1_TD_REPORT', uri: '/sap/bc/adt/programs/programs/ZARC1_TD_REPORT' },
    { type: 'PROG', name: 'ABSENT', uri: '/sap/bc/adt/programs/programs/ABSENT' },
  ];
  const xml = readFileSync(new URL('../../fixtures/xml/syntax-batch-758.xml', import.meta.url), 'utf8');
  const result = parseSyntaxBatch(xml, objects, 'active');
  expect(result.results.map((r) => r.status)).toEqual(['passed', 'passed', 'not-checked']);
  expect(result.status).toBe('incomplete');
  expect(() => parseSyntaxBatch('<html/>', objects, 'active')).toThrow();
});
it('cannot pass a batch with an unattached message or unrecognized severity', () => {
  const object = { type: 'PROG', name: 'ZDEMO', uri: '/sap/bc/adt/programs/programs/ZDEMO' };
  const report =
    '<checkReport reporter="abapCheckRun" triggeringUri="/sap/bc/adt/programs/programs/ZDEMO" status="processed"/>';
  expect(
    parseSyntaxBatch(
      `<checkRunReports>${report}<checkMessage type="E" shortText="Unattributed error"/></checkRunReports>`,
      [object],
      'active',
    ).status,
  ).toBe('incomplete');
  expect(
    parseSyntaxBatch(
      `<checkRunReports>${report.replace('/>', '><checkMessage type="X"/></checkReport>')}</checkRunReports>`,
      [object],
      'active',
    ).results[0]?.checked,
  ).toBe(false);
});

const syntaxObject = { type: 'PROG', name: 'ZDEMO', uri: '/sap/bc/adt/programs/programs/ZDEMO' };
const cleanReport =
  '<checkReport reporter="abapCheckRun" triggeringUri="/sap/bc/adt/programs/programs/ZDEMO" status="processed"/>';
it.each([
  '<checkReport reporter="other" triggeringUri="/sap/bc/adt/programs/programs/ZDEMO" status="processed"><checkMessage type="E" shortText="Foreign error"/></checkReport>',
  '<checkReport reporter="abapCheckRun" triggeringUri="/sap/bc/adt/programs/programs/OTHER" status="processed"/>',
])('does not hide an unexpected report: %s', (extra) => {
  const result = parseSyntaxBatch(
    `<checkRunReports>${cleanReport}${extra}</checkRunReports>`,
    [syntaxObject],
    'active',
  );
  expect(result.status).toBe('incomplete');
});
it('retains foreign report messages and refuses duplicate reports', () => {
  const foreign = cleanReport
    .replace('abapCheckRun', 'other')
    .replace('/>', '><checkMessage type="E" shortText="Foreign error"/></checkReport>');
  const result = parseSyntaxBatch(
    `<checkRunReports>${cleanReport}${foreign}</checkRunReports>`,
    [syntaxObject],
    'active',
  );
  expect(result.unattributedMessages).toContainEqual({ type: 'E', text: 'Foreign error' });
  expect(
    parseSyntaxBatch(`<checkRunReports>${cleanReport}${cleanReport}</checkRunReports>`, [syntaxObject], 'active')
      .results[0]?.checked,
  ).toBe(false);
});
it('bounds the syntax parser itself', () => {
  expect(() =>
    parseSyntaxBatch(`<checkRunReports>${' '.repeat(512 * 1024)}</checkRunReports>`, [syntaxObject], 'active'),
  ).toThrow(/oversized/);
});
const feedXml = readFileSync(new URL('../../fixtures/xml/dumps-schema-758.xml', import.meta.url), 'utf8');
it.each(['not-a-number', '1.5', '-2'])('refuses invalid query depth %s', (depth) => {
  expect(() =>
    parseDumpFeedSchema(feedXml.replace(/<[^>]*queryDepth>2<\/[^>]*queryDepth>/g, `<queryDepth>${depth}</queryDepth>`)),
  ).toThrow();
});
it('refuses duplicate feed, attribute and operator identities', () => {
  const entry = [...feedXml.matchAll(/<atom:entry>[\s\S]*?<\/atom:entry>/g)]
    .map((m) => m[0])
    .find((e) => e.includes('<atom:id>/sap/bc/adt/runtime/dumps</atom:id>'))!;
  const attribute = entry.match(/<feed:attribute id="runtimeError">[\s\S]*?<\/feed:attribute>/)![0];
  const operator = entry.match(/<feed:operator id="equals" numberOfOperands="1"[^>]*>[\s\S]*?<\/feed:operator>/)![0];
  for (const fragment of [entry, attribute, operator]) {
    const changed = entry.replace(fragment, fragment + fragment);
    expect(() => parseDumpFeedSchema(feedXml.replace(entry, changed))).toThrow();
  }
});

it('retains unattributed messages after a recognized report with its own findings', () => {
  const warning = cleanReport.replace('/>', '><checkMessage type="W" shortText="Known warning"/></checkReport>');
  const foreign = cleanReport
    .replace('abapCheckRun', 'foreign')
    .replace('/>', '><checkMessage type="E" shortText="Foreign error"/></checkReport>');
  const result = parseSyntaxBatch(
    `<checkRunReports>${warning}${foreign}<checkMessage type="E" shortText="Global error"/></checkRunReports>`,
    [syntaxObject],
    'active',
  );
  expect(result.status).toBe('incomplete');
  expect(result.unattributedMessages).toEqual(
    expect.arrayContaining([
      { type: 'E', text: 'Foreign error' },
      { type: 'E', text: 'Global error' },
    ]),
  );
});
it('keeps all message branches inside a recognized report', () => {
  const report = cleanReport.replace('/>', '<placeholder/>');
  const xml = report.replace(
    '<placeholder/>',
    '><first><checkMessage type="W" shortText="Warning"/></first><second><checkMessage type="E"><shortText><txt>Error in second branch</txt></shortText></checkMessage></second></checkReport>',
  );
  const result = parseSyntaxBatch(`<checkRunReports>${xml}</checkRunReports>`, [syntaxObject], 'active');
  expect(result.status).toBe('failed');
  expect(result.results[0]).toMatchObject({
    hasErrors: true,
    messages: expect.arrayContaining([expect.objectContaining({ text: 'Error in second branch' })]),
  });
});
it('does not hide an error nested inside another message', () => {
  const report = cleanReport.replace(
    '/>',
    '><checkMessage type="W" shortText="Outer"><checkMessage type="E" shortText="Nested error"/></checkMessage></checkReport>',
  );
  const result = parseSyntaxBatch(`<checkRunReports>${report}</checkRunReports>`, [syntaxObject], 'active');
  expect(result.status).toBe('failed');
  expect(result.results[0]).toMatchObject({
    messages: expect.arrayContaining([expect.objectContaining({ text: 'Nested error', severity: 'error' })]),
  });
});
it('keeps a foreign report nested inside a recognized report incomplete', () => {
  const nested = cleanReport.replace('abapCheckRun', 'foreign');
  const report = cleanReport.replace('/>', `>${nested}</checkReport>`);
  const result = parseSyntaxBatch(`<checkRunReports>${report}</checkRunReports>`, [syntaxObject], 'active');
  expect(result.status).toBe('incomplete');
  expect(result.unexpectedReports).toEqual([expect.objectContaining({ reporter: 'foreign' })]);
});
it('refuses duplicate schema containers and ambiguous attribute datatypes', () => {
  const operators = feedXml.match(/<feed:operators>[\s\S]*?<\/feed:operators>/)![0];
  const attributes = feedXml.match(/<feed:attributes>[\s\S]*?<\/feed:attributes>/)![0];
  for (const container of [operators, attributes])
    expect(() => parseDumpFeedSchema(feedXml.replace(container, container + container))).toThrow();
  expect(() =>
    parseDumpFeedSchema(
      feedXml.replace('<feed:dataType id="string"/>', '<feed:dataType id="string"/><feed:dataType id="dateTime"/>'),
    ),
  ).toThrow();
});
