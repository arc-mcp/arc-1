/** One disposable CLAS, unsaved declaration deltas, and own-session deletion. No activation or execution. */
import { createHash } from 'node:crypto';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { quickfixPosition, quickfixRangeUri } from '../../../src/adt/pinned-quickfix-input.js';
import { getFixProposals } from '../../../src/adt/quickfix.js';
import { editableSourceEquals, sourceHash } from '../../../src/adt/source-precondition.js';
import type { FixDelta } from '../../../src/adt/types.js';
import { executePrivatePinnedQuickfix } from '../../../src/handlers/pinned-quickfix.js';
import { createPinnedTextSourceContext } from '../../../src/handlers/write/pinned-source-input.js';
import { executePinnedSourceWrite } from '../../../src/handlers/write/pinned-source-write.js';
import { runtimeRetainedClassReceipt } from './native-runtime-retained-fixed.js';
import { type RuntimeInput, runtimePayload, runtimeStageClient } from './native-runtime-slice-context.js';
import {
  runtimeFixture as fixture,
  runtimeClassOwner as owner,
  RuntimeFailure,
  runtimeProposal,
  runtimeReason,
  runtimeStoredSource,
  runtimeUnsavedSource,
} from './native-runtime-slice-fixed.js';
import { retainedAbsent } from './native-v5-retained-evidence.js';

const core = 'http://www.sap.com/adt/core';
const digest = (body: string) => createHash('sha256').update(body).digest('hex');
const need = (value: unknown, reason: string): void => {
  if (!value) throw new RuntimeFailure(reason);
};
function declarationBufferEquals(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const delta = value as Partial<FixDelta>;
  if (typeof delta.uri !== 'string' || typeof delta.content !== 'string') return false;
  try {
    const { range } = quickfixRangeUri(delta.uri, { type: 'CLAS', name: fixture.className }, true);
    if (
      !range ||
      delta.uri.split('#')[0] !== `${owner}/source/main` ||
      JSON.stringify(delta.range) !== JSON.stringify(range)
    )
      return false;
    const start = quickfixPosition(runtimeUnsavedSource, range.start),
      end = quickfixPosition(runtimeUnsavedSource, range.end);
    if (end < start) return false;
    const applied = runtimeUnsavedSource.slice(0, start) + delta.content + runtimeUnsavedSource.slice(end);
    // The native replacement retains the existing declaration. Also retain the prior
    // insertion fixture's exact spelling/indentation; no other source bytes may change.
    return [
      '    DATA: lv_missing TYPE i.\n    lv_missing = 1.',
      '    DATA lv_missing TYPE i.\n    lv_missing = 1.',
      '    DATA lv_missing TYPE i.\nlv_missing = 1.',
    ].some((replacement) => applied === runtimeUnsavedSource.replace('    lv_missing = 1.', replacement));
  } catch {
    return false;
  }
}
export const runRuntimeQuickfix = (input: RuntimeInput) => runQuickfix(input, false);
export const runRetainedRuntimeQuickfix = (input: RuntimeInput) => runQuickfix(input, true);
async function runQuickfix(input: RuntimeInput, retained: boolean) {
  let phase = 'preflight',
    deleteReceipt: { metadataHash: string; sourceHash: string } | undefined;
  let createDispatched = false,
    created = false,
    confirmedDeleted = false,
    finalAbsent = false,
    sourceUnchanged = false,
    retainedVerified = false;
  const reads = [
    owner,
    `${owner}?version=inactive`,
    `${owner}/source/main`,
    `${owner}/source/main?version=inactive`,
    '/sap/bc/adt/packages/$TMP',
    '/sap/bc/adt/packages/$tmp',
    '/sap/bc/adt/discovery',
  ];
  const scoped = runtimeStageClient(
    {
      ...input,
      record: (row) => {
        const event = row as { stage?: string; method?: string; path?: string; status?: number };
        if (event.method === 'POST' && event.path === '/sap/bc/adt/oo/classes') {
          if (event.stage === 'dispatch') createDispatched = true;
          if (event.stage === 'response' && event.status === 201) created = true;
        }
        input.record(row);
      },
    },
    (method, path, body) => {
      const uri = new URL(path, 'https://a4h.marianzeis.de');
      need(
        path.startsWith('/sap/bc/adt/') && !path.includes('#') && uri.origin === 'https://a4h.marianzeis.de',
        'scope',
      );
      if (method === 'GET' && reads.includes(path)) return;
      if (
        method === 'POST' &&
        uri.pathname === owner &&
        ['LOCK', 'UNLOCK'].includes(uri.searchParams.get('_action') ?? '') &&
        [...uri.searchParams.keys()].every((key) => ['_action', 'accessMode', 'lockHandle'].includes(key))
      )
        return;
      if (method === 'POST' && uri.pathname === '/sap/bc/adt/cts/transportchecks') {
        const actual = JSON.stringify(
          nativeXmlRoot(body ?? '', 'abap', 'http://www.sap.com/abapxml').canonicalValue({}),
        );
        need(
          ['I', ''].some(
            (operation) =>
              actual ===
              JSON.stringify(
                nativeXmlRoot(
                  `<a:abap xmlns:a="http://www.sap.com/abapxml" version="1.0"><a:values><DATA><DEVCLASS>$TMP</DEVCLASS><URI>${owner}</URI><OPERATION>${operation}</OPERATION></DATA></a:values></a:abap>`,
                  'abap',
                  'http://www.sap.com/abapxml',
                ).canonicalValue({}),
              ),
          ),
          'recording-owner',
        );
        return;
      }
      if (method === 'POST' && uri.pathname === '/sap/bc/adt/oo/classes' && uri.search === '' && phase === 'create') {
        const root = nativeXmlRoot(body ?? '', 'abapClass', 'http://www.sap.com/adt/oo/classes');
        need(
          root.attribute('name', core) === fixture.className &&
            root.child('packageRef', core)?.attribute('name', core) === '$TMP' &&
            root.attribute('description', core) === fixture.title,
          'create-owner',
        );
        return;
      }
      if (
        method === 'PUT' &&
        uri.pathname === `${owner}/source/main` &&
        phase === 'create' &&
        body === runtimeStoredSource &&
        [...uri.searchParams.keys()].every((key) => ['lockHandle'].includes(key))
      )
        return;
      if (
        method === 'DELETE' &&
        uri.pathname === owner &&
        phase === 'delete' &&
        deleteReceipt &&
        [...uri.searchParams.keys()].every((key) => ['lockHandle'].includes(key))
      )
        return;
      if (
        phase === 'quickfix' &&
        method === 'POST' &&
        uri.pathname === '/sap/bc/adt/quickfixes/evaluation' &&
        uri.search === `?uri=${encodeURIComponent(`${owner}/source/main#start=8,4`)}` &&
        body === runtimeUnsavedSource
      )
        return;
      if (phase === 'quickfix' && method === 'POST' && path === runtimeProposal && body?.includes('lv_missing = 1.'))
        return;
      throw new RuntimeFailure('scope');
    },
    async (http) => {
      need(phase === 'delete' && deleteReceipt, 'delete-receipt');
      const actual = await snapshot(http);
      need(JSON.stringify(actual) === JSON.stringify(deleteReceipt), 'delete-drift');
    },
  );
  async function snapshot(http: AdtHttpClient) {
    const metadata = await http.get(owner, { Accept: 'application/*' });
    const root = nativeXmlRoot(metadata.body, 'abapClass', 'http://www.sap.com/adt/oo/classes');
    need(
      root.attribute('name', core) === fixture.className &&
        root.attribute('type', core) === 'CLAS/OC' &&
        root.attribute('description', core) === fixture.title &&
        root.attribute('createdBy', core) === 'MARIAN' &&
        ['inactive', 'new'].includes(root.attribute('version', core) ?? '') &&
        root.child('packageRef', core)?.attribute('name', core) === '$TMP',
      'class-owner',
    );
    const source = await http.get(`${owner}/source/main`, { Accept: 'text/plain' });
    need(editableSourceEquals(source.body, runtimeStoredSource), 'class-source');
    const actual = { metadataHash: digest(metadata.body), sourceHash: sourceHash(source.body) };
    if (retained) need(JSON.stringify(actual) === JSON.stringify(runtimeRetainedClassReceipt), 'retained-class-drift');
    return actual;
  }
  const write = async (args: Record<string, unknown>) => {
    const result = await executePinnedSourceWrite(
      createPinnedTextSourceContext(
        scoped.owningClient,
        { ...args, type: 'CLAS', name: fixture.className },
        scoped.config,
        scoped.context,
      ),
    );
    input.record({ adapter: args.action, result });
    return result;
  };
  try {
    if (!retained) {
      await retainedAbsent(scoped.http, owner, input.record, scoped.context.requestPolicy);
      phase = 'create';
      const creation = runtimePayload(
        await write({ action: 'create', package: '$TMP', description: fixture.title, source: runtimeStoredSource }),
      );
      input.record({ action: 'create', result: creation });
      need(creation.state === 'saved-inactive', 'class-create');
      created = true;
    }
    const before = await snapshot(scoped.http);
    retainedVerified = retained;
    phase = 'negative';
    const rejected = await executePrivatePinnedQuickfix(
      scoped.client,
      {
        action: 'apply_quickfix',
        type: 'CLAS',
        name: fixture.className,
        sourceUri: `${owner}/source/main`,
        source: runtimeUnsavedSource,
        line: 8,
        column: 4,
        proposalUri: '/sap/bc/adt/activation',
      },
      scoped.config,
      ['read', 'write'],
    );
    need(rejected.isError, 'negative-not-refused');
    phase = 'quickfix';
    const proposals = await getFixProposals(
      scoped.http,
      scoped.client.safety,
      `${owner}/source/main`,
      runtimeUnsavedSource,
      8,
      4,
    );
    const matches = proposals.filter((p) => p.uri === runtimeProposal);
    need(matches.length === 1, 'proposal-unavailable');
    const proposal = matches[0];
    const computed = runtimePayload(
      await executePrivatePinnedQuickfix(
        scoped.client,
        {
          action: 'apply_quickfix',
          type: 'CLAS',
          name: fixture.className,
          sourceUri: `${owner}/source/main`,
          source: runtimeUnsavedSource,
          line: 8,
          column: 4,
          proposalUri: proposal.uri,
          proposalUserContent: proposal.userContent,
          proposalAffectedObjects: proposal.affectedObjects,
        },
        scoped.config,
        ['read', 'write'],
      ),
    );
    input.record({ action: 'quickfix', result: computed });
    need(
      computed.state === 'computed' &&
        computed.sourceSaved === false &&
        Array.isArray(computed.deltas) &&
        computed.deltas.length === 1 &&
        declarationBufferEquals(computed.deltas[0]),
      'delta-content',
    );
    const after = await snapshot(scoped.http);
    need(JSON.stringify(before) === JSON.stringify(after), 'quickfix-persisted');
    sourceUnchanged = true;
    deleteReceipt = after;
    phase = 'delete';
    const deleted = runtimePayload(await write({ action: 'delete' }));
    input.record({ action: 'delete', result: deleted });
    need(deleted.state === 'deleted', 'delete-unconfirmed');
    await retainedAbsent(scoped.http, owner, input.record, scoped.context.requestPolicy);
    confirmedDeleted = true;
    phase = 'final';
    await retainedAbsent(scoped.http, owner, input.record, scoped.context.requestPolicy);
    finalAbsent = true;
    need(!scoped.context.cleanup.unlockFailed && scoped.context.cleanup.sessionClosed !== false, 'session-cleanup');
    if (retained) scoped.verify();
    return {
      failure: false,
      ...(retained ? { adopted: [owner], createReplayed: false, cleanup: scoped.context.cleanup } : {}),
      sourceUnchanged,
      confirmedDeleted: [owner],
      remaining: [],
      finalAbsent,
      mutationDispatched: scoped.mutationDispatched(),
      activationExecuted: false,
    };
  } catch (error) {
    return {
      failure: true,
      reason: runtimeReason(error),
      stoppedAt: phase,
      created,
      ...(retained
        ? {
            adopted: retainedVerified ? [owner] : [],
            createReplayed: false,
            inspectionRequired: !finalAbsent ? [owner] : [],
          }
        : {}),
      sourceUnchanged,
      finalAbsent,
      confirmedDeleted: confirmedDeleted ? [owner] : [],
      remaining: (retained || createDispatched) && !finalAbsent ? [owner] : [],
      mutationDispatched: scoped.mutationDispatched(),
      cleanup: scoped.context.cleanup,
    };
  }
}
