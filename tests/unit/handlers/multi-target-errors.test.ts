import { describe, expect, it, vi } from 'vitest';
import { AdtApiError, AdtNetworkError } from '../../../src/adt/errors.js';
import { classifyMultiTargetSapError, handleToolCall } from '../../../src/handlers/dispatch.js';
import { logger } from '../../../src/server/logger.js';
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

  it('describes shared Basic authentication failures without blaming the human caller', () => {
    const result = classifyMultiTargetSapError(
      new AdtApiError('Unauthorized', 401, '/sap/bc/adt/core/discovery', 'secret-auth-body'),
      'A4H/100',
      'SAPRead',
      'shared',
    );

    expect(result).toMatchObject({
      code: 'SAP_AUTHENTICATION_FAILED',
      event: 'sap_authentication_failed',
      retryable: false,
    });
    expect(result?.message).toContain('shared technical credentials');
    expect(result?.message).toContain('15 minutes');
    expect(result?.message).not.toContain('propagated user');
    expect(result?.message).not.toContain('secret-auth-body');
  });

  it('does not overclaim user authorization from an ambiguous 403', () => {
    const result = classifyMultiTargetSapError(
      new AdtApiError('Forbidden', 403, '/sap/bc/adt/core/discovery', 'Forbidden'),
      'A4H/100',
      'SAPRead',
    );
    expect(result).toMatchObject({ code: 'SAP_AUTHENTICATION_FAILED', event: 'sap_authentication_failed' });
  });

  it('does not claim or cache shared credential rejection from an ambiguous 403', () => {
    const result = classifyMultiTargetSapError(
      new AdtApiError('Forbidden', 403, '/sap/bc/adt/core/discovery', 'Forbidden'),
      'A4H/100',
      'SAPRead',
      'shared',
    );
    expect(result).toMatchObject({ code: 'SAP_REQUEST_FAILED', retryable: true });
    expect(result?.event).toBeUndefined();
    expect(result?.message).toContain('did not treat it as a rejected shared credential generation');
    expect(result?.message).toContain('Do not retry automatically');
  });

  it('distinguishes the verified Cloud Connector exposure denial from SAP authentication', () => {
    const body =
      'Access denied to system npl.example.internal:80. In case this was a valid request, ' +
      'ensure to expose the system correctly in your cloud connector.';
    const result = classifyMultiTargetSapError(
      new AdtApiError('Forbidden', 403, '/sap/bc/adt/core/discovery', body),
      'NPL/001',
      'SAPRead',
    );
    expect(result).toMatchObject({
      code: 'CLOUD_CONNECTOR_ACCESS_DENIED',
      event: 'cloud_connector_access_denied',
    });
    expect(result?.message).toContain('NPL/001');
    expect(result?.message).toContain('Do not retry automatically');
    expect(result?.message).toContain('only after the administrator confirms the repair');
    expect(result?.message).not.toContain('npl.example.internal');
  });

  it('uses Basic-specific Cloud Connector remediation for a shared target', () => {
    const body =
      'Access denied to system npl.example.internal:80. In case this was a valid request, ' +
      'ensure to expose the system correctly in your cloud connector.';
    const result = classifyMultiTargetSapError(
      new AdtApiError('Forbidden', 403, '/sap/bc/adt/core/discovery', body),
      'NPL/001',
      'SAPRead',
      'shared',
    );
    expect(result).toMatchObject({ code: 'CLOUD_CONNECTOR_ACCESS_DENIED' });
    expect(result?.message).toContain('Basic OnPremise mapping');
    expect(result?.message).not.toContain('X.509');
  });

  it('does not classify a near-match or non-403 response as a Cloud Connector exposure denial', () => {
    const body =
      'Access denied to system example.internal:80. In case this was a valid request, ' +
      'ensure to expose the system correctly in your cloud connector.';
    const wrongStatus = classifyMultiTargetSapError(
      new AdtApiError('Unauthorized', 401, '/sap/bc/adt/core/discovery', body),
      'A4H/100',
      'SAPRead',
    );
    const nearMatch = classifyMultiTargetSapError(
      new AdtApiError('Forbidden', 403, '/sap/bc/adt/core/discovery', 'Access denied by policy'),
      'A4H/100',
      'SAPRead',
    );
    expect(wrongStatus).toMatchObject({ code: 'SAP_AUTHENTICATION_FAILED' });
    expect(nearMatch).toMatchObject({ code: 'SAP_AUTHENTICATION_FAILED' });
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
    expect(result).toMatchObject({ code: 'SAP_SERVICE_INACTIVE', event: 'sap_service_unavailable' });
    expect(result?.message).toContain('Do not retry automatically');
    expect(result?.message).toContain('only after the administrator confirms the repair');
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

  it('returns a sanitized structured envelope for a Cloud Connector exposure denial', async () => {
    const auditSpy = vi.spyOn(logger, 'emitAudit').mockImplementation(() => undefined);
    const responseBody =
      'Access denied to system npl.example.internal:80. In case this was a valid request, ' +
      'ensure to expose the system correctly in your cloud connector.';
    const client = {
      getSystemInfo: async () => {
        throw new AdtApiError('Forbidden', 403, '/sap/bc/adt/core/discovery', responseBody);
      },
    };
    const result = await handleToolCall(
      client as never,
      { ...DEFAULT_CONFIG, targetId: 'NPL/001', minimalErrors: true },
      'SAPRead',
      { type: 'SYSTEM' },
      undefined,
      undefined,
      undefined,
      true,
      undefined,
      'REQ-CLOUD-CONNECTOR-DENIAL',
    );
    const payload = JSON.parse(result.content[0]?.text ?? '{}');
    expect(payload).toMatchObject({
      error: 'CLOUD_CONNECTOR_ACCESS_DENIED',
      target: 'NPL/001',
      requestId: 'REQ-CLOUD-CONNECTOR-DENIAL',
      retryable: true,
    });
    expect(payload.message).toContain('Cloud Connector');
    expect(JSON.stringify(payload)).not.toContain('npl.example.internal');
    expect(JSON.stringify(payload)).not.toContain('Access denied to system');
    expect(auditSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'cloud_connector_access_denied',
        target: 'NPL/001',
        requestId: 'REQ-CLOUD-CONNECTOR-DENIAL',
        errorCode: 'CLOUD_CONNECTOR_ACCESS_DENIED',
      }),
    );
    auditSpy.mockRestore();
  });

  it('audits an inactive SAP service as unavailable rather than an authentication failure', async () => {
    const auditSpy = vi.spyOn(logger, 'emitAudit').mockImplementation(() => undefined);
    const client = {
      getSystemInfo: async () => {
        throw new AdtApiError(
          'Forbidden',
          403,
          '/sap/bc/adt/core/discovery',
          '<html><head><title>Service cannot be reached</title></head><body>inactive</body></html>',
        );
      },
    };

    try {
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
        'REQ-SERVICE-INACTIVE',
      );
      const payload = JSON.parse(result.content[0]?.text ?? '{}');
      expect(payload).toMatchObject({
        error: 'SAP_SERVICE_INACTIVE',
        target: 'A4H/100',
        requestId: 'REQ-SERVICE-INACTIVE',
        retryable: true,
      });
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'sap_service_unavailable',
          target: 'A4H/100',
          requestId: 'REQ-SERVICE-INACTIVE',
          errorCode: 'SAP_SERVICE_INACTIVE',
        }),
      );
    } finally {
      auditSpy.mockRestore();
    }
  });
});
