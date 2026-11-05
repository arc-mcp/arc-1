/** Actual retained A receipts; future A-parent/B/C transitions are synthetic, not native evidence. */
import { readFileSync } from 'node:fs';
import {
  CTS_BASE,
  CTS_RETAINED_SUFFIX,
  ctsFixtures,
  retainedCtsRequest,
} from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
import { harness } from './pr1142-native-cts-harness.js';
export const v5Bodies = Object.fromEntries(
  ['parent', 'task', 'release'].map((n) => [
    n,
    readFileSync(new URL(`../../fixtures/qualification/cts-retained-v5/${n}.xml`, import.meta.url), 'utf8'),
  ]),
);
export function retainedV5Harness(options: Parameters<typeof harness>[1] = {}) {
  const h = harness(ctsFixtures(CTS_RETAINED_SUFFIX), options),
    own = retainedCtsRequest('retained-v5');
  h.trees.set(own.parent, {
    parent: own.parent,
    task: own.task,
    description: own.description,
    parentStatus: 'D',
    taskStatus: 'R',
    taskOwner: 'MARIAN',
    taskType: own.taskType,
    taskExists: true,
    exists: true,
    objects: [],
  });
  const initial = (r: (typeof h.calls)[number]) => {
    const t = [...h.trees.values()].find(
      (t) => r.path === CTS_BASE + t.parent + '/newreleasejobs' || r.path === CTS_BASE + t.task + '/newreleasejobs',
    );
    if (t && r.method === 'POST') {
      if (r.path.includes(t.task)) t.taskStatus = 'R';
      else t.parentStatus = 'R';
    }
  };
  const reply = (r: (typeof h.calls)[number]) => {
    const t = [...h.trees.values()].find((t) =>
      [
        CTS_BASE + t.parent,
        CTS_BASE + t.task,
        CTS_BASE + t.parent + '/newreleasejobs',
        CTS_BASE + t.task + '/newreleasejobs',
      ].includes(r.path),
    );
    if (!t) return;
    if (r.method === 'POST' && r.path.includes('/newreleasejobs'))
      return {
        statusCode: 200,
        data: v5Bodies.release.replaceAll(own.task, r.path.includes(t.task) ? t.task : t.parent),
      };
    if (r.method !== 'GET') return;
    if (t.parent === own.parent)
      return {
        statusCode: 200,
        data:
          r.path === CTS_BASE + own.task
            ? v5Bodies.task
            : t.parentStatus === 'D'
              ? v5Bodies.parent
              : v5Bodies.parent.replace('tm:status="D"', 'tm:status="R"'),
      };
    // Only B release changes representation. Earlier synthetic class records are position1 as native A.
    t.objects = t.objects.map((x) => x.replace('000010', '000001'));
    if (t.taskStatus !== 'R') return;
    const full = r.path === CTS_BASE + t.parent;
    const cls = h.graph.classes[1].name;
    const replace = (body: string) =>
      body
        .replaceAll(own.parent, t.parent)
        .replaceAll(own.task, t.task)
        .replaceAll(h.graph.classes[0].name, cls)
        .replaceAll(own.description, t.description)
        .replace('tm:status="D"', `tm:status="${t.parentStatus}"`);
    return { statusCode: 200, data: replace(full ? v5Bodies.parent : v5Bodies.task) };
  };
  h.hooks.before = initial;
  h.hooks.reply = reply;
  return {
    ...h,
    initial,
    reply,
    runV5: (extra: Parameters<typeof h.run>[2] = {}) => h.run('A', undefined, { profile: 'retained-v5', ...extra }),
  };
}
