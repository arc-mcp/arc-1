/** Synthetic retained graph, seeded by the original actual-adapter lifecycle, never native evidence. */
import { vi } from 'vitest';
import { ddicHash } from '../../../scripts/qualification/pr1142/native-ddic-evidence.js';
import {
  ENHO_RETAINED_BODIES,
  ENHO_RETAINED_MODE,
  ENHO_RETAINED_SUFFIX,
  retainedEnhoFixtures,
} from '../../../scripts/qualification/pr1142/native-enho-retained-fixed.js';
import { enhoHarness } from './pr1142-native-enho-harness.js';

const expected = vi.hoisted(() => ({ bodies: {} as Record<string, string> }));
vi.mock('../../../scripts/qualification/pr1142/native-enho-retained-state.js', async (original) => {
  const actual = await original<typeof import('../../../scripts/qualification/pr1142/native-enho-retained-state.js')>();
  return {
    ...actual,
    readRetainedEnhoStart: (...args: Parameters<typeof actual.readRetainedEnhoStart>) =>
      actual.readRetainedEnhoStart(args[0], args[1], args[2], args[3], expected.bodies),
    retainedEnhoCounterpart: (...args: Parameters<typeof actual.retainedEnhoCounterpart>) =>
      actual.retainedEnhoCounterpart(args[0], args[1], args[2], args[3], expected.bodies),
  };
});
const { runNativeEnho } = await import('../../../scripts/qualification/pr1142/native-enho-driver.js');
export const retainedFixtures = retainedEnhoFixtures(ENHO_RETAINED_SUFFIX);
export async function retainedHarness(options: Parameters<typeof enhoHarness>[0] = {}) {
  const seed = enhoHarness({}, retainedFixtures);
  seed.hooks.record = (r) => {
    if (r.stageCompleted === 'update-ENHO') seed.stop();
  };
  const seeded = await seed.run();
  if (seeded.completed.at(-1) !== 'update-ENHO') throw new Error('Synthetic retained seed failed.');
  const h = enhoHarness(options, retainedFixtures, (input) => runNativeEnho(input, ENHO_RETAINED_MODE));
  for (const [k, v] of seed.world.objects) h.world.objects.set(k, { ...v });
  const child = retainedFixtures[1],
    parent = retainedFixtures[0];
  const alternate = (xml: string, v: string) =>
    xml.replace(
      '</enho:objectData>',
      `<atom:link xmlns:atom="http://www.w3.org/2005/Atom" rel="http://www.sap.com/adt/relations/objectstates" href="./${child.name.toLowerCase()}?version=${v}"/></enho:objectData>`,
    );
  h.world.objects.get(child.owner)!.metadata = alternate(h.world.objects.get(child.owner)!.metadata, 'active');
  h.changeActive(alternate(seed.activeDocument()!, 'inactive'));
  expected.bodies = Object.fromEntries(
    Object.keys(ENHO_RETAINED_BODIES).map((p) => {
      const body = p.startsWith(parent.owner)
        ? p.includes('/source/main')
          ? h.world.objects.get(parent.owner)!.source!
          : h.world.objects.get(parent.owner)!.metadata
        : p.startsWith(child.owner)
          ? p.endsWith('=active')
            ? h.activeDocument()!
            : h.world.objects.get(child.owner)!.metadata
          : p.includes('/enhancements/enhsxsb/')
            ? h.dependency.spot
            : p.endsWith('/source/main')
              ? h.dependency.source
              : h.dependency.iface;
      return [p, ddicHash(body)];
    }),
  );
  const reply = h.hooks.reply!;
  h.hooks.reply = (u, m, b) => {
    const result = reply(u, m, b);
    if (
      m === 'POST' &&
      u.pathname === '/sap/bc/adt/activation' &&
      u.searchParams.get('preauditRequested') === 'false'
    ) {
      const o = h.world.objects.get(child.owner)!;
      o.metadata = o.metadata.replace(
        /<atom:link[^>]*rel="http:\/\/www.sap.com\/adt\/relations\/objectstates"[^>]*\/>/g,
        '',
      );
      h.changeActive(o.metadata);
    }
    return result;
  };
  return h;
}
