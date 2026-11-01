import { describe, expect, it } from 'vitest';
import { ACTION_POLICY } from '../../../src/authz/policy.js';
import { getToolDefinitions } from '../../../src/handlers/tools.js';
import { multiTargetInvocationDecision, multiTargetToolDefinitions } from '../../../src/server/multi-target-tools.js';
import { pinnedMutationAllowed, pinnedMutationSurface } from '../../../src/server/multi-target-write-surface.js';
import { PINNED_MUTATION_CAPABILITIES } from '../../../src/server/pinned-mutation-capabilities.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const writer = {
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
const admitted = [
  'SAPWrite.create',
  'SAPWrite.update',
  'SAPWrite.edit_unit',
  'SAPWrite.add_unit',
  'SAPWrite.edit_method',
  'SAPWrite.edit_class_definition',
  'SAPWrite.edit_method_signature',
  'SAPWrite.add_method',
  'SAPWrite.delete_method',
  'SAPWrite.change_method_visibility',
  'SAPActivate.activate',
  'SAPWrite.delete',
  'SAPLint.set_formatter_settings',
];
const validArguments = (tool: string, action?: string) =>
  tool === 'SAPLint'
    ? { action, style: 'none' }
    : { action, type: action === 'edit_unit' || action === 'add_unit' ? 'PROG' : 'CLAS' };

describe('pinned mutation capability matrix', () => {
  it('pins the reviewed action, type, representation and raw-field contracts', () => {
    expect(PINNED_MUTATION_CAPABILITIES.map(({ accepts: _accepts, ...contract }) => contract)).toEqual([
      {
        tool: 'SAPWrite',
        action: 'create',
        resource: 'repository-source',
        types: ['CLAS', 'INTF', 'PROG', 'INCL'],
        fields: ['action', 'type', 'name', 'source', 'transport', 'package', 'description'],
      },
      {
        tool: 'SAPWrite',
        action: 'update',
        resource: 'repository-source',
        types: ['CLAS', 'INTF', 'PROG', 'INCL'],
        fields: ['action', 'type', 'name', 'source', 'transport', 'expectedSourceHash', 'include'],
      },
      ...['edit_unit', 'add_unit'].map((action) => ({
        tool: 'SAPWrite',
        action,
        resource: 'repository-source',
        types: ['PROG', 'INCL'],
        fields: ['action', 'type', 'name', 'source', 'transport', 'unit', 'expectedSourceHash'],
      })),
      {
        tool: 'SAPWrite',
        action: 'edit_method',
        resource: 'repository-source',
        types: ['CLAS'],
        fields: ['action', 'type', 'name', 'source', 'transport', 'method', 'expectedSourceHash', 'include'],
      },
      {
        tool: 'SAPWrite',
        action: 'edit_class_definition',
        resource: 'repository-source',
        types: ['CLAS'],
        fields: ['action', 'type', 'name', 'transport', 'expectedSourceHash', 'source', 'include'],
      },
      {
        tool: 'SAPWrite',
        action: 'edit_method_signature',
        resource: 'repository-source',
        types: ['CLAS'],
        fields: ['action', 'type', 'name', 'transport', 'expectedSourceHash', 'source', 'method'],
      },
      {
        tool: 'SAPWrite',
        action: 'add_method',
        resource: 'repository-source',
        types: ['CLAS'],
        fields: ['action', 'type', 'name', 'transport', 'expectedSourceHash', 'method', 'visibility', 'abstract'],
      },
      {
        tool: 'SAPWrite',
        action: 'delete_method',
        resource: 'repository-source',
        types: ['CLAS'],
        fields: ['action', 'type', 'name', 'transport', 'expectedSourceHash', 'method'],
      },
      {
        tool: 'SAPWrite',
        action: 'change_method_visibility',
        resource: 'repository-source',
        types: ['CLAS'],
        fields: ['action', 'type', 'name', 'transport', 'expectedSourceHash', 'method', 'visibility'],
      },
      {
        tool: 'SAPActivate',
        action: 'activate',
        resource: 'whole-owner',
        types: ['CLAS', 'INTF', 'PROG', 'INCL'],
        fields: ['action', 'type', 'name'],
      },
      {
        tool: 'SAPWrite',
        action: 'delete',
        resource: 'whole-owner',
        types: ['CLAS', 'INTF', 'PROG', 'INCL'],
        fields: ['action', 'type', 'name', 'transport'],
      },
      {
        tool: 'SAPLint',
        action: 'set_formatter_settings',
        resource: 'settings',
        fields: ['action', 'indentation', 'style'],
      },
    ]);
  });

  it('admits every reviewed per-action field through the public invocation decision', () => {
    const source = { name: 'ZARC1_CAPABILITY', source: 'source', transport: 'A4HK900001' };
    const expectedSourceHash = 'a'.repeat(64);
    for (const type of ['CLAS', 'INTF']) {
      expect(
        multiTargetInvocationDecision(
          'SAPWrite',
          {
            ...source,
            type,
            action: 'create',
            package: '$TMP',
            description: 'Qualification fixture',
          },
          writer,
        ),
      ).toBe('allowed');
      expect(
        multiTargetInvocationDecision(
          'SAPWrite',
          {
            ...source,
            type,
            action: 'update',
            expectedSourceHash,
          },
          writer,
        ),
      ).toBe('allowed');
      expect(
        multiTargetInvocationDecision(
          'SAPActivate',
          {
            name: source.name,
            type,
            action: 'activate',
          },
          writer,
        ),
      ).toBe('allowed');
    }
    expect(
      multiTargetInvocationDecision(
        'SAPWrite',
        {
          ...source,
          type: 'CLAS',
          action: 'edit_method',
          method: 'VALUE',
          expectedSourceHash,
        },
        writer,
      ),
    ).toBe('allowed');
  });

  it('requires an explicit disposition before any additional single-target mutation is admitted', () => {
    expect(PINNED_MUTATION_CAPABILITIES.map((entry) => `${entry.tool}.${entry.action}`)).toEqual(admitted);
    for (const [key, policy] of Object.entries(ACTION_POLICY)) {
      if (!['C', 'U', 'D', 'A', 'W', 'X'].includes(policy.opType)) continue;
      const [tool, action] = key.split('.');
      expect(multiTargetInvocationDecision(tool, validArguments(tool, action), writer), key).toBe(
        admitted.includes(key) || key === 'SAPActivate' ? 'allowed' : 'forbidden',
      );
    }
    expect(multiTargetInvocationDecision('Custom_write', { action: 'create', type: 'CLAS' }, writer)).toBe('forbidden');
  });

  it.each(['allowWrites', 'ppEnabled', 'ppStrict', 'disabled-context', 'absent-context'] as const)(
    'removes every mutation from invocation and advertisement when %s is absent',
    (gate) => {
      const config =
        gate === 'disabled-context'
          ? { ...writer, multiTargetWrite: { ...writer.multiTargetWrite, enabled: false } }
          : gate === 'absent-context'
            ? { ...writer, multiTargetWrite: undefined }
            : { ...writer, [gate]: false };
      for (const entry of PINNED_MUTATION_CAPABILITIES) {
        expect(pinnedMutationAllowed(entry.tool, validArguments(entry.tool, entry.action), config)).toBe(false);
        expect(pinnedMutationSurface(entry.tool, config)).toBeUndefined();
      }
    },
  );

  it('admits existing procedural sources only on on-premise targets', () => {
    for (const type of ['PROG', 'INCL']) {
      for (const action of ['update', 'edit_unit', 'add_unit']) {
        const args = {
          action,
          type,
          name: 'ZARC1_PROGRAM',
          source: 'FORM selected. ENDFORM.',
          expectedSourceHash: 'a'.repeat(64),
          ...(action === 'update' ? {} : { unit: 'selected' }),
        };
        expect(multiTargetInvocationDecision('SAPWrite', args, writer)).toBe('allowed');
        expect(multiTargetInvocationDecision('SAPWrite', args, { ...writer, systemType: 'btp' })).toBe('forbidden');
      }
      for (const action of ['edit_method'])
        expect(pinnedMutationAllowed('SAPWrite', { action, type }, writer)).toBe(false);
      expect(pinnedMutationAllowed('SAPWrite', { action: 'delete', type }, writer)).toBe(true);
      expect(pinnedMutationAllowed('SAPWrite', { action: 'delete', type }, { ...writer, systemType: 'btp' })).toBe(
        false,
      );
      expect(pinnedMutationAllowed('SAPActivate', { type }, writer)).toBe(true);
      expect(pinnedMutationAllowed('SAPActivate', { type }, { ...writer, systemType: 'btp' })).toBe(false);
      expect(pinnedMutationAllowed('SAPWrite', { action: 'create', type }, writer)).toBe(true);
      expect(pinnedMutationAllowed('SAPWrite', { action: 'create', type }, { ...writer, systemType: 'btp' })).toBe(
        false,
      );
    }
    const surface = pinnedMutationSurface('SAPWrite', { ...writer, systemType: 'btp' })!;
    expect(surface.types).toEqual(['CLAS', 'INTF']);
    expect(surface.actions).not.toContain('edit_unit');
    expect(surface.actions).not.toContain('add_unit');
    expect(surface.fields.has('unit')).toBe(false);
    const defensiveConfig = { ...writer, systemType: 'btp' as const };
    const tool = multiTargetToolDefinitions(getToolDefinitions(defensiveConfig), defensiveConfig).find(
      (entry) => entry.name === 'SAPWrite',
    )!;
    expect(tool.description).not.toMatch(/PROG|INCL|edit_unit|add_unit/);
    expect(JSON.stringify((tool.inputSchema.properties as Record<string, unknown>).source)).not.toMatch(
      /PROG|INCL|edit_unit|add_unit/,
    );
  });

  it('derives advertised actions, types and fields from the admitted combinations', () => {
    const tools = multiTargetToolDefinitions(getToolDefinitions(writer), writer);
    for (const name of ['SAPWrite', 'SAPActivate']) {
      const tool = tools.find((entry) => entry.name === name)!;
      const surface = pinnedMutationSurface(name, writer)!;
      const properties = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
      expect(properties.action.enum).toEqual(surface.actions);
      expect(properties.type.enum).toEqual(surface.types);
      expect(Object.keys(properties).sort()).toEqual([...surface.fields].sort());
      expect(tool.inputSchema.required).toEqual(name === 'SAPWrite' ? ['action', 'type', 'name'] : ['type', 'name']);
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    }
  });

  it('refuses action-specific fields before schemas can strip them', () => {
    for (const entry of PINNED_MUTATION_CAPABILITIES) {
      for (const field of ['target', 'include', 'objects', 'recursive', 'responsible', 'activate']) {
        expect(
          pinnedMutationAllowed(
            entry.tool,
            { ...validArguments(entry.tool, entry.action), [field]: { nested: true } },
            writer,
          ),
        ).toBe(false);
      }
      expect(pinnedMutationAllowed(entry.tool, { action: entry.action, type: 'TABL' }, writer)).toBe(false);
    }
    for (const action of ['update', 'edit_method']) {
      expect(pinnedMutationAllowed('SAPWrite', { action, package: '$TMP' }, writer)).toBe(false);
      expect(pinnedMutationAllowed('SAPWrite', { action, description: 'ignored' }, writer)).toBe(false);
    }
    expect(pinnedMutationAllowed('SAPWrite', { action: 'create', expectedSourceHash: 'hash' }, writer)).toBe(false);
    expect(pinnedMutationAllowed('SAPWrite', { action: 'create', method: 'VALUE' }, writer)).toBe(false);
    expect(pinnedMutationAllowed('SAPWrite', { action: 'update', method: 'VALUE' }, writer)).toBe(false);
    expect(pinnedMutationAllowed('SAPWrite', { action: 'edit_method', type: 'INTF' }, writer)).toBe(false);
    for (const method of [
      'lhc_local~save',
      'lcl_local~save',
      'ltc_local~save',
      'LHC_LOCAL~SAVE',
      'LCL_LOCAL~SAVE',
      'LTC_LOCAL~SAVE',
    ]) {
      expect(pinnedMutationAllowed('SAPWrite', { action: 'edit_method', type: 'CLAS', method }, writer)).toBe(true);
    }
    expect(pinnedMutationAllowed('SAPActivate', { type: 'CLAS' }, writer)).toBe(true);
  });

  it.each(['update', 'edit_method', 'edit_class_definition'])(
    'limits %s includes to the four explicit CLAS selectors',
    (selectedAction) => {
      for (const include of ['definitions', 'implementations', 'macros', 'testclasses']) {
        const args = { action: selectedAction, type: 'CLAS', include };
        expect(pinnedMutationAllowed('SAPWrite', args, writer)).toBe(true);
        for (const type of ['INTF', 'PROG', undefined])
          expect(pinnedMutationAllowed('SAPWrite', { ...args, type }, writer)).toBe(false);
        for (const action of ['create', 'delete', 'edit_method_signature'])
          expect(pinnedMutationAllowed('SAPWrite', { ...args, action }, writer)).toBe(false);
        expect(pinnedMutationAllowed('SAPWrite', args, { ...writer, allowWrites: false })).toBe(false);
        expect(pinnedMutationAllowed('SAPWrite', args, { ...writer, ppStrict: false })).toBe(false);
      }
      for (const include of ['main', 'text_symbols', 'DEFINITIONS', '../source/main'])
        expect(pinnedMutationAllowed('SAPWrite', { action: selectedAction, type: 'CLAS', include }, writer)).toBe(
          false,
        );
    },
  );
});
