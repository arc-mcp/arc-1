/** SAPWrite action="generate" over SAP responses captured on 7.58 and 8.16 (table renamed to ZTRAVEL). */
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

const fixture = (name: string) =>
  readFileSync(new URL(`../../fixtures/service-generators/${name}`, import.meta.url), 'utf8');
const RELEASES = {
  '758': { id: 'uiservice', root: '/sap/bc/adt/businessservices/generators/uiservice', count: 9 },
  '816': { id: 'ui-service', root: '/sap/bc/adt/rap/generators/ui/ui-service', count: 14 },
} as const;
type Release = keyof typeof RELEASES;

interface Sap {
  release?: Release;
  existing?: string[]; // planned "TYPE NAME" that already exist before the run
  afterRun?: (name: string) => string | undefined; // package of a planned object after the run; undefined = missing
  validation?: 'ok' | 'error' | 'empty';
  runStatus?: number;
  feed?: string;
  feedStatus?: number;
  preview?: string;
  transport?: string; // CTS document for GET /transportrequests/<id>
  local?: boolean; // SAP's transport check reports the package as local
  table?: 'missing' | 'never-activated';
  ctsResult?: string;
}

function sap(opts: Sap = {}) {
  const release = opts.release ?? '758';
  const { id, root } = RELEASES[release];
  const prefix = `${release}-${id}`;
  const preview = opts.preview ?? fixture(`${prefix}-preview.xml`);
  const planned = [...preview.matchAll(/adtcore:uri="([^"]+)" adtcore:type="([^"]+)" adtcore:name="([^"]+)"/g)].map(
    (m) => ({ uri: m[1] as string, type: m[2] as string, name: m[3] as string }),
  );
  let ran = false;
  const calls: Array<{ method: string; path: string; url: URL; body: string; init: Record<string, unknown> }> = [];
  mockFetch.mockImplementation(async (raw, init) => {
    const url = new URL(String(raw));
    const method = String(init?.method ?? 'GET');
    calls.push({ method, path: url.pathname, url, body: String(init?.body ?? ''), init: init ?? {} });
    const ok = (body: string) => mockResponse(200, body, { 'x-csrf-token': 'T' });
    const path = url.pathname;
    if (path === '/sap/bc/adt/repository/generators') {
      return mockResponse(opts.feedStatus ?? 200, opts.feed ?? fixture(`${prefix}-feed.xml`));
    }
    if (path === `${root}/content`) return ok(fixture(`${prefix}-content.json`));
    if (path === `${root}/validation`) {
      if (opts.validation === 'empty') return ok('<other/>');
      return ok(fixture(`${prefix}-validation${opts.validation === 'error' ? '-error' : ''}.xml`));
    }
    if (path === `${root}/preview`) return ok(preview);
    if (path === root && method === 'POST') {
      ran = true;
      return mockResponse(opts.runStatus ?? 200, fixture(`${prefix}-run.xml`), { 'x-csrf-token': 'T' });
    }
    const object = planned.find((p) => p.uri === path);
    if (object) {
      const pkg = ran
        ? opts.afterRun
          ? opts.afterRun(object.name)
          : '$TMP'
        : opts.existing?.includes(`${object.type} ${object.name}`)
          ? 'ZOTHER'
          : undefined;
      return pkg === undefined
        ? mockResponse(404, 'not found')
        : ok(`<x adtcore:name="${object.name}"><adtcore:packageRef adtcore:name="${pkg}"/></x>`);
    }
    if (path === '/sap/bc/adt/ddic/tables/ztravel') {
      if (opts.table === 'missing') return mockResponse(404, 'not found');
      return ok(`<blue:blueSource adtcore:version="${opts.table === 'never-activated' ? 'new' : 'active'}"/>`);
    }
    if (path.startsWith('/sap/bc/adt/packages/')) return ok('<pak:package/>');
    if (path === '/sap/bc/adt/cts/transportchecks') {
      return ok(
        `<asx:abap><asx:values><DATA><DLVUNIT>${opts.local ? 'ZLOCAL' : 'HOME'}</DLVUNIT><RECORDING>${opts.local ? '' : 'X'}</RECORDING><RESULT>${opts.ctsResult ?? 'S'}</RESULT></DATA></asx:values></asx:abap>`,
      );
    }
    if (path.startsWith('/sap/bc/adt/cts/transportrequests/')) return ok(opts.transport ?? '<tm:root/>');
    return mockResponse(404, 'unexpected');
  });
  return { calls, planned, posts: () => calls.filter((c) => c.method === 'POST'), ran: () => ran };
}

const client = (safety: Partial<ReturnType<typeof unrestrictedSafetyConfig>> = {}) =>
  new AdtClient({
    baseUrl: 'http://sap:8000',
    username: 'u',
    password: 'p',
    safety: { ...unrestrictedSafetyConfig(), ...safety },
  });
const generate = (args: Record<string, unknown>, c = client(), config: Partial<ServerConfig> = {}) =>
  handleToolCall(c, { ...DEFAULT_CONFIG, allowWrites: true, ...config }, 'SAPWrite', {
    action: 'generate',
    generator: 'ui-service',
    type: 'TABL',
    name: 'ZTRAVEL',
    package: '$TMP',
    ...args,
  });
const json = (text: string) => JSON.parse(text.slice(text.indexOf('{')));

describe('SAPWrite action="generate"', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(['758', '816'] as const)('dry run on %s: SAP checks, planned objects, no run', async (release) => {
    const s = sap({ release });
    const result = await generate({ dryRun: true });
    expect(result.isError).toBeUndefined();
    const body = json(result.content[0].text);
    expect(body).toMatchObject({ valid: true, dryRun: true, package: '$TMP' });
    expect(body.objects).toHaveLength(RELEASES[release].count);
    expect(body.objects[0]).toEqual({ type: s.planned[0]!.type, name: s.planned[0]!.name });
    expect(Object.keys(body.input)[0]).toBe('metadata');
    expect(body.input.metadata).toMatchObject({ package: '$TMP', masterLanguage: 'EN' });
    expect(s.ran()).toBe(false);
    const bindingKey = release === '758' ? 'name' : 'serviceBindingName';
    expect(body.next).toContain(`{"businessService":{"serviceBinding":{"${bindingKey}":"ZUI_ZTRAVEL_O4_NEW"}}}`);
    const validation = s.posts().find((c) => c.path.endsWith('/validation'))!;
    expect(validation.url.searchParams.get('checks')).toBe('package,referencedobject,authorization');
    expect(validation.url.searchParams.get('referencedObject')).toBe('/sap/bc/adt/ddic/tables/ztravel');
  });

  it.each(['758', '816'] as const)(
    'real run on %s: one run POST, never redirected, every object read back',
    async (release) => {
      const s = sap({ release });
      const result = await generate({});
      expect(result.isError, result.content[0].text).toBeUndefined();
      const body = json(result.content[0].text);
      expect(body.objects.every((o: { state: string }) => o.state === 'found')).toBe(true);
      expect(body.next).toContain('publish_srvb');
      const runs = s.posts().filter((c) => c.path === RELEASES[release].root);
      expect(runs).toHaveLength(1);
      expect(runs[0]!.init.redirect).toBe('manual');
      expect(body.objects).toHaveLength(RELEASES[release].count);
    },
  );

  it('defaults to $TMP like create', async () => {
    sap();
    const result = await generate({ dryRun: true, package: undefined });
    expect(json(result.content[0].text).package).toBe('$TMP');
  });

  it('carries an override of a proposed name into validation, preview and run', async () => {
    const s = sap();
    const source = JSON.stringify({ businessService: { serviceBinding: { name: 'ZUI_TRAVEL_X' } } });
    await generate({ source });
    for (const post of s.posts())
      expect(JSON.parse(post.body).businessService.serviceBinding.name).toBe('ZUI_TRAVEL_X');
  });

  it.each([
    ['writes off', { safety: { allowWrites: false } }, 'allowWrites=false'],
    [
      'package outside allowlist',
      { safety: { allowedPackages: ['$TMP'] }, args: { package: 'ZOTHER', transport: 'A4HK900001' } },
      "package 'ZOTHER'",
    ],
    ['metadata in source', { args: { source: '{"metadata":{"package":"ZOTHER"}}' } }, 'metadata is set by ARC-1'],
    [
      'transport not allowed, subtree package rule',
      {
        safety: { allowedTransports: ['A4HK9*'], allowedPackages: ['ZROOT/**'] },
        args: { package: 'ZPKG', transport: 'B4HK900001' },
      },
      "transport 'B4HK900001'",
    ],
    ['transport on $TMP', { args: { transport: 'A4HK900001' } }, 'takes no transport'],
    [
      'transport not allowed',
      { safety: { allowedTransports: ['A4HK9*'] }, args: { package: 'ZPKG', transport: 'B4HK900001' } },
      "transport 'B4HK900001'",
    ],
    ['denied action', { config: { denyActions: ['SAPWrite.generate'] } }, 'SAP_DENY_ACTIONS'],
    ['not a table', { args: { type: 'DDLS' } }, 'type="TABL"'],
    ['unknown generator', { args: { generator: 'smbc' } }, 'generator'],
  ] as const)('refuses before any SAP request: %s', async (_label, setup, message) => {
    sap();
    const s = setup as { safety?: object; args?: object; config?: object };
    const result = await generate({ dryRun: true, ...s.args }, client(s.safety), s.config);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(message);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an unknown key',
      { businessService: { serviceBinding: { url: 'x' } } },
      '"businessService.serviceBinding.url" is not in SAP\'s proposal',
    ],
    ['the table name', { general: { referenceObjectName: 'ZOTHER' } }, 'names the table'],
    ['a changed shape', { businessObject: 'x' }, 'shape'],
    ['an "input" wrapper', { input: { general: {} } }, 'remove the outer "input" key'],
  ])('refuses %s in source before validation', async (_label, overrides, message) => {
    const s = sap();
    const result = await generate({ dryRun: true, source: JSON.stringify(overrides) });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(message);
    expect(s.posts()).toHaveLength(0);
  });

  it.each(['758', '816'] as const)('stops on a validation error from %s', async (release) => {
    const s = sap({ release, validation: 'error' });
    const result = await generate({ dryRun: true });
    expect(result.isError).toBe(true);
    expect(json(result.content[0].text).messages[0]).toMatchObject({ severity: 'ERROR' });
    expect(result.content[0].text).toContain('already exists');
    expect(s.posts().some((c) => c.path.endsWith('/preview'))).toBe(false);
  });

  it('never treats an unreadable validation answer as a pass', async () => {
    sap({ validation: 'empty' });
    const result = await generate({ dryRun: true });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no validation status');
  });

  it('refuses the run when a planned object already exists', async () => {
    const s = sap({ release: '816', existing: ['SRVB/SVB ZUI_ZTRAVEL_O4'] });
    const result = await generate({});
    expect(result.isError).toBe(true);
    expect(json(result.content[0].text).existing).toEqual([{ type: 'SRVB/SVB', name: 'ZUI_ZTRAVEL_O4' }]);
    expect(s.ran()).toBe(false);
  });

  it('reports the read-back when the run fails, and never replays it', async () => {
    const s = sap({ runStatus: 500 });
    const result = await generate({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('SAP generation failed');
    expect(result.content[0].text).toContain('"state":"found"');
    expect(s.posts().filter((c) => c.path === RELEASES['758'].root)).toHaveLength(1);
  });

  it('is an error when an object is missing or in another package after the run', async () => {
    sap({ afterRun: (name) => (name === 'ZC_ZTRAVEL' ? undefined : name.startsWith('ZBP') ? 'ZOTHER' : '$TMP') });
    const result = await generate({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('not every object was confirmed');
    expect(result.content[0].text).toContain('"state":"missing"');
    expect(result.content[0].text).toContain('"state":"wrong_package"');
  });

  it.each([
    ['a missing table or structure (7.58 would preview one)', 'missing', 'ZTRAVEL is not a database table'],
    ['a never-activated table (8.16 validation dumps)', 'never-activated', 'Activate it first'],
  ] as const)('refuses %s before any generator endpoint', async (_label, table, message) => {
    const s = sap({ table });
    const result = await generate({ dryRun: true });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(message);
    expect(s.calls.some((c) => c.path.includes('/generators/'))).toBe(false);
  });

  it.each([307, 308])(
    'never reports a run answered with HTTP %s as success, even when every object exists',
    async (status) => {
      const s = sap({ runStatus: status });
      const result = await generate({});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(`status ${status} at`);
      expect(result.content[0].text).toContain('"state":"found"');
      expect(s.posts().filter((c) => c.path === RELEASES['758'].root)).toHaveLength(1);
    },
  );

  it("keeps SAP's 8.16 bookkeeping: an unchanged sessionId passes, a changed one is refused", async () => {
    const s = sap({ release: '816' });
    const same = await generate({
      dryRun: true,
      source: '{"general":{"sessionId":"SID0000000000000000000000000001"}}',
    });
    expect(same.isError).toBeUndefined();
    const changed = await generate({ dryRun: true, source: '{"general":{"sessionId":"OLD"}}' });
    expect(changed.content[0].text).toContain('"general.sessionId" is SAP\'s own');
    const orgn = await generate({
      dryRun: true,
      source: '{"businessObject":{"dataModelEntity":{"entityNameOrgn":"ZX"}}}',
    });
    expect(orgn.content[0].text).toContain('"businessObject.dataModelEntity.entityNameOrgn" is SAP\'s own');
    expect(s.posts().filter((c) => c.path.endsWith('/validation'))).toHaveLength(1);
  });

  it('refuses a preview object without CREATE as its operation', async () => {
    const preview = fixture('758-uiservice-preview.xml').replace(' adtcore:description="CREATE"', '');
    const s = sap({ preview });
    const result = await generate({});
    expect(json(result.content[0].text).notCreate).toEqual([
      { type: 'DDLS/DF', name: 'ZR_ZTRAVEL', operation: 'none' },
    ]);
    expect(s.ran()).toBe(false);
  });

  it('says so when the system has no generator framework (7.50)', async () => {
    sap({ feedStatus: 404, feed: 'No suitable resource found' });
    const result = await generate({ dryRun: true });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('no ADT object generators');
  });

  it('names what SAP offers when the table has no such generator', async () => {
    sap({
      feed: fixture('758-uiservice-feed.xml').replace(/<atom:id>uiservice<\/atom:id>/, '<atom:id>other</atom:id>'),
    });
    const result = await generate({ dryRun: true });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('offered: smbc, other, webapiservice');
  });

  it('refuses an endpoint outside the generator root', async () => {
    const feed = fixture('758-uiservice-feed.xml').replace(
      '/sap/bc/adt/businessservices/generators/uiservice/preview',
      '/sap/bc/adt/businessservices/generators/uiservice-x/preview',
    );
    const s = sap({ feed });
    const result = await generate({ dryRun: true });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("no usable 'preview' endpoint");
    expect(s.calls.at(-1)?.path).toBe('/sap/bc/adt/repository/generators');
  });

  it('refuses a feed link for another rel (a preview link pointing at the run endpoint)', async () => {
    const feed = fixture('758-uiservice-feed.xml').replace(
      '/sap/bc/adt/businessservices/generators/uiservice/preview',
      '/sap/bc/adt/businessservices/generators/uiservice',
    );
    const s = sap({ feed });
    const result = await generate({ dryRun: true });
    expect(result.content[0].text).toContain("no usable 'preview' endpoint");
    expect(s.posts()).toHaveLength(0);
  });

  it('fails closed on a preview entry without a name', async () => {
    const preview = fixture('816-ui-service-preview.xml').replace('adtcore:name="ZC_ZTRAVEL"', 'adtcore:name=""');
    const s = sap({ release: '816', preview });
    const result = await generate({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('incomplete generator preview');
    expect(s.ran()).toBe(false);
  });

  it("hides SAP's run error text with ARC1_MINIMAL_ERRORS but keeps the read-back", async () => {
    sap({ runStatus: 500 });
    const result = await generate({}, client(), { minimalErrors: true });
    expect(result.content[0].text).toContain('SAP generation failed: SAP answered HTTP 500');
    expect(result.content[0].text).toContain('"state":"found"');
  });

  describe('transportable package', () => {
    const request = (status: string, objects: string[] = []) =>
      `<tm:root><tm:request tm:number="A4HK900001" tm:status="${status}"><tm:task tm:number="A4HK900002">${objects
        .map((o) => `<tm:abap_object tm:pgmid="R3TR" tm:type="${o.split(' ')[0]}" tm:name="${o.split(' ')[1]}"/>`)
        .join('')}</tm:task></tm:request></tm:root>`;
    const args = { package: 'ZPKG', transport: 'A4HK900001' };

    it('needs a transport when SAP says the package records changes', async () => {
      const s = sap();
      const result = await generate({ package: 'ZPKG', dryRun: true });
      expect(result.content[0].text).toContain('"transport" is required for package ZPKG');
      expect(s.calls.some((c) => c.path.includes('/generators'))).toBe(false);
    });

    it('refuses an inconclusive transport check instead of skipping the request', async () => {
      const s = sap({ local: true, ctsResult: '' });
      const result = await generate({ package: 'ZLOCAL_SUB', dryRun: true });
      expect(result.content[0].text).toContain('was inconclusive');
      expect(s.calls.some((c) => c.path.includes('/generators'))).toBe(false);
    });

    it('takes no transport in a local package (BTP ZLOCAL subpackage)', async () => {
      sap({ local: true });
      expect(json((await generate({ package: 'ZLOCAL_SUB', dryRun: true })).content[0].text).valid).toBe(true);
      const refused = await generate({ package: 'ZLOCAL_SUB', transport: 'A4HK900001', dryRun: true });
      expect(refused.content[0].text).toContain('is local and takes no transport');
    });
    const inPackage = () => 'ZPKG';

    it('passes corrNr and reports objects outside the request', async () => {
      const s = sap({ transport: request('D', ['DDLS ZR_ZTRAVEL']), afterRun: inPackage });
      const result = await generate(args);
      const run = s.posts().find((c) => c.path === RELEASES['758'].root)!;
      expect(run.url.searchParams.get('corrNr')).toBe('A4HK900001');
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('"name":"ZR_ZTRAVEL","state":"found"');
      expect(result.content[0].text).toContain('"state":"wrong_transport"');
    });

    it.each([
      ['a task', '<tm:root><tm:request tm:number="A4HK900000" tm:status="D"/></tm:root>', 'not a transport request'],
      ['a released request', request('R'), 'not modifiable'],
    ])('refuses %s before the generator is called', async (_label, transport, message) => {
      const s = sap({ transport });
      const result = await generate({ ...args, dryRun: true });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(message);
      expect(s.calls.some((c) => c.path.startsWith('/sap/bc/adt/repository/generators'))).toBe(false);
    });
  });
});
