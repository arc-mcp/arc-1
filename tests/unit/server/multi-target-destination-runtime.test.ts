import type { BTPConfig } from '@arc-mcp/xsuaa-auth/btp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resolveRuntimeSubaccountDestination,
  resolveRuntimeSubaccountPpDestination,
} from '../../../src/server/multi-target-destination-runtime.js';

const BTP_CONFIG: BTPConfig = {
  xsuaaUrl: 'https://xsuaa.example.test',
  xsuaaClientId: 'xsuaa-client',
  xsuaaSecret: 'xsuaa-secret',
  destinationUrl: 'https://destination.example.test',
  destinationClientId: 'destination-client',
  destinationSecret: 'destination-secret',
  destinationTokenUrl: 'https://destination.example.test/oauth/token',
  connectivityProxyHost: 'proxy.internal',
  connectivityProxyPort: '20003',
  connectivityClientId: 'connectivity-client',
  connectivitySecret: 'connectivity-secret',
  connectivityTokenUrl: 'https://connectivity.example.test/oauth/token',
};

const BASIC_CONFIGURATION = {
  Name: 'ARC1_A4H_100_BASIC',
  Type: 'HTTP',
  URL: 'http://a4h.internal:50000',
  Authentication: 'BasicAuthentication',
  ProxyType: 'OnPremise',
  User: 'ARC1_READER',
  Password: 'CURRENT_PASSWORD',
  'sap-sysid': 'A4H',
  'sap-client': '100',
  'arc1.enabled': 'true',
  'arc1.client_secret': 'MUST_NOT_SURVIVE',
};

const PP_CONFIGURATION = {
  Name: 'ARC1_A4H_100_PP',
  Type: 'HTTP',
  URL: 'http://a4h.internal:50000',
  Authentication: 'PrincipalPropagation',
  ProxyType: 'OnPremise',
  CloudConnectorLocationId: 'SCC_A4H',
  'sap-sysid': 'A4H',
  'sap-client': '100',
  Description: 'A4H client 100',
  'arc1.enabled': 'true',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tokenResponse(): Response {
  return jsonResponse({ access_token: 'destination-service-token', expires_in: 300 });
}

function destinationResponse(
  configuration: Readonly<Record<string, unknown>>,
  level: 'subaccount' | 'instance' = 'subaccount',
): Response {
  return jsonResponse({
    owner: level === 'subaccount' ? { SubaccountId: 'subaccount-id' } : { InstanceId: 'instance-id' },
    destinationConfiguration: configuration,
  });
}

describe('multi-target runtime destination level enforcement', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads Basic credentials only from an owner-confirmed subaccount Find response', async () => {
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(destinationResponse(BASIC_CONFIGURATION));

    const destination = await resolveRuntimeSubaccountDestination(BTP_CONFIG, BASIC_CONFIGURATION.Name);

    expect(destination).toMatchObject({
      Name: BASIC_CONFIGURATION.Name,
      User: 'ARC1_READER',
      Password: 'CURRENT_PASSWORD',
      'sap-client': '100',
    });
    expect(destination.originalProperties).toMatchObject({
      'sap-sysid': 'A4H',
      'arc1.enabled': 'true',
    });
    expect(destination.originalProperties).not.toHaveProperty('Password');
    expect(destination.originalProperties?.['arc1.client_secret']).toBe('');
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      `${BTP_CONFIG.destinationUrl}/destination-configuration/v1/destinations/${BASIC_CONFIGURATION.Name}?$skipTokenRetrieval=true`,
      expect.objectContaining({
        headers: { Authorization: 'Bearer destination-service-token' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('rejects an instance-level Basic shadow even when Find returns valid credentials', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(destinationResponse({ ...BASIC_CONFIGURATION, Password: 'SHADOW_PASSWORD' }, 'instance'));

    await expect(resolveRuntimeSubaccountDestination(BTP_CONFIG, BASIC_CONFIGURATION.Name)).rejects.toMatchObject({
      name: 'RuntimeDestinationLevelError',
      code: 'INSTANCE_DESTINATION_SHADOW',
    });
  });

  it('rejects a destination that no longer exists at runtime', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(resolveRuntimeSubaccountDestination(BTP_CONFIG, BASIC_CONFIGURATION.Name)).rejects.toMatchObject({
      code: 'DESTINATION_NOT_FOUND_AT_SUBACCOUNT',
    });
  });

  it('accepts an explicit subaccount PP destination after Connectivity validates the user JWT', async () => {
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(destinationResponse(PP_CONFIGURATION))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'validated-user-token' }));

    const result = await resolveRuntimeSubaccountPpDestination(
      BTP_CONFIG,
      PP_CONFIGURATION.Name,
      'header.payload.signature',
    );

    expect(result.destination).toMatchObject({
      Name: PP_CONFIGURATION.Name,
      Authentication: 'PrincipalPropagation',
      'sap-client': '100',
    });
    expect(result.authTokens.sapConnectivityAuth).toBe('Bearer header.payload.signature');
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      BTP_CONFIG.connectivityTokenUrl,
      expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
    );
  });

  it('rejects an instance PP shadow before validating the user JWT', async () => {
    const fetchMock = vi
      .mocked(fetch)
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(destinationResponse(PP_CONFIGURATION, 'instance'));

    await expect(
      resolveRuntimeSubaccountPpDestination(BTP_CONFIG, PP_CONFIGURATION.Name, 'header.payload.signature'),
    ).rejects.toMatchObject({
      name: 'RuntimeDestinationLevelError',
      code: 'INSTANCE_DESTINATION_SHADOW',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns no PP credential when Connectivity rejects the user JWT', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(tokenResponse())
      .mockResolvedValueOnce(destinationResponse(PP_CONFIGURATION))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    const result = await resolveRuntimeSubaccountPpDestination(
      BTP_CONFIG,
      PP_CONFIGURATION.Name,
      'header.payload.signature',
    );

    expect(result.authTokens).toEqual({});
  });
});
