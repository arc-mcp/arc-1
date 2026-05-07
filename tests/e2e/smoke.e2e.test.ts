/**
 * E2E Smoke Tests
 *
 * Quick sanity check that the MCP server is running, connected to SAP,
 * and basic tool calls work. Run these first before the full suite.
 *
 * These tests use only standard SAP objects (no custom Z objects needed).
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  callTool,
  classifyToolErrorSkip,
  connectClient,
  expectToolError,
  expectToolSuccess,
  expectToolSuccessOrSkip,
} from './helpers.js';

describe('E2E Smoke Tests', () => {
  let client: Client;

  beforeAll(async () => {
    client = await connectClient();
  });

  afterAll(async () => {
    try {
      await client?.close();
    } catch {
      // Ignore close errors
    }
  });

  // ── Connection ─────────────────────────────────────────────────

  it('connects to MCP server and lists tools', async () => {
    const tools = await client.listTools();
    expect(tools.tools.length).toBeGreaterThan(0);

    const toolNames = tools.tools.map((t) => t.name);
    expect(toolNames).toContain('SAPRead');
    expect(toolNames).toContain('SAPSearch');
    expect(toolNames).toContain('SAPQuery');
    expect(toolNames).toContain('SAPContext');

    console.log(`    Tools available: ${toolNames.join(', ')}`);
  });

  // ── SAPRead: System info (no SAP object needed) ────────────────

  it('SAPRead SYSTEM — returns system info', async () => {
    const result = await callTool(client, 'SAPRead', { type: 'SYSTEM' });
    const text = expectToolSuccess(result);
    const parsed = JSON.parse(text);
    expect(parsed.user).toBeTruthy();
    // User depends on server config — just verify it's set
    expect(typeof parsed.user).toBe('string');
  });

  it('SAPRead COMPONENTS — returns installed components', async () => {
    const result = await callTool(client, 'SAPRead', { type: 'COMPONENTS' });
    const text = expectToolSuccess(result);
    const components = JSON.parse(text);
    expect(components.length).toBeGreaterThan(0);
    const basis = components.find((c: { name: string }) => c.name === 'SAP_BASIS');
    expect(basis).toBeDefined();
    expect(basis.release).toBeTruthy();
    console.log(`    SAP_BASIS release: ${basis.release}`);
  });

  // ── SAPRead: Standard program ──────────────────────────────────

  it('SAPRead PROG — reads standard SAP program RSHOWTIM', async () => {
    const result = await callTool(client, 'SAPRead', { type: 'PROG', name: 'RSHOWTIM' });
    const text = expectToolSuccess(result);
    expect(text.length).toBeGreaterThan(10);
  });

  // ── SAPRead: Standard class ────────────────────────────────────

  it('SAPRead CLAS — reads standard class CL_ABAP_CHAR_UTILITIES', async () => {
    const result = await callTool(client, 'SAPRead', { type: 'CLAS', name: 'CL_ABAP_CHAR_UTILITIES' });
    const text = expectToolSuccess(result);
    expect(text.length).toBeGreaterThan(0);
  });

  // ── SAPRead: Table structure ───────────────────────────────────

  it('SAPRead TABL — reads T000 table structure', async (ctx) => {
    const result = await callTool(client, 'SAPRead', { type: 'TABL', name: 'T000' });
    const text = expectToolSuccessOrSkip(ctx, result);
    expect(text).toBeTruthy();
  });

  // ── SAPRead: Table contents ────────────────────────────────────

  it('SAPRead TABLE_CONTENTS — reads T000 data', async (ctx) => {
    const result = await callTool(client, 'SAPRead', { type: 'TABLE_CONTENTS', name: 'T000', maxRows: 5 });
    const text = expectToolSuccessOrSkip(ctx, result);
    const data = JSON.parse(text);
    expect(data.columns).toContain('MANDT');
    expect(data.rows.length).toBeGreaterThan(0);
  });

  // ── SAPRead: DDIC objects ───────────────────────────────────────

  it('SAPRead TABL — reads BAPIRET2 DDIC structure via unified TABL type', async () => {
    // Model B: structures and transparent tables both use type='TABL'.
    // ARC-1 auto-resolves /sap/bc/adt/ddic/tables/ → /sap/bc/adt/ddic/structures/.
    const result = await callTool(client, 'SAPRead', { type: 'TABL', name: 'BAPIRET2' });
    const text = expectToolSuccess(result);
    expect(text).toContain('bapiret2');
    expect(text).toContain('message');
  });

  it('SAPRead TABL — reads T000 transparent table via unified TABL type', async () => {
    const result = await callTool(client, 'SAPRead', { type: 'TABL', name: 'T000' });
    const text = expectToolSuccess(result);
    expect(text.toLowerCase()).toContain('t000');
  });

  it('SAPRead — type=STRU is rejected with a schema validation error', async () => {
    const result = await callTool(client, 'SAPRead', { type: 'STRU', name: 'BAPIRET2' });
    // Zod rejects STRU at validation; error mentions valid types (incl. TABL).
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('Invalid arguments for SAPRead');
  });

  it('SAPRead DOMA — reads BUKRS domain metadata', async (ctx) => {
    const result = await callTool(client, 'SAPRead', { type: 'DOMA', name: 'BUKRS' });
    const text = expectToolSuccessOrSkip(ctx, result);
    const domain = JSON.parse(text);
    expect(domain.name).toBe('BUKRS');
    expect(domain.dataType).toBe('CHAR');
    expect(domain.length).toBeTruthy();
  });

  it('SAPRead DTEL — reads BUKRS data element metadata', async () => {
    const result = await callTool(client, 'SAPRead', { type: 'DTEL', name: 'BUKRS' });
    const text = expectToolSuccess(result);
    const dtel = JSON.parse(text);
    expect(dtel.name).toBe('BUKRS');
    expect(dtel.typeKind).toBe('domain');
    expect(dtel.typeName).toBe('BUKRS');
    expect(dtel.mediumLabel).toBeTruthy();
  });

  it('SAPRead TRAN — reads SE38 transaction metadata', async (ctx) => {
    const result = await callTool(client, 'SAPRead', { type: 'TRAN', name: 'SE38' });
    const text = expectToolSuccessOrSkip(ctx, result);
    let tran: { code: string; description?: string; program?: string };
    try {
      tran = JSON.parse(text);
    } catch {
      // Some releases return a plain-text placeholder when transaction metadata
      // isn't available for standard transactions — skip rather than fail.
      ctx.skip(
        `Backend feature not supported on this SAP system: TRAN metadata read returned non-JSON (${text.slice(0, 80)})`,
      );
      return;
    }
    if (!tran.program || tran.program === '') {
      ctx.skip('Backend feature not supported on this SAP system: TRAN metadata empty on this release');
      return;
    }
    expect(tran.code).toBe('SE38');
    expect(tran.description).toBeTruthy();
    expect(tran.program).toBe('RSABAPPROGRAM');
  });

  // ── SAPSearch ──────────────────────────────────────────────────

  it('SAPSearch — finds standard classes', async () => {
    const result = await callTool(client, 'SAPSearch', { query: 'CL_ABAP_CHAR*', maxResults: 5 });
    const text = expectToolSuccess(result);
    const results = JSON.parse(text);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].objectName).toMatch(/^CL_ABAP_CHAR/);
    expect(results[0]).toHaveProperty('objectType');
    expect(results[0]).toHaveProperty('uri');
  });

  it('SAPSearch — returns empty for non-existent', async () => {
    const result = await callTool(client, 'SAPSearch', { query: 'ZZZNONEXISTENT999*', maxResults: 5 });
    const text = expectToolSuccess(result);
    // Response starts with "[]" JSON but may include LLM guidance hints after it
    expect(text).toMatch(/^\[\]\s*/);
  });

  // ── SAPQuery ───────────────────────────────────────────────────

  it('SAPQuery — SELECT from T000', async (ctx) => {
    const result = await callTool(client, 'SAPQuery', { sql: 'SELECT * FROM T000', maxRows: 5 });
    if (result.isError) {
      const text = result.content?.[0]?.text ?? '';
      // SAPQuery depends on /datapreview/freestyle, which is absent on some older releases.
      // The handler wraps the 404 into a "Table not found" message.
      if (/Table .* not found/i.test(text) || classifyToolErrorSkip(result) !== null) {
        ctx.skip(
          'Backend feature not supported on this SAP system: SAPQuery relies on /datapreview/freestyle, absent on this release',
        );
        return;
      }
    }
    const text = expectToolSuccess(result);
    const data = JSON.parse(text);
    expect(data.columns).toContain('MANDT');
    expect(data.rows.length).toBeGreaterThan(0);
  });

  // ── SAPLint ────────────────────────────────────────────────────

  it('SAPLint — lints ABAP source locally', async () => {
    const result = await callTool(client, 'SAPLint', {
      action: 'lint',
      source: 'REPORT ztest.\nWRITE: / sy-datum.',
    });
    const text = expectToolSuccess(result);
    // Returns JSON array of issues (may be empty for clean code)
    const issues = JSON.parse(text);
    expect(Array.isArray(issues)).toBe(true);
  });

  it('SAPLint — formats ABAP source via ADT PrettyPrinter', async () => {
    // The PrettyPrinter honors the SAP user's keyword-case preference
    // (keywordUpper / keywordLower / keywordAuto). We probe the active
    // setting and assert accordingly instead of hardcoding uppercase —
    // which broke on NW 7.50 where the default is lower/auto.
    const settingsResult = await callTool(client, 'SAPLint', { action: 'get_formatter_settings' });
    const settings = JSON.parse(expectToolSuccess(settingsResult));
    const style = String(settings.style ?? 'none');

    const result = await callTool(client, 'SAPLint', {
      action: 'format',
      source: 'report ztest.\ndata lv type string.\n',
    });
    const text = expectToolSuccess(result);

    // Source must have been normalized in SOME way (the assertion that matters
    // is "PrettyPrinter responded with reformatted content", not casing).
    expect(text.length).toBeGreaterThan(0);
    if (style === 'keywordUpper') {
      expect(text).toContain('REPORT');
      expect(text).toContain('DATA');
    } else if (style === 'keywordLower') {
      expect(text.toLowerCase()).toContain('report');
      expect(text.toLowerCase()).toContain('data');
    }
    // keywordAuto / none — only assert that formatter ran without stripping content.
    expect(text.toLowerCase()).toContain('report');
    expect(text.toLowerCase()).toContain('data');
  });

  it('SAPLint — reads formatter settings', async () => {
    const result = await callTool(client, 'SAPLint', { action: 'get_formatter_settings' });
    const text = expectToolSuccess(result);
    const settings = JSON.parse(text);
    expect(typeof settings.indentation).toBe('boolean');
    expect(['keywordUpper', 'keywordLower', 'keywordAuto', 'none']).toContain(settings.style);
  });

  // ── SAPManage ──────────────────────────────────────────────────

  it('SAPManage probe — detects system features', async () => {
    const result = await callTool(client, 'SAPManage', { action: 'probe' });
    const text = expectToolSuccess(result);
    const features = JSON.parse(text);
    // Should have feature entries with expected shape
    expect(typeof features).toBe('object');
  });

  // ── Error handling ─────────────────────────────────────────────

  it('SAPWrite — write policy is explicit (read-only error or writable create+delete)', async (ctx) => {
    const objectName = `ZARC1_E2E_WPOL${Date.now().toString().slice(-8)}`;
    const result = await callTool(client, 'SAPWrite', {
      action: 'create',
      type: 'PROG',
      name: objectName,
      source: `REPORT ${objectName}.\nWRITE: / 'write-policy'.`,
      package: '$TMP',
    });

    if (result.isError) {
      const text = expectToolError(result);
      // Safety system blocks writes in read-only mode — message varies by config
      if (/read-only/i.test(text) || /blocked by safety/i.test(text)) {
        expect(text).toMatch(/read-only|blocked by safety/i);
        return;
      }
      // Known backend quirk on NW 7.50 trial — create+PUT hits 423 on the PUT step.
      const skipReason = classifyToolErrorSkip(result);
      if (skipReason !== null) {
        ctx.skip(skipReason);
        return;
      }
      throw new Error(`Unexpected SAPWrite create failure in write-policy smoke test: ${text}`);
    }

    const createText = expectToolSuccess(result);
    expect(createText).toContain(`Created PROG ${objectName}`);

    // best-effort-cleanup
    const deleteResult = await callTool(client, 'SAPWrite', {
      action: 'delete',
      type: 'PROG',
      name: objectName,
    });
    if (deleteResult.isError) {
      console.warn(`    [cleanup] Failed to delete ${objectName}: ${deleteResult.content[0]?.text ?? 'unknown error'}`);
    }
  });

  it('SAPRead — 404 for non-existent program returns error with hint', async () => {
    const result = await callTool(client, 'SAPRead', { type: 'PROG', name: 'ZZZNOTEXIST999' });
    expectToolError(result, 'ZZZNOTEXIST999');
    const text = result.content[0].text;
    expect(text).toContain('SAPSearch'); // LLM remediation hint
  });

  it('SAPRead — invalid include returns Zod validation error with valid include values', async () => {
    const result = await callTool(client, 'SAPRead', {
      type: 'CLAS',
      name: 'CL_ABAP_CHAR_UTILITIES',
      include: 'INVALID_INCLUDE',
    });
    expectToolError(result, 'Invalid arguments for SAPRead');
    const text = result.content[0].text;
    expect(text).toContain('Valid values');
    expect(text).toContain('main');
    expect(text).toContain('testclasses');
  });

  it('SAPActivate — non-existent object returns actionable error', async () => {
    const result = await callTool(client, 'SAPActivate', { type: 'PROG', name: 'ZZZNOTEXIST999' });
    expectToolError(result);
    const text = result.content[0].text;
    // In read-only mode, activation is blocked by safety before reaching SAP.
    // In writable mode, SAP returns 404 with a not-found hint.
    expect(text).toMatch(/blocked by safety|ZZZNOTEXIST999|not found/i);
  });

  it('SAPRead — unknown type returns Zod validation error', async () => {
    const result = await callTool(client, 'SAPRead', { type: 'FOOBAR' });
    expectToolError(result, 'Invalid arguments for SAPRead');
  });

  it('SAPLint — unknown action returns Zod validation error', async () => {
    const result = await callTool(client, 'SAPLint', { action: 'foobar' });
    expectToolError(result, 'Invalid arguments for SAPLint');
  });

  it('SAPLint — atc action returns Zod validation error', async () => {
    const result = await callTool(client, 'SAPLint', { action: 'atc' });
    expectToolError(result, 'Invalid arguments for SAPLint');
  });

  it('SAPLint — syntax action returns Zod validation error', async () => {
    const result = await callTool(client, 'SAPLint', { action: 'syntax' });
    expectToolError(result, 'Invalid arguments for SAPLint');
  });
});
