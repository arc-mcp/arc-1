import { boundedFetch, HarnessError, readToolBody, safeFailure } from './safe-io.mjs';
import { checkTargetSchemaProjection } from './schema-projection.mjs';

const MUTATION_TOOLS = ['SAPWrite', 'SAPActivate', 'SAPGit', 'SAPManage'];
const TARGET_PATTERN = /^[A-Z][A-Z0-9-]{1,30}[A-Z0-9]\/[0-9]{3}$/;

function sameSet(left, right) {
  return JSON.stringify([...new Set(left)].sort()) === JSON.stringify([...new Set(right)].sort());
}

class McpSession {
  constructor(url, token, record, prefix, privateResponses = true) {
    this.url = url;
    this.token = token;
    this.id = 1;
    this.sequence = 0;
    this.record = record;
    this.prefix = prefix;
    this.privateResponses = privateResponses;
  }
  async request(method, params = {}, notification = false) {
    const requestId = notification ? undefined : this.id++;
    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (this.token != null) headers.Authorization = `Bearer ${this.token}`;
    if (this.sessionId) headers['Mcp-Session-Id'] = this.sessionId;
    if (this.protocolVersion) headers['MCP-Protocol-Version'] = this.protocolVersion;
    const response = await boundedFetch(
      this.url,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: requestId }), method, params }),
      },
      { rpcResponseId: requestId },
    );
    if (this.privateResponses) {
      const directives = (response.headers.get('cache-control') ?? '')
        .toLowerCase()
        .split(',')
        .map((value) => value.trim());
      this.record(
        `${this.prefix}.response_${this.sequence++}.private_no_store`,
        directives.includes('private') && directives.includes('no-store') && !directives.includes('public'),
      );
    }
    if (
      !notification &&
      response.status === 200 &&
      (response.json?.jsonrpc !== '2.0' ||
        response.json.id !== requestId ||
        Object.hasOwn(response.json, 'result') === Object.hasOwn(response.json, 'error'))
    )
      throw new HarnessError('INVALID_MCP_RESPONSE');
    if (notification && ![200, 202, 204].includes(response.status))
      throw new HarnessError('MCP_INITIALIZED_NOTIFICATION_REJECTED', response.status);
    const sessionId = response.headers.get('mcp-session-id');
    if (sessionId) this.sessionId = sessionId;
    return response;
  }
  async initialize() {
    const response = await this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'arc1-pr677-live-harness', version: '1.0.0' },
    });
    if (response.json?.result?.protocolVersion) {
      this.protocolVersion = response.json.result.protocolVersion;
      await this.request('notifications/initialized', {}, true);
    }
    return response;
  }
}

export function validateScenario(scenario) {
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) throw new HarnessError('INVALID_SCENARIO');
  const expected = scenario.expect ?? {};
  if (!expected || typeof expected !== 'object' || Array.isArray(expected))
    throw new HarnessError('INVALID_EXPECTATIONS');
  if (scenario.expectedIdentity !== undefined) {
    const identity = scenario.expectedIdentity;
    if (
      !identity ||
      typeof identity !== 'object' ||
      Array.isArray(identity) ||
      Object.keys(identity).length === 0 ||
      Object.entries(identity).some(
        ([key, value]) =>
          !['email', 'origin', 'logonName'].includes(key) || typeof value !== 'string' || value.trim().length === 0,
      )
    )
      throw new HarnessError('INVALID_IDENTITY_EXPECTATION');
  }
  for (const name of ['allowedTargets', 'deniedTargets', 'catalogTargets', 'schemaTargets']) {
    if (
      expected[name] !== undefined &&
      (!Array.isArray(expected[name]) ||
        expected[name].length > 256 ||
        !expected[name].every((target) => typeof target === 'string' && TARGET_PATTERN.test(target)))
    ) {
      throw new HarnessError('INVALID_SCENARIO_TARGETS');
    }
  }
  if (expected.schemaTargets !== undefined && new Set(expected.schemaTargets).size !== expected.schemaTargets.length)
    throw new HarnessError('DUPLICATE_SCHEMA_EXPECTATION');
  if (
    (expected.aggregateHttpStatus ?? 200) === 200 &&
    expected.privateResponses !== false &&
    expected.schemaTargets === undefined
  )
    throw new HarnessError('COMPLETE_SCHEMA_TARGET_EXPECTATION_REQUIRED');
  for (const name of ['scopes', 'requiredTools', 'forbiddenTools', 'grantValues']) {
    if (
      expected[name] !== undefined &&
      (!Array.isArray(expected[name]) ||
        expected[name].length > 1024 ||
        !expected[name].every((value) => typeof value === 'string'))
    )
      throw new HarnessError('INVALID_SCENARIO_EXPECTATION');
  }
  if (expected.aggregateHttpStatus !== undefined && ![200, 401, 403, 404, 503].includes(expected.aggregateHttpStatus))
    throw new HarnessError('INVALID_EXPECTED_HTTP_STATUS');
  for (const name of ['catalogVisible', 'userPrincipal', 'unpaged', 'missingTargetDenied', 'privateResponses']) {
    if (expected[name] !== undefined && typeof expected[name] !== 'boolean')
      throw new HarnessError('INVALID_BOOLEAN_EXPECTATION');
  }
  for (const name of ['grantCount', 'toolCount']) {
    if (
      expected[name] !== undefined &&
      (!Number.isInteger(expected[name]) || expected[name] < 0 || expected[name] > 1024)
    )
      throw new HarnessError('INVALID_COUNT_EXPECTATION');
  }
  if (
    expected.grantStatus !== undefined &&
    !['valid', 'missing', 'invalid', 'limit_exceeded'].includes(expected.grantStatus)
  )
    throw new HarnessError('INVALID_GRANT_STATUS_EXPECTATION');
  if (expected.verification !== undefined && !['valid', 'invalid'].includes(expected.verification))
    throw new HarnessError('INVALID_VERIFICATION_EXPECTATION');
  if (
    expected.verificationFailure !== undefined &&
    ![
      'wrong_audience',
      'expired',
      'not_yet_valid',
      'invalid_signature',
      'invalid_jwt',
      'unsupported_algorithm',
      'invalid_issuer',
      'untrusted_issuer',
    ].includes(expected.verificationFailure)
  )
    throw new HarnessError('INVALID_VERIFICATION_FAILURE_EXPECTATION');
  if (expected.authorizationMode !== undefined && expected.authorizationMode !== 'xsuaa-attribute')
    throw new HarnessError('INVALID_AUTHORIZATION_MODE_EXPECTATION');
  if (expected.aggregateErrorCode !== undefined && !['forbidden'].includes(expected.aggregateErrorCode))
    throw new HarnessError('INVALID_HTTP_ERROR_EXPECTATION');
  if (
    expected.catalogGranted !== undefined &&
    (!expected.catalogGranted ||
      typeof expected.catalogGranted !== 'object' ||
      Array.isArray(expected.catalogGranted) ||
      Object.entries(expected.catalogGranted).some(
        ([target, value]) => !TARGET_PATTERN.test(target) || typeof value !== 'boolean',
      ))
  )
    throw new HarnessError('INVALID_CATALOG_GRANTED_EXPECTATION');
  return scenario;
}

/** Ignore only the documented correlation field, never target/identity/topology differences. */
export function comparableDenial(body, text) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { comparable: text, correlationValid: true };
  const { requestId, ...stable } = body;
  const correlationValid =
    requestId === undefined || (typeof requestId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(requestId));
  const canonical = (value) =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, canonical(value[key])]),
          )
        : value;
  return { comparable: JSON.stringify(canonical(stable)), correlationValid };
}

/** Assertions inspect real responses internally; only booleans/counts/statuses leave this function. */
export async function runMcpChecks({ baseUrl, accessToken, scenario, record }) {
  const expected = validateScenario(scenario).expect ?? {};
  const session = (path, prefix, token = accessToken) =>
    new McpSession(new URL(path, baseUrl), token, record, prefix, expected.privateResponses !== false);
  // Authentication and cache headers precede inventory lookup, including the compatibility alias.
  for (const [index, path] of [
    '/multi/mcp',
    '/authorize',
    ...[expected.allowedTargets?.[0], expected.deniedTargets?.[0]].filter(Boolean).map((target) => `/${target}/mcp`),
  ].entries()) {
    const anonymous = await session(path, `anonymous_${index}`, null).initialize();
    record(`anonymous_${index}.http_401`, anonymous.status === 401, { httpStatus: anonymous.status });
  }
  const aggregate = session('/multi/mcp', 'aggregate');
  const initialized = await aggregate.initialize();
  const aggregateStatus = expected.aggregateHttpStatus ?? 200;
  record('aggregate.initialize.http', initialized.status === aggregateStatus, { httpStatus: initialized.status });
  if (expected.aggregateErrorCode !== undefined)
    record('aggregate.initialize.error_code', initialized.json?.error === expected.aggregateErrorCode);
  const alias = session('/authorize', 'alias');
  const aliasInit = await alias.initialize();
  record('alias.initialize.http', aliasInit.status === aggregateStatus, { httpStatus: aliasInit.status });
  if (aggregateStatus !== 200) {
    for (const [index, target] of (expected.deniedTargets ?? ['ZZZ/999']).entries()) {
      const blocked = await session(`/${target}/mcp`, `pinned.authentication_${index}`).initialize();
      record(`pinned.authentication_${index}.status`, blocked.status === aggregateStatus, {
        httpStatus: blocked.status,
      });
    }
    return;
  }
  if (initialized.status !== 200) return;
  record('aggregate.initialize.protocol', !!initialized.json?.result?.protocolVersion);
  const listed = await aggregate.request('tools/list');
  record(
    'aggregate.tools_list.protocol',
    listed.status === 200 &&
      Array.isArray(listed.json?.result?.tools) &&
      listed.json.result.tools.every(
        (tool) => tool && typeof tool.name === 'string' && tool.inputSchema?.type === 'object',
      ),
  );
  const tools = listed.json?.result?.tools ?? [];
  const names = tools.map((tool) => tool.name);
  if (expected.schemaTargets !== undefined)
    checkTargetSchemaProjection(tools, expected.schemaTargets, record, 'aggregate');
  if (aliasInit.status === 200 && aliasInit.json?.result) {
    const aliasList = await alias.request('tools/list');
    record('alias.same_tool_projection', JSON.stringify(aliasList.json?.result?.tools) === JSON.stringify(tools));
    if (expected.schemaTargets !== undefined)
      checkTargetSchemaProjection(aliasList.json?.result?.tools, expected.schemaTargets, record, 'alias');
  }
  record(
    'aggregate.no_mutation_tools',
    MUTATION_TOOLS.every((name) => !names.includes(name)),
  );
  for (const [index, name] of (expected.requiredTools ?? []).entries())
    record(`tool.required_${index}`, names.includes(name));
  for (const [index, name] of (expected.forbiddenTools ?? []).entries())
    record(`tool.forbidden_${index}`, !names.includes(name));
  if (expected.toolCount !== undefined)
    record('aggregate.tool_count', names.length === expected.toolCount, { actualCount: names.length });
  if (expected.catalogVisible !== undefined)
    record('catalog.visibility', names.includes('SAPTargets') === expected.catalogVisible);

  const surface = `${initialized.text}\n${listed.text}`;
  for (const [index, target] of (expected.deniedTargets ?? []).entries()) {
    record(`projection.hidden_target_${index}.absent`, !surface.includes(target));
  }

  if (names.includes('SAPTargets')) {
    const catalogResponse = await aggregate.request('tools/call', { name: 'SAPTargets', arguments: {} });
    const catalog = readToolBody(catalogResponse);
    record(
      'catalog.call.success',
      catalogResponse.status === 200 &&
        catalog.result?.isError !== true &&
        (Array.isArray(catalog.body) || Array.isArray(catalog.body?.targets)),
    );
    const targets = Array.isArray(catalog.body) ? catalog.body : (catalog.body?.targets ?? []);
    if (expected.catalogTargets)
      record(
        'catalog.exact_targets',
        sameSet(
          targets.map((target) => target.target),
          expected.catalogTargets,
        ),
        { actualCount: targets.length },
      );
    if (expected.authorizationMode)
      record('catalog.authorization_mode', catalog.body?.admin?.authorization?.mode === expected.authorizationMode);
    if (expected.unpaged === true) {
      const schema = tools.find((tool) => tool.name === 'SAPTargets')?.inputSchema;
      record('catalog.unpaged_schema', !Object.hasOwn(schema?.properties ?? {}, 'offset'));
      record('catalog.unpaged_result', !Object.hasOwn(catalog.body?.admin ?? {}, 'diagnosticNextOffset'));
      const rejectedOffset = await aggregate.request('tools/call', { name: 'SAPTargets', arguments: { offset: 0 } });
      record(
        'catalog.offset_rejected',
        rejectedOffset.json?.error != null || readToolBody(rejectedOffset).result?.isError === true,
      );
    }
    if (expected.catalogGranted) {
      record(
        'catalog.admin_granted_flags',
        Object.entries(expected.catalogGranted).every(
          ([target, granted]) => targets.find((entry) => entry.target === target)?.granted === granted,
        ),
      );
    }
  } else if (expected.catalogVisible === false) {
    const direct = await aggregate.request('tools/call', { name: 'SAPTargets', arguments: {} });
    const body = readToolBody(direct);
    record('catalog.unlisted_direct_unknown_tool', body.result?.isError === true && body.text.includes('UNKNOWN_TOOL'));
  }

  for (const [index, target] of (expected.allowedTargets ?? []).entries()) {
    const response = await aggregate.request('tools/call', { name: 'SAPRead', arguments: { target, type: 'SYSTEM' } });
    const read = readToolBody(response);
    record(
      `aggregate.allowed_${index}.sap_read`,
      response.status === 200 && read.result != null && read.result.isError !== true,
    );
    const pinned = session(`/${target}/mcp`, `pinned.allowed_${index}`);
    const pinInit = await pinned.initialize();
    record(`pinned.allowed_${index}.initialize`, pinInit.status === 200 && !!pinInit.json?.result);
    if (pinInit.json?.result) {
      const pinResponse = await pinned.request('tools/call', { name: 'SAPRead', arguments: { type: 'SYSTEM' } });
      const pinRead = readToolBody(pinResponse);
      record(
        `pinned.allowed_${index}.sap_read`,
        pinResponse.status === 200 && pinRead.result != null && pinRead.result.isError !== true,
      );
    }
  }
  const denials = [];
  for (const [index, target] of (expected.deniedTargets ?? []).entries()) {
    const response = await aggregate.request('tools/call', { name: 'SAPRead', arguments: { target, type: 'SYSTEM' } });
    const read = readToolBody(response);
    record(
      `aggregate.denied_${index}.generic_error`,
      response.status === 200 && read.result?.isError === true && read.text.includes('TARGET_NOT_AVAILABLE'),
    );
    record(`aggregate.denied_${index}.no_target_echo`, !read.text.includes(target));
    const stable = comparableDenial(read.body, read.text);
    record(`aggregate.denied_${index}.bounded_correlation`, stable.correlationValid);
    const pinned = session(`/${target}/mcp`, `pinned.denied_${index}`);
    const pinInit = await pinned.initialize();
    record(`pinned.denied_${index}.generic_404`, pinInit.status === 404, { httpStatus: pinInit.status });
    record(`pinned.denied_${index}.no_target_echo`, !pinInit.text.includes(target));
    denials.push({ aggregate: stable.comparable, pinned: pinInit.text });
    if (index === 0 && aliasInit.status === 200) {
      const aliasDenied = readToolBody(
        await alias.request('tools/call', { name: 'SAPRead', arguments: { target, type: 'SYSTEM' } }),
      );
      const aliasStable = comparableDenial(aliasDenied.body, aliasDenied.text);
      record(
        'alias.same_target_denial',
        aliasDenied.result?.isError === true &&
          aliasStable.correlationValid &&
          aliasStable.comparable === stable.comparable,
      );
    }
  }
  if (denials.length > 1) {
    record(
      'denials.existing_and_unknown_indistinguishable',
      denials.every((value) => value.aggregate === denials[0].aggregate && value.pinned === denials[0].pinned),
    );
  }
  if (expected.missingTargetDenied === true && names.includes('SAPRead')) {
    const missing = readToolBody(
      await aggregate.request('tools/call', { name: 'SAPRead', arguments: { type: 'SYSTEM' } }),
    );
    record(
      'aggregate.missing_target_denied',
      missing.result?.isError === true && missing.text.includes('TARGET_REQUIRED'),
    );
  }
}

export async function guardedMcpChecks(options) {
  try {
    await runMcpChecks(options);
  } catch (error) {
    options.record('mcp.transport_or_protocol_failure', false, safeFailure(error));
  }
}
