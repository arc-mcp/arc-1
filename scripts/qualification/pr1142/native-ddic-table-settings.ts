/** Separate permanent claim for the exact unfinished table graph. */
import { readFixedCollectionsIntent } from './native-ddic-collections-prerequisites.js';
import { type DdicPhaseDependencies, runFixedDdicPhases } from './native-ddic-phases.js';
import { type TableFixture, tableDeletedOwners } from './native-ddic-table-fixtures.js';
import {
  settingsTailFixtures,
  settingsTailOwners,
  TABLE_SETTINGS_PROTOCOL,
  TABLE_SETTINGS_STAGES,
  TABLE_SETTINGS_SUFFIX,
} from './native-ddic-table-settings-fixed.js';
import { verifySettingsTailHistory } from './native-ddic-table-settings-history.js';
import { isDirectEntry } from './native-declarative-entry.js';
export function runNativeSettingsTailPhases(
  args: string[],
  dependencies?: DdicPhaseDependencies<TableFixture> & { verifyHistory: () => void },
) {
  return runFixedDdicPhases(
    args,
    new URL(import.meta.url),
    {
      protocol: TABLE_SETTINGS_PROTOCOL,
      flag: 'ddic-table-settings-tail-v1',
      suffixBytes: 6,
      fixedSuffix: TABLE_SETTINGS_SUFFIX,
      retainedOwners: settingsTailOwners(),
      inventory: 'valid-unfiltered',
      verifyHistory: dependencies?.verifyHistory ?? verifySettingsTailHistory,
      stages: TABLE_SETTINGS_STAGES,
      failureGraph: 'fixed-settings-activation-parent-coupling-tail',
      deletedOwners: tableDeletedOwners,
      fixtures: settingsTailFixtures,
      intent: (binding) => readFixedCollectionsIntent(binding, TABLE_SETTINGS_PROTOCOL, settingsTailFixtures),
      helpers: async () => {
        const h = await import('./native-ddic-table-settings-runner.js');
        return { runtime: h.settingsTailRuntime, client: h.ddicClient, preflight: h.settingsTailPreflight };
      },
    },
    dependencies,
  );
}
if (isDirectEntry(process.argv[1], import.meta.url)) {
  try {
    const result = await runNativeSettingsTailPhases(process.argv.slice(2));
    console.log(JSON.stringify(result));
    process.exitCode = result.failure ? 1 : 0;
  } catch {
    console.error('Fixed retained table graph stopped. Preserve original and new claims and residuals; never replay.');
    process.exitCode = 1;
  }
}
