import { describe, expect, it, vi } from 'vitest';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { executePinnedFlpMutation } from '../../../src/adt/pinned-flp.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';

const safety = {
  ...defaultSafetyConfig(),
  allowWrites: true,
  multiTargetWrite: {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP'],
    allowedTransports: [],
    serverAllowedTransports: [],
  },
};
const key = 'X-SAP-UI2-CATALOGPAGE:ZCAT';
const catalog = { id: key, domainId: 'ZCAT', type: 'CATALOG_PAGE', scope: 'CUSTOMIZING', isReadOnly: false };
const group = {
  id: 'ZGROUP',
  catalogId: '/UI2/FLPD_CATALOG',
  scope: 'CUSTOMIZING',
  isCatalogPage: false,
  isReadOnly: false,
};
const response = (d: unknown) => ({ statusCode: 200, headers: {}, body: JSON.stringify({ d }) });
const rows = (pageId: string) =>
  Array.from({ length: 499 }, (_, index) => ({ pageId, instanceId: `OLD${index}`, chipId: 'OTHER' }));

describe('truthful FLP write results when readback reaches the list cap', () => {
  it('keeps a tile create unconfirmed after a successful POST changes 499 entries to 500', async () => {
    const created = { pageId: key, instanceId: 'NEW', chipId: 'X-SAP-UI2-CHIP:/UI2/STATIC_APPLAUNCHER', title: 'Tile' };
    const http = {
      get: vi
        .fn()
        .mockResolvedValueOnce(response(catalog))
        .mockResolvedValueOnce(response({ results: rows(key) }))
        .mockResolvedValueOnce(response({ results: [...rows(key), created] })),
      post: vi.fn().mockResolvedValue(response(created)),
    };
    const context = pinnedMutationContext(safety, { deadline: Date.now() + 60_000 }, { unlockFailed: false });
    const result = await executePinnedFlpMutation(http as unknown as AdtHttpClient, safety, context, {
      action: 'flp_create_tile',
      catalogId: 'ZCAT',
      tile: { id: 'NEW', title: 'Tile', semanticObject: 'Sales', semanticAction: 'display' },
    });
    expect(result).toMatchObject({ ok: false, state: 'create-unconfirmed', phase: 'readback' });
    expect(result.message).toContain('listing is incomplete');
    expect(result.message).not.toContain('nothing was changed');
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it('retains accepted membership and manual verification after the 499-to-500 transition', async () => {
    const member = { pageId: 'ZGROUP', instanceId: 'NEW', chipId: `X-SAP-UI2-PAGE:${key}:SOURCE` };
    const http = {
      get: vi
        .fn()
        .mockResolvedValueOnce(response(catalog))
        .mockResolvedValueOnce(response(group))
        .mockResolvedValueOnce(response({ results: [{ pageId: key, instanceId: 'SOURCE', chipId: 'OTHER' }] }))
        .mockResolvedValueOnce(response({ results: rows('ZGROUP') }))
        .mockResolvedValueOnce(response({ results: [...rows('ZGROUP'), member] })),
      post: vi.fn().mockResolvedValue(response(member)),
    };
    const context = pinnedMutationContext(safety, { deadline: Date.now() + 60_000 }, { unlockFailed: false });
    const result = await executePinnedFlpMutation(http as unknown as AdtHttpClient, safety, context, {
      action: 'flp_add_tile_to_group',
      catalogId: 'ZCAT',
      groupId: 'ZGROUP',
      tileInstanceId: 'SOURCE',
    });
    expect(result).toMatchObject({ ok: false, state: 'membership-accepted-unconfirmed', phase: 'readback' });
    expect(result.manualVerification).toContain('Launchpad Designer');
    expect(result.message).toContain('listing is incomplete');
    expect(result.message).not.toContain('nothing was changed');
    expect(http.post).toHaveBeenCalledTimes(1);
  });
});
