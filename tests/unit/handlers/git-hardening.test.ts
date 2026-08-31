import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { resetCachedFeatures, setCachedFeatures } from '../../../src/handlers/feature-cache.js';
import { handleSAPGit } from '../../../src/handlers/git.js';
import { featuresOff } from './handler-test-config.js';

const EMPTY_OBJECTS =
  '<?xml version="1.0"?><abapObjects:abapObjects xmlns:abapObjects="http://www.sap.com/adt/abapgit/objects"/>';
const SUCCESS_OBJECTS = `<?xml version="1.0"?>
<abapObjects:abapObjects xmlns:abapObjects="http://www.sap.com/adt/abapgit/objects">
  <abapObjects:abapObject>
    <abapObjects:type>CLAS</abapObjects:type>
    <abapObjects:name>ZCL_TEST</abapObjects:name>
    <abapObjects:package>$TMP</abapObjects:package>
    <abapObjects:msgType>S</abapObjects:msgType>
    <abapObjects:msgText>Imported</abapObjects:msgText>
  </abapObjects:abapObject>
</abapObjects:abapObjects>`;
const REPOS = `<?xml version="1.0"?>
<abapgitrepo:repositories xmlns:abapgitrepo="http://www.sap.com/adt/abapgit/repositories" xmlns:atom="http://www.w3.org/2005/Atom">
  <abapgitrepo:repository>
    <abapgitrepo:key>000000000001</abapgitrepo:key>
    <abapgitrepo:package>$TMP</abapgitrepo:package>
    <abapgitrepo:url>https://user:output-secret@example.com/repo.git?token=query-secret</abapgitrepo:url>
    <abapgitrepo:branchName>main</abapgitrepo:branchName>
    <atom:link href="/sap/bc/adt/abapgit/repos/000000000001/stage" rel="http://www.sap.com/adt/abapgit/relations/stage" type="stage_link"/>
    <atom:link href="/sap/bc/adt/abapgit/repos/000000000001/push" rel="http://www.sap.com/adt/abapgit/relations/push" type="push_link"/>
  </abapgitrepo:repository>
</abapgitrepo:repositories>`;
const EMPTY_REPOS =
  '<?xml version="1.0"?><abapgitrepo:repositories xmlns:abapgitrepo="http://www.sap.com/adt/abapgit/repositories"/>';
const STAGING = `<?xml version="1.0"?>
<abapgitstaging:abapgitstaging xmlns:abapgitstaging="http://www.sap.com/adt/abapgit/staging" xmlns:adtcore="http://www.sap.com/adt/core">
  <abapgitstaging:unstaged_objects>
    <abapgitstaging:abapgitobject adtcore:name="ZCL_TEST" adtcore:type="CLAS/OC" adtcore:uri="/sap/bc/adt/oo/classes/zcl_test" abapgitstaging:wbkey="CLAS">
      <abapgitstaging:abapgitfile abapgitstaging:name="zcl_test.clas.abap" abapgitstaging:path="/src/" abapgitstaging:localState="M"/>
    </abapgitstaging:abapgitobject>
  </abapgitstaging:unstaged_objects>
</abapgitstaging:abapgitstaging>`;

function response(body: string) {
  return { statusCode: 200, headers: {}, body };
}

function client(body: string, allowedPackages: string[] = []): { client: AdtClient; http: AdtHttpClient } {
  const http = {
    get: vi.fn().mockResolvedValue(response(REPOS)),
    post: vi.fn().mockResolvedValue(response(body)),
    put: vi.fn().mockResolvedValue(response('')),
    delete: vi.fn().mockResolvedValue(response('')),
    fetchCsrfToken: vi.fn(),
    withStatefulSession: vi.fn(),
  } as unknown as AdtHttpClient;
  const fake = {
    http,
    safety: { ...unrestrictedSafetyConfig(), allowedPackages },
    getPackageHierarchyResolver: () => null,
  } as unknown as AdtClient;
  return { client: fake, http };
}

describe('SAPGit hardening', () => {
  afterEach(() => resetCachedFeatures());

  it('quarantines every gCTS mutation before HTTP even with legacy unrestricted packages', async () => {
    setCachedFeatures(featuresOff({ gcts: true }));
    for (const allowedPackages of [[], ['*']]) {
      for (const args of [
        { action: 'clone', backend: 'gcts', url: 'https://example.com/repo.git' },
        { action: 'pull', backend: 'gcts', repoId: 'R' },
        { action: 'switch_branch', backend: 'gcts', repoId: 'R', branch: 'main' },
        { action: 'create_branch', backend: 'gcts', repoId: 'R', branch: 'feature' },
        { action: 'unlink', backend: 'gcts', repoId: 'R' },
      ]) {
        const fixture = client('{}', allowedPackages);
        await expect(handleSAPGit(fixture.client, args)).rejects.toThrow(/VCS_NO_IMPORT/);
        expect(fixture.http.get).not.toHaveBeenCalled();
        expect(fixture.http.post).not.toHaveBeenCalled();
        expect(fixture.http.put).not.toHaveBeenCalled();
        expect(fixture.http.delete).not.toHaveBeenCalled();
      }
    }
  });

  it('returns an incomplete ToolResult for an empty clone wrapper and redacts repository credentials', async () => {
    setCachedFeatures(featuresOff({ abapGit: true }));
    const fixture = client(EMPTY_OBJECTS);
    const result = await handleSAPGit(fixture.client, {
      action: 'clone',
      backend: 'abapgit',
      package: '$TMP',
      url: 'https://example.com/repo.git?token=input-secret',
    });
    expect(result.isError).toBe(true);
    const text = result.content[0]!.text;
    expect(text).toContain('"outcome":"incomplete"');
    expect(text).toContain('"verified":false');
    expect(text).not.toContain('output-secret');
    expect(text).not.toContain('query-secret');
    expect(text).not.toContain('input-secret');
  });

  it('returns an incomplete ToolResult for an empty pull wrapper with modest readback evidence', async () => {
    setCachedFeatures(featuresOff({ abapGit: true }));
    const fixture = client(EMPTY_OBJECTS);
    const result = await handleSAPGit(fixture.client, {
      action: 'pull',
      backend: 'abapgit',
      repoId: '000000000001',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('linkage/readback does not prove');
    expect(result.content[0]!.text).toContain('"repository"');
  });

  it('labels non-empty S/W bridge rows as unverified evidence rather than complete import proof', async () => {
    setCachedFeatures(featuresOff({ abapGit: true }));
    const fixture = client(SUCCESS_OBJECTS);
    const result = await handleSAPGit(fixture.client, {
      action: 'pull',
      backend: 'abapgit',
      repoId: '000000000001',
    });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain('"outcome":"bridge_evidence"');
    expect(result.content[0]!.text).toContain('"verified":false');
  });

  it('requires ROOT/** or * for abapGit mutations and rejects exact/broad package grants', async () => {
    setCachedFeatures(featuresOff({ abapGit: true }));
    for (const allowedPackages of [['$TMP'], ['$*']]) {
      const fixture = client(SUCCESS_OBJECTS, allowedPackages);
      await expect(
        handleSAPGit(fixture.client, {
          action: 'pull',
          backend: 'abapgit',
          repoId: '000000000001',
        }),
      ).rejects.toThrow(/subtree grant|subpackages/);
      expect(fixture.http.post).not.toHaveBeenCalled();
    }

    const allowed = client(SUCCESS_OBJECTS, ['$TMP/**']);
    const result = await handleSAPGit(allowed.client, {
      action: 'pull',
      backend: 'abapgit',
      repoId: '000000000001',
    });
    expect(result.isError).toBeUndefined();
  });

  it('applies the whole-subtree gate at every abapGit mutation sink before mutation HTTP', async () => {
    setCachedFeatures(featuresOff({ abapGit: true }));
    const actions = [
      { action: 'clone', backend: 'abapgit', package: '$TMP', url: 'https://example.com/repo.git' },
      { action: 'pull', backend: 'abapgit', repoId: '000000000001' },
      { action: 'push', backend: 'abapgit', repoId: '000000000001', message: 'test' },
      { action: 'switch_branch', backend: 'abapgit', repoId: '000000000001', branch: 'main' },
      { action: 'create_branch', backend: 'abapgit', repoId: '000000000001', branch: 'feature' },
      { action: 'unlink', backend: 'abapgit', repoId: '000000000001' },
    ];

    for (const args of actions) {
      const fixture = client(SUCCESS_OBJECTS, ['$TMP']);
      await expect(handleSAPGit(fixture.client, args)).rejects.toThrow(/subtree grant|subpackages/);
      expect(fixture.http.post).not.toHaveBeenCalled();
      expect(fixture.http.put).not.toHaveBeenCalled();
      expect(fixture.http.delete).not.toHaveBeenCalled();
      expect(fixture.http.get).toHaveBeenCalledTimes(args.action === 'clone' ? 0 : 1);
    }
  });

  it('redacts gCTS config key/value secrets in legacy read payloads', async () => {
    setCachedFeatures(featuresOff({ gcts: true }));
    const fixture = client('{}');
    (fixture.http.get as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      response(
        '{"config":[{"key":"CLIENT_VCS_AUTH_PWD","value":"config-secret"},{"key":"CLIENT_VCS_URI","value":"https://user:url-secret@example.com/r?token=query-secret","Authorization":"opaque-authorization-secret"}]}',
      ),
    );
    const result = await handleSAPGit(fixture.client, { action: 'config', backend: 'gcts' });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).not.toContain('config-secret');
    expect(result.content[0]!.text).not.toContain('url-secret');
    expect(result.content[0]!.text).not.toContain('query-secret');
    expect(result.content[0]!.text).not.toContain('opaque-authorization-secret');
  });

  it('returns push acceptance as incomplete/error when remote completion cannot be verified', async () => {
    setCachedFeatures(featuresOff({ abapGit: true }));
    const fixture = client('', ['$TMP/**']);
    (fixture.http.get as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValueOnce(response(REPOS))
      .mockResolvedValueOnce(response(STAGING));
    const result = await handleSAPGit(fixture.client, {
      action: 'push',
      backend: 'abapgit',
      repoId: '000000000001',
      message: 'test',
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('"outcome":"incomplete"');
    expect(result.content[0]!.text).toContain('"accepted":true');
    expect(result.content[0]!.text).toContain('"verified":false');
    expect(result.content[0]!.text).toContain('Do not retry blindly');
  });

  it.each(['switch_branch', 'create_branch'])(
    '%s acceptance is incomplete/error without object proof',
    async (action) => {
      setCachedFeatures(featuresOff({ abapGit: true }));
      const fixture = client('', ['$TMP/**']);
      const result = await handleSAPGit(fixture.client, {
        action,
        backend: 'abapgit',
        repoId: '000000000001',
        branch: 'feature',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('"outcome":"incomplete"');
      expect(result.content[0]!.text).toContain('"verified":false');
    },
  );

  it('verifies unlink by absence and fails closed on mismatch or readback uncertainty', async () => {
    setCachedFeatures(featuresOff({ abapGit: true }));

    const verified = client('', ['$TMP/**']);
    (verified.http.get as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValueOnce(response(REPOS))
      .mockResolvedValueOnce(response(EMPTY_REPOS));
    const verifiedResult = await handleSAPGit(verified.client, {
      action: 'unlink',
      backend: 'abapgit',
      repoId: '000000000001',
    });
    expect(verifiedResult.isError).toBeUndefined();
    expect(verifiedResult.content[0]!.text).toContain('"verified":true');

    const mismatch = client('', ['$TMP/**']);
    const mismatchResult = await handleSAPGit(mismatch.client, {
      action: 'unlink',
      backend: 'abapgit',
      repoId: '000000000001',
    });
    expect(mismatchResult.isError).toBe(true);
    expect(mismatchResult.content[0]!.text).toContain('still present');

    const uncertain = client('', ['$TMP/**']);
    (uncertain.http.get as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValueOnce(response(REPOS))
      .mockRejectedValueOnce(new Error('readback unavailable'));
    const uncertainResult = await handleSAPGit(uncertain.client, {
      action: 'unlink',
      backend: 'abapgit',
      repoId: '000000000001',
    });
    expect(uncertainResult.isError).toBe(true);
    expect(uncertainResult.content[0]!.text).toContain('readback failed');
  });
});
