/** Private exact-owner DDIC/server-driven activation evidence, reused by the common activation orchestrator. */
import { createHash } from 'node:crypto';
import type { AdtClient } from '../../adt/client.js';
import { DataResponseBudget } from '../../adt/data-result-context.js';
import type { ActivationReference, ActivationResult } from '../../adt/devtools.js';
import { AdtSafetyError } from '../../adt/errors.js';
import {
  type PinnedDdicEvidence,
  type PinnedDdicSelection,
  pinnedDdicSelection,
  readPinnedDdicEvidence,
  resolvePinnedTableType,
} from '../../adt/pinned-ddic-owner.js';
import { assertSavedFields, derivedMetadataFields } from '../../adt/pinned-metadata-projection.js';
import { checkOperation, OperationType } from '../../adt/safety.js';
import { serverDrivenSourceContentType } from '../../adt/server-driven.js';
import { isTablesEndpointAvailable } from '../feature-cache.js';

const canonical = (uri: string) => uri.replace(/%2f/gi, '%2F').replace(/%7e/gi, '~').toLowerCase();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
/** Saved active by SAP; activation does not move them through a separate inactive review. */
const IMMEDIATE_ACTIVE = new Set(['APLO', 'UIAD']);

export async function selectPrivateDdicActivation(
  client: AdtClient,
  args: Record<string, unknown>,
): Promise<PinnedDdicSelection> {
  const fields = new Set(['type', 'name', 'action', 'preaudit']);
  if (
    Object.keys(args).some((key) => args[key] !== undefined && !fields.has(key)) ||
    (args.preaudit !== undefined && args.preaudit !== true) ||
    (args.action !== undefined && args.action !== 'activate')
  )
    throw new AdtSafetyError('The private DDIC activation profile selects one complete owner only.');
  let { type } = args;
  if (type === 'TABL' || type === 'TABL/DT' || type === 'TABL/DS') {
    pinnedDdicSelection('TABL/DT', args.name);
    type = await resolvePinnedTableType(client, type, args.name as string, isTablesEndpointAvailable());
  }
  if (typeof type === 'string' && IMMEDIATE_ACTIVE.has(type))
    throw new AdtSafetyError(
      `${type} source saves are active immediately; there is no separate activation to request.`,
    );
  return pinnedDdicSelection(type, args.name);
}

export function ddicActivationEvidence(client: AdtClient, selected: PinnedDdicSelection) {
  let captured: PinnedDdicEvidence | undefined;
  let sourceHash: string | undefined;
  const sourceBacked = selected.kind === 'table-source' || selected.kind === 'server-driven';
  async function source(version: 'active' | 'inactive') {
    checkOperation(client.safety, OperationType.Read, 'DdicActivationEvidence');
    const response = await client.http.get(
      `${selected.objectUrl}/source/main?version=${version}`,
      {
        Accept: selected.kind === 'server-driven' ? serverDrivenSourceContentType(selected.type) : 'text/plain',
        'Cache-Control': 'no-cache',
      },
      { responseBudget: new DataResponseBudget(4 * 1024 * 1024, 'ddic-activation-source', true) },
    );
    return hash(response.body);
  }
  return {
    validateReferences(refs: readonly ActivationReference[]) {
      if (
        refs.length !== 1 ||
        refs.some(
          (ref) =>
            canonical(ref.uri) !== canonical(selected.objectUrl) ||
            (ref.name !== undefined && ref.name.trim().toUpperCase() !== selected.name) ||
            (ref.type !== undefined && ref.type !== selected.native) ||
            (ref.deleted !== undefined && ref.deleted !== 'false'),
        )
      )
        throw new AdtSafetyError(
          'DDIC activation expanded beyond the selected native owner; no confirmation was sent.',
        );
    },
    async capture() {
      const current = await readPinnedDdicEvidence(client, selected, 'inactive');
      if (selected.type === 'TABL/DTT' && current.version === 'new')
        throw new AdtSafetyError(
          `New technical settings require the table's first activation: activate TABL ${selected.name} instead.`,
        );
      const currentSource = sourceBacked ? await source('inactive') : undefined;
      if (
        captured &&
        (current.hash !== captured.hash || current.version !== captured.version || currentSource !== sourceHash)
      )
        throw new AdtSafetyError('The selected DDIC draft changed during preaudit; no confirmation was sent.');
      captured ??= current;
      sourceHash ??= currentSource;
      return current.packageName;
    },
    /** Warnings can leave native state unverified even when metadata reports active (758 index evidence). */
    assertResult(result: ActivationResult) {
      if (selected.type === 'TABL/DTI' && result.details.some((detail) => detail.severity === 'warning'))
        throw new AdtSafetyError(
          'Index activation returned warnings; database state is unverified. The index may already be active. Inspect it in ADT before retrying.',
        );
    },
    async verify() {
      if (!captured || (sourceBacked && !sourceHash))
        throw new AdtSafetyError('DDIC activation lacks captured draft evidence.');
      // The explicit inactive view exposes a remaining draft, including another user's.
      for (const version of [undefined, 'active', 'inactive'] as const) {
        const current = await readPinnedDdicEvidence(client, selected, version);
        if (current.packageName !== captured.packageName || current.version !== 'active')
          throw new AdtSafetyError('Native DDIC metadata does not confirm the selected active owner.');
        if (!sourceBacked)
          assertSavedFields(
            captured.fields,
            current.fields,
            derivedMetadataFields(selected.type, captured.fields),
            true,
          );
      }
      if (sourceBacked && (await source('active')) !== sourceHash)
        throw new AdtSafetyError('The native active source differs from the captured draft.');
    },
    get sourceBacked() {
      return sourceBacked;
    },
    get previousVersion() {
      return captured?.version;
    },
    get wasAlreadyActive() {
      return captured?.version === 'active';
    },
    get sourceHash() {
      return sourceHash;
    },
    get metadataHash() {
      return captured?.hash;
    },
  };
}
