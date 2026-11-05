/** Private TABL/DTT profile: parent-table package, draft-visible patch under the settings lock, read-back. */
import { withLockedMutation } from '../../adt/crud.js';
import { AdtSafetyError } from '../../adt/errors.js';
import { throwIfRequestCancelled } from '../../adt/http-deadline.js';
import { mutationClient } from '../../adt/mutation-client.js';
import { pinnedDdicSelection, readPinnedDdicEvidence } from '../../adt/pinned-ddic-owner.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import {
  assertTableSettingsService,
  parseTableSettings,
  parseTableSettingsPatch,
  patchTableSettingsXml,
  TABLE_SETTINGS_CONTENT_TYPE,
  type TableSettingsPatch,
} from '../../adt/table-settings.js';
import { type ToolResult, textResult } from '../shared.js';
import type { SapWriteContext } from './context.js';
import { pinnedSourceLockPolicy } from './pinned-lock.js';
import { pinnedSourceState } from './pinned-source-context.js';

function parsePatch(ctx: SapWriteContext): TableSettingsPatch {
  try {
    return parseTableSettingsPatch(String(ctx.args.source));
  } catch (error) {
    throw new AdtSafetyError(error instanceof Error ? error.message : 'Invalid TABL/DTT source.');
  }
}

function assertPatchSaved(xml: string, name: string, patch: TableSettingsPatch): void {
  const { source } = parseTableSettings(xml, name);
  const buffering = patch.buffering ?? {};
  const matches =
    (patch.dataClass === undefined || source.dataClass === patch.dataClass) &&
    (patch.sizeCategory === undefined || source.sizeCategory === patch.sizeCategory) &&
    (patch.loggingEnabled === undefined || source.loggingEnabled === patch.loggingEnabled) &&
    Object.entries(buffering).every(
      ([field, value]) => value === undefined || source.buffering[field as keyof typeof source.buffering] === value,
    );
  if (!matches)
    throw new AdtSafetyError('Save returned, but technical settings read-back differs. Inspect before continuing.');
}

export async function writePinnedTableSettings(ctx: SapWriteContext): Promise<ToolResult> {
  const state = pinnedSourceState(ctx);
  const { client, args, name, objectUrl } = ctx;
  const patch = parsePatch(ctx);
  await assertTableSettingsService(client.http, client.safety);
  await ctx.enforcePackageForExistingObject();
  const { context, recording, pkg } = state;
  if (!pkg || !recording)
    throw new AdtSafetyError('Settings updates require verified package and recording preflight.');
  const selected = pinnedDdicSelection('TABL/DTT', name);
  const policy = pinnedSourceLockPolicy(client, context, objectUrl, pkg, recording, (phase) => {
    state.phase = phase;
  });
  await withLockedMutation(client.http, client.safety, context, objectUrl, policy, async (session, lock) => {
    const current = mutationClient(client, context, session);
    state.phase = 'metadata-read';
    // Two-user evidence: only the explicit inactive view exposes another user's pending settings.
    const stored = await readPinnedDdicEvidence(current, selected, 'inactive');
    if (args.expectedMetadataHash !== undefined && args.expectedMetadataHash !== stored.hash)
      throw new AdtSafetyError(
        'The stored settings changed since they were read. No write was sent. Re-read them first.',
      );
    state.phase = 'edit-preparation';
    let body: string;
    try {
      body = patchTableSettingsXml(stored.xml, name, patch);
    } catch (error) {
      throw new AdtSafetyError(error instanceof Error ? error.message : 'The settings could not be patched safely.');
    }
    if (body === stored.xml) {
      state.unchangedConfirmed = true;
      state.metadata = { hash: stored.hash, nativeVersion: stored.version };
      return;
    }
    checkOperation(client.safety, OperationType.Update, 'PinnedTableSettingsSave');
    throwIfRequestCancelled(context.requestPolicy);
    state.phase = 'metadata-save';
    state.state = 'metadata-save-unknown';
    state.writeAttempted = true;
    const params = new URLSearchParams({ lockHandle: lock.lockHandle });
    if (recording.request) params.set('corrNr', recording.request);
    await session.put(`${objectUrl}?${params}`, body, TABLE_SETTINGS_CONTENT_TYPE, {
      Accept: TABLE_SETTINGS_CONTENT_TYPE,
    });
    state.phase = 'metadata-readback';
    const saved = await readPinnedDdicEvidence(current, selected, 'inactive');
    assertPatchSaved(saved.xml, name, patch);
    state.metadata = { hash: saved.hash, nativeVersion: saved.version };
    state.state = saved.version === 'active' ? 'saved-active' : 'saved-inactive';
  });
  return textResult('');
}
