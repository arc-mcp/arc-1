import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { graphConfigured, resolveGraphConnection } from '../../../src/repository-graph/connection.js';
import { resolveConfig } from '../../../src/server/config.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { KEY } from './helpers.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(extra: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'arc-graph-'));
  dirs.push(dir);
  const key = join(dir, 'key');
  const file = join(dir, 'connection.json');
  writeFileSync(key, KEY, { mode: 0o600 });
  const descriptor = {
    version: 1,
    url: 'http://127.0.0.1:8091',
    systemKey: 'TEST-001',
    audience: 'trial',
    sharing: 'shared-repository-metadata',
    apiKeyFile: key,
    ...extra,
  };
  writeFileSync(file, JSON.stringify(descriptor), { mode: 0o600 });
  return { config: { ...DEFAULT_CONFIG, graphConnectionFile: file }, key, file, descriptor };
}
describe('graph connection', () => {
  it('is off without explicit file/binding, ignores VCAP and explicit off wins', () => {
    expect(graphConfigured(DEFAULT_CONFIG)).toBe(false);
    expect(() => resolveGraphConnection(DEFAULT_CONFIG, { VCAP_SERVICES: 'invalid' })).toThrow('not_configured');
    expect(graphConfigured({ graphMode: 'off', graphConnectionFile: '/missing' })).toBe(false);
  });
  it('loads a private file and rereads rotated key without retaining it in config', () => {
    const { config, key } = fixture();
    const conn = resolveGraphConnection(config);
    expect(conn.readKey()).toBe(KEY);
    writeFileSync(key, `${KEY}-rotated`);
    expect(conn.readKey()).toBe(`${KEY}-rotated`);
    expect(JSON.stringify(config)).not.toContain(KEY);
  });
  it.each([
    { url: 'http://untrusted.invalid' },
    { url: 'https://user:secret@example.org/' },
    { url: 'https://example.org/path' },
    { url: 'https://example.org/?key=secret' },
    { sharing: 'assumed-sap-login' },
    { audience: '' },
    { apiKey: KEY },
    { apiKeyFile: 'relative' },
    { unexpected: true },
  ])('rejects invalid descriptor %j with a secret-free diagnostic', (extra) => {
    expect(() => resolveGraphConnection(fixture(extra).config)).toThrow('Repository graph: invalid_connection');
  });
  it('allows explicitly approved HTTP networking but never SAP_INSECURE as permission', () => {
    expect(
      resolveGraphConnection(fixture({ url: 'http://graph.internal:8091', allowInsecureHttp: true }).config).url,
    ).toBe('http://graph.internal:8091');
    expect(() =>
      resolveGraphConnection({ ...fixture({ url: 'http://graph.internal' }).config, insecure: true }),
    ).toThrow('invalid_connection');
  });
  it('rejects readable secret or descriptor files on POSIX', () => {
    const { config, key, file } = fixture();
    chmodSync(key, 0o644);
    expect(() => resolveGraphConnection(config)).toThrow('invalid_connection');
    chmodSync(key, 0o600);
    chmodSync(file, 0o644);
    expect(() => resolveGraphConnection(config)).toThrow('invalid_connection');
  });
  it('requires exactly one selected user-provided binding and file has precedence', () => {
    const { config, descriptor } = fixture();
    const { apiKeyFile: _, ...rest } = descriptor;
    const service = { name: 'arc1-repository-graph', label: 'user-provided', credentials: { ...rest, apiKey: KEY } };
    const bound = { ...DEFAULT_CONFIG, graphServiceBinding: service.name };
    expect(
      resolveGraphConnection(bound, { VCAP_SERVICES: JSON.stringify({ 'user-provided': [service] }) }).readKey(),
    ).toBe(KEY);
    expect(() =>
      resolveGraphConnection(bound, { VCAP_SERVICES: JSON.stringify({ 'user-provided': [service, service] }) }),
    ).toThrow('invalid_connection');
    expect(
      resolveGraphConnection({ ...config, graphServiceBinding: service.name }, { VCAP_SERVICES: 'invalid' }).readKey(),
    ).toBe(KEY);
    expect(() => resolveGraphConnection({ ...config, multiTargetEndpoints: true })).toThrow('invalid_connection');
  });
  it('resolves CLI configuration with explicit disable', () => {
    const { config } = resolveConfig(['--graph', 'off', '--graph-connection-file', '/private/file']);
    expect(config.graphMode).toBe('off');
    expect(config.graphConnectionFile).toBe('/private/file');
  });
});
