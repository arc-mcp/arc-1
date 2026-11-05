/** Ordinary read companions for native optimistic preconditions; these do not admit any mutation. */
import type { AdtClient } from '../adt/client.js';
import { DataResponseBudget } from '../adt/data-result-context.js';
import { AdtSafetyError } from '../adt/errors.js';
import type { AdtRequestOptions } from '../adt/http.js';
import {
  isPinnedDdicType,
  pinnedDdicSelection,
  readDdicEvidence,
  resolvePinnedTableType,
} from '../adt/pinned-ddic-owner.js';
import { isPinnedDocumentType, pinnedDocumentSelection, readNativeDocument } from '../adt/pinned-document-owner.js';
import { pinnedBindingSelection, readBindingDocument } from '../adt/pinned-service-binding-owner.js';
import { RequestAttemptBudget } from '../adt/request-attempt-budget.js';
import { checkOperation, OperationType } from '../adt/safety.js';
import { serverDrivenSourceContentType, serverDrivenSourceFormat } from '../adt/server-driven.js';
import { sourceHash } from '../adt/source-precondition.js';
import { getCurrentContext } from '../server/context.js';
import { isTablesEndpointAvailable } from './feature-cache.js';
import { errorResult, type ToolResult, textResult, toolJson } from './shared.js';

export const hasEditableNativeProfile = (type: string) =>
  type === 'TABL' || type === 'SRVB' || isPinnedDdicType(type) || isPinnedDocumentType(type);

export async function readEditableNative(
  client: AdtClient,
  args: Record<string, unknown>,
  type: string,
  name: string,
): Promise<ToolResult> {
  const fields = new Set(['type', 'name', 'format', 'force_refresh']);
  if (Object.keys(args).some((key) => args[key] !== undefined && !fields.has(key)))
    return errorResult(
      'Native editable reads select one complete object. Supply only type, name and format="editable".',
    );
  checkOperation(client.safety, OperationType.Read, 'GetEditableNative');
  const request: AdtRequestOptions = {
    deadline: Date.now() + 60_000,
    signal: getCurrentContext()?.signal,
    responseBudget: new DataResponseBudget((isPinnedDocumentType(type) ? 1 : 8) * 1024 * 1024, 'editable-native', true),
    attemptBudget: new RequestAttemptBudget(16),
  };
  if (isPinnedDocumentType(type)) {
    const selected = pinnedDocumentSelection(type, name);
    const evidence = await readNativeDocument(client, selected, undefined, request);
    return textResult(
      toolJson({
        type,
        name,
        nativeType: selected.native,
        objectUrl: selected.objectUrl,
        package: evidence.packageName,
        metadataView: 'developer',
        nativeVersion: evidence.version,
        inactiveAlternative: evidence.inactiveAlternative,
        metadataXml: evidence.xml,
        metadataHash: evidence.hash,
      }),
    );
  }
  if (type === 'SRVB') {
    const selected = pinnedBindingSelection(name);
    const { xml, evidence } = await readBindingDocument(client, selected, undefined, request);
    if (!['active', 'inactive', 'new'].includes(evidence.nativeVersion ?? ''))
      throw new AdtSafetyError('Editable service-binding metadata lacks a known native version.');
    return textResult(
      toolJson({
        type,
        name,
        objectUrl: selected.objectUrl,
        package: evidence.packageName,
        metadataView: 'developer',
        nativeVersion: evidence.nativeVersion,
        inactiveAlternative: evidence.inactiveAlternative,
        metadataXml: xml,
        metadataHash: evidence.metadataHash,
      }),
    );
  }
  // Normal SAPRead aliases collapse TABL/DT and /DS. Resolve the actual type, never probe collections.
  if (type === 'TABL') {
    pinnedDdicSelection('TABL/DT', name);
    type = await resolvePinnedTableType(client, 'TABL', name, isTablesEndpointAvailable(), request);
  }
  const selected = pinnedDdicSelection(type, name);
  const version =
    selected.kind === 'metadata' || selected.kind === 'table-settings' || type === 'TABL/DTI' ? 'inactive' : undefined;
  const before = await readDdicEvidence(client, selected, version, request);
  const result = {
    type,
    name,
    objectUrl: selected.objectUrl,
    package: before.packageName,
    metadataView: version ?? 'developer',
    nativeVersion: before.version,
    metadataXml: before.xml,
    metadataHash: before.hash,
  };
  if (selected.kind === 'metadata' || selected.kind === 'table-settings') return textResult(toolJson(result));

  const sourceView = type === 'TABL/DTI' ? 'inactive' : 'developer';
  const sourceUrl = `${selected.objectUrl}/source/main${sourceView === 'inactive' ? '?version=inactive' : ''}`;
  const sourceFormat = selected.kind === 'table-source' ? 'text' : serverDrivenSourceFormat(type);
  const accept = selected.kind === 'table-source' ? 'text/plain' : serverDrivenSourceContentType(type);
  const response = await client.http.get(sourceUrl, { Accept: accept, 'Cache-Control': 'no-cache' }, request);
  const source = response.body;
  if (Buffer.byteLength(source, 'utf8') > 4 * 1024 * 1024)
    throw new AdtSafetyError('Editable native source exceeds the 4 MiB bound.');
  if (sourceFormat === 'json') {
    try {
      JSON.parse(source);
    } catch {
      throw new AdtSafetyError('Editable native source is not valid JSON.');
    }
  }
  const after = await readDdicEvidence(client, selected, version, request);
  // The writer hash omits bookkeeping. Compare the complete namespace-bound metadata here too,
  // retaining version, object-state alternatives, language and native change markers across reads.
  if (
    before.packageName !== after.packageName ||
    JSON.stringify(before.root.canonicalValue({})) !== JSON.stringify(after.root.canonicalValue({}))
  )
    throw new AdtSafetyError('Native owner metadata changed during the editable read. Re-read before editing.');
  return textResult(
    toolJson({ ...result, source, sourceHash: sourceHash(source), sourceUrl, sourceView, sourceFormat }),
  );
}
