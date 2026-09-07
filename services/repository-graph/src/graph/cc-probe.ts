import assert from 'node:assert/strict';
import { lookup } from 'node:dns/promises';
import { Pool } from 'undici';
import { ConnectivityTransport, connectivityConfig } from '../connectivity.js';
import { resolveDestination } from '../destination.js';
import { searchRepository } from '../inventory.js';
import { SapClient } from '../sap.js';
import { sourcePathFromObject } from '../sources.js';

/** Read-only CF diagnostic; emits assertions and counts, never source/cookies/tokens. */
async function main() {
  const destination = process.env.SAP_DESTINATION;
  assert.ok(destination, 'Named Cloud Connector destination required');
  const resolved = await resolveDestination(destination);
  const config = resolved.destinationConfiguration;
  assert.equal(config.ProxyType, 'OnPremise');
  assert.equal(config.Authentication, 'BasicAuthentication');
  const header = resolved.authTokens?.find(
    (token) => token.http_header?.key?.toLowerCase() === 'authorization',
  )?.http_header;
  const authorization = header?.value;
  assert.ok(authorization, 'Technical credential required');
  assert.ok(authorization.startsWith('Basic '), 'Technical Basic credential required');
  const base = new URL(config.URL!);
  let directDnsUnavailable = false;
  try {
    await lookup(base.hostname);
  } catch (error) {
    directDnsUnavailable = (error as NodeJS.ErrnoException).code === 'ENOTFOUND';
  }
  assert.equal(directDnsUnavailable, true, 'Proof requires a virtual hostname unavailable to direct CF DNS');
  const sap = await SapClient.create(destination);
  const proxy = new ConnectivityTransport(config.CloudConnectorLocationId);
  const wrongLocation = new ConnectivityTransport('ARC1_GRAPH_NONEXISTENT_LOCATION_7A950');
  const unauthorized = new Pool(connectivityConfig().proxyOrigin);
  try {
    assert.equal(sap.transport, 'cloud-connector');
    const discovery = await sap.getText('/sap/bc/adt/core/discovery');
    assert.equal(discovery.status, 200);
    const objects = await searchRepository(sap, process.env.ARC_GRAPH_PROBE_QUERY ?? 'CL_ABAP*', 5, 'CLAS');
    assert.ok(objects.length > 0, 'Known class required for live source proof');
    const path = sourcePathFromObject({ OBJECT_TYPE: objects[0]!.type, OBJECT_URI: objects[0]!.uri });
    const source = await sap.getText(path, undefined, { accept: 'text/plain', retries: 0 });
    assert.ok(source.body.length > 100, 'Expected nonempty protected class source');
    assert.match(source.body, /\bCLASS\s+[\w/]+\s+DEFINITION\b/i, 'Expected ABAP class source, not a login page');
    const url = new URL(path, base);
    url.searchParams.set('sap-client', config['sap-client'] ?? '001');
    const anonymous = await proxy.get(url, { accept: 'text/plain' }, AbortSignal.timeout(15000));
    assert.equal(anonymous.status, 401, 'SAP must refuse the same source without the technical identity');
    const authenticated = await proxy.get(url, { authorization, accept: 'text/plain' }, AbortSignal.timeout(15000));
    assert.equal(authenticated.status, 200);
    const cookieIdentity = authenticated.headers.get('set-cookie')?.match(/SAP_SESSIONID_([A-Z0-9]+)_(\d{3})=/);
    assert.ok(cookieIdentity, 'SAP session identity evidence required');
    assert.equal(cookieIdentity[2], config['sap-client'] ?? '001');
    const wrong = await wrongLocation.get(url, { authorization, accept: 'text/plain' }, AbortSignal.timeout(15000));
    assert.ok([502, 503].includes(wrong.status), 'Unknown Cloud Connector location must fail');
    const rejected = await unauthorized.request({
      method: 'GET',
      path: url.toString(),
      signal: AbortSignal.timeout(15000),
      headers: { host: url.host, 'proxy-authorization': 'Bearer invalid-proxy-test-token' },
    });
    rejected.body.on('error', () => undefined);
    rejected.body.destroy();
    assert.equal(rejected.statusCode, 407, 'Invalid proxy token must be rejected');
    console.log(
      JSON.stringify({
        status: 'passed',
        destination,
        transport: sap.transport,
        directDnsUnavailable,
        sapSystemId: cookieIdentity[1],
        sapClient: cookieIdentity[2],
        anonymousStatus: anonymous.status,
        sourceReadStatus: source.status,
        sourceBytes: Buffer.byteLength(source.body),
        wrongLocationStatus: wrong.status,
        invalidProxyTokenStatus: rejected.statusCode,
        metrics: sap.metrics(),
        checkedAt: new Date().toISOString(),
      }),
    );
  } finally {
    await Promise.all([sap.close(), proxy.close(), wrongLocation.close(), unauthorized.destroy()]);
  }
}
main().catch((error) => {
  console.error(
    JSON.stringify({
      status: 'failed',
      operation: 'cc-probe',
      assertion: error instanceof assert.AssertionError ? error.message : 'Connection or configuration check failed',
    }),
  );
  process.exitCode = 1;
});
