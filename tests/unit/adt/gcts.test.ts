import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtSafetyError } from '../../../src/adt/errors.js';
import {
  cloneRepo,
  commitRepo,
  createBranch,
  deleteRepo,
  getCommitHistory,
  getConfig,
  getSystemInfo,
  getTransportHistory,
  getUserInfo,
  listBranches,
  listRepoObjects,
  listRepos,
  pullRepo,
  switchBranch,
} from '../../../src/adt/gcts.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

const fixturesDir = join(import.meta.dirname, '../../fixtures/json');
const loadFixture = (name: string) => readFileSync(join(fixturesDir, name), 'utf-8');

function mockHttp(body = '{}'): AdtHttpClient {
  return {
    get: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body }),
    post: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body }),
    put: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body }),
    delete: vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: '' }),
    fetchCsrfToken: vi.fn(),
    withStatefulSession: vi.fn(),
  } as unknown as AdtHttpClient;
}

const gitSafety = { ...unrestrictedSafetyConfig(), allowGitWrites: true };

describe('gCTS client helpers', () => {
  it('parses /system payload', async () => {
    const http = mockHttp(loadFixture('gcts-system.json'));
    const result = await getSystemInfo(http, gitSafety);
    expect(result.result.sid).toBe('A4H');
    expect(result.result.version).toBe('2.7.1');
    expect(result.result.status?.some((s) => s.name === 'tp' && s.status === 'GREEN')).toBe(true);
  });

  it('parses /user payload', async () => {
    const http = mockHttp(loadFixture('gcts-user.json'));
    const result = await getUserInfo(http, gitSafety);
    expect(result.user.user).toBe('DEVELOPER');
    expect(result.user.scope?.system?.[0]?.scope).toBe('config');
  });

  it('parses /config payload (array shape)', async () => {
    const http = mockHttp(loadFixture('gcts-config.json'));
    const result = await getConfig(http, gitSafety);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((entry) => entry.ckey === 'CLIENT_VCS_URI')).toBe(true);
  });

  it('listRepos tolerates empty object response', async () => {
    const http = mockHttp(loadFixture('gcts-repository-empty.json'));
    const result = await listRepos(http, gitSafety);
    expect(result).toEqual([]);
  });

  it('listRepos parses {result:[...]} shape', async () => {
    const http = mockHttp(loadFixture('gcts-repository.json'));
    const result = await listRepos(http, gitSafety);
    expect(result).toHaveLength(1);
    expect(result[0]?.rid).toBe('ZARC1');
  });

  it('listBranches parses branch payload', async () => {
    const http = mockHttp(loadFixture('gcts-branches.json'));
    const result = await listBranches(http, gitSafety, 'ZARC1');
    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe('main');
  });

  it('getCommitHistory parses commit payload', async () => {
    const http = mockHttp(loadFixture('gcts-commit-history.json'));
    const result = await getCommitHistory(http, gitSafety, 'ZARC1', 10);
    expect(result).toHaveLength(2);
    expect(result[0]?.commit).toBe('1f2e3d4c');
  });

  it('listRepoObjects parses objects payload', async () => {
    const http = mockHttp(loadFixture('gcts-objects.json'));
    const result = await listRepoObjects(http, gitSafety, 'ZARC1');
    expect(result).toHaveLength(2);
    expect(result[0]?.type).toBe('CLAS');
  });

  it('cloneRepo is blocked when allowGitWrites=false', async () => {
    const http = mockHttp(loadFixture('gcts-repository.json'));
    const safety = { ...unrestrictedSafetyConfig(), allowGitWrites: false };
    await expect(
      cloneRepo(http, safety, { url: 'https://github.com/example/arc1.git', package: '$TMP' }),
    ).rejects.toThrow(AdtSafetyError);
  });

  it('cloneRepo enforces package allowlist', async () => {
    const http = mockHttp(loadFixture('gcts-repository.json'));
    const safety = { ...gitSafety, allowedPackages: ['$TMP'] };
    await expect(
      cloneRepo(http, safety, { url: 'https://github.com/example/arc1.git', package: 'ZBLOCKED' }),
    ).rejects.toThrow(AdtSafetyError);
  });

  it('cloneRepo requires explicit package when allowedPackages is set', async () => {
    const http = mockHttp(loadFixture('gcts-repository.json'));
    const safety = { ...gitSafety, allowedPackages: ['$TMP'] };
    await expect(cloneRepo(http, safety, { url: 'https://github.com/example/arc1.git' })).rejects.toThrow(
      AdtSafetyError,
    );
    expect(http.post).not.toHaveBeenCalled();
  });

  it('cloneRepo allows missing package when no allowlist configured', async () => {
    const http = mockHttp(loadFixture('gcts-repository.json'));
    const safety = { ...gitSafety, allowedPackages: [] };
    await expect(cloneRepo(http, safety, { url: 'https://github.com/example/arc1.git' })).resolves.toBeDefined();
  });

  it('cloneRepo injects per-request repo credentials into config entries', async () => {
    const http = mockHttp(loadFixture('gcts-repository.json'));
    await cloneRepo(http, gitSafety, {
      url: 'https://github.com/example/arc1.git',
      package: '$TMP',
      user: 'git-user',
      password: 'git-pass',
      token: 'git-token',
    });

    expect(http.post).toHaveBeenCalledTimes(1);
    const [, body] = (http.post as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    const parsed = JSON.parse(body) as { config?: Array<{ key: string; value: string }> };
    expect(parsed.config).toEqual(
      expect.arrayContaining([
        { key: 'CLIENT_VCS_AUTH_USER', value: 'git-user' },
        { key: 'CLIENT_VCS_AUTH_PWD', value: 'git-pass' },
        { key: 'CLIENT_VCS_AUTH_TOKEN', value: 'git-token' },
      ]),
    );
  });

  it('pullRepo enforces existing repository package allowlist before posting', async () => {
    const http = mockHttp(loadFixture('gcts-repository.json'));
    const safety = { ...gitSafety, allowedPackages: ['$TMP'] };

    await expect(pullRepo(http, safety, 'ZARC1')).rejects.toThrow(AdtSafetyError);
    expect(http.get).toHaveBeenCalledWith(
      '/sap/bc/cts_abapvcs/repository',
      expect.objectContaining({ Accept: 'application/json' }),
    );
    expect(http.post).not.toHaveBeenCalled();
  });

  it('pullRepo allows existing repository package that matches the allowlist', async () => {
    const http = mockHttp(loadFixture('gcts-repository.json'));
    const safety = { ...gitSafety, allowedPackages: ['ZARC1'] };

    await expect(pullRepo(http, safety, 'ZARC1')).resolves.toBeDefined();
    expect(http.post).toHaveBeenCalledTimes(1);
    expect((http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      '/sap/bc/cts_abapvcs/repository/ZARC1/pullByCommit',
    );
  });

  it('pullRepo fails closed when repository package metadata is unavailable', async () => {
    const http = mockHttp('{"result":[{"rid":"ZARC1","name":"ZARC1"}]}');
    const safety = { ...gitSafety, allowedPackages: ['ZARC1'] };

    await expect(pullRepo(http, safety, 'ZARC1')).rejects.toThrow(/could not resolve package/);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('commitRepo enforces existing repository package allowlist before posting', async () => {
    const http = mockHttp(loadFixture('gcts-repository.json'));
    const safety = { ...gitSafety, allowedPackages: ['$TMP'] };

    await expect(commitRepo(http, safety, 'ZARC1', { message: 'test' })).rejects.toThrow(AdtSafetyError);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('commitRepo allows existing repository package that matches the allowlist', async () => {
    const http = mockHttp(loadFixture('gcts-repository.json'));
    const safety = { ...gitSafety, allowedPackages: ['ZARC1'] };

    await expect(commitRepo(http, safety, 'ZARC1', { message: 'test' })).resolves.toBeDefined();
    expect(http.post).toHaveBeenCalledTimes(1);
    expect((http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      '/sap/bc/cts_abapvcs/repository/ZARC1/commit',
    );
  });

  it('switchBranch enforces existing repository package allowlist before posting', async () => {
    const http = mockHttp(loadFixture('gcts-repository.json'));
    const safety = { ...gitSafety, allowedPackages: ['$TMP'] };

    await expect(switchBranch(http, safety, 'ZARC1', 'feature')).rejects.toThrow(AdtSafetyError);
    expect(http.post).not.toHaveBeenCalled();
  });

  it('switchBranch allows existing repository package that matches the allowlist', async () => {
    const http = mockHttp(loadFixture('gcts-repository.json'));
    const safety = { ...gitSafety, allowedPackages: ['ZARC1'] };

    await expect(switchBranch(http, safety, 'ZARC1', 'feature')).resolves.toBeDefined();
    expect(http.post).toHaveBeenCalledTimes(1);
    expect((http.post as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toContain(
      '/sap/bc/cts_abapvcs/repository/ZARC1/checkout/feature',
    );
  });

  it('pullRepo surfaces 200/log ERROR payload as AdtApiError', async () => {
    const http = mockHttp(loadFixture('gcts-log-error.json'));
    await expect(pullRepo(http, gitSafety, 'ZARC1')).rejects.toThrow(AdtApiError);
    await expect(pullRepo(http, gitSafety, 'ZARC1')).rejects.toThrow(/Remote pull failed/);
  });

  it('commitRepo surfaces 200/log ERROR payload as AdtApiError', async () => {
    const http = mockHttp(loadFixture('gcts-log-error.json'));
    await expect(commitRepo(http, gitSafety, 'ZARC1', { message: 'test' })).rejects.toThrow(AdtApiError);
    await expect(commitRepo(http, gitSafety, 'ZARC1', { message: 'test' })).rejects.toThrow(/Remote pull failed/);
  });

  it('getTransportHistory maps gCTS exception payload from AdtApiError response body', async () => {
    const http = mockHttp();
    (http.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AdtApiError(
        '{"exception":"No relation between system and repository"}',
        500,
        '/sap/bc/cts_abapvcs/repository/history/ZARC1',
        '{"exception":"No relation between system and repository"}',
      ),
    );

    try {
      await getTransportHistory(http, gitSafety, 'ZARC1');
      expect.fail('Expected getTransportHistory to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AdtApiError);
      expect((err as Error).message).toContain('No relation between system and repository');
    }
  });

  it('passes encoded URL segments to create/switch/delete operations', async () => {
    const http = mockHttp('{}');
    await createBranch(http, gitSafety, 'Z AR C1', { branch: 'feature/new' });
    await switchBranch(http, gitSafety, 'Z AR C1', 'feature/new');
    await deleteRepo(http, gitSafety, 'Z AR C1');

    const postCalls = (http.post as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]));
    const deleteCalls = (http.delete as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]));
    expect(postCalls.some((url) => url.includes('/repository/Z%20AR%20C1/branches'))).toBe(true);
    expect(postCalls.some((url) => url.includes('/repository/Z%20AR%20C1/checkout/feature%2Fnew'))).toBe(true);
    expect(deleteCalls[0]).toContain('/repository/Z%20AR%20C1');
  });
});
