import { type GraphConnection, GraphError } from './connection.js';
import { type GraphInput, type GraphResponse, graphResponseSchema } from './contract.js';

export class GraphClient {
  private active = 0;
  constructor(
    private readonly connection: GraphConnection,
    private readonly fetcher = fetch,
    private readonly timeoutMs = 5000,
  ) {}

  async query(input: GraphInput, signal?: AbortSignal): Promise<GraphResponse> {
    if (this.active >= 8) throw new GraphError('busy');
    if (signal?.aborted) throw new GraphError('cancelled');
    this.active++;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      input.action === 'status' ? Math.min(this.timeoutMs, 2000) : this.timeoutMs,
    );
    const cancel = () => controller.abort();
    signal?.addEventListener('abort', cancel, { once: true });
    let response: Response | undefined;
    try {
      response = await this.fetcher(`${this.connection.url}/v2/query`, {
        method: 'POST',
        redirect: 'error',
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${this.connection.readKey()}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ ...input, systemKey: this.connection.systemKey, audience: this.connection.audience }),
      });
      if (response.status === 401 || response.status === 403) throw new GraphError('unauthorized');
      if (response.status === 404 || response.status === 426) throw new GraphError('incompatible');
      if (!response.ok) throw new GraphError('unavailable');
      if (
        response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json' ||
        !response.body
      )
        throw new GraphError('incompatible');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 512_000) throw new GraphError('incompatible');
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      const parsed = graphResponseSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (!parsed.success) throw new GraphError('incompatible');
      const result = parsed.data;
      if (
        result.systemKey !== this.connection.systemKey ||
        result.audience !== this.connection.audience ||
        result.action !== input.action ||
        result.nodes.length > (input.action === 'search' ? input.limit : input.maxNodes) ||
        result.edges.length > input.maxEdges ||
        result.couplings.length > input.limit ||
        result.scope.depth !== input.depth ||
        result.scope.direction !== (input.action === 'impact' ? 'incoming' : input.direction)
      )
        throw new GraphError('incompatible');
      const traversal = ['neighbors', 'impact', 'path'].includes(input.action);
      const matches = (name: string | undefined, type: string | undefined) =>
        result.nodes.some(
          (node) =>
            node.name.toUpperCase() === name?.toUpperCase() &&
            (type?.includes('/') ? node.adtType : node.type).toUpperCase() === type?.toUpperCase(),
        );
      if (
        (!traversal &&
          (result.startStatus !== 'not_requested' ||
            result.targetStatus !== 'not_requested' ||
            result.edges.length > 0)) ||
        (traversal && result.startStatus === 'not_requested') ||
        (input.action !== 'path' && (result.targetStatus !== 'not_requested' || result.pathFound !== null)) ||
        (input.action === 'path' &&
          (result.targetStatus === 'not_requested' ||
            result.pathFound === null ||
            (!result.pathFound && (result.nodes.length > 0 || result.edges.length > 0)))) ||
        (traversal && result.startStatus !== 'found' && (result.nodes.length > 0 || result.edges.length > 0)) ||
        (traversal &&
          result.startStatus === 'found' &&
          (input.action !== 'path' || result.pathFound) &&
          !matches(input.name, input.type)) ||
        (result.pathFound &&
          (result.startStatus !== 'found' ||
            result.targetStatus !== 'found' ||
            !matches(input.targetName, input.targetType))) ||
        (input.action !== 'package_coupling' && result.couplings.length > 0) ||
        (['status', 'package_coupling'].includes(input.action) && result.nodes.length > 0) ||
        (result.coverage.status === 'complete' &&
          (result.coverage.sourceCounts.failed > 0 || result.coverage.sourceCounts.partial > 0)) ||
        (result.coverage.generation === null && (result.coverage.asOf !== null || result.coverage.status !== 'unknown'))
      )
        throw new GraphError('incompatible');
      return result;
    } catch (error) {
      if (signal?.aborted) throw new GraphError('cancelled');
      if (error instanceof GraphError) throw error;
      throw new GraphError(
        controller.signal.aborted ? 'unavailable' : error instanceof SyntaxError ? 'incompatible' : 'unavailable',
      );
    } finally {
      controller.abort();
      await response?.body?.cancel().catch(() => undefined);
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      this.active--;
    }
  }
}
