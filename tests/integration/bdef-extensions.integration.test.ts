/** Read-only standard BDEF example; no SAP objects are created or changed. */
import { afterAll, beforeAll, describe, it } from 'vitest';
import { AdtClient } from '../../src/adt/client.js';
import { DataResponseBudget } from '../../src/adt/data-result-context.js';
import { createBearerTokenProvider, loadServiceKeyFile, parseServiceKey } from '../../src/adt/oauth.js';
import { parseDiscoveryDocument } from '../../src/adt/xml-parser.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { resetCachedFeatures, setCachedDiscovery, setCachedFeatures } from '../../src/handlers/feature-cache.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { assertBdefExtensions } from '../helpers/bdef-extension-assertions.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { getTestClient, hasBtpCredentials, hasSapCredentials } from './helpers.js';

for (const target of ['onprem', 'btp'] as const) {
  const describeIf = (target === 'btp' ? hasBtpCredentials() : hasSapCredentials()) ? describe : describe.skip;
  describeIf(`${target} BDEF extension public dispatch`, () => {
    let client: AdtClient;
    let supported: true | undefined;
    beforeAll(async () => {
      resetCachedFeatures();
      if (target === 'onprem') client = getTestClient();
      else {
        const key = process.env.TEST_BTP_SERVICE_KEY
          ? parseServiceKey(process.env.TEST_BTP_SERVICE_KEY)
          : loadServiceKeyFile(process.env.TEST_BTP_SERVICE_KEY_FILE || process.env.SAP_BTP_SERVICE_KEY_FILE || '');
        client = new AdtClient({
          baseUrl: key.url,
          client: key.abap?.sapClient || '100',
          language: 'EN',
          bearerTokenProvider: createBearerTokenProvider(key),
        });
      }
      const release = (await client.getInstalledComponents()).find(
        (component) => component.name === 'SAP_BASIS',
      )?.release;
      if (release && Number(release) < 758) return;
      const discovery = parseDiscoveryDocument(
        (
          await client.http.get(
            '/sap/bc/adt/discovery',
            { Accept: 'application/atomsvc+xml' },
            {
              deadline: Date.now() + 15_000,
              responseBudget: new DataResponseBudget(2 * 1024 * 1024),
              retryTransientErrors: false,
            },
          )
        ).body,
      );
      setCachedDiscovery(discovery);
      setCachedFeatures({ abapRelease: release, discoveryMap: discovery });
      supported = true;
    }, 180_000);
    afterAll(() => resetCachedFeatures());
    const read = (extensions: 'none' | 'summary' | 'sources') =>
      handleToolCall(client, { ...DEFAULT_CONFIG, systemType: target }, 'SAPRead', {
        type: 'BDEF',
        name: 'DEMO_RAP_EXTENSIBLE',
        version: 'active',
        force_refresh: true,
        extensions,
      });
    it('preserves the base across repeated summaries with fresh per-call limits', async (ctx) => {
      requireOrSkip(ctx, supported, SkipReason.BACKEND_UNSUPPORTED);
      const base = await read('none');
      for (let observation = 0; observation < 2; observation++)
        assertBdefExtensions(base, await read('summary'), 'summary');
    }, 30_000);
    it('verifies separate authored sources independently of summary completion', async (ctx) => {
      requireOrSkip(ctx, supported, SkipReason.BACKEND_UNSUPPORTED);
      const base = await read('none');
      assertBdefExtensions(base, await read('sources'), 'sources');
    }, 30_000);
  });
}
