import { readFileSync } from 'node:fs';
import { afterEach, expect, vi } from 'vitest';

const { pinnedMutationContext } = await import('../../../src/adt/mutation-context.js');

import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from '../handlers/setup-undici-mock.js';

export const core = 'http://www.sap.com/adt/core';
export const nativeAbsent =
  '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/><message>Missing</message></exc:exception>';
export const bindingName = 'ZBIND';
export const bindingUri = '/sap/bc/adt/businessservices/bindings/ZBIND';
export const definitionUri = '/sap/bc/adt/ddic/srvd/sources/zdefinition';
const unexpected: string[] = [];
afterEach(() => expect(unexpected).toEqual([]));
export function bindingXml(version = 'inactive', published = false) {
  return readFileSync(new URL('../../fixtures/xml/service-binding.xml', import.meta.url), 'utf8')
    .replaceAll('/DMO/UI_TRAVEL_D_D_O4', bindingName)
    .replaceAll('/DMO/UI_TRAVEL_D_D', 'ZDEFINITION')
    .replaceAll('%2fdmo%2fui_travel_d_d', 'zdefinition')
    .replaceAll('/DMO/FLIGHT_DRAFT', '$TMP')
    .replaceAll('%2fdmo%2fflight_draft', '%24tmp')
    .replace('srvb:published="true"', `srvb:published="${published}"`)
    .replace('srvb:bindingCreated="true"', `srvb:bindingCreated="${published}"`)
    .replace('adtcore:version="active"', `adtcore:version="${version}"`);
}
export function packageXml(name: string, parent = '', component = 'LOCAL') {
  return `<p:package xmlns:p="http://www.sap.com/adt/packages" xmlns:adtcore="${core}" adtcore:name="${name}" adtcore:type="DEVC/K"><adtcore:packageRef adtcore:name="${name}"/><p:superPackage adtcore:name="${parent}"/><p:attributes p:packageType="development" p:recordChanges="${component === 'LOCAL' ? 'false' : 'true'}"/><p:transport><p:softwareComponent p:name="${component}"/><p:transportLayer p:name=""/></p:transport></p:package>`;
}
export function ownerXml(type = 'SRVD', name = 'ZDEFINITION', pkg = '$TMP') {
  const shape =
    type === 'CLAS'
      ? ['abapClass', 'http://www.sap.com/adt/oo/classes', 'CLAS/OC']
      : ['srvdSource', 'http://www.sap.com/adt/ddic/srvdsources', 'SRVD/SRV'];
  return `<o:${shape[0]} xmlns:o="${shape[1]}" xmlns:adtcore="${core}" adtcore:name="${name}" adtcore:type="${shape[2]}"><adtcore:packageRef adtcore:name="${pkg}" adtcore:type="DEVC/K"/></o:${shape[0]}>`;
}
export interface Request {
  method: string;
  path: string;
  body: string;
  headers: Headers;
}
export function managedHarness(handler: (request: Request) => ReturnType<typeof mockResponse> | undefined) {
  vi.resetAllMocks();
  unexpected.length = 0;
  const calls: Request[] = [];
  mockFetch.mockImplementation(async (url: unknown, options: any = {}) => {
    const uri = new URL(String(url));
    uri.searchParams.delete('sap-client');
    uri.searchParams.delete('sap-language');
    const request = {
      method: options.method ?? 'GET',
      path: uri.pathname + uri.search,
      body: String(options.body ?? ''),
      headers: new Headers(options.headers),
    };
    calls.push(request);
    if (request.method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'token' });
    const selected = handler(request);
    if (selected) return selected;
    if (request.path === '/sap/bc/adt/core/http/sessions') return mockResponse(200, '');
    if (request.path.includes('_action=LOCK'))
      return mockResponse(200, '<DATA><LOCK_HANDLE>SECRET_HANDLE</LOCK_HANDLE><CORRNR/><IS_LOCAL>X</IS_LOCAL></DATA>', {
        'set-cookie': 'sap-contextid=SECRET_SESSION; Path=/',
      });
    if (request.path.includes('_action=UNLOCK')) return mockResponse(200, '');
    if (request.path.includes('transportchecks')) {
      const pkg = /<DEVCLASS>([^<]+)<\/DEVCLASS>/.exec(request.body)?.[1] ?? '$TMP';
      const operation = /<OPERATION>([^<]*)<\/OPERATION>/.exec(request.body)?.[1] ?? '';
      return mockResponse(
        200,
        `<DATA><DEVCLASS>${pkg}</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION>${operation}</OPERATION><RECORDING/><LOCKS/><RESULT>S</RESULT></DATA>`,
      );
    }
    unexpected.push(`${request.method} ${request.path}`);
    throw new Error(`Unexpected mock request: ${request.method} ${request.path}`);
  });
  const client = new AdtClient({
    baseUrl: 'https://sap.example.test',
    client: '001',
    safety: {
      ...defaultSafetyConfig(),
      allowWrites: true,
      allowedPackages: ['$TMP', '$NEW', '$DEST', 'ZTEAM'],
      multiTargetWrite: {
        target: 'A4H/001',
        enabled: true,
        allowedPackages: ['$TMP', '$NEW', '$DEST', 'ZTEAM'],
        allowedTransports: ['A4HK900001'],
        serverAllowedTransports: ['A4HK900001'],
      },
    },
  });
  const context = (signal?: AbortSignal) =>
    pinnedMutationContext(client.safety, { deadline: Date.now() + 30_000, signal }, { unlockFailed: false });
  return { client, calls, context };
}
