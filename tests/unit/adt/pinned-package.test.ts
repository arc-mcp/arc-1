import { beforeEach, describe, expect, it } from 'vitest';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import { AdtApiError } from '../../../src/adt/errors.js';

import { mockResponse } from '../../helpers/mock-fetch.js';
import { managedHarness, nativeAbsent, packageXml } from './pinned-managed-harness.js';

const { pinnedMutationContext } = await import('../../../src/adt/mutation-context.js');
const { mutationClient } = await import('../../../src/adt/mutation-client.js');
const { createPinnedPackage, deletePinnedPackage, pinnedPackageSelection, readPinnedPackage } = await import(
  '../../../src/adt/pinned-package.js'
);
let exists: boolean, fault: string, readbackAttributes: string;
const matchingAttributes = 'adtcore:description="Test package" adtcore:responsible="MARIAN"';
let harness: ReturnType<typeof managedHarness>;
const input = { name: '$NEW', description: 'Test package', superPackage: '$DEST', responsible: 'MARIAN' };
beforeEach(() => {
  exists = false;
  fault = '';
  readbackAttributes = matchingAttributes;
  harness = managedHarness((r) => {
    if (r.method === 'POST' && r.path === '/sap/bc/adt/packages') {
      exists = true;
      return mockResponse(fault === 'lost-create' ? 503 : 201, '');
    }
    if (r.path === '/sap/bc/adt/packages/%24DEST') return mockResponse(200, packageXml('$DEST'));
    if (r.path === '/sap/bc/adt/packages/%24NEW')
      return exists
        ? mockResponse(
            200,
            packageXml('$NEW', fault === 'wrong-parent' ? '$OTHER' : '$DEST').replace(
              '<p:package ',
              `<p:package ${readbackAttributes} `,
            ),
          )
        : mockResponse(404, fault === 'html-absence' ? '<html>Missing</html>' : nativeAbsent);
    return undefined;
  });
});
const create = (patch = {}) =>
  createPinnedPackage(harness.client, harness.context(), { ...input, ...patch }, { cloud: false });
const creates = () => harness.calls.filter((r) => r.method === 'POST' && r.path.startsWith('/sap/bc/adt/packages'));

describe('private pinned packages', () => {
  it.each([
    ['native empty', '<p:superPackage/>', ''],
    ['explicit empty name', '<p:superPackage adtcore:name=""/>', ''],
    ['missing', '', undefined],
    ['real parent', '<p:superPackage adtcore:name="$DEST"/>', '$DEST'],
  ])('preserves the native parent evidence distinction: %s', async (_label, parent, expected) => {
    harness = managedHarness((r) =>
      r.method === 'GET' && r.path === '/sap/bc/adt/packages/%24NEW'
        ? mockResponse(200, packageXml('$NEW').replace('<p:superPackage adtcore:name=""/>', parent!))
        : undefined,
    );
    const result = await readPinnedPackage(
      mutationClient(harness.client, harness.context()),
      pinnedPackageSelection('$NEW'),
    );
    expect(result.superPackage).toBe(expected);
    expect(harness.calls.map((r) => r.method)).toEqual(['GET']);
  });
  it('does not confuse a native empty parent with the actual requested child parent', async () => {
    let created = false;
    harness = managedHarness((r) => {
      if (r.method === 'POST' && r.path === '/sap/bc/adt/packages') {
        created = true;
        return mockResponse(201, '');
      }
      if (r.path === '/sap/bc/adt/packages/%24DEST') return mockResponse(200, packageXml('$DEST'));
      if (r.path === '/sap/bc/adt/packages/%24NEW')
        return created
          ? mockResponse(
              200,
              packageXml('$NEW')
                .replace('<p:superPackage adtcore:name=""/>', '<p:superPackage/>')
                .replace('<p:package ', `<p:package ${matchingAttributes} `),
            )
          : mockResponse(404, nativeAbsent);
      return undefined;
    });
    expect(await create()).toMatchObject({ ok: false, state: 'created-unverified', phase: 'readback' });
    expect(creates()).toHaveLength(1);
    expect(harness.calls.some((r) => r.method === 'DELETE' || r.method === 'PUT')).toBe(false);
  });
  it('verifies the requested description, responsible user and parent before reporting created', async () => {
    const result = await create();
    expect(result, JSON.stringify({ result, calls: harness.calls })).toMatchObject({
      ok: true,
      state: 'created',
      recording: { local: true },
    });
    expect(creates()).toHaveLength(1);
    expect(creates()[0]?.body).toContain('adtcore:responsible="MARIAN"');
    expect(creates()[0]?.body).toContain('adtcore:description="Test package"');
    expect(creates()[0]?.body).toContain('adtcore:name="$DEST"');
    expect(harness.calls.find((r) => r.path.includes('transportchecks'))?.body).toContain('<DEVCLASS>$DEST</DEVCLASS>');
    expect(harness.calls.find((r) => r.path.includes('transportchecks'))?.body).toContain('<OPERATION>I</OPERATION>');
  });
  it('uses the real child parent for recorded request selection', async () => {
    let created = false;
    harness = managedHarness((r) => {
      if (r.path.startsWith('/sap/bc/adt/cts/transportchecks'))
        return mockResponse(
          200,
          '<DATA><DEVCLASS>ZTEAM</DEVCLASS><DLVUNIT>HOME</DLVUNIT><OPERATION>I</OPERATION><RESULT>S</RESULT><RECORDING>X</RECORDING></DATA>',
        );
      if (r.path === '/sap/bc/adt/cts/transportrequests/A4HK900001')
        return mockResponse(
          200,
          '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900001" tm:type="K" tm:status="D"/></tm:root>',
        );
      if (r.path === '/sap/bc/adt/packages/ZTEAM') return mockResponse(200, packageXml('ZTEAM', '', 'HOME'));
      if (r.path === '/sap/bc/adt/packages/ZNEW')
        return created
          ? mockResponse(
              200,
              packageXml('ZNEW', 'ZTEAM', 'HOME').replace('<p:package ', `<p:package ${matchingAttributes} `),
            )
          : mockResponse(404, nativeAbsent);
      if (r.method === 'POST' && r.path === '/sap/bc/adt/packages?corrNr=A4HK900001') {
        created = true;
        return mockResponse(201, '');
      }
      return undefined;
    });
    harness.client.safety.allowedPackages.push('ZNEW');
    harness.client.safety.multiTargetWrite = {
      ...harness.client.safety.multiTargetWrite!,
      allowedPackages: [...harness.client.safety.multiTargetWrite!.allowedPackages, 'ZNEW'],
    };
    const result = await create({
      name: 'ZNEW',
      superPackage: 'ZTEAM',
      softwareComponent: 'HOME',
      transport: 'A4HK900001',
    });
    expect(result).toMatchObject({ ok: true, state: 'created', recording: { local: false, request: 'A4HK900001' } });
    expect(creates()).toHaveLength(1);
    expect(harness.calls.find((r) => r.path.includes('transportchecks'))?.body).toContain('<DEVCLASS>ZTEAM</DEVCLASS>');
    expect(creates()[0]?.body).toContain('adtcore:name="ZTEAM"');
  });
  it.each(['component', 'recording', 'layer', 'kind'])(
    'rejects incompatible local parent %s before recording or creation',
    async (fault) => {
      const changes: Record<string, (s: string) => string> = {
        component: (s) => s.replace('p:name="LOCAL"', 'p:name="HOME"'),
        recording: (s) => s.replace('p:recordChanges="false"', 'p:recordChanges="true"'),
        layer: (s) => s.replace('<p:transportLayer p:name=""/>', ''),
        kind: (s) => s.replace('p:packageType="development"', 'p:packageType="structure"'),
      };
      harness = managedHarness((r) =>
        r.path.endsWith('%24NEW')
          ? mockResponse(404, nativeAbsent)
          : r.path.endsWith('%24DEST')
            ? mockResponse(200, changes[fault](packageXml('$DEST')))
            : undefined,
      );
      expect(await create()).toMatchObject({ ok: false, state: 'unchanged', phase: 'parent-policy' });
      expect(creates()).toHaveLength(0);
      expect(harness.calls.some((r) => r.path.includes('transportchecks'))).toBe(false);
    },
  );
  it('compares decoded native values using their namespace rather than prefix spelling', async () => {
    readbackAttributes =
      'xmlns:c="http://www.sap.com/adt/core" c:description="R&amp;D &quot;native&quot;" c:responsible="CB9980000000"';
    expect(await create({ description: 'R&D "native"', responsible: 'CB9980000000' })).toMatchObject({
      ok: true,
      state: 'created',
      phase: 'readback',
    });
    expect(creates()).toHaveLength(1);
    expect(creates()[0]?.body).toContain('adtcore:description="R&amp;D &quot;native&quot;"');
    expect(creates()[0]?.body).toContain('adtcore:responsible="CB9980000000"');
  });
  it.each([
    ['both fields absent', ''],
    ['description absent', 'adtcore:responsible="MARIAN"'],
    ['responsible absent', 'adtcore:description="Test package"'],
    ['description changed', matchingAttributes.replace('Test package', 'Different package')],
    ['responsible changed', matchingAttributes.replace('MARIAN', 'OTHER')],
    ['description empty', matchingAttributes.replace('Test package', '')],
    ['responsible empty', matchingAttributes.replace('MARIAN', '')],
    ['description padded', matchingAttributes.replace('Test package', ' Test package ')],
    ['responsible padded', matchingAttributes.replace('MARIAN', ' MARIAN ')],
    ['description in a foreign namespace', matchingAttributes.replace('adtcore:description', 'p:description')],
    ['responsible in a foreign namespace', matchingAttributes.replace('adtcore:responsible', 'p:responsible')],
    ['unqualified description', matchingAttributes.replace('adtcore:description', 'description')],
    ['unqualified responsible', matchingAttributes.replace('adtcore:responsible', 'responsible')],
  ])('retains an acknowledged creation as unverified with %s', async (_label, attributes) => {
    readbackAttributes = attributes;
    const result = await create();
    expect(result).toMatchObject({ ok: false, state: 'created-unverified', phase: 'readback', retryable: false });
    expect(creates()).toHaveLength(1);
    expect(harness.calls.some((r) => r.method === 'DELETE' || r.method === 'PUT')).toBe(false);
  });
  it.each(['../X', '%24TMP', '$TMP/foo', '', 'lower', 'X'.repeat(31)])('rejects unsafe package name %s', (name) => {
    expect(() => pinnedPackageSelection(name)).toThrow();
  });
  it.each([
    { name: '$TMP' },
    { superPackage: undefined },
    { superPackage: '$TMP' },
    { packageType: 'structure' },
    { superPackage: '$NEW' },
    { superPackage: 'ZTEAM' },
    { responsible: 'idp@example.com' },
    { responsible: '' },
    { transport: 'A4HK900001' },
    { transport: '' },
    { recordChanges: true },
    { recordChanges: 'false' },
    { transportLayer: 'ZDEV' },
    { softwareComponent: 'HOME' },
    { packageType: 'bogus' },
    { description: 'two\nlines' },
    { target: 'OTHER/001' },
  ])('refuses invalid selection before native requests: %j', async (patch) => {
    expect(await create(patch)).toMatchObject({ ok: false, state: 'unchanged', phase: 'validation' });
    expect(harness.calls).toHaveLength(0);
  });
  it('refuses an existing target', async () => {
    exists = true;
    expect(await create()).toMatchObject({ ok: false, state: 'unchanged' });
    expect(creates()).toHaveLength(0);
  });
  it('does not turn an HTML 404 into native absence', async () => {
    fault = 'html-absence';
    expect(await create()).toMatchObject({ ok: false, state: 'unchanged' });
    expect(creates()).toHaveLength(0);
  });
  it('retains an uncertain accepted create without replay or rollback', async () => {
    fault = 'lost-create';
    expect(await create()).toMatchObject({ ok: false, state: 'creation-unconfirmed', retryable: false });
    expect(creates()).toHaveLength(1);
    expect(harness.calls.some((r) => r.method === 'DELETE')).toBe(false);
  });
  it('reports a wrong native parent as a created but unverified package', async () => {
    fault = 'wrong-parent';
    expect(await create()).toMatchObject({ ok: false, state: 'created-unverified' });
  });
  it('checks both parent and child package restrictions before POST', async () => {
    harness.client.safety.multiTargetWrite = { ...harness.client.safety.multiTargetWrite!, allowedPackages: ['$TMP'] };
    expect(await create()).toMatchObject({ ok: false, state: 'unchanged' });
    expect(creates()).toHaveLength(0);
  });
  it('rejects a disabled server ceiling before network', async () => {
    harness.client.safety.allowWrites = false;
    expect(await create()).toMatchObject({ ok: false, state: 'unchanged' });
    expect(harness.calls).toHaveLength(0);
  });
  it('stops an already cancelled request before network', async () => {
    const abort = new AbortController();
    abort.abort();
    expect(
      await createPinnedPackage(harness.client, harness.context(abort.signal), input, { cloud: false }),
    ).toMatchObject({ ok: false, state: 'unchanged' });
    expect(harness.calls).toHaveLength(0);
  });
  it.each(['content', 'network'])('refuses known content or unavailable browsing: %s', async (evidence) => {
    exists = true;
    harness.client.getDirectPackageContents = async () => {
      if (evidence === 'network') throw new AdtApiError('Not available', 503, '/packages');
      return {
        objects:
          evidence === 'content' ? [{ type: 'CLAS/OC', name: 'ZOTHER', uri: '/sap/bc/adt/oo/classes/zother' }] : [],
        listing: {},
      } as any;
    };
    const result = await deletePinnedPackage(
      harness.client,
      pinnedMutationContext(
        harness.client.safety,
        {
          deadline: Date.now() + 30_000,
          responseBudget: new DataResponseBudget(4 * 1024 * 1024, 'package-delete', true),
        },
        { unlockFailed: false },
      ),
      { name: '$NEW' },
      { cloud: false, abapRelease: '758' },
    );
    expect(result).toMatchObject({ ok: false, state: 'unchanged' });
    expect(harness.calls.some((r) => r.method === 'DELETE' || r.path.includes('_action=LOCK'))).toBe(false);
  });
});
