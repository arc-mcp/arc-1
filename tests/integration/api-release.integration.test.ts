/** Live API release visibility: release/repeat/readback, then revoke before deleting the owner. */
import { describe, expect, it } from 'vitest';
import { fetchDiscoveryDocument } from '../../src/adt/discovery.js';
import { AdtApiError } from '../../src/adt/errors.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { generateUniqueName } from './crud-harness.js';
import { getTestClient } from './helpers.js';

describe('SAPManage set_api_state (API release write)', () => {
  it('releases and repeats explicit C1 visibility, reads it back, then revokes', async (ctx) => {
    const client = getTestClient();
    const discovery = await fetchDiscoveryDocument(client.http);
    expect(discovery.map.size, 'ADT discovery must succeed before checking API-release support').toBeGreaterThan(0);
    client.http.setDiscoveryMap(discovery.map);
    requireOrSkip(
      ctx,
      discovery.map.has('/sap/bc/adt/apireleases') || undefined,
      `${SkipReason.BACKEND_UNSUPPORTED}: API release collection absent`,
    );
    const config = { ...DEFAULT_CONFIG, allowWrites: true };
    const name = generateUniqueName('ZCL_ARC1_ARS');
    const objectUri = `/sap/bc/adt/oo/classes/${name.toLowerCase()}`;
    const call = async (tool: string, args: Record<string, unknown>) => {
      const result = await handleToolCall(client, config, tool, args);
      expect(result.isError, JSON.stringify(result)).toBeUndefined();
      return result;
    };
    let created = false;
    let releaseAttempted = false;
    try {
      await call('SAPWrite', {
        action: 'create',
        type: 'CLAS',
        name,
        package: '$TMP',
        description: 'ARC-1 IT api-release',
        source: `CLASS ${name.toLowerCase()} DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\nENDCLASS.\nCLASS ${name.toLowerCase()} IMPLEMENTATION.\nENDCLASS.`,
      });
      created = true;
      await call('SAPActivate', { type: 'CLAS', name });
      for (let attempt = 0; attempt < 2; attempt++) {
        releaseAttempted = true;
        await call('SAPManage', {
          action: 'set_api_state',
          name,
          objectType: 'CLAS',
          apiState: 'RELEASED',
          apiVisibility: ['cloudDevelopment'],
        });
        const read = await call('SAPRead', { type: 'API_STATE', name, objectType: 'CLAS' });
        const info = JSON.parse(read.content[0]!.text);
        expect(info.contracts).toContainEqual(
          expect.objectContaining({
            contract: 'C1',
            state: 'RELEASED',
            useInSAPCloudPlatform: true,
            useInKeyUserApps: false,
          }),
        );
      }
    } finally {
      // A failed follow-up source PUT may still have created the class shell.
      if (!created) {
        try {
          await client.http.get(objectUri);
          created = true;
        } catch (error) {
          expect(error).toBeInstanceOf(AdtApiError);
          expect(error).toMatchObject({ statusCode: 404 });
        }
      }
      // An accepted PUT may have released the object even when its verification failed. Do not
      // delete a released owner: catalog residue cannot be ruled out by the owner's later 404.
      if (releaseAttempted) {
        const info = await client.getApiReleaseState(objectUri);
        for (const contract of info.contracts.filter((entry) => entry.state === 'RELEASED')) {
          await call('SAPManage', {
            action: 'set_api_state',
            name,
            objectType: 'CLAS',
            apiState: 'NOT_RELEASED',
            contract: contract.contract,
          });
        }
        expect((await client.getApiReleaseState(objectUri)).contracts.some((entry) => entry.state === 'RELEASED')).toBe(
          false,
        );
      }
      if (created) {
        await call('SAPWrite', { action: 'delete', type: 'CLAS', name });
        await expect(client.http.get(objectUri)).rejects.toMatchObject({ statusCode: 404 });
      }
    }
  }, 90_000);
});
