import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { executePrivatePinnedQuickfix } = await import('../../../src/handlers/pinned-quickfix.js');
const { applyFixProposal } = await import('../../../src/adt/quickfix.js');
const native = readFileSync(new URL('../../fixtures/quickfix/a4h-native-proposal-result.xml', import.meta.url), 'utf8');
const proposal = '/sap/bc/adt/quickfixes/proposals/providers/refactoring/quickfixes/declare_local_variable';
const owner = '/sap/bc/adt/oo/classes/zcl_test',
  sourceUri = owner + '/source/main';
const source = `CLASS zcl_test DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.
CLASS zcl_test IMPLEMENTATION.
  METHOD run.
    DATA lv_existing TYPE i.
    lv_missing = 1.
  ENDMETHOD.
ENDCLASS.`;
const core = 'http://www.sap.com/adt/core';
const config = {
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
const input = {
  action: 'apply_quickfix',
  type: 'CLAS',
  name: 'ZCL_TEST',
  sourceUri,
  source,
  line: 8,
  column: 4,
  proposalUri: proposal,
  proposalUserContent: '',
};
function setup(xml = native) {
  const client = new AdtClient({
    baseUrl: 'https://sap.test',
    client: '001',
    safety: config,
    bearerTokenProvider: async () => 'mapped-token',
  });
  mockFetch.mockImplementation(async (url, options) => {
    const path = new URL(String(url)).pathname;
    if (options.method === 'HEAD' || path === '/sap/bc/adt/discovery')
      return mockResponse(200, '', { 'x-csrf-token': 'csrf' });
    if (options.method === 'GET' && path === owner)
      return mockResponse(
        200,
        `<c:abapClass xmlns:c="http://www.sap.com/adt/oo/classes" xmlns:a="${core}" a:name="ZCL_TEST" a:type="CLAS/OC"/>`,
      );
    if (options.method === 'POST' && path === '/sap/bc/adt/quickfixes/evaluation')
      return mockResponse(
        200,
        `<q:evaluationResults xmlns:q="http://www.sap.com/adt/quickfixes" xmlns:a="${core}"><evaluationResult><a:objectReference a:uri="${proposal}" a:type="declare_local_variable"/><userContent/></evaluationResult></q:evaluationResults>`,
      );
    if (options.method === 'POST' && path === proposal) return mockResponse(200, xml);
    throw new Error('Unexpected request ' + options.method + ' ' + path);
  });
  const run = async () =>
    JSON.parse(
      ((await executePrivatePinnedQuickfix(client, input, config, ['read', 'write'])).content[0] as { text: string })
        .text,
    );
  return { client, run };
}
const applications = () =>
  mockFetch.mock.calls.filter(([url, o]) => o.method === 'POST' && String(url) === 'https://sap.test' + proposal);
function onlyComputation() {
  expect(applications()).toHaveLength(1);
  expect(
    mockFetch.mock.calls.every(
      ([url, o]) =>
        ['GET', 'HEAD'].includes(o.method) ||
        (o.method === 'POST' &&
          [proposal, '/sap/bc/adt/quickfixes/evaluation'].includes(new URL(String(url)).pathname)),
    ),
  ).toBe(true);
}
beforeEach(() => vi.resetAllMocks());
it.each([
  ['captured empty state envelope and display label', native],
  ['display label without state envelope', native.replace(/<variableSourceStates>.*<\/variableSourceStates>/, '')],
  ['empty state envelope with historical owner name', native.replace('Insert variable definition', 'ZCL_TEST')],
  ['namespace aliases', native.replaceAll('adtcore:', 'c:').replaceAll('xmlns:adtcore=', 'xmlns:c=')],
  ['label carries no target authority', native.replace('Insert variable definition', 'ZCL_OTHER')],
])('returns native replacement deltas: %s', async (_label, xml) => {
  const s = setup(xml),
    out = await s.run();
  expect(out).toMatchObject({
    ok: true,
    state: 'computed',
    sourceSaved: false,
    deltas: [
      {
        uri: sourceUri + '#start=7,4;end=7,28',
        range: { start: { line: 7, column: 4 }, end: { line: 7, column: 28 } },
        content: 'DATA lv_existing TYPE i.\n    DATA: lv_missing TYPE i.',
      },
    ],
  });
  expect(out.deltas[0]).not.toHaveProperty('name');
  onlyComputation();
});
it.each([
  native.replace(
    '<adtcore:objectReferences xmlns:adtcore="' + core + '"/>',
    '<adtcore:objectReferences xmlns:adtcore="' +
      core +
      '"><adtcore:objectReference adtcore:uri="' +
      sourceUri +
      '"/></adtcore:objectReferences>',
  ),
  native.replace('<variableSourceStates>', '<variableSourceStates extra="yes">'),
  native.replace('<variableSourceStates>', '<variableSourceStates xmlns="urn:foreign">'),
  native.replace('objectReferences xmlns:adtcore="' + core + '"', 'objectReferences xmlns:adtcore="urn:foreign"'),
  native.replace('</variableSourceStates>', '<unknown/></variableSourceStates>'),
  native.replace(
    '</qf:proposalResult>',
    '<variableSourceStates><adtcore:objectReferences xmlns:adtcore="' +
      core +
      '"/></variableSourceStates></qf:proposalResult>',
  ),
  native.replace('<adtcore:objectReferences xmlns:adtcore="' + core + '"/>', ''),
  native.replace(
    '<adtcore:objectReferences xmlns:adtcore="' + core + '"/>',
    '<adtcore:objectReferences xmlns:adtcore="' + core + '" state="unknown"/>',
  ),
  native.replace(
    '<adtcore:objectReferences xmlns:adtcore="' + core + '"/>',
    '<adtcore:objectReferences xmlns:adtcore="' + core + '">unknown</adtcore:objectReferences>',
  ),
  native.replace('zcl_test/source', 'zcl_other/source'),
  native.replace('CLAS/OC', 'INTF/OI'),
  native.replace('#start=7,4;end=7,28', '#start=7,4;end=7,29'),
  native.replace('#start=7,4;end=7,28', '#start=7,28;end=7,4'),
  native.replace('zcl_test/source/main', 'zcl_test/source/../main'),
  native.replace('zcl_test/source/main', 'zcl_test/source/main?version=active'),
  native.replace('<content>', '<content><unknown/>'),
])('refuses unknown state/foreign identity/unsafe range after one application %#', async (xml) => {
  const out = await setup(xml).run();
  expect(out).toMatchObject({ ok: false, state: 'computation-unverified', sourceSaved: false });
  onlyComputation();
});
it('leaves the ordinary single-target result contract compatible', async () => {
  const s = setup();
  const deltas = await applyFixProposal(
    s.client.http,
    { ...s.client.safety, multiTargetWrite: undefined },
    { uri: proposal, type: 'quickfix/proposal', name: '', description: '', userContent: '' },
    sourceUri,
    source,
    8,
    4,
  );
  expect(deltas).toMatchObject([
    {
      content: 'DATA lv_existing TYPE i.\n    DATA: lv_missing TYPE i.',
      range: { start: { line: 7, column: 4 }, end: { line: 7, column: 28 } },
    },
  ]);
  onlyComputation();
});
