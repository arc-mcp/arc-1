import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const fixture = (release: string, part: string) =>
  readFileSync(new URL(`../../fixtures/xml/package-browser-${release}-${part}.xml`, import.meta.url), 'utf8');
const direct = { type: 'DEVC', name: 'SABP_UNIT_CORE', packageScope: 'direct', format: 'structured' };
let bodies: string[];
beforeEach(() => {
  vi.resetAllMocks();
  bodies = [];
  mockFetch.mockImplementation(async (_url, options) => {
    if (options.method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'test' });
    bodies.push(options.body);
    return mockResponse(200, fixture('750', bodies.length === 1 ? 'root' : 'expanded'));
  });
});

it('reads legacy direct contents through the public handler without package-filtered search', async () => {
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', direct);
  expect(result.isError).toBeUndefined();
  const data = JSON.parse(result.content[0]!.text!);
  expect(data.objects.length).toBeGreaterThan(10);
  expect(data.listing).toMatchObject({ scope: 'direct', coverage: 'adt-nodestructure', completeness: 'unknown' });
  expect(bodies).toHaveLength(2);
  expect(mockFetch.mock.calls.every(([url]) => !String(url).includes('/informationsystem/search'))).toBe(true);
});

it.each(['TABL/DS', 'TABL/DT'])('preserves exact %s folder selection through argument normalization', async (type) => {
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { ...direct, objectType: type });
  expect(result.isError).toBeUndefined();
  expect(bodies[1]).toContain(`<TV_NODEKEY>${type === 'TABL/DS' ? '000019' : '000009'}</TV_NODEKEY>`);
  expect(bodies[1]!.match(/<TV_NODEKEY>/g)).toHaveLength(1);
});

it('rejects a DEVC objectType that indexed search would silently ignore', async () => {
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
    type: 'DEVC',
    name: 'SABP_UNIT_CORE',
    objectType: 'CLAS/OC',
  });
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain('packageScope');
  expect(mockFetch).not.toHaveBeenCalled();
});

it.each([
  { name: '' },
  { name: '*' },
  { name: 'A'.repeat(31) },
  { name: 'Z&parent_name=OTHER' },
  { type: 'CLAS' },
  { action: 'diff' },
  { include: 'main' },
  { version: 'inactive' },
])('rejects invalid direct input before SAP: %j', async (change) => {
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { ...direct, ...change });
  expect(result.isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});

it('retains the two-block text shape and applies the local result cap', async () => {
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
    ...direct,
    format: 'text',
    maxResults: 1,
  });
  expect(result.isError).toBeUndefined();
  expect(JSON.parse(result.content[0]!.text!)).toHaveLength(1);
  expect(JSON.parse(result.content[1]!.text!).listing).toMatchObject({
    effectiveLimit: 1,
    returned: 1,
    limitReached: true,
    possiblyTruncated: true,
  });
});

it('does not return a successful prefix when expansion exceeds the byte budget', async () => {
  mockFetch.mockImplementation(async (_url, options) => {
    if (options.method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'test' });
    bodies.push(options.body);
    return mockResponse(200, bodies.length === 1 ? fixture('750', 'root') : 'x'.repeat(2 * 1024 * 1024));
  });
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', direct);
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain('objectType');
  expect(result.content[0]!.text).not.toContain('WHERE');
});

it('enforces read scope and denyActions before the read-only POST', async () => {
  const deniedScope = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', direct, {
    token: 'test',
    clientId: 'test',
    scopes: [],
  });
  expect(deniedScope.isError).toBe(true);
  const deniedAction = await handleToolCall(
    createClient(),
    { ...DEFAULT_CONFIG, denyActions: ['SAPRead.DEVC'] },
    'SAPRead',
    direct,
  );
  expect(deniedAction.isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});

it('preserves a returned alias type through the public folder selector', async () => {
  mockFetch.mockImplementation(async (_url, options) => {
    if (options.method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'test' });
    bodies.push(options.body);
    const xml =
      bodies.length === 1
        ? fixture('750', 'root').replace('CLAS/OC', 'AMSD/TYP')
        : fixture('750', 'expanded').replaceAll('CLAS/OC', 'AMSD/ASD');
    return mockResponse(200, xml);
  });
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { ...direct, objectType: 'AMSD/TYP' });
  expect(result.isError).toBeUndefined();
  expect(JSON.parse(result.content[0]!.text!).objects.some((o: { type: string }) => o.type === 'AMSD/ASD')).toBe(true);
});

it('returns advertised choices for an unknown type without expanding', async () => {
  const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', { ...direct, objectType: 'BDEF/BDO' });
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain('Available types:');
  expect(bodies).toHaveLength(1);
});
