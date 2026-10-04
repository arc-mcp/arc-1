/** Live round trips for TTYP updates: the stored description and row type survive a partial update. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fetchDiscoveryDocument } from '../../src/adt/discovery.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { generateUniqueName } from './crud-harness.js';
import { getTestClient } from './helpers.js';

describe('TTYP update — live', () => {
  const client = getTestClient();
  const created: string[] = [];
  // NW 7.50 has no /ddic/tabletypes endpoint.
  let tabletypesAvailable = false;
  async function call(tool: string, args: Record<string, unknown>) {
    const result = await handleToolCall(client, DEFAULT_CONFIG, tool, args);
    expect(result.isError, JSON.stringify(result)).toBeUndefined();
    return result;
  }
  beforeAll(async () => {
    tabletypesAvailable = (await fetchDiscoveryDocument(client.http)).map.has('/sap/bc/adt/ddic/tabletypes');
  });
  afterAll(async () => {
    for (const name of created) {
      try {
        await call('SAPWrite', { action: 'delete', type: 'TTYP', name });
      } catch (error) {
        // best-effort-cleanup: attempt every fixture and preserve the original test failure.
        console.warn(`Could not delete TTYP ${name}`, error);
      }
    }
  });

  it.for([
    // INT4 is SAP's name for a built-in that ARC-1 does not auto-detect: a restated row type must stay built-in.
    { rowType: 'INT4', rowTypeKind: 'builtin' },
    { rowType: 'BAPIRET2' },
    // A data element: SAP resolves the row to CHAR 12 itself.
    { rowType: 'SYUNAME' },
  ])(
    'keeps the stored description and $rowType row type across partial updates',
    { timeout: 120_000 },
    async (row, ctx) => {
      requireOrSkip(ctx, tabletypesAvailable || undefined, SkipReason.BACKEND_UNSUPPORTED);
      const name = generateUniqueName('ZARC1_TTU');
      // SAP returns stored text entity-encoded: it must come back unchanged, not escaped twice.
      const description = 'R&D <rows> "quoted"';
      await call('SAPWrite', { action: 'create', type: 'TTYP', name, package: '$TMP', description, ...row });
      created.push(name);
      const read = async () => JSON.parse((await call('SAPRead', { type: 'TTYP', name })).content[0]!.text);
      const stored = await read();
      expect(stored).toMatchObject({ description, rowType: row.rowType, plainStandardTable: true });

      await call('SAPWrite', { action: 'update', type: 'TTYP', name, rowType: row.rowType });
      expect(await read()).toEqual(stored);
      await call('SAPWrite', { action: 'update', type: 'TTYP', name, description: 'Changed' });
      expect(await read()).toEqual({ ...stored, description: 'Changed' });
      await call('SAPActivate', { type: 'TTYP', name });
      expect(await read()).toEqual({ ...stored, description: 'Changed' });
    },
  );
});
