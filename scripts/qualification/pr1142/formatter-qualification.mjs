import { randomUUID } from 'node:crypto';
import { durable } from './durable-journal.mjs';
import { McpSession } from './mcp-checks.mjs';
import { nativeCheck } from './native-check.mjs';
import { configuration, validateConfiguration } from './qualification-config.mjs';
import { verifyRunManifest } from './run-manifest.mjs';
import { HarnessError, privateJson, readToolBody, responseReceipt, safeFailure } from './safe-io.mjs';
import { checkForwardWork } from './shutdown.mjs';

const styles = ['none', 'keywordLower', 'keywordAuto', 'keywordUpper'];
const companionActions = ['format', 'get_formatter_settings', 'set_formatter_settings'];
const same = (a, b) => a?.indentation === b?.indentation && a?.style === b?.style;
const sameSet = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
const validSettings = (v) =>
  v &&
  typeof v.indentation === 'boolean' &&
  styles.includes(v.style) &&
  sameSet(Object.keys(v), ['indentation', 'style']);
const restorePatch = (baseline, expected) =>
  Object.fromEntries(['indentation', 'style'].filter((k) => baseline[k] !== expected[k]).map((k) => [k, baseline[k]]));
let busy = false;

/** Test injections are function arguments only; the live command wrapper never accepts them from input. */
export async function qualify({
  action,
  sessions,
  baseUrl,
  verifyUser,
  service,
  emit,
  sentinels,
  configurationOverride,
  nativeOverride,
  journalOverride,
  signal,
}) {
  if (busy || action.plan !== 'formatter-two-user-v2') throw new HarnessError('QUALIFICATION_PLAN_OR_STATE_MISMATCH');
  if (baseUrl.origin !== 'https://mcp-sap-docs.cfapps.us10-001.hana.ondemand.com')
    throw new HarnessError('WRONG_TEST_APP');
  const config = configurationOverride ?? configuration;
  validateConfiguration(config);
  const { root, target, actors } = config;
  busy = true;
  const write = journalOverride ?? durable;
  const native = async (mode) => {
    checkForwardWork(signal, recovering);
    return nativeOverride ? nativeOverride(mode) : nativeCheck('native-formatter.mts', mode, randomUUID());
  };
  const assertions = [],
    clients = {},
    tokens = {};
  let phase = 'identity-preflight',
    journal,
    journalOwned = false,
    recovering = action.restoreOnly === true,
    run;
  const record = (test, pass, details = {}) => assertions.push({ test, pass: pass === true, ...details });
  const ensure = (test, pass, details = {}) => {
    record(test, pass, details);
    if (!pass) throw new HarnessError(test.toUpperCase().replace(/[^A-Z0-9_]/g, '_'));
  };
  const step = (value) => {
    checkForwardWork(signal, recovering);
    phase = value;
    emit('qualification_phase', { phase });
  };
  const save = () => write(`${root}/formatter-qualification.json`, journal);
  const observeResponse = (session) => async (method, response) => {
    if (!journalOwned) return;
    journal.rpcReceipts = (journal.rpcReceipts ?? 0) + 1;
    await write(
      `${root}/formatter-rpc-${randomUUID()}.json`,
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
    ensure(`${phase}.expected_outcome`, Boolean(parsed.result.isError) === Boolean(expectedError), {
      expectedError: expectedError ?? null,
      actualError: parsed.body?.error ?? null,
    });
    if (expectedError)
      ensure(`${phase}.exact_refusal`, parsed.body?.error === expectedError, {
        expectedError,
        actualError: parsed.body?.error ?? null,
      });
    return parsed;
  };
  const lint = (client, args, expectedError) => call(client, 'SAPLint', args, expectedError);
  const get = async (client) => {
    const value = (await lint(client, { action: 'get_formatter_settings' })).body;
    ensure(`${phase}.native_settings`, typeof value?.indentation === 'boolean' && styles.includes(value?.style));
    return { indentation: value.indentation, style: value.style };
  };
  const catalog = async (client) => {
    checkForwardWork(signal, recovering);
    const response = await client.request('tools/list');
    ensure(`${phase}.catalog`, response.status === 200 && Array.isArray(response.json?.result?.tools));
    const actions = response.json.result.tools.find((t) => t.name === 'SAPLint')?.inputSchema?.properties?.action?.enum;
    ensure(`${phase}.action_enum`, Array.isArray(actions));
    return actions;
  };
  const initialize = async (key, route, token) => {
    checkForwardWork(signal, recovering);
    const client = new McpSession(new URL(route, baseUrl), token, record, key, true, observeResponse(key));
    ensure(`${phase}.${key}.initialize`, (await client.initialize()).status === 200);
    return client;
  };
  const mutationOutcome = (key, value) => {
    ensure(`${phase}.updated`, value?.ok === true && value.state === 'updated' && value.target === target);
    ensure(`${phase}.concurrency`, ['strong-etag', 'native-unconditional'].includes(value.concurrency));
    (journal.concurrency ??= {})[key] = value.concurrency;
  };
  const restore = async () => {
    if (!journalOwned) return;
    for (const key of ['writerB', 'writerA']) {
      step(`restore-${key}`);
      journal.restored[key] = false;
      (journal.restorationStatus ??= {})[key] = 'not-attempted';
      try {
        let attempted = false;
        try {
          const attempt = await privateJson(`${root}/formatter-attempt-${key}.json`);
          ensure(
            `${phase}.attempt_binding`,
            attempt.runId === journal.runId &&
              validSettings(attempt.baseline) &&
              validSettings(attempt.expected) &&
              same(attempt.baseline, journal.baseline[key]) &&
              same(attempt.expected, journal.expected[key]),
          );
          attempted = true;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
        }
        if (!attempted) {
          journal.restorationStatus[key] = 'not-required';
          continue;
        }
        journal.restorationStatus[key] = 'pending';
        ensure(`${phase}.valid_baseline`, validSettings(journal.baseline[key]) && validSettings(journal.expected[key]));
        const current = await get(clients[key]);
        if (!same(current, journal.baseline[key])) {
          ensure(`${phase}.owned_state`, same(current, journal.expected[key]));
          journal.restoreAttempts ??= [];
          journal.restoreAttempts.push({ key, at: new Date().toISOString() });
          await save();
          mutationOutcome(
            `restore-${key}`,
            (
              await lint(clients[key], {
                action: 'set_formatter_settings',
                ...restorePatch(journal.baseline[key], journal.expected[key]),
              })
            ).body,
          );
        }
        ensure(`${phase}.verified`, same(await get(clients[key]), journal.baseline[key]));
        journal.restored[key] = true;
        journal.restorationStatus[key] = 'verified';
      } catch (error) {
        journal.restorationStatus[key] = 'incomplete';
        record(`${phase}.failure`, false, safeFailure(error));
      } finally {
        try {
          await save();
        } catch (error) {
          record(`${phase}.journal_failure`, false, safeFailure(error));
        }
      }
    }
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
      ensure(
        `${actor.label}.exact_write_grants`,
        sameSet(verification.extra?.xsuaaUserAttributes?.arc1_write_targets ?? [], [target, 'A4H/001']),
      );
      ensure(
        `${actor.label}.read_grants`,
        [target, 'A4H/001'].every((t) =>
          (verification.extra?.xsuaaUserAttributes?.arc1_targets ?? []).some((v) => v === t || v === '*'),
        ),
      );
      record(`${actor.label}.observed_read_grants`, true, {
        grants: verification.extra?.xsuaaUserAttributes?.arc1_targets ?? [],
      });
      const payload = JSON.parse(Buffer.from(tokens[actor.label].split('.')[1], 'base64url').toString('utf8'));
      ensure(
        `${actor.label}.token_lifetime`,
        typeof payload.exp === 'number' && payload.exp * 1000 > Date.now() + 600000,
      );
    }
    run = configurationOverride ? await privateJson(`${root}/run-manifest.json`) : await verifyRunManifest(root);
    ensure(
      'run.identity',
      typeof run.runId === 'string' &&
        /^[a-f0-9]{40}$/.test(run.sourceRevision) &&
        /^[a-f0-9]{64}$/.test(run.harnessSha256),
    );
    if (action.restoreOnly === true) {
      journal = await privateJson(`${root}/formatter-qualification.json`);
      ensure(
        'restore.binding',
        journal.target === target &&
          journal.plan === 'formatter-two-user-v2' &&
          journal.runId === run.runId &&
          journal.sourceRevision === run.sourceRevision &&
          journal.harnessSha256 === run.harnessSha256,
      );
      for (const key of ['writerA', 'writerB'])
        ensure(`restore.${key}.shape`, validSettings(journal.baseline[key]) && validSettings(journal.expected[key]));
      journalOwned = true;
    } else {
      journal = {
        plan: 'formatter-two-user-v2',
        target,
        runId: run.runId,
        sourceRevision: run.sourceRevision,
        harnessSha256: run.harnessSha256,
        startedAt: new Date().toISOString(),
        baseline: {},
        expected: {},
        restored: {},
        assertions,
      };
      try {
        await write(`${root}/formatter-qualification.json`, journal, true);
      } catch (error) {
        if (error.code === 'EEXIST') throw new HarnessError('JOURNAL_EXISTS');
        throw error;
      }
      journalOwned = true;
    }
    step('initialize');
    for (const actor of actors)
      clients[actor.label] = await initialize(actor.label, `/${target}/mcp`, tokens[actor.label]);
    if (action.restoreOnly !== true) {
      step('native-sentinels');
      for (const key of ['writerA', 'writerB']) {
        const sentinel = sentinels?.find((s) => s.actor === key);
        ensure(
          `${key}.sentinel_receipt`,
          sentinel?.type === 'CLAS' &&
            /^[a-f0-9]{64}$/.test(sentinel?.sourceHash) &&
            sentinel?.nativeIdentity?.createdBy === actors.find((a) => a.label === key).sapUser &&
            sentinel?.nativeIdentity?.version === 'active',
        );
        const actual = (
          await call(clients[key], 'SAPRead', { type: sentinel.type, name: sentinel.name, format: 'editable' })
        ).body;
        ensure(`${key}.native_sentinel`, actual?.sourceHash === sentinel.sourceHash);
      }
      step('catalogs');
      journal.catalogActions = {};
      for (const key of ['writerA', 'writerB']) {
        journal.catalogActions[key] = await catalog(clients[key]);
        ensure(
          `${key}.formatter_visible`,
          companionActions.every((a) => journal.catalogActions[key].includes(a)),
        );
      }
      journal.catalogActions.readerA = await catalog(clients.readerA);
      ensure(
        'reader.hidden',
        companionActions.every((a) => !journal.catalogActions.readerA.includes(a)),
      );
      step('baseline');
      for (const key of ['writerA', 'writerB']) {
        journal.baseline[key] = await get(clients[key]);
        ensure(`${key}.stable_baseline`, same(await get(clients[key]), journal.baseline[key]));
      }
      journal.expected.writerA = { indentation: !journal.baseline.writerA.indentation, style: 'keywordUpper' };
      journal.expected.writerB = {
        indentation:
          journal.baseline.writerB.style === 'keywordLower'
            ? !journal.baseline.writerB.indentation
            : journal.baseline.writerB.indentation,
        style: 'keywordLower',
      };
      await save();
      step('native-seed');
      journal.nativeSeedAttempted = true;
      await save();
      const seed = await native('seed');
      ensure('native.seeded', seed.status === 'complete' && seed.seeded === true && seed.sentinelFields?.length === 5);
      journal.nativeSeeded = true;
      await save();
      ensure('native.before', (await native('before')).status === 'complete');
      step('primary-patch');
      await write(
        `${root}/formatter-attempt-writerA.json`,
        {
          runId: run.runId,
          baseline: journal.baseline.writerA,
          expected: journal.expected.writerA,
          at: new Date().toISOString(),
        },
        true,
      );
      mutationOutcome(
        'writerA',
        (
          await lint(clients.writerA, {
            action: 'set_formatter_settings',
            indentation: String(journal.expected.writerA.indentation),
            style: journal.expected.writerA.style,
          })
        ).body,
      );
      ensure('primary.readback', same(await get(clients.writerA), journal.expected.writerA));
      ensure('secondary.isolation_after_primary', same(await get(clients.writerB), journal.baseline.writerB));
      ensure('native.during_primary', (await native('during-primary')).unrelatedPreserved === true);
      await save();
      step('secondary-patch');
      await write(
        `${root}/formatter-attempt-writerB.json`,
        {
          runId: run.runId,
          baseline: journal.baseline.writerB,
          expected: journal.expected.writerB,
          at: new Date().toISOString(),
        },
        true,
      );
      mutationOutcome(
        'writerB',
        (await lint(clients.writerB, { action: 'set_formatter_settings', ...journal.expected.writerB })).body,
      );
      ensure('secondary.readback', same(await get(clients.writerB), journal.expected.writerB));
      ensure('primary.isolation_after_secondary', same(await get(clients.writerA), journal.expected.writerA));
      ensure('native.during_secondary', (await native('during-secondary')).unrelatedPreserved === true);
      await save();
      for (const key of ['writerA', 'writerB']) {
        step(`${key}-format`);
        const formatted = await lint(clients[key], {
          action: 'format',
          source: "rEpOrT zarc1_formatter_probe.\nwRiTe 'PP formatting only'.",
        });
        const expected =
          key === 'writerA'
            ? /\bREPORT\s+zarc1_formatter_probe\.[\s\S]*\bWRITE\b/i
            : /\breport\s+zarc1_formatter_probe\.[\s\S]*\bwrite\b/i;
        const words = key === 'writerA' ? ['REPORT', 'WRITE'] : ['report', 'write'];
        ensure(
          `${key}.formatted_keywords`,
          expected.test(formatted.text) &&
            words.every((word) => new RegExp(`\\b${word}\\b`).test(formatted.text)) &&
            !/rEpOrT|wRiTe/.test(formatted.text),
        );
      }
      for (const [key, route, token, extra] of [
        ['reader', `/${target}/mcp`, tokens.readerA, {}],
        ['read-only-destination', '/A4H/001/mcp', tokens.writerA, {}],
        ['aggregate', '/multi/mcp', tokens.writerA, { target }],
        ['aggregate-alias', '/authorize', tokens.writerA, { target }],
      ]) {
        step(key);
        const client = await initialize(key, route, token);
        const actions = await catalog(client);
        ensure(
          `${key}.hidden`,
          companionActions.every((a) => !actions.includes(a)),
        );
        for (const probe of [
          { action: 'set_formatter_settings', indentation: journal.baseline.writerA.indentation },
          { action: 'get_formatter_settings' },
          { action: 'format', source: 'report zarc1_formatter_probe.' },
        ])
          await lint(client, { ...probe, ...extra }, 'MULTI_TARGET_OPERATION_FORBIDDEN');
        ensure(`${key}.primary_unchanged`, same(await get(clients.writerA), journal.expected.writerA));
        ensure(`${key}.secondary_unchanged`, same(await get(clients.writerB), journal.expected.writerB));
      }
    }
  } catch (error) {
    record('qualification.failure', false, { phase, ...safeFailure(error) });
  } finally {
    recovering = true;
    try {
      await restore();
      if (journalOwned) {
        if (journal.restored.writerA && action.restoreOnly !== true)
          try {
            ensure('native.restored', (await native('after')).originalBytesRestored === true);
          } catch (error) {
            record('native.restore_failure', false, safeFailure(error));
          }
        try {
          const restoredSeed = await native('restore-seed');
          ensure(
            'native.pre_seed_restored',
            (restoredSeed.status === 'complete' ||
              (!journal.nativeSeedAttempted && restoredSeed.status === 'not-required')) &&
              restoredSeed.originalBytesRestored === true,
          );
          journal.nativeSeedRestored = true;
        } catch (error) {
          journal.nativeSeedRestored = false;
          record('native.seed_restore_failure', false, safeFailure(error));
        }
        journal.assertions = [...(action.restoreOnly === true ? (journal.assertions ?? []) : []), ...assertions];
        journal.finishedAt = new Date().toISOString();
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
    plan: 'formatter-two-user-v2',
    target,
    runId: run?.runId,
    sourceRevision: run?.sourceRevision,
    harnessSha256: run?.harnessSha256,
    journalOwned,
    passed: assertions.filter((a) => a.pass).length,
    failed: assertions.filter((a) => !a.pass).length,
    restored: journal?.restored ?? {},
    restorationStatus: journal?.restorationStatus ?? {},
    nativeSeedRestored: journal?.nativeSeedRestored === true,
    failures: assertions.filter((a) => !a.pass),
  };
  emit('qualification_complete', result);
  return result;
}
