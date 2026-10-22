import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../../../src/cli.js';
import { buildIdeConfigFragment } from '../../../src/cli-ide.js';
import { resolveHttpIdeContext } from '../../../src/server/ide-request.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';

afterEach(() => vi.restoreAllMocks());

describe('offline IDE configuration helper', () => {
  it('generates local Eclipse settings and keeps Claude links off by default', () => {
    expect(buildIdeConfigFragment({ client: 'eclipse', systemId: 'A4H' })).toEqual({
      env: { ARC1_IDE_LINKS: 'eclipse', ARC1_IDE_SYSTEM_ID: 'A4H' },
    });
    expect(buildIdeConfigFragment({ client: 'claude' })).toEqual({
      env: { ARC1_IDE_LINKS: 'off', ARC1_IDE_SYSTEM_ID: '' },
    });
  });
  it.each(['/mcp', '/A4H-2025/001/mcp', '/multi/mcp'])(
    'generates Eclipse headers for %s without alias mappings',
    (path) => {
      const endpoint = `https://arc.example${path}`;
      const fragment = buildIdeConfigFragment({ client: 'eclipse', endpoint });
      expect(fragment).toEqual({ requestInit: { headers: { 'Arc1-Ide-Client': 'eclipse' } } });
      const targetId = path === '/mcp' ? undefined : 'A4H-2025/001';
      expect(
        resolveHttpIdeContext(
          {
            ...DEFAULT_CONFIG,
            transport: 'http-streamable',
            ideLinks: 'eclipse',
            ideSystemId: 'A4H',
            targetId,
            multiTargetEndpoints: !!targetId,
          },
          { 'arc1-ide-client': 'eclipse' },
        ),
      ).toEqual({ style: 'eclipse', systemId: 'A4H', target: targetId });
      expect(buildIdeConfigFragment({ client: 'claude', editor: 'eclipse', endpoint })).toEqual({
        headers: { 'Arc1-Ide-Client': 'eclipse' },
      });
    },
  );
  it('rejects malformed or mixed setup inputs', () => {
    for (const endpoint of [
      'https://user:pass@arc.example/mcp',
      'https://arc.example/mcp?token=secret',
      'https://arc.example/mcp#x',
      'file:///mcp',
      'https://arc.example/unknown',
      'bad',
    ]) {
      expect(() => buildIdeConfigFragment({ client: 'eclipse', endpoint })).toThrow();
    }
    expect(() => buildIdeConfigFragment({ client: 'eclipse' })).toThrow(/system-id/);
    expect(() => buildIdeConfigFragment({ client: 'eclipse', systemId: 'DEV-001' })).toThrow(/system-id/);
    expect(() =>
      buildIdeConfigFragment({ client: 'eclipse', systemId: 'A4H', endpoint: 'https://arc.example/mcp' }),
    ).toThrow(/server supplies/);
    expect(() => buildIdeConfigFragment({ client: 'claude', systemId: 'A4H' })).toThrow(/only for Eclipse/);
  });
  it.each(['eclipse', 'claude'] as const)('explains how to disable HTTP links for %s', (client) => {
    expect(() => buildIdeConfigFragment({ client, editor: 'off', endpoint: 'https://arc.example/mcp' })).toThrow(
      /sends no Arc1-Ide-\* headers; remove them/,
    );
  });
  it.each([
    ['--client', '001', 'config', 'ide', '--mcp-client', 'eclipse', '--system-id', 'A4H'],
    ['config', 'ide', '--client', 'eclipse', '--endpoint', 'https://arc.example/mcp'],
  ])('rejects SAP --client instead of silently consuming it (%j)', async (...args) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const forbidden = vi.fn(() => {
      throw new Error('Must stay offline');
    });
    expect(
      await main(args, { resolveConfiguration: forbidden, createClient: forbidden, flushLogger: async () => {} }),
    ).toBe(2);
    expect(error.mock.calls.flat().join(' ')).toContain('--client is the SAP logon client; use --mcp-client');
    expect(log).not.toHaveBeenCalled();
    expect(forbidden).not.toHaveBeenCalled();
  });
  it('runs through the CLI without resolving SAP config or creating a connection', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const forbidden = vi.fn(() => {
      throw new Error('Must stay offline');
    });
    const status = await main(
      ['config', 'ide', '--mcp-client', 'eclipse', '--endpoint', 'https://arc.example/A4H/001/mcp'],
      { resolveConfiguration: forbidden, createClient: forbidden, flushLogger: async () => {} },
    );
    expect(status).toBe(0);
    expect(forbidden).not.toHaveBeenCalled();
    expect(JSON.parse(log.mock.calls[0][0])).toEqual({ requestInit: { headers: { 'Arc1-Ide-Client': 'eclipse' } } });
  });
});
