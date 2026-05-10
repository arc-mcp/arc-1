import { describe, expect, it } from 'vitest';

import { OperationType } from '../../../src/adt/safety.js';
import {
  ACTION_POLICY,
  allPolicyKeys,
  expandScopes,
  getActionPolicy,
  hasRequiredScope,
} from '../../../src/authz/policy.js';

describe('ACTION_POLICY matrix', () => {
  it('includes tool-level defaults for every top-level tool', () => {
    const tools = [
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
    for (const t of tools) {
      expect(ACTION_POLICY[t]).toBeDefined();
    }
  });

  it('SAPRead.TABLE_CONTENTS requires data scope (not read)', () => {
    const policy = getActionPolicy('SAPRead', 'TABLE_CONTENTS');
    expect(policy?.scope).toBe('data');
    expect(policy?.opType).toBe(OperationType.Query);
  });

  it('SAPRead default (any other type) is read', () => {
    const policy = getActionPolicy('SAPRead', 'PROG');
    expect(policy?.scope).toBe('read');
    expect(policy?.opType).toBe(OperationType.Read);
  });

  it('CLASSIFICATION FIX: SAPLint.set_formatter_settings requires write scope', () => {
    const policy = getActionPolicy('SAPLint', 'set_formatter_settings');
    expect(policy?.scope).toBe('write');
    expect(policy?.opType).toBe(OperationType.Update);
  });

  it('SAPLint read actions require read scope', () => {
    for (const action of ['lint', 'lint_and_fix', 'list_rules', 'format', 'get_formatter_settings']) {
      const policy = getActionPolicy('SAPLint', action);
      expect(policy?.scope, `SAPLint.${action}`).toBe('read');
    }
  });

  it('CLASSIFICATION FIX: SAPManage.flp_list_* require read scope', () => {
    for (const action of ['flp_list_catalogs', 'flp_list_groups', 'flp_list_tiles']) {
      const policy = getActionPolicy('SAPManage', action);
      expect(policy?.scope, `SAPManage.${action}`).toBe('read');
    }
  });

  it('CLASSIFICATION FIX: SAPTransport.check/history require read scope', () => {
    expect(getActionPolicy('SAPTransport', 'check')?.scope).toBe('read');
    expect(getActionPolicy('SAPTransport', 'history')?.scope).toBe('read');
    expect(getActionPolicy('SAPTransport', 'list')?.scope).toBe('read');
    expect(getActionPolicy('SAPTransport', 'get')?.scope).toBe('read');
  });

  it('SAPTransport mutations require transports scope', () => {
    for (const action of ['create', 'release', 'release_recursive', 'reassign', 'delete']) {
      expect(getActionPolicy('SAPTransport', action)?.scope, `SAPTransport.${action}`).toBe('transports');
    }
  });

  it('SAPGit mutations require git scope', () => {
    for (const action of ['stage', 'clone', 'pull', 'push', 'commit', 'switch_branch', 'create_branch', 'unlink']) {
      expect(getActionPolicy('SAPGit', action)?.scope, `SAPGit.${action}`).toBe('git');
    }
  });

  it('SAPGit read actions require read scope', () => {
    for (const action of [
      'list_repos',
      'whoami',
      'config',
      'branches',
      'external_info',
      'history',
      'objects',
      'check',
    ]) {
      expect(getActionPolicy('SAPGit', action)?.scope, `SAPGit.${action}`).toBe('read');
    }
  });

  it('SAPQuery requires sql scope', () => {
    expect(getActionPolicy('SAPQuery')?.scope).toBe('sql');
  });

  it('SAPDiagnose.object_state requires only read scope', () => {
    const policy = getActionPolicy('SAPDiagnose', 'object_state');
    expect(policy?.scope).toBe('read');
    expect(policy?.opType).toBe(OperationType.Read);
    expect(hasRequiredScope(['read'], policy!.scope)).toBe(true);
  });

  it('hyperfocused mixed delegators are read-scoped; concrete sub-actions enforce mutations', () => {
    expect(getActionPolicy('SAP', 'transport')?.scope).toBe('read');
    expect(getActionPolicy('SAP', 'git')?.scope).toBe('read');
    expect(getActionPolicy('SAP', 'manage')?.scope).toBe('read');
  });

  it('SAPManage read actions require read scope', () => {
    for (const action of ['features', 'probe', 'cache_stats']) {
      expect(getActionPolicy('SAPManage', action)?.scope, `SAPManage.${action}`).toBe('read');
    }
  });

  it('SAPManage write actions require write scope', () => {
    for (const action of ['create_package', 'delete_package', 'change_package']) {
      expect(getActionPolicy('SAPManage', action)?.scope, `SAPManage.${action}`).toBe('write');
    }
  });

  it('SAPWrite.scaffold_rap_handlers has explicit entry with rap feature gate', () => {
    // Regression: after the authz refactor (commit 7be4ff0), every SAPWrite
    // action has its own entry so admins can target them individually in
    // SAP_DENY_ACTIONS. Without this entry, deny-actions startup validation
    // rejects `SAPWrite.scaffold_rap_handlers` as "matches no actions".
    const policy = getActionPolicy('SAPWrite', 'scaffold_rap_handlers');
    expect(policy?.scope).toBe('write');
    expect(policy?.opType).toBe(OperationType.Update);
    expect(policy?.featureGate).toBe('rap');
  });
});

describe('getActionPolicy', () => {
  it('returns specific key when present', () => {
    const policy = getActionPolicy('SAPRead', 'TABLE_CONTENTS');
    expect(policy?.scope).toBe('data');
  });

  it('falls back to tool-level default when specific absent', () => {
    const policy = getActionPolicy('SAPRead', 'PROG');
    expect(policy?.scope).toBe('read'); // falls back to SAPRead tool-level
  });

  it('returns tool-level when action is undefined', () => {
    const policy = getActionPolicy('SAPRead');
    expect(policy?.scope).toBe('read');
  });

  it('returns undefined for unknown tool', () => {
    expect(getActionPolicy('SAPFoo', 'bar')).toBeUndefined();
    expect(getActionPolicy('SAPFoo')).toBeUndefined();
  });
});

describe('expandScopes', () => {
  it('admin implies all 7 scopes', () => {
    const result = expandScopes(['admin']);
    expect(result).toContain('read');
    expect(result).toContain('write');
    expect(result).toContain('data');
    expect(result).toContain('sql');
    expect(result).toContain('transports');
    expect(result).toContain('git');
    expect(result).toContain('admin');
    expect(result.length).toBe(7);
  });

  it('write implies read', () => {
    const result = expandScopes(['write']);
    expect(result.sort()).toEqual(['read', 'write']);
  });

  it('sql implies data', () => {
    const result = expandScopes(['sql']);
    expect(result.sort()).toEqual(['data', 'sql']);
  });

  it('read alone does not imply others', () => {
    expect(expandScopes(['read'])).toEqual(['read']);
  });

  it('deduplicates repeated scopes', () => {
    expect(expandScopes(['read', 'read', 'write'])).toEqual(['read', 'write']);
  });

  it('empty input returns empty', () => {
    expect(expandScopes([])).toEqual([]);
  });
});

describe('hasRequiredScope', () => {
  it('admin satisfies every required scope', () => {
    const scopes = ['admin'];
    for (const req of ['read', 'write', 'data', 'sql', 'transports', 'git', 'admin'] as const) {
      expect(hasRequiredScope(scopes, req), `admin → ${req}`).toBe(true);
    }
  });

  it('write implies read', () => {
    expect(hasRequiredScope(['write'], 'read')).toBe(true);
  });

  it('sql implies data', () => {
    expect(hasRequiredScope(['sql'], 'data')).toBe(true);
  });

  it('read does not imply write', () => {
    expect(hasRequiredScope(['read'], 'write')).toBe(false);
  });

  it('write does not imply transports', () => {
    expect(hasRequiredScope(['write'], 'transports')).toBe(false);
  });

  it('write does not imply git', () => {
    expect(hasRequiredScope(['write'], 'git')).toBe(false);
  });

  it('combined scopes each match', () => {
    expect(hasRequiredScope(['read', 'transports'], 'transports')).toBe(true);
    expect(hasRequiredScope(['read', 'transports'], 'read')).toBe(true);
    expect(hasRequiredScope(['read', 'transports'], 'write')).toBe(false);
  });
});

describe('allPolicyKeys', () => {
  it('returns >70 entries (sanity check against inventory)', () => {
    expect(allPolicyKeys().length).toBeGreaterThan(70);
  });
});
