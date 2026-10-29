import { describe, expect, it, vi } from 'vitest';
import { DataResponseBudget } from '../../../src/adt/data-result-context.js';
import {
  enhancementIncludeName,
  enhancementMethodIncludes,
  readEnhancementIncludeRevision,
} from '../../../src/adt/enhancement-include.js';
import { RequestAttemptBudget } from '../../../src/adt/request-attempt-budget.js';

const include = enhancementIncludeName('CL_OO_ADT_ENHANCED_CLASS1');
const path = `/sap/bc/adt/programs/includes/${encodeURIComponent(include.toLowerCase())}/source/main/versions/19700101091123/00000/content`;
const active = { id: '00000', author: 'SAP', timestamp: '1970-01-01', uri: path };
function client(overrides = {}) {
  return {
    getRevisions: vi
      .fn()
      .mockResolvedValue({ object: { name: include, type: 'REPS' }, revisions: [active], ...overrides }),
    getRevisionSource: vi.fn().mockResolvedValue('unchanged generated source'),
  };
}
describe('qualified generated include revisions', () => {
  it('binds the active entry and forwards every transport budget to both reads', async () => {
    const c = client({ revisions: [{ ...active, id: '00001', timestamp: '2099-01-01' }, active] });
    const request = {
      deadline: Date.now() + 1000,
      signal: new AbortController().signal,
      attemptBudget: new RequestAttemptBudget(3),
      responseBudget: new DataResponseBudget(1000, 'test'),
      retryTransientErrors: false,
    };
    expect(await readEnhancementIncludeRevision(c, include, request)).toMatchObject({
      source: 'unchanged generated source',
      revision: { id: '00000', timestamp: '1970-01-01', uri: path },
    });
    expect(c.getRevisions).toHaveBeenCalledWith('INCL', include, {}, request);
    expect(c.getRevisionSource).toHaveBeenCalledWith(path, request);
  });
  it.each([
    { object: { name: 'ANOTHER', type: 'REPS' } },
    { object: { name: include, type: 'PROG' } },
    { revisions: [active, active] },
    { revisions: [{ ...active, uri: path.replace('/00000/', '/00001/') }] },
    { revisions: [{ ...active, uri: path.replace('cl_oo_adt_enhanced_class1', 'another') }] },
    { revisions: [{ ...active, uri: `https://other.test${path}` }] },
    { revisions: [{ ...active, uri: path.replace('/versions/', '/%2e%2e/versions/') }] },
    { revisions: [{ ...active, uri: `${path}?version=inactive` }] },
    { revisions: [{ ...active, uri: path.replace('/00000/content', '/99999/content') }] },
  ])('rejects a feed/content ownership or version mismatch %#', async (overrides) => {
    const c = client(overrides);
    await expect(readEnhancementIncludeRevision(c, include)).rejects.toThrow('revision history');
    expect(c.getRevisionSource).not.toHaveBeenCalled();
  });
  it('does not select history or substitute active content for an inactive request', async () => {
    const c = client({ revisions: [{ ...active, id: '00001' }] });
    expect(await readEnhancementIncludeRevision(c, include)).toBeUndefined();
    c.getRevisions.mockClear();
    expect(await readEnhancementIncludeRevision(c, include, { version: 'inactive' })).toBeUndefined();
    expect(c.getRevisions).not.toHaveBeenCalled();
    expect(c.getRevisionSource).not.toHaveBeenCalled();
  });
  it.each(['../WRONG', 'A'.repeat(31), 'Z?x', '', '/BAD/NAME/EXTRA'])('validates candidate name %s', (name) => {
    expect(() => enhancementIncludeName(name)).toThrow();
  });
  it('follows only a method child discovered in a real statement for the same owner', async () => {
    const child = `${include}M001`;
    expect(
      enhancementMethodIncludes(
        `* INCLUDE ${include}M002.\nDATA(s) = 'INCLUDE ${include}M003.'.\nINCLUDE ${child}.\nINCLUDE OTHER=========================EM001.`,
        include,
      ),
    ).toEqual([child]);
    const c = client({
      object: { name: child, type: 'REPS' },
      revisions: [{ ...active, uri: path.replace('%3De/', '%3Dem001/') }],
    });
    expect(await readEnhancementIncludeRevision(c, child)).toMatchObject({ include: child });
  });
});
