import { describe, expect, it } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');

describe('metadata update package', () => {
  it('puts the real package of the object in the update body, not the caller package', async () => {
    const lockBody =
      '<asx:abap xmlns:asx="http://www.sap.com/abapxml"><asx:values><DATA><LOCK_HANDLE>H1</LOCK_HANDLE><CORRNR></CORRNR><IS_LOCAL>X</IS_LOCAL></DATA></asx:values></asx:abap>';
    let putBody = '';
    mockFetch.mockReset();
    mockFetch.mockImplementation((url: string | URL, opts?: { method?: string; body?: unknown }) => {
      const method = opts?.method ?? 'GET';
      if (method === 'PUT') putBody = String(opts?.body);
      if (method === 'POST' && String(url).includes('_action=LOCK'))
        return Promise.resolve(mockResponse(200, lockBody, { 'x-csrf-token': 'T' }));
      return Promise.resolve(
        mockResponse(
          200,
          '<doma:domain xmlns:doma="http://www.sap.com/dictionary/domain" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="ZDOMAIN"><adtcore:packageRef adtcore:name="ZREAL"/></doma:domain>',
          { 'x-csrf-token': 'T' },
        ),
      );
    });

    const restricted = new AdtClient({
      baseUrl: 'http://sap:8000',
      username: 'admin',
      password: 'secret',
      safety: { ...unrestrictedSafetyConfig(), allowedPackages: ['ZREAL'] },
    });
    const result = await handleToolCall(restricted, DEFAULT_CONFIG, 'SAPWrite', {
      action: 'update',
      type: 'DOMA',
      name: 'ZDOMAIN',
      package: 'ZOTHER',
      dataType: 'CHAR',
      length: 1,
    });

    expect(result.isError, result.content[0]?.text).toBeUndefined();
    expect(putBody).toContain('adtcore:name="ZREAL"');
    expect(putBody).not.toContain('ZOTHER');
  });
});
