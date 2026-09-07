import { describe, expect, it } from 'vitest';
import type { GraphCollectionReport } from '../types.js';
import { collectionReportPayload } from './collection-report.js';

describe('persisted collection report', () => {
  it('projects metadata and numeric counters only, dropping source and raw errors', () => {
    const input = {
      status: 'complete',
      counters: { discoveredObjects: 1, source: 'CANARY' },
      sources: [
        {
          name: 'ztest',
          type: 'prog/p',
          status: 'parsed',
          reasons: [],
          dynamicTargets: 0,
          source: 'CANARY',
          error: 'CANARY',
        },
      ],
    } as unknown as GraphCollectionReport;
    const payload = collectionReportPayload(input, 'S');
    expect(JSON.stringify(payload)).not.toContain('CANARY');
    expect(payload.checkpoint.sources[0]?.name).toBe('ZTEST');
  });
  it('cannot claim complete when a source failed', () => {
    expect(
      collectionReportPayload(
        {
          status: 'complete',
          counters: {},
          sources: [{ name: 'ZTEST', type: 'PROG', status: 'failed', reasons: ['empty_source'], dynamicTargets: 0 }],
        },
        'S',
      ).status,
    ).toBe('partial');
  });
  it('rejects raw exception strings masquerading as reason codes', () => {
    expect(() =>
      collectionReportPayload(
        {
          status: 'partial',
          counters: {},
          sources: [{ name: 'ZTEST', type: 'PROG', status: 'failed', reasons: ['CANARY' as never], dynamicTargets: 0 }],
        },
        'S',
      ),
    ).toThrow('Invalid source outcome');
  });
  it('rejects nonnumeric counters and nonfinite counts', () => {
    expect(() =>
      collectionReportPayload({ status: 'complete', counters: { requests: Infinity }, sources: [] }, 'S'),
    ).toThrow('Invalid collection counter');
  });
});
