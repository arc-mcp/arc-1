import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../src/server/logger.js';
import { assertMultiTargetAuthorizationStartup, createAndStartServer } from '../../../src/server/server.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';

const CONFIG: ServerConfig = {
  ...DEFAULT_CONFIG,
  multiTargetEndpoints: true,
  multiTargetAuthorization: 'xsuaa-attribute',
  transport: 'http-streamable',
  xsuaaAuth: true,
  cacheMode: 'none',
};

describe('enforced multi-only startup boundary', () => {
  let network: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.stubEnv('SAP_BTP_DESTINATION', '');
    vi.stubEnv('SAP_BTP_PP_DESTINATION', '');
    network = vi.fn(async () => {
      throw new Error('Unexpected startup network access');
    });
    vi.stubGlobal('fetch', network);
    vi.spyOn(logger, 'info').mockImplementation(() => {});
  });
  afterEach(() => {
    expect(network).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    ['url', 'https://sap.example.test'],
    ['username', 'SHARED_USER'],
    ['password', 'shared-password-marker'],
    ['destinationName', 'SINGLE_DEST'],
    ['btpServiceKey', '{"mustNotBeParsed":true}'],
    ['btpServiceKeyFile', '/must/not/be/read/service-key.json'],
  ])('rejects resolved %s before service-key resolution, logging or network', async (field, value) => {
    await expect(createAndStartServer({ ...CONFIG, [field]: value })).rejects.toThrow('multi-only deployment');
    expect(logger.info).not.toHaveBeenCalled();
  });

  it.each(['SAP_BTP_DESTINATION', 'SAP_BTP_PP_DESTINATION'])(
    'rejects unresolved %s before runtime contact',
    async (name) => {
      vi.stubEnv(name, 'PRIVATE_DESTINATION_MARKER');
      await expect(createAndStartServer(CONFIG)).rejects.toThrow('multi-only deployment');
      expect(logger.info).not.toHaveBeenCalled();
    },
  );

  it('rejects misplaced enforcement before any runtime startup', async () => {
    await expect(createAndStartServer({ ...CONFIG, multiTargetEndpoints: false })).rejects.toThrow(
      'requires ARC1_MULTI_TARGET_ENDPOINTS=true',
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('permits pure multi-only configuration without inventing single-target conflicts', () => {
    expect(() => assertMultiTargetAuthorizationStartup(CONFIG, {})).not.toThrow();
  });

  it('leaves legacy mixed runtime configuration untouched', () => {
    expect(() =>
      assertMultiTargetAuthorizationStartup(
        {
          ...CONFIG,
          multiTargetAuthorization: 'legacy',
          url: 'https://sap.example.test',
          username: 'USER',
          password: 'test',
          destinationName: 'SINGLE_DEST',
        },
        { SAP_BTP_DESTINATION: 'DEST', SAP_BTP_PP_DESTINATION: 'PP_DEST' },
      ),
    ).not.toThrow();
  });

  it('does not include connection secrets in the startup failure', async () => {
    const secret = 'PRIVATE_CREDENTIAL_MARKER';
    await expect(createAndStartServer({ ...CONFIG, password: secret })).rejects.not.toThrow(secret);
  });
});
