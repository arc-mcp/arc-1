#!/usr/bin/env node
/** Interactive real-system test harness. Tokens stay in this process; browsers are never opened here. */
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { guardedMcpChecks, validateScenario } from './mcp-checks.mjs';
import { clientCredentialsToken, postToken } from './oauth-requests.mjs';
import {
  assertSafeDiagnosticEnvironment,
  boundedFetch,
  classifySapVerificationFailure,
  HarnessError,
  label,
  privateJson,
  safeFailure,
  validateBaseUrl,
} from './safe-io.mjs';
import { forgetSessionLabel, reserveSessionLabel } from './session-labels.mjs';

// Provider debug output can contain user identifiers. Import SDKs only after disabling it.
process.env.DEBUG = '';
const emit = (event, details = {}) =>
  process.stdout.write(`${JSON.stringify({ event, at: new Date().toISOString(), ...details })}\n`);
const sessions = new Map();
const pending = new Map();
const reservedLabels = new Map();
let server;
let input;
let stopping = false;

function options() {
  const result = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i];
    if (
      !['--base-url', '--credentials-file', '--auth-module', '--port', '--login-timeout-minutes'].includes(key) ||
      !process.argv[i + 1]
    )
      throw new HarnessError('INVALID_COMMAND_LINE');
    result[key.slice(2)] = process.argv[i + 1];
  }
  if (!result['base-url'] || !result['credentials-file'] || !result['auth-module'])
    throw new HarnessError('REQUIRED_ARGUMENT_MISSING');
  const minutes = Number(result['login-timeout-minutes'] ?? 60);
  const port = Number(result.port ?? 0);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 720 || !Number.isInteger(port) || port < 0 || port > 65535)
    throw new HarnessError('INVALID_LISTENER_OPTION');
  return { ...result, port, timeoutMs: minutes * 60_000 };
}

function constantResultSet(left, right) {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

async function main() {
  assertSafeDiagnosticEnvironment();
  const config = options();
  const baseUrl = validateBaseUrl(config['base-url']);
  const stored = await privateJson(config['credentials-file']);
  const credentials = stored.credentials ?? stored;
  for (const field of ['clientid', 'clientsecret', 'url', 'xsappname', 'uaadomain']) {
    if (typeof credentials[field] !== 'string' || !credentials[field])
      throw new HarnessError('INVALID_XSUAA_CREDENTIALS');
  }
  validateBaseUrl(credentials.url.endsWith('/') ? credentials.url : `${credentials.url}/`);
  const auth = await import(pathToFileURL(resolve(config['auth-module'])).href);
  if (typeof auth.createXsuaaTokenVerifier !== 'function' || typeof auth.XsuaaUserTokenRequiredError !== 'function')
    throw new HarnessError('NEW_AUTH_CONTRACT_REQUIRED');
  const { default: xssec } = await import('@sap/xssec');
  const service = new xssec.XsuaaService(credentials);
  const verify = auth.createXsuaaTokenVerifier(credentials, { userAttributeNames: ['arc1_targets'] });
  const verifyUser = auth.createXsuaaTokenVerifier(credentials, {
    userAttributeNames: ['arc1_targets'],
    requireUserToken: true,
  });

  async function inspect(accessToken, scenario, record) {
    let context;
    let verified;
    try {
      context = await service.createSecurityContext(accessToken);
    } catch (error) {
      const rejection = classifySapVerificationFailure(error, xssec.errors);
      if (!rejection) throw new HarnessError('TOKEN_VERIFICATION_UNAVAILABLE');
      record('token.signature_audience_expiry', scenario.expect?.verification === 'invalid');
      if (scenario.expect?.verificationFailure)
        record('token.expected_rejection', scenario.expect.verificationFailure === rejection);
      return { verified: false, rejection, accessTokenBytes: Buffer.byteLength(accessToken) };
    }
    try {
      verified = await verify(accessToken);
    } catch {
      throw new HarnessError('AUTH_PACKAGE_VERIFICATION_DISAGREEMENT');
    }
    record('token.signature_audience_expiry', scenario.expect?.verification !== 'invalid');
    let supportedUser = false;
    try {
      await verifyUser(accessToken);
      supportedUser = true;
    } catch (error) {
      if (!(error instanceof auth.XsuaaUserTokenRequiredError))
        throw new HarnessError('UNEXPECTED_USER_VERIFIER_FAILURE');
    }
    const expected = scenario.expect ?? {};
    if (expected.userPrincipal !== undefined) record('token.user_principal', supportedUser === expected.userPrincipal);
    if (expected.scopes) record('token.exact_local_scopes', constantResultSet(verified.scopes, expected.scopes));
    const values = verified.extra?.xsuaaUserAttributes?.arc1_targets ?? [];
    const status = verified.extra?.xsuaaUserAttributeStatus?.arc1_targets;
    if (expected.grantValues) record('token.exact_attribute_values', constantResultSet(values, expected.grantValues));
    if (expected.grantCount !== undefined)
      record('token.attribute_count', values.length === expected.grantCount, { actualCount: values.length });
    if (expected.grantStatus) record('token.attribute_status', status === expected.grantStatus);
    const identity = scenario.expectedIdentity;
    if (identity) {
      const match =
        (identity.email === undefined || context.getEmail() === identity.email) &&
        (identity.origin === undefined || context.getOrigin() === identity.origin) &&
        (identity.logonName === undefined || context.getLogonName() === identity.logonName);
      record('token.expected_identity', match);
      if (!match) throw new HarnessError('WRONG_LOGIN_IDENTITY');
    }
    const raw = context.getAttribute('arc1_targets');
    const rawType = raw == null ? 'missing' : Array.isArray(raw) ? 'array' : typeof raw;
    const grant = context.getGrantType();
    const knownGrants = [
      'authorization_code',
      'refresh_token',
      'urn:ietf:params:oauth:grant-type:jwt-bearer',
      'client_credentials',
      'user_token',
      'password',
    ];
    const sapPrincipal = context.getUserName();
    return {
      verified: true,
      verifiedBy: '@sap/xssec',
      accessTokenBytes: Buffer.byteLength(accessToken),
      secondsUntilExpiry: Math.max(0, Math.floor((verified.expiresAt ?? 0) - Date.now() / 1000)),
      grantType: knownGrants.includes(grant) ? grant : 'unknown',
      supportedUser,
      identityExpectationConfigured: !!identity,
      shape: {
        originPresent: typeof context.getOrigin() === 'string' && !!context.getOrigin(),
        logonPresent: typeof context.getLogonName() === 'string' && !!context.getLogonName(),
        sapUserPrincipal: typeof sapPrincipal === 'string' && sapPrincipal.startsWith('user/'),
        attributeWireType: rawType,
      },
      localScopes: verified.scopes,
      attributeStatus: status,
      attributeCount: values.length,
      allTargetValuePresent: values.includes('*'),
    };
  }

  async function run(sessionLabel, scenarioPath) {
    const session = sessions.get(label(sessionLabel));
    if (!session) throw new HarnessError('SESSION_NOT_FOUND');
    const path = scenarioPath ?? session.scenarioPath;
    if (!path) throw new HarnessError('SCENARIO_FILE_REQUIRED');
    const scenario = validateScenario(await privateJson(path));
    const assertions = [];
    const record = (test, pass, details = {}) => assertions.push({ test, pass: pass === true, ...details });
    let evidence;
    try {
      evidence = await inspect(session.token.access_token, scenario, record);
      await guardedMcpChecks({ baseUrl, accessToken: session.token.access_token, scenario, record });
    } catch (error) {
      record('scenario.execution', false, safeFailure(error));
    }
    const result = {
      label: sessionLabel,
      evidence,
      assertions,
      passed: assertions.filter((value) => value.pass).length,
      failed: assertions.filter((value) => !value.pass).length,
    };
    emit('scenario_complete', result);
    return result;
  }

  async function beginLogin(command) {
    const sessionLabel = label(command.label);
    const release = reserveSessionLabel(sessionLabel, sessions, reservedLabels);
    try {
      if (command.scenario) validateScenario(await privateJson(command.scenario));
      const state = randomBytes(32).toString('base64url');
      const verifier = randomBytes(48).toString('base64url');
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      const redirectUri = `http://127.0.0.1:${server.address().port}/callback`;
      const registered = await boundedFetch(new URL('/register', baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: 'ARC-1 PR677 live acceptance',
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: 'none',
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
        }),
      });
      if (registered.status !== 201 || typeof registered.json?.client_id !== 'string')
        throw new HarnessError('DCR_REGISTRATION_FAILED', registered.status);
      if (stopping) throw new HarnessError('HARNESS_STOPPED');
      const entry = {
        label: sessionLabel,
        verifier,
        redirectUri,
        clientId: registered.json.client_id,
        scenarioPath: command.scenario,
        created: Date.now(),
        release,
      };
      entry.timer = setTimeout(() => {
        pending.delete(state);
        release();
        emit('login_expired', { label: sessionLabel });
      }, config.timeoutMs);
      pending.set(state, entry);
      const authorize = new URL('/authorize', baseUrl);
      authorize.search = new URLSearchParams({
        response_type: 'code',
        client_id: entry.clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        scope: 'read data sql admin',
        ...(command.forceLogin === true ? { prompt: 'login', max_age: '0' } : {}),
      }).toString();
      emit('authorization_required', {
        label: sessionLabel,
        authorizeUrl: authorize.toString(),
        expiresInMinutes: config.timeoutMs / 60_000,
        browserAction: 'Open with approved browser tooling; secondary identity must use a new incognito window.',
      });
    } catch (error) {
      release();
      throw error;
    }
  }

  async function callback(request, response) {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (request.method !== 'GET' || url.pathname !== '/callback') {
      response.writeHead(404).end('Not found');
      return;
    }
    const state = url.searchParams.get('state');
    const entry = pending.get(state);
    if (!entry) {
      response.writeHead(400).end('Invalid or expired login state. Request another login in the test harness.');
      return;
    }
    pending.delete(state);
    clearTimeout(entry.timer);
    const code = url.searchParams.get('code');
    if (!code || url.searchParams.has('error')) {
      entry.release();
      response.writeHead(400).end('Authorization failed. See the sanitized test harness status.');
      emit('login_failed', { label: entry.label, code: 'OAUTH_AUTHORIZATION_FAILED' });
      return;
    }
    try {
      const token = await postToken(new URL('/token', baseUrl), {
        grant_type: 'authorization_code',
        code,
        client_id: entry.clientId,
        redirect_uri: entry.redirectUri,
        code_verifier: entry.verifier,
      });
      if (stopping) throw new HarnessError('HARNESS_STOPPED');
      entry.release.commit({
        token,
        clientId: entry.clientId,
        scenarioPath: entry.scenarioPath,
        created: Date.now(),
      });
      response
        .writeHead(200)
        .end(
          'Authentication received. Tests run in the local harness; this page does not indicate they passed. You may close this window.',
        );
      emit('login_received', { label: entry.label, hasRefreshToken: typeof token.refresh_token === 'string' });
      if (entry.scenarioPath) await run(entry.label);
    } catch (error) {
      if (!response.headersSent) response.writeHead(400).end('Token exchange failed. Request another login.');
      emit('login_failed', { label: entry.label, ...safeFailure(error) });
    } finally {
      entry.release();
    }
  }

  async function command(action) {
    if (stopping) throw new HarnessError('HARNESS_STOPPED');
    if (!action || typeof action !== 'object' || Array.isArray(action)) throw new HarnessError('INVALID_COMMAND');
    if (action.command === 'login') return beginLogin(action);
    if (action.command === 'run') return run(action.label, action.scenario);
    if (action.command === 'concurrent') {
      if (!Array.isArray(action.labels) || action.labels.length < 2 || action.labels.length > 8)
        throw new HarnessError('CONCURRENT_LABELS_REQUIRED');
      await Promise.all(action.labels.map((value) => run(value)));
      return;
    }
    if (action.command === 'status') {
      emit('status', {
        sessions: [...sessions.entries()].map(([name, entry]) => ({
          label: name,
          ageSeconds: Math.floor((Date.now() - entry.created) / 1000),
          hasRefreshToken: typeof entry.token.refresh_token === 'string',
        })),
        pending: [...pending.values()].map((entry) => ({
          label: entry.label,
          ageSeconds: Math.floor((Date.now() - entry.created) / 1000),
        })),
      });
      return;
    }
    if (action.command === 'forget') {
      forgetSessionLabel(action.label, sessions, reservedLabels, pending);
      emit('session_forgotten', {
        label: action.label,
        warning:
          'Stored session and pending login cancelled; issued tokens and already-running requests are not revoked.',
      });
      return;
    }
    if (action.command === 'finish') return stop();
    const nextLabel = label(action.nextLabel ?? action.label);
    const release = reserveSessionLabel(nextLabel, sessions, reservedLabels);
    try {
      if (action.scenario) validateScenario(await privateJson(action.scenario));
      if (action.command === 'import-token') {
        const token = await privateJson(action.file);
        if (typeof token.access_token !== 'string') throw new HarnessError('INVALID_TOKEN_FILE');
        release.commit({
          token,
          clientId: token.client_id,
          scenarioPath: action.scenario,
          created: Date.now(),
        });
      } else if (action.command === 'client-credentials') {
        const token = await clientCredentialsToken(credentials, action.scopes);
        release.commit({ token, scenarioPath: action.scenario, created: Date.now() });
      } else {
        const previous = sessions.get(label(action.label));
        if (!previous) throw new HarnessError('SESSION_NOT_FOUND');
        let token;
        if (action.command === 'refresh') {
          if (typeof previous.token.refresh_token !== 'string' || !previous.clientId)
            throw new HarnessError('REFRESH_NOT_AVAILABLE');
          token = await postToken(new URL('/token', baseUrl), {
            grant_type: 'refresh_token',
            client_id: previous.clientId,
            refresh_token: previous.token.refresh_token,
          });
        } else if (action.command === 'exchange-user') {
          await verifyUser(previous.token.access_token);
          token = await postToken(
            new URL('/oauth/token', credentials.url),
            { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: previous.token.access_token },
            {
              Authorization: `Basic ${Buffer.from(`${credentials.clientid}:${credentials.clientsecret}`).toString('base64')}`,
            },
          );
        } else throw new HarnessError('UNKNOWN_COMMAND');
        release.commit({
          token,
          clientId: previous.clientId,
          scenarioPath: action.scenario ?? previous.scenarioPath,
          created: Date.now(),
        });
      }
      emit('token_snapshot_available', { label: nextLabel, source: action.command });
      if (sessions.get(nextLabel).scenarioPath) await run(nextLabel);
    } finally {
      release();
    }
  }

  server = createServer((request, response) => {
    callback(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500).end('Local callback failed');
      emit('callback_failed', { code: 'UNEXPECTED_FAILURE' });
    });
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(config.port, '127.0.0.1', accept);
  });
  input = createInterface({ input: process.stdin, terminal: false });
  let queue = Promise.resolve();
  input.on('line', (line) => {
    queue = queue.then(async () => {
      try {
        if (line.length > 16_384) throw new HarnessError('COMMAND_TOO_LARGE');
        let value;
        try {
          value = JSON.parse(line);
        } catch {
          throw new HarnessError('INVALID_JSON_COMMAND');
        }
        await command(value);
      } catch (error) {
        emit('command_failed', safeFailure(error));
      }
    });
  });
  emit('ready', {
    callbackPort: server.address().port,
    baseUrl: baseUrl.origin,
    tokenStorage: 'process-memory-only',
    commandProtocol: 'JSON lines on stdin',
    loginTimeoutMinutes: config.timeoutMs / 60_000,
  });
}

function stop() {
  if (stopping) return;
  stopping = true;
  for (const entry of pending.values()) clearTimeout(entry.timer);
  pending.clear();
  reservedLabels.clear();
  sessions.clear();
  input?.close();
  server?.close();
  server?.closeAllConnections();
  emit('stopped', { tokensPersisted: false });
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.on('unhandledRejection', () => emit('operation_failed', { code: 'UNEXPECTED_FAILURE' }));
main().catch((error) => {
  emit('startup_failed', safeFailure(error));
  process.exitCode = 1;
  stop();
});
