import { expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { logger } from '../../../src/server/logger.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const owner = '/sap/bc/adt/oo/classes/zcl_shared_name';
const initial = 'CLASS zcl_shared_name DEFINITION PUBLIC. ENDCLASS. CLASS zcl_shared_name IMPLEMENTATION. ENDCLASS.';

it('keeps concurrent pinned recording, save, result and audit evidence on their selected targets', async () => {
  const audit = vi.spyOn(logger, 'emitAudit').mockImplementation(() => {});
  const requests: Array<{ host: string; path: string; method: string; body: string; cookie?: string }> = [];
  const sources = new Map([
    ['first', initial],
    ['second', initial],
  ]);
  const transport = (host: string) => (host === 'first' ? 'A4HK900001' : 'B4HK900001');
  let locked = 0;
  let release!: () => void;
  const bothLocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  mockFetch.mockImplementation(async (url: string, options) => {
    const parsed = new URL(url);
    const host = parsed.hostname.split('.')[0]!;
    const path = parsed.pathname + parsed.search;
    const body = String(options.body ?? '');
    requests.push({ host, path, method: options.method, body, cookie: options.headers.Cookie });
    if (path.includes('transportchecks'))
      return mockResponse(
        200,
        '<DATA><DEVCLASS>ZTEAM</DEVCLASS><DLVUNIT>HOME</DLVUNIT><OPERATION></OPERATION><RESULT>S</RESULT><RECORDING>X</RECORDING></DATA>',
      );
    if (path.includes('transportrequests'))
      return mockResponse(
        200,
        `<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="${transport(host)}" tm:type="K" tm:status="D"/></tm:root>`,
      );
    if (path.includes('_action=LOCK')) {
      if (++locked === 2) release();
      await bothLocked;
      return mockResponse(
        200,
        `<DATA><LOCK_HANDLE>lock-${host}</LOCK_HANDLE><CORRNR>${transport(host)}</CORRNR><IS_LOCAL></IS_LOCAL></DATA>`,
        {},
        [`sap-contextid=session-${host}; Path=/`],
      );
    }
    if (parsed.pathname.endsWith('/source/main')) {
      if (options.method === 'PUT') sources.set(host, body);
      return mockResponse(200, sources.get(host)!);
    }
    if (parsed.pathname === owner && options.method === 'GET')
      return mockResponse(
        200,
        '<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="ZTEAM"/></class:abapClass>',
      );
    return mockResponse(200, '', { 'x-csrf-token': `token-${host}` });
  });
  try {
    const results = await Promise.all(
      ['first', 'second'].map(async (host) => {
        const policy = {
          target: `${host}/001`,
          enabled: true,
          allowedPackages: ['ZTEAM'],
          allowedTransports: [transport(host)],
          serverAllowedTransports: [transport(host)],
        };
        const config = {
          ...DEFAULT_CONFIG,
          targetId: policy.target,
          multiTargetEndpoints: true,
          multiTargetWrite: policy,
          allowWrites: true,
          allowedPackages: ['ZTEAM'],
          ppEnabled: true,
          ppStrict: true,
          lintBeforeWrite: false,
        };
        const client = new AdtClient({
          baseUrl: `https://${host}.example.com`,
          username: host,
          password: 'test',
          safety: { ...defaultSafetyConfig(), ...config },
        });
        const result = await handleToolCall(
          client,
          config,
          'SAPWrite',
          {
            action: 'update',
            type: 'CLAS',
            name: 'ZCL_SHARED_NAME',
            source: `${initial}\n* ${host}\n`,
            expectedSourceHash: sourceHash(initial),
            transport: transport(host),
          },
          { token: 'test', clientId: host, scopes: ['read', 'write'], extra: { userName: host } },
          undefined,
          undefined,
          true,
          undefined,
          `request-${host}`,
        );
        expect(result.isError, JSON.stringify(result)).not.toBe(true);
        return JSON.parse(result.content[0]!.text!);
      }),
    );
    for (const [index, host] of ['first', 'second'].entries()) {
      expect(results[index]).toMatchObject({
        target: `${host}/001`,
        transport: transport(host),
        state: 'saved-inactive',
      });
      expect(results[index].sourceHash).toBe(sourceHash(sources.get(host)!));
      const own = requests.filter((request) => request.host === host);
      expect(own.filter((request) => request.path.includes('transportchecks'))).toHaveLength(2);
      const saves = own.filter((request) => request.method === 'PUT');
      expect(saves).toHaveLength(1);
      expect(saves[0]!.path).toContain(`corrNr=${transport(host)}`);
      expect(saves[0]!.body).toContain(`* ${host}`);
      expect(own.find((request) => request.path.includes('_action=UNLOCK'))?.cookie).toContain(`session-${host}`);
      const events = audit.mock.calls
        .map(([event]) => event)
        .filter((event) => event.event.startsWith('tool_call_') && event.requestId === `request-${host}`);
      expect(events).toHaveLength(2);
      expect(events.every((event) => event.target === `${host}/001` && event.user === host)).toBe(true);
    }
  } finally {
    audit.mockRestore();
  }
});
