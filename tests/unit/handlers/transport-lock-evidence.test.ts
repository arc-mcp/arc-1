import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const TASK_ONLY = '<LOCK_HOLDER><CTS_TASK_HEADER><TRKORR>DEVK900002</TRKORR></CTS_TASK_HEADER></LOCK_HOLDER>';
const CONFLICTING = ['DEVK900001', 'DEVK900003']
  .map((id) => `<LOCK_HOLDER><REQ_HEADER><TRKORR>${id}</TRKORR><AS4USER>DEV</AS4USER></REQ_HEADER></LOCK_HOLDER>`)
  .join('');
const info = (locks = '') =>
  `<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><DEVCLASS>ZPKG</DEVCLASS><RECORDING>X</RECORDING><RESULT>S</RESULT><LOCKS>${locks}</LOCKS></DATA></asx:values></asx:abap>`;

beforeEach(() => {
  vi.resetAllMocks();
  mockFetch.mockResolvedValue(mockResponse(200, '', { 'x-csrf-token': 'T' }));
});

it.each(['empty', 'denied'] as const)('does not claim no lock when package metadata is %s', async (kind) => {
  const client = createClient();
  const resolve = vi.spyOn(client, 'resolveObjectPackage');
  if (kind === 'empty') resolve.mockResolvedValue('');
  else resolve.mockRejectedValue(new Error('unavailable'));
  const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPTransport', {
    action: 'history',
    type: 'INTF',
    name: 'ZIF_TEST',
  });
  const history = JSON.parse(result.content[0].text);
  expect(history.lockStatusUnknown).toBe(true);
  expect(history.summary).toContain('could not be verified');
  expect(history.summary).not.toMatch(/no (active|current) lock/);
});

it.each([
  ['task-only', TASK_ONLY],
  ['conflicting', CONFLICTING],
])('does not present %s lock evidence as free or uniquely assigned', async (_kind, locks) => {
  mockFetch.mockImplementation(async (url: string) =>
    mockResponse(200, String(url).includes('/transportchecks') ? info(locks) : '', { 'x-csrf-token': 'T' }),
  );
  const client = createClient();
  vi.spyOn(client, 'resolveObjectPackage').mockResolvedValue('ZPKG');
  const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPTransport', {
    action: 'history',
    type: 'INTF',
    name: 'ZIF_TEST',
  });
  const history = JSON.parse(result.content[0].text);
  expect(history.lockStatusUnknown).toBe(true);
  expect(history).not.toHaveProperty('lockedTransport');
  const check = await handleToolCall(client, DEFAULT_CONFIG, 'SAPTransport', {
    action: 'check',
    type: 'INTF',
    name: 'ZIF_TEST',
    package: 'ZPKG',
    operation: 'modify',
  });
  expect(check.isError).toBe(true);
  expect(check.content[0].text).toContain('ambiguous CTS lock holders');
});

it('reports a failed transportchecks fallback as unverified', async () => {
  mockFetch.mockImplementation(async (url: string) =>
    mockResponse(String(url).includes('/transportchecks') ? 403 : 200, '', { 'x-csrf-token': 'T' }),
  );
  const client = createClient();
  vi.spyOn(client, 'resolveObjectPackage').mockResolvedValue('ZPKG');
  const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPTransport', {
    action: 'history',
    type: 'INTF',
    name: 'ZIF_TEST',
  });
  expect(JSON.parse(result.content[0].text).lockStatusUnknown).toBe(true);
});

it('does not guess standalone ownership from a repository miss', async () => {
  const client = createClient();
  vi.spyOn(client, 'lookupObjects').mockResolvedValue([{ name: 'ZINCLUDE', found: false, matches: [] }]);
  vi.spyOn(client, 'resolveObjectPackage').mockResolvedValue('$TMP');
  const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPTransport', {
    action: 'history',
    type: 'INCL',
    name: 'ZINCLUDE',
  });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('Provide "group" explicitly');
  expect(mockFetch).not.toHaveBeenCalled();
});

it('allows a new include name in a create check', async () => {
  const client = createClient();
  vi.spyOn(client, 'lookupObjects').mockResolvedValue([{ name: 'ZINCLUDE', found: false, matches: [] }]);
  mockFetch.mockResolvedValue(mockResponse(200, info(), { 'x-csrf-token': 'T' }));
  const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPTransport', {
    action: 'check',
    type: 'INCL',
    name: 'ZINCLUDE',
    package: 'ZPKG',
    operation: 'create',
  });
  expect(result.isError).toBeUndefined();
  expect(JSON.parse(result.content[0].text).transportAssignmentRequired).toBe(true);
});

it('resolves an exact namespaced function-group include', async () => {
  const client = createClient();
  vi.spyOn(client, 'lookupObjects').mockResolvedValue([
    {
      name: '/TEST/LTOP',
      found: true,
      matches: [
        {
          objectName: '/TEST/LTOP',
          objectType: 'FUGR/I',
          description: '',
          packageName: '$TMP',
          uri: '/sap/bc/adt/functions/groups/%2ftest%2fgroup/includes/%2ftest%2fltop',
        },
      ],
    },
  ]);
  vi.spyOn(client, 'resolveObjectPackage').mockResolvedValue('$TMP');
  const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPTransport', {
    action: 'history',
    type: 'INCL',
    name: '/TEST/LTOP',
  });
  expect(result.isError).toBeUndefined();
  expect(JSON.parse(result.content[0].text).object.uri).toBe(
    '/sap/bc/adt/functions/groups/%2Ftest%2Fgroup/includes/%2Ftest%2Fltop',
  );
});

it('does not choose a group from conflicting exact lookup hits', async () => {
  const client = createClient();
  vi.spyOn(client, 'lookupObjects').mockResolvedValue([
    {
      name: 'LZTOP',
      found: true,
      matches: ['ZFIRST', 'ZSECOND'].map((group) => ({
        objectName: 'LZTOP',
        objectType: 'FUGR/I',
        description: '',
        packageName: '$TMP',
        uri: `/sap/bc/adt/functions/groups/${group}/includes/LZTOP`,
      })),
    },
  ]);
  const result = await handleToolCall(client, DEFAULT_CONFIG, 'SAPTransport', {
    action: 'history',
    type: 'INCL',
    name: 'LZTOP',
  });
  expect(result.isError).toBe(true);
  expect(mockFetch).not.toHaveBeenCalled();
});
