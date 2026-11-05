/** One claimed experiment, three explicit invocations: prepare, passive observation, inspected whole-group recovery. */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';
import { AdtClient } from '../../../src/adt/client.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { AdtRequestNotSentError } from "../../../src/adt/errors.js";
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { contractSelection, isNativeContractOrigin } from './native-contract-transport.js';
import { runNativeFunctionContract } from './native-function-contract-run.js';
import {
  claimDirectory,
  durableRecord,
  fileHash,
  journal,
  nativeLockBinding,
  privateDirectory,
} from './native-lock-binding.js';
import { captureOwnedFunctionInventory } from './native-lock-inventory.js';
import { observeNativeFunctionLock, type ActiveFunctionReceipt } from './native-lock-observation.js';
import { recoverInspectedFunctionGroup } from './native-lock-recovery.js';
import { createPassiveObservationChannel } from './native-observation-channel.js';
import { assertSafeDiagnosticEnvironment, privateJson } from './safe-io.mjs';

function preserveEveryOwner(http: AdtHttpClient): AdtHttpClient {
  return new Proxy(http, {
    get(target, key) {
      if (key === 'delete')
        return async () => {
          throw new AdtRequestNotSentError('DELETE', 'Preparation preserves every fixture.');
        };
      if (key === 'withStatefulSession')
        return (
          fn: (session: AdtHttpClient) => Promise<unknown>,
          cleanup: Parameters<AdtHttpClient['withStatefulSession']>[1],
        ) => target.withStatefulSession((session) => fn(preserveEveryOwner(session)), cleanup);
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
async function main() {
  assertSafeDiagnosticEnvironment();
  const [mode, flag, revision, inventoryFlag, inspectedHash, ...extra] = process.argv.slice(2);
  const prepare = mode === '--create-observation-fixture';
  const observe = mode === '--observe-existing-fixture';
  const cleanup = mode === '--delete-whole-owned-group';
  if (
    !(prepare || observe || cleanup) ||
    flag !== '--execute-reviewed-revision' ||
    !/^[a-f0-9]{40}$/.test(revision ?? '') ||
    extra.length ||
    (cleanup
      ? inventoryFlag !== '--inspected-inventory-sha256' || !/^[a-f0-9]{64}$/.test(inspectedHash ?? '')
      : inventoryFlag !== undefined || inspectedHash !== undefined)
  )
    throw new Error(
      'An exact phase, reviewed revision and separate inspected-inventory acknowledgement for deletion are required.',
    );
  process.umask(0o077);
  const binding = await nativeLockBinding(revision, new URL(import.meta.url));
  const { root, verifySource } = binding;
  if (prepare) {
    claimDirectory(root); // Fixed experiment name: a second invocation cannot create another pair.
    durableRecord(join(root, 'manifest.json'), {
      schema: 1,
      createdAt: new Date().toISOString(),
      binding: binding.evidence,
      suffix: randomBytes(8).toString('hex').toUpperCase(),
      identity: 'MARIAN',
      target: 'A4H/001',
      authentication: 'Basic-native-contract-only',
    });
  }
  privateDirectory(root);
  const manifest = await privateJson(join(root, 'manifest.json'));
  if (
    manifest.schema !== 1 ||
    manifest.identity !== 'MARIAN' ||
    manifest.target !== 'A4H/001' ||
    Object.entries(binding.evidence).some(([key, value]) => manifest.binding?.[key] !== value)
  )
    throw new Error('The fixed experiment does not belong to this exact source/runtime binding.');
  const selection = contractSelection(manifest.suffix),
    marker = `ARC1 native contract ${manifest.suffix}`;
  const phase = prepare ? 'prepare' : observe ? 'observe' : 'cleanup';
  let ready: { receipt: ActiveFunctionReceipt; inventoryHash: string } | undefined;
  if (!prepare) {
    ready = await privateJson(join(root, 'ready.json'));
    if (
      !ready ||
      ![ready.receipt?.hash, ready.receipt?.metadataHash, ready.inventoryHash].every(
        (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
      ) ||
      fileHash(join(root, 'inventory.json')) !== ready.inventoryHash
    )
      throw new Error('The owned prepared inventory/active receipt is incomplete or changed.');
  }
  if (cleanup) {
    const observation = await privateJson(join(root, 'observation-result.json'));
    if (observation.cleanupConfirmed !== true || inspectedHash !== ready!.inventoryHash)
      throw new Error(
        'Recovery requires confirmed observation-session cleanup and the separately inspected inventory hash.',
      );
  }
  const record = journal(join(root, phase)); // Claim every phase before credentials or native access.
  record({ phase, binding: binding.evidence, selection, inspectedHash });
  const env = parse(readFileSync(join(binding.repo, '.env')));
  if (
    !isNativeContractOrigin(env.SAP_URL) ||
    env.SAP_USER !== 'MARIAN' ||
    env.SAP_CLIENT !== '001' ||
    !env.SAP_PASSWORD
  )
    throw new Error('The existing MARIAN/001 credentials must select the approved HTTPS origin.');
  const config = {
    ...DEFAULT_CONFIG,
    client: '001',
    systemType: 'onprem' as const,
    allowWrites: true,
    targetId: 'A4H/001',
    allowedPackages: ['$TMP'],
    lintBeforeWrite: false,
    checkBeforeWrite: false,
    multiTargetWrite: {
      target: 'A4H/001',
      enabled: true,
      allowedPackages: ['$TMP'],
      allowedTransports: [],
      serverAllowedTransports: [],
    },
  };
  const client = new AdtClient({
    baseUrl: 'https://a4h.marianzeis.de',
    client: '001',
    username: env.SAP_USER,
    password: env.SAP_PASSWORD,
    insecure: false,
    safety: { ...defaultSafetyConfig(), ...config },
  });
  delete env.SAP_PASSWORD;
  const controller = new AbortController();
  const stop = () => controller.abort(new Error('Operator stopped this phase.'));
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, stop);
  try {
    if (prepare) {
      let receipt: ActiveFunctionReceipt | undefined;
      const protectedClient = Object.assign(Object.create(Object.getPrototypeOf(client)), client, {
        http: preserveEveryOwner(client.http),
      }) as AdtClient;
      const outcome = await runNativeFunctionContract({
        base: protectedClient,
        config,
        selection,
        marker,
        verifySource,
        shouldStop: () => controller.signal.aborted,
        record: (value) => {
          record(value);
          const row = value as Record<string, unknown>;
          if (
            row.activeSourceVerified === selection.moduleUrl &&
            row.nativeVersion === 'active' &&
            [row.hash, row.metadataHash].every((hash) => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))
          )
            receipt = { hash: row.hash as string, metadataHash: row.metadataHash as string };
        },
      });
      record({ preparationOutcome: outcome });
      if (
        !receipt ||
        outcome.pendingCreation.length ||
        outcome.cleanupIssues.length ||
        controller.signal.aborted ||
        outcome.remaining.length !== 2 ||
        ![selection.groupUrl, selection.moduleUrl].every((path) => outcome.remaining.includes(path))
      )
        throw new Error('Preparation did not establish the owned active fixture; inspect without rerunning.');
      verifySource();
      controller.signal.throwIfAborted();
      const inventory = await captureOwnedFunctionInventory(client.http, selection, marker, receipt, record, {
        signal: controller.signal,
      });
      durableRecord(join(root, 'inventory.json'), inventory);
      durableRecord(join(root, 'ready.json'), { receipt, inventoryHash: fileHash(join(root, 'inventory.json')) });
      console.log(JSON.stringify({ phase: 'prepared', root, selection, ready: true }));
    } else if (observe) {
      const channel = createPassiveObservationChannel(process.stdin, controller, (prompt) =>
        console.log(JSON.stringify({ awaitingObservation: prompt, root })),
      );
      try {
        const result = await observeNativeFunctionLock({
          client,
          selection,
          marker,
          receipt: ready!.receipt,
          observe: channel.observe,
          record,
          verifySource,
          signal: controller.signal,
        });
        durableRecord(join(root, 'observation-result.json'), result);
        console.log(JSON.stringify({ workflowPhase: phase, root, ...result }));
        process.exitCode = result.cleanupConfirmed && result.state !== 'failed' ? 0 : 1;
      } finally {
        channel.close();
      }
    } else {
      const inspected = await privateJson(join(root, 'inventory.json'));
      const result = await recoverInspectedFunctionGroup({
        client,
        selection,
        marker,
        receipt: ready!.receipt,
        inspected,
        record,
        verifySource,
        signal: controller.signal,
      });
      durableRecord(join(root, 'recovery-result.json'), result);
      console.log(JSON.stringify({ phase, root, cleanupConfirmed: result.cleanupConfirmed }));
      process.exitCode = result.cleanupConfirmed ? 0 : 1;
    }
  } finally {
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.off(signal, stop);
  }
}
main().catch(() => {
  console.error('Native lock workflow stopped. Inspect its private receipts; do not retry a claimed phase.');
  process.exitCode = 1;
});
