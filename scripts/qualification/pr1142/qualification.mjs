import { qualify as deletion } from './deletion-qualification.mjs';
import { durable } from './durable-journal.mjs';
import { qualify as formatter } from './formatter-qualification.mjs';
import { qualifyIncludes } from './include-qualification.mjs';
import { configuration } from './qualification-config.mjs';
import { HarnessError, privateJson } from './safe-io.mjs';

export async function recordFormatterRecovery(root, result, load = privateJson, write = durable) {
  if (result.journalOwned !== true) return;
  let parent;
  try {
    parent = await load(`${root}/deletion-qualification.json`);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const restored = await load(`${root}/formatter-qualification.json`);
  if (
    parent.plan !== 'delete-two-user-v1' ||
    restored.plan !== 'formatter-two-user-v2' ||
    ['runId', 'sourceRevision', 'harnessSha256', 'target'].some(
      (key) => parent[key] !== restored[key] || restored[key] !== result[key],
    )
  )
    throw new HarnessError('RECOVERY_PARENT_BINDING_MISMATCH');
  if (!parent.formatter && parent.formatterAttempted !== true)
    throw new HarnessError('RECOVERY_PARENT_FORMATTER_MISSING');
  if (parent.formatterRecovery) (parent.formatterRestorationHistory ??= []).push({ ...parent.formatterRecovery });
  else if (parent.formatter)
    (parent.formatterRestorationHistory ??= []).push({
      at: new Date().toISOString(),
      restored: parent.formatter.restored,
      restorationStatus: parent.formatter.restorationStatus,
      nativeSeedRestored: parent.formatter.nativeSeedRestored,
    });
  // Keep the original qualification failures; recovery success does not qualify the test run.
  // A crash can leave only formatterAttempted; never manufacture a completed formatter result.
  if (parent.formatter) {
    parent.formatter.restored = result.restored;
    parent.formatter.restorationStatus = result.restorationStatus;
    parent.formatter.nativeSeedRestored = result.nativeSeedRestored;
  }
  parent.formatterRecovery = { ...result, at: new Date().toISOString() };
  await write(`${root}/deletion-qualification.json`, parent);
}
export async function qualify(context) {
  if (context.action.plan === 'formatter-two-user-v2' && context.action.restoreOnly === true) {
    const result = await formatter(context);
    await recordFormatterRecovery(context.configurationOverride?.root ?? configuration.root, result);
    return result;
  }
  return deletion({
    ...context,
    includeQualifier: qualifyIncludes,
    formatterQualifier: async ({ sessions, sentinels }) =>
      formatter({ ...context, sessions, sentinels, action: { plan: 'formatter-two-user-v2' } }),
  });
}
