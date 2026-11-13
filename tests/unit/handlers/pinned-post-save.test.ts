/**
 * Pinned writes past the save: the internal activation steps that the per-family mock never reaches
 * (text-pool activation, batch_create, generate_behavior_implementation) and caller-reachable preaudit=false.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { handleSAPActivate } = await import('../../../src/handlers/activate.js');

const config = {
  ...DEFAULT_CONFIG,
  targetId: 'A4H/001',
  multiTargetEndpoints: true,
  multiTargetWrite: {
    target: 'A4H/001',
    enabled: true,
    allowedPackages: ['$TMP'],
    allowedTransports: ['A4HK900001'],
    serverAllowedTransports: [],
  },
  allowWrites: true,
  allowedPackages: ['$TMP'],
  ppEnabled: true,
  ppStrict: true,
  lintBeforeWrite: false,
};
const client = () => new AdtClient({ baseUrl: 'http://sap:8000', safety: { ...defaultSafetyConfig(), ...config } });
const NATIVE = { classes: 'CLAS/OCX', programs: 'PROG/PX', functiongroups: 'FUGR/PX' } as Record<string, string>;
const OK =
  '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="true"/></chkl:messages>';
const FAILED =
  '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><msg type="E"><shortText><txt>Text pool not activated</txt></shortText></msg></chkl:messages>';
const prompt = (uris: string[]) =>
  `<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core">${uris
    .map(
      (uri) =>
        `<ioc:entry><ioc:object><ioc:ref adtcore:uri="${uri}" adtcore:name="${uri.split('/').pop()?.toUpperCase()}"/></ioc:object></ioc:entry>`,
    )
    .join('')}</ioc:inactiveObjects>`;

let activation: (body: string, path: string) => string;
let poolState: string;
const requests: Array<{ method: string; path: string; body: string }> = [];
beforeEach(() => {
  vi.resetAllMocks();
  activation = () => OK;
  poolState = 'active';
  requests.length = 0;
  mockFetch.mockImplementation(async (url: unknown, options: any = {}) => {
    const parsed = new URL(String(url));
    const path = parsed.pathname + parsed.search;
    const method = options.method ?? 'GET';
    const body = String(options.body ?? '');
    requests.push({ method, path, body });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'T' });
    if (path.includes('transportchecks'))
      return mockResponse(200, '<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><RESULT>S</RESULT></DATA>');
    if (path.includes('_action=LOCK')) return mockResponse(200, '<DATA><LOCK_HANDLE>LH</LOCK_HANDLE></DATA>');
    if (path.includes('/activation?')) return mockResponse(200, activation(body, path));
    if (method !== 'GET') return mockResponse(200, '');
    const pool = parsed.pathname.match(/\/textelements\/(\w+)\/(\w+)$/);
    if (pool && parsed.searchParams.get('version') === 'inactive')
      return mockResponse(
        200,
        `<rept:textElement xmlns:rept="http://www.sap.com/adt/textelements" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${pool[2].toUpperCase()}" adtcore:type="${NATIVE[pool[1]]}" adtcore:version="${poolState}"><adtcore:packageRef adtcore:name="$TMP"/></rept:textElement>`,
      );
    if (/\/source\//.test(parsed.pathname)) return mockResponse(200, '');
    return mockResponse(
      200,
      `<adtcore:object xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZTEST"><adtcore:packageRef adtcore:name="$TMP"/></adtcore:object>`,
    );
  });
});
const activations = () => requests.filter((r) => r.path.includes('/activation?'));
const index = (pick: (r: (typeof requests)[number]) => boolean) => requests.findIndex(pick);
const write = (args: Record<string, unknown>) => handleToolCall(client(), config, 'SAPWrite', args);

describe('pinned text-symbol writes activate exactly their text pool', () => {
  it.each([
    ['PROG', 'programs'],
    ['CLAS', 'classes'],
    ['FUGR', 'functiongroups'],
  ] as const)('%s: save, exact-URI activation without preaudit, then state read', async (type, collection) => {
    const result = await write({ action: 'edit_text_symbols', type, name: 'ZTEST', source: '@MaxLength:20\n001=Hi' });
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(result.content[0].text).toContain('SAP reports the text pool active');
    const pool = `/sap/bc/adt/textelements/${collection}/ZTEST`;
    expect(activations()).toHaveLength(1);
    expect(activations()[0].path).toContain('preauditRequested=false');
    expect(activations()[0].body.match(/adtcore:uri="([^"]+)"/g)).toEqual([`adtcore:uri="${pool}"`]);
    const put = index((r) => r.method === 'PUT');
    const activate = index((r) => r.path.includes('/activation?'));
    const state = index((r, i) => i > activate && r.path.startsWith(`${pool}?version=inactive`));
    expect(put).toBeGreaterThan(-1);
    expect(activate).toBeGreaterThan(put);
    expect(state).toBeGreaterThan(activate);
  });

  it('reports a saved text pool whose activation failed', async () => {
    activation = () => FAILED;
    const result = await write({ action: 'edit_text_symbols', type: 'PROG', name: 'ZTEST', source: '' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Text elements were saved, but activation was not confirmed');
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
    expect(activations()).toHaveLength(1);
  });
});

describe('caller-supplied preaudit=false stays refused on pinned routes', () => {
  it('refuses at dispatch and in the activate handler itself, before any request', async () => {
    const viaDispatch = await handleToolCall(client(), config, 'SAPActivate', {
      type: 'PROG',
      name: 'ZTEST',
      preaudit: false,
    });
    expect(viaDispatch.isError).toBe(true);
    for (const args of [
      { type: 'PROG', name: 'ZTEST', preaudit: false },
      { type: 'REPT', name: 'ZTEST', preaudit: false },
      { objects: [{ type: 'PROG', name: 'ZTEST' }], preaudit: false },
    ])
      await expect(handleSAPActivate(client(), args, undefined, { isPerUserClient: true }, true)).rejects.toThrow(
        'Multi-target activation requires preaudit.',
      );
    expect(requests).toHaveLength(0);
  });
});

describe('repairing a stranded program text pool on a pinned route', () => {
  const pool = '/sap/bc/adt/textelements/programs/ztest';
  const owner = '/sap/bc/adt/programs/programs/ztest';

  it('activates REPT with preaudit; SAP adding the owner program needs it listed', async () => {
    activation = (_body, path) => (path.includes('preauditRequested=true') ? prompt([pool]) : OK);
    const own = await handleToolCall(client(), config, 'SAPActivate', { type: 'REPT', name: 'ZTEST' });
    expect(own.isError, own.content[0].text).toBeUndefined();
    expect(activations()[0].path).toContain('preauditRequested=true');
    expect(activations()[0].body.toLowerCase()).toContain(`adtcore:uri="${pool}"`);

    requests.length = 0;
    activation = (_body, path) => (path.includes('preauditRequested=true') ? prompt([pool, owner]) : OK);
    const widened = await handleToolCall(client(), config, 'SAPActivate', { type: 'REPT', name: 'ZTEST' });
    expect(widened.isError).toBe(true);
    expect(widened.content[0].text).toContain('objects that were not requested');
    expect(activations()).toHaveLength(1);

    requests.length = 0;
    const listed = await handleToolCall(client(), config, 'SAPActivate', {
      objects: [
        { type: 'REPT', name: 'ZTEST' },
        { type: 'PROG', name: 'ZTEST' },
      ],
    });
    expect(listed.isError, listed.content[0].text).toBeUndefined();
    expect(activations()).toHaveLength(2);
    expect(activations()[1].path).toContain('preauditRequested=false');
  });
});

describe('activationExecuted="false" is reported, not claimed as success', () => {
  it('single, batch and batch_create keep a non-failing result without "Successfully activated"', async () => {
    activation = () =>
      '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="false"/></chkl:messages>';
    const single = await handleToolCall(client(), config, 'SAPActivate', { type: 'PROG', name: 'ZTEST' });
    const batch = await handleToolCall(client(), config, 'SAPActivate', {
      objects: [
        { type: 'PROG', name: 'ZTEST' },
        { type: 'PROG', name: 'ZTEST2' },
      ],
    });
    for (const result of [single, batch]) {
      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).not.toContain('Successfully activated');
      expect(result.content[0].text).toContain('activation was not executed');
    }
    expect(batch.content[0].text).toContain('ZTEST (PROG): requested');
    const created = await write({
      action: 'batch_create',
      package: '$TMP',
      activateAtEnd: true,
      objects: [{ type: 'PROG', name: 'ZTEST_A', source: 'REPORT ztest_a.' }],
    });
    expect(created.isError).toBeUndefined();
    expect(created.content[0].text).toContain('batch activation requested');
    expect(created.content[0].text).toContain('activation was not executed');
  });
});

describe('other internal activations after a pinned save keep the preaudit scope check', () => {
  const batch = (activateAtEnd: boolean) =>
    write({
      action: 'batch_create',
      package: '$TMP',
      activateAtEnd,
      objects: [
        { type: 'PROG', name: 'ZTEST_A', source: 'REPORT ztest_a.' },
        { type: 'PROG', name: 'ZTEST_B', source: 'REPORT ztest_b.' },
      ],
    });

  it.each([false, true])('batch_create activateAtEnd=%s activates with preaudit after the saves', async (atEnd) => {
    const result = await batch(atEnd);
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(activations()).toHaveLength(atEnd ? 1 : 2);
    expect(activations().every((r) => r.path.includes('preauditRequested=true'))).toBe(true);
    expect(index((r) => r.path.includes('/activation?'))).toBeGreaterThan(index((r) => r.method === 'PUT'));
  });

  it('batch_create refuses to confirm an object SAP adds to the activation', async () => {
    activation = (_body, path) =>
      path.includes('preauditRequested=true')
        ? prompt(['/sap/bc/adt/programs/programs/ztest_a', '/sap/bc/adt/programs/programs/zforeign'])
        : OK;
    const result = await batch(true);
    expect(result.content[0].text).toContain('objects that were not requested');
    expect(activations()).toHaveLength(1);
  });
});
