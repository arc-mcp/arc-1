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
  redactGitUrl,
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
  it('redacts encoded query and fragment credentials from Git URLs', () => {
    const sentinel = 'abapgit-url-sentinel';
    const redacted = redactGitUrl(
      `https://example.com/repo.git;token=${sentinel}` +
        `?ref=main;to%6ben=${sentinel}&token:${sentinel}&jsessionid=${sentinel}` +
        `&cookie=${sentinel}#access_token=${sentinel}`,
    );
    expect(redacted).toContain('ref=main');
    expect(redacted).not.toContain(sentinel);
  });

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

  it('repository and external-info reads fail closed on unknown or incomplete 200 XML', () => {
    expect(() => parseAbapGitRepos('<html><body>Logon</body></html>')).toThrow(/no <repositories> root/);
    expect(() =>
      parseAbapGitRepos('<repositories><repository><key>1</key><package>$TMP</package></repository></repositories>'),
    ).toThrow(/incomplete <repository> row/);
    expect(() => parseAbapGitExternalInfo('<html><body>Logon</body></html>')).toThrow(/no <externalRepoInfo> root/);
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

    // A present expected root is empty only when the element is actually empty. Scalar error text
    // must not become a false-green empty result.
    expect(() => parseAbapGitRepos('<repositories>ERROR</repositories>')).toThrow(/unexpected repository-list/);
    expect(() => parseAbapGitExternalInfo('<externalRepoInfo>ERROR</externalRepoInfo>')).toThrow(
      /unexpected external-info/,
    );
    expect(() => parseAbapGitObjects('<abapObjects>ERROR</abapObjects>')).toThrow(/unexpected clone\/pull/);
    expect(() => parseAbapGitStaging('<abapgitstaging>ERROR</abapgitstaging>')).toThrow(/unexpected staging/);
    expect(() => parseAbapGitRepos('<repositories><repository>ERROR</repository></repositories>')).toThrow(
      /invalid <repository>/,
    );
    expect(() => parseAbapGitExternalInfo('<externalRepoInfo><branch>ERROR</branch></externalRepoInfo>')).toThrow(
      /invalid <branch>/,
    );
    expect(() =>
      parseAbapGitExternalInfo(
        '<externalRepoInfo accessMode="PUBLIC"><branch><foo>x</foo></branch></externalRepoInfo>',
      ),
    ).toThrow(/incomplete external branch row/);
    expect(() =>
      parseAbapGitObjects('<abapObjects><abapObject>ERROR</abapObject><abapObject>ERROR2</abapObject></abapObjects>'),
    ).toThrow(/invalid <abapObject>/);
    expect(() =>
      parseAbapGitStaging('<abapgitstaging><unstaged_objects>ERROR</unstaged_objects></abapgitstaging>'),
    ).toThrow(/invalid <unstaged_objects>/);
    expect(() => parseAbapGitExternalInfo('<externalRepoInfo/>')).toThrow(/incomplete <externalRepoInfo>/);
    expect(() => parseAbapGitObjects('<abapObjects><abapObject><foo>x</foo></abapObject></abapObjects>')).toThrow(
      /incomplete object row/,
    );
    expect(() =>
      parseAbapGitStaging(
        '<abapgitstaging><unstaged_objects><abapgitobject><foo>x</foo></abapgitobject></unstaged_objects></abapgitstaging>',
      ),
    ).toThrow(/incomplete staging object row/);
    expect(() =>
      parseAbapGitStaging(
        '<abapgitstaging><unstaged_objects><abapgitobject name="Z" type="CLAS"><abapgitfile name="x"/></abapgitobject></unstaged_objects></abapgitstaging>',
      ),
    ).toThrow(/incomplete staging file row/);
    expect(() => parseAbapGitRepos('<repositories><error>FAILED</error></repositories>')).toThrow(
      /unexpected child elements/,
    );
    expect(() => parseAbapGitStaging('<abapgitstaging><error>FAILED</error></abapgitstaging>')).toThrow(
      /unexpected child elements/,
    );
    expect(() =>
      parseAbapGitStaging(
        '<abapgitstaging><unstaged_objects><error>FAILED</error></unstaged_objects></abapgitstaging>',
      ),
    ).toThrow(/unexpected child elements/);
    expect(() =>
      parseAbapGitStaging(
        '<abapgitstaging><unstaged_objects><dummy>x</dummy></unstaged_objects><unstaged_objects><abapgitobject name="Z" type="CLAS"/></unstaged_objects></abapgitstaging>',
      ),
    ).toThrow(/duplicate <unstaged_objects>/);
    expect(() => parseAbapGitRepos('<repositories><repository/></repositories>')).toThrow(/invalid <repository>/);
    expect(() => parseAbapGitObjects('<abapObjects><abapObject/></abapObjects>')).toThrow(/invalid <abapObject>/);
    expect(() =>
      parseAbapGitStaging('<abapgitstaging><unstaged_objects><abapgitobject/></unstaged_objects></abapgitstaging>'),
    ).toThrow(/invalid <abapgitobject>/);
  });

  it('does not expose malformed XML response prefixes in parser errors', async () => {
    const sentinel = 'abapgit-invalid-xml-sentinel';
    const http = mockHttp(`<repositories><repository remotePassword="${sentinel}"`);
    try {
      await listRepos(http, gitSafety);
      expect.fail('Expected malformed abapGit XML to throw');
    } catch (err) {
      expect(String(err)).toContain('abapGit bridge returned invalid XML');
      expect(String(err)).not.toContain(sentinel);
      expect(String(err)).not.toContain('<repositories>');
    }
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

  it('getExternalInfo requires the Git write/egress ceiling and rejects unsafe literal targets', async () => {
    const noWrites = { ...gitSafety, allowWrites: false };
    const noGit = { ...gitSafety, allowGitWrites: false };
    await expect(getExternalInfo(mockHttp(), noWrites, 'https://example.com/repo.git')).rejects.toThrow(
      /allowWrites=false/,
    );
    await expect(getExternalInfo(mockHttp(), noGit, 'https://example.com/repo.git')).rejects.toThrow(
      /allowGitWrites=false/,
    );
    await expect(getExternalInfo(mockHttp(), gitSafety, 'http://example.com/repo.git')).rejects.toThrow(/only HTTPS/);
    await expect(getExternalInfo(mockHttp(), gitSafety, 'https://user:secret@example.com/repo.git')).rejects.toThrow(
      /userinfo/,
    );
    for (const url of [
      'https://localhost/repo.git',
      'https://localhost./repo.git',
      'https://foo.localhost./repo.git',
      'https://127.0.0.1/repo.git',
      'https://[::1]/repo.git',
      'https://[::ffff:127.0.0.1]/repo.git',
      'https://[::ffff:10.0.0.1]/repo.git',
    ]) {
      await expect(getExternalInfo(mockHttp(), gitSafety, url)).rejects.toThrow(/private|localhost/);
    }
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

    it('allows only an explicit whole-subtree grant or global *', async () => {
      const safety = { ...gitSafety, allowedPackages: ['$TUTORIALS/**'] };
      await expect(enforceRepoPackageAllowed(safety, '$TUTORIALS', null, 'pull')).resolves.toBeUndefined();
      await expect(
        enforceRepoPackageAllowed({ ...gitSafety, allowedPackages: ['*'] }, '$TUTORIALS', null, 'pull'),
      ).resolves.toBeUndefined();
    });

    it('allows a repository package covered by an ancestor subtree grant', async () => {
      const resolver = {
        isDescendantOrSelf: vi.fn().mockResolvedValue(true),
        invalidate: vi.fn(),
      };
      const safety = { ...gitSafety, allowedPackages: ['ZROOT/**'] };
      await expect(enforceRepoPackageAllowed(safety, 'ZROOT_CHILD', resolver, 'pull')).resolves.toBeUndefined();
      expect(resolver.isDescendantOrSelf).toHaveBeenCalledWith('ZROOT', 'ZROOT_CHILD');
    });

    it('refuses exact-root and broad prefix grants because neither proves descendant closure', async () => {
      for (const allowedPackages of [['$TUTORIALS'], ['$*'], ['Z*']]) {
        const safety = { ...gitSafety, allowedPackages };
        await expect(enforceRepoPackageAllowed(safety, '$TUTORIALS', null, 'SAPGit(action="pull")')).rejects.toThrow(
          /whole|subpackages|subtree/,
        );
      }
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
    const http = mockHttp(loadFixture('abapgit-objects-v1.xml'));
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

  it('createRepo and pullRepo reject E/A/X bridge object messages', async () => {
    const http = mockHttp(loadFixture('abapgit-objects.xml'));
    await expect(
      createRepo(http, gitSafety, { package: '$TMP', url: 'https://github.com/example/repo.git' }),
    ).rejects.toThrow(/rejecting object messages/);
    await expect(pullRepo(http, gitSafety, '000000000001')).rejects.toThrow(/rejecting object messages/);
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

  it('redacts credential assignments and URL secrets from bridge errors and response bodies', async () => {
    const http = mockHttp();
    const bearer = 'abapgit-bearer-sentinel';
    const basic = 'abapgit-basic-sentinel';
    const escapedUrl = 'abapgit-escaped-url-sentinel';
    const pathSentinel = 'abapgit-error-path-sentinel';
    const assignmentSentinel = 'abapgit-assignment-sentinel';
    const attributeSentinel = 'abapgit-attribute-sentinel';
    const cookieSentinel = 'abapgit-cookie-sentinel';
    const standaloneSentinel = 'abapgit-standalone-sentinel';
    const unicodeKeySentinel = 'abapgit-unicode-key-sentinel';
    const body =
      `<?xml version="1.0"?><exc:exception xmlns:exc="x"><namespace id="org.abapgit.adt"/><detail remotePassword="${attributeSentinel}"/><message>` +
      `Remote Authorization: Bearer ${bearer}; Authorization=Basic \\"${basic}\\"; ` +
      `Cookie: SAP_SESSIONID_A4H_001=${cookieSentinel}; Set-Cookie: JSESSIONID=${cookieSentinel}; ` +
      `Basic ${standaloneSentinel}; ` +
      `{\\"to\\u006ben\\":\\"${unicodeKeySentinel}\\"}; ` +
      `CLIENT_VCS_AUTH_TOKEN=${assignmentSentinel}; pwd=plain-error-sentinel ` +
      `https:\\/\\/user:${escapedUrl}@example.com/r?auth=query-sentinel` +
      '</message></exc:exception>';
    (http.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AdtApiError('remote failed', 500, `/sap/bc/adt/abapgit/repos/R/pull?token=${pathSentinel}`, body),
    );

    try {
      await pullRepo(http, gitSafety, 'R');
      expect.fail('Expected pullRepo to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AdtApiError);
      expect((err as Error).message).not.toContain('plain-error-sentinel');
      expect((err as Error).message).not.toContain('url-sentinel');
      expect((err as Error).message).not.toContain('query-sentinel');
      expect((err as AdtApiError).responseBody).not.toContain('plain-error-sentinel');
      expect((err as Error).message).not.toContain(bearer);
      expect((err as Error).message).not.toContain(basic);
      expect((err as Error).message).not.toContain(escapedUrl);
      expect((err as Error).message).not.toContain(pathSentinel);
      expect((err as AdtApiError).path).not.toContain(pathSentinel);
      expect((err as Error).message).not.toContain(assignmentSentinel);
      expect((err as Error).message).not.toContain(cookieSentinel);
      expect((err as Error).message).not.toContain(standaloneSentinel);
      expect((err as Error).message).not.toContain(unicodeKeySentinel);
      expect((err as AdtApiError).responseBody).not.toContain(bearer);
      expect((err as AdtApiError).responseBody).not.toContain(basic);
      expect((err as AdtApiError).responseBody).not.toContain(escapedUrl);
      expect((err as AdtApiError).responseBody).not.toContain(assignmentSentinel);
      expect((err as AdtApiError).responseBody).not.toContain(attributeSentinel);
      expect((err as AdtApiError).responseBody).not.toContain(cookieSentinel);
      expect((err as AdtApiError).responseBody).not.toContain(standaloneSentinel);
      expect((err as AdtApiError).responseBody).not.toContain(unicodeKeySentinel);
      expect((err as AdtApiError).responseBody).not.toContain('query-sentinel');
    }
  });

  it('redacts then bounds oversized credential-bearing bridge error URLs', async () => {
    const sentinel = 'abapgit-long-url-sentinel';
    const body =
      '<?xml version="1.0"?><exc:exception xmlns:exc="x"><namespace id="org.abapgit.adt"/><message>' +
      `Remote failed https://git-user:${sentinel}@example.com/${'A'.repeat(60_000)}?token=${sentinel}` +
      '</message></exc:exception>';
    const http = mockHttp();
    (http.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AdtApiError(body.slice(0, 500), 500, '/sap/bc/adt/abapgit/repos/R/pull', body),
    );

    try {
      await pullRepo(http, gitSafety, 'R');
      expect.fail('Expected pullRepo to throw');
    } catch (err) {
      expect(String(err)).not.toContain(sentinel);
      expect((err as AdtApiError).responseBody).not.toContain(sentinel);
      expect((err as AdtApiError).responseBody!.length).toBeLessThan(4_096);
      expect((err as AdtApiError).responseBody).toContain('[truncated');
    }
  });

  it('stageRepo throws descriptive error when repository has no stage link', async () => {
    const http = mockHttp(loadFixture('abapgit-staging.xml'));
    const repo = { ...firstRepo(), links: [] };
    await expect(stageRepo(http, gitSafety, repo)).rejects.toThrow(/does not expose a stage_link/);

    const sentinel = 'abapgit-repo-key-sentinel';
    try {
      await stageRepo(http, gitSafety, { ...repo, key: `Authorization: Bearer ${sentinel}` });
      expect.fail('Expected missing stage link to throw');
    } catch (err) {
      expect(String(err)).not.toContain(sentinel);
    }
  });

  it.each([
    '/sap/bc/adt/abapgit/../admin/trigger',
    '/sap/bc/adt/abapgit/repos/1/%2e%2e/admin/trigger',
    '/sap/bc/adt/abapgitEVIL/repos/1/stage',
  ])('rejects a non-canonical SAP-provided HATEOAS link: %s', async (href) => {
    const http = mockHttp(loadFixture('abapgit-staging.xml'));
    const repo = {
      ...firstRepo(),
      links: [{ rel: 'http://www.sap.com/adt/relations/abapgit/stage', href, type: 'stage_link' }],
    };

    await expect(stageRepo(http, gitSafety, repo)).rejects.toThrow(/canonical host-relative ADT path/i);
    expect(http.get).not.toHaveBeenCalled();
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

  it('pushRepo rejects an unexpected non-empty 2xx body without exposing it', async () => {
    const sentinel = 'abapgit-push-body-sentinel';
    const http = mockHttp(`<error remotePassword="${sentinel}">accepted-but-incomplete</error>`);
    const repo = firstRepo();
    try {
      await pushRepo(http, gitSafety, repo, {
        repoKey: repo.key,
        objects: [{ type: 'CLAS', name: 'Z', files: [] }],
        comment: { comment: 'test' },
      });
      expect.fail('Expected unexpected push response to throw');
    } catch (err) {
      expect(String(err)).toContain('unexpected non-empty push response');
      expect(String(err)).not.toContain(sentinel);
    }
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

  it('switchBranch/createBranch reject unexpected non-empty 2xx bodies without exposing them', async () => {
    const sentinel = 'abapgit-branch-body-sentinel';
    const http = mockHttp(`<error remotePassword="${sentinel}">accepted-but-incomplete</error>`);
    await expect(switchBranch(http, gitSafety, '000000000001', 'main')).rejects.toThrow(
      /unexpected non-empty switch-branch response/,
    );
    await expect(createBranch(http, gitSafety, '000000000001', 'feature/new')).rejects.toThrow(
      /unexpected non-empty create-branch response/,
    );
    for (const operation of [
      switchBranch(mockHttp(`<error>${sentinel}</error>`), gitSafety, 'R', 'main'),
      createBranch(mockHttp(`<error>${sentinel}</error>`), gitSafety, 'R', 'feature/new'),
    ]) {
      try {
        await operation;
      } catch (err) {
        expect(String(err)).not.toContain(sentinel);
      }
    }
  });

  it('createRepo and pullRepo accept the object media type the bridge renders (406 guard)', async () => {
    const http = mockHttp(loadFixture('abapgit-objects-v1.xml'));
    const created = await createRepo(http, gitSafety, { package: '$TMP', url: 'https://github.com/example/repo.git' });
    await pullRepo(http, gitSafety, '000000000001', { package: '$TMP' });
    expect(created).toHaveLength(1);
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

  it('unlinkRepo rejects an unexpected non-empty 2xx body without exposing it', async () => {
    const sentinel = 'abapgit-unlink-body-sentinel';
    const http = mockHttp();
    (http.delete as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      statusCode: 200,
      headers: {},
      body: `<error remotePassword="${sentinel}">accepted-but-incomplete</error>`,
    });
    try {
      await unlinkRepo(http, gitSafety, 'R');
      expect.fail('Expected unexpected unlink response to throw');
    } catch (err) {
      expect(String(err)).toContain('unexpected non-empty unlink response');
      expect(String(err)).not.toContain(sentinel);
    }
  });
});
