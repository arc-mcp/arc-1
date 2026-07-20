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

    it('parses premium plan binding', () => {
      process.env.VCAP_SERVICES = JSON.stringify({
        auditlog: [
          {
            plan: 'premium',
            credentials: {
              url: 'https://api.auditlog.cf.example.com:6081',
              uaa: {
                url: 'https://sub.auth.example.com',
                certurl: 'https://sub.auth.cert.example.com',
                clientid: 'my-client-id',
                certificate: '-----BEGIN CERT-----',
                key: '-----BEGIN KEY-----',
              },
            },
          },
        ],
      });

      const config = parseBTPAuditLogConfig();
      expect(config).toBeDefined();
      expect(config!.url).toBe('https://api.auditlog.cf.example.com:6081');
      expect(config!.uaa.clientid).toBe('my-client-id');
    });

    it('returns undefined for invalid JSON', () => {
      process.env.VCAP_SERVICES = 'not-json';
      expect(parseBTPAuditLogConfig()).toBeUndefined();
    });
  });

  describe('Event categorization', () => {
    let stderrSpy: ReturnType<typeof vi.spyOn>;
    let fetchSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
      // Mock global fetch
      fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: 'test-token', expires_in: 3600 }),
        text: () => Promise.resolve(''),
      });
      vi.stubGlobal('fetch', fetchSpy);
    });

    afterEach(() => {
      stderrSpy.mockRestore();
      vi.unstubAllGlobals();
    });

    const config = {
      url: 'https://api.auditlog.test:6081',
      uaa: {
        url: 'https://sub.auth.test',
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

      // First call is token fetch, second is audit log write
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const auditCall = fetchSpy.mock.calls[1]!;
      expect(auditCall[0]).toContain('/security-events');
    });

    it('sends data-accesses for read tool calls', async () => {
      const sink = new BTPAuditLogSink(config);
      const event: AuditEvent = {
        timestamp: '',
        level: 'info',
        event: 'tool_call_end',
        tool: 'SAPRead',
        durationMs: 100,
        status: 'success',
      };
      sink.write(event);
      await sink.flush();

      const auditCall = fetchSpy.mock.calls[1]!;
      expect(auditCall[0]).toContain('/data-accesses');
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

      const auditCall = fetchSpy.mock.calls[1]!;
      expect(auditCall[0]).toContain('/data-modifications');
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

      const auditCall = fetchSpy.mock.calls[1]!;
      expect(auditCall[0]).toContain('/configuration-changes');
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

      // Only token fetch should happen, no audit log write
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

      expect(fetchSpy).toHaveBeenCalledTimes(0);
    });

    it('handles fetch errors gracefully (fire-and-forget)', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));
      const sink = new BTPAuditLogSink(config);
      const event: AuditEvent = {
        timestamp: '',
        level: 'warn',
        event: 'safety_blocked',
        operation: 'CreateObject',
        reason: 'allowWrites=false',
      };
      sink.write(event);

      // Should not throw
      await sink.flush();
      // Error should be logged to stderr
      expect(stderrSpy).toHaveBeenCalled();
    });
  });
});
