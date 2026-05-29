/**
 * Tests for BTP principal propagation (per-user destination lookup).
 *
 * Tests the lookupDestinationWithUserToken function which uses
 * SAP Cloud SDK's getDestination() to resolve destinations with
 * per-user JWT for principal propagation via Cloud Connector.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the SAP Cloud SDK's getDestination
const mockGetDestination = vi.fn();
vi.mock('@sap-cloud-sdk/connectivity', () => ({
  getDestination: mockGetDestination,
}));

// Mock fetch for the jwt-bearer fallback path (which still uses direct fetch)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Must import AFTER mocking
const { lookupDestinationWithUserToken } = await import('../../../src/adt/btp.js');

import type { BTPConfig } from '../../../src/adt/btp.js';

const TEST_BTP_CONFIG: BTPConfig = {
  xsuaaUrl: 'https://test.auth.example.com',
  xsuaaClientId: 'xsuaa-client',
  xsuaaSecret: 'xsuaa-secret',
  destinationUrl: 'https://destination.example.com',
  destinationClientId: 'dest-client',
  destinationSecret: 'dest-secret',
  destinationTokenUrl: 'https://test.auth.example.com/oauth/token',
  connectivityProxyHost: 'proxy.internal',
  connectivityProxyPort: '20003',
  connectivityClientId: 'conn-client',
  connectivitySecret: 'conn-secret',
  connectivityTokenUrl: 'https://test.auth.example.com/oauth/token',
};

describe('lookupDestinationWithUserToken', () => {
  beforeEach(() => {
    mockGetDestination.mockReset();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves destination via SDK and returns PrincipalPropagation auth tokens', async () => {
    mockGetDestination.mockResolvedValueOnce({
      name: 'SAP_TRIAL',
      url: 'http://sap:50000',
      authentication: 'PrincipalPropagation',
      proxyType: 'OnPremise',
      username: '',
      password: '',
      authTokens: [
        {
          type: 'PrincipalPropagationToken',
          value: 'saml-assertion-encoded',
          error: null,
          http_header: {
            key: 'SAP-Connectivity-Authentication',
            value: 'Bearer saml-assertion-encoded',
          },
        },
      ],
    });

    const result = await lookupDestinationWithUserToken(TEST_BTP_CONFIG, 'SAP_TRIAL', 'user-jwt-token');

    // Verify SDK was called with correct args
    expect(mockGetDestination).toHaveBeenCalledWith({
      destinationName: 'SAP_TRIAL',
      jwt: 'user-jwt-token',
      useCache: true,
    });

    // Verify destination was resolved
    expect(result.destination.Name).toBe('SAP_TRIAL');
    expect(result.destination.Authentication).toBe('PrincipalPropagation');

    // Verify auth tokens were extracted
    expect(result.authTokens.sapConnectivityAuth).toBe('Bearer saml-assertion-encoded');
  });

  it('returns Bearer token for OAuth2SAMLBearerAssertion destinations', async () => {
    mockGetDestination.mockResolvedValueOnce({
      name: 'S4_CLOUD',
      url: 'https://s4.cloud.sap',
      authentication: 'OAuth2SAMLBearerAssertion',
      proxyType: 'Internet',
      username: '',
      password: '',
      authTokens: [
        {
          type: 'Bearer',
          value: 'oauth-access-token-for-user',
          error: null,
          http_header: {
            key: 'Authorization',
            value: 'Bearer oauth-access-token-for-user',
          },
        },
      ],
    });

    const result = await lookupDestinationWithUserToken(TEST_BTP_CONFIG, 'S4_CLOUD', 'user-jwt');

    expect(result.authTokens.bearerToken).toBe('oauth-access-token-for-user');
    expect(result.authTokens.sapConnectivityAuth).toBeUndefined();
  });

  it('returns Bearer token for OAuth2UserTokenExchange (SDK lowercases type to "bearer", #301)', async () => {
    // Verified live against a BTP ABAP Environment: the Destination Service returns the auth
    // token entry with type "bearer" (lowercase), not "Bearer". A capital-B-only check dropped it.
    mockGetDestination.mockResolvedValueOnce({
      name: 'ABAP_FREE_PP',
      url: 'https://abc.abap.us10.hana.ondemand.com',
      authentication: 'OAuth2UserTokenExchange',
      proxyType: 'Internet',
      username: '',
      password: '',
      authTokens: [
        {
          type: 'bearer',
          value: 'abap-user-context-token',
          error: null,
          http_header: { key: 'Authorization', value: 'Bearer abap-user-context-token' },
        },
      ],
    });

    const result = await lookupDestinationWithUserToken(TEST_BTP_CONFIG, 'ABAP_FREE_PP', 'user-jwt');

    expect(result.authTokens.bearerToken).toBe('abap-user-context-token');
    expect(result.authTokens.sapConnectivityAuth).toBeUndefined();
  });

  it('falls back to the Authorization http_header when a bearer entry has no top-level value', async () => {
    mockGetDestination.mockResolvedValueOnce({
      name: 'ABAP_FREE_PP',
      url: 'https://abc.abap.us10.hana.ondemand.com',
      authentication: 'OAuth2UserTokenExchange',
      proxyType: 'Internet',
      username: '',
      password: '',
      authTokens: [
        {
          type: 'bearer',
          value: '', // empty top-level value — only the header carries the token
          error: null,
          http_header: { key: 'Authorization', value: 'Bearer header-only-token' },
        },
      ],
    });

    const result = await lookupDestinationWithUserToken(TEST_BTP_CONFIG, 'ABAP_FREE_PP', 'user-jwt');

    expect(result.authTokens.bearerToken).toBe('header-only-token');
  });

  it('throws on auth token error from Destination Service', async () => {
    mockGetDestination.mockResolvedValueOnce({
      name: 'SAP_TRIAL',
      url: 'http://sap:50000',
      authentication: 'PrincipalPropagation',
      proxyType: 'OnPremise',
      username: '',
      password: '',
      authTokens: [
        {
          type: 'PrincipalPropagationToken',
          value: '',
          error: 'User token validation failed: token expired',
          http_header: {
            key: 'SAP-Connectivity-Authentication',
            value: '',
          },
        },
      ],
    });

    await expect(lookupDestinationWithUserToken(TEST_BTP_CONFIG, 'SAP_TRIAL', 'expired-jwt')).rejects.toThrow(
      'auth token error',
    );
  });

  it('throws when SDK returns null (destination not found)', async () => {
    mockGetDestination.mockResolvedValueOnce(null);

    await expect(lookupDestinationWithUserToken(TEST_BTP_CONFIG, 'NONEXISTENT', 'user-jwt')).rejects.toThrow(
      "no destination for 'NONEXISTENT'",
    );
  });

  it('handles destinations with no authTokens array', async () => {
    mockGetDestination.mockResolvedValueOnce({
      name: 'SAP_BASIC',
      url: 'http://sap:50000',
      authentication: 'BasicAuthentication',
      proxyType: 'OnPremise',
      username: 'DEVELOPER',
      password: 'pass123',
      // No authTokens for BasicAuthentication
    });

    const result = await lookupDestinationWithUserToken(TEST_BTP_CONFIG, 'SAP_BASIC', 'user-jwt');

    expect(result.destination.Authentication).toBe('BasicAuthentication');
    expect(result.authTokens.sapConnectivityAuth).toBeUndefined();
    expect(result.authTokens.bearerToken).toBeUndefined();
  });

  it('maps cloudConnectorLocationId from SDK destination', async () => {
    mockGetDestination.mockResolvedValueOnce({
      name: 'SAP_PP_LOC2',
      url: 'http://sap:50000',
      authentication: 'PrincipalPropagation',
      proxyType: 'OnPremise',
      username: '',
      password: '',
      cloudConnectorLocationId: 'LOC2',
      authTokens: [
        {
          type: 'PrincipalPropagationToken',
          value: 'saml-assertion',
          error: null,
          http_header: {
            key: 'SAP-Connectivity-Authentication',
            value: 'Bearer saml-assertion',
          },
        },
      ],
    });

    const result = await lookupDestinationWithUserToken(TEST_BTP_CONFIG, 'SAP_PP_LOC2', 'user-jwt');

    expect(result.destination.CloudConnectorLocationId).toBe('LOC2');
  });

  it('falls back to jwt-bearer exchange when SDK returns no auth tokens for PP destination', async () => {
    // SDK returns PP destination with no authTokens
    mockGetDestination.mockResolvedValueOnce({
      name: 'SAP_PP',
      url: 'http://sap:50000',
      authentication: 'PrincipalPropagation',
      proxyType: 'OnPremise',
      username: '',
      password: '',
      authTokens: null,
    });

    // Mock the jwt-bearer exchange fetch call
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: 'exchanged-token', expires_in: 3600 }),
    });

    const userJwt = 'user-jwt-for-pp';
    const result = await lookupDestinationWithUserToken(TEST_BTP_CONFIG, 'SAP_PP', userJwt);

    // Verify jwt-bearer exchange was attempted
    expect(mockFetch).toHaveBeenCalledOnce();
    const [fetchUrl, fetchOpts] = mockFetch.mock.calls[0];
    expect(fetchUrl).toBe(TEST_BTP_CONFIG.connectivityTokenUrl);
    expect(fetchOpts.body).toContain('grant_type=urn');
    expect(fetchOpts.body).toContain('assertion=user-jwt-for-pp');

    // Verify Option 2: original JWT used as SAP-Connectivity-Authentication
    expect(result.authTokens.sapConnectivityAuth).toBe(`Bearer ${userJwt}`);
  });
});
