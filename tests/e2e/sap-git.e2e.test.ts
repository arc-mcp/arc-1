import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireOrSkip, SkipReason, skipTest } from '../helpers/skip-policy.js';
import { callTool, connectClient, expectToolError, expectToolSuccess, type ToolResult } from './helpers.js';

describe.sequential('E2E SAPGit tests', () => {
  let client: Client;
  let sapGitAvailable: boolean | undefined;
  let gctsAvailable: boolean | undefined;
  let abapGitAvailable: boolean | undefined;

  beforeAll(async () => {
    client = await connectClient();

    const tools = await client.listTools();
    sapGitAvailable = tools.tools.some((tool) => tool.name === 'SAPGit');

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
    if (payload.result.length > 0) {
      expect(
        payload.result.some((entry: { ckey?: string }) => typeof entry?.ckey === 'string' && entry.ckey.length > 0),
      ).toBe(true);
    }
  }, 120_000);

  it('SAPGit(action=external_info, backend=abapgit) returns remote branch info', async (ctx) => {
    requireOrSkip(ctx, sapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    requireOrSkip(ctx, abapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    const result = await callTool(client, 'SAPGit', {
      action: 'external_info',
      backend: 'abapgit',
      url: 'https://github.com/abapGit-tests/CLAS.git',
    });
    const text = expectToolSuccess(result);
    const payload = JSON.parse(text);
    expect(payload.backend).toBe('abapgit');
    expect(Array.isArray(payload.result.branches)).toBe(true);
    expect(payload.result.branches.length).toBeGreaterThan(0);
  }, 120_000);

  it('SAPGit(action=clone) without --allow-git-writes returns safety error', async (ctx) => {
    requireOrSkip(ctx, sapGitAvailable ? true : undefined, SkipReason.BACKEND_UNSUPPORTED);
    const backend = gctsAvailable ? 'gcts' : 'abapgit';
    const args: Record<string, unknown> = {
      action: 'clone',
      backend,
      url: 'https://github.com/abapGit-tests/CLAS.git',
    };
    if (backend === 'abapgit') args.package = '$TMP';

    const result = await callTool(client, 'SAPGit', args);
    const text = (result.content?.[0]?.text ?? '') as string;

    if (result.isError && text.includes('Git write')) {
      expectToolError(result, 'allowGitWrites=false');
      return;
    }
    skipTest(
      ctx,
      'Server appears to run with --allow-git-writes=true; write safety gate is not expected in this environment',
    );
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
