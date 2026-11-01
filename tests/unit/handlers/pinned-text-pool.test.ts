import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pinnedMutationContext } from '../../../src/adt/mutation-context.js';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { type TextElementPart, writeTextElementPartWithPolicy } from '../../../src/adt/text-elements.js';
import { requestContext } from '../../../src/server/context.js';
import { DEFAULT_CONFIG } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const { createPinnedTextPoolContext, pinnedTextPoolResult } = await import(
  '../../../src/handlers/write/pinned-text-pool.js'
);
const { forgetPinnedSourceContext } = await import('../../../src/handlers/write/pinned-source-context.js');
const { writeActionEditTextSymbols } = await import('../../../src/handlers/write/update-delete.js');
const config = {
  ...DEFAULT_CONFIG,
  client: '001',
  allowWrites: true,
  multiTargetEndpoints: true,
  targetId: 'A4H/001',
  ppEnabled: true,
  ppStrict: true,
  allowedPackages: ['$TMP', 'ZTEAM'],
  multiTargetWrite: {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP', 'ZTEAM'],
    allowedTransports: ['A4HK900001'],
    serverAllowedTransports: ['A4HK900001'],
  },
};
let name = 'ZTEXT';
const replacement = '@MaxLength:20\n002=New text';
const replacements = { symbols: replacement, selections: 'P_NEW=New selection', headings: 'listHeader=New heading' };
const active = new Map<TextElementPart, string>(),
  inactive = new Map<TextElementPart, string>();
const calls: {
  path: string;
  method: string;
  body: string;
  query: URLSearchParams;
  locked: boolean;
  headers: Headers;
}[] = [];
const unexpected: string[] = [];
let type = 'PROG',
  owner = '',
  pool = '',
  locked = false,
  writes = 0,
  activations = 0,
  fault = '',
  transportable = false;
let cancel: AbortController | undefined;
const count = (method: string, path?: string) =>
  calls.filter((call) => call.method === method && (path === undefined || call.path === path));
const poolXml = () =>
  `<rept:textElement xmlns:rept="http://www.sap.com/adt/textelements" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${fault === 'pool-owner' ? 'ZFOREIGN' : name}" adtcore:type="${fault === 'pool-type' ? (type === 'FUGR' ? 'PROG/PX' : 'FUGR/PX') : type === 'CLAS' ? 'CLAS/OCX' : `${type}/PX`}" adtcore:version="${inactive.size || (fault === 'still-inactive' && activations) ? 'inactive' : 'active'}"><adtcore:packageRef adtcore:type="DEVC/K" adtcore:name="${transportable ? 'ZTEAM' : '$TMP'}"/></rept:textElement>`;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  active.clear();
  inactive.clear();
  calls.length = 0;
  unexpected.length = 0;
  active.set('symbols', '@MaxLength:20\n001=Old text');
  active.set('selections', 'P_OLD=Old selection');
  active.set('headings', 'listHeader=Old heading');
  locked = false;
  writes = 0;
  activations = 0;
  fault = '';
  name = 'ZTEXT';
  transportable = false;
  cancel = undefined;
  mockFetch.mockImplementation(async (url, init: RequestInit = {}) => {
    const uri = new URL(String(url)),
      path = uri.pathname.toLowerCase(),
      method = init.method ?? 'GET';
    calls.push({
      path,
      method,
      body: String(init.body ?? ''),
      query: uri.searchParams,
      locked,
      headers: new Headers(init.headers),
    });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'T' });
    if (path === pool && uri.searchParams.get('_action') === 'LOCK') {
      if (fault === 'lock')
        return mockResponse(
          423,
          '<exc:exception xmlns:exc="http://www.sap.com/abapxml/errors" type="ExceptionResourceLocked"><message>Pool locked</message></exc:exception>',
        );
      locked = true;
      if (fault === 'lock-lost') throw new Error('Injected lost LOCK response');
      if (fault === 'lock-server') return mockResponse(503, 'Unconfirmed native lock');
      return mockResponse(
        200,
        `<DATA><LOCK_HANDLE>pool-lock</LOCK_HANDLE><IS_LOCAL>${fault === 'locality' || transportable ? '' : 'X'}</IS_LOCAL><CORRNR>${fault === 'lock-transport' ? 'A4HK900099' : transportable ? 'A4HK900002' : ''}</CORRNR></DATA>`,
        {},
        ['sap-contextid=pool-owner; Path=/'],
      );
    }
    if (path === pool && uri.searchParams.get('_action') === 'UNLOCK') {
      locked = false;
      if (fault === 'cancel-noop') cancel?.abort();
      return mockResponse(fault === 'unlock' ? 503 : 200, '');
    }
    if (path.includes('/http/sessions')) return mockResponse(fault === 'close' ? 503 : 200, '');
    if (path === owner && method === 'GET') {
      const root =
        type === 'CLAS' ? 'class:abapClass' : type === 'FUGR' ? 'group:abapFunctionGroup' : 'program:abapProgram';
      const pkg =
        (fault === 'package-locked' && locked) || (fault === 'package-activation' && writes)
          ? 'ZDENIED'
          : transportable
            ? 'ZTEAM'
            : '$TMP';
      return mockResponse(
        200,
        `<${root} xmlns:group="http://www.sap.com/adt/functions/groups" xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:program="http://www.sap.com/adt/programs/programs" xmlns:adtcore="http://www.sap.com/adt/core" adtcore:name="${name}" adtcore:type="${type === 'CLAS' ? 'CLAS/OC' : type === 'FUGR' ? 'FUGR/F' : 'PROG/P'}" program:programType="executableProgram"><adtcore:packageRef adtcore:name="${pkg}" adtcore:type="DEVC/K"/></${root}>`,
      );
    }
    if (path.includes('/cts/transportchecks'))
      return mockResponse(
        200,
        `<DATA><DEVCLASS>${transportable ? 'ZTEAM' : '$TMP'}</DEVCLASS><DLVUNIT>${transportable ? 'HOME' : 'LOCAL'}</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING>${transportable ? 'X' : ''}</RECORDING></DATA>`,
      );
    if (path.includes('/cts/transportrequests/'))
      if (path.endsWith('/a4hk900099'))
        return mockResponse(
          200,
          '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900099" tm:type="K" tm:status="D"/></tm:root>',
        );
    if (path.includes('/cts/transportrequests/'))
      return mockResponse(
        200,
        '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900001" tm:type="K" tm:status="D"><tm:task tm:number="A4HK900002" tm:status="D"/></tm:request></tm:root>',
      );
    if (path === pool && method === 'GET') {
      if (activations && ['activation-503-recovery-pool', 'activation-503-recovery-both'].includes(fault))
        return mockResponse(500, 'Recovery pool read failed');
      if (new Headers(init.headers).get('Accept') !== 'application/vnd.sap.adt.textelements.v1+xml')
        return mockResponse(406, 'Native pool metadata Accept required');
      let body = poolXml();
      if (fault === 'pool-malformed') body = body.replace('</rept:textElement>', '');
      if (fault === 'pool-doctype') body = `<!DOCTYPE textElement>${body}`;
      if (fault === 'pool-package' || (fault === 'pool-after-unlock' && writes && !locked))
        body = body.replace('adtcore:name="$TMP"', 'adtcore:name="ZFOREIGN"');
      if (fault === 'pool-no-package') body = body.replace(/<adtcore:packageRef[^>]*\/>/, '');
      return mockResponse(200, body);
    }
    if (path.startsWith(`${pool}/source/`)) {
      const part = path.split('/').at(-1) as TextElementPart;
      if (method === 'PUT') {
        if (fault === 'save-partial400') {
          writes++;
          inactive.set(part, String(init.body));
          return mockResponse(400, 'Native error after saving');
        }
        if (fault === 'save-rejected' || fault === 'save-uncertain')
          return mockResponse(fault === 'save-rejected' ? 403 : 503, 'save refused or uncertain');
        writes++;
        if (fault !== 'save-nochange')
          inactive.set(
            part,
            fault === 'save-dropped' ? String(init.body).replace(/^002=.*(?:\n|$)/m, '') : String(init.body),
          );
        return mockResponse(200, '');
      }
      if (method === 'GET') {
        const version = uri.searchParams.get('version');
        if (
          activations &&
          version === 'active' &&
          ['activation-503-recovery-part', 'activation-503-recovery-both'].includes(fault)
        )
          return mockResponse(500, 'Recovery source read failed');
        if ((fault === 'cancel-read' && !writes) || (fault === 'cancel-readback' && writes)) cancel!.abort();
        if (fault === 'readback' && writes) return mockResponse(503, 'readback unavailable');
        if (fault === 'readback-oversized' && writes) return mockResponse(200, 'ü'.repeat(524_289));
        if (version === 'active')
          return mockResponse(
            200,
            fault === 'active-mismatch' && activations ? 'different active content' : (active.get(part) ?? ''),
          );
        if (version === 'inactive')
          return mockResponse(200, inactive.has(part) ? inactive.get(part)! : (active.get(part) ?? ''));
      }
    }
    if (path === '/sap/bc/adt/activation' && method === 'POST') {
      activations++;
      if (fault.startsWith('activation-503')) return mockResponse(503, 'activation uncertain');
      if (fault === 'activation-warning-unconfirmed')
        return mockResponse(
          200,
          '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:msg type="W" shortText="SENTINEL_NATIVE_DIAGNOSTIC" uri="/sap/bc/adt/oo/classes/sentinel_private_uri"/><chkl:properties activationExecuted="false"/></chkl:messages>',
        );
      if (fault === 'activation-native-error')
        return mockResponse(
          200,
          '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:msg type="E" shortText="Text element is not allowed here"/><chkl:properties activationExecuted="false"/></chkl:messages>',
        );
      if (fault === 'activation-expand')
        return mockResponse(
          200,
          '<ioc:inactiveObjects xmlns:ioc="http://www.sap.com/abapxml/inactiveCtsObjects" xmlns:adtcore="http://www.sap.com/adt/core"><ioc:entry><ioc:object><ioc:ref adtcore:uri="/sap/bc/adt/oo/classes/zforeign"/></ioc:object></ioc:entry></ioc:inactiveObjects>',
        );
      for (const [part, body] of inactive) active.set(part, body);
      inactive.clear();
      return mockResponse(
        200,
        fault === 'activation-html'
          ? '<html><body>Login required</body></html>'
          : fault === 'activation-empty'
            ? ''
            : '<chkl:messages xmlns:chkl="http://www.sap.com/abapxml/checklist"><chkl:properties activationExecuted="true"/></chkl:messages>',
      );
    }
    unexpected.push(`${method} ${path}${uri.search}`);
    return mockResponse(500, 'Unexpected fixture request');
  });
});
afterEach(() => expect(unexpected).toEqual([]));

async function write(
  kind = 'PROG',
  part: TextElementPart = 'symbols',
  source = replacement,
  extra: Record<string, unknown> = {},
  settings = config,
  candidateProfile = false,
) {
  type = kind;
  if (typeof extra.name === 'string') name = extra.name;
  const key = encodeURIComponent(name.toLowerCase()).toLowerCase();
  owner = `${type === 'CLAS' ? '/sap/bc/adt/oo/classes' : type === 'FUGR' ? '/sap/bc/adt/functions/groups' : '/sap/bc/adt/programs/programs'}/${key}`;
  pool = `/sap/bc/adt/textelements/${type === 'CLAS' ? 'classes' : type === 'FUGR' ? 'functiongroups' : 'programs'}/${key}`;
  const client = new AdtClient({
    baseUrl: 'http://sap:8000',
    client: '001',
    safety: { ...defaultSafetyConfig(), ...settings },
  });
  if (fault === 'service-missing')
    client.http.setDiscoveryMap(new Map([['/sap/bc/adt/programs/programs', ['application/xml']]]));
  if (fault === 'discovery-conflict')
    client.http.setDiscoveryMap(new Map([[pool.slice(0, pool.lastIndexOf('/')), ['application/x-incorrect']]]));
  const args = {
    action: 'edit_text_symbols',
    type,
    name,
    source,
    textPart: part,
    ...extra,
  };
  const result = await (async () => {
    if (!candidateProfile) return handleToolCall(client, settings, 'SAPWrite', args);
    // The native FUGR profile remains outside public admission until the full family is ready.
    const context = pinnedMutationContext(client.safety, { deadline: Date.now() + 30_000 }, { unlockFailed: false });
    const ctx = createPinnedTextPoolContext(client, args, settings, context);
    try {
      await writeActionEditTextSymbols(ctx);
      return pinnedTextPoolResult(ctx);
    } finally {
      forgetPinnedSourceContext(ctx);
    }
  })();
  let payload: Record<string, any> = {};
  try {
    payload = JSON.parse(result.content[0].text);
  } catch {
    /* Dispatcher refusals can be plain text. */
  }
  return { result, payload };
}

describe('pinned native text-part lifecycle', () => {
  it.each([
    ['save-nochange', replacement],
    ['save-nochange', ''],
    ['save-dropped', '@MaxLength:20\n001=First\n@MaxLength:20\n002=Second'],
  ])('does not activate when a 200 %s fails to persist the requested text', async (issue, source) => {
    fault = issue;
    const { result, payload } = await write('PROG', 'symbols', source);
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ state: 'text-saved-unverified', phase: 'text-readback' });
    expect(payload.message).toContain('requested');
    expect(writes).toBe(1);
    expect(activations).toBe(0);
  });
  it.each(['symbols', 'selections', 'headings'] as const)(
    'verifies the candidate FUGR %s part through the same pool lifecycle',
    async (part) => {
      inactive.set(part === 'headings' ? 'symbols' : 'headings', 'Other pending part');
      const { payload } = await write('FUGR', part, replacements[part], {}, config, true);
      expect(payload).toMatchObject({ state: 'text-saved-active', activePartVerified: true });
      expect(active.get(part)).toBe(replacements[part]);
      expect(active.get(part === 'headings' ? 'symbols' : 'headings')).toBe('Other pending part');
      expect(count('PUT')).toHaveLength(1);
      expect(calls.filter((c) => c.query.get('_action') === 'LOCK').map((c) => c.path)).toEqual([pool]);
      expect(calls.some((c) => c.path === `${owner}/source/main`)).toBe(false);
    },
  );
  it('skips an already active empty FUGR symbols part without creating a draft', async () => {
    active.set('symbols', '');
    const { payload } = await write('FUGR', 'symbols', '', {}, config, true);
    expect(payload.state).toBe('unchanged');
    expect(writes).toBe(0);
    expect(activations).toBe(0);
  });
  it.each(['package-locked', 'pool-type', 'pool-owner'])(
    'refuses candidate FUGR %s evidence before saving',
    async (issue) => {
      fault = issue;
      await expect(write('FUGR', 'symbols', replacement, {}, config, true)).rejects.toThrow();
      expect(writes).toBe(0);
      expect(activations).toBe(0);
    },
  );
  it.each(['pool-no-package', 'discovery-conflict'])('uses independent owner proof with %s', async (condition) => {
    fault = condition;
    const { result, payload } = await write();
    expect(result.isError, result.content[0].text).not.toBe(true);
    expect(payload).toMatchObject({ state: 'text-saved-active', activePartVerified: true });
    expect(count('PUT')).toHaveLength(1);
  });

  it('preserves an explicit empty replacement to clear existing symbols', async () => {
    const { result, payload } = await write('CLAS', 'symbols', '');
    expect(result.isError, result.content[0].text).not.toBe(true);
    expect(payload.state).toBe('text-saved-active');
    expect(active.get('symbols')).toBe('');
    expect(count('PUT')[0].body).toBe('');
    expect(payload.changes).toContain('001');
  });

  it.each(['global', 'destination', 'pp', 'strict', 'deny-action'] as const)(
    'makes no SAP call when %s refuses',
    async (gate) => {
      const settings =
        gate === 'destination'
          ? { ...config, multiTargetWrite: { ...config.multiTargetWrite, enabled: false } }
          : gate === 'deny-action'
            ? { ...config, denyActions: ['SAPWrite.edit_text_symbols'] }
            : { ...config, [gate === 'global' ? 'allowWrites' : gate === 'pp' ? 'ppEnabled' : 'ppStrict']: false };
      const { result } = await write('PROG', 'symbols', replacement, {}, settings);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/blocked|unavailable|denied|forbidden/i);
      expect(calls).toHaveLength(0);
    },
  );

  it.each(['expectedSourceHash', 'include', 'group', 'package'])(
    'refuses an inapplicable %s before SAP',
    async (field) => {
      const { result, payload } = await write('PROG', 'symbols', replacement, {
        [field]: field === 'expectedSourceHash' ? 'a'.repeat(64) : 'ZOTHER',
      });
      expect(result.isError).toBe(true);
      expect(payload.error).toBe('MULTI_TARGET_OPERATION_FORBIDDEN');
      expect(calls).toHaveLength(0);
    },
  );

  it('bounds source by UTF-8 bytes before SAP is called', async () => {
    const { result, payload } = await write('PROG', 'symbols', 'ü'.repeat(524_289));
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ state: 'unchanged', phase: 'validation' });
    expect(payload.message).toContain('1 MiB');
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['FUGR', 'symbols'],
    ['INTF', 'symbols'],
    ['INCL', 'symbols'],
    ['CLAS', 'selections'],
    ['CLAS', 'headings'],
  ] as const)('refuses unadmitted %s %s before SAP', async (kind, part) => {
    const { result, payload } = await write(kind, part);
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ error: 'PINNED_WRITE_REFUSED', state: 'unchanged', phase: 'validation' });
    expect(payload.message).toContain('Operation is unavailable');
    expect(calls).toHaveLength(0);
  });

  it('refuses PROG on BTP before SAP', async () => {
    const { result } = await write('PROG', 'symbols', replacement, {}, { ...config, systemType: 'btp' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Invalid arguments for SAPWrite');
    expect(result.content[0].text).toContain('type');
    expect(calls).toHaveLength(0);
  });

  it.each(['SAPActivate', 'SAPActivate.activate', 'SAPActivate.act*'])(
    'honors %s for implicit text activation before SAP',
    async (deny) => {
      const { result } = await write('CLAS', 'symbols', replacement, {}, { ...config, denyActions: [deny] });
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('unavailable');
      expect(calls).toHaveLength(0);
    },
  );

  it('requires explicit source before SAP', async () => {
    const { result, payload } = await write('PROG', 'symbols', replacement, { source: undefined });
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ state: 'unchanged', phase: 'validation' });
    expect(payload.message).toContain('explicit source');
    expect(calls).toHaveLength(0);
  });

  it.each(['CLAS', 'PROG'])('binds a namespaced %s pool to one encoded URI segment', async (kind) => {
    const { result, payload } = await write(kind, 'symbols', replacement, { name: '/NS/ZTEXT' });
    expect(result.isError, result.content[0].text).not.toBe(true);
    expect(payload).toMatchObject({ name: '/NS/ZTEXT', state: 'text-saved-active', activePartVerified: true });
    const submissions = count('POST', '/sap/bc/adt/activation');
    expect(submissions).toHaveLength(1);
    expect(submissions[0].body).toContain(`/textelements/${kind === 'CLAS' ? 'classes' : 'programs'}/%2FNS%2FZTEXT`);
    expect(count('PUT')).toHaveLength(1);
  });
  it.each([
    ['CLAS', 'symbols'],
    ['PROG', 'symbols'],
    ['PROG', 'selections'],
    ['PROG', 'headings'],
  ] as const)('saves %s %s and verifies the explicit active content', async (kind, part) => {
    const { result, payload } = await write(kind, part, replacements[part]);
    expect(result.isError, result.content[0].text).not.toBe(true);
    expect(payload).toMatchObject({ state: 'text-saved-active', textPart: part, activePartVerified: true });
    expect(payload).not.toHaveProperty('sourceHash');
    expect(active.get(part)).toBe(replacements[part]);
    expect(count('PUT')).toHaveLength(1);
    expect(count('PUT')[0]).toMatchObject({ locked: true, path: `${pool}/source/${part}`, body: replacements[part] });
    expect(count('GET', owner)).toHaveLength(3);
    expect(count('GET', pool).map((call) => call.headers.get('Accept'))).toEqual(
      Array(3).fill('application/vnd.sap.adt.textelements.v1+xml'),
    );
    const submissions = count('POST', '/sap/bc/adt/activation');
    expect(submissions).toHaveLength(1);
    expect(submissions[0].locked).toBe(false);
    expect(submissions[0].body).toContain(`adtcore:uri="${pool.replace('ztext', name)}"`);
    expect(submissions[0].body).not.toContain(owner);
    expect(submissions[0].query.get('preauditRequested')).toBe('false');
    expect(count('GET', `${pool}/source/${part}`).map((call) => call.query.get('version'))).toEqual([
      'inactive',
      'inactive',
      'active',
    ]);
    expect(count('PUT')[0].headers.get('Cookie')).toContain('sap-contextid=pool-owner');
    expect(count('PUT')[0].headers.get('Accept')).toBe(count('PUT')[0].headers.get('Content-Type'));
    expect(count('PUT')[0].headers.get('Accept')).toBe(`application/vnd.sap.adt.textelements.${part}.v1`);
    expect(submissions[0].headers.get('Cookie')).toContain('sap-contextid=pool-owner');
    expect(calls.filter((call) => call.path.includes('/http/sessions'))).toHaveLength(1);
  });

  it('preserves other pending parts and explicitly activates the complete pool', async () => {
    inactive.set('headings', 'listHeader=Previously pending');
    const { payload } = await write();
    expect(payload.state).toBe('text-saved-active');
    expect(active.get('headings')).toBe('listHeader=Previously pending');
    expect(count('PUT').map((call) => call.path)).toEqual([`${pool}/source/symbols`]);
    expect(payload.next).toContain('other text parts');
    expect(payload.changes).toContain('001');
  });

  it.each([false, true])('handles explicit empty symbols with inactive draft=%s', async (draft) => {
    active.set('symbols', '');
    if (draft) inactive.set('symbols', '');
    const { result, payload } = await write('CLAS', 'symbols', '');
    expect(result.isError, result.content[0].text).not.toBe(true);
    expect(payload.state).toBe(draft ? 'text-saved-active' : 'unchanged');
    expect(payload.activePartVerified).toBe(true);
    expect(count('PUT')).toHaveLength(draft ? 1 : 0);
    expect(activations).toBe(draft ? 1 : 0);
  });

  it('uses the verified parent request on a transportable text save', async () => {
    transportable = true;
    const { result, payload } = await write('PROG', 'symbols', replacement, { transport: 'A4HK900002' });
    expect(result.isError, result.content[0].text).not.toBe(true);
    expect(payload.transport).toBe('A4HK900001');
    expect(count('PUT')[0].query.get('corrNr')).toBe('A4HK900001');
  });

  it.each([
    ['save-rejected', 'text-save-unknown', 'text-save'],
    ['save-partial400', 'text-save-unknown', 'text-save'],
    ['save-uncertain', 'text-save-unknown', 'text-save'],
    ['readback', 'text-saved-unverified', 'text-readback'],
    ['readback-oversized', 'text-saved-unverified', 'text-readback'],
    ['activation-503', 'text-activation-unknown', 'text-pool-verification'],
    ['activation-empty', 'text-activation-not-confirmed', 'text-pool-verification'],
    ['activation-html', 'text-activation-not-confirmed', 'text-pool-verification'],
    ['activation-expand', 'text-activation-not-confirmed', 'text-pool-verification'],
    ['active-mismatch', 'text-activation-not-confirmed', 'text-pool-verification'],
    ['still-inactive', 'text-activation-not-confirmed', 'text-pool-verification'],
    ['unlock', 'text-saved-inactive', 'unlock'],
    ['close', 'text-saved-active', 'session-close'],
  ])('retains native progress after %s', async (failure, state, phase) => {
    fault = failure;
    const { result, payload } = await write();
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ state, phase, retryable: false, textPart: 'symbols' });
    expect(count('PUT')).toHaveLength(1);
    expect(activations).toBe(
      ['save-rejected', 'save-partial400', 'save-uncertain', 'readback', 'readback-oversized', 'unlock'].includes(
        failure,
      )
        ? 0
        : 1,
    );
    expect(count('POST', '/sap/bc/adt/activation').every((call) => !call.body.includes('zforeign'))).toBe(true);
    if (failure === 'save-partial400') {
      expect(payload.statusCode).toBe(400);
      expect(inactive.get('symbols')).toBe(replacement);
    }
    if (failure === 'close') expect(payload).toMatchObject({ activePartVerified: true, cleanupFailed: true });
    if (failure === 'activation-empty')
      expect(payload).toMatchObject({ textPoolState: 'active', activePartVerified: true });
    if (failure === 'activation-503')
      expect(payload).toMatchObject({ textPoolState: 'inactive', activePartVerified: false, statusCode: 503 });
    if (failure === 'unlock') expect(payload.cleanupFailed).toBe(true);
  });

  it('keeps native activation errors and read-only pool observations', async () => {
    fault = 'activation-native-error';
    const { result, payload } = await write();
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      phase: 'text-pool-verification',
      textPoolState: 'inactive',
      activePartVerified: false,
      nativeActivation: { success: false, messages: ['Text element is not allowed here'] },
    });
    expect(payload.message).not.toContain('Text element is not allowed here');
    expect(activations).toBe(1);
  });

  it.each([true, false])(
    'respects minimalErrors=%s for retained native activation diagnostics',
    async (minimalErrors) => {
      for (const failure of ['activation-native-error', 'activation-warning-unconfirmed']) {
        fault = failure;
        const { result, payload } = await write('PROG', 'symbols', replacement, {}, { ...config, minimalErrors });
        const sentinel =
          failure === 'activation-native-error' ? 'Text element is not allowed here' : 'SENTINEL_NATIVE_DIAGNOSTIC';
        expect(result.isError).toBe(true);
        expect(payload.message).not.toContain(sentinel);
        if (minimalErrors) {
          expect(payload.nativeActivation).toEqual({ success: false });
          expect(result.content[0].text).not.toContain(sentinel);
          expect(result.content[0].text).not.toContain('sentinel_private_uri');
        } else expect(payload.nativeActivation.messages).toContain(sentinel);
      }
    },
  );

  it.each(['001=first\n001=second', '001=text\n@MaxLength:20', '@Unknown:x\n001=text', '=== symbols ===\n001=text'])(
    'refuses unverifiable text before lock or save: %s',
    async (source) => {
      const { result, payload } = await write('PROG', 'symbols', source);
      expect(result.isError).toBe(true);
      expect(payload).toMatchObject({ state: 'unchanged', phase: 'validation' });
      expect(payload.message).toMatch(/cannot verify|unverifiable/i);
      expect(calls).toHaveLength(0);
    },
  );

  it.each(['pool', 'part', 'both'])(
    'preserves unknown activation and its 503 when recovery %s fails',
    async (failure) => {
      fault = `activation-503-recovery-${failure}`;
      const { result, payload } = await write();
      expect(result.isError).toBe(true);
      expect(payload).toMatchObject({
        state: 'text-activation-unknown',
        phase: 'text-pool-verification',
        statusCode: 503,
        activationOutcome: 'unknown',
      });
      expect(payload.activationRecovery).toContain('SAP may still finish');
      expect(payload.verificationFailures).toEqual(
        failure === 'both' ? ['pool-state', 'active-part'] : [failure === 'pool' ? 'pool-state' : 'active-part'],
      );
      expect(payload.textPoolState).toBe(failure === 'part' ? 'inactive' : 'unknown');
      expect(payload.activePartVerified).toBe(failure === 'pool' ? false : undefined);
      expect(activations).toBe(1);
      expect(count('PUT')).toHaveLength(1);
    },
  );

  it.each(['afterUnlock', 'afterUnlockNeeded', 'confirmedResourceDeletion'])(
    'rejects a supplied %s text profile before HTTP',
    async (field) => {
      const client = new AdtClient({
        baseUrl: 'http://sap:8000',
        client: '001',
        safety: { ...defaultSafetyConfig(), ...config },
      });
      const context = pinnedMutationContext(client.safety, { deadline: Date.now() + 30_000 }, { unlockFailed: false });
      await expect(
        writeTextElementPartWithPolicy(client.http, client.safety, 'PROG', 'ZTEXT', 'symbols', replacement, undefined, {
          mode: 'pinned-pp',
          ownerType: 'PROG',
          ownerName: 'ZTEXT',
          ownerPackage: '$TMP',
          context,
          lockPolicy: { beforeLock: () => {}, validateLock: async () => {}, [field]: () => false },
          validateActivationOwner: async () => {},
          onPhase: () => {},
        }),
      ).rejects.toThrow('Select the dedicated admitted text-pool ownership profile.');
      expect(calls).toHaveLength(0);
    },
  );

  it.each(['missing-transport', 'lock-transport', 'lock-lost', 'lock-server'])(
    'refuses %s before any text save or activation',
    async (failure) => {
      fault = failure;
      transportable = ['missing-transport', 'lock-transport'].includes(failure);
      const { result, payload } = await write(
        'PROG',
        'symbols',
        replacement,
        failure === 'lock-transport' ? { transport: 'A4HK900002' } : {},
      );
      expect(result.isError).toBe(true);
      expect(payload).toMatchObject({
        state: 'unchanged',
        retryable: false,
        phase:
          failure === 'missing-transport'
            ? 'recording-preflight'
            : failure === 'lock-transport'
              ? 'locked-policy'
              : 'lock',
      });
      expect(count('PUT')).toHaveLength(0);
      if (failure === 'lock-lost' || failure === 'lock-server') {
        expect(payload).toMatchObject({ lockOutcome: 'unknown', cleanupUnconfirmed: true });
        expect(payload.lockRecovery).toContain('SM12');
        expect(payload.unknownLocks).toHaveLength(1);
        expect(payload.unknownLocks[0].uri).toBe('/sap/bc/adt/textelements/programs/ZTEXT');
      }
      expect(activations).toBe(0);
      expect(calls.filter((call) => call.query.get('_action') === 'LOCK')).toHaveLength(
        failure === 'missing-transport' ? 0 : 1,
      );
    },
  );

  it('refuses pool identity drift after unlock before activation', async () => {
    fault = 'pool-after-unlock';
    const { result, payload } = await write();
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ phase: 'text-activation-preflight', state: 'text-saved-inactive' });
    expect(count('PUT')).toHaveLength(1);
    expect(activations).toBe(0);
  });

  it('reports no-op cleanup failure without inventing a skipped activation failure', async () => {
    active.set('symbols', '');
    fault = 'unlock';
    const { result, payload } = await write('CLAS', 'symbols', '');
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      phase: 'unlock',
      state: 'unchanged',
      activePartVerified: true,
      cleanupFailed: true,
    });
    expect(payload.message).not.toContain('not sent');
    expect(activations).toBe(0);
    expect(count('PUT')).toHaveLength(0);
  });

  it.each([
    ['pool-owner', 'text-pool-read', /Cannot verify/],
    ['pool-type', 'text-pool-read', /Cannot verify/],
    ['pool-malformed', 'text-pool-read', /Cannot verify/],
    ['pool-doctype', 'text-pool-read', /Cannot verify/],
    ['pool-package', 'text-pool-read', /package.*owner package/i],
    ['service-missing', 'text-pool-service', /native ADT textelements service/i],
    ['locality', 'locked-policy', /recording context/i],
    ['package-locked', 'locked-policy', /package/i],
    ['lock', 'lock', /No create/],
  ] as const)('refuses %s before saving', async (failure, phase, message) => {
    fault = failure;
    const { result, payload } = await write();
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({ state: 'unchanged', phase });
    expect(payload.message).toMatch(message);
    if (['pool-owner', 'pool-type', 'pool-malformed', 'pool-doctype'].includes(failure))
      expect(payload.statusCode).toBeUndefined();
    expect(count('PUT')).toHaveLength(0);
    expect(activations).toBe(0);
  });

  it('rechecks the owner before activation and retains the saved draft on package drift', async () => {
    fault = 'package-activation';
    const { payload } = await write();
    expect(payload).toMatchObject({ state: 'text-saved-inactive', phase: 'text-activation-preflight' });
    expect(payload.message).toMatch(/package/i);
    expect(count('PUT')).toHaveLength(1);
    expect(activations).toBe(0);
  });

  it.each(['cancel-read', 'cancel-readback'])('stops after %s and still cleans up', async (failure) => {
    fault = failure;
    cancel = new AbortController();
    const { result, payload } = await requestContext.run({ requestId: 'pool-cancel', signal: cancel.signal }, () =>
      write(),
    );
    expect(result.isError).toBe(true);
    expect(payload.state).toBe(failure === 'cancel-read' ? 'unchanged' : 'text-saved-inactive');
    expect(payload.phase).toBe(failure === 'cancel-read' ? 'text-pool-read' : 'unlock');
    expect(count('PUT')).toHaveLength(failure === 'cancel-read' ? 0 : 1);
    expect(activations).toBe(0);
    expect(calls.filter((call) => call.query.get('_action') === 'UNLOCK')).toHaveLength(1);
    expect(calls.filter((call) => call.path.includes('/http/sessions'))).toHaveLength(1);
  });

  it('retains a verified no-op when cancellation arrives during cleanup', async () => {
    active.set('symbols', '');
    fault = 'cancel-noop';
    cancel = new AbortController();
    const { result, payload } = await requestContext.run({ requestId: 'noop-cancel', signal: cancel.signal }, () =>
      write('CLAS', 'symbols', ''),
    );
    expect(cancel.signal.aborted).toBe(true);
    expect(result.isError).not.toBe(true);
    expect(payload).toMatchObject({ state: 'unchanged', activePartVerified: true });
    expect(count('PUT')).toHaveLength(0);
    expect(activations).toBe(0);
    expect(calls.filter((call) => call.query.get('_action') === 'UNLOCK')).toHaveLength(1);
    expect(calls.filter((call) => call.path.includes('/http/sessions'))).toHaveLength(1);
  });
});
