import { readFileSync } from 'node:fs';
import { getGlobalDispatcher, Headers, type HeadersInit, MockAgent, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { recoveryConfig } from '../../../scripts/qualification/pr1142/native-declarative-recovery-driver.js';
import {
  checkV4RecoveryRequest,
  runV4DeclarativeRecovery,
} from '../../../scripts/qualification/pr1142/native-declarative-v4-recovery-driver.js';
import {
  v4RecoveryFixtures,
  v4RecoveryOwners,
  v4ReferencedClass,
} from '../../../scripts/qualification/pr1142/native-declarative-v4-recovery-fixed.js';
import { AdtClient } from '../../../src/adt/client.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { resetCachedFeatures, setCachedFeatures } from '../../../src/handlers/feature-cache.js';
import { featuresOff } from './handler-test-config.js';

const native = JSON.parse(
  readFileSync(new URL('../../fixtures/declarative-owners/failed-v4-pair-20261103.json', import.meta.url), 'utf8'),
).responses as Record<string, string>;
const origin = 'https://a4h.marianzeis.de';
const HANDLE = 'RECOVERY-PRIVATE-HANDLE',
  CONTEXT = 'RECOVERY-PRIVATE-CONTEXT',
  SECRET = 'RECOVERY-PRIVATE-SECRET';
const absent =
  '<exc:exception xmlns:exc="http://www.sap.com/abapxml/types/communicationframework"><namespace id="com.sap.adt"/><type id="ExceptionResourceNotFound"/><message>Missing resource</message></exc:exception>';
let agent: MockAgent;
const previous = getGlobalDispatcher();
let calls: { method: string; path: string; body: unknown; headers: unknown }[], records: unknown[];
let existing: Set<string>, locked: string | undefined, lastOwner: string | undefined;
let fault: string, stopped: boolean, bindingBroken: boolean, guardDone: boolean, inventoryReads: number;
let verificationHook: (() => void) | undefined;
let outcome: Awaited<ReturnType<typeof runV4DeclarativeRecovery>> | undefined;
const deletes = () => calls.filter((r) => r.method === 'DELETE');
const unlocks = () => calls.filter((r) => r.path.includes('_action=UNLOCK'));
const ownerIndex = (path: string) =>
  v4RecoveryOwners.findIndex((f) => path === f.owner || path === `${f.owner}/source/main`);
beforeEach(() => {
  resetCachedFeatures();
  setCachedFeatures({ ...featuresOff, systemType: 'onprem', abapRelease: '758' });
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
  calls = [];
  records = [];
  existing = new Set(v4RecoveryOwners.map((f) => f.owner));
  locked = undefined;
  lastOwner = undefined;
  fault = '';
  stopped = false;
  bindingBroken = false;
  guardDone = false;
  inventoryReads = 0;
  outcome = undefined;
  verificationHook = undefined;
  for (const method of ['GET', 'HEAD', 'POST', 'DELETE', 'PUT'])
    agent
      .get(origin)
      .intercept({ path: /.*/, method })
      .reply((request) => {
        const url = new URL(request.path, origin),
          path = url.pathname;
        calls.push({ method, path: request.path, body: request.body, headers: request.headers });
        const reply = (statusCode: number, data = '', headers: Record<string, string> = {}) => ({
          statusCode,
          data,
          responseOptions: { headers },
        });
        const index = ownerIndex(path),
          fixture = v4RecoveryOwners[index];
        const selectedFault = fault.startsWith(`${index}:`) ? fault.slice(2) : '';
        const stateful = new Headers(request.headers as HeadersInit).get('X-sap-adt-sessiontype') === 'stateful';
        const guard = locked === fixture?.owner && !stateful;
        if (method === 'HEAD') return reply(200, '', { 'x-csrf-token': 'synthetic' });
        if (path.includes('/http/sessions')) return reply(fault === `${ownerIndex(lastOwner ?? '')}:close` ? 500 : 200);
        if (path.endsWith('/transportchecks'))
          return reply(
            200,
            '<DATA><DEVCLASS>$TMP</DEVCLASS><DLVUNIT>LOCAL</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING/></DATA>',
          );
        if (url.searchParams.get('_action') === 'LOCK') {
          locked = fixture?.owner;
          lastOwner = locked;
          return reply(200, `<DATA><LOCK_HANDLE>${HANDLE}</LOCK_HANDLE><CORRNR/><IS_LOCAL>X</IS_LOCAL></DATA>`, {
            'set-cookie': `sap-contextid=${CONTEXT}; Path=/`,
          });
        }
        if (url.searchParams.get('_action') === 'UNLOCK') {
          if (selectedFault === 'unlock') return reply(500, SECRET);
          locked = undefined;
          return reply(200);
        }
        if (method === 'DELETE') {
          if (selectedFault === 'delete-403') return reply(403, SECRET);
          if (selectedFault === 'delete-503') return reply(503, SECRET);
          if (selectedFault === 'delete-421') return reply(421, SECRET);
          if (selectedFault === 'delete-network') throw new Error(SECRET);
          existing.delete(fixture.owner);
          return reply(204);
        }
        if (path.endsWith('/inactiveobjects')) {
          inventoryReads++;
          if (fault === 'final-binding' && inventoryReads === 3) bindingBroken = true;
          return reply(
            200,
            `<i:inactiveObjects xmlns:i="http://www.sap.com/abapxml/inactiveCtsObjects">${fault === 'inventory' ? v4RecoveryOwners[0].name : ''}</i:inactiveObjects>`,
            { 'content-type': 'application/xml' },
          );
        }
        if (
          method === 'GET' &&
          (v4RecoveryFixtures.some((f) => f.owner === path) || path === v4ReferencedClass.owner || index >= 0)
        ) {
          if (path === v4ReferencedClass.owner) {
            if (locked) guardDone = true;
            if (fault === 'class-present' || (fault === 'guard-class-present' && locked))
              return reply(200, '<present/>');
            if (fault === 'class-untyped') return reply(404, 'not found');
          }
          if (index < 0 || !existing.has(fixture.owner)) {
            if (index >= 0 && selectedFault === 'absence') return reply(404, 'untyped');
            if (fault === 'peer-present' && index < 0 && path !== v4ReferencedClass.owner)
              return reply(200, '<present/>');
            return reply(404, absent, { 'content-type': 'application/xml' });
          }
          const version = url.searchParams.get('version') ?? 'default';
          const prefix = fixture.type === 'BDEF' ? 'BDEF' : 'ABSTRACT-DDLS';
          if (path.endsWith('/source/main')) {
            if (guard && selectedFault === 'stop') stopped = true;
            if (guard && selectedFault === 'binding') bindingBroken = true;
            if (guard && selectedFault === 'deadline') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 180001);
            let source = native[`${prefix}-source-${version}.abap`];
            if (selectedFault === 'response-limit') source = 'x'.repeat(2 * 1024 * 1024 + 1);
            if (selectedFault === `${version}-source` || (guard && selectedFault === `guard-${version}-source`))
              source += '\nforeign change';
            return reply(200, source, { 'content-type': selectedFault === 'media' ? 'text/html' : 'text/plain' });
          }
          let metadata = native[`${prefix}-${version}-metadata.xml`];
          if (selectedFault === 'author')
            metadata = metadata.replace('adtcore:changedBy="MARIAN"', 'adtcore:changedBy="FOREIGN"');
          if (selectedFault === 'package') metadata = metadata.replace('adtcore:name="$TMP"', 'adtcore:name="ZOTHER"');
          if (selectedFault === 'marker') metadata = metadata.replace('ARC1 declarative v4', 'ARC1 foreign v4');
          if (selectedFault === 'version')
            metadata = metadata.replace('adtcore:version="active"', 'adtcore:version="inactive"');
          if (selectedFault === 'metadata' || (guard && selectedFault === 'guard-metadata'))
            metadata = metadata.replace('adtcore:language="EN"', 'adtcore:language="DE"');
          return reply(200, metadata, { 'content-type': 'application/xml' });
        }
        throw new Error(`Unexpected request ${method} ${path}`);
      })
      .persist();
});
afterEach(async () => {
  expect(calls.some((r) => r.method === 'PUT' || r.path.startsWith('/sap/bc/adt/activation?'))).toBe(false);
  expect(
    calls
      .filter((r) => r.method === 'DELETE')
      .every((r) => v4RecoveryOwners.some((f) => r.path.startsWith(`${f.owner}?`))),
  ).toBe(true);
  expect(calls.filter((r) => r.path.startsWith(v4ReferencedClass.owner)).every((r) => r.method === 'GET')).toBe(true);
  for (const secret of [HANDLE, CONTEXT, SECRET]) expect(JSON.stringify({ records, outcome })).not.toContain(secret);
  setGlobalDispatcher(previous);
  await agent.close();
  vi.restoreAllMocks();
});
async function run(deadlineMs = 60000) {
  const base = new AdtClient({
    baseUrl: origin,
    client: '001',
    safety: { ...defaultSafetyConfig(), ...recoveryConfig },
    bearerTokenProvider: async () => {
      if (guardDone && fault === 'send-binding') bindingBroken = true;
      if (guardDone && fault === 'send-deadline') {
        guardDone = false;
        vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 120000);
      }
      return 'synthetic';
    },
  });
  outcome = await runV4DeclarativeRecovery({
    base,
    deadline: Date.now() + deadlineMs,
    record: (row) => records.push(row),
    verifySource: () => {
      if (bindingBroken) throw new Error(SECRET);
      verificationHook?.();
    },
    shouldStop: () => stopped,
  });
  return outcome;
}
it('deletes the exact dual-version BDEF then active parent, with independent absence and owning cleanup before advancement', async () => {
  await expect(run()).resolves.toMatchObject({
    failure: false,
    confirmedDeleted: v4RecoveryOwners.map((f) => f.owner),
    cleanupConfirmed: true,
    finalAbsenceConfirmed: true,
    remaining: [],
  });
  expect(deletes().map((r) => r.path.split('?')[0])).toEqual(v4RecoveryOwners.map((f) => f.owner));
  expect(unlocks()).toHaveLength(2);
  expect(inventoryReads).toBe(3);
  const second = calls.findIndex((r) => r.path.startsWith(`${v4RecoveryOwners[1].owner}?_action=LOCK`));
  expect(calls.slice(0, second).some((r) => r.path.includes('/http/sessions'))).toBe(true);
  expect(existing.size).toBe(0);
});
it.each(
  [0, 1].flatMap((index) =>
    [
      'default-source',
      'active-source',
      'inactive-source',
      'author',
      'package',
      'marker',
      'version',
      'metadata',
      'media',
      'response-limit',
    ].map((f) => `${index}:${f}`),
  ),
)('refuses original pair receipt drift %s before any lock', async (value) => {
  fault = value;
  await expect(run()).resolves.toMatchObject({ failure: true, mutationAttempted: false, confirmedDeleted: [] });
  expect(unlocks()).toHaveLength(0);
  expect(deletes()).toHaveLength(0);
});
it.each(
  [0, 1].flatMap((index) =>
    [
      'guard-default-source',
      'guard-active-source',
      'guard-inactive-source',
      'guard-metadata',
      'stop',
      'binding',
      'deadline',
    ].map((f) => `${index}:${f}`),
  ),
)('stops on %s under its own lock while preserving prior confirmed cleanup', async (value) => {
  fault = value;
  const index = Number(value[0]);
  await expect(run()).resolves.toMatchObject({
    failure: true,
    confirmedDeleted: v4RecoveryOwners.slice(0, index).map((f) => f.owner),
    remaining: v4RecoveryOwners.slice(index).map((f) => f.owner),
  });
  expect(deletes()).toHaveLength(index);
  expect(unlocks()).toHaveLength(index + 1);
});
it.each(
  [0, 1].flatMap((index) =>
    ['delete-403', 'delete-503', 'delete-421', 'delete-network', 'absence', 'unlock', 'close'].map(
      (f) => `${index}:${f}`,
    ),
  ),
)('does not advance or replay after %s', async (value) => {
  fault = value;
  const index = Number(value[0]);
  const result = await run();
  expect(result.failure).toBe(true);
  expect(result.finalAbsenceConfirmed).toBe(false);
  expect(deletes()).toHaveLength(index + 1);
  expect(unlocks()).toHaveLength(index + 1);
  if (value.endsWith('unlock') || value.endsWith('close'))
    expect(result.confirmedDeleted).toEqual(v4RecoveryOwners.slice(0, index + 1).map((f) => f.owner));
});
it.each([
  'class-present',
  'class-untyped',
  'peer-present',
  'guard-class-present',
  'inventory',
  'final-binding',
  'send-binding',
  'send-deadline',
])('stops on %s without losing confirmed partial facts', async (value) => {
  fault = value;
  const result = await run();
  expect(result.failure).toBe(true);
  expect(result.finalAbsenceConfirmed).toBe(false);
  if (value === 'final-binding') expect(result.confirmedDeleted).toEqual(v4RecoveryOwners.map((f) => f.owner));
  if (value === 'send-binding' || value === 'send-deadline') {
    expect(deletes()).toHaveLength(0);
    expect(unlocks()).toHaveLength(1);
  }
});
it.each(v4RecoveryOwners)('refuses foreign, repair, recording and class mutation paths for $type', (fixture) => {
  for (const [method, path, body] of [
    ['PUT', `${fixture.owner}/source/main?lockHandle=${HANDLE}`, 'repair'],
    ['POST', fixture.owner.replace(/\/[^/]+$/, ''), '<create/>'],
    ['POST', '/sap/bc/adt/activation?method=activate', '<activate/>'],
    ['DELETE', `${v4ReferencedClass.owner}?lockHandle=${HANDLE}`, undefined],
    ['DELETE', `${fixture.owner}?lockHandle=${HANDLE}&corrNr=ANY`, undefined],
    ['GET', `${fixture.owner}?sap-client=100`, undefined],
  ])
    expect(() => checkV4RecoveryRequest(fixture, method!, path!, body)).toThrow();
  expect(calls).toEqual([]);
});

it.each([0, 1].flatMap((index) => [6000, 30000].map((cap) => ({ index, cap }))))(
  'refuses owner $index when final proof reaches the effective $cap ms deadline, retaining own cleanup',
  async ({ index, cap }) => {
    let time = Date.now(),
      fired = false;
    vi.spyOn(Date, 'now').mockImplementation(() => time);
    verificationHook = () => {
      const last = records.at(-1) as { stage?: string; method?: string; path?: string } | undefined;
      if (
        !fired &&
        last?.stage === 'request' &&
        last.method === 'DELETE' &&
        last.path?.startsWith(v4RecoveryOwners[index].owner)
      ) {
        fired = true;
        time += cap;
      }
    };
    // 6s is the original prerequisite expiry; 30s is narrower than both the 60s caller and 90s owner.
    const result = await run(cap === 6000 ? cap : 60000);
    expect(fired).toBe(true);
    expect(result.failure).toBe(true);
    expect(deletes()).toHaveLength(index);
    expect(unlocks()).toHaveLength(index + 1);
    expect(result.confirmedDeleted).toEqual(v4RecoveryOwners.slice(0, index).map((f) => f.owner));
    expect(result.outcomes[index].result.cleanupConfirmed).toBe(true);
  },
);
