import { describe, expect, it } from 'vitest';
import type { AdtClient } from '../../../src/adt/client.js';
import { resolveIncludeGroup, resolveIncludeGroupForMutation } from '../../../src/handlers/include-group.js';

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

describe('resolveIncludeGroupForMutation', () => {
  it('resolves a structural include and respects explicit groups', async () => {
    expect(await resolveIncludeGroupForMutation(clientWith([grouped('zarc1')]), 'LZARC1TOP', undefined)).toBe('ZARC1');
    const boom = {
      lookupObjects: async () => {
        throw new Error('must not look up');
      },
    } as unknown as AdtClient;
    expect(await resolveIncludeGroupForMutation(boom, 'LZARC1TOP', ' ZEXPLICIT ')).toBe('ZEXPLICIT');
    expect(await resolveIncludeGroupForMutation(boom, 'ZSTANDALONE', undefined)).toBeUndefined();
    expect(await resolveIncludeGroupForMutation(boom, '/NS/ZSTANDALONE', undefined)).toBeUndefined();
  });
  it('resolves namespaced groups from encoded include paths', async () => {
    const hit = ref('FUGR/I', '/sap/bc/adt/functions/groups/%2Fns%2Fgroup/includes/%2Fns%2Flgrouptop');
    expect(await resolveIncludeGroupForMutation(clientWith([hit]), '/NS/LGROUPTOP', undefined)).toBe('/NS/GROUP');
  });
  it.each([
    '/sap/bc/adt/functions/groups/zarc1/fmodules/zfunction',
    'https://foreign.example/sap/bc/adt/functions/groups/zarc1/includes/lzarc1top',
    '/sap/bc/adt/functions/groups/zarc1/includes/lzarc1top?x=1',
  ])('refuses unverified owner evidence %s', async (uri) => {
    await expect(
      resolveIncludeGroupForMutation(clientWith([ref('FUGR/I', uri)]), 'LZARC1TOP', undefined),
    ).rejects.toThrow('Provide "group"');
  });
});
