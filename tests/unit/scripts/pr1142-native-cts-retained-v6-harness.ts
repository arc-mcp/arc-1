/** Actual released A views; B mappings are synthetic future coverage, never native evidence. */
import { readFileSync } from 'node:fs';
import { CTS_BASE, retainedCtsRequest } from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
import { retainedV5Harness, v5Bodies } from './pr1142-native-cts-retained-v5-harness.js';
export const v6Bodies = Object.fromEntries(
  ['parent', 'task'].map((n) => [
    n,
    readFileSync(new URL(`../../fixtures/qualification/cts-retained-v6/${n}.xml`, import.meta.url), 'utf8'),
  ]),
);
export function retainedV6Harness(options: Parameters<typeof retainedV5Harness>[0] = {}) {
  const h = retainedV5Harness(options),
    own = retainedCtsRequest('retained-v6');
  h.trees.get(own.parent)!.parentStatus = 'R';
  const reply = (r: (typeof h.calls)[number]) => {
    const t = [...h.trees.values()].find((t) => [CTS_BASE + t.parent, CTS_BASE + t.task].includes(r.path));
    if (r.method !== 'GET' || !t) return h.reply(r);
    if (t.parent === own.parent)
      return { statusCode: 200, data: r.path === CTS_BASE + own.parent ? v6Bodies.parent : v6Bodies.task };
    if (t.taskStatus !== 'R') return h.reply(r);
    const bodies = t.parentStatus === 'R' ? v6Bodies : v5Bodies;
    return {
      statusCode: 200,
      data: (r.path === CTS_BASE + t.parent ? bodies.parent : bodies.task)
        .replaceAll(own.parent, t.parent)
        .replaceAll(own.task, t.task)
        .replaceAll(h.graph.classes[0].name, h.graph.classes[1].name)
        .replaceAll(own.description, t.description),
    };
  };
  h.hooks.reply = reply;
  return {
    ...h,
    reply,
    runV6: (extra: Parameters<typeof h.run>[2] = {}) => h.run('A', undefined, { profile: 'retained-v6', ...extra }),
  };
}
