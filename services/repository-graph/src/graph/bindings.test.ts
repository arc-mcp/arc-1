import { describe, expect, it } from 'vitest';
import { boundPgConfig, selectedBinding } from './bindings.js';
import { graphApiKeys, graphPoolConfig } from './config.js';

const key = 'TEST_DATABASE_PASSWORD_CANARY';
const service = {
  name: 'graph-reader',
  credentials: {
    host: 'db.internal',
    port: '5432',
    dbname: 'graph',
    username: 'reader',
    password: key,
    sslcert: 'test-ca',
  },
};
const env = {
  ARC_GRAPH_PG_SERVICE_BINDING: service.name,
  VCAP_SERVICES: JSON.stringify({ 'user-provided': [service] }),
};
describe('explicit CF graph bindings', () => {
  it('uses a named binding with verified TLS and ignores ambient PG overrides', () => {
    expect(
      graphPoolConfig({ ...env, PGHOST: 'wrong', ARC_GRAPH_PG_SSL: 'false', ARC_GRAPH_APPLICATION_NAME: 'graph-api' }),
    ).toMatchObject({
      host: 'db.internal',
      user: 'reader',
      ssl: { rejectUnauthorized: true, ca: 'test-ca' },
      max: 5,
      statement_timeout: 2000,
    });
  });
  it.each(['{}', 'invalid', JSON.stringify({ pg: [service, service] })])(
    'fails closed for missing/malformed/ambiguous selection',
    (VCAP_SERVICES) => {
      expect(() => boundPgConfig({ VCAP_SERVICES }, service.name)).toThrow('Invalid graph PostgreSQL binding');
    },
  );
  it('never exposes raw credentials on validation failure', () => {
    const bad = {
      VCAP_SERVICES: JSON.stringify({ pg: [{ ...service, credentials: { ...service.credentials, port: key } }] }),
    };
    expect(() => boundPgConfig(bad, service.name)).toThrow(/^Invalid graph PostgreSQL binding$/);
  });
  it('refuses implicit cloud databases and unbounded pool settings', () => {
    expect(() => graphPoolConfig({ VCAP_APPLICATION: '{}' })).toThrow('explicitly selected');
    for (const ARC_GRAPH_PG_POOL_MAX of ['0', '11', 'NaN', '1.5'])
      expect(() => graphPoolConfig({ ARC_GRAPH_PG_POOL_MAX })).toThrow('1..10');
  });
  it('ignores unrelated service bindings and preserves local Docker configuration', () => {
    expect(graphPoolConfig({ PGHOST: 'postgres', PGUSER: 'arc_graph_writer' })).toMatchObject({
      host: 'postgres',
      user: 'arc_graph_writer',
    });
    expect(() => selectedBinding(env, 'unselected')).toThrow('Invalid or ambiguous');
  });
  it('uses only the explicitly selected API secret and fails closed without it', () => {
    const apiKey = 'a'.repeat(64);
    const auth = {
      ARC_GRAPH_API_AUTH_BINDING: 'graph-auth',
      ARC_GRAPH_API_KEY: 'b'.repeat(64),
      VCAP_SERVICES: JSON.stringify({ 'user-provided': [{ name: 'graph-auth', credentials: { apiKey } }] }),
    };
    expect(graphApiKeys(auth)).toEqual([apiKey]);
    expect(() => graphApiKeys({ ...auth, VCAP_SERVICES: '{}' })).toThrow('Invalid or ambiguous');
    expect(() =>
      graphApiKeys({ ...auth, VCAP_SERVICES: auth.VCAP_SERVICES.replace(apiKey, 'short-secret-canary') }),
    ).toThrow(/^Invalid graph API credential binding$/);
  });
});
