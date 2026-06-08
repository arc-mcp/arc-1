import { beforeAll, describe, expect, it } from 'vitest';
import {
  checkRepo,
  createRepo,
  getExternalInfo,
  listRepos,
  pullRepo,
  stageRepo,
  unlinkRepo,
} from '../../src/adt/abapgit.js';
import type { AdtClient } from '../../src/adt/client.js';
import { defaultFeatureConfig } from '../../src/adt/config.js';
import { probeFeatures } from '../../src/adt/features.js';
import { unrestrictedSafetyConfig } from '../../src/adt/safety.js';
import { expectSapFailureClass } from '../helpers/expected-error.js';
import { requireOrSkip, SkipReason, skipTest } from '../helpers/skip-policy.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

const ABAPGIT_REMOTE_TESTS_DISABLED =
  'TEST_ABAPGIT_REMOTE_TESTS not enabled (abapGit stage/pull requires remote reachability and STRUST trust chain)';
const abapGitRemoteTestsEnabled = process.env.TEST_ABAPGIT_REMOTE_TESTS === 'true';
const abapGitPullRepoKey = process.env.TEST_ABAPGIT_PULL_REPO_KEY;

describe('abapGit ADT bridge integration', () => {
  let client: AdtClient;
  let abapGitAvailable: boolean | undefined;

  beforeAll(async () => {
    requireSapCredentials();
    client = getTestClient();
    const features = await probeFeatures(client.http, defaultFeatureConfig());
    abapGitAvailable = features.abapGit?.available;
  });

  it('listRepos returns linked repositories with key/package/url/links', async (ctx) => {
    requireOrSkip(ctx, abapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    const repos = await listRepos(client.http, client.safety);
    expect(Array.isArray(repos)).toBe(true);
    expect(repos.length).toBeGreaterThan(0);
    for (const repo of repos) {
      expect(repo.key).toBeTruthy();
      expect(repo.package).toBeTruthy();
      expect(repo.url).toContain('http');
      expect(Array.isArray(repo.links)).toBe(true);
    }
  });

  it('getExternalInfo returns remote branch metadata for public test repo', async (ctx) => {
    requireOrSkip(ctx, abapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    const info = await getExternalInfo(client.http, client.safety, 'https://github.com/abapGit-tests/CLAS.git');
    expect(info.accessMode).toBeTruthy();
    expect(Array.isArray(info.branches)).toBe(true);
    expect(info.branches.length).toBeGreaterThan(0);
  });

  it('unlinkRepo on fake key returns expected bridge error shape', async (ctx) => {
    requireOrSkip(ctx, abapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    try {
      await unlinkRepo(client.http, client.safety, `999999999${Date.now()}`);
      expect.fail('Expected unlinkRepo to fail for fake key');
    } catch (err) {
      expectSapFailureClass(err, [404, 400], [/Repository not found in database/i, /not found/i]);
    }
  });

  it('createRepo is blocked when allowGitWrites=false', async (ctx) => {
    requireOrSkip(ctx, abapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    const noGitSafety = { ...unrestrictedSafetyConfig(), allowGitWrites: false };
    await expect(
      createRepo(client.http, noGitSafety, {
        package: '$TMP',
        url: 'https://github.com/example/repo.git',
      }),
    ).rejects.toThrow(/Git write 'clone' is blocked: allowGitWrites=false/);
  });

  it('checkRepo succeeds or fails quickly without hanging', async (ctx) => {
    requireOrSkip(ctx, abapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    const repos = await listRepos(client.http, client.safety);
    requireOrSkip(ctx, repos[0], SkipReason.NO_FIXTURE);

    const timeoutMs = 30_000;
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`checkRepo timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    await Promise.race([
      (async () => {
        try {
          const result = await checkRepo(client.http, client.safety, repos[0]!);
          expect(typeof result.ok).toBe('boolean');
        } catch (err) {
          expect(err).toBeInstanceOf(Error);
        }
      })(),
      timeout,
    ]);
  });

  it('stageRepo can stage a linked repo when remote trust is explicitly enabled', async (ctx) => {
    requireOrSkip(ctx, abapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    if (!abapGitRemoteTestsEnabled) {
      skipTest(ctx, ABAPGIT_REMOTE_TESTS_DISABLED);
      return;
    }
    const repos = await listRepos(client.http, client.safety);
    requireOrSkip(ctx, repos[0], `${SkipReason.NO_FIXTURE}: linked abapGit repo required for stageRepo`);
    await stageRepo(client.http, client.safety, repos[0]);
  });

  it('pullRepo can pull a configured repo when remote trust is explicitly enabled', async (ctx) => {
    requireOrSkip(ctx, abapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    if (!abapGitRemoteTestsEnabled) {
      skipTest(ctx, ABAPGIT_REMOTE_TESTS_DISABLED);
      return;
    }
    requireOrSkip(
      ctx,
      abapGitPullRepoKey,
      'TEST_ABAPGIT_PULL_REPO_KEY not configured (pullRepo needs an explicit linked repository key)',
    );
    await pullRepo(client.http, client.safety, abapGitPullRepoKey);
  });
});
