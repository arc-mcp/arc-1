import { describe, expect, it } from 'vitest';
import { AdtApiError, AdtNetworkError } from '../../../src/adt/errors.js';
import { classifyMultiTargetSapError, handleToolCall } from '../../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

describe('multi-target SAP error contract', () => {
  it('treats a 401 as retryable SAP authentication failure', () => {
    const result = classifyMultiTargetSapError(
      new AdtApiError('Unauthorized', 401, '/sap/bc/adt/core/discovery', 'Unauthorized'),
      'A4H/100',
      'SAPRead',
    );
    expect(result).toMatchObject({ code: 'SAP_AUTHENTICATION_FAILED', event: 'sap_authentication_failed' });
    expect(result?.message).toContain('try again now');
  });

  it('does not overclaim user authorization from an ambiguous 403', () => {
    const result = classifyMultiTargetSapError(
      new AdtApiError('Forbidden', 403, '/sap/bc/adt/core/discovery', 'Forbidden'),
      'A4H/100',
      'SAPRead',
    );
    expect(result).toMatchObject({ code: 'SAP_AUTHENTICATION_FAILED', event: 'sap_authentication_failed' });
  });

  it('reports authorization only for a structured SAP authorization refusal', () => {
    const body =
      '<exc:exception><type id="ExceptionNotAuthorized"/>' +
      '<localizedMessage>No authorization for S_DEVELOP</localizedMessage></exc:exception>';
    const result = classifyMultiTargetSapError(
      new AdtApiError('Forbidden', 403, '/sap/bc/adt/repository/informationsystem/search', body),
      'A4H/100',
      'SAPSearch',
    );
    expect(result).toMatchObject({ code: 'SAP_AUTHORIZATION_DENIED', event: 'sap_authorization_failed' });
  });

  it('distinguishes an inactive ICF service from authentication', () => {
    const body = '<html><head><title>Service cannot be reached</title></head><body>inactive</body></html>';
    const result = classifyMultiTargetSapError(
      new AdtApiError('Forbidden', 403, '/sap/bc/adt/repository/informationsystem/search', body),
      'A4H/100',
      'SAPSearch',
    );
    expect(result).toMatchObject({ code: 'SAP_SERVICE_INACTIVE', event: 'sap_authentication_failed' });
  });

  it('returns a target-aware retryable classification for network failures', () => {
    const result = classifyMultiTargetSapError(new AdtNetworkError('connect ETIMEDOUT'), 'A4H/100', 'SAPRead');
    expect(result).toMatchObject({ code: 'SAP_REQUEST_FAILED' });
    expect(result?.event).toBeUndefined();
    expect(result?.message).toContain('A4H/100');
  });

  it('returns a target-aware classification for SAP 5xx responses', () => {
    const result = classifyMultiTargetSapError(
      new AdtApiError('Internal Server Error', 503, '/sap/bc/adt/core/discovery', 'Internal Server Error'),
      'A4H/100',
      'SAPRead',
    );
    expect(result).toMatchObject({ code: 'SAP_REQUEST_FAILED' });
    expect(result?.event).toBeUndefined();
    expect(result?.message).toContain('A4H/100');
  });

  it.each([
    ['network', new AdtNetworkError('secret-network-sentinel')],
    [
      'backend',
      new AdtApiError('secret-backend-sentinel', 500, '/sap/bc/adt/core/discovery', 'secret-backend-body-sentinel'),
    ],
  ])('returns a safe structured envelope for a full %s dispatch failure', async (_kind, failure) => {
    const client = {
      getSystemInfo: async () => {
        throw failure;
      },
    };
    const result = await handleToolCall(
      client as never,
      { ...DEFAULT_CONFIG, targetId: 'A4H/100', minimalErrors: true },
      'SAPRead',
      { type: 'SYSTEM' },
      undefined,
      undefined,
      undefined,
      true,
      undefined,
      'REQ-STRUCTURED-FAILURE',
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload).toMatchObject({
      error: 'SAP_REQUEST_FAILED',
      target: 'A4H/100',
      requestId: 'REQ-STRUCTURED-FAILURE',
      retryable: true,
    });
    expect(JSON.stringify(payload)).not.toContain('secret-network-sentinel');
    expect(JSON.stringify(payload)).not.toContain('secret-backend-sentinel');
    expect(JSON.stringify(payload)).not.toContain('secret-backend-body-sentinel');
  });
});
