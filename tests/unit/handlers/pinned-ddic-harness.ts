/**
 * Stateful fake ADT backend for the private DDIC/server-driven profiles. It models the native wire
 * contracts recorded in tests/fixtures and docs/research; it is offline replay, never live evidence.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

export const core = 'http://www.sap.com/adt/core';
const notFound = `<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/><message>Resource does not exist.</message></exc:exception>`;

export function fixture(path: string): string {
  return readFileSync(resolve(__dirname, '../../fixtures', path), 'utf8');
}

export const config = {
  ...DEFAULT_CONFIG,
  client: '001',
  targetId: 'A4H/001',
  multiTargetEndpoints: true,
  ppEnabled: true,
  ppStrict: true,
  allowWrites: true,
  systemType: 'onprem' as const,
  lintBeforeWrite: false,
  checkBeforeWrite: false,
  allowedPackages: ['$TMP', 'ZTEAM'],
  multiTargetWrite: {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP', 'ZTEAM'],
    allowedTransports: ['A4HK900001'],
    serverAllowedTransports: ['A4HK900001'],
  },
};

export function blueSource(name: string, nativeType: string, pkg: string, version = 'inactive', extra = ''): string {
  return `<?xml version="1.0" encoding="utf-8"?><blue:blueSource adtcore:responsible="DEV" adtcore:masterLanguage="EN" adtcore:masterSystem="A4H" adtcore:name="${name}" adtcore:type="${nativeType}" adtcore:version="${version}" adtcore:description="d" xmlns:blue="http://www.sap.com/wbobj/blue" xmlns:adtcore="${core}">${extra}<adtcore:packageRef adtcore:uri="/sap/bc/adt/packages/x" adtcore:type="DEVC/K" adtcore:name="${pkg}"/></blue:blueSource>`;
}

export interface FakeObject {
  metadata: string;
  source?: string;
  nativeType: string;
  /** Native source served for active reads after activation. */
  activeSource?: string;
}

export interface World {
  objects: Map<string, FakeObject>;
  calls: { path: string; method: string; locked: boolean; body: string; accept?: string; contentType?: string }[];
  unexpected: string[];
  faults: Set<string>;
  locked: string | undefined;
  transported: boolean;
  search: { type: string; name: string }[];
  /** Extra references SAP's preaudit reports alongside the selected owner. */
  preauditRefs: { uri: string; name?: string; type?: string }[];
  activationMessages: string;
  /** adtcore:version SAP reports after a metadata save; new settings stay "new" until parent activation. */
  savedVersion: string;
  /** Native normalization applied to a saved source. */
  sourceOnSave?: (body: string) => string;
  abort?: AbortController;
  createdMetadata?: (body: string) => string;
}

const key = (path: string) => decodeURIComponent(path).toLowerCase();

/** SAP echoes bodies with native identity: a stored document always carries type, version and package type. */
function storedDocument(body: string, nativeType: string, version: string): string {
  const xml = body.replace(/(<adtcore:packageRef\b)(?![^>]*adtcore:type=)/, '$1 adtcore:type="DEVC/K"');
  const start = xml.indexOf('<', xml.startsWith('<?xml') ? xml.indexOf('?>') : 0);
  const end = xml.indexOf('>', start);
  const open = xml.slice(start, end).replace(/\s+adtcore:(?:type|version)="[^"]*"/g, '');
  return `${xml.slice(0, start)}${open} adtcore:type="${nativeType}" adtcore:version="${version}"${xml.slice(end)}`;
}

export function createWorld(): World {
  return {
    objects: new Map(),
    calls: [],
    unexpected: [],
    faults: new Set(),
    locked: undefined,
    transported: false,
    search: [],
    preauditRefs: [],
    activationMessages:
      '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="true"/></chkl:messages>',
    savedVersion: 'inactive',
  };
}

export function install(world: World): void {
  mockFetch.mockImplementation(async (url, init: any = {}) => {
    const uri = new URL(String(url));
    const path = uri.pathname;
    const method = init.method ?? 'GET';
    const body = String(init.body ?? '');
    const headers = init.headers ?? {};
    world.calls.push({
      path: path + uri.search,
      method,
      locked: world.locked !== undefined,
      body,
      accept: headers.Accept,
      contentType: headers['Content-Type'],
    });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'token' });
    if (path.includes('/http/sessions')) return mockResponse(200, '');
    if (uri.searchParams.get('_action') === 'LOCK') {
      if (world.faults.has('lock-denied')) return mockResponse(403, 'denied');
      world.locked = path;
      if (world.faults.has('cancel')) world.abort?.abort();
      const corr = world.transported ? 'A4HK900002' : '';
      return mockResponse(
        200,
        `<DATA><LOCK_HANDLE>native-lock</LOCK_HANDLE><CORRNR>${corr}</CORRNR><IS_LOCAL>${world.transported ? '' : 'X'}</IS_LOCAL></DATA>`,
        { 'set-cookie': 'sap-contextid=owned; Path=/' },
      );
    }
    if (uri.searchParams.get('_action') === 'UNLOCK') {
      world.locked = undefined;
      return mockResponse(world.faults.has('unlock') ? 503 : 200, '');
    }
    if (path.includes('/transportchecks')) {
      const pkg = /<DEVCLASS>([^<]*)</.exec(body)?.[1] ?? '';
      return mockResponse(
        200,
        `<DATA><DEVCLASS>${pkg}</DEVCLASS><DLVUNIT>${world.transported ? 'HOME' : 'LOCAL'}</DLVUNIT><OPERATION>${body.includes('<OPERATION>I</OPERATION>') ? 'I' : ''}</OPERATION><RESULT>S</RESULT><RECORDING>${world.transported ? 'X' : ''}</RECORDING></DATA>`,
      );
    }
    if (path.includes('/transportrequests/'))
      return mockResponse(
        200,
        `<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="${world.faults.has('cts') ? 'A4HK900099' : 'A4HK900001'}" tm:type="K" tm:status="D"><tm:task tm:number="A4HK900002" tm:status="D"/></tm:request></tm:root>`,
      );
    if (path === '/sap/bc/adt/repository/informationsystem/search') {
      if (world.faults.has('search')) return mockResponse(500, 'search unavailable');
      return mockResponse(
        200,
        `<adtcore:objectReferences xmlns:adtcore="${core}">${world.search.map((hit) => `<adtcore:objectReference adtcore:type="${hit.type}" adtcore:name="${hit.name}" adtcore:uri="/x/${hit.name.toLowerCase()}" adtcore:packageName="$TMP"/>`).join('')}</adtcore:objectReferences>`,
      );
    }
    if (path === '/sap/bc/adt/deletion/check') {
      const target = /adtcore:uri="([^"]*)"/.exec(body)?.[1] ?? '';
      return mockResponse(
        200,
        `<del:checkResponse xmlns:del="http://www.sap.com/adt/deletion" xmlns:adtcore="${core}"><del:object adtcore:uri="${target}" del:isDeletable="${world.faults.has('undeletable') ? 'false' : 'true'}"/></del:checkResponse>`,
      );
    }
    if (path === '/sap/bc/adt/checkruns') return mockResponse(404, notFound);
    if (path === '/sap/bc/adt/activation') {
      if (uri.searchParams.get('preauditRequested') === 'true') {
        const refs = [...body.matchAll(/adtcore:uri="([^"]*)"(?:\s+adtcore:name="([^"]*)")?/g)].map((match) => ({
          uri: match[1]!,
          name: match[2],
        }));
        const all = [...refs, ...world.preauditRefs];
        // A concurrent draft edit landing between preaudit and the confirmation evidence.
        if (world.faults.has('draft-drift'))
          for (const object of world.objects.values()) {
            object.metadata = object.metadata.replace('<doma:datatype>CHAR<', '<doma:datatype>NUMC<');
            object.source &&= `${object.source}\n// concurrent edit`;
          }
        return mockResponse(
          200,
          `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="${core}">${all.map((ref) => `<ioc:entry><ioc:object ioc:deleted="false"><ioc:ref adtcore:uri="${ref.uri}"${ref.name ? ` adtcore:name="${ref.name}"` : ''}/></ioc:object></ioc:entry>`).join('')}</ioc:inactiveObjects>`,
        );
      }
      for (const object of world.objects.values()) {
        object.activeSource = object.source;
        if (!world.faults.has('still-inactive'))
          object.metadata = object.metadata.replace(/adtcore:version="[^"]*"/, 'adtcore:version="active"');
      }
      return mockResponse(200, world.activationMessages);
    }
    // Collection create.
    for (const [objectPath, object] of world.objects) {
      if (!object.metadata && key(objectPath).startsWith(`${key(path)}/`) && method === 'POST') {
        if (world.faults.has('create-unknown')) return mockResponse(503, 'unavailable');
        if (world.faults.has('create-rejected')) return mockResponse(409, 'exists');
        object.metadata =
          world.createdMetadata?.(body) ??
          storedDocument(body, object.nativeType, 'inactive').replace(
            /adtcore:masterSystem="H00"/,
            'adtcore:masterSystem="A4H"',
          );
        if (object.source === undefined) object.source = '';
        return mockResponse(201, object.metadata);
      }
    }
    const sourceMatch = /^(.*)\/source\/main$/.exec(path);
    const objectKey = key(sourceMatch ? sourceMatch[1]! : path);
    const object = [...world.objects.entries()].find(([candidate]) => key(candidate) === objectKey)?.[1];
    if (!object?.metadata) {
      if (object || method === 'GET') return mockResponse(404, notFound);
      world.unexpected.push(`${method} ${path}`);
      return mockResponse(599, 'Unexpected test request');
    }
    if (method === 'DELETE') {
      if (world.faults.has('delete-unknown')) return mockResponse(503, 'unavailable');
      if (world.faults.has('delete-rejected')) return mockResponse(409, 'still used');
      object.metadata = '';
      return mockResponse(200, '');
    }
    if (sourceMatch) {
      if (method === 'PUT') {
        if (world.faults.has('save-unknown')) return mockResponse(503, 'unavailable');
        if (world.faults.has('save-rejected')) return mockResponse(400, 'invalid');
        object.source = world.sourceOnSave?.(body) ?? (world.faults.has('readback') ? `${body}\n"changed"` : body);
        return mockResponse(200, '');
      }
      if (uri.searchParams.get('version') === 'active' && object.activeSource !== undefined)
        return mockResponse(200, object.activeSource, { 'content-type': 'text/plain' });
      return mockResponse(200, object.source ?? '', { 'content-type': 'text/plain' });
    }
    if (method === 'PUT') {
      if (world.faults.has('save-unknown')) return mockResponse(503, 'unavailable');
      if (world.faults.has('save-rejected')) return mockResponse(409, 'conflict');
      if (world.faults.has('readback')) return mockResponse(200, '');
      object.metadata = storedDocument(body, object.nativeType, world.savedVersion);
      return mockResponse(200, '');
    }
    if (method === 'GET') {
      if (world.faults.has('budget')) return mockResponse(200, `<x>${'y'.repeat(1024 * 1024 + 1)}</x>`);
      if (world.locked && world.faults.has('package-drift'))
        return mockResponse(200, object.metadata.replace(/(packageRef[^>]*adtcore:name=")[^"]*/, '$1ZDENIED'));
      if (world.locked && world.faults.has('identity-drift'))
        return mockResponse(200, object.metadata.replace(/adtcore:type="[^"]*"/, 'adtcore:type="ZZZZ/ZZ"'));
      return mockResponse(200, object.metadata);
    }
    world.unexpected.push(`${method} ${path}`);
    return mockResponse(599, 'Unexpected test request');
  });
}

export function nativeClient(discovery?: Map<string, string[]>, overrides: Partial<typeof config> = {}) {
  const client = new AdtClient({
    baseUrl: 'https://sap.example',
    client: '001',
    safety: { ...defaultSafetyConfig(), ...config, ...overrides },
  });
  if (discovery) client.http.setDiscoveryMap(discovery);
  return client;
}

export function context(client: ReturnType<typeof nativeClient>, abort?: AbortController) {
  return pinnedMutationContext(
    client.safety,
    { deadline: Date.now() + 30_000, signal: abort?.signal },
    { unlockFailed: false },
  );
}

export const puts = (world: World) => world.calls.filter((call) => call.method === 'PUT');
export const posts = (world: World, path: string) =>
  world.calls.filter((call) => call.method === 'POST' && call.path.split('?')[0] === path);
export type { ServerConfig };
