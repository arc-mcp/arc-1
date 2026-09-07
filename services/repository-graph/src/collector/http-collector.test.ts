import { createServer, type RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GraphImport } from '../graph/types.js';
import { SourceParseError } from './extractor.js';
import { collectHttpSources, fetchSourceText } from './http-collector.js';

const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

async function mock(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('source transport', () => {
  it('includes explicit metadata-only nodes without fetching fake empty source', async () => {
    const requests: string[] = [];
    const base = await mock((request, response) => {
      requests.push(request.url!);
      response.end('REPORT ztest. DATA x TYPE string.');
    });
    const store = {
      importGraph: vi.fn(async (_graph: GraphImport, _replace?: boolean) => ({ nodes: 0, observations: 0 })),
    };
    const result = await collectHttpSources(store, base, {
      extractorVersion: 'test',
      scope: 'test',
      systemKey: 'MOCK',
      objects: [
        { name: 'ZTEST', type: 'PROG', sourceFile: 'ztest.prog.abap' },
        { name: 'ZTAB', type: 'TABL' },
      ],
    });
    expect(requests).toEqual(['/source/0']);
    expect(result.nodes).toBe(2);
    expect(store.importGraph.mock.calls[0]![0].evidenceScopes).toHaveLength(1);
  });

  it('does not silently downgrade a failed empty source into metadata-only success', async () => {
    const base = await mock((_request, response) => response.end(''));
    const store = {
      importGraph: vi.fn(async (_graph: GraphImport, _replace?: boolean) => ({ nodes: 0, observations: 0 })),
    };
    await expect(
      collectHttpSources(store, base, {
        extractorVersion: 'test',
        scope: 'test',
        systemKey: 'MOCK',
        objects: [{ name: 'ZTEST', type: 'PROG', sourceFile: 'empty.abap' }],
      }),
    ).rejects.toThrow(SourceParseError);
    expect(store.importGraph).not.toHaveBeenCalled();
  });
  it('reads a bounded same-origin response', async () => {
    const base = await mock((_request, response) => response.end('CLASS zcl_a DEFINITION. ENDCLASS.'));
    await expect(fetchSourceText(base, '/source')).resolves.toMatchObject({ bytes: 33 });
  });

  it('refuses redirects before forwarding credentials in a future SAP client', async () => {
    const base = await mock((_request, response) => {
      response.statusCode = 302;
      response.setHeader('location', 'https://example.invalid/source');
      response.end();
    });
    await expect(fetchSourceText(base, '/source')).rejects.toThrow('redirects are refused');
  });

  it('stops oversized streaming responses', async () => {
    const base = await mock((_request, response) => response.end('x'.repeat(101)));
    await expect(fetchSourceText(base, '/source', 100)).rejects.toThrow('byte limit');
  });
});
