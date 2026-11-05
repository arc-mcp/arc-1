/** Fixed stage scope and final send budget. No caller-selected protocol, new owner or request replay. */
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { throwIfRequestCancelled } from '../../../src/adt/http-deadline.js';
import { RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';
import { checkDeclarativeRequest, isDeclarativeOwnerUnlock } from './native-declarative-transport.js';
import {
  absentPeers,
  absentReference,
  retainedService,
  retainedView,
  type RetainedStage,
} from './native-v5-retained-fixed.js';
export const selectedRetained = (stage: RetainedStage) =>
  stage === 'delete-view'
    ? retainedView
    : stage === 'inspect' || stage === 'final'
      ? undefined
      : retainedService;
const readPaths = new Set([
  ...[retainedService, retainedView].flatMap((f) =>
    ['', '?version=active', '?version=inactive'].flatMap((q) => [f.owner + q, `${f.owner}/source/main${q}`]),
  ),
  ...absentPeers.map((f) => f.owner),
  absentReference.owner,
  '/sap/bc/adt/activation/inactiveobjects',
]);
export function checkRetainedRequest(stage: RetainedStage, method: string, path: string, body?: string) {
  if (method === 'GET' && readPaths.has(path)) return;
  if (method === 'HEAD' && path === '/sap/bc/adt/discovery') return;
  const fixture = selectedRetained(stage);
  if (!fixture) throw new Error('No retained mutation stage selected.');
  checkDeclarativeRequest(fixture, method, path, body);
  const uri = new URL(path, 'https://a4h.marianzeis.de');
  if (method === 'GET' || method === 'HEAD') throw new Error('Read outside retained evidence scope.');
  if (isDeclarativeOwnerUnlock(fixture, method, path)) return;
  if (method === 'POST' && uri.pathname === '/sap/bc/adt/cts/transportchecks') return;
  if (
    method === 'POST' &&
    uri.pathname === fixture.owner &&
    uri.searchParams.get('_action') === 'LOCK' &&
    ['correct', 'revise-label', 'delete-service', 'delete-view'].includes(stage)
  )
    return;
  if (
    method === 'PUT' &&
    fixture === retainedService &&
    ['correct', 'revise-label'].includes(stage) &&
    body === (stage === 'correct' ? retainedService.source : retainedService.updatedSource)
  )
    return;
  if (
    method === 'POST' &&
    uri.pathname === '/sap/bc/adt/activation' &&
    ['activate-corrected', 'activate-revised'].includes(stage)
  )
    return;
  if (method === 'DELETE' && ['delete-service', 'delete-view'].includes(stage)) return;
  throw new Error('Mutation outside the fixed continuation stage.');
}
function bothResponseBudgets(
  original: DataResponseBudget | undefined,
  outer: DataResponseBudget,
): DataResponseBudget {
  if (!original || original === outer) return outer;
  return new Proxy(outer, {
    get(target, key) {
      if (key === 'assertSingleResponseBytes')
        return (size: number, id?: string) => {
          original.assertSingleResponseBytes(size, id);
          target.assertSingleResponseBytes(size, id);
        };
      if (key === 'createReservation')
        return () => {
          const a = original.createReservation(),
            b = target.createReservation();
          return new Proxy(b, {
            get(reservation, field) {
              if (field === 'add')
                return (size: number, id?: string) => {
                  try {
                    a.add(size, id);
                    b.add(size, id);
                  } catch (error) {
                    a.release();
                    b.release();
                    throw error;
                  }
                };
              if (field === 'commit')
                return () => {
                  a.commit();
                  b.commit();
                };
              if (field === 'release')
                return () => {
                  a.release();
                  b.release();
                };
              const value = Reflect.get(reservation, field, reservation);
              return typeof value === 'function' ? value.bind(reservation) : value;
            },
          });
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
export interface RetainedTransportInput {
  stage: () => RetainedStage;
  verify: () => void;
  shouldStop: () => boolean;
  deadline: number;
  record: (row: unknown) => void;
  readOnly?: boolean;
}
export function retainedTransport(http: AdtHttpClient, input: RetainedTransportInput) {
  const main = new RequestAttemptBudget(input.readOnly ? 48 : 256);
  const bytes = new DataResponseBudget(2 * 1024 * 1024, 'retained-v5', true);
  const cleanup = new Map<
    RetainedStage,
    { attempts: RequestAttemptBudget; bytes: DataResponseBudget; deadline: number }
  >();
  const submitted = new Set<string>();
  let ended = false;
  const wrap = (raw: AdtHttpClient): AdtHttpClient =>
    new Proxy(raw, {
      get(target, property) {
        if (property === 'withStatefulSession')
          return (
            run: (session: AdtHttpClient) => Promise<unknown>,
            state: Parameters<AdtHttpClient['withStatefulSession']>[1],
          ) => target.withStatefulSession((s) => run(wrap(s)), state);
        if (['get', 'head', 'post', 'put', 'delete'].includes(String(property)))
          return async (...args: unknown[]) => {
            const method = String(property).toUpperCase(),
              path = String(args[0]),
              stage = input.stage();
            const body = ['POST', 'PUT'].includes(method) ? (args[1] as string | undefined) : undefined;
            const index = ['POST', 'PUT'].includes(method) ? 4 : 2;
            checkRetainedRequest(stage, method, path, body);
            if (input.readOnly && method !== 'GET') throw new Error('Preflight is GET-only.');
            const ownUnlock = isDeclarativeOwnerUnlock(selectedRetained(stage), method, path);
            if (ownUnlock && !cleanup.has(stage))
              cleanup.set(stage, {
                attempts: new RequestAttemptBudget(4),
                bytes: new DataResponseBudget(64 * 1024, 'retained-own-cleanup', true),
                deadline: Date.now() + 30_000,
              });
            const own = ownUnlock ? cleanup.get(stage)! : undefined;
            const original = args[index] as AdtRequestOptions | undefined;
            const effective: AdtRequestOptions = {
              ...original,
              deadline: Math.min(
                original?.deadline ?? Infinity,
                own?.deadline ?? input.deadline,
                Date.now() + 30_000,
              ),
              responseBudget: bothResponseBudgets(original?.responseBudget, own?.bytes ?? bytes),
              noReplay: true,
              retryTransientErrors: false,
            };
            const key = `${stage}:${method}:${path.split('?')[0]}:${new URL(path, 'https://a4h.marianzeis.de').searchParams.get('preauditRequested') ?? ''}`;
            const single =
              method === 'PUT' ||
              method === 'DELETE' ||
              (method === 'POST' && path.startsWith('/sap/bc/adt/activation?'));
            const proof = () => {
              checkRetainedRequest(stage, method, path, body);
              if (!ownUnlock) {
                if (ended || input.stage() !== stage || input.shouldStop())
                  throw new Error('Retained execution stopped.');
                input.verify();
                if (single && submitted.has(key)) throw new Error('Retained stage cannot be replayed.');
              }
              throwIfRequestCancelled(effective);
            };
            const budget = new RequestAttemptBudget(1);
            budget.consume = () => {
              original?.attemptBudget?.consume();
              (own?.attempts ?? main).consume();
              proof();
            };
            budget.dispatched = (actualMethod) => {
              original?.attemptBudget?.dispatched?.(actualMethod);
              if (actualMethod !== method) return;
              if (single) submitted.add(key);
              input.record({
                retainedDispatch: true,
                stage,
                method,
                owner: selectedRetained(stage)?.owner,
                mutation: single,
              });
            };
            effective.attemptBudget = budget;
            proof();
            args[index] = effective;
            return Reflect.apply(Reflect.get(target, property), target, args);
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  return {
    http: wrap(http),
    finish: () => {
      ended = true;
    },
    attempts: main,
  };
}
