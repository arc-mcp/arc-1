import { describe, expect, it } from 'vitest';
import {
  buildIdeLink,
  ECLIPSE_TEMPLATE,
  formatIdeLink,
  objectIdentity,
  resolveTemplate,
  VSCODE_TEMPLATE,
} from '../../../src/server/ide-links.js';

// Client identities measured 2026-08-03 against MCP protocol 2025-11-25.
const VS_CODE = 'Visual Studio Code/1.131.0';
const CLAUDE_DESKTOP = 'claude-ai/0.1.0';
const CLAUDE_CODE = 'local-agent-mode-arc-1/1.0.0';

describe('resolveTemplate', () => {
  it('emits nothing when off or empty', () => {
    expect(resolveTemplate('off', VS_CODE)).toBeUndefined();
    expect(resolveTemplate('', VS_CODE)).toBeUndefined();
  });

  it('auto picks the VS Code bridge link for VS Code and its forks', () => {
    expect(resolveTemplate('auto', VS_CODE)).toBe(VSCODE_TEMPLATE);
    expect(resolveTemplate('auto', 'Cursor (Visual Studio Code)/1.0')).toBe(VSCODE_TEMPLATE);
  });

  it('auto emits nothing for a client with no IDE to open', () => {
    // Claude Desktop and Claude Code have no ABAP editor — a link there would go nowhere.
    expect(resolveTemplate('auto', CLAUDE_DESKTOP)).toBeUndefined();
    expect(resolveTemplate('auto', CLAUDE_CODE)).toBeUndefined();
    expect(resolveTemplate('auto', undefined)).toBeUndefined();
    expect(resolveTemplate('auto', 'some-unknown-client/9')).toBeUndefined();
  });

  it('an explicit mode overrides detection — this is how a Claude Desktop user opts in', () => {
    expect(resolveTemplate('vscode', CLAUDE_DESKTOP)).toBe(VSCODE_TEMPLATE);
    expect(resolveTemplate('eclipse', CLAUDE_DESKTOP)).toBe(ECLIPSE_TEMPLATE);
    expect(resolveTemplate('https://wiki/{name}', CLAUDE_CODE)).toBe('https://wiki/{name}');
  });
});

describe('buildIdeLink', () => {
  it('fills the VS Code template and url-encodes values', () => {
    expect(buildIdeLink(VSCODE_TEMPLATE, { name: 'ZCL_X', package: '$TMP' })).toBe(
      'vscode://marianfoo.arc1-abap-bridge/open?name=ZCL_X&package=%24TMP',
    );
  });

  it('treats package as optional and leaves no dangling parameter', () => {
    expect(buildIdeLink(VSCODE_TEMPLATE, { name: 'ZCL_X' })).toBe(
      'vscode://marianfoo.arc1-abap-bridge/open?name=ZCL_X',
    );
  });

  it('builds an adt:// link from the object uri, sid and client', () => {
    const link = buildIdeLink(ECLIPSE_TEMPLATE, {
      uri: '/sap/bc/adt/oo/classes/zcl_x',
      sid: 'A4H',
      client: '001',
    });
    // The object uri is a PATH — its slashes must survive, or the link does not resolve.
    expect(link).toBe('adt://A4H/sap/bc/adt/oo/classes/zcl_x?sap-client=001');
  });

  it('percent-encodes path segments without destroying the separators', () => {
    const link = buildIdeLink(ECLIPSE_TEMPLATE, {
      uri: '/sap/bc/adt/functions/groups/my group/fmodules/z fm',
      sid: 'A4H',
      client: '001',
    });
    expect(link).toBe('adt://A4H/sap/bc/adt/functions/groups/my%20group/fmodules/z%20fm?sap-client=001');
  });

  it('returns undefined rather than a half-built link when a required value is missing', () => {
    // No destination name configured — an adt:// link without a system is useless.
    expect(buildIdeLink(ECLIPSE_TEMPLATE, { uri: '/sap/bc/adt/oo/classes/zcl_x', client: '001' })).toBeUndefined();
    expect(buildIdeLink(VSCODE_TEMPLATE, { package: 'ZFOO' })).toBeUndefined();
  });
});

describe('objectIdentity', () => {
  it('recognises a single object', () => {
    expect(objectIdentity({ type: 'clas', name: 'zcl_x' })).toEqual({ type: 'CLAS', name: 'ZCL_X' });
  });

  it('ignores calls that are not about exactly one object', () => {
    expect(objectIdentity({ type: 'CLAS' })).toBeUndefined();
    expect(objectIdentity({ name: 'ZCL_X' })).toBeUndefined();
    expect(objectIdentity({ type: 'CLAS', name: 'ZCL_*' })).toBeUndefined(); // a search
    expect(objectIdentity({ type: 'CLAS', name: 'ZCL_A,ZCL_B' })).toBeUndefined(); // a list
    expect(objectIdentity({ type: 'CLAS', name: '   ' })).toBeUndefined();
  });
});

describe('formatIdeLink', () => {
  it('leads with a newline so clients that concatenate blocks stay readable', () => {
    // Measured: ARC-1's CLI and Claude Desktop both join content blocks with no separator,
    // producing `endmethod.Open ZCL_X …` without this.
    const line = formatIdeLink('vscode://x', 'ZCL_X');
    expect(line).toBe('\nOpen ZCL_X in your IDE: vscode://x');
  });
});
