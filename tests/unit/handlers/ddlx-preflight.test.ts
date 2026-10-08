import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { featuresOff } from './handler-test-config.js';
import { createClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { resetCachedFeatures, setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const source = `@Metadata.layer: #CUSTOMER
@UI.headerInfo: { typeName: 'Item', typeNamePlural: 'Items' }
@Search.searchable: true
annotate view ZI_ITEM with {
  @UI.lineItem: [{ position: 10, label: 'Changed label' }]
  @Search.defaultSearchElement: true
  Item;
}`;

describe('DDLX supported annotations through SAPWrite (#941)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetCachedFeatures();
    // RAP preflight uses the probed release, not config.abapRelease (the lint override).
    setCachedFeatures({ ...featuresOff(), systemType: 'onprem', abapRelease: '758' });
    mockFetch.mockImplementation((url) =>
      Promise.resolve(
        mockResponse(
          200,
          String(url).includes('_action=LOCK')
            ? '<asx:values><LOCK_HANDLE>L1</LOCK_HANDLE><CORRNR></CORRNR></asx:values>'
            : '',
          { 'x-csrf-token': 'T' },
        ),
      ),
    );
  });

  afterEach(() => resetCachedFeatures());

  it.each(['create', 'update', 'batch_create'])(
    '%s writes supported annotations with default preflight on probed 758',
    async (action) => {
      const object = { type: 'DDLX', name: 'ZX_ITEM', package: '$TMP', source };
      const args = action === 'batch_create' ? { action, objects: [object] } : { action, ...object };
      const result = await handleToolCall(
        createClient(),
        { ...DEFAULT_CONFIG, systemType: 'onprem' },
        'SAPWrite',
        args,
      );
      expect(result.isError).not.toBe(true);
      const put = mockFetch.mock.calls.find(([, options]) => options?.method === 'PUT');
      expect(put?.[1].body).toBe(source);
    },
  );
});
