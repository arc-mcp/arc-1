import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { fetchDiscoveryDocument } from '../../src/adt/discovery.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { CrudRegistry, cleanupAll, generateUniqueName } from './crud-harness.js';
import { getTestClient } from './helpers.js';

// Through dispatch: exercise schema/normalization, the real package gate, lock/PUT/unlock,
// and read-back. All writes belong to uniquely named disposable $TMP objects.
describe('text elements via SAPRead/SAPWrite', () => {
  let client: AdtClient;
  const registry = new CrudRegistry();
  const config = { ...DEFAULT_CONFIG, allowWrites: true, allowedPackages: ['$TMP'], lintBeforeWrite: false };

  beforeAll(async () => {
    client = getTestClient();
    client.safety.allowedPackages = ['$TMP'];
    client.http.setDiscoveryMap((await fetchDiscoveryDocument(client.http)).map);
  });

  afterAll(async () => {
    if (!client) return;
    const report = await cleanupAll(client.http, client.safety, registry);
    expect(report.failed, 'all temporary text-pool objects must be deleted').toEqual([]);
  });

  async function call(tool: string, args: Record<string, unknown>): Promise<string> {
    const result = await handleToolCall(client, config, tool, args);
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    return result.content.map((c) => c.text ?? '').join('\n');
  }

  for (const type of ['PROG', 'FUGR'] as const) {
    it(`${type} selection screen and text-pool lifecycle`, async (ctx) => {
      const collection = type === 'PROG' ? 'programs' : 'functiongroups';
      requireOrSkip(
        ctx,
        client.http.discoveryAcceptFor(`/sap/bc/adt/textelements/${collection}`),
        `${SkipReason.BACKEND_UNSUPPORTED}: ADT textelements/${collection} collection absent`,
      );
      const name = generateUniqueName(type === 'PROG' ? 'ZARC1_IT' : 'ZATG');
      const objectUrl = `${type === 'PROG' ? '/sap/bc/adt/programs/programs' : '/sap/bc/adt/functions/groups'}/${name.toLowerCase()}`;
      const fields =
        'PARAMETERS p_test TYPE c LENGTH 10.\nDATA v_test TYPE c LENGTH 10.\nSELECT-OPTIONS s_test FOR v_test.';
      await call('SAPWrite', {
        action: 'create',
        type,
        name,
        package: '$TMP',
        description: 'ARC-1 text-pool lifecycle',
      });
      registry.register(objectUrl, type, name);
      if (type === 'PROG') {
        await call('SAPWrite', {
          action: 'update',
          type,
          name,
          source: `REPORT ${name.toLowerCase()}.\n${fields}\nWRITE 'Hello'.`,
        });
      } else {
        await call('SAPWrite', {
          action: 'update',
          type: 'INCL',
          group: name,
          name: `L${name}TOP`,
          source: `FUNCTION-POOL ${name}.\nSELECTION-SCREEN BEGIN OF SCREEN 100.\n${fields}\nSELECTION-SCREEN END OF SCREEN 100.`,
        });
      }
      await call('SAPActivate', { type, name });

      const read = (part?: string) =>
        call('SAPRead', { type: 'TEXT_ELEMENTS', objectType: type, name, ...(part ? { include: part } : {}) });
      const write = (textPart: string, source: string) =>
        call('SAPWrite', { action: 'edit_text_symbols', type, name, textPart, source });

      await write('symbols', '@MaxLength:20\n001=Hello\n\n@MaxLength:20\n002=Second\n');
      const symbols = await read('symbols');
      expect(symbols).toContain('001=Hello');
      expect(symbols).toContain('002=Second');

      await write('selections', 'P_TEST=Parameter label\nS_TEST=Selection label\n');
      const selections = await read('selections');
      expect(selections).toMatch(/P_TEST\s*=Parameter label/);
      expect(selections).toMatch(/S_TEST\s*=Selection label/);
      expect(await read('symbols')).toBe(symbols);

      await write(
        'headings',
        'listHeader=Lifecycle report\n\ncolumnHeader_1=First column\ncolumnHeader_2=\ncolumnHeader_3=\ncolumnHeader_4=\n',
      );
      const headings = await read('headings');
      expect(headings).toContain('listHeader=Lifecycle report');
      expect(headings).toContain('columnHeader_1=First column');
      expect(await read('selections')).toBe(selections);
      const whole = await read();
      for (const [part, body] of [
        ['symbols', symbols],
        ['selections', selections],
        ['headings', headings],
      ]) {
        expect(whole).toContain(`=== ${part} ===\n${body}`);
      }

      // Rejected bodies must leave the earlier pool intact and release the lock for the next write.
      const malformed = await handleToolCall(client, config, 'SAPWrite', {
        action: 'edit_text_symbols',
        type,
        name,
        source: '@MaxLength:20\n001=Broken\n002=Missing max length\n',
      });
      expect(malformed.isError).toBe(true);
      expect(malformed.content[0]?.text).toMatch(/406|inconsisten|text elements contain errors/i);
      expect(await read('symbols')).toBe(symbols);
      await write('symbols', '@MaxLength:20\n001=Replacement\n');
      expect(await read('symbols')).toContain('001=Replacement');
      expect(await read('symbols')).not.toContain('002=');

      // Explicit empty source clears only the selected part, without requiring SAPActivate.
      await write('symbols', '');
      expect(await read('symbols')).toBe('');
      expect(await read('selections')).toBe(selections);
      expect(await read('headings')).toBe(headings);
      await write('selections', '');
      expect(await read('selections')).not.toMatch(/Parameter label|Selection label/);
      expect(await read('headings')).toBe(headings);

      await call('SAPWrite', { action: 'delete', type, name });
      registry.remove(name);
      await expect(client.http.get(objectUrl)).rejects.toMatchObject({ statusCode: 404 });
    }, 60_000);
  }
});
