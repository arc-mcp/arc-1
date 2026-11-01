/**
 * SAPRead data preview filters end to end: a filter the requested type would ignore is refused
 * before any SAP request, and a DDIC preview that refuses a condition-only sqlFilter gets a hint
 * that leads to TABLE_QUERY instead of repeating the condition-only shape.
 *
 * The undici mock + AdtClient + createClient live in ./setup-undici-mock.ts — import that helper
 * and keep all other src-module imports dynamic (see its header for the ordering rules).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

describe('SAPRead data preview filters', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it.each([
    ['TABLE_QUERY', { sqlFilter: "MANDT = '100'" }],
    ['TABLE_CONTENTS', { where: [{ field: 'MANDT', op: '=', value: '100' }] }],
    ['TABLE_CONTENTS', { columns: ['MANDT'] }],
  ])('refuses a %s filter it would ignore before any request is sent', async (type, filter) => {
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type,
      name: 'T000',
      maxRows: 5,
      ...filter,
    });
    expect(result.isError).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('points to TABLE_QUERY when the DDIC preview refuses a condition-only sqlFilter', async () => {
    // Live 758 and 816 answer every condition-only body this way; repeating the condition-only
    // shape hint would loop the caller.
    mockFetch.mockRejectedValueOnce(
      new AdtApiError(
        'Invalid query string. Only SELECT statement is allowed',
        400,
        '/sap/bc/adt/datapreview/ddic',
        'Invalid query string. Only SELECT statement is allowed',
      ),
    );
    const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPRead', {
      type: 'TABLE_CONTENTS',
      name: 'MARA',
      sqlFilter: "MANDT = '100'",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('does not accept a TABLE_CONTENTS sqlFilter');
    expect(result.content[0]?.text).toContain('TABLE_QUERY');
    expect(result.content[0]?.text).not.toContain('condition expression only');
  });
});
