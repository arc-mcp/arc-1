/** Fresh complete captured-body checks supplement the unchanged semantic native owner proofs. */
import type { AdtClient } from '../../../src/adt/client.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { pinnedDocumentSelection, readNativeDocument } from '../../../src/adt/pinned-document-owner.js';
import { ddicHash } from './native-ddic-evidence.js';
import { enhoDocument, enhoSnapshot } from './native-enho-evidence.js';
import type { EnhoFixture } from './native-enho-fixtures.js';
import { ENHO_RETAINED_BODIES, ENHO_RETAINED_SUFFIX, retainedEnhoFixtures } from './native-enho-retained-fixed.js';

function graph(f: readonly EnhoFixture[]) {
  if (JSON.stringify(f) !== JSON.stringify(retainedEnhoFixtures(ENHO_RETAINED_SUFFIX)))
    throw new Error('Exact retained enhancement graph required.');
}
/** Digest parameter is an offline test seam, never supplied by the fixed entry/driver. */
export async function retainedEnhoCounterpart(
  client: AdtClient,
  f: readonly EnhoFixture[],
  record: (v: unknown) => void,
  options: AdtRequestOptions,
  expected = ENHO_RETAINED_BODIES,
) {
  graph(f);
  const value = await readNativeDocument(client, pinnedDocumentSelection('ENHO', f[1].name), 'active', options);
  enhoDocument(f[1], f[0], value.xml, false);
  if (
    value.version !== 'active' ||
    !value.inactiveAlternative ||
    ddicHash(value.xml) !== expected[`${f[1].owner}?version=active`]
  )
    throw new Error('Original active enhancement counterpart changed.');
  record({ retainedActiveCounterpart: f[1].owner, body: value.xml, sha256: ddicHash(value.xml) });
}
export async function readRetainedEnhoStart(
  client: AdtClient,
  f: readonly EnhoFixture[],
  record: (v: unknown) => void,
  options: AdtRequestOptions,
  expected = ENHO_RETAINED_BODIES,
) {
  graph(f);
  if (JSON.stringify(Object.keys(expected)) !== JSON.stringify(Object.keys(ENHO_RETAINED_BODIES)))
    throw new Error('Exact retained body paths required.');
  for (const [path, digest] of Object.entries(expected)) {
    const plain = path.includes('/source/main');
    const response = await client.http.get(
      path,
      { Accept: plain ? 'text/plain' : 'application/*', 'Cache-Control': 'no-cache' },
      options,
    );
    if (
      response.statusCode !== 200 ||
      ddicHash(response.body) !== digest ||
      (plain &&
        !Object.entries(response.headers).some(
          ([k, v]) => k.toLowerCase() === 'content-type' && v.split(';')[0].trim() === 'text/plain',
        ))
    )
      throw new Error('Retained full native body changed.');
    record({ retainedRead: path, body: response.body, sha256: digest });
  }
  // Close the read-to-semantic-proof window without adopting freshly drifted native bytes.
  const http = new Proxy(client.http, {
    get(target, key) {
      if (key === 'get')
        return async (...args: Parameters<typeof target.get>) => {
          const response = await target.get(...args);
          if (!expected[args[0]] || response.statusCode !== 200 || ddicHash(response.body) !== expected[args[0]])
            throw new Error('Retained native body drifted during adoption.');
          return response;
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  client = Object.assign(Object.create(Object.getPrototypeOf(client)), client, { http }) as AdtClient;
  const parent = await enhoSnapshot(client, f, f[0], false, true, record, options);
  const child = await enhoSnapshot(client, f, f[1], true, false, record, options);
  if (ddicHash(child.xml!) !== expected[f[1].owner] || parent.sourceHash !== expected[`${f[0].owner}/source/main`])
    throw new Error('Retained source changed across semantic proof.');
  await retainedEnhoCounterpart(client, f, record, options, expected);
  return [parent, child];
}
