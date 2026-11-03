import { describe, expect, it } from 'vitest';
import type { ExtensionOmission, ExtensionProvider } from '../../../src/adt/extension-discovery.js';
import { assertBdefExtensions } from '../../helpers/bdef-extension-assertions.js';

const base = { content: [{ type: 'text', text: 'define behavior for DEMO_RAP_EXTENSIBLE {}' }] };
const names = ['DEMO_RAP_EXTEND1', 'DEMO_RAP_EVENT_EXT'];
function fixture() {
  const provider: ExtensionProvider = {
    id: 'bdef_wul_verified',
    family: 'behavior_extension',
    status: 'returned',
    coverage: 'candidate_index',
  };
  const summary = {
    root: { type: 'BDEF', name: 'DEMO_RAP_EXTENSIBLE', version: 'active' },
    providers: [provider],
    identities: names.map((name) => ({ type: 'BDEF', name, version: 'active' })),
    applicability: 'unknown',
    omissions: {} as Partial<Record<ExtensionOmission, number>>,
    consumed: { sends: 3, responseBytes: 1344, elapsedMs: 600 },
  };
  const result = (sourceNames: string[] = []) => ({
    content: [
      ...base.content,
      { type: 'text', text: `[extensions] ${JSON.stringify(summary)}` },
      ...sourceNames.map((name) => ({
        type: 'text',
        text: `[extension source BDEF ${name} version=active representation=authored_source provider=bdef_wul_verified]\nextend behavior for DEMO_RAP_EXTENSIBLE {}`,
      })),
    ],
  });
  return { provider, summary, result };
}

describe('live BDEF assertions', () => {
  it('accepts completed summaries and positive authored-source verification', () => {
    const f = fixture();
    assertBdefExtensions(base, f.result(), 'summary');
    assertBdefExtensions(base, f.result(names), 'sources');
  });
  it.each([
    ['deadline', 'deadline'],
    ['request_limit', 'requests'],
    ['response_byte_limit', 'wire_bytes'],
  ] as const)('accepts an explicit %s summary without identities', (reason, omission) => {
    const f = fixture();
    f.provider.status = 'incomplete';
    f.provider.reason = reason;
    f.summary.identities = [];
    f.summary.omissions[omission] = 1;
    f.summary.consumed.elapsedMs = 2007;
    expect(assertBdefExtensions(base, f.result(), 'summary').omissions[omission]).toBe(1);
  });
  it.each([
    ['returned', undefined],
    ['incomplete', 'invalid_provider_response'],
    ['incomplete', 'http_500'],
    ['denied', 'deadline'],
    ['not_advertised', undefined],
  ] as const)('rejects an empty %s result with reason %s', (status, reason) => {
    const f = fixture();
    f.provider.status = status;
    f.provider.reason = reason;
    f.summary.identities = [];
    f.summary.omissions.deadline = 1;
    expect(() => assertBdefExtensions(base, f.result(), 'summary')).toThrow();
  });
  it.each([undefined, 0])('rejects a deadline reason with omission count %s', (count) => {
    const f = fixture();
    f.provider.status = 'incomplete';
    f.provider.reason = 'deadline';
    f.summary.identities = [];
    f.summary.omissions.deadline = count;
    expect(() => assertBdefExtensions(base, f.result(), 'summary')).toThrow();
  });
  it.each(['denied', 'not_advertised', 'unsupported'] as const)(
    'rejects %s even when positive identities are retained',
    (status) => {
      const f = fixture();
      f.provider.status = status;
      expect(() => assertBdefExtensions(base, f.result(), 'summary')).toThrow();
    },
  );
  it.each(['returned', 'incomplete'] as const)('rejects source bodies in a %s summary', (status) => {
    const f = fixture();
    f.provider.status = status;
    if (status === 'incomplete') {
      f.provider.reason = 'deadline';
      f.summary.omissions.deadline = 1;
    }
    expect(() => assertBdefExtensions(base, f.result(names), 'summary')).toThrow();
  });
  it('does not substitute a different omission for the reported resource failure', () => {
    const f = fixture();
    f.provider.status = 'incomplete';
    f.provider.reason = 'deadline';
    f.summary.identities = [];
    f.summary.omissions.requests = 1;
    expect(() => assertBdefExtensions(base, f.result(), 'summary')).toThrow();
  });
  it('still requires positive identities and both labelled authored bodies in sources mode', () => {
    const f = fixture();
    expect(() => assertBdefExtensions(base, f.result(names.slice(0, 1)), 'sources')).toThrow();
    f.summary.identities = [];
    f.provider.status = 'incomplete';
    f.provider.reason = 'deadline';
    f.summary.omissions.deadline = 1;
    expect(() => assertBdefExtensions(base, f.result(), 'sources')).toThrow();
  });
  it.each(['base', 'sends', 'bytes', 'output', 'provider', 'version'])(
    'keeps the %s invariant on partial summaries',
    (invariant) => {
      const f = fixture();
      f.provider.status = 'incomplete';
      f.provider.reason = 'deadline';
      f.summary.omissions.deadline = 1;
      const result = f.result();
      if (invariant === 'base') result.content[0] = { type: 'text', text: 'changed base' };
      if (invariant === 'sends') f.summary.consumed.sends = 7;
      if (invariant === 'bytes') f.summary.consumed.responseBytes = 131073;
      if (invariant === 'provider') f.provider.id = 'unrelated_provider';
      if (invariant === 'version') f.summary.identities[0]!.version = 'inactive';
      result.content[1]!.text = `[extensions] ${JSON.stringify(f.summary)}`;
      if (invariant === 'output') result.content[1]!.text += ' '.repeat(2048);
      expect(() => assertBdefExtensions(base, result, 'summary')).toThrow();
    },
  );
});
