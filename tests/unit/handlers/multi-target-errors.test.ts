import { describe, expect, it } from 'vitest';
import { AdtApiError } from '../../../src/adt/errors.js';
import { classifyMultiTargetSapError } from '../../../src/handlers/dispatch.js';

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
});
