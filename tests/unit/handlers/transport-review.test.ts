import { beforeEach, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { getTransport } from '../../../src/adt/transport.js';
import type { TransportRequest } from '../../../src/adt/types.js';
import { handleTransportReview } from '../../../src/handlers/transport-review.js';
import { requestContext } from '../../../src/server/context.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

vi.mock('../../../src/adt/transport.js', () => ({ getTransport: vi.fn() }));
const id = 'A4HK900001';
const transport = (names: string[]) =>
  ({
    id,
    status: 'R',
    type: 'K',
    description: 'Review',
    owner: 'TEST',
    tasks: [
      {
        id,
        objects: names.map((name) => ({
          pgmid: 'R3TR',
          type: 'PROG',
          name,
          wbtype: 'PROG/P',
          description: '',
          locked: false,
          position: '1',
        })),
      },
    ],
  }) as TransportRequest;
const client = {
  username: 'TEST',
  sapClient: '001',
  getRevisions: vi.fn(async () => ({
    revisions: [
      { id: '00002', transport: id, timestamp: '2026-10-17T10:00:00Z', uri: '/2', author: 'TEST' },
      { id: '00001', transport: 'OTHER', timestamp: '2026-10-16T10:00:00Z', uri: '/1', author: 'TEST' },
    ],
  })),
  getRevisionSource: vi.fn(async (uri: string) => uri),
} as unknown as AdtClient;
const config = { ...DEFAULT_CONFIG, url: 'https://sap.test' };
const run = (user: string, args: Record<string, unknown>) =>
  requestContext.run({ requestId: 'test', user }, () => handleTransportReview(client, { id, ...args }, config));
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getTransport).mockResolvedValue(transport(['A', 'B']));
});
it('pages sorted inventory without local state or report metadata', async () => {
  vi.mocked(getTransport).mockResolvedValue(transport(['B', 'A']));
  const first = JSON.parse((await run('alice', { limit: 1 })).content[0]!.text);
  const second = JSON.parse((await run('alice', { offset: first.nextOffset })).content[0]!.text);
  expect(first).toMatchObject({ offset: 0, shown: 1, nextOffset: 1, objects: [{ name: 'A' }] });
  expect(second).toMatchObject({ offset: 1, shown: 1, objects: [{ name: 'B' }] });
  expect(second).not.toHaveProperty('nextOffset');
  for (const field of ['continuation', 'target', 'sourceHashes', 'status', 'resultFormat'])
    expect(first).not.toHaveProperty(field);
  expect(first.objects[0].parts[0].diff).toContain('+/2');
});
it.each(['D', 'L', 'R', 'N'])('derives source state from native status %s', async (status) => {
  vi.mocked(getTransport).mockResolvedValue({ ...transport(['A']), status });
  vi.mocked(client.getRevisions).mockResolvedValueOnce({
    object: { type: 'PROG', name: 'A' },
    revisions: [
      { id: '99999', transport: id, timestamp: '2026-10-18', uri: '/draft', author: 'T' },
      { id: '00000', transport: id, timestamp: '2026-10-17', uri: '/active', author: 'T' },
      { id: '00002', transport: id, timestamp: '2026-10-16', uri: '/released', author: 'T' },
      { id: '00001', transport: 'OTHER', timestamp: '2026-10-15', uri: '/prior', author: 'T' },
    ],
  });
  const page = JSON.parse((await run('alice', {})).content[0]!.text);
  expect(page.objects[0].parts[0].to).toContain(['D', 'L'].includes(status) ? '00000' : '00002');
  expect(client.getRevisionSource).not.toHaveBeenCalledWith('/draft', expect.anything());
});
it.each(['O', 'P', '?', ''])('does not guess a comparison during transitional/unknown status %s', async (status) => {
  vi.mocked(getTransport).mockResolvedValue({ ...transport(['A']), status });
  expect((await run('alice', {})).isError).toBe(true);
  expect(client.getRevisions).not.toHaveBeenCalled();
});
it('bounds a page of whole classes and retries the unfinished later object', async () => {
  const inventory = transport(Array.from({ length: 40 }, (_, i) => `ZCL_${i}`));
  for (const object of inventory.tasks[0]!.objects) {
    object.type = 'CLAS';
    object.wbtype = 'CLAS/OC';
  }
  vi.mocked(getTransport).mockResolvedValue(inventory);
  const page = JSON.parse((await run('alice', { limit: 40 })).content[0]!.text);
  expect(page.stoppedBy).toBe('collection limit');
  expect(page.shown).toBe(11);
  expect(page.nextOffset).toBe(page.shown);
  expect(JSON.stringify(page.objects)).not.toContain('budget exhausted');
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(64 * 1024);
});
it('rejects an offset outside the inventory', async () => {
  expect((await run('alice', { offset: 2 })).isError).toBe(true);
});
it('summary omits hunks but preserves counts and baseline evidence', async () => {
  const full = JSON.parse((await run('alice', {})).content[0]!.text);
  const summary = JSON.parse((await run('alice', { summary: true })).content[0]!.text);
  expect(summary.objects[0].parts[0]).toEqual({ ...full.objects[0].parts[0], diff: '', hunksOmitted: true });
});
it('fails a cancelled review without reading more SAP objects', async () => {
  const abort = new AbortController();
  vi.mocked(client.getRevisionSource).mockImplementationOnce(async () => {
    abort.abort();
    return 'source';
  });
  await expect(
    requestContext.run({ requestId: 'cancel', signal: abort.signal }, () =>
      handleTransportReview(client, { id }, config),
    ),
  ).rejects.toThrow();
});
it('caps a large first class and pages later objects without losing their hunks', async () => {
  const inventory = transport(['ZA', 'ZB']);
  for (const object of inventory.tasks[0]!.objects) {
    object.type = 'CLAS';
    object.wbtype = 'CLAS/OC';
  }
  vi.mocked(getTransport).mockResolvedValue(inventory);
  const source = vi
    .mocked(client.getRevisionSource)
    .mockImplementation(async (uri) => (uri === '/2' ? 'é'.repeat(12000) : 'old'));
  try {
    const response = (await run('alice', {})).content[0]!.text;
    const first = JSON.parse(response);
    expect(Buffer.byteLength(response)).toBeLessThanOrEqual(64 * 1024);
    expect(first).toMatchObject({ shown: 1, nextOffset: 1, stoppedBy: 'output limit' });
    expect(first.objects[0].parts).toHaveLength(5);
    expect(first.objects[0].parts.some((p: { hunksOmitted?: boolean }) => p.hunksOmitted)).toBe(true);
    expect(
      first.objects[0].parts.every((p: { added: number; removed: number }) => p.added === 1 && p.removed === 1),
    ).toBe(true);
    const second = JSON.parse((await run('alice', { offset: first.nextOffset })).content[0]!.text);
    expect(second.objects[0].name).toBe('ZB');
    expect(second).not.toHaveProperty('nextOffset');
  } finally {
    source.mockImplementation(async (uri) => uri);
  }
});
it('keeps translation entries as inventory without reading object source', async () => {
  const inventory = transport(['ZTEXT']);
  inventory.tasks[0]!.objects[0]!.pgmid = 'LANG';
  vi.mocked(getTransport).mockResolvedValue(inventory);
  const page = JSON.parse((await run('alice', {})).content[0]!.text);
  expect(page.objects[0]).toMatchObject({ parts: [], inventoryReason: expect.stringContaining('LANG entry') });
  expect(client.getRevisions).not.toHaveBeenCalled();
});
it('keeps the refusal bounded when SAP returns oversized object metadata', async () => {
  vi.mocked(getTransport).mockResolvedValue(transport(['Z'.repeat(70000)]));
  const result = await run('alice', {});
  expect(result.isError).toBe(true);
  expect(Buffer.byteLength(result.content[0]!.text)).toBeLessThanOrEqual(64 * 1024);
});
