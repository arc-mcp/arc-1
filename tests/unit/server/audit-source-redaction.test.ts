/**
 * Source and business content passed as tool arguments must never reach an audit sink.
 * Exercises the real dispatcher, Logger, StderrSink, FileSink and BTPAuditLogSink.
 */

import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { XsuaaService } from '@sap/xssec';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { unrestrictedSafetyConfig } from '../../../src/adt/safety.js';
import type { AuditEvent } from '../../../src/server/audit.js';
import { sanitizeArgs } from '../../../src/server/audit.js';
import { BTPAuditLogSink } from '../../../src/server/sinks/btp-auditlog.js';
import { FileSink } from '../../../src/server/sinks/file.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';

const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});

const { AdtClient } = await import('../../../src/adt/client.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { logger, Logger } = await import('../../../src/server/logger.js');

const S = 'SENTINEL_SOURCE_7f3a';
const tmpFile = join(tmpdir(), `arc1-audit-source-${process.pid}-${Date.now()}.jsonl`);

const CASES: Array<[string, string, Record<string, unknown>]> = [
  ['update source', 'SAPWrite', { action: 'update', type: 'PROG', name: 'ZSENT', source: S }],
  ['edit_method', 'SAPWrite', { action: 'edit_method', type: 'CLAS', name: 'ZCL_SENT', method: 'run', source: S }],
  ['text symbols', 'SAPWrite', { action: 'edit_text_symbols', type: 'PROG', name: 'ZSENT', source: S }],
  [
    'edit_content',
    'SAPWrite',
    {
      action: 'edit_content',
      type: 'PROG',
      name: 'ZSENT',
      oldContent: S,
      newContent: `${S}2`,
      expectedSourceHash: 'a'.repeat(64),
    },
  ],
  [
    'MSAG messages',
    'SAPWrite',
    { action: 'create', type: 'MSAG', name: 'ZSENT', messages: [{ number: '001', shortText: S }] },
  ],
  [
    'DOMA fixed values',
    'SAPWrite',
    { action: 'create', type: 'DOMA', name: 'ZSENT', package: '$TMP', fixedValues: [{ low: S, description: S }] },
  ],
  [
    'KTD short texts',
    'SAPWrite',
    { action: 'create', type: 'SKTD', name: 'ZSENT', shortTexts: [{ node: 'n', text: S }] },
  ],
  [
    'nested batch',
    'SAPWrite',
    {
      action: 'batch_create',
      package: '$TMP',
      objects: [
        { type: 'CLAS', name: 'ZCL_SENT', source: S },
        { type: 'DOMA', name: 'ZSENT', fixedValues: [{ low: S }] },
      ],
    },
  ],
  [
    'quickfix content',
    'SAPDiagnose',
    {
      action: 'apply_quickfix',
      proposalUri: '/sap/bc/adt/quickfixes/x',
      proposalUserContent: S,
      proposalAffectedObjects: [{ uri: '/sap/bc/adt/programs/programs/zsent', content: S }],
    },
  ],
  ['invalid action', 'SAPWrite', { action: 'no_such_action', source: S }],
];

describe('audit sinks never receive source-bearing arguments', () => {
  const events: AuditEvent[] = [];
  const btpFetch = vi.fn();
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  let fileSink: FileSink;
  let btpSink: BTPAuditLogSink;

  beforeAll(() => {
    vi.stubGlobal('fetch', btpFetch);
    vi.spyOn(XsuaaService.prototype, 'getClientCredentialsToken').mockResolvedValue({
      access_token: 'audit-token',
    } as never);
    fileSink = new FileSink(tmpFile);
    btpSink = new BTPAuditLogSink({
      url: 'https://auditlog.example.test',
      uaa: { certurl: 'https://auth.example.test', clientid: 'c', certificate: 'x', key: 'y' },
    } as never);
    logger.addSink({ write: (event: AuditEvent) => events.push(event) });
    logger.addSink(fileSink);
    logger.addSink(btpSink);
  });

  afterAll(() => {
    stderrSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    if (existsSync(tmpFile)) unlinkSync(tmpFile);
  });

  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(mockResponse(200, '<ok/>', { 'x-csrf-token': 'csrf' }));
    btpFetch.mockReset();
    btpFetch.mockResolvedValue({ ok: true, status: 201, text: async () => '' });
  });

  const client = () =>
    new AdtClient({ baseUrl: 'http://sap:8000', username: 'u', password: 'p', safety: unrestrictedSafetyConfig() });
  const writer = { token: 't', clientId: 'cid', scopes: ['read', 'write', 'admin'], extra: { userName: 'AUDIT_USER' } };
  const reader = { ...writer, scopes: ['read'] };

  for (const httpDebug of ['true', 'false']) {
    for (const [label, tool, args] of CASES) {
      for (const [authLabel, authInfo] of [
        ['accepted', writer],
        ['refused', reader],
      ] as const) {
        it(`${label} (${authLabel}, HTTP debug ${httpDebug})`, async () => {
          vi.stubEnv('ARC1_LOG_HTTP_DEBUG', httpDebug);
          events.length = 0;
          stderrSpy.mockClear();
          const requestId = `REQ-${label.replace(/\W/g, '')}-${authLabel}-${httpDebug}`;
          await handleToolCall(
            client(),
            { ...DEFAULT_CONFIG, allowWrites: true, allowedPackages: ['*'] },
            tool,
            structuredClone(args),
            authInfo,
            undefined,
            undefined,
            undefined,
            undefined,
            requestId,
          );
          await logger.flush();

          const outputs = {
            capture: JSON.stringify(events),
            file: readFileSync(tmpFile, 'utf8'),
            stderr: JSON.stringify(stderrSpy.mock.calls),
            btp: JSON.stringify(btpFetch.mock.calls),
          };
          for (const [sink, output] of Object.entries(outputs)) {
            expect(output, sink).not.toContain(S);
          }
          const start = events.find((event) => event.event === 'tool_call_start');
          expect(start).toMatchObject({ tool, requestId, user: 'AUDIT_USER', clientId: 'cid' });
          expect(JSON.stringify(start)).toMatch(/\[REDACTED content \d+ chars\]/);
          expect(outputs.stderr).toContain(requestId);
        });
      }
    }
  }
});

describe('content summaries', () => {
  it('keeps routing metadata, the target and a correlatable summary', () => {
    const write = vi.fn();
    const quiet = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const local = new Logger('json', 'info');
    local.addSink({ write });
    const args = { action: 'update', type: 'PROG', name: 'ZSENT', package: '$TMP', transport: 'A4HK900001', source: S };
    local.emitAudit({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'tool_call_start',
      requestId: 'REQ-1',
      user: 'AUDIT_USER',
      target: 'A4H/100',
      tool: 'SAPWrite',
      args: sanitizeArgs(args),
    });
    quiet.mockRestore();
    const event = write.mock.calls[0]![0];
    expect(JSON.stringify(event)).not.toContain(S);
    expect(event).toMatchObject({
      requestId: 'REQ-1',
      user: 'AUDIT_USER',
      target: 'A4H/100',
      args: { action: 'update', type: 'PROG', name: 'ZSENT', package: '$TMP', transport: 'A4HK900001' },
    });
    // Same input → same summary after both redaction passes; a different length → a different summary.
    expect(event.args.source).toBe(sanitizeArgs(args).source);
    expect(event.args.source).not.toBe(sanitizeArgs({ source: `${S}!` }).source);
  });

  it('keeps the tadir_lookup source enum and summarizes hyperfocused params', () => {
    expect(sanitizeArgs({ action: 'search', source: 'db' }).source).toBe('db');
    const nested = sanitizeArgs({ action: 'write', params: { source: S, objects: [{ source: S }] } });
    expect(JSON.stringify(nested)).not.toContain(S);
  });

  it('does not trust a caller-supplied value that merely looks like a summary', () => {
    const forged = `[REDACTED content 1 chars] ${S}`;
    expect(JSON.stringify(sanitizeArgs({ source: forged }))).not.toContain(S);
    const longDigits = '[REDACTED content 4111111111111111 chars]';
    expect(sanitizeArgs({ source: longDigits }).source).not.toContain('4111111111111111');
  });

  it('summarizes values under non-ASCII keys before schema validation rejects them', () => {
    expect(JSON.stringify(sanitizeArgs({ s\u043eurce: S, nested: [{ \u0441ontent: S }] }))).not.toContain(S);
  });
});
