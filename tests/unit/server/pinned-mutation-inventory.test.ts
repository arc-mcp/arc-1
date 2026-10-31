import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SDO_TYPES } from '../../../src/adt/server-driven.js';
import { ACTION_POLICY } from '../../../src/authz/policy.js';
import { normalizeWriteObjectType, SLASH_TYPE_MAP } from '../../../src/handlers/object-types.js';
import { getToolSchema } from '../../../src/handlers/schemas.js';
import { SAPWRITE_TYPES_ONPREM } from '../../../src/handlers/tool-registry.js';
import { isMultiTargetInvocationAllowed } from '../../../src/server/multi-target-tools.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

const inventory = JSON.parse(
  readFileSync(new URL('../../../docs/research/broader-pinned-pp-writes/inventory.json', import.meta.url), 'utf8'),
) as {
  actions: Record<string, { scope: string; operation: string; disposition: string }>;
  types: Record<string, { family: string }>;
  aliases: Record<string, string>;
  fields: Record<string, string[]>;
  actionLists: Record<string, string[]>;
};

const nestedInputs = JSON.parse(
  readFileSync(
    new URL('../../../docs/research/broader-pinned-pp-writes/nested-input-contracts.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

describe('PR 2 review inventory drift guard (not runtime authorization)', () => {
  it('keeps hyperfocused SAP aliases out of every multi-target invocation', () => {
    for (const key of Object.keys(ACTION_POLICY).filter((key) => key.startsWith('SAP.')))
      expect(isMultiTargetInvocationAllowed('SAP', { action: key.slice(4) }, DEFAULT_CONFIG), key).toBe(false);
  });
  it('requires a disposition for every built-in mutation, including excluded Git and tool defaults', () => {
    const mutations = Object.entries(ACTION_POLICY).filter(
      ([key, policy]) => !key.startsWith('SAP.') && ['C', 'U', 'D', 'A', 'W', 'X'].includes(policy.opType),
    );
    expect(Object.keys(inventory.actions).sort()).toEqual(mutations.map(([key]) => key).sort());
    for (const [key, policy] of mutations) {
      expect(inventory.actions[key]).toMatchObject({ scope: policy.scope, operation: policy.opType });
      expect(inventory.actions[key].disposition).toBeTruthy();
      if (key.startsWith('SAPGit.')) expect(inventory.actions[key].disposition).toBe('excluded');
    }
  });

  it('requires explicit review when a write type or generated SDO type changes', () => {
    expect(Object.keys(inventory.types).sort()).toEqual([...SAPWRITE_TYPES_ONPREM].sort());
    expect(
      Object.entries(inventory.types)
        .filter(([, entry]) => entry.family === 'server-driven')
        .map(([key]) => key)
        .sort(),
    ).toEqual([...SDO_TYPES].sort());
  });

  it('tracks write-relevant slash aliases with the write-specific subtype normalizer', () => {
    const writeTypes = new Set<string>(SAPWRITE_TYPES_ONPREM);
    const aliases = Object.fromEntries(
      Object.keys(SLASH_TYPE_MAP)
        .filter((alias) => writeTypes.has(normalizeWriteObjectType(alias)))
        .map((alias) => [alias, normalizeWriteObjectType(alias)]),
    );
    expect(inventory.aliases).toEqual(aliases);
    expect(inventory.aliases['STRU/DS']).toBe('TABL/DS');
  });

  it('requires input review when top-level fields change on a tool with included mutations', () => {
    for (const [tool, fields] of Object.entries(inventory.fields)) {
      const schema = getToolSchema(tool, false) as unknown as { shape: Record<string, unknown> };
      expect(Object.keys(schema.shape).sort(), tool).toEqual(fields);
    }
  });

  it('detects newly added actions even if their policy is classified as read or test', () => {
    expect(Object.keys(inventory.actionLists).sort()).toEqual(Object.keys(inventory.fields).sort());
    for (const [tool, actions] of Object.entries(inventory.actionLists)) {
      const schema = getToolSchema(tool, false) as z.ZodObject;
      let action = schema.shape.action;
      while (action instanceof z.ZodOptional || action instanceof z.ZodDefault || action instanceof z.ZodNullable)
        action = action.unwrap();
      expect(action).toBeInstanceOf(z.ZodEnum);
      expect([...(action as z.ZodEnum).options].sort(), tool).toEqual(actions);
    }
  });

  it('freezes nested batch, activation and FLP contracts before their adapters are admitted', () => {
    expect(Object.keys(nestedInputs).sort()).toEqual(['SAPActivate.objects', 'SAPManage.tile', 'SAPWrite.objects']);
    for (const [key, expected] of Object.entries(nestedInputs)) {
      const [tool, field] = key.split('.');
      const schema = getToolSchema(tool, false) as z.ZodObject;
      expect(
        z.toJSONSchema(schema.shape[field], { target: 'draft-7', io: 'input', unrepresentable: 'any' }),
        key,
      ).toEqual(expected);
    }
  });
});
