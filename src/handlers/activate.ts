/**
 * SAPActivate handler — activate single/batch objects, CDS activation ordering, message
 * formatting. Extracted from intent.ts (Stage B; moved verbatim).
 */

import type { AdtClient } from '../adt/client.js';
import {
  type ActivationResult,
  activate,
  activateBatch,
  publishServiceBinding,
  unpublishServiceBinding,
} from '../adt/devtools.js';
import { AdtSafetyError } from '../adt/errors.js';
import { isServerDrivenObjectType, serverDrivenBlueContentType, serverDrivenObjectUrl } from '../adt/server-driven.js';
import type { CachingLayer } from '../cache/caching-layer.js';
import { type CacheSecurityContext, invalidateInactiveList } from './cache-security.js';
import { buildCdsActivationDependencyHint } from './cds-hints.js';
import { isTablesEndpointAvailable } from './feature-cache.js';
import { normalizeObjectType, objectUrlForType } from './object-types.js';
import { errorResult, type ToolResult, textResult } from './shared.js';
import {
  enforceAllowedPackageForObjectUrl,
  inactiveSyntaxDiagnostic,
  SERVICEBINDING_V2_ACCEPT,
} from './write-helpers.js';

// ─── SAPActivate Handler ─────────────────────────────────────────────

export async function handleSAPActivate(
  client: AdtClient,
  args: Record<string, unknown>,
  cachingLayer: CachingLayer | undefined,
  cacheSecurity: CacheSecurityContext,
): Promise<ToolResult> {
  const action = String(args.action ?? 'activate');
  const name = String(args.name ?? '');
  const version = String(args.version ?? '0001');
  const explicitServiceType = args.service_type as string | undefined;

  // Resolve the OData service type for publish/unpublish endpoints.
  // Explicit service_type parameter takes precedence; otherwise auto-detect from SRVB metadata.
  async function resolveServiceType(): Promise<'odatav2' | 'odatav4'> {
    if (explicitServiceType === 'odatav4' || explicitServiceType === 'odatav2') return explicitServiceType;
    try {
      const { source: srvbJson } = await client.getSrvb(name);
      const srvb = JSON.parse(srvbJson);
      if (srvb.odataVersion === 'V4') return 'odatav4';
    } catch {
      // If readback fails, fall back to odatav2 (legacy default)
    }
    return 'odatav2';
  }

  // Publish service binding
  if (action === 'publish_srvb') {
    if (!name) {
      return errorResult('Missing required "name" parameter for publish_srvb action.');
    }
    await enforceAllowedPackageForObjectUrl(
      client,
      objectUrlForType('SRVB', name),
      `Publish of service binding '${name}'`,
      SERVICEBINDING_V2_ACCEPT,
    );
    const serviceType = await resolveServiceType();
    const result = await publishServiceBinding(client.http, client.safety, name, version, serviceType);
    if (result.severity === 'ERROR') {
      return errorResult(
        `Failed to publish service binding ${name}: ${result.shortText}${result.longText ? ` — ${result.longText}` : ''}`,
      );
    }
    let srvbInfo: string;
    try {
      srvbInfo = (await client.getSrvb(name)).source;
    } catch {
      if (result.severity === 'UNKNOWN') {
        return errorResult(
          `Publish response for ${name} could not be parsed and readback failed — use SAPRead to verify publish status.`,
        );
      }
      return textResult(
        `Successfully published service binding ${name} (readback of binding metadata failed — use SAPRead to verify)`,
      );
    }
    // Verify the published flag from the SRVB readback
    try {
      const srvbData = JSON.parse(srvbInfo);
      if (srvbData.published === false) {
        return errorResult(
          `Publish of service binding ${name} may have failed — binding is still unpublished.\n\n${srvbInfo}`,
        );
      }
    } catch {
      // If we can't parse the readback JSON, fall through — better to return what we have
    }
    if (result.severity === 'UNKNOWN') {
      return textResult(
        `Publish request for ${name} completed but response could not be fully parsed. Verify status below:\n\n${srvbInfo}`,
      );
    }
    return textResult(`Successfully published service binding ${name}.\n\n${srvbInfo}`);
  }

  // Unpublish service binding
  if (action === 'unpublish_srvb') {
    if (!name) {
      return errorResult('Missing required "name" parameter for unpublish_srvb action.');
    }
    await enforceAllowedPackageForObjectUrl(
      client,
      objectUrlForType('SRVB', name),
      `Unpublish of service binding '${name}'`,
      SERVICEBINDING_V2_ACCEPT,
    );
    const serviceType = await resolveServiceType();
    const result = await unpublishServiceBinding(client.http, client.safety, name, version, serviceType);
    if (result.severity === 'ERROR') {
      return errorResult(
        `Failed to unpublish service binding ${name}: ${result.shortText}${result.longText ? ` — ${result.longText}` : ''}`,
      );
    }
    let srvbInfo: string | undefined;
    try {
      srvbInfo = (await client.getSrvb(name)).source;
    } catch {
      // Readback failed — fall through with what we have
    }
    // Verify the published flag from the SRVB readback
    if (srvbInfo) {
      try {
        const srvbData = JSON.parse(srvbInfo);
        if (srvbData.published === true) {
          return errorResult(
            `Unpublish of service binding ${name} may have failed — binding is still published.\n\n${srvbInfo}`,
          );
        }
      } catch {
        // If we can't parse the readback JSON, fall through
      }
    }
    if (result.severity === 'UNKNOWN') {
      return textResult(
        `Unpublish request for ${name} completed but response could not be fully parsed.${srvbInfo ? ` Verify status below:\n\n${srvbInfo}` : ' Use SAPRead to verify status.'}`,
      );
    }
    return textResult(`Successfully unpublished service binding ${name}.${srvbInfo ? `\n\n${srvbInfo}` : ''}`);
  }

  // Batch activation: multiple objects at once (for RAP stacks etc.)
  const type = normalizeObjectType(String(args.type ?? ''));
  const preaudit = args.preaudit !== undefined ? Boolean(args.preaudit) : undefined;
  const activateOpts = preaudit !== undefined ? { preaudit } : undefined;

  if (args.objects && Array.isArray(args.objects)) {
    const rawObjects = args.objects as Array<Record<string, unknown>>;
    // Resolve URLs sequentially. For TABL we await the URL resolver so DDIC
    // structures (which live at /sap/bc/adt/ddic/structures/) are addressed
    // correctly; the resolver short-circuits on its in-memory cache.
    // For FUNC the URL needs the parent function-group baked into the path
    // (issue #250); each batch entry must carry `group` or be auto-resolvable
    // by name.
    const objects = await Promise.all(
      rawObjects.map(async (o) => {
        const objType = normalizeObjectType(String(o.type ?? type));
        const objName = String(o.name ?? '');
        let url: string;
        if (objType === 'TABL') {
          // Use the write-path resolver: refuses TABL/DT activation on systems
          // that don't expose /sap/bc/adt/ddic/tables/ (NW 7.50/7.51), where
          // activate would hit the wrong endpoint. See issue #285.
          url = await client.resolveTablObjectUrlForWrite(objName, {
            tablesEndpointAvailable: isTablesEndpointAvailable(),
          });
        } else if (objType === 'FUNC') {
          let group = String(o.group ?? args.group ?? '').trim();
          if (!group) {
            const resolved = cachingLayer
              ? await cachingLayer.resolveFuncGroup(client, objName)
              : await client.resolveFunctionGroup(objName);
            if (!resolved) {
              throw new Error(
                `Cannot resolve function group for FM "${objName}" in batch activate. Provide "group" on each FUNC entry.`,
              );
            }
            group = resolved;
          }
          const groupLc = encodeURIComponent(group.toLowerCase());
          url = `/sap/bc/adt/functions/groups/${groupLc}/fmodules/${encodeURIComponent(objName.toLowerCase())}`;
        } else {
          url = objectUrlForType(objType, objName);
        }
        return { type: objType, name: objName, url };
      }),
    );

    // Enforce the allowedPackages ceiling against each object's REAL package before
    // activating ANY of them — one out-of-allowlist object aborts the whole batch
    // (no partial activation). Fail-closed; no-op when unrestricted. (security audit 2026-06)
    for (const o of objects) {
      await enforceAllowedPackageForObjectUrl(client, o.url, `Activation of ${o.type} '${o.name}'`);
    }

    const result = await activateBatch(client.http, client.safety, objects, activateOpts);
    const names = objects.map((o) => o.name).join(', ');
    const batchStatuses = buildBatchActivationStatuses(objects, result);
    const statusDetails = formatBatchActivationStatuses(batchStatuses);

    if (result.success) {
      for (const object of objects) {
        cachingLayer?.invalidate(object.type, object.name, 'all');
      }
      invalidateInactiveList(cachingLayer, client, cacheSecurity);
      return textResult(`Successfully activated ${objects.length} objects: ${names}.${statusDetails}`);
    }
    // On batch failure enrich with per-object inactive-version syntax errors —
    // only for objects whose activation returned no error details, to avoid duplicating messages.
    const objectsNeedingSyntaxCheck = objects.filter((_o, i) => batchStatuses[i].status !== 'error');
    const diagnostics = await Promise.all(
      objectsNeedingSyntaxCheck.map((o) => inactiveSyntaxDiagnostic(client, o.type, o.name)),
    );
    const combinedDiag = diagnostics
      .map((d, i) => (d ? `\n[${objectsNeedingSyntaxCheck[i].name}]${d}` : ''))
      .filter(Boolean)
      .join('');
    return errorResult(
      `Batch activation failed for: ${names}.${statusDetails}\n${formatActivationMessages(result)}${combinedDiag}`,
    );
  }

  // Single activation (existing behavior). For TABL we use the write-path
  // resolver so transparent-table activations on NW 7.50/7.51 are refused
  // with the SE11 hint instead of silently activating against /structures/
  // (which would not even be the right object). See issue #285.
  // For FUNC the URL needs the parent function group baked into the path
  // (issue #250) — `objectBasePath('FUNC')` deliberately throws so generic
  // builders fail loudly. Auto-resolve the group when omitted.
  let objectUrl: string;
  if (type === 'TABL') {
    try {
      objectUrl = await client.resolveTablObjectUrlForWrite(name, {
        tablesEndpointAvailable: isTablesEndpointAvailable(),
      });
    } catch (resolveErr) {
      if (resolveErr instanceof AdtSafetyError) {
        return errorResult(resolveErr.message);
      }
      throw resolveErr;
    }
  } else if (type === 'FUNC') {
    let group = String(args.group ?? '').trim();
    if (!group) {
      const resolved = cachingLayer
        ? await cachingLayer.resolveFuncGroup(client, name)
        : await client.resolveFunctionGroup(name);
      if (!resolved) {
        return errorResult(`Cannot resolve function group for FM "${name}". Provide the "group" parameter explicitly.`);
      }
      group = resolved;
    }
    const groupLc = encodeURIComponent(group.toLowerCase());
    objectUrl = `/sap/bc/adt/functions/groups/${groupLc}/fmodules/${encodeURIComponent(name.toLowerCase())}`;
  } else if (isServerDrivenObjectType(type)) {
    // Server-driven objects (8.16+): objectBasePath(<sdo>) throws, so route via the registry href.
    // Single-object activation only — SDO is not added to the batch resolver above (batch is
    // RAP-stack-oriented). The generic activate() endpoint handles SDO (verified: activate(DESD) → ok).
    objectUrl = serverDrivenObjectUrl(type, name);
  } else {
    objectUrl = objectUrlForType(type, name);
  }

  // Enforce the allowedPackages ceiling against the object's REAL package before
  // activating — activation is a write-class state change (inactive draft → active
  // runtime version) and must honor the same package boundary as create/update/delete.
  // Fail-closed; no-op when allowedPackages is unrestricted. (security audit 2026-06)
  // SDO metadata only renders its packageRef under the blues Accept — thread it for SDO types.
  await enforceAllowedPackageForObjectUrl(
    client,
    objectUrl,
    `Activation of ${type} '${name}'`,
    isServerDrivenObjectType(type) ? serverDrivenBlueContentType(type) : undefined,
  );

  const result = await activate(client.http, client.safety, objectUrl, { ...activateOpts, name });

  if (result.success) {
    cachingLayer?.invalidate(type, name, 'all');
    invalidateInactiveList(cachingLayer, client, cacheSecurity);
    return textResult(`Successfully activated ${type} ${name}.${formatActivationMessages(result)}`);
  }
  // On failure, try to enrich with the actual compiler errors from the inactive version —
  // especially useful when SAP returned <ioc:inactiveObjects> with no <msg> detail.
  // Skip when activation already returned error details to avoid duplicating the same messages.
  const hasActivationErrors = result.details.some((d) => d.severity === 'error');
  const syntaxDetail = hasActivationErrors ? '' : await inactiveSyntaxDiagnostic(client, type, name);
  let activationError = `Activation failed for ${type} ${name}.\n${formatActivationMessages(result)}${syntaxDetail}`;
  if (type === 'DDLS') {
    activationError += `\n\n${await buildCdsActivationDependencyHint(client, name, objectUrl)}`;
  }
  return errorResult(activationError);
}

/** Format activation result messages with structured detail (line numbers, URIs) when available */
function formatActivationMessages(result: ActivationResult): string {
  if (result.details.length === 0) return '';

  const errors = result.details.filter((d) => d.severity === 'error');
  const warnings = result.details.filter((d) => d.severity === 'warning');

  const parts: string[] = [];

  if (errors.length > 0) {
    const formatted = errors.map((e) => {
      const prefix = e.line ? `[line ${e.line}] ` : '';
      const suffix = e.uri ? ` (${e.uri})` : '';
      return `- ${prefix}${e.text}${suffix}`;
    });
    parts.push(`Errors:\n${formatted.join('\n')}`);
  }

  if (warnings.length > 0) {
    const formatted = warnings.map((w) => {
      const prefix = w.line ? `[line ${w.line}] ` : '';
      return `- ${prefix}${w.text}`;
    });
    parts.push(`Warnings:\n${formatted.join('\n')}`);
  }

  // Fall back to flat messages if no errors/warnings but info messages exist
  if (parts.length === 0 && result.messages.length > 0) {
    return `\nMessages: ${result.messages.join('; ')}`;
  }

  return parts.length > 0 ? `\n${parts.join('\n')}` : '';
}

export interface BatchActivationObject {
  type: string;
  name: string;
  url: string;
}

interface BatchActivationObjectStatus {
  type: string;
  name: string;
  status: 'active' | 'warning' | 'error';
  messages: string[];
}

function normalizeActivationUri(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  return uri.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();
}

export function buildBatchActivationStatuses(
  objects: BatchActivationObject[],
  result: ActivationResult,
): BatchActivationObjectStatus[] {
  // Group error details by object. SAP error URIs may be subpaths of the object URL
  // (e.g. .../classes/zcl_demo/source/main for object .../classes/ZCL_DEMO) and may
  // differ in case, so we lowercase and use startsWith for matching.
  const objectKeys = objects.map((obj) => normalizeActivationUri(obj.url) ?? '');
  const perObject: Array<Array<{ severity: 'error' | 'warning' | 'info'; text: string }>> = objects.map(() => []);
  const unassigned: string[] = [];

  for (const detail of result.details) {
    const detailUri = normalizeActivationUri(detail.uri);
    const prefix = detail.line ? `[line ${detail.line}] ` : '';
    const suffix = detail.uri ? ` (${detail.uri})` : '';
    if (!detailUri) {
      unassigned.push(`${prefix}${detail.text}${suffix}`);
      continue;
    }
    const matchIdx = objectKeys.findIndex((k) => k && detailUri.startsWith(k));
    if (matchIdx >= 0) {
      perObject[matchIdx].push({ severity: detail.severity, text: `${prefix}${detail.text}${suffix}` });
    } else {
      unassigned.push(`${prefix}${detail.text}${suffix}`);
    }
  }

  return objects.map((obj, index) => {
    const details = perObject[index];
    const hasError = details.some((detail) => detail.severity === 'error');
    const hasWarning = details.some((detail) => detail.severity === 'warning');
    const status: BatchActivationObjectStatus['status'] = hasError ? 'error' : hasWarning ? 'warning' : 'active';
    const messages = details.map((detail) => detail.text);
    if (index === 0 && unassigned.length > 0) {
      messages.push(...unassigned);
    }
    return {
      type: obj.type,
      name: obj.name,
      status,
      messages,
    };
  });
}

export function formatBatchActivationStatuses(statuses: BatchActivationObjectStatus[]): string {
  if (statuses.length === 0) return '';
  const lines: string[] = [];
  for (const status of statuses) {
    if (status.messages.length === 0) {
      lines.push(`- ${status.name} (${status.type}): ${status.status}`);
    } else {
      for (const msg of status.messages) {
        lines.push(`- ${status.name} (${status.type}) ${msg}`);
      }
    }
  }
  return `\n${lines.join('\n')}`;
}

// ─── SAPDiagnose Handler ─────────────────────────────────────────────
