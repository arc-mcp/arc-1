import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CachingLayer } from '../../../src/cache/caching-layer.js';
import { MemoryCache } from '../../../src/cache/memory.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { buildCreateXml } = await import('../../../src/handlers/write-helpers.js');
const fixture = (name: string) => readFileSync(new URL(`../../fixtures/xml/${name}`, import.meta.url), 'utf8');
const ktd = `<sktd:docu xmlns:sktd="http://www.sap.com/wbobj/texts/sktd" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZDOC" adtcore:description="Original">
<adtcore:packageRef adtcore:name="$TMP"/><sktd:element><sktd:id>ZDOC</sktd:id><sktd:text>${Buffer.from('Original prose').toString('base64')}</sktd:text><adtcore:objectReference/></sktd:element></sktd:docu>`;
const cases = [
  {
    type: 'DOMA',
    name: 'BUKRS',
    path: '/ddic/domains/BUKRS',
    xml: fixture('domain-metadata.xml'),
    patch: { lowercase: true },
  },
  {
    type: 'DTEL',
    name: 'BUKRS',
    path: '/ddic/dataelements/BUKRS',
    xml: fixture('dataelement-metadata.xml'),
    patch: { shortLabel: 'New' },
  },
  {
    type: 'MSAG',
    name: 'ZMSG',
    path: '/messageclass/ZMSG',
    xml: buildCreateXml('MSAG', 'ZMSG', '$TMP', 'Original', { messages: [{ number: '001', shortText: 'Original' }] }),
    patch: { messages: [{ number: '001', shortText: 'New' }] },
  },
  {
    type: 'SRVB',
    name: 'ZBIND',
    path: '/businessservices/bindings/ZBIND',
    xml: fixture('service-binding.xml'),
    patch: { serviceDefinition: 'ZNEW' },
  },
  { type: 'SKTD', name: 'ZDOC', path: '/documentation/ktd/documents/zdoc', xml: ktd, patch: { source: 'New prose' } },
  {
    type: 'ENQU',
    name: 'EMEKKOE',
    path: '/ddic/lockobjects/sources/EMEKKOE',
    xml: fixture('lockobject-emekkoe.xml'),
    patch: { source: '{"allowRFC":true}' },
  },
  {
    type: 'TTYP',
    name: 'STRINGTAB',
    path: '/ddic/tabletypes/STRINGTAB',
    xml: fixture('tabletype-stringtab.xml'),
    patch: { rowType: 'STRING' },
  },
];

function sap(
  row: (typeof cases)[number],
  failure?: 'lock' | 'read' | 'put' | 'unlock',
  colleagueDescription = 'Colleague description',
) {
  let current = row.xml;
  let locked = false;
  const calls: Array<{
    method: string;
    url: string;
    body: string;
    stateful: boolean;
    locked: boolean;
    cookie: string;
  }> = [];
  mockFetch.mockImplementation(
    async (url: string | URL, opts?: { method?: string; body?: unknown; headers?: Record<string, string> }) => {
      const method = opts?.method ?? 'GET';
      const path = String(url);
      const call = {
        method,
        url: path,
        body: String(opts?.body ?? ''),
        stateful: opts?.headers?.['X-sap-adt-sessiontype'] === 'stateful',
        locked,
        cookie: opts?.headers?.Cookie ?? '',
      };
      calls.push(call);
      if (method === 'POST' && path.includes('_action=LOCK')) {
        if (failure === 'lock') return mockResponse(423, 'locked by another user');
        // A colleague saves and releases their lock before ours is granted.
        current = current.replace(/adtcore:description="[^"]*"/, `adtcore:description="${colleagueDescription}"`);
        locked = true;
        return mockResponse(200, '<asx:values><LOCK_HANDLE>LH</LOCK_HANDLE><CORRNR>REQ1</CORRNR></asx:values>', {
          'set-cookie': 'sap-contextid=LOCK_SESSION; Path=/',
        });
      }
      if (method === 'POST' && path.includes('_action=UNLOCK')) {
        locked = false;
        return mockResponse(failure === 'unlock' ? 400 : 200, 'unlock');
      }
      if (method === 'GET' && path.includes(row.path)) return mockResponse(failure === 'read' ? 400 : 200, current);
      if (method === 'PUT') return mockResponse(failure === 'put' ? 400 : 200, 'write');
      return mockResponse(200, '', { 'x-csrf-token': 'T' });
    },
  );
  return calls;
}

describe('metadata updates preserve edits committed before the lock', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCachedFeatures();
  });

  it('stateful facade preserves every field except its isolated HTTP session', async () => {
    const client = createClient();
    const originalHttp = client.http;
    await client.withStatefulSession(async (current) => {
      expect(current).toBeInstanceOf(AdtClient);
      expect(current.http).not.toBe(originalHttp);
      for (const key of Object.keys(client).filter((key) => key !== 'http')) {
        expect(Reflect.get(current, key), key).toBe(Reflect.get(client, key));
      }
      expect(client.http).toBe(originalHttp);
    });
    expect(client.http).toBe(originalHttp);
  });

  it.each(cases)('$type reads and merges in the locked session', async (row) => {
    const calls = sap(row);
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: row.type,
      name: row.name,
      ...row.patch,
    });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.body).toContain('adtcore:description="Colleague description"');
    expect(put?.url).toContain('corrNr=REQ1');
    const reads = calls.filter((c) => c.method === 'GET' && c.url.includes(row.path));
    expect(reads.some((c) => c.locked && c.stateful && c.cookie.includes('sap-contextid=LOCK_SESSION'))).toBe(true);
    expect(put?.cookie).toContain('sap-contextid=LOCK_SESSION');
    expect(calls.find((c) => c.url.includes('_action=LOCK'))?.stateful).toBe(true);
    expect(calls.some((c) => c.url.includes('_action=UNLOCK'))).toBe(true);
  });

  // SAP sends stored text entity-encoded. Re-escaping it undecoded ("R&amp;amp;D") made SAP store
  // the literal "R&amp;D", compounding with every further partial update.
  it.each(cases)('$type writes the stored description back escaped exactly once', async (row) => {
    const stored = 'R&amp;D &lt;Orders&gt; &amp;lt;literal&amp;gt; &quot;x&quot;';
    const calls = sap(row, undefined, stored);
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: row.type,
      name: row.name,
      ...row.patch,
    });
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(calls.find((c) => c.method === 'PUT')?.body).toContain(`adtcore:description="${stored}"`);
  });

  it.each(['lock', 'read', 'put', 'unlock'] as const)(
    'reports %s failure and releases any acquired lock',
    async (failure) => {
      const row = cases[0]!;
      const calls = sap(row, failure);
      const cache = new CachingLayer(new MemoryCache());
      const invalidate = vi.spyOn(cache, 'invalidate');
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPWrite',
        {
          action: 'update',
          type: row.type,
          name: row.name,
          ...row.patch,
        },
        undefined,
        undefined,
        cache,
      );
      expect(invalidate.mock.calls.length > 0).toBe(failure === 'put' || failure === 'unlock');
      expect(result.isError).toBe(true);
      expect(calls.some((c) => c.url.includes('_action=UNLOCK'))).toBe(failure !== 'lock');
      expect(calls.some((c) => c.method === 'PUT')).toBe(failure === 'put' || failure === 'unlock');
      if (failure === 'lock') expect(calls.some((c) => c.method === 'GET' && c.url.includes(row.path))).toBe(false);
    },
  );

  it('refuses a read-only metadata update before acquiring a lock', async () => {
    const row = cases[0]!;
    const calls = sap(row);
    const client = createClient();
    const result = await handleToolCall(
      client.withSafety({ ...client.safety, allowWrites: false }),
      DEFAULT_CONFIG,
      'SAPWrite',
      {
        action: 'update',
        type: row.type,
        name: row.name,
        ...row.patch,
      },
    );
    expect(result.isError).toBe(true);
    expect(calls.some((c) => c.method === 'POST' || c.method === 'PUT')).toBe(false);
  });

  it.each([undefined, 'put'] as const)('cache failure does not replace the %s write outcome', async (failure) => {
    const row = cases[0]!;
    sap(row, failure);
    const cache = new CachingLayer(new MemoryCache());
    vi.spyOn(cache, 'invalidate').mockImplementation(() => {
      throw new Error('SQLITE_BUSY');
    });
    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAPWrite',
      {
        action: 'update',
        type: row.type,
        name: row.name,
        ...row.patch,
      },
      undefined,
      undefined,
      cache,
    );
    expect(result.isError).toBe(failure ? true : undefined);
    expect(result.content[0]!.text).toContain(failure ? 'status 400' : 'Successfully updated');
    expect(result.content[0]!.text).not.toContain('SQLITE_BUSY');
  });

  it('keeps SKTD dry-run unlocked and unwritten', async () => {
    const row = cases[4]!;
    const calls = sap(row);
    const client = createClient();
    const result = await handleToolCall(
      client.withSafety({ ...client.safety, allowWrites: false }),
      DEFAULT_CONFIG,
      'SAPWrite',
      {
        action: 'update',
        type: row.type,
        name: row.name,
        ...row.patch,
        dryRun: true,
      },
    );
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    expect(result.content[0]!.text).toContain('Dry run');
    expect(calls.some((c) => c.url.includes('_action=LOCK') || c.method === 'PUT')).toBe(false);
  });

  describe('TTYP', () => {
    const ttyp = cases.find((row) => row.type === 'TTYP')!;
    const update = (args: Record<string, unknown>) =>
      handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'TTYP',
        name: ttyp.name,
        ...args,
      });
    const putBody = (calls: ReturnType<typeof sap>) => calls.find((c) => c.method === 'PUT')?.body;
    // Row types and definitions as SAP_BASIS 758 returns them (docs/research/abap-types/types/ttyp.md).
    const stringRow = '<ttyp:dataType>STRING</ttyp:dataType><ttyp:length>000000</ttyp:length>';
    const int4Row = '<ttyp:dataType>INT4</ttyp:dataType><ttyp:length>000010</ttyp:length>';
    const builtIn = '<ttyp:typeKind>predefinedAbapType</ttyp:typeKind><ttyp:typeName/><ttyp:builtInType>';
    const int4Table = { ...ttyp, xml: ttyp.xml.replace(stringRow, int4Row) };
    const refTable = {
      ...ttyp,
      xml: ttyp.xml.replace(
        `${builtIn}<ttyp:dataType>STRING</ttyp:dataType>`,
        '<ttyp:typeKind>refToClassOrInterfaceType</ttyp:typeKind><ttyp:typeName>OBJECT</ttyp:typeName><ttyp:builtInType><ttyp:dataType/>',
      ),
    };
    const hashedTable = { ...ttyp, xml: ttyp.xml.replace('<ttyp:accessType>standard<', '<ttyp:accessType>hashed<') };

    it('writes the stored description back escaped exactly once when only rowType is given', async () => {
      // SAP sends stored text entity-encoded; re-escaping it undecoded would PUT "R&amp;amp;D".
      const stored = 'R&amp;D &lt;Orders&gt; &quot;x&quot; literal &amp;lt;';
      const calls = sap(ttyp, undefined, stored);
      const result = await update({ rowType: 'STRING' });
      expect(result.isError, JSON.stringify(result)).toBeUndefined();
      expect(putBody(calls)).toContain(`adtcore:description="${stored}"`);
    });

    // A packed row (DEC 15,2): decimals are part of the stored row type, like the length.
    it('a description-only update keeps stored decimals', async () => {
      const decRow =
        '<ttyp:dataType>DEC</ttyp:dataType><ttyp:length>000015</ttyp:length><ttyp:decimals>000002</ttyp:decimals>';
      const calls = sap({
        ...ttyp,
        xml: ttyp.xml.replace(`${stringRow}<ttyp:decimals>000000</ttyp:decimals>`, decRow),
      });
      expect((await update({ description: 'New text' })).isError).toBeUndefined();
      expect(putBody(calls)).toContain(builtIn + decRow);
    });

    it('an explicit rowTypeKind wins over the stored kind', async () => {
      const calls = sap(int4Table);
      expect((await update({ rowType: 'INT4', rowTypeKind: 'structure' })).isError).toBeUndefined();
      expect(putBody(calls)).toContain(
        '<ttyp:typeKind>dictionaryType</ttyp:typeKind><ttyp:typeName>INT4</ttyp:typeName>',
      );
    });

    // INT4 is SAP's name for a built-in that ARC-1 does not auto-detect, and its length is part of the row type.
    it.each([
      ['a description-only update keeps the stored row type', { description: 'New text' }, 'New text', int4Row],
      ['a restated row type keeps its stored kind and length', { rowType: 'int4' }, 'Colleague description', int4Row],
      ['a new row type takes neither', { rowType: 'STRING' }, 'Colleague description', stringRow],
    ])('%s', async (_title, args, description, row) => {
      const calls = sap(int4Table);
      const result = await update(args);
      expect(result.isError, JSON.stringify(result)).toBeUndefined();
      expect(putBody(calls)).toContain(`adtcore:description="${description}"`);
      expect(putBody(calls)).toContain(builtIn + row);
    });

    it.each([
      ['a ref row type', refTable, 'its refToClassOrInterfaceType row type'],
      ['a hashed table', hashedTable, 'its access type, keys or initial row count'],
    ])('rewrites %s only when rowType is given', async (_label, table, lost) => {
      const calls = sap(table);
      const refused = await update({ description: 'New text' });
      expect(refused.isError).toBe(true);
      expect(refused.content[0]!.text).toContain(`without "rowType"`);
      expect(refused.content[0]!.text).toContain(`cannot keep ${lost}`);
      expect(putBody(calls)).toBeUndefined();
      expect(calls.some((c) => c.url.includes('_action=UNLOCK'))).toBe(true);
      const replaced = await update({ rowType: 'BAPIRET2' });
      expect(replaced.isError, JSON.stringify(replaced)).toBeUndefined();
      expect(putBody(calls)).toContain('<ttyp:typeName>BAPIRET2</ttyp:typeName>');
    });

    it.each([
      ['explains an unreadable shape', { ...ttyp, xml: '<tableType/>' }, undefined, /could not read .*\(Invalid TTYP/],
      ['reports a failed read as SAP returned it', ttyp, 'read', /status 400/],
    ] as const)('%s and writes nothing', async (_title, table, failure, message) => {
      const calls = sap(table, failure);
      const result = await update({ rowType: 'STRING', description: 'New text' });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toMatch(message);
      expect(result.content[0]!.text.includes('will not overwrite it blind')).toBe(failure === undefined);
      expect(putBody(calls)).toBeUndefined();
      expect(calls.some((c) => c.url.includes('_action=UNLOCK'))).toBe(true);
    });
  });
});
