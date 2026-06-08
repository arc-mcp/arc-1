import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type BTPConfig, createConnectivityProxy, lookupDestination, parseVCAPServices } from '../../../src/adt/btp.js';

const BASE_BTP_CONFIG: BTPConfig = {
  xsuaaUrl: 'https://xsuaa.example.com',
  xsuaaClientId: 'xsuaa-client',
  xsuaaSecret: 'xsuaa-secret',
  destinationUrl: 'https://destination.example.com',
  destinationClientId: 'destination-client',
  destinationSecret: 'destination-secret',
  destinationTokenUrl: 'https://destination-auth.example.com/oauth/token',
  connectivityProxyHost: 'proxy.internal',
  connectivityProxyPort: '20003',
  connectivityClientId: 'connectivity-client',
  connectivitySecret: 'connectivity-secret',
  connectivityTokenUrl: 'https://connectivity-auth.example.com/oauth/token',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('BTP VCAP and startup helpers', () => {
  let savedVcapServices: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    savedVcapServices = process.env.VCAP_SERVICES;
    delete process.env.VCAP_SERVICES;
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    if (savedVcapServices === undefined) delete process.env.VCAP_SERVICES;
    else process.env.VCAP_SERVICES = savedVcapServices;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns null when VCAP_SERVICES is not set', () => {
    expect(parseVCAPServices()).toBeNull();
  });

  it('parses xsuaa, destination, and connectivity bindings with token URL fallbacks', () => {
    process.env.VCAP_SERVICES = JSON.stringify({
      xsuaa: [
        {
          name: 'xsuaa',
          credentials: {
            url: 'https://xsuaa.example.com',
            clientid: 'xsuaa-client',
            clientsecret: 'xsuaa-secret',
          },
        },
      ],
      destination: [
        {
          name: 'destination',
          credentials: {
            uri: 'https://destination.example.com',
            url: 'https://destination-auth.example.com',
            clientid: 'destination-client',
            clientsecret: 'destination-secret',
          },
        },
      ],
      connectivity: [
        {
          name: 'connectivity',
          credentials: {
            onpremise_proxy_host: 'proxy.internal',
            onpremise_proxy_http_port: '20003',
            clientid: 'connectivity-client',
            clientsecret: 'connectivity-secret',
            token_service_url: 'https://connectivity-auth.example.com',
          },
        },
      ],
    });

    const config = parseVCAPServices();

    expect(config).not.toBeNull();
    expect(config?.xsuaaUrl).toBe('https://xsuaa.example.com');
    expect(config?.destinationUrl).toBe('https://destination.example.com');
    expect(config?.destinationTokenUrl).toBe('https://destination-auth.example.com/oauth/token');
    expect(config?.connectivityProxyHost).toBe('proxy.internal');
    expect(config?.connectivityTokenUrl).toBe('https://connectivity-auth.example.com/oauth/token');
  });

  it('looks up a destination using a client-credentials token', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'destination-token', expires_in: 3600 }))
      .mockResolvedValueOnce(
        jsonResponse({
          destinationConfiguration: {
            Name: 'SAP_A4H',
            URL: 'https://sap.example.com',
            Authentication: 'BasicAuthentication',
            ProxyType: 'OnPremise',
            User: 'sap-user',
            Password: 'sap-password',
            'sap-client': '100',
            CloudConnectorLocationId: 'EU10',
          },
        }),
      );

    const destination = await lookupDestination(BASE_BTP_CONFIG, 'SAP_A4H');

    expect(destination.Name).toBe('SAP_A4H');
    expect(destination.ProxyType).toBe('OnPremise');
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://destination-auth.example.com/oauth/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://destination.example.com/destination-configuration/v1/destinations/SAP_A4H',
      { headers: { Authorization: 'Bearer destination-token' } },
    );
  });

  it('does not create a connectivity proxy when no proxy host is configured', () => {
    const proxy = createConnectivityProxy({
      ...BASE_BTP_CONFIG,
      connectivityProxyHost: '',
    });

    expect(proxy).toBeNull();
  });

  it('caches the connectivity proxy token until the expiry buffer', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'connectivity-token', expires_in: 3600 }));
    const proxy = createConnectivityProxy(BASE_BTP_CONFIG, 'EU10');

    expect(proxy).not.toBeNull();
    expect(proxy?.host).toBe('proxy.internal');
    expect(proxy?.port).toBe(20003);
    expect(proxy?.locationId).toBe('EU10');

    await expect(proxy!.getProxyToken()).resolves.toBe('connectivity-token');
    await expect(proxy!.getProxyToken()).resolves.toBe('connectivity-token');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://connectivity-auth.example.com/oauth/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );
  });
});
