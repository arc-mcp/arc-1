import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bdef, bdefName, config, name, nativeClient, rapWorld } from './pinned-rap-harness.js';
import './setup-undici-mock.js';

const { handlePrivatePinnedRap } = await import('../../../src/handlers/write/pinned-rap.js');
const { setCachedFeatures, resetCachedFeatures } = await import('../../../src/handlers/feature-cache.js');
const actions = ['scaffold_rap_handlers', 'generate_behavior_implementation'] as const;
let state: ReturnType<typeof rapWorld>;
const writes = () => state.sourceCalls.filter((call) => call.method !== 'GET');
async function call(action: (typeof actions)[number], targetAlias?: string) {
  return handlePrivatePinnedRap(
    nativeClient(),
    config,
    {
      action,
      type: 'CLAS',
      name,
      bdefName,
      ...(action === actions[0] ? { autoApply: true } : { activate: false }),
      ...(targetAlias === undefined ? {} : { targetAlias }),
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

const splitHeaders = [
  'define\nbehavior for ZI_RAP_TEST alias Item',
  'define behavior\nfor ZI_RAP_TEST alias Item',
  'define behavior for\nZI_RAP_TEST alias Item',
  'define behavior for ZI_RAP_TEST\nalias Item',
  'define behavior for ZI_RAP_TEST alias\nItem',
  'define behavior for ZI_RAP_TEST\r\nalias Item',
  'define behavior for ZI_RAP_TEST /* split\ncomment */ alias Item',
];
it.each(
  actions.flatMap((action) =>
    splitHeaders.flatMap((header) => [undefined, 'Item'].map((targetAlias) => ({ action, header, targetAlias }))),
  ),
)(
  'refuses split entity/alias headers before saving: $action $header $targetAlias',
  async ({ action, header, targetAlias }) => {
    state.bdefSource = bdef.replace('define behavior for ZI_RAP_TEST alias Item', header);
    const result = await call(action, targetAlias);
    expect(result.isError, result.content[0].text).toBe(true);
    expect(writes()).toEqual([]);
    expect(JSON.parse(result.content[0].text).cleanup.sessionClosed).toBe(true);
  },
);
it.each(actions.flatMap((action) => [undefined, 'iTeM'].map((targetAlias) => ({ action, targetAlias }))))(
  'binds a supported same-line tab-separated alias exactly: $action $targetAlias',
  async ({ action, targetAlias }) => {
    state.bdefSource = bdef.replace(
      'define behavior for ZI_RAP_TEST alias Item',
      'DeFiNe\tBeHaViOr\tFoR\tZI_RAP_TEST\tAlIaS\tItem',
    );
    const result = await call(action, targetAlias);
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(writes()).toHaveLength(1);
    expect(state.sources.implementations).toContain('CLASS lhc_item DEFINITION');
    expect(state.sources.implementations).toContain('FOR ACTION Item~approve');
    expect(state.sources.implementations).not.toContain('lhc_rap_test');
  },
);

const unsupported = [
  bdef.replace('action approve', 'action ( features: instance ) approve'),
  bdef.replace('action approve', 'action ( features: global ) approve'),
  bdef.replace('action approve', 'action ( features:\n instance ) approve'),
  bdef.replace('action approve', 'action ( precheck ) approve'),
  bdef.replace('lock master', 'lock master\nauthorization master ( global, instance )'),
  bdef.replace('lock master', 'lock master\nauthorization master ( instance, global )'),
  bdef.replace('lock master', 'lock master\nauthorization master ( global,\n instance )'),
  bdef.replace('lock master', 'lock master\nauthorization master ( global /* comment */, instance )'),
  bdef.replace('lock master', 'lock master\nauthorization dependent by _Parent'),
  bdef.replace('lock master', 'lock master unmanaged'),
  bdef.replace('action approve', 'update ( features: instance );\n action approve'),
  bdef.replace('action approve', 'create ( precheck );\n action approve'),
  bdef.replace('action approve', 'field ( features: instance ) Name;\n action approve'),
  bdef.replace('action approve', 'association _Items { create ( features: instance ); }\n action approve'),
  bdef.replace('managed implementation', 'unmanaged implementation'),
  bdef.replace('unique;', 'unique;\nwith draft;'),
  bdef.replace('action approve', 'function test result [1] $self;\n action approve'),
  bdef.replace('action approve', 'event Changed;\n action approve'),
  bdef.replace('unique;', 'unique;\nwith additional save;'),
  bdef.replace('lock master', 'lock master\nlate numbering'),
  bdef.replace('action approve', 'unknown handler omitted;\n action approve'),
  bdef.replace('action approve result [1] $self;', 'action approve; action second;'),
  bdef.replace('action approve result [1] $self;', 'action approve;\n action approve;'),
  bdef.replace('action approve result [1] $self;', 'action approve parameter result;'),
  bdef.replace('action approve result [1] $self;', `action approve\n${'\n'.repeat(21)}result [1] $self;`),
  bdef.replace('action approve', "action 'hidden syntax' approve"),
  `'hidden root syntax'\n${bdef}`,
  bdef.replace('unique;', 'unique;\n@EndUserText.label:'),
];
it.each(
  actions.flatMap((action) =>
    unsupported.flatMap((source, variant) =>
      [undefined, 'Item'].map((targetAlias) => ({ action, source, variant, targetAlias })),
    ),
  ),
)(
  'refuses incomplete handler contracts before initialization/save: $action variant $variant $targetAlias',
  async ({ action, source, targetAlias }) => {
    state.bdefSource = source;
    delete state.sources.implementations;
    const result = await call(action, targetAlias);
    expect(result.isError, result.content[0].text).toBe(true);
    expect(writes()).toEqual([]);
    expect(JSON.parse(result.content[0].text).cleanup.sessionClosed).toBe(true);
  },
);

it.each(actions.flatMap((action) => [unsupported[0], unsupported[4]].map((source) => ({ action, source }))))(
  'refuses incomplete $action previews using GETs only',
  async ({ action, source }) => {
    state.bdefSource = source;
    const result = await handlePrivatePinnedRap(
      nativeClient(),
      config,
      {
        action,
        type: 'CLAS',
        name,
        bdefName,
        targetAlias: 'Item',
        ...(action === actions[0] ? { autoApply: false } : { dryRun: true }),
      },
      ['write'],
    );
    expect(result.isError).toBe(true);
    expect(state.world.calls.every((call) => call.method === 'GET')).toBe(true);
    expect(writes()).toEqual([]);
  },
);

it.each(
  actions.flatMap((action) =>
    ['instance', 'global'].flatMap((mode) => [undefined, 'Item'].map((targetAlias) => ({ action, mode, targetAlias }))),
  ),
)('retains supported single-mode authorization: $action $mode $targetAlias', async ({ action, mode, targetAlias }) => {
  state.bdefSource = bdef.replace('lock master', `lock master\nauthorization master (\n ${mode}\n)`);
  const result = await call(action, targetAlias);
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(state.sources.implementations).toContain(
    `METHODS get_${mode}_authorizations FOR ${mode.toUpperCase()} AUTHORIZATION`,
  );
  expect(state.sources.implementations).toContain(`METHOD get_${mode}_authorizations.`);
  expect(state.sources.implementations).toContain('FOR ACTION Item~approve');
});

it.each(actions)('%s retains the full supported managed declaration set', async (action) => {
  state.bdefSource = `@EndUserText.label: 'Actions with features: text only'
managed implementation in class ${name} unique;
strict ( 2 );
define behavior for ${bdefName} alias Item
persistent table zrap_table
lock master
etag master LastChanged
authorization master ( instance )
{
 create; update; delete;
 field ( readonly : update, mandatory : create ) Name, Id;
 association _Parent;
 association _Items { create; }
 static action Reset;
 internal action Calculate parameter ZI_PARAMETER;
 factory action Copy [1];
 static factory action CreateNew;
 action approve parameter ZI_PARAMETER
   result [1] $self;
 determination Set1 on modify { create; field Name; }
 determination Set2 on save { update; }
 validation Check1 on save { create; update; field Name, Id; }
 mapping for zrap_table { Name = NAME; Id = ID; }
}`;
  const result = await call(action);
  expect(result.isError, result.content[0].text).toBeUndefined();
  const source = state.sources.implementations;
  for (const method of [
    'reset',
    'calculate',
    'copy',
    'createnew',
    'approve',
    'set1',
    'set2',
    'check1',
    'get_instance_authorizations',
  ])
    expect(source).toContain(`METHOD ${method}.`);
  expect(source).toContain('FOR ACTION Item~approve RESULT result.');
  expect(source).toContain('FOR ACTION Item~Calculate.');
  expect(source).toContain('FOR DETERMINE ON MODIFY');
  expect(source).toContain('FOR VALIDATE ON SAVE');
});

it.each(actions)('%s honors a selected alias only after validating the complete BDEF', async (action) => {
  const child = '\ndefine behavior for ZI_CHILD alias Child\n{\n action Process;\n}';
  state.bdefSource = bdef + child;
  const result = await call(action, 'Child');
  expect(result.isError, result.content[0].text).toBeUndefined();
  expect(state.sources.implementations).toContain('CLASS lhc_child DEFINITION');
  expect(state.sources.implementations).toContain('FOR ACTION Child~Process');
  expect(state.sources.implementations).not.toContain('CLASS lhc_item DEFINITION');
});
it.each(actions)('%s cannot hide an unsupported other-entity clause through targetAlias', async (action) => {
  state.bdefSource =
    bdef +
    '\ndefine behavior for ZI_CHILD alias Child\nauthorization master ( instance, global )\n{\n action Process;\n}';
  const result = await call(action, 'Item');
  expect(result.isError).toBe(true);
  expect(writes()).toEqual([]);
});

// BP_DEMO_RAP_STRICT's existing fixture/test uses unmanaged read + global authorization,
// so unmanaged itself is not a reason to refuse the shared generator's known families.
const unmanagedRead = `unmanaged implementation in class ZBP_RAP_TEST unique;
strict (2);
define behavior for ZI_RAP_TEST alias Item
authorization master (global)
{
 read;
}`;
it.each(
  actions.flatMap((action) =>
    [false, true].flatMap((withAction) =>
      [undefined, 'Item'].map((targetAlias) => ({ action, withAction, targetAlias })),
    ),
  ),
)(
  '$action preserves the supported unmanaged read/auth envelope, action=$withAction alias=$targetAlias',
  async ({ action, withAction, targetAlias }) => {
    state.bdefSource = withAction
      ? unmanagedRead.replace(' read;', ' read;\n action Approve result [1] $self;')
      : unmanagedRead;
    const result = await call(action, targetAlias);
    expect(result.isError, result.content[0].text).toBeUndefined();
    expect(writes()).toHaveLength(1);
    expect(state.sources.implementations).toContain('METHOD get_global_authorizations.');
    expect(state.sources.implementations).toContain('FOR GLOBAL AUTHORIZATION');
    expect(state.sources.implementations).toContain('FOR Item RESULT result.');
    expect(state.sources.implementations.match(/\bMETHOD \w+\./g)).toHaveLength(withAction ? 2 : 1);
    if (withAction) expect(state.sources.implementations).toContain('FOR ACTION Item~Approve RESULT result.');
  },
);
it.each(
  actions.flatMap((action) =>
    [
      ...['create', 'update', 'delete'].map((operation) => unmanagedRead.replace(' read;', ` read;\n ${operation};`)),
      unmanagedRead.replace('authorization master', 'lock master\nauthorization master'),
      unmanagedRead.replace('authorization master', 'etag master LastChanged\nauthorization master'),
      unmanagedRead.replace('authorization master', 'persistent table zrap_table\nauthorization master'),
      unmanagedRead.replace(' read;', ' read;\n mapping for zrap_table { Id = ID; }'),
      unmanagedRead.replace('unique;', 'unique;\nwith unmanaged save;'),
      unmanagedRead.replace(' read;', ' read;\n association _Parent;'),
    ].map((source, variant) => ({ action, source, variant })),
  ),
)(
  '$action refuses unmanaged lifecycle requirements omitted by the shared generator: $variant',
  async ({ action, source }) => {
    state.bdefSource = source;
    const result = await call(action, 'Item');
    expect(result.isError, result.content[0].text).toBe(true);
    expect(writes()).toEqual([]);
  },
);
