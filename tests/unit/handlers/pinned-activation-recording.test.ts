import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handlePinnedActivation } = await import('../../../src/handlers/write/pinned-activation.js');
const core = 'http://www.sap.com/adt/core';
let type = 'CLAS',
  owner = '',
  posts = 0,
  drift = false;
const unexpected: string[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  posts = 0;
  drift = false;
  unexpected.length = 0;
  mockFetch.mockImplementation(async (url, init: any = {}) => {
    const uri = new URL(String(url)),
      path = uri.pathname;
    if (init.method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'fixture' });
    if (path.endsWith('/transportchecks')) {
      const request = posts && drift ? 'A4HK900002' : 'A4HK900001';
      return mockResponse(
        200,
        `<DATA><DEVCLASS>ZTEAM</DEVCLASS><DLVUNIT>HOME</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING>X</RECORDING><LOCKS><CTS_OBJECT_LOCK><LOCK_HOLDER><REQ_HEADER><TRKORR>${request}</TRKORR></REQ_HEADER></LOCK_HOLDER></CTS_OBJECT_LOCK></LOCKS></DATA>`,
      );
    }
    if (path.includes('/transportrequests/'))
      return mockResponse(
        200,
        `<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="${path.slice(path.lastIndexOf('/') + 1)}" tm:type="K" tm:status="D"/></tm:root>`,
      );
    if (path === owner)
      return mockResponse(
        200,
        type === 'CLAS'
          ? `<c:abapClass xmlns:c="http://www.sap.com/adt/oo/classes" xmlns:adtcore="${core}" adtcore:name="ZARC1_RECORD" adtcore:type="CLAS/OC"><adtcore:packageRef adtcore:name="ZTEAM" adtcore:type="DEVC/K"/></c:abapClass>`
          : `<p:abapProgram xmlns:p="http://www.sap.com/adt/programs/programs" xmlns:adtcore="${core}" adtcore:name="ZARC1_RECORD" adtcore:type="PROG/P" p:programType="executableProgram"><adtcore:packageRef adtcore:name="ZTEAM" adtcore:type="DEVC/K"/></p:abapProgram>`,
      );
    if (path.toLowerCase() === '/sap/bc/adt/textelements/programs/zarc1_record')
      return mockResponse(
        200,
        `<text:textElement xmlns:text="http://www.sap.com/adt/textelements" xmlns:c="${core}" c:name="ZARC1_RECORD" c:type="PROG/PX" c:version="active"/>`,
      );
    if (path === '/sap/bc/adt/activation') {
      posts++;
      if (posts === 1)
        return mockResponse(
          200,
          `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:c="${core}"><ioc:entry><ioc:object ioc:deleted="false"><ioc:ref c:uri="${owner}" c:name="ZARC1_RECORD" c:type="${type === 'CLAS' ? 'CLAS/OC' : 'PROG/P'}"/></ioc:object></ioc:entry></ioc:inactiveObjects>`,
        );
      return mockResponse(
        200,
        '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="true"/></chkl:messages>',
      );
    }
    unexpected.push(path);
    return mockResponse(599, 'unexpected');
  });
});
it.each(['CLAS', 'PROG'])('preserves a stable recorded public %s activation across preaudit', async (kind) => {
  type = kind;
  owner = `/sap/bc/adt/${type === 'CLAS' ? 'oo/classes' : 'programs/programs'}/zarc1_record`;
  const result = await run();
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(JSON.parse(result.content[0].text).state).toBe('activated');
  expect(posts).toBe(2);
  expect(unexpected).toEqual([]);
});
it.each(['CLAS', 'PROG'])('refuses changing public %s to another allowed recording request', async (kind) => {
  type = kind;
  drift = true;
  owner = `/sap/bc/adt/${type === 'CLAS' ? 'oo/classes' : 'programs/programs'}/zarc1_record`;
  const result = await run();
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('recording context changed');
  expect(posts).toBe(1);
  expect(unexpected).toEqual([]);
});
async function run() {
  const base = new AdtClient({
    baseUrl: 'https://sap.example',
    client: '001',
    safety: {
      ...defaultSafetyConfig(),
      allowWrites: true,
      allowedPackages: ['ZTEAM'],
      multiTargetWrite: {
        target: 'A4H/001',
        enabled: true,
        allowedPackages: ['ZTEAM'],
        allowedTransports: ['A4HK900001', 'A4HK900002'],
        serverAllowedTransports: ['A4HK900001', 'A4HK900002'],
      },
    },
  });
  return handlePinnedActivation(base, { type, name: 'ZARC1_RECORD' });
}
