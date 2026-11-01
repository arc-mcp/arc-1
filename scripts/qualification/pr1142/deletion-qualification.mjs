import { randomUUID } from 'node:crypto';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { durable } from './durable-journal.mjs';
import { actors, root, target, validateFixtures } from './fixture-contract.mjs';
import { includeKinds } from './include-qualification.mjs';
import { McpSession } from './mcp-checks.mjs';
import { nativeCheck } from './native-check.mjs';
import { configuration, validateConfiguration } from './qualification-config.mjs';
import { verifyRunManifest } from './run-manifest.mjs';
import { HarnessError, privateJson, readToolBody, responseReceipt, safeFailure } from './safe-io.mjs';
import { checkForwardWork } from './shutdown.mjs';

const sameSet = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
let busy = false;

export async function qualify({
  action,
  sessions,
  baseUrl,
  verifyUser,
  service,
  emit,
  nativeOverride,
  configurationOverride,
  formatterQualifier,
  includeQualifier,
  journalOverride,
  signal,
}) {
  if (busy || action.plan !== 'delete-two-user-v1') throw new HarnessError('QUALIFICATION_PLAN_OR_STATE_MISMATCH');
  if (baseUrl.origin !== 'https://mcp-sap-docs.cfapps.us10-001.hana.ondemand.com')
    throw new HarnessError('WRONG_TEST_APP');
  const config = configurationOverride ?? configuration;
  validateConfiguration(config);
  const { root, target, actors } = config;
  const write = journalOverride ?? durable;
  busy = true;
  let phase = 'identity-preflight',
    journal,
    journalOwned = false,
    recovering = false,
    manifest;
  const clients = {},
    tokens = {},
    assertions = [];
  const record = (test, pass, details = {}) => assertions.push({ test, pass: pass === true, ...details });
  const ensure = (test, pass) => {
    record(test, pass);
    if (!pass) throw new HarnessError(test.toUpperCase().replace(/[^A-Z0-9_]/g, '_'));
  };
  const step = (value) => {
    checkForwardWork(signal, recovering);
    phase = value;
    emit('qualification_phase', { phase });
  };
  const save = () => write(`${root}/deletion-qualification.json`, journal);
  const native = (mode, name) => {
    checkForwardWork(signal, recovering);
    return nativeOverride ? nativeOverride(mode, name) : nativeCheck('native-fixtures.mts', mode, name);
  };
  const observeResponse = (session) => async (method, response) => {
    if (!journalOwned) return;
    journal.rpcReceipts = (journal.rpcReceipts ?? 0) + 1;
    await write(
      `${root}/deletion-rpc-${randomUUID()}.json`,
      {
        runId: journal.runId,
        phase,
        session,
        method,
        at: new Date().toISOString(),
        ...responseReceipt(response, Object.values(tokens)),
      },
      true,
    );
  };
  const call = async (client, name, args, expectedError) => {
    checkForwardWork(signal, recovering);
    const response = await client.request('tools/call', { name, arguments: args });
    const parsed = readToolBody(response);
    ensure(`${phase}.http_result`, response.status === 200 && parsed.result != null && !response.json?.error);
    ensure(`${phase}.expected_outcome`, Boolean(parsed.result.isError) === Boolean(expectedError));
    if (expectedError) {
      record(`${phase}.refusal_code`, parsed.body?.error === expectedError, {
        expectedError,
        actualError: parsed.body?.error ?? null,
      });
      ensure(`${phase}.exact_refusal`, parsed.body?.error === expectedError);
    }
    return parsed;
  };
  const initialize = async (key, route, token) => {
    checkForwardWork(signal, recovering);
    const client = new McpSession(new URL(route, baseUrl), token, record, key, true, observeResponse(key));
    const response = await client.initialize();
    ensure(
      `${phase}.${key}.initialize`,
      response.status === 200 && typeof response.json?.result?.protocolVersion === 'string',
    );
    return client;
  };
  const catalog = async (client) => {
    checkForwardWork(signal, recovering);
    const result = await client.request('tools/list');
    ensure(`${phase}.catalog`, result.status === 200 && Array.isArray(result.json?.result?.tools));
    return result.json.result.tools;
  };
  const editable = async (fixture) => {
    const body = (
      await call(clients[fixture.actor], 'SAPRead', { type: fixture.type, name: fixture.name, format: 'editable' })
    ).body;
    ensure(
      `${phase}.editable`,
      typeof body?.source === 'string' &&
        body.source.includes(manifest.marker) &&
        /^[a-f0-9]{64}$/.test(body.sourceHash),
    );
    return body;
  };
  try {
    checkForwardWork(signal, recovering);
    for (const actor of actors) {
      const token = sessions.get(actor.label)?.token.access_token;
      if (typeof token !== 'string') throw new HarnessError('ALL_THREE_SESSIONS_REQUIRED');
      tokens[actor.label] = token;
    }
    for (const actor of actors) {
      const verification = await verifyUser(tokens[actor.label]);
      const context = await service.createSecurityContext(tokens[actor.label]);
      ensure(`${actor.label}.identity`, context.getEmail() === actor.email && context.getOrigin() === 'sap.custom');
      ensure(
        `${actor.label}.scope`,
        sameSet(verification.scopes, actor.write ? ['read', 'write'] : ['read']) &&
          context.checkLocalScope('read') &&
          context.checkLocalScope('write') === actor.write,
      );
      const attributes = verification.extra?.xsuaaUserAttributes;
      ensure(`${actor.label}.exact_write_grants`, sameSet(attributes?.arc1_write_targets ?? [], [target, 'A4H/001']));
      ensure(
        `${actor.label}.read_grants`,
        [target, 'A4H/001'].every((t) => (attributes?.arc1_targets ?? []).some((v) => v === t || v === '*')),
      );
      record(`${actor.label}.observed_read_grants`, true, { grants: attributes?.arc1_targets ?? [] });
      const payload = JSON.parse(Buffer.from(tokens[actor.label].split('.')[1], 'base64url').toString('utf8'));
      ensure(
        `${actor.label}.token_lifetime`,
        typeof payload.exp === 'number' && payload.exp * 1000 > Date.now() + 600000,
      );
    }
    manifest = await privateJson(`${root}/fixture-manifest.json`);
    const manifestSha256 = validateFixtures(manifest, actors);
    const run = configurationOverride ? await privateJson(`${root}/run-manifest.json`) : await verifyRunManifest(root);
    ensure(
      'run.binding',
      typeof run.runId === 'string' &&
        /^[a-f0-9]{40}$/.test(run.sourceRevision) &&
        /^[a-f0-9]{64}$/.test(run.harnessSha256),
    );
    journal = {
      runId: run.runId,
      sourceRevision: run.sourceRevision,
      harnessSha256: run.harnessSha256,
      plan: 'delete-two-user-v1',
      target,
      manifestSha256,
      startedAt: new Date().toISOString(),
      assertions,
      fixtures: manifest.fixtures.map((f) => ({ actor: f.actor, type: f.type, name: f.name })),
    };
    try {
      await write(`${root}/deletion-qualification.json`, journal, true);
    } catch (error) {
      if (error.code === 'EEXIST') throw new HarnessError('JOURNAL_EXISTS');
      throw error;
    }
    journalOwned = true;
    const preflight = await native('preflight');
    ensure(
      'native-preflight.complete',
      preflight.status === 'complete' && preflight.manifestSha256 === manifestSha256 && preflight.fixtures.length === 4,
    );
    for (const fixture of manifest.fixtures)
      ensure(
        `native-preflight.${fixture.name}`,
        preflight.fixtures.some((f) => f.name === fixture.name && f.type === fixture.type && f.absent === true),
      );
    step('initialize');
    for (const actor of actors)
      clients[actor.label] = await initialize(actor.label, `/${target}/mcp`, tokens[actor.label]);
    for (const actor of actors) {
      const tools = await catalog(clients[actor.label]);
      const write = tools.find((t) => t.name === 'SAPWrite');
      ensure(
        `${actor.label}.write_catalog`,
        actor.write
          ? Array.isArray(write?.inputSchema?.properties?.action?.enum) &&
              write.inputSchema.properties.action.enum.includes('delete')
          : !write,
      );
      if (actor.write) {
        const schema = new Ajv2020({ strictTypes: false, allowUnionTypes: true }).compile(write.inputSchema);
        ensure(
          `${actor.label}.delete_schema`,
          schema({ action: 'delete', type: 'CLAS', name: manifest.fixtures[0].name }),
        );
        if (includeQualifier) {
          ensure(
            `${actor.label}.include_enum`,
            sameSet(write.inputSchema.properties.include?.enum ?? [], includeKinds),
          );
          for (const include of includeKinds)
            ensure(
              `${actor.label}.${include}.clear_schema`,
              schema({
                action: 'update',
                type: 'CLAS',
                name: manifest.fixtures[0].name,
                include,
                source: '',
                expectedSourceHash: 'a'.repeat(64),
              }),
            );
        }
      }
      ensure(`${actor.label}.excluded_tools`, !tools.some((t) => t.name === 'SAPGit' || t.name.startsWith('Custom_')));
    }
    for (const fixture of manifest.fixtures) {
      const entry = journal.fixtures.find((f) => f.name === fixture.name);
      const client = clients[fixture.actor];
      const key = { type: fixture.type, name: fixture.name };
      step(`create-${fixture.name}`);
      entry.creationAttempted = true;
      await save();
      const created = (
        await call(client, 'SAPWrite', {
          ...key,
          action: 'create',
          package: '$TMP',
          source: fixture.source1,
          description: 'Temporary PR1142 PP deletion fixture',
        })
      ).body;
      ensure(`${phase}.saved`, created?.state === 'saved-inactive' && created.target === target);
      const first = await editable(fixture);
      step(`update-${fixture.name}`);
      entry.updateAttempted = true;
      await save();
      ensure(
        `${phase}.saved`,
        (
          await call(client, 'SAPWrite', {
            ...key,
            action: 'update',
            source: fixture.source2,
            expectedSourceHash: first.sourceHash,
          })
        ).body?.state === 'saved-inactive',
      );
      const second = await editable(fixture);
      ensure(`${phase}.changed`, second.sourceHash !== first.sourceHash);
      step(`stale-${fixture.name}`);
      const refused = (
        await call(
          client,
          'SAPWrite',
          { ...key, action: 'update', source: fixture.source3, expectedSourceHash: first.sourceHash },
          'PINNED_WRITE_REFUSED',
        )
      ).body;
      ensure(
        `${phase}.reason`,
        refused?.state === 'unchanged' &&
          refused?.message?.startsWith('Source changed, or expectedSourceHash came from a different object/include.'),
      );
      ensure(`${phase}.unchanged`, (await editable(fixture)).sourceHash === second.sourceHash);
      step(`final-save-${fixture.name}`);
      entry.finalSaveAttempted = true;
      await save();
      const changed =
        fixture.type === 'CLAS'
          ? {
              ...key,
              action: 'edit_method',
              method: 'GET_VALUE',
              source: 'rv_value = 3.',
              expectedSourceHash: second.sourceHash,
            }
          : { ...key, action: 'update', source: fixture.source3, expectedSourceHash: second.sourceHash };
      ensure(`${phase}.saved`, (await call(client, 'SAPWrite', changed)).body?.state === 'saved-inactive');
      const third = await editable(fixture);
      ensure(`${phase}.changed`, third.sourceHash !== second.sourceHash);
      if (includeQualifier && fixture.type === 'CLAS') {
        await includeQualifier({ fixture, marker: manifest.marker, entry, client, target, call, ensure, step, save });
      }
      step(`activate-${fixture.name}`);
      entry.activationAttempted = true;
      await save();
      ensure(`${phase}.executed`, (await call(client, 'SAPActivate', key)).body?.success === true);
      const receipt = await native('identity', fixture.name);
      ensure(
        `${phase}.native_identity`,
        receipt.status === 'complete' &&
          receipt.manifestSha256 === manifestSha256 &&
          receipt.fixtures.length === 1 &&
          receipt.fixtures[0].identity?.createdBy === actors.find((a) => a.label === fixture.actor).sapUser,
      );
      const observed = receipt.fixtures[0].identity;
      if (includeQualifier && fixture.type === 'CLAS') {
        ensure(
          `${phase}.native_includes`,
          entry.includes?.complete === true &&
            sameSet(Object.keys(entry.includes.kinds), includeKinds) &&
            Object.entries(entry.includes.kinds).every(
              ([kind, value]) =>
                observed.includes?.[kind]?.sourceSha256 === value.sourceHash &&
                observed.includes?.[kind]?.activeSourceSha256 === value.sourceHash &&
                observed.includes?.[kind]?.changedBy === actors.find((a) => a.label === fixture.actor).sapUser &&
                observed.includes?.[kind]?.version === 'active',
            ),
        );
      }
      ensure(
        `${phase}.native_source`,
        observed.name === fixture.name &&
          observed.type === fixture.type &&
          observed.sourceSha256 === third.sourceHash &&
          observed.activeSourceSha256 === third.sourceHash,
      );
      entry.sourceHash = third.sourceHash;
      entry.nativeIdentity = observed;
      await save();
      if (includeQualifier && fixture.type === 'CLAS') {
        // Missing coverage fails qualification without interrupting activation/cleanup evidence.
        record(`${fixture.name}.include_initialization_exercised`, entry.includes.initializedKinds.length > 0, {
          initializedKinds: entry.includes.initializedKinds,
        });
      }
    }
    if (formatterQualifier) {
      step('formatter-qualification');
      journal.formatterAttempted = true;
      await save();
      const frozenSessions = new Map(
        Object.entries(tokens).map(([key, token]) => [key, { token: { access_token: token } }]),
      );
      journal.formatter = await formatterQualifier({ sessions: frozenSessions, sentinels: journal.fixtures });
      await save();
      ensure(
        'formatter.qualified',
        journal.formatter.failed === 0 &&
          journal.formatter.nativeSeedRestored === true &&
          journal.formatter.restored.writerA === true &&
          journal.formatter.restored.writerB === true,
      );
    }
    for (const [label, route, token, extra] of [
      ['reader', `/${target}/mcp`, tokens.readerA, {}],
      ['readonly-destination', '/A4H/001/mcp', tokens.writerA, {}],
      ['aggregate', '/multi/mcp', tokens.writerA, { target }],
      ['compatibility', '/authorize', tokens.writerA, { target }],
    ]) {
      step(label);
      const denied = await initialize(label, route, token);
      const tools = await catalog(denied);
      ensure(`${label}.hidden`, !tools.some((t) => ['SAPWrite', 'SAPActivate'].includes(t.name)));
      for (const fixture of manifest.fixtures) {
        await call(
          denied,
          'SAPWrite',
          { ...extra, action: 'delete', type: fixture.type, name: fixture.name },
          'MULTI_TARGET_OPERATION_FORBIDDEN',
        );
        if (includeQualifier && fixture.type === 'CLAS') {
          const hash = journal.fixtures.find((f) => f.name === fixture.name).includes.kinds.macros.sourceHash;
          await call(
            denied,
            'SAPWrite',
            {
              ...extra,
              action: 'update',
              type: 'CLAS',
              name: fixture.name,
              include: 'macros',
              source: 'forbidden',
              expectedSourceHash: hash,
            },
            'MULTI_TARGET_OPERATION_FORBIDDEN',
          );
          const current = (
            await call(clients[fixture.actor], 'SAPRead', {
              type: 'CLAS',
              name: fixture.name,
              include: 'macros',
              format: 'editable',
            })
          ).body;
          ensure(`${label}.${fixture.name}.include_unchanged`, current?.sourceHash === hash);
        }
        ensure(
          `${label}.${fixture.name}.unchanged`,
          (await editable(fixture)).sourceHash === journal.fixtures.find((f) => f.name === fixture.name).sourceHash,
        );
      }
    }
    const witness = manifest.fixtures[0];
    for (const extra of [
      { source: 'forbidden' },
      { expectedSourceHash: 'a'.repeat(64) },
      { include: 'main' },
      { package: '$TMP' },
      { objects: [] },
    ]) {
      step(`hidden-delete-field-${Object.keys(extra)[0]}`);
      await call(
        clients[witness.actor],
        'SAPWrite',
        { action: 'delete', type: witness.type, name: witness.name, ...extra },
        'MULTI_TARGET_OPERATION_FORBIDDEN',
      );
      ensure(`${phase}.unchanged`, (await editable(witness)).sourceHash === journal.fixtures[0].sourceHash);
    }
    for (const fixture of manifest.fixtures) {
      step(`delete-${fixture.name}`);
      const entry = journal.fixtures.find((f) => f.name === fixture.name);
      const current = await native('unchanged', fixture.name);
      ensure(
        `${phase}.native_unchanged`,
        current.status === 'complete' &&
          current.manifestSha256 === manifestSha256 &&
          current.fixtures[0]?.unchanged === true &&
          current.fixtures[0]?.identity?.sourceSha256 === entry.sourceHash,
      );
      entry.deletionAttempted = true;
      await save();
      const deleted = (
        await call(clients[fixture.actor], 'SAPWrite', { action: 'delete', type: fixture.type, name: fixture.name })
      ).body;
      entry.deletion = deleted;
      await save();
      ensure(
        `${phase}.confirmed`,
        deleted?.ok === true &&
          deleted.state === 'deleted' &&
          deleted.target === target &&
          deleted.type === fixture.type &&
          deleted.name === fixture.name &&
          deleted.retryable === false,
      );
      const proof = await native('absence', fixture.name);
      ensure(
        `${phase}.independent_absence`,
        proof.status === 'complete' &&
          proof.manifestSha256 === manifestSha256 &&
          proof.fixtures[0]?.name === fixture.name &&
          proof.fixtures[0]?.absent === true,
      );
      entry.independentAbsence = true;
      await save();
    }
  } catch (error) {
    record('qualification.execution', false, { phase, ...safeFailure(error) });
  } finally {
    recovering = true;
    try {
      if (journalOwned) {
        for (const fixture of manifest.fixtures) {
          const entry = journal.fixtures.find((f) => f.name === fixture.name);
          step(`cleanup-${fixture.name}`);
          try {
            const proof = await native('cleanup', fixture.name);
            ensure(
              `${phase}.independent_absence`,
              proof.status === 'complete' &&
                proof.manifestSha256 === journal.manifestSha256 &&
                proof.fixtures[0]?.name === fixture.name &&
                proof.fixtures[0]?.absent === true,
            );
            entry.finalAbsenceVerified = true;
          } catch (error) {
            record(`${phase}.failure`, false, safeFailure(error));
            entry.finalAbsenceVerified = false;
          }
          try {
            await save();
          } catch (error) {
            record(`${phase}.journal_failure`, false, safeFailure(error));
          }
        }
        journal.finishedAt = new Date().toISOString();
        journal.passed = assertions.filter((a) => a.pass).length;
        journal.failed = assertions.filter((a) => !a.pass).length;
        journal.allAbsent = journal.fixtures.every((f) => f.finalAbsenceVerified === true);
        try {
          await save();
        } catch (error) {
          record('journal.final_failure', false, safeFailure(error));
        }
      }
    } finally {
      busy = false;
    }
  }
  const result = {
    plan: 'delete-two-user-v1',
    passed: assertions.filter((a) => a.pass).length,
    failed: assertions.filter((a) => !a.pass).length,
    journalOwned,
    allAbsent: journalOwned && journal.allAbsent,
    failures: assertions.filter((a) => !a.pass),
  };
  emit('qualification_complete', result);
  return result;
}
