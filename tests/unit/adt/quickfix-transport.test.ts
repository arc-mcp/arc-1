import { beforeEach, expect, it, vi } from 'vitest';
import { applyFixProposal } from '../../../src/adt/devtools.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { mockFetch } from '../handlers/setup-undici-mock.js';

const { AdtHttpClient } = await import('../../../src/adt/http.js');
const proposal = '/sap/bc/adt/quickfixes/proposals/providers/refactoring/quickfixes/declare_local_variable';
const config = { baseUrl: 'https://sap.test', client: '123', language: 'DE', disableSaml: true };

beforeEach(() => {
  vi.resetAllMocks();
  mockFetch.mockResolvedValue(mockResponse(200, '<result/>', { 'x-csrf-token': 'token' }));
});

it('ignores XML formatting when a unit has absent or empty replacement content', async () => {
  mockFetch.mockResolvedValue(
    mockResponse(
      200,
      `<proposalResult><deltas>
      <unit>
        <objectReference uri="/source#start=2,1;end=2,8"/>
      </unit>
      <unit><content/><objectReference uri="/source#start=3,1;end=3,8"/></unit>
    </deltas></proposalResult>`,
      { 'x-csrf-token': 'token' },
    ),
  );
  const deltas = await applyFixProposal(
    new AdtHttpClient(config),
    unrestrictedSafetyConfig(),
    { uri: proposal, type: 'quickfix/proposal', name: 'Fix', description: 'Fix', userContent: '' },
    '/source',
    'source',
    2,
    1,
  );
  expect(deltas.map((delta) => delta.content)).toEqual(['', '']);
});

it('keeps the proposal URI exact and selects the configured context through headers', async () => {
  await new AdtHttpClient(config).post(proposal, '<request/>', 'application/xml');
  const [csrfUrl] = mockFetch.mock.calls[0]!;
  expect(String(csrfUrl)).toContain('sap-client=123');
  const [url, options] = mockFetch.mock.calls.at(-1)!;
  expect(String(url)).toBe(`https://sap.test${proposal}`);
  expect(options?.headers).toMatchObject({
    'sap-client': '123',
    'sap-language': 'DE',
    'X-SAP-SAML2': 'disabled',
    'X-CSRF-Token': 'token',
  });
});

it('keeps the same client and exact URI after refreshing CSRF', async () => {
  mockFetch
    .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'old' }))
    .mockResolvedValueOnce(mockResponse(403, '', { 'x-csrf-token': 'Required' }))
    .mockResolvedValueOnce(mockResponse(200, '', { 'x-csrf-token': 'new' }))
    .mockResolvedValueOnce(mockResponse(200, '<result/>'));
  await new AdtHttpClient(config).post(proposal, '<request/>', 'application/xml');
  const posts = mockFetch.mock.calls.filter(([, options]) => options?.method === 'POST');
  expect(posts).toHaveLength(2);
  for (const [url, options] of posts) {
    expect(String(url)).toBe(`https://sap.test${proposal}`);
    expect(options?.headers).toMatchObject({ 'sap-client': '123', 'sap-language': 'DE' });
  }
});

it('preserves proposal-owned query parameters and omits unconfigured context headers', async () => {
  await new AdtHttpClient({ baseUrl: config.baseUrl }).post(`${proposal}?opaque=state`, '', 'application/xml');
  const [url, options] = mockFetch.mock.calls.at(-1)!;
  expect(String(url)).toBe(`https://sap.test${proposal}?opaque=state`);
  expect(options?.headers).not.toHaveProperty('sap-client');
  expect(options?.headers).not.toHaveProperty('sap-language');
});

it.each(['/sap/bc/adt/quickfixes/evaluation?uri=source', '/sap/bc/adt/activation'])(
  'retains context query parameters for %s',
  async (path) => {
    await new AdtHttpClient(config).post(path, '', 'application/xml');
    const [url] = mockFetch.mock.calls.at(-1)!;
    expect(String(url)).toContain('sap-client=123');
    expect(String(url)).toContain('sap-language=DE');
    expect(String(url)).toContain('saml2=disabled');
  },
);
