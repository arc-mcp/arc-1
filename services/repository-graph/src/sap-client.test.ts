import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./destination.js', () => ({
  resolveDestination: vi.fn(),
}));

import { resolveDestination } from './destination.js';
import { SapClient } from './sap.js';

const DIRECT_ENV = [
  'ARC_GRAPH_SAP_URL',
  'ARC_GRAPH_SAP_USER',
  'ARC_GRAPH_SAP_PASSWORD',
  'ARC_GRAPH_SAP_CLIENT',
  'ARC_GRAPH_SAP_TRUST_ALL',
] as const;

afterEach(() => {
  for (const name of DIRECT_ENV) delete process.env[name];
  vi.mocked(resolveDestination).mockReset();
});

describe('SapClient.create', () => {
  it('uses explicit direct credentials without resolving a destination', async () => {
    process.env.ARC_GRAPH_SAP_URL = 'https://sap.example.test';
    process.env.ARC_GRAPH_SAP_USER = 'collector';
    process.env.ARC_GRAPH_SAP_PASSWORD = 'secret';
    process.env.ARC_GRAPH_SAP_CLIENT = '001';

    const client = await SapClient.create();

    expect(client.destinationName).toBe('direct');
    expect(client.baseUrl).toBe('https://sap.example.test');
    expect(client.client).toBe('001');
    expect(resolveDestination).not.toHaveBeenCalled();
    await client.close();
  });

  it('rejects a partial direct configuration', async () => {
    process.env.ARC_GRAPH_SAP_URL = 'https://sap.example.test';

    await expect(SapClient.create()).rejects.toThrow(
      'ARC_GRAPH_SAP_URL, ARC_GRAPH_SAP_USER, and ARC_GRAPH_SAP_PASSWORD must be set together',
    );
    expect(resolveDestination).not.toHaveBeenCalled();
  });

  it('keeps destination resolution as the default', async () => {
    vi.mocked(resolveDestination).mockResolvedValue({
      authTokens: [{ http_header: { key: 'authorization', value: 'Bearer destination-token' } }],
      destinationConfiguration: { URL: 'https://destination.example.test', 'sap-client': '100' },
    });

    const client = await SapClient.create('TEST_DESTINATION');

    expect(client.destinationName).toBe('TEST_DESTINATION');
    expect(client.baseUrl).toBe('https://destination.example.test');
    expect(client.client).toBe('100');
    await client.close();
  });
});
