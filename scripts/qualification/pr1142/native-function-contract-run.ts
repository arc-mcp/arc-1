/** Mockable native-protocol orchestration; no credentials, process controls or filesystem access. */
import type { AdtClient } from '../../../src/adt/client.js';
import { activate } from '../../../src/adt/devtools.js';
import { AdtApiError, classifySapDomainError, extractExceptionType } from '../../../src/adt/errors.js';
import { prepareFunctionSourceVerification } from "../../../src/adt/source-precondition.js";
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { mutationClient } from '../../../src/adt/mutation-client.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { createPinnedFunctionContext } from '../../../src/handlers/write/pinned-function-context.js';
import { pinnedSourceState } from '../../../src/handlers/write/pinned-source-context.js';
import { executePinnedSourceWrite } from '../../../src/handlers/write/pinned-source-write.js';
import type { ServerConfig } from '../../../src/server/types.js';
import {
  type ContractActiveReceipt,
  type ContractGroupBaseline,
  captureContractGroupBaseline,
  nextContractActiveReceipt,
  verifyContractActiveReceipt,
  verifyContractGroupBaseline,
} from './native-contract-inventory.js';
import {
  contractIdentity,
  contractFunctionMetadataHash,
  contractMetadataHash,
  contractRequestPolicy,
  type NativeContractSelection,
  observeContractHttp,
} from './native-contract-transport.js';

export interface NativeContractRunResult {
  failure: boolean;
  remaining: string[];
  pendingCreation: string[];
  cleanupIssues: string[];
  inspectionRequired: string[];
  stopped: boolean;
  cleanupUnconfirmed: boolean;
  activeDeletionVerified: boolean;
}

export async function runNativeFunctionContract({
  base,
  config,
  selection,
  marker,
  record,
  verifySource,
  shouldStop,
  activatedCleanup = 'preserve',
}: {
  base: AdtClient;
  config: ServerConfig;
  selection: NativeContractSelection;
  marker: string;
  record: (value: unknown) => void;
  verifySource: () => void;
  shouldStop: () => boolean;
  activatedCleanup?: 'preserve' | 'delete-verified-active';
}): Promise<NativeContractRunResult> {
  const receipts = new Map<string, { hash: string; metadataHash: string; active?: ContractActiveReceipt }>();
  let groupBaseline: ContractGroupBaseline | undefined;
  let activatedFixturePreserved = false;
  let activeDeletionSelected = false;
  let activeDeletionVerified = false;
  const attempted = new Set<string>();
  const blocked = new Set<string>();
  const creationUnknown = new Set<string>();
  const cleanupIssues = new Set<string>();
  function preserve(path: string) {
    blocked.add(path);
    if (path === selection.moduleUrl) blocked.add(selection.groupUrl);
  }
  async function absent(http: AdtHttpClient, path: string, policy?: AdtRequestOptions) {
    try {
      await http.get(path, { Accept: 'application/*', 'Cache-Control': 'no-cache' }, contractRequestPolicy(policy));
      return false;
    } catch (error) {
      if (
        error instanceof AdtApiError &&
        error.statusCode === 404 &&
        extractExceptionType(error.responseBody ?? '') === 'ExceptionResourceNotFound' &&
        !classifySapDomainError(error.statusCode, error.responseBody, error.path)
      ) {
        record({ absence: path, status: 404, exception: error.responseBody });
        return true;
      }
      throw error;
    }
  }
  async function snapshot(http: AdtHttpClient, path: string, policy?: AdtRequestOptions, active = false) {
    const group = path === selection.groupUrl;
    const metadata = await http.get(
      active ? `${path}?version=active` : path,
      { Accept: 'application/*', 'Cache-Control': 'no-cache' },
      contractRequestPolicy(policy),
    );
    record({
      snapshotMetadata: path,
      active,
      status: metadata.statusCode,
      ...(Buffer.byteLength(metadata.body) <= 1024 * 1024 ? { body: metadata.body } : { oversized: true }),
    });
    const identity = contractIdentity(metadata.body, group, selection, marker);
    const source = await http.get(
      `${path}/source/main?version=${active ? 'active' : 'inactive'}`,
      { Accept: 'text/plain', 'Cache-Control': 'no-cache' },
      contractRequestPolicy(policy),
    );
    const hash = sourceHash(source.body);
    if (
      source.statusCode !== 200 ||
      Buffer.byteLength(source.body) > 1024 * 1024 ||
      source.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'text/plain'
    )
      throw new Error('A complete bounded native source response is required for fixture ownership.');
    const metadataHash = group
      ? contractMetadataHash(metadata.body)
      : contractFunctionMetadataHash(metadata.body, selection);
    record({
      snapshot: path,
      requestedVersion: active ? 'active' : 'inactive-source/default-metadata',
      nativeVersion: identity.nativeVersion ?? null,
      hash,
      metadataHash,
      metadata: metadata.body,
      source: source.body,
    });
    return { hash, metadataHash, source: source.body, ...identity };
  }
  async function beforeDelete(_owning: AdtHttpClient, path: string, policy: AdtRequestOptions) {
    verifySource();
    // These are additional fixture-verification reads, not the production owner/package checks.
    // Keep versioned display reads on the original identity's stateless connection while the
    // mutation retains its owning lock. Passive SM12 evidence observed a lock disappear after
    // an inactive metadata read in that owning session; it did not establish the exact cause.
    const http = client.http;
    if (activatedCleanup === 'delete-verified-active' && shouldStop())
      throw new Error('The explicit active-deletion qualification was stopped.');
    const receipt = receipts.get(path);
    const current = await snapshot(http, path, policy);
    if (!receipt || blocked.has(path) || current.hash !== receipt.hash || current.metadataHash !== receipt.metadataHash)
      throw new Error('Cleanup requires an unchanged, confirmed fixture receipt under its owning lock.');
    if (path === selection.moduleUrl) {
      const active = await snapshot(http, path, policy, true);
      if (
        active.nativeVersion === 'active' &&
        active.hash === receipt.hash &&
        receipt.active?.sourceHashes.some((hash) => hash !== receipt.hash)
      ) {
        preserve(path);
        activatedFixturePreserved = true;
        record({ preservedAfterUnexpectedActivation: path, hash: active.hash });
        throw new Error('Saved module source is already active; individual deletion remains unqualified.');
      }
      if (activeDeletionSelected && active.nativeVersion !== 'active')
        throw new Error('Active deletion qualification requires a fresh native active version under the lock.');
      verifyContractActiveReceipt(receipt.active, active);
    }
    if (path === selection.groupUrl) {
      if (!(await absent(http, selection.moduleUrl, policy)))
        throw new Error('The function module must be absent before group deletion.');
      await verifyContractGroupBaseline(http, selection, marker, groupBaseline, record, policy);
    }
    if (activatedCleanup === 'delete-verified-active' && shouldStop())
      throw new Error('The explicit active-deletion qualification was stopped during verification.');
  }
  const client = Object.assign(Object.create(Object.getPrototypeOf(base)), base, {
    http: observeContractHttp(base.http, selection, record, beforeDelete),
  }) as AdtClient;
  async function action(type: 'FUGR' | 'FUNC', action: string, extra: Record<string, unknown> = {}) {
    verifySource();
    if (shouldStop() && action !== 'delete')
      throw new Error('Forward work stopped; attempting only confirmed fixture cleanup.');
    const path = type === 'FUGR' ? selection.groupUrl : selection.moduleUrl;
    const context = pinnedMutationContext(client.safety, { deadline: Date.now() + 60_000 }, { unlockFailed: false });
    const input = {
      type,
      action,
      name: type === 'FUGR' ? selection.group : selection.module,
      ...(type === 'FUNC' ? { group: selection.group } : {}),
      ...(action === 'create' ? { description: marker, package: '$TMP' } : {}),
      ...extra,
    };
    const ctx = await createPinnedFunctionContext(client, input, config, context);
    const state = pinnedSourceState(ctx);
    if (action === 'create') {
      attempted.add(path);
      record({ creationAttempt: path });
    }
    const result = await executePinnedSourceWrite(ctx);
    if (result.isError && (state.writeAttempted || state.createdOwner)) preserve(path);
    if (
      context.cleanup.unlockFailed ||
      context.cleanup.sessionClosed === false ||
      (action === 'delete' && context.cleanup.sessionClosed !== true) ||
      context.cleanup.unknownLocks?.length
    ) {
      preserve(path);
      cleanupIssues.add(path);
    }
    if (action === 'create' && state.state === 'creation-unknown') {
      creationUnknown.add(path);
      preserve(path);
      blocked.add(selection.groupUrl);
      record({
        creationUnknown: path,
        next: 'A current 404 cannot rule out late completion; recheck later without retrying creation.',
      });
    }
    record({
      input,
      result,
      ...(action === 'delete' ? {} : { phase: state.phase, state: state.state }),
      cleanup: context.cleanup,
    });
    if (result.isError || (action === 'delete' && cleanupIssues.has(path))) {
      throw new Error(`Native contract ${type}/${action} did not complete; inspect private receipts.`);
    }
    if (action !== 'delete') {
      try {
        const readback = await snapshot(client.http, path);
        if (type === 'FUNC' && action === 'update' && readback.changedBy !== 'MARIAN') {
          preserve(path);
          throw new Error('The native function update did not report the expected last changer.');
        }
        if (readback.hash !== state.sourceHash) {
          preserve(path);
          throw new Error('Independent source hash differs from the adapter result.');
        }
        const active =
          type === 'FUNC'
            ? nextContractActiveReceipt(
                receipts.get(path)?.active,
                await snapshot(client.http, path, undefined, true),
                readback.hash,
              )
            : undefined;
        receipts.set(path, { hash: readback.hash, metadataHash: readback.metadataHash, active });
      } catch (error) {
        preserve(path);
        throw error;
      }
    }
    return state;
  }
  let failure = false;
  let outcome: NativeContractRunResult | undefined;
  try {
    for (const path of [selection.groupUrl, selection.moduleUrl])
      if (!(await absent(client.http, path))) throw new Error('A proposed fixture already exists.');
    await action('FUGR', 'create');
    groupBaseline = await captureContractGroupBaseline(client.http, selection, marker, record);
    await action('FUNC', 'create');
    const source = `FUNCTION ${selection.module}\n  IMPORTING\n    VALUE(IV_TEXT) TYPE STRING DEFAULT 'MiXeD'.\n  DATA(lv_text) = iv_text.\n  " ${marker}\nENDFUNCTION.\n`;
    const matches = prepareFunctionSourceVerification(source, selection.module);
    await action('FUNC', 'update', { source, expectedSourceHash: receipts.get(selection.moduleUrl)!.hash });
    if (!matches((await snapshot(client.http, selection.moduleUrl)).source))
      throw new Error('Native function frame/body comparison failed.');
    verifySource();
    if (shouldStop()) throw new Error('Stopped before preaudit.');
    const context = pinnedMutationContext(client.safety, { deadline: Date.now() + 60_000 }, { unlockFailed: false });
    const scoped = mutationClient(client, context);
    let validations = 0;
    const captured = new Error('Native preaudit captured; confirmation deliberately not sent.');
    try {
      const result = await activate(scoped.http, scoped.safety, selection.moduleUrl, {
        name: selection.module,
        validateReferences: async (refs) => {
          record({ activationReferences: refs });
          if (++validations > 1) throw captured;
        },
      });
      record({ nativeActivation: result });
      if (!result.success) throw new Error('Native activation did not succeed.');
      // A successful activation flag does not prove that the requested source became active.
      const previouslyBlocked = blocked.has(selection.moduleUrl) || blocked.has(selection.groupUrl);
      preserve(selection.moduleUrl);
      const active = await snapshot(client.http, selection.moduleUrl, undefined, true);
      const saved = receipts.get(selection.moduleUrl)!;
      if (active.nativeVersion !== 'active')
        throw new Error(
          `SAP did not report the native active version (reported: ${JSON.stringify(active.nativeVersion ?? '<missing>').slice(0, 80)}); an active GET may have fallen back to an inactive draft.`,
        );
      if (active.hash !== saved.hash || active.metadataHash !== saved.metadataHash)
        throw new Error('SAP reported activation but the active source or owner does not match the saved receipt.');
      receipts.set(selection.moduleUrl, {
        ...saved,
        active: { metadataHash: active.metadataHash, sourceHashes: [active.hash] },
      });
      activatedFixturePreserved = true;
      record({
        activeSourceVerified: selection.moduleUrl,
        hash: active.hash,
        metadataHash: active.metadataHash,
        nativeVersion: active.nativeVersion,
      });
      if (
        activatedCleanup === 'delete-verified-active' &&
        !previouslyBlocked &&
        !cleanupIssues.size &&
        !creationUnknown.size &&
        !shouldStop()
      ) {
        // Only this explicit native qualification mode may clear the deliberate preservation.
        // Pre-existing uncertainty and an activation prompt never reach this release point.
        blocked.delete(selection.moduleUrl);
        blocked.delete(selection.groupUrl);
        activatedFixturePreserved = false;
        activeDeletionSelected = true;
        record({ verifiedActiveDeletionSelected: selection.moduleUrl });
      } else {
        record({
          preservedAfterActivation: selection.moduleUrl,
          reason: 'Activated fixture preserved; individual deletion requires the explicit native qualification mode.',
        });
      }
    } catch (error) {
      if (error !== captured) {
        blocked.add(selection.groupUrl);
        blocked.add(selection.moduleUrl);
        throw error;
      }
    }
  } catch (error) {
    failure = true;
    record({ failure: error instanceof Error ? error.message : 'unknown' });
  } finally {
    for (const [type, path] of [
      ['FUNC', selection.moduleUrl],
      ['FUGR', selection.groupUrl],
    ] as const) {
      if (!attempted.has(path)) continue;
      try {
        if (await absent(client.http, path)) {
          if (receipts.has(path)) {
            failure = true;
            preserve(path);
            record({
              unexpectedAbsence: path,
              next: 'No DELETE from this run explains this absence; inspect the preserved parent and receipts.',
            });
          }
          continue;
        }
        if (!receipts.has(path) || blocked.has(path))
          throw new Error(
            activatedFixturePreserved
              ? 'Activated fixture is deliberately preserved because individual module deletion remains unqualified.'
              : 'Unconfirmed fixture is preserved for operator inspection.',
          );
        await action(type, 'delete');
        if (!(await absent(client.http, path))) throw new Error('Deletion absence was not confirmed.');
        if (type === 'FUNC' && activeDeletionSelected) activeDeletionVerified = true;
      } catch (error) {
        failure = true;
        preserve(path);
        record({ cleanupFailure: path, message: error instanceof Error ? error.message : 'unknown' });
      }
    }
    const remaining: string[] = [];
    for (const path of attempted) {
      try {
        if (!(await absent(client.http, path))) remaining.push(path);
      } catch {
        remaining.push(path);
      }
    }
    const pendingCreation = [...creationUnknown];
    outcome = {
      failure: failure || (activatedCleanup === 'delete-verified-active' && !activeDeletionVerified),
      activeDeletionVerified,
      remaining,
      pendingCreation,
      cleanupIssues: [...cleanupIssues],
      inspectionRequired: [...blocked],
      stopped: shouldStop(),
      cleanupUnconfirmed:
        remaining.length > 0 || pendingCreation.length > 0 || cleanupIssues.size > 0 || blocked.size > 0,
    };
    record({ finished: true, ...outcome, authentication: 'Basic-native-contract-only' });
  }
  return outcome!;
}
