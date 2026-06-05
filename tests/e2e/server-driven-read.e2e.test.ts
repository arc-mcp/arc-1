/**
 * E2E Tests for the generic server-driven object (SDO) read path (ABAP Platform 2025 / 8.16+).
 *
 * Exercises SAPRead for the new AFF generic-object types (DESD/EVTB/DTSC/CSNM/EVTO/COTA) through
 * the full MCP stack. EVTB (RAP Event Binding) ships on both S/4HANA 2023 (758) and 816, so the
 * read test runs on most targets; it skips cleanly when the type's collection is absent.
 */
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { skipTest } from '../helpers/skip-policy.js';
import { callTool, connectClient, expectToolError, expectToolSuccess } from './helpers.js';

describe('E2E Server-Driven Object Read', () => {
  let client: Client;

  beforeAll(async () => {
    client = await connectClient();
  });

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // best-effort-cleanup
    }
  });

  it('reads an EVTB (RAP Event Binding) via SAPRead (skips if not on this system)', async (ctx) => {
    const result = await callTool(client, 'SAPRead', { type: 'EVTB', name: 'S_BUSINESSPARTNER_CHANGE' });
    if (result.isError) {
      return skipTest(
        ctx,
        `Server-driven object EVTB unavailable on this system: ${result.content?.[0]?.text?.slice(0, 200) ?? 'unknown error'}`,
      );
    }
    const payload = JSON.parse(expectToolSuccess(result)) as {
      type: string;
      source: { boName?: string; events?: unknown[] };
    };
    expect(payload.type).toBe('EVTB/EVB');
    expect(payload.source).toBeTypeOf('object');
    expect(Array.isArray(payload.source.events)).toBe(true);
  });

  it('returns a focused error when name is missing for a server-driven type', async () => {
    const result = await callTool(client, 'SAPRead', { type: 'DESD' });
    expectToolError(result, 'name');
  });
});
