import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import type { GraphStore } from '../graph/store/store.js';
import type { GraphImport, GraphNodeInput } from '../graph/types.js';
import { extractGraphObject } from './extractor.js';

interface MockFixture {
  extractorVersion: string;
  objects: Array<Omit<GraphNodeInput, 'systemKey'> & { sourceFile?: string }>;
  scope: string;
  systemKey: string;
}

export async function fetchSourceText(
  baseUrl: string,
  path: string,
  maxBytes = 1_000_000,
): Promise<{ body: string; bytes: number }> {
  const base = new URL(baseUrl);
  const url = new URL(path, base);
  if (url.origin !== base.origin) throw new Error('Source path crosses the configured origin');
  const response = await fetch(url, {
    headers: { accept: 'text/plain' },
    redirect: 'manual',
    signal: AbortSignal.timeout(5_000),
  });
  if (response.status >= 300 && response.status < 400) throw new Error('Source redirects are refused');
  if (!response.ok) throw new Error(`Source request failed with HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new Error('Source response exceeds byte limit');
  const reader = response.body?.getReader();
  if (!reader) return { body: '', bytes: 0 };
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    bytes += result.value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error('Source response exceeds byte limit');
    }
    chunks.push(result.value);
  }
  return { body: Buffer.concat(chunks).toString('utf8'), bytes };
}

export async function collectHttpSources(
  store: Pick<GraphStore, 'importGraph'>,
  baseUrl: string,
  fixture: MockFixture,
): Promise<{ downloadedBytes: number; nodes: number; observations: number }> {
  const catalog: GraphNodeInput[] = fixture.objects.map(({ sourceFile: _sourceFile, ...object }) => ({
    ...object,
    systemKey: fixture.systemKey,
  }));
  const extracted = [];
  let downloadedBytes = 0;
  for (let index = 0; index < fixture.objects.length; index += 1) {
    const input = fixture.objects[index];
    if (!input || input.sourceFile === undefined) continue;
    const response = await fetchSourceText(baseUrl, `/source/${index}`);
    downloadedBytes += response.bytes;
    extracted.push(extractGraphObject({ ...input, source: response.body, systemKey: fixture.systemKey }, catalog));
  }
  const graph: GraphImport = {
    evidenceScopes: extracted.map((item) => item.evidenceScope),
    extractorVersion: fixture.extractorVersion,
    nodes: catalog,
    observations: extracted.flatMap((item) => item.observations),
    scope: fixture.scope,
    systemKey: fixture.systemKey,
  };
  await store.importGraph(graph, true);
  return { downloadedBytes, nodes: graph.nodes.length, observations: graph.observations.length };
}

export async function collectMockFixture(
  store: GraphStore,
  fixtureFile = join(process.cwd(), 'tests/graph/fixtures/extraction/manifest.json'),
): Promise<{ downloadedBytes: number; nodes: number; observations: number }> {
  const fixture = JSON.parse(await readFile(fixtureFile, 'utf8')) as MockFixture;
  const fixtureDirectory = dirname(fixtureFile);
  const bodies = await Promise.all(
    fixture.objects.map((object) =>
      object.sourceFile === undefined ? undefined : readFile(join(fixtureDirectory, object.sourceFile), 'utf8'),
    ),
  );
  const server = createServer((request, response) => {
    const match = request.url?.match(/^\/source\/(\d+)$/);
    const index = Number(match?.[1] ?? -1);
    const body = bodies[index];
    if (body === undefined) {
      response.statusCode = 404;
      response.end();
      return;
    }
    response.setHeader('content-type', 'text/plain');
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  try {
    return await collectHttpSources(store, `http://127.0.0.1:${address.port}`, fixture);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}
