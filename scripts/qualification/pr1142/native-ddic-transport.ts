/** Fixed native request scope. Shared observer repeats this after queue/CSRF/token waits. */

import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { throwIfRequestCancelled } from '../../../src/adt/http-deadline.js';
import { nativeXmlRoot } from '../../../src/adt/native-xml-evidence.js';
import { pinnedDdicSelection } from '../../../src/adt/pinned-ddic-owner.js';
import { RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';
export interface DdicRequestFixture {
  type: string;
  name: string;
  owner: string;
}

import type { DeclarativeFixture } from './native-declarative-fixtures.js';
import { isDeclarativeOwnerUnlock } from './native-declarative-transport.js';
export const ddicUnlock = (f: DdicRequestFixture | undefined, m: string, p: string) =>
  isDeclarativeOwnerUnlock(f as unknown as DeclarativeFixture, m, p);
export function checkDdicRequest(
  fixtures: readonly DdicRequestFixture[],
  selected: DdicRequestFixture | undefined,
  stage: string | undefined,
  method: string,
  path: string,
  body?: string,
) {
  if (!path.startsWith('/sap/bc/adt/') || /[#\\]/.test(path)) throw new Error('Fixed DDIC path required.');
  const url = new URL(path, 'https://a4h.marianzeis.de'),
    keys = [...url.searchParams.keys()];
  if (
    url.origin !== 'https://a4h.marianzeis.de' ||
    url.pathname !== path.split('?')[0] ||
    new Set(keys).size !== keys.length
  )
    throw new Error('Fixed DDIC path/query required.');
  const query = (allowed: string[]) => keys.every((k) => allowed.includes(k));
  if (method === 'GET') {
    if (
      fixtures.some((f) => url.pathname === f.owner) &&
      query(['version']) &&
      (!keys.length || ['active', 'inactive'].includes(url.searchParams.get('version') ?? ''))
    )
      return;
    if (url.pathname === '/sap/bc/adt/activation/inactiveobjects' && !keys.length) return;
    throw new Error('Read outside fixed DDIC evidence.');
  }
  if (method === 'HEAD' && fixtures.some((f) => url.pathname === f.owner) && !keys.length) return;
  if (!selected || !stage) throw new Error('No selected DDIC stage.');
  if (ddicUnlock(selected, method, path)) return;
  if (method === 'POST' && url.pathname === '/sap/bc/adt/cts/transportchecks' && !keys.length) {
    const root = nativeXmlRoot(body ?? '', 'abap', 'http://www.sap.com/abapxml');
    for (const operation of ['I', '']) {
      const xml = `<a:abap xmlns:a="http://www.sap.com/abapxml" version="1.0"><a:values><DATA><DEVCLASS>$TMP</DEVCLASS><URI>${selected.owner}</URI><OPERATION>${operation}</OPERATION></DATA></a:values></a:abap>`;
      if (
        JSON.stringify(root.canonicalValue({})) ===
        JSON.stringify(nativeXmlRoot(xml, 'abap', 'http://www.sap.com/abapxml').canonicalValue({}))
      )
        return;
    }
  }
  if (
    method === 'POST' &&
    url.pathname === selected.owner &&
    url.searchParams.get('_action') === 'LOCK' &&
    url.searchParams.get('accessMode') === 'MODIFY' &&
    query(['_action', 'accessMode'])
  )
    return;
  if (
    method === 'DELETE' &&
    stage === `delete-${selected.type}` &&
    url.pathname === selected.owner &&
    url.searchParams.get('lockHandle') &&
    query(['lockHandle'])
  )
    return;
  const core = 'http://www.sap.com/adt/core',
    profile = pinnedDdicSelection(selected.type, selected.name);
  if (
    (method === 'POST' &&
      stage === `create-${selected.type}` &&
      url.pathname === profile.collection &&
      query(['_package']) &&
      [null, '$TMP'].includes(url.searchParams.get('_package'))) ||
    (method === 'PUT' &&
      !stage.startsWith('stale-') &&
      ['create-', 'update-'].some((p) => stage.startsWith(p)) &&
      url.pathname === selected.owner &&
      url.searchParams.get('lockHandle') &&
      query(['lockHandle']))
  ) {
    const root = nativeXmlRoot(body ?? '', profile.root, profile.namespace, true);
    if (
      root.attribute('name', core) === selected.name &&
      (!root.attribute('type', core) || root.attribute('type', core) === profile.native) &&
      root.child('packageRef', core)?.attribute('name', core) === '$TMP' &&
      !root.hasChild('containerRef')
    )
      return;
  }
  if (
    method === 'POST' &&
    (stage === `activate-${selected.type}` || stage === `reactivate-${selected.type}`) &&
    url.pathname === '/sap/bc/adt/activation' &&
    query(['method', 'preauditRequested']) &&
    url.searchParams.get('method') === 'activate' &&
    ['true', 'false'].includes(url.searchParams.get('preauditRequested') ?? '')
  ) {
    const refs = nativeXmlRoot(body ?? '', 'objectReferences', core).children('objectReference', core);
    if (
      refs.length === 1 &&
      refs[0].attribute('uri', core) === selected.owner &&
      refs[0].attribute('name', core) === selected.name &&
      (!refs[0].attribute('type', core) || refs[0].attribute('type', core) === profile.native)
    )
      return;
  }
  throw new Error('Mutation outside fixed DDIC stage.');
}
/** Retain the original absolute deadline and one aggregate budget across every adapter/context. */
export function ddicBoundHttp(
  http: AdtHttpClient,
  input: {
    attemptLimit?: 256 | 384 | 640 | 768;
    deadline: number;
    assert: () => void;
    unlock: (m: string, p: string) => boolean;
  },
) {
  const limit = input.attemptLimit ?? 256;
  if (![256, 384, 640, 768].includes(limit)) throw new Error('Fixed DDIC attempt limit required.');
  const attempts = new RequestAttemptBudget(limit),
    responses = new DataResponseBudget(2 * 1024 * 1024, 'native-ddic', true);
  const wrap = (base: AdtHttpClient): AdtHttpClient =>
    new Proxy(base, {
      get(target, key) {
        if (key === 'withStatefulSession')
          return (fn: (s: AdtHttpClient) => unknown, close: unknown) =>
            Reflect.apply(target.withStatefulSession, target, [(session: AdtHttpClient) => fn(wrap(session)), close]);
        const value = Reflect.get(target, key, target);
        if (!['get', 'head', 'post', 'put', 'delete'].includes(String(key)))
          return typeof value === 'function' ? value.bind(target) : value;
        return (...args: unknown[]) => {
          const method = String(key).toUpperCase(),
            path = String(args[0]),
            unlock = input.unlock(method, path),
            index = ['POST', 'PUT'].includes(method) ? 4 : 2;
          const supplied = args[index] as AdtRequestOptions | undefined;
          const policy: AdtRequestOptions = {
            ...supplied,
            noReplay: true,
            retryTransientErrors: false,
            deadline: Math.min(supplied?.deadline ?? Infinity, unlock ? Date.now() + 30000 : input.deadline),
            responseBudget: unlock ? new DataResponseBudget(65536, 'ddic-own-unlock', true) : responses,
          };
          const budget = supplied?.attemptBudget ?? (unlock ? new RequestAttemptBudget(4) : attempts);
          policy.attemptBudget = new Proxy(budget, {
            get(b, k) {
              if (k === 'consume')
                return () => {
                  const used = attempts.used;
                  b.consume();
                  if (!unlock && attempts.used === used) attempts.consume();
                  if (!unlock) input.assert();
                  throwIfRequestCancelled(policy);
                };
              const v = Reflect.get(b, k);
              return typeof v === 'function' ? v.bind(b) : v;
            },
          });
          args[index] = policy;
          return Reflect.apply(value, target, args);
        };
      },
    });
  return wrap(http);
}
