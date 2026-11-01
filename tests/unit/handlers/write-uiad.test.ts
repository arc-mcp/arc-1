import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import type { CachingLayer } from '../../../src/cache/caching-layer.js';
import { logger } from '../../../src/server/logger.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleSAPWrite } = await import('../../../src/handlers/write.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const schema = readFileSync(new URL('../../fixtures/uiad/uiad-v2.json', import.meta.url), 'utf8');
const prefix = '/sap/bc/adt/fiori/uiad';
const name = 'ZARC1_UIAD_TEST';
const uri = `${prefix}/${name}`;
const candidate = () => ({
  formatVersion: '2',
  header: { description: 'UIAD test', originalLanguage: 'en', abapLanguageVersion: 'cloudDevelopment' },
  generalInformation: { appType: 'url', catalogId: 'SAP_TC_ALV5_DEFAULT' },
  navigation: {
    targetMappingId: `${name}_TM`,
    semanticObject: 'ZArc1Test',
    action: 'display',
    targetUrl: 'https://example.com',
  },
  tiles: [],
});
const source = () => JSON.stringify(candidate());
const config = { ...DEFAULT_CONFIG, allowWrites: true, allowedPackages: ['$TMP'], lintBeforeWrite: false };
const semantic = (message = '', status = 'processed', target = uri) =>
  `<chkrun:checkRunReports xmlns:chkrun="http://www.sap.com/adt/checkrun"><chkrun:checkReport chkrun:reporter="abapCheckRun" chkrun:triggeringUri="${target}" chkrun:status="${status}">${message}</chkrun:checkReport></chkrun:checkRunReports>`;
const catalogError =
  '<chkrun:checkMessage chkrun:type="E" chkrun:shortText="Technical Catalog ID is initial." chkrun:code="SUI_UIAD_CHECK(101)" chkrun:uri="/source/main#start=1,159"><chkrun:t100Key chkrun:msgid="SUI_UIAD_CHECK" chkrun:msgno="101"/></chkrun:checkMessage>';
type Wire = { method: string; path: string; body: string };
let calls: Wire[];
let checkBody: string;
let configuration: unknown;
let schemaBody: string;
let statuses: Record<string, number>;
let realPackage: string;

function client(writes = true) {
  return new AdtClient({
    baseUrl: 'https://sap.test',
    username: 'USER',
    password: 'test',
    safety: { ...defaultSafetyConfig(), allowWrites: writes },
  });
}
async function write(
  action = 'create',
  args: Record<string, unknown> = {},
  minimalErrors = false,
  cache?: CachingLayer,
) {
  const result = await handleSAPWrite(
    client(),
    { action, type: 'UIAD', name, package: '$TMP', source: source(), ...args },
    { ...config, minimalErrors },
    cache,
    { isPerUserClient: true, userKey: 'issuer:userName:ALICE' },
  );
  return { result, data: JSON.parse(result.content[0].text) };
}
const mutations = () => calls.filter((c) => c.method !== 'GET' && !c.path.includes('/checkruns'));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  resetCachedFeatures();
  calls = [];
  checkBody = semantic();
  configuration = {};
  schemaBody = schema;
  statuses = {};
  realPackage = '$TMP';
  mockFetch.mockImplementation(async (input: string, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const path = url.pathname + url.search;
    const method = init.method ?? 'GET';
    calls.push({ method, path, body: String(init.body ?? '') });
    let body = '';
    let phase = '';
    if (url.pathname.endsWith('/discovery'))
      body = `<app:service xmlns:app="http://www.w3.org/2007/app"><app:workspace><app:collection href="${prefix}"><app:accept>application/vnd.sap.adt.blues.v2+xml</app:accept></app:collection></app:workspace></app:service>`;
    else if (url.pathname.endsWith('/$schema') || url.pathname.endsWith('/schema')) {
      body = schemaBody;
      phase = 'schema';
    } else if (url.pathname.endsWith('/configuration')) {
      body = JSON.stringify(configuration);
      phase = 'configuration';
    } else if (url.pathname.endsWith('/checkruns')) {
      body = checkBody;
      phase = 'check';
    } else if (url.searchParams.get('_action') === 'LOCK') {
      body = '<asx:abap><LOCK_HANDLE>SECRET_LOCK</LOCK_HANDLE><CORRNR></CORRNR></asx:abap>';
      phase = 'lock';
    } else if (url.searchParams.get('_action') === 'UNLOCK') phase = 'unlock';
    else if (method === 'PUT') phase = 'put';
    else if (method === 'POST' && url.pathname === prefix) phase = 'create';
    else if (method === 'GET')
      body = `<blue:blueSource xmlns:blue="http://www.sap.com/wbobj/blue" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${name}"><adtcore:packageRef adtcore:name="${realPackage}"/></blue:blueSource>`;
    const status = statuses[phase] ?? 200;
    if (status >= 400)
      body = `<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><message>${phase} original failure</message></exc:exception>`;
    return mockResponse(status, body, { 'x-csrf-token': 'TOKEN' });
  });
});

describe('UIAD write orchestration', () => {
  it.each(['pattern', 'patternProperties', 'format'])(
    'does not execute backend %s constraints or claim a schema pass',
    async (keyword) => {
      const debug = vi.spyOn(logger, 'debug');
      schemaBody = JSON.stringify({
        type: 'object',
        properties: {
          formatVersion: { const: '2' },
          header: { [keyword]: keyword === 'patternProperties' ? { '(a+)+$': { type: 'string' } } : '(a+)+$' },
        },
      });
      const { data } = await write();
      expect(data.validation.schema).toBe('unavailable');
      expect(data.validation.semantic).toBe('passed');
      expect(data.validation.issues[0]).toContain('pattern/format');
      expect(debug.mock.calls.filter(([message]) => message === 'UIAD schema validation unavailable')).toEqual([
        ['UIAD schema validation unavailable', { reason: 'pattern_or_format', operation: 'create' }],
      ]);
    },
  );
  it('does not report a regex fallback for the supported target schema', async () => {
    const debug = vi.spyOn(logger, 'debug');
    const { data } = await write();
    expect(data.validation.schema).toBe('passed');
    expect(debug.mock.calls.filter(([message]) => message === 'UIAD schema validation unavailable')).toEqual([]);
  });

  it('bounds diagnostics while retaining errors that occur after many warnings', async () => {
    checkBody = semantic(catalogError.replace('type="E"', 'type="W"').repeat(30) + catalogError);
    const { result, data } = await write();
    expect(result.isError).toBe(true);
    expect(data.validation.messageCount).toBe(31);
    expect(data.validation.messages).toHaveLength(20);
    expect(data.validation.messages[0].severity).toBe('error');
    expect(mutations()).toHaveLength(0);
  });
  it('lets SAP validate an older AFF format instead of applying the current version schema to it', async () => {
    const value = candidate();
    value.formatVersion = '1';
    const { result, data } = await write('create', { source: JSON.stringify(value) });
    expect(result.isError).toBeUndefined();
    expect(data.validation.schema).toBe('unavailable');
    expect(data.validation.semantic).toBe('passed');
    expect(JSON.parse(calls.find((c) => c.method === 'PUT')!.body).formatVersion).toBe('1');
  });
  it('still blocks SAP errors in a version for which no matching schema is available', async () => {
    const value = candidate();
    value.formatVersion = '1';
    checkBody = semantic(catalogError);
    const { result } = await write('create', { source: JSON.stringify(value) });
    expect(result.isError).toBe(true);
    expect(mutations()).toHaveLength(0);
  });
  it('treats a malformed readonly flag as unavailable, not an editable assertion', async () => {
    configuration = { 'sap.adt.readonly': 'true' };
    const { data } = await write('update');
    expect(data.validation.configuration).toBe('unavailable');
  });
  it('validates before mutation, preserves bytes and explicit creation language version', async () => {
    const exact = JSON.stringify(candidate(), null, 2);
    const { result, data } = await write('create', { source: exact });
    expect(result.isError).toBeUndefined();
    expect(data).toMatchObject({
      status: 'created',
      metadata: 'created',
      source: 'saved',
      validation: { schema: 'passed', semantic: 'passed' },
    });
    expect(calls.find((c) => c.path.split('?')[0] === prefix && c.method === 'POST')?.body).toContain(
      'adtcore:abapLanguageVersion="cloudDevelopment"',
    );
    expect(calls.find((c) => c.method === 'PUT')?.body).toBe(exact);
    expect(calls.findIndex((c) => c.path.includes('/checkruns'))).toBeLessThan(
      calls.findIndex((c) => c.path.split('?')[0] === prefix),
    );
    expect(JSON.stringify(data)).not.toContain('SAPActivate');
    expect(calls.some((c) => /\$new|\/validation|sideeffect|openwithflpam/.test(c.path))).toBe(false);
  });
  it('blocks full-schema errors before check, metadata, or lock', async () => {
    const value = candidate();
    value.navigation.action = 'x'.repeat(61);
    const { result, data } = await write('create', { source: JSON.stringify(value) });
    expect(result.isError).toBe(true);
    expect(data.validation.schema).toBe('failed');
    expect(data.validation.issues[0]).toContain('/navigation/action');
    expect(mutations()).toHaveLength(0);
    expect(calls.some((c) => c.path.includes('/checkruns'))).toBe(false);
  });
  it('blocks schema-valid SAP semantic errors and exposes the code/position', async () => {
    const value = candidate();
    value.generalInformation.catalogId = '';
    checkBody = semantic(catalogError);
    const { result, data } = await write('create', { source: JSON.stringify(value) });
    expect(result.isError).toBe(true);
    expect(data.validation).toMatchObject({
      schema: 'passed',
      semantic: 'failed',
      messages: [{ code: 'SUI_UIAD_CHECK(101)', t100: { id: 'SUI_UIAD_CHECK', number: '101' }, column: 159 }],
    });
    expect(mutations()).toHaveLength(0);
  });
  it('rejects an explicit readonly root without running the check or mutation', async () => {
    configuration = { 'sap.adt.readonly': true };
    const { result, data } = await write('update');
    expect(result.isError).toBe(true);
    expect(data.validation.configuration).toBe('readonly');
    expect(mutations()).toHaveLength(0);
  });
  it('permits nested readonly fields and does not write metadata language version on update', async () => {
    configuration = { properties: { header: { 'sap.adt.readonly': true } } };
    const { result } = await write('update');
    expect(result.isError).toBeUndefined();
    expect(calls.some((c) => c.path.split('?')[0] === prefix && c.method === 'POST')).toBe(false);
    expect(calls.some((c) => c.path.split('?')[0] === `${uri}/schema`)).toBe(true);
  });
  it.each(['schema', 'check', 'configuration'])(
    'reports unavailable %s explicitly without pretending it passed',
    async (phase) => {
      statuses[phase] = 404;
      const { result, data } = await write('update');
      expect(result.isError).toBeUndefined();
      expect(data.validation[phase === 'check' ? 'semantic' : phase]).toBe('unavailable');
    },
  );
  it('keeps an unprocessed check visible and warnings non-blocking', async () => {
    checkBody = semantic(catalogError.replace('type="E"', 'type="W"'), 'notProcessed');
    const { result, data } = await write();
    expect(result.isError).toBeUndefined();
    expect(data.validation).toMatchObject({
      semantic: 'unavailable',
      messages: [{ severity: 'warning' }],
    });
  });
  it.each([401, 403, 500])('propagates HTTP %i during preflight before mutation', async (status) => {
    statuses.schema = status;
    await expect(write()).rejects.toMatchObject({ statusCode: status });
    expect(mutations()).toHaveLength(0);
  });
  it('gates updates on the actual package, ignoring a claimed allowed package', async () => {
    realPackage = 'SAP_STANDARD';
    await expect(write('update')).rejects.toThrow(/package/i);
    expect(mutations()).toHaveLength(0);
  });
  it('gates writes before preflight and rejects denied actions in dispatch', async () => {
    await expect(
      handleSAPWrite(client(false), { action: 'create', type: 'UIAD', name, source: source() }, config, undefined, {
        isPerUserClient: false,
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
    const result = await handleToolCall(client(), { ...config, denyActions: ['SAPWrite.create'] }, 'SAPWrite', {
      action: 'create',
      type: 'UIAD',
      name,
      source: source(),
    });
    expect(result.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
  it.each(['create', 'put', 'unlock'])(
    'reports partial state and invalidates the current user cache after %s failure',
    async (phase) => {
      statuses[phase] = 400;
      const cache = { invalidate: vi.fn(), inactiveLists: { invalidate: vi.fn() } } as unknown as CachingLayer;
      const { result, data } = await write('create', {}, false, cache);
      expect(result.isError).toBe(true);
      expect(data.metadata).toBe(phase === 'create' ? 'unknown' : 'created');
      expect(data.message).toContain(
        phase === 'create' ? 'creation outcome is unknown' : phase === 'put' ? 'creation was confirmed' : 'source save',
      );
      if (phase === 'create') expect(data.message).not.toMatch(/retained|repairing|deleting/);
      expect(data.source).toBe(phase === 'create' ? 'notAttempted' : phase === 'put' ? 'unknown' : 'saved');
      expect(data.failure).toContain(`${phase} original failure`);
      expect(cache.inactiveLists.invalidate).toHaveBeenCalledWith('issuer:userName:ALICE');
      expect(cache.invalidate).toHaveBeenCalledWith('UIAD', name, 'all');
      expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(phase === 'create' ? 0 : 1);
    },
  );
  it('keeps the original save failure and avoids repeating validation when unlock fails', async () => {
    statuses.put = 400;
    statuses.unlock = 400;
    const { data } = await write();
    expect(data.failure).toContain('put original failure');
    expect(data.unlockFailed).toBe(true);
    expect(data.message).toContain('SAP lock may remain');
    expect(calls.filter((call) => call.path.includes('/checkruns'))).toHaveLength(1);
    expect(data.source).toBe('unknown');
  });
  it('does not imply that an update created a metadata shell', async () => {
    statuses.put = 400;
    const { data } = await write('update');
    expect(data.metadata).toBe('existing');
    expect(data.message).toContain('existing UIAD');
    expect(data.message).not.toMatch(/creation|retained|deleting/);
  });
  it('hides SAP diagnostics and lock tokens in minimal-errors mode', async () => {
    statuses.put = 400;
    const { result } = await write('create', {}, true);
    expect(result.content[0].text).not.toMatch(/original failure|SECRET_LOCK|TOKEN/);
    statuses.put = 200;
    checkBody = semantic(catalogError);
    const blocked = await write('create', {}, true);
    expect(blocked.result.content[0].text).not.toMatch(/Technical Catalog|SUI_UIAD/);
    expect(blocked.data.validation.semantic).toBe('failed');
  });
  it('does not retain schema state across calls or resolve remote refs', async () => {
    await write();
    schemaBody = JSON.stringify({
      type: 'object',
      properties: { formatVersion: { $ref: 'https://evil.test/schema' } },
    });
    const { data } = await write();
    expect(data.validation.schema).toBe('unavailable');
    expect(calls.filter((c) => c.path.split('?')[0] === `${prefix}/$schema`)).toHaveLength(2);
  });
  it('supports metadata-only creates without claiming source validation', async () => {
    const { data } = await write('create', { source: undefined });
    expect(data.validation).toMatchObject({ schema: 'notRun', semantic: 'notRun' });
    expect(data.source).toBe('notAttempted');
  });
  it.each(['{', '[]', 'null', '"hello"', 'x'.repeat(1024 * 1024 + 1)])(
    'rejects malformed, non-object, and oversized source before mutation',
    async (value) => {
      const result = await handleSAPWrite(
        client(),
        { action: 'create', type: 'UIAD', name, source: value },
        config,
        undefined,
        { isPerUserClient: false },
      );
      expect(result.isError).toBe(true);
      expect(mutations()).toHaveLength(0);
    },
  );
});
