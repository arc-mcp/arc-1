// Regressions reproduced by the independent PR review.
import { expect, it, vi } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { getTransport } from '../../src/adt/transport.js';
import {
  baselineStatusFor,
  diffTransportObject,
  rollupTransportObjects,
  selectTransportRevisionPair,
} from '../../src/adt/transport-diff.js';
import type { RevisionInfo, TransportRequest } from '../../src/adt/types.js';
import { handleTransportReview } from '../../src/handlers/transport-review.js';
import { requestContext } from '../../src/server/context.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { collectTransportReview } from '../../src/workflows/transport-review.js';

vi.mock('../../src/adt/transport.js', () => ({ getTransport: vi.fn() }));
const REQ = 'A4HK900001';
const rev = (id: string, transport: string | undefined, timestamp: string): RevisionInfo => ({
  id,
  transport,
  timestamp,
  author: 'D',
  uri: `/sap/bc/adt/demo/versions/1/${id}/content`,
});
const config = { ...DEFAULT_CONFIG, url: 'https://sap.test' };
const inventory = (objects: Array<Record<string, string>>) =>
  ({
    id: REQ,
    status: 'R',
    type: 'K',
    description: '',
    owner: 'T',
    tasks: [
      {
        id: 'A4HK900002',
        status: 'R',
        owner: 'T',
        description: '',
        objects: objects.map((o) => ({ ...o, description: '', locked: false, position: '1' })),
      },
    ],
  }) as unknown as TransportRequest;
const client = () =>
  ({
    username: 'T',
    sapClient: '001',
    getRevisions: vi.fn(async () => ({
      revisions: [rev('00002', REQ, '2026-10-17T10:00:00Z'), rev('00001', 'A4HK800001', '2026-10-16T10:00:00Z')],
    })),
    getRevisionSource: vi.fn(async (uri: string) => (uri.includes('00002') ? 'WRITE 2.\n' : 'WRITE 1.\n')),
  }) as unknown as AdtClient;

it('collector retries the object that hit the page budget', async () => {
  const c = client();
  // 13 whole classes would also show it; use R3TR CLAS like the repro.
  vi.mocked(getTransport).mockResolvedValue(
    inventory(
      Array.from({ length: 13 }, (_, i) => ({
        pgmid: 'R3TR',
        type: 'CLAS',
        name: `ZCL_${String(i).padStart(2, '0')}`,
        wbtype: 'CLAS/OC',
      })),
    ),
  );
  const artifact = await requestContext.run({ requestId: 'f', user: 'alice' }, () =>
    collectTransportReview(async (_t, args) => handleTransportReview(c, args, config), REQ),
  );
  const objects = artifact.pages.flatMap((p) => p.objects);
  expect(objects.flatMap((o) => o.parts).filter((p) => String(p.note).includes('budget'))).toHaveLength(0);
  expect(artifact.pages.map((p) => [p.offset, p.shown])).toEqual([
    [0, 11],
    [11, 2],
  ]);
  // Whole classes now carry the text-pool gap, so collection stays partial for that honest reason only.
  expect(artifact.status).toBe('partial');
  expect(objects).toHaveLength(13);
});
it('REPT-only class keeps the text gap without speculative source parts', async () => {
  const [object] = rollupTransportObjects([
    {
      id: REQ,
      objects: [
        { pgmid: 'LIMU', type: 'REPT', name: `${'ZCL_DEMO'.padEnd(30, '=')}CP`, wbtype: '', description: '' },
      ] as never,
    },
  ]);
  const c = client();
  const result = await diffTransportObject(c, object!, new Set([REQ]), { mode: 'released' });
  expect(result.parts).toEqual([]);
  expect(result.inventoryReason).toContain('Text-pool');
  expect(result.coverageGaps).toBeUndefined();
  expect(vi.mocked(c.getRevisions)).not.toHaveBeenCalled();
});
it('undated in-between snapshot makes the pair ambiguous; consistent dated history stays solid', () => {
  const feed = [
    rev('00005', REQ, '2026-10-17T12:00:00Z'),
    rev('00003', 'X', '2026-10-10T12:00:00Z'),
    rev('00004', 'Y', ''),
  ];
  expect(baselineStatusFor(selectTransportRevisionPair(feed, [REQ], 'released'), feed)).toBe('baseline-ambiguous');
  const dated = [
    rev('00005', REQ, '2026-10-17T12:00:00Z'),
    rev('00004', 'Y', '2026-10-12T12:00:00Z'),
    rev('00003', 'X', '2026-10-10T12:00:00Z'),
  ];
  expect(baselineStatusFor(selectTransportRevisionPair(dated, [REQ], 'released'), dated)).toBe('prior-revision');
  const sameRequest = [
    rev('00005', REQ, '2026-10-17T12:00:00Z'),
    rev('00004', REQ, '2026-10-16T12:00:00Z'),
    rev('00003', 'X', '2026-10-10T12:00:00Z'),
  ];
  expect(baselineStatusFor(selectTransportRevisionPair(sameRequest, [REQ], 'released'), sameRequest)).toBe(
    'prior-revision',
  );
});

it('does not certify an active baseline that skipped a higher undated foreign snapshot', () => {
  const feed = [
    rev('00000', REQ, '2026-10-17T12:00:00Z'),
    rev('00003', 'X', '2026-10-10T12:00:00Z'),
    rev('00004', 'Y', ''),
  ];
  expect(baselineStatusFor(selectTransportRevisionPair(feed, [REQ], 'active'), feed)).toBe('baseline-ambiguous');
});

it('retries an object cut short by the page deadline on a fresh page', async () => {
  vi.mocked(getTransport).mockResolvedValue(
    inventory(['ZA', 'ZB'].map((name) => ({ pgmid: 'LIMU', type: 'REPS', name, wbtype: 'PROG/P' }))),
  );
  const c = client();
  let now = 1000;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.mocked(c.getRevisions).mockImplementation(async () => {
    now += 6000;
    return {
      object: { name: '', type: '' },
      revisions: [rev('00002', REQ, '2026-10-17'), rev('00001', 'OTHER', '2026-10-16')],
    };
  });
  vi.mocked(c.getRevisionSource).mockImplementation(async (uri) => {
    now += 6000;
    return uri;
  });
  try {
    const artifact = await collectTransportReview(async (_tool, args) => handleTransportReview(c, args, config), REQ);
    expect(artifact.status).toBe('complete');
    expect(artifact.pages.map((page) => [page.offset, page.shown])).toEqual([
      [0, 1],
      [1, 1],
    ]);
    expect(
      artifact.pages
        .flatMap((page) => page.objects.flatMap((object) => object.parts))
        .every((part) => part.statisticsComplete),
    ).toBe(true);
  } finally {
    clock.mockRestore();
  }
});
it('continuation survives a module reload (restart / second instance)', async () => {
  const objects = [
    { pgmid: 'R3TR', type: 'PROG', name: 'ZA', wbtype: 'PROG/P' },
    { pgmid: 'R3TR', type: 'PROG', name: 'ZB', wbtype: 'PROG/P' },
  ];
  vi.mocked(getTransport).mockResolvedValue(inventory(objects));
  const first = JSON.parse(
    (
      await requestContext.run({ requestId: 'f', user: 'alice' }, () =>
        handleTransportReview(client(), { id: REQ, reviewMode: 'released', limit: 1 }, config),
      )
    ).content[0]!.text,
  );
  vi.resetModules();
  vi.mocked((await import('../../src/adt/transport.js')).getTransport).mockResolvedValue(inventory(objects));
  const other = await import('../../src/handlers/transport-review.js');
  const ctx = await import('../../src/server/context.js');
  const second = await ctx.requestContext.run({ requestId: 'g', user: 'alice' }, () =>
    other.handleTransportReview(
      client(),
      { id: REQ, reviewMode: 'released', offset: 1, continuation: first.continuation },
      config,
    ),
  );
  expect(second.isError).toBeUndefined();
  const bob = await ctx.requestContext.run({ requestId: 'h', user: 'bob' }, () =>
    other.handleTransportReview(
      client(),
      { id: REQ, reviewMode: 'released', offset: 1, continuation: first.continuation },
      config,
    ),
  );
  expect(bob.isError).toBe(true);
});
it('whole-object program entry is no longer complete', async () => {
  vi.mocked(getTransport).mockResolvedValue(
    inventory([{ pgmid: 'R3TR', type: 'PROG', name: 'ZPROG', wbtype: 'PROG/P' }]),
  );
  const page = JSON.parse(
    (
      await requestContext.run({ requestId: 'e', user: 'alice' }, () =>
        handleTransportReview(client(), { id: REQ, reviewMode: 'released' }, config),
      )
    ).content[0]!.text,
  );
  expect(page.status).toBe('partial');
  expect(page.objects[0].coverageGaps[0]).toMatch(/whole-object/i);
  vi.mocked(getTransport).mockResolvedValue(
    inventory([{ pgmid: 'R3TR', type: 'PROG', name: 'ZINCL', wbtype: 'PROG/I' }]),
  );
  const incl = JSON.parse(
    (
      await requestContext.run({ requestId: 'i', user: 'alice' }, () =>
        handleTransportReview(client(), { id: REQ, reviewMode: 'released' }, config),
      )
    ).content[0]!.text,
  );
  expect(incl.objects[0]).toMatchObject({ type: 'INCL' });
  expect(incl.status).toBe('complete');
});
