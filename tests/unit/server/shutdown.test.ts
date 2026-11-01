import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '../../../src/server/logger.js';
import { closeHttpServer, registerShutdownHandlers } from '../../../src/server/shutdown.js';

describe('graceful shutdown', () => {
  let unregister: (() => void) | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'flush').mockResolvedValue(undefined);
  });

  afterEach(() => {
    unregister?.();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function signal(name: 'SIGTERM' | 'SIGINT'): Promise<void> {
    const handler = process.listeners(name).at(-1) as (signal: string) => Promise<void>;
    return handler(name);
  }

  it.each(['SIGTERM', 'SIGINT'] as const)('waits for audit delivery before exiting on %s', async (name) => {
    let release!: () => void;
    vi.mocked(logger.flush).mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    const stop = vi.fn().mockResolvedValue(undefined);
    const closeCache = vi.fn();
    unregister = registerShutdownHandlers(stop, closeCache);

    const shutdown = signal(name);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
    expect(logger.flush).toHaveBeenCalledOnce();
    expect(closeCache).not.toHaveBeenCalled();
    expect(process.exit).not.toHaveBeenCalled();

    // A second signal must not skip the in-progress flush or close resources twice.
    await signal(name === 'SIGTERM' ? 'SIGINT' : 'SIGTERM');
    expect(logger.flush).toHaveBeenCalledOnce();
    release();
    await shutdown;
    expect(closeCache).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drains requests before flushing the final audit events', async () => {
    let finishRequest!: () => void;
    const stop = () => new Promise<void>((resolve) => (finishRequest = resolve));
    unregister = registerShutdownHandlers(stop, vi.fn());
    const shutdown = signal('SIGTERM');
    expect(logger.flush).not.toHaveBeenCalled();
    finishRequest();
    await shutdown;
    expect(logger.flush).toHaveBeenCalledOnce();
  });

  it.each(['transport', 'flush', 'cache'])('still exits if %s cleanup fails', async (failure) => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const closeCache = vi.fn();
    if (failure === 'transport') stop.mockRejectedValue(new Error('close failed'));
    if (failure === 'flush') vi.mocked(logger.flush).mockRejectedValue(new Error('flush failed'));
    if (failure === 'cache')
      closeCache.mockImplementation(() => {
        throw new Error('cache close failed');
      });
    unregister = registerShutdownHandlers(stop, closeCache);

    await signal('SIGTERM');
    expect(logger.flush).toHaveBeenCalledOnce();
    expect(closeCache).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['transport', 'flush'])('bounds shutdown when %s never settles', async (stalled) => {
    const pending = new Promise<void>(() => {});
    const stop = vi.fn().mockResolvedValue(undefined);
    if (stalled === 'transport') stop.mockReturnValue(pending);
    else vi.mocked(logger.flush).mockReturnValue(pending);
    unregister = registerShutdownHandlers(stop, vi.fn());
    void signal('SIGTERM');

    await vi.advanceTimersByTimeAsync(4_999);
    expect(process.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(logger.warn).toHaveBeenCalledWith('Shutdown timed out; pending requests or audit writes may be lost');
  });

  it('closes HTTP listeners while allowing an active response to finish', async () => {
    vi.useRealTimers();
    let finishResponse!: () => void;
    const server = createServer((_req, res) => {
      finishResponse = () => res.end('done');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as { port: number };
    const requestStarted = once(server, 'request');
    const response = fetch(`http://127.0.0.1:${address.port}`, { headers: { Connection: 'close' } });
    await requestStarted;
    let closed = false;
    const closing = closeHttpServer(server).then(() => {
      closed = true;
    });
    expect(server.listening).toBe(false);
    expect(closed).toBe(false);
    finishResponse();
    expect(await (await response).text()).toBe('done');
    await closing;
    expect(closed).toBe(true);
  });
});

describe('server signal wiring', () => {
  it.each([
    ['SIGTERM', 'none', 'stdio'],
    ['SIGINT', 'memory', 'stdio'],
    ['SIGTERM', 'none', 'http-streamable'],
  ] as const)(
    'delivers an in-flight audit post on real %s with cache=%s over %s',
    async (signal, cacheMode, transport) => {
      // Use the real server startup and sink; hold the mocked HTTP response across an OS signal.
      const child = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          `
      import { XsuaaService } from '@sap/xssec';
      import { createAndStartServer } from './src/server/server.ts';
      import { DEFAULT_CONFIG } from './src/server/types.ts';
      import { logger } from './src/server/logger.ts';
      import { BTPAuditLogSink } from './src/server/sinks/btp-auditlog.ts';
      await createAndStartServer({
        ...DEFAULT_CONFIG, url: '', cacheMode: '${cacheMode}', transport: '${transport}', httpAddr: '127.0.0.1:0'
      });
      XsuaaService.prototype.getClientCredentialsToken = async () => ({ access_token: 'test-token' });
      globalThis.fetch = async () => {
        process.send('post-started');
        await new Promise(resolve => process.once('message', resolve));
        process.send('post-completed');
        return { ok: true };
      };
      logger.addSink(new BTPAuditLogSink({
        url: 'https://auditlog.test',
        uaa: { certurl: 'https://auth.test', clientid: 'test', certificate: 'cert', key: 'key' }
      }));
      logger.emitAudit({ timestamp: '', level: 'warn', event: 'safety_blocked', operation: 'SAPWrite', reason: 'test' });
    `,
        ],
        {
          cwd: fileURLToPath(new URL('../../../', import.meta.url)),
          env: { PATH: process.env.PATH },
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        },
      );
      const messages: unknown[] = [];
      let stderr = '';
      let stdout = '';
      child.on('message', (message) => messages.push(message));
      child.stderr!.on('data', (chunk) => {
        stderr += chunk;
      });
      child.stdout!.on('data', (chunk) => {
        stdout += chunk;
      });
      const exited = once(child, 'exit');
      try {
        await vi.waitFor(() => expect(messages, stderr).toContain('post-started'), { timeout: 5_000 });
        child.kill(signal);
        await vi.waitFor(() => expect(stderr).toContain(`shutting down (${signal})`));
        expect(child.exitCode).toBeNull();
        child.send('finish-post');
        expect(await exited).toEqual([0, null]);
        expect(messages).toContain('post-completed');
        for (const line of stdout.trim().split('\n').filter(Boolean)) {
          expect(JSON.parse(line).jsonrpc).toBe('2.0');
        }
      } finally {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        await exited;
      }
    },
  );
});
