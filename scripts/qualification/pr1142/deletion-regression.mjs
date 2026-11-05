import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { qualify } from './deletion-qualification.mjs';
import { qualifyIncludes, includeKinds } from './include-qualification.mjs';
import { durable } from './durable-journal.mjs';
import { digest, sourceFor, validateFixtures } from './fixture-contract.mjs';

const actors = [
  { label: 'writerA', email: 'first@example.test', sapUser: 'FIRST', letter: 'A', write: true },
  { label: 'writerB', email: 'second@example.test', sapUser: 'SECOND', letter: 'B', write: true },
  { label: 'readerA', email: 'first@example.test', sapUser: 'FIRST', letter: 'A', write: false },
];
const baseUrl = new URL('https://mcp-sap-docs.cfapps.us10-001.hana.ondemand.com');
const storedInclude = (source) => source.replace(/\r\n/g, '\n').replace(/\n+$/, '');
const scenarios = [
  'includes-success',
  'includes-bad-clear',
  'includes-stale-write',
  'includes-wrong-native',
  'includes-foreign-draft',
  'includes-read-loss',
  'includes-no-initialization',
  'includes-tool-read-error',
  'includes-denied-write',
  'includes-abort',
  'includes-uncertain',
  'includes-writer-b-failure',
  'includes-wrong-include-author',
  'includes-wrong-session',
  'includes-wrong-include-version',
  'includes-blank-mutates-existing',
  'includes-blank-initializes',
  'includes-blank-wrong-state',
  'includes-post-save-read-rejection',
  'includes-hash-refusal-mutates',
  'includes-hash-refusal-wrong-state',
  'includes-save-wrong-field',
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
export async function runDeletionScenario(scenario, options = {}) {
  const includesEnabled = scenario.startsWith('includes-');
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
      includeMutations = 0,
      deniedIncludeCalls = 0,
      injected = false,
      formatterCalled = false;
    let mutationsAtReadRejection,
      failedReceiptVerified = false;
    const abort = new AbortController();
    const emit = (event, value) => {
      if (
        scenario === 'includes-abort' &&
        event === 'qualification_phase' &&
        value.phase === `include-${manifest.fixtures[0].name}-definitions-existing-save`
      )
        abort.abort();
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
      const request = JSON.parse(init.body);
      // Model a transport wired to the wrong writer, independently of the class creator.
      if (
        scenario === 'includes-wrong-session' &&
        keyOf(init.headers.Authorization.slice(7)) === 'writerA' &&
        request.params?.name === 'SAPWrite' &&
        request.params.arguments?.action === 'update' &&
        request.params.arguments.include
      )
        init = { ...init, headers: { ...init.headers, Authorization: `Bearer ${token('writerB')}` } };
      const actor = keyOf(init.headers.Authorization.slice(7)),
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
                      properties: {
                        action: { enum: ['create', 'update', 'edit_method', 'delete'] },
                        ...(includesEnabled ? { include: { enum: includeKinds } } : {}),
                      },
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
          (scenario === 'denied-delete-success' && denied) ||
          (scenario === 'ignored-include' && args.include) ||
          (scenario === 'includes-denied-write' && denied && args.include);
        if (denied && args.include) deniedIncludeCalls++;
        if ((denied || rawExtra) && !leak)
          result = failure(scenario === 'wrong-refusal' ? 'WRONG_CODE' : 'MULTI_TARGET_OPERATION_FORBIDDEN');
        else if (name === 'SAPRead') {
          assert.ok(entry);
          if (args.include) {
            if (scenario === 'includes-post-save-read-rejection' && phase.endsWith('-existing-save-readback')) {
              const disk = JSON.parse(await readFile(`${root}/deletion-qualification.json`, 'utf8'));
              const progress = disk.fixtures.find((f) => f.name === fixture.name).includes.kinds[args.include];
              assert.equal(progress.attempt, 'existing-save');
              assert.equal(
                progress.lastWrite.sourceHash,
                digest(entry.includes[args.include]),
                'Save receipt must precede its read-back',
              );
              assert.equal(
                progress.sourceHash,
                digest(storedInclude(`" ${manifest.marker} ${fixture.name} ${args.include} version 1\n`)),
              );
              assert.notEqual(progress.sourceHash, progress.lastWrite.sourceHash);
              mutationsAtReadRejection = mutations;
              throw new TypeError('simulated private connection details', { cause: { code: 'ECONNRESET' } });
            }
            if (scenario === 'includes-read-loss') return new Response('unavailable', { status: 500 });
            if (scenario === 'includes-tool-read-error' || !Object.hasOwn(entry.includes, args.include))
              result = failure('NATIVE_READ_UNAVAILABLE');
            else body = { source: entry.includes[args.include], sourceHash: digest(entry.includes[args.include]) };
          } else body = { source: entry.source, sourceHash: digest(entry.source) };
        } else if (name === 'SAPActivate') {
          assert.ok(entry);
          entry.active = true;
          if (entry.includes) entry.activeIncludes = structuredClone(entry.includes);
          body = { success: true };
        } else if (args.action === 'create') {
          assert.equal(objects.has(args.name), false);
          mutations++;
          objects.set(args.name, {
            source: args.source,
            active: false,
            ...(includesEnabled
              ? {
                  includes:
                    scenario === 'includes-no-initialization'
                      ? Object.fromEntries(includeKinds.map((kind) => [kind, `default ${kind}\n`]))
                      : {
                          definitions: 'default definitions\n',
                          implementations: 'default implementations\n',
                          macros: 'default macros\n',
                        },
                  includeAuthors: {},
                }
              : {}),
            createdBy: scenario === 'wrong-native-author' ? 'ALIEN' : actors.find((a) => a.label === actor).sapUser,
          });
          if (scenario === 'frozen-sessions')
            sessions.set('writerB', { token: { access_token: token('wrong-session') } });
          if (scenario === 'create-uncertain') throw new Error('simulated response loss after create');
          body = { state: 'saved-inactive', target: 'PR1142/001' };
        } else if (args.action === 'update' && args.include) {
          assert.ok(entry);
          assert.ok(includeKinds.includes(args.include));
          const initialized = !Object.hasOwn(entry.includes, args.include);
          const stale = !initialized && args.expectedSourceHash !== digest(entry.includes[args.include]);
          const invalidBlank = !args.source.trim() && (args.source !== '' || args.expectedSourceHash === undefined);
          const writeStep = ['first-save', 'existing-save', 'clear', 'final-save'].find((step) =>
            phase.endsWith(`-${step}`),
          );
          if (!denied && writeStep) {
            const disk = JSON.parse(await readFile(`${root}/deletion-qualification.json`, 'utf8'));
            assert.equal(
              disk.fixtures.find((f) => f.name === fixture.name)?.includes?.kinds[args.include]?.attempt,
              writeStep,
              'The include attempt must be durable before the HTTP mutation is sent',
            );
          }
          if (invalidBlank || (stale && !(scenario === 'includes-stale-write' && phase.endsWith('-stale-hash')))) {
            if (
              (stale && scenario === 'includes-hash-refusal-mutates' && phase.endsWith('-stale-hash')) ||
              (invalidBlank &&
                ((scenario === 'includes-blank-mutates-existing' && !initialized) ||
                  (scenario === 'includes-blank-initializes' && initialized)))
            ) {
              mutations++;
              includeMutations++;
              entry.includes[args.include] = 'unexpected write despite refusal';
              entry.includeAuthors[args.include] = actors.find((a) => a.label === actor).sapUser;
            }
            result = {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({
                    error: 'PINNED_WRITE_REFUSED',
                    state:
                      (invalidBlank && scenario === 'includes-blank-wrong-state') ||
                      (stale && scenario === 'includes-hash-refusal-wrong-state' && phase.endsWith('-stale-hash'))
                        ? 'incomplete'
                        : 'unchanged',
                  }),
                },
              ],
            };
          } else {
            mutations++;
            includeMutations++;
            if (
              !(
                (scenario === 'includes-bad-clear' ||
                  (scenario === 'includes-writer-b-failure' && actor === 'writerB')) &&
                args.source === ''
              )
            ) {
              entry.includes[args.include] = storedInclude(args.source);
              entry.includeAuthors[args.include] = actors.find((a) => a.label === actor).sapUser;
            }
            if (scenario === 'includes-uncertain') throw new Error('simulated response loss after include save');
            body = {
              action: 'update',
              state: 'saved-inactive',
              target: scenario === 'includes-save-wrong-field' ? 'OTHER/001' : 'PR1142/001',
              type: 'CLAS',
              name: fixture.name,
              include: args.include,
              initialized,
              sourceHash: digest(entry.includes[args.include]),
            };
          }
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
        if (includesEnabled && f.type === 'CLAS') {
          identity.includes = Object.fromEntries(
            includeKinds.map((kind) => [
              kind,
              {
                sourceSha256: digest(entry.includes[kind]),
                activeSourceSha256: digest(entry.activeIncludes[kind]),
                createdBy: entry.createdBy,
                changedBy: entry.includeAuthors[kind],
                version: 'active',
              },
            ]),
          );
          if (scenario === 'includes-wrong-native') identity.includes.macros.activeSourceSha256 = '0'.repeat(64);
          if (scenario === 'includes-wrong-include-author') identity.includes.macros.changedBy = 'OTHER';
          if (scenario === 'includes-wrong-include-version') identity.includes.macros.version = 'inactive';
        }
        if (entry.createdBy === actors.find((a) => a.label === f.actor).sapUser)
          receipts.set(name, structuredClone(identity));
        proof.fixtures = [{ name, type: f.type, identity }];
      } else if (mode === 'unchanged') {
        if (scenario === 'foreign-change' && !injected) {
          entry.source += 'foreign edit';
          injected = true;
        }
        if (scenario === 'includes-foreign-draft' && f.type === 'CLAS' && !injected) {
          entry.includes.macros += 'foreign edit';
          injected = true;
        }
        assert.equal(digest(entry.source), receipts.get(name)?.sourceSha256, 'Foreign edit preserved');
        if (includesEnabled && f.type === 'CLAS')
          for (const kind of includeKinds) {
            assert.equal(
              digest(entry.includes[kind]),
              receipts.get(name)?.includes[kind].sourceSha256,
              'Foreign include preserved',
            );
            assert.equal(
              digest(entry.activeIncludes[kind]),
              receipts.get(name)?.includes[kind].activeSourceSha256,
              'Active include differs',
            );
          }
        proof.fixtures = [{ name, unchanged: true, identity: receipts.get(name) }];
      } else if (mode === 'absence') {
        if (scenario === 'unknown-absence') throw new Error('simulated generic service 404');
        proof.fixtures = [{ name, absent: !entry }];
      } else {
        assert.equal(mode, 'cleanup');
        if (scenario === 'includes-post-save-read-rejection' && name === manifest.fixtures[0].name) {
          const records = await Promise.all(
            (await readdir(root))
              .filter((file) => file.startsWith('deletion-rpc-'))
              .map(async (file) => JSON.parse(await readFile(`${root}/${file}`, 'utf8'))),
          );
          const failures = records.filter((record) => record.failure);
          assert.equal(failures.length, 1, 'The failed read receipt must precede cleanup');
          assert.equal(failures[0].failure.code, 'HTTP_REQUEST_FAILED');
          assert.equal(failures[0].failure.rpcTool, 'SAPRead');
          assert.equal(failures[0].failure.causeCode, 'ECONNRESET');
          assert.equal(failures[0].status, undefined);
          assert.ok(failures[0].phase.endsWith('-existing-save-readback'));
          assert.ok(!JSON.stringify(failures).includes('private connection details'));
          failedReceiptVerified = true;
        }
        cleanup.push(name);
        if (scenario === 'cleanup-read-failure' && name === manifest.fixtures[0].name)
          throw new Error('native cleanup read unavailable');
        if (scenario === 'unknown-absence' && !entry) throw new Error('absence not provable');
        if (entry) {
          assert.ok(receipts.has(name), 'No ownership receipt: preserve the object');
          assert.equal(digest(entry.source), receipts.get(name).sourceSha256, 'Foreign edit preserved');
          if (includesEnabled && f.type === 'CLAS')
            for (const kind of includeKinds) {
              assert.equal(
                digest(entry.includes[kind]),
                receipts.get(name)?.includes[kind].sourceSha256,
                'Foreign include preserved',
              );
              assert.equal(
                digest(entry.activeIncludes[kind]),
                receipts.get(name)?.includes[kind].activeSourceSha256,
                'Active include differs',
              );
              assert.equal(
                entry.includeAuthors[kind],
                actors.find((a) => a.label === f.actor).sapUser,
                'Foreign include author preserved',
              );
              assert.equal(
                entry.includeAuthors[kind],
                receipts.get(name)?.includes[kind].changedBy,
                'Include author differs',
              );
              assert.equal(
                entry.active ? 'active' : 'inactive',
                receipts.get(name)?.includes[kind].version,
                'Include version differs',
              );
            }
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
    options.configureFormatter?.(formatterQualifier);
    const journalOverride = async (path, value, exclusive) => {
      if (scenario === 'cleanup-journal-failure' && phase?.startsWith('cleanup-') && !injected) {
        injected = true;
        throw new Error('simulated journal failure');
      }
      return durable(path, value, exclusive);
    };
    const invoke = () =>
      (options.qualifier ?? qualify)({
        action: { plan: 'delete-two-user-v1' },
        sessions,
        baseUrl,
        verifyUser,
        service,
        emit,
        nativeOverride,
        configurationOverride: { root, target: 'PR1142/001', actors },
        ...(options.qualifier
          ? {}
          : { formatterQualifier, ...(includesEnabled ? { includeQualifier: qualifyIncludes } : {}) }),
        journalOverride,
        signal: abort.signal,
      });
    await invoke();
    assert.ok(output);
    if (['success-replay', 'frozen-sessions', 'includes-success'].includes(scenario)) {
      assert.equal(output.failed, 0, JSON.stringify(output.failures));
      assert.equal(output.allAbsent, true);
      assert.equal(objects.size, 0);
      assert.equal(formatterCalled, true);
      if (includesEnabled) assert.equal(includeMutations, 32);
      if (includesEnabled)
        assert.equal(deniedIncludeCalls, 8, 'All four denied routes must exercise both class includes');
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
          'includes-bad-clear',
          'includes-stale-write',
          'includes-wrong-native',
          'includes-foreign-draft',
          'includes-read-loss',
          'includes-tool-read-error',
          'includes-denied-write',
          'includes-abort',
          'includes-uncertain',
          'includes-writer-b-failure',
          'includes-wrong-include-author',
          'includes-wrong-session',
          'includes-wrong-include-version',
          'includes-blank-mutates-existing',
          'includes-blank-initializes',
          'includes-blank-wrong-state',
          'includes-post-save-read-rejection',
          'includes-hash-refusal-mutates',
          'includes-hash-refusal-wrong-state',
          'includes-save-wrong-field',
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
    if (scenario === 'includes-read-loss') assert.equal(includeMutations, 0);
    if (scenario === 'includes-tool-read-error') assert.equal(includeMutations, 0);
    if (scenario === 'includes-denied-write') {
      assert.equal(deniedIncludeCalls, 1);
      assert.ok(
        output.failures.some((f) => f.test.startsWith('reader.') && f.test.endsWith('.expected_outcome')),
        JSON.stringify(output.failures),
      );
    }
    if (scenario === 'includes-abort') {
      assert.equal(includeMutations, 1);
      assert.ok(output.failures.some((f) => f.code === 'QUALIFICATION_STOP_REQUESTED'));
    }
    if (scenario === 'includes-uncertain')
      assert.equal(includeMutations, 1, 'An uncertain include save is never replayed');
    if (scenario === 'includes-post-save-read-rejection') {
      assert.equal(failedReceiptVerified, true);
      assert.equal(includeMutations, 2);
      assert.equal(mutations, mutationsAtReadRejection, 'No mutation follows the rejected read');
      assert.ok(
        output.failures.some(
          (f) =>
            f.code === 'HTTP_REQUEST_FAILED' &&
            f.rpcTool === 'SAPRead' &&
            f.causeCode === 'ECONNRESET' &&
            f.phase.endsWith('-existing-save-readback'),
        ),
      );
    }
    if (scenario === 'includes-writer-b-failure') assert.deepEqual([...objects.keys()], [manifest.fixtures[2].name]);
    const expectedFailure = {
      'includes-blank-mutates-existing': '.empty-without-hash.unchanged_source',
      'includes-blank-initializes': '.empty-without-hash.still_unavailable',
      'includes-blank-wrong-state': '.empty-without-hash.unchanged_result',
      'includes-wrong-session': '.native_includes',
      'includes-wrong-include-version': '.native_includes',
      'includes-hash-refusal-mutates': '.stale-hash.unchanged_source',
      'includes-hash-refusal-wrong-state': '.stale-hash.unchanged_result',
      'includes-save-wrong-field': '.first-save.saved',
    }[scenario];
    if (expectedFailure)
      assert.ok(
        output.failures.some((f) => f.test.endsWith(expectedFailure)),
        JSON.stringify(output.failures),
      );
    if (scenario === 'includes-no-initialization') {
      assert.equal(output.failed, 2);
      assert.ok(
        output.failures.every(
          (f) => f.test.endsWith('.include_initialization_exercised') && f.initializedKinds.length === 0,
        ),
      );
      assert.equal(formatterCalled, true);
      assert.equal(objects.size, 0);
    }
    if (scenario === 'includes-foreign-draft')
      assert.ok(objects.get(manifest.fixtures[0].name).includes.macros.endsWith('foreign edit'));
    if (includesEnabled) {
      const journal = JSON.parse(await readFile(`${root}/deletion-qualification.json`, 'utf8'));
      const first = journal.fixtures.find((f) => f.name === manifest.fixtures[0].name).includes;
      if (scenario === 'includes-writer-b-failure') {
        const second = journal.fixtures.find((f) => f.name === manifest.fixtures[2].name).includes;
        assert.equal(second.complete, false);
        assert.equal(second.kinds.definitions.attempt, 'clear');
        assert.equal(second.kinds.definitions.lastWrite.state, 'saved-inactive');
        assert.equal(
          second.kinds.definitions.sourceHash,
          digest(objects.get(manifest.fixtures[2].name).includes.definitions),
        );
      }
      if (['includes-success', 'includes-writer-b-failure'].includes(scenario)) {
        assert.equal(first.complete, true);
        assert.deepEqual(first.initializedKinds, ['testclasses']);
        for (const kind of includeKinds) {
          assert.equal(first.kinds[kind].complete, true);
          assert.deepEqual(first.kinds[kind].blankRefusals, ['empty-without-hash', 'whitespace']);
          assert.equal(
            first.kinds[kind].sourceHash,
            digest(
              objects.get(manifest.fixtures[0].name)?.includes[kind] ??
                storedInclude(`" ${manifest.marker} ${manifest.fixtures[0].name} ${kind} version 3\n`),
            ),
          );
        }
      }
      if (
        ['includes-bad-clear', 'includes-abort', 'includes-uncertain', 'includes-tool-read-error'].includes(scenario)
      ) {
        assert.equal(first.complete, false);
        const saved = first.kinds.definitions;
        assert.equal(
          saved.attempt,
          scenario === 'includes-bad-clear' ? 'clear' : scenario === 'includes-abort' ? 'existing-save' : 'first-save',
        );
        if (scenario === 'includes-uncertain' || scenario === 'includes-tool-read-error')
          assert.equal(saved.lastWrite, undefined);
        else assert.equal(saved.lastWrite.state, 'saved-inactive');
      }
    }
    const summary = { scenario, passed: true, requests, mutations, includeMutations, remainingObjects: objects.size };
    if (!options.quiet) console.log(JSON.stringify(summary));
    return summary;
  } finally {
    globalThis.fetch = oldFetch;
    await rm(root, { recursive: true, force: true });
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  for (const scenario of scenarios) await runDeletionScenario(scenario);
}
