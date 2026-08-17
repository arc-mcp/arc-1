import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireOrSkip, SkipReason, skipTest } from '../helpers/skip-policy.js';
import { callTool, connectClient, expectToolError, expectToolSuccess, type ToolResult } from './helpers.js';

describe.sequential('E2E SAPGit tests', () => {
  let client: Client;
  let sapGitAvailable: boolean | undefined;
  let gctsAvailable: boolean | undefined;
  let abapGitAvailable: boolean | undefined;
  let sapGitActions: string[] = [];

  beforeAll(async () => {
    client = await connectClient();

    const tools = await client.listTools();
    const sapGitTool = tools.tools.find((tool) => tool.name === 'SAPGit');
    sapGitAvailable = Boolean(sapGitTool);
    sapGitActions = ((sapGitTool?.inputSchema as { properties?: { action?: { enum?: string[] } } })?.properties?.action
      ?.enum ?? []) as string[];

    if (!sapGitAvailable) return;

    const featuresResult = await callTool(client, 'SAPManage', { action: 'features' });
    if (!featuresResult.isError) {
      const features = JSON.parse(featuresResult.content[0]?.text ?? '{}');
      gctsAvailable = features.gcts?.available === true;
      abapGitAvailable = features.abapGit?.available === true;
    }
  });

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // best-effort-cleanup
    }
  });

  it('tools/list includes SAPGit when at least one Git backend is available', async (ctx) => {
    requireOrSkip(ctx, sapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    const tools = await client.listTools();
    const names = tools.tools.map((tool) => tool.name);
    expect(names).toContain('SAPGit');
  }, 120_000);

  it('SAPGit(action=list_repos) returns parseable JSON', async (ctx) => {
    requireOrSkip(ctx, sapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    const result = await callTool(client, 'SAPGit', { action: 'list_repos' });
    const text = expectToolSuccess(result);
    const payload = JSON.parse(text);

    if (Array.isArray(payload)) {
      expect(payload.length).toBeGreaterThanOrEqual(0);
    } else {
      expect(payload).toHaveProperty('backend');
      expect(Array.isArray(payload.result)).toBe(true);
    }
  }, 120_000);

  it('SAPGit(action=whoami, backend=gcts) returns user and scope', async (ctx) => {
    requireOrSkip(ctx, sapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    requireOrSkip(ctx, gctsAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    const result = await callTool(client, 'SAPGit', { action: 'whoami', backend: 'gcts' });
    const text = expectToolSuccess(result);
    const payload = JSON.parse(text);
    expect(payload.backend).toBe('gcts');
    expect(payload.result.user.user).toBeTruthy();
  }, 120_000);

  it('SAPGit(action=config, backend=gcts) returns config list', async (ctx) => {
    requireOrSkip(ctx, sapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    requireOrSkip(ctx, gctsAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    const result = await callTool(client, 'SAPGit', { action: 'config', backend: 'gcts' });
    const text = expectToolSuccess(result);
    const payload = JSON.parse(text);
    expect(payload.backend).toBe('gcts');
    expect(Array.isArray(payload.result)).toBe(true);
    expect(payload.result.length).toBeGreaterThan(0);
    expect(
      payload.result.some((entry: { key?: string; ckey?: string }) =>
        [entry?.key, entry?.ckey].some((key) => typeof key === 'string' && key.length > 0),
      ),
    ).toBe(true);
    let redactedFields = 0;
    for (const entry of payload.result as Array<Record<string, unknown>>) {
      const key = String(entry.key ?? entry.ckey ?? '').toUpperCase();
      if (key.includes('AUTH_USER') || key.includes('AUTH_PWD') || key.includes('AUTH_TOKEN')) {
        for (const [field, value] of Object.entries(entry)) {
          if (['value', 'defaultvalue', 'currentvalue', 'example'].includes(field.toLowerCase())) {
            expect(value).toBe('[REDACTED]');
            redactedFields += 1;
          }
        }
      }
    }
    expect(redactedFields).toBeGreaterThan(0);
  }, 120_000);

  it('SAPGit(action=external_info, backend=abapgit) returns remote branch info', async (ctx) => {
    requireOrSkip(ctx, sapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    requireOrSkip(ctx, abapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    if (!sapGitActions.includes('external_info')) {
      return skipTest(ctx, 'SAPGit external_info is not enabled by the server write/Git safety ceiling');
    }
    const result = await callTool(client, 'SAPGit', {
      action: 'external_info',
      backend: 'abapgit',
      url: 'https://github.com/abapGit-tests/CLAS.git',
    });
    if (result.isError) {
      const errorText = (result.content?.[0]?.text ?? '') as string;
      expect(errorText).toMatch(/allowWrites=false|allowGitWrites=false|Git write|required scope|authorization/i);
      return;
    }
    const text = expectToolSuccess(result);
    const payload = JSON.parse(text);
    expect(payload.backend).toBe('abapgit');
    expect(Array.isArray(payload.result.branches)).toBe(true);
    expect(payload.result.branches.length).toBeGreaterThan(0);
  }, 120_000);

  it('tools/list omits clone when Git writes are disabled without attempting a mutation', async (ctx) => {
    requireOrSkip(ctx, sapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    if (sapGitActions.includes('clone')) {
      return skipTest(ctx, 'Server advertises Git writes; a negative gate test must not attempt a live clone');
    }
    expect(sapGitActions).not.toContain('clone');
  }, 120_000);

  it('SAPGit(action=whoami, backend=abapgit) returns backend mismatch error', async (ctx) => {
    requireOrSkip(ctx, sapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    requireOrSkip(ctx, abapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    const result = await callTool(client, 'SAPGit', { action: 'whoami', backend: 'abapgit' });
    expectToolError(result, 'only supported by gCTS');
  }, 120_000);

  it('SAPGit rejects unknown action via schema validation', async (ctx) => {
    requireOrSkip(ctx, sapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    const result: ToolResult = await callTool(client, 'SAPGit', { action: 'unknown_action' });
    expectToolError(result, 'Invalid arguments for SAPGit');
  }, 120_000);
});
