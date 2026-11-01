import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { durable } from './durable-journal.mjs';
import { qualify } from './formatter-qualification.mjs';
import { qualify as composedQualify } from './qualification.mjs';

const actors = [
  { label: 'writerA', email: 'first@example.test', sapUser: 'FIRST', letter: 'A', write: true },
  { label: 'writerB', email: 'second@example.test', sapUser: 'SECOND', letter: 'B', write: true },
  { label: 'readerA', email: 'first@example.test', sapUser: 'FIRST', letter: 'A', write: false },
];
const baseUrl = new URL('https://mcp-sap-docs.cfapps.us10-001.hana.ondemand.com');
const scenarios = [
  'success-replay-restore',
  'shared-preferences',
  'uncertain-secondary',
  'foreign-change',
  'cleanup-read-failure',
  'cleanup-journal-failure',
  'wrong-identity',
  'extra-scope',
  'wrong-refusal',
  'visible-denied-action',
  'denied-write-success',
  'forward-unchanged',
  'format-echo',
  'wrong-native-during',
  'wrong-sentinel',
  'wrong-format-case',
  'restore-binding-refusal',
  'abort-forward',
  'interrupted-composed-recovery',
];
for (const scenario of scenarios) {
  const root = await mkdtemp(join(tmpdir(), 'arc1-formatter-harness-test-'));
  await durable(
    `${root}/run-manifest.json`,
    { runId: randomUUID(), sourceRevision: 'a'.repeat(40), harnessSha256: 'b'.repeat(64) },
    true,
  );
  const oldFetch = globalThis.fetch;
  try {
    const token = (key) =>
      'test.' +
      Buffer.from(JSON.stringify({ key, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') +
      '.test';
    const sessions = new Map(actors.map((a) => [a.label, { token: { access_token: token(a.label) } }]));
    const keyOf = (t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).key;
    const verifyUser = async (t) => ({
      scopes:
        scenario === 'extra-scope' ? ['read', 'write', 'admin'] : keyOf(t) === 'readerA' ? ['read'] : ['read', 'write'],
      extra: { xsuaaUserAttributes: { arc1_targets: ['*'], arc1_write_targets: ['PR1142/001', 'A4H/001'] } },
    });
    const service = {
      createSecurityContext: async (t) => ({
        getEmail: () =>
          scenario === 'wrong-identity' ? 'wrong@example.test' : actors.find((a) => a.label === keyOf(t)).email,
        getOrigin: () => 'sap.custom',
        checkLocalScope: (s) => s === 'read' || keyOf(t) !== 'readerA',
      }),
    };
    const baseline = { indentation: true, style: 'keywordUpper' },
      values = { writerA: { ...baseline }, writerB: { ...baseline } };
    const sentinels = actors
      .filter((a) => a.write)
      .map((a) => ({
        actor: a.label,
        type: 'CLAS',
        name: `ZCL_${a.sapUser}`,
        sourceHash: 'c'.repeat(64),
        nativeIdentity: { createdBy: a.sapUser, version: 'active' },
      }));
    let interruptedSnapshot;
    let phase,
      output,
      requests = 0,
      mutations = 0,
      injected = false;
    const abort = new AbortController();
    const emit = (event, value) => {
      if (scenario === 'abort-forward' && event === 'qualification_phase' && value.phase === 'secondary-patch')
        abort.abort();
      if (event === 'qualification_phase') phase = value.phase;
      if (event === 'qualification_complete') output = value;
    };
    globalThis.fetch = async (url, init) => {
      assert.equal(url.origin, baseUrl.origin);
      requests++;
      const request = JSON.parse(init.body),
        actor = keyOf(init.headers.Authorization.slice(7));
      const denied = actor === 'readerA' || url.pathname !== '/PR1142/001/mcp';
      let result;
      if (request.method === 'notifications/initialized')
        return new Response(null, { status: 202, headers: { 'cache-control': 'private, no-store' } });
      if (request.method === 'initialize')
        result = { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'mock', version: '1' } };
      else if (request.method === 'tools/list')
        result = {
          tools: [
            {
              name: 'SAPLint',
              inputSchema: {
                properties: {
                  action: {
                    enum:
                      denied && scenario !== 'visible-denied-action'
                        ? ['lint']
                        : ['lint', 'format', 'get_formatter_settings', 'set_formatter_settings'],
                  },
                },
              },
            },
          ],
        };
      else {
        assert.equal(request.method, 'tools/call');
        const args = request.params.arguments;
        const key = scenario === 'shared-preferences' ? 'writerA' : actor;
        let body;
        if (request.params.name === 'SAPRead')
          body = { sourceHash: scenario === 'wrong-sentinel' ? 'd'.repeat(64) : 'c'.repeat(64) };
        else if (denied)
          result =
            scenario === 'denied-write-success'
              ? { content: [{ type: 'text', text: JSON.stringify({ ok: true, state: 'updated' }) }] }
              : {
                  isError: true,
                  content: [
                    {
                      type: 'text',
                      text: JSON.stringify({
                        error: scenario === 'wrong-refusal' ? 'WRONG_CODE' : 'MULTI_TARGET_OPERATION_FORBIDDEN',
                      }),
                    },
                  ],
                };
        else if (args.action === 'get_formatter_settings') {
          if (scenario === 'cleanup-read-failure' && phase === 'restore-writerB' && !injected) {
            injected = true;
            throw new Error('simulated cleanup read outage');
          }
          body = { ...values[key] };
        } else if (args.action === 'format') {
          const caseActor = scenario === 'wrong-format-case' ? (actor === 'writerA' ? 'writerB' : 'writerA') : actor;
          const formatted =
            scenario === 'format-echo'
              ? args.source
              : args.source
                  .replace('rEpOrT', caseActor === 'writerA' ? 'REPORT' : 'report')
                  .replace('wRiTe', caseActor === 'writerA' ? 'WRITE' : 'write');
          result = { content: [{ type: 'text', text: formatted }] };
        } else {
          assert.equal(args.action, 'set_formatter_settings');
          mutations++;
          if (phase === 'restore-writerA')
            assert.equal(Object.hasOwn(args, 'style'), false, 'Restore must omit unchanged primary style');
          if (phase === 'restore-writerB')
            assert.equal(
              Object.hasOwn(args, 'indentation'),
              false,
              'Restore must omit unchanged secondary indentation',
            );
          if (args.indentation !== undefined)
            values[key].indentation =
              typeof args.indentation === 'string' ? args.indentation === 'true' : args.indentation;
          if (args.style !== undefined) values[key].style = args.style;
          body = {
            ok: true,
            state: scenario === 'forward-unchanged' && !phase.startsWith('restore') ? 'unchanged' : 'updated',
            target: 'PR1142/001',
            concurrency: 'native-unconditional',
          };
          if (scenario === 'uncertain-secondary' && actor === 'writerB' && !injected) {
            injected = true;
            throw new Error('simulated lost response');
          }
          if (scenario === 'foreign-change' && actor === 'writerA' && !injected) {
            injected = true;
            values.writerA.style = 'keywordLower';
          }
        }
        result ??= { content: [{ type: 'text', text: JSON.stringify(body) }] };
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
      });
    };
    const nativeOverride = async (mode) => ({
      status: 'complete',
      seeded: mode === 'seed',
      sentinelFields: ['keepIdentifier', 'formatMethodCalls', 'condenseMethodCalls', 'formatValue', 'defaultAutoStyle'],
      unrelatedPreserved: scenario !== 'wrong-native-during',
      originalBytesRestored:
        values.writerA.indentation === baseline.indentation && values.writerA.style === baseline.style,
      mode,
    });
    const journalOverride = async (path, value, exclusive) => {
      if (
        scenario === 'interrupted-composed-recovery' &&
        phase === 'primary-patch' &&
        value.plan === 'formatter-two-user-v2'
      )
        interruptedSnapshot = structuredClone({ journal: value, values });
      if (
        scenario === 'cleanup-journal-failure' &&
        phase === 'restore-writerB' &&
        value.restored?.writerB === true &&
        !injected
      ) {
        injected = true;
        throw new Error('simulated one-shot journal outage');
      }
      return durable(path, value, exclusive);
    };
    const invoke = (extra, composed = false) =>
      (composed ? composedQualify : qualify)({
        action: { plan: 'formatter-two-user-v2', ...extra },
        sessions,
        baseUrl,
        verifyUser,
        service,
        emit,
        sentinels,
        configurationOverride: { root, target: 'PR1142/001', actors },
        nativeOverride,
        journalOverride,
        signal: abort.signal,
      });
    await invoke();
    assert.ok(output);
    if (scenario === 'success-replay-restore') {
      assert.equal(output.failed, 0, JSON.stringify(output.failures));
      assert.deepEqual(values, { writerA: baseline, writerB: baseline });
      assert.equal(mutations, 4);
      const bytes = await readFile(`${root}/formatter-qualification.json`, 'utf8'),
        beforeRequests = requests;
      await invoke();
      assert.ok(output.failures.some((f) => f.code === 'JOURNAL_EXISTS'));
      assert.equal(requests, beforeRequests);
      assert.equal(await readFile(`${root}/formatter-qualification.json`, 'utf8'), bytes);
      await invoke({ restoreOnly: true });
      assert.equal(output.failed, 0, JSON.stringify(output.failures));
      assert.equal(mutations, 4);
    } else if (scenario === 'interrupted-composed-recovery') {
      assert.equal(output.failed, 0);
      assert.ok(interruptedSnapshot);
      assert.equal(interruptedSnapshot.journal.finishedAt, undefined);
      await durable(`${root}/formatter-qualification.json`, interruptedSnapshot.journal);
      await rm(`${root}/formatter-attempt-writerB.json`);
      const { runId, sourceRevision, harnessSha256, target } = interruptedSnapshot.journal;
      const parent = {
        plan: 'delete-two-user-v1',
        runId,
        sourceRevision,
        harnessSha256,
        target,
        formatterAttempted: true,
        fixtures: sentinels,
        assertions: [{ test: 'source.active', pass: true }],
      };
      await durable(`${root}/deletion-qualification.json`, parent, true);
      Object.assign(values, structuredClone(interruptedSnapshot.values));
      values.writerA.style = 'keywordLower'; // A foreign edit must survive the first recovery.
      await invoke({ restoreOnly: true }, true);
      assert.ok(output.failed > 0);
      assert.equal(values.writerA.style, 'keywordLower');
      const failedRecovery = JSON.parse(
        await readFile(`${root}/deletion-qualification.json`, 'utf8'),
      ).formatterRecovery;
      assert.ok(failedRecovery.failed > 0);
      Object.assign(values, structuredClone(interruptedSnapshot.values));
      await invoke({ restoreOnly: true }, true);
      assert.equal(output.failed, 0, JSON.stringify(output.failures));
      assert.deepEqual(values, { writerA: baseline, writerB: baseline });
      const recovered = JSON.parse(await readFile(`${root}/deletion-qualification.json`, 'utf8'));
      assert.deepEqual(recovered.formatterRestorationHistory, [failedRecovery]);
      assert.equal(recovered.formatterRecovery.failed, 0);
      assert.deepEqual(recovered.fixtures, parent.fixtures);
      assert.deepEqual(recovered.assertions, parent.assertions);
      for (const field of ['formatter', 'finishedAt', 'passed', 'failed', 'allAbsent'])
        assert.equal(recovered[field], undefined);
      const formatterJournal = JSON.parse(await readFile(`${root}/formatter-qualification.json`, 'utf8'));
      assert.equal(formatterJournal.finishedAt, undefined);
      assert.equal(formatterJournal.interrupted, true);
      assert.equal(typeof formatterJournal.recoveryFinishedAt, 'string');
      assert.ok(formatterJournal.assertions.some((a) => !a.pass));
    } else if (scenario === 'restore-binding-refusal') {
      assert.equal(output.failed, 0);
      const saved = JSON.parse(await readFile(`${root}/formatter-qualification.json`, 'utf8'));
      saved.runId = randomUUID();
      await durable(`${root}/formatter-qualification.json`, saved);
      const bytes = await readFile(`${root}/formatter-qualification.json`, 'utf8');
      const beforeRequests = requests;
      await invoke({ restoreOnly: true });
      assert.equal(output.journalOwned, false);
      assert.ok(output.failures.some((f) => f.code === 'RESTORE_BINDING'));
      assert.equal(requests, beforeRequests);
      assert.equal(await readFile(`${root}/formatter-qualification.json`, 'utf8'), bytes);
    } else if (scenario === 'abort-forward') {
      assert.ok(output.failures.some((f) => f.code === 'QUALIFICATION_STOP_REQUESTED'));
      assert.deepEqual(values, { writerA: baseline, writerB: baseline });
      assert.equal(mutations, 2, 'Only the primary patch and its restoration may write');
    } else if (['wrong-identity', 'extra-scope'].includes(scenario)) {
      assert.ok(output.failed > 0);
      assert.equal(requests, 0);
      await assert.rejects(access(`${root}/formatter-qualification.json`));
    } else if (scenario === 'foreign-change') {
      assert.ok(output.failed > 0);
      assert.equal(mutations, 1);
      assert.equal(values.writerA.style, 'keywordLower');
      assert.equal(output.restored.writerA, false);
    } else if (scenario === 'cleanup-read-failure') {
      assert.ok(output.failed > 0);
      assert.deepEqual(values.writerA, baseline);
      assert.equal(output.restored.writerB, false);
      assert.notDeepEqual(values.writerB, baseline);
      const beforeMutations = mutations;
      await invoke({ restoreOnly: true });
      assert.equal(output.failed, 0, JSON.stringify(output.failures));
      assert.equal(mutations, beforeMutations + 1);
      assert.deepEqual(values, { writerA: baseline, writerB: baseline });
    } else {
      assert.ok(output.failed > 0, `${scenario} should fail`);
      assert.deepEqual(values, { writerA: baseline, writerB: baseline });
    }
    console.log(JSON.stringify({ scenario, passed: true, requests, mutations }));
  } finally {
    globalThis.fetch = oldFetch;
    await rm(root, { recursive: true, force: true });
  }
}
