/**
 * Guards the MCP read-only / destructive annotations emitted by getToolDefinitions().
 *
 * The snapshot test freezes the whole tool surface, but a snapshot can be blessed away with
 * `-u`. These assertions pin the *meaning* of each annotation independently, so a wrong hint
 * (e.g. SAPManage flipped to read-only, which would let a client auto-run deletes) fails loudly.
 */

import { describe, expect, it } from 'vitest';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { FULL, features, onprem } from './handler-test-config.js';

const READ_ONLY = ['SAPRead', 'SAPSearch', 'SAPNavigate', 'SAPQuery', 'SAPContext', 'SAPLint', 'SAPDiagnose'];
const WRITE_SAFE = ['SAPWrite', 'SAPActivate', 'SAPTransport', 'SAPGit'];

describe('tool annotations', () => {
  const tools = getToolDefinitions(onprem({ ...FULL, allowedPackages: ['Z*'] }), true, features());
  const byName = new Map(tools.map((t) => [t.name, t]));

  it('marks every read-only tool readOnlyHint=true', () => {
    for (const name of READ_ONLY) {
      expect(byName.get(name)?.annotations, name).toEqual({ readOnlyHint: true });
    }
  });

  it('marks create/update/activate/transport/git as non-destructive writes', () => {
    for (const name of WRITE_SAFE) {
      expect(byName.get(name)?.annotations, name).toEqual({ readOnlyHint: false, destructiveHint: false });
    }
  });

  it('marks SAPManage destructive (it deletes objects)', () => {
    expect(byName.get('SAPManage')?.annotations).toEqual({ readOnlyHint: false, destructiveHint: true });
  });

  it('leaves no standard tool unannotated', () => {
    for (const t of tools) {
      expect(typeof t.annotations?.readOnlyHint, t.name).toBe('boolean');
    }
  });

  it('leaves the hyperfocused universal tool unannotated (it can read and write)', () => {
    const hf = getToolDefinitions(onprem({ ...FULL, toolMode: 'hyperfocused' }), true, features());
    expect(hf).toHaveLength(1);
    expect(hf[0].annotations).toBeUndefined();
  });
});
