import { describe, expect, it } from 'vitest';

import { getToolRegistry } from '../../../src/handlers/dispatch.js';

// FEAT-61 PR1.2 parity: the registry must expose exactly the 12 built-ins + the `SAP`
// hyperfocused wrapper, all sourced as 'builtin', with a real policy — i.e. the switch→registry
// refactor dropped nothing and added nothing.
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
  'SAP',
];

describe('built-in tool registration (FEAT-61 PR1.2)', () => {
  it('registers exactly the 13 built-ins, all source=builtin with a policy', () => {
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
