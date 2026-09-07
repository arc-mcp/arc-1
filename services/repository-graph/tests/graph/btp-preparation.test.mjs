import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  postgresArtifacts,
  prepareBtpPostgres,
  validateBtpSettings,
} from '../../scripts/graph/prepare-btp-postgres.mjs';

const settings = {
  subaccount: '12345678-1234-1234-1234-123456789abc',
  database: 'graph-db',
  databaseKey: 'bootstrap',
  prefix: 'graph',
  url: 'https://graph.example.test',
  systemKey: 'TEST-001',
  audience: 'shared',
  sharing: 'shared-repository-metadata',
};
const credentials = {
  hostname: 'db.example.test',
  dbname: 'db',
  port: 5432,
  username: 'administrator',
  password: 'ADMIN_CANARY',
};
it('never hands the administrator password or role to runtime/ARC artifacts', () => {
  const result = postgresArtifacts(settings, credentials);
  expect(JSON.stringify(result)).not.toContain('ADMIN_CANARY');
  expect(JSON.stringify(result)).not.toContain('administrator');
  expect(result['reader.json'].user).toBe('arc_graph_api');
  expect(result['connection.json'].apiKey).toBe(result['api-auth.json'].apiKey);
  expect(() => validateBtpSettings({ ...settings, sharing: undefined })).toThrow();
  expect(() => validateBtpSettings({ ...settings, url: 'http://graph.example.test' })).toThrow();
});
it('uses the selected key and creates private artifacts without overwriting an existing setup', () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'graph-btp-')));
  const target = join(parent, 'output');
  const api = (path) =>
    path.endsWith('/details') ? { credentials } : { resources: [{ guid: 'key', name: 'bootstrap' }] };
  const check = () => ({ databaseGuid: 'db', databaseOffering: 'postgresql-db' });
  try {
    prepareBtpPostgres(settings, target, api, check);
    expect(statSync(join(target, 'connection.json')).mode & 0o777).toBe(0o600);
    const previous = readFileSync(join(target, 'connection.json'), 'utf8');
    expect(() => prepareBtpPostgres(settings, target, api, check)).toThrow();
    expect(readFileSync(join(target, 'connection.json'), 'utf8')).toBe(previous);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
