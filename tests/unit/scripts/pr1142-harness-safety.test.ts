import { execFile, execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { McpSession } from '../../../scripts/qualification/pr1142/mcp-checks.mjs';
import { recordFormatterRecovery } from '../../../scripts/qualification/pr1142/qualification.mjs';
import {
  assertPersistentStateParent,
  assertWorkspaceRoot,
} from '../../../scripts/qualification/pr1142/run-manifest.mjs';
import {
  assertSafeDiagnosticEnvironment,
  boundedFetch,
  responseReceipt,
} from '../../../scripts/qualification/pr1142/safe-io.mjs';
import { checkForwardWork, QualificationShutdown } from '../../../scripts/qualification/pr1142/shutdown.mjs';

describe('PR1142 real harness safety boundaries', () => {
  it.each(['broken-output', 'native-interrupt'])('lets an in-flight worker finish after %s', async (boundary) => {
    const root = await mkdtemp(join(tmpdir(), 'pr1142-process-boundary-'));
    const marker = join(root, 'completed');
    const module = new URL('../../../scripts/qualification/pr1142/process-boundaries.mjs', import.meta.url).href;
    const script = `
        import { writeFile } from 'node:fs/promises';
        import { journalSafeEmitter, retainNativeWorkerOnInterrupt } from ${JSON.stringify(module)};
        const emit = journalSafeEmitter();
        if (process.env.ARC1_TEST_BOUNDARY === 'native-interrupt') retainNativeWorkerOnInterrupt();
        emit('ready');
        for await (const chunk of process.stdin) break;
        emit('continuing');
        await new Promise(resolve => setTimeout(resolve, 30));
        emit('cleanup');
        await writeFile(process.env.ARC1_TEST_MARKER, 'complete');
      `;
    try {
      await new Promise<void>((resolve, reject) => {
        const child = execFile(
          process.execPath,
          ['--import', 'tsx', '--input-type=module', '--eval', script],
          {
            env: { ...process.env, ARC1_TEST_BOUNDARY: boundary, ARC1_TEST_MARKER: marker },
            timeout: 10000,
          },
          (error) => (error ? reject(error) : resolve()),
        );
        child.stdin?.on('error', () => {});
        child.stdout?.once('data', () => {
          if (boundary === 'broken-output') child.stdout?.destroy();
          else child.kill('SIGINT');
          setTimeout(() => child.stdin?.end('finish'), 50);
        });
      });
      expect(await readFile(marker, 'utf8')).toBe('complete');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['native-fixtures.mts', 'native-formatter.mts'])(
    'the real %s entrypoint installs its interrupt hook before refusing unsafe TLS',
    async (script) => {
      const root = await mkdtemp(join(tmpdir(), 'pr1142-worker-entrypoint-'));
      const marker = join(root, 'completed');
      const preload = join(root, 'observe-refusal.mjs');
      const filename = fileURLToPath(new URL(`../../../scripts/qualification/pr1142/${script}`, import.meta.url));
      await writeFile(
        preload,
        `
        import { writeFileSync } from 'node:fs';
        process.on('uncaughtException', (error) => {
          if (error.code !== 'TLS_VERIFICATION_REQUIRED') process.exit(2);
          process.stdin.once('data', () => { writeFileSync(process.env.ARC1_TEST_MARKER, 'complete'); process.exit(0); });
          process.stdout.write('ARC1_TEST_TLS_BLOCKED\\n');
        });
      `,
      );
      try {
        await new Promise<void>((resolve, reject) => {
          const child = execFile(
            process.execPath,
            ['--import', 'tsx', '--import', preload, filename],
            {
              env: {
                ...process.env,
                NODE_TLS_REJECT_UNAUTHORIZED: '0',
                TEST_SAP_URL: 'https://example.invalid',
                TEST_SAP_USER: 'OFFLINE_TEST',
                TEST_SAP_PASSWORD: 'offline-test-only',
                DOTENV_CONFIG_QUIET: 'true',
                ARC1_TEST_MARKER: marker,
              },
              timeout: 10000,
            },
            (error) => (error ? reject(error) : resolve()),
          );
          let observed = '',
            sent = false;
          child.stdin?.on('error', () => {});
          child.stdout?.on('data', (chunk) => {
            observed += String(chunk);
            if (!sent && observed.includes('ARC1_TEST_TLS_BLOCKED')) {
              sent = true;
              child.kill('SIGINT');
              setTimeout(() => child.stdin?.end('finish'), 50);
            }
          });
        });
        expect(await readFile(marker, 'utf8')).toBe('complete');
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it('the real parent entrypoint survives closed stdout while reporting a startup refusal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pr1142-parent-entrypoint-'));
    const marker = join(root, 'observed.json');
    const preload = join(root, 'observe-exit.mjs');
    const filename = fileURLToPath(new URL('../../../scripts/qualification/pr1142/live-harness.mjs', import.meta.url));
    await writeFile(
      preload,
      `
      import { writeFileSync } from 'node:fs';
      const uncaught = [];
      process.on('uncaughtExceptionMonitor', error => uncaught.push(error.code ?? error.message));
      process.on('exit', exitCode => writeFileSync(process.env.ARC1_TEST_MARKER, JSON.stringify({ exitCode, uncaught })));
    `,
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const child = execFile(
          process.execPath,
          ['--import', preload, filename],
          {
            env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0', ARC1_TEST_MARKER: marker },
            timeout: 10000,
          },
          (error) => (error?.code === 1 ? resolve() : reject(error ?? new Error('Expected unsafe TLS refusal'))),
        );
        child.stdout?.destroy();
      });
      expect(JSON.parse(await readFile(marker, 'utf8'))).toEqual({ exitCode: 1, uncaught: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('updates restoration evidence without erasing the original failed qualification', async () => {
    const binding = { runId: 'run', sourceRevision: 'revision', harnessSha256: 'hash', target: 'PR1142/001' };
    const parent = {
      ...binding,
      plan: 'delete-two-user-v1',
      failed: 3,
      formatter: {
        failed: 2,
        restored: { writerA: false },
        restorationStatus: { writerA: 'incomplete' },
        nativeSeedRestored: false,
      },
    };
    const load = async (path: string) =>
      structuredClone(
        path.endsWith('deletion-qualification.json') ? parent : { ...binding, plan: 'formatter-two-user-v2' },
      );
    const write = vi.fn();
    const result = {
      ...binding,
      journalOwned: true,
      failed: 0,
      restored: { writerA: true, writerB: true },
      restorationStatus: { writerA: 'verified', writerB: 'verified' },
      nativeSeedRestored: true,
    };
    await recordFormatterRecovery('/private', result, load, write);
    expect(write.mock.calls[0][1]).toMatchObject({
      failed: 3,
      formatter: { failed: 2, restored: result.restored, nativeSeedRestored: true },
    });
    expect(write.mock.calls[0][1].formatterRestorationHistory).toEqual([
      {
        at: expect.any(String),
        restored: parent.formatter.restored,
        restorationStatus: parent.formatter.restorationStatus,
        nativeSeedRestored: false,
      },
    ]);
    write.mockClear();
    await expect(recordFormatterRecovery('/private', { ...result, runId: 'foreign' }, load, write)).rejects.toThrow(
      'RECOVERY_PARENT_BINDING_MISMATCH',
    );
    expect(write).not.toHaveBeenCalled();
    await recordFormatterRecovery('/private', { ...result, journalOwned: false }, load, write);
    expect(write).not.toHaveBeenCalled();
  });
  it('records recovery after a mid-formatter crash without inventing qualification completion', async () => {
    const binding = { runId: 'run', sourceRevision: 'revision', harnessSha256: 'hash', target: 'PR1142/001' };
    const parent = {
      ...binding,
      plan: 'delete-two-user-v1',
      formatterAttempted: true,
      assertions: [{ test: 'source.active', pass: true }],
    };
    const load = async (path: string) =>
      structuredClone(
        path.endsWith('deletion-qualification.json') ? parent : { ...binding, plan: 'formatter-two-user-v2' },
      );
    const write = vi.fn();
    const result = {
      ...binding,
      journalOwned: true,
      failed: 0,
      restored: { writerA: true, writerB: true },
      restorationStatus: { writerA: 'verified', writerB: 'verified' },
      nativeSeedRestored: true,
    };
    await recordFormatterRecovery('/private', result, load, write);
    const saved = write.mock.calls[0][1];
    expect(saved).toMatchObject({ ...parent, formatterRecovery: result });
    for (const field of ['formatter', 'finishedAt', 'passed', 'failed', 'allAbsent'])
      expect(saved).not.toHaveProperty(field);

    write.mockClear();
    const unrelatedLoad = async (path: string) =>
      path.endsWith('deletion-qualification.json') ? { ...binding, plan: 'delete-two-user-v1' } : load(path);
    await expect(recordFormatterRecovery('/private', result, unrelatedLoad, write)).rejects.toThrow(
      'RECOVERY_PARENT_FORMATTER_MISSING',
    );
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects an ignored snapshot inside another Git worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pr1142-git-root-'));
    try {
      execFileSync('git', ['init', '-q', root]);
      await writeFile(join(root, '.gitignore'), 'ignored/\n');
      const nested = join(root, 'ignored/source');
      await mkdir(nested, { recursive: true });
      await expect(assertWorkspaceRoot(root)).resolves.toBeUndefined();
      await expect(assertWorkspaceRoot(nested)).rejects.toMatchObject({ code: 'REAL_GIT_WORKSPACE_ROOT_REQUIRED' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses OS temporary storage and macOS /tmp aliases', async () => {
    for (const location of [tmpdir(), '/tmp', '/var/tmp']) {
      let path: string;
      try {
        path = await realpath(location);
      } catch (error: any) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      await expect(assertPersistentStateParent(path)).rejects.toMatchObject({
        code: 'PERSISTENT_PRIVATE_STATE_REQUIRED',
      });
    }
  });

  it('refuses disabled TLS before any bearer request', async () => {
    expect(() => assertSafeDiagnosticEnvironment({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }, [])).toThrow(
      'TLS_VERIFICATION_REQUIRED',
    );
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
    try {
      await expect(boundedFetch(new URL('https://example.test'))).rejects.toThrow('TLS_VERIFICATION_REQUIRED');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it('waits for cleanup to settle after requesting shutdown', async () => {
    const stop = new QualificationShutdown();
    let release!: () => void, started!: () => void;
    const begun = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    let cleaned = false;
    const task = stop.track(async () => {
      started();
      try {
        await pending;
        checkForwardWork(stop.signal, false);
      } finally {
        checkForwardWork(stop.signal, true);
        cleaned = true;
      }
    });
    await begun;
    expect(stop.request()).toBe(true);
    expect(stop.request()).toBe(false);
    let drained = false;
    const drain = stop.drain().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    expect(cleaned).toBe(false);
    release();
    await expect(task).rejects.toThrow('QUALIFICATION_STOP_REQUESTED');
    await drain;
    expect(cleaned).toBe(true);
    await expect(stop.track(async () => {})).rejects.toThrow('HARNESS_STOPPED');
  });

  it('captures malformed RPC evidence before protocol validation and redacts reflected tokens', async () => {
    const token = 'test-access-token';
    const observed: any[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(`bad gateway echoed ${token}`, {
            status: 200,
            headers: { 'content-type': 'text/plain', 'cache-control': 'private, no-store' },
          }),
      ),
    );
    try {
      const session = new McpSession(
        new URL('https://example.test'),
        token,
        () => {},
        'fixture',
        true,
        async (method: string, response: any) => {
          observed.push({ method, ...responseReceipt(response, [token]) });
        },
      );
      await expect(session.request('initialize')).rejects.toThrow('INVALID_MCP_RESPONSE');
      expect(observed).toHaveLength(1);
      expect(observed[0].rawBody).toBe('bad gateway echoed [REDACTED_TOKEN]');
      expect(observed[0].method).toBe('initialize');
      expect(JSON.stringify(observed)).not.toContain(token);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
