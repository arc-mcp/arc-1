import { setImmediate as immediate } from 'node:timers/promises';
import { expect, it, vi } from 'vitest';
import { Semaphore } from '../../../src/adt/semaphore.js';
import { DDIC_STAGES, ddicHarness, fixtures } from './pr1142-native-ddic-harness.js';

const { checkDdicRequest } = await import('../../../scripts/qualification/pr1142/native-ddic-transport.js');
const { ddicGetOnlyPreflight } = await import('../../../scripts/qualification/pr1142/native-ddic-runner.js');
it('runs all real private stages, mandatory DTEL post-PUT, stale refusals and DTEL→DOMA deletion', async () => {
  const h = ddicHarness(),
    r = await h.run();
  expect(r, JSON.stringify(h.world.calls.filter((c) => c.path.includes('/activation?')))).toMatchObject({
    failure: false,
    completed: [...DDIC_STAGES],
    confirmedDeleted: [fixtures[1].owner, fixtures[0].owner],
    finalAbsenceConfirmed: true,
    cleanupUnconfirmed: false,
  });
  expect(h.world.unexpected).toEqual([]);
  const puts = h.world.calls.filter((c) => c.method === 'PUT');
  expect(puts).toHaveLength(3);
  expect(puts.filter((c) => c.path.startsWith(fixtures[1].owner))).toHaveLength(2);
  expect(puts.at(-1)?.body).toContain('<dtel:deactivateInputHistory>true</dtel:deactivateInputHistory>');
  expect(puts.at(-1)?.body).toContain('<dtel:mediumFieldLabel>DDIC fixture</dtel:mediumFieldLabel>');
  expect(h.records.filter((r) => r.adapter?.startsWith('stale-')).map((r) => r.result.state)).toEqual([
    'unchanged',
    'unchanged',
  ]);
  expect(h.world.calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('?')[0])).toEqual([
    fixtures[1].owner,
    fixtures[0].owner,
  ]);
  expect(JSON.stringify(h.records)).not.toContain('native-lock');
  expect(h.runtime.createClient.mock.calls[0]?.[0]?.safety?.multiTargetWrite).toMatchObject({
    enabled: true,
    allowedPackages: ['$TMP'],
    allowedTransports: [],
    serverAllowedTransports: [],
  });
});
it.each(['create-unknown', 'save-unknown', 'readback', 'still-inactive', 'unlock', 'delete-unknown'])(
  'stops and retains on %s with no automatic catch deletion',
  async (fault) => {
    const h = ddicHarness();
    h.world.faults.add(fault);
    const r = await h.run();
    expect(r.failure).toBe(true);
    expect(r.finalAbsenceConfirmed).toBe(false);
    if (fault !== 'delete-unknown') expect(h.world.calls.some((c) => c.method === 'DELETE')).toBe(false);
    else expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(1);
    expect(r.inspectionRequired.length).toBeGreaterThan(0);
  },
);
it('rejects negative input-history readback drift before another mutation', async () => {
  const h = ddicHarness();
  h.hooks.record = (r) => {
    if (r.adapter === 'create-DTEL') {
      const o = h.world.objects.get(fixtures[1].owner)!;
      o.metadata = o.metadata.replace('<dtel:deactivateInputHistory>true<', '<dtel:deactivateInputHistory>false<');
    }
  };
  expect((await h.run()).failure).toBe(true);
  expect(h.world.calls.some((c) => c.method === 'DELETE')).toBe(false);
});
it('does only three fixed GETs in preflight', async () => {
  const h = ddicHarness();
  await ddicGetOnlyPreflight(h.client, fixtures, (r) => h.records.push(r), h.verify);
  expect(h.world.calls.map((c) => c.method)).toEqual(['GET', 'GET', 'GET']);
});
it.each(['source', 'stop', 'expired'] as const)(
  'rechecks %s after actual semaphore wait and keeps own UNLOCK available',
  async (fault) => {
    const semaphore = new Semaphore(1),
      h = ddicHarness({ semaphore }),
      now = Date.now.bind(Date);
    let offset = 0,
      queued = false;
    vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
    h.hooks.record = (r) => {
      if (r.stage === 'request' && r.method === 'PUT' && !queued) {
        queued = true;
        void semaphore.acquire();
        void (async () => {
          for (let i = 0; i < 100 && semaphore.waiting === 0; i++) await immediate();
          if (fault === 'source') h.breakSource();
          else if (fault === 'stop') h.stop();
          else offset = 300001;
          semaphore.release();
        })();
      }
    };
    const result = await h.run();
    expect(queued).toBe(true);
    expect(result.failure).toBe(true);
    expect(
      h.world.calls.filter((c) => c.method === 'PUT'),
      JSON.stringify(h.records.slice(-8)),
    ).toEqual([]);
    expect(h.world.calls.some((c) => c.path.includes('_action=UNLOCK'))).toBe(true);
    expect(result.cleanupUnconfirmed, JSON.stringify(h.records.slice(-8))).toBe(false);
  },
);
it('rechecks immutable binding after final inventory await', async () => {
  const h = ddicHarness();
  let inventories = 0;
  h.hooks.before = (u) => {
    if (u.pathname.endsWith('inactiveobjects') && ++inventories === 2) h.breakSource();
  };
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.confirmedDeleted).toHaveLength(2);
  expect(r.inspectionRequired).toHaveLength(2);
});
it('rejects metadata identity/version/author/hash drift before delete', async () => {
  const h = ddicHarness();
  h.hooks.record = (r) => {
    if (r.stageCompleted === 'reactivate-DTEL') {
      const o = h.world.objects.get(fixtures[1].owner)!;
      o.metadata = o.metadata.replace('adtcore:createdBy="MARIAN"', 'adtcore:createdBy="FOREIGN"');
    }
  };
  expect((await h.run()).failure).toBe(true);
  expect(h.world.calls.some((c) => c.method === 'DELETE')).toBe(false);
});
it('checks effective deadline after synchronous proof at dispatch', async () => {
  const h = ddicHarness(),
    now = Date.now.bind(Date);
  let offset = 0,
    intent = false;
  vi.spyOn(Date, 'now').mockImplementation(() => now() + offset);
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.method === 'POST' && r.path === '/sap/bc/adt/ddic/domains') intent = true;
  };
  h.hooks.verify = () => {
    if (intent) offset = 300001;
  };
  expect((await h.run()).failure).toBe(true);
  expect(h.world.calls.some((c) => c.method === 'POST' && c.path === '/sap/bc/adt/ddic/domains')).toBe(false);
});
it('refuses foreign/malformed namespace absence instead of reporting cleaned', async () => {
  const h = ddicHarness();
  h.hooks.record = (r) => {
    if (r.adapter === 'delete-DTEL') h.world.objects.get(fixtures[1].owner)!.metadata = '<html>login</html>';
  };
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(r.confirmedDeleted).toEqual([]);
});
it.each([false, true])('uses the same actual lifecycle with Connectivity=%s', async (proxy) => {
  expect((await ddicHarness({ proxy }).run()).failure).toBe(false);
});
it.each([false, true])('refuses changed source after async token wait with Connectivity=%s', async (proxy) => {
  let intent = false;
  const h = ddicHarness({
    proxy,
    token: async () => {
      await Promise.resolve();
      if (intent) h.breakSource();
      return 'synthetic-token';
    },
  });
  h.hooks.record = (r) => {
    if (r.stage === 'request' && r.method === 'POST' && r.path === '/sap/bc/adt/ddic/domains') intent = true;
  };
  expect((await h.run()).failure).toBe(true);
  expect(h.world.calls.some((c) => c.method === 'POST' && c.path.split('?')[0] === '/sap/bc/adt/ddic/domains')).toBe(
    false,
  );
});

it.each([
  'foreign-owner',
  'foreign-package',
  'foreign-author',
  'unknown-state',
  'foreign-state-link',
  'duplicate-state-link',
] as const)('retains before activation on %s', async (fault) => {
  const h = ddicHarness();
  h.hooks.record = (r) => {
    if (r.stageCompleted !== 'create-DOMA') return;
    const o = h.world.objects.get(fixtures[0].owner)!;
    if (fault === 'foreign-owner') o.metadata = o.metadata.replace(fixtures[0].name, 'FOREIGN');
    if (fault === 'foreign-package') o.metadata = o.metadata.replace('adtcore:name="$TMP"', 'adtcore:name="FOREIGN"');
    if (fault === 'foreign-author') o.metadata = o.metadata.replace('createdBy="MARIAN"', 'createdBy="OTHER"');
    if (fault === 'unknown-state') o.metadata = o.metadata.replace('version="inactive"', 'version="unknown"');
    const link =
      '<a:link xmlns:a="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="' +
      (fault === 'foreign-state-link' ? '/foreign' : `${fixtures[0].owner}?version=active`) +
      '"/>';
    if (fault.endsWith('state-link'))
      o.metadata = o.metadata.replace(
        '</doma:domain>',
        `${link + (fault === 'duplicate-state-link' ? link : '')}</doma:domain>`,
      );
  };
  const r = await h.run();
  expect(r.failure).toBe(true);
  expect(h.world.calls.some((c) => c.path.startsWith('/sap/bc/adt/activation?'))).toBe(false);
  expect(h.world.calls.some((c) => c.method === 'DELETE')).toBe(false);
});
it('refuses an altered fixed fixture graph before any native call', async () => {
  const h = ddicHarness(),
    other = structuredClone(fixtures);
  other[1].create.deactivateInputHistory = false;
  await expect(h.run(other)).rejects.toThrow('fixed DDIC');
  expect(h.world.calls).toEqual([]);
});
it('rejects foreign paths, nested owner escapes, identity/CTS query overrides and stale-stage PUT', () => {
  for (const [method, path] of [
    ['GET', 'https://foreign.invalid/sap/bc/adt/ddic/domains/X'],
    ['GET', `${fixtures[0].owner}/source/main`],
    ['GET', `${fixtures[0].owner}?sap-client=100`],
    ['GET', `${fixtures[0].owner}?version=active&version=inactive`],
    ['DELETE', `${fixtures[1].owner}?lockHandle=x`],
    ['DELETE', `${fixtures[0].owner}?lockHandle=x&corrNr=FOREIGN`],
    ['POST', `${fixtures[0].owner}?_action=UNLOCK&lockHandle=x&sap-user=OTHER`],
    ['PUT', `${fixtures[0].owner}?lockHandle=x`],
  ])
    expect(() => checkDdicRequest(fixtures, fixtures[0], 'stale-DOMA', method, path, '<bad/>')).toThrow();
});

it('accepts explicit native new state before first activation without inferring active state', async () => {
  const h = ddicHarness();
  h.hooks.record = (r) => {
    if (r.stage === 'response' && r.method === 'POST' && r.path === '/sap/bc/adt/ddic/domains') {
      const o = h.world.objects.get(fixtures[0].owner)!;
      o.metadata = o.metadata.replace('version="inactive"', 'version="new"');
    }
  };
  const r = await h.run();
  expect(r.failure).toBe(false);
  expect(h.records.some((r) => r.nativeVersion === 'new')).toBe(true);
});
it('refuses uppercase inactive state alternatives rather than treating them as active', async () => {
  const h = ddicHarness();
  h.hooks.record = (r) => {
    if (r.stageCompleted === 'activate-DOMA') h.stop();
  };
  await h.run();
  const o = h.world.objects.get(fixtures[0].owner)!;
  o.metadata = o.metadata.replace(
    '</doma:domain>',
    `<a:link xmlns:a="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="${fixtures[0].owner}?version=INACTIVE"/></doma:domain>`,
  );
  const { ddicSnapshot } = await import('../../../scripts/qualification/pr1142/native-ddic-evidence.js');
  await expect(
    ddicSnapshot(h.client, fixtures[0], false, true, () => {}, { deadline: Date.now() + 10000, noReplay: true }),
  ).rejects.toThrow('state alternative');
});
