import type { AdtClient } from '../../adt/client.js';
import { AdtApiError } from '../../adt/errors.js';
import { checkOperation, checkPackage, OperationType } from '../../adt/safety.js';
import {
  createServerDrivenObject,
  ensureServerDrivenSupport,
  serverDrivenMetadataContentType,
  serverDrivenObjectUrl,
  serverDrivenUnavailableMessage,
  updateServerDrivenObjectSource,
} from '../../adt/server-driven.js';
import {
  checkUiadCandidate,
  parseUiadSource,
  type UiadValidation,
  uiadValidationSummary,
  validateUiadSource,
} from '../../adt/uiad.js';
import type { CachingLayer } from '../../cache/caching-layer.js';
import type { ServerConfig } from '../../server/types.js';
import { type CacheSecurityContext, invalidateInactiveList } from '../cache-security.js';
import { errorResult, type ToolResult, toolJson } from '../shared.js';
import { enforceAllowedPackageForObjectUrl } from '../write-helpers.js';

/** UIAD is saved active and has a candidate-check protocol distinct from other SDOs. */
export async function writeUiad(
  client: AdtClient,
  action: 'create' | 'update',
  name: string,
  args: Record<string, unknown>,
  config: ServerConfig,
  cachingLayer: CachingLayer | undefined,
  cacheSecurity: CacheSecurityContext,
): Promise<ToolResult> {
  const create = action === 'create';
  checkOperation(client.safety, create ? OperationType.Create : OperationType.Update, 'WriteUIAD');
  if (!(await ensureServerDrivenSupport(client.http, client.safety, 'UIAD')))
    return errorResult(serverDrivenUnavailableMessage('SAPWrite', 'UIAD'));
  const uri = serverDrivenObjectUrl('UIAD', name);
  const pkg = String(args.package ?? '$TMP');
  if (create) await checkPackage(client.safety, pkg, client.getPackageHierarchyResolver());
  else
    await enforceAllowedPackageForObjectUrl(
      client,
      uri,
      `Operations on UIAD '${name}'`,
      serverDrivenMetadataContentType('UIAD'),
    );

  const source = typeof args.source === 'string' ? args.source : '';
  if (!create && !source.trim()) return errorResult('SAPWrite update for UIAD requires source (complete AFF JSON).');
  let parsed: ReturnType<typeof parseUiadSource> | undefined;
  if (source.trim()) {
    try {
      parsed = parseUiadSource(source);
    } catch {
      return errorResult(
        'UIAD source must be a valid AFF JSON object (maximum 1 MiB, bounded nesting) with a supported header.abapLanguageVersion. No object was changed.',
      );
    }
  }
  let validation: UiadValidation = { schema: 'notRun', semantic: 'notRun', configuration: 'notRun', issues: [] };
  if (parsed) validation = await validateUiadSource(client.http, client.safety, uri, source, parsed.value, create);
  const manifest: {
    type: 'UIAD';
    name: string;
    action: string;
    metadata: 'notAttempted' | 'unknown' | 'created' | 'existing';
    source: 'notAttempted' | 'unknown' | 'saved';
    phase: string;
  } = {
    type: 'UIAD',
    name,
    action,
    metadata: create ? 'notAttempted' : 'existing',
    source: 'notAttempted',
    phase: 'validation',
  };
  const response = (
    isError: boolean,
    status: string,
    message: string,
    detail?: Record<string, unknown>,
  ): ToolResult => ({
    ...(isError ? { isError: true } : {}),
    content: [
      {
        type: 'text',
        text: toolJson({
          status,
          message,
          ...manifest,
          validation: uiadValidationSummary(validation, config.minimalErrors),
          ...detail,
        }),
      },
    ],
  });
  if (validation.configuration === 'readonly')
    return response(
      true,
      'blocked',
      'SAP marks this UIAD read-only. For a deployment-generated descriptor, edit manifest.json and redeploy the app; use a separately created editable descriptor for independent tiles. No mutation was attempted.',
    );
  if (validation.schema === 'failed' || validation.semantic === 'failed')
    return response(
      true,
      'blocked',
      'UIAD candidate validation found errors. Correct the submitted source and try again. No mutation was attempted.',
    );

  const transport = args.transport as string | undefined;
  try {
    if (create) {
      manifest.phase = 'metadata';
      manifest.metadata = 'unknown';
      await createServerDrivenObject(client.http, client.safety, 'UIAD', name, {
        package: pkg,
        description: String(args.description ?? name),
        transport,
        uiadLanguageVersion: parsed?.languageVersion,
      });
      manifest.metadata = 'created';
    }
    if (parsed) {
      manifest.phase = 'lock';
      await updateServerDrivenObjectSource(client.http, client.safety, 'UIAD', name, source, {
        transport,
        onSourceWrite: (state) => {
          manifest.source = state === 'attempted' ? 'unknown' : 'saved';
          manifest.phase = state === 'attempted' ? 'source' : 'unlock';
        },
      });
    }
    manifest.phase = 'complete';
    return response(
      false,
      create ? 'created' : 'updated',
      parsed
        ? 'UIAD source saved. See validation for warnings or unavailable preflight checks.'
        : 'UIAD metadata created without source validation. Read the object and supply its complete AFF JSON to finish it.',
    );
  } catch (error) {
    // A save can discover context-dependent errors that did not appear for an uncreated URI.
    // Recheck the same candidate once, without another write; never replace the original failure.
    let afterFailure: Record<string, unknown> | undefined;
    if (manifest.phase === 'source' && error instanceof AdtApiError && [400, 422].includes(error.statusCode)) {
      try {
        const check = await checkUiadCandidate(client.http, client.safety, uri, source);
        afterFailure = uiadValidationSummary(
          { ...validation, check, semantic: check.hasErrors ? 'failed' : check.checked ? 'passed' : 'unavailable' },
          config.minimalErrors,
        );
      } catch {
        afterFailure = { semantic: 'unavailable' };
      }
    }
    const failure =
      config.minimalErrors || (error instanceof AdtApiError && [401, 403].includes(error.statusCode))
        ? 'SAP rejected or could not confirm the operation.'
        : error instanceof AdtApiError
          ? error.responseBody
            ? AdtApiError.extractCleanMessage(error.responseBody).slice(0, 1500)
            : `SAP request failed (HTTP ${error.statusCode}).`
          : 'The operation could not be confirmed. Check the server logs for the original failure.';
    return response(
      true,
      'failed',
      manifest.source === 'saved'
        ? 'SAP confirmed the source save, but cleanup failed. Inspect the object and lock state before further edits.'
        : 'The operation failed. Read the UIAD to establish its current state before retrying. A confirmed metadata create is retained; repair it with update or explicitly delete it.',
      {
        failure,
        ...(error instanceof AdtApiError ? { httpStatus: error.statusCode } : {}),
        ...(afterFailure ? { afterFailure } : {}),
      },
    );
  } finally {
    if (manifest.metadata === 'created' || manifest.metadata === 'unknown' || manifest.source !== 'notAttempted') {
      cachingLayer?.invalidate('UIAD', name, 'all');
      invalidateInactiveList(cachingLayer, client, cacheSecurity);
    }
  }
}
