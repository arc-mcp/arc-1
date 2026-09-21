import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import type { ResolvedFeatures } from '../../../src/adt/types.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const features = await import('../../../src/handlers/feature-cache.js');
const deadline = await import('../../../src/adt/http-deadline.js');
const { requestContext } = await import('../../../src/server/context.js');
const xml = readFileSync(new URL('../../fixtures/xml/publish-recovery/active.xml', import.meta.url), 'utf8');
const failure = readFileSync(new URL('../../fixtures/xml/publish-recovery/error.xml', import.meta.url), 'utf8');
const ok =
  '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY></DATA></asx:values></asx:abap>';
const name = 'ZARC1_PUBLISH';
const args = { action: 'publish_srvb', name, service_type: 'odatav4' };
let jobs = 0;
let reads = 0;
let responseForRead: (n: number) => string;
let retryBody: string;
let firstBody: string;
function call(client = createClient(), overrides = {}) {
  return handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', { ...args, ...overrides });
}
const text = (r: Awaited<ReturnType<typeof call>>) => r.content[0]?.text ?? '';
beforeEach(() => {
  vi.restoreAllMocks();
  features.resetCachedFeatures();
  features.setCachedFeatures({ systemType: 'btp' } as ResolvedFeatures);
  vi.spyOn(deadline, 'sleepWithinRequestBudget').mockResolvedValue();
  jobs = 0;
  reads = 0;
  retryBody = ok;
  firstBody = failure;
  responseForRead = () => (jobs >= 2 ? xml.replace('published="false"', 'published="true"') : xml);
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url, init) => {
    if (String(url).includes('/publishjobs')) {
      jobs++;
      return mockResponse(200, jobs === 1 ? firstBody : retryBody);
    }
    if (init?.method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'T' });
    if (String(url).includes('version=active')) return mockResponse(200, responseForRead(++reads));
    return mockResponse(200, xml, { 'x-csrf-token': 'T' });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  features.resetCachedFeatures();
});

describe('publish recovery through the dispatcher', () => {
  it('retries once after fresh state checks and verifies success, preserving the first failure', async () => {
    const r = await call();
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain('after one retry');
    expect(text(r)).toContain('Inbound service ZARC1_PUBLISH_0001_G4BA does not exist');
    expect(jobs).toBe(2);
    expect(reads).toBeGreaterThanOrEqual(3);
    expect(deadline.sleepWithinRequestBudget).toHaveBeenCalledWith(
      10000,
      expect.objectContaining({ deadline: expect.any(Number) }),
    );
  });
  it('stops after the same permanent failure without reporting success', async () => {
    retryBody = failure;
    const r = await call();
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('Retry failed');
    expect(text(r)).toContain('Inbound service');
    expect(jobs).toBe(2);
  });
  it.each([1, 2])('does not repost when state is published at check %i', async (n) => {
    responseForRead = (i) => (i >= n ? xml.replace('published="false"', 'published="true"') : xml);
    const r = await call();
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain('already published');
    expect(jobs).toBe(1);
    expect(deadline.sleepWithinRequestBudget).toHaveBeenCalledTimes(n - 1);
  });
  it.each([
    ['inactive', xml.replace('adtcore:version="active"', 'adtcore:version="inactive"')],
    ['missing flag', xml.replace('srvb:published="false"', '')],
    ['other binding', xml.replaceAll(name, 'ZOTHER')],
    ['other version', xml.replace('srvb:version="0001"', 'srvb:version="0002"')],
    ['Web API', xml.replace('srvb:category="0"', 'srvb:category="1"')],
  ])('does not retry with %s metadata', async (_label, body) => {
    responseForRead = () => body;
    const r = await call();
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('unknown');
    expect(jobs).toBe(1);
    expect(deadline.sleepWithinRequestBudget).not.toHaveBeenCalled();
  });
  it('stops if metadata becomes unknown during the grace period', async () => {
    responseForRead = (i) => (i === 1 ? xml : xml.replace('srvb:published="false"', ''));
    expect((await call()).isError).toBe(true);
    expect(jobs).toBe(1);
  });
  it('requires a published readback even after an OK retry response', async () => {
    responseForRead = () => xml;
    const r = await call();
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('not confirmed');
    expect(jobs).toBe(2);
  });
  it.each(['onprem', undefined])('does not retry for system type %s', async (systemType) => {
    features.setCachedFeatures(systemType ? ({ systemType } as ResolvedFeatures) : undefined);
    expect((await call()).isError).toBe(true);
    expect(jobs).toBe(1);
    expect(reads).toBe(0);
  });
  it('does not infer BTP from bearer authentication when the probe is not ready', async () => {
    features.resetCachedFeatures();
    const client = new AdtClient({
      baseUrl: 'http://sap:8000',
      bearerTokenProvider: async () => 'own-token',
      safety: unrestrictedSafetyConfig(),
    });
    expect((await call(client)).isError).toBe(true);
    expect(jobs).toBe(1);
    expect(reads).toBe(0);
  });
  it.each([{ service_type: 'odatav2' }, { version: '0002' }])(
    'does not broaden to another endpoint/version: %j',
    async (overrides) => {
      expect((await call(createClient(), overrides)).isError).toBe(true);
      expect(jobs).toBe(1);
      expect(reads).toBe(0);
    },
  );
  it.each([
    failure.replace('Local Publish of ZARC1_PUBLISH failed', 'Local Publish of ZOTHER failed'),
    failure.replace('ZARC1_PUBLISH_0001_G4BA', 'ZOTHER_0001_G4BA'),
    failure.replace('does not exist', 'is unauthorized'),
  ])('does not recover an unrecognized SAP result', async (body) => {
    firstBody = body;
    expect((await call()).isError).toBe(true);
    expect(jobs).toBe(1);
    expect(reads).toBe(0);
  });
  it('keeps the successful normal path free of recovery reads or delays', async () => {
    firstBody = ok;
    mockFetch.mockImplementation(async (_url, init) =>
      init?.method === 'POST'
        ? mockResponse(200, ok)
        : mockResponse(200, xml.replace('published="false"', 'published="true"'), { 'x-csrf-token': 'T' }),
    );
    expect((await call()).isError).toBeUndefined();
    expect(deadline.sleepWithinRequestBudget).not.toHaveBeenCalled();
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('version=active'))).toBe(false);
  });
  it('revalidates a changed package before retrying', async () => {
    const client = new AdtClient({
      baseUrl: 'http://sap:8000',
      username: 'own-user',
      password: 'own-pass',
      safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['ZARC1_TEST'] },
    });
    responseForRead = () => xml.replace('adtcore:name="ZARC1_TEST"', 'adtcore:name="ZFORBIDDEN"');
    const r = await call(client);
    expect(r.isError).toBe(true);
    expect(jobs).toBe(1);
  });
  it('checks the write ceiling again after waiting', async () => {
    const client = createClient();
    vi.mocked(deadline.sleepWithinRequestBudget).mockImplementation(async () => {
      client.safety.allowWrites = false;
    });
    expect((await call(client)).isError).toBe(true);
    expect(jobs).toBe(1);
  });
  it('honors request cancellation after the wait before another publish', async () => {
    const controller = new AbortController();
    vi.mocked(deadline.sleepWithinRequestBudget).mockImplementation(async () => {
      controller.abort();
    });
    const r = await requestContext.run({ requestId: 'cancel-publish', signal: controller.signal }, () => call());
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('cancel');
    expect(jobs).toBe(1);
  });
  it('shares the recovery deadline across the wait and the next request', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.mocked(deadline.sleepWithinRequestBudget).mockImplementation(async () => {
      vi.setSystemTime(Date.now() + 150001);
    });
    const r = await call();
    expect(r.isError).toBe(true);
    expect(jobs).toBe(1);
  });
  it('preserves a failed state read and never proceeds to publish', async () => {
    responseForRead = () => {
      throw Error('state read failed');
    };
    const r = await call();
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('Inbound service');
    expect(jobs).toBe(1);
  });
});

describe('recovery review regressions', () => {
  it('does not suggest missing dependencies for a different retry error', async () => {
    retryBody = failure.replace('Inbound service ZARC1_PUBLISH_0001_G4BA does not exist', 'Authorization missing');
    const r = await call();
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('Authorization missing');
    expect(text(r)).not.toContain('may still be missing');
    expect(jobs).toBe(2);
  });
  it('requires a resolvable package again before the retry', async () => {
    const client = new AdtClient({
      baseUrl: 'http://sap:8000',
      username: 'own-user',
      password: 'own-pass',
      safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['ZARC1_TEST'] },
    });
    responseForRead = () => xml.replace('adtcore:name="ZARC1_TEST"', '');
    const r = await call(client);
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('could not determine');
    expect(jobs).toBe(1);
  });
  it('never starts a late mutation after a cancelled subtree lookup resolves', async () => {
    const controller = new AbortController();
    const client = new AdtClient({
      baseUrl: 'http://sap:8000',
      username: 'own-user',
      password: 'own-pass',
      safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['ZARC1_TEST', 'ZROOT/**'] },
    });
    responseForRead = () => xml.replace('adtcore:name="ZARC1_TEST"', 'adtcore:name="ZROOT_CHILD"');
    let finish: (value: boolean) => void = () => {
      throw Error('Lookup never started');
    };
    vi.spyOn(client, 'getPackageHierarchyResolver').mockReturnValue({
      invalidate: () => {},
      isDescendantOrSelf: () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
          controller.abort();
        }),
    });
    const r = await requestContext.run({ requestId: 'cancel-package', signal: controller.signal }, () => call(client));
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('cancelled');
    expect(text(r)).toContain('No retry sent');
    finish(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(jobs).toBe(1);
  });
});
