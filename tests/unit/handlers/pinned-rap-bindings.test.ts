import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bdef, bdefName, config, name, nativeClient, rapWorld } from './pinned-rap-harness.js';
import './setup-undici-mock.js';

const { handlePrivatePinnedRap } = await import('../../../src/handlers/write/pinned-rap.js');
const { setCachedFeatures, resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const actions = ['scaffold_rap_handlers', 'generate_behavior_implementation'] as const;
let state: ReturnType<typeof rapWorld>;
const writes = () => state.sourceCalls.filter((call) => call.method !== 'GET');
const handler = (
  declarations: string,
  method = 'approve',
) => `CLASS lhc_item DEFINITION INHERITING FROM cl_abap_behavior_handler.
 PRIVATE SECTION.
 ${declarations}
ENDCLASS.
CLASS lhc_item IMPLEMENTATION.
 METHOD ${method}.
  DATA(kept) = 1.
 ENDMETHOD.
ENDCLASS.`;
async function call(action: (typeof actions)[number], preview = false, alias = 'Item') {
  return handlePrivatePinnedRap(
    nativeClient(),
    config,
    {
      action,
      type: 'CLAS',
      name,
      bdefName,
      targetAlias: alias,
      ...(action === actions[0] ? { autoApply: !preview } : { activate: false, dryRun: preview }),
    },
    ['write'],
  );
}
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  resetCachedFeatures();
  state = rapWorld();
  setCachedFeatures({ rap: { id: 'rap', available: true, mode: 'auto' } }, config.targetId);
});
afterEach(() => {
  expect(state.world.unexpected).toEqual([]);
  resetCachedFeatures();
  vi.restoreAllMocks();
});

const incompatible = [
  'METHODS approve.',
  'METHODS approve FOR MODIFY IMPORTING keys FOR ACTION Other~approve RESULT result.',
  'METHODS approve FOR DETERMINE ON MODIFY IMPORTING keys FOR Item~approve.',
  'METHODS approve FOR MODIFY IMPORTING keys FOR ACTION Item~approve.',
  'METHODS approve FOR MODIFY IMPORTING keys FOR ACTION Item~different RESULT result.',
  'CLASS-METHODS approve FOR MODIFY IMPORTING keys FOR ACTION Item~approve RESULT result.',
  'METHODS approve IMPORTING keys FOR ACTION Item~approve RESULT result.',
  'METHODS approve. " FOR MODIFY IMPORTING keys FOR ACTION Item~approve RESULT result.',
];
it.each(
  actions.flatMap((action) =>
    incompatible.flatMap((declaration) => [false, true].map((sibling) => ({ action, declaration, sibling }))),
  ),
)(
  '$action refuses incompatible existing declarations before sibling=$sibling save: $declaration',
  async ({ action, declaration, sibling }) => {
    if (sibling)
      state.bdefSource = bdef.replace(
        'action approve result [1] $self;',
        'action approve result [1] $self;\n action reject;',
      );
    state.sources.implementations = handler(declaration);
    const before = state.sources.implementations;
    const result = await call(action);
    expect(result.isError, result.content[0].text).toBe(true);
    expect(writes()).toEqual([]);
    expect(state.sources.implementations).toBe(before);
    expect(JSON.parse(result.content[0].text).cleanup.sessionClosed).toBe(true);
  },
);
it.each(actions)('%s rejects a preview collision using only GETs', async (action) => {
  state.sources.implementations = handler(incompatible[0]!);
  expect((await call(action, true)).isError).toBe(true);
  expect(state.world.calls.every((call) => call.method === 'GET')).toBe(true);
});
it.each(actions)('%s rejects a declaration collision before initializing an absent include', async (action) => {
  state.sources.definitions = handler(incompatible[0]!);
  delete state.sources.implementations;
  expect((await call(action)).isError).toBe(true);
  expect(writes()).toEqual([]);
});
it.each(actions)('%s rejects a wrong-event declaration despite the same method and entity', async (action) => {
  state.bdefSource = bdef.replace(
    'action approve result [1] $self;',
    'determination approve on modify { create; }\n action reject;',
  );
  state.sources.implementations = handler('METHODS approve FOR DETERMINE ON SAVE IMPORTING keys FOR Item~approve.');
  expect((await call(action)).isError).toBe(true);
  expect(writes()).toEqual([]);
});
it.each(actions)('%s rejects wrong authorization kind hidden behind the expected name', async (action) => {
  state.bdefSource = bdef.replace('lock master', 'lock master\nauthorization master (instance)');
  state.sources.implementations = handler(
    'METHODS get_instance_authorizations FOR GLOBAL AUTHORIZATION IMPORTING REQUEST flags FOR Item RESULT result.',
    'get_instance_authorizations',
  );
  expect((await call(action)).isError).toBe(true);
  expect(writes()).toEqual([]);
});
it.each(
  actions.flatMap((action) =>
    ['main', 'definitions', 'implementations'].flatMap((section) =>
      [false, true].map((utility) => ({ action, section, utility })),
    ),
  ),
)('$action preserves renamed handlers in $section with utility=$utility', async ({ action, section, utility }) => {
  state.bdefSource = bdef.replace(
    'action approve result [1] $self;',
    'action approve result [1] $self;\n action reject;',
  );
  const source = handler(
    `METHODS do_approve FOR MODIFY " preserve comment
 IMPORTING selected_keys FOR ACTION Item ~ approve
 RESULT response_rows.${utility ? '\n METHODS approve.' : ''}`,
    'do_approve',
  );
  state.sources[section] +=
    '\n' +
    (utility
      ? source.replace(
          'CLASS lhc_item IMPLEMENTATION.',
          'CLASS lhc_item IMPLEMENTATION.\n METHOD approve.\n  DATA(utility) = 1.\n ENDMETHOD.',
        )
      : source);
  const result = await call(action);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(writes()).toHaveLength(1);
  expect(state.sources[section]).toContain('METHOD do_approve.');
  expect(state.sources[section]).toContain('DATA(kept) = 1.');
  expect(state.sources[section]).toContain('METHOD reject.');
  expect(state.sources[section].match(/FOR ACTION Item\s*~\s*approve/g)).toHaveLength(1);
  if (utility) expect(state.sources[section]).toContain('DATA(utility) = 1.');
  else expect(state.sources[section]).not.toContain('METHOD approve.');
});
it.each(actions)('%s fills the actual missing renamed implementation', async (action) => {
  state.sources.implementations = handler(
    'METHODS do_approve FOR MODIFY IMPORTING keys FOR ACTION Item~approve RESULT result.',
    'do_approve',
  ).replace(/ METHOD do_approve\.[\s\S]*? ENDMETHOD\./, '');
  const result = await call(action);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(writes()).toHaveLength(1);
  expect(state.sources.implementations).toContain('METHOD do_approve.');
  expect(state.sources.implementations).not.toContain('METHOD approve.');
});
it.each(actions)(
  '%s rejects a duplicate binding produced by the actual chained-declaration planner',
  async (action) => {
    state.bdefSource = bdef.replace(
      'action approve result [1] $self;',
      'action approve result [1] $self;\n action reject;',
    );
    state.sources.implementations = handler(
      'METHODS: do_approve FOR MODIFY IMPORTING keys FOR ACTION Item~approve RESULT result.',
      'do_approve',
    );
    const before = state.sources.implementations;
    const result = await call(action);
    expect(result.isError, result.content[0].text).toBe(true);
    expect(writes()).toEqual([]);
    expect(state.sources.implementations).toBe(before);
  },
);
it.each(actions)(
  '%s does not mistake a literal binding for the missing renamed implementation on a no-op path',
  async (action) => {
    state.sources.implementations =
      handler(`METHODS do_approve FOR MODIFY IMPORTING keys FOR ACTION Item~approve RESULT result.
 METHODS approve.
 CONSTANTS hint TYPE string VALUE 'FOR ACTION Item~approve'.`);
    const result = await call(action);
    expect(result.isError, result.content[0].text).toBe(true);
    expect(writes()).toEqual([]);
    expect(state.sources.implementations).not.toContain('METHOD do_approve.');
  },
);
it.each(actions)(
  '%s preserves correctly renamed authorization handlers with renamed formal parameters',
  async (action) => {
    state.bdefSource = bdef.replace('lock master', 'lock master\nauthorization master (instance)');
    state.sources.implementations = handler(
      'METHODS authorise FOR INSTANCE AUTHORIZATION IMPORTING selected_keys REQUEST requested_flags FOR Item RESULT response_flags.',
      'authorise',
    );
    const result = await call(action);
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(writes()).toHaveLength(1);
    expect(state.sources.implementations).toContain('METHOD authorise.');
    expect(state.sources.implementations).toContain('DATA(kept) = 1.');
    expect(state.sources.implementations).not.toContain('METHOD get_instance_authorizations.');
    expect(state.sources.implementations).toContain('METHOD approve.');
  },
);
it.each(actions.flatMap((action) => [false, true].map((sibling) => ({ action, sibling }))))(
  '$action keeps a qualified method distinct from a masked missing plain handler, sibling=$sibling',
  async ({ action, sibling }) => {
    if (sibling)
      state.bdefSource = bdef.replace(
        'action approve result [1] $self;',
        'action approve result [1] $self;\n action reject;',
      );
    state.sources.implementations =
      `INTERFACE do_approve.\n METHODS other.\nENDINTERFACE.\n${handler(`INTERFACES do_approve.
 METHODS do_approve FOR MODIFY IMPORTING keys FOR ACTION Item~approve RESULT result.
 METHODS approve.
 CONSTANTS hint TYPE string VALUE 'FOR ACTION Item~approve'.`)}`.replace(
        'CLASS lhc_item IMPLEMENTATION.',
        'CLASS lhc_item IMPLEMENTATION.\n METHOD do_approve~other.\n  DATA(interface_kept) = 2.\n ENDMETHOD.',
      );
    const before = state.sources.implementations;
    const result = await call(action);
    expect(result.isError, result.content[0].text).toBe(true);
    expect(writes()).toEqual([]);
    expect(state.sources.implementations).toBe(before);
    expect(state.sources.implementations).not.toContain('METHOD do_approve.');
  },
);
it.each(actions)('%s preserves an interface method while filling the distinct plain handler', async (action) => {
  state.sources.implementations = `INTERFACE approve.\n METHODS other.\nENDINTERFACE.\n${handler(
    `INTERFACES approve.
 METHODS approve FOR MODIFY IMPORTING keys FOR ACTION Item~approve RESULT result.`,
    'approve~other',
  )}`;
  const result = await call(action);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(writes()).toHaveLength(1);
  expect(state.sources.implementations).toContain('METHOD approve.');
  expect(state.sources.implementations).toContain('METHOD approve~other.');
  expect(state.sources.implementations).toContain('DATA(kept) = 1.');
});
it.each(actions)('%s checks the selected entity without requiring unselected missing handlers', async (action) => {
  state.bdefSource = `${bdef}\ndefine behavior for ZI_CHILD alias Child\n{\n action Process;\n}`;
  state.sources.implementations = handler('METHODS approve.');
  const result = await call(action, false, 'Child');
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(writes()).toHaveLength(1);
  expect(state.sources.implementations).toContain('METHODS approve.');
  expect(state.sources.implementations).toContain('FOR ACTION Child~Process.');
});
