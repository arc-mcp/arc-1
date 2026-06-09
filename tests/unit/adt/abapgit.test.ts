import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  checkRepo,
  createBranch,
  createRepo,
  enforceRepoPackageAllowed,
  getExternalInfo,
  listRepos,
  parseAbapGitExternalInfo,
  parseAbapGitObjects,
  parseAbapGitRepos,
  pullRepo,
  pushRepo,
  stageRepo,
  switchBranch,
  unlinkRepo,
} from '../../../src/adt/abapgit.js';
import { AdtApiError, AdtSafetyError } from '../../../src/adt/errors.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import type { AbapGitRepo } from '../../../src/adt/types.js';

const fixturesDir = join(import.meta.dirname, '../../fixtures/xml');
const loadFixture = (name: string) => readFileSync(join(fixturesDir, name), 'utf-8');

function mockHttp(body = ''): AdtHttpClient {
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

function firstRepo(): AbapGitRepo {
  return parseAbapGitRepos(loadFixture('abapgit-repos-v2.xml'))[0]!;
}

describe('abapGit client helpers', () => {
  it('parseAbapGitRepos parses repository metadata and HATEOAS links', () => {
    const repos = parseAbapGitRepos(loadFixture('abapgit-repos-v2.xml'));
    expect(repos).toHaveLength(2);
    expect(repos[0]?.key).toBe('000000000001');
    expect(repos[0]?.package).toBe('$TUTORIALS');
    expect(repos[0]?.links.some((link) => link.href.endsWith('/stage'))).toBe(true);
    expect(repos[0]?.links.some((link) => link.href.endsWith('/checks'))).toBe(true);
  });

  it('parseAbapGitExternalInfo parses access mode and branches', () => {
    const info = parseAbapGitExternalInfo(loadFixture('abapgit-external-info.xml'));
    expect(info.accessMode).toBe('PUBLIC');
    expect(info.defaultBranch).toBe('main');
    expect(info.branches.some((branch) => branch.name === 'HEAD' && branch.isHead === true)).toBe(true);
    expect(info.branches.some((branch) => branch.name === 'main')).toBe(true);
  });

  it('parseAbapGitObjects parses staging payload', () => {
    const objects = parseAbapGitObjects(loadFixture('abapgit-staging.xml'));
    expect(objects).toHaveLength(2);
    expect(objects[0]?.type).toBe('CLAS');
    expect(objects[0]?.state).toBe('M');
  });

  it('listRepos calls repos endpoint with v2 Accept header', async () => {
    const http = mockHttp(loadFixture('abapgit-repos-v2.xml'));
    const repos = await listRepos(http, gitSafety);
    expect(repos).toHaveLength(2);
    expect(http.get).toHaveBeenCalledWith('/sap/bc/adt/abapgit/repos', {
      Accept: 'application/abapgit.adt.repos.v2+xml',
    });
  });

  it('getExternalInfo uses the externalRepo namespace (capital R) in request payload', async () => {
    const http = mockHttp(loadFixture('abapgit-external-info.xml'));
    const result = await getExternalInfo(
      http,
      gitSafety,
      'https://github.com/abapGit-tests/CLAS.git',
      'user',
      'secret',
    );
    expect(result.accessMode).toBe('PUBLIC');
    const [, body] = (http.post as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(body).toContain('http://www.sap.com/adt/abapgit/externalRepo');
  });

  it('createRepo is blocked when allowGitWrites=false', async () => {
    const http = mockHttp(loadFixture('abapgit-repos-v2.xml'));
    const safety = { ...unrestrictedSafetyConfig(), allowGitWrites: false };
    await expect(
      createRepo(http, safety, { package: '$TMP', url: 'https://github.com/example/repo.git' }),
    ).rejects.toThrow(AdtSafetyError);
  });

  it('createRepo enforces package allowlist', async () => {
    const http = mockHttp(loadFixture('abapgit-repos-v2.xml'));
    const safety = { ...gitSafety, allowedPackages: ['$TMP'] };
    await expect(
      createRepo(http, safety, { package: 'ZBLOCKED', url: 'https://github.com/example/repo.git' }),
    ).rejects.toThrow(AdtSafetyError);
  });

  describe('enforceRepoPackageAllowed (R9 — pull/push gate the repo binding)', () => {
    it('is a no-op when no allowlist is configured', async () => {
      await expect(enforceRepoPackageAllowed(gitSafety, '$TUTORIALS', null, 'pull')).resolves.toBeUndefined();
    });

    it('allows a repo whose bound package is within the allowlist', async () => {
      const safety = { ...gitSafety, allowedPackages: ['$TUTORIALS'] };
      await expect(enforceRepoPackageAllowed(safety, '$TUTORIALS', null, 'pull')).resolves.toBeUndefined();
    });

    it('refuses a repo whose bound package is outside the allowlist', async () => {
      // $TUTORIALS is the binding of repos-v2 repo[0]; a pull would deserialize remote content into it.
      const safety = { ...gitSafety, allowedPackages: ['$TMP'] };
      await expect(enforceRepoPackageAllowed(safety, '$TUTORIALS', null, 'SAPGit(action="pull")')).rejects.toThrow(
        AdtSafetyError,
      );
    });

    it('fails closed when the allowlist is set but the bound package cannot be resolved', async () => {
      const safety = { ...gitSafety, allowedPackages: ['$TMP'] };
      await expect(enforceRepoPackageAllowed(safety, undefined, null, 'SAPGit(action="pull")')).rejects.toThrow(
        AdtSafetyError,
      );
      await expect(enforceRepoPackageAllowed(safety, '', null, 'SAPGit(action="pull")')).rejects.toThrow(
        AdtSafetyError,
      );
    });
  });

  it('createRepo sends Username + base64 Password headers and remote credentials in XML body', async () => {
    const http = mockHttp(loadFixture('abapgit-repos-v2.xml'));
    await createRepo(http, gitSafety, {
      package: '$TMP',
      url: 'https://github.com/example/repo.git',
      branchName: 'main',
      transportRequest: 'A4HK900123',
      user: 'git-user',
      password: 'git-pass',
    });

    const [, body, contentType, headers] = (http.post as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      string | undefined,
      Record<string, string>,
    ];
    expect(contentType).toBe('application/abapgit.adt.repo.v3+xml');
    expect(headers.Username).toBe('git-user');
    expect(headers.Password).toBe(Buffer.from('git-pass', 'utf-8').toString('base64'));
    expect(body).toContain('<abapgitrepo:remoteUser>git-user</abapgitrepo:remoteUser>');
    expect(body).toContain('<abapgitrepo:remotePassword>git-pass</abapgitrepo:remotePassword>');
  });

  it('pullRepo maps bridge XML errors to AdtApiError message with namespace', async () => {
    const http = mockHttp();
    (http.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AdtApiError(
        loadFixture('abapgit-error-bridge.xml'),
        404,
        '/sap/bc/adt/abapgit/repos/000000000001/pull',
        loadFixture('abapgit-error-bridge.xml'),
      ),
    );
    try {
      await pullRepo(http, gitSafety, '000000000001', { package: '$TMP' });
      expect.fail('Expected pullRepo to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AdtApiError);
      expect((err as Error).message).toContain('[org.abapgit.adt]');
      expect((err as Error).message).toContain('Repository not found in database');
    }
  });

  it('stageRepo throws descriptive error when repository has no stage link', async () => {
    const http = mockHttp(loadFixture('abapgit-staging.xml'));
    const repo = { ...firstRepo(), links: [] };
    await expect(stageRepo(http, gitSafety, repo)).rejects.toThrow(/does not expose a stage_link/);
  });

  it('stageRepo parses staging objects from HATEOAS stage endpoint', async () => {
    const http = mockHttp(loadFixture('abapgit-staging.xml'));
    const repo = firstRepo();
    const staging = await stageRepo(http, gitSafety, repo);
    expect(staging.repoKey).toBe(repo.key);
    expect(staging.objects).toHaveLength(2);
  });

  it('checkRepo translates empty body to {ok:true}', async () => {
    const http = mockHttp('');
    const repo = firstRepo();
    const result = await checkRepo(http, gitSafety, repo);
    expect(result).toEqual({ ok: true, message: null });
  });

  it('checkRepo normalises bridge-namespace 5xx into {ok:false,message} instead of throwing', async () => {
    const bridgeError = `<?xml version="1.0" encoding="utf-8"?><exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="org.abapgit.adt"/><type id=""/><message lang="EN">HTTP error 421 reaching remote</message><localizedMessage lang="EN">HTTP error 421 reaching remote</localizedMessage></exc:exception>`;
    const http = mockHttp('');
    (http.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AdtApiError(
        'HTTP error 421 reaching remote',
        500,
        '/sap/bc/adt/abapgit/repos/000000000001/checks',
        bridgeError,
      ),
    );
    const repo = firstRepo();
    const result = await checkRepo(http, gitSafety, repo);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('HTTP error 421');
  });

  it('checkRepo re-throws framework-namespace errors (e.g. 405/406) rather than swallowing', async () => {
    const frameworkError = `<?xml version="1.0" encoding="utf-8"?><exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionMethodNotSupported"/><message lang="EN">Method not supported</message><localizedMessage lang="EN">Method not supported</localizedMessage></exc:exception>`;
    const http = mockHttp('');
    (http.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AdtApiError('Method not supported', 405, '/sap/bc/adt/abapgit/repos/000000000001/checks', frameworkError),
    );
    const repo = firstRepo();
    await expect(checkRepo(http, gitSafety, repo)).rejects.toThrow(AdtApiError);
  });

  it('stageRepo resolves the correct link via rel when type attr is missing', async () => {
    const http = mockHttp(loadFixture('abapgit-staging.xml'));
    const repos = parseAbapGitRepos(loadFixture('abapgit-repos-v2.xml'));
    const repoWithoutTypes = repos[1]!; // /DMO/FLIGHT — all 4 links lack type attr
    const staging = await stageRepo(http, gitSafety, repoWithoutTypes);
    const [url] = (http.get as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('/sap/bc/adt/abapgit/repos/000000000006/stage');
    expect(staging.repoKey).toBe('000000000006');
  });

  it('pushRepo resolves push link by rel only (does not cross-match /checks)', async () => {
    const http = mockHttp('');
    const repos = parseAbapGitRepos(loadFixture('abapgit-repos-v2.xml'));
    const repoWithoutTypes = repos[1]!;
    await pushRepo(http, gitSafety, repoWithoutTypes, {
      repoKey: repoWithoutTypes.key,
      branchName: repoWithoutTypes.branchName,
      objects: [{ type: 'CLAS', name: 'Z' }],
    });
    const [url] = (http.post as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('/sap/bc/adt/abapgit/repos/000000000006/push');
    expect(url).not.toContain('/checks');
  });

  it('pushRepo posts serialized staging payload to push link', async () => {
    const http = mockHttp('');
    const repo = firstRepo();
    await pushRepo(http, gitSafety, repo, {
      repoKey: repo.key,
      branchName: repo.branchName,
      objects: [{ type: 'CLAS', name: 'ZCL_ARC1_TEST', operation: 'M' }],
    });
    const [url, body] = (http.post as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(url).toContain('/push');
    expect(body).toContain('abapgitrepo:objects');
    expect(body).toContain('type="CLAS"');
  });

  it('switchBranch sets ?create=false and createBranch sets ?create=true', async () => {
    const http = mockHttp();
    await switchBranch(http, gitSafety, '000000000001', 'feature/test', false);
    await createBranch(http, gitSafety, '000000000001', 'feature/new');
    const urls = (http.post as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toContain('/branches/feature%2Ftest?create=false');
    expect(urls[1]).toContain('/branches/feature%2Fnew?create=true');
  });

  it('unlinkRepo uses encoded repository key', async () => {
    const http = mockHttp();
    await unlinkRepo(http, gitSafety, 'repo with spaces');
    const [url] = (http.delete as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('/repos/repo%20with%20spaces');
  });
});
