import { expect, it, vi } from 'vitest';
import { readEnhancementIncludeRevision } from '../../../src/adt/enhancement-include.js';
import type { RevisionInfo } from '../../../src/adt/types.js';

const include = `${'ZTEST'.padEnd(30, '=')}E`;
const uri = (version: string, name = include) =>
  `/sap/bc/adt/programs/includes/${encodeURIComponent(name)}/source/main/versions/20261101000000/${version}/content`;
const revision = (version: string, name = include): RevisionInfo => ({
  id: `urn:revision:${version}`,
  author: 'TEST',
  timestamp: '2026-11-01T00:00:00Z',
  uri: uri(version, name),
});
function client(revisions: RevisionInfo[]) {
  return {
    getRevisions: vi.fn().mockResolvedValue({ object: { type: 'REPS', name: include }, revisions }),
    getRevisionSource: vi.fn().mockResolvedValue('active source'),
  };
}

it('identifies the active content link even when the Atom id is a URN and a draft is first', async () => {
  const sap = client([revision('99999'), revision('00001'), revision('00000')]);
  const result = await readEnhancementIncludeRevision(sap, include);
  expect(result?.source).toBe('active source');
  expect(sap.getRevisionSource).toHaveBeenCalledExactlyOnceWith(uri('00000'));
});

it.each([
  ['only history', [revision('00001')]],
  ['only a draft', [revision('99999')]],
  ['duplicate active entries', [revision('00000'), revision('00000')]],
  ['another include', [{ ...revision('00000', 'OTHER'), id: '00000' }]],
  ['a misleading id', [{ ...revision('00001'), id: '00000' }]],
  ['an external URI', [{ ...revision('00000'), uri: `https://other.example${uri('00000')}` }]],
  ['a malformed URI', [{ ...revision('00000'), uri: uri('00000', 'OTHER').replace('OTHER', '%ZZ') }]],
] as const)('does not fetch source when the feed contains %s', async (_label, revisions) => {
  const sap = client([...revisions]);
  expect(await readEnhancementIncludeRevision(sap, include)).toBeUndefined();
  expect(sap.getRevisionSource).not.toHaveBeenCalled();
});
