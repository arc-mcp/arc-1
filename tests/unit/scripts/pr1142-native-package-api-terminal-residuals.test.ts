import { expect, it } from 'vitest';
import { packageApiOwners } from '../../../scripts/qualification/pr1142/native-package-api-profile.js';
import { graph, retainedHarness } from './pr1142-native-package-api-retained-harness.js';

it.each(
  [false, true].flatMap((proxy) =>
    ['root', 'child', 'clas'].flatMap((key) =>
      ['present', 'unavailable', 'untyped-404'].map((fault) => ({ proxy, key, fault })),
    ),
  ),
)('retains the current terminal $key $fault observation (proxy=$proxy)', async ({ proxy, key, fault }) => {
  const owner = graph[key as 'root' | 'child' | 'clas'].owner;
  const h = await retainedHarness({ proxy });
  const body = (await h.client.http.get(owner)).body;
  h.calls.length = 0;
  let final = false;
  let reads = 0;
  h.hooks.record = (row) => {
    if (row.stageComplete === 'delete-root') final = true;
  };
  h.hooks.reply = (request) => {
    if (!final || request.method !== 'GET' || request.path !== owner || ++reads !== 2) return;
    return {
      statusCode: fault === 'present' ? 200 : fault === 'unavailable' ? 503 : 404,
      data: fault === 'present' ? body : 'Unqualified native absence',
    };
  };
  const result = await h.run();
  expect(reads).toBe(2);
  expect(result).toMatchObject({
    failure: true,
    confirmedDeleted: packageApiOwners(graph)
      .map((value) => value.owner)
      .reverse(),
    remaining: [owner],
    inspectionRequired: [owner],
    finalAbsenceConfirmed: false,
    cleanupUnconfirmed: false,
  });
  expect(h.calls.filter((request) => request.method === 'DELETE')).toHaveLength(6);
});
