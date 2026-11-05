import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NativeCtsDependencies } from '../../../scripts/qualification/pr1142/native-cts.js';
import type { CtsRound } from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
import {
  ctsOrigin,
  ctsPhaseProfile,
  ctsProtocol,
  ctsSteps,
  retainedCtsRequest,
} from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
import { runNativeRetainedCts } from '../../../scripts/qualification/pr1142/native-cts-retained.js';
import { runNativeRetainedCtsV2 } from '../../../scripts/qualification/pr1142/native-cts-retained-v2.js';
import { runNativeRetainedCtsV3 } from '../../../scripts/qualification/pr1142/native-cts-retained-v3.js';
import { runNativeRetainedCtsV4 } from '../../../scripts/qualification/pr1142/native-cts-retained-v4.js';
import { runNativeRetainedCtsV5 } from '../../../scripts/qualification/pr1142/native-cts-retained-v5.js';
import { runNativeRetainedCtsV6 } from '../../../scripts/qualification/pr1142/native-cts-retained-v6.js';
import { AdtClient, harness, runNativeCtsRound } from './pr1142-native-cts-harness.js';
import { retainedV3Harness } from './pr1142-native-cts-retained-v3-harness.js';
import { retainedV4Harness } from './pr1142-native-cts-retained-v4-harness.js';
import { retainedV5Harness } from './pr1142-native-cts-retained-v5-harness.js';
import { retainedV6Harness } from './pr1142-native-cts-retained-v6-harness.js';

describe.each(['retained', 'retained-v2', 'retained-v3', 'retained-v4', 'retained-v5', 'retained-v6'] as const)(
  'fixed %s CTS profile',
  (profile) => {
    const revision = 'a'.repeat(40),
      jpeg = Buffer.from('ffd8ffc0000b080001000101011100ffda0008010100003f0011ff0022ffd9', 'hex'),
      sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
    const read = (p: string) => JSON.parse(readFileSync(p, 'utf8')),
      write = (p: string, x: unknown) => writeFileSync(p, JSON.stringify(x), { mode: 0o600 });
    let temporary: string,
      deps: NativeCtsDependencies,
      h: ReturnType<typeof harness> | undefined,
      validHistory: boolean,
      useProxy: boolean;
    const root = () => join(temporary, ctsProtocol(profile)),
      tick = () => vi.setSystemTime(Date.now() + 1000);
    const invoke = (mode: string, round?: CtsRound, sample?: string) =>
      (profile === 'retained-v6'
        ? runNativeRetainedCtsV6
        : profile === 'retained-v5'
          ? runNativeRetainedCtsV5
          : profile === 'retained-v4'
            ? runNativeRetainedCtsV4
            : profile === 'retained-v3'
              ? runNativeRetainedCtsV3
              : profile === 'retained'
                ? runNativeRetainedCts
                : runNativeRetainedCtsV2)(
        [
          `--${mode}-reviewed-native-cts-${ctsPhaseProfile(profile)}`,
          revision,
          ...(round ? [round] : []),
          ...(sample ? [sample] : []),
        ],
        deps,
      );
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-03T17:00:00Z'));
      vi.spyOn(process, 'umask').mockReturnValue(0o022);
      temporary = mkdtempSync(join(tmpdir(), 'cts-retained-entry-'));
      validHistory = true;
      useProxy = false;
      deps = {
        validateRuntime: vi.fn(),
        bind: vi.fn(async () => ({
          repo: temporary,
          root: root(),
          verifySource: vi.fn(),
          evidence: {
            revision,
            entryHash: 'b'.repeat(64),
            packageLockHash: 'c'.repeat(64),
            node: 'v22.21.1',
            repo: temporary,
            dependencyLimit: 'synthetic',
          },
        })),
        retainedHistory: () => ({
          verify: () => {
            if (!validHistory) throw Error('Synthetic old history changed');
          },
        }),
        readEnv: vi.fn(() => ({
          SAP_URL: 'https://a4h.marianzeis.de',
          SAP_USER: 'MARIAN',
          SAP_PASSWORD: 'SYNTHETIC-PASSWORD',
          SAP_CLIENT: '001',
        })),
        createClient: vi.fn((options) => {
          if (!h) throw Error('Harness not ready');
          return new AdtClient({
            ...options,
            baseUrl: h.origin,
            ...(useProxy
              ? {
                  btpProxy: {
                    host: 'proxy.invalid',
                    port: 20003,
                    protocol: 'http',
                    getProxyToken: async () => 'synthetic-token',
                  },
                }
              : {}),
          });
        }),
        execute: runNativeCtsRound,
      };
    });
    afterEach(() => {
      h?.assertSafe();
      h = undefined;
      rmSync(temporary, { recursive: true, force: true });
      vi.useRealTimers();
    });
    async function prepare() {
      await invoke('prepare');
      if (
        profile === 'retained-v3' ||
        profile === 'retained-v4' ||
        profile === 'retained-v5' ||
        profile === 'retained-v6'
      ) {
        h =
          profile === 'retained-v6'
            ? retainedV6Harness()
            : profile === 'retained-v5'
              ? retainedV5Harness()
              : profile === 'retained-v4'
                ? retainedV4Harness()
                : retainedV3Harness();
        tick();
        return;
      }
      h = harness(read(join(root(), 'intent.json')).graph);
      const own = retainedCtsRequest();
      h.trees.set(own.parent, {
        parent: own.parent,
        task: own.task,
        description: own.description,
        parentStatus: 'D',
        taskStatus: 'D',
        taskOwner: 'MARIAN',
        taskType: 'Unclassified',
        taskExists: true,
        exists: true,
        objects: [],
      });
      tick();
    }
    async function ready(round: CtsRound) {
      const out = await invoke('preflight', round);
      expect(out).toMatchObject({ failure: false, mutationAttempted: false });
      tick();
      const sample = (out as { preflightId: string }).preflightId,
        dir = join(root(), round, 'preflight', sample),
        intentHash = sha(readFileSync(join(root(), 'intent.json'))),
        observed = {
          observedAt: new Date().toISOString(),
          client: '001',
          table: '*',
          lockCount: 0,
          evidenceSha256: sha(jpeg),
        };
      write(join(dir, 'sm12-baseline.json'), {
        protocol: ctsProtocol(profile),
        round,
        revision,
        intentHash,
        preflightId: sample,
        suffixSearch: { ...observed, user: '*', argument: `*${h!.graph.suffix}*` },
        userSearch: { ...observed, user: 'MARIAN', argument: '*' },
      });
      for (const name of ['suffix', 'user']) writeFileSync(join(dir, `sm12-${name}.jpg`), jpeg, { mode: 0o600 });
      return { sample, dir };
    }
    it.each([false, true])(
      'composes actual entry/client/driver A→B→C via proxy=%s without prefix replay',
      async (proxy) => {
        useProxy = proxy;
        await prepare();
        expect(read(join(root(), 'intent.json')).origin).toEqual(ctsOrigin(profile)!);
        for (const round of ['A', 'B', 'C'] as const) {
          const { sample } = await ready(round),
            count = h!.calls.length,
            envs = vi.mocked(deps.readEnv).mock.calls.length,
            files = readdirSync(root());
          expect(await invoke('check', round, sample)).toMatchObject({
            failure: false,
            attemptClaimed: false,
            executionGrant: false,
          });
          expect(h!.calls).toHaveLength(count);
          expect(deps.readEnv).toHaveBeenCalledTimes(envs);
          expect(readdirSync(root())).toEqual(files);
          expect(await invoke('execute', round, sample)).toMatchObject({
            failure: false,
            completed: ctsSteps(round, profile),
            origin: ctsOrigin(profile)!,
          });
          if (profile === 'retained-v4' && round === 'A') {
            expect(
              h!.calls
                .slice(count)
                .filter((r) => ['POST', 'PUT', 'DELETE'].includes(r.method))
                .map((r) => [r.method, r.path]),
            ).toEqual([
              ['POST', '/sap/bc/adt/cts/transportrequests/A4HK906608/newreleasejobs'],
              ['POST', '/sap/bc/adt/cts/transportrequests/A4HK906607/newreleasejobs'],
            ]);
          }
          if (profile === 'retained-v6' && round === 'A')
            expect(h!.calls.filter((r) => !['GET', 'HEAD'].includes(r.method))).toEqual([]);
          if (profile === 'retained-v5' && round === 'A')
            expect(
              h!.calls
                .slice(count)
                .filter((r) => ['POST', 'PUT', 'DELETE'].includes(r.method))
                .map((r) => r.path),
            ).toEqual(['/sap/bc/adt/cts/transportrequests/A4HK906607/newreleasejobs']);
          const saved = read(join(root(), round, 'attempt/result.json'));
          expect(saved.remaining).toEqual([]);
          expect(saved.requests[0].parent).toBe('A4HK906607');
          const calls = h!.calls.length;
          await expect(invoke('execute', round, sample)).rejects.toThrow();
          expect(h!.calls).toHaveLength(calls);
          tick();
        }
        if (
          profile === 'retained-v3' ||
          profile === 'retained-v4' ||
          profile === 'retained-v5' ||
          profile === 'retained-v6'
        )
          expect(
            h!.calls.filter((r) => r.method === 'POST' && r.path.startsWith('/sap/bc/adt/oo/classes?')),
          ).toHaveLength(1); // Only new B.
        expect(h!.calls.filter((r) => r.method === 'POST' && r.path === '/sap/bc/adt/cts/transports')).toHaveLength(2);
        expect(
          vi
            .mocked(deps.bind)
            .mock.calls.every(([, entry]) =>
              entry.pathname.endsWith(
                profile === 'retained-v6'
                  ? '/native-cts-retained-v6.ts'
                  : profile === 'retained-v5'
                    ? '/native-cts-retained-v5.ts'
                    : profile === 'retained-v4'
                      ? '/native-cts-retained-v4.ts'
                      : profile === 'retained-v3'
                        ? '/native-cts-retained-v3.ts'
                        : profile === 'retained'
                          ? '/native-cts-retained.ts'
                          : '/native-cts-retained-v2.ts',
              ),
            ),
        ).toBe(true);
      },
      120000,
    );
    it('refuses broken original history before preparation creates the new root', async () => {
      validHistory = false;
      await expect(invoke('prepare')).rejects.toThrow();
      expect(existsSync(root())).toBe(false);
      expect(deps.readEnv).not.toHaveBeenCalled();
    });
    it.each(['origin', 'suffix', 'graph', 'protocol'] as const)(
      'refuses edited %s in the new intent before credentials',
      async (fault) => {
        await prepare();
        const p = join(root(), 'intent.json'),
          x = read(p);
        if (fault === 'origin') x.origin.parent = 'A4HK900001';
        if (fault === 'suffix') x.suffix = '0'.repeat(16);
        if (fault === 'graph') x.graph.classes[0].name = 'ZFOREIGN';
        if (fault === 'protocol') x.protocol = 'pr1142-native-cts-workflows-v1';
        write(p, x);
        await expect(invoke('preflight', 'A')).rejects.toThrow();
        expect(deps.readEnv).not.toHaveBeenCalled();
      },
    );
    it('refuses B without a successful sealed new A; old failed history is no substitute', async () => {
      await prepare();
      await expect(invoke('preflight', 'B')).rejects.toThrow();
      expect(deps.readEnv).not.toHaveBeenCalled();
    });
    it('refuses changed parent after GET preflight, retains both IDs and consumes only the new attempt', async () => {
      await prepare();
      const { sample } = await ready('A');
      h!.trees.get('A4HK906607')!.taskOwner = 'OTHER';
      if (
        profile === 'retained-v3' ||
        profile === 'retained-v4' ||
        profile === 'retained-v5' ||
        profile === 'retained-v6'
      ) {
        const original = h!.hooks.reply;
        h!.hooks.reply = (r) => {
          const value = original?.(r);
          return value && r.path.endsWith('A4HK906607')
            ? { ...value, data: value.data.replace('tm:owner="MARIAN"', 'tm:owner="OTHER"') }
            : value;
        };
      }
      const out = await invoke('execute', 'A', sample);
      expect(out).toMatchObject({ failure: true, completed: [], origin: ctsOrigin(profile)! });
      const saved = read(join(root(), 'A/attempt/result.json'));
      expect(saved.inspectionRequired).toEqual(expect.arrayContaining(['A4HK906607', 'A4HK906608']));
      expect(h!.calls.every((r) => r.method === 'GET')).toBe(true);
      await expect(invoke('execute', 'A', sample)).rejects.toThrow();
    });
    it('final native send checks the original history; a read-side change prevents the first PUT', async () => {
      await prepare();
      const { sample } = await ready('A');
      let armed = true;
      h!.hooks.before = (r) => {
        if (armed && r.path.endsWith('A4HK906607')) {
          armed = false;
          validHistory = false;
        }
      };
      const out = await invoke('execute', 'A', sample);
      expect(out).toMatchObject({ failure: true, completed: [], origin: ctsOrigin(profile)! });
      expect(h!.calls.every((r) => r.method === 'GET')).toBe(true);
      const saved = read(join(root(), 'A/attempt/result.json'));
      expect(saved.inspectionRequired).toContain('A4HK906607');
    });
    it('preserves completed native facts but refuses a terminal old-history change', async () => {
      await prepare();
      const { sample } = await ready('A');
      const real = deps.execute;
      deps.execute = async (input) => {
        const result = await real(input);
        validHistory = false;
        return result;
      };
      const out = await invoke('execute', 'A', sample);
      expect(out).toMatchObject({ failure: true, completed: ctsSteps('A', profile) });
      const saved = read(join(root(), 'A/attempt/result.json'));
      expect(saved.confirmedReleased).toEqual(expect.arrayContaining(['A4HK906607', 'A4HK906608']));
      expect(saved.inspectionRequired).toContain('A4HK906607');
    }, 30000);
    it('C cannot begin before a successful B result', async () => {
      await prepare();
      const count = h!.calls.length;
      await expect(invoke('preflight', 'C')).rejects.toThrow();
      expect(h!.calls).toHaveLength(count);
      expect(existsSync(join(root(), 'C/attempt'))).toBe(false);
    });
    it('refuses an expired sample before credentials and retains the held pair in the permanent result', async () => {
      await prepare();
      const { sample } = await ready('A');
      const before = vi.mocked(deps.readEnv).mock.calls.length;
      vi.setSystemTime(Date.now() + 301000);
      await expect(invoke('execute', 'A', sample)).rejects.toThrow();
      expect(deps.readEnv).toHaveBeenCalledTimes(before);
      expect(read(join(root(), 'A/attempt/result.json')).inspectionRequired).toEqual(
        expect.arrayContaining(['A4HK906607', 'A4HK906608']),
      );
      if (
        profile === 'retained-v3' ||
        profile === 'retained-v4' ||
        profile === 'retained-v5' ||
        profile === 'retained-v6'
      )
        expect(read(join(root(), 'A/attempt/result.json')).remaining).toContain(h!.graph.classes[0].owner);
      await expect(invoke('execute', 'A', sample)).rejects.toThrow();
    });
  },
);
