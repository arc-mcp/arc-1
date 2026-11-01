import { beforeEach, describe, expect, it, vi } from 'vitest';
import { digest } from '../../../scripts/qualification/pr1142/fixture-contract.mjs';
import { includeKinds } from '../../../scripts/qualification/pr1142/include-qualification.mjs';
import {
  cleanupNativeFixture,
  nativeAbsent,
  nativeIdentity,
} from '../../../scripts/qualification/pr1142/native-fixture-operations.mjs';
import { deleteObject, withLockedMutation } from '../../../src/adt/crud.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import { pinnedRecording, validatePinnedLock } from '../../../src/adt/pinned-write-policy.js';

vi.mock('../../../src/adt/crud.js', () => ({ deleteObject: vi.fn(), withLockedMutation: vi.fn() }));
vi.mock('../../../src/adt/pinned-write-policy.js', () => ({ pinnedRecording: vi.fn(), validatePinnedLock: vi.fn() }));
const fixture = { name: 'ZARC1_DPP_AC_1234ABCD', type: 'CLAS', actor: 'writerA' };
const metadata = (
  user = 'FIRST',
  includes = includeKinds
    .map(
      (kind) => `<c:include c:includeType="${kind}" c:createdBy="${user}" c:changedBy="${user}" c:version="active"/>`,
    )
    .join(''),
) =>
  `<c:abapClass xmlns:c="urn:adt" c:name="${fixture.name}" c:version="active" c:masterSystem="A4H" c:createdBy="${user}" c:changedBy="${user}" c:createdAt="2026-11-01"><c:packageRef c:name="$TMP"/>${includes}</c:abapClass>`;

describe('PR1142 actual native identity and cleanup branches', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(pinnedRecording).mockResolvedValue({ local: true });
    vi.mocked(withLockedMutation).mockImplementation(async (...args) => {
      const lock: any = { lockHandle: 'LOCK' };
      await args[4].validateLock(args[0], lock);
      return args[5](args[0], lock);
    });
  });

  it('records the actual wrong creator before refusing the receipt', async () => {
    const observed: any[] = [];
    const get = vi.fn(async () => ({ body: metadata('OTHER') }));
    await expect(
      nativeIdentity({
        fixture,
        actor: { sapUser: 'FIRST' },
        marker: 'MARKER',
        http: { get },
        options: {},
        observe: async (identity: any) => {
          observed.push(identity);
        },
      }),
    ).rejects.toThrow('Native creator differs');
    expect(observed[0].createdBy).toBe('OTHER');
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('retains both source hashes when an observed inactive draft prevents cleanup', async () => {
    const observed: any[] = [];
    const get = vi
      .fn()
      .mockResolvedValueOnce({ body: metadata() })
      .mockResolvedValueOnce({ body: 'MARKER draft' })
      .mockResolvedValueOnce({ body: 'MARKER active' });
    await expect(
      nativeIdentity({
        fixture,
        actor: { sapUser: 'FIRST' },
        marker: 'MARKER',
        http: { get },
        options: {},
        observe: async (identity: any) => {
          observed.push(identity);
        },
      }),
    ).rejects.toThrow('Unexpected inactive draft');
    expect(observed.at(-1).sourceSha256).not.toBe(observed.at(-1).activeSourceSha256);
  });

  it('does not accept an untyped native 404 as owner absence', async () => {
    const evidence: any[] = [];
    await expect(
      nativeAbsent(
        fixture,
        {
          get: async () => {
            throw new AdtApiError('missing', 404, '/owner', '<html>missing</html>');
          },
        },
        {},
        (value) => evidence.push(value),
      ),
    ).rejects.toBeInstanceOf(AdtApiError);
    expect(evidence).toEqual([{ statusCode: 404, exceptionType: null, classifiedServiceError: false }]);
  });

  function includeIdentity() {
    const observed: any[] = [];
    let foreign: 'current' | 'active' | undefined;
    let metadataBody = metadata();
    const expectedIncludes = {
      complete: true,
      kinds: Object.fromEntries(includeKinds.map((kind) => [kind, { complete: true, sourceHash: digest(kind) }])),
    };
    const get = vi.fn(async (path: string) => {
      if (path.endsWith(fixture.name.toLowerCase())) return { body: metadataBody };
      if (path.includes('/source/main')) return { body: 'MARKER main' };
      const kind = path.split('/includes/')[1]?.split('?')[0];
      expect(includeKinds).toContain(kind);
      const changed = kind === 'macros' && foreign && path.includes('?version=active') === (foreign === 'active');
      return { body: changed ? `${kind} foreign draft` : kind };
    });
    const identity = () =>
      nativeIdentity({
        fixture,
        actor: { sapUser: 'FIRST' },
        marker: 'MARKER',
        http: { get },
        options: {},
        expectedIncludes,
        observe: async (value: any) => observed.push(value),
      });
    return {
      identity,
      get,
      observed,
      expectedIncludes,
      changeMetadata: (body: string) => {
        metadataBody = body;
      },
      change: (value: 'current' | 'active') => {
        foreign = value;
      },
    };
  }

  it('requires every active and editable include to match its PP hash', async () => {
    const test = includeIdentity();
    const identity = await test.identity();
    expect(Object.keys(identity.includes)).toEqual(includeKinds);
    for (const kind of includeKinds)
      expect(identity.includes[kind]).toEqual({
        sourceSha256: digest(kind),
        activeSourceSha256: digest(kind),
        createdBy: 'FIRST',
        changedBy: 'FIRST',
        version: 'active',
      });
    expect(test.get).toHaveBeenCalledTimes(11);
  });

  it.each(['wrong-author', 'inactive', 'missing', 'duplicate'])(
    'refuses %s per-include metadata even with matching class ownership and source hashes',
    async (mode) => {
      const test = includeIdentity();
      const descriptors = includeKinds
        .flatMap((kind) => {
          const entry = `<c:include c:includeType="${kind}" c:createdBy="FIRST" c:changedBy="${kind === 'macros' && mode === 'wrong-author' ? 'OTHER' : 'FIRST'}" c:version="${kind === 'macros' && mode === 'inactive' ? 'inactive' : 'active'}"/>`;
          return kind !== 'macros'
            ? [entry]
            : mode === 'missing'
              ? []
              : mode === 'duplicate'
                ? [entry, entry]
                : [entry];
        })
        .join('');
      test.changeMetadata(metadata('FIRST', descriptors));
      await expect(test.identity()).rejects.toThrow(/Native include/);
      if (mode === 'wrong-author') expect(test.observed.at(-1).includes.macros.changedBy).toBe('OTHER');
      if (mode === 'inactive') expect(test.observed.at(-1).includes.macros.version).toBe('inactive');
    },
  );

  it.each(['current', 'active'] as const)('records and refuses a changed %s include', async (version) => {
    const test = includeIdentity();
    test.change(version);
    await expect(test.identity()).rejects.toThrow(/include/);
    const last = test.observed.at(-1);
    expect(last.includes.macros.sourceSha256).not.toBe(last.includes.macros.activeSourceSha256);
    expect(last.sourceSha256).toBe(digest('MARKER main'));
  });

  it('refuses a partial include qualification before accepting an ownership receipt', async () => {
    const test = includeIdentity();
    test.expectedIncludes.complete = false;
    await expect(test.identity()).rejects.toThrow('Include qualification is incomplete');
  });

  function cleanup() {
    const owned = { createdBy: 'FIRST', sourceSha256: 'owned' };
    const receipt: any = {
      manifestSha256: 'manifest',
      status: 'complete',
      fixtures: [{ name: fixture.name, identity: owned }],
    };
    const context = { cleanup: { unlockFailed: false } };
    return {
      fixture,
      manifestSha256: 'manifest',
      context,
      client: { http: {}, safety: {} },
      http: {},
      options: {},
      receipt,
      owned,
      attempted: vi.fn(),
      absent: vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true),
      identity: vi.fn().mockResolvedValue(owned),
      load: async (name: string) =>
        name === 'native-preflight.json'
          ? { manifestSha256: 'manifest', fixtures: [{ name: fixture.name, absent: true }] }
          : receipt,
    };
  }

  it.each(['missing-receipt', 'foreign-before-lock', 'foreign-under-lock'])(
    'preserves the fixture on %s',
    async (mode) => {
      const test = cleanup();
      if (mode === 'missing-receipt') test.receipt.status = 'failed';
      if (mode === 'foreign-before-lock') test.identity.mockResolvedValue({ createdBy: 'OTHER' });
      if (mode === 'foreign-under-lock')
        test.identity.mockResolvedValueOnce(test.owned).mockResolvedValueOnce({ sourceSha256: 'foreign' });
      await expect(cleanupNativeFixture(test)).rejects.toThrow();
      expect(deleteObject).not.toHaveBeenCalled();
    },
  );

  it('uses the owning session only after both identity and fresh lock checks pass', async () => {
    const test = cleanup();
    await expect(cleanupNativeFixture(test)).resolves.toMatchObject({ absent: true });
    expect(test.identity).toHaveBeenCalledTimes(2);
    expect(pinnedRecording).toHaveBeenCalledTimes(2);
    expect(validatePinnedLock).toHaveBeenCalledOnce();
    expect(deleteObject).toHaveBeenCalledExactlyOnceWith(
      test.client.http,
      test.client.safety,
      '/sap/bc/adt/oo/classes/zarc1_dpp_ac_1234abcd',
      'LOCK',
    );
  });

  it('preserves a foreign include draft discovered by the actual native reader under the class lock', async () => {
    const native = includeIdentity();
    const test = cleanup();
    test.receipt.fixtures[0].identity = await native.identity();
    test.identity.mockImplementation(() => native.identity());
    vi.mocked(withLockedMutation).mockImplementation(async (...args) => {
      native.change('current');
      const lock: any = { lockHandle: 'LOCK' };
      await args[4].validateLock(args[0], lock);
      return args[5](args[0], lock);
    });
    await expect(cleanupNativeFixture(test)).rejects.toThrow('Native include differs');
    expect(deleteObject).not.toHaveBeenCalled();
    expect(test.identity).toHaveBeenCalledTimes(2);
  });
});
