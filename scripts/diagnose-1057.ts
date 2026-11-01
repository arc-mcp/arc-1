/** Temporary research driver; this workflow and its helpers must not be merged into main. */
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { recordWhereUsed } from '../tests/helpers/where-used-diagnostics.js';
import {
  BASELINE,
  call,
  checkTarget,
  cleanupPair,
  MANIFEST,
  type Manifest,
  makeClient,
  PUBLIC_DIR,
  readManifest,
  recordDescriptions,
  recordError,
  snapshotIndex,
  withReadDeadline,
  writeJson,
} from '../tests/helpers/where-used-experiment.js';
import {
  assertOriginalTestOnly,
  ORIGINAL_TEST,
  suiteFailed,
  summarizeSuite,
} from '../tests/helpers/where-used-suite.js';

async function suite() {
  const orderProof = `${PUBLIC_DIR}/order.json`;
  const reportPath = 'test-results/integration.json';
  if (existsSync(MANIFEST) || existsSync(orderProof) || existsSync(reportPath))
    throw new Error('Refusing to overwrite prior diagnostic evidence.');
  // --filesOnly resolves the selection without loading tests or invoking SAP. Refuse before
  // creating the manifest too, so an always-run cleanup cannot connect after a selection failure.
  const selected = JSON.parse(
    execFileSync(
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'list', '--config', 'vitest.research-1057.config.ts', '--filesOnly', '--json'],
      { encoding: 'utf8' },
    ),
  ) as { file: string }[];
  assertOriginalTestOnly(selected.map((entry) => entry.file));
  let state: Manifest = { baseline: BASELINE, startedUtc: new Date().toISOString(), pairs: [], suiteExitCode: null };
  writeJson(MANIFEST, state);
  writeJson(`${PUBLIC_DIR}/provenance.json`, {
    baseline: BASELINE,
    experiment: 'original-test-only; full-suite comparison is run 41329470276 at 1c2626e8',
    runningRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    originalTestBlob: execFileSync('git', ['hash-object', ORIGINAL_TEST], { encoding: 'utf8' }).trim(),
    productionSourceTree: execFileSync('git', ['rev-parse', 'HEAD:src'], { encoding: 'utf8' }).trim(),
    packageVersion: JSON.parse(readFileSync('package.json', 'utf8')).version,
    runId: process.env.GITHUB_RUN_ID ?? null,
    transport: 'HTTPS proxy; historical CI used direct HTTP on the same SAP host',
    setupDifferences: 'Same original instrumented test and guards as full-suite run; preceding suite files omitted',
    bail: 1,
    retry: 0,
  });
  await checkTarget(makeClient());
  mkdirSync('test-results/1057-private', { recursive: true });
  const log = openSync('test-results/1057-private/suite.log', 'w', 0o600);
  try {
    const result = spawnSync(
      process.execPath,
      ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.research-1057.config.ts', '--bail=1', '--retry=0'],
      { stdio: ['ignore', log, log] },
    );
    state = readManifest();
    state.suiteExitCode = result.status;
    if (result.error || result.signal) state.stop = 'process';
    writeJson(MANIFEST, state);
    try {
      // Keep the baseline reporters; their configured outputFile overrides the CLI option.
      // Neither the default report path nor this private directory is uploaded.
      renameSync(reportPath, 'test-results/1057-private/suite.json');
      const order = JSON.parse(readFileSync(orderProof, 'utf8'));
      if (order.fileCount !== 1 || order.targetRank !== 1 || order.predecessor !== null)
        throw new Error('Unverified integration order.');
      const allowedFiles = new Set(
        execFileSync('git', ['ls-files', 'tests/integration'], { encoding: 'utf8' })
          .trim()
          .split('\n')
          .filter((path) => path.endsWith('.test.ts') && !path.endsWith('.slow.integration.test.ts')),
      );
      const summary = summarizeSuite(
        JSON.parse(readFileSync('test-results/1057-private/suite.json', 'utf8')),
        allowedFiles,
      );
      if (summary.files.length !== 1 || summary.files[0]?.path !== ORIGINAL_TEST)
        throw new Error('Unexpected files in the original-test-only report.');
      writeJson(`${PUBLIC_DIR}/suite-summary.json`, summary);
      if (!summary.success && result.status === 0) state.stop = 'process';
      if (!summary.ownedTestReported || state.pairs.length !== 1 || state.pairs[0]?.outcome === 'setup')
        state.stop ??= 'setup';
    } catch (error) {
      state.stop = 'process';
      recordError(state, 'suite-report', error);
    }
  } finally {
    closeSync(log);
  }
  writeJson(MANIFEST, state);
  console.log(
    JSON.stringify({
      suiteExitCode: state.suiteExitCode,
      outcome: state.pairs[0]?.outcome ?? 'unexecuted',
      stop: state.stop ?? null,
    }),
  );
  // Allow observation and cleanup to run; the final verdict preserves the full suite's exit status.
}

async function observe(phase: 'before-native' | 'after-native') {
  const state = readManifest();
  if (!state.pairs.some((pair) => pair.retain === 'failure')) {
    console.log('No qualifying retained failure; no inspection hold.');
    return;
  }
  const client = makeClient();
  try {
    await checkTarget(client);
  } catch (error) {
    state.observationFailures = (state.observationFailures ?? 0) + 1;
    recordError(state, 'observation-target', error);
    return;
  }
  if (phase === 'after-native' && !state.holdStartedUtc) return;
  state.holdStartedUtc ??= new Date().toISOString();
  const started = Date.parse(state.holdStartedUtc);
  writeJson(MANIFEST, state);
  for (const minute of phase === 'before-native' ? [0, 2, 5] : [10, 15, 19]) {
    await delay(Math.max(0, started + minute * 60_000 - Date.now()));
    for (const pair of state.pairs.filter((row) => row.retain)) {
      const label = `minute-${minute}`;
      try {
        await snapshotIndex(client, pair, label);
      } catch (error) {
        state.observationFailures = (state.observationFailures ?? 0) + 1;
        recordError(state, 'sample-index', error);
      }
      try {
        await withReadDeadline(client, 25_000, async () => {
          const descriptions = recordDescriptions(client, pair.root);
          const evidence = recordWhereUsed(client.http, {
            root: pair.root,
            consumer: pair.consumer,
            activatedAt: pair.activatedAt!,
            artifactPath: `${PUBLIC_DIR}/${pair.root}-${label}-references.json`,
          });
          try {
            for (const scoped of [false, true]) {
              const phase = scoped ? 'scoped' : 'ordinary';
              evidence.phase = phase;
              const result = JSON.parse(
                await call(client, 'SAPNavigate', {
                  action: 'references',
                  type: 'CLAS',
                  name: pair.root,
                  objectType: 'CLAS',
                  ...(scoped ? { packages: ['$TMP'] } : {}),
                }),
              );
              evidence.recordResult(phase, result);
            }
          } finally {
            evidence.restore();
            descriptions.restore();
            evidence.writeFailure();
            writeJson(`${PUBLIC_DIR}/${pair.root}-${label}-descriptions.json`, descriptions.descriptions);
          }
        });
      } catch (error) {
        // Preserve the agreed inspection window even when a diagnostic read fails.
        state.observationFailures = (state.observationFailures ?? 0) + 1;
        recordError(state, 'sample-references', error);
        writeJson(`${PUBLIC_DIR}/${pair.root}-${label}-error.json`, {
          observationFailed: true,
          observedUtc: new Date().toISOString(),
        });
      }
      writeJson(MANIFEST, state);
    }
    console.log(JSON.stringify({ sampleMinute: minute, finishedUtc: new Date().toISOString() }));
  }
  if (phase === 'before-native') {
    state.nativeInspectionReadyUtc = new Date().toISOString();
    writeJson(MANIFEST, state);
    return;
  }
  await delay(Math.max(0, started + 20 * 60_000 - Date.now()));
  state.holdFinishedUtc = new Date().toISOString();
  writeJson(MANIFEST, state);
}

async function cleanup() {
  if (!existsSync(MANIFEST)) return;
  const state = readManifest();
  const client = makeClient();
  await checkTarget(client);
  // A killed step cannot prove the last server-side operation settled. Keep the manifest and
  // allow a quiet interval before deletion; report that uncertainty instead of claiming certainty.
  const unfinished = state.pairs.some(
    (pair) =>
      pair.attempts.length > 0 &&
      (pair.outcome === 'setup' ||
        (pair.phase === 'cleanup' && pair.attempts.some((name) => pair.cleanup[name] !== 'absent'))),
  );
  if (unfinished) {
    writeJson(`${PUBLIC_DIR}/late-operation-warning.json`, { serverCompletionUncertain: true, waitSeconds: 120 });
    await delay(120_000);
  }
  const deadline = Date.now() + 7 * 60_000;
  for (const pair of [...state.pairs].reverse()) {
    if (!(await cleanupPair(client, state, pair, Math.max(0, Math.min(180_000, deadline - Date.now())))))
      state.stop = 'cleanup';
  }
  // A separate second check catches an object appearing during the first cleanup pass.
  await delay(5_000);
  for (const pair of state.pairs) {
    if (!(await cleanupPair(client, state, pair, 0))) state.stop = 'cleanup';
  }
  state.cleanupFinishedUtc = new Date().toISOString();
  writeJson(MANIFEST, state);
  console.log(JSON.stringify({ cleanupComplete: state.stop !== 'cleanup', finishedUtc: state.cleanupFinishedUtc }));
}

async function main() {
  const action = process.argv[2];
  if (action === 'suite') await suite();
  else if (action === 'observe-before-native') await observe('before-native');
  else if (action === 'observe-after-native') await observe('after-native');
  else if (action === 'cleanup') await cleanup();
  else if (action === 'verdict') {
    const state = readManifest();
    if (suiteFailed(state)) process.exitCode = 1;
    console.log(
      JSON.stringify({
        suiteExitCode: state.suiteExitCode,
        stop: state.stop ?? null,
        outcome: state.pairs[0]?.outcome ?? 'unexecuted',
        activeSourcesMatch: state.pairs[0]?.activeSourcesMatch ?? null,
      }),
    );
  } else throw new Error('Unknown diagnostic stage.');
}
main().catch((error) => {
  try {
    if (existsSync(MANIFEST)) recordError(readManifest(), 'driver', error);
  } catch {
    /* A corrupt manifest must never trigger an improvised cleanup. */
  }
  console.error('Diagnostic stage failed; inspect the bounded manifest and stage status.');
  process.exitCode = 1;
});
