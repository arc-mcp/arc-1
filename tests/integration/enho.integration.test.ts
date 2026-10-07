/**
 * Live lifecycle for BAdI enhancement implementations (ENHO/XHB) through the real dispatcher:
 * create → read back → update → activate → delete in $TMP.
 *
 * The BAdI is system-dependent, so it comes from the environment:
 *   TEST_ENHO_SPOT   enhancement spot, e.g. ES_SD_SLS_EXTEND
 *   TEST_ENHO_BADI   BAdI definition in that spot (no filter), e.g. SD_APM_SET_APPROVAL_REASON
 *   TEST_ENHO_CLASS  active class implementing the BAdI interface (it is referenced, not changed)
 * Contract and evidence: docs/research/2026-10-07-enho-xhb-write-contract.md.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { fetchDiscoveryDocument, resolveAcceptType } from '../../src/adt/discovery.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { generateUniqueName } from './crud-harness.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

const spot = process.env.TEST_ENHO_SPOT;
const badi = process.env.TEST_ENHO_BADI;
const implementingClass = process.env.TEST_ENHO_CLASS;

describe('ENHO/XHB write lifecycle — live', () => {
  let client: AdtClient;
  let discovery: Map<string, string[]>;
  const name = generateUniqueName('ZARC1_EH');
  let created = false;

  async function call(tool: string, args: Record<string, unknown>) {
    const result = await handleToolCall(client, DEFAULT_CONFIG, tool, args);
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    return result;
  }

  beforeAll(async () => {
    requireSapCredentials();
    client = getTestClient();
    discovery = (await fetchDiscoveryDocument(client.http)).map;
  });

  afterAll(async () => {
    if (!created) return;
    // best-effort-cleanup: npm run test:cleanup sweeps ZARC1* leftovers.
    await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', { action: 'delete', type: 'ENHO', name }).catch(
      () => undefined,
    );
  });

  it('creates, updates, activates and deletes a BAdI implementation', async (ctx) => {
    requireOrSkip(
      ctx,
      resolveAcceptType(discovery, '/sap/bc/adt/enhancements/enhoxhb'),
      `${SkipReason.BACKEND_UNSUPPORTED}: enhoxhb collection not advertised`,
    );
    requireOrSkip(
      ctx,
      spot && badi && implementingClass,
      `${SkipReason.NO_FIXTURE}: TEST_ENHO_SPOT/BADI/CLASS not set`,
    );
    const implName = `${name}_I`.slice(0, 30);

    await call('SAPWrite', {
      action: 'create',
      type: 'ENHO',
      name,
      package: '$TMP',
      description: 'ARC-1 ENHO write test',
      source: JSON.stringify({
        enhancementSpot: spot,
        badiImplementations: [{ name: implName, badiDefinition: badi, implementingClass, shortText: 'ARC-1 test' }],
      }),
    });
    created = true;

    const read = JSON.parse((await call('SAPRead', { type: 'ENHO', name })).content[0]!.text);
    expect(read).toMatchObject({
      name,
      package: '$TMP',
      technology: 'BADI_IMPL',
      badiImplementations: [
        {
          name: implName,
          shortText: 'ARC-1 test',
          implementingClass,
          badiDefinition: badi,
          enhancementSpot: spot,
          active: true,
          default: false,
        },
      ],
    });

    // Round trip: SAPRead output, one flag changed, written back unchanged otherwise.
    read.badiImplementations[0].active = false;
    await call('SAPWrite', { action: 'update', type: 'ENHO', name, source: JSON.stringify(read) });
    const updated = JSON.parse((await call('SAPRead', { type: 'ENHO', name })).content[0]!.text);
    expect(updated.badiImplementations[0]).toMatchObject({ name: implName, active: false, shortText: 'ARC-1 test' });

    await call('SAPActivate', { type: 'ENHO', name });

    await call('SAPWrite', { action: 'delete', type: 'ENHO', name });
    created = false;
    await expect(client.http.get(`/sap/bc/adt/enhancements/enhoxhb/${name}`)).rejects.toMatchObject({
      statusCode: 404,
    });
  }, 180_000);
});
