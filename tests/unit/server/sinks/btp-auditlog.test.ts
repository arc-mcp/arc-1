import { XsuaaService } from '@sap/xssec';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEvent } from '../../../../src/server/audit.js';
import { BTPAuditLogSink, parseBTPAuditLogConfig } from '../../../../src/server/sinks/btp-auditlog.js';

describe('BTP Audit Log Sink', () => {
  describe('parseBTPAuditLogConfig', () => {
    const originalEnv = process.env.VCAP_SERVICES;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.VCAP_SERVICES;
      } else {
        process.env.VCAP_SERVICES = originalEnv;
      }
    });

    it('returns undefined when VCAP_SERVICES is not set', () => {
      delete process.env.VCAP_SERVICES;
      expect(parseBTPAuditLogConfig()).toBeUndefined();
    });

    it('returns undefined when no auditlog binding exists', () => {
      process.env.VCAP_SERVICES = JSON.stringify({ xsuaa: [] });
      expect(parseBTPAuditLogConfig()).toBeUndefined();
    });

    const credentials = {
      url: 'https://api.auditlog.cf.example.com:6081',
      uaa: {
        certurl: 'https://sub.auth.cert.example.com',
        clientid: 'my-client-id',
        certificate: '-----BEGIN CERT-----',
        key: '-----BEGIN KEY-----',
      },
    };

    it.each([
      ['auditlog', 'premium'],
      ['auditlog-api', 'oauth2'],
    ])('parses %s/%s and excludes client secrets from the token client config', (label, plan) => {
      process.env.VCAP_SERVICES = JSON.stringify({
        [label]: [{ plan, credentials: { ...credentials, uaa: { ...credentials.uaa, clientsecret: 'ignored' } } }],
      });

      // xssec prefers client secrets when present, so only forward the X.509 credentials.
      expect(parseBTPAuditLogConfig()).toEqual(credentials);
    });

    it.each([undefined, '  ', 42])('rejects a missing, blank, or non-string private key (%s)', (key) => {
      process.env.VCAP_SERVICES = JSON.stringify({
        auditlog: [{ plan: 'premium', credentials: { ...credentials, uaa: { ...credentials.uaa, key } } }],
      });

      expect(() => parseBTPAuditLogConfig()).toThrow('missing required X.509 fields: uaa.key.');
    });

    it('rejects a selected binding without X.509 credentials', () => {
      process.env.VCAP_SERVICES = JSON.stringify({
        auditlog: [
          {
            plan: 'premium',
            credentials: {
              url: 'https://api.auditlog.cf.example.com:6081',
              uaa: {
                clientid: 'my-client-id',
                clientsecret: 'must-not-appear-in-error',
              },
            },
          },
        ],
      });

      expect(() => parseBTPAuditLogConfig()).toThrow(
        'BTP Audit Log binding is missing required X.509 fields: uaa.certurl, uaa.certificate, uaa.key',
      );
      expect(() => parseBTPAuditLogConfig()).not.toThrow(/must-not-appear-in-error/);
    });

    it('returns undefined for invalid JSON', () => {
      process.env.VCAP_SERVICES = 'not-json';
      expect(parseBTPAuditLogConfig()).toBeUndefined();
    });

    it('returns undefined when VCAP_SERVICES is not an object', () => {
      process.env.VCAP_SERVICES = 'null';
      expect(parseBTPAuditLogConfig()).toBeUndefined();
    });
  });

  describe('Event categorization', () => {
    let fetchSpy: ReturnType<typeof vi.fn>;
    let tokenSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Mock global fetch
      fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(''),
      });
      vi.stubGlobal('fetch', fetchSpy);
      tokenSpy = vi.spyOn(XsuaaService.prototype, 'getClientCredentialsToken').mockResolvedValue({
        access_token: 'test-token',
        expires_in: 3600,
        token_type: 'bearer',
      });
    });

    afterEach(() => {
      tokenSpy.mockRestore();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    const config = {
      url: 'https://api.auditlog.test:6081',
      uaa: {
        certurl: 'https://sub.auth.cert.test',
        clientid: 'test-client',
        certificate: 'cert',
        key: 'key',
      },
    };

    it('sends security events for auth_scope_denied', async () => {
      const sink = new BTPAuditLogSink(config);
      const event: AuditEvent = {
        timestamp: '',
        level: 'warn',
        event: 'auth_scope_denied',
        tool: 'SAPWrite',
        requiredScope: 'write',
        availableScopes: ['read'],
      };
      sink.write(event);
      await sink.flush();

      expect(tokenSpy).toHaveBeenCalledOnce();
      expect(fetchSpy).toHaveBeenCalledOnce();
      const auditCall = fetchSpy.mock.calls[0]!;
      expect(auditCall[0]).toContain('/security-events');
      expect(auditCall[1]?.headers).toMatchObject({ Authorization: 'Bearer test-token' });
      expect(JSON.parse(auditCall[1]!.body as string)).not.toHaveProperty('data_subject');
    });

    it('sends bounded data-response events without response or SQL bodies', async () => {
      const sink = new BTPAuditLogSink(config);
      sink.write({
        timestamp: '',
        level: 'warn',
        event: 'data_response_limited',
        tool: 'SAPQuery',
        requestId: 'REQ-1',
        limitBytes: 2_097_152,
        observedBytes: 2_097_153,
        endpointFamily: 'data-preview',
        queueWaitMs: 4,
      });
      await sink.flush();

      expect(fetchSpy).toHaveBeenCalledOnce();
      const auditCall = fetchSpy.mock.calls[0]!;
      expect(auditCall[0]).toContain('/security-events');
      const body = String(auditCall[1]?.body);
      expect(body).toContain('2097152 bytes');
      expect(body).not.toContain('SELECT');
      expect(body).not.toContain('responseBody');
    });

    it('attributes the calling agent on tool-call events', async () => {
      const sink = new BTPAuditLogSink(config);
      sink.write({
        timestamp: '',
        level: 'info',
        event: 'tool_call_start',
        tool: 'SAPRead',
        clientId: 'arc1-abc',
        clientAgent: 'claude-code/1.2.3',
        args: {},
      });
      await sink.flush();

      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      expect(body.attributes).toContainEqual({ name: 'clientAgent', new: 'claude-code/1.2.3' });
    });

    it('attributes the calling agent on security events (free-text data, not attributes)', async () => {
      const sink = new BTPAuditLogSink(config);
      sink.write({
        timestamp: '',
        level: 'warn',
        event: 'safety_blocked',
        operation: 'SAPWrite',
        reason: 'Action denied by SAP_DENY_ACTIONS',
        user: 'DEV1',
        clientAgent: 'cursor/0.44.1',
      });
      await sink.flush();

      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      expect(body.data).toContain('Agent: cursor/0.44.1.');
    });

    it('omits the agent suffix when no agent was resolved', async () => {
      const sink = new BTPAuditLogSink(config);
      sink.write({
        timestamp: '',
        level: 'warn',
        event: 'safety_blocked',
        operation: 'SAPWrite',
        reason: 'blocked',
        user: 'DEV1',
      });
      await sink.flush();

      const body = JSON.parse(fetchSpy.mock.calls[0]![1]!.body as string);
      expect(body.data).not.toContain('Agent:');
    });

    it('sends data-accesses for read tool calls', async () => {
      const sink = new BTPAuditLogSink(config);
      const event: AuditEvent = {
        timestamp: '',
        level: 'info',
        event: 'tool_call_end',
        tool: 'SAPRead',
        target: 'A4H/001',
        durationMs: 100,
        status: 'success',
      };
      sink.write(event);
      await sink.flush();

      const auditCall = fetchSpy.mock.calls[0]!;
      expect(auditCall[0]).toContain('/data-accesses');
      expect(JSON.parse(auditCall[1]!.body as string).data_subject).toEqual({
        type: 'sap-system',
        role: 'data-owner',
        id: { system: 'A4H/001' },
      });
    });

    it('sends data-modifications for write tool calls', async () => {
      const sink = new BTPAuditLogSink(config);
      const event: AuditEvent = {
        timestamp: '',
        level: 'info',
        event: 'tool_call_end',
        tool: 'SAPWrite',
        durationMs: 200,
        status: 'success',
      };
      sink.write(event);
      await sink.flush();

      const auditCall = fetchSpy.mock.calls[0]!;
      expect(auditCall[0]).toContain('/data-modifications');
      expect(JSON.parse(auditCall[1]!.body as string).data_subject).toEqual({
        type: 'sap-system',
        role: 'data-owner',
        id: { system: 'configured-target' },
      });
    });

    it('sends configuration-changes for transport tool calls', async () => {
      const sink = new BTPAuditLogSink(config);
      const event: AuditEvent = {
        timestamp: '',
        level: 'info',
        event: 'tool_call_end',
        tool: 'SAPTransport',
        durationMs: 300,
        status: 'success',
      };
      sink.write(event);
      await sink.flush();

      const auditCall = fetchSpy.mock.calls[0]!;
      expect(auditCall[0]).toContain('/configuration-changes');
      expect(JSON.parse(auditCall[1]!.body as string)).not.toHaveProperty('data_subject');
    });

    it('sends every multi-target failure stage with direct target attribution', async () => {
      const sink = new BTPAuditLogSink(config);
      const stages = [
        'target_resolution_failed',
        'pp_exchange_failed',
        'shared_auth_failed',
        'cloud_connector_access_denied',
        'sap_service_unavailable',
        'sap_authentication_failed',
        'sap_authorization_failed',
        'target_policy_denied',
      ] as const;
      for (const event of stages) {
        sink.write({
          timestamp: '',
          level: 'warn',
          event,
          target: 'A4H/100',
          tool: 'SAPRead',
          errorCode: 'VALIDATION_ERROR',
        });
      }
      await sink.flush();

      const auditCalls = fetchSpy.mock.calls.filter((call) => String(call[0]).includes('/audit-log/'));
      expect(auditCalls).toHaveLength(stages.length);
      for (const auditCall of auditCalls) {
        expect(auditCall[0]).toContain('/security-events');
        expect(String(auditCall[1]?.body)).toContain('A4H/100');
        expect(String(auditCall[1]?.body)).toContain('VALIDATION_ERROR');
      }
    });

    it('preserves target attribution across forwarded multi-target event families', async () => {
      const sink = new BTPAuditLogSink(config);
      const target = 'A4H/100';
      const events: AuditEvent[] = [
        {
          timestamp: '',
          level: 'info',
          event: 'tool_call_start',
          target,
          identity: 'shared',
          tool: 'SAPRead',
          args: {},
        },
        {
          timestamp: '',
          level: 'info',
          event: 'tool_call_end',
          target,
          identity: 'shared',
          tool: 'SAPRead',
          durationMs: 1,
          status: 'success',
        },
        {
          timestamp: '',
          level: 'error',
          event: 'auth_pp_created',
          target,
          identity: 'per-user',
          success: false,
          errorMessage: 'redacted upstream',
        },
        {
          timestamp: '',
          level: 'info',
          event: 'auth_shared_created',
          target,
          user: 'TEST_USER',
          tool: 'SAPRead',
          identity: 'shared',
        },
        {
          timestamp: '',
          level: 'warn',
          event: 'auth_scope_denied',
          target,
          identity: 'shared',
          tool: 'SAPQuery',
          requiredScope: 'sql',
          availableScopes: ['read'],
        },
        {
          timestamp: '',
          level: 'warn',
          event: 'safety_blocked',
          target,
          identity: 'shared',
          operation: 'SAPWrite',
          reason: 'read-only multi-target v1',
        },
        {
          timestamp: '',
          level: 'warn',
          event: 'mcp_rate_limited',
          target,
          identity: 'shared',
          user: 'TEST_USER',
          tool: 'SAPRead',
          limitPerMinute: 120,
          retryAfterMs: 500,
        },
      ];
      for (const event of events) sink.write(event);
      await sink.flush();

      const auditCalls = fetchSpy.mock.calls.filter((call) => String(call[0]).includes('/audit-log/'));
      expect(auditCalls).toHaveLength(events.length);
      for (const auditCall of auditCalls) {
        const body = String(auditCall[1]?.body);
        expect(body).toContain(target);
        expect(body).toContain('identity');
        expect(body).not.toContain('undefined');
      }
    });

    it('does not send http_request events', async () => {
      const sink = new BTPAuditLogSink(config);
      const event: AuditEvent = {
        timestamp: '',
        level: 'debug',
        event: 'http_request',
        method: 'GET',
        path: '/test',
        statusCode: 200,
        durationMs: 50,
      };
      sink.write(event);
      await sink.flush();

      expect(tokenSpy).not.toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    });

    it('does not send server_start events', async () => {
      const sink = new BTPAuditLogSink(config);
      const event: AuditEvent = {
        timestamp: '',
        level: 'info',
        event: 'server_start',
        version: '3.0.0',
        transport: 'stdio',
        allowWrites: true,
        url: 'http://test',
      };
      sink.write(event);
      await sink.flush();

      expect(tokenSpy).not.toHaveBeenCalled();
      expect(fetchSpy).toHaveBeenCalledTimes(0);
    });

    it('rate-limits delivery warnings without throwing into the tool call', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-17T08:00:00Z'));
      fetchSpy.mockRejectedValue(new Error('Network error'));
      const reportError = vi.fn();
      const sink = new BTPAuditLogSink(config, reportError);
      const event: AuditEvent = {
        timestamp: '',
        level: 'warn',
        event: 'safety_blocked',
        operation: 'CreateObject',
        reason: 'allowWrites=false',
      };
      sink.write(event);
      sink.write(event);

      await sink.flush();
      expect(reportError).toHaveBeenCalledTimes(1);
      expect(reportError).toHaveBeenCalledWith('Network error');

      vi.advanceTimersByTime(60_000);
      sink.write(event);
      await sink.flush();
      expect(reportError).toHaveBeenCalledTimes(2);
    });

    it('reports token failures without attempting an unauthenticated audit write', async () => {
      tokenSpy.mockRejectedValue(new Error('Token exchange failed'));
      const reportError = vi.fn();
      const sink = new BTPAuditLogSink(config, reportError);
      sink.write({
        timestamp: '',
        level: 'warn',
        event: 'safety_blocked',
        operation: 'SAPWrite',
        reason: 'allowWrites=false',
      });

      await expect(sink.flush()).resolves.toBeUndefined();
      expect(reportError).toHaveBeenCalledExactlyOnceWith('Token exchange failed');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('reports rejected audit payloads with the HTTP status and a bounded response excerpt', async () => {
      const body = 'data_subject is required. '.repeat(20);
      fetchSpy.mockResolvedValue({ ok: false, status: 400, text: async () => body });
      const reportError = vi.fn();
      const sink = new BTPAuditLogSink(config, reportError);
      sink.write({
        timestamp: '',
        level: 'info',
        event: 'tool_call_start',
        tool: 'SAPRead',
        args: {},
      });

      await expect(sink.flush()).resolves.toBeUndefined();
      expect(reportError).toHaveBeenCalledExactlyOnceWith(`HTTP 400: ${body.slice(0, 200)}`);
    });

    it.each(['success', 'failure'])('removes settled writes after %s without needing flush', async (outcome) => {
      if (outcome === 'failure') fetchSpy.mockRejectedValue(new Error('Network error'));
      const sink = new BTPAuditLogSink(config, vi.fn());
      sink.write({
        timestamp: '',
        level: 'info',
        event: 'tool_call_start',
        tool: 'SAPRead',
        args: {},
      });
      const pending = (sink as unknown as { pendingWrites: Set<Promise<void>> }).pendingWrites;
      expect(pending.size).toBe(1);
      await vi.waitFor(() => expect(pending.size).toBe(0));
    });
  });
});
