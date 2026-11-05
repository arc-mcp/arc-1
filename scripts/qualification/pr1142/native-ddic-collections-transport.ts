import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import type { CollectionsFixture } from './native-ddic-collections-fixtures.js';
/** Only the three compiled owners; source/search additions are exact existing native routes. */
import { checkDdicRequest } from './native-ddic-transport.js';
export function checkCollectionsRequest(
  fixtures: readonly CollectionsFixture[],
  selected: CollectionsFixture | undefined,
  stage: string | undefined,
  method: string,
  path: string,
  body?: string,
) {
  if (path.startsWith('/sap/bc/adt/') && !/[#\\]/.test(path)) {
    const url = new URL(path, 'https://a4h.marianzeis.de'),
      keys = [...url.searchParams.keys()];
    if (url.pathname === path.split('?')[0] && new Set(keys).size === keys.length) {
      const source = fixtures.find((f) => f.type === 'TABL/DS' && url.pathname === `${f.owner}/source/main`);
      if (
        method === 'GET' &&
        source &&
        keys.every((k) => k === 'version') &&
        (!keys.length || ['active', 'inactive'].includes(url.searchParams.get('version') ?? ''))
      )
        return;
      if (
        method === 'PUT' &&
        selected === source &&
        source &&
        [`create-${source.type}`, `update-${source.type}`].includes(stage ?? '') &&
        keys.length === 1 &&
        keys[0] === 'lockHandle' &&
        url.searchParams.get('lockHandle') &&
        body === (stage?.startsWith('create-') ? source.create.source : source.update.source)
      )
        return;
      if (
        method === 'GET' &&
        selected?.type === 'TABL/DS' &&
        stage &&
        !stage.startsWith('create-') &&
        url.pathname === '/sap/bc/adt/repository/informationsystem/search' &&
        keys.length === 3 &&
        keys.every((k) => ['operation', 'query', 'maxResults'].includes(k)) &&
        url.searchParams.get('operation') === 'quickSearch' &&
        url.searchParams.get('query') === selected.name &&
        url.searchParams.get('maxResults') === '5'
      )
        return;
    }
  }
  checkDdicRequest(fixtures, selected, stage, method, path, body);
}

/** Production activation offers 4 MiB per source; this experiment only permits 2 MiB in total.
 * Clamp before observer admission. Its inner ddicBoundHttp still owns the shared aggregate budget.
 */
export function collectionsResponseCap(http: AdtHttpClient, allMethods = false): AdtHttpClient {
  return new Proxy(http, {
    get(target, key) {
      if (key === 'withStatefulSession')
        return (fn: (s: AdtHttpClient) => unknown, close: unknown) =>
          Reflect.apply(target.withStatefulSession, target, [
            (session: AdtHttpClient) => fn(collectionsResponseCap(session, allMethods)),
            close,
          ]);
      if (key === 'get' || (allMethods && ['head', 'post', 'put', 'delete'].includes(String(key))))
        return (...args: unknown[]) => {
          const index = key === 'post' || key === 'put' ? 4 : 2;
          const options = args[index] as AdtRequestOptions | undefined;
          const budget = options?.responseBudget;
          const policy =
            budget && (budget.limitBytes > 2 * 1024 * 1024 || !budget.countAllResponses)
              ? {
                  ...options,
                  responseBudget: new DataResponseBudget(
                    Math.min(budget.limitBytes, 2 * 1024 * 1024),
                    'collections-source-cap',
                    true,
                  ),
                }
              : options;
          args[index] = policy;
          return Reflect.apply(Reflect.get(target, key), target, args);
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
