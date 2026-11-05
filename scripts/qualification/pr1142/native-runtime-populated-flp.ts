/** Fresh owned populated CUST pages. Native deletion completion is distinct from UNKNOWN GET604. */
import { createHash } from 'node:crypto';
import type { AdtClient } from '../../../src/adt/client.js';
import { buildTileConfiguration, type FlpTileInput, flpPageTilesPath } from '../../../src/adt/flp.js';
import type { AdtHttpClient } from '../../../src/adt/http.js';
import { mutationHttp, withMutationSession } from '../../../src/adt/mutation-http.js';
import {
  assertManagedCatalog,
  assertManagedGroup,
  flpEntityPath,
  isUnresolvedFlpLookup,
  readEntity,
} from '../../../src/adt/pinned-flp-entity.js';
import { readPinnedFlpTilePage } from "../../../src/adt/pinned-flp-entity.js";
import { createNativeGovernedFlpRecording } from "../../../src/adt/pinned-flp.js";
import { executePrivatePinnedNativeGovernedFlp } from '../../../src/handlers/pinned-flp-native-recording.js';
import { assertPrivatePinnedRuntime } from '../../../src/handlers/pinned-operation.js';
import { flpNativeEvidence } from './native-flp-evidence.js';
import { FLP_SERVICE } from './native-flp-fixed.js';
import { type RuntimeInput, runtimePayload, runtimeStageClient } from './native-runtime-slice-context.js';
import { runtimeFixture as f, RuntimeFailure, runtimeReason } from './native-runtime-slice-fixed.js';

const catalogKey = `X-SAP-UI2-CATALOGPAGE:${f.catalogId}`;
const owner = (kind: 'group' | 'catalog') =>
  flpEntityPath(kind === 'group' ? 'Pages' : 'Catalogs', kind === 'group' ? f.groupId : catalogKey).split('?')[0];
const tile: FlpTileInput = {
  id: f.tileId,
  title: f.title,
  semanticObject: 'Shell',
  semanticAction: 'home',
  icon: 'sap-icon://home',
  url: '#Shell-home',
};
const hash = (body: string) => createHash('sha256').update(body).digest('hex');
const need = (value: unknown, reason: string): void => {
  if (!value) throw new RuntimeFailure(reason);
};
function canonical(value: any): string {
  return JSON.stringify(value, (_key, item) =>
    item && !Array.isArray(item) && typeof item === 'object'
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}
export async function runRuntimePopulatedFlp(input: RuntimeInput) {
  let phase = 'preflight',
    tileId: string | undefined,
    groupTileId: string | undefined;
  const created = new Set<string>(),
    nativeDeleted = new Set<string>(),
    remaining = new Set<string>();
  const receipts = new Map<string, string>();
  let profileAssert = () => {};
  const reads = [
    `${FLP_SERVICE}/$metadata`,
    ...['group', 'catalog'].flatMap((kind) => {
      const key = kind === 'group' ? f.groupId : catalogKey;
      return [`${owner(kind as 'group' | 'catalog')}?$format=json`, flpEntityPath('Pages', key), flpPageTilesPath(key)];
    }),
    `${flpEntityPath('Pages', catalogKey).split('?')[0]}/Bags?$format=json&$top=1`,
  ];
  const payloads = () =>
    new Map([
      [
        'catalog',
        {
          path: `${FLP_SERVICE}/Catalogs`,
          body: JSON.stringify({ domainId: f.catalogId, title: f.title, type: 'CATALOG_PAGE' }),
        },
      ],
      [
        'group',
        {
          path: `${FLP_SERVICE}/Pages`,
          body: JSON.stringify({ id: f.groupId, title: f.title, catalogId: '/UI2/FLPD_CATALOG', layout: '' }),
        },
      ],
      [
        'tile',
        {
          path: `${FLP_SERVICE}/PageChipInstances`,
          body: JSON.stringify({
            chipId: 'X-SAP-UI2-CHIP:/UI2/STATIC_APPLAUNCHER',
            pageId: catalogKey,
            scope: 'CUSTOMIZING',
            title: tile.title,
            configuration: buildTileConfiguration(tile),
          }),
        },
      ],
      [
        'assignment',
        {
          path: `${FLP_SERVICE}/PageChipInstances`,
          body: JSON.stringify({ chipId: `X-SAP-UI2-PAGE:${catalogKey}:${tileId}`, pageId: f.groupId }),
        },
      ],
    ]);
  const scoped = runtimeStageClient(
    input,
    (method, path, body) => {
      profileAssert();
      if (method === 'GET' && reads.includes(path) && body === undefined) return;
      const post = payloads().get(phase);
      if (method === 'POST' && post?.path === path && post.body === body) return;
      if (
        method === 'DELETE' &&
        phase.startsWith('delete-') &&
        path === owner(phase.slice(7) as 'group' | 'catalog') &&
        receipts.has(path) &&
        body === undefined
      )
        return;
      throw new RuntimeFailure('scope');
    },
    async (http, path) => {
      const kind = path === owner('group') ? 'group' : path === owner('catalog') ? 'catalog' : undefined;
      need(kind && created.has(path) && receipts.has(path), 'delete-owner');
      need((await inspect(http, kind!)) === receipts.get(path), 'delete-drift');
      scoped.verify();
    },
  );
  const profile = createNativeGovernedFlpRecording(input.base.safety, scoped.context, scoped.config, () => {
    assertPrivatePinnedRuntime(
      scoped.client,
      scoped.config,
      'SAPManage',
      phase.startsWith('delete-')
        ? { action: 'flp_delete_catalog', catalogId: f.catalogId }
        : { action: 'flp_create_group', groupId: f.groupId, title: f.title },
      scoped.context,
    );
  });
  profileAssert = profile.assert;
  async function inspect(transport: AdtHttpClient, kind: 'group' | 'catalog') {
    const http = mutationHttp(transport, input.base.safety, scoped.context);
    const key = kind === 'group' ? f.groupId : catalogKey;
    const page = await readEntity<Record<string, unknown>>(http, 'Pages', key);
    if (kind === 'group') assertManagedGroup(page, f.groupId);
    else
      need(
        page.id === key &&
          page.scope === 'CUSTOMIZING' &&
          page.isCatalogPage === 'X' &&
          [false, '', 'false'].includes(page.isReadOnly as any),
        'catalog-page',
      );
    need(page.title === f.title && page.layout === '', 'page-marker');
    const catalog = kind === 'catalog' ? await readEntity<Record<string, unknown>>(http, 'Catalogs', key) : undefined;
    if (catalog) {
      assertManagedCatalog(catalog, f.catalogId);
      need(catalog.title === f.title && Number(catalog.chipCount) === (tileId ? 1 : 0), 'catalog-count');
    }
    const list = await readPinnedFlpTilePage(http, input.base.safety, key);
    const expectedId = kind === 'catalog' ? tileId : groupTileId;
    need(!list.truncated && list.items.length === (expectedId ? 1 : 0), 'foreign-membership');
    if (expectedId) {
      const actual = list.items[0];
      need(
        actual.instanceId === expectedId &&
          actual.pageId === key &&
          actual.chipId ===
            (kind === 'catalog' ? 'X-SAP-UI2-CHIP:/UI2/STATIC_APPLAUNCHER' : `X-SAP-UI2-PAGE:${catalogKey}:${tileId}`),
        'tile-owner',
      );
      if (kind === 'catalog')
        need(
          actual.configuration?.id === tile.id &&
            actual.title === tile.title &&
            actual.configuration?.url === '#Shell-home',
          'tile-content',
        );
    }
    // Bind opaque collection fields as well as the shared parsed ownership proof.
    const raw = JSON.parse((await http.get(flpPageTilesPath(key), { Accept: 'application/json' })).body);
    need(
      Array.isArray(raw?.d?.results) &&
        raw.d.results.length === list.items.length &&
        !raw.d.__next &&
        (raw.d.__count === undefined || Number(raw.d.__count) === list.items.length),
      'tile-collection',
    );
    if (kind === 'catalog') {
      const bags = JSON.parse(
        (
          await http.get(`${flpEntityPath('Pages', key).split('?')[0]}/Bags?$format=json&$top=1`, {
            Accept: 'application/json',
          })
        ).body,
      );
      need(
        Array.isArray(bags?.d?.results) &&
          bags.d.results.length === 0 &&
          !bags.d.__next &&
          (bags.d.__count === undefined || bags.d.__count === '0'),
        'foreign-bags',
      );
    }
    return hash(canonical({ page, catalog, raw }));
  }
  try {
    await withMutationSession(
      scoped.http,
      input.base.safety,
      scoped.context,
      async (session) => {
        const counts = new Set<string>();
        const oneShot = new Proxy(session, {
          get(target, key) {
            if (key === 'post' || key === 'delete')
              return async (...args: unknown[]) => {
                need(!counts.has(phase), 'replay');
                counts.add(phase);
                if (key === 'post' && (phase === 'tile' || phase === 'assignment')) {
                  // The adapter performs its own reads first. Re-prove the exact retained
                  // parents here, at the actual owning-session child request, as for DELETE.
                  for (const kind of (phase === 'tile' ? ['catalog'] : ['catalog', 'group']) as (
                    | 'catalog'
                    | 'group'
                  )[]) {
                    const path = owner(kind);
                    need(created.has(path) && receipts.has(path), 'child-parent');
                    need((await inspect(target, kind)) === receipts.get(path), 'child-parent-drift');
                  }
                  scoped.verify();
                  input.record({ childWriteParentsVerified: phase });
                }
                const response = await Reflect.apply(Reflect.get(target, key), target, args);
                need(
                  response.statusCode === (key === 'post' ? 201 : 204) &&
                    (key !== 'delete' || response.body === '') &&
                    !Object.entries(response.headers).some(
                      ([name, value]) => ['sap-message', 'sap-messages'].includes(name.toLowerCase()) && value,
                    ),
                  'native-acknowledgement',
                );
                input.record({ acknowledged: phase, status: response.statusCode });
                if (key === 'delete') nativeDeleted.add(String(args[0]));
                return response;
              };
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        const client = Object.assign(Object.create(Object.getPrototypeOf(input.base)), input.base, {
          http: oneShot,
        }) as AdtClient;
        const run = async (args: Record<string, unknown>) => {
          const result = runtimePayload(
            await executePrivatePinnedNativeGovernedFlp(client, args, scoped.config, scoped.context, ['read', 'write']),
          );
          input.record({ action: phase, result });
          return result;
        };
        const metadata = await oneShot.get(`${FLP_SERVICE}/$metadata`, { Accept: 'application/xml' });
        need(metadata.statusCode === 200 && hash(metadata.body) === flpNativeEvidence.metadataHash, 'metadata');
        // UNKNOWN prelookup is permitted only through reviewed backend create-only semantics; known entities refuse.
        for (const kind of ['catalog', 'group'] as const) {
          try {
            await readEntity(oneShot, 'Pages', kind === 'catalog' ? catalogKey : f.groupId);
            throw new RuntimeFailure('preexisting');
          } catch (error) {
            if (!isUnresolvedFlpLookup(error, flpEntityPath('Pages', kind === 'catalog' ? catalogKey : f.groupId)))
              throw error;
          }
        }
        for (const kind of ['catalog', 'group'] as const) {
          phase = kind;
          remaining.add(owner(kind));
          const result = await run(
            kind === 'catalog'
              ? { action: 'flp_create_catalog', domainId: f.catalogId, title: f.title }
              : { action: 'flp_create_group', groupId: f.groupId, title: f.title },
          );
          need(result.state === 'created' && result.recording === 'native-governed-unverified', 'create-unconfirmed');
          created.add(owner(kind));
          receipts.set(owner(kind), await inspect(oneShot, kind));
        }
        phase = 'tile';
        const tileResult = await run({ action: 'flp_create_tile', catalogId: f.catalogId, tile });
        need(tileResult.state === 'created' && typeof tileResult.tile?.instanceId === 'string', 'tile-create');
        tileId = tileResult.tile.instanceId;
        receipts.set(owner('catalog'), await inspect(oneShot, 'catalog'));
        phase = 'assignment';
        const groupResult = await run({
          action: 'flp_add_tile_to_group',
          catalogId: f.catalogId,
          groupId: f.groupId,
          tileInstanceId: tileId,
        });
        need(
          groupResult.state === 'membership-verified' && typeof groupResult.tile?.instanceId === 'string',
          'membership',
        );
        groupTileId = groupResult.tile.instanceId;
        receipts.set(owner('group'), await inspect(oneShot, 'group'));
        // Owned Page first removes its exact owned reference; Catalog then owns its exact static tile and PageConfig.
        for (const kind of ['group', 'catalog'] as const) {
          phase = `delete-${kind}`;
          if (kind === 'group') await oneShot.delete(owner(kind), { Accept: 'application/json' });
          else {
            const raw = await executePrivatePinnedNativeGovernedFlp(
              client,
              { action: 'flp_delete_catalog', catalogId: f.catalogId },
              scoped.config,
              scoped.context,
              ['read', 'write'],
            );
            const result = JSON.parse(raw.content[0].text);
            input.record({ action: phase, result });
            need(result.state === 'delete-unconfirmed' && result.phase === 'readback', 'delete-report');
          }
          need(nativeDeleted.has(owner(kind)), 'delete-unconfirmed');
          try {
            await readEntity(
              oneShot,
              kind === 'group' ? 'Pages' : 'Catalogs',
              kind === 'group' ? f.groupId : catalogKey,
            );
            throw new RuntimeFailure('post-delete-present');
          } catch (error) {
            if (!isUnresolvedFlpLookup(error, `${owner(kind)}?$format=json`)) throw error;
          }
          if (kind === 'catalog') {
            const pagePath = flpEntityPath('Pages', catalogKey);
            try {
              await readEntity(oneShot, 'Pages', catalogKey);
              throw new RuntimeFailure('post-delete-page-present');
            } catch (error) {
              if (!isUnresolvedFlpLookup(error, pagePath)) throw error;
            }
          }
          remaining.delete(owner(kind));
        }
      },
      {
        timeoutMs: 30000,
        noReplay: true,
        onClose: (closed) => {
          scoped.context.cleanup.sessionClosed = closed;
        },
      },
    );
    need(!scoped.context.cleanup.unlockFailed && scoped.context.cleanup.sessionClosed !== false, 'session-cleanup');
    return {
      failure: false,
      nativeDeleteCompleted: [...nativeDeleted],
      remaining: [],
      tileId,
      groupTileId,
      readAbsenceConfirmed: false,
      recording: 'native-governed-unverified',
      mutationDispatched: scoped.mutationDispatched(),
    };
  } catch (error) {
    return {
      failure: true,
      reason: runtimeReason(error),
      stoppedAt: phase,
      created: [...created],
      nativeDeleteCompleted: [...nativeDeleted],
      remaining: [...remaining],
      tileId,
      groupTileId,
      readAbsenceConfirmed: false,
      recording: 'native-governed-unverified',
      mutationDispatched: scoped.mutationDispatched(),
      cleanup: scoped.context.cleanup,
    };
  }
}
