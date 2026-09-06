import { describe, expect, it } from 'vitest';

import { getToolRegistry } from '../../../src/handlers/dispatch.js';

// 12 default tools + optional SAPGraph + hyperfocused wrapper. The optional handler is
// stateless here: its client comes from the per-runtime dispatch context, never this singleton.
const BUILTINS = [
  'SAPRead',
  'SAPSearch',
  'SAPQuery',
  'SAPWrite',
  'SAPActivate',
  'SAPNavigate',
  'SAPLint',
  'SAPDiagnose',
  'SAPTransport',
  'SAPGit',
  'SAPContext',
  'SAPManage',
  'SAPGraph',
  'SAP',
];

describe('built-in tool registration (FEAT-61 PR1.2)', () => {
  it('registers exactly the 14 handlers, all source=builtin with a policy', () => {
    const r = getToolRegistry();
    for (const name of BUILTINS) {
      const e = r.get(name);
      expect(e, `built-in ${name} should be registered`).toBeDefined();
      expect(e?.source).toBe('builtin');
      expect(e?.policy?.scope).toBeTruthy();
      expect(e?.policy?.opType).toBeTruthy();
    }
    expect(r.size()).toBe(BUILTINS.length);
    expect(r.list().every((e) => e.source === 'builtin')).toBe(true);
  });

  it('returns undefined for an unknown tool (the former switch default)', () => {
    expect(getToolRegistry().get('NoSuchTool')).toBeUndefined();
  });

  it('returns the same registry instance on repeated calls (lazy singleton)', () => {
    expect(getToolRegistry()).toBe(getToolRegistry());
  });
});
