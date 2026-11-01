import { describe, expect, it, vi } from 'vitest';
import {
  assertSeededPreferences,
  formatterFixtureDocument,
  nativeFormatterFixture,
  sentinelPreferences,
} from '../../../scripts/qualification/pr1142/native-formatter-fixture.mjs';
import { AdtClient } from '../../../src/adt/client.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { patchPinnedFormatterSettings } from '../../../src/adt/pinned-formatter.js';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';

const original =
  '<?xml version="1.0" encoding="utf-8"?><p:PrettyPrinterSettings xmlns:p="http://www.sap.com/adt/prettyprintersettings" p:indentation="true" p:style="keywordUpper"/>';
function setup() {
  const client = new AdtClient({
    baseUrl: 'https://example.test',
    safety: {
      ...unrestrictedSafetyConfig(),
      multiTargetWrite: {
        target: 'A4H/001',
        enabled: true,
        allowedPackages: [],
        allowedTransports: [],
        serverAllowedTransports: [],
      },
    },
  });
  let xml = original;
  const files = new Map<string, any>();
  const get = vi.spyOn(client.http, 'get').mockImplementation(async () => ({
    statusCode: 200,
    headers: { 'content-type': 'application/vnd.sap.adt.ppsettings.v5+xml' },
    body: xml,
  }));
  const put = vi.spyOn(client.http, 'put').mockImplementation(async (_path, body) => {
    expect(files.has('/private/native-formatter-seed.json')).toBe(true);
    xml = String(body);
    return { statusCode: 200, headers: {}, body: '' };
  });
  const read = async (path: string) => {
    if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return structuredClone(files.get(path));
  };
  const write = async (path: string, value: any, exclusive?: boolean) => {
    if (exclusive && files.has(path)) throw Object.assign(new Error('exists'), { code: 'EEXIST' });
    files.set(path, structuredClone(value));
  };
  const run = { runId: 'run', sourceRevision: 'revision', harnessSha256: 'harness' };
  const invoke = (mode: string, overrides = {}) =>
    nativeFormatterFixture({
      mode,
      http: client.http,
      run,
      root: '/private',
      read,
      write,
      required: true,
      expectedSettings: { indentation: true, style: 'keywordUpper' },
      ...overrides,
    });
  const patch = (indentation: boolean) =>
    patchPinnedFormatterSettings(
      client.http,
      client.safety,
      pinnedMutationContext(client.safety, { deadline: Date.now() + 30000 }, { unlockFailed: false }),
      { indentation },
    );
  return {
    client,
    get,
    put,
    files,
    read,
    write,
    run,
    invoke,
    patch,
    xml: () => xml,
    change: (value: string) => {
      xml = value;
    },
  };
}

describe('PR1142 actual native formatter fixture lifecycle', () => {
  it('seeds all five preferences, preserves them through the real candidate, and restores the original XML', async () => {
    const test = setup();
    expect(await test.invoke('seed')).toMatchObject({ status: 'complete', seeded: true });
    expect(formatterFixtureDocument(test.xml()).state).toMatchObject(sentinelPreferences);
    expect(Object.keys(sentinelPreferences)).toHaveLength(5);
    expect(await test.patch(false)).toMatchObject({ ok: true, state: 'updated' });
    expect(() => assertSeededPreferences(test.xml())).not.toThrow();
    expect(await test.patch(true)).toMatchObject({ ok: true, state: 'updated' });
    expect(await test.invoke('restore-seed')).toMatchObject({ originalBytesRestored: true });
    expect(test.xml()).toBe(original);
    const calls = test.put.mock.calls.length;
    expect(await test.invoke('restore-seed')).toMatchObject({ originalBytesRestored: true });
    expect(test.put).toHaveBeenCalledTimes(calls);
    for (const call of test.put.mock.calls)
      expect(call[4]).toMatchObject({ noReplay: true, retryTransientErrors: false });
  });

  it('rejects the empty optional-field baseline that would let the old lossy writer pass', () => {
    expect(() => assertSeededPreferences(original)).toThrow('Missing seeded keepIdentifier');
  });

  it('never sends the seed PUT if its original-state journal cannot be saved', async () => {
    const test = setup();
    await expect(
      test.invoke('seed', {
        write: async () => {
          throw new Error('disk unavailable');
        },
      }),
    ).rejects.toThrow('disk unavailable');
    expect(test.put).not.toHaveBeenCalled();
  });

  it('recovers a lost response after the native seed PUT without replaying that PUT', async () => {
    const test = setup();
    test.put.mockImplementationOnce(async (_path, body) => {
      test.change(String(body));
      throw new Error('lost response');
    });
    await expect(test.invoke('seed')).rejects.toThrow('lost response');
    expect(test.files.get('/private/native-formatter-seed.json').phase).toBe('seed-submitted');
    expect(await test.invoke('restore-seed')).toMatchObject({ originalBytesRestored: true });
    expect(test.put).toHaveBeenCalledTimes(2);
    expect(test.xml()).toBe(original);
  });

  it('can recheck an uncertain restore without repeating an already-applied original-state PUT', async () => {
    const test = setup();
    await test.invoke('seed');
    test.put.mockImplementationOnce(async (_path, body) => {
      test.change(String(body));
      throw new Error('lost restore response');
    });
    await expect(test.invoke('restore-seed')).rejects.toThrow('lost restore response');
    expect(await test.invoke('restore-seed')).toMatchObject({ originalBytesRestored: true });
    expect(test.put).toHaveBeenCalledTimes(2);
  });

  it('preserves foreign preferences instead of restoring over them', async () => {
    const test = setup();
    await test.invoke('seed');
    test.change(test.xml().replace('p:style="keywordUpper"', 'p:style="keywordLower"'));
    const foreign = test.xml();
    await expect(test.invoke('restore-seed')).rejects.toThrow('preserve foreign work');
    expect(test.xml()).toBe(foreign);
    expect(test.put).toHaveBeenCalledTimes(1);
  });

  it('rejects a seed receipt from another run before native access', async () => {
    const test = setup();
    await test.invoke('seed');
    const calls = test.get.mock.calls.length;
    await expect(test.invoke('restore-seed', { run: { ...test.run, runId: 'other' } })).rejects.toThrow(
      'Seed receipt binding differs',
    );
    expect(test.get).toHaveBeenCalledTimes(calls);
  });

  it('requires a receipt for an attempted seed, but permits cleanup when no seed was attempted', async () => {
    const test = setup();
    await expect(test.invoke('restore-seed')).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await test.invoke('restore-seed', { required: false })).toMatchObject({ status: 'not-required' });
    expect(test.get).not.toHaveBeenCalled();
  });

  it('rejects unqualified representations and unknown fixture fields before native mutation', async () => {
    const test = setup();
    test.get.mockResolvedValueOnce({
      statusCode: 200,
      headers: { 'content-type': 'application/vnd.sap.adt.ppsettings.v2+xml' },
      body: original,
    });
    await expect(test.invoke('seed')).rejects.toThrow();
    expect(test.put).not.toHaveBeenCalled();
    expect(() => formatterFixtureDocument(original.replace('/>', ' p:future="x"/>'))).toThrow(
      'Unqualified native fixture preference',
    );
  });
});
