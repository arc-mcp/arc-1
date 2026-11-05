import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError, AdtNetworkError } from '../../../src/adt/errors.js';
import type { AdtRequestOptions } from '../../../src/adt/http.js';
import { handlePrivatePinnedCts } from '../../../src/handlers/pinned-cts.js';
import { requestContext } from '../../../src/server/context.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';

const parent = 'DEVK900001',
  task = 'DEVK900002',
  third = 'DEVK900003';
const ns = 'http://www.sap.com/cts/adt/tm';
const root = (xml: string) => `<tm:root xmlns:tm="${ns}">${xml}</tm:root>`;
const inactive = '<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects"/>';
const typedAbsent = (id: string) =>
  new AdtApiError(
    'missing',
    404,
    `/sap/bc/adt/cts/transportrequests/${id}`,
    readFileSync(new URL('../../fixtures/xml/cts-request-not-found-a4h-758.xml', import.meta.url), 'utf8').replaceAll(
      'A4HK000000',
      id,
    ),
  );
const object =
  '<tm:abap_object tm:pgmid="R3TR" tm:type="CLAS" tm:name="ZCL_TEST" tm:position="000010" tm:lock_status="X"/>';
function setup() {
  const config: ServerConfig = {
    ...DEFAULT_CONFIG,
    multiTargetEndpoints: true,
    ppEnabled: true,
    ppStrict: true,
    allowWrites: true,
    allowTransportWrites: true,
    targetId: 'DEV/001',
    allowedPackages: ['$TMP'],
    multiTargetWrite: {
      enabled: true,
      target: 'DEV/001',
      allowedPackages: ['$TMP'],
      allowedTransports: [parent],
      serverAllowedTransports: [parent],
    },
  };
  const state = {
    exists: true,
    tasks: [task],
    owners: new Map([
      [parent, 'DEV'],
      [task, 'DEV'],
    ]),
    statuses: new Map([
      [parent, 'D'],
      [task, 'D'],
    ]),
    objects: '',
    type: 'K',
    target: '',
    description: 'Fixture request',
    inactive,
    readHook: undefined as undefined | ((path: string, body: string) => string),
    writeHook: undefined as undefined | ((method: string, id: string, body?: string) => void),
  };
  const tree = () =>
    root(
      state.exists
        ? `<tm:request tm:number="${parent}" tm:owner="${state.owners.get(parent)}" tm:type="${state.type}" tm:status="${state.statuses.get(parent)}" tm:target="${state.target}" tm:desc="${state.description}">${state.tasks
            .map(
              (id) =>
                `<tm:task tm:number="${id}" tm:owner="${state.owners.get(id) ?? 'DEV'}" tm:status="${state.statuses.get(id) ?? 'D'}">${state.objects}</tm:task>`,
            )
            .join('')}</tm:request>`
        : '',
    );
  const response = (body: string) => ({ statusCode: 200, headers: {}, body });
  const http = {
    get: vi.fn(async (path: string, _headers?: unknown, _options?: AdtRequestOptions) =>
      response(
        state.readHook?.(path, path.includes('inactiveobjects') ? state.inactive : tree()) ??
          (path.includes('inactiveobjects') ? state.inactive : tree()),
      ),
    ),
    post: vi.fn(
      async (path: string, body?: string, _type?: string, _headers?: unknown, _options?: AdtRequestOptions) => {
        const id = path.match(/\/transportrequests\/([^/]+)\/newreleasejobs/)?.[1];
        state.writeHook?.('POST', id ?? '', body);
        if (id) {
          state.statuses.set(id, 'R');
          return response(root(''));
        }
        state.exists = true;
        state.description =
          body?.match(/tm:desc="([^"]*)"/)?.[1] ?? body?.match(/<REQUEST_TEXT>(.*?)<\/REQUEST_TEXT>/)?.[1] ?? '';
        if (path === '/sap/bc/adt/cts/transportrequests') {
          state.target = body?.match(/tm:target="([^"]+)"/)?.[1] ?? '';
          return response(tree());
        }
        return response(`/sap/bc/adt/cts/transportrequests/${parent}`);
      },
    ),
    put: vi.fn(
      async (path: string, body?: string, _type?: string, _headers?: unknown, _options?: AdtRequestOptions) => {
        const id = path.split('/').at(-1)!.split('?')[0];
        state.writeHook?.('PUT', id, body);
        if (body?.includes('changeowner')) state.owners.set(id, 'NEWOWNER');
        else state.objects = '';
        return response('');
      },
    ),
    delete: vi.fn(async (path: string, _headers?: unknown, _options?: AdtRequestOptions) => {
      const id = path.split('/').at(-1)!;
      state.writeHook?.('DELETE', id);
      if (id === parent) state.exists = false;
      else state.tasks = state.tasks.filter((candidate) => candidate !== id);
      return response('');
    }),
    hasDiscoveryData: () => true,
    discoveryAcceptFor: () => 'application/vnd.sap.adt.transportorganizer.v1+xml',
  };
  const client = Object.assign(Object.create(AdtClient.prototype) as AdtClient, { http, safety: config });
  const run = async (args: Record<string, unknown>, scopes = ['read', 'write', 'transports']) => {
    const result = await handlePrivatePinnedCts(client, config, args, scopes);
    return JSON.parse((result.content[0] as { text: string }).text);
  };
  return { run, state, http, config };
}

describe('private CTS candidate', () => {
  it('keeps native TMS target selection separate from the pinned backend and omits caller IdP identity', async () => {
    const s = setup();
    s.config.multiTargetWrite = {
      ...s.config.multiTargetWrite!,
      allowedTransports: ['*'],
      serverAllowedTransports: [],
    };
    const result = await s.run({ action: 'create', target: 'C11.021', description: 'Native route' });
    expect(result).toMatchObject({ ok: true, target: 'DEV/001', nativeTarget: 'C11.021' });
    expect(s.http.post.mock.calls[0][1]).toContain('tm:target="C11.021"');
    expect(s.http.post.mock.calls[0][1]).not.toContain('tm:owner=');
  });
  it.each(['layers', 'targets'])('keeps private %s companion read-scoped and bounded', async (action) => {
    const s = setup();
    s.config.allowTransportWrites = false;
    s.state.readHook = () =>
      '<n:namedItemList xmlns:n="http://www.sap.com/adt/nameditem"><n:totalItemCount>0</n:totalItemCount></n:namedItemList>';
    expect(await s.run({ action }, ['read'])).toMatchObject({ ok: true, values: [], complete: true });
    expect(s.http.get.mock.calls[0][2]).toMatchObject({ noReplay: true });
    expect(s.http.post).not.toHaveBeenCalled();
  });
  it('does not echo an unrecognized action into its bounded result', async () => {
    const s = setup();
    expect(await s.run({ action: 'secret'.repeat(1000) })).toMatchObject({ ok: false, action: 'invalid' });
  });
  it.each(['delete', 'reassign', 'release', 'release_recursive'])(
    'runs %s under the shared scope and confirms native outcomes',
    async (action) => {
      const s = setup();
      const result = await s.run({
        action,
        id: parent,
        ...(action === 'reassign' ? { owner: 'NEWOWNER', recursive: true } : {}),
        ...(action === 'delete' ? { recursive: true } : {}),
      });
      expect(result).toMatchObject({ ok: true, state: 'confirmed', target: 'DEV/001', nativeTarget: '' });
      expect(result.completed.length).toBe(action === 'release' ? 1 : 2);
      const options = s.http.get.mock.calls.map((call) => call[2]!);
      expect(options.every((option) => option.noReplay && option.retryTransientErrors === false)).toBe(true);
      expect(new Set(options.map((option) => option.responseBudget)).size).toBe(1);
      expect(new Set(options.map((option) => option.attemptBudget)).size).toBe(1);
      expect(options[0].responseBudget).toMatchObject({ limitBytes: 8388608, countAllResponses: true });
      expect(new Set(options.map((option) => option.deadline)).size).toBe(1);
    },
  );
  it.each([['read'], ['read', 'write'], ['admin'], ['transports']])(
    'refuses incomplete scopes %j before GET',
    async (...scopes) => {
      const s = setup();
      expect(await s.run({ action: 'delete', id: parent }, scopes)).toMatchObject({ ok: false, state: 'unchanged' });
      expect(s.http.get).not.toHaveBeenCalled();
    },
  );
  it('allows write plus admin to imply transports, but never admin-only write', async () => {
    const s = setup();
    expect(await s.run({ action: 'reassign', id: task, owner: 'NEWOWNER' }, ['write', 'admin'])).toMatchObject({
      ok: true,
    });
    expect(s.http.put).toHaveBeenCalledTimes(1);
  });
  it.each(['allowWrites', 'allowTransportWrites', 'ppEnabled', 'ppStrict', 'multiTargetEndpoints'] as const)(
    'refuses missing %s before GET',
    async (field) => {
      const s = setup();
      s.config[field] = false;
      expect(await s.run({ action: 'delete', id: parent })).toMatchObject({ ok: false, state: 'unchanged' });
      expect(s.http.get).not.toHaveBeenCalled();
    },
  );
  it.each(['allowedTransports', 'serverAllowedTransports'] as const)(
    'checks %s on the canonical parent, not task prefix',
    async (field) => {
      const s = setup();
      s.config.multiTargetWrite = { ...s.config.multiTargetWrite!, [field]: [task] };
      expect(await s.run({ action: 'delete', id: task })).toMatchObject({ ok: false, state: 'unchanged' });
      expect(s.http.delete).not.toHaveBeenCalled();
    },
  );
  it.each(['SAPTransport', 'SAPTransport.delete', 'SAPTransport.del*'])(
    'honors deny action %s before reads',
    async (deny) => {
      const s = setup();
      s.config.denyActions = [deny];
      expect(await s.run({ action: 'delete', id: parent })).toMatchObject({ ok: false });
      expect(s.http.get).not.toHaveBeenCalled();
    },
  );
  it('refuses the entire recursive operation before writing when a later child is not modifiable', async () => {
    const s = setup();
    s.state.tasks.push(third);
    s.state.statuses.set(third, 'R');
    expect(await s.run({ action: 'reassign', id: parent, owner: 'NEWOWNER', recursive: true })).toMatchObject({
      ok: false,
      state: 'unchanged',
    });
    expect(s.http.put).not.toHaveBeenCalled();
  });
  it('stops at membership drift between recursive writes with truthful partial results', async () => {
    const s = setup();
    s.state.writeHook = () => s.state.tasks.push(third);
    const result = await s.run({ action: 'reassign', id: parent, owner: 'NEWOWNER', recursive: true });
    expect(result).toMatchObject({ ok: false, state: 'incomplete', submissions: [{ acknowledged: true }] });
    expect(s.http.put).toHaveBeenCalledTimes(1);
    expect(result.completed).toEqual([]); // The post-write evidence itself became incomplete.
  });
  it('preserves a confirmed earlier delete when the parent delete fails, without retry', async () => {
    const s = setup();
    s.state.writeHook = (_method, id) => {
      if (id === parent) throw new AdtNetworkError('secret token');
    };
    const result = await s.run({ action: 'delete', id: parent, recursive: true });
    expect(result).toMatchObject({
      ok: false,
      state: 'incomplete',
      completed: [{ id: task, state: 'confirmed' }],
      submissions: [{ acknowledged: true }, { acknowledged: false }],
    });
    expect(s.http.delete).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain('secret token');
  });
  it.each([403, 409, 500])('never retries uncertain/rejected mutation HTTP %s', async (status) => {
    const s = setup();
    s.state.writeHook = () => {
      throw new AdtApiError('secret body', status, '/private');
    };
    expect(await s.run({ action: 'reassign', id: parent, owner: 'NEWOWNER' })).toMatchObject({
      state: 'incomplete',
      httpStatus: status,
    });
    expect(s.http.put).toHaveBeenCalledTimes(1);
  });
  it('does not accept an untyped 404 as deletion proof', async () => {
    const s = setup();
    s.state.writeHook = () => {
      s.state.readHook = () => {
        throw new AdtApiError('not found', 404, '/private');
      };
    };
    expect(await s.run({ action: 'delete', id: task })).toMatchObject({
      ok: false,
      state: 'incomplete',
      completed: [],
    });
  });
  it('confirms recursive deletion after the exact typed parent404, without retry', async () => {
    const s = setup();
    s.state.writeHook = (method, id) => {
      if (method === 'DELETE' && id === parent)
        s.state.readHook = () => {
          throw typedAbsent(parent);
        };
    };
    expect(await s.run({ action: 'delete', id: parent, recursive: true })).toMatchObject({
      ok: true,
      state: 'confirmed',
      completed: [
        { id: task, state: 'confirmed' },
        { id: parent, state: 'confirmed' },
      ],
      submissions: [{ acknowledged: true }, { acknowledged: true }],
    });
    expect(s.http.delete).toHaveBeenCalledTimes(2);
  });
  it('refuses typed parent absence during initial preflight before any DELETE', async () => {
    const s = setup();
    s.state.readHook = () => {
      throw typedAbsent(parent);
    };
    expect(await s.run({ action: 'delete', id: parent, recursive: true })).toMatchObject({
      ok: false,
      state: 'unchanged',
    });
    expect(s.http.delete).not.toHaveBeenCalled();
  });
  it('refuses parent disappearance after only a child DELETE and preserves the acknowledged submission', async () => {
    const s = setup();
    s.state.writeHook = () => {
      s.state.readHook = () => {
        throw typedAbsent(parent);
      };
    };
    expect(await s.run({ action: 'delete', id: parent, recursive: true })).toMatchObject({
      ok: false,
      state: 'incomplete',
      completed: [],
      submissions: [{ acknowledged: true }],
    });
    expect(s.http.delete).toHaveBeenCalledTimes(1);
  });
  it('passes the full native object key and confirms entry removal independently', async () => {
    const s = setup();
    s.state.objects = object;
    const result = await s.run({ action: 'remove_object', id: parent, type: 'CLAS', name: 'ZCL_TEST' });
    expect(result).toMatchObject({
      ok: true,
      completed: [{ id: task, operation: 'remove_object', object: '["R3TR","CLAS","ZCL_TEST","000010"]' }],
    });
    expect(s.http.put.mock.calls[0][1]).toContain('tm:position="000010"');
  });
  it('refuses ambiguous selectors before a PUT', async () => {
    const s = setup();
    s.state.objects = object + object.replace('000010', '000020');
    expect(await s.run({ action: 'remove_object', id: parent, type: 'CLAS', name: 'ZCL_TEST' })).toMatchObject({
      ok: false,
      state: 'unchanged',
    });
    expect(s.http.put).not.toHaveBeenCalled();
  });
  it('refuses the known older remove-object contract without native lock metadata before PUT', async () => {
    const s = setup();
    s.state.objects = object.replace(' tm:lock_status="X"', '');
    expect(await s.run({ action: 'remove_object', id: parent, type: 'CLAS', name: 'ZCL_TEST' })).toMatchObject({
      state: 'unchanged',
    });
    expect(s.http.put).not.toHaveBeenCalled();
  });
  it('reports destructive locked-entry cleanup separately from task deletion', async () => {
    const s = setup();
    s.state.objects = object;
    expect(await s.run({ action: 'delete', id: parent, recursive: true, removeLockedObjects: true })).toMatchObject({
      ok: true,
      completed: [
        { operation: 'remove_locked_entry', id: task },
        { operation: 'delete', id: task },
        { operation: 'delete', id: parent },
      ],
    });
  });
  it('requires native lock metadata before any cleanup', async () => {
    const s = setup();
    s.state.objects = object.replace(' tm:lock_status="X"', '');
    expect(await s.run({ action: 'delete', id: parent, recursive: true, removeLockedObjects: true })).toMatchObject({
      state: 'unchanged',
    });
    expect(s.http.put).not.toHaveBeenCalled();
    expect(s.http.delete).not.toHaveBeenCalled();
  });
  it.each(['', '<html/>', '<ioc:inactiveObjects xmlns:ioc="wrong"/>'])(
    'fails closed on unqualified inactive evidence %s',
    async (body) => {
      const s = setup();
      s.state.inactive = body;
      expect(await s.run({ action: 'release', id: parent })).toMatchObject({ ok: false, state: 'unchanged' });
      expect(s.http.post).not.toHaveBeenCalled();
    },
  );
  it('accepts generated-ID create only under both unrestricted request policies', async () => {
    const s = setup();
    s.config.multiTargetWrite = {
      ...s.config.multiTargetWrite!,
      allowedTransports: ['*'],
      serverAllowedTransports: [],
    };
    expect(await s.run({ action: 'create', package: '$TMP', description: 'Private test' })).toMatchObject({
      ok: true,
      selected: parent,
      nativeTarget: '',
    });
    expect(s.http.post).toHaveBeenCalledTimes(1);
  });
  it.each(['allowedTransports', 'serverAllowedTransports'] as const)(
    'refuses generated-ID creation under %s prefix policy',
    async (field) => {
      const s = setup();
      s.config.multiTargetWrite = {
        ...s.config.multiTargetWrite!,
        allowedTransports: ['*'],
        serverAllowedTransports: [],
        [field]: ['DEV*'],
      };
      expect(await s.run({ action: 'create', package: '$TMP', description: 'Private test' })).toMatchObject({
        state: 'unchanged',
      });
      expect(s.http.post).not.toHaveBeenCalled();
    },
  );
  it('refuses package routing outside either package policy before POST', async () => {
    const s = setup();
    s.config.multiTargetWrite = {
      ...s.config.multiTargetWrite!,
      allowedTransports: ['*'],
      serverAllowedTransports: [],
    };
    expect(await s.run({ action: 'create', package: 'ZOTHER', description: 'Private test' })).toMatchObject({
      state: 'unchanged',
    });
    expect(s.http.post).not.toHaveBeenCalled();
  });
  it('does not send on cancellation and stops between writes without dropping earlier results', async () => {
    const s = setup(),
      abort = new AbortController();
    s.state.writeHook = () => abort.abort();
    const result = await requestContext.run({ requestId: 'cts-test', signal: abort.signal }, () =>
      s.run({ action: 'reassign', id: parent, owner: 'NEWOWNER', recursive: true }),
    );
    expect(result).toMatchObject({ state: 'incomplete' });
    expect(s.http.put).toHaveBeenCalledTimes(1);
    const reads = s.http.get.mock.calls.length;
    await requestContext.run({ requestId: 'cts-test', signal: abort.signal }, () =>
      s.run({ action: 'delete', id: parent }),
    );
    expect(s.http.get).toHaveBeenCalledTimes(reads);
  });
  it.each([
    { action: 'release', id: parent, timeoutSeconds: 301 },
    { action: 'create', description: 'x' },
    { action: 'create', description: 'x', target: 'DEV/001' },
    { action: 'reassign', id: parent, owner: 'x&y' },
    { action: 'delete', id: parent, target: 'OTHER/001' },
    { action: 'delete', id: '../OTHER' },
  ])('rejects invalid selector/authority inputs %j before reading', async (args) => {
    const s = setup();
    expect(await s.run(args)).toMatchObject({ state: 'unchanged' });
    expect(s.http.get).not.toHaveBeenCalled();
  });
});

describe('private CTS independent review regressions', () => {
  const inactiveEntry = (assignment = parent, attributes = '') =>
    `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:core="http://www.sap.com/adt/core"><ioc:entry><ioc:object ioc:user="DEV" ioc:deleted="false"><ioc:ref core:uri="/sap/bc/adt/oo/classes/z" core:name="Z" core:type="CLAS/OC"/></ioc:object><ioc:transport ioc:user="DEV" ioc:linked="true"><ioc:ref core:name="${assignment}" core:type="/RQ" ${attributes.includes('core:uri=') ? '' : `core:uri="/sap/bc/adt/cts/transportrequests/${assignment}"`} ${attributes}/></ioc:transport></ioc:entry></ioc:inactiveObjects>`;
  it.each([
    inactive.replace('/>', ' ioc:hasMore="true" ioc:totalCount="1"/>'),
    inactive.replace('/>', ' ioc:totalCount="0"/>'),
    ...['entry', 'object', 'transport'].map((tag) =>
      inactiveEntry('OTHER').replace(`<ioc:${tag}`, `<ioc:${tag} ioc:hasMore="true"`),
    ),
    inactiveEntry('OTHER').replace('core:uri=', 'ioc:next="page2" core:uri='),
    inactiveEntry('OTHER', 'ioc:totalCount="2"'),
    inactiveEntry('OTHER').replace('</ioc:transport>', '<ioc:next/></ioc:transport>'),
    inactiveEntry(`${parent} `),
    inactiveEntry(` ${parent}`),
    inactiveEntry(parent.toLowerCase()),
    inactiveEntry('OTHER', `core:uri="/sap/bc/adt/cts/transportrequests/${parent}"`),
    inactiveEntry('OTHER', `core:parentUri="/sap/bc/adt/cts/transportrequests/${parent} "`),
    inactiveEntry('OTHER', `core:parentUri="/sap/bc/adt/cts/transportrequests/${parent}/"`),
    inactiveEntry('OTHER', 'core:parentUri="/sap/bc/adt/cts/transportrequests/OTHER"'),
    inactiveEntry('OTHER', 'core:parentUri=""'),
    inactiveEntry('OTHER', `core:parentUri="https://other.example/sap/bc/adt/cts/transportrequests/${parent}"`),
  ])('refuses incomplete or malformed inactive assignment before any release %#', async (body) => {
    const s = setup();
    s.state.inactive = body;
    expect(await s.run({ action: 'release_recursive', id: parent })).toMatchObject({
      ok: false,
      state: 'unchanged',
      completed: [],
      submissions: [],
    });
    expect(s.http.post).not.toHaveBeenCalled();
    expect(s.http.put).not.toHaveBeenCalled();
    expect(s.http.delete).not.toHaveBeenCalled();
  });
  it.each([
    inactive,
    inactiveEntry(
      'OTHER',
      'core:uri="/sap/bc/adt/cts/transportrequests/OTHER" core:parentUri="/sap/bc/adt/cts/transportrequests/OTHERPARENT"',
    ),
  ])('accepts qualified complete empty or explicitly unrelated inactive evidence %#', async (body) => {
    const s = setup();
    s.state.tasks = [];
    s.state.inactive = body;
    expect(await s.run({ action: 'release', id: parent })).toMatchObject({ ok: true, state: 'confirmed' });
    expect(s.http.post).toHaveBeenCalledTimes(1);
  });
  it('refuses a canonical inactive child assignment to the selected parent', async () => {
    const s = setup();
    s.state.inactive = inactiveEntry('OTHER', `core:parentUri="/sap/bc/adt/cts/transportrequests/${parent}"`);
    expect(await s.run({ action: 'release', id: parent })).toMatchObject({ state: 'unchanged', submissions: [] });
    expect(s.http.post).not.toHaveBeenCalled();
  });
  describe.each([{ target: 'C11.021' }, { package: '$TMP' }])('created description through %o', (route) => {
    const create = () => {
      const s = setup();
      s.config.multiTargetWrite = {
        ...s.config.multiTargetWrite!,
        allowedTransports: ['*'],
        serverAllowedTransports: [],
      };
      return s;
    };
    it.each(['Requested description', 'Requested & "quoted" <route>', '0001'])(
      'confirms exactly matching native text %s',
      async (description) => {
        const s = create();
        expect(await s.run({ action: 'create', ...route, description })).toMatchObject({
          ok: true,
          state: 'confirmed',
          completed: [{ id: parent, operation: 'create' }],
        });
        expect(s.http.post).toHaveBeenCalledTimes(1);
        expect(s.http.get.mock.calls.some(([path]) => path.endsWith(`/transportrequests/${parent}`))).toBe(true);
      },
    );
    it.each([
      '',
      'tm:desc="Different description"',
      'tm:desc="Requested description "',
      'xmlns:x="urn:foreign" x:desc="Requested description"',
      `xmlns:x="${ns}" tm:desc="Requested description" x:desc="Requested description"`,
    ])('retains one submitted create as incomplete for invalid native description %s', async (attribute) => {
      const s = create();
      s.state.readHook = (_path, body) => body.replace(/tm:desc="[^"]*"/, attribute);
      expect(await s.run({ action: 'create', ...route, description: 'Requested description' })).toMatchObject({
        ok: false,
        state: 'incomplete',
        completed: [],
        submissions: [{ method: 'POST', acknowledged: true }],
      });
      expect(s.http.post).toHaveBeenCalledTimes(1);
      expect(s.http.post.mock.calls[0].at(-1)).toMatchObject({ noReplay: true });
      expect(s.http.put).not.toHaveBeenCalled();
      expect(s.http.delete).not.toHaveBeenCalled();
    });
  });
  const addChild = (body: string) =>
    body.replace('</tm:request>', `<tm:task tm:number="${third}" tm:owner="DEV" tm:status="R"/></tm:request>`);
  it.each(['transient', 'stable', 'later-read-fails'])(
    'retains %s expansion from strict terminal evidence',
    async (mode) => {
      const s = setup();
      s.state.tasks = [];
      let postSubmissionReads = 0;
      s.state.readHook = (path, body) => {
        if (!path.includes('/transportrequests/') || !s.http.post.mock.calls.length) return body;
        postSubmissionReads++;
        // First read is convergence, second is private terminal proof, third is final verification.
        if (postSubmissionReads === 3 && mode === 'later-read-fails') throw new AdtNetworkError('private diagnostic');
        return postSubmissionReads === 2 || (postSubmissionReads === 3 && mode === 'stable') ? addChild(body) : body;
      };
      const result = await s.run({ action: 'release', id: parent });
      expect(result).toMatchObject({
        ok: false,
        state: 'incomplete',
        unexpectedChildren: [third],
        completed: [{ id: parent, operation: 'release', state: 'confirmed' }],
        submissions: [{ method: 'POST', id: parent, acknowledged: true }],
      });
      expect(postSubmissionReads).toBe(3);
      expect(s.http.post).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(result)).not.toContain('private diagnostic');
    },
  );
  it.each([1, 2])('stops recursive submissions after expansion in post-write read %s', async (appearance) => {
    const s = setup();
    let reads = 0;
    s.state.readHook = (path, body) => {
      if (!path.includes('/transportrequests/') || !s.http.post.mock.calls.length) return body;
      return ++reads === appearance ? addChild(body) : body;
    };
    const result = await s.run({ action: 'release_recursive', id: parent });
    expect(result).toMatchObject({
      ok: false,
      state: 'incomplete',
      unexpectedChildren: [third],
      completed: [{ id: task, operation: 'release', state: 'confirmed' }],
      submissions: [{ method: 'POST', id: task, acknowledged: true }],
    });
    expect(s.http.post).toHaveBeenCalledTimes(1);
    expect(s.state.statuses.get(parent)).toBe('D');
  });
  it('retains observed expansion when the release engine returns unverified', async () => {
    const s = setup();
    s.state.tasks = [];
    s.state.writeHook = () => {
      throw new AdtNetworkError('response lost');
    };
    s.state.readHook = (path, body) =>
      path.includes('/transportrequests/') && s.http.post.mock.calls.length ? addChild(body) : body;
    expect(await s.run({ action: 'release', id: parent })).toMatchObject({
      ok: false,
      state: 'incomplete',
      unexpectedChildren: [third],
      release: { outcome: 'unknown', unexpectedChildren: [third] },
      completed: [],
      submissions: [{ id: parent, method: 'POST', acknowledged: false }],
    });
    expect(s.http.post).toHaveBeenCalledTimes(1);
  });
  it('stops before POST if expansion is first observed by the engine preflight', async () => {
    const s = setup();
    s.state.tasks = [];
    let reads = 0;
    s.state.readHook = (path, body) => (path.includes('/transportrequests/') && ++reads === 4 ? addChild(body) : body);
    expect(await s.run({ action: 'release', id: parent })).toMatchObject({
      ok: false,
      state: 'unchanged',
      unexpectedChildren: [third],
      submissions: [],
    });
    expect(s.http.post).not.toHaveBeenCalled();
  });
});
