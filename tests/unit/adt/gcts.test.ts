import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtSafetyError } from '../../../src/adt/errors.js';
import {
  enforceGctsMutationQuarantine,
  GCTS_QUARANTINED_MUTATIONS,
  getCommitHistory,
  getConfig,
  getSystemInfo,
  getTransportHistory,
  getUserInfo,
  listBranches,
  listRepoObjects,
  listRepos,
  redactGctsValue,
} from '../../../src/adt/gcts.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { getActionPolicy } from '../../../src/authz/policy.js';

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

  it('parses and redacts the live {config:[...]} payload', async () => {
    const http = mockHttp(loadFixture('gcts-config.json'));
    const result = await getConfig(http, gitSafety);
    expect(result.length).toBeGreaterThan(0);
    expect(result.some((entry) => entry.ckey === 'CLIENT_VCS_URI')).toBe(true);
    expect(result.find((entry) => entry.ckey === 'CLIENT_VCS_AUTH_USER')?.example).toBe('[REDACTED]');
    expect(result.find((entry) => entry.ckey === 'CLIENT_VCS_AUTH_PWD')?.example).toBe('[REDACTED]');
    expect(JSON.stringify(result)).not.toContain('sentinel-password');
  });

  it('redacts malformed URL assignments, encoded query keys, and fragment credentials', () => {
    const sentinel = 'gcts-redaction-sentinel';
    const result = redactGctsValue({
      url: `token=${sentinel}`,
      remoteUrl:
        `https://example.com/repo;token=${sentinel}` +
        `?ref=main;to%6ben=${sentinel}&token:${sentinel}&sessionid=${sentinel}` +
        `&cookie=${sentinel}#access_token=${sentinel}`,
      config: [{ ckey: 'CLIENT_VCS_AUTH_TOKEN', example: sentinel }],
    });
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(result.remoteUrl).toContain('ref=main');
    expect(result.config[0]?.example).toBe('[REDACTED]');
  });

  it('bounds recursive response redaction before deeply nested JSON can overflow the stack', () => {
    let nested: unknown = 'leaf';
    for (let index = 0; index < 2_000; index += 1) nested = { nested };
    expect(JSON.stringify(redactGctsValue(nested))).toContain('redaction budget exceeded');
  });

  it('preserves ordinary wide list responses while redacting every entry', () => {
    const branches = Array.from({ length: 300 }, (_, index) => ({
      name: `branch-${index}`,
      url: `https://user:secret-${index}@example.com/repo.git?token=secret-${index}`,
    }));
    const result = redactGctsValue({ branches });
    expect(result.branches).toHaveLength(branches.length);
    expect(JSON.stringify(result)).not.toContain('secret-');
    expect(JSON.stringify(result)).not.toContain('redaction budget exceeded');
  });

  it('redacts then bounds oversized Git URL values', () => {
    const sentinel = 'gcts-long-url-sentinel';
    const result = redactGctsValue({
      url: `https://git-user:${sentinel}@example.com/${'A'.repeat(60_000)}?token=${sentinel}`,
    });
    expect(result.url).not.toContain(sentinel);
    expect(result.url).toContain('[truncated');
    expect(result.url.length).toBeLessThan(4_096);
  });

  it('sanitizes, bounds, and collision-safely preserves attacker-controlled response keys', () => {
    const first = 'gcts-key-first-sentinel';
    const second = 'gcts-key-second-sentinel';
    const nested = 'gcts-key-nested-sentinel';
    const dynamic = 'gcts-dynamic-key-sentinel';
    const authorization = 'gcts-opaque-authorization-sentinel';
    const escapedLabelSentinel = 'Q7z9!';
    const result = redactGctsValue({
      Authorization: authorization,
      [`Authorization: Bearer ${first}`]: 1,
      [`https://git-user:${first}@example.com`]: 2,
      [`https://git-user:${second}@example.com`]: 3,
      [`field-${'K'.repeat(60_000)}`]: 4,
      [`password_${dynamic}`]: true,
      [`passw\\u006frd_${escapedLabelSentinel}`]: true,
      rows: [
        {
          [`CLIENT_VCS_AUTH_TOKEN=${nested}`]: true,
          [`CLIENT_VCS_AUTH_TOKEN_${dynamic}`]: true,
          [`to\\u006ben_${escapedLabelSentinel}`]: true,
        },
      ],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(first);
    expect(serialized).not.toContain(second);
    expect(serialized).not.toContain(nested);
    expect(serialized).not.toContain(dynamic);
    expect(serialized).not.toContain(authorization);
    expect(serialized).not.toContain(escapedLabelSentinel);
    expect(Object.keys(result).every((key) => key.length <= 4_096)).toBe(true);
    expect(Object.values(result)).toEqual(expect.arrayContaining(['[REDACTED]', 2, 3, 4]));
  });

  it('does not include an invalid JSON response prefix in the surfaced error', async () => {
    const sentinel = 'SUPER_SECRET_INVALID_JSON';
    try {
      await getConfig(mockHttp(sentinel), gitSafety);
      expect.fail('Expected invalid gCTS JSON to throw');
    } catch (err) {
      expect(String(err)).toContain('gCTS returned invalid JSON');
      expect(String(err)).not.toContain(sentinel);
      expect(String(err)).not.toContain(sentinel.slice(0, 10));
    }
  });

  it('rejects unknown non-empty read wrappers instead of returning a false-green []', async () => {
    await expect(getSystemInfo(mockHttp('{"result":[]}'), gitSafety)).rejects.toThrow(/expected \{result/);
    await expect(getUserInfo(mockHttp('{"user":[]}'), gitSafety)).rejects.toThrow(/expected \{user/);
    await expect(getConfig(mockHttp('{"result":[]}'), gitSafety)).rejects.toThrow(/expected \{config/);
    await expect(listBranches(mockHttp('{"result":[]}'), gitSafety, 'ZARC1')).rejects.toThrow(/expected \{branches/);
    await expect(getCommitHistory(mockHttp('{"result":[]}'), gitSafety, 'ZARC1')).rejects.toThrow(/expected \{commits/);
    await expect(listRepos(mockHttp('{"mystery":[]}'), gitSafety)).rejects.toThrow(/unexpected response shape/);
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
    expect(result[0]?.id).toBe('1f2e3d4c');
    expect(result[0]?.commit).toBe('1f2e3d4c');
    expect(result[0]?.authorMail).toBe('developer@example.com');
    expect(result[0]?.email).toBe('developer@example.com');
    expect(result[0]?.description).toBe('Initial import of package');
  });

  it('listRepoObjects parses objects payload', async () => {
    const http = mockHttp(loadFixture('gcts-objects.json'));
    const result = await listRepoObjects(http, gitSafety, 'ZARC1');
    expect(result).toHaveLength(2);
    expect(result[0]?.type).toBe('CLAS');
  });

  it('applies the ordinary write ceiling before the mutation quarantine', () => {
    const writesBlocked = { ...unrestrictedSafetyConfig(), allowWrites: false, allowGitWrites: true };
    expect(() => enforceGctsMutationQuarantine(writesBlocked, 'clone')).toThrow(AdtSafetyError);
    expect(() => enforceGctsMutationQuarantine(writesBlocked, 'clone')).toThrow(/allowWrites=false/);

    const gitBlocked = { ...unrestrictedSafetyConfig(), allowGitWrites: false };
    expect(() => enforceGctsMutationQuarantine(gitBlocked, 'clone')).toThrow(/allowGitWrites=false/);
  });

  it('keeps every quarantined action aligned with ACTION_POLICY', () => {
    for (const [action, [opType]] of Object.entries(GCTS_QUARANTINED_MUTATIONS)) {
      expect(getActionPolicy('SAPGit', action)).toMatchObject({ scope: 'git', opType });
      expect(() => enforceGctsMutationQuarantine(gitSafety, action)).toThrow(/VCS_NO_IMPORT/);
    }
    expect(() => enforceGctsMutationQuarantine(gitSafety, 'config')).not.toThrow();
  });

  it('does not treat legacy allowedPackages=[] or explicit * as authorization for a gCTS mutation', () => {
    for (const allowedPackages of [[], ['*']]) {
      expect(() => enforceGctsMutationQuarantine({ ...gitSafety, allowedPackages }, 'clone')).toThrow(
        /gCTS mutations are unavailable/,
      );
    }
  });

  it('surfaces ERROR logs on read responses and redacts credential values', async () => {
    const bearer = 'gcts-bearer-sentinel';
    const basic = 'gcts-basic-sentinel';
    const assignment = 'gcts-assignment-sentinel';
    const cookie = 'gcts-cookie-sentinel';
    const standalone = 'gcts-standalone-sentinel';
    const unicodeKey = 'gcts-unicode-key-sentinel';
    const http = mockHttp(
      JSON.stringify({
        log: [
          {
            severity: 'ERROR',
            message:
              `Remote Authorization: Bearer ${bearer}; Authorization=Basic \\"${basic}\\"; ` +
              `Cookie: SAP_SESSIONID_A4H_001=${cookie}; Set-Cookie: JSESSIONID=${cookie}; ` +
              `Bearer ${standalone}; ` +
              `{\\"to\\u006ben\\":\\"${unicodeKey}\\"}; ` +
              `CLIENT_VCS_AUTH_PWD=${assignment}; ` +
              'failed https://user:secret@example.com/x?token=sentinel pwd=plain-error-sentinel',
          },
        ],
      }),
    );
    await expect(getConfig(http, gitSafety)).rejects.toThrow(AdtApiError);
    try {
      await getConfig(http, gitSafety);
    } catch (err) {
      expect(String(err)).not.toContain('secret');
      expect(String(err)).not.toContain('sentinel');
      expect(err).toBeInstanceOf(AdtApiError);
      expect((err as AdtApiError).responseBody).not.toContain('secret');
      expect((err as AdtApiError).responseBody).not.toContain('sentinel');
      expect((err as AdtApiError).responseBody).not.toContain('plain-error-sentinel');
      expect(String(err)).not.toContain(bearer);
      expect(String(err)).not.toContain(basic);
      expect(String(err)).not.toContain(assignment);
      expect(String(err)).not.toContain(cookie);
      expect(String(err)).not.toContain(standalone);
      expect(String(err)).not.toContain(unicodeKey);
      expect((err as AdtApiError).responseBody).not.toContain(bearer);
      expect((err as AdtApiError).responseBody).not.toContain(basic);
      expect((err as AdtApiError).responseBody).not.toContain(assignment);
      expect((err as AdtApiError).responseBody).not.toContain(cookie);
      expect((err as AdtApiError).responseBody).not.toContain(standalone);
      expect((err as AdtApiError).responseBody).not.toContain(unicodeKey);
    }
  });

  it('redacts credentials in slash-escaped URLs from malformed HTTP error JSON', async () => {
    const sentinel = 'gcts-escaped-url-sentinel';
    const pathSentinel = 'gcts-error-path-sentinel';
    const assignmentSentinel = 'gcts-invalid-json-assignment-sentinel';
    const unicodeKeySentinel = 'gcts-invalid-unicode-key-sentinel';
    const body = `{"CLIENT_VCS_AUTH_TOKEN":"${assignmentSentinel}","to\\u006ben":"${unicodeKeySentinel}","exception":"failed https:\\/\\/git-user:${sentinel}@example.com/r?token=${sentinel}" BROKEN`;
    const http = mockHttp();
    (http.get as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new AdtApiError(body.slice(0, 500), 500, `/sap/bc/cts_abapvcs/config?api_key=${pathSentinel}`, body),
    );

    try {
      await getConfig(http, gitSafety);
      expect.fail('Expected malformed gCTS error to throw');
    } catch (err) {
      expect(String(err)).not.toContain(sentinel);
      expect(String(err)).not.toContain(pathSentinel);
      expect(String(err)).not.toContain(assignmentSentinel);
      expect(String(err)).not.toContain(unicodeKeySentinel);
      expect((err as AdtApiError).path).not.toContain(pathSentinel);
      expect((err as AdtApiError).responseBody).not.toContain(sentinel);
      expect((err as AdtApiError).responseBody).not.toContain(assignmentSentinel);
      expect((err as AdtApiError).responseBody).not.toContain(unicodeKeySentinel);
      expect(String(err)).not.toContain(body.slice(0, 40));
    }
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
});
