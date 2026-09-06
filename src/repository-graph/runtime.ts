import type { ToolResult } from '../handlers/shared.js';
import { errorResult, textResult } from '../handlers/shared.js';
import type { ServerConfig } from '../server/types.js';
import { GraphClient } from './client.js';
import { GraphError, graphConfigured, resolveGraphConnection } from './connection.js';
import { type GraphInput, type GraphResponse, graphInputSchema } from './contract.js';

export class RepositoryGraphRuntime {
  private state = 'unavailable';
  private everReady = false;
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private flight?: Promise<void>;
  private readonly listeners = new Set<() => void>();
  private readonly abort = new AbortController();
  private failureCount = 0;
  private coverage?: GraphResponse['coverage'];
  constructor(
    private readonly client?: GraphClient,
    private readonly systemKey?: string,
    invalidState?: string,
  ) {
    if (invalidState) this.state = invalidState;
  }
  get listed(): boolean {
    return (
      !this.stopped && this.everReady && !['unauthorized', 'incompatible', 'invalid_connection'].includes(this.state)
    );
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private setState(state: string): void {
    const wasListed = this.listed;
    this.state = state;
    if (state === 'ready') this.everReady = true;
    if (wasListed !== this.listed) for (const listener of this.listeners) listener();
  }
  start(): void {
    if (this.client && !this.stopped && !this.timer && !this.flight) void this.probe();
  }
  probe(): Promise<void> {
    if (this.flight) return this.flight;
    if (!this.client || this.stopped) return Promise.resolve();
    if (this.timer) clearTimeout(this.timer);
    this.flight = (async () => {
      try {
        const result = await this.client?.query(graphInputSchema.parse({ action: 'status' }), this.abort.signal);
        if (!this.stopped) {
          this.coverage = result?.coverage;
          this.setState(result?.coverage.generation ? 'ready' : 'not_indexed');
        }
        this.failureCount = 0;
      } catch (error) {
        this.coverage = undefined;
        if (!this.stopped) this.setState(error instanceof GraphError ? error.code : 'unavailable');
        this.failureCount++;
      } finally {
        this.flight = undefined;
        if (!this.stopped) {
          const delay = this.state === 'ready' ? 30000 : Math.min(60000, 1000 * 2 ** Math.min(this.failureCount, 6));
          this.timer = setTimeout(() => void this.probe(), delay);
          this.timer.unref();
        }
      }
    })();
    return this.flight;
  }
  async call(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    if (signal?.aborted) return errorResult('Repository graph: cancelled');
    const parsed = graphInputSchema.safeParse(args);
    if (!parsed.success) return errorResult('Repository graph: invalid arguments');
    const input: GraphInput = parsed.data;
    if (input.action === 'status') {
      // A cancelled caller must not cancel the probe shared by other sessions.
      let cancel: (() => void) | undefined;
      try {
        await Promise.race([
          this.probe(),
          new Promise<never>((_resolve, reject) => {
            cancel = () => reject(new GraphError('cancelled'));
            signal?.addEventListener('abort', cancel, { once: true });
            if (signal?.aborted) cancel();
          }),
        ]);
      } catch {
        return errorResult('Repository graph: cancelled');
      } finally {
        if (cancel) signal?.removeEventListener('abort', cancel);
      }
      const status = textResult(
        JSON.stringify({
          state: this.state,
          systemKey: this.systemKey,
          coverage: this.coverage,
          sharing: 'shared-repository-metadata',
          liveSapAuthorization: false,
        }),
      );
      return { ...status, isError: this.state !== 'ready' };
    }
    if (!this.client || this.stopped)
      return errorResult(`Repository graph: ${this.stopped ? 'unavailable' : this.state}`);
    try {
      // No result cache and no SAP fallback: every successful query is authenticated by the service.
      const result = await this.client.query(
        input,
        signal ? AbortSignal.any([signal, this.abort.signal]) : this.abort.signal,
      );
      this.setState(result.coverage.generation ? 'ready' : 'not_indexed');
      return textResult(
        JSON.stringify({
          ...result,
          qualification:
            'Indexed active metadata; potential dependencies only. Coverage describes the last collection scope, not all SAP objects. Live SAP authorization is not evaluated here.',
        }),
      );
    } catch (error) {
      const code = error instanceof GraphError ? error.code : 'unavailable';
      if (code !== 'cancelled' && code !== 'busy') this.setState(code);
      return errorResult(`Repository graph: ${code}. Use arc1-cli graph status; live SAP tools remain independent.`);
    }
  }
  stop(): void {
    this.stopped = true;
    this.state = 'unavailable';
    this.coverage = undefined;
    this.abort.abort();
    if (this.timer) clearTimeout(this.timer);
    this.listeners.clear();
  }
}

export function createRepositoryGraphRuntime(config: ServerConfig): RepositoryGraphRuntime | undefined {
  if (!graphConfigured(config)) return undefined;
  try {
    const connection = resolveGraphConnection(config);
    return new RepositoryGraphRuntime(new GraphClient(connection), connection.systemKey);
  } catch {
    return new RepositoryGraphRuntime(undefined, undefined, 'invalid_connection');
  }
}
