import { describe, expect, it } from 'vitest';
import { capResponseBody } from '../../../src/adt/bounded-response.js';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';

describe('all-response accounting for optional extension reads', () => {
  it('keeps the existing success-only accounting default for data-preview callers', async () => {
    const budget = new DataResponseBudget(100);
    await (await capResponseBody(new Response('failure', { status: 500 }), budget)).text();
    expect(budget.consumedBytes).toBe(0);
    await (await capResponseBody(new Response('success'), budget)).text();
    expect(budget.consumedBytes).toBe(7);
  });

  it('charges error bodies cumulatively and rejects the next over-budget chunk', async () => {
    const budget = new DataResponseBudget(10, 'extension-discovery', true);
    await (await capResponseBody(new Response('failure', { status: 404 }), budget)).text();
    expect(budget.consumedBytes).toBe(7);
    await expect((await capResponseBody(new Response('another', { status: 404 }), budget)).text()).rejects.toThrow(
      'limit',
    );
    expect(budget.consumedBytes).toBe(7);
    expect(budget.reservedBytes).toBe(0);
  });

  it('retains consumed prefix accounting when the stream fails', async () => {
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (++reads === 1) controller.enqueue(new TextEncoder().encode('prefix'));
        else controller.error(new Error('synthetic stream failure'));
      },
    });
    const budget = new DataResponseBudget(20, 'extension-discovery', true);
    await expect((await capResponseBody(new Response(stream), budget)).text()).rejects.toThrow('stream failure');
    expect(budget.consumedBytes).toBe(6);
    expect(budget.reservedBytes).toBe(0);
  });
});
