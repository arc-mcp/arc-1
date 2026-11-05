import { afterEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  config: {} as any,
  manifest: {} as any,
  run: {} as any,
  history: {} as any,
  journal: {} as any,
  metadata: '',
  source: '',
  writes: [] as any[],
  gets: [] as any[],
  queueChange: false,
}));
vi.mock('../../../scripts/qualification/pr1142/qualification-config.mjs', () => ({
  configuration: state.config,
  validateConfiguration: () => {},
}));
vi.mock('../../../scripts/qualification/pr1142/run-manifest.mjs', () => ({ verifyRunManifest: async () => state.run }));
vi.mock('../../../scripts/qualification/pr1142/current-text-tail-v2-history.mjs', async (original) => ({
  ...(await original<typeof import('../../../scripts/qualification/pr1142/current-text-tail-v2-history.mjs')>()),
  readFixedTextTailV2History: () => state.history,
}));
vi.mock('../../../scripts/qualification/pr1142/safe-io.mjs', async (original) => ({
  ...(await original<typeof import('../../../scripts/qualification/pr1142/safe-io.mjs')>()),
  privateJson: async (path: string) => {
    if (path.endsWith('/fixture-manifest.json')) return state.manifest;
    if (path.endsWith('/current-workflow-result.json')) return state.journal;
    throw new Error(`Unexpected private read ${path}`);
  },
}));
vi.mock('../../../scripts/qualification/pr1142/durable-journal.mjs', () => ({
  durable: async (path: string, value: unknown, exclusive: boolean) => {
    state.writes.push({ path, value: structuredClone(value), exclusive });
  },
}));
vi.mock('../../integration/helpers.js', () => ({
  getTestClient: () => ({
    username: 'MARIAN',
    sapClient: '001',
    safety: {},
    http: {
      get: async (path: string, headers: any, options: any) => {
        state.gets.push({ path, headers, options });
        if (state.queueChange) state.history.expected[state.manifest.fixtures[2].name].sourceHash = 'changed';
        return { statusCode: 200, body: path.includes('/source/main') ? state.source : state.metadata };
      },
    },
  }),
}));
vi.mock('../../../src/adt/transport.js', () => ({
  getTransport: async () => ({
    id: 'A4HK900001',
    owner: 'MARIAN',
    type: 'K',
    status: 'D',
    tasks: [
      {
        id: 'A4HK900002',
        owner: 'MARIAN',
        status: 'D',
        objects: [{ pgmid: 'R3TR', type: 'PROG', name: state.manifest.fixtures[2].name }],
      },
    ],
  }),
}));

import { retainedMarker } from '../../../scripts/qualification/pr1142/current-retained-history.mjs';
import {
  textTailV2Descriptor,
  textTailV2Root,
} from '../../../scripts/qualification/pr1142/current-text-tail-v2-history.mjs';
import {
  currentApp,
  makeCurrentManifest,
  sha,
} from '../../../scripts/qualification/pr1142/current-workflow-contract.mjs';

const oldArgv = process.argv;
afterEach(() => {
  process.argv = oldArgv;
  process.exitCode = undefined;
  vi.unstubAllEnvs();
});
function setup() {
  state.gets = [];
  state.writes = [];
  state.queueChange = false;
  Object.assign(state.config, {
    root: textTailV2Root,
    target: 'PR1142/001',
    actors: [
      { label: 'writerA', email: 'primary@example.invalid', sapUser: 'MARIAN', letter: 'A', write: true },
      { label: 'writerB', email: 'secondary@example.invalid', sapUser: 'ARC1_WG_RO', letter: 'B', write: true },
      { label: 'readerA', email: 'primary@example.invalid', sapUser: 'MARIAN', letter: 'A', write: false },
    ],
  });
  const deployment = {
    sourceRevision: 'a'.repeat(40),
    appOrigin: currentApp,
    dropletGuid: '00000000-0000-4000-8000-000000000000',
    artifactSha256: 'c'.repeat(64),
    observedAt: new Date().toISOString(),
  };
  state.manifest = makeCurrentManifest(
    retainedMarker,
    {
      version: 1,
      deployment: { ...deployment, receiptSha256: sha(deployment) },
      recording: { package: 'ZARC1_DEMO', request: 'A4HK900001', task: 'A4HK900002', owner: 'MARIAN' },
    },
    state.config,
  );
  state.run = {
    runId: 'new-run',
    sourceRevision: deployment.sourceRevision,
    harnessSha256: 'b'.repeat(64),
    retained: textTailV2Descriptor,
  };
  const include = state.manifest.fixtures[2],
    program = state.manifest.fixtures[3];
  state.source = `" ${retainedMarker}\nFORM test.\nENDFORM.\n`;
  state.metadata = `<include:abapInclude xmlns:include="http://www.sap.com/adt/programs/includes" xmlns:adtcore="http://www.sap.com/adt/core" include:contextRefCount="1" adtcore:name="${include.name}" adtcore:type="PROG/I" adtcore:version="active" adtcore:changedBy="MARIAN" adtcore:createdAt="2026-11-03T00:00:00Z" adtcore:masterSystem="A4H"><adtcore:packageRef adtcore:name="ZARC1_DEMO"/><include:contextRef adtcore:name="${program.name}"/></include:abapInclude>`;
  state.history = {
    manifest: state.manifest,
    includeRelationship: {
      include: include.name,
      program: program.name,
      withProgramHash: sha(state.metadata),
      withoutProgramHash: 'without',
    },
    expected: {
      [include.name]: {
        name: include.name,
        type: 'INCL',
        sourceHash: sha(state.source),
        metadataHash: sha(state.metadata),
      },
    },
    proofs: {
      [include.name]: {
        kind: 'verified-pp-create',
        name: include.name,
        type: 'INCL',
        actor: 'writerA',
        sourceRevision: 'd'.repeat(40),
        createReceiptHash: 'e'.repeat(64),
      },
    },
  };
  state.journal = {
    runId: state.run.runId,
    sourceRevision: state.run.sourceRevision,
    harnessSha256: state.run.harnessSha256,
    manifestSha256: sha(state.manifest),
    operations: [],
    fixtures: state.manifest.fixtures.map((f: any) => ({ name: f.name, type: f.type, deleted: false })),
  };
  process.argv = [
    process.execPath,
    'offline-native-worker.mts',
    'identity',
    include.name,
    '00000000-0000-4000-8000-000000000000',
  ];
  vi.stubEnv('TEST_SAP_URL', state.manifest.nativeUrl);
  vi.stubEnv('TEST_SAP_CLIENT', '001');
  vi.stubEnv('TEST_SAP_INSECURE', 'false');
}
async function run() {
  vi.resetModules();
  await import('../../../scripts/qualification/pr1142/current-workflow-native.mjs');
  return state.writes.at(-1).value;
}
it('actual native-worker entry selects v2 profile and performs only fixed bounded GETs', async () => {
  setup();
  const r = await run();
  expect(r).toMatchObject({ status: 'complete', fixtures: [{ type: 'INCL', nativeCreatorEvidence: 'unavailable' }] });
  expect(state.gets).toHaveLength(4);
  expect(
    state.gets.every(
      (g) => g.options.noReplay && !g.options.retryTransientErrors && Number.isFinite(g.options.deadline),
    ),
  ).toBe(true);
  expect(state.writes.every((w) => w.exclusive)).toBe(true);
});
it.each(['source', 'owner', 'package', 'link', 'history'])(
  'actual native-worker refuses %s drift before returning a complete identity',
  async (kind) => {
    setup();
    if (kind === 'source') state.source += 'foreign';
    if (kind === 'owner')
      state.metadata = state.metadata.replace('adtcore:changedBy="MARIAN"', 'adtcore:changedBy="FOREIGN"');
    if (kind === 'package')
      state.metadata = state.metadata.replace('adtcore:name="ZARC1_DEMO"', 'adtcore:name="FOREIGN"');
    if (kind === 'link') state.metadata = state.metadata.replace('contextRefCount="1"', 'contextRefCount="0"');
    if (kind === 'history') state.queueChange = true;
    const r = await run();
    expect(r.status).toBe('failed');
    expect(process.exitCode).toBe(1);
    expect(r.fixtures).toBeUndefined();
    expect(state.writes.every((w) => !/credential|claim/.test(w.path))).toBe(true);
  },
);
