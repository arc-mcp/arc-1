import { describe, expect, it, vi } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { AdtApiError, AdtResponseLimitError } from '../../../src/adt/errors.js';
import { AdtRequestBudgetError } from '../../../src/adt/request-attempt-budget.js';
import {
  baselineStatusFor,
  diffTransportObject,
  type LogicalTransportObject,
  selectTransportRevisionPair,
} from '../../../src/adt/transport-diff.js';
import { ReviewBudget } from '../../../src/adt/transport-review-budget.js';
import type { RevisionInfo } from '../../../src/adt/types.js';
import { parseRevisionFeed } from '../../../src/adt/xml-parser.js';

const request = 'DEVK900002';
const ids = new Set([request]);
const rev = (id: string, transport?: string, timestamp = '2026-10-17T12:00:00Z'): RevisionInfo => ({
  id,
  transport,
  timestamp,
  author: 'DEMO',
  uri: `/sap/bc/adt/demo/versions/20261017120000/${id}/content`,
});
const history = (attributed = true) => [
  rev('00002', attributed ? request : undefined),
  rev('00001', attributed ? 'DEVK900001' : undefined, '2026-10-16T12:00:00Z'),
];
const component = (type: string, suffix: string) => ({
  pgmid: 'LIMU',
  type,
  name: 'ZCL_DEMO'.padEnd(30, '=') + suffix,
  wbtype: 'CLAS/OC',
  taskId: request,
});
const object = (components: LogicalTransportObject['components']): LogicalTransportObject => ({
  pgmid: 'R3TR',
  type: 'CLAS',
  name: 'ZCL_DEMO',
  description: '',
  taskIds: [request],
  components,
});
function client(missing: string[] = []) {
  return {
    getRevisions: vi.fn(async (_type: string, _name: string, opts: { include?: string }) => {
      if (missing.includes(opts.include ?? 'main')) throw new AdtApiError('Not found', 404, '/sap/bc/adt/demo');
      return { revisions: history((opts.include ?? 'main') === 'main') };
    }),
    getRevisionSource: vi.fn(async (uri: string) => (uri.includes('00002') ? 'WRITE 2.\n' : 'WRITE 1.\n')),
  } as unknown as AdtClient;
}

describe('transport review evidence regressions', () => {
  it('keeps local invalid-history explanations under minimal errors', async () => {
    const c = client();
    vi.mocked(c.getRevisions).mockImplementation(async () => parseRevisionFeed('<html>PRIVATE</html>'));
    const result = await diffTransportObject(c, { ...object([]), type: 'PROG' }, ids, { minimalErrors: true });
    expect(result.parts[0].note).toContain('Invalid or unexpected revision history response');
    expect(result.parts[0].note).not.toContain('PRIVATE');
  });
  it('distinguishes a speculative include without request attribution', async () => {
    const result = await diffTransportObject(client(), object([]), ids);
    const part = result.parts.find((part) => part.part === 'definitions');
    expect(part?.baselineStatus).toBe('baseline-unavailable');
    expect(part?.note).toContain('Speculative part: no snapshot attributed to this request');
  });
  it.each([false, true])('reports a pending draft even when the active read fails: %s', async (fails) => {
    const c = client();
    vi.mocked(c.getRevisions).mockResolvedValue({
      object: { type: 'PROG', name: 'Z_DEMO' },
      revisions: [rev('99999', request), rev('00000', request), ...history()],
    });
    if (fails) vi.mocked(c.getRevisionSource).mockRejectedValue(new AdtApiError('Denied', 403, '/sap/bc/adt/demo'));
    const result = await diffTransportObject(c, { ...object([]), type: 'PROG' }, ids, { mode: 'active' });
    expect(result.parts[0].note).toContain('Inactive draft pending for this request; not compared.');
    expect(vi.mocked(c.getRevisionSource).mock.calls.every(([uri]) => !uri.includes('99999'))).toBe(true);
  });
  it.each([false, true])('names an oversized response under minimalErrors=%s', async (minimalErrors) => {
    const c = client();
    vi.mocked(c.getRevisionSource).mockRejectedValue(new AdtResponseLimitError(1024, 1025, 'transport-review'));
    const result = await diffTransportObject(c, { ...object([]), type: 'PROG' }, ids, {
      budget: new ReviewBudget(),
      minimalErrors,
    });
    expect(result.parts[0].note).toContain('response exceeded its 1024-byte review allowance');
    expect(result.parts[0].note).not.toContain('page budget exhausted');
  });
  it.each([false, true])(
    'preserves a SAP failure on the last allowed read under minimalErrors=%s',
    async (minimalErrors) => {
      const c = client();
      vi.mocked(c.getRevisions).mockRejectedValue(
        new AdtApiError('Sensitive SAP diagnostic', 403, '/sap/bc/adt/private'),
      );
      const budget = new ReviewBudget();
      budget.reads = 179;
      const result = await diffTransportObject(c, { ...object([]), type: 'PROG' }, ids, { budget, minimalErrors });
      expect(budget.exhausted).toBe(true);
      expect(result.parts[0].note).toContain(
        minimalErrors ? 'SAP request failed (status 403)' : 'Sensitive SAP diagnostic',
      );
      expect(result.parts[0].note).not.toContain('page budget exhausted');
      if (minimalErrors) expect(result.parts[0].note).not.toMatch(/Sensitive|private/);
    },
  );
  it('names the actual send limit with minimal SAP errors', async () => {
    const c = client();
    vi.mocked(c.getRevisions).mockRejectedValue(new AdtRequestBudgetError(180));
    const result = await diffTransportObject(c, { ...object([]), type: 'PROG' }, ids, {
      budget: new ReviewBudget(),
      minimalErrors: true,
    });
    expect(result.parts[0].note).toContain('SAP HTTP attempt limit (180) reached');
  });
  it('names a request deadline with minimal SAP errors', async () => {
    const budget = new ReviewBudget();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(budget.deadline);
    try {
      const result = await diffTransportObject(client(), { ...object([]), type: 'PROG' }, ids, {
        budget,
        minimalErrors: true,
      });
      expect(result.parts[0].note).toContain('ARC-1 review request time limit reached');
    } finally {
      clock.mockRestore();
    }
  });
  it('keeps local budget exhaustion intelligible with minimal SAP errors', async () => {
    const budget = new ReviewBudget();
    budget.reads = 180;
    const result = await diffTransportObject(client(), { ...object([]), type: 'PROG' }, ids, {
      budget,
      minimalErrors: true,
    });
    expect(result.parts[0].note).toContain('ARC-1 review page budget exhausted');
    expect(result.parts[0].baselineStatus).toBe('baseline-unavailable');
  });
  it('does not certify a newer-numbered undated snapshot as the predecessor', () => {
    const feed = [rev('00002', request), rev('00003', 'DEVK900003', '')];
    const pair = selectTransportRevisionPair(feed, ids, 'released');
    expect(baselineStatusFor(pair, feed)).toBe('baseline-ambiguous');
  });
  it('does not certify the selected snapshot when a newer same-request version has no date', () => {
    const feed = [rev('00002', request), rev('00001', 'OTHER', '2026-10-16'), rev('00003', request, '')];
    const pair = selectTransportRevisionPair(feed, ids, 'released');
    expect(baselineStatusFor(pair, feed)).toBe('baseline-ambiguous');
  });
  it.each(['<feed><entry/></feed>', '<feed><entry>unexpected</entry></feed>'])(
    'rejects a malformed entry instead of silently reporting empty history: %s',
    (xml) => expect(() => parseRevisionFeed(xml)).toThrow(/unexpected/),
  );
  it('selects explicit source states without substituting current work for missing release history', () => {
    const feed = [rev('99999', request), rev('00000', request), ...history()];
    expect(selectTransportRevisionPair(feed, ids, 'active').current?.id).toBe('00000');
    expect(selectTransportRevisionPair(feed, ids, 'released').current?.id).toBe('00002');
    expect(selectTransportRevisionPair(feed.slice(0, 2), ids, 'released').current).toBeNull();
  });

  it('advertises incomplete history without following a guessed URL', () => {
    const feed = parseRevisionFeed(
      '<feed><link rel="next" href="https://untrusted.test/"/><entry isTestTransport="true"><id>00002</id><content src="/sap/bc/adt/demo/versions/20261017120000/00002/content"/></entry></feed>',
    );
    expect(feed).toMatchObject({
      historyComplete: false,
      revisions: [{ id: '00002' }],
    });
    expect(JSON.stringify(feed)).not.toContain('untrusted.test');
    expect(() => parseRevisionFeed('<html>Login</html>')).toThrow(/unexpected/);
    expect(() => parseRevisionFeed('<feed>Unexpected text</feed>')).toThrow(/unexpected/);
    expect(() => parseRevisionFeed('<feed><entry><id>00001</id></entry></feed>')).toThrow(/unexpected/);
    expect(parseRevisionFeed('<feed/>').revisions).toEqual([]);
  });

  it('bounds a wide UTF-8 line while retaining accurate statistics', async () => {
    const c = client();
    vi.mocked(c.getRevisionSource).mockImplementation(async (uri) => (uri.includes('00002') ? 'é'.repeat(150000) : ''));
    const result = await diffTransportObject(c, { ...object([]), type: 'PROG' }, ids);
    const part = result.parts[0];
    expect(Buffer.byteLength(part.diff)).toBeLessThanOrEqual(16384);
    expect(part).toMatchObject({ diffTruncated: true, added: 1 });
  });
  it('TD-01 retains a selected include when main succeeds and include history returns 404', async () => {
    const result = await diffTransportObject(
      client(['implementations']),
      object([component('METH', 'M'), component('CINC', 'CCIMP')]),
      ids,
    );
    expect(result.parts).toHaveLength(2);
    expect(result.scopeNote).toContain('whole class source');
    expect(result.parts[0].diff).toContain('+WRITE 2.');
    expect(result.parts[1]).toMatchObject({ part: 'implementations', baselineStatus: 'baseline-unavailable' });
    expect(result.parts[1].note).toContain('absence or deletion is not established');
  });

  it('TD-02 retains changed unattributed siblings of an exact main match', async () => {
    const c = client(['definitions', 'macros', 'testclasses']);
    vi.mocked(c.getRevisions).mockImplementation(async (_t, _n, opts) => ({
      object: { type: 'CLAS', name: 'ZCL_DEMO' },
      revisions: [rev('00000', opts?.include === 'main' ? request : undefined), rev('00001', 'OTHER', '2026-10-16')],
    }));
    vi.mocked(c.getRevisionSource).mockImplementation(async (uri) =>
      uri.includes('00000') ? 'WRITE 2.\n' : 'WRITE 1.\n',
    );
    const result = await diffTransportObject(
      c,
      object([{ pgmid: 'R3TR', type: 'CLAS', name: 'ZCL_DEMO', wbtype: 'CLAS/OC', taskId: request }]),
      ids,
      { mode: 'active' },
    );
    expect(result.parts.find((p) => p.part === 'implementations')).toMatchObject({
      added: 1,
      removed: 1,
      baselineStatus: 'prior-revision-unverified',
    });
    expect(result.parts.find((p) => p.part === 'implementations')?.diff).toContain('+WRITE 2.');
    expect(result.parts).toHaveLength(5);
  });

  it('TD-03 preserves text component scope even when source is identical', async () => {
    const c = client();
    vi.mocked(c.getRevisionSource).mockResolvedValue('WRITE text-001.');
    const input = { ...object([component('REPT', 'CP')]), type: 'PROG' };
    const result = await diffTransportObject(c, input, ids);
    expect(result.parts).toEqual([]);
    expect(c.getRevisions).not.toHaveBeenCalled();
    expect(result.inventoryReason).toContain('historical');
  });

  it.each(['00000'])('TD-04 does not infer an empty baseline for undated %s with known history', (workState) => {
    const feed = [rev('00002', 'DEVK900001'), rev(workState, request, '')];
    const pair = selectTransportRevisionPair(feed, ids, 'active');
    expect(pair.previous?.id).toBe('00002');
    expect(baselineStatusFor(pair, feed)).toBe('baseline-ambiguous');
  });
});
