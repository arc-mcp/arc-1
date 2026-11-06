import { describe, expect, it } from 'vitest';
import { decodeAuthTraceRows } from '../../../src/adt/authorization-trace.js';
import {
  parseDataPreviewMeta,
  parseDataPreviewResult,
  parseTableContents,
  parseXml,
} from '../../../src/adt/xml-parser.js';

const cells = [
  '   A  B',
  '            X     X',
  '  tail  ',
  '   ',
  '',
  '0001',
  '7 ',
  '&#32;A&amp;B&#32;',
  '<![CDATA[  &amp;  ]]>',
];
const expected = ['   A  B', '            X     X', '  tail  ', '   ', '', '0001', '7 ', ' A&B ', '  &amp;  '];

describe('data-preview whitespace (#982)', () => {
  it.each(['modern', 'asx'])('preserves cell text in the %s format', (format) => {
    const xml =
      format === 'modern'
        ? `<dataPreview:tableData xmlns:dataPreview="http://www.sap.com/adt/dataPreview"><dataPreview:columns><dataPreview:metadata dataPreview:name="K"/><dataPreview:dataSet>${cells.map((cell) => `<dataPreview:data>${cell}</dataPreview:data>`).join('')}</dataPreview:dataSet></dataPreview:columns></dataPreview:tableData>`
        : `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><COLUMNS><COLUMN><METADATA name="K"/><DATASET>${cells.map((cell) => `<DATA>${cell}</DATA>`).join('')}</DATASET></COLUMN></COLUMNS></asx:values></asx:abap>`;
    for (const parse of [parseTableContents, parseDataPreviewResult]) {
      expect(parse(xml)).toMatchObject({ columns: ['K'], rows: expected.map((K) => ({ K })) });
    }
  });

  it('preserves the SQL echo, including literal spaces and line separators', () => {
    const sql = "SELECT '   A  B' AS K\r\n FROM T000  WHERE MANDT &lt;&gt; '999'";
    const xml = `<tableData><executedQueryString>${sql}</executedQueryString><totalRows> 1 </totalRows><queryExecutionTime> 0.25 </queryExecutionTime></tableData>`;
    for (const parse of [parseDataPreviewMeta, parseDataPreviewResult]) {
      expect(parse(xml)).toMatchObject({
        executedQueryString: sql.replace('&lt;&gt;', '<>').replace('\r\n', '\n'),
        totalRows: 1,
        queryExecutionTimeMs: 0.25,
      });
    }
  });

  it('keeps ordinary ADT metadata trimming unchanged', () => {
    expect(parseXml('<root><name>  ZTEST  </name></root>')).toEqual({ root: { name: 'ZTEST' } });
  });
});

it('normalizes numeric trace metadata while retaining significant authorization values', () => {
  const values = { FIRSTCALL: '20261012083000 ', ABAPLINE: '7 ', RC: '0 ', ABAPPROG: 'ZARC_TEST', FIELD1: '  X  ' };
  const xml = `<tableData>${Object.entries(values)
    .map(([name, value]) => `<columns><metadata name="${name}"/><dataSet><data>${value}</data></dataSet></columns>`)
    .join('')}</tableData>`;
  const { rows } = parseDataPreviewResult(xml);
  expect(rows[0]?.FIRSTCALL).toBe('20261012083000 ');
  expect(decodeAuthTraceRows(rows, {}, { maxResults: 1 })[0]).toMatchObject({
    firstSeen: '2026-10-12T08:30:00.000Z',
    codeLocation: 'ZARC_TEST:7',
    rc: 0,
    fields: { FIELD1: '  X  ' },
  });
});
