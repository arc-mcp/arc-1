import { describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtResponseLimitError } from '../../../src/adt/errors.js';
import {
  ExtensionDiscoverySession,
  extensionKey,
  renderExtensionDiscovery,
} from '../../../src/adt/extension-discovery.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';

const request = { root: { type: 'TABL', name: 'ZBASE', version: 'active' }, scope: 'object ZBASE' };
const provider = () => ({
  id: 'ddic',
  family: 'ddic_append',
  status: 'returned' as const,
  coverage: 'direct_identities' as const,
});
const session = (mode: 'summary' | 'sources' = 'summary') =>
  new ExtensionDiscoverySession(mode, request, defaultSafetyConfig());

describe('extension discovery contract', () => {
  it('shares actual-send/response/deadline options and disables transient retries', async () => {
    const s = session();
    await s.read('TABL', async (options) => {
      expect(options).toMatchObject({
        retryTransientErrors: false,
        attemptBudget: { limit: 6 },
        responseBudget: { limitBytes: 131072 },
      });
      options.attemptBudget!.consume();
      const reservation = options.responseBudget!.createReservation();
      reservation.add(10);
      reservation.commit();
    });
    await s.read('TABL', async (options) => {
      expect(options).toBe(s.options);
    });
    expect(s.finish().consumed).toMatchObject({ sends: 1, responseBytes: 10 });
    expect(s.options.deadline! - Date.now()).toBeLessThanOrEqual(2000);
    expect(session('sources').limits).toMatchObject({ sends: 20, timeMs: 12000, nodes: 20, depth: 5 });
  });

  it.each([401, 403, 429])('stops all providers after terminal HTTP %s without leaking bodies', async (code) => {
    const s = session(),
      next = vi.fn();
    await s.provider(provider(), () =>
      s.read('TABL', async () => {
        throw new AdtApiError('secret', code, '/x');
      }),
    );
    await s.provider(provider(), () => s.read('ENHO', next));
    expect(next).not.toHaveBeenCalled();
    expect(s.result.providers[0]?.status).toBe(code === 429 ? 'incomplete' : 'denied');
    expect(JSON.stringify(s.finish())).not.toContain('secret');
  });

  it.each(['ENHO', 'INCL', 'TABL'])('honors hidden SAPRead.%s denial before invoking callback', async (type) => {
    const s = new ExtensionDiscoverySession('sources', request, {
      ...defaultSafetyConfig(),
      denyActions: [`SAPRead.${type}`],
    });
    const send = vi.fn();
    await s.provider(provider(), () => s.read(type, send));
    expect(send).not.toHaveBeenCalled();
    expect(s.result.providers[0]?.status).toBe('denied');
  });

  it('keeps caller cancellation fatal, but records deadline and byte exhaustion', async () => {
    const abort = new AbortController();
    abort.abort();
    const s = new ExtensionDiscoverySession('summary', request, defaultSafetyConfig(), { signal: abort.signal });
    await expect(s.provider(provider(), () => s.read('TABL', vi.fn()))).rejects.toThrow();
    const expired = new ExtensionDiscoverySession('summary', request, defaultSafetyConfig(), {
      deadline: Date.now() - 1,
    });
    await expired.provider(provider(), () => expired.read('TABL', vi.fn()));
    expect(expired.result.omissions.deadline).toBe(1);
    const bytes = session();
    await bytes.provider(provider(), () =>
      bytes.read('TABL', async () => {
        throw new AdtResponseLimitError(128, 129, 'test');
      }),
    );
    expect(bytes.stopped).toBe(true);
    expect(bytes.result.omissions.wire_bytes).toBe(1);
  });

  it('deduplicates fetch identities while retaining repeated attachment edges and node/depth omissions', () => {
    const s = session('sources');
    for (let i = 0; i < 22; i++) s.addNode({ ...request.root, name: `Z${i}`, provider: 'ddic', family: 'ddic_append' });
    s.addNode({ ...request.root, name: 'ZDEEP', provider: 'ddic', family: 'ddic_append' }, 6);
    const node = s.result.nodes[0]!;
    expect(s.addNode({ ...node, name: node.name.toLowerCase() })).toBe(true);
    s.result.edges.push(
      ...['a', 'b'].map((attribute) => ({
        from: extensionKey(request.root),
        to: extensionKey(node),
        kind: 'include',
        attribute,
      })),
    );
    expect(s.result.nodes).toHaveLength(20);
    expect(s.result.edges).toHaveLength(2);
    expect(s.result.omissions).toMatchObject({ nodes: 2, depth: 1 });
  });

  it('caps summary identities and UTF-8 output without changing the result', () => {
    const s = session();
    s.result.providers.push(provider());
    for (let i = 0; i < 20; i++)
      s.addNode({ ...request.root, name: `Z${i}${'A'.repeat(180)}`, provider: 'ddic', family: 'ddic_append' });
    const blocks = renderExtensionDiscovery(s.finish());
    expect(Buffer.byteLength(blocks[0]!.text)).toBeLessThanOrEqual(2048);
    expect(blocks[0]!.text).toContain('omissions');
    expect(s.result.nodes).toHaveLength(8);
  });

  it('labels and truncates source bodies within the aggregate cap', () => {
    const s = session('sources');
    s.result.sources.push({
      identity: request.root,
      representation: 'authored_source',
      provider: 'ddic',
      source: 'ö'.repeat(20000),
    });
    const blocks = renderExtensionDiscovery(s.finish());
    expect(blocks[1]!.text).toContain('representation=authored_source');
    expect(blocks[1]!.text).toContain('source truncated');
    expect(blocks[1]!.text).not.toContain('\uFFFD');
    expect(blocks.reduce((n, b) => n + Buffer.byteLength(b.text), 0)).toBeLessThanOrEqual(16384);
  });
});
