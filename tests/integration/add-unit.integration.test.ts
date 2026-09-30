/** Real dispatcher round trips for surgical FORM/MODULE insertion (#776). */
import { afterAll, describe, expect, it } from 'vitest';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { generateUniqueName } from './crud-harness.js';
import { getTestClient } from './helpers.js';

describe('add_unit — live', () => {
  const client = getTestClient();
  const created: Array<{ type: 'PROG' | 'INCL'; name: string }> = [];
  async function call(tool: string, args: Record<string, unknown>) {
    const result = await handleToolCall(client, DEFAULT_CONFIG, tool, args);
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    return result;
  }
  afterAll(async () => {
    for (const object of created.reverse()) {
      await call('SAPWrite', { action: 'delete', ...object });
      const path = `/sap/bc/adt/programs/${object.type === 'PROG' ? 'programs' : 'includes'}/${object.name}/source/main`;
      await expect(client.http.get(path)).rejects.toMatchObject({ statusCode: 404 });
    }
  });

  it.each([
    { type: 'PROG' as const, kind: 'FORM', direction: '' },
    { type: 'INCL' as const, kind: 'MODULE', direction: ' OUTPUT' },
  ])(
    'adds a $kind to $type, rejects a duplicate, and activates the preserved source',
    async (row) => {
      const object = { type: row.type, name: generateUniqueName('ZARC1_AUNIT') };
      await call('SAPWrite', { action: 'create', ...object, package: '$TMP', description: 'ARC-1 add_unit test' });
      created.push(object);
      const seed = `${row.type === 'PROG' ? `REPORT ${object.name.toLowerCase()}.\n` : ''}${row.kind} existing${row.direction}.\nEND${row.kind}.\n`;
      await call('SAPWrite', { action: 'update', ...object, source: seed });
      await call('SAPActivate', object);
      const read = await call('SAPRead', { ...object, format: 'editable' });
      const snapshot = JSON.parse(read.content[0]!.text);
      const block = `${row.kind} added${row.direction}.\n  " newly inserted unit\nEND${row.kind}.`;
      const args = { action: 'add_unit', ...object, unit: 'added', source: block };
      await call('SAPWrite', { ...args, expectedSourceHash: snapshot.sourceHash });
      const draft = JSON.parse((await call('SAPRead', { ...object, format: 'editable' })).content[0]!.text);
      // SAP canonicalizes line endings and strips the final newline on read-back.
      const original = snapshot.source.replace(/\r\n/g, '\n').trimEnd();
      expect(draft.source.replace(/\r\n/g, '\n').trimEnd()).toBe(`${original}\n${block}`);
      const duplicate = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', args);
      expect(duplicate.isError).toBe(true);
      expect(duplicate.content[0]!.text).toContain('already exists');
      await call('SAPActivate', object);
      const active = await call('SAPRead', { ...object, version: 'active' });
      expect(active.content[0]!.text).toContain(`${row.kind} added`);
      expect(active.content[0]!.text).toContain(`${row.kind} existing`);
    },
    120_000,
  );
});
