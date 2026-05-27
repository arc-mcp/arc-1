import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { describe, expect, it, vi } from 'vitest';
import { PERSISTENT_OBJECTS, readFixture } from '../../e2e/fixtures.js';
import { syncPersistentFixtures } from '../../e2e/setup.js';

interface FakeToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

function textResult(text: string): FakeToolResult {
  return { content: [{ type: 'text', text }] };
}

function errorResult(text: string): FakeToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function fakeClient(handler: (name: string, args: Record<string, unknown>) => FakeToolResult): Client {
  return {
    callTool: vi.fn(async ({ name, arguments: args }) => handler(name, (args ?? {}) as Record<string, unknown>)),
  } as unknown as Client;
}

function fixtureFor(name: string) {
  const fixture = PERSISTENT_OBJECTS.find((obj) => obj.name === name);
  if (!fixture) throw new Error(`No fixture for ${name}`);
  return fixture;
}

describe('E2E fixture setup', () => {
  it('fails fixture sync when activation returns an error result', async () => {
    const client = fakeClient((name) => {
      if (name === 'SAPSearch') return textResult('[]');
      if (name === 'SAPWrite') return textResult('created');
      if (name === 'SAPActivate') return errorResult('Activation failed: invalid CDS annotation');
      throw new Error(`Unexpected tool call: ${name}`);
    });

    await expect(syncPersistentFixtures(client)).rejects.toThrow(
      /activate PROG ZARC1_TEST_REPORT failed: Activation failed/i,
    );
  });

  it('fails fixture sync when a managed fixture remains in the inactive object list', async () => {
    const client = fakeClient((name, args) => {
      if (name === 'SAPSearch') {
        const fixture = fixtureFor(String(args.query));
        return textResult(JSON.stringify([{ objectName: fixture.name, objectType: fixture.type }]));
      }
      if (name === 'SAPRead' && args.type === 'INACTIVE_OBJECTS') {
        return textResult(
          JSON.stringify({
            count: 1,
            objects: [{ type: 'DDLS/DF', name: 'ZI_ARC1_I33_ROOT', uri: '/sap/bc/adt/ddic/ddl/sources/...' }],
          }),
        );
      }
      if (name === 'SAPRead') {
        const fixture = fixtureFor(String(args.name));
        return textResult(readFixture(fixture.fixture));
      }
      throw new Error(`Unexpected tool call: ${name}`);
    });

    await expect(syncPersistentFixtures(client)).rejects.toThrow(
      /Persistent fixture activation incomplete; inactive fixtures remain: DDLS\/DF ZI_ARC1_I33_ROOT/i,
    );
  });

  it('accepts unchanged fixtures when active source matches and no inactive drafts remain', async () => {
    const client = fakeClient((name, args) => {
      if (name === 'SAPSearch') {
        const fixture = fixtureFor(String(args.query));
        return textResult(JSON.stringify([{ objectName: fixture.name, objectType: fixture.type }]));
      }
      if (name === 'SAPRead' && args.type === 'INACTIVE_OBJECTS') {
        return textResult(JSON.stringify({ count: 0, objects: [] }));
      }
      if (name === 'SAPRead') {
        const fixture = fixtureFor(String(args.name));
        return textResult(readFixture(fixture.fixture));
      }
      throw new Error(`Unexpected tool call: ${name}`);
    });

    const summary = await syncPersistentFixtures(client);

    expect(summary.unchanged).toHaveLength(PERSISTENT_OBJECTS.length);
    expect(summary.created).toEqual([]);
    expect(summary.recreated).toEqual([]);
    expect(summary.skipped).toEqual([]);
  });

  it('accepts created fixtures when SAP canonicalizes the active source text', async () => {
    const client = fakeClient((name, args) => {
      if (name === 'SAPSearch') return textResult('[]');
      if (name === 'SAPWrite') return textResult('created');
      if (name === 'SAPActivate') return textResult('activated');
      if (name === 'SAPRead' && args.type === 'INACTIVE_OBJECTS') {
        return textResult(JSON.stringify({ count: 0, objects: [] }));
      }
      if (name === 'SAPRead') return textResult(`canonicalized ${String(args.type)} ${String(args.name)}`);
      throw new Error(`Unexpected tool call: ${name}`);
    });

    const summary = await syncPersistentFixtures(client);

    expect(summary.created).toHaveLength(PERSISTENT_OBJECTS.length);
    expect(summary.recreated).toEqual([]);
    expect(summary.unchanged).toEqual([]);
    expect(summary.skipped).toEqual([]);
  });
});
