import { expect, it } from 'vitest';
import { ddicHarness, fixtures } from './pr1142-native-ddic-harness.js';

it.each(['present', 'uncertain'] as const)(
  'retains a historically deleted dependent after later %s evidence',
  async (outcome) => {
    const h = ddicHarness();
    let saved = '',
      armed = false,
      observed = 0;
    h.hooks.record = (row) => {
      if (row.stageStarted === 'delete-DTEL') saved = h.world.objects.get(fixtures[1].owner)!.metadata;
      if (row.stageCompleted === 'delete-DTEL') {
        armed = true;
        if (outcome === 'present') h.world.objects.get(fixtures[1].owner)!.metadata = saved;
      }
    };
    h.hooks.before = (url, input) => {
      if (armed && input.method === 'GET' && url.pathname === fixtures[1].owner) {
        observed++;
        if (outcome === 'uncertain') throw new Error('Synthetic unavailable child absence.');
      }
    };
    const result = await h.run();
    expect(observed).toBe(1);
    expect(result).toMatchObject({
      failure: true,
      stoppedAt: 'delete-DOMA',
      confirmedDeleted: [fixtures[1].owner],
      cleanupUnconfirmed: false,
      finalAbsenceConfirmed: false,
    });
    expect(new Set(result.remaining)).toEqual(new Set(fixtures.map((f) => f.owner)));
    expect(new Set(result.inspectionRequired)).toEqual(new Set(fixtures.map((f) => f.owner)));
    expect(h.world.calls.filter((c) => c.method === 'DELETE').map((c) => c.path.split('?')[0])).toEqual([
      fixtures[1].owner,
    ]);
    expect(h.world.calls.at(-1)?.path).toContain('http/sessions');
  },
);

it.each(fixtures.flatMap((f) => (['present', 'uncertain'] as const).map((outcome) => [f.type, outcome] as const)))(
  'retains historical deletions when terminal %s absence becomes %s',
  async (type, outcome) => {
    const h = ddicHarness(),
      target = fixtures.find((f) => f.type === type)!;
    let saved = '',
      armed = false,
      observed = 0;
    h.hooks.record = (row) => {
      if (row.stageStarted === `delete-${type}`) saved = h.world.objects.get(target.owner)!.metadata;
      if (row.stageCompleted === 'delete-DOMA') {
        armed = true;
        if (outcome === 'present') h.world.objects.get(target.owner)!.metadata = saved;
      }
    };
    h.hooks.before = (url, input) => {
      if (armed && input.method === 'GET' && url.pathname === target.owner) {
        observed++;
        if (outcome === 'uncertain') throw new Error('Synthetic unavailable terminal absence.');
      }
    };
    const result = await h.run();
    expect(observed).toBe(1);
    expect(result).toMatchObject({
      failure: true,
      confirmedDeleted: [fixtures[1].owner, fixtures[0].owner],
      remaining: [target.owner],
      inspectionRequired: [target.owner],
      cleanupUnconfirmed: false,
      finalAbsenceConfirmed: false,
    });
    expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(2);
  },
);

it('reports both owners as uncertain if the final suffix inventory is unavailable', async () => {
  const h = ddicHarness();
  let count = 0;
  h.hooks.before = (url) => {
    if (url.pathname.endsWith('/inactiveobjects') && ++count === 2) throw new Error('Synthetic unavailable inventory.');
  };
  const result = await h.run();
  expect(result).toMatchObject({
    failure: true,
    confirmedDeleted: [fixtures[1].owner, fixtures[0].owner],
    cleanupUnconfirmed: false,
    finalAbsenceConfirmed: false,
  });
  expect(new Set(result.remaining)).toEqual(new Set(fixtures.map((f) => f.owner)));
  expect(new Set(result.inspectionRequired)).toEqual(new Set(fixtures.map((f) => f.owner)));
  expect(h.world.calls.filter((c) => c.method === 'DELETE')).toHaveLength(2);
});
