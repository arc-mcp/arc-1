import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import {
  assertCtsMembers,
  assertCtsNoInactive,
  isCtsRequestAbsent,
  nativeCtsTarget,
  parseCtsTree,
  readCtsTree,
  readCtsTreeAfterDelete,
  readCtsValues,
} from '../../../src/adt/pinned-cts-evidence.js';

const parent = 'DEVK900001',
  task = 'DEVK900002';
const ns = 'http://www.sap.com/cts/adt/tm';
const root = (xml: string) => `<tm:root xmlns:tm="${ns}">${xml}</tm:root>`;
const request = (child = '', extra = '') =>
  `<tm:request tm:number="${parent}" tm:type="W" tm:status="D" tm:owner="DEV" ${extra}>${child}</tm:request>`;
const child = `<tm:task tm:number="${task}" tm:status="D" tm:owner="OTHER"/>`;
const responseHttp = (body: string) =>
  ({
    get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body }),
    hasDiscoveryData: () => true,
    discoveryAcceptFor: () => 'transportorganizer',
  }) as unknown as AdtHttpClient;

describe('private CTS native evidence', () => {
  it('reads the retained native 7.58 released organizer fixture', () => {
    const xml = readFileSync(new URL('../../fixtures/xml/transport-released-a4h-758.xml', import.meta.url), 'utf8');
    expect(parseCtsTree(xml, 'A4HK906291').parent).toMatchObject({ id: 'A4HK906291', type: 'K', status: 'R' });
  });
  it('handles equivalent namespace aliases, customizing requests and native task parent references', () => {
    const xml = root(request() + child.replace('/>', ` tm:parent="/sap/bc/adt/cts/transportrequests/${parent}"/>`))
      .replaceAll('tm:', 'cts:')
      .replace('xmlns:tm=', 'xmlns:cts=');
    expect(parseCtsTree(xml, parent)).toMatchObject({ parent: { type: 'W' }, tasks: [{ id: task }] });
  });
  it.each([
    '<html/>',
    '',
    root(request()).replace(ns, 'wrong'),
    root(request()).replace('tm:owner="DEV"', ''),
    root(request()).replace('tm:status="D"', 'tm:status="?"'),
    root(request()).replace('tm:type="W"', 'tm:type="X"'),
    root(request(child + child)),
    root(request(child.replace('/>', ' tm:parent="OTHER"/>'))),
    root(request('', 'number="OTHER"')),
    root(request('', 'tm:hasMore="true"')),
    root(request('<tm:objects/>')),
    root(request()).replace('</tm:root>', '<tm:next/></tm:root>'),
    root(request(child.replace('tm:owner="OTHER"', 'other:owner="OTHER" xmlns:other="evil"'))),
    root(request()).replace(
      '</tm:root>',
      '<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="next" href="/next"/></tm:root>',
    ),
    `<!DOCTYPE x [<!ENTITY x "x">]>${root(request())}`,
    root(request()).replace(parent, 'OTHER'),
    root(request('<tm:abap_object tm:pgmid="R3TR" tm:type="CLAS" tm:name="Z"/>')),
  ])('refuses ambiguous, malformed, incomplete or unknown native contract %#', (body) => {
    expect(() => parseCtsTree(body, parent)).toThrow();
  });
  it('accepts only typed, empty organizer absence', () => {
    expect(parseCtsTree(root(''), parent)).toEqual({ tasks: [] });
    expect(() => parseCtsTree(root('<tm:error/>'), parent)).toThrow();
  });
  it('checks exact membership and permits only individually accounted-for removals', () => {
    const tree = parseCtsTree(root(request()), parent);
    expect(() => assertCtsMembers(tree, [parent, task])).toThrow();
    expect(() => assertCtsMembers(tree, [parent, task], new Set([task]))).not.toThrow();
    expect(() => assertCtsMembers(parseCtsTree(root(request(child)), parent), [parent])).toThrow();
  });
  it.each(['C11', 'C11.021', '/TRG/'])('accepts native CTS routing %s', (value) =>
    expect(nativeCtsTarget(value)).toBe(value),
  );
  it.each(['A4H/001', '/A4H/001/mcp', 'https://sap.example', 'C11/021', '../TRG', ' C11', '', '/multi/mcp'])(
    'rejects route selector %s',
    (value) => expect(() => nativeCtsTarget(value)).toThrow(),
  );
  it('refuses selected inactive assignment and ambiguous assignment, while allowing a proven unrelated assignment', async () => {
    const inactive = (name: string) =>
      `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:core="http://www.sap.com/adt/core"><ioc:entry><ioc:object ioc:user="DEV" ioc:deleted="false"><ioc:ref core:uri="/sap/bc/adt/oo/classes/z" core:name="Z" core:type="CLAS/OC"/></ioc:object><ioc:transport ioc:user="DEV" ioc:linked="true"><ioc:ref core:name="${name}" core:uri="/sap/bc/adt/cts/transportrequests/${name}" core:type="/RQ"/></ioc:transport></ioc:entry></ioc:inactiveObjects>`;
    await expect(assertCtsNoInactive(responseHttp(inactive(parent)), [parent])).rejects.toThrow('inactive');
    await expect(assertCtsNoInactive(responseHttp(inactive('')), [parent])).rejects.toThrow('assignment');
    await expect(assertCtsNoInactive(responseHttp(inactive('OTHER')), [parent])).resolves.toBeUndefined();
  });
});

describe('private CTS read companions', () => {
  const named = (count: string, items = '') =>
    `<n:namedItemList xmlns:n="http://www.sap.com/adt/nameditem"><n:totalItemCount>${count}</n:totalItemCount>${items}</n:namedItemList>`;
  const item =
    '<n:namedItem><n:name>ZDEV</n:name><n:description>Development</n:description><n:data>DEV</n:data></n:namedItem>';
  it('preserves native routing values with an exact count', async () => {
    expect(await readCtsValues(responseHttp(named('1', item)), 'layers')).toEqual([
      { name: 'ZDEV', description: 'Development', nativeTarget: 'DEV' },
    ]);
  });
  it('establishes a typed empty result', async () =>
    expect(await readCtsValues(responseHttp(named('0')), 'targets')).toEqual([]));
  it.each([
    named('2', item),
    named('x'),
    named('200', item.repeat(200)),
    named('2', item.repeat(2)),
    '<html/>',
    named('1', item.replace('<n:name>ZDEV</n:name>', '')),
    named('0').replace('</n:namedItemList>', '<n:next/></n:namedItemList>'),
  ])('refuses partial/malformed/oversized companion evidence %#', async (body) => {
    await expect(readCtsValues(responseHttp(body), 'targets')).rejects.toThrow();
  });
  it('requires actual discovery support before target GET', async () => {
    const http = responseHttp(named('0'));
    vi.spyOn(http, 'hasDiscoveryData').mockReturnValue(false);
    await expect(readCtsValues(http, 'targets')).rejects.toThrow('discovery');
    expect(http.get).not.toHaveBeenCalled();
  });
});

const id = 'A4HK000000',
  path = `/sap/bc/adt/cts/transportrequests/${id}`;
const body = readFileSync(new URL('../../fixtures/xml/cts-request-not-found-a4h-758.xml', import.meta.url), 'utf8');
const missing = (xml = body, status = 404, requestPath = path) => new AdtApiError('missing', status, requestPath, xml);

describe('exact CTS native missing-resource evidence', () => {
  it('accepts the captured typed A4H response and equivalent exception namespace alias', () => {
    expect(isCtsRequestAbsent(missing(), id)).toBe(true);
    expect(
      isCtsRequestAbsent(missing(body.replaceAll('exc:', 'other:').replace('xmlns:exc=', 'xmlns:other=')), id),
    ).toBe(true);
    expect(
      isCtsRequestAbsent(
        missing(body.replace(/<message[\s\S]*?<\/message>/, '<message lang="DE">Lokalisierte Diagnose.</message>')),
        id,
      ),
    ).toBe(true);
  });
  it.each([200, 400, 401, 403, 410, 500])('refuses status%s despite an otherwise exact body', (status) =>
    expect(isCtsRequestAbsent(missing(body, status), id)).toBe(false),
  );
  it.each([
    '',
    '<html>Not found</html>',
    body.replace('ExceptionResourceNotFound', 'ExceptionAuthorization'),
    body.replace('com.sap.adt', 'com.example'),
    body.replace('http://www.sap.com/abapxml/types/communicationframework', 'urn:foreign'),
    body.replace('SADT_RESOURCE', 'SADT_AUTH'),
    body.replace('>002<', '>003<'),
    body.replace('>Transport Request/Task<', '>ABAP Class<'),
    body.replace(`>${id}<`, '>A4HK999999<'),
    body.replace('<properties>', '<properties xmlns="urn:foreign">'),
    body.replace('</properties>', '<entry key="T100KEY-V2">A4HK999999</entry></properties>'),
    body.replace('</properties>', '<entry key="T100KEY-V2">A4HK000000</entry></properties>'),
    body.replace('</exc:exception>', '<properties/></exc:exception>'),
    body.replace('</exc:exception>', '<namespace id="com.sap.adt"/></exc:exception>'),
    body.replace('</exc:exception>', '<extra/></exc:exception>'),
    body.replace('</exc:exception>', '<message lang="EN">Duplicate</message></exc:exception>'),
    body.replace('</message>', '<extra/></message>'),
    `<!DOCTYPE exception [<!ENTITY x "x">]>${body}`,
    body + ' '.repeat(32 * 1024),
  ])('refuses missing, foreign, contradictory, duplicate or oversized evidence %#', (xml) =>
    expect(isCtsRequestAbsent(missing(xml), id)).toBe(false),
  );
  it('binds the exact request path and canonical ID, not a matching message alone', () => {
    expect(isCtsRequestAbsent(missing(body, 404, '/private'), id)).toBe(false);
    expect(isCtsRequestAbsent(missing(), 'A4HK999999')).toBe(false);
    expect(isCtsRequestAbsent(missing(), '../A4HK000000')).toBe(false);
    expect(isCtsRequestAbsent({ statusCode: 404, path, responseBody: body }, id)).toBe(false);
  });
  it('leaves preflight reads strict and enables only the explicit post-delete reader', async () => {
    const error = missing(),
      get = vi.fn().mockRejectedValue(error),
      http = { get } as unknown as AdtHttpClient;
    await expect(readCtsTree(http, id)).rejects.toBe(error);
    await expect(readCtsTreeAfterDelete(http, id)).resolves.toEqual({ tasks: [] });
    expect(get).toHaveBeenCalledTimes(2);
  });
});
