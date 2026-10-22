import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { getDirectPackageContents } from '../../../src/adt/package-browser.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { requestContext } from '../../../src/server/context.js';

const post = vi.fn();
const http = { post } as unknown as AdtHttpClient;
const safety = defaultSafetyConfig();
const fixture = (release: string, part: string) =>
  readFileSync(new URL(`../../fixtures/xml/package-browser-${release}-${part}.xml`, import.meta.url), 'utf8');
const node = (name = 'ZONE', type = 'CLAS/OC', uri = `/sap/bc/adt/oo/classes/${name.toLowerCase()}`) =>
  `<SEU_ADT_REPOSITORY_OBJ_NODE><OBJECT_TYPE>${type}</OBJECT_TYPE><OBJECT_NAME>${name}</OBJECT_NAME><OBJECT_URI>${uri}</OBJECT_URI><DESCRIPTION>Wrong text</DESCRIPTION></SEU_ADT_REPOSITORY_OBJ_NODE>`;
const folder = (type = 'CLAS/OC', id = '000123') =>
  `<SEU_ADT_OBJECT_TYPE_INFO><OBJECT_TYPE>${type}</OBJECT_TYPE><NODE_ID>${id}</NODE_ID></SEU_ADT_OBJECT_TYPE_INFO>`;
const tree = (nodes = '', folders = '') =>
  `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><TREE_CONTENT>${nodes}</TREE_CONTENT><OBJECT_TYPES>${folders}</OBJECT_TYPES></DATA></asx:values></asx:abap>`;
const read = (maxResults?: number, objectType?: string) =>
  getDirectPackageContents(http, safety, 'ZPACKAGE', maxResults, objectType);
const responses = (root: string, expanded = tree(node())) =>
  post.mockResolvedValueOnce({ body: root }).mockResolvedValueOnce({ body: expanded });
beforeEach(() => post.mockReset());
afterEach(() => vi.restoreAllMocks());

it.each(['750', '758'])('parses native %s projections and omits unreliable descriptions', async (release) => {
  responses(fixture(release, 'root'), fixture(release, 'expanded'));
  const result = await read();
  expect(result.objects.length).toBeGreaterThan(10);
  expect(result.objects.every((item) => item.name && item.type && item.uri && !('description' in item))).toBe(true);
  expect(result.listing).toMatchObject({
    completeness: 'unknown',
    total: null,
    unexpandedTypes: [],
    possiblyTruncated: false,
  });
  expect(post).toHaveBeenCalledTimes(2);
});

it('encodes an exact namespace parent and never follows subpackages or response URIs', async () => {
  responses(
    tree(node('/NS/CHILD', 'DEVC/K', '/sap/bc/adt/packages/%2fns%2fchild'), folder('DEVC/K', '000010') + folder()),
  );
  const result = await getDirectPackageContents(http, safety, '/NS/PARENT');
  expect(result.objects[0]!.name).toBe('/NS/CHILD');
  expect(
    post.mock.calls.every(([url]) => url.includes('parent_name=%2FNS%2FPARENT&parent_tech_name=%2FNS%2FPARENT')),
  ).toBe(true);
  expect(post.mock.calls[1]![1]).toContain('000123');
  expect(post.mock.calls[1]![1]).not.toContain('000010');
  expect(post).toHaveBeenCalledTimes(2);
});

it('lists only direct subpackages with DEVC/K selection, without an expansion', async () => {
  responses(tree(node('ZCHILD', 'DEVC/K', '/sap/bc/adt/packages/zchild'), folder('DEVC/K', '000010') + folder()));
  const result = await read(200, 'DEVC/K');
  expect(result.objects.map((o) => o.name)).toEqual(['ZCHILD']);
  expect(result.listing).toMatchObject({ unexpandedTypes: ['CLAS/OC'], possiblyTruncated: true });
  expect(post).toHaveBeenCalledTimes(1);
});

it('keeps native alias types and omits subpackages when selecting an object folder', async () => {
  responses(
    tree(node('ZCHILD', 'DEVC/K'), folder('AMSD/TYP') + folder('DEVC/K', '000010')),
    tree(node('ZAMSD', 'AMSD/ASD')),
  );
  const result = await read(200, 'AMSD/TYP');
  expect(result.objects).toEqual([{ name: 'ZAMSD', type: 'AMSD/ASD', uri: '/sap/bc/adt/oo/classes/zamsd' }]);
});

it('selects first 16 unique folder IDs in document order and reports skipped types', async () => {
  const folders = Array.from({ length: 18 }, (_, i) => folder(`TYPE${i}`, String(300 - i).padStart(6, '0')));
  responses(tree('', folders[0] + folders.join('')));
  const result = await read();
  const ids = [...post.mock.calls[1]![1].matchAll(/<TV_NODEKEY>(\d+)<\/TV_NODEKEY>/g)].map(
    (m: RegExpMatchArray) => m[1],
  );
  expect(ids).toEqual(Array.from({ length: 16 }, (_, i) => String(300 - i).padStart(6, '0')));
  expect(result.listing).toMatchObject({ unexpandedTypes: ['TYPE16', 'TYPE17'], possiblyTruncated: true });
});

it('never uses extra IDs found in expansion metadata, and deduplicates native entries before capping', async () => {
  responses(tree('', folder()), tree(node('ZONE') + node('ZONE') + node('ZTWO'), folder('OTHER', '999999')));
  const result = await read(1.8);
  expect(result.objects.map((o) => o.name)).toEqual(['ZONE']);
  expect(result.listing).toMatchObject({ effectiveLimit: 1, returned: 1, limitReached: true, possiblyTruncated: true });
  expect(post).toHaveBeenCalledTimes(2);
});

it('refuses an unadvertised selector without broadening or expanding', async () => {
  responses(tree('', folder()));
  await expect(read(200, 'TABL/DS')).rejects.toThrow('Available types: CLAS/OC');
  expect(post).toHaveBeenCalledTimes(1);
});

it.each(['', ' ', tree()])('treats an empty root as ambiguous, not as an empty package', async (xml) => {
  responses(xml);
  await expect(read()).rejects.toThrow('empty, missing or inaccessible');
  expect(post).toHaveBeenCalledTimes(1);
});

it.each([
  '<html/>',
  '<asx:abap>',
  '<abap><values><DATA/></values></abap>',
  tree('', folder('CLAS/OC', '000000')),
  tree('', folder('CLAS/OC', '123')),
  tree('', folder('CLAS/OC', '123456&lt;')),
  tree(node('').replace('<OBJECT_NAME></OBJECT_NAME>', '<OBJECT_NAME/>'), folder()),
  tree(node('ZONE', 'CLAS/OC', 'https://other.invalid/sap/bc/adt/source'), folder()),
  tree(node('ZONE', 'CLAS/OC', '/sap/bc/adt/../admin'), folder()),
  tree('', folder()).replace('<NODE_ID>', '<NODE_ID>000111</NODE_ID><NODE_ID>'),
])('refuses malformed or ambiguous root data without expansion', async (xml) => {
  responses(xml);
  await expect(read()).rejects.toThrow();
  expect(post).toHaveBeenCalledTimes(1);
});

it.each(['', '<html/>', tree(node('ZCHILD', 'DEVC/K'))])(
  'never returns root results after invalid expansion',
  async (xml) => {
    responses(tree(node('ZROOTCHILD', 'DEVC/K'), folder()), xml);
    await expect(read()).rejects.toThrow();
    expect(post).toHaveBeenCalledTimes(2);
  },
);

it.each([401, 403, 404, 500])('propagates HTTP %i without fallback', async (statusCode) => {
  const error = Object.assign(new Error('Native error'), { statusCode });
  post.mockRejectedValueOnce(error);
  await expect(read()).rejects.toBe(error);
  expect(post).toHaveBeenCalledTimes(1);
});

it.each(['', '*', 'Z?x=1', 'Z/PACK', 'Z'.repeat(31), 'Z\n'])(
  'refuses invalid client names %j before HTTP',
  async (name) => {
    await expect(getDirectPackageContents(http, safety, name)).rejects.toThrow();
    expect(post).not.toHaveBeenCalled();
  },
);

it('shares cumulative response, deadline and actual-send allowances across both calls', async () => {
  responses(tree('', folder()));
  await read();
  const first: AdtRequestOptions = post.mock.calls[0]![4];
  const second: AdtRequestOptions = post.mock.calls[1]![4];
  expect(second).toBe(first);
  expect(first).toMatchObject({
    responseBudget: { limitBytes: 2 * 1024 * 1024, endpointFamily: 'package-browser' },
    attemptBudget: { limit: 8 },
    retryTransientErrors: false,
  });
  expect(first.deadline! - Date.now()).toBeGreaterThan(9000);
});

it.each(['cancel', 'deadline'])('stops before expansion when the shared %s expires', async (kind) => {
  const controller = new AbortController();
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  post.mockImplementationOnce(async () => {
    if (kind === 'cancel') controller.abort();
    else clock.mockReturnValue(now + 10_001);
    return { body: tree('', folder()) };
  });
  await expect(requestContext.run({ requestId: 'package-test', signal: controller.signal }, read)).rejects.toThrow();
  expect(post).toHaveBeenCalledTimes(1);
});

it('refuses an already cancelled request before contacting SAP', async () => {
  await expect(requestContext.run({ requestId: 'package-test', signal: AbortSignal.abort() }, read)).rejects.toThrow();
  expect(post).not.toHaveBeenCalled();
});
