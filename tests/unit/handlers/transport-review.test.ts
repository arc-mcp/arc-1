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
  requestContext.run({ requestId: 'test', user }, () =>
    handleTransportReview(client, { id, reviewMode: 'released', ...args }, config),
  );
beforeEach(() => {
  vi.mocked(getTransport).mockResolvedValue(transport(['A', 'B']));
});
it('binds review continuation to caller, inventory, request, target and mode', async () => {
  const first = JSON.parse((await run('alice', { limit: 1 })).content[0]!.text);
  expect(first.nextOffset).toBe(1);
  expect((await run('bob', { offset: 1, continuation: first.continuation })).isError).toBe(true);
  expect((await run('alice', { offset: 1, reviewMode: 'active', continuation: first.continuation })).isError).toBe(
    true,
  );
  expect((await run('alice', { offset: 1, continuation: first.continuation })).isError).toBeUndefined();
  expect((await run('alice', { id: 'A4HK900002', offset: 1, continuation: first.continuation })).isError).toBe(true);
  const otherTarget = await requestContext.run({ requestId: 'test', user: 'alice' }, () =>
    handleTransportReview(
      client,
      { id, reviewMode: 'released', offset: 1, continuation: first.continuation },
      { ...config, url: 'https://other.test' },
    ),
  );
  expect(otherTarget.isError).toBe(true);
  vi.mocked(getTransport).mockResolvedValue(transport(['B']));
  expect((await run('alice', { offset: 1, continuation: first.continuation })).isError).toBe(true);
});
it('does not declare offset-only continuation verified', async () => {
  const page = JSON.parse((await run('alice', { offset: 1 })).content[0]!.text);
  expect(page).toMatchObject({ status: 'partial', continuationVerified: false });
});
it('reports an oversized first object instead of returning a non-progressing continuation', async () => {
  const large = transport(['A']);
  large.tasks[0]!.objects = Array.from({ length: 7000 }, () => ({ ...large.tasks[0]!.objects[0]! }));
  vi.mocked(getTransport).mockResolvedValue(large);
  const result = await run('alice', { limit: 1 });
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain('output budget');
});
it('invalidates continuation when a task changes state or an empty task is added', async () => {
  const first = JSON.parse((await run('alice', { limit: 1 })).content[0]!.text);
  const changed = transport(['A', 'B']);
  changed.tasks[0]!.status = 'R';
  vi.mocked(getTransport).mockResolvedValue(changed);
  expect((await run('alice', { offset: 1, continuation: first.continuation })).isError).toBe(true);
  const added = transport(['A', 'B']);
  added.tasks.push({ id: 'A4HK900099', status: 'D', owner: 'TEST', description: '', objects: [] });
  vi.mocked(getTransport).mockResolvedValue(added);
  expect((await run('alice', { offset: 1, continuation: first.continuation })).isError).toBe(true);
});
it('binds the SAP client even when a configured target label stays the same', async () => {
  const selected = { ...config, targetId: 'DEV' };
  const first = JSON.parse((await handleTransportReview(client, { id }, selected)).content[0]!.text);
  const changedClient = { ...client, sapClient: '002' } as AdtClient;
  expect((await handleTransportReview(changedClient, { id, continuation: first.continuation }, selected)).isError).toBe(
    true,
  );
});
it('accepts reordered objects while refusing a forged continuation', async () => {
  const first = JSON.parse((await run('alice', { limit: 1 })).content[0]!.text);
  vi.mocked(getTransport).mockResolvedValue(transport(['B', 'A']));
  expect((await run('alice', { offset: 1, continuation: first.continuation })).isError).toBeUndefined();
  expect((await run('alice', { offset: 1, continuation: '0'.repeat(64) })).isError).toBe(true);
});
it('bounds a page of whole classes and keeps unfinished work visible', async () => {
  const inventory = transport(Array.from({ length: 40 }, (_, i) => `ZCL_${i}`));
  for (const task of inventory.tasks)
    for (const object of task.objects) {
      object.type = 'CLAS';
      object.wbtype = 'CLAS/OC';
    }
  vi.mocked(getTransport).mockResolvedValue(inventory);
  const page = JSON.parse((await run('alice', { limit: 40 })).content[0]!.text);
  expect(page).toMatchObject({ status: 'partial', metrics: { exhausted: true } });
  expect(page.metrics.reads).toBeLessThanOrEqual(180);
  expect(page.shown).toBeLessThan(40);
  expect(page.nextOffset).toBe(page.shown);
  expect(
    page.objects
      .flatMap((o: { parts: Array<{ note?: string }> }) => o.parts)
      .some((p: { note?: string }) => p.note?.includes('budget')),
  ).toBe(false);
  expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(512 * 1024);
});

it('rejects an offset outside the inventory instead of returning an empty complete page', async () => {
  const first = JSON.parse((await run('alice', { limit: 1 })).content[0]!.text);
  const result = await run('alice', { offset: 2, continuation: first.continuation });
  expect(result.isError).toBe(true);
  expect(result.content[0]!.text).toContain('outside this transport inventory');
});

it('keeps normal replies compact while full evidence retains hashes and revision records', async () => {
  const inventory = transport(Array.from({ length: 20 }, (_, i) => `ZCL_${i}`));
  for (const object of inventory.tasks[0]!.objects) {
    object.pgmid = 'LIMU';
    object.type = 'METH';
    object.wbtype = 'CLAS/OM';
    object.name = `${object.name.padEnd(30)}RUN`;
  }
  vi.mocked(getTransport).mockResolvedValue(inventory);
  const compactText = (await run('alice', {})).content[0]!.text;
  const fullText = (await run('alice', { resultFormat: 'structured' })).content[0]!.text;
  const compact = JSON.parse(compactText),
    full = JSON.parse(fullText);
  expect(Buffer.byteLength(compactText)).toBeLessThan(Buffer.byteLength(fullText) * 0.65);
  expect(compact.scopeNotes).toHaveLength(1);
  expect(compact.coverage).toEqual(full.coverage);
  expect(compact.objects[0].components).toEqual(full.objects[0].components);
  expect(compact.objects[0].parts[0].diff).toEqual(full.objects[0].parts[0].diff);
  expect(compact.objects[0].parts[0]).not.toHaveProperty('revisions');
  expect(full.objects[0].parts[0].sourceHashes.after).toMatch(/^[a-f0-9]{64}$/);
});
