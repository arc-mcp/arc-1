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
  'SAPWrite.edit_method',
  'SAPActivate.activate',
  'SAPWrite.delete',
  'SAPLint.set_formatter_settings',
];
const validArguments = (tool: string, action?: string) =>
  tool === 'SAPLint' ? { action, style: 'none' } : { action, type: 'CLAS' };

describe('pinned mutation capability matrix', () => {
  it('pins the reviewed action, type, representation and raw-field contracts', () => {
    expect(PINNED_MUTATION_CAPABILITIES.map(({ accepts: _accepts, ...contract }) => contract)).toEqual([
      {
        tool: 'SAPWrite',
        action: 'create',
        resource: 'main-source',
        types: ['CLAS', 'INTF'],
        fields: ['action', 'type', 'name', 'source', 'transport', 'package', 'description'],
      },
      {
        tool: 'SAPWrite',
        action: 'update',
        resource: 'main-source',
        types: ['CLAS', 'INTF'],
        fields: ['action', 'type', 'name', 'source', 'transport', 'expectedSourceHash'],
      },
      {
        tool: 'SAPWrite',
        action: 'edit_method',
        resource: 'main-source',
        types: ['CLAS'],
        fields: ['action', 'type', 'name', 'source', 'transport', 'method', 'expectedSourceHash'],
      },
      {
        tool: 'SAPActivate',
        action: 'activate',
        resource: 'whole-owner',
        types: ['CLAS', 'INTF'],
        fields: ['action', 'type', 'name'],
      },
      {
        tool: 'SAPWrite',
        action: 'delete',
        resource: 'whole-owner',
        types: ['CLAS', 'INTF'],
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

  it('derives advertised actions, types and fields from the admitted combinations', () => {
    const tools = multiTargetToolDefinitions(getToolDefinitions(writer), writer);
    for (const name of ['SAPWrite', 'SAPActivate']) {
      const tool = tools.find((entry) => entry.name === name)!;
      const surface = pinnedMutationSurface(name, writer)!;
      const properties = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
      expect(properties.action.enum).toEqual(surface.actions);
      expect(properties.type.enum).toEqual(surface.types);
      expect(Object.keys(properties).sort()).toEqual([...surface.fields].sort());
      expect(tool.inputSchema.required).toEqual(
        name === 'SAPWrite' ? ['action', 'type', 'name', 'source'] : ['type', 'name'],
      );
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
      expect(pinnedMutationAllowed(entry.tool, { action: entry.action, type: 'PROG' }, writer)).toBe(false);
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
      expect(pinnedMutationAllowed('SAPWrite', { action: 'edit_method', method }, writer)).toBe(false);
    }
    expect(pinnedMutationAllowed('SAPActivate', { type: 'CLAS' }, writer)).toBe(true);
  });
});
