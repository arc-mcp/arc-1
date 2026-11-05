import { beforeEach, expect, it } from 'vitest';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { pinnedPublicAuth, pinnedPublicRuntime } from '../../helpers/pinned-public-auth.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { pinnedMutationAllowed } = await import('../../../src/server/multi-target-write-surface.js');
const id = 'A4HK900001',
  path = `/sap/bc/adt/cts/transportrequests/${id}`;
let released = false,
  lost = false;
const sent: Array<{ path: string; method: string }> = [];
const tree = () =>
  `<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="${id}" tm:owner="SYNTHETIC" tm:type="K" tm:status="${released ? 'R' : 'D'}" tm:target="" tm:desc="Synthetic"/></tm:root>`;
beforeEach(() => {
  mockFetch.mockReset();
  sent.length = 0;
  released = false;
  lost = false;
  mockFetch.mockImplementation(async (url, options = {}) => {
    const uri = new URL(String(url));
    const method = options.method ?? 'GET';
    sent.push({ path: uri.pathname, method });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'synthetic' });
    if (method === 'GET' && uri.pathname.includes('inactiveobjects'))
      return mockResponse(200, '<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects"/>');
    if (method === 'GET' && uri.pathname === path)
      return lost && released ? mockResponse(503, 'Terminal evidence unavailable') : mockResponse(200, tree());
    if (method === 'POST' && uri.pathname === `${path}/newreleasejobs`) {
      released = true;
      if (lost) return mockResponse(503, 'Native response unavailable');
      return mockResponse(
        200,
        `<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:releasereports><c:checkReport xmlns:c="http://www.sap.com/adt/checkrun" c:status="released" c:triggeringUri="${path}"/></tm:releasereports></tm:root>`,
      );
    }
    throw new Error(`Unexpected synthetic request ${method} ${uri.pathname}`);
  });
});
async function run(server = [id], destination = [id], scopes = ['read', 'write', 'transports']) {
  const auth = pinnedPublicAuth(scopes),
    config = await pinnedPublicRuntime(server, destination, auth);
  expect(config.allowedTransports).toEqual([]);
  expect(config.multiTargetWrite?.serverAllowedTransports).toEqual(server);
  const client = new AdtClient({ baseUrl: 'https://sap.invalid', client: '001', safety: config });
  return handleToolCall(
    client,
    config,
    'SAPTransport',
    { action: 'release', id, timeoutSeconds: 1 },
    auth,
    undefined,
    undefined,
    true,
  );
}
it('releases once through the real builder, public dispatch and shared native CTS verifier', async () => {
  const result = await run();
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(JSON.parse(result.content[0].text)).toMatchObject({
    state: 'confirmed',
    completed: [{ id, operation: 'release' }],
  });
  expect(sent.filter((call) => call.method === 'POST')).toHaveLength(1);
});
it.each(['server', 'destination'])(
  'the real builder’s empty legacy allowlist cannot bypass %s request restrictions',
  async (side) => {
    const result = await run(side === 'server' ? ['A4HK900099'] : [id], side === 'destination' ? ['A4HK900099'] : [id]);
    expect(result.isError).toBe(true);
    expect(
      sent.filter((call) => call.method === 'POST' || call.method === 'PUT' || call.method === 'DELETE'),
    ).toHaveLength(0);
  },
);
it('a functional writer without transports scope cannot submit CTS management', async () => {
  expect((await run([id], [id], ['read', 'write'])).isError).toBe(true);
  expect(sent).toHaveLength(0);
});
it('preserves uncertainty without replay when release and terminal evidence are unavailable', async () => {
  lost = true;
  const result = await run();
  expect(result.isError).toBe(true);
  expect(JSON.parse(result.content[0].text)).toMatchObject({
    state: 'incomplete',
    completed: [],
    submissions: [{ id, acknowledged: false }],
  });
  expect(sent.filter((call) => call.method === 'POST')).toHaveLength(1);
});
it('distinguishes a native CTS target from a route selector before destination preparation', async () => {
  const config = await pinnedPublicRuntime(['*'], ['*']);
  expect(
    pinnedMutationAllowed('SAPTransport', { action: 'create', description: 'Synthetic', target: 'A4H/001' }, config),
  ).toBe(false);
  expect(
    pinnedMutationAllowed('SAPTransport', { action: 'create', description: 'Synthetic', target: 'A4H' }, config),
  ).toBe(true);
  expect(sent).toHaveLength(0);
});
