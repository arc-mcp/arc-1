import { describe, expect, it } from 'vitest';
import type {
  ActivationPreauditEvent,
  AuditEvent,
  ToolCallEndEvent,
  ToolCallStartEvent,
} from '../../../src/server/audit.js';
import { redactAuditEvent, sanitizeArgs } from '../../../src/server/audit.js';

describe('Audit Events', () => {
  describe('sanitizeArgs', () => {
    it('passes through normal args unchanged', () => {
      const args = { type: 'FUNC', name: 'ZHELLO', includeSignature: true };
      expect(sanitizeArgs(args)).toEqual({ type: 'FUNC', name: 'ZHELLO', includeSignature: true });
    });

    it('redacts sensitive keys', () => {
      const args = { password: 'secret', token: 'abc123', type: 'PROG' };
      const result = sanitizeArgs(args);
      expect(result.password).toBe('[REDACTED]');
      expect(result.token).toBe('[REDACTED]');
      expect(result.type).toBe('PROG');
    });

    it('truncates long string values', () => {
      const longString = 'A'.repeat(600);
      const args = { source: longString };
      const result = sanitizeArgs(args);
      expect(result.source).toContain('[truncated 600 chars]');
      expect((result.source as string).length).toBeLessThan(300);
    });

    it('bounds adversarial escape normalization work before redaction', () => {
      const value = `${'\\\\'.repeat(100_000)}u0061`;
      const amplified = Object.fromEntries(
        Array.from({ length: 512 }, (_, index) => [`url${index}`, `${'\\\\'.repeat(500)}u0061`]),
      );
      const started = performance.now();
      const result = sanitizeArgs({ note: value, [value]: true, ...amplified });
      expect(performance.now() - started).toBeLessThan(500);
      expect(String(result.note)).toContain('[truncated');
    });

    it('redacts quoted secrets after long escaped-quote prefixes', () => {
      const sentinel = 'LONG-ESCAPED-SECRET-SENTINEL';
      const escapedQuote = `${'\\'.repeat(15)}"`;
      const result = sanitizeArgs({ message: `password=${escapedQuote}${sentinel}${escapedQuote}` });

      expect(JSON.stringify(result)).not.toContain(sentinel);
    });

    it('handles empty args', () => {
      expect(sanitizeArgs({})).toEqual({});
    });

    it('is case-insensitive for sensitive keys', () => {
      const args = { Authorization: 'Bearer xyz', apiKey: 'key123' };
      const result = sanitizeArgs(args);
      expect(result.Authorization).toBe('[REDACTED]');
      expect(result.apiKey).toBe('[REDACTED]');
    });

    it('removes URL userinfo and credential-like query values before tool_call_start audit', () => {
      const sentinelPassword = 'audit-password-sentinel';
      const sentinelToken = 'audit-token-sentinel';
      const result = sanitizeArgs({
        url:
          `https://git-user:${sentinelPassword}@example.com/repo.git;token=${sentinelToken}` +
          `?ref=main;token=${sentinelToken}&token:${sentinelToken}&session=${sentinelToken}` +
          `&cookie=${sentinelToken}#api_key=${sentinelToken}`,
        nested: { callbackUrl: `https://example.com/callback?apiKey=${sentinelToken}&mode=read` },
      });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(sentinelPassword);
      expect(serialized).not.toContain(sentinelToken);
      expect(String(result.url)).toContain('ref=main');
      expect(String(result.url)).not.toContain('git-user');
    });

    it('best-effort redacts malformed URLs before handler validation', () => {
      const result = sanitizeArgs({
        url: 'token=bare-assignment-sentinel',
        nested: {
          callbackUrl:
            'https://user:malformed-secret@example.com/path?to%6ben=query-secret%ZZ#access_token=fragment-secret',
        },
      });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('bare-assignment-sentinel');
      expect(serialized).not.toContain('malformed-secret');
      expect(serialized).not.toContain('query-secret');
      expect(serialized).not.toContain('fragment-secret');
    });

    it('preserves URL semantics through arrays and recognizes credential-key aliases', () => {
      const sentinel = 'audit-array-alias-sentinel';
      const args = sanitizeArgs({
        url: [`https:\\/\\/git-user:${sentinel}@example.com/repo.git?api_key=${sentinel}`],
        api_key: sentinel,
        passwd: sentinel,
        passphrase: sentinel,
        pwd: sentinel,
        private_key: sentinel,
        ssh_key: sentinel,
        credential: sentinel,
        signature: sentinel,
      });
      const event: AuditEvent = {
        timestamp: '',
        level: 'info',
        event: 'tool_call_start',
        tool: 'SAPGit',
        args,
      };
      expect(JSON.stringify(args)).not.toContain(sentinel);
      expect(JSON.stringify(redactAuditEvent(event))).not.toContain(sentinel);

      const bodyAliasEvent = { ...event, args: { response_body: sentinel } };
      expect(JSON.stringify(redactAuditEvent(bodyAliasEvent))).not.toContain(sentinel);
      expect(sanitizeArgs({ response_body: 'ordinary tool argument' })).toEqual({
        response_body: 'ordinary tool argument',
      });

      const keySentinel = 'audit-property-key-sentinel';
      const dynamic = { [`password_${keySentinel}`]: true, rows: [{ [`token_${keySentinel}`]: true }] };
      expect(JSON.stringify(sanitizeArgs(dynamic))).not.toContain(keySentinel);
      expect(JSON.stringify(redactAuditEvent({ ...event, args: dynamic }))).not.toContain(keySentinel);

      const punctuationSentinel = '!!!';
      const punctuationKeys = {
        [`password_${punctuationSentinel}`]: true,
        [`x-csrf-token_${punctuationSentinel}`]: true,
      };
      expect(JSON.stringify(sanitizeArgs(punctuationKeys))).not.toContain(punctuationSentinel);
      expect(JSON.stringify(redactAuditEvent({ ...event, args: punctuationKeys }))).not.toContain(punctuationSentinel);

      const escapedLabelSentinel = 'Q7z9!';
      const escapedLabelKeys = {
        [`passw\\u006frd_${escapedLabelSentinel}`]: true,
        rows: [{ [`to\\u006ben_${escapedLabelSentinel}`]: true }],
      };
      expect(JSON.stringify(sanitizeArgs(escapedLabelKeys))).not.toContain(escapedLabelSentinel);
      expect(JSON.stringify(redactAuditEvent({ ...event, args: escapedLabelKeys }))).not.toContain(
        escapedLabelSentinel,
      );
    });

    it('redacts complete Basic/Bearer values and slash-escaped embedded URLs', () => {
      const bearer = 'audit-bearer-sentinel';
      const basic = 'audit-basic-sentinel';
      const urlSecret = 'audit-escaped-url-sentinel';
      const assignmentSecret = 'audit-assignment-sentinel';
      const cookieSecret = 'audit-cookie-sentinel';
      const standaloneSecret = 'audit-standalone-sentinel';
      const unicodeKeySecret = 'audit-unicode-key-sentinel';
      const result = sanitizeArgs({
        message:
          `Authorization: Bearer ${bearer}; Authorization=Basic \\"${basic}\\"; ` +
          `Cookie: SAP_SESSIONID_A4H_001=${cookieSecret}; Set-Cookie: JSESSIONID=${cookieSecret}; ` +
          `Basic ${standaloneSecret}; ` +
          `CLIENT_VCS_AUTH_PWD=${assignmentSecret}; {\\"api_key\\":\\"${assignmentSecret}\\"}; ` +
          `{\\"to\\u006ben\\":\\"${unicodeKeySecret}\\"}; ` +
          `failed https:\\/\\/git-user:${urlSecret}@example.com/repo?token=${urlSecret}`,
      });
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(bearer);
      expect(serialized).not.toContain(basic);
      expect(serialized).not.toContain(assignmentSecret);
      expect(serialized).not.toContain(cookieSecret);
      expect(serialized).not.toContain(standaloneSecret);
      expect(serialized).not.toContain(unicodeKeySecret);
      expect(serialized).not.toContain(urlSecret);
    });

    it('bounds depth and aggregate entries without throwing or preserving cycles', () => {
      let nested: unknown = 'leaf';
      for (let index = 0; index < 2_000; index += 1) nested = { nested };
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;

      const args = sanitizeArgs({ nested, cyclic, many: Array.from({ length: 2_000 }, (_, index) => index) });
      expect(JSON.stringify(args)).toContain('redaction budget exceeded');

      const event: AuditEvent = {
        timestamp: '',
        level: 'info',
        event: 'tool_call_start',
        tool: 'SAPGit',
        args: { nested, cyclic },
      };
      expect(JSON.stringify(redactAuditEvent(event))).toContain('redaction budget exceeded');
    });

    it('sanitizes URLs before enforcing the audit string-length cap', () => {
      const sentinel = 'audit-long-url-sentinel';
      const longUrl = `https://git-user:${sentinel}@example.com/${'A'.repeat(60_000)}?token=${sentinel}`;
      const longKey = `field-${'K'.repeat(60_000)}`;
      const args = sanitizeArgs({ url: longUrl, [longKey]: true });
      expect(String(args.url)).not.toContain(sentinel);
      expect(String(args.url)).toContain('[truncated');
      expect(String(args.url).length).toBeLessThan(500);
      expect(Object.keys(args).find((key) => key.startsWith('field-'))?.length).toBeLessThan(500);
    });

    it('applies URL redaction again at the final audit-sink boundary', () => {
      const event: AuditEvent = {
        timestamp: '',
        level: 'info',
        event: 'server_start',
        version: 'test',
        transport: 'stdio',
        allowWrites: false,
        url: 'https://sink-user:sink-password@example.com/r?credential=sink-token&ref=main#api_key=sink-fragment',
      };
      const serialized = JSON.stringify(redactAuditEvent(event));
      expect(serialized).not.toContain('sink-user');
      expect(serialized).not.toContain('sink-password');
      expect(serialized).not.toContain('sink-token');
      expect(serialized).not.toContain('sink-fragment');
      expect(serialized).toContain('ref=main');
    });
  });

  describe('Type shapes', () => {
    it('ToolCallStartEvent has expected fields', () => {
      const event: ToolCallStartEvent = {
        timestamp: new Date().toISOString(),
        level: 'info',
        event: 'tool_call_start',
        requestId: 'REQ-1',
        user: 'testuser',
        tool: 'SAPRead',
        args: { type: 'PROG', name: 'ZHELLO' },
      };
      expect(event.event).toBe('tool_call_start');
      expect(event.tool).toBe('SAPRead');
    });

    it('ToolCallEndEvent captures error info', () => {
      const event: ToolCallEndEvent = {
        timestamp: new Date().toISOString(),
        level: 'error',
        event: 'tool_call_end',
        requestId: 'REQ-1',
        tool: 'SAPRead',
        durationMs: 150,
        status: 'error',
        errorClass: 'AdtApiError',
        errorMessage: 'Not found',
      };
      expect(event.status).toBe('error');
      expect(event.errorClass).toBe('AdtApiError');
    });

    it('AuditEvent union accepts all event types', () => {
      const events: AuditEvent[] = [
        {
          timestamp: '',
          level: 'info',
          event: 'tool_call_start',
          tool: 'SAPRead',
          args: {},
        },
        {
          timestamp: '',
          level: 'info',
          event: 'tool_call_end',
          tool: 'SAPRead',
          durationMs: 0,
          status: 'success',
        },
        {
          timestamp: '',
          level: 'debug',
          event: 'http_request',
          method: 'GET',
          path: '/sap/bc/adt/programs',
          statusCode: 200,
          durationMs: 50,
        },
        {
          timestamp: '',
          level: 'warn',
          event: 'auth_scope_denied',
          tool: 'SAPWrite',
          requiredScope: 'write',
          availableScopes: ['read'],
        },
        {
          timestamp: '',
          level: 'info',
          event: 'server_start',
          version: '3.0.0',
          transport: 'stdio',
          allowWrites: true,
          url: 'http://sap:8000',
        },
      ];
      expect(events).toHaveLength(5);
    });

    it('ActivationPreauditEvent has the expected fields', () => {
      const event: ActivationPreauditEvent = {
        timestamp: new Date().toISOString(),
        level: 'info',
        event: 'activation_preaudit_completed',
        objectLabel: 'ZCL_TEST',
        refCount: 3,
        phase1DurationMs: 120,
        phase2DurationMs: 85,
        outcome: 'success',
      };
      expect(event.event).toBe('activation_preaudit_completed');
      expect(event.outcome).toBe('success');
      expect(event.refCount).toBe(3);
    });

    it('AuditEvent union accepts ActivationPreauditEvent', () => {
      const event: AuditEvent = {
        timestamp: '',
        level: 'info',
        event: 'activation_preaudit_completed',
        objectLabel: 'ZTEST,ZTEST2',
        refCount: 2,
        phase1DurationMs: 0,
        phase2DurationMs: 0,
        outcome: 'error',
      };
      expect(event.event).toBe('activation_preaudit_completed');
    });
  });
});
