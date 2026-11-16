import { execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeSamlMaterial(algorithm: 'rsa' | 'ec' = 'rsa') {
  const pair =
    algorithm === 'rsa'
      ? generateKeyPairSync('rsa', { modulusLength: 2048 })
      : generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const publicKeyPem = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const dir = mkdtempSync(join(tmpdir(), 'arc1-saml-test-'));
  const keyFile = join(dir, 'idp.key');
  const certFile = join(dir, 'idp.crt');
  writeFileSync(keyFile, privateKeyPem, { mode: 0o600 });
  execFileSync('openssl', [
    'req',
    '-new',
    '-x509',
    '-key',
    keyFile,
    '-out',
    certFile,
    '-days',
    '1',
    '-subj',
    '/CN=arc1-test',
  ]);
  const certificatePem = readFileSync(certFile, 'utf8');
  return {
    privateKeyPem,
    publicKeyPem,
    certificatePem,
    keyFile,
    certFile,
    cleanup: () => rmSync(dir, { recursive: true }),
  };
}
