import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { CrudRegistry, cleanupAll, generateUniqueName } from './crud-harness.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

describe('FUNC recovery after source failure (#1159)', () => {
  let client: AdtClient;
  const registry = new CrudRegistry();
  const names: string[] = [];
  const config = { ...DEFAULT_CONFIG, systemType: 'onprem' as const, lintBeforeWrite: false, checkBeforeWrite: false };
  beforeAll(() => {
    requireSapCredentials();
    client = getTestClient();
  });
  afterAll(async () => {
    if (!client) return;
    const cleanup = await cleanupAll(client.http, client.safety, registry);
    expect(cleanup.failed).toEqual([]);
    for (const name of names) {
      expect(
        (await client.searchObject(name, 10)).filter(
          (object) => object.objectName.toUpperCase() === name || object.uri.toUpperCase().endsWith(`/${name}`),
        ),
      ).toEqual([]);
    }
  }, 60_000);

  it('reads and repairs the existing RFC module without repeating create', async () => {
    const group = generateUniqueName('ZARC1XRG');
    const name = generateUniqueName('ZARC1XRF');
    const groupUrl = `/sap/bc/adt/functions/groups/${group.toLowerCase()}`;
    const objectUrl = `${groupUrl}/fmodules/${name.toLowerCase()}`;
    const createdGroup = await handleToolCall(client, config, 'SAPWrite', {
      action: 'create',
      type: 'FUGR',
      name: group,
      package: '$TMP',
      description: 'ARC-1 recovery test',
    });
    expect(createdGroup.isError, String(createdGroup.content[0]?.text)).not.toBe(true);
    registry.register(groupUrl, 'FUGR', group);
    registry.register(objectUrl, 'FUNC', name);
    names.push(group, name);
    // Deliberately malformed raw source; independent of the structured-parameter formatter.
    const rejected = await handleToolCall(client, config, 'SAPWrite', {
      action: 'create',
      type: 'FUNC',
      name,
      group,
      processingType: 'rfc',
      source: `FUNCTION ${name}\n IMPORTING VALUE(iv_text) TYPE TYPE string.\nENDFUNCTION.`,
    });
    expect(rejected.isError).toBe(true);
    expect(String(rejected.content[0]?.text)).toContain('was created');
    expect(String(rejected.content[0]?.text)).toContain('do not repeat create');
    const read = await handleToolCall(client, config, 'SAPRead', {
      type: 'FUNC',
      name,
      group,
      version: 'inactive',
      includeSignature: true,
    });
    expect(read.isError, String(read.content[0]?.text)).not.toBe(true);
    expect(JSON.parse(String(read.content[0]?.text)).processingType).toBe('rfc');
    const repaired = await handleToolCall(client, config, 'SAPWrite', {
      action: 'update',
      type: 'FUNC',
      name,
      group,
      source: `FUNCTION ${name}\n IMPORTING VALUE(iv_text) TYPE string.\n DATA lv_text TYPE string.\n lv_text = iv_text.\nENDFUNCTION.`,
    });
    expect(repaired.isError, String(repaired.content[0]?.text)).not.toBe(true);
    const activated = await handleToolCall(client, config, 'SAPActivate', { type: 'FUNC', name, group });
    expect(activated.isError, String(activated.content[0]?.text)).not.toBe(true);
    expect((await client.getFunctionModuleProperties(group, name)).processingType).toBe('rfc');
    const active = await client.getFunction(group, name, { version: 'active' });
    expect(active.source).toMatch(/lv_text\s*=\s*iv_text/i);
    expect(active.source).not.toMatch(/TYPE\s+TYPE/i);
  }, 120_000);
});
