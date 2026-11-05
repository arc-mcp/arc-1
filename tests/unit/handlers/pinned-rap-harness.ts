/** Offline stateful native-wire model, based on the captured behavior-pool metadata fixture. */
import { mockResponse } from '../../helpers/mock-fetch.js';
import { blueSource, config, createWorld, fixture, install, nativeClient } from './pinned-ddic-harness.js';
import { mockFetch } from './setup-undici-mock.js';

export { config, nativeClient };
export const name = 'ZBP_RAP_TEST',
  bdefName = 'ZI_RAP_TEST';
export const owner = `/sap/bc/adt/oo/classes/${name.toLowerCase()}`;
export const bdefOwner = `/sap/bc/adt/bo/behaviordefinitions/${bdefName.toLowerCase()}`;
export const main = `CLASS zbp_rap_test DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF zi_rap_test.
ENDCLASS.
CLASS zbp_rap_test IMPLEMENTATION.
ENDCLASS.`;
export const bdef = `managed implementation in class ZBP_RAP_TEST unique;
define behavior for ZI_RAP_TEST alias Item
persistent table zrap_table
lock master
{
  action approve result [1] $self;
}`;
export function rapWorld() {
  const world = createWorld();
  const state = {
    world,
    version: 'inactive',
    packageName: '$TMP',
    sources: { main, definitions: '* native placeholder', implementations: '* native placeholder' } as Record<
      string,
      string
    >,
    active: {} as Record<string, string>,
    bdefSource: bdef,
    bdefVersion: 'active',
    metadataTransform: (xml: string) => xml,
    bdefMetadataTransform: (xml: string) => xml,
    hook: undefined as ((uri: URL, method: string) => void) | undefined,
    fault: undefined as ((uri: URL, method: string) => { status: number; body: string } | undefined) | undefined,
    sourceCalls: [] as Array<{
      path: string;
      method: string;
      locked: boolean;
      body: string;
      headers: Record<string, string>;
    }>,
  };
  const template = fixture('xml/class-metadata-behaviorpool.xml')
    .replaceAll('ZBP_DM_PROJECT', name)
    .replaceAll('zbp_dm_project', name.toLowerCase())
    .replaceAll('ZR_DM_PROJECT', bdefName)
    .replaceAll('zr_dm_project', bdefName.toLowerCase())
    .replace(/<class:include\b[\s\S]*?<\/class:include>/g, '');
  const metadata = () =>
    state.metadataTransform(
      template
        .replaceAll('ZDEMO_MIG_RAP', state.packageName)
        .replaceAll('zdemo_mig_rap', encodeURIComponent(state.packageName.toLowerCase()))
        .replace(/adtcore:version="[^"]*"/g, `adtcore:version="${state.version}"`)
        .replace(
          '</class:abapClass>',
          `${Object.keys(state.sources)
            .map(
              (part) =>
                `<class:include class:includeType="${part}" abapsource:sourceUri="${part === 'main' ? 'source/main' : `includes/${part}`}" adtcore:name="" adtcore:type="CLAS/I" adtcore:version="${state.version}"/>`,
            )
            .join('')}</class:abapClass>`,
        ),
    );
  world.objects.set(owner, { metadata: metadata(), nativeType: 'CLAS/OC', source: main });
  world.objects.set(bdefOwner, {
    metadata: blueSource(bdefName, 'BDEF/BDO', 'ZREAD_ONLY', 'active'),
    nativeType: 'BDEF/BDO',
    source: bdef,
  });
  install(world);
  const base = mockFetch.getMockImplementation()!;
  mockFetch.mockImplementation(async (input, init = {}) => {
    const uri = new URL(String(input)),
      method = init.method ?? 'GET';
    state.hook?.(uri, method);
    const fault = state.fault?.(uri, method);
    if (fault) return mockResponse(fault.status, fault.body);
    world.objects.get(owner)!.metadata = metadata();
    world.objects.get(bdefOwner)!.metadata = state.bdefMetadataTransform(
      blueSource(bdefName, 'BDEF/BDO', 'ZREAD_ONLY', state.bdefVersion),
    );
    world.objects.get(bdefOwner)!.source = state.bdefSource;
    const source = /\/(source\/main|includes\/[^/]+)$/.exec(uri.pathname);
    if (uri.pathname.startsWith(`${owner}/`) && source) {
      const part = source[1] === 'source/main' ? 'main' : source[1].split('/')[1];
      state.sourceCalls.push({
        path: uri.pathname + uri.search,
        method,
        locked: !!world.locked,
        body: String(init.body ?? ''),
        headers: init.headers ?? {},
      });
      if (method === 'GET' && part in state.sources)
        return mockResponse(
          200,
          uri.searchParams.get('version') === 'active'
            ? (state.active[part] ?? state.sources[part])
            : state.sources[part],
          { 'content-type': 'text/plain' },
        );
      if (method === 'POST') {
        state.sources[part] = '';
        return mockResponse(201, '');
      }
      if (method === 'PUT') {
        state.sources[part] = String(init.body);
        state.version = 'inactive';
        return mockResponse(200, '');
      }
    }
    const result = await base(input, init);
    if (uri.pathname === '/sap/bc/adt/activation' && uri.searchParams.get('preauditRequested') !== 'true') {
      state.version = world.faults.has('still-inactive') ? 'inactive' : 'active';
      state.active = { ...state.sources };
      // Activation affects only the class fixture, not its read-only BDEF dependency.
      world.objects.get(bdefOwner)!.metadata = state.bdefMetadataTransform(
        blueSource(bdefName, 'BDEF/BDO', 'ZREAD_ONLY', state.bdefVersion),
      );
    }
    return result;
  });
  return state;
}
