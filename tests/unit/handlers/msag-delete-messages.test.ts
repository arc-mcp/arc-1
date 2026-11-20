import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { sanitizeArgs } = await import('../../../src/server/audit.js');
const write = (args: Record<string, unknown>) =>
  handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
    action: 'update',
    type: 'MSAG',
    name: 'ZMSG',
    deleteMessages: ['2'],
    ...args,
  });

function mockClass(savedNumber = '001', savedName = 'ZMSG') {
  let written = false;
  const operations: string[] = [];
  const bodies: string[] = [];
  mockFetch.mockImplementation(async (url, opts) => {
    const path = new URL(url);
    let body = '';
    if (path.searchParams.get('_action') === 'LOCK') {
      operations.push('lock');
      body = '<asx:values><LOCK_HANDLE>LH</LOCK_HANDLE></asx:values>';
    } else if (path.searchParams.get('_action') === 'UNLOCK') {
      operations.push('unlock');
    } else if (opts.method === 'PUT') {
      operations.push('put');
      written = true;
      bodies.push(String(opts.body));
    } else if (path.pathname.endsWith('/messageclass/ZMSG')) {
      operations.push('read');
      const numbers = written ? [savedNumber] : ['001', '002'];
      body = `<mc:messageClass adtcore:name="${written ? savedName : 'ZMSG'}"><adtcore:packageRef adtcore:name="$TMP"/>${numbers.map((n) => `<mc:messages mc:msgno="${n}" mc:msgtext="Original"/>`).join('')}</mc:messageClass>`;
    }
    return mockResponse(200, body, { 'x-csrf-token': 'T' });
  });
  return { operations, bodies };
}

describe('MSAG deleteMessages', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([
    { action: 'create' },
    { action: 'delete' },
    { type: 'DOMA' },
    { action: 'batch_create', objects: [{ type: 'MSAG', name: 'ZMSG' }] },
    {
      action: 'batch_create',
      deleteMessages: undefined,
      objects: [{ type: 'MSAG', name: 'ZMSG', deleteMessages: ['2'] }],
    },
  ])('refuses $action/$type before any SAP call', async (args) => {
    const result = await write(args);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('nothing was changed');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects more than 1000 deletion entries before any SAP call', async () => {
    const result = await write({ deleteMessages: Array(1001).fill('001') });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('1000');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each(['', '0001', 'A', 2])('refuses invalid deletion number %j', async (value) => {
    const result = await write({ deleteMessages: [value] });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('deleteMessages.0');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ messages: [{ number: '02', shortText: 'New' }] }, 'both messages and deleteMessages'],
    [{ deleteMessages: ['002', '3'] }, '003 does not exist'],
  ] as const)('refuses the entire update before PUT', async (args, reason) => {
    const { operations } = mockClass();
    const result = await write(args);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(reason);
    expect(result.content[0].text).toContain('nothing was changed');
    expect(operations).not.toContain('put');
    expect(operations.at(-1)).toBe('unlock');
  });

  it.each([
    undefined,
    [
      { number: '001', shortText: '' },
      { number: '003', shortText: 'New' },
    ],
  ])('orders all retained or changed messages before deletions and verifies once under lock', async (messages) => {
    const { operations, bodies } = mockClass();
    const args = { messages, deleteMessages: ['2', '002'] };
    const result = await write(args);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('Deleted messages: 002.');
    expect(operations.slice(operations.indexOf('lock'))).toEqual(['lock', 'read', 'put', 'read', 'unlock']);
    const body = bodies[0]!;
    expect(body).toContain(`<mc:messages mc:msgno="001" mc:msgtext="${messages ? '' : 'Original'}"`);
    if (messages) expect(body).toContain('<mc:messages mc:msgno="003" mc:msgtext="New"');
    expect(body).not.toContain('<mc:messages mc:msgno="002"');
    expect(body.match(/<mc:deletedmessages mc:msgno="002"\/>/g)).toHaveLength(1);
    expect(body.lastIndexOf('<mc:messages ')).toBeLessThan(body.indexOf('<mc:deletedmessages'));
    expect(sanitizeArgs(args).deleteMessages).toEqual(['2', '002']);
  });

  it.each([
    ['002', 'ZMSG', '002 are still present'],
    ['001', '', 'could not verify'],
  ])('reports an unverified deletion after save and unlocks', async (number, name, reason) => {
    const { operations } = mockClass(number, name);
    const result = await write({});
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain(reason);
    expect(operations.slice(-3)).toEqual(['put', 'read', 'unlock']);
  });
});
