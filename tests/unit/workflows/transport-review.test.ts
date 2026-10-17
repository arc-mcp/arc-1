import { describe, expect, it, vi } from 'vitest';
import { textResult } from '../../../src/handlers/shared.js';
import { collectTransportReview, renderTransportReview } from '../../../src/workflows/transport-review.js';

const part = {
  part: 'main',
  baselineStatus: 'prior-revision',
  selectionMethod: 'exact-transport',
  from: '00001',
  to: '00002',
  added: 1,
  removed: 1,
  diff: '-old\n+new',
  change: 'changed',
  statisticsComplete: true,
  sourceHashes: { before: 'a'.repeat(64), after: 'b'.repeat(64) },
  revisions: {
    before: { id: '00001', uri: '/v1', timestamp: '', author: '' },
    after: { id: '00002', uri: '/v2', timestamp: '', author: '' },
    skipped: [],
  },
};
const object = { type: 'PROG', name: 'ZDEMO', taskIds: [], components: [], parts: [part] };
const page = {
  schemaVersion: 1,
  resultFormat: 'structured',
  target: 'A4H/001',
  client: '001',
  transport: { id: 'A4HK900001', status: 'R' },
  reviewMode: 'released',
  inventoryFingerprint: 'hash',
  continuation: 'token',
  offset: 0,
  shown: 1,
  totalObjects: 1,
  objects: [object],
};

describe('transport evidence collector', () => {
  it('rejects repeated objects across pages instead of claiming complete coverage', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(textResult(JSON.stringify({ ...page, totalObjects: 2, nextOffset: 1 })))
      .mockResolvedValueOnce(textResult(JSON.stringify({ ...page, totalObjects: 2, offset: 1 })))
      .mockResolvedValue(textResult(JSON.stringify({ ...page, totalObjects: 2 })));
    const result = await collectTransportReview(invoke, 'A4HK900001');
    expect(result.status).toBe('error');
    expect(result.gaps.join(' ')).toMatch(/duplicate/i);
    expect(result.pages).toHaveLength(1);
  });
  it('rejects duplicate source parts rather than counting the same evidence twice', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue(textResult(JSON.stringify({ ...page, objects: [{ ...object, parts: [part, part] }] })));
    expect((await collectTransportReview(invoke, 'A4HK900001')).status).toBe('error');
  });
  it('collects complete historical evidence, checks inventory again and never invents checks', async () => {
    const invoke = vi.fn().mockResolvedValue(textResult(JSON.stringify(page)));
    const artifact = await collectTransportReview(invoke, 'A4HK900001');
    expect(artifact.status).toBe('complete');
    expect(artifact.checks[0].status).toBe('not-run');
    expect(invoke).toHaveBeenLastCalledWith(
      'SAPTransport',
      expect.objectContaining({ continuation: 'token', summary: true }),
    );
    expect(artifact.pages[0]).not.toHaveProperty('continuation');
  });
  it('cannot call missing coverage complete', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue(
        textResult(JSON.stringify({ ...page, objects: [{ ...object, coverageGaps: ['Text history unreviewed'] }] })),
      );
    const artifact = await collectTransportReview(invoke, 'A4HK900001');
    expect(artifact.status).toBe('partial');
  });
  it('detects inventory drift and never concatenates a second target', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(textResult(JSON.stringify({ ...page, totalObjects: 2, nextOffset: 1 })))
      .mockResolvedValueOnce(textResult(JSON.stringify({ ...page, target: 'OTHER/001', totalObjects: 2, offset: 1 })));
    const artifact = await collectTransportReview(invoke, 'A4HK900001');
    expect(artifact.status).toBe('stale');
    expect(artifact.pages).toHaveLength(1);
  });
  it('keeps legacy connector responses and errors from becoming complete', async () => {
    const invoke = vi.fn().mockResolvedValue(textResult('{}'));
    expect((await collectTransportReview(invoke, 'A4HK900001')).status).toBe('error');
  });
  it('validates final inventory evidence and rejects malformed part data', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(textResult(JSON.stringify(page)))
      .mockResolvedValueOnce(textResult(JSON.stringify({ ...page, inventoryFingerprint: 'drift' })));
    expect((await collectTransportReview(invoke, 'A4HK900001')).status).toBe('stale');
    const invalid = vi
      .fn()
      .mockResolvedValue(textResult(JSON.stringify({ ...page, objects: [{ ...object, parts: [{}] }] })));
    expect((await collectTransportReview(invalid, 'A4HK900001')).status).toBe('error');
  });
  it('does not promote active check drift to historical validation', async () => {
    let states = 0;
    const invoke = vi.fn(async (tool: string, args: Record<string, unknown>) =>
      textResult(
        JSON.stringify(
          tool === 'SAPTransport'
            ? page
            : args.action === 'syntax'
              ? { checked: true, hasErrors: false }
              : { sections: [{ section: 'main', active: { available: true, sha256: String(++states) } }] },
        ),
      ),
    );
    const artifact = await collectTransportReview(invoke, 'A4HK900001', { syntax: true });
    expect(artifact.checks[0]).toMatchObject({
      status: 'stale',
      sourceState: 'active',
      historicalCorrelation: 'not established',
    });
  });
  it('renders hunks as inert text and identifies evidence gaps next to status', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue(
        textResult(
          JSON.stringify({ ...page, objects: [{ ...object, parts: [{ ...part, diff: '<script>bad()</script>' }] }] }),
        ),
      );
    const html = renderTransportReview(await collectTransportReview(invoke, 'A4HK900001'));
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('not a release verdict');
  });
});
