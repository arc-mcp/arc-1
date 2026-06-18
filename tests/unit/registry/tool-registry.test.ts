import { describe, expect, it } from 'vitest';

import { OperationType } from '../../../src/adt/safety.js';
import { type RegistryEntry, type ToolDispatchContext, ToolRegistry } from '../../../src/registry/tool-registry.js';

const okResult = { content: [{ type: 'text' as const, text: 'ok' }] };

function entry(over: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    name: 'SAPRead',
    source: 'builtin',
    policy: { scope: 'read', opType: OperationType.Read },
    invoke: async () => okResult,
    ...over,
  };
}

describe('ToolRegistry', () => {
  it('registers and retrieves an entry', () => {
    const r = new ToolRegistry();
    r.register(entry());
    expect(r.get('SAPRead')?.name).toBe('SAPRead');
    expect(r.has('SAPRead')).toBe(true);
    expect(r.size()).toBe(1);
  });

  it('returns undefined for an unknown tool', () => {
    const r = new ToolRegistry();
    expect(r.get('Nope')).toBeUndefined();
    expect(r.has('Nope')).toBe(false);
  });

  it('rejects a duplicate name (fail-fast)', () => {
    const r = new ToolRegistry();
    r.register(entry());
    expect(() => r.register(entry())).toThrow(/duplicate tool name 'SAPRead'/);
  });

  it('rejects an entry with no policy', () => {
    const r = new ToolRegistry();
    expect(() => r.register(entry({ policy: undefined as unknown as RegistryEntry['policy'] }))).toThrow(
      /policy\.scope/,
    );
  });

  it('rejects an entry missing opType', () => {
    const r = new ToolRegistry();
    expect(() =>
      r.register(entry({ name: 'SAPWrite', policy: { scope: 'write' } as unknown as RegistryEntry['policy'] })),
    ).toThrow(/opType/);
  });

  it('rejects a plugin tool outside the Custom_ namespace', () => {
    const r = new ToolRegistry();
    expect(() => r.register(entry({ name: 'EvilTool', source: 'plugin', pluginName: 'p' }))).toThrow(/Custom_/);
  });

  it('accepts a plugin tool in the Custom_ namespace', () => {
    const r = new ToolRegistry();
    r.register(entry({ name: 'Custom_Foo', source: 'plugin', pluginName: 'p1' }));
    expect(r.get('Custom_Foo')?.source).toBe('plugin');
    expect(r.get('Custom_Foo')?.pluginName).toBe('p1');
  });

  it('rejects a plugin whose declared scope does not cover its opType (read scope + write op)', () => {
    const r = new ToolRegistry();
    expect(() =>
      r.register(
        entry({
          name: 'Custom_Liar',
          source: 'plugin',
          pluginName: 'p',
          policy: { scope: 'read', opType: OperationType.Update },
        }),
      ),
    ).toThrow(/scope 'read' but opType 'U' requires scope 'write'/);
  });

  it('accepts a plugin whose scope covers its opType (write scope ⊇ a read op)', () => {
    const r = new ToolRegistry();
    r.register(
      entry({
        name: 'Custom_Over',
        source: 'plugin',
        pluginName: 'p',
        policy: { scope: 'write', opType: OperationType.Read },
      }),
    );
    expect(r.get('Custom_Over')?.source).toBe('plugin');
  });

  it('does NOT apply the opType↔scope check to built-ins (ACTION_POLICY owns their consistency)', () => {
    const r = new ToolRegistry();
    // A deliberately-inconsistent built-in still registers — only plugin entries are gated.
    r.register(entry({ name: 'SAPOdd', policy: { scope: 'read', opType: OperationType.Update } }));
    expect(r.get('SAPOdd')?.source).toBe('builtin');
  });

  it('allows a built-in to keep its SAP* (non-Custom_) name', () => {
    const r = new ToolRegistry();
    expect(() => r.register(entry({ name: 'SAPWrite' }))).not.toThrow();
  });

  it('lists built-ins before plugins, each in registration order', () => {
    const r = new ToolRegistry();
    r.register(entry({ name: 'SAPRead' }));
    r.register(entry({ name: 'Custom_A', source: 'plugin', pluginName: 'p' }));
    r.register(entry({ name: 'SAPWrite' }));
    r.register(entry({ name: 'Custom_B', source: 'plugin', pluginName: 'p' }));
    expect(r.list().map((e) => e.name)).toEqual(['SAPRead', 'SAPWrite', 'Custom_A', 'Custom_B']);
  });

  it('dispatches to the entry handler with the per-request context', async () => {
    const r = new ToolRegistry();
    let seen: ToolDispatchContext | undefined;
    r.register(
      entry({
        name: 'Custom_Echo',
        source: 'plugin',
        pluginName: 'p',
        invoke: async (ctx) => {
          seen = ctx;
          return { content: [{ type: 'text', text: ctx.requestId }] };
        },
      }),
    );
    const ctx = {
      client: {} as ToolDispatchContext['client'],
      config: {} as ToolDispatchContext['config'],
      args: {},
      requestId: 'req-1',
    } as ToolDispatchContext;
    const res = await r.get('Custom_Echo')!.invoke(ctx);
    expect(seen?.requestId).toBe('req-1');
    expect(res.content[0].text).toBe('req-1');
  });
});
