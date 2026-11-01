/** Temporary research driver; this workflow and its helpers must not be merged into main. */
import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { recordWhereUsed } from '../tests/helpers/where-used-diagnostics.js';
import {
  BASELINE,
  call,
  checkTarget,
  cleanupPair,
  makeClient,
  MANIFEST,
  type Manifest,
  PUBLIC_DIR,
  readManifest,
  recordDescriptions,
  snapshotIndex,
  withReadDeadline,
  writeJson,
} from '../tests/helpers/where-used-experiment.js';

async function trials() {
  if (existsSync(MANIFEST)) throw new Error('Refusing to overwrite an existing diagnostic manifest.');
  let state: Manifest = { baseline: BASELINE, startedUtc: new Date().toISOString(), pairs: [], trialFailures: 0 };
  writeJson(MANIFEST, state);
  writeJson(`${PUBLIC_DIR}/provenance.json`, {
    baseline: BASELINE,
    runningRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    packageVersion: JSON.parse(readFileSync('package.json', 'utf8')).version,
  });
  // Fail before creating anything if the CI secrets point to a different system.
  await checkTarget(makeClient());
  const started = Date.now();
  mkdirSync('test-results/1057-private', { recursive: true });
  for (let trial = 1; trial <= 6; trial++) {
    if (Date.now() - started > 17 * 60_000) {
      state.stop = 'process';
      break;
    }
    const suffix = `${Date.now().toString(36).toUpperCase()}${trial}`;
    state.pairs.push({
      root: `ZAR1057_ROOT_${suffix}`,
      consumer: `ZAR1057_USE_${suffix}`,
      absentBeforeCreate: false,
      attempts: [],
      conflicts: [],
      outcome: 'setup',
      cleanup: {},
    });
    writeJson(MANIFEST, state);
    console.log(JSON.stringify({ trial, root: state.pairs.at(-1)!.root, consumer: state.pairs.at(-1)!.consumer }));
    const log = openSync(`test-results/1057-private/trial-${trial}.log`, 'w', 0o600);
    try {
      // Every trial gets a fresh client/process. Raw assertion details stay out of public logs/artifacts.
      const result = spawnSync(
        process.execPath,
        [
          'node_modules/vitest/vitest.mjs',
          'run',
          '--config',
          'vitest.integration.config.ts',
          'tests/integration/where-used-diagnosis.integration.test.ts',
          '--reporter=json',
          `--outputFile=test-results/1057-private/trial-${trial}.json`,
        ],
        { stdio: ['ignore', log, log] },
      );
      state = readManifest();
      if (result.status !== 0) state.trialFailures++;
      if (result.error || result.signal) state.stop = 'process';
    } finally {
      closeSync(log);
    }
    writeJson(MANIFEST, state);
    console.log(JSON.stringify({ trial, outcome: state.pairs.at(-1)!.outcome, stop: state.stop ?? null }));
    if (
      state.stop ||
      (state.pairs.some((pair) => pair.retain === 'control') && state.pairs.some((pair) => pair.retain === 'failure'))
    )
      break;
  }
  writeJson(MANIFEST, state);
  // This stage succeeds so the hold and cleanup run. The final verdict preserves every failed trial.
}

async function observe(phase: 'before-native' | 'after-native') {
  const state = readManifest();
  if (!state.holdStartedUtc && (state.stop || !state.pairs.some((pair) => pair.retain === 'failure'))) {
    console.log('No qualifying retained failure; no inspection hold.');
    return;
  }
  const client = makeClient();
  await checkTarget(client);
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
      } catch {
        // Preserve the agreed inspection window even when a diagnostic read fails.
        state.observationFailures = (state.observationFailures ?? 0) + 1;
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
  const unfinished = state.pairs.some((pair) => pair.outcome === 'setup' && pair.attempts.length > 0);
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
  if (action === 'trials') await trials();
  else if (action === 'observe-before-native') await observe('before-native');
  else if (action === 'observe-after-native') await observe('after-native');
  else if (action === 'cleanup') await cleanup();
  else if (action === 'verdict') {
    const state = readManifest();
    if (state.stop || state.trialFailures || state.observationFailures || !state.cleanupFinishedUtc)
      process.exitCode = 1;
    console.log(
      JSON.stringify({
        trialFailures: state.trialFailures,
        stop: state.stop ?? null,
        reproduced: state.pairs.some((pair) => pair.outcome === 'ordinary-scoped-failure'),
      }),
    );
  } else throw new Error('Unknown diagnostic stage.');
}
main().catch(() => {
  console.error('Diagnostic stage failed; inspect the bounded manifest and stage status.');
  process.exitCode = 1;
});
