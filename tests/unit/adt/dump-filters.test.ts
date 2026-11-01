import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { compileDumpFilters, parseDumpFeedSchema } from '../../../src/adt/feed-schema.js';

const feedXml = readFileSync(new URL('../../fixtures/xml/dumps-schema-758.xml', import.meta.url), 'utf8');
const schema = parseDumpFeedSchema(feedXml);
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
it.each(['*', 'A*', 'A B', '', 'A\nB', 'A,B', 'A(B)'])('rejects unqualified string grammar %j', (value) => {
  expect(() =>
    compileDumpFilters(schema, [{ attribute: 'runtimeError', operator: 'equals', values: [value] }]),
  ).toThrow();
});
it('rejects wrong operands, shallow metadata, reversed ranges and malformed XML', () => {
  expect(() =>
    compileDumpFilters(schema, [{ attribute: 'runtimeError', operator: 'equals', values: ['X', 'Y'] }]),
  ).toThrow();
  expect(() =>
    compileDumpFilters({ ...schema, queryDepth: 1 }, [
      { attribute: 'runtimeError', operator: 'equals', values: ['X'] },
    ]),
  ).toThrow();
  expect(() =>
    compileDumpFilters(schema, [
      { attribute: 'datetime', operator: 'between', values: ['20261018000000', '20261017000000'] },
    ]),
  ).toThrow(/reversed/);
  expect(() => parseDumpFeedSchema('<feed>')).toThrow();
  expect(() => parseDumpFeedSchema(`<feed>${' '.repeat(256 * 1024)}</feed>`)).toThrow(/oversized/);
});
