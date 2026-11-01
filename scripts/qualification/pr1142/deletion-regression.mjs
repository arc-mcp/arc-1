import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { qualify } from './deletion-qualification.mjs';
import { durable } from './durable-journal.mjs';
import { digest, sourceFor, validateFixtures } from './fixture-contract.mjs';

const actors = [
  { label: 'writerA', email: 'first@example.test', sapUser: 'FIRST', letter: 'A', write: true },
  { label: 'writerB', email: 'second@example.test', sapUser: 'SECOND', letter: 'B', write: true },
  { label: 'readerA', email: 'first@example.test', sapUser: 'FIRST', letter: 'A', write: false },
];
const baseUrl = new URL('https://mcp-sap-docs.cfapps.us10-001.hana.ondemand.com');
const scenarios = [
  'success-replay',
  'frozen-sessions',
  'wrong-identity',
  'wrong-refusal',
  'denied-delete-success',
  'ignored-include',
  'create-uncertain',
  'stale-write-accepted',
  'wrong-native-author',
  'foreign-change',
  'unknown-absence',
  'cleanup-read-failure',
  'cleanup-journal-failure',
  'invalid-delete-catalog',
  'formatter-failure',
  'visible-denied-write',
  'abort-before-delete',
];
for (const scenario of scenarios) {
  const root = await mkdtemp(join(tmpdir(), 'arc1-deletion-harness-test-'));
  const manifest = {
    target: 'PR1142/001',
    nativeUrl: 'https://a4h.marianzeis.de',
    client: '001',
    marker: 'A'.repeat(32),
    fixtures: actors
      .filter((a) => a.write)
      .flatMap((a) =>
        ['CLAS', 'INTF'].map((type) => ({
          actor: a.label,
          type,
          name: `ZARC1_DPP_${a.letter}${type === 'CLAS' ? 'C' : 'I'}_1234ABCD`,
        })),
      ),
  };
  for (const f of manifest.fixtures) for (const n of [1, 2, 3]) f[`source${n}`] = sourceFor(f, manifest.marker, n);
  const manifestSha256 = validateFixtures(manifest, actors);
  await durable(`${root}/fixture-manifest.json`, manifest, true);
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
      scopes: keyOf(t) === 'readerA' ? ['read'] : ['read', 'write'],
      extra: { xsuaaUserAttributes: { arc1_targets: ['*'], arc1_write_targets: ['PR1142/001', 'A4H/001'] } },
    });
    const service = {
      createSecurityContext: async (t) => ({
        getEmail: () =>
          scenario === 'wrong-identity' ? 'wrong@example.test' : actors.find((a) => a.label === keyOf(t))?.email,
        getOrigin: () => 'sap.custom',
        checkLocalScope: (s) => s === 'read' || keyOf(t) !== 'readerA',
      }),
    };
    const objects = new Map(),
      receipts = new Map(),
      cleanup = [];
    let phase,
      output,
      requests = 0,
      mutations = 0,
      injected = false,
      formatterCalled = false;
    const abort = new AbortController();
    const emit = (event, value) => {
      if (
        scenario === 'abort-before-delete' &&
        event === 'qualification_phase' &&
        value.phase === `delete-${manifest.fixtures[0].name}`
      )
        abort.abort();
      if (event === 'qualification_phase') phase = value.phase;
      if (event === 'qualification_complete') output = value;
    };
    const failure = (error) => ({ isError: true, content: [{ type: 'text', text: JSON.stringify({ error }) }] });
    globalThis.fetch = async (url, init) => {
      requests++;
      assert.equal(url.origin, baseUrl.origin);
      const request = JSON.parse(init.body),
        actor = keyOf(init.headers.Authorization.slice(7)),
        denied = actor === 'readerA' || url.pathname !== '/PR1142/001/mcp';
      let result, body;
      if (request.method === 'notifications/initialized')
        return new Response(null, { status: 202, headers: { 'cache-control': 'private, no-store' } });
      if (request.method === 'initialize')
        result = { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'mock', version: '1' } };
      else if (request.method === 'tools/list')
        result = {
          tools:
            denied && !(scenario === 'visible-denied-write' && actor !== 'readerA')
              ? []
              : [
                  {
                    name: 'SAPWrite',
                    inputSchema: {
                      type: 'object',
                      required:
                        scenario === 'invalid-delete-catalog'
                          ? ['action', 'type', 'name', 'source']
                          : ['action', 'type', 'name'],
                      properties: { action: { enum: ['create', 'update', 'edit_method', 'delete'] } },
                    },
                  },
                  { name: 'SAPActivate' },
                ],
        };
      else {
        const { name, arguments: args } = request.params;
        const fixture = manifest.fixtures.find((f) => f.name === args.name),
          entry = objects.get(args.name);
        assert.ok(fixture);
        const rawExtra =
          args.action === 'delete' && Object.keys(args).some((k) => !['action', 'type', 'name', 'target'].includes(k));
        const leak =
          (scenario === 'denied-delete-success' && denied) || (scenario === 'ignored-include' && args.include);
        if ((denied || rawExtra) && !leak)
          result = failure(scenario === 'wrong-refusal' ? 'WRONG_CODE' : 'MULTI_TARGET_OPERATION_FORBIDDEN');
        else if (name === 'SAPRead') {
          assert.ok(entry);
          body = { source: entry.source, sourceHash: digest(entry.source) };
        } else if (name === 'SAPActivate') {
          assert.ok(entry);
          entry.active = true;
          body = { success: true };
        } else if (args.action === 'create') {
          assert.equal(objects.has(args.name), false);
          mutations++;
          objects.set(args.name, {
            source: args.source,
            active: false,
            createdBy: scenario === 'wrong-native-author' ? 'ALIEN' : actors.find((a) => a.label === actor).sapUser,
          });
          if (scenario === 'frozen-sessions')
            sessions.set('writerB', { token: { access_token: token('wrong-session') } });
          if (scenario === 'create-uncertain') throw new Error('simulated response loss after create');
          body = { state: 'saved-inactive', target: 'PR1142/001' };
        } else if (['update', 'edit_method'].includes(args.action)) {
          assert.ok(entry);
          if (args.expectedSourceHash !== digest(entry.source) && scenario !== 'stale-write-accepted')
            result = {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: 'PINNED_WRITE_REFUSED',
                    state: 'unchanged',
                    message: 'Source changed, or expectedSourceHash came from a different object/include. Read again.',
                  }),
                },
              ],
            };
          else {
            mutations++;
            entry.source = args.action === 'edit_method' ? fixture.source3 : args.source;
            body = { state: 'saved-inactive', target: 'PR1142/001' };
          }
        } else {
          assert.equal(args.action, 'delete');
          if (scenario === 'cleanup-read-failure') result = failure('PINNED_WRITE_INCOMPLETE');
          else {
            assert.ok(entry);
            mutations++;
            objects.delete(args.name);
            body = {
              ok: true,
              state: 'deleted',
              type: fixture.type,
              name: fixture.name,
              target: 'PR1142/001',
              retryable: false,
            };
          }
        }
        result ??= { content: [{ type: 'text', text: JSON.stringify(body) }] };
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }), {
        status: 200,
        headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
      });
    };
    const nativeOverride = async (mode, name) => {
      const f = manifest.fixtures.find((f) => f.name === name),
        entry = objects.get(name);
      const proof = { status: 'complete', manifestSha256, fixtures: [] };
      if (mode === 'preflight')
        proof.fixtures = manifest.fixtures.map((f) => ({ name: f.name, type: f.type, absent: !objects.has(f.name) }));
      else if (mode === 'identity') {
        assert.ok(entry.active);
        const identity = {
          name: f.name,
          type: f.type,
          createdBy: entry.createdBy,
          changedBy: entry.createdBy,
          version: 'active',
          masterSystem: 'A4H',
          sourceSha256: digest(entry.source),
          activeSourceSha256: digest(entry.source),
        };
        if (entry.createdBy === actors.find((a) => a.label === f.actor).sapUser)
          receipts.set(name, structuredClone(identity));
        proof.fixtures = [{ name, type: f.type, identity }];
      } else if (mode === 'unchanged') {
        if (scenario === 'foreign-change' && !injected) {
          entry.source += 'foreign edit';
          injected = true;
        }
        assert.equal(digest(entry.source), receipts.get(name)?.sourceSha256, 'Foreign edit preserved');
        proof.fixtures = [{ name, unchanged: true, identity: receipts.get(name) }];
      } else if (mode === 'absence') {
        if (scenario === 'unknown-absence') throw new Error('simulated generic service 404');
        proof.fixtures = [{ name, absent: !entry }];
      } else {
        assert.equal(mode, 'cleanup');
        cleanup.push(name);
        if (scenario === 'cleanup-read-failure' && name === manifest.fixtures[0].name)
          throw new Error('native cleanup read unavailable');
        if (scenario === 'unknown-absence' && !entry) throw new Error('absence not provable');
        if (entry) {
          assert.ok(receipts.has(name), 'No ownership receipt: preserve the object');
          assert.equal(digest(entry.source), receipts.get(name).sourceSha256, 'Foreign edit preserved');
          objects.delete(name);
        }
        proof.fixtures = [{ name, absent: true }];
      }
      return proof;
    };
    const formatterQualifier = async ({ sessions: frozen, sentinels }) => {
      formatterCalled = true;
      assert.equal(keyOf(frozen.get('writerB').token.access_token), 'writerB');
      assert.equal(sentinels.length, 4);
      return {
        failed: scenario === 'formatter-failure' ? 1 : 0,
        restored: { writerA: true, writerB: true },
        nativeSeedRestored: true,
      };
    };
    const journalOverride = async (path, value, exclusive) => {
      if (scenario === 'cleanup-journal-failure' && phase?.startsWith('cleanup-') && !injected) {
        injected = true;
        throw new Error('simulated journal failure');
      }
      return durable(path, value, exclusive);
    };
    const invoke = () =>
      qualify({
        action: { plan: 'delete-two-user-v1' },
        sessions,
        baseUrl,
        verifyUser,
        service,
        emit,
        nativeOverride,
        configurationOverride: { root, target: 'PR1142/001', actors },
        formatterQualifier,
        journalOverride,
        signal: abort.signal,
      });
    await invoke();
    assert.ok(output);
    if (['success-replay', 'frozen-sessions'].includes(scenario)) {
      assert.equal(output.failed, 0, JSON.stringify(output.failures));
      assert.equal(output.allAbsent, true);
      assert.equal(objects.size, 0);
      assert.equal(formatterCalled, true);
      if (scenario === 'success-replay') {
        const bytes = await readFile(`${root}/deletion-qualification.json`, 'utf8'),
          beforeRequests = requests;
        await invoke();
        assert.ok(output.failures.some((f) => f.code === 'JOURNAL_EXISTS'));
        assert.equal(requests, beforeRequests);
        assert.equal(await readFile(`${root}/deletion-qualification.json`, 'utf8'), bytes);
      }
    } else if (scenario === 'wrong-identity') {
      assert.equal(output.failed > 0, true);
      assert.equal(requests, 0);
      assert.equal(cleanup.length, 0);
    } else {
      assert.equal(output.failed > 0, true, `${scenario} should fail`);
      assert.equal(cleanup.length, 4, 'Every fixture receives an independent cleanup attempt');
      if (scenario === 'abort-before-delete')
        assert.ok(output.failures.some((f) => f.code === 'QUALIFICATION_STOP_REQUESTED'));
      if (scenario === 'formatter-failure') assert.equal(formatterCalled, true);
      if (
        [
          'create-uncertain',
          'stale-write-accepted',
          'wrong-native-author',
          'foreign-change',
          'cleanup-read-failure',
        ].includes(scenario)
      ) {
        assert.equal(output.allAbsent, false);
        assert.equal(objects.size, 1);
      } else if (scenario === 'unknown-absence') assert.equal(output.allAbsent, false);
      else {
        assert.equal(objects.size, 0);
        assert.equal(output.allAbsent, true);
      }
    }
    console.log(JSON.stringify({ scenario, passed: true, requests, mutations, remainingObjects: objects.size }));
  } finally {
    globalThis.fetch = oldFetch;
    await rm(root, { recursive: true, force: true });
  }
}
