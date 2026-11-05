import { expect, vi } from 'vitest';
import {
  retainedDescriptor,
  retainedMarker,
  retainedPlan,
  retainedRoot,
} from '../../../scripts/qualification/pr1142/current-retained-history.mjs';
import {
  currentApp,
  currentFixtureSources,
  currentPlan,
  makeCurrentManifest,
  sha,
} from '../../../scripts/qualification/pr1142/current-workflow-contract.mjs';
import { SAPActivateSchema, SAPReadSchema, SAPTransportSchema, SAPWriteSchema } from '../../../src/handlers/schemas.js';
import { currentPpCatalog } from '../../helpers/current-pp-catalog.js';

const schemas: Record<string, any> = {
  SAPWrite: SAPWriteSchema,
  SAPActivate: SAPActivateSchema,
  SAPRead: SAPReadSchema,
  SAPTransport: SAPTransportSchema,
};
export function fixture() {
  const now = Date.now();
  const config = {
    root: '/private/current-test',
    target: 'PR1142/001',
    actors: [
      { label: 'writerA', email: 'primary@example.invalid', sapUser: 'PRIMARY', letter: 'A', write: true },
      { label: 'writerB', email: 'secondary@example.invalid', sapUser: 'SECONDARY', letter: 'B', write: true },
      { label: 'readerA', email: 'primary@example.invalid', sapUser: 'PRIMARY', letter: 'A', write: false },
    ],
  };
  const run: {
    plan: string;
    runId: string;
    sourceRevision: string;
    harnessSha256: string;
    preparedAt: string;
    retained?: unknown;
  } = {
    plan: currentPlan,
    runId: 'fixed-test-run',
    sourceRevision: 'a'.repeat(40),
    harnessSha256: 'b'.repeat(64),
    preparedAt: new Date(now - 1000).toISOString(),
  };
  const deployment = {
    appOrigin: currentApp,
    sourceRevision: run.sourceRevision,
    dropletGuid: '00000000-0000-4000-8000-000000000000',
    artifactSha256: 'c'.repeat(64),
    observedAt: new Date(now - 2000).toISOString(),
  };
  const bindings = {
    version: 1,
    deployment: { ...deployment, receiptSha256: sha(deployment) },
    recording: { package: 'ZARC1_PP', request: 'A4HK900001', task: 'A4HK900002', owner: 'PRIMARY' },
  };
  const manifest = makeCurrentManifest('1234567890ABCDEF1234567890ABCDEF', bindings, config);
  const files = new Map<string, any>([
    ['fixture-manifest.json', manifest],
    ['deployment-receipt.json', deployment],
  ]);
  const sources = new Map<string, any>(),
    calls: any[] = [],
    attempts: any[] = [];
  const scopes: Record<string, string[]> = {
    writerA: ['read', 'write', 'transports'],
    writerB: ['read', 'write'],
    readerA: ['read'],
  };
  const tokens = new Map(
    config.actors.map((a) => [
      a.label,
      `test.${Buffer.from(JSON.stringify({ label: a.label, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600 })).toString('base64url')}.signature`,
    ]),
  );
  const sessions = new Map([...tokens].map(([label, token]) => [label, { token: { access_token: token } }]));
  const actorFor = (token: string) => [...tokens].find(([, value]) => value === token)![0];
  const request: any = {
    id: bindings.recording.request,
    owner: 'PRIMARY',
    type: 'K',
    status: 'D',
    tasks: [{ id: bindings.recording.task, owner: 'PRIMARY', status: 'D', objects: [] }],
  };
  const changed = {
    refuseAt: '',
    acceptStale: false,
    driftAfter: '',
    driftOnRead: false,
    nativeAbsentFail: false,
    driftNative: false,
    catalogMutation: (_tools: any[], _label: string) => {},
  };
  const fileKey = (path: string) => path.split('/').at(-1)!;
  const native = vi.fn(async (mode: string, name: string) => {
    if (mode === 'absence' && changed.nativeAbsentFail) throw new Error('native unavailable');
    return {
      status: 'complete',
      runId: run.runId,
      sourceRevision: run.sourceRevision,
      manifestSha256: sha(manifest),
      fixtures: (mode === 'preflight' ? manifest.fixtures : manifest.fixtures.filter((f: any) => f.name === name)).map(
        (f: any) => {
          if (mode !== 'identity') return { name: f.name, type: f.type, absent: !sources.has(f.name) };
          const saved = sources.get(f.name);
          return {
            name: f.name,
            type: f.type,
            identity: {
              createdBy: config.actors.find((a) => a.label === f.actor)!.sapUser,
              package: f.package,
              version: 'active',
            },
            sourceHash: sha(saved.source),
            metadataHash: changed.driftNative ? 'changed' : 'same',
            ...(saved.tests ? { testSourceHash: sha(saved.tests) } : {}),
          };
        },
      ),
    };
  });
  const fetch = vi.fn(async (url: any, init: any) => {
    expect(new URL(url).hostname).toBe('current-pp.invalid');
    const rpc = JSON.parse(init.body),
      label = actorFor(init.headers.Authorization.slice(7));
    const route = new URL(url).pathname;
    const allowed = route === '/PR1142/001/mcp' && label !== 'readerA';
    let result: any;
    const body = (value: any, isError = false, raw = false) => ({
      content: [{ type: 'text', text: raw ? value : JSON.stringify(value) }],
      ...(isError ? { isError } : {}),
    });
    if (rpc.method === 'initialize')
      result = { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'mock', version: '1' } };
    else if (rpc.method === 'notifications/initialized')
      return new Response('', { status: 202, headers: { 'cache-control': 'private, no-store' } });
    else if (rpc.method === 'tools/list') {
      const { tools } = currentPpCatalog(scopes[label], { destinationWrites: route === '/PR1142/001/mcp' });
      changed.catalogMutation(tools, label);
      result = { tools };
    } else {
      expect(rpc.method).toBe('tools/call');
      const { name: tool, arguments: args } = rpc.params;
      if (allowed || tool !== 'SAPWrite')
        expect(schemas[tool].safeParse(args).success, JSON.stringify(args)).toBe(true);
      calls.push({ tool, args, label, route });
      const entry = sources.get(args.name);
      if (tool === 'SAPWrite' && !allowed) result = body({ error: 'MULTI_TARGET_OPERATION_FORBIDDEN' }, true);
      else if (tool === 'SAPRead') {
        if (args.type === 'TEXT_ELEMENTS') result = body(entry.symbols, false, true);
        else if (args.include && !entry.tests) result = body({ error: 'NOT_FOUND' }, true);
        else {
          const source = args.include ? entry.tests : entry.source;
          result = body({ source, sourceHash: sha(source) });
        }
      } else if (tool === 'SAPTransport') result = body(request);
      else if (tool === 'SAPActivate') result = body({ success: true });
      else {
        attempts.push(args);
        if (changed.refuseAt && args.name.includes(changed.refuseAt))
          result = body({ error: 'PINNED_WRITE_REFUSED', state: 'unchanged' }, true);
        else if (
          args.action !== 'create' &&
          args.expectedSourceHash &&
          args.expectedSourceHash !== sha(args.include ? entry.tests : entry.source) &&
          !changed.acceptStale
        )
          result = body({ error: 'PINNED_WRITE_REFUSED', state: 'unchanged' }, true);
        else if (args.action === 'delete') {
          sources.delete(args.name);
          result = body({ ok: true, state: 'deleted' });
        } else if (args.action === 'edit_text_symbols') {
          entry.symbols = args.source;
          result = body({ state: 'text-saved-active', activePartVerified: true, transport: request.id });
        } else {
          if (args.action === 'create') {
            sources.set(args.name, { source: args.source });
            if (label === 'writerA')
              request.tasks[0].objects.push({
                pgmid: 'R3TR',
                type: args.type === 'INCL' ? 'PROG' : args.type,
                name: args.name,
              });
          } else if (args.include) entry.tests = args.source;
          else if (args.action === 'edit_method')
            entry.source = entry.source.replace(
              /(METHOD get_value\.\s*)[\s\S]*?(\s*ENDMETHOD\.)/,
              `$1${args.source}$2`,
            );
          else if (args.action === 'edit_class_definition')
            entry.source = entry.source.replace(/CLASS [\s\S]*?ENDCLASS\./, args.source);
          else entry.source = args.source;
          const saved = sources.get(args.name);
          result = body({
            state: 'saved-inactive',
            target: config.target,
            type: args.type,
            name: args.name,
            sourceHash: sha(args.include ? saved.tests : saved.source),
            ...(label === 'writerA' ? { transport: request.id } : {}),
          });
        }
        if (changed.driftAfter === args.action) changed.driftOnRead = true;
      }
    }
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
    });
  });
  vi.stubGlobal('fetch', fetch);
  // Fixed real runner authority, synthetic transport origin. Production obtains a normal URL from the CLI parser.
  const baseUrl = new URL('https://current-pp.invalid');
  Object.defineProperty(baseUrl, 'origin', { value: currentApp });
  const context: any = {
    action: { command: 'qualify', plan: currentPlan },
    sessions,
    baseUrl,
    emit: vi.fn(),
    verifyUser: async (token: string) => ({
      scopes: scopes[actorFor(token)],
      extra: { xsuaaUserAttributes: { arc1_write_targets: ['PR1142/001', 'A4H/001'], arc1_targets: ['*'] } },
    }),
    service: {
      createSecurityContext: async (token: string) => {
        const label = actorFor(token),
          actor = config.actors.find((a) => a.label === label)!;
        return {
          getEmail: () => actor.email,
          getOrigin: () => 'sap.custom',
          checkLocalScope: (s: string) => scopes[label].includes(s),
        };
      },
    },
    currentDependencies: {
      configuration: config,
      verify: async () => ({ ...run, ...(changed.driftOnRead ? { sourceRevision: 'd'.repeat(40) } : {}) }),
      load: async (path: string) => structuredClone(files.get(fileKey(path))),
      write: async (path: string, data: any, exclusive: boolean) => {
        const key = fileKey(path);
        if (exclusive && files.has(key)) throw new Error('EEXIST');
        files.set(key, structuredClone(data));
      },
      native,
      controls: async () => ({ sha256: 'f'.repeat(64), freshUntil: now + 300_000 }),
    },
  };
  return {
    context,
    config,
    manifest,
    run,
    files,
    calls,
    attempts,
    sources,
    scopes,
    request,
    changed,
    native,
    fetch,
    result: () => files.get('current-workflow-result.json'),
  };
}
export async function retainedFixture() {
  const f = fixture();
  f.config.root = retainedRoot;
  Object.assign(f.run, { retained: retainedDescriptor });
  Object.assign(f.manifest, makeCurrentManifest(retainedMarker, f.manifest.bindings, f.config));
  f.context.action.plan = retainedPlan;
  const history: any = { manifest: structuredClone(f.manifest), expected: {}, proofs: {} };
  for (const owner of f.manifest.fixtures.slice(0, 3)) {
    const source = currentFixtureSources(owner, f.manifest.marker, f.manifest.fixtures);
    f.sources.set(owner.name, {
      source: source.updated ?? source.initial.replace('rv_value = 1.', 'rv_value = 2.'),
      ...(owner.type === 'CLAS' && owner.actor === 'writerA' ? { tests: source.tests } : {}),
    });
    if (owner.actor === 'writerA')
      f.request.tasks[0].objects.push({
        pgmid: 'R3TR',
        type: owner.type === 'INCL' ? 'PROG' : owner.type,
        name: owner.name,
      });
    if (owner.type === 'INCL')
      history.proofs[owner.name] = {
        kind: 'verified-pp-create',
        runId: retainedDescriptor.originalRunId,
        sourceRevision: retainedDescriptor.originalSourceRevision,
        actor: owner.actor,
        name: owner.name,
        type: owner.type,
        createReceiptHash: 'a'.repeat(64),
      };
  }
  const original = f.native.getMockImplementation()!;
  f.native.mockImplementation(async (mode: string, name: string) => {
    const observed: any = await original(mode, name);
    for (const value of observed.fixtures)
      if (mode === 'identity' && value.type === 'INCL') {
        value.identity.createdBy = null;
        value.nativeCreatorEvidence = 'unavailable';
        value.ownedCreate = history.proofs[value.name];
      }
    return observed;
  });
  for (const owner of f.manifest.fixtures.slice(0, 3))
    history.expected[owner.name] = structuredClone((await f.native('identity', owner.name)).fixtures[0]);
  f.native.mockClear();
  f.context.currentDependencies.retainedHistory = vi.fn(() => history);
  f.context.currentDependencies.retainedSendProof = vi.fn();
  return { ...f, history };
}
