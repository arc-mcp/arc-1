import { describe, expect, it } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { parseTableType } from '../../../src/adt/ddic-xml.js';
import { SAPWriteSchema, SAPWriteSchemaBtp } from '../../../src/handlers/schemas.js';
import {
  buildCreateXml,
  getMetadataWriteProperties,
  mergeMetadataWriteProperties,
} from '../../../src/handlers/write-helpers.js';

const input = {
  action: 'create',
  type: 'TTYP',
  name: 'ZROWS',
  rowType: 'DEC',
  rowTypeKind: 'builtin',
  rowTypeLength: 5,
  rowTypeDecimals: 2,
};
const build = (properties: Record<string, unknown>) => buildCreateXml('TTYP', 'ZROWS', '$TMP', 'Rows', properties);
const stored = () => parseTableType(build({ ...input, rowTypeLength: '5', rowTypeDecimals: '2' }));
const client = () => ({ getTableType: async () => stored() }) as unknown as AdtClient;

describe.each([
  ['onprem', SAPWriteSchema],
  ['btp', SAPWriteSchemaBtp],
] as const)('public TTYP dimensions (%s)', (_target, schema) => {
  it('writes explicit dimensions through single and batch input extraction', () => {
    const single = schema.parse(input);
    const { action: _action, ...object } = input;
    const batch = schema.parse({ action: 'batch_create', objects: [object] });
    for (const value of [single, batch.objects?.[0]]) {
      expect(value).toBeDefined();
      expect(parseTableType(build(getMetadataWriteProperties(value!)))).toMatchObject({
        rowTypeLength: '000005',
        rowTypeDecimals: '000002',
      });
    }
  });
  it('accepts numeric strings without accepting booleans or empty input', () => {
    expect(schema.parse({ ...input, rowTypeLength: '32', rowTypeDecimals: '0' })).toMatchObject({
      rowTypeLength: 32,
      rowTypeDecimals: 0,
    });
  });
  it.each([-1, 1.5, 1000000, true, '', '1e2', '1.5', null])('refuses invalid dimension %j', (rowTypeLength) => {
    expect(schema.safeParse({ ...input, rowTypeLength }).success).toBe(false);
  });
  it.each([{ type: 'DOMA' }, { action: 'delete' }, { rowTypeKind: 'structure' }])(
    'refuses irrelevant dimensions: %j',
    (patch) => {
      expect(schema.safeParse({ ...input, ...patch }).success).toBe(false);
    },
  );
  it('applies explicit zero decimals and preserves omitted length', async () => {
    const args = schema.parse({ action: 'update', type: 'TTYP', name: 'ZROWS', rowTypeDecimals: 0 });
    const props = await mergeMetadataWriteProperties(client(), 'TTYP', 'ZROWS', getMetadataWriteProperties(args));
    expect(parseTableType(build(props))).toMatchObject({ rowTypeLength: '000005', rowTypeDecimals: '000000' });
  });
  it('updates length while preserving omitted scale', async () => {
    const args = schema.parse({ action: 'update', type: 'TTYP', name: 'ZROWS', rowTypeLength: 7 });
    const props = await mergeMetadataWriteProperties(client(), 'TTYP', 'ZROWS', getMetadataWriteProperties(args));
    expect(parseTableType(build(props))).toMatchObject({ rowTypeLength: '000007', rowTypeDecimals: '000002' });
  });
  it('does not carry dimensions across a row type or kind change', async () => {
    for (const patch of [{ rowType: 'STRING' }, { rowType: 'DEC', rowTypeKind: 'structure' }]) {
      const props = await mergeMetadataWriteProperties(client(), 'TTYP', 'ZROWS', patch);
      expect(props.rowTypeLength).toBeUndefined();
      expect(props.rowTypeDecimals).toBeUndefined();
    }
  });
  it('refuses dimensions for an implicitly resolved dictionary row', () => {
    expect(() => build({ rowType: 'BAPIRET2', rowTypeLength: 5 })).toThrow(/built-in/);
  });
  it('defends the XML boundary against malformed internal dimensions', () => {
    expect(() => build({ ...input, rowTypeLength: '<bad>' })).toThrow(/dimension|rowTypeLength/);
  });
});
