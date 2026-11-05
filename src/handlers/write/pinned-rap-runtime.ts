/** Exact-resource RAP policy over the shared generator, lock coordinator and activation adapter. */

import { pinnedClassIncludeAbsent, savePinnedClassIncludeSource } from '../../adt/class-include-write.js';
import type { AdtClient } from '../../adt/client.js';
import { updateSource, withLockedMutation } from '../../adt/crud.js';
import { DataResponseBudget } from '../../adt/data-result-context.js';
import { type ActivationReference, activate } from '../../adt/devtools.js';
import { AdtSafetyError } from '../../adt/errors.js';
import type { AdtHttpClient } from '../../adt/http.js';
import { throwIfRequestCancelled } from '../../adt/http-deadline.js';
import type { PinnedMutationContext } from '../../adt/mutation-context.js';
import { boundedRapText, rapBdefForPlanning, validateRapInputs, validateRapPlan } from '../../adt/pinned-rap-bdef.js';
import {
  RAP_SOURCE_LIMIT,
  type RapSection,
  rapEvidence,
  rapHash,
  rapOwner,
  rapSections,
  rapSource,
  validateRapHandlerBindings,
} from '../../adt/pinned-rap-evidence.js';
import { type PinnedRecording, pinnedRecording } from '../../adt/pinned-write-policy.js';
import type { RapHandlerSourceSections } from '../../adt/rap-handlers.js';
import type { RapProfile } from '../../adt/rap-profile.js';
import { checkPackage } from '../../adt/safety.js';
import { editableSourceEquals } from '../../adt/source-precondition.js';
import { isActionDenied } from '../../server/deny-actions.js';
import type { ServerConfig } from '../../server/types.js';
import type { ToolResult } from '../shared.js';
import { preparePrivatePinnedBatchActivation } from './pinned-activation.js';
import { pinnedSourceLockPolicy, revalidatePinnedOwnerRecording } from './pinned-lock.js';

interface SectionResult {
  section: RapSection;
  state: 'unread' | 'observed' | 'absent' | 'initialization-unconfirmed' | 'initialized' | 'save-unconfirmed' | 'saved';
  sourceHash?: string;
  initialized?: true;
}
export function pinnedRapRuntime(
  client: AdtClient,
  config: ServerConfig,
  args: Record<string, unknown>,
  context: PinnedMutationContext,
) {
  const name = args.name as string,
    owner = rapOwner(name),
    evidence = rapEvidence(client, name);
  const sections: SectionResult[] = rapSections.map((section) => ({ section, state: 'unread' }));
  const state = {
    phase: 'metadata',
    sections,
    submitted: false,
    activation: {
      status: 'not-attempted' as 'not-attempted' | 'unconfirmed' | 'confirmed',
      scope: [] as string[],
      result: undefined as ToolResult | undefined,
    },
    dependency: undefined as { name: string; sourceHash: string; version: string; metadataHash: string } | undefined,
    observedOwner: undefined as
      | {
          uri: string;
          packageName: string;
          version: string;
          includes: Array<{ part: string; version: string; alternative?: string }>;
        }
      | undefined,
  };
  let pkg: string | undefined, recording: PinnedRecording | undefined;
  let bdefName: string | undefined;
  let selectedAlias = '';
  let capturedBdef: Awaited<ReturnType<typeof evidence.bdef>> | undefined;
  const sources = new Map<RapSection, string | undefined>();
  const planned = new Map<RapSection, string>();
  let locked = false,
    validated = false;

  async function metadata(http = client.http, active = false) {
    const current = await evidence.classMetadata(http, active);
    const selected = (args.bdefName as string | undefined) ?? current.bdefName;
    if (
      !selected ||
      (current.bdefName && current.bdefName !== selected) ||
      (bdefName && bdefName !== selected) ||
      (pkg && current.packageName !== pkg)
    )
      throw new AdtSafetyError('RAP class package or BDEF binding is absent or changed.');
    bdefName = selected;
    return current;
  }
  async function preflight() {
    state.phase = 'package-recording-preflight';
    const current = await metadata();
    await checkPackage(client.safety, current.packageName, client.getPackageHierarchyResolver());
    const next = await pinnedRecording(
      client.http,
      client.safety,
      owner,
      current.packageName,
      '',
      args.transport as string | undefined,
      context.requestPolicy,
    );
    if (recording && (recording.local !== next.local || recording.request !== next.request))
      throw new AdtSafetyError('RAP recording changed before lock.');
    pkg = current.packageName;
    recording = next;
    return pkg;
  }
  async function dependency(http: AdtHttpClient) {
    if (!bdefName || !capturedBdef) throw new AdtSafetyError('RAP lacks its captured BDEF evidence.');
    const current = await evidence.bdef(http, bdefName);
    if (
      current.hash !== capturedBdef.hash ||
      current.sourceHash !== capturedBdef.sourceHash ||
      current.version !== capturedBdef.version ||
      current.alternative !== capturedBdef.alternative
    )
      throw new AdtSafetyError('BDEF identity, native version or source changed; later RAP phases were not submitted.');
  }
  async function beforeWrite(http: AdtHttpClient) {
    if (!locked || !validated || !pkg || !recording)
      throw new AdtSafetyError('RAP save requires the validated owning lock and complete plan.');
    await revalidatePinnedOwnerRecording(client, http, context, owner, pkg, recording);
    await metadata(http);
    await dependency(http);
    throwIfRequestCancelled(context.requestPolicy);
  }
  async function verifySources(http: AdtHttpClient, active = false) {
    for (const part of rapSections) {
      const expected = sources.get(part);
      const path = rapSource(name, part) + (active ? '?version=active' : '');
      if (expected === undefined) {
        try {
          await evidence.get(http, path, true);
        } catch (error) {
          if (part !== 'main' && pinnedClassIncludeAbsent(error)) continue;
          throw error;
        }
        throw new AdtSafetyError('An absent RAP include appeared after planning.');
      }
      if (!editableSourceEquals(await evidence.get(http, path, true), expected))
        throw new AdtSafetyError(
          active
            ? 'Native active RAP source differs from the saved/observed source.'
            : 'RAP editable source changed before activation.',
        );
    }
  }
  const profile: RapProfile = {
    context,
    metadata: async () => (await metadata()).metadata,
    async bdef(http, requested) {
      await metadata(http);
      if (requested !== bdefName) throw new AdtSafetyError('RAP selected another BDEF.');
      capturedBdef = await evidence.bdef(http, requested);
      state.dependency = {
        name: requested,
        sourceHash: capturedBdef.sourceHash,
        version: capturedBdef.version,
        metadataHash: capturedBdef.hash,
      };
      return rapBdefForPlanning(capturedBdef.source);
    },
    async sources(http) {
      state.phase = 'source-read';
      const native = await metadata(http);
      state.observedOwner = {
        uri: owner,
        packageName: native.packageName,
        version: native.version,
        includes: native.includes,
      };
      const result: RapHandlerSourceSections = { main: '' };
      for (const entry of sections) {
        try {
          const source = await evidence.get(http, rapSource(name, entry.section), true);
          boundedRapText(source);
          if (!native.includes.some((include) => include.part === entry.section))
            throw new AdtSafetyError('Native class metadata does not identify the observed RAP include.');
          result[entry.section] = source;
          sources.set(entry.section, source);
          entry.state = 'observed';
          entry.sourceHash = rapHash(source);
        } catch (error) {
          if (entry.section === 'main' || !pinnedClassIncludeAbsent(error)) throw error;
          if (native.includes.some((include) => include.part === entry.section))
            throw new AdtSafetyError('RAP include absence contradicts native class metadata.');
          sources.set(entry.section, undefined);
          entry.state = 'absent';
        }
      }
      const after = await metadata(http);
      if (JSON.stringify(native) !== JSON.stringify(after))
        throw new AdtSafetyError('RAP class identity/version changed during source reads.');
      return result;
    },
    validateSources(bdef, sourceSections, alias) {
      if (!bdefName) throw new AdtSafetyError('RAP BDEF selection is missing.');
      validateRapInputs(name, bdefName, bdef, sourceSections, alias);
      validateRapHandlerBindings(bdef, sourceSections, alias, false);
      selectedAlias = alias;
      validated = true;
    },
    validatePlan(plan) {
      validateRapPlan(plan);
      if (!bdefName || !capturedBdef) throw new AdtSafetyError('RAP planning lost its BDEF evidence.');
      validateRapInputs(name, bdefName, rapBdefForPlanning(capturedBdef.source), plan.sections, '');
      validateRapHandlerBindings(rapBdefForPlanning(capturedBdef.source), plan.sections, selectedAlias, true);
      planned.clear();
      for (const part of plan.changedSections) {
        const source = plan.sections[part];
        if (source === undefined) throw new AdtSafetyError('RAP planned a missing replacement.');
        planned.set(part, source);
      }
    },
    async edit(operation) {
      await preflight();
      const policy = pinnedSourceLockPolicy(client, context, owner, pkg!, recording!, (phase) => {
        state.phase = phase;
      });
      return withLockedMutation(client.http, client.safety, context, owner, policy, async (http, lock) => {
        locked = true;
        try {
          await metadata(http);
          const result = await operation(http, async (url, source) => {
            const part = rapSections.find(
              (part) =>
                url === rapSource(name, part) || url === rapSource(name, part).replace(name.toLowerCase(), name),
            );
            if (!part || planned.get(part) !== source || !sources.has(part))
              throw new AdtSafetyError('RAP save is outside its exact source plan.');
            const entry = sections.find((entry) => entry.section === part)!;
            let observed = source;
            const before = async (phase: 'include-initialization' | 'source-save' | 'source-readback') => {
              if (
                phase === 'include-initialization' &&
                isActionDenied('SAPWrite', 'create', [...client.safety.denyActions, ...config.denyActions])
              )
                throw new AdtSafetyError('RAP include initialization is denied by policy.');
              if (phase !== 'source-readback') await beforeWrite(http);
              state.phase = phase;
              if (phase !== 'source-readback') {
                entry.state = phase === 'include-initialization' ? 'initialization-unconfirmed' : 'save-unconfirmed';
                state.submitted = true;
              }
            };
            if (part === 'main') {
              await before('source-save');
              await updateSource(
                http,
                client.safety,
                rapSource(name, part),
                source,
                lock.lockHandle,
                recording!.request,
              );
              state.phase = 'source-readback';
              observed = await evidence.get(http, rapSource(name, part), true);
              if (!editableSourceEquals(observed, source))
                throw new AdtSafetyError('RAP MAIN readback differs after save.');
            } else {
              const saved = await savePinnedClassIncludeSource(
                http,
                client.safety,
                context,
                owner,
                rapSource(name, part),
                source,
                lock.lockHandle,
                recording!.request,
                sources.get(part) === undefined,
                before,
                () => {
                  entry.initialized = true;
                  entry.state = 'initialized';
                },
                { responseBudget: new DataResponseBudget(RAP_SOURCE_LIMIT, 'rap-include-readback', true) },
              );
              if (saved.initialized) entry.initialized = true;
              observed = saved.source;
            }
            sources.set(part, observed);
            entry.sourceHash = rapHash(observed);
            entry.state = 'saved';
            planned.delete(part);
          });
          if (planned.size) throw new AdtSafetyError('RAP did not save its complete planned source set.');
          await dependency(http);
          return result;
        } finally {
          locked = false;
        }
      });
    },
    async activate() {
      if (
        !validated ||
        context.cleanup.unlockFailed ||
        context.cleanup.sessionClosed !== true ||
        context.cleanup.unknownLocks?.length
      )
        throw new AdtSafetyError(
          'RAP activation requires confirmed owning-session cleanup and a complete source plan.',
        );
      state.phase = 'activation-preflight';
      const prepared = await preparePrivatePinnedBatchActivation(
        client,
        { action: 'activate', type: 'CLAS', name },
        config.minimalErrors,
        context,
      );
      if (!('execute' in prepared)) {
        state.activation.result = prepared;
        return { success: false };
      }
      const validateReferences = async (refs: readonly ActivationReference[]) => {
        await prepared.validateReferences(refs);
        if (!pkg || !recording) throw new AdtSafetyError('RAP activation lost its recording evidence.');
        await revalidatePinnedOwnerRecording(client, client.http, context, owner, pkg, recording);
        await metadata();
        await verifySources(client.http);
        await dependency(client.http);
        throwIfRequestCancelled(context.requestPolicy);
        state.activation.scope = [...new Set([...state.activation.scope, ...refs.map((ref) => ref.uri)])];
      };
      try {
        const native = await activate(client.http, client.safety, owner, {
          name,
          validateReferences,
          beforeSubmit: () => {
            throwIfRequestCancelled(context.requestPolicy);
            prepared.beforeSubmit();
            state.activation.status = 'unconfirmed';
            state.submitted = true;
          },
        });
        state.activation.result = await prepared.finish(native);
        if (!native.success || state.activation.result.isError) return { success: false };
        state.phase = 'active-source-verification';
        for (const active of [false, true]) {
          const current = await metadata(client.http, active);
          if (
            current.version !== 'active' ||
            current.alternative?.endsWith('=inactive') ||
            current.includes.some(
              (include) => include.version !== 'active' || include.alternative?.endsWith('=inactive'),
            )
          )
            throw new AdtSafetyError('Native RAP metadata does not establish complete active owner state.');
        }
        await verifySources(client.http, true);
        await dependency(client.http);
        state.activation.status = 'confirmed';
        return { success: true };
      } catch (error) {
        state.activation.result ??= prepared.failure(error);
        throw error;
      }
    },
  };
  return { profile, state, preflight };
}
