import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import type { ResolvedFeatures } from '../../../src/adt/types.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const features = await import('../../../src/handlers/feature-cache.js');
const { requestContext } = await import('../../../src/server/context.js');
const xml = readFileSync(new URL('../../fixtures/xml/publish-failure/active.xml', import.meta.url), 'utf8');
const failure = readFileSync(new URL('../../fixtures/xml/publish-failure/error.xml', import.meta.url), 'utf8');
const ok =
  '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><SEVERITY>OK</SEVERITY></DATA></asx:values></asx:abap>';
const name = 'ZARC1_PUBLISH';
const args = { action: 'publish_srvb', name, service_type: 'odatav4' };
let jobs = 0;
let reads = 0;
let responseForRead: () => string;
let firstBody: string;
function call(client = createClient(), overrides = {}) {
  return handleToolCall(client, DEFAULT_CONFIG, 'SAPActivate', { ...args, ...overrides });
}
const text = (r: Awaited<ReturnType<typeof call>>) => r.content[0]?.text ?? '';
beforeEach(() => {
  vi.restoreAllMocks();
  features.resetCachedFeatures();
  features.setCachedFeatures({ systemType: 'btp' } as ResolvedFeatures);
  jobs = 0;
  reads = 0;
  firstBody = failure;
  responseForRead = () => xml;
  mockFetch.mockReset();
  mockFetch.mockImplementation(async (url, init) => {
    if (String(url).includes('/publishjobs')) {
      jobs++;
      return mockResponse(200, firstBody);
    }
    if (init?.method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'T' });
    if (String(url).includes('version=active')) {
      reads++;
      return mockResponse(200, responseForRead());
    }
    return mockResponse(200, xml, { 'x-csrf-token': 'T' });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  features.resetCachedFeatures();
});

describe('publish failure inspection through the dispatcher', () => {
  it('returns explicit unpublished state without automatically publishing again', async () => {
    const r = await call();
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('unpublished');
    expect(text(r)).toContain('Inbound service ZARC1_PUBLISH_0001_G4BA does not exist');
    expect(jobs).toBe(1);
    expect(reads).toBe(1);
  });
  it('reports confirmed published state without sending another publish', async () => {
    responseForRead = () => xml.replace('published="false"', 'published="true"');
    const r = await call();
    expect(r.isError).toBeUndefined();
    expect(text(r)).toContain('already published');
    expect(text(r)).toContain('Inbound service');
    expect(jobs).toBe(1);
    expect(reads).toBe(1);
  });
  it.each([
    ['inactive', xml.replace('adtcore:version="active"', 'adtcore:version="inactive"')],
    ['missing flag', xml.replace('srvb:published="false"', '')],
    ['other binding', xml.replaceAll(name, 'ZOTHER')],
    ['other version', xml.replace('srvb:version="0001"', 'srvb:version="0002"')],
    ['Web API', xml.replace('srvb:category="0"', 'srvb:category="1"')],
  ])('reports unknown state for %s metadata', async (_label, body) => {
    responseForRead = () => body;
    const r = await call();
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('unknown');
    expect(jobs).toBe(1);
  });
  it.each(['onprem', undefined])('does not inspect state for system type %s', async (systemType) => {
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
  ])('does not inspect an unrecognized SAP result', async (body) => {
    firstBody = body;
    expect((await call()).isError).toBe(true);
    expect(jobs).toBe(1);
    expect(reads).toBe(0);
  });
  it('keeps the successful normal path free of failure-state inspection', async () => {
    firstBody = ok;
    mockFetch.mockImplementation(async (_url, init) =>
      init?.method === 'POST'
        ? mockResponse(200, ok)
        : mockResponse(200, xml.replace('published="false"', 'published="true"'), { 'x-csrf-token': 'T' }),
    );
    expect((await call()).isError).toBeUndefined();
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('version=active'))).toBe(false);
  });
  it('does not report success if cancelled while reading active state', async () => {
    const controller = new AbortController();
    responseForRead = () => {
      controller.abort();
      return xml.replace('published="false"', 'published="true"');
    };
    const r = await requestContext.run({ requestId: 'cancel-publish-state', signal: controller.signal }, () => call());
    expect(r.isError).toBe(true);
    expect(text(r)).toContain('cancelled');
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
