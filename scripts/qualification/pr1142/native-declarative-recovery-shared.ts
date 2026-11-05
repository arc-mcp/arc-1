/** Shared cleanup-only loop; each entry binds one fixed reviewed owner and receipt profile. */
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { createPinnedDeclarativeContext } from '../../../src/handlers/write/pinned-declarative-context.js';
import { executePinnedSourceWrite } from '../../../src/handlers/write/pinned-source-write.js';
import type { ServerConfig } from '../../../src/server/types.js';
import { declarativeInventoryClean, declarativeOwnerAbsent } from './native-declarative-evidence.js';
import type { DeclarativeFixture } from './native-declarative-fixtures.js';
import { checkDeclarativeRequest, isDeclarativeOwnerUnlock } from './native-declarative-transport.js';
import { boundSourceCheck, DeclarativeFailure, declarativeFailureRow } from './native-declarative-workflow.js';
import { observeNativeHttp } from './native-observed-http.js';
export interface DeclarativeRecoveryInput {
  base: AdtClient;
  record: (row: unknown) => void;
  verifySource: () => void;
  shouldStop: () => boolean;
  /** Trusted entry's original prerequisite expiry; never renewed after an asynchronous wait. */
  deadline?: number;
}
export interface FixedDeclarativeRecoveryProfile {
  fixture: DeclarativeFixture;
  config: ServerConfig;
  checkRequest: (method: string, path: string, body?: string) => void;
  verifyReceipt: (base: AdtClient, record: (row: unknown) => void, options: AdtRequestOptions) => Promise<void>;
  /** A stricter fixed profile must establish its own native absence before confirmation. */
  verifyOwnAbsence?: (base: AdtClient, record: (row: unknown) => void, options: AdtRequestOptions) => Promise<void>;
  verifyOtherAbsence?: (base: AdtClient, record: (row: unknown) => void, options: AdtRequestOptions) => Promise<void>;
  /** Trusted fixed multi-owner recovery may share its original deadline and final-send allowance. */
  requestPolicy?: AdtRequestOptions;
}
export async function runFixedDeclarativeRecovery(
  input: DeclarativeRecoveryInput,
  profile: FixedDeclarativeRecoveryProfile,
) {
  const { base, record, shouldStop } = input;
  const fixture = profile.fixture;
  const verifySource = boundSourceCheck(input.verifySource);
  const deadline = Math.min(Date.now() + 90_000, profile.requestPolicy?.deadline ?? Infinity);
  const policy = { ...profile.requestPolicy, deadline };
  let mutationAttempted = false,
    deleteAttempted = false,
    confirmedDeleted = false,
    cleanupConfirmed = false;
  let failureReason: ReturnType<typeof declarativeFailureRow> | undefined;
  const observe = (value: unknown) => {
    const row = value as { stage?: string; method?: string; path?: string };
    if (
      row.stage === 'request' &&
      !['GET', 'HEAD'].includes(row.method ?? '') &&
      row.path !== '/sap/bc/adt/cts/transportchecks'
    )
      mutationAttempted = true;
    if (row.stage === 'request' && row.method === 'DELETE') deleteAttempted = true;
    record(value);
  };
  const assertContinuing = () => {
    verifySource();
    if (shouldStop()) throw new DeclarativeFailure('stopped');
  };
  const http = observeNativeHttp(
    base.http,
    (method, path, body) => {
      try {
        profile.checkRequest(method, path, body);
      } catch {
        throw new DeclarativeFailure('request-out-of-scope');
      }
      if (!isDeclarativeOwnerUnlock(fixture, method, path)) assertContinuing();
    },
    observe,
    async (_session, _path, options) => {
      // The production adapter already holds its own lock and rechecks package/recording in that session.
      // These additional same-principal stateless reads avoid disturbing its stateful editing session.
      assertContinuing();
      await profile.verifyReceipt(base, record, options);
      assertContinuing();
    },
  );
  const client = Object.assign(Object.create(Object.getPrototypeOf(base)), base, { http }) as AdtClient;
  try {
    assertContinuing();
    await profile.verifyReceipt(base, record, policy);
    assertContinuing();
    const context = pinnedMutationContext(client.safety, { ...policy, deadline }, { unlockFailed: false });
    const result = await executePinnedSourceWrite(
      createPinnedDeclarativeContext(
        client,
        { action: 'delete', type: fixture.type, name: fixture.name },
        profile.config,
        context,
      ),
    );
    let state: unknown;
    try {
      state = JSON.parse(result.content[0].text).state;
    } catch {
      state = 'unparseable';
    }
    cleanupConfirmed =
      !context.cleanup.unlockFailed && !context.cleanup.unknownLocks?.length && context.cleanup.sessionClosed === true;
    record({ operation: 'delete', owner: fixture.owner, state, isError: result.isError === true, cleanupConfirmed });
    if (state !== 'deleted')
      throw new DeclarativeFailure(state === 'unchanged' ? 'delete-not-sent' : 'delete-unconfirmed');
    verifySource();
    if (profile.verifyOwnAbsence) await profile.verifyOwnAbsence(base, record, policy);
    else await declarativeOwnerAbsent(base.http, fixture, record, policy);
    confirmedDeleted = true;
    await profile.verifyOtherAbsence?.(base, record, policy);
    await declarativeInventoryClean(base.http, [fixture], record, policy);
    verifySource();
    if (result.isError || !cleanupConfirmed)
      throw new DeclarativeFailure('deleted-cleanup-unconfirmed', { ownerDeleted: true });
  } catch (error) {
    failureReason = declarativeFailureRow(error);
    record({ recoveryUnconfirmed: true, ...failureReason });
  }
  return {
    failure: !!failureReason || shouldStop() || !confirmedDeleted || !cleanupConfirmed,
    mutationAttempted,
    deleteAttempted,
    confirmedDeleted,
    cleanupConfirmed,
    stopped: shouldStop(),
    ...(failureReason ?? {}),
    remaining: confirmedDeleted ? [] : [fixture.owner],
    inspectionRequired: failureReason || !cleanupConfirmed ? [fixture.owner] : [],
  };
}

export function checkFixedRecoveryRequest(
  fixture: DeclarativeFixture,
  readPaths: readonly string[],
  method: string,
  path: string,
  body?: string,
) {
  checkDeclarativeRequest(fixture, method, path, body);
  const uri = new URL(path, 'https://a4h.marianzeis.de');
  if (method === 'GET' && readPaths.includes(path)) return;
  if (method === 'POST' && uri.pathname === '/sap/bc/adt/cts/transportchecks') {
    const expected = `<a:abap xmlns:a="http://www.sap.com/abapxml" version="1.0"><a:values><DATA><DEVCLASS>$TMP</DEVCLASS><URI>${fixture.owner}</URI><OPERATION></OPERATION></DATA></a:values></a:abap>`;
    const canonical = (xml: string) =>
      JSON.stringify(nativeXmlRoot(xml, 'abap', 'http://www.sap.com/abapxml').canonicalValue({}));
    if (canonical(body ?? '') !== canonical(expected))
      throw new Error('Recovery only permits existing-owner recording checks.');
    return;
  }
  if (
    (method === 'POST' &&
      uri.pathname === fixture.owner &&
      ['LOCK', 'UNLOCK'].includes(uri.searchParams.get('_action') ?? '')) ||
    method === 'DELETE'
  ) {
    if (body !== undefined && body !== '') throw new Error('Recovery lock and delete requests have no body.');
    return;
  }
  throw new Error('Recovery only permits the exact fixed owned DDLS cleanup.');
}
