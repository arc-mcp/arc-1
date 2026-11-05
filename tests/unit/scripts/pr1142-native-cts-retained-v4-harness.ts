/** Actual own deleted-record starting bodies; subsequent release outcomes are synthetic. */
import { readFileSync } from 'node:fs';
import {
  CTS_BASE,
  CTS_RETAINED_SUFFIX,
  ctsFixtures,
  retainedCtsRequest,
} from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
import { harness } from './pr1142-native-cts-harness.js';
export const ctsV4Bodies = Object.fromEntries(
  ['parent', 'task', 'absent'].map((name) => [
    name,
    readFileSync(new URL(`../../fixtures/qualification/cts-retained-v4/${name}.xml`, import.meta.url), 'utf8'),
  ]),
);
export function retainedV4Harness(options: Parameters<typeof harness>[1] = {}) {
  const h = harness(ctsFixtures(CTS_RETAINED_SUFFIX), options),
    own = retainedCtsRequest('retained-v4'),
    cls = h.graph.classes[0];
  h.trees.set(own.parent, {
    parent: own.parent,
    task: own.task,
    description: own.description,
    parentStatus: 'D',
    taskStatus: 'D',
    taskOwner: 'MARIAN',
    taskType: own.taskType,
    taskExists: true,
    exists: true,
    objects: [
      `<t:abap_object t:pgmid="R3TR" t:type="CLAS" t:name="${cls.name}" t:position="000001" t:lock_status="X"/>`,
    ],
  });
  let released = false;
  const initial = (r: (typeof h.calls)[number]) => {
    if (r.method === 'POST' && r.path === CTS_BASE + own.task + '/newreleasejobs') released = true;
  };
  const reply = (r: (typeof h.calls)[number]) => {
    if (r.method !== 'GET') return;
    if (!released && [CTS_BASE + own.parent, CTS_BASE + own.task].includes(r.path))
      return { statusCode: 200, data: ctsV4Bodies[r.path.endsWith(own.parent) ? 'parent' : 'task'] };
    if (r.path === cls.owner && !h.classes.get(cls.owner)!.exists) return { statusCode: 404, data: ctsV4Bodies.absent };
  };
  h.hooks.before = initial;
  h.hooks.reply = reply;
  return {
    ...h,
    initial,
    reply,
    runV4: (extra: Parameters<typeof h.run>[2] = {}) => h.run('A', undefined, { profile: 'retained-v4', ...extra }),
  };
}
