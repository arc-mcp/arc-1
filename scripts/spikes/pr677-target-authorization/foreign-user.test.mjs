import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exchangeForeignUser } from './foreign-user.mjs';

const primary = { url: 'https://tenant.authentication.example', clientid: 'primary', xsappname: 'app-one' };
const foreign = {
  ...primary,
  clientid: 'foreign',
  xsappname: 'app-two',
  clientsecret: 'secret',
  uaadomain: 'authentication.example',
};
const expected = { email: 'test@example.invalid', origin: 'fixture-idp', scopes: ['read'], grantValues: ['A4H/100'] };
function fixture(overrides = {}) {
  const calls = [];
  const xssec = {
    XsuaaService: class {
      constructor(credentials) {
        assert.equal(credentials, foreign);
      }
      async createSecurityContext(token) {
        calls.push('sdk');
        assert.equal(token, 'foreign-user-token');
        if (overrides.sdkError) throw overrides.sdkError;
        return { getEmail: () => expected.email, getOrigin: () => expected.origin, ...overrides.context };
      }
    },
  };
  const auth = {
    createXsuaaTokenVerifier(credentials, options) {
      assert.equal(credentials, foreign);
      assert.deepEqual(options, { requireUserToken: true, userAttributeNames: ['arc1_targets'] });
      return async () => {
        calls.push('user-verifier');
        if (overrides.error) throw overrides.error;
        return {
          scopes: overrides.scopes ?? ['read'],
          extra: {
            xsuaaUserAttributes: { arc1_targets: overrides.values ?? expected.grantValues },
            xsuaaUserAttributeStatus: { arc1_targets: overrides.status ?? 'valid' },
          },
        };
      };
    },
  };
  return { calls, auth, xssec };
}
function tokenFetch(t) {
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(String(url), `${foreign.url}/oauth/token`);
    assert.equal(init.body.get('assertion'), 'primary-user-token');
    assert.equal(init.body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    assert.equal(init.headers.Authorization, `Basic ${Buffer.from('foreign:secret').toString('base64')}`);
    return new Response(JSON.stringify({ access_token: 'foreign-user-token', token_type: 'Bearer' }));
  });
}
test('foreign human fixture verifies issuer, supported principal, identity and exact grants before reporting evidence', async (t) => {
  tokenFetch(t);
  const f = fixture();
  const result = await exchangeForeignUser({ assertion: 'primary-user-token', primary, foreign, expected, ...f });
  assert.deepEqual(f.calls, ['sdk', 'user-verifier']);
  assert.equal(result.token.access_token, 'foreign-user-token');
  assert.equal(result.sourceEvidence.attributeCount, 1);
  for (const forbidden of ['secret', 'example.invalid', 'foreign-user-token', 'A4H/100'])
    assert.equal(JSON.stringify(result.sourceEvidence).includes(forbidden), false);
});
test('same app, foreign tenant, incomplete identity or absent grants never sends an assertion', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('must not send assertion'));
  for (const bad of [
    { foreign: { ...foreign, xsappname: primary.xsappname } },
    { foreign: { ...foreign, url: 'https://another.example' } },
    { expected: { ...expected, origin: '' } },
    { expected: { ...expected, grantValues: [] } },
    { expected: { ...expected, scopes: ['user_attributes'] } },
  ])
    await assert.rejects(
      exchangeForeignUser({ assertion: 'primary-user-token', primary, foreign, expected, ...fixture(), ...bad }),
    );
  assert.equal(fetch.mock.callCount(), 0);
});
test('machine principal, wrong human, missing/foreign grants and SDK outages cannot create passing evidence', async (t) => {
  tokenFetch(t);
  for (const f of [
    fixture({ error: new Error('USER_REQUIRED') }),
    fixture({ context: { getEmail: () => 'wrong' } }),
    fixture({ context: { getOrigin: () => 'other-idp' } }),
    fixture({ values: [] }),
    fixture({ values: ['A4H/001'] }),
    fixture({ status: 'missing' }),
    fixture({ scopes: ['read', 'admin'] }),
    fixture({ error: new Error('JWKS_UNAVAILABLE') }),
    fixture({ sdkError: new Error('WRONG_AUDIENCE') }),
    fixture({ sdkError: new Error('JWKS_UNAVAILABLE') }),
  ])
    await assert.rejects(exchangeForeignUser({ assertion: 'primary-user-token', primary, foreign, expected, ...f }));
});

test('a refused foreign exchange is not a successful isolation check and never reaches verification', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{"error":"invalid_grant"}', { status: 400 }));
  const f = fixture();
  await assert.rejects(exchangeForeignUser({ assertion: 'primary-user-token', primary, foreign, expected, ...f }), {
    code: 'OAUTH_TOKEN_EXCHANGE_FAILED',
  });
  assert.deepEqual(f.calls, []);
});
