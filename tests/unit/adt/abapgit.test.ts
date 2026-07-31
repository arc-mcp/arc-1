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
  parseAbapGitStaging,
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

  it('parseAbapGitObjects parses a clone/pull response incl. abapGit status messages', () => {
    const objects = parseAbapGitObjects(loadFixture('abapgit-objects.xml'));
    expect(objects).toHaveLength(2);
    expect(objects[0]).toMatchObject({ type: 'CLAS', name: 'ZCL_ARC1_TEST', package: '$TMP', status: 'Imported' });
    expect(objects[1]).toMatchObject({ msgType: 'E', msgText: 'Object could not be activated' });
  });

  it('parseAbapGitObjects also reads the pre-2020 v1 shape (namespace-less, obj_* fields)', () => {
    const objects = parseAbapGitObjects(loadFixture('abapgit-objects-v1.xml'));
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({
      type: 'CLAS',
      name: 'ZCL_ARC1_TEST',
      package: '$TMP',
      status: 'Imported',
      msgType: 'S',
    });
  });

  it('parsers accept a well-formed empty response but fail closed on an unrecognised 200 body', () => {
    // A correctly shaped "nothing happened" answer is a legitimate result, not a parse failure.
    expect(parseAbapGitObjects('<?xml version="1.0"?><abapObjects:abapObjects xmlns:abapObjects="x"/>')).toEqual([]);
    expect(
      parseAbapGitStaging('<?xml version="1.0"?><abapgitstaging:abapgitstaging xmlns:abapgitstaging="x"/>').objects,
    ).toEqual([]);

    // Anything else must raise rather than report "cloned nothing" / "nothing to push".
    expect(() => parseAbapGitObjects('')).toThrow(/unexpected clone\/pull response/);
    expect(() => parseAbapGitObjects('<html><body>Logon screen</body></html>')).toThrow(/no <abapObjects> root/);
    expect(() => parseAbapGitStaging('')).toThrow(/unexpected staging response/);
    expect(() => parseAbapGitStaging(loadFixture('abapgit-objects.xml'))).toThrow(/no <abapgitstaging> root/);
  });

  it('parseAbapGitStaging splits unstaged/ignored objects and reads the prefilled commit identity', () => {
    const staging = parseAbapGitStaging(loadFixture('abapgit-staging.xml'));
    expect(staging.objects).toHaveLength(2);
    expect(staging.objects[0]).toMatchObject({ name: 'ZCL_ARC1_TEST', type: 'CLAS/OC', wbkey: 'CLAS' });
    expect(staging.objects[0]?.files.map((file) => file.name)).toEqual([
      'zcl_arc1_test.clas.abap',
      'zcl_arc1_test.clas.xml',
    ]);
    expect(staging.objects[0]?.files[0]).toMatchObject({ path: '/src/', localState: 'M' });
    expect(staging.objects[1]?.files).toHaveLength(1);
    expect(staging.ignored).toHaveLength(1);
    expect(staging.comment?.committer).toEqual({ name: 'DEVELOPER', email: 'developer@example.com' });
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
    const http = mockHttp(loadFixture('abapgit-objects.xml'));
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
    expect(body).toContain('xmlns:abapgitrepo="http://www.sap.com/adt/abapgit/repositories"');
    expect(body).not.toContain('xmlns:abapgitrepo="http://www.sap.com/adt/abapgit/repository"');
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
    expect(staging.comment?.author?.name).toBe('DEVELOPER');
  });

  it('stageRepo forwards private-remote credentials as bridge headers', async () => {
    const http = mockHttp(loadFixture('abapgit-staging.xml'));
    await stageRepo(http, gitSafety, firstRepo(), 'git-user', 'git-pass');
    const [, headers] = (http.get as ReturnType<typeof vi.fn>).mock.calls[0] as [string, Record<string, string>];
    expect(headers.Username).toBe('git-user');
    expect(headers.Password).toBe(Buffer.from('git-pass', 'utf-8').toString('base64'));
  });

  it('checkRepo translates empty body to {ok:true}', async () => {
    const http = mockHttp('');
    const repo = firstRepo();
    const result = await checkRepo(http, gitSafety, repo);
    expect(result).toEqual({ ok: true, message: null });
  });

  it('checkRepo forwards private-remote credentials as bridge headers', async () => {
    const http = mockHttp('');
    await checkRepo(http, gitSafety, firstRepo(), 'git-user', 'git-pass');
    const [, , , headers] = (http.post as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      string | undefined,
      Record<string, string>,
    ];
    expect(headers.Username).toBe('git-user');
    expect(headers.Password).toBe(Buffer.from('git-pass', 'utf-8').toString('base64'));
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
      objects: [{ type: 'CLAS', name: 'Z', files: [] }],
    });
    const [url] = (http.post as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe('/sap/bc/adt/abapgit/repos/000000000006/push');
    expect(url).not.toContain('/checks');
  });

  it('pushRepo posts the staging payload shape the bridge deserializes (ZABAPGIT_ST_REPO_STAGE)', async () => {
    const http = mockHttp('');
    const repo = firstRepo();
    const staged = parseAbapGitStaging(loadFixture('abapgit-staging.xml'));
    await pushRepo(http, gitSafety, repo, {
      repoKey: repo.key,
      branchName: repo.branchName,
      objects: staged.objects.slice(0, 1),
      comment: { ...staged.comment, comment: 'arc-1 push' },
    });
    const [url, body] = (http.post as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(url).toContain('/push');
    expect(body).toContain(
      '<abapgitstaging:abapgitstaging xmlns:abapgitstaging="http://www.sap.com/adt/abapgit/staging"',
    );
    expect(body).not.toContain('abapgitrepo:objects');
    // Objects ride under staged_objects with adtcore refs + their files; the comment carries the identity.
    expect(body).toContain('<abapgitstaging:staged_objects>');
    expect(body).toContain('adtcore:name="ZCL_ARC1_TEST"');
    expect(body).toContain('adtcore:type="CLAS/OC"');
    expect(body).toContain('abapgitstaging:wbkey="CLAS"');
    expect(body).toContain('abapgitstaging:name="zcl_arc1_test.clas.abap"');
    expect(body).toContain('abapgitstaging:localState="M"');
    expect(body).toContain('abapgitstaging:comment="arc-1 push"');
    expect(body).toContain('<abapgitstaging:committer abapgitstaging:name="DEVELOPER"');
  });

  it('pushRepo emits an empty staged_objects element when nothing is selected', async () => {
    const http = mockHttp('');
    const repo = firstRepo();
    await pushRepo(http, gitSafety, repo, { repoKey: repo.key, objects: [], comment: { comment: 'empty' } });
    const [, body] = (http.post as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(body).toContain('<abapgitstaging:staged_objects/>');
  });

  it('pushRepo forwards private-remote credentials as bridge headers', async () => {
    const http = mockHttp('');
    const repo = firstRepo();
    await pushRepo(
      http,
      gitSafety,
      repo,
      { repoKey: repo.key, branchName: repo.branchName, objects: [], comment: { comment: 'c' } },
      'git-user',
      'git-pass',
    );
    const [, , , headers] = (http.post as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
      string | undefined,
      Record<string, string>,
    ];
    expect(headers.Username).toBe('git-user');
    expect(headers.Password).toBe(Buffer.from('git-pass', 'utf-8').toString('base64'));
  });

  it('switchBranch sets ?create=false and createBranch sets ?create=true', async () => {
    const http = mockHttp();
    await switchBranch(http, gitSafety, '000000000001', 'feature/test', false);
    await createBranch(http, gitSafety, '000000000001', 'feature/new');
    const urls = (http.post as ReturnType<typeof vi.fn>).mock.calls.map((call) => String(call[0]));
    expect(urls[0]).toContain('/branches/feature%2Ftest?create=false');
    expect(urls[1]).toContain('/branches/feature%2Fnew?create=true');
  });

  it('switchBranch/createBranch forward private-remote credentials (the bridge reads them too)', async () => {
    const http = mockHttp();
    await switchBranch(http, gitSafety, '000000000001', 'main', false, 'git-user', 'git-pass');
    await createBranch(http, gitSafety, '000000000001', 'feature/new', 'git-user', 'git-pass');
    const encoded = Buffer.from('git-pass', 'utf-8').toString('base64');
    for (const call of (http.post as ReturnType<typeof vi.fn>).mock.calls) {
      const headers = call[3] as Record<string, string>;
      expect(headers.Username).toBe('git-user');
      expect(headers.Password).toBe(encoded);
    }
  });

  it('createRepo and pullRepo accept the object media type the bridge renders (406 guard)', async () => {
    const http = mockHttp(loadFixture('abapgit-objects.xml'));
    const created = await createRepo(http, gitSafety, { package: '$TMP', url: 'https://github.com/example/repo.git' });
    await pullRepo(http, gitSafety, '000000000001', { package: '$TMP' });
    expect(created).toHaveLength(2);
    expect(created[0]?.name).toBe('ZCL_ARC1_TEST');
    for (const call of (http.post as ReturnType<typeof vi.fn>).mock.calls) {
      const headers = call[3] as Record<string, string>;
      // Both renderings of the response, current first. repo.v3 is the request type and never renders.
      expect(headers.Accept).toBe(
        'application/abapgit.adt.repo.object.v2+xml, application/abapgit.adt.repo.object.v1+xml',
      );
    }
  });

  it('unlinkRepo uses encoded repository key', async () => {
    const http = mockHttp();
    await unlinkRepo(http, gitSafety, 'repo with spaces');
    const [url] = (http.delete as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain('/repos/repo%20with%20spaces');
  });
});
