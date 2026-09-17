import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuditEvent } from '../../../src/server/audit.js';
import { Logger, logger } from '../../../src/server/logger.js';
import type { TargetGrant } from '../../../src/server/multi-target-authorization.js';
import { auditTargetGrantDenial } from '../../../src/server/multi-target-authorization-audit.js';

describe('target grant diagnostics after central audit redaction', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each<TargetGrant>([
    { mode: 'none', status: 'TARGET_GRANT_MISSING' },
    { mode: 'none', status: 'TARGET_GRANT_MALFORMED' },
    { mode: 'none', status: 'TARGET_GRANT_LIMIT_EXCEEDED' },
    { mode: 'exact', status: 'valid', targets: ['OTHER/001'], exactGrantCount: 1 },
  ])('preserves bounded operator fields for $status without exposing claims', (grant) => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const actualLogger = new Logger('json', true);
    const events: AuditEvent[] = [];
    actualLogger.addSink({ write: (event) => events.push(event) });
    vi.spyOn(logger, 'emitAudit').mockImplementation((event) => actualLogger.emitAudit(event));

    auditTargetGrantDenial(
      grant,
      {
        token: 'TOKEN-MUST-NOT-LEAVE',
        clientId: 'test-client',
        scopes: ['read'],
        extra: { xsuaaUserAttributes: { arc1_targets: ['RAW-GRANT-MUST-NOT-LEAVE'] } },
      },
      'request-1',
      'SAPRead',
      'A4H/100',
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'target_resolution_failed',
      errorCode: grant.mode === 'none' ? grant.status : 'TARGET_NOT_GRANTED',
      targetAccessMode: 'xsuaa-attribute',
      grantMode: grant.mode,
      ...(grant.mode === 'exact' ? { exactGrantCount: 1 } : {}),
    });
    const output = JSON.stringify([events, stderr.mock.calls]);
    expect(output).not.toContain('TOKEN-MUST-NOT-LEAVE');
    expect(output).not.toContain('RAW-GRANT-MUST-NOT-LEAVE');
    expect(output).not.toContain('OTHER/001');
    expect(output).not.toContain('xsuaaUserAttributes');
    expect(output).not.toContain('[REDACTED sensitive key]');
  });
});
