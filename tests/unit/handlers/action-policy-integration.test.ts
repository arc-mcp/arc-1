/**
 * Integration tests verifying ACTION_POLICY is correctly wired into handleToolCall
 * and filterToolsByAuthScope. These tests are the behavioral validation that the six
 * classification bugs from the authz-refactor-v2 plan are actually fixed end-to-end.
 */
import { describe, expect, it, vi } from 'vitest';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { featuresOff } from './handler-test-config.js';

const mockFetch = vi.fn();
vi.mock('undici', async (importOriginal) => {
  const actual = await importOriginal<typeof import('undici')>();
  return { ...actual, fetch: mockFetch };
});

const { AdtClient } = await import('../../../src/adt/client.js');
const { unrestrictedSafetyConfig } = await import('../../../src/adt/safety.js');
const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { setCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const { getToolDefinitions } = await import('../../../src/handlers/tools.js');
const { filterToolsByAuthScope } = await import('../../../src/server/server.js');
const { DEFAULT_CONFIG } = await import('../../../src/server/types.js');

function createClient() {
  mockFetch.mockResolvedValue(mockResponse(200, 'ok', { 'x-csrf-token': 'T' }));
  return new AdtClient({
    baseUrl: 'http://sap:8000',
    username: 'admin',
    password: 'secret',
    safety: unrestrictedSafetyConfig(),
  });
}

function readAuth() {
  return {
    token: 'test',
    clientId: 'test',
    scopes: ['read'],
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
}

function writeAuth() {
  return {
    token: 'test',
    clientId: 'test',
    scopes: ['read', 'write'],
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
}

function dataAuth() {
  return {
    ...readAuth(),
    scopes: ['read', 'data'],
  };
}

function transportsAuth() {
  return {
    token: 'test',
    clientId: 'test',
    scopes: ['read', 'write', 'transports'],
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
}

function gitAuth() {
  return {
    token: 'test',
    clientId: 'test',
    scopes: ['read', 'write', 'git'],
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  };
}

describe('ACTION_POLICY runtime integration — classification bug fixes', () => {
  describe('SAPDiagnose.authorization_trace requires data scope', () => {
    it('blocks a read-only user before querying SAP', async () => {
      const result = await handleToolCall(
        createClient(),
        { ...DEFAULT_CONFIG, allowDataPreview: true },
        'SAPDiagnose',
        { action: 'authorization_trace' },
        readAuth(),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/Insufficient scope: 'data'/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('allows a data-scoped user to reach the implementation', async () => {
      const client = createClient();
      vi.spyOn(client, 'runTableQuery').mockResolvedValue({ columns: [], rows: [] });

      const result = await handleToolCall(
        client,
        { ...DEFAULT_CONFIG, allowDataPreview: true },
        'SAPDiagnose',
        { action: 'authorization_trace' },
        dataAuth(),
      );

      expect(result.content[0]?.text).not.toMatch(/Insufficient scope/);
      expect(result.isError).toBeUndefined();
    });
  });

  describe('Bug fix #1: SAPLint.set_formatter_settings requires write scope', () => {
    it('read user is blocked with scope error mentioning write', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPLint',
        { action: 'set_formatter_settings', indentation: true },
        readAuth(),
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/Insufficient scope: 'write'/);
    });

    it('write user passes scope check (proceeds to implementation)', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPLint',
        { action: 'set_formatter_settings', indentation: true },
        writeAuth(),
      );
      // May fail for other reasons (backend call), but not scope.
      expect(result.content[0]?.text).not.toMatch(/Insufficient scope/);
    });

    it('read user CAN call SAPLint.get_formatter_settings (read action)', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPLint',
        { action: 'get_formatter_settings' },
        readAuth(),
      );
      expect(result.content[0]?.text).not.toMatch(/Insufficient scope/);
    });
  });

  describe('Bug fix #2: SAPManage.flp_list_* accepts read scope', () => {
    it('read user can call flp_list_catalogs', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPManage',
        { action: 'flp_list_catalogs' },
        readAuth(),
      );
      expect(result.content[0]?.text).not.toMatch(/Insufficient scope/);
    });

    it('read user can call flp_list_groups', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPManage',
        { action: 'flp_list_groups' },
        readAuth(),
      );
      expect(result.content[0]?.text).not.toMatch(/Insufficient scope/);
    });

    it('read user can call flp_list_tiles', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPManage',
        { action: 'flp_list_tiles', catalogId: 'TEST' },
        readAuth(),
      );
      expect(result.content[0]?.text).not.toMatch(/Insufficient scope/);
    });

    it('read user is blocked on flp_create_catalog (write)', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPManage',
        { action: 'flp_create_catalog', catalogId: 'TEST', title: 'T' },
        readAuth(),
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/Insufficient scope: 'write'/);
    });
  });

  describe('Bug fix #3: SAPTransport.check/history/list/get accept read scope', () => {
    it('read user can call SAPTransport.check', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPTransport',
        { action: 'check', name: 'ZTEST', type: 'PROG', package: '$TMP' },
        readAuth(),
      );
      expect(result.content[0]?.text).not.toMatch(/Insufficient scope/);
    });

    it('read user can call SAPTransport.history', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPTransport',
        { action: 'history', name: 'ZTEST', type: 'PROG' },
        readAuth(),
      );
      expect(result.content[0]?.text).not.toMatch(/Insufficient scope/);
    });

    it('read user can call SAPTransport.list', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPTransport',
        { action: 'list' },
        readAuth(),
      );
      expect(result.content[0]?.text).not.toMatch(/Insufficient scope/);
    });

    it('write user WITHOUT transports scope is blocked on SAPTransport.create', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPTransport',
        { action: 'create', description: 'Test' },
        writeAuth(),
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/Insufficient scope: 'transports'/);
    });

    it('user with transports scope CAN create', async () => {
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPTransport',
        { action: 'create', description: 'Test' },
        transportsAuth(),
      );
      expect(result.content[0]?.text).not.toMatch(/Insufficient scope/);
    });
  });

  describe('Bug fix #4/5/6: SAPGit requires git scope for writes (not plain write)', () => {
    it('write user WITHOUT git scope is blocked on SAPGit.clone', async () => {
      setCachedFeatures(featuresOff({ gcts: true }));
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPGit',
        { action: 'clone', backend: 'gcts', url: 'https://github.com/x/y.git', package: '$TMP' },
        writeAuth(),
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toMatch(/Insufficient scope: 'git'/);
    });

    it('user with git scope CAN clone', async () => {
      setCachedFeatures(featuresOff({ gcts: true }));
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPGit',
        { action: 'clone', backend: 'gcts', url: 'https://github.com/x/y.git', package: '$TMP' },
        gitAuth(),
      );
      expect(result.content[0]?.text).not.toMatch(/Insufficient scope/);
    });

    it('read user can still call SAPGit.list_repos (read action)', async () => {
      setCachedFeatures(featuresOff({ gcts: true }));
      const result = await handleToolCall(
        createClient(),
        DEFAULT_CONFIG,
        'SAPGit',
        { action: 'list_repos' },
        readAuth(),
      );
      expect(result.content[0]?.text).not.toMatch(/Insufficient scope/);
    });
  });
});

describe('ACTION_POLICY runtime integration — SAP_DENY_ACTIONS enforcement', () => {
  it('denied action returns specific error with pattern name', async () => {
    const config = { ...DEFAULT_CONFIG, denyActions: ['SAPWrite.delete'] };
    const result = await handleToolCall(
      createClient(),
      config,
      'SAPWrite',
      { action: 'delete', type: 'PROG', name: 'ZTEST' },
      writeAuth(),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/denied by server policy.*SAP_DENY_ACTIONS/);
  });

  it('non-denied sibling action still works', async () => {
    const config = { ...DEFAULT_CONFIG, denyActions: ['SAPWrite.delete'] };
    const result = await handleToolCall(
      createClient(),
      config,
      'SAPWrite',
      { action: 'create', type: 'PROG', name: 'ZTEST', source: 'report ztest.' },
      writeAuth(),
    );
    expect(result.content[0]?.text).not.toMatch(/denied by server policy/);
  });

  it('glob pattern denies matching actions', async () => {
    const config = { ...DEFAULT_CONFIG, denyActions: ['SAPManage.flp_*'] };
    const result = await handleToolCall(
      createClient(),
      config,
      'SAPManage',
      { action: 'flp_list_catalogs' },
      readAuth(),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/denied by server policy/);
  });

  it('tool-level deny blocks everything for that tool', async () => {
    const config = { ...DEFAULT_CONFIG, denyActions: ['SAPGit'] };
    setCachedFeatures(featuresOff({ gcts: true }));
    const result = await handleToolCall(createClient(), config, 'SAPGit', { action: 'list_repos' }, readAuth());
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/denied by server policy/);
  });
});

describe('ACTION_POLICY runtime integration — hyperfocused delegates enforce concrete actions', () => {
  it('read user can call SAP(action=transport) for a read transport sub-action', async () => {
    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAP',
      { action: 'transport', params: { action: 'check', name: 'ZTEST', type: 'PROG', package: '$TMP' } },
      readAuth(),
    );
    expect(result.content[0]?.text).not.toMatch(/Insufficient scope/);
  });

  it('read user is blocked by the concrete SAPTransport.create policy after delegation', async () => {
    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAP',
      { action: 'transport', params: { action: 'create', description: 'Test' } },
      readAuth(),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/Insufficient scope: 'transports'/);
  });

  it('read user can call SAP(action=manage) for a read FLP list sub-action', async () => {
    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAP',
      { action: 'manage', params: { action: 'flp_list_catalogs' } },
      readAuth(),
    );
    expect(result.content[0]?.text).not.toMatch(/Insufficient scope/);
  });
});

describe('ACTION_POLICY runtime integration — type-level pruning in tool listing', () => {
  it('prunes authorization_trace for read-only users and preserves it for data scope', () => {
    const tools = getToolDefinitions({
      ...DEFAULT_CONFIG,
      allowDataPreview: true,
    });
    const readOnlyTools = filterToolsByAuthScope(tools, ['read']);
    const dataTools = filterToolsByAuthScope(tools, ['read', 'data']);
    const readOnlyActions = (
      readOnlyTools.find((tool) => tool.name === 'SAPDiagnose')!.inputSchema as Record<string, any>
    ).properties.action.enum as string[];
    const dataActions = (dataTools.find((tool) => tool.name === 'SAPDiagnose')!.inputSchema as Record<string, any>)
      .properties.action.enum as string[];

    expect(readOnlyActions).not.toContain('authorization_trace');
    expect(dataActions).toContain('authorization_trace');
  });

  it('SAPRead TABLE_CONTENTS type is pruned when user lacks data scope', () => {
    const tools = getToolDefinitions({
      ...DEFAULT_CONFIG,
      allowWrites: true,
      allowDataPreview: true,
    });
    const filtered = filterToolsByAuthScope(tools, ['read']);
    const sapRead = filtered.find((t) => t.name === 'SAPRead');
    expect(sapRead).toBeDefined();
    const typeEnum = (sapRead!.inputSchema as Record<string, any>).properties.type.enum as string[];
    // PROG etc. still present
    expect(typeEnum).toContain('PROG');
    expect(typeEnum).toContain('CLAS');
    // TABLE_CONTENTS is pruned for read-only users
    expect(typeEnum).not.toContain('TABLE_CONTENTS');
  });

  it('SAPRead TABLE_CONTENTS stays when user has data scope', () => {
    const tools = getToolDefinitions({
      ...DEFAULT_CONFIG,
      allowWrites: true,
      allowDataPreview: true,
    });
    const filtered = filterToolsByAuthScope(tools, ['read', 'data']);
    const sapRead = filtered.find((t) => t.name === 'SAPRead');
    expect(sapRead).toBeDefined();
    const typeEnum = (sapRead!.inputSchema as Record<string, any>).properties.type.enum as string[];
    expect(typeEnum).toContain('TABLE_CONTENTS');
  });

  it('SAPRead TABLE_QUERY type is pruned when user lacks data scope', () => {
    const tools = getToolDefinitions({
      ...DEFAULT_CONFIG,
      allowWrites: true,
      allowDataPreview: true,
    });
    const filtered = filterToolsByAuthScope(tools, ['read']);
    const sapRead = filtered.find((t) => t.name === 'SAPRead');
    expect(sapRead).toBeDefined();
    const typeEnum = (sapRead!.inputSchema as Record<string, any>).properties.type.enum as string[];
    expect(typeEnum).not.toContain('TABLE_QUERY');
  });

  it('SAPRead TABLE_QUERY stays when user has data scope', () => {
    const tools = getToolDefinitions({
      ...DEFAULT_CONFIG,
      allowWrites: true,
      allowDataPreview: true,
    });
    const filtered = filterToolsByAuthScope(tools, ['read', 'data']);
    const sapRead = filtered.find((t) => t.name === 'SAPRead');
    expect(sapRead).toBeDefined();
    const typeEnum = (sapRead!.inputSchema as Record<string, any>).properties.type.enum as string[];
    expect(typeEnum).toContain('TABLE_QUERY');
  });
});

describe('ACTION_POLICY runtime integration — admin-implies-all', () => {
  it('admin scope alone satisfies write scope requirement', async () => {
    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAPLint',
      { action: 'set_formatter_settings', indentation: true },
      { ...readAuth(), scopes: ['admin'] },
    );
    expect(result.content[0]?.text).not.toMatch(/Insufficient scope/);
  });

  it('admin scope alone satisfies transports scope requirement', async () => {
    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAPTransport',
      { action: 'create', description: 'Test' },
      { ...readAuth(), scopes: ['admin'] },
    );
    expect(result.content[0]?.text).not.toMatch(/Insufficient scope/);
  });

  it('admin scope alone satisfies git scope requirement', async () => {
    setCachedFeatures(featuresOff({ gcts: true }));
    const result = await handleToolCall(
      createClient(),
      DEFAULT_CONFIG,
      'SAPGit',
      { action: 'clone', backend: 'gcts', url: 'https://x/y.git', package: '$TMP' },
      { ...readAuth(), scopes: ['admin'] },
    );
    expect(result.content[0]?.text).not.toMatch(/Insufficient scope/);
  });
});
