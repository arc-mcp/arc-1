import { randomUUID } from 'node:crypto';
import { retainedProfile, retainedProfileForRoot, textTailProfile, textTailV2Profile } from './current-retained-profiles.mjs';
import { verifyRetainedSend } from './current-retained-send-proof.mjs';
import { verifyCurrentCatalog } from './current-workflow-catalog.mjs';
import {
  currentApp,
  currentFixtureSources,
  currentPlan,
  currentSymbolsMatch,
  requireEvidence,
  sha,
  validateCurrentManifest,
  verifyCurrentRecording,
} from './current-workflow-contract.mjs';
import { readCurrentControls } from './current-workflow-controls.mjs';
import { durable } from './durable-journal.mjs';
import { McpSession } from './mcp-checks.mjs';
import { nativeCheck } from './native-check.mjs';
import { configuration, validateConfiguration } from './qualification-config.mjs';
import { verifyRunManifest } from './run-manifest.mjs';
import { privateJson, readToolBody, responseReceipt, safeFailure } from './safe-io.mjs';

let busy = false;
const equalSet = (a, b) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());
const normalize = (source) => source.replace(/\r\n/g, '\n').replace(/\n+$/, '');

/** Fixed owner workflows, never an operator-supplied MCP program. Injection is for offline composition tests only. */
export async function qualifyCurrent(context) {
  requireEvidence(!busy, 'CURRENT_QUALIFICATION_BUSY');
  busy = true;
  try {
    return await executeCurrent(context, undefined);
  } finally {
    busy = false;
  }
}

export async function qualifyRetainedCurrent(context) {
  requireEvidence(!busy, 'CURRENT_QUALIFICATION_BUSY');
  busy = true;
  try {
    return await executeCurrent(context, retainedProfile);
  } finally {
    busy = false;
  }
}

export async function qualifyTextTailCurrent(context) {
  requireEvidence(!busy, 'CURRENT_QUALIFICATION_BUSY');
  busy = true;
  try {
    return await executeCurrent(context, textTailProfile);
  } finally {
    busy = false;
  }
}

export async function qualifyTextTailV2Current(context) {
  requireEvidence(!busy, 'CURRENT_QUALIFICATION_BUSY');
  busy = true;
  try {
    return await executeCurrent(context, textTailV2Profile);
  } finally {
    busy = false;
  }
}

async function executeCurrent(
  { action, sessions, baseUrl, verifyUser, service, emit, signal, currentDependencies = {} },
  profile,
) {
  const retained = !!profile;
  const plan = profile?.plan ?? currentPlan;
  requireEvidence(
    action.plan === plan && Object.keys(action).every((k) => ['command', 'plan'].includes(k)),
    'CURRENT_PLAN_OR_STATE_MISMATCH',
  );
  requireEvidence(baseUrl.origin === currentApp, 'WRONG_TEST_APP');
  const config = currentDependencies.configuration ?? configuration;
  validateConfiguration(config);
  const { root, actors, target } = config;
  requireEvidence(retained ? root === profile.root : !retainedProfileForRoot(root), 'RETAINED_FIXED_ROOT_REQUIRED');
  const historyReader = currentDependencies.retainedHistory ?? profile?.readHistory;
  const history = retained ? historyReader() : undefined;
  const load = currentDependencies.load ?? privateJson,
    write = currentDependencies.write ?? durable;
  const verify = currentDependencies.verify ?? (() => verifyRunManifest(root));
  const native =
    currentDependencies.native ?? ((mode, name = 'all') => nativeCheck('current-workflow-native.mts', mode, name));
  const controls = currentDependencies.controls ?? readCurrentControls;
  const run = await verify(),
    manifest = await load(`${root}/fixture-manifest.json`);
  requireEvidence(run.plan === currentPlan && (retained || run.retained === undefined), 'CURRENT_RUN_REQUIRED');
  if (retained) profile.assertContext(history, run, manifest, config);
  const manifestSha256 = validateCurrentManifest(manifest, config, run.sourceRevision);
  const baseline = await controls(root, manifest, manifestSha256, run);
  const deadline = Date.now() + 8 * 60_000;
  const tokens = {},
    clients = {},
    assertions = [],
    verifiedActors = [];
  let journal,
    claimed = false,
    mutating = false,
    firstMutation = false,
    phase = 'identity';
  const record = (test, pass) => {
    assertions.push({ test, pass: pass === true });
    requireEvidence(pass, 'CURRENT_ASSERTION_FAILED');
  };
  const proof = async () => {
    const current = await verify();
    if (retained) profile.assertContext(historyReader(), current, manifest, config);
    requireEvidence(
      ['runId', 'sourceRevision', 'harnessSha256'].every((key) => current[key] === run[key]) &&
        sha(await load(`${root}/fixture-manifest.json`)) === manifestSha256,
      'CURRENT_BINDING_CHANGED',
    );
    const observedControls = await controls(
      root,
      manifest,
      manifestSha256,
      run,
      undefined,
      undefined,
      undefined,
      !firstMutation,
    );
    requireEvidence(
      observedControls.sha256 === baseline.sha256 && observedControls.freshUntil === baseline.freshUntil,
      'CURRENT_BASELINE_CHANGED',
    );
    const deployed = await load(`${root}/deployment-receipt.json`);
    requireEvidence(
      sha(deployed) === manifest.bindings.deployment.receiptSha256 &&
        ['appOrigin', 'sourceRevision', 'dropletGuid', 'artifactSha256', 'observedAt'].every(
          (key) => deployed[key] === manifest.bindings.deployment[key],
        ),
      'CURRENT_DEPLOYMENT_RECEIPT_CHANGED',
    );
  };
  const finalCheck = (dispatch = true) => {
    if (retained)
      (currentDependencies.retainedSendProof ?? verifyRetainedSend)({ root, run, manifest, baseline, config });
    requireEvidence(!signal?.aborted && Date.now() < deadline, 'CURRENT_STOP_OR_DEADLINE');
    if (mutating && !firstMutation) {
      requireEvidence(Date.now() < baseline.freshUntil, 'CURRENT_BASELINE_EXPIRED');
      // Conservative dispatch intent: a transport failure is uncertain, never an authorization to replay.
      if (dispatch) firstMutation = true;
    }
  };
  const policy = { beforeRequest: proof, beforeSend: finalCheck, deadline, signal };
  const save = () => write(`${root}/current-workflow-result.json`, journal);
  const receipt = (label) => async (method, response) => {
    if (!claimed) return;
    await write(
      `${root}/current-rpc-${randomUUID()}.json`,
      {
        runId: run.runId,
        phase,
        actor: label,
        method,
        at: new Date().toISOString(),
        ...responseReceipt(response, Object.values(tokens)),
      },
      true,
    );
  };
  const start = async (label, route, token) => {
    const client = new McpSession(new URL(route, baseUrl), token, record, label, true, receipt(label), policy);
    const result = await client.initialize();
    requireEvidence(result.status === 200 && result.json?.result?.protocolVersion, 'CURRENT_INITIALIZE_FAILED');
    return client;
  };
  const call = async (client, tool, args, { mutation = false, expectError, allowError = false } = {}) => {
    mutating = mutation;
    if (mutation) {
      journal.operations.push({ phase, tool, args, startedAt: new Date().toISOString(), outcome: 'unconfirmed' });
      await save();
    }
    const response = await client.request('tools/call', { name: tool, arguments: args });
    const parsed = readToolBody(response);
    requireEvidence(response.status === 200 && parsed.result && !response.json?.error, 'CURRENT_RPC_RESULT_INVALID');
    if (mutation) {
      Object.assign(journal.operations.at(-1), {
        result: parsed.body ?? parsed.text,
        isError: parsed.result.isError === true,
        receivedAt: new Date().toISOString(),
        outcome: 'response-received',
      });
      await save();
    }
    if (expectError)
      requireEvidence(
        parsed.result.isError === true && parsed.body?.error === expectError,
        'CURRENT_EXPECTED_DENIAL_MISSING',
      );
    else if (!allowError) requireEvidence(parsed.result.isError !== true, 'CURRENT_TOOL_REFUSED');
    mutating = false;
    return parsed;
  };
  const key = (f) => ({ type: f.type, name: f.name });
  const transport = (f) => (f.actor === 'writerA' ? { transport: manifest.bindings.recording.task } : {});
  const editable = async (f, include) => {
    const value = (
      await call(clients[f.actor], 'SAPRead', { ...key(f), format: 'editable', ...(include ? { include } : {}) })
    ).body;
    requireEvidence(
      typeof value?.source === 'string' && value.sourceHash === sha(value.source) && value.source.length <= 65536,
      'CURRENT_EDITABLE_HASH_INVALID',
    );
    return value;
  };
  const writeSource = async (f, args) => {
    const value = (
      await call(clients[f.actor], 'SAPWrite', { ...key(f), ...transport(f), ...args }, { mutation: true })
    ).body;
    requireEvidence(
      value?.state === 'saved-inactive' &&
        value.target === target &&
        value.name === f.name &&
        value.type === f.type &&
        (f.actor !== 'writerA' || value.transport === manifest.bindings.recording.request),
      'CURRENT_SAVE_NOT_CONFIRMED',
    );
    const current = await editable(f, args.include);
    requireEvidence(current.sourceHash === value.sourceHash, 'CURRENT_SAVE_READBACK_MISMATCH');
    return current;
  };
  const observe = async (mode, f) => {
    await proof();
    finalCheck();
    const result = await native(mode, f?.name ?? 'all');
    requireEvidence(
      result.status === 'complete' &&
        result.manifestSha256 === manifestSha256 &&
        result.runId === run.runId &&
        result.sourceRevision === run.sourceRevision,
      'CURRENT_NATIVE_RECEIPT_MISMATCH',
    );
    await proof();
    finalCheck();
    return result;
  };
  try {
    for (const actor of actors) {
      const token = sessions.get(actor.label)?.token?.access_token;
      requireEvidence(typeof token === 'string', 'CURRENT_THREE_FRESH_SESSIONS_REQUIRED');
      tokens[actor.label] = token;
      const verified = await verifyUser(token),
        context = await service.createSecurityContext(token);
      const scopes =
        actor.label === 'writerA' ? ['read', 'write', 'transports'] : actor.write ? ['read', 'write'] : ['read'];
      requireEvidence(
        equalSet(verified.scopes, scopes) &&
          context.getEmail() === actor.email &&
          context.getOrigin() === 'sap.custom' &&
          scopes.every((scope) => context.checkLocalScope(scope)),
        'CURRENT_ACTOR_OR_SCOPE_MISMATCH',
      );
      const attributes = verified.extra?.xsuaaUserAttributes;
      requireEvidence(
        equalSet(attributes?.arc1_write_targets ?? [], [target, 'A4H/001']) &&
          [target, 'A4H/001'].every((t) => (attributes?.arc1_targets ?? []).some((g) => g === t || g === '*')),
        'CURRENT_TARGET_GRANTS_MISMATCH',
      );
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      requireEvidence(
        Number.isFinite(claims.iat) &&
          claims.iat * 1000 >= Date.parse(run.preparedAt) - 1000 &&
          Number.isFinite(claims.exp) &&
          claims.exp * 1000 > deadline + 30000,
        'CURRENT_FRESH_LOGIN_REQUIRED',
      );
      verifiedActors.push({
        label: actor.label,
        email: actor.email,
        sapUser: actor.sapUser,
        identityAndScopesVerified: true,
      });
    }
    await proof();
    finalCheck();
    journal = {
      plan,
      ...(retained ? { retained: profile.descriptor } : {}),
      runId: run.runId,
      sourceRevision: run.sourceRevision,
      harnessSha256: run.harnessSha256,
      manifestSha256,
      baselineSha256: baseline.sha256,
      verifiedActors,
      startedAt: new Date().toISOString(),
      failure: true,
      operations: [],
      assertions,
      fixtures: manifest.fixtures.map((f, index) => ({
        ...key(f),
        actor: f.actor,
        attempted: retained && index < profile.count,
        deleted: false,
        ...(retained && index < profile.count
          ? { retainedFrom: history.origins?.[f.name] ?? profile.descriptor.originalRunId }
          : {}),
      })),
      outstanding: [
        'Independent fresh post-run SM12 controls and operator audit',
        'Basic destination hidden-call evidence (no Basic route is configured by this plan)',
        'Other accepted PR2 workflow groups and CTS management/release remain separate',
      ],
    };
    await write(
      `${root}/current-workflow-claim.json`,
      { plan, runId: run.runId, manifestSha256, claimedAt: journal.startedAt },
      true,
    );
    claimed = true;
    await save();
    if (retained) {
      phase = 'retained-fresh-native-prerequisites';
      for (const f of manifest.fixtures.slice(0, profile.count)) {
        const observed = await observe('identity', f);
        const entry = journal.fixtures.find((e) => e.name === f.name);
        entry.nativeIdentity = profile.assertObservation(history, f, observed, { journal, run, manifest });
        entry.sourceHash = entry.nativeIdentity.sourceHash;
        if (entry.nativeIdentity.testSourceHash) entry.testSourceHash = entry.nativeIdentity.testSourceHash;
        await save();
      }
      if (!profile.textOnly) {
        const f = manifest.fixtures[3],
          absent = await observe('absence', f);
        requireEvidence(
          absent.fixtures.length === 1 &&
            absent.fixtures[0].name === f.name &&
            absent.fixtures[0].type === f.type &&
            absent.fixtures[0].absent === true,
          'RETAINED_PROGRAM_NOT_ABSENT',
        );
      }
    } else {
      const preflight = await observe('preflight');
      requireEvidence(
        preflight.fixtures.length === 4 &&
          manifest.fixtures.every((f) =>
            preflight.fixtures.some((r) => r.name === f.name && r.type === f.type && r.absent === true),
          ),
        'CURRENT_PREFLIGHT_NOT_ABSENT',
      );
    }
    for (const actor of actors) {
      clients[actor.label] = await start(actor.label, `/${target}/mcp`, tokens[actor.label]);
      const listed = await clients[actor.label].request('tools/list');
      const tools = listed.json?.result?.tools;
      verifyCurrentCatalog(tools, actor, manifest);
    }
    verifyCurrentRecording(
      (await call(clients.writerA, 'SAPTransport', { action: 'get', id: manifest.bindings.recording.request })).body,
      manifest,
      retained ? manifest.fixtures.slice(0, profile.count).filter((f) => f.actor === 'writerA') : [],
    );
    for (const f of retained ? manifest.fixtures.slice(3) : manifest.fixtures) {
      const entry = journal.fixtures.find((e) => e.name === f.name),
        sources = currentFixtureSources(f, manifest.marker, manifest.fixtures);
      let current;
      if (profile?.textOnly) {
        phase = `retained-read-${f.name}`;
        current = await editable(f);
        requireEvidence(current.sourceHash === entry.sourceHash, 'TEXT_TAIL_PROGRAM_CHANGED');
      } else {
        phase = `create-${f.name}`;
        emit('qualification_phase', { phase });
        entry.attempted = true;
        await save();
        current = await writeSource(f, {
          action: 'create',
          package: f.package,
          description: 'PR1142 current PP owned workflow',
          source: sources.initial,
        });
        requireEvidence(normalize(current.source) === normalize(sources.initial), 'CURRENT_INITIAL_SOURCE_CHANGED');
        const firstHash = current.sourceHash;
        phase = `edit-${f.name}`;
        if (f.type === 'CLAS') {
          if (f.actor === 'writerA') {
            const definition = `CLASS ${f.name.toLowerCase()} DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\n    METHODS get_value RETURNING VALUE(rv_value) TYPE i.\n  PRIVATE SECTION.\n    CONSTANTS fixture_value TYPE i VALUE 2.\nENDCLASS.`;
            current = await writeSource(f, {
              action: 'edit_class_definition',
              source: definition,
              expectedSourceHash: current.sourceHash,
            });
          }
          current = await writeSource(f, {
            action: 'edit_method',
            method: 'get_value',
            source: f.actor === 'writerA' ? 'rv_value = fixture_value.' : 'rv_value = 2.',
            expectedSourceHash: current.sourceHash,
          });
          requireEvidence(
            current.source.includes(f.actor === 'writerA' ? 'rv_value = fixture_value.' : 'rv_value = 2.'),
            'CURRENT_METHOD_EDIT_MISSING',
          );
          if (f.actor === 'writerA') {
            const existing = await call(
              clients.writerA,
              'SAPRead',
              { ...key(f), include: 'testclasses', format: 'editable' },
              { allowError: true },
            );
            let hash;
            if (existing.result.isError !== true) {
              requireEvidence(
                typeof existing.body?.source === 'string' && existing.body.sourceHash === sha(existing.body.source),
                'CURRENT_INCLUDE_PRECONDITION_INVALID',
              );
              hash = existing.body.sourceHash;
            }
            const include = await writeSource(f, {
              action: 'update',
              include: 'testclasses',
              source: sources.tests,
              ...(hash ? { expectedSourceHash: hash } : {}),
            });
            requireEvidence(normalize(include.source) === normalize(sources.tests), 'CURRENT_TEST_SOURCE_CHANGED');
            entry.testSourceHash = include.sourceHash;
          }
        } else {
          current = await writeSource(f, {
            action: 'update',
            source: sources.updated,
            expectedSourceHash: current.sourceHash,
          });
          requireEvidence(normalize(current.source) === normalize(sources.updated), 'CURRENT_UPDATED_SOURCE_CHANGED');
        }
        phase = `stale-${f.name}`;
        await call(
          clients[f.actor],
          'SAPWrite',
          { ...key(f), ...transport(f), action: 'update', source: sources.initial, expectedSourceHash: firstHash },
          { mutation: true, expectError: 'PINNED_WRITE_REFUSED' },
        );
        requireEvidence((await editable(f)).sourceHash === current.sourceHash, 'CURRENT_STALE_REFUSAL_CHANGED_SOURCE');
        phase = `activate-${f.name}`;
        const activated = (await call(clients[f.actor], 'SAPActivate', key(f), { mutation: true })).body;
        requireEvidence(activated?.success === true, 'CURRENT_ACTIVATION_UNCONFIRMED');
      }
      if (f.type === 'PROG') {
        phase = `text-${f.name}`;
        const result = (
          await call(
            clients.writerA,
            'SAPWrite',
            { ...key(f), ...transport(f), action: 'edit_text_symbols', textPart: 'symbols', source: sources.symbols },
            { mutation: true },
          )
        ).body;
        requireEvidence(
          result?.state === 'text-saved-active' &&
            result.activePartVerified === true &&
            result.transport === manifest.bindings.recording.request,
          'CURRENT_TEXT_ACTIVE_NOT_CONFIRMED',
        );
        const read = await call(clients.writerA, 'SAPRead', {
          type: 'TEXT_ELEMENTS',
          objectType: 'PROG',
          name: f.name,
          include: 'symbols',
        });
        requireEvidence(currentSymbolsMatch(read.text, sources.symbols), 'CURRENT_TEXT_READBACK_MISSING');
        entry.textReadbackHash = sha(read.text);
        entry.textSource = sources.symbols;
      }
      const observed = (await observe('identity', f)).fixtures[0];
      requireEvidence(
        observed.sourceHash === current.sourceHash &&
          (!entry.testSourceHash || observed.testSourceHash === entry.testSourceHash),
        'CURRENT_NATIVE_PP_SOURCE_MISMATCH',
      );
      if (f.type === 'PROG' && profile?.textOnly) {
        requireEvidence(
          observed.textPool?.parts?.symbols === entry.textReadbackHash &&
            ['selections', 'headings'].every(
              (part) => observed.textPool.parts[part] === entry.nativeIdentity.textPool.parts[part],
            ),
          'TEXT_TAIL_UNSELECTED_PART_CHANGED',
        );
      }
      entry.sourceHash = current.sourceHash;
      entry.nativeIdentity = observed;
      await save();
    }
    const sentinel = manifest.fixtures[0],
      sentinelState = journal.fixtures[0];
    for (const [label, route, token, extra] of [
      ['reader', `/${target}/mcp`, tokens.readerA, {}],
      ['readonly-destination', '/A4H/001/mcp', tokens.writerA, {}],
      ['aggregate', '/multi/mcp', tokens.writerA, { target }],
      ['compatibility', '/authorize', tokens.writerA, { target }],
    ]) {
      phase = `deny-${label}`;
      const denied = await start(label, route, token),
        catalog = await denied.request('tools/list');
      requireEvidence(
        Array.isArray(catalog.json?.result?.tools) &&
          !catalog.json.result.tools.some((t) => ['SAPWrite', 'SAPActivate'].includes(t.name)),
        'CURRENT_NEGATIVE_CATALOG_EXPANDED',
      );
      const observed = await editable(sentinel);
      await call(
        denied,
        'SAPWrite',
        {
          ...key(sentinel),
          ...extra,
          action: 'update',
          source: observed.source,
          expectedSourceHash: observed.sourceHash,
        },
        { mutation: true, expectError: 'MULTI_TARGET_OPERATION_FORBIDDEN' },
      );
      requireEvidence(
        (await editable(sentinel)).sourceHash === sentinelState.sourceHash,
        'CURRENT_NEGATIVE_CHANGED_SOURCE',
      );
    }
    verifyCurrentRecording(
      (await call(clients.writerA, 'SAPTransport', { action: 'get', id: manifest.bindings.recording.request })).body,
      manifest,
      manifest.fixtures.filter((f) => f.actor === 'writerA'),
    );
    // Reverse dependency order. Failure stops; a later operator must inspect and separately authorize recovery.
    for (const f of [...manifest.fixtures].reverse()) {
      phase = `delete-${f.name}`;
      emit('qualification_phase', { phase });
      const entry = journal.fixtures.find((e) => e.name === f.name);
      const observed = (await observe('identity', f)).fixtures[0];
      if (profile?.beforeDelete) profile.beforeDelete(history, f, observed, { journal, run, manifest });
      else
        requireEvidence(
          JSON.stringify(observed) === JSON.stringify(entry.nativeIdentity),
          'CURRENT_OWNER_CHANGED_BEFORE_DELETE',
        );
      const deleted = (
        await call(clients[f.actor], 'SAPWrite', { ...key(f), ...transport(f), action: 'delete' }, { mutation: true })
      ).body;
      requireEvidence(
        deleted?.state === 'deleted' && deleted.ok === true && deleted.cleanupFailed !== true,
        'CURRENT_DELETE_UNCONFIRMED',
      );
      entry.deletionAcknowledged = true;
      await save();
      const absence = await observe('absence', f);
      requireEvidence(absence.fixtures[0]?.absent === true, 'CURRENT_TYPED_ABSENCE_MISSING');
      if (profile?.retainAbsence) {
        requireEvidence(
          absence.mode === 'absence' && absence.fixtures.length === 1 &&
            absence.fixtures[0].name === f.name && absence.fixtures[0].type === f.type &&
            absence.fixtures[0].absence === 'ExceptionResourceNotFound',
          'CURRENT_TYPED_ABSENCE_MISSING',
        );
        entry.absenceEvidence = absence;
      }
      entry.deleted = true;
      await save();
    }
    const finalRecording = (
      await call(clients.writerA, 'SAPTransport', { action: 'get', id: manifest.bindings.recording.request })
    ).body;
    verifyCurrentRecording(finalRecording, manifest);
    journal.recordingEntriesAfterDeletion = [
      ...(finalRecording.requestObjects ?? []),
      ...finalRecording.tasks.flatMap((t) => t.objects),
    ].filter((o) => manifest.fixtures.some((f) => f.name === o.name));
    await proof();
    finalCheck();
    journal.failure = false;
  } catch (error) {
    if (!claimed) throw error;
    journal.error = safeFailure(error);
    journal.failedPhase = phase;
  } finally {
    if (claimed) {
      journal.firstMutationMayHaveBeenSubmitted = firstMutation;
      journal.finishedAt = new Date().toISOString();
      journal.remaining = journal.fixtures
        .filter((f) => f.attempted && !f.deleted)
        .map((f) => ({
          type: f.type,
          name: f.name,
          state: f.deletionAcknowledged
            ? 'server-confirmed-deleted; independent absence unavailable'
            : f.nativeIdentity
              ? 'last-observed-active; inspect current state'
              : f.retainedFrom
                ? 'retained owner; fresh verification incomplete'
                : 'mutation-unconfirmed; inspect current state',
        }));
      try {
        await proof();
        if (retained) finalCheck(false);
      } catch (error) {
        journal.failure = true;
        journal.terminalBindingError = safeFailure(error);
      }
      await save();
    }
  }
  return {
    plan,
    failure: journal.failure,
    remaining: journal.remaining,
    outstanding: journal.outstanding,
    qualifiedForMerge: false,
  };
}
