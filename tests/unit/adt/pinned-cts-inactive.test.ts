import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError } from '../../../src/adt/errors.js';
import type { AdtHttpClient, AdtRequestOptions } from '../../../src/adt/http.js';
import { assertCtsNoInactive } from '../../../src/adt/pinned-cts-evidence.js';
import { handlePrivatePinnedCts } from '../../../src/handlers/pinned-cts.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';

const ns = 'http://www.sap.com/abapxml/inactiveCtsObjects';
const core = 'http://www.sap.com/adt/core';
const parent = 'DEVK900001',
  task = 'DEVK900002';
const fixture = readFileSync(
  new URL('../../fixtures/xml/inactive-cts-native-shapes-a4h-758.xml', import.meta.url),
  'utf8',
);
const root = (body: string) => `<i:inactiveObjects xmlns:i="${ns}" xmlns:c="${core}">${body}</i:inactiveObjects>`;
const object =
  '<i:object i:user="DEV" i:deleted="false"><i:ref c:uri="/sap/bc/adt/oo/classes/zowned" c:name="ZOWNED" c:type="CLAS/OC"/></i:object>';
const transport = (id = 'OTHER', parentId?: string) =>
  `<i:transport i:user="DEV" i:linked="true"><i:ref c:uri="/sap/bc/adt/cts/transportrequests/${id}" c:name="${id}" c:type="/RQ" ${parentId ? `c:parentUri="/sap/bc/adt/cts/transportrequests/${parentId}"` : ''}/></i:transport>`;
const row = (o = object, t = transport()) => `<i:entry>${o}${t}</i:entry>`;
const http = (body: string, statusCode = 200, headers = {}) =>
  ({ get: vi.fn(async () => ({ body, statusCode, headers })) }) as unknown as AdtHttpClient;

describe('qualified native rich CTS inventory', () => {
  it('classifies all four sanitized observed forms, with namespace aliases and inert object ancestry', async () => {
    await expect(assertCtsNoInactive(http(fixture), [parent, task])).resolves.toBeUndefined();
    await expect(
      assertCtsNoInactive(http(fixture.replaceAll('ioc:', 'native:').replace('xmlns:ioc=', 'xmlns:native=')), [
        parent,
        task,
      ]),
    ).resolves.toBeUndefined();
    const inert = root(
      row(object.replace('/>', ` c:parentUri="/sap/bc/adt/cts/transportrequests/${parent}"/>`), transport()),
    );
    await expect(assertCtsNoInactive(http(inert), [parent, task])).resolves.toBeUndefined();
  });
  it('keeps linked=false assigned objects assigned, never equivalent to an empty transport', async () => {
    await expect(
      assertCtsNoInactive(http(root(row(object, transport().replace('i:linked="true"', 'i:linked="false"')))), [
        parent,
      ]),
    ).resolves.toBeUndefined();
    for (const id of [parent, task])
      await expect(
        assertCtsNoInactive(http(root(row(object, transport(id).replace('i:linked="true"', 'i:linked="false"')))), [
          parent,
          task,
        ]),
      ).rejects.toThrow('contains inactive objects');
  });
  it('accepts an exact selected-request heading, not a selected inactive object', async () => {
    const body = root(row('<i:object/>', transport(parent).replace('i:linked="true"', 'i:linked="false"')));
    await expect(assertCtsNoInactive(http(body), [parent, task])).resolves.toBeUndefined();
  });
  it.each([transport(parent), transport(task), transport('OTHER', parent), transport('OTHER', task)])(
    'refuses selected assignment, including deleted objects: %s',
    async (assignment) => {
      for (const value of ['false', 'true']) {
        await expect(
          assertCtsNoInactive(http(root(row(object.replace('deleted="false"', `deleted="${value}"`), assignment))), [
            parent,
            task,
          ]),
        ).rejects.toThrow('contains inactive objects');
      }
    },
  );
  it.each([201, 202, 204, 206, 304, 400, 500])(
    'refuses noncomplete status %i even with a rich empty body',
    async (status) => {
      await expect(assertCtsNoInactive(http(root(''), status), [parent])).rejects.toThrow('complete successful');
    },
  );
  it('refuses a partial content header even with HTTP200', async () => {
    await expect(
      assertCtsNoInactive(http(root(''), 200, { 'Content-Range': 'items 0-0/2' }), [parent]),
    ).rejects.toThrow('complete successful');
  });
  it.each([
    row('', '<i:transport/>'),
    row('<i:object/>', ''),
    row('<i:object><i:ref/></i:object>', '<i:transport/>'),
    row('<i:object i:user="DEV"/>', '<i:transport/>'),
    row('<i:object/>', '<i:transport i:user="DEV"/>'),
    row(object, '<i:transport><i:ref/></i:transport>'),
    row(object, transport().replace('i:linked="true"', 'i:linked="unknown"')),
    row('<i:object/>', transport()),
    row('<i:object/>', transport().replace('i:linked="true"', 'i:linked="unknown"')),
    row(object.replace('i:deleted="false"', 'i:deleted="unknown"')),
    row(object.replace('i:user="DEV"', '')),
    row(object.replace('c:name="ZOWNED"', '')),
    row(object.replace('c:type="CLAS/OC"', '')),
    row(object.replace('c:uri=', 'unknown:uri=').replace('<i:ref ', '<i:ref xmlns:unknown="urn:foreign" ')),
    row(object.replace('/>', '><i:ref c:uri="/sap/bc/adt/hidden"/></i:ref>')),
    row(object, transport().replace('c:name="OTHER"', 'c:name=" other "')),
    row(object, transport().replace('c:type="/RQ"', 'c:type="CLAS/OC"')),
    row(object, transport().replace('c:uri="/sap/bc/adt/cts/transportrequests/OTHER"', '')),
    row(object, transport().replace('transportrequests/OTHER', 'transportrequests/DIFFERENT')),
    row(object, transport('OTHER', 'OTHER')),
    row(object, transport('OTHER', '../BROKEN')),
    row(
      object,
      transport('OTHER', parent)
        .replace('c:parentUri=', 'x:parentUri=')
        .replace('<i:ref ', '<i:ref xmlns:x="urn:foreign" '),
    ),
    row(object, transport()).replace('<i:entry>', '<i:entry i:totalCount="1">'),
    row(object, transport()).replace('<i:object ', '<i:object i:hasMore="false" '),
    row(object, transport()).replace('<i:transport ', '<i:transport i:page="0" '),
    row(object, transport()).replace('</i:transport>', '<i:next/></i:transport>'),
    row(object, transport()).replace('<i:ref ', '<i:ref c:next="page2" '),
    row('<i:object>meaningful</i:object>', '<i:transport/>'),
    row(object, '<i:transport>meaningful</i:transport>'),
    row(object, transport()).replace('</i:entry>', '<i:transport/></i:entry>'),
  ])('refuses malformed or incomplete row %# before accepting any empty/unrelated form', async (body) => {
    await expect(assertCtsNoInactive(http(root(body)), [parent, task])).rejects.toThrow();
  });
  it.each([
    root('').replace('/inactiveCtsObjects', '/wrong'),
    `<i:inactiveObjects xmlns:i="${ns}" xmlns:c="${core}" i:totalCount="0"></i:inactiveObjects>`,
    root(row('<i:object/>', '<i:transport/>').repeat(1001)),
    root('<i:unknown/>'),
    '<html/>',
    '',
  ])('refuses incomplete root or bounds %#', async (body) => {
    await expect(assertCtsNoInactive(http(body), [parent, task])).rejects.toThrow();
  });
});

describe('real private release boundary with an intercepted POST', () => {
  it.each([false, true])('preserves exact nonempty deleted-class membership; selected inactive=%s', async (blocked) => {
    const config: ServerConfig = {
      ...DEFAULT_CONFIG,
      multiTargetEndpoints: true,
      ppEnabled: true,
      ppStrict: true,
      allowWrites: true,
      allowTransportWrites: true,
      targetId: 'A4H/001',
      allowedPackages: ['ZRECORDED'],
      multiTargetWrite: {
        enabled: true,
        target: 'A4H/001',
        allowedPackages: ['ZRECORDED'],
        allowedTransports: [parent],
        serverAllowedTransports: [parent],
      },
    };
    const tree = `<t:root xmlns:t="http://www.sap.com/cts/adt/tm"><t:request t:number="${parent}" t:owner="DEV" t:type="K" t:status="D" t:target=""><t:task t:number="${task}" t:owner="DEV" t:type="Development/Correction" t:status="D" t:target=""><t:abap_object t:pgmid="R3TR" t:type="CLAS" t:name="ZOWNED" t:position="000001" t:lock_status="X"/></t:task></t:request></t:root>`;
    const calls: string[] = [];
    const transportHttp = {
      hasDiscoveryData: () => true,
      discoveryAcceptFor: () => 'application/vnd.sap.adt.transportorganizer.v1+xml',
      get: vi.fn(async (path: string) => {
        calls.push(path);
        if (path === '/sap/bc/adt/activation/inactiveobjects')
          return { statusCode: 200, headers: {}, body: blocked ? root(row(object, transport(task))) : fixture };
        if (
          path === `/sap/bc/adt/cts/transportrequests/${parent}` ||
          path === `/sap/bc/adt/cts/transportrequests/${task}`
        )
          return { statusCode: 200, headers: {}, body: tree };
        throw new Error('Unexpected object/package lookup');
      }),
      post: vi.fn(
        async (path: string, _body: unknown, _type: unknown, _headers: unknown, options: AdtRequestOptions) => {
          expect(path).toBe(`/sap/bc/adt/cts/transportrequests/${task}/newreleasejobs`);
          expect(options.noReplay).toBe(true);
          throw new AdtApiError('Offline release intercepted', 400, path, '');
        },
      ),
    };
    const result = await handlePrivatePinnedCts(
      Object.assign(Object.create(AdtClient.prototype) as AdtClient, { http: transportHttp, safety: config }),
      config,
      { action: 'release', id: task, timeoutSeconds: 1 },
      ['read', 'write', 'transports'],
    );
    const value = JSON.parse((result.content[0] as { text: string }).text);
    expect(transportHttp.post).toHaveBeenCalledTimes(blocked ? 0 : 1);
    expect(value).toMatchObject({ ok: false, phase: blocked ? 'inactive-precheck' : 'release' });
    expect(calls.every((path) => path.includes('/transportrequests/') || path.endsWith('/inactiveobjects'))).toBe(true);
  });
});
