import { describe, expect, it } from 'vitest';
import { generateRequestId, getCurrentContext, requestContext } from '../../../src/server/context.js';

describe('Request Context', () => {
  it('generates monotonically increasing request IDs', () => {
    const id1 = generateRequestId();
    const id2 = generateRequestId();
    expect(id1).toMatch(/^REQ-\d+$/);
    expect(id2).toMatch(/^REQ-\d+$/);
    // IDs should be different
    expect(id1).not.toBe(id2);
  });

  it('returns undefined when no context is active', () => {
    expect(getCurrentContext()).toBeUndefined();
  });

  it('provides context within run()', async () => {
    const ctx = { requestId: 'REQ-TEST', user: 'admin', tool: 'SAPRead' };
    let captured: ReturnType<typeof getCurrentContext>;

    await requestContext.run(ctx, async () => {
      captured = getCurrentContext();
    });

    expect(captured!).toBe(ctx);
    expect(captured!.requestId).toBe('REQ-TEST');
    expect(captured!.user).toBe('admin');
  });

  it('isolates context between concurrent runs', async () => {
    const results: string[] = [];

    await Promise.all([
      requestContext.run({ requestId: 'A', tool: 'SAPRead' }, async () => {
        // Simulate async work
        await new Promise((r) => setTimeout(r, 5));
        results.push(getCurrentContext()!.requestId);
      }),
      requestContext.run({ requestId: 'B', tool: 'SAPSearch' }, async () => {
        await new Promise((r) => setTimeout(r, 2));
        results.push(getCurrentContext()!.requestId);
      }),
    ]);

    expect(results).toContain('A');
    expect(results).toContain('B');
  });

  it('carries trace context and the calling agent', async () => {
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    let captured: ReturnType<typeof getCurrentContext>;

    await requestContext.run(
      { requestId: 'REQ-T', traceparent, tracestate: 'rojo=1', clientAgent: 'cursor/0.44' },
      () => {
        captured = getCurrentContext();
      },
    );

    expect(captured!.traceparent).toBe(traceparent);
    expect(captured!.tracestate).toBe('rojo=1');
    expect(captured!.clientAgent).toBe('cursor/0.44');
  });

  it('lets an inner run inherit trace context from the HTTP-edge context', async () => {
    // Mirrors production: serveMcpRequest opens the outer context, handleToolCall the inner one.
    const traceparent = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    let inner: ReturnType<typeof getCurrentContext>;

    await requestContext.run({ requestId: 'REQ-OUTER', traceparent, clientAgent: 'agent/1' }, async () => {
      const outer = getCurrentContext();
      await requestContext.run(
        { requestId: 'REQ-INNER', tool: 'SAPRead', traceparent: outer?.traceparent, clientAgent: outer?.clientAgent },
        () => {
          inner = getCurrentContext();
        },
      );
    });

    expect(inner!.requestId).toBe('REQ-INNER');
    expect(inner!.traceparent).toBe(traceparent);
    expect(inner!.clientAgent).toBe('agent/1');
  });

  it('context is not available after run() completes', async () => {
    await requestContext.run({ requestId: 'DONE' }, async () => {
      expect(getCurrentContext()!.requestId).toBe('DONE');
    });
    expect(getCurrentContext()).toBeUndefined();
  });
});
