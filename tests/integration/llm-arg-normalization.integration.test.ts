/**
 * Issue #360 — GPT/OpenAI schema-pollution hardening, verified against a live SAP system.
 *
 * These tests drive handleToolCall() (the same entry the MCP server + CLI use) with
 * "polluted" payloads a GPT/OpenAI client would send — stringified booleans, null-valued
 * optionals (strict-mode optional emulation), empty-string enums, and an inapplicable
 * `include` — and assert the operation SUCCEEDS with correct data, rather than being
 * rejected or silently corrupted.
 *
 * Requires TEST_SAP_URL (hard-fails via requireSapCredentials, never silent-skips).
 * Objects are created in $TMP and removed in finally blocks (best-effort-cleanup).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { generateUniqueName } from './crud-harness.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

describe('Issue #360 — LLM arg-pollution hardening (live SAP)', () => {
  let client: AdtClient;

  beforeAll(() => {
    requireSapCredentials();
    client = getTestClient();
  });

  // Best-effort delete of any object the tests may have left behind.
  async function cleanup(type: string, name: string): Promise<void> {
    try {
      await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', { action: 'delete', type, name });
    } catch {
      // best-effort-cleanup
    }
  }

  it('stringified signExists/lowercase "false" create a NON-sign domain (no silent inversion)', async () => {
    const name = generateUniqueName('ZARC360D');
    try {
      const created = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DOMA',
        name,
        package: '$TMP',
        description: 'issue360 bool',
        dataType: 'DEC',
        length: 8,
        decimals: 2,
        // GPT-style stringified booleans — pre-fix these inverted to true.
        signExists: 'false',
        lowercase: 'false',
      });
      expect(created.isError).toBeFalsy();

      const read = await handleToolCall(client, DEFAULT_CONFIG, 'SAPRead', {
        type: 'DOMA',
        name,
        version: 'inactive',
      });
      expect(read.isError).toBeFalsy();
      const domain = JSON.parse(read.content[0].text);
      expect(domain.signExists).toBe(false);
      expect(domain.lowercase).toBe(false);
    } finally {
      await cleanup('DOMA', name);
    }
  });

  it('null-valued optional pollution (strict-mode emulation) is accepted on a DTEL create', async () => {
    const name = generateUniqueName('ZARC360E');
    try {
      const created = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'DTEL',
        name,
        package: '$TMP',
        description: 'issue360 null',
        typeKind: 'predefinedAbapType',
        dataType: 'CHAR',
        length: 10,
        // Irrelevant optionals a strict OpenAI client emits as null — pre-fix: hard-rejected.
        serviceDefinition: null,
        bindingType: null,
        odataVersion: null,
        source: null,
        group: null,
      });
      expect(created.isError).toBeFalsy();
      expect(created.content[0].text).toContain(name);
    } finally {
      await cleanup('DTEL', name);
    }
  });

  it('empty-string enum + inapplicable include are normalized on a source-object update', async () => {
    const name = generateUniqueName('ZARC360P');
    try {
      const created = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'create',
        type: 'PROG',
        name,
        package: '$TMP',
        source: `REPORT ${name.toLowerCase()}.`,
      });
      expect(created.isError).toBeFalsy();

      const updated = await handleToolCall(client, DEFAULT_CONFIG, 'SAPWrite', {
        action: 'update',
        type: 'PROG',
        name,
        source: `REPORT ${name.toLowerCase()}.\nWRITE: / 'updated'.`,
        // Pollution: empty-string enum (pre-fix rejected) + CLAS-only include on a PROG
        // (pre-fix rejected: "include is only supported for type=CLAS").
        odataVersion: '',
        include: 'definitions',
      });
      expect(updated.isError).toBeFalsy();
      expect(updated.content[0].text).toContain('updated');
      expect(updated.content[0].text).not.toContain('include is only supported');
    } finally {
      await cleanup('PROG', name);
    }
  });

  afterAll(() => {
    // No shared state to tear down; per-test finally blocks handle cleanup.
  });
});
