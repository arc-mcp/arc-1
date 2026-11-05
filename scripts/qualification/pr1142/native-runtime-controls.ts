/** User preference restoration and bounded own-user trace controls through the current shared adapters. */

import { createHash } from 'node:crypto';
import { ST05_STATE_CONTENT_TYPE, ST05_STATE_URL } from '../../../src/adt/diagnostics.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import {
  FORMATTER_SETTINGS_CONTENT_TYPE,
  FORMATTER_SETTINGS_PATH,
  parsePinnedFormatterDocument,
} from '../../../src/adt/pinned-formatter.js';
import {
  type PinnedTraceStartOutcome,
  parsePinnedTraceStart,
  requestFeed,
  st05Document,
} from '../../../src/adt/pinned-trace.js';
import { buildTraceParametersXml, TRACE_BASE, traceRequestPath } from '../../../src/adt/trace-requests.js';
import { handlePinnedFormatter } from '../../../src/handlers/pinned-formatter.js';
import { executePrivatePinnedTrace } from '../../../src/handlers/pinned-trace.js';
import { type RuntimeInput, runtimePayload, runtimeStageClient } from './native-runtime-slice-context.js';
import { RuntimeFailure, runtimeFixture, runtimeReason } from './native-runtime-slice-fixed.js';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const need = (value: unknown, reason: string): void => {
  if (!value) throw new RuntimeFailure(reason);
};

export async function runRuntimeFormatter(input: RuntimeInput) {
  let baseline: ReturnType<typeof parsePinnedFormatterDocument> | undefined;
  let expected: ReturnType<typeof parsePinnedFormatterDocument>['settings'] | undefined;
  let step = 'baseline',
    restored = false;
  const scoped = runtimeStageClient(input, (method, path, body) => {
    need(path === FORMATTER_SETTINGS_PATH && ['GET', 'PUT'].includes(method), 'scope');
    if (method === 'PUT') {
      need(expected && baseline && typeof body === 'string', 'formatter-intent');
      const current = parsePinnedFormatterDocument(body!);
      need(same(current.settings, expected) && same(current.unrelated, baseline!.unrelated), 'formatter-fields');
    }
  });
  const read = async () => {
    const response = await scoped.http.get(FORMATTER_SETTINGS_PATH, { Accept: '*/*' });
    need(response.headers['content-type']?.split(';')[0] === FORMATTER_SETTINGS_CONTENT_TYPE, 'formatter-mime');
    return parsePinnedFormatterDocument(response.body);
  };
  try {
    baseline = await read();
    input.record({ formatterBaseline: { settings: baseline.settings, unrelated: baseline.unrelated } });
    for (const [label, settings] of [
      ['change', { ...baseline.settings, indentation: !baseline.settings.indentation }],
      ['restore', baseline.settings],
    ] as const) {
      step = label;
      expected = settings;
      const args = { action: 'set_formatter_settings', ...settings };
      const result = runtimePayload(await handlePinnedFormatter(scoped.client, args, scoped.config));
      input.record({ action: label, result });
      need(result.ok && result.state === 'updated', 'formatter-unconfirmed');
      const actual = await read();
      need(same(actual.settings, settings) && same(actual.unrelated, baseline.unrelated), 'formatter-drift');
    }
    restored = true;
    return {
      failure: false,
      state: 'restored',
      restored,
      remaining: [],
      mutationDispatched: scoped.mutationDispatched(),
    };
  } catch (error) {
    return {
      failure: true,
      reason: runtimeReason(error),
      stoppedAt: step,
      restored,
      remaining: scoped.mutationDispatched() ? ['MARIAN formatter preferences: inspect saved baseline'] : [],
      mutationDispatched: scoped.mutationDispatched(),
    };
  }
}

export async function runRuntimeSt05(input: RuntimeInput, expectedBaselineHash?: string) {
  let baseline: ReturnType<typeof st05Document> | undefined, desired: boolean | undefined;
  let restored = false,
    step = 'baseline';
  const scoped = runtimeStageClient(input, (method, path, body) => {
    need(path === ST05_STATE_URL && ['GET', 'PUT'].includes(method), 'scope');
    if (method === 'PUT') {
      need(baseline && desired !== undefined && typeof body === 'string', 'st05-intent');
      const submitted = st05Document({
        statusCode: 200,
        body: body!,
        headers: { 'content-type': ST05_STATE_CONTENT_TYPE },
      });
      need(
        submitted.unrelated === baseline!.unrelated &&
          submitted.instances.every((x) => x.filter.user === 'MARIAN' && x.traceTypes.sql === desired),
        'st05-fields',
      );
      need(
        same(submitted.instances.map((x) => x.instance).sort(), baseline!.instances.map((x) => x.instance).sort()),
        'st05-instances',
      );
    }
  });
  const read = async () => st05Document(await scoped.http.get(ST05_STATE_URL, { Accept: ST05_STATE_CONTENT_TYPE }));
  try {
    baseline = await read();
    if (expectedBaselineHash)
      need(
        createHash('sha256').update(baseline.body).digest('hex') === expectedBaselineHash,
        'st05-historical-baseline',
      );
    need(
      baseline.instances.every((x) => Object.values(x.traceTypes).every((active) => !active) && !x.filter.user) &&
        baseline.offUnrelated() === baseline.unrelated,
      'st05-restoration-prerequisite',
    );
    input.record({ st05Baseline: baseline.instances, unrelated: baseline.unrelated });
    for (const value of [true, false]) {
      desired = value;
      step = value ? 'arm' : 'restore';
      const args = { action: 'set_sql_trace_state', sqlOn: value, ...(value ? { user: 'MARIAN' } : {}) };
      const result = runtimePayload(
        await executePrivatePinnedTrace(scoped.client, args, scoped.config, scoped.context),
      );
      input.record({ action: step, result });
      need(result.state === 'updated', 'st05-unconfirmed');
      const actual = await read();
      need(
        actual.unrelated === baseline.unrelated &&
          actual.instances.every(
            (x) => (value ? x.filter.user === 'MARIAN' : !x.filter.user) && x.traceTypes.sql === value,
          ),
        'st05-drift',
      );
      need(
        same(actual.instances.map((x) => x.instance).sort(), baseline.instances.map((x) => x.instance).sort()),
        'st05-instances',
      );
    }
    restored = true;
    return {
      failure: false,
      state: 'restored',
      restored,
      remaining: [],
      mutationDispatched: scoped.mutationDispatched(),
      clientIsolated: false,
    };
  } catch (error) {
    return {
      failure: true,
      reason: runtimeReason(error),
      stoppedAt: step,
      restored,
      remaining: scoped.mutationDispatched() ? ['MARIAN ST05 state: inspect saved instance baseline'] : [],
      mutationDispatched: scoped.mutationDispatched(),
      clientIsolated: false,
    };
  }
}

export async function runRuntimeProfiler(input: RuntimeInput) {
  const start = {
    action: 'trace_start',
    traceUser: 'MARIAN',
    processType: 'dialog',
    objectType: 'transaction',
    maxExecutions: 1,
    expiresHours: 1 / 60,
    sqlTrace: false,
    aggregate: true,
    description: runtimeFixture.title,
  };
  const plan = parsePinnedTraceStart(start);
  let ownRequest: string | undefined,
    parametersId: string | undefined,
    cancelled = false;
  let startOutcome:
    | Pick<PinnedTraceStartOutcome, 'state' | 'phase' | 'parametersId' | 'requestOutcome' | 'request' | 'readback'>
    | undefined;
  let parametersDispatched = false,
    requestDispatched = false;
  const observedInput: RuntimeInput = {
    ...input,
    record: (row) => {
      const event = row as { stage?: string; method?: string; path?: string };
      if (event.stage === 'dispatch' && event.method === 'POST') {
        if (event.path === `${TRACE_BASE}/parameters`) parametersDispatched = true;
        if (event.path?.startsWith(`${TRACE_BASE}/requests?`)) requestDispatched = true;
      }
      input.record(row);
    },
  };
  const listPath = `${TRACE_BASE}/requests?user=MARIAN`;
  const scoped = runtimeStageClient(observedInput, (method, path, body) => {
    if (method === 'GET' && path === listPath) return;
    if (method === 'DELETE' && ownRequest && path === traceRequestPath(ownRequest) && body === undefined) return;
    if (method === 'POST' && path === `${TRACE_BASE}/parameters` && body === buildTraceParametersXml(plan)) return;
    const url = new URL(path, 'https://a4h.marianzeis.de');
    if (method === 'POST' && path.startsWith(`${TRACE_BASE}/requests?`) && !body) {
      const q = Object.fromEntries(url.searchParams);
      need([...url.searchParams].length === 9 && Object.keys(q).length === 9, 'trace-query');
      need(
        q.server === '*' &&
          q.description === runtimeFixture.title &&
          q.traceUser === 'MARIAN' &&
          q.traceClient === '001' &&
          q.processType === `${TRACE_BASE}/processtypes/dialog` &&
          q.objectType === `${TRACE_BASE}/objecttypes/transaction` &&
          q.maximalExecutions === '1' &&
          q.parametersId.startsWith(`${TRACE_BASE}/parameters/`) &&
          /^[A-Za-z0-9_%-]+$/.test(q.parametersId.slice(`${TRACE_BASE}/parameters/`.length)) &&
          Date.parse(q.expires) > Date.now() &&
          Date.parse(q.expires) <= Date.now() + 65_000,
        'trace-query',
      );
      parametersId = q.parametersId;
      return;
    }
    throw new RuntimeFailure('scope');
  });
  const list = async () => {
    const response = await scoped.http.get(listPath, { Accept: 'application/atom+xml;type=feed' });
    const root = nativeXmlRoot(response.body, 'feed', 'http://www.w3.org/2005/Atom');
    need(
      !root.children('link', 'http://www.w3.org/2005/Atom').some((link) => link.attribute('rel', '') === 'next'),
      'trace-feed-incomplete',
    );
    const entries = requestFeed(response.body);
    need(
      entries.length === root.children('entry', 'http://www.w3.org/2005/Atom').length &&
        new Set(entries.map((x) => x.id)).size === entries.length &&
        entries.every((x) => x.user === 'MARIAN' && x.client === '001'),
      'trace-feed-identity',
    );
    return entries;
  };
  try {
    const before = await list();
    need(!before.some((x) => x.title === runtimeFixture.title), 'trace-preexisting');
    input.record({ profilerBaseline: before });
    const raw = await executePrivatePinnedTrace(scoped.client, start, scoped.config, scoped.context);
    // Preserve the native adapter's partial evidence before rejecting its error result.
    // Diagnostic IDs never grant cancellation authority: ownRequest is still assigned only below.
    const parsed = JSON.parse(raw.content[0].text) as PinnedTraceStartOutcome;
    if (!parsed || typeof parsed !== 'object') throw new RuntimeFailure('adapter-result');
    startOutcome = {
      state: parsed.state,
      phase: parsed.phase,
      requestOutcome: parsed.requestOutcome,
      parametersId: parsed.parametersId,
      request: parsed.request,
      readback: parsed.readback,
    };
    if (
      typeof parsed.parametersId === 'string' &&
      parsed.parametersId.startsWith(`${TRACE_BASE}/parameters/`) &&
      /^[A-Za-z0-9_%-]+$/.test(parsed.parametersId.slice(`${TRACE_BASE}/parameters/`.length))
    )
      parametersId = parsed.parametersId;
    input.record({ action: 'start', result: parsed });
    const result = runtimePayload(raw);
    need(
      result.state === 'armed' &&
        result.readback === 'confirmed' &&
        result.request?.user === 'MARIAN' &&
        result.request?.client === '001' &&
        result.request?.actingUser === 'MARIAN',
      'trace-owner',
    );
    ownRequest = result.request.id;
    need(!before.some((x) => x.id === ownRequest), 'trace-preexisting');
    const cancel = runtimePayload(
      await executePrivatePinnedTrace(
        scoped.client,
        { action: 'trace_cancel', traceUser: 'MARIAN', id: ownRequest },
        scoped.config,
        scoped.context,
      ),
    );
    input.record({ action: 'cancel', result: cancel });
    need(cancel.state === 'cancelled', 'trace-cancel');
    cancelled = true;
    const after = await list();
    need(
      same(
        [...before].sort((a, b) => a.id.localeCompare(b.id)),
        [...after].sort((a, b) => a.id.localeCompare(b.id)),
      ),
      'trace-other-state',
    );
    return {
      failure: false,
      cancelled,
      remaining: [],
      startOutcome,
      parametersDispatched,
      requestDispatched,
      parametersId,
      parametersCleanup: 'native-retention-unverified',
      mutationDispatched: scoped.mutationDispatched(),
      noWorkloadExecuted: true,
    };
  } catch (error) {
    return {
      failure: true,
      reason: runtimeReason(error),
      cancelled,
      remaining: ownRequest
        ? [ownRequest]
        : requestDispatched && startOutcome?.requestOutcome !== 'rejected'
          ? ['MARIAN profiler request outcome unknown']
          : parametersId
            ? [parametersId]
            : parametersDispatched && startOutcome?.state !== 'parameters-rejected'
              ? ['MARIAN profiler parameters outcome unknown']
              : [],
      startOutcome,
      parametersDispatched,
      requestDispatched,
      parametersId,
      parametersCleanup: 'native-retention-unverified',
      mutationDispatched: scoped.mutationDispatched(),
    };
  }
}
