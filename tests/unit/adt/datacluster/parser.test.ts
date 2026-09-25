/**
 * Ported (structure and assertions) from vibing-steampunk's
 * `pkg/datacluster/cluster_test.go` and `layout_test.go`, against the same
 * hex fixtures (`tests/fixtures/datacluster/`), to give this independent
 * TypeScript port the same correctness bar as the Go original.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeDecfloat } from '../../../../src/adt/datacluster/decfloat.js';
import { decodeHex, type Fragment, joinFragments } from '../../../../src/adt/datacluster/fragments.js';
import {
  applyLayout,
  applyNames,
  ComponentKind,
  type Layout,
  objectRecords,
  sapScriptText,
  TLINE_LAYOUT,
} from '../../../../src/adt/datacluster/layout.js';
import { parseCluster } from '../../../../src/adt/datacluster/parser.js';
import {
  type Cluster,
  type ClusterObject,
  findObject,
  ObjectKind,
  TYPE_CHAR,
} from '../../../../src/adt/datacluster/types.js';
import { decodePacked } from '../../../../src/adt/datacluster/values.js';

const FIXTURES = join(__dirname, '../../../fixtures/datacluster');

function loadHex(name: string): Buffer {
  const raw = readFileSync(join(FIXTURES, name), 'utf8').trim();
  return Buffer.from(raw, 'hex');
}

// The row every STRUCT-typed object in the INDX fixtures holds.
const structValues: unknown[] = [
  'ABC',
  '000042',
  '20260904',
  '123456',
  -7,
  200,
  -300,
  1234567890123n,
  '-12345.67',
  2.5,
  'DEADBEEF',
  'a string value',
  'CAFE',
  '3.14159',
  '20260904123456.1234567',
];
const structTypes = [
  'CHAR',
  'NUMC',
  'DATS',
  'TIMS',
  'INT4',
  'INT1',
  'INT2',
  'INT8',
  'DEC',
  'FLTP',
  'RAW',
  'STRING',
  'XSTRING',
  'DF34',
  'DEC',
];

function checkFields(obj: { fields: { type: string }[]; name: string }, types: string[]): void {
  expect(obj.fields.map((f) => f.type)).toEqual(types);
}

describe('parseCluster: INDX fixtures', () => {
  for (const tc of [
    { file: 'indx_plain.hex', compressed: false, objects: 2 },
    { file: 'indx_compressed.hex', compressed: true, objects: 5 },
  ]) {
    it(tc.file, () => {
      const c = parseCluster(loadHex(tc.file));
      expect(c.compressed).toBe(tc.compressed);
      expect(c.codepage).toBe('4103');
      expect(c.version).toBe(6);
      if (tc.compressed) expect(c.algorithm).toBe('LZH');
      expect(c.objects).toHaveLength(tc.objects);

      const st = findObject(c, 'STRUCT');
      expect(st?.kind).toBe(ObjectKind.Structure);
      expect(st?.rowLength).toBe(160);
      expect(st?.rows).toHaveLength(1);
      if (!tc.compressed) expect(st?.size).toBe(389);
      checkFields(st!, structTypes);
      expect(st?.rows[0]).toEqual(structValues);
      expect(st?.fields[8]?.decimals).toBe(2);
      expect(st?.fields[14]?.decimals).toBe(7);

      const tab = findObject(c, 'TABLE');
      expect(tab?.kind).toBe(ObjectKind.Table);
      expect(tab?.rows).toHaveLength(2);
      checkFields(tab!, structTypes);
      expect(tab?.rows[0]).toEqual(structValues);
      const row2 = [...structValues];
      row2[0] = 'row2';
      row2[4] = 2;
      expect(tab?.rows[1]).toEqual(row2);

      if (!tc.compressed) return;

      const nested = findObject(c, 'NESTED');
      expect(nested?.rowLength).toBe(192);
      expect(nested?.rows).toHaveLength(1);
      const wantPaths = ['1', ...Array.from({ length: 15 }, (_, i) => `2.${i + 1}`), '3'];
      expect(nested?.fields.map((f) => f.path)).toEqual(wantPaths);
      const want = ['HEAD', ...structValues, '99'];
      expect(nested?.rows[0]).toEqual(want);
      // HEAD, an alignment filler, the inner structure (15 fields and 4 fillers), the tail, a
      // trailing filler.
      expect(nested?.type.children).toHaveLength(5);
      expect(nested?.type.children?.[1]?.filler).toBe(true);
      expect(nested?.type.children?.[2]?.children).toHaveLength(19);

      const scalar = findObject(c, 'SCALAR');
      expect(scalar?.kind).toBe(ObjectKind.Elementary);
      expect(scalar?.fields[0]?.type).toBe('CHAR');
      expect(scalar?.rows[0]?.[0]).toBe('a bare elementary field');

      const number = findObject(c, 'NUMBER');
      expect(number?.kind).toBe(ObjectKind.Elementary);
      expect(number?.fields[0]?.type).toBe('INT4');
      expect(number?.rows[0]?.[0]).toBe(4711);
    });
  }
});

describe('parseCluster: BALDAT', () => {
  it('decodes an application log', () => {
    const c = parseCluster(loadHex('baldat_a4h.hex'));
    const names: string[] = [];
    for (const o of c.objects) {
      expect(o.kind).toBe(ObjectKind.Table);
      if (o.rows.length > 0) names.push(`${o.name}:${o.rows.length}`);
    }
    expect(names.join(' ')).toBe('T_2000:3 T_MHDR:3');

    const msgs = findObject(c, 'T_2000')!;
    // number, four 50-char variables, two flags, four flags, a one-plus-three include, then
    // type, class, number, detail level, problem class, sort, timestamp, count.
    expect(msgs.rowLength).toBe(12 + 400 + 4 + 8 + 8 + 76);
    expect(msgs.fields).toHaveLength(5 + 2 + 4 + 4 + 8);

    const empty = findObject(c, 'T_1000')!;
    expect(empty.rows).toHaveLength(0);
    expect(empty.rowLength).toBe(12 + 160 + 4 + 8 + 8 + 76);

    const row = msgs.rows[0]!;
    expect(row[0]).toBe('000001');
    expect(row[1]).toBe('Periodic mode - checking all active runs');
    const tail = row.slice(row.length - 8);
    expect(tail[0]).toBe('I');
    expect(tail[1]).toBe('BL');
    expect(tail[2]).toBe('001');
    expect(tail[7]).toBe(1);
    expect(String(tail[6])).toMatch(/^2026.*\./);

    const dir = findObject(c, 'T_MHDR')!;
    expect(dir.rows[2]?.[0]).toBe('000003');
    expect(dir.rows[2]?.[1]).toBe('2');
  });
});

describe('parseCluster: rejects malformed input', () => {
  const blob = loadHex('indx_plain.hex');
  it.each([
    ['short', blob.subarray(0, 10)],
    ['no marker', Buffer.concat([Buffer.from([0]), blob.subarray(1)])],
    ['format', Buffer.concat([blob.subarray(0, 4), Buffer.from([9]), blob.subarray(5)])],
    ['truncated', blob.subarray(0, Math.floor(blob.length / 2))],
    ['no end', blob.subarray(0, blob.length - 1)],
  ])('%s', (_name, bad) => {
    expect(() => parseCluster(bad)).toThrow();
  });

  it('rejects a damaged compressed body', () => {
    const comp = loadHex('indx_compressed.hex');
    const damaged = Buffer.from(comp);
    damaged[100] ^= 0xff;
    expect(() => parseCluster(damaged)).toThrow();
  });
});

describe('joinFragments', () => {
  it('reassembles out-of-order, zero-padded fragments', () => {
    const whole = loadHex('indx_plain.hex');
    const frags: Fragment[] = [];
    for (let i = 0; i * 512 < whole.length; i++) {
      const end = Math.min((i + 1) * 512, whole.length);
      const padded = Buffer.alloc(512);
      whole.copy(padded, 0, i * 512, end);
      frags.push({ seq: i, length: end - i * 512, data: padded });
    }
    // Out of order on purpose.
    [frags[0], frags[1]] = [frags[1]!, frags[0]!];
    const got = joinFragments(frags);
    expect(got.equals(whole)).toBe(true);
    expect(() => joinFragments(frags.slice(0, 1))).toThrow();
    expect(() => joinFragments([...frags, frags[0]!])).toThrow();
  });
});

describe('decodeHex', () => {
  it('accepts whitespace and mixed case', () => {
    expect(decodeHex('DE AD\nBE\tEF').toString('hex')).toBe('deadbeef');
    expect(decodeHex('deadbeef').toString('hex')).toBe('deadbeef');
  });
  it('rejects non-hex input', () => {
    expect(() => decodeHex('zz')).toThrow();
  });
});

describe('decodeDecfloat', () => {
  it.each([
    // decfloat34 3.14159 as the fixture holds it.
    ['D9500600000000000000000000C00622', '3.14159'],
    // decfloat34 zero.
    ['00000000000000000000000000004022', '0'],
  ])('%s -> %s', (hex, want) => {
    expect(decodeDecfloat(Buffer.from(hex, 'hex'))).toBe(want);
  });
});

describe('decodePacked', () => {
  it.each([
    ['000000001234567D', 2, '-12345.67'],
    ['000000001234567C', 2, '12345.67'],
    ['0C', 0, '0'],
    ['005C', 3, '0.005'],
    ['202609041234561234567C', 7, '20260904123456.1234567'],
  ])('%s/%d -> %s', (hex, dec, want) => {
    expect(decodePacked(Buffer.from(hex, 'hex'), dec)).toBe(want);
  });
});

// The EUFUNC fixtures are version 5 clusters — written by a pre-Unicode kernel in code page 1100
// and still on disk after the conversion — from the Function Builder's test data.
describe('parseCluster: legacy (version 5)', () => {
  it('reads the function directory fixture', () => {
    const c = parseCluster(loadHex('eufunc_v5.hex'));
    expect(c.version).toBe(5);
    expect(c.codepage).toBe('1100');
    expect(c.compressed).toBe(true);
    expect(c.objects).toHaveLength(3);

    const dir = findObject(c, 'TE_DATADIR')!;
    expect(dir.kind).toBe(ObjectKind.Table);
    expect(dir.rows).toHaveLength(0);
    expect(dir.fields).toHaveLength(6);
    expect(dir.fields[5]?.length).toBe(40);

    const iface = findObject(c, 'FDESC_COPY')!;
    expect(iface.rows).toHaveLength(8);
    expect(iface.fields).toHaveLength(8);
    const row = iface.rows[0]!;
    expect(row[0]).toBe('EVENTID');
    expect(row[1]).toBe('TBTCM-EVENTID');
    expect(row[2]).toBe('C');
    expect(row[5]).toBe('32');
    expect(row[7]).toBe(0);

    const el = findObject(c, 'D102_FNAME')!;
    expect(el.kind).toBe(ObjectKind.Elementary);
    expect(el.rows[0]?.[0]).toBe('GET_JOB_RUNTIME_INFO');
  });

  it('reads the plain (uncompressed) fixture', () => {
    const c = parseCluster(loadHex('eufunc_v5_plain.hex'));
    const want: Record<string, unknown> = {
      '%_ISTRING1': 'ABC',
      '%_ISTRING2': 'XYZ',
      TIME1: '900',
      V_RC: 0,
      VEXCEPTION: '',
      '%_VSTRING': 'ABCXYZ',
    };
    expect(c.objects).toHaveLength(Object.keys(want).length);
    for (const [name, v] of Object.entries(want)) {
      const o = findObject(c, name)!;
      expect(o.kind).toBe(ObjectKind.Elementary);
      expect(o.rows).toHaveLength(1);
      expect(o.rows[0]?.[0]).toBe(v);
    }
  });
});

const tyAll: Layout = {
  name: 'TY_ALL',
  components: [
    { name: 'F_CHAR', type: 'CHAR', chars: 10 },
    { name: 'F_NUMC', type: 'NUMC', chars: 6 },
    { name: 'F_DATS', type: 'DATS', chars: 8 },
    { name: 'F_TIMS', type: 'TIMS', chars: 6 },
    { name: 'F_INT', type: 'INT4', chars: 10 },
    { name: 'F_INT1', type: 'INT1', chars: 3 },
    { name: 'F_INT2', type: 'INT2', chars: 5 },
    { name: 'F_INT8', type: 'INT8', chars: 19 },
    { name: 'F_P', type: 'DEC', chars: 15, decimals: 2 },
    { name: 'F_FLTP', type: 'FLTP', chars: 16 },
    { name: 'F_RAW', type: 'RAW', chars: 4 },
    { name: 'F_STR', type: 'STRG' },
    { name: 'F_XSTR', type: 'RSTR' },
    { name: 'F_DEC', type: 'D34D', chars: 34 },
    { name: 'F_TS', type: 'DEC', chars: 21, decimals: 7 },
  ],
};

describe('applyLayout', () => {
  it('names a flat structure, a nested structure and an elementary field', () => {
    const c = parseCluster(loadHex('indx_compressed.hex'));
    const st = findObject(c, 'STRUCT')!;
    applyLayout(st, tyAll);
    const rec = objectRecords(st)[0]!;
    expect(rec.F_CHAR).toBe('ABC');
    expect(rec.F_TS).toBe('20260904123456.1234567');
    expect(rec.F_XSTR).toBe('CAFE');

    const nested = findObject(c, 'NESTED')!;
    const tyNested: Layout = {
      name: 'TY_NESTED',
      components: [
        { name: 'HEAD', type: 'CHAR', chars: 4 },
        { name: 'INNER', kind: ComponentKind.Substructure, type: 'TY_ALL', sub: tyAll },
        { name: 'TAIL', type: 'NUMC', chars: 2 },
      ],
    };
    applyLayout(nested, tyNested);
    const nrec = objectRecords(nested)[0]!;
    expect(nrec.HEAD).toBe('HEAD');
    expect(nrec['INNER.F_INT']).toBe(-7);
    expect(nrec.TAIL).toBe('99');
    expect(nested.fields[1]?.name).toBe('INNER.F_CHAR');
    expect(nested.fields[1]?.path).toBe('2.1');

    const scalar = findObject(c, 'SCALAR')!;
    applyLayout(scalar, { name: 'X', components: [{ name: 'VALUE', type: 'CHAR', chars: 23 }] });
    expect(scalar.fields[0]?.name).toBe('VALUE');
  });

  it('refuses a layout that does not fit, and names nothing', () => {
    const clone = (edit: (l: Layout) => void): Layout => {
      const l: Layout = { name: 'BAD', components: tyAll.components.map((c2) => ({ ...c2 })) };
      edit(l);
      return l;
    };
    const cases: Record<string, Layout> = {
      'too short': clone((l) => {
        l.components = l.components.slice(0, 14);
      }),
      'too long': clone((l) => {
        l.components = [...l.components, { name: 'X', type: 'CHAR', chars: 1 }];
      }),
      'wrong length': clone((l) => {
        l.components[0]!.chars = 11;
      }),
      'wrong type': clone((l) => {
        l.components[4]!.type = 'FLTP';
      }),
      'wrong decimals': clone((l) => {
        l.components[8]!.decimals = 3;
      }),
      'field for struct': clone((l) => {
        l.components[0] = {
          name: 'S',
          kind: ComponentKind.Substructure,
          sub: { name: '', components: [{ name: 'A', type: 'CHAR', chars: 5 }] },
        };
      }),
      'table type': clone((l) => {
        l.components[0]!.kind = ComponentKind.Table;
      }),
    };
    for (const [name, l] of Object.entries(cases)) {
      // Re-parse per case: applyLayout mutates field names on success, and a case must start clean.
      const cc = parseCluster(loadHex('indx_compressed.hex'));
      const target = findObject(cc, 'STRUCT')!;
      expect(() => applyLayout(target, l), name).toThrow();
      for (const f of target.fields) {
        expect(f.name, `${name}: a refused layout still named field ${f.path}`).toBeUndefined();
      }
    }
  });

  it('names fields spread across nested includes (BAL message bucket)', () => {
    const c = parseCluster(loadHex('baldat_a4h.hex'));
    const flag = (n: string) => ({ name: n, type: 'CHAR', chars: 1 });
    const l: Layout = {
      name: 'BUCKET',
      components: [
        { name: 'MSGNUMBER', type: 'NUMC', chars: 6 },
        {
          name: 'VARS',
          kind: ComponentKind.Substructure,
          sub: {
            name: '',
            components: [
              { name: 'MSGV1', type: 'CHAR', chars: 50 },
              { name: 'MSGV2', type: 'CHAR', chars: 50 },
              { name: 'MSGV3', type: 'CHAR', chars: 50 },
              { name: 'MSGV4', type: 'CHAR', chars: 50 },
            ],
          },
        },
        { name: '.INCLUDE', kind: ComponentKind.Include, sub: { name: '', components: [flag('CTX1'), flag('CTX2')] } },
        {
          name: 'FLAGS',
          kind: ComponentKind.Substructure,
          sub: { name: '', components: [flag('A'), flag('B'), flag('C'), flag('D')] },
        },
        {
          name: '.INCLUDE',
          kind: ComponentKind.Include,
          sub: {
            name: '',
            components: [
              flag('E'),
              {
                name: '.INCLUDE',
                kind: ComponentKind.Include,
                sub: { name: '', components: [flag('F'), flag('G'), flag('H')] },
              },
            ],
          },
        },
        {
          name: 'MSG',
          kind: ComponentKind.Substructure,
          sub: {
            name: '',
            components: [
              flag('MSGTY'),
              { name: 'MSGID', type: 'CHAR', chars: 20 },
              { name: 'MSGNO', type: 'NUMC', chars: 3 },
              flag('DETLEVEL'),
              flag('PROBCLASS'),
              { name: 'ALSORT', type: 'CHAR', chars: 3 },
              { name: 'TIME_STMP', type: 'DEC', chars: 21, decimals: 7 },
              { name: 'MSG_COUNT', type: 'INT4', chars: 10 },
            ],
          },
        },
      ],
    };
    const obj = findObject(c, 'T_2000')!;
    applyLayout(obj, l);
    const rec = objectRecords(obj)[0]!;
    expect(rec.MSGNUMBER).toBe('000001');
    expect(rec['VARS.MSGV1']).toBe('Periodic mode - checking all active runs');
    expect(rec['MSG.MSGID']).toBe('BL');
    expect(rec.H).toBe('');
    const names = obj.fields.map((f) => f.name).join(',');
    expect(names).toContain('CTX1,CTX2,FLAGS.A');
    expect(names).toContain('E,F,G,H,MSG.MSGTY');
  });
});

describe('sapScriptText', () => {
  it('joins TLINE rows the way the editor shows them', () => {
    const c: Cluster = {
      version: 6,
      codepage: '4103',
      compressed: false,
      objects: [
        {
          name: 'TLINE',
          kind: ObjectKind.Table,
          typeCode: 0,
          rowLength: 268,
          size: 0,
          charBytes: 2 as const,
          type: {
            path: '',
            typeCode: 0,
            length: 268,
            decimals: 0,
            children: [
              { path: '1', typeCode: TYPE_CHAR, length: 4, decimals: 0 },
              { path: '2', typeCode: TYPE_CHAR, length: 264, decimals: 0 },
            ],
          },
          fields: [
            { path: '1', type: 'CHAR', typeCode: TYPE_CHAR, length: 4 },
            { path: '2', type: 'CHAR', typeCode: TYPE_CHAR, length: 264 },
          ],
          rows: [
            ['*', 'Dear customer,'],
            ['', 'your order'],
            ['=', ' 4711 shipped.'],
            ['/:', 'INCLUDE ZFOOTER'],
          ],
        },
      ],
    };
    const { lines, text } = sapScriptText(c);
    expect(lines).toHaveLength(4);
    expect(lines[0]?.format).toBe('*');
    expect(text).toBe('Dear customer,\nyour order 4711 shipped.\nINCLUDE ZFOOTER');
    expect(c.objects[0]?.fields[1]?.name).toBe('TDLINE');
  });

  it('rejects a cluster without TLINE', () => {
    expect(() => sapScriptText({ version: 6, codepage: '4103', compressed: false, objects: [] })).toThrow();
  });
});

// indx_ddic.hex was written by a program exporting a BAPIRET2 structure, a TLINE table and a
// BAL_S_CONT structure: flat DDIC types, which the kernel marks with the flat object kinds 02/03.
describe('applyLayout: DDIC layouts', () => {
  it('names BAPIRET2, TLINE and BAL_S_CONT', () => {
    const c = parseCluster(loadHex('indx_ddic.hex'));
    expect(c.objects).toHaveLength(3);
    const ch = (n: string, l: number) => ({ name: n, type: 'CHAR', chars: l });
    const bapiret2: Layout = {
      name: 'BAPIRET2',
      components: [
        ch('TYPE', 1),
        ch('ID', 20),
        { name: 'NUMBER', type: 'NUMC', chars: 3 },
        ch('MESSAGE', 220),
        ch('LOG_NO', 20),
        { name: 'LOG_MSG_NO', type: 'NUMC', chars: 6 },
        ch('MESSAGE_V1', 50),
        ch('MESSAGE_V2', 50),
        ch('MESSAGE_V3', 50),
        ch('MESSAGE_V4', 50),
        ch('PARAMETER', 32),
        { name: 'ROW', type: 'INT4', chars: 10 },
        ch('FIELD', 30),
        ch('SYSTEM', 10),
      ],
    };
    const ret = findObject(c, 'RET')!;
    expect(ret.kind).toBe(ObjectKind.Structure);
    applyLayout(ret, bapiret2);
    const rec = objectRecords(ret)[0]!;
    expect(rec.TYPE).toBe('E');
    expect(rec.ID).toBe('ZDEMO');
    expect(rec.NUMBER).toBe('017');
    expect(rec.ROW).toBe(3);
    expect(rec.FIELD).toBe('VBELN');

    const lines = findObject(c, 'LINES')!;
    expect(lines.kind).toBe(ObjectKind.Table);
    expect(lines.rows).toHaveLength(3);
    applyLayout(lines, TLINE_LAYOUT);
    expect(objectRecords(lines)[2]?.TDLINE).toBe(' 4711 shipped.');

    const cont = findObject(c, 'CONT')!;
    applyLayout(cont, { name: 'BAL_S_CONT', components: [ch('TABNAME', 30), ch('VALUE', 256)] });
    expect(objectRecords(cont)[0]?.TABNAME).toBe('ZDEMO_ORDER_KEY');
  });
});

// indx_deep.hex probes the deep cases: a BAL_S_MSG with two parameter rows in its T_PAR table, a
// table whose rows each hold a table, sorted/hashed tables, a table of strings, a bare string, a
// bare xstring, an INT8 and a packed number with two decimals.
describe('parseCluster: deep cases (indx_deep.hex)', () => {
  it('decodes nested tables and every scalar kind', () => {
    const c = parseCluster(loadHex('indx_deep.hex'));
    expect(c.objects).toHaveLength(9);

    const msg = findObject(c, 'MSG')!;
    expect(msg.fields).toHaveLength(23);
    expect(msg.fields[18]?.type).toBe('TABLE');
    expect(msg.fields[18]?.fields).toHaveLength(2);
    expect(msg.fields[18]?.fields?.[1]?.length).toBe(150);
    expect(JSON.stringify(msg.rows[0]?.[18])).toBe(
      JSON.stringify([
        ['COMP', 'TM'],
        ['SUB', ''],
      ]),
    );

    const orders = findObject(c, 'ORDERS')!;
    expect(orders.rows).toHaveLength(2);
    expect(JSON.stringify(orders.rows[0])).toBe(
      JSON.stringify([
        'O1',
        [
          [1, 'first'],
          [2, 'second'],
        ],
        'two',
      ]),
    );
    expect(JSON.stringify(orders.rows[1])).toBe(JSON.stringify(['O2', [], 'none']));

    const sorted = findObject(c, 'SORTED')!;
    expect(JSON.stringify(sorted.rows)).toBe(
      JSON.stringify([
        [1, 'a'],
        [3, 'c'],
      ]),
    );

    const hashed = findObject(c, 'HASHED')!;
    expect(JSON.stringify(hashed.rows)).toBe(JSON.stringify([[9, 'z']]));

    const strings = findObject(c, 'STRINGS')!;
    expect(JSON.stringify(strings.rows)).toBe(JSON.stringify([['alpha'], [''], ['gamma']]));
    expect(strings.fields[0]?.type).toBe('STRING');

    const str = findObject(c, 'STR')!;
    expect(str.kind).toBe(ObjectKind.Elementary);
    expect(str.rows[0]?.[0]).toBe('a bare string');

    const xstr = findObject(c, 'XSTR')!;
    expect(xstr.rows[0]?.[0]).toBe('CAFEBABE');

    const i8 = findObject(c, 'I8')!;
    expect(i8.rows[0]?.[0]).toBe(42n);

    const pk = findObject(c, 'PK')!;
    expect(pk.rows[0]?.[0]).toBe('-1.50');
    expect(pk.fields[0]?.decimals).toBe(2);
  });
});

describe('applyLayout: nested tables', () => {
  it('names BAL_S_MSG including its T_PAR table and CALLBACK substructure', () => {
    const c = parseCluster(loadHex('indx_deep.hex'));
    const ch = (n: string, l: number) => ({ name: n, type: 'CHAR', chars: l });
    const balSPar: Layout = { name: 'BAL_S_PAR', components: [ch('PARNAME', 10), ch('PARVALUE', 75)] };
    const balSMsg: Layout = {
      name: 'BAL_S_MSG',
      components: [
        ch('MSGTY', 1),
        ch('MSGID', 20),
        { name: 'MSGNO', type: 'NUMC', chars: 3 },
        ch('MSGV1', 50),
        ch('MSGV2', 50),
        ch('MSGV3', 50),
        ch('MSGV4', 50),
        ch('MSGV1_SRC', 15),
        ch('MSGV2_SRC', 15),
        ch('MSGV3_SRC', 15),
        ch('MSGV4_SRC', 15),
        ch('DETLEVEL', 1),
        ch('PROBCLASS', 1),
        ch('ALSORT', 3),
        { name: 'TIME_STMP', type: 'DEC', chars: 21, decimals: 7 },
        { name: 'MSG_COUNT', type: 'INT4', chars: 10 },
        {
          name: 'CONTEXT',
          kind: ComponentKind.Substructure,
          sub: { name: '', components: [ch('TABNAME', 30), ch('VALUE', 256)] },
        },
        {
          name: 'PARAMS',
          kind: ComponentKind.Substructure,
          sub: {
            name: '',
            components: [
              { name: 'T_PAR', kind: ComponentKind.Table, type: 'BAL_T_PAR', sub: balSPar },
              {
                name: 'CALLBACK',
                kind: ComponentKind.Substructure,
                sub: { name: '', components: [ch('USEREXITP', 40), ch('USEREXITF', 30), ch('USEREXITT', 1)] },
              },
              ch('ALTEXT', 28),
            ],
          },
        },
      ],
    };
    const msg = findObject(c, 'MSG')!;
    applyLayout(msg, balSMsg);
    const rec = objectRecords(msg)[0]!;
    expect(rec.MSGID).toBe('ZDEMO');
    expect(rec['PARAMS.ALTEXT']).toBe('ALTEXT');
    const pars = rec['PARAMS.T_PAR'] as Record<string, unknown>[];
    expect(pars).toHaveLength(2);
    expect(pars[0]?.PARNAME).toBe('COMP');
    expect(pars[1]?.PARVALUE).toBe('');
    expect(msg.fields[18]?.name).toBe('PARAMS.T_PAR');
    expect(msg.fields[18]?.fields?.[0]?.name).toBe('PARAMS.T_PAR[].PARNAME');

    const orders = findObject(c, 'ORDERS')!;
    const items: Layout = {
      name: 'TY_ITEMS',
      components: [
        { name: 'NO', type: 'INT4', chars: 10 },
        { name: 'NAME', type: 'STRG' },
      ],
    };
    const order: Layout = {
      name: 'TY_ORDER',
      components: [ch('ID', 10), { name: 'ITEMS', kind: ComponentKind.Table, sub: items }, ch('NOTE', 5)],
    };
    applyLayout(orders, order);
    const recs = objectRecords(orders);
    expect(recs[0]?.ITEMS).toEqual([
      { NO: 1, NAME: 'first' },
      { NO: 2, NAME: 'second' },
    ]);
    expect(recs[1]?.ITEMS).toEqual([]);

    // A table where the layout has a field, and a field where it has a table.
    const c2 = parseCluster(loadHex('indx_deep.hex'));
    const orders2 = findObject(c2, 'ORDERS')!;
    expect(() =>
      applyLayout(orders2, { name: '', components: [ch('ID', 10), ch('ITEMS', 4), ch('NOTE', 5)] }),
    ).toThrow();
    const c3 = parseCluster(loadHex('indx_deep.hex'));
    const orders3 = findObject(c3, 'ORDERS')!;
    expect(() =>
      applyLayout(orders3, {
        name: '',
        components: [
          { name: 'ID', kind: ComponentKind.Table },
          { name: 'ITEMS', kind: ComponentKind.Table },
          ch('NOTE', 5),
        ],
      }),
    ).toThrow();
  });
});

describe('applyNames', () => {
  it('names fields by explicit path, including nested tables', () => {
    const objs: ClusterObject[] = [
      {
        name: 'HDR',
        kind: ObjectKind.Structure,
        typeCode: 0,
        rowLength: 0,
        size: 0,
        charBytes: 1 as const,
        type: { path: '', typeCode: 0, length: 0, decimals: 0 },
        fields: [
          { path: '1', type: 'INT4', typeCode: 0, length: 0 },
          {
            path: '2',
            type: 'TABLE',
            typeCode: 0,
            length: 0,
            fields: [
              { path: '2.1', type: '', typeCode: 0, length: 0 },
              { path: '2.2', type: '', typeCode: 0, length: 0 },
            ],
          },
        ],
        rows: [[1, [['a', 'b']]]],
      },
    ];
    const notes = applyNames(objs, {
      hdr: ['Count', 'items'],
      'HDR.2': ['id', 'hash', 'extra'],
      SNAP: ['x'],
      'HDR.9': ['x'],
    });
    expect(objs[0]?.fields[0]?.name).toBe('count');
    expect(objs[0]?.fields[1]?.fields?.[1]?.name).toBe('hash');
    expect(notes).toHaveLength(3);
    const rec = objectRecords(objs[0]!);
    const items = rec[0]?.items as Record<string, unknown>[];
    expect(items).toHaveLength(1);
    expect(items[0]?.hash).toBe('b');
  });
});
