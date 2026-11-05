import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handlePinnedTrace } = await import('../../../src/handlers/pinned-trace.js');
const { setSqlTraceState } = await import('../../../src/adt/diagnostics.js');
const { unrestrictedSafetyConfig } = await import('../../../src/adt/safety.js');
const state = readFileSync(new URL('../../fixtures/xml/st05-trace-state.xml', import.meta.url), 'utf8');
const path = '/sap/bc/adt/st05/trace/state',
  mime = 'application/vnd.sap.adt.perf.trace.state.v1+xml';
const on = (xml = state) =>
  xml.replace('<ts:sqlOn>false', '<ts:sqlOn>true').replace('<ts:traceUser/>', '<ts:traceUser>MARIAN</ts:traceUser>');
const config = {
  ...DEFAULT_CONFIG,
  allowWrites: true,
  multiTargetEndpoints: true,
  multiTargetAuthorization: 'xsuaa-attribute' as const,
  ppEnabled: true,
  ppStrict: true,
  targetId: 'A4H/001',
  multiTargetWrite: {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: [],
    allowedTransports: [],
    serverAllowedTransports: [],
  },
};
function fixture(initial: string, afterPut: (body: string) => string = (body) => body) {
  let current = initial;
  const client = new AdtClient({
    baseUrl: 'https://sap.test',
    client: '001',
    safety: config,
    bearerTokenProvider: async () => 'synthetic-mapped-token',
  });
  mockFetch.mockImplementation(async (url, opts) => {
    if (opts.method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'test-csrf' });
    expect(new URL(String(url)).pathname).toBe(path);
    if (opts.method === 'PUT') current = afterPut(opts.body);
    return mockResponse(200, current, { 'content-type': mime });
  });
  return {
    client,
    run: async (sqlOn: boolean) =>
      JSON.parse(
        (
          await handlePinnedTrace(
            client,
            { action: 'set_sql_trace_state', sqlOn, ...(sqlOn ? { user: 'MARIAN' } : {}) },
            config,
          )
        ).content[0].text,
      ),
    current: () => current,
  };
}
const puts = () => mockFetch.mock.calls.filter(([, o]) => o.method === 'PUT');
beforeEach(() => vi.resetAllMocks());
it.each(['bufOn', 'enqOn', 'rfcOn', 'httpOn', 'apcOn', 'amcOn', 'authOn'])(
  'refuses an ON write that would clear same-user active %s',
  async (type) => {
    const initial = state
      .replace('<ts:traceUser/>', '<ts:traceUser>MARIAN</ts:traceUser>')
      .replace(`<ts:${type}>false`, `<ts:${type}>true`);
    const f = fixture(initial);
    expect(await f.run(true)).toMatchObject({ ok: false, state: 'unchanged' });
    expect(puts()).toHaveLength(0);
    expect(f.current()).toBe(initial);
  },
);
it.each(['bufOn', 'enqOn', 'rfcOn', 'httpOn', 'apcOn', 'amcOn', 'authOn'])(
  'refuses an OFF write that would clear active %s',
  async (type) => {
    const f = fixture(on().replace(`<ts:${type}>false`, `<ts:${type}>true`));
    expect(await f.run(false)).toMatchObject({ ok: false, state: 'unchanged' });
    expect(puts()).toHaveLength(0);
  },
);
it.each([false, true])('preserves a valid no-op even with another active trace (sqlOn=%s)', async (sqlOn) => {
  const f = fixture((sqlOn ? on() : state).replace('<ts:authOn>false', '<ts:authOn>true'));
  expect(await f.run(sqlOn)).toMatchObject({ ok: true, state: 'unchanged' });
  expect(puts()).toHaveLength(0);
});
it('verifies the source-backed native OFF defaults after exactly one PUT', async () => {
  const initial = on()
    .replace('<ts:program/>', '<ts:program>ZOWNER</ts:program>')
    .replace('<ts:includeMissingTableNameOn>false', '<ts:includeMissingTableNameOn>true')
    .replace('<ts:authErrorsOnly>false', '<ts:authErrorsOnly>true')
    .replace('<ts:stackTraceOn>false', '<ts:stackTraceOn>true');
  const inactive = state.replace('<ts:stackTraceOn>false', '<ts:stackTraceOn>true');
  const f = fixture(initial, () => inactive),
    result = await f.run(false);
  expect(result).toMatchObject({ ok: true, state: 'updated' });
  expect(result.next).toContain('inactive defaults');
  expect(result.next).not.toContain('filter and other trace types were preserved');
  expect(puts()).toHaveLength(1);
  expect(puts()[0][1].body).toBe(initial.replace('<ts:sqlOn>true', '<ts:sqlOn>false'));
  expect(result.after[0].filter.user).toBeUndefined();
});
it('arms then disarms an initially empty baseline with no extra restoration PUT', async () => {
  const f = fixture(state, (body) => (body.includes('<ts:sqlOn>true') ? body : state));
  expect(await f.run(true)).toMatchObject({ ok: true, state: 'updated' });
  expect(await f.run(false)).toMatchObject({ ok: true, state: 'updated' });
  expect(f.current()).toBe(state);
  expect(puts()).toHaveLength(2);
});
it.each([
  ['duplicate flag', on().replace('</ts:traceTypes>', '<ts:authOn>true</ts:authOn></ts:traceTypes>')],
  ['foreign flag', on().replace('<ts:authOn>false</ts:authOn>', '<ts:authOn xmlns:ts="urn:foreign">false</ts:authOn>')],
  [
    'foreign same-name decoy',
    on().replace('</ts:traceTypes>', '<x:authOn xmlns:x="urn:foreign">false</x:authOn></ts:traceTypes>'),
  ],
  ['nested flag', on().replace('<ts:authOn>false</ts:authOn>', '<ts:authOn><ts:value>false</ts:value></ts:authOn>')],
  ['invalid stack property', on().replace('<ts:stackTraceOn>false', '<ts:stackTraceOn>unknown')],
  [
    'numeric opaque representation',
    on().replace('</ts:traceStateInstance>', '<x:note xmlns:x="urn:opaque">&#65;</x:note></ts:traceStateInstance>'),
  ],
  ['missing flag', on().replace('<ts:rfcOn>false</ts:rfcOn>', '')],
  ['unknown filter', on().replace('</ts:traceFilter>', '<ts:futureFilter>opaque</ts:futureFilter></ts:traceFilter>')],
  ['opaque filter attribute', on().replace('<ts:program/>', '<ts:program x:note="opaque" xmlns:x="urn:foreign"/>')],
  [
    'unknown property',
    on().replace('</ts:traceProperties>', '<ts:futureProperty>opaque</ts:futureProperty></ts:traceProperties>'),
  ],
  [
    'unqualified table list',
    on().replace('<ts:includedTables/>', '<ts:includedTables><ts:future>opaque</ts:future></ts:includedTables>'),
  ],
])('refuses %s before any OFF submission', async (_label, initial) => {
  expect(await fixture(initial).run(false)).toMatchObject({ ok: false, state: 'unchanged' });
  expect(puts()).toHaveLength(0);
});
it('preserves opaque instance state that is outside the native reset fields', async () => {
  const opaque = state.replace(
    '</ts:traceStateInstance>',
    '<x:modificationUser xmlns:x="urn:opaque">opaque</x:modificationUser></ts:traceStateInstance>',
  );
  expect(await fixture(on(opaque), () => opaque).run(false)).toMatchObject({ ok: true, state: 'updated' });
  expect(puts()).toHaveLength(1);
});
it.each([
  ['retained filter', state.replace('<ts:traceUser/>', '<ts:traceUser>MARIAN</ts:traceUser>')],
  ['nondefault property', state.replace('<ts:authErrorsOnly>false', '<ts:authErrorsOnly>true')],
  ['changed stack flag', state.replace('<ts:stackTraceOn>false', '<ts:stackTraceOn>true')],
  [
    'new foreign field',
    state.replace(
      '</ts:traceStateInstance>',
      '<x:modificationUser xmlns:x="urn:opaque">new</x:modificationUser></ts:traceStateInstance>',
    ),
  ],
  ['another active trace', state.replace('<ts:authOn>false', '<ts:authOn>true')],
])('reports %s after OFF as unconfirmed, without retry', async (_label, readback) => {
  expect(await fixture(on(), () => readback).run(false)).toMatchObject({
    ok: false,
    state: 'update-unconfirmed',
    retryable: false,
  });
  expect(puts()).toHaveLength(1);
});
it('keeps a failed submitted OFF one-shot', async () => {
  const f = fixture(on(), () => {
    throw new Error('synthetic uncertain send');
  });
  expect(await f.run(false)).toMatchObject({ ok: false, state: 'update-unconfirmed', retryable: false });
  expect(puts()).toHaveLength(1);
});
it('keeps the ordinary legacy setter behavior separate', async () => {
  const initial = on().replace('<ts:authOn>false', '<ts:authOn>true');
  fixture(initial);
  const legacy = new AdtClient({ baseUrl: 'https://sap.test', client: '001', safety: unrestrictedSafetyConfig() });
  await setSqlTraceState(legacy.http, legacy.safety, { sqlOn: false });
  expect(puts()).toHaveLength(1);
  expect(puts()[0][1].body).toContain('<ts:authOn>true');
});

it('preserves literal entity-looking opaque text without treating it as a numeric reference', async () => {
  const opaque = state.replace(
    '</ts:traceStateInstance>',
    '<x:note xmlns:x="urn:opaque">&amp;#65;</x:note></ts:traceStateInstance>',
  );
  expect(await fixture(on(opaque), () => opaque).run(false)).toMatchObject({ ok: true, state: 'updated' });
  expect(puts()).toHaveLength(1);
});
it('refuses the entire instance set when an unselected second instance has another active trace', async () => {
  const second = state
    .match(/<ts:traceStateInstance>.*<\/ts:traceStateInstance>/)![0]
    .replace('vhcala4hci_A4H_00', 'vhcala4hci_A4H_01')
    .replace('<ts:traceUser/>', '<ts:traceUser>MARIAN</ts:traceUser>')
    .replace('<ts:authOn>false', '<ts:authOn>true');
  expect(
    await fixture(on().replace('</ts:traceStateInstanceTable>', second + '</ts:traceStateInstanceTable>')).run(true),
  ).toMatchObject({ ok: false, state: 'unchanged' });
  expect(puts()).toHaveLength(0);
});

for (const field of ['modificationUser', 'modificationDateTime', 'isLocal', 'isSelected']) {
  for (const shape of ['attribute', 'nested', 'duplicate']) {
    it(`refuses opaque ${shape} on ignored native ${field} before PUT`, async () => {
      const tag = new RegExp(`<ts:${field}>[^<]*</ts:${field}>`);
      const original = on().match(tag)![0];
      const changed =
        shape === 'attribute'
          ? original.replace(`<ts:${field}>`, `<ts:${field} xmlns:x="urn:opaque" x:note="preserve">`)
          : shape === 'nested'
            ? `<ts:${field}><x:note xmlns:x="urn:opaque">preserve</x:note></ts:${field}>`
            : original + original;
      expect(await fixture(on().replace(tag, changed), () => state).run(false)).toMatchObject({
        ok: false,
        state: 'unchanged',
      });
      expect(puts()).toHaveLength(0);
    });
  }
}
it.each(['isLocal', 'isSelected'])('refuses a non-boolean ignored %s', async (field) => {
  const initial = on().replace(new RegExp(`<ts:${field}>[^<]*`), `<ts:${field}>unknown`);
  expect(await fixture(initial, () => state).run(false)).toMatchObject({ ok: false, state: 'unchanged' });
  expect(puts()).toHaveLength(0);
});
it('accepts absent optional stamps/selection values and scalar changes on readback', async () => {
  const initial = on().replace(/<ts:(modificationUser|modificationDateTime|isLocal|isSelected)>[^<]*<\/ts:\1>/g, '');
  expect(await fixture(initial, () => state).run(false)).toMatchObject({ ok: true, state: 'updated' });
  expect(puts()).toHaveLength(1);
});
it('accepts an empty scalar modification user/date while preserving literal scalar semantics', async () => {
  const initial = on().replace(/<ts:(modificationUser|modificationDateTime)>[^<]*<\/ts:\1>/g, '<ts:$1/>');
  expect(await fixture(initial, () => state).run(false)).toMatchObject({ ok: true, state: 'updated' });
  expect(puts()).toHaveLength(1);
});
