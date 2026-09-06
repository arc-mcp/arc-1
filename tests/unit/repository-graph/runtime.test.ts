import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphClient } from '../../../src/repository-graph/client.js';
import { createRepositoryGraphRuntime, RepositoryGraphRuntime } from '../../../src/repository-graph/runtime.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { jsonResponse, KEY, response } from './helpers.js';

afterEach(() => {
  vi.useRealTimers();
});
describe('graph lifecycle', () => {
  it('has no runtime/network/timers when unconfigured or explicitly disabled', () => {
    vi.useFakeTimers();
    expect(createRepositoryGraphRuntime(DEFAULT_CONFIG)).toBeUndefined();
    expect(
      createRepositoryGraphRuntime({ ...DEFAULT_CONFIG, graphMode: 'off', graphConnectionFile: '/missing' }),
    ).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('coalesces 50 first probes and stops timers', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(response('status')));
    const runtime = new RepositoryGraphRuntime(
      new GraphClient(
        { url: 'https://graph.example', systemKey: 'TEST-001', audience: 'trial', readKey: () => KEY },
        fetcher,
      ),
    );
    try {
      await Promise.all(Array.from({ length: 50 }, () => runtime.probe()));
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(runtime.listed).toBe(true);
    } finally {
      runtime.stop();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
  it('hides initially, retries automatically, remains listed in an outage, revokes and recovers', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(KEY));
    const runtime = new RepositoryGraphRuntime(
      new GraphClient(
        { url: 'https://graph.example', systemKey: 'TEST-001', audience: 'trial', readKey: () => KEY },
        fetcher,
      ),
    );
    const changed = vi.fn();
    runtime.subscribe(changed);
    try {
      await runtime.probe();
      expect(runtime.listed).toBe(false);
      fetcher.mockImplementation(async () => jsonResponse(response('status')));
      await vi.advanceTimersByTimeAsync(2100);
      expect(runtime.listed).toBe(true);
      expect(changed).toHaveBeenCalledTimes(1);
      fetcher.mockRejectedValue(new Error(KEY));
      await runtime.probe();
      expect(runtime.listed).toBe(true);
      const failed = await runtime.call({ action: 'search', query: 'Z' });
      expect(failed.isError).toBe(true);
      expect(JSON.stringify(failed)).not.toContain(KEY);
      fetcher.mockImplementation(async () => jsonResponse({}, 401));
      await runtime.probe();
      expect(runtime.listed).toBe(false);
      fetcher.mockImplementation(async () => jsonResponse(response('status')));
      await runtime.probe();
      expect(runtime.listed).toBe(true);
    } finally {
      runtime.stop();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps malformed configuration local to graph diagnostics', async () => {
    const runtime = createRepositoryGraphRuntime({ ...DEFAULT_CONFIG, graphConnectionFile: '/missing' });
    expect(runtime?.listed).toBe(false);
    expect((await runtime?.call({ action: 'status' }))?.content[0]?.text).toContain('invalid_connection');
    runtime?.stop();
  });
  it('cancels one status waiter without cancelling the shared probe', async () => {
    let resolve!: (value: Response) => void;
    const deferred = new Promise<Response>((done) => {
      resolve = done;
    });
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(deferred);
    const runtime = new RepositoryGraphRuntime(
      new GraphClient(
        { url: 'https://graph.example', systemKey: 'TEST-001', audience: 'trial', readKey: () => KEY },
        fetcher,
      ),
    );
    const abort = new AbortController();
    try {
      const cancelled = runtime.call({ action: 'status' }, abort.signal);
      const other = runtime.call({ action: 'status' });
      abort.abort();
      expect(JSON.stringify(await cancelled)).toContain('cancelled');
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false);
      resolve(jsonResponse(response('status')));
      expect((await other).isError).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(runtime.listed).toBe(true);
      expect(JSON.stringify(await runtime.call({ action: 'status' }, abort.signal))).toContain('cancelled');
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      runtime.stop();
    }
  });
});
