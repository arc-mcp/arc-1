import { describe, expect, it } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { applyIncludeGroup, resolveIncludeGroup } from '../../../src/handlers/include-group.js';

const ref = (objectType: string, uri: string) => ({ objectType, objectName: 'LZARC1TOP', uri });
const clientWith = (matches: ReturnType<typeof ref>[]) =>
  ({ lookupObjects: async () => [{ name: 'LZARC1TOP', found: matches.length > 0, matches }] }) as unknown as AdtClient;
const grouped = (group: string) => ref('FUGR/I', `/sap/bc/adt/functions/groups/${group}/includes/lzarc1top`);

describe('resolveIncludeGroup', () => {
  it('returns the owning group of a function-group include', async () => {
    expect(await resolveIncludeGroup(clientWith([grouped('zarc1')]), 'LZARC1TOP', true)).toBe('ZARC1');
  });

  it('treats a flat PROG/I match and no match (when allowed) as standalone', async () => {
    const flat = ref('PROG/I', '/sap/bc/adt/programs/includes/LZARC1TOP');
    expect(await resolveIncludeGroup(clientWith([flat]), 'LZARC1TOP', true)).toBeUndefined();
    expect(await resolveIncludeGroup(clientWith([]), 'LZARC1TOP', true)).toBeUndefined();
  });

  it('fails closed on two different owners, an unexpected URI, or no match when not allowed', async () => {
    await expect(resolveIncludeGroup(clientWith([grouped('za'), grouped('zb')]), 'LZARC1TOP', true)).rejects.toThrow(
      'Provide "group" explicitly',
    );
    const odd = ref('FUGR/I', '/sap/bc/adt/functions/groups/zarc1/includes/other');
    await expect(resolveIncludeGroup(clientWith([odd]), 'LZARC1TOP', true)).rejects.toThrow('Provide "group"');
    await expect(resolveIncludeGroup(clientWith([]), 'LZARC1TOP', false)).rejects.toThrow('Provide "group"');
  });
});

describe('applyIncludeGroup', () => {
  it('sets args.group for an in-scope action on INCL', async () => {
    const args: Record<string, unknown> = {};
    expect(await applyIncludeGroup(clientWith([grouped('zarc1')]), args, 'INCL', 'LZARC1TOP', 'edit_content')).toBe(
      undefined,
    );
    expect(args.group).toBe('ZARC1');
  });

  it('leaves an explicit group, other types and create/delete untouched (no lookup)', async () => {
    const boom = { lookupObjects: async () => Promise.reject(new Error('must not be called')) } as unknown as AdtClient;
    const withGroup: Record<string, unknown> = { group: 'ZX' };
    expect(await applyIncludeGroup(boom, withGroup, 'INCL', 'LZARC1TOP', 'update')).toBeUndefined();
    expect(withGroup.group).toBe('ZX');
    expect(await applyIncludeGroup(boom, {}, 'PROG', 'ZTEST', 'update')).toBeUndefined();
    expect(await applyIncludeGroup(boom, {}, 'INCL', 'LZARC1TOP', 'create')).toBeUndefined();
    expect(await applyIncludeGroup(boom, {}, 'INCL', 'LZARC1TOP', 'delete')).toBeUndefined();
  });

  it('returns an error result (no write path) when the owner cannot be verified', async () => {
    const args: Record<string, unknown> = {};
    const result = await applyIncludeGroup(
      clientWith([grouped('za'), grouped('zb')]),
      args,
      'INCL',
      'LZARC1TOP',
      'update',
    );
    expect(result?.isError).toBe(true);
    expect(args.group).toBeUndefined();
  });
});
