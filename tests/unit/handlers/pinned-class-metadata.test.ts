import { readFileSync } from 'node:fs';
import { beforeEach, expect, it, vi } from 'vitest';
import { defaultSafetyConfig } from '../../../src/adt/safety.js';
import { sourceHash } from '../../../src/adt/source-precondition.js';
import { requestContext } from '../../../src/server/context.js';
import { DEFAULT_CONFIG, type ServerConfig } from '../../../src/server/types.js';
import { mockResponse } from '../../helpers/mock-fetch.js';
import { AdtClient, mockFetch } from './setup-undici-mock.js';

const { handleToolCall } = await import('../../../src/handlers/dispatch.js');
const quality = await import('../../../src/handlers/write-helpers.js');
const source = readFileSync(new URL('../../fixtures/class-surgery/pinned.abap', import.meta.url), 'utf8');
const xml = readFileSync(new URL('../../fixtures/class-surgery/pinned.xml', import.meta.url), 'utf8');
let owner = '/sap/bc/adt/oo/classes/zcl_proof';
const config = {
  ...DEFAULT_CONFIG,
  client: '001',
  targetId: 'A4H/001',
  multiTargetEndpoints: true,
  allowWrites: true,
  ppEnabled: true,
  ppStrict: true,
  lintBeforeWrite: false,
  allowedPackages: ['$TMP'],
  multiTargetWrite: {
    enabled: true,
    target: 'A4H/001',
    allowedPackages: ['$TMP'],
    allowedTransports: [],
    serverAllowedTransports: [],
  },
};
const requests: { path: string; method: string; locked: boolean; body: string }[] = [];
let stored = source,
  metadata = xml,
  locked = false,
  saved = false;
let transportable = false;
let fault = '',
  cancel: AbortController | undefined;
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  requests.length = 0;
  owner = '/sap/bc/adt/oo/classes/zcl_proof';
  stored = source;
  metadata = xml;
  locked = false;
  saved = false;
  fault = '';
  transportable = false;
  cancel = undefined;
  mockFetch.mockImplementation(async (url, init: any = {}) => {
    const uri = new URL(String(url)),
      path = uri.pathname.toLowerCase(),
      method = init.method ?? 'GET';
    requests.push({ path: path + uri.search, method, locked, body: String(init.body ?? '') });
    if (method === 'HEAD') return mockResponse(200, '', { 'x-csrf-token': 'token' });
    if (uri.searchParams.get('_action') === 'LOCK') {
      locked = true;
      return mockResponse(
        200,
        `<DATA><LOCK_HANDLE>owner-lock</LOCK_HANDLE><CORRNR>${transportable ? 'A4HK900002' : ''}</CORRNR><IS_LOCAL>${transportable ? '' : 'X'}</IS_LOCAL></DATA>`,
        {
          'set-cookie': 'sap-contextid=owned; Path=/',
        },
      );
    }
    if (uri.searchParams.get('_action') === 'UNLOCK') {
      locked = false;
      return mockResponse(fault === 'unlock' ? 503 : 200, '');
    }
    if (path.includes('/http/sessions')) return mockResponse(fault === 'close' ? 503 : 200, '');
    if (path === owner && method === 'GET')
      return mockResponse(
        200,
        `<class:abapClass xmlns:class="http://www.sap.com/adt/oo/classes" xmlns:adtcore="http://www.sap.com/adt/core"><adtcore:packageRef adtcore:name="${fault === 'package' && locked ? 'ZFOREIGN' : transportable ? 'ZTEAM' : '$TMP'}"/></class:abapClass>`,
      );
    if (path.includes('transportchecks'))
      return mockResponse(
        200,
        `<DATA><DEVCLASS>${transportable ? 'ZTEAM' : '$TMP'}</DEVCLASS><DLVUNIT>${transportable ? 'HOME' : 'LOCAL'}</DLVUNIT><OPERATION/><RESULT>S</RESULT><RECORDING>${transportable || (fault === 'recording' && locked) ? 'X' : ''}</RECORDING></DATA>`,
      );
    if (path.includes('transportrequests'))
      return mockResponse(
        200,
        '<tm:root xmlns:tm="http://www.sap.com/cts/adt/tm"><tm:request tm:number="A4HK900001" tm:type="K" tm:status="D"><tm:task tm:number="A4HK900002" tm:status="D"/></tm:request></tm:root>',
      );
    if (path === `${owner}/objectstructure`) {
      expect(locked).toBe(true);
      if (cancel) cancel.abort();
      return mockResponse(fault === 'metadata' ? 503 : 200, metadata);
    }
    if (path === `${owner}/source/main`) {
      expect(locked).toBe(true);
      if (method === 'GET')
        return mockResponse(
          saved && fault === 'readback-status' ? 503 : 200,
          saved && fault === 'readback-mismatch' ? 'foreign' : stored,
        );
      expect(method).toBe('PUT');
      expect(uri.searchParams.get('lockHandle')).toBe('owner-lock');
      if (fault === 'save') return mockResponse(503, 'unavailable');
      stored = String(init.body);
      saved = true;
      return mockResponse(200, '');
    }
    throw Error(`Unexpected request ${method} ${path}`);
  });
});
const inputs: Record<string, Record<string, unknown>> = {
  edit_class_definition: {
    source: source
      .slice(0, source.indexOf('CLASS zcl_proof IMPLEMENTATION.'))
      .replace('METHODS selected.', 'METHODS selected IMPORTING value TYPE i.'),
  },
  edit_method_signature: { method: 'SELECTED', source: 'METHODS selected IMPORTING value TYPE i.' },
  add_method: { method: 'METHODS added.', visibility: 'public' },
  delete_method: { method: 'SELECTED' },
  change_method_visibility: { method: 'SELECTED', visibility: 'private' },
};
async function invoke(
  action = 'edit_method_signature',
  extra: Record<string, unknown> = {},
  settings: ServerConfig = config,
) {
  const result = await handleToolCall(
    new AdtClient({ baseUrl: 'http://sap:8000', client: '001', safety: { ...defaultSafetyConfig(), ...settings } }),
    settings,
    'SAPWrite',
    { action, type: 'CLAS', name: 'ZCL_PROOF', ...inputs[action], expectedSourceHash: sourceHash(source), ...extra },
  );
  const text = result.content[0].text;
  return { result, body: text.startsWith('{') ? JSON.parse(text) : { message: text } };
}
it.each(Object.keys(inputs))(
  '%s uses shared editing with verified main/structure under one owner lock',
  async (action) => {
    const { result, body } = await invoke(action);
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(body).toMatchObject({ state: 'saved-inactive', sourceHash: sourceHash(stored), action });
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
    expect(requests.filter((r) => r.path.split('?')[0]?.endsWith('/objectstructure'))).toMatchObject([
      { locked: true },
    ]);
    expect(requests.filter((r) => r.path.split('?')[0]?.endsWith('/source/main') && r.method === 'GET')).toHaveLength(
      2,
    );
    expect(requests.some((r) => r.path.includes('UNLOCK'))).toBe(true);
    expect(locked).toBe(false);
    if (action === 'add_method')
      expect(stored).toBe(
        source
          .replace('    METHODS selected.', '    METHODS selected.\nMETHODS added.')
          .replace('  ENDMETHOD.\nENDCLASS.', '  ENDMETHOD.\n\n  METHOD added.\n  ENDMETHOD.\nENDCLASS.'),
      );
    if (action === 'delete_method')
      expect(stored).toBe(
        source.replace('    METHODS selected.\n', '').replace('  METHOD selected.\n  ENDMETHOD.\n', ''),
      );
    if (action === 'change_method_visibility')
      expect(stored).toBe(
        source
          .replace('    METHODS selected.\n', '')
          .replace('    METHODS neighbor.', '    METHODS neighbor.\n    METHODS selected.'),
      );
    if (action === 'edit_method_signature')
      expect(stored).toBe(source.replace('    METHODS selected.', 'METHODS selected IMPORTING value TYPE i.'));
    if (action === 'edit_class_definition')
      expect(stored).toBe(source.replace('METHODS selected.', 'METHODS selected IMPORTING value TYPE i.'));
  },
);
it('returns explicit verified unchanged visibility without a PUT', async () => {
  const { result, body } = await invoke('change_method_visibility', { visibility: 'public' });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(body).toMatchObject({ state: 'unchanged', sourceHash: sourceHash(source) });
  expect(body.next).toContain('no source was saved');
  expect(requests.some((r) => r.method === 'PUT')).toBe(false);
  expect(locked).toBe(false);
});
it.each(['package', 'recording', 'metadata'])(
  'refuses %s failure before saving and closes the owner session',
  async (value) => {
    fault = value;
    const { result } = await invoke();
    expect(result.isError).toBe(true);
    expect(stored).toBe(source);
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
    expect(requests.some((r) => r.path.includes('UNLOCK'))).toBe(true);
    expect(locked).toBe(false);
  },
);
it.each(['owner', 'version', 'inventory', 'columns'])(
  'refuses mismatched %s metadata under lock without PUT',
  async (what) => {
    metadata =
      what === 'owner'
        ? xml.replace('adtcore:name="ZCL_PROOF"', 'adtcore:name="WRONG"')
        : what === 'version'
          ? xml.replace('./source/main#', './source/main?version=active#')
          : what === 'inventory'
            ? xml.replace('adtcore:name="SELECTED"', 'adtcore:name="MISSING"')
            : xml.replace('start=3,4;end=3,20', 'start=3,4;end=3,21');
    const { result } = await invoke();
    expect(result.isError).toBe(true);
    expect(stored).toBe(source);
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
    expect(locked).toBe(false);
  },
);
it.each([undefined, 'a'.repeat(64)])('rejects missing/stale source hash %s before metadata/save', async (hash) => {
  const { result } = await invoke('edit_method_signature', { expectedSourceHash: hash });
  expect(result.isError).toBe(true);
  expect(requests.some((r) => r.path.split('?')[0]?.endsWith('/objectstructure') || r.method === 'PUT')).toBe(false);
});
it.each(['save', 'readback-status', 'readback-mismatch'])(
  'reports an unconfirmed save after %s without replay',
  async (value) => {
    fault = value;
    const { result, body } = await invoke();
    expect(result.isError).toBe(true);
    expect(body.state).toBe('source-save-unknown');
    expect(body.sourceHash).toBeUndefined();
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
    expect(locked).toBe(false);
  },
);
it.each(['unlock', 'close'])('retains the confirmed save/hash but reports %s failure', async (value) => {
  fault = value;
  const { result, body } = await invoke();
  expect(result.isError).toBe(true);
  expect(body).toMatchObject({ state: 'saved-inactive', sourceHash: sourceHash(stored) });
  expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
});
it('retains configured lint warnings through the pinned result', async () => {
  vi.spyOn(quality, 'runPreWriteLint').mockReturnValue({ blocked: false, warnings: 'review this warning' });
  const { result, body } = await invoke('add_method');
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(body.warnings).toBe('review this warning');
});
it('does not lint intermediate signature edits', async () => {
  const lint = vi.spyOn(quality, 'runPreWriteLint');
  const { result } = await invoke('edit_method_signature', {}, { ...config, lintBeforeWrite: true });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(lint).not.toHaveBeenCalled();
});
it('honors cancellation during native metadata and still cleans up', async () => {
  cancel = new AbortController();
  const { result } = await requestContext.run({ requestId: 'metadata-cancel', signal: cancel.signal }, () => invoke());
  expect(result.isError).toBe(true);
  expect(requests.some((r) => r.method === 'PUT')).toBe(false);
  expect(locked).toBe(false);
});
it.each([{ include: 'definitions' }, { type: 'INTF' }, { lintBeforeWrite: false }, { objects: [] }])(
  'rejects unadmitted metadata arguments before native work: %j',
  async (extra) => {
    const { result } = await invoke('edit_method_signature', extra);
    expect(result.isError).toBe(true);
    expect(requests).toHaveLength(0);
  },
);

for (const pinned of [true, false]) {
  it.each([
    ['edit_method_signature', { source: 'METHODS renamed.' }],
    ['edit_method_signature', { source: 'METHODS selected.\nMETHODS neighbor.' }],
    ['edit_method_signature', { source: '" removed' }],
    ['edit_method_signature', { source: 'METHODS selected.\nENDCLASS.\nCLASS lcl_x DEFINITION.\nPUBLIC SECTION.' }],
    ['edit_method_signature', { source: 'METHODS: selected.' }],
    ['add_method', { method: 'METHODS added. METHODS other.' }],
    ['add_method', { method: 'METHODS added.\nENDCLASS.\nCLASS lcl_x DEFINITION.\nPUBLIC SECTION.' }],
    [
      'edit_class_definition',
      { source: String(inputs.edit_class_definition!.source).replace('zcl_proof', 'zcl_foreign') },
    ],
    [
      'edit_class_definition',
      { source: String(inputs.edit_class_definition!.source) + '\nCLASS lcl_x DEFINITION.\nENDCLASS.' },
    ],
  ])(
    `${pinned ? 'pinned' : 'single-target'} %s refuses replacement outside the selected construct`,
    async (action, extra) => {
      const settings = pinned
        ? config
        : {
            ...config,
            multiTargetEndpoints: false,
            multiTargetWrite: undefined,
            targetId: undefined,
            ppEnabled: false,
            ppStrict: false,
          };
      const { result } = await invoke(action as string, extra as Record<string, unknown>, settings);
      expect(result.isError, result.content[0].text).toBe(true);
      expect(result.content[0].text).toContain('Replacement must contain');
      expect(requests.some((r) => r.method === 'PUT')).toBe(false);
      expect(locked).toBe(false);
    },
  );
}
it.each(['unlock', 'close'])('reports %s failure after a verified visibility no-op', async (value) => {
  fault = value;
  const { result, body } = await invoke('change_method_visibility', { visibility: 'public' });
  expect(result.isError).toBe(true);
  expect(body.state).toBe('unchanged');
  expect(body.retryable).toBe(false);
  expect(body.phase).toBe(value === 'unlock' ? 'unlock' : 'session-close');
  expect(requests.some((r) => r.method === 'PUT')).toBe(false);
});

const chainSource = readFileSync(new URL('../../fixtures/class-surgery/pinned-chain.abap', import.meta.url), 'utf8');
const chainXml = readFileSync(new URL('../../fixtures/class-surgery/pinned-chain.xml', import.meta.url), 'utf8');
it('adds after a fully verified chain while preserving all original declarations and bodies', async () => {
  stored = chainSource;
  metadata = chainXml;
  const { result } = await invoke('add_method', { expectedSourceHash: sourceHash(chainSource) });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(stored).toBe(
    chainSource
      .replace('      neighbor.\n', '      neighbor.\nMETHODS added.\n')
      .replace(
        '  METHOD neighbor.\n  ENDMETHOD.\nENDCLASS.',
        '  METHOD neighbor.\n  ENDMETHOD.\n\n  METHOD added.\n  ENDMETHOD.\nENDCLASS.',
      ),
  );
});
it('returns the actionable chain refusal on the pinned route', async () => {
  stored = chainSource;
  metadata = chainXml;
  const { result } = await invoke('edit_method_signature', { expectedSourceHash: sourceHash(chainSource) });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('Chained METHODS declarations');
  expect(result.content[0].text).toContain('complete class source update');
  expect(requests.some((r) => r.method === 'PUT')).toBe(false);
});
it('blocks invalid replacement syntax with real configured lint, then unlocks', async () => {
  const lint = vi.spyOn(quality, 'runPreWriteLint');
  const { result } = await invoke(
    'edit_class_definition',
    {
      source: String(inputs.edit_class_definition!.source).replace(
        'PUBLIC SECTION.',
        'PUBLIC SECTION.\n DATA broken TYPE .',
      ),
    },
    { ...config, lintBeforeWrite: true },
  );
  expect(lint.mock.results[0]?.value.blocked).toBe(true);
  expect(result.isError).toBe(true);
  expect(requests.some((r) => r.method === 'PUT')).toBe(false);
  expect(locked).toBe(false);
});
const transportSettings = {
  ...config,
  allowedPackages: ['$TMP', 'ZTEAM'],
  multiTargetWrite: {
    ...config.multiTargetWrite,
    allowedPackages: ['$TMP', 'ZTEAM'],
    allowedTransports: ['A4HK900001'],
    serverAllowedTransports: ['A4HK900001'],
  },
};
it('records a metadata source save on the verified parent request', async () => {
  transportable = true;
  const { result, body } = await invoke('edit_method_signature', { transport: 'A4HK900002' }, transportSettings);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
  expect(requests.find((r) => r.method === 'PUT')!.path).toContain('corrNr=A4HK900001');
  expect(body.transport).toBe('A4HK900001');
});
it.each(['no-op', 'refusal'])('omits a selected transport from an unchanged %s result', async (outcome) => {
  transportable = true;
  if (outcome === 'refusal') fault = 'metadata';
  const { result, body } = await invoke(
    'change_method_visibility',
    { visibility: 'public', transport: 'A4HK900002' },
    transportSettings,
  );
  expect(!!result.isError).toBe(outcome === 'refusal');
  expect(body.state).toBe('unchanged');
  expect(body).not.toHaveProperty('transport');
  expect(requests.some((r) => r.method === 'PUT')).toBe(false);
});

it('retains all methods when replacing an ordinary definition with a chain', async () => {
  const definition = chainSource.slice(0, chainSource.indexOf('CLASS zcl_proof IMPLEMENTATION.'));
  const { result } = await invoke('edit_class_definition', { source: definition });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(stored).toBe(chainSource);
});
it('counts a newly added chained method before refusing an orphan declaration', async () => {
  const definition = chainSource
    .slice(0, chainSource.indexOf('CLASS zcl_proof IMPLEMENTATION.'))
    .replace('      neighbor.', '      neighbor,\n      added.');
  const { result } = await invoke('edit_class_definition', { source: definition });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('ADDED');
  expect(result.content[0].text).toContain('no matching');
  expect(requests.some((r) => r.method === 'PUT')).toBe(false);
});

it('explains a shared-line declaration refusal on the pinned route', async () => {
  stored = source
    .replace('    METHODS selected.', '    METHODS selected. METHODS neighbor.')
    .replace('    METHODS neighbor.\n', '\n');
  metadata = xml
    .replace('start=5,4;end=5,20', 'start=3,22;end=3,38')
    .replace('visibility="private"', 'visibility="public"');
  const { result } = await invoke('edit_method_signature', { expectedSourceHash: sourceHash(stored) });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('safely isolate the selected source boundary');
  expect(result.content[0].text).toContain('complete editable source');
  expect(requests.some((r) => r.method === 'PUT')).toBe(false);
  expect(locked).toBe(false);
});

const interfaceSource = readFileSync(
  new URL('../../fixtures/class-surgery/pinned-interface.abap', import.meta.url),
  'utf8',
);
const interfaceXml = readFileSync(
  new URL('../../fixtures/class-surgery/pinned-interface.xml', import.meta.url),
  'utf8',
);
it.each(['add_method', 'delete_method', 'edit_class_definition'])(
  'preserves direct interface implementations through %s',
  async (action) => {
    stored = interfaceSource;
    metadata = interfaceXml;
    const definition = interfaceSource.slice(0, interfaceSource.indexOf('CLASS zcl_proof IMPLEMENTATION.'));
    const { result } = await invoke(action, {
      expectedSourceHash: sourceHash(stored),
      ...(action === 'edit_class_definition'
        ? { source: definition.replace('METHODS selected.', 'METHODS selected IMPORTING value TYPE i.') }
        : {}),
    });
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(stored).toContain('INTERFACES lif_x.');
    expect(stored).toContain('  METHOD lif_x~run.\n  ENDMETHOD.');
    expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(1);
  },
);
it.each(['removed-interface', 'new-abstract', 'abstract-parameter', 'abstract-name'])(
  'refuses incomplete definition/body symmetry: %s',
  async (change) => {
    if (change === 'removed-interface') {
      stored = interfaceSource;
      metadata = interfaceXml;
    }
    let definition = stored.slice(0, stored.indexOf('CLASS zcl_proof IMPLEMENTATION.'));
    definition =
      change === 'removed-interface'
        ? definition.replace('    INTERFACES lif_x.\n', '')
        : change === 'new-abstract'
          ? definition.replace('METHODS selected.', 'METHODS selected ABSTRACT.')
          : definition.replace(
              'METHODS selected.',
              `METHODS selected.\n    METHODS ${change === 'abstract-name' ? 'abstract.' : 'added IMPORTING abstract TYPE i.'}`,
            );
    const { result, body } = await invoke('edit_class_definition', {
      source: definition,
      expectedSourceHash: sourceHash(stored),
    });
    expect(result.isError).toBe(true);
    expect(body.state).toBe('unchanged');
    expect(requests.some((r) => r.method === 'PUT')).toBe(false);
  },
);
it('refuses an interface-only signature edit with a complete-source remedy', async () => {
  stored = interfaceSource;
  metadata = interfaceXml;
  const { result } = await invoke('edit_method_signature', {
    method: 'LIF_X~RUN',
    source: 'METHODS lif_x~run REDEFINITION.',
    expectedSourceHash: sourceHash(stored),
  });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toMatch(/interface|INTERFACES/);
  expect(requests.some((r) => r.method === 'PUT')).toBe(false);
});
it.each(['spaced', 'split'])('inserts before the complete %s ENDCLASS statement', async (shape) => {
  stored = source.replace('METHODS selected.', 'METHODS selected .');
  metadata = xml.replace('start=3,4;end=3,20', 'start=3,4;end=3,21');
  if (shape === 'spaced') {
    stored = stored.replace(/ENDCLASS\.\n$/, 'ENDCLASS .\n');
    metadata = metadata.replace('end=12,8', 'end=12,9');
  } else {
    stored = stored.replace(/ENDCLASS\.\n$/, 'ENDCLASS\n.\n');
    metadata = metadata.replace('end=12,8', 'end=13,0');
  }
  const closing = shape === 'spaced' ? 'ENDCLASS .\n' : 'ENDCLASS\n.\n';
  const { result } = await invoke('add_method', { expectedSourceHash: sourceHash(stored) });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(stored).toContain(`METHOD added.\n  ENDMETHOD.\n${closing}`);
});
it('uses the encoded owning URL for namespaced class surgery', async () => {
  stored = source.replaceAll('zcl_proof', '/nsp/demo');
  metadata = xml.replaceAll('ZCL_PROOF', '/NSP/DEMO').replaceAll('zcl_proof', '%2fnsp%2fdemo');
  owner = '/sap/bc/adt/oo/classes/%2fnsp%2fdemo';
  const { result } = await invoke('add_method', { name: '/NSP/DEMO', expectedSourceHash: sourceHash(stored) });
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(requests.find((r) => r.method === 'PUT')?.path).toContain(owner);
});

it('refuses removing ABSTRACT when no implementation body exists', async () => {
  stored = source
    .replace('CLASS zcl_proof DEFINITION.', 'CLASS zcl_proof DEFINITION ABSTRACT.')
    .replace('METHODS selected.', 'METHODS selected ABSTRACT.')
    .replace('  METHOD selected.\n  ENDMETHOD.\n', '');
  const selected = xml.match(
    /<abapsource:objectStructureElement adtcore:type="CLAS\/OM" adtcore:name="SELECTED"[\s\S]*?<\/abapsource:objectStructureElement>/,
  )![0];
  const child = selected
    .replace('adtcore:name="SELECTED"', 'adtcore:name="SELECTED" abstract="true"')
    .replace(/<atom:link rel="[^\n]*\/implementation[^\n]*\n/g, '')
    .replace('start=3,4;end=3,20', 'start=3,4;end=3,29');
  metadata = xml
    .replace(selected, child)
    .replace('end=12,8', 'end=10,8')
    .replace('start=10,2;end=11,11', 'start=8,2;end=9,11');
  const definition = stored
    .slice(0, stored.indexOf('CLASS zcl_proof IMPLEMENTATION.'))
    .replace('METHODS selected ABSTRACT.', 'METHODS selected.');
  const { result } = await invoke('edit_class_definition', {
    source: definition,
    expectedSourceHash: sourceHash(stored),
  });
  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('Changing ABSTRACT');
  expect(requests.some((r) => r.method === 'PUT')).toBe(false);
});
it.each(['edit_method_signature', 'delete_method', 'change_method_visibility', 'invalid-signature'])(
  'keeps the narrow legacy namespaced redefinition contract for %s',
  async (action) => {
    const method = 'ZIF_SERVICE~/NS/RUN';
    stored = source
      .replace('METHODS selected.', `METHODS ${method.toLowerCase()} REDEFINITION.`)
      .replace('METHOD selected.', `METHOD ${method.toLowerCase()}.`);
    metadata = xml
      .replace('adtcore:name="SELECTED"', `adtcore:name="${method}" redefinition="true"`)
      .replace('start=3,12;end=3,20', `start=3,12;end=3,${12 + method.length}`)
      .replace('start=8,9;end=8,17', `start=8,9;end=8,${9 + method.length}`)
      .replace('start=3,4;end=3,20', `start=3,4;end=3,${12 + method.length + ' REDEFINITION'.length}`);
    const settings = {
      ...config,
      targetId: undefined,
      multiTargetWrite: undefined,
      multiTargetEndpoints: false,
      ppEnabled: false,
      ppStrict: false,
    };
    const extra = {
      method,
      expectedSourceHash: sourceHash(stored),
      source: `METHODS ${method.toLowerCase()} ${action === 'invalid-signature' ? 'IMPORTING x TYPE i' : 'FINAL REDEFINITION'}.`,
      visibility: 'public',
    };
    if (action === 'delete_method' || action === 'change_method_visibility')
      delete (extra as { source?: string }).source;
    const { result } = await invoke(action === 'invalid-signature' ? 'edit_method_signature' : action, extra, settings);
    if (action === 'invalid-signature' || action === 'delete_method') {
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        action === 'invalid-signature' ? 'installed boundary parser' : 'safely isolate',
      );
      expect(requests.some((r) => r.method === 'PUT')).toBe(false);
    } else {
      expect(result.isError, result.content[0].text).toBeUndefined();
      expect(requests.filter((r) => r.method === 'PUT')).toHaveLength(action === 'change_method_visibility' ? 0 : 1);
      if (action === 'edit_method_signature')
        expect(stored).toContain(`METHODS ${method.toLowerCase()} FINAL REDEFINITION.`);
      if (action === 'delete_method') expect(stored).not.toContain(method.toLowerCase());
    }
  },
);
