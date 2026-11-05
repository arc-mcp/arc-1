import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { parsePinnedQuickfixInput } from '../../../src/adt/pinned-quickfix-input.js';
import { requestContext } from '../../../src/server/context.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { pinnedPublicAuth } from '../../helpers/pinned-public-auth.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { executePrivatePinnedQuickfix } = await import('../../../src/handlers/pinned-quickfix.js');
const { applyFixProposal } = await import('../../../src/adt/quickfix.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const nativeEvaluation = readFileSync(
  new URL('../../fixtures/quickfix/a4h-native-evaluation-types.xml', import.meta.url),
  'utf8',
);
const proposal = '/sap/bc/adt/quickfixes/proposals/providers/refactoring/quickfixes/declare_local_variable';
const owner = '/sap/bc/adt/oo/classes/ZCL_TEST',
  sourceUri = `${owner}/source/main`;
const qf = 'http://www.sap.com/adt/quickfixes',
  core = 'http://www.sap.com/adt/core';
const metadata = `<c:abapClass xmlns:c="http://www.sap.com/adt/oo/classes" xmlns:a="${core}" a:name="ZCL_TEST" a:type="CLAS/OC"/>`;
const evaluation = (affected = '', state = 'opaque &amp; 0001') =>
  `<q:evaluationResults xmlns:q="${qf}" xmlns:a="${core}"><evaluationResult><a:objectReference a:uri="${proposal}" a:type="quickfix/proposal"/><userContent>${state}</userContent>${affected}</evaluationResult></q:evaluationResults>`;
const delta = (uri = `${sourceUri}#start=2,0;end=2,0`, content = '\n  DATA lv TYPE i.\n') =>
  `<unit><content>${content}</content><a:objectReference a:uri="${uri}"/></unit>`;
const result = (units = delta()) =>
  `<q:proposalResult xmlns:q="${qf}" xmlns:a="${core}"><deltas>${units}</deltas></q:proposalResult>`;
const args = {
  action: 'apply_quickfix',
  type: 'CLAS',
  name: 'ZCL_TEST',
  sourceUri,
  source: 'METHOD run.\nlv = 1.\nENDMETHOD.',
  line: 2,
  column: 0,
  proposalUri: proposal,
  proposalUserContent: 'opaque & 0001',
};
function setup() {
  const config: ServerConfig = {
    ...DEFAULT_CONFIG,
    allowWrites: true,
    multiTargetEndpoints: true,
    ppEnabled: true,
    ppStrict: true,
    targetId: 'A4H/001',
    multiTargetWrite: {
      enabled: true,
      target: 'A4H/001',
      allowedPackages: [],
      allowedTransports: [],
      serverAllowedTransports: [],
    },
  };
  const client = new AdtClient({
    baseUrl: 'https://sap.test',
    client: '001',
    language: 'DE',
    safety: config,
    bearerTokenProvider: async () => 'mapped-user-token',
  });
  const state = { metadata, evaluation: evaluation(), result: result(), status: 200, ownerPath: owner };
  mockFetch.mockImplementation(async (url, options) => {
    const path = new URL(String(url)).pathname;
    if (options?.method === 'GET' && path.toLowerCase() === state.ownerPath.toLowerCase())
      return mockResponse(200, state.metadata);
    if (options?.method === 'GET' || options?.method === 'HEAD')
      return mockResponse(200, '', { 'x-csrf-token': 'csrf-token' });
    if (path === '/sap/bc/adt/quickfixes/evaluation') return mockResponse(200, state.evaluation);
    if (path === proposal)
      return mockResponse(state.status, state.result, state.status === 403 ? { 'x-csrf-token': 'Required' } : {});
    throw new Error('unexpected endpoint');
  });
  const run = async (input: Record<string, unknown> = args, scopes = ['read', 'write']) => {
    const output = await executePrivatePinnedQuickfix(client, input, config, scopes);
    return JSON.parse((output.content[0] as { text: string }).text);
  };
  return { config, client, state, run };
}
const posts = () => mockFetch.mock.calls.filter(([, options]) => options?.method === 'POST');
const applications = () => posts().filter(([url]) => String(url) === `https://sap.test${proposal}`);
beforeEach(() => vi.resetAllMocks());

describe('private quickfix through the shared real HTTP client', () => {
  it('computes through the registered shared low-level profile', async () => {
    const s = setup(),
      input = parsePinnedQuickfixInput(args);
    const context = pinnedMutationContext(s.client.safety, { deadline: Date.now() + 30_000 }, { unlockFailed: false });
    await expect(
      applyFixProposal(
        s.client.http,
        s.client.safety,
        input.proposal,
        input.sourceUri,
        input.source,
        input.line,
        input.column,
        { mode: 'pinned-pp', context, owner: input.owner },
      ),
    ).resolves.toMatchObject([{ content: '\n  DATA lv TYPE i.\n' }]);
  });
  it('returns literal deltas, keeps the exact proposal URI/context headers, and never saves or activates', async () => {
    const s = setup();
    const output = await s.run();
    expect(output, JSON.stringify(output)).toMatchObject({
      ok: true,
      state: 'computed',
      sourceSaved: false,
      target: 'A4H/001',
      deltas: [{ uri: `${sourceUri}#start=2,0;end=2,0`, content: '\n  DATA lv TYPE i.\n' }],
    });
    expect(posts()).toHaveLength(2);
    expect(applications()).toHaveLength(1);
    const [url, options] = applications()[0];
    expect(String(url)).toBe(`https://sap.test${proposal}`);
    expect(options.headers).toMatchObject({
      'sap-client': '001',
      'sap-language': 'DE',
      Authorization: 'Bearer mapped-user-token',
    });
    expect(options.body).toContain('<userContent>opaque &amp; 0001</userContent>');
    expect(options.body).toContain(`${sourceUri}#start=2,0`);
    expect(mockFetch.mock.calls.every(([, o]) => ['GET', 'HEAD', 'POST'].includes(o.method))).toBe(true);
    expect(
      mockFetch.mock.calls.some(([u]) => /activation|\/source\/|\/locks|\$TMP/.test(new URL(String(u)).pathname)),
    ).toBe(false);
    expect(s.client.safety.multiTargetWrite).toBe(s.config.multiTargetWrite);
  });
  it('owns a validated proposal snapshot across asynchronous evaluation', async () => {
    const s = setup(),
      input = parsePinnedQuickfixInput(args),
      send = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (...request) => {
      const response = await send(...request);
      if (new URL(String(request[0])).pathname === '/sap/bc/adt/quickfixes/evaluation') {
        input.proposal.uri = '/sap/bc/adt/activation';
        input.proposal.userContent = 'changed-after-validation';
      }
      return response;
    });
    const context = pinnedMutationContext(s.client.safety, { deadline: Date.now() + 30_000 }, { unlockFailed: false });
    await expect(
      applyFixProposal(
        s.client.http,
        s.client.safety,
        input.proposal,
        input.sourceUri,
        input.source,
        input.line,
        input.column,
        { mode: 'pinned-pp', context, owner: input.owner },
      ),
    ).resolves.toHaveLength(1);
    expect(applications()).toHaveLength(1);
    expect(applications()[0][1].body).not.toContain('changed-after-validation');
  });
  it('binds a same-owner affected include to fresh native evaluation and the supplied unit text', async () => {
    const s = setup(),
      include = `${owner}/includes/definitions`,
      content = 'CLASS local DEFINITION.\nENDCLASS.';
    s.state.evaluation = evaluation(
      `<affectedObjects><a:objectReference a:uri="${include}" a:type="CLAS/OC" a:name="ZCL_TEST"/></affectedObjects>`,
    );
    s.state.result = result(delta(`${include}#start=2,0;end=2,0`, '0001'));
    expect(
      await s.run({ ...args, proposalAffectedObjects: [{ uri: include, type: 'CLAS/OC', name: 'ZCL_TEST', content }] }),
    ).toMatchObject({ ok: true, deltas: [{ content: '0001' }] });
    expect(applications()[0][1].body).toContain(content);
  });
  it.each(['', '<content/>'])('preserves native empty replacement content %s', async (content) => {
    const s = setup();
    s.state.result = result(`<unit>${content}<a:objectReference a:uri="${sourceUri}#start=2,0;end=2,7"/></unit>`);
    expect(await s.run()).toMatchObject({ ok: true, deltas: [{ content: '' }] });
  });
  it('accepts a typed empty delta collection', async () => {
    const s = setup();
    s.state.result = result('');
    expect(await s.run()).toMatchObject({ ok: true, deltas: [] });
  });
  it.each([
    metadata.replace('ZCL_TEST', 'ZCL_OTHER'),
    metadata.replace('CLAS/OC', 'INTF/OI'),
    metadata.replace(core, 'urn:foreign'),
    metadata.replace('/>', ` a:uri="${owner}X"/>`),
    '<html/>',
    '',
  ])('refuses mismatched/untyped owner metadata before evaluation %#', async (xml) => {
    const s = setup();
    s.state.metadata = xml;
    expect(await s.run()).toMatchObject({ ok: false });
    expect(posts()).toHaveLength(0);
  });
  it.each([
    evaluation('', 'different state'),
    evaluation().replace(proposal, `${proposal}_other`),
    evaluation(`<affectedObjects><a:objectReference a:uri="${owner}/includes/definitions"/></affectedObjects>`),
    evaluation().replace('</q:evaluationResults>', '<next/></q:evaluationResults>'),
    evaluation().replace('<evaluationResult>', '<evaluationResult hasMore="true">'),
    evaluation().replace('a:type="quickfix/proposal"', 'a:type="interactive/refactoring"'),
    `<q:evaluationResults xmlns:q="${qf}"/>`,
    '<html/>',
  ])('does not apply a stale, mismatched or unknown native proposal context %#', async (xml) => {
    const s = setup();
    s.state.evaluation = xml;
    expect(await s.run()).toMatchObject({ ok: false });
    expect(applications()).toHaveLength(0);
    expect(posts()).toHaveLength(1);
  });
  it.each([
    '<html/>',
    '',
    `<q:proposalResult xmlns:q="${qf}"/>`,
    result().replace(qf, 'urn:foreign'),
    result().replace(core, 'urn:foreign'),
    result().replace('<deltas>', '<deltas hasMore="true">'),
    result().replace('</deltas>', '<unknown/></deltas>'),
    result(delta('https://evil.test/source#start=2,0;end=2,0')),
    result(delta(`${owner}/includes/definitions#start=1,0;end=1,0`)),
    result(delta(`${sourceUri}#start=999,0;end=999,0`)),
    result(delta(`${sourceUri}#start=2,2;end=2,1`)),
    result(delta(`${sourceUri}#start=2,0`)),
    result(delta() + delta()),
    result(delta().repeat(65)),
    result(delta().replace('<content>', '<content><unknown/>')),
  ])('refuses malformed/foreign/ambiguous delta output after exactly one application %#', async (xml) => {
    const s = setup();
    s.state.result = xml;
    expect(await s.run()).toMatchObject({ ok: false, sourceSaved: false, state: 'computation-unverified' });
    expect(applications()).toHaveLength(1);
  });
  it.each([401, 403, 406, 429, 500, 503])('never replays application after native %s', async (status) => {
    const s = setup();
    s.state.status = status;
    s.state.result = 'SECRET native diagnostic';
    const output = await s.run();
    expect(output).toMatchObject({ ok: false, sourceSaved: false });
    expect(applications()).toHaveLength(1);
    expect(JSON.stringify(output)).not.toMatch(/SECRET|csrf-token|mapped-user-token|opaque/);
  });
  it('bounds decoded native XML and cumulative bodies before returning deltas', async () => {
    const s = setup();
    s.state.result = result(delta().replace('<content>', `<content>${'x'.repeat(2 * 1024 * 1024)}`));
    expect(await s.run()).toMatchObject({ ok: false });
    expect(applications()).toHaveLength(1);
  });
  it('counts individually bounded owner, evaluation and delta bodies cumulatively', async () => {
    const s = setup(),
      padding = 'x'.repeat(600 * 1024);
    s.state.metadata = metadata.replace('/>', `><!--${padding}--></c:abapClass>`);
    s.state.evaluation = evaluation().replace('<evaluationResult>', `<evaluationResult><!--${padding}-->`);
    s.state.result = result(delta(undefined, padding));
    expect(await s.run()).toMatchObject({ ok: false });
    expect(applications()).toHaveLength(1);
  });
  it('does not apply after cancellation during fresh evaluation', async () => {
    const s = setup(),
      controller = new AbortController();
    const send = mockFetch.getMockImplementation()!;
    mockFetch.mockImplementation(async (...input) => {
      const response = await send(...input);
      if (new URL(String(input[0])).pathname === '/sap/bc/adt/quickfixes/evaluation') controller.abort();
      return response;
    });
    expect(await requestContext.run({ requestId: 'test', signal: controller.signal }, () => s.run())).toMatchObject({
      ok: false,
    });
    expect(posts()).toHaveLength(1);
    expect(applications()).toHaveLength(0);
  });
  it('honors the registered deadline before network I/O', async () => {
    const s = setup(),
      input = parsePinnedQuickfixInput(args);
    const context = pinnedMutationContext(s.client.safety, { deadline: Date.now() - 1 }, { unlockFailed: false });
    await expect(
      applyFixProposal(
        s.client.http,
        s.client.safety,
        input.proposal,
        input.sourceUri,
        input.source,
        input.line,
        input.column,
        { mode: 'pinned-pp', context, owner: input.owner },
      ),
    ).rejects.toThrow();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([
    ['INTF', 'oo/interfaces', 'abapInterface', 'INTF/OI', 'ZIF_TEST'],
    ['PROG', 'programs/programs', 'abapProgram', 'PROG/P', 'ZPROG'],
    ['INCL', 'programs/includes', 'abapInclude', 'PROG/I', 'ZINCLUDE'],
    ['CLAS', 'oo/classes', 'abapClass', 'CLAS/OC', '/NS/ZCL_TEST'],
  ])(
    'binds the %s native source context without changing the legacy existence rule',
    async (type, path, root, native, name) => {
      const s = setup(),
        selected = `/sap/bc/adt/${path}/${encodeURIComponent(name)}`,
        uri = `${selected}/source/main`;
      s.state.ownerPath = selected;
      s.state.metadata = `<o:${root} xmlns:o="http://www.sap.com/adt/${path}" xmlns:a="${core}" a:name="${name}" a:type="${native}"/>`;
      s.state.result = result(delta(`${uri}#start=2,0;end=2,0`));
      expect(await s.run({ ...args, type, name, sourceUri: uri })).toMatchObject({ ok: true });
      const reads = mockFetch.mock.calls.filter(
        ([url, options]) => options?.method === 'GET' && new URL(String(url)).pathname === selected,
      );
      expect(reads).toHaveLength(type === 'CLAS' || type === 'INTF' ? 2 : 0);
    },
  );
  it('honors cancellation before network I/O', async () => {
    const s = setup(),
      controller = new AbortController();
    controller.abort();
    expect(await requestContext.run({ requestId: 'test', signal: controller.signal }, () => s.run())).toMatchObject({
      ok: false,
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('refuses a foreign context target or shared identity', async () => {
    const s = setup();
    for (const context of [{ target: 'OTHER/001' }, { identity: 'shared' as const }])
      expect(await requestContext.run({ requestId: 'test', ...context }, () => s.run())).toMatchObject({ ok: false });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each([{ scopes: ['read'] }, { scopes: ['admin'] }, { scopes: [] }])(
    'requires raw write and effective read scope %j',
    async ({ scopes }) => {
      const s = setup();
      expect(await s.run(args, scopes)).toMatchObject({ ok: false, state: 'unchanged' });
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );
  it.each(['allowWrites', 'ppEnabled', 'ppStrict', 'multiTargetEndpoints'] as const)(
    'refuses a disabled %s',
    async (field) => {
      const s = setup();
      s.config[field] = false;
      expect(await s.run()).toMatchObject({ ok: false });
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );
  it('honors deny actions and destination write refusal', async () => {
    const s = setup();
    s.config.denyActions = ['SAPDiagnose.apply_quickfix'];
    expect(await s.run()).toMatchObject({ ok: false });
    s.config.denyActions = [];
    s.config.multiTargetWrite = { ...s.config.multiTargetWrite!, enabled: false };
    expect(await s.run()).toMatchObject({ ok: false });
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('keeps public dispatch closed for a fully opted-in writer', async () => {
    const s = setup();
    const output = await handleToolCall(s.client, s.config, 'SAPDiagnose', args);
    expect(output.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('rejects missing/fabricated/cross-policy contexts at the shared low-level application boundary', async () => {
    const s = setup(),
      input = parsePinnedQuickfixInput(args);
    const invoke = (profile?: Parameters<typeof applyFixProposal>[7]) =>
      applyFixProposal(
        s.client.http,
        s.client.safety,
        input.proposal,
        input.sourceUri,
        input.source,
        input.line,
        input.column,
        profile,
      );
    await expect(invoke()).rejects.toThrow('Missing pinned');
    const context = pinnedMutationContext(s.client.safety, { deadline: Date.now() + 30_000 }, { unlockFailed: false });
    await expect(invoke({ mode: 'pinned-pp', owner: input.owner, context: { ...context } })).rejects.toThrow('context');
    const other = { ...s.client.safety, multiTargetWrite: { ...s.client.safety.multiTargetWrite! } };
    await expect(
      invoke({
        mode: 'pinned-pp',
        owner: input.owner,
        context: pinnedMutationContext(other, { deadline: Date.now() + 30_000 }, { unlockFailed: false }),
      }),
    ).rejects.toThrow('context');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('quickfix canonical input before any HTTP', () => {
  it.each([
    { sourceUri: `https://sap.test${sourceUri}` },
    { sourceUri: `${sourceUri}?sap-client=999` },
    { sourceUri: `${owner}/includes/unknown` },
    { sourceUri: sourceUri.replace('ZCL_TEST', 'ZCL_OTHER') },
    { sourceUri: sourceUri.replaceAll('ZCL_TEST', '%255aCL_TEST') },
    { sourceUri: '/sap/bc/adt/oo/classes/%2e%2e/source/main' },
    { sourceUri: sourceUri.replaceAll('ZCL_TEST', 'ZCL_TEST//..') },
    { proposalUri: '/sap/bc/adt/activation' },
    { proposalUri: `${proposal}?opaque=state` },
    { proposalUri: `${proposal}/nested` },
    { proposalUri: proposal.replace('declare_', '%64eclare_') },
    { proposalUri: `${proposal}#fragment` },
    { name: 'ZCL_OTHER' },
    { type: 'FUNC' },
    { line: 0 },
    { column: -1 },
    { line: '2' },
    { line: 1.5 },
    { line: 999 },
    { column: 999 },
    { source: '' },
    { source: '\u0000' },
    { proposalUserContent: '\ud800' },
    { source: 'x'.repeat(256 * 1024 + 1) },
    {
      line: 1,
      source: 'x'.repeat(256 * 1024),
      proposalAffectedObjects: [{ uri: `${owner}/includes/definitions`, content: 'x'.repeat(256 * 1024) }],
    },
    { proposalUserContent: 'x'.repeat(64 * 1024 + 1) },
    { target: 'OTHER/001' },
    { proposalAffectedObjects: [{ uri: `${owner}/includes/definitions`, content: '', unknown: true }] },
    { proposalAffectedObjects: [{ uri: `${owner}/includes/definitions` }] },
    { proposalAffectedObjects: [{ uri: sourceUri, content: 'wrong source' }] },
    { proposalAffectedObjects: [{ uri: sourceUri.replace('ZCL_TEST', 'ZCL_OTHER'), content: 'source' }] },
  ])('refuses mismatched, unbounded or ambiguous input %#', async (bad) => {
    const s = setup();
    expect(await s.run({ ...args, ...bad })).toMatchObject({ ok: false, state: 'unchanged' });
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

it('routes an authorized public quickfix to the same delta-only HTTP core without saving source', async () => {
  const { client, config } = setup();
  const selected = { ...config, client: '001', multiTargetAuthorization: 'xsuaa-attribute' as const };
  const { pinnedMutationAllowed } = await import('../../../src/server/multi-target-write-surface.js');
  const { normalizeTypeArgsForValidation } = await import('../../../src/handlers/object-types.js');
  const { SAPDiagnoseSchema } = await import('../../../src/handlers/schemas.js');
  const normalized = normalizeTypeArgsForValidation('SAPDiagnose', args);
  const parsed = SAPDiagnoseSchema.parse(normalized);
  expect(pinnedMutationAllowed('SAPDiagnose', args, selected)).toBe(true);
  expect(pinnedMutationAllowed('SAPDiagnose', normalized, selected), JSON.stringify(normalized)).toBe(true);
  expect(pinnedMutationAllowed('SAPDiagnose', parsed, selected), JSON.stringify(parsed)).toBe(true);
  const output = await handleToolCall(
    client,
    selected,
    'SAPDiagnose',
    args,
    pinnedPublicAuth(),
    undefined,
    undefined,
    true,
  );
  expect(output.isError, output.content[0].text).toBeUndefined();
  expect(JSON.parse(output.content[0].text)).toMatchObject({ ok: true, state: 'computed', sourceSaved: false });
  expect(mockFetch.mock.calls.filter(([, init]) => init?.method === 'PUT' || init?.method === 'DELETE')).toHaveLength(
    0,
  );
  expect(
    mockFetch.mock.calls.filter(([url, init]) => init?.method === 'POST' && new URL(String(url)).pathname === proposal),
  ).toHaveLength(1);
});

describe('captured A4H refactoring proposal types', () => {
  it('uses the complete native evaluation with exact concrete type, URI and empty declaration state', async () => {
    const s = setup();
    s.state.evaluation = nativeEvaluation;
    s.state.result = result(delta(`${sourceUri}#start=2,0;end=2,0`, 'DATA lv_missing TYPE i.'));
    expect(
      await s.run({ ...args, source: 'METHOD run.\nlv_missing = 1.\nENDMETHOD.', proposalUserContent: '' }),
    ).toMatchObject({
      ok: true,
      state: 'computed',
      sourceSaved: false,
      deltas: [{ content: 'DATA lv_missing TYPE i.' }],
    });
    expect(posts()).toHaveLength(2);
    expect(applications()).toHaveLength(1);
    expect(applications()[0][1].body).toContain('<userContent></userContent>');
    expect(applications()[0][1].body).toContain('lv_missing = 1.');
    expect(mockFetch.mock.calls.every(([, o]) => ['GET', 'HEAD', 'POST'].includes(o.method))).toBe(true);
  });
  it.each([
    ['foreign provider', (x: string) => x.replaceAll('/providers/refactoring/', '/providers/foreign/')],
    [
      'mismatched identifier',
      (x: string) => x.replace('adtcore:type="declare_local_variable"', 'adtcore:type="use_similar_local_variable"'),
    ],
    ['unsupported identifier', (x: string) => x.replaceAll('declare_local_variable', 'unknown_concrete_fix')],
    ['missing type', (x: string) => x.replace('adtcore:type="declare_local_variable"', '')],
    ['wrong native namespace', (x: string) => x.replaceAll('http://www.sap.com/adt/core', 'urn:foreign')],
    [
      'query-bearing URI',
      (x: string) => x.replace('/quickfixes/declare_local_variable', '/quickfixes/declare_local_variable?other=1'),
    ],
  ] as const)('refuses %s before proposal dispatch', async (_label, rewrite) => {
    const s = setup();
    s.state.evaluation = rewrite(nativeEvaluation);
    expect(await s.run({ ...args, proposalUserContent: '' })).toMatchObject({ ok: false });
    expect(posts()).toHaveLength(1);
    expect(applications()).toHaveLength(0);
  });
  it('still refuses an unexpected caller state against the captured empty native declaration state', async () => {
    const s = setup();
    s.state.evaluation = nativeEvaluation;
    expect(await s.run({ ...args, proposalUserContent: 'stale' })).toMatchObject({ ok: false });
    expect(applications()).toHaveLength(0);
  });
});
