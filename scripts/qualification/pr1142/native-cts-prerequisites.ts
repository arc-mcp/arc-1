/** Private local phase/whole-journal bindings and fresh actual JPEG controls. No native imports. */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  CTS_RESERVED,
  CTS_RETAINED_SUFFIX,
  CTS_ROUNDS,
  type CtsProfile,
  type CtsRound,
  type CtsRoundResult,
  ctsFixtures,
  ctsOrigin,
  ctsProtocol,
  ctsSteps,
} from './native-cts-fixtures.js';
import { type DeclarativeBinding, PREREQUISITE_AGE_MS, privateEvidence } from './native-declarative-prerequisites.js';
import { jpegEvidenceSignature } from './native-declarative-v3-evidence.js';
import { privateDirectory } from './native-lock-binding.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/),
  revision = z.string().regex(/^[a-f0-9]{40}$/),
  date = z.iso.datetime();
export function readCtsIntent(binding: DeclarativeBinding, profile: CtsProfile = 'original') {
  const protocol = ctsProtocol(profile),
    origin = ctsOrigin(profile);
  privateDirectory(binding.root);
  const path = join(binding.root, 'intent.json'),
    file = privateEvidence(path);
  const value = z
    .object({
      protocol: z.literal(protocol),
      origin: z.unknown().optional(),
      createdAt: date,
      binding: z.unknown(),
      suffix: z.string().regex(/^[A-F0-9]{16}$/),
      graph: z.unknown(),
      identity: z.literal('MARIAN'),
      target: z.literal('A4H/001'),
      authentication: z.literal('Basic-native-contract-only'),
    })
    .strict()
    .parse(JSON.parse(file.body.toString()));
  const graph = ctsFixtures(value.suffix);
  if (
    (profile !== 'original' && value.suffix !== CTS_RETAINED_SUFFIX) ||
    JSON.stringify(value.origin) !== JSON.stringify(origin) ||
    JSON.stringify(value.binding) !== JSON.stringify(binding.evidence) ||
    JSON.stringify(value.graph) !== JSON.stringify(graph)
  )
    throw new Error('CTS intent binding changed.');
  return {
    protocol,
    profile,
    origin,
    graph,
    hash: file.sha256,
    createdAt: Date.parse(value.createdAt),
    verify: () => {
      if (privateEvidence(path).sha256 !== file.sha256) throw new Error('CTS intent changed.');
    },
  };
}
export function ctsJournalBinding(root: string) {
  privateDirectory(root);
  const names = readdirSync(root).sort();
  if (names.length > 1000 || names.some((n, i) => n !== `${String(i + 1).padStart(5, '0')}.json`))
    throw new Error('Bounded native journal required.');
  let bytes = 0;
  return names.map((name) => {
    const file = privateEvidence(join(root, name), 2 * 1024 * 1024);
    bytes += file.body.length;
    if (bytes > 16 * 1024 * 1024) throw new Error('Native journal exceeds 16 MiB.');
    return { name, sha256: file.sha256 };
  });
}
export function readCtsHistory(binding: DeclarativeBinding, intent: ReturnType<typeof readCtsIntent>, round: CtsRound) {
  const captured: { path: string; sha256: string; limit: number }[] = [],
    past = CTS_ROUNDS.slice(0, CTS_ROUNDS.indexOf(round));
  const directoryBindings: { path: string; names: string[] }[] = [];
  let prior: CtsRoundResult | undefined;
  for (const previous of past) {
    const dir = join(binding.root, previous, 'attempt');
    privateDirectory(join(binding.root, previous));
    privateDirectory(dir);
    const manifestPath = join(dir, 'manifest.json'),
      manifestFile = privateEvidence(manifestPath, 256 * 1024);
    const manifest = JSON.parse(manifestFile.body.toString());
    if (
      manifest.protocol !== intent.protocol ||
      JSON.stringify(manifest.origin) !== JSON.stringify(intent.origin) ||
      manifest.round !== previous ||
      manifest.intentHash !== intent.hash ||
      JSON.stringify(manifest.binding) !== JSON.stringify(binding.evidence) ||
      !/^[A-F0-9]{16}$/.test(manifest.preflightId) ||
      JSON.stringify(manifest.steps) !== JSON.stringify(ctsSteps(previous, intent.profile)) ||
      !Array.isArray(manifest.prerequisites)
    )
      throw new Error('Historical source/runtime/phase manifest changed.');
    const nativePreflight = join(binding.root, previous, 'preflight', manifest.preflightId);
    privateDirectory(join(binding.root, previous, 'preflight'));
    privateDirectory(nativePreflight);
    const names = new Set<string>();
    for (const receipt of manifest.prerequisites) {
      if (
        typeof receipt.path !== 'string' ||
        (!['result.json', 'sm12-baseline.json', 'sm12-user.jpg', 'sm12-suffix.jpg'].includes(receipt.path) &&
          !/^run\/\d{5}\.json$/.test(receipt.path)) ||
        names.has(receipt.path) ||
        !/^[a-f0-9]{64}$/.test(receipt.sha256)
      )
        throw new Error('Historical prerequisite path/hash refused.');
      names.add(receipt.path);
      const path = join(nativePreflight, receipt.path),
        limit = receipt.path.endsWith('.jpg') ? 8 * 1024 * 1024 : 2 * 1024 * 1024;
      if (privateEvidence(path, limit).sha256 !== receipt.sha256)
        throw new Error('Consumed native prerequisite changed.');
      captured.push({ path, sha256: receipt.sha256, limit });
    }
    if (
      names.size > 1004 ||
      ['result.json', 'sm12-baseline.json', 'sm12-user.jpg', 'sm12-suffix.jpg'].some((name) => !names.has(name))
    )
      throw new Error('Incomplete historical controls.');
    const preflightRun = join(nativePreflight, 'run'),
      preflightRows = ctsJournalBinding(preflightRun);
    if (
      preflightRows.some((row) => !names.has(`run/${row.name}`)) ||
      [...names].filter((name) => name.startsWith('run/')).length !== preflightRows.length
    )
      throw new Error('Consumed preflight journal changed.');
    directoryBindings.push({ path: preflightRun, names: preflightRows.map((row) => row.name) });
    captured.push({ path: manifestPath, sha256: manifestFile.sha256, limit: 256 * 1024 });
    const path = join(dir, 'result.json'),
      file = privateEvidence(path, 256 * 1024),
      data = JSON.parse(file.body.toString()) as CtsRoundResult & {
        revision: string;
        intentHash: string;
        journal: { name: string; sha256: string }[];
      };
    if (
      data.protocol !== intent.protocol ||
      JSON.stringify(data.origin) !== JSON.stringify(intent.origin) ||
      data.round !== previous ||
      data.failure !== false ||
      data.revision !== binding.evidence.revision ||
      data.intentHash !== intent.hash ||
      JSON.stringify(data.completed) !== JSON.stringify(ctsSteps(previous, intent.profile)) ||
      data.remaining.length ||
      data.inspectionRequired.length ||
      data.unknownCreation ||
      data.cleanupUnconfirmed ||
      data.requests.length !== CTS_ROUNDS.indexOf(previous) + 1
    )
      throw new Error('Successful sealed previous CTS history required.');
    const ids: string[] = [];
    for (const [i, req] of data.requests.entries()) {
      if (
        req.round !== CTS_ROUNDS[i] ||
        req.description !== intent.graph.descriptions[req.round] ||
        !['Unclassified', 'Development/Correction'].includes(req.taskType)
      )
        throw new Error('Fixed historical request binding.');
      for (const id of [req.parent, req.task]) {
        if (
          !/^A4HK[0-9]{6}$/.test(id) ||
          (CTS_RESERVED as readonly string[]).includes(id) ||
          ids.includes(id) ||
          data.current[id] !== 'released' ||
          !data.confirmedReleased.includes(id)
        )
          throw new Error('Released exact historical membership required.');
        ids.push(id);
      }
    }
    if (intent.graph.classes.some((c) => data.current[c.owner] !== 'absent'))
      throw new Error('Historical class absence required.');
    const run = join(dir, 'run'),
      actual = ctsJournalBinding(run);
    if (JSON.stringify(data.journal) !== JSON.stringify(actual)) throw new Error('Historical native journal changed.');
    directoryBindings.push({ path: run, names: actual.map((row) => row.name) });
    captured.push(
      { path, sha256: file.sha256, limit: 256 * 1024 },
      ...actual.map((f) => ({ path: join(run, f.name), sha256: f.sha256, limit: 2 * 1024 * 1024 })),
    );
    prior = data;
  }
  return {
    prior,
    receipts: captured.map((r) => ({ path: r.path.slice(binding.root.length + 1), sha256: r.sha256 })),
    verify: () => {
      for (const dir of directoryBindings) {
        privateDirectory(dir.path);
        if (JSON.stringify(readdirSync(dir.path).sort()) !== JSON.stringify(dir.names))
          throw new Error('Historical journal membership changed.');
      }
      for (const f of captured)
        if (privateEvidence(f.path, f.limit).sha256 !== f.sha256) throw new Error('Prior CTS evidence changed.');
    },
  };
}
const search = z
  .object({
    observedAt: date,
    client: z.literal('001'),
    user: z.string(),
    table: z.literal('*'),
    argument: z.string(),
    lockCount: z.literal(0),
    evidenceSha256: hash,
  })
  .strict();
export function readCtsPrerequisites(
  binding: DeclarativeBinding,
  intent: ReturnType<typeof readCtsIntent>,
  round: CtsRound,
  sample: string,
  now: number,
) {
  if (!/^[A-F0-9]{16}$/.test(sample)) throw new Error('Fixed sample required.');
  const dir = join(binding.root, round, 'preflight', sample);
  privateDirectory(join(binding.root, round));
  privateDirectory(join(binding.root, round, 'preflight'));
  privateDirectory(dir);
  const captured: { path: string; sha256: string; limit: number }[] = [];
  let freshUntil = now + PREREQUISITE_AGE_MS;
  const read = (name: string, limit = 256 * 1024) => {
    const path = join(dir, name),
      file = privateEvidence(path, limit);
    captured.push({ path, sha256: file.sha256, limit });
    return file;
  };
  const fresh = (time: string) => {
    const t = Date.parse(time);
    if (!Number.isFinite(t) || t > now || t < intent.createdAt || now - t >= PREREQUISITE_AGE_MS)
      throw new Error('Fresh post-prepare controls required.');
    freshUntil = Math.min(freshUntil, t + PREREQUISITE_AGE_MS);
    return t;
  };
  const preflight = z
    .object({
      protocol: z.literal(intent.protocol),
      origin: z.unknown().optional(),
      round: z.enum(CTS_ROUNDS),
      revision,
      intentHash: hash,
      startedAt: date,
      completedAt: date,
      failure: z.literal(false),
      mutationAttempted: z.literal(false),
      packageMetadataHash: hash,
      history: z.unknown(),
      journal: z.array(z.object({ name: z.string(), sha256: hash }).strict()),
    })
    .strict()
    .parse(JSON.parse(read('result.json').body.toString()));
  const history = readCtsHistory(binding, intent, round),
    completed = fresh(preflight.completedAt);
  if (
    fresh(preflight.startedAt) > completed ||
    preflight.round !== round ||
    preflight.revision !== binding.evidence.revision ||
    preflight.intentHash !== intent.hash ||
    JSON.stringify(preflight.origin) !== JSON.stringify(intent.origin) ||
    JSON.stringify(preflight.history) !== JSON.stringify(history.receipts)
  )
    throw new Error('Preflight binding mismatch.');
  const actual = ctsJournalBinding(join(dir, 'run'));
  if (JSON.stringify(actual) !== JSON.stringify(preflight.journal)) throw new Error('Preflight journal mismatch.');
  for (const row of actual) read(`run/${row.name}`, 2 * 1024 * 1024);
  const baseline = z
    .object({
      protocol: z.literal(intent.protocol),
      round: z.enum(CTS_ROUNDS),
      revision,
      intentHash: hash,
      preflightId: z.string(),
      suffixSearch: search,
      userSearch: search,
    })
    .strict()
    .parse(JSON.parse(read('sm12-baseline.json').body.toString()));
  if (
    baseline.round !== round ||
    baseline.revision !== binding.evidence.revision ||
    baseline.intentHash !== intent.hash ||
    baseline.preflightId !== sample ||
    baseline.suffixSearch.user !== '*' ||
    baseline.suffixSearch.argument !== `*${intent.graph.suffix}*` ||
    baseline.userSearch.user !== 'MARIAN' ||
    baseline.userSearch.argument !== '*'
  )
    throw new Error('Exact SM12 controls required.');
  for (const [name, value] of [
    ['suffix', baseline.suffixSearch],
    ['user', baseline.userSearch],
  ] as const) {
    const file = read(`sm12-${name}.jpg`, 8 * 1024 * 1024);
    if (
      fresh(value.observedAt) < completed ||
      file.sha256 !== value.evidenceSha256 ||
      !jpegEvidenceSignature(file.body)
    )
      throw new Error('Actual fresh JPEG receipt required.');
  }
  return {
    freshUntil,
    history,
    packageMetadataHash: preflight.packageMetadataHash,
    receipts: captured.map((f) => ({ path: f.path.slice(dir.length + 1), sha256: f.sha256 })),
    verify: () => {
      history.verify();
      privateDirectory(join(dir, 'run'));
      if (JSON.stringify(readdirSync(join(dir, 'run')).sort()) !== JSON.stringify(actual.map((row) => row.name)))
        throw new Error('Preflight journal membership changed.');
      for (const f of captured)
        if (privateEvidence(f.path, f.limit).sha256 !== f.sha256) throw new Error('CTS prerequisites changed.');
    },
  };
}
