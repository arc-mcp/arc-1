import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdtClient } from '../../src/adt/client.js';
import type { SyntaxCheckResult } from '../../src/adt/types.js';
import { handleToolCall } from '../../src/handlers/dispatch.js';
import { DEFAULT_CONFIG } from '../../src/server/types.js';
import { CrudRegistry, cleanupAll, generateUniqueName } from './crud-harness.js';
import { getTestClient, requireSapCredentials } from './helpers.js';

describe('FUNC syntax lifecycle (#1160)', () => {
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
    for (const name of names)
      expect(
        (await client.searchObject(name, 10)).filter(
          (r) => r.objectName.toUpperCase() === name || r.uri.toUpperCase().endsWith(`/${name}`),
        ),
      ).toEqual([]);
  }, 60_000);
  async function call(tool: string, args: Record<string, unknown>) {
    const result = await handleToolCall(client, config, tool, args);
    expect(result.isError, String(result.content[0]?.text)).not.toBe(true);
    return String(result.content[0]?.text);
  }
  async function checks(name: string, options: Record<string, unknown> = {}) {
    const results: SyntaxCheckResult[] = [];
    for (const [tool, args] of [
      ['SAPDiagnose', { action: 'syntax', type: 'FUNC' }],
      ['SAPRead', { type: 'SYNTAX', objectType: 'FUGR/FF' }],
    ] as const)
      results.push(JSON.parse(await call(tool, { ...args, name, ...options })));
    return results;
  }
  async function rejectsCandidate(name: string, source: string) {
    for (const version of [undefined, 'active', 'inactive']) {
      for (const result of await checks(name, { version, source })) {
        expect(result).toMatchObject({ checked: true, hasErrors: true });
        expect(result.messages.some((message) => message.text.includes('CANDIDATE_ERROR'))).toBe(true);
      }
    }
  }
  it('checks stored versions and candidate text without hiding sibling errors', async () => {
    const group = generateUniqueName('ZARC1XSG');
    const name = generateUniqueName('ZARC1XSF');
    const sibling = generateUniqueName('ZARC1XSS');
    const groupUrl = `/sap/bc/adt/functions/groups/${group.toLowerCase()}`;
    const moduleUrl = (n: string) => `${groupUrl}/fmodules/${n.toLowerCase()}`;
    const valid = `FUNCTION ${name}.\n DATA lv TYPE string.\n lv = 'valid'.\nENDFUNCTION.`;
    const candidate = `FUNCTION ${name}\n IMPORTING VALUE(iv_new) TYPE string.\n DATA lv TYPE string.\n lv = iv_new.\nENDFUNCTION.`;
    await call('SAPWrite', {
      action: 'create',
      type: 'FUGR',
      name: group,
      package: '$TMP',
      description: 'ARC-1 FUNC syntax test',
    });
    registry.register(groupUrl, 'FUGR', group);
    names.push(group);
    registry.register(moduleUrl(name), 'FUNC', name);
    names.push(name);
    await call('SAPWrite', {
      action: 'create',
      type: 'FUNC',
      name,
      group,
      source: valid.replace("'valid'", 'initial_error'),
    });
    for (const version of [undefined, 'active']) {
      for (const result of await checks(name, { version }))
        expect(result).toMatchObject({ checked: true, hasErrors: false });
    }
    for (const result of await checks(name, { version: 'inactive' })) {
      expect(result).toMatchObject({ checked: true, hasErrors: true });
      expect(result.messages.some((m) => m.text.includes('INITIAL_ERROR'))).toBe(true);
    }
    const initialActive = await client.getFunction(group, name, { version: 'active' });
    expect(initialActive.statusCode).toBe(200);
    expect(initialActive.source).not.toMatch(/initial_error/i);
    await rejectsCandidate(name, candidate.replace('lv = iv_new', 'lv = candidate_error'));
    await call('SAPWrite', { action: 'update', type: 'FUNC', name, group, source: valid });
    await call('SAPActivate', { type: 'FUNC', name, group });
    await call('SAPWrite', {
      action: 'update',
      type: 'FUNC',
      name,
      group,
      source: valid.replace("'valid'", 'stored_error'),
    });
    for (const version of [undefined, 'active']) {
      for (const result of await checks(name, { version }))
        expect(result).toMatchObject({ checked: true, hasErrors: false });
    }
    for (const result of await checks(name, { version: 'inactive' })) {
      expect(result).toMatchObject({ checked: true, hasErrors: true });
      expect(result.messages.some((m) => m.text.includes('STORED_ERROR'))).toBe(true);
    }
    for (const result of await checks(name, { version: 'inactive', source: candidate }))
      expect(result).toMatchObject({ checked: true, hasErrors: false });
    for (const result of await checks(name, {
      version: 'inactive',
      source: candidate.replace('lv = iv_new', 'lv = candidate_error'),
    })) {
      expect(result).toMatchObject({ checked: true, hasErrors: true });
      expect(result.messages.some((m) => m.text.includes('CANDIDATE_ERROR'))).toBe(true);
    }
    for (const result of await checks(name, {
      source: `FUNCTION ${name}.\n*" IMPORTING\n*" VALUE(iv_new) TYPE STRING\n unknown_statement.\nENDFUNCTION.`,
    })) {
      expect(result).toMatchObject({ checked: false, hasErrors: true });
    }
    expect((await client.getFunction(group, name, { version: 'inactive' })).source).toMatch(/stored_error/i);
    await call('SAPWrite', { action: 'update', type: 'FUNC', name, group, source: valid });
    await call('SAPActivate', { type: 'FUNC', name, group });
    await rejectsCandidate(name, candidate.replace('lv = iv_new', 'lv = candidate_error'));
    registry.register(moduleUrl(sibling), 'FUNC', sibling);
    names.push(sibling);
    await call('SAPWrite', {
      action: 'create',
      type: 'FUNC',
      name: sibling,
      group,
      source: `FUNCTION ${sibling}.\n unknown_statement.\nENDFUNCTION.`,
    });
    for (const result of await checks(name, { version: 'inactive' })) {
      expect(result).toMatchObject({ checked: true, hasErrors: true });
      expect(result.messages.some((m) => m.uri?.includes(moduleUrl(sibling)))).toBe(true);
    }
  }, 120_000);
});
