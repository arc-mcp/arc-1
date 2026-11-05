/** Saved owned native starting views with a synthetic post-save lifecycle; not native qualification. */
import { readFileSync } from 'node:fs';
import {
  CTS_BASE,
  CTS_RETAINED_SUFFIX,
  ctsFixtures,
  retainedCtsRequest,
} from '../../../scripts/qualification/pr1142/native-cts-fixtures.js';
import { CTS_RETAINED_V3_VIEWS } from '../../../scripts/qualification/pr1142/native-cts-retained-v3-evidence.js';
import { harness } from './pr1142-native-cts-harness.js';

const sources = JSON.parse(
  readFileSync(new URL('../../fixtures/qualification/cts-retained-v3/source-views.json', import.meta.url), 'utf8'),
) as Record<string, string>;
const read = (name: string) =>
  name.endsWith('.abap')
    ? sources[name]!
    : readFileSync(new URL(`../../fixtures/qualification/cts-retained-v3/${name}`, import.meta.url), 'utf8');
export const ctsV3Bodies = [
  'inactive.xml',
  'inactive.abap',
  'inactive.xml',
  'inactive.abap',
  'active.xml',
  'active.abap',
  'definitions.abap',
  'implementations.abap',
  'macros.abap',
].map(read);
export function retainedV3Harness(options: Parameters<typeof harness>[1] = {}) {
  const h = harness(ctsFixtures(CTS_RETAINED_SUFFIX), options),
    own = retainedCtsRequest('retained-v3'),
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
  const state = h.classes.get(cls.owner)!;
  state.exists = true;
  state.source = ctsV3Bodies[1];
  let saved = false;
  const initial = (r: (typeof h.calls)[number]) => {
    if (r.method === 'PUT' && r.path.startsWith(cls.owner + '/source/main')) saved = true;
  };
  const reply = (r: (typeof h.calls)[number]) => {
    if (r.method !== 'GET') return;
    if (!saved && [CTS_BASE + own.parent, CTS_BASE + own.task].includes(r.path))
      return { statusCode: 200, data: read(r.path.endsWith(own.parent) ? 'parent.xml' : 'task.xml') };
    const i = CTS_RETAINED_V3_VIEWS.findIndex(([path]) => r.path === cls.owner + path);
    if (i >= 0 && (!saved || i >= 6)) return { statusCode: 200, data: ctsV3Bodies[i] };
    if (!saved && r.path === '/sap/bc/adt/activation/inactiveobjects')
      return { statusCode: 200, data: read('inactive-owned.xml') };
  };
  h.hooks.before = initial;
  h.hooks.reply = reply;
  return {
    ...h,
    initial,
    reply,
    runV3: (extra: Parameters<typeof h.run>[2] = {}) => h.run('A', undefined, { profile: 'retained-v3', ...extra }),
  };
}
