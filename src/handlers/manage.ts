/**
 * SAPManage handler — server lifecycle: feature probe, discovery cache, package CRUD, FLP catalog
 * management.
 */

import type { AdtClient } from '../adt/client.js';
import { createObject, deleteObject, lockObject, unlockObject } from '../adt/crud.js';
import { buildPackageXml, type PackageCreateParams } from '../adt/ddic-xml.js';
import { probeFeatures } from '../adt/features.js';
import {
  addTileToGroup,
  createCatalog,
  createGroup,
  createTile,
  deleteCatalog,
  listCatalogs,
  listGroups,
  listTiles,
} from '../adt/flp.js';
import { changePackage } from '../adt/refactoring.js';
import { checkOperation, checkPackage, OperationType } from '../adt/safety.js';
import { getTransportInfo } from '../adt/transport.js';
import type { CachingLayer } from '../cache/caching-layer.js';
import type { ServerConfig } from '../server/types.js';
import { cachedFeatures, setCachedFeatures } from './feature-cache.js';
import { inferObjectType, normalizeObjectType, objectUrlForTypeRaw } from './object-types.js';
import { errorResult, type ToolResult, textResult } from './shared.js';
import { enforceAllowedPackageForObjectUrl, resolveWriteSystemType } from './write-helpers.js';

// ─── SAPManage Handler ────────────────────────────────────────────────

export async function handleSAPManage(
  client: AdtClient,
  config: ServerConfig,
  args: Record<string, unknown>,
  cachingLayer?: CachingLayer,
  isPerUserClient?: boolean,
): Promise<ToolResult> {
  const action = String(args.action ?? '');
  const flpUnavailableMessage =
    'FLP customization service (PAGE_BUILDER_CUST) is not available on this system. Check ICF service activation in SICF.';

  switch (action) {
    case 'features': {
      if (!cachedFeatures) {
        return textResult(
          JSON.stringify({ message: 'No features probed yet. Use action="probe" to probe the SAP system first.' }),
        );
      }
      return textResult(JSON.stringify(cachedFeatures, null, 2));
    }

    case 'set_api_state': {
      // Clean-core API release: set an object's release contract to RELEASED / NOT_RELEASED.
      const stateArg = String(args.apiState ?? 'RELEASED').toUpperCase();
      if (stateArg !== 'RELEASED' && stateArg !== 'NOT_RELEASED') {
        return errorResult('apiState must be "RELEASED" or "NOT_RELEASED".');
      }
      // Which release contract to set. C1 (Key-User/Cloud) is the common clean-core default, but
      // object types support different contracts — e.g. SRVD only C0, classic VIEW only C3 — so the
      // caller can pick. SAP validates the choice (set_api_state surfaces the supported list on error).
      const contract = String(args.contract ?? 'C1').toUpperCase();
      if (!/^C[0-4]$/.test(contract)) {
        return errorResult('contract must be one of C0, C1, C2, C3, C4.');
      }
      // Address by objectUri, or compute from objectType + name (same inference as SAPRead API_STATE).
      let objectUri = String(args.objectUri ?? '').trim();
      if (!objectUri) {
        const name = String(args.name ?? '').trim();
        if (!name) {
          return errorResult('set_api_state requires "objectUri", or "name" (+ optional "objectType").');
        }
        const inferred = normalizeObjectType(String(args.objectType ?? '')) || inferObjectType(name);
        if (!inferred) {
          return errorResult(
            `Cannot infer object type from name "${name}". Specify objectType (e.g. CLAS, INTF, DDLS, TABL).`,
          );
        }
        objectUri = objectUrlForTypeRaw(inferred, name);
      }
      // Fail-closed package gate against the object's REAL package (resolves via the object URI).
      await enforceAllowedPackageForObjectUrl(client, objectUri, `set_api_state on ${objectUri}`);
      const result = await client.setApiReleaseState(objectUri, {
        state: stateArg,
        contract,
        transport: args.transport as string | undefined,
      });
      const c = result.contracts.find((ct) => ct.contract === contract);
      const vis = [c?.useInSAPCloudPlatform ? 'ABAP Cloud' : '', c?.useInKeyUserApps ? 'Key User Apps' : '']
        .filter(Boolean)
        .join(', ');
      const endState = c?.state ?? stateArg;
      const lead = result.changed
        ? `Set API release contract ${contract} of ${objectUri} to ${endState}`
        : `API release contract ${contract} of ${objectUri} is already ${endState} (no change)`;
      return textResult(`${lead}${vis ? ` (visible in ${vis})` : ''}.\n\n${JSON.stringify(result, null, 2)}`);
    }

    case 'create_package': {
      const name = String(args.name ?? '').trim();
      const description = String(args.description ?? '').trim();
      const superPackage = String(args.superPackage ?? '').trim();
      const softwareComponent = String(args.softwareComponent ?? '').trim();
      const transportLayer = String(args.transportLayer ?? '').trim();
      const recordChanges = typeof args.recordChanges === 'boolean' ? args.recordChanges : undefined;
      const transport = String(args.transport ?? '').trim();
      const responsibleArg = String(args.responsible ?? '').trim();

      if (!name) return errorResult('"name" is required for create_package action.');
      if (!description) return errorResult('"description" is required for create_package action.');

      checkOperation(client.safety, OperationType.Create, 'CreatePackage');

      // Package allowlist gate:
      // - When `superPackage` is set, gate the parent. This enables creating
      //   children in allowed parents like $TMP. With subtree (`X/**`) rules,
      //   the new child will automatically be inside its parent's subtree.
      // - When `superPackage` is omitted, the new package is created at the
      //   root and IS the gateable name itself — otherwise an admin's
      //   allowedPackages restriction would be bypassed by simply omitting
      //   the parent. Gate the new name in that case.
      if (superPackage) {
        await checkPackage(client.safety, superPackage, client.getPackageHierarchyResolver());
      } else {
        await checkPackage(client.safety, name, client.getPackageHierarchyResolver());
      }

      // BTP: responsible must be the internal ABAP user (never the email — getEffectiveUser is unused);
      // resolve explicit arg → cached internal user → error. Cloud also skips the transport pre-flight
      // below. Details: docs/research/2026-06-27-btp-package-create-solved.md.
      const systemType = resolveWriteSystemType(config, client);
      const cloud = systemType === 'btp';
      const responsible = cloud ? responsibleArg || client.getInternalUser() || '' : config.username;
      if (cloud) {
        if (!superPackage) {
          return errorResult(
            'BTP packages must nest under a structure package: pass superPackage (e.g. "ZLOCAL"). ' +
              'A root package create is rejected with TR/458 ("… is not a valid software component").',
          );
        }
        if (!responsible || responsible.includes('@')) {
          return errorResult(
            'BTP package create needs your internal ABAP user (XUBNAME, e.g. CB9980000000) as ' +
              'person-responsible — the IAS email is rejected. Pass responsible="<internal user>" (from ' +
              'SAPRead createdBy on an object you own), or create any object first to auto-resolve it.',
          );
        }
      }

      let effectiveTransport = transport || undefined;
      const packageUrl = `/sap/bc/adt/packages/${encodeURIComponent(name)}`;

      // Transport pre-flight for non-local parent packages when no transport is provided. Skipped on
      // cloud — BTP packages under the local SC need no STMS transport (live-verified: ZLOCAL → 201).
      if (!cloud && !effectiveTransport && superPackage && superPackage.toUpperCase() !== '$TMP') {
        try {
          const transportInfo = await getTransportInfo(client.http, client.safety, packageUrl, superPackage, 'I');
          if (transportInfo.lockedTransport) {
            effectiveTransport = transportInfo.lockedTransport;
          } else if (!transportInfo.isLocal && transportInfo.recording) {
            const existingList =
              transportInfo.existingTransports.length > 0
                ? `\n\nExisting transports for this package:\n${transportInfo.existingTransports
                    .slice(0, 10)
                    .map((t) => `  - ${t.id}: ${t.description} (${t.owner})`)
                    .join('\n')}`
                : '';
            return errorResult(
              `Package "${superPackage}" requires a transport number for package creation, but none was provided.\n\n` +
                `To fix this, either:\n` +
                `1. Use SAPTransport(action="list") to find an existing modifiable transport\n` +
                `2. Use SAPTransport(action="create", description="...") to create a new one\n` +
                `3. Then retry SAPManage(action="create_package", ..., transport="<transport_id>")` +
                existingList,
            );
          }
        } catch {
          // Graceful fallback: let SAP enforce transport requirements if the pre-check fails.
        }
      }

      const packageTypeRaw = String(args.packageType ?? '').trim();
      const packageType: PackageCreateParams['packageType'] =
        packageTypeRaw === 'development' || packageTypeRaw === 'structure' || packageTypeRaw === 'main'
          ? packageTypeRaw
          : undefined;

      const xml = buildPackageXml({
        name,
        description,
        superPackage: superPackage || undefined,
        softwareComponent: softwareComponent || undefined,
        transportLayer: transportLayer || undefined,
        recordChanges,
        packageType,
        responsible,
        cloud,
      });

      await createObject(
        client.http,
        client.safety,
        '/sap/bc/adt/packages',
        xml,
        'application/*',
        effectiveTransport,
        undefined,
        cachedFeatures?.abapRelease,
      );
      // Hierarchy changed: invalidate any cached subtree that could contain
      // the new package. Conservative: clear all (cheap; per-call cost is one BFS).
      client.invalidatePackageHierarchy();
      return textResult(`Created package ${name}.`);
    }

    case 'delete_package': {
      const name = String(args.name ?? '').trim();
      const transport = String(args.transport ?? '').trim();
      if (!name) return errorResult('"name" is required for delete_package action.');

      checkOperation(client.safety, OperationType.Delete, 'DeletePackage');
      // Gate by allowedPackages: deletion targets the package itself, so the
      // package name must be in the allowed set (or in an allowed subtree).
      await checkPackage(client.safety, name, client.getPackageHierarchyResolver());

      const packageUrl = `/sap/bc/adt/packages/${encodeURIComponent(name)}`;
      await client.http.withStatefulSession(async (session) => {
        const lock = await lockObject(session, client.safety, packageUrl, 'MODIFY', cachedFeatures?.abapRelease);
        const effectiveTransport = transport || lock.corrNr || undefined;
        try {
          await deleteObject(session, client.safety, packageUrl, lock.lockHandle, effectiveTransport);
        } finally {
          try {
            await unlockObject(session, packageUrl, lock.lockHandle);
          } catch {
            // Object may already be deleted — unlock failure is expected.
          }
        }
      });

      // Hierarchy changed: invalidate cached subtrees.
      client.invalidatePackageHierarchy();
      return textResult(`Deleted package ${name}.`);
    }

    case 'change_package': {
      const objectName = String(args.objectName ?? '').trim();
      const objectType = String(args.objectType ?? '').trim();
      const oldPackage = String(args.oldPackage ?? '').trim();
      const newPackage = String(args.newPackage ?? '').trim();
      const transport = String(args.transport ?? '').trim();
      let objectUri = String(args.objectUri ?? '').trim();

      if (!objectName) return errorResult('"objectName" is required for change_package action.');
      if (!objectType) return errorResult('"objectType" is required for change_package action.');
      if (!oldPackage) return errorResult('"oldPackage" is required for change_package action.');
      if (!newPackage) return errorResult('"newPackage" is required for change_package action.');

      checkOperation(client.safety, OperationType.Update, 'ChangePackage');
      {
        const resolver = client.getPackageHierarchyResolver();
        await checkPackage(client.safety, oldPackage, resolver);
        await checkPackage(client.safety, newPackage, resolver);
      }

      // Resolve object URI via search if not provided
      if (!objectUri) {
        const searchResp = await client.http.get(
          `/sap/bc/adt/repository/informationsystem/search?operation=quickSearch&query=${encodeURIComponent(objectName)}&maxResults=10`,
        );
        const uriMatch = searchResp.body.match(
          new RegExp(`adtcore:uri="([^"]*)"[^>]*adtcore:type="${objectType.replace('/', '\\/')}"`, 'i'),
        );
        if (!uriMatch?.[1]) {
          return errorResult(
            `Could not find object "${objectName}" with type "${objectType}" via ADT search. ` +
              `Verify the object exists and the type is correct (e.g., CLAS/OC, DDLS/DF, PROG/P).`,
          );
        }
        objectUri = uriMatch[1];
      }

      // SECURITY: gate the object's REAL package (resolved from objectUri via ADT
      // metadata), not the caller-supplied `oldPackage` — authorization must never
      // trust an attacker-controlled source-package string. This is the authoritative
      // source gate; the `checkPackage(oldPackage)` above is defense-in-depth only.
      // Fail-closed; no-op when allowedPackages is unrestricted. (security audit 2026-06)
      await enforceAllowedPackageForObjectUrl(client, objectUri, `change_package of ${objectName}`);

      // Transport pre-flight for non-local target packages
      let effectiveTransport = transport || undefined;
      if (!effectiveTransport && newPackage.toUpperCase() !== '$TMP') {
        try {
          const transportInfo = await getTransportInfo(client.http, client.safety, objectUri, newPackage, 'I');
          if (transportInfo.lockedTransport) {
            effectiveTransport = transportInfo.lockedTransport;
          } else if (!transportInfo.isLocal && transportInfo.recording) {
            const existingList =
              transportInfo.existingTransports.length > 0
                ? `\n\nExisting transports for this package:\n${transportInfo.existingTransports
                    .slice(0, 10)
                    .map((t) => `  - ${t.id}: ${t.description} (${t.owner})`)
                    .join('\n')}`
                : '';
            return errorResult(
              `Package "${newPackage}" requires a transport number for change_package, but none was provided.\n\n` +
                `To fix this, either:\n` +
                `1. Use SAPTransport(action="list") to find an existing modifiable transport\n` +
                `2. Use SAPTransport(action="create", description="...") to create a new one\n` +
                `3. Then retry SAPManage(action="change_package", ..., transport="<transport_id>")` +
                existingList,
            );
          }
        } catch {
          // Graceful fallback: let SAP enforce transport requirements if the pre-check fails.
        }
      }

      const result = await changePackage(client.http, client.safety, {
        objectUri,
        objectType,
        objectName,
        oldPackage,
        newPackage,
        transport: effectiveTransport,
      });

      // Hierarchy may have shifted (object moved between packages); invalidate cache.
      client.invalidatePackageHierarchy();
      const transportNote = result.transport ? ` (transport: ${result.transport})` : '';
      return textResult(`Moved ${objectName} from package ${oldPackage} to ${newPackage}${transportNote}.`);
    }

    case 'flp_list_catalogs': {
      const catalogs = await listCatalogs(client.http, client.safety);
      const customCount = catalogs.filter((c) => /^(Z|Y)/i.test(c.domainId)).length;
      const lines = [
        `${catalogs.length} catalogs (${customCount} custom Z/Y). Columns: domainId | title | type | scope | chips`,
        ...catalogs.map(
          (c) => `${c.domainId} | ${c.title || '(no title)'} | ${c.type || '-'} | ${c.scope || '-'} | ${c.chipCount}`,
        ),
      ];
      return textResult(lines.join('\n'));
    }

    case 'flp_list_groups': {
      const groups = await listGroups(client.http, client.safety);
      const lines = [
        `${groups.length} groups. Columns: id | title`,
        ...groups.map((g) => `${g.id} | ${g.title || '(no title)'}`),
      ];
      return textResult(lines.join('\n'));
    }

    case 'flp_list_tiles': {
      const catalogId = String(args.catalogId ?? '');
      if (!catalogId) return errorResult('"catalogId" is required for flp_list_tiles action.');
      const result = await listTiles(client.http, client.safety, catalogId);
      if (result.backendError) {
        return textResult(`⚠ Backend error for catalog "${catalogId}": ${result.backendError}\n\nReturned 0 tiles.`);
      }
      const lines = [
        `${result.tiles.length} tiles in catalog "${catalogId}". Columns: instanceId | title | chipId | semanticObject | semanticAction`,
        ...result.tiles.map((t) => {
          const so = (t.configuration as Record<string, unknown> | null)?.semantic_object ?? '';
          const sa = (t.configuration as Record<string, unknown> | null)?.semantic_action ?? '';
          return `${t.instanceId} | ${t.title || '(no title)'} | ${t.chipId} | ${so} | ${sa}`;
        }),
      ];
      return textResult(lines.join('\n'));
    }

    case 'flp_create_catalog': {
      if (cachedFeatures?.flp && !cachedFeatures.flp.available) {
        return errorResult(flpUnavailableMessage);
      }
      const domainId = String(args.domainId ?? '');
      const title = String(args.title ?? '');
      if (!domainId) return errorResult('"domainId" is required for flp_create_catalog action.');
      if (!title) return errorResult('"title" is required for flp_create_catalog action.');
      const catalog = await createCatalog(client.http, client.safety, domainId, title);
      return textResult(JSON.stringify(catalog, null, 2));
    }

    case 'flp_create_group': {
      if (cachedFeatures?.flp && !cachedFeatures.flp.available) {
        return errorResult(flpUnavailableMessage);
      }
      const groupId = String(args.groupId ?? '');
      const title = String(args.title ?? '');
      if (!groupId) return errorResult('"groupId" is required for flp_create_group action.');
      if (!title) return errorResult('"title" is required for flp_create_group action.');
      const group = await createGroup(client.http, client.safety, groupId, title);
      return textResult(JSON.stringify(group, null, 2));
    }

    case 'flp_create_tile': {
      if (cachedFeatures?.flp && !cachedFeatures.flp.available) {
        return errorResult(flpUnavailableMessage);
      }
      const catalogId = String(args.catalogId ?? '');
      if (!catalogId) return errorResult('"catalogId" is required for flp_create_tile action.');
      const rawTile = args.tile;
      if (!rawTile || typeof rawTile !== 'object' || Array.isArray(rawTile)) {
        return errorResult('"tile" object is required for flp_create_tile action.');
      }
      const tile = rawTile as Record<string, unknown>;
      const id = String(tile.id ?? '');
      const title = String(tile.title ?? '');
      const semanticObject = String(tile.semanticObject ?? '');
      const semanticAction = String(tile.semanticAction ?? '');
      if (!id || !title || !semanticObject || !semanticAction) {
        return errorResult(
          '"tile.id", "tile.title", "tile.semanticObject", and "tile.semanticAction" are required for flp_create_tile action.',
        );
      }
      const tileInstance = await createTile(client.http, client.safety, catalogId, {
        id,
        title,
        semanticObject,
        semanticAction,
        icon: typeof tile.icon === 'string' ? tile.icon : undefined,
        url: typeof tile.url === 'string' ? tile.url : undefined,
        subtitle: typeof tile.subtitle === 'string' ? tile.subtitle : undefined,
        info: typeof tile.info === 'string' ? tile.info : undefined,
      });
      return textResult(JSON.stringify(tileInstance, null, 2));
    }

    case 'flp_add_tile_to_group': {
      if (cachedFeatures?.flp && !cachedFeatures.flp.available) {
        return errorResult(flpUnavailableMessage);
      }
      const groupId = String(args.groupId ?? '');
      const catalogId = String(args.catalogId ?? '');
      const tileInstanceId = String(args.tileInstanceId ?? '');
      if (!groupId) return errorResult('"groupId" is required for flp_add_tile_to_group action.');
      if (!catalogId) return errorResult('"catalogId" is required for flp_add_tile_to_group action.');
      if (!tileInstanceId) return errorResult('"tileInstanceId" is required for flp_add_tile_to_group action.');
      const result = await addTileToGroup(client.http, client.safety, groupId, catalogId, tileInstanceId);
      return textResult(JSON.stringify(result, null, 2));
    }

    case 'flp_delete_catalog': {
      if (cachedFeatures?.flp && !cachedFeatures.flp.available) {
        return errorResult(flpUnavailableMessage);
      }
      const catalogId = String(args.catalogId ?? '');
      if (!catalogId) return errorResult('"catalogId" is required for flp_delete_catalog action.');
      await deleteCatalog(client.http, client.safety, catalogId);
      return textResult(`Deleted FLP catalog: ${catalogId}`);
    }

    case 'cache_stats': {
      if (!cachingLayer) {
        return textResult(JSON.stringify({ enabled: false, message: 'Object cache is disabled (ARC1_CACHE=none).' }));
      }
      const stats = cachingLayer.stats();
      return textResult(
        JSON.stringify(
          {
            enabled: true,
            warmupAvailable: cachingLayer.isWarmupAvailable,
            ...stats,
            inactiveListCache: cachingLayer.inactiveLists.stats(),
          },
          null,
          2,
        ),
      );
    }

    case 'probe': {
      const { defaultFeatureConfig } = await import('../adt/config.js');
      const featureConfig = defaultFeatureConfig();
      // Override with server config feature toggles
      featureConfig.hana = config.featureHana as 'auto' | 'on' | 'off';
      featureConfig.abapGit = config.featureAbapGit as 'auto' | 'on' | 'off';
      featureConfig.rap = config.featureRap as 'auto' | 'on' | 'off';
      featureConfig.amdp = config.featureAmdp as 'auto' | 'on' | 'off';
      featureConfig.ui5 = config.featureUi5 as 'auto' | 'on' | 'off';
      featureConfig.transport = config.featureTransport as 'auto' | 'on' | 'off';
      featureConfig.ui5repo = config.featureUi5Repo as 'auto' | 'on' | 'off';
      featureConfig.flp = config.featureFlp as 'auto' | 'on' | 'off';

      const probed = await probeFeatures(client.http, featureConfig, config.systemType);

      // In PP mode with a per-user client, auth-sensitive results (401/403 on any
      // feature) must not poison the global cache — another user may have different
      // authorizations.  Return the per-user result to the caller but keep the global
      // cache unchanged.  However, when PP is enabled but the request fell back to the
      // shared/default client (no JWT, missing btpConfig, or non-strict fallback), the
      // probe ran with the same service-account credentials as the startup probe, so
      // updating the cache is safe and allows a manual probe to repair a failed startup.
      // Apply the same auth-failure sanitization as the startup probe: in PP mode,
      // shared-client 401/403 on textSearch must not hide source_code from users who
      // might have authorization via per-user clients.
      if (!isPerUserClient) {
        if (config.ppEnabled && probed.textSearch && !probed.textSearch.available) {
          const reason = probed.textSearch.reason ?? '';
          if (reason.includes('authorization') || reason.includes('401') || reason.includes('403')) {
            probed.textSearch = undefined;
          }
        }
        setCachedFeatures(probed);
      }
      return textResult(JSON.stringify(probed, null, 2));
    }

    default:
      return errorResult(
        `Unknown SAPManage action: ${action}. Supported: features, probe, cache_stats, create_package, delete_package, change_package, flp_list_catalogs, flp_list_groups, flp_list_tiles, flp_create_catalog, flp_create_group, flp_create_tile, flp_add_tile_to_group, flp_delete_catalog`,
      );
  }
}
