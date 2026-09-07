import { describe, expect, it } from 'vitest';
import { hanaConfig, loadHanaDriver } from './hana-connection.js';

const env = (credentials: Record<string, unknown>) => ({
  ARC_GRAPH_HANA_SERVICE_BINDING: 'graph-reader',
  VCAP_SERVICES: JSON.stringify({ 'user-provided': [{ name: 'graph-reader', credentials }] }),
});
const credentials = {
  host: 'test.hanacloud.ondemand.com',
  port: 443,
  user: 'GRAPH_READER',
  password: 'secret',
  schema: 'ARC_GRAPH',
};
describe('HANA connection boundary', () => {
  it('loads the actual official driver from ESM without opening a connection', async () => {
    expect(typeof (await loadHanaDriver()).createConnection).toBe('function');
  });
  it('requires explicit binding and validated TLS regardless of extra credentials', () => {
    expect(() => hanaConfig({})).toThrow('Explicit HANA binding');
    expect(hanaConfig(env({ ...credentials, sslValidateCertificate: false }))).toMatchObject({
      encrypt: true,
      sslValidateCertificate: true,
      currentSchema: 'ARC_GRAPH',
      connectTimeout: 2000,
    });
  });
  it('rejects invalid authority and identifiers', () => {
    for (const patch of [{ host: 'a@b' }, { port: 80 }, { user: 'A;B' }, { schema: 'A"B' }])
      expect(() => hanaConfig(env({ ...credentials, ...patch }))).toThrow();
  });
  it('forbids DBADMIN outside explicit bootstrap', () => {
    expect(() => hanaConfig(env({ ...credentials, user: 'DBADMIN' }))).toThrow('forbidden');
    expect(hanaConfig({ ...env({ ...credentials, user: 'DBADMIN' }), ARC_GRAPH_HANA_BOOTSTRAP: 'true' }).uid).toBe(
      'DBADMIN',
    );
  });
});
