import { describe, expect, it, vi } from 'vitest';
import { getToolDefinitions, type ToolDefinition } from '../../../src/handlers/tools.js';
import {
  finalizeMultiTargetToolAnnotations,
  multiTargetInvocationDecision,
  multiTargetToolDefinitions,
} from '../../../src/server/multi-target-tools.js';
import { pinnedMutationAllowed } from '../../../src/server/multi-target-write-surface.js';
import type { PinnedMutationCapability } from '../../../src/server/pinned-mutation-capabilities.js';
import { filterToolsByAuthScope } from '../../../src/server/tool-auth.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';

// Exercise future adapter registration without admitting any of these operations in production.
// The real matrix's exact contract is checked separately in pinned-mutation-capabilities.test.ts.
vi.mock('../../../src/server/pinned-mutation-capabilities.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/server/pinned-mutation-capabilities.js')>();
  const fixtures: PinnedMutationCapability[] = [
    {
      tool: 'SAPManage',
      action: 'create_package',
      resource: 'package',
      fields: ['action', 'name', 'description', 'superPackage'],
      accepts: () => true,
    },
    {
      tool: 'SAPTransport',
      action: 'create',
      resource: 'cts',
      fields: ['action', 'description', 'target'],
      accepts: () => true,
    },
    {
      tool: 'SAPDiagnose',
      action: 'trace_start',
      resource: 'trace',
      fields: ['action', 'user'],
      accepts: (args) => args.user === undefined || args.user === 'TEST_USER',
    },
    {
      tool: 'SAPLint',
      action: 'set_formatter_settings',
      resource: 'settings',
      fields: ['action', 'indentation', 'style'],
      accepts: () => true,
    },
    // Neither a missing action policy nor a read policy is a mutation capability.
    { tool: 'SAPManage', action: 'unknown', resource: 'package', fields: ['action'], accepts: () => true },
    { tool: 'SAPManage', action: 'features', resource: 'package', fields: ['action'], accepts: () => true },
  ];
  return {
    ...actual,
    pinnedMutationCapability: (tool: string, action: unknown) =>
      fixtures.find((row) => row.tool === tool && row.action === action) ??
      actual.pinnedMutationCapability(tool, action),
    pinnedMutationToolSurface: (tool: string, enabled: (row: PinnedMutationCapability) => boolean) => {
      const rows = fixtures.filter((row) => row.tool === tool && enabled(row));
      if (!rows.length) return actual.pinnedMutationToolSurface(tool, enabled);
      return {
        actions: rows.map((row) => row.action),
        types: [],
        fields: new Set(rows.flatMap((row) => row.fields)),
      };
    },
  };
});

const writer: ServerConfig = {
  ...DEFAULT_CONFIG,
  allowWrites: true,
  allowTransportWrites: true,
  allowGitWrites: true,
  ppEnabled: true,
  ppStrict: true,
  multiTargetWrite: {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP'],
    allowedTransports: ['*'],
    serverAllowedTransports: ['*'],
  },
};
const cases = [
  ['SAPManage', { action: 'create_package', name: 'ZTEST', description: 'Test', superPackage: '$TMP' }],
  ['SAPTransport', { action: 'create', description: 'Test', target: 'QAS' }],
  ['SAPDiagnose', { action: 'trace_start', user: 'TEST_USER' }],
  ['SAPLint', { action: 'set_formatter_settings', indentation: true, style: 'keywordUpper' }],
] as const;

function actions(tool: ToolDefinition): string[] {
  return (tool.inputSchema.properties as Record<string, { enum: string[] }>).action.enum;
}
function catalog(config = writer, scopes = ['read', 'write', 'transports'], denied: string[] = []) {
  return finalizeMultiTargetToolAnnotations(
    filterToolsByAuthScope(multiTargetToolDefinitions(getToolDefinitions(config), config), scopes, denied),
  );
}

describe('mixed-tool pinned admission plumbing (synthetic capability registration)', () => {
  it.each(cases)('applies the explicit raw-field contract to %s', (tool, args) => {
    expect(multiTargetInvocationDecision(tool, args, writer)).toBe('allowed');
    for (const extra of [{ recursive: true }, { objects: [] }, { type: 'CLAS' }, { unexpected: 'value' }]) {
      expect(multiTargetInvocationDecision(tool, { ...args, ...extra }, writer)).toBe('forbidden');
    }
    if (tool !== 'SAPTransport') {
      expect(multiTargetInvocationDecision(tool, { ...args, target: 'OTHER/001' }, writer)).toBe('forbidden');
    }
  });

  it.each(['allowWrites', 'ppEnabled', 'ppStrict', 'absent-context', 'disabled-context'] as const)(
    'keeps every mutation unavailable without %s',
    (gate) => {
      const config: ServerConfig =
        gate === 'absent-context'
          ? { ...writer, multiTargetWrite: undefined }
          : gate === 'disabled-context'
            ? { ...writer, multiTargetWrite: { ...writer.multiTargetWrite!, enabled: false } }
            : { ...writer, [gate]: false };
      const tools = catalog(config);
      for (const [name, args] of cases) {
        expect(multiTargetInvocationDecision(name, args, config)).toBe('forbidden');
        const tool = tools.find((entry) => entry.name === name);
        if (tool) {
          expect(actions(tool)).not.toContain(args.action);
          expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
        }
      }
      expect(tools.some((tool) => tool.name === 'SAPManage')).toBe(false);
    },
  );

  it('requires the exact mutating policy and the adapter input validator', () => {
    for (const action of ['unknown', 'features']) {
      expect(pinnedMutationAllowed('SAPManage', { action }, writer)).toBe(false);
      expect(multiTargetInvocationDecision('SAPManage', { action }, writer)).toBe('forbidden');
    }
    expect(multiTargetInvocationDecision('SAPDiagnose', { action: 'trace_start', user: '*' }, writer)).toBe(
      'forbidden',
    );
  });

  it('retains the transport-specific global switch independently of write access', () => {
    const config = { ...writer, allowTransportWrites: false };
    expect(multiTargetInvocationDecision('SAPTransport', cases[1][1], config)).toBe('forbidden');
    const transport = catalog(config).find((tool) => tool.name === 'SAPTransport')!;
    expect(actions(transport)).toEqual(['list', 'get', 'diff', 'check', 'history']);
    expect(transport.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(transport.inputSchema.properties).not.toHaveProperty('description');
    expect(transport.inputSchema.properties).not.toHaveProperty('target');
    expect(multiTargetInvocationDecision('SAPManage', cases[0][1], config)).toBe('allowed');
  });

  it('combines existing reads and admitted mutations without exposing other actions or fields', () => {
    const tools = catalog();
    for (const [name, args] of cases) {
      const tool = tools.find((entry) => entry.name === name)!;
      expect(actions(tool)).toContain(args.action);
      expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false });
      for (const key of Object.keys(args)) expect(tool.inputSchema.properties).toHaveProperty(key);
    }
    const manage = tools.find((tool) => tool.name === 'SAPManage')!;
    expect(actions(manage)).toEqual(['create_package']);
    expect(Object.keys(manage.inputSchema.properties!)).toEqual(['action', 'name', 'description', 'superPackage']);
    expect(actions(tools.find((tool) => tool.name === 'SAPLint')!)).toEqual([
      'lint',
      'lint_and_fix',
      'list_rules',
      'format',
      'get_formatter_settings',
      'set_formatter_settings',
    ]);
    const transport = tools.find((tool) => tool.name === 'SAPTransport')!;
    expect(actions(transport)).toContain('list');
    expect(actions(transport)).not.toContain('release');
    expect(actions(transport)).not.toContain('layers');
    expect(transport.inputSchema.properties).not.toHaveProperty('removeLockedObjects');
  });

  it('recomputes annotations after functional-scope pruning without restoring removed actions', () => {
    const readOnly = catalog(writer, ['read']);
    expect(readOnly.some((tool) => tool.name === 'SAPManage')).toBe(false);
    for (const [name, args] of cases.slice(1)) {
      const tool = readOnly.find((entry) => entry.name === name)!;
      expect(actions(tool)).not.toContain(args.action);
      expect(tool.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    }
    const noTransportScope = catalog(writer, ['read', 'write']);
    const transport = noTransportScope.find((tool) => tool.name === 'SAPTransport')!;
    expect(actions(transport)).not.toContain('create');
    expect(transport.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(noTransportScope.find((tool) => tool.name === 'SAPManage')!.annotations!.readOnlyHint).toBe(false);
  });

  it('recomputes annotations after per-action denial and retains remaining mutations', () => {
    const tools = catalog(
      writer,
      ['read', 'write', 'transports'],
      ['SAPTransport.create', 'SAPDiagnose.trace_start', 'SAPManage.create_package', 'SAPWrite.create'],
    );
    expect(tools.some((tool) => tool.name === 'SAPManage')).toBe(false);
    for (const name of ['SAPTransport', 'SAPDiagnose']) {
      expect(tools.find((tool) => tool.name === name)!.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
      });
    }
    const write = tools.find((tool) => tool.name === 'SAPWrite')!;
    expect(actions(write)).toEqual([
      'edit_text_symbols',
      'update',
      'edit_unit',
      'add_unit',
      'edit_method',
      'edit_class_definition',
      'edit_method_signature',
      'add_method',
      'delete_method',
      'change_method_visibility',
      'delete',
    ]);
    expect(write.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it('never admits Git or custom tools through permissive global switches', () => {
    expect(multiTargetInvocationDecision('SAPGit', { action: 'pull' }, writer)).toBe('forbidden');
    expect(multiTargetInvocationDecision('Custom_write', { action: 'create' }, writer)).toBe('forbidden');
    expect(catalog().some((tool) => tool.name === 'SAPGit')).toBe(false);
  });
});
