import { beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { requireOrSkip, SkipReason } from '../helpers/skip-policy.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

// SAP standard function-group include (SAP_BASIS, group SPO1). Read-only: nothing is created or saved.
const INCLUDE = 'LSPO1F01';

describe('INCL syntax in its function group', () => {
  let client: AdtClient;
  beforeAll(() => {
    requireSapCredentials();
    client = getTestClient();
  });
  async function call(tool: string, args: Record<string, unknown>) {
    const result = await handleToolCall(client, DEFAULT_CONFIG, tool, args);
    expect(result.isError, String(result.content[0]?.text)).not.toBe(true);
    return JSON.parse(String(result.content[0]?.text));
  }

  it('checks stored and candidate text of a function-group include', async (ctx) => {
    const [lookup] = await client.lookupObjects([INCLUDE]);
    requireOrSkip(
      ctx,
      lookup?.matches.find((m) => m.objectType === 'FUGR/I'),
      SkipReason.NO_FIXTURE,
    );
    const { source } = await client.getInclude(INCLUDE);
    const candidate = `${source}\nFORM arc1_candidate.\n  arc1_candidate_error.\nENDFORM.`;
    for (const args of [
      { tool: 'SAPDiagnose', base: { action: 'syntax', type: 'INCL' } },
      { tool: 'SAPRead', base: { type: 'SYNTAX', objectType: 'INCL' } },
    ]) {
      // Without the group as context, SAP refuses the check: "Select a master program for include …".
      expect(await call(args.tool, { ...args.base, name: INCLUDE })).toMatchObject({ checked: true, hasErrors: false });
      const result = await call(args.tool, { ...args.base, name: INCLUDE, source: candidate });
      expect(result).toMatchObject({ checked: true, hasErrors: true });
      expect(result.messages.some((m: { text: string }) => /ARC1_CANDIDATE_ERROR/i.test(m.text))).toBe(true);
    }
  }, 120_000);
});
