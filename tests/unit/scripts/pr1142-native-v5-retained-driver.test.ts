import { expect, it, vi } from 'vitest';
import {
  absentPeers,
  absentReference,
  retainedOwners,
  retainedService,
  retainedStages,
  retainedView,
  revisedLabel,
} from '../../../scripts/qualification/pr1142/native-v5-retained-fixed.js';
import { absent, retainedHarness, viewMetadata } from './pr1142-native-v5-retained-harness.js';

it.each([false, true])('completes exactly the retained two-owner lifecycle with proxy=%s', async (proxy) => {
  const h = retainedHarness({ proxy, reflectLabel: true });
  const result = await h.run();
  expect(result).toMatchObject({
    failure: false,
    completed: [...retainedStages],
    confirmedDeleted: [...retainedOwners],
    cleanupConfirmed: true,
    finalAbsenceConfirmed: true,
    remaining: [],
  });
  expect(h.calls.filter((r) => r.method === 'PUT')).toHaveLength(2);
  expect(h.calls.filter((r) => r.method === 'DELETE' && retainedOwners.includes(r.path.split('?')[0]))).toHaveLength(2);
  expect(h.calls.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(4);
  expect(JSON.stringify(h.records)).not.toContain('RETAINED-SECRET');
});
it('also accepts native metadata retaining its original label, without weakening source verification', async () => {
  expect(await retainedHarness({ reflectLabel: false }).run()).toMatchObject({ failure: false });
});
it.each(['source', 'stop', 'deadline'])('preserves owning unlock after a submitted PUT and %s', async (fault) => {
  const h = retainedHarness();
  let time = Date.now();
  const deadline = time + 2000;
  if (fault === 'deadline') vi.spyOn(Date, 'now').mockImplementation(() => time);
  h.hooks.before = (r) => {
    if (r.method === 'PUT') {
      if (fault === 'source') h.breakSource();
      else if (fault === 'stop') h.stop();
      else time += 3000;
    }
  };
  const result = await h.run(deadline);
  expect(result.failure).toBe(true);
  expect(result.confirmedDeleted).toEqual([]);
  expect(h.calls.filter((r) => r.method === 'PUT')).toHaveLength(1);
  expect(h.calls.filter((r) => r.path.includes('_action=UNLOCK'))).toHaveLength(1);
  expect(h.records.some((r) => r.operation === 'update' && r.cleanupConfirmed === true)).toBe(true);
});
it('retains both deletion/cleanup facts when immutable proof drifts after the last inventory await', async () => {
  const h = retainedHarness();
  h.hooks.record = (r) => {
    if (Array.isArray(r.ownedInventory) && r.ownedInventory.length === 0) h.breakSource();
  };
  expect(await h.run()).toMatchObject({
    failure: true,
    confirmedDeleted: [...retainedOwners],
    cleanupConfirmed: true,
    finalAbsenceConfirmed: false,
    inspectionRequired: [...retainedOwners],
  });
});
it('does not continue to view deletion after a service cleanup failure', async () => {
  const h = retainedHarness();
  h.hooks.reply = (r) =>
    r.path.includes('_action=UNLOCK') && !h.existing.has(retainedOwners[0])
      ? { statusCode: 500, data: '<error>RETAINED-SECRET-HANDLE</error>' }
      : undefined;
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(result.confirmedDeleted).toEqual([retainedOwners[0]]);
  expect(h.existing.has(retainedOwners[1])).toBe(true);
  expect(JSON.stringify(h.records)).not.toContain('RETAINED-SECRET-HANDLE');
});
it.each(['view-drift', 'foreign-label', 'false-active', 'foreign-absence', 'foreign-reference'])(
  'refuses %s without progressing beyond the known receipt',
  async (fault) => {
    const h = retainedHarness({ reflectLabel: true });
    let puts = 0;
    h.hooks.before = (r) => {
      if (r.method === 'PUT') puts++;
    };
    h.hooks.reply = (r) => {
      if (fault === 'view-drift' && puts && r.method === 'GET' && r.path === retainedView.owner)
        return { statusCode: 200, data: viewMetadata.replace('MARIAN', 'OTHER') };
      if (fault === 'foreign-label' && puts === 2 && r.path === retainedService.owner)
        return { statusCode: 200, data: h.metadata(null).replace(revisedLabel, 'FOREIGN LABEL') };
      if (fault === 'false-active' && puts && r.path === retainedService.owner)
        return {
          statusCode: 200,
          data: h.metadata(null).replace('adtcore:version="active"', 'adtcore:version="inactive"'),
        };
      if (fault === 'foreign-absence' && r.path === absentPeers[0].owner)
        return {
          statusCode: 404,
          data: absent.replace('http://www.sap.com/abapxml/types/communicationframework', 'urn:foreign'),
        };
      if (fault === 'foreign-reference' && r.path === absentReference.owner)
        return { statusCode: 200, data: '<present/>' };
    };
    const result = await h.run();
    expect(result.failure).toBe(true);
    expect(result.confirmedDeleted).toEqual([]);
    expect(h.existing.size).toBe(2);
    if (['foreign-absence', 'foreign-reference'].includes(fault)) expect(puts).toBe(0);
  },
);
it('does not replay a rejected save and omits echoed handle diagnostics', async () => {
  const h = retainedHarness();
  h.hooks.reply = (r) =>
    r.method === 'PUT' ? { statusCode: 415, data: '<error>RETAINED-SECRET-HANDLE</error>' } : undefined;
  expect((await h.run()).failure).toBe(true);
  expect(h.calls.filter((r) => r.method === 'PUT')).toHaveLength(1);
  expect(JSON.stringify(h.records)).not.toContain('RETAINED-SECRET-HANDLE');
});
it.each([false, true].flatMap((proxy) => retainedOwners.map((owner) => ({ proxy, owner }))))(
  'keeps namespace-invalid selected-owner absence unconfirmed: $proxy $owner',
  async ({ proxy, owner }) => {
    const h = retainedHarness({ proxy });
    h.hooks.reply = (row) =>
      !h.existing.has(owner) && row.method === 'GET' && row.path === owner
        ? {
            statusCode: 404,
            data: absent.replace('http://www.sap.com/abapxml/types/communicationframework', 'urn:foreign'),
          }
        : undefined;
    const result = await h.run();
    expect(result.failure).toBe(true);
    expect(result.confirmedDeleted).toEqual(owner === retainedService.owner ? [] : [retainedService.owner]);
    expect(result.remaining).toContain(owner);
    expect(result.inspectionRequired).toContain(owner);
    expect(h.calls.filter((row) => row.method === 'DELETE')).toHaveLength(owner === retainedService.owner ? 1 : 2);
  },
);
it('refuses active metadata at the expected inactive-save boundary before activation', async () => {
  const h = retainedHarness();
  let saved = false;
  h.hooks.before = (row) => {
    if (row.method === 'PUT') saved = true;
  };
  h.hooks.reply = (row) =>
    saved && row.method === 'GET' && row.path.startsWith(retainedService.owner) && !row.path.includes('/source/main')
      ? { statusCode: 200, data: h.metadata(null).replace('adtcore:version="inactive"', 'adtcore:version="active"') }
      : undefined;
  const result = await h.run();
  expect(result.failure).toBe(true);
  expect(h.calls.filter((row) => row.method === 'PUT')).toHaveLength(1);
  expect(h.calls.filter((row) => row.path.startsWith('/sap/bc/adt/activation?'))).toHaveLength(0);
  expect(h.calls.filter((row) => row.path.includes('_action=UNLOCK'))).toHaveLength(1);
});
