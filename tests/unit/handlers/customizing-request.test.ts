import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const create = (args: Record<string, unknown> = {}, client = createClient()) =>
  handleToolCall(client, DEFAULT_CONFIG, 'SAPTransport', {
    action: 'create',
    description: 'ZARC1_CX',
    requestType: 'W',
    ...args,
  });
const id = 'DEVK900001';
const xml = (type: string, target = '') =>
  `<tm:root><tm:request tm:number="${id}" tm:type="${type}" tm:target="${target}"/></tm:root>`;

describe('CTS request category on create', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([undefined, '', 'DEV'])(
    'creates W with target %j using newrequest and reads its category',
    async (target) => {
      mockFetch.mockResolvedValue(mockResponse(200, xml('W', target), { 'x-csrf-token': 'T' }));
      const result = await create({ target });
      expect(result.isError).toBeUndefined();
      const posts = mockFetch.mock.calls.filter(([, opts]) => opts.method === 'POST');
      expect(posts).toHaveLength(1);
      expect(new URL(posts[0]![0]).pathname).toBe('/sap/bc/adt/cts/transportrequests');
      expect(posts[0]![1].body).toContain('tm:useraction="newrequest"');
      expect(posts[0]![1].body).toContain(`tm:type="W" tm:target="${target ?? ''}"`);
      expect(result.content[0].text).toContain('Request type: W (Customizing)');
      expect(result.content[0].text).toContain(target || '<none> (local)');
      expect(new URL(mockFetch.mock.calls.at(-1)![0]).pathname).toBe(`/sap/bc/adt/cts/transportrequests/${id}`);
    },
  );

  it.each([{ package: 'ZTEST' }, { transportLayer: 'ZDEV' }])(
    'rejects Workbench routing before any SAP call',
    async (args) => {
      const result = await create(args);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Workbench requests only');
      expect(result.content[0].text).toContain('target to set the destination');
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it('rejects transport of copies in the schema', async () => {
    const result = await create({ requestType: 'T' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('K');
    expect(result.content[0].text).toContain('W');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('refuses requestType outside create', async () => {
    expect((await create({ action: 'list' })).content[0].text).toContain('only supported for create');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([true, false])('reports SE09/SE10 when newrequest is unsupported, discovery loaded=%s', async (loaded) => {
    const client = createClient();
    if (loaded) client.http.setDiscoveryMap(new Map([['/sap/bc/adt/oo/classes', ['application/xml']]]));
    mockFetch.mockImplementation(async (_url, opts) =>
      opts.method === 'POST'
        ? mockResponse(400, 'user action  is not supported')
        : mockResponse(200, '', { 'x-csrf-token': 'T' }),
    );
    const result = await create({}, client);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('cannot create Customizing requests through ADT');
    expect(result.content[0].text).toContain('SE09/SE10');
    expect(mockFetch.mock.calls.filter(([, opts]) => opts.method === 'POST')).toHaveLength(loaded ? 0 : 1);
  });

  it.each([
    ['K', 'with type K'],
    ['', 'could not be verified'],
  ])('identifies an already created request if verification fails', async (actual, reason) => {
    mockFetch.mockImplementation(async (_url, opts) =>
      mockResponse(200, xml(opts.method === 'POST' ? 'W' : actual), { 'x-csrf-token': 'T' }),
    );
    const result = await create();
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(id);
    expect(result.content[0].text).toContain(reason);
  });

  it.each([undefined, 'DEV'])(
    'explicit K has the same request and result as the default with target %j',
    async (target) => {
      mockFetch.mockImplementation(async (url, opts) =>
        mockResponse(
          200,
          opts.method === 'POST' && new URL(url).pathname.endsWith('/transports') ? id : xml('K', target),
          { 'x-csrf-token': 'T' },
        ),
      );
      const invoke = async (requestType?: string) => {
        mockFetch.mockClear();
        const result = await create({ requestType, target });
        expect(result.isError).toBeUndefined();
        const posts = mockFetch.mock.calls.filter(([, opts]) => opts.method === 'POST');
        expect(posts).toHaveLength(1);
        return { text: result.content[0].text, url: posts[0]![0], body: posts[0]![1].body };
      };
      expect(await invoke('K')).toEqual(await invoke());
    },
  );
});
