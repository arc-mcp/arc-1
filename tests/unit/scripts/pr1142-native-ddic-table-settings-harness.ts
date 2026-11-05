import { readFileSync } from 'node:fs';
import {
  settingsTailFixtures,
  TABLE_SETTINGS_SUFFIX,
} from '../../../scripts/qualification/pr1142/native-ddic-table-settings-fixed.js';
import { tableHarness } from './pr1142-native-ddic-table-harness.js';

const { runSettingsTailGraph } = await import(
  '../../../scripts/qualification/pr1142/native-ddic-table-settings-runner.js'
);
export const fixtures = settingsTailFixtures(TABLE_SETTINGS_SUFFIX);
const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/pr1142-table-settings-tail/${name}`, import.meta.url), 'utf8');
export const tableActive = fixture('table-active.xml'),
  tableInactive = fixture('table-inactive.xml'),
  settingsInactive = fixture('settings-inactive.xml'),
  settingsActive = fixture('settings-active.xml'),
  retainedSource = fixture('source.ddl');
export function settingsTailHarness(options: Parameters<typeof tableHarness>[0] = {}) {
  const h = tableHarness(options);
  let activated = false,
    stopped = false;
  const views = { tableInactive, settingsActive };
  const seed = () => {
    h.useFixtures(fixtures);
    activated = false;
    views.tableInactive = tableInactive;
    views.settingsActive = settingsActive;
    Object.assign(h.world.objects.get(fixtures[0].owner)!, { metadata: tableActive, source: retainedSource });
    h.world.objects.get(fixtures[1].owner)!.metadata = settingsInactive;
  };
  seed();
  const previous = h.hooks.reply!;
  h.hooks.reply = (url, method, body) => {
    const [parent, settings] = fixtures;
    const response = (data: string) => ({
      statusCode: 200,
      data,
      responseOptions: { headers: { 'content-type': 'application/xml' } },
    });
    if (
      method === 'GET' &&
      url.pathname.toLowerCase() === parent.owner.toLowerCase() &&
      h.world.objects.get(parent.owner)!.metadata
    )
      return response(
        !activated && url.searchParams.get('version') === 'inactive'
          ? views.tableInactive
          : h.world.objects.get(parent.owner)!.metadata,
      );
    if (method === 'GET' && url.pathname === settings.owner && h.world.objects.get(settings.owner)!.metadata)
      return response(
        !activated && url.searchParams.get('version') === 'active'
          ? views.settingsActive
          : h.world.objects.get(settings.owner)!.metadata,
      );
    if (
      method === 'POST' &&
      url.pathname === '/sap/bc/adt/activation' &&
      url.searchParams.get('preauditRequested') === 'false' &&
      body.includes(settings.owner) &&
      !h.world.faults.has('still-inactive')
    ) {
      activated = true;
      h.world.objects.get(settings.owner)!.metadata = h.world.objects
        .get(settings.owner)!
        .metadata.replace(/<atom:link[^>]*rel="http:\/\/www.sap.com\/adt\/relations\/objectstates"[^>]*\/>/, '')
        .replace('adtcore:version="inactive"', 'adtcore:version="active"');
    }
    return previous(url, method, body);
  };
  h.runtime.execute = runSettingsTailGraph;
  return {
    ...h,
    seed,
    views,
    stop: () => {
      stopped = true;
      h.stop();
    },
    run: () =>
      runSettingsTailGraph({
        base: h.client,
        fixtures,
        freshUntil: Date.now() + 240000,
        verify: h.verify,
        shouldStop: () => stopped,
        record: (r) => {
          h.records.push(r);
          h.hooks.record?.(r);
        },
      }),
  };
}
