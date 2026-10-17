import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

describe('KTD creation without a parent description', () => {
  beforeEach(() => mockFetch.mockReset());

  // SAP's SADT_OBJECT_REFERENCE reads adtcore:description under check="not-initial(...)":
  // an empty attribute fails with "Check of condition failed", an absent one is skipped.
  it.each([
    ['omitted', undefined],
    ['blank', '   '],
  ])(
    'SKTD create sends no description attribute when the parent description is %s',
    async (_label, refObjectDescription) => {
      const posts: string[] = [];
      mockFetch.mockImplementation((_url: string | URL, opts?: { method?: string; body?: string | Buffer }) => {
        if (opts?.method === 'POST' && opts.body) posts.push(String(opts.body));
        return Promise.resolve(mockResponse(201, '<sktd:docu/>', { 'x-csrf-token': 'T' }));
      });

      const result = await handleToolCall(createClient(), DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'SKTD',
        name: 'ZUI_TRAVEL_O4',
        package: '$TMP',
        refObjectType: 'SRVD/SRV',
        ...(refObjectDescription === undefined ? {} : { refObjectDescription }),
      });

      expect(result.isError).toBeUndefined();
      const body = posts.find((b) => b.includes('<sktd:docu'));
      expect(body).toContain('<sktd:refObject adtcore:name="ZUI_TRAVEL_O4" adtcore:type="SRVD/SRV"');
      expect(body).not.toContain('adtcore:description');
    },
  );
});
