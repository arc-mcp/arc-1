/**
 * SAPTransport handler — CTS transport management (create, release, list, history, targets,
 * layers).
 */

import { type AdtClient, clampSearchResults } from '../adt/client.js';
import { AdtApiError } from '../adt/errors.js';
import { checkTransport } from '../adt/safety.js';
import {
  createTransport,
  createTransportWithTarget,
  deleteTransport,
  failedReleaseReports,
  getObjectTransports,
  getTransport,
  getTransportInfo,
  inactiveObjectsForTransport,
  listTransportLayers,
  listTransports,
  listTransportTargets,
  reassignTransport,
  releaseTransport,
  releaseTransportRecursive,
  removeObjectFromTransport,
  supportsExplicitTransportTarget,
} from '../adt/transport.js';
import type { InactiveObject, ObjectTransportHistory, TransportReleaseReport, TransportRequest } from '../adt/types.js';
import { logger } from '../server/logger.js';
import { objectUrlForType } from './object-types.js';
import { errorResult, type ToolResult, textResult, toolJson } from './shared.js';

/** Default page size for `list`. Object lists dominate the payload, so the backlog sets the cost. */
const DEFAULT_TRANSPORT_RESULTS = 50;

/**
 * Pre-release guard: find inactive objects that belong to `transportId`. Releasing a transport that
 * still contains inactive objects makes SAP's release pipeline hang (it activates before exporting),
 * which the agent sees only as an opaque timeout. Returns the blocking objects — or `[]` if there are
 * none, OR if the probe itself fails (graceful degradation: never block a legitimate release on a
 * diagnostic error).
 */
async function precheckInactiveForRelease(client: AdtClient, transportId: string): Promise<InactiveObject[]> {
  try {
    const inactive = await client.getInactiveObjects();
    return inactiveObjectsForTransport(inactive, transportId);
  } catch (err) {
    logger.warn('Pre-release inactive-objects check failed; proceeding with release', {
      transportId,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** Format the blocking-inactive error shared by `release` / `release_recursive`. */
function inactiveReleaseError(transportId: string, blocking: InactiveObject[]): ToolResult {
  const list = blocking.map((o) => `  - ${o.type} ${o.name}`).join('\n');
  return errorResult(
    `Transport ${transportId} cannot be released: ${blocking.length} inactive object(s) would hang the ` +
      `release (SAP activates objects before exporting; an inactive one makes the release pipeline time out ` +
      `with no detail):\n${list}\nActivate them first (SAPActivate), then retry the release.`,
  );
}

/** Render one release report's findings as indented lines. */
function formatReleaseReport(r: TransportReleaseReport): string {
  const head = r.statusText || `[${r.status}] ${r.reporter}`;
  const msgs = r.messages.map((m) => `    - ${m.severity}: ${m.text}${m.uri ? ` (${m.uri})` : ''}`);
  return [`  • ${head}`, ...msgs].join('\n');
}

/**
 * Turn release check reports into a tool result. A blocked release returns HTTP 200 with
 * `status≠released` — so this is the only place that distinguishes a real release from a silent abort.
 * Clean release → the same concise line as before (token-lean); warnings → that line + the findings;
 * blocked → an error with the reporter status + messages so the agent knows why.
 *
 * @param released  ids that actually released (recursive case); enables the `Released (recursive): …` form.
 */
function summarizeRelease(id: string, reports: TransportReleaseReport[], released?: string[]): ToolResult {
  const failed = failedReleaseReports(reports);
  if (failed.length > 0) {
    const detail = failed.map(formatReleaseReport).join('\n');
    const partial = released && released.length > 0 ? `\nReleased before the block: ${released.join(', ')}.` : '';
    return errorResult(
      `Transport ${id} was NOT released — SAP returned HTTP 200 but aborted the release:\n${detail}${partial}\n` +
        `Fix the reported errors (e.g. ATC findings, locks), then retry.`,
    );
  }
  const prefix = released
    ? `Released (recursive): ${released.length ? released.join(', ') : id}`
    : `Released transport request: ${id}`;
  const warnings = reports.flatMap((r) => r.messages);
  if (warnings.length > 0) {
    const list = warnings.map((m) => `  - ${m.severity}: ${m.text}${m.uri ? ` (${m.uri})` : ''}`).join('\n');
    return textResult(`${prefix}\nReleased with ${warnings.length} warning(s):\n${list}`);
  }
  return textResult(prefix);
}

// ─── SAPTransport Handler ────────────────────────────────────────────

/**
 * Headers-only view of a transport for `list` summary mode: drop the (often large)
 * per-task object lists and keep an objectCount. The `list` response embeds every
 * object of every open transport inline, so on a busy box this turns a ~80 KB payload
 * into a few KB — the caller `get`s a specific id when it needs the objects.
 */
function summarizeTransport(t: TransportRequest) {
  return {
    id: t.id,
    description: t.description,
    owner: t.owner,
    status: t.status,
    type: t.type,
    target: t.target,
    targetDesc: t.targetDesc,
    objectCount: t.tasks.reduce((n, task) => n + task.objects.length, 0),
    tasks: t.tasks.map((task) => ({
      id: task.id,
      description: task.description,
      owner: task.owner,
      status: task.status,
      objectCount: task.objects.length,
    })),
  };
}

export async function handleSAPTransport(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  const action = String(args.action ?? '');

  switch (action) {
    case 'list': {
      const user = (args.user as string | undefined) || client.username;
      const status = (args.status as string | undefined) ?? 'D';
      const transports = await listTransports(client.http, client.safety, user, status === '*' ? undefined : status);
      // ADT returns every matching request WITH its full object list, and there is no server-side
      // limit on /cts/transportrequests. Live: 55 requests = 104 KB (~26k tokens). The cost is the
      // per-request object lists, not the count — capping at 50 of 55 saved only 2%, while dropping
      // object lists saves 4.7x. So `list` summarises by default (the list→get workflow this tool
      // already documents); pass summary=false for the old full-object payload. maxResults stays as
      // a backstop for a large backlog.
      const limit = clampSearchResults(args.maxResults as number | undefined, DEFAULT_TRANSPORT_RESULTS);
      const page = transports.slice(0, limit);
      const truncated = transports.length > limit;
      const payload = args.summary === false ? page : page.map(summarizeTransport);
      return textResult(
        toolJson({
          total: transports.length,
          shown: page.length,
          truncated,
          ...(truncated
            ? {
                hint:
                  `Showing ${page.length} of ${transports.length} transports. Narrow with user/status, ` +
                  `or raise maxResults (max 1000).`,
              }
            : {}),
          transports: payload,
        }),
      );
    }
    case 'get': {
      const id = String(args.id ?? '');
      if (!id) return errorResult('Transport ID is required for "get" action.');
      const transport = await getTransport(client.http, client.safety, id);
      if (!transport) return textResult(`Transport ${id} not found.`);
      return textResult(toolJson(transport));
    }
    case 'create': {
      const description = String(args.description ?? '');
      if (!description) return errorResult('Description is required for "create" action.');
      // Distinguish "target omitted" from "target present but empty": an explicit but
      // blank target is a caller mistake, not a request to use the package/layer path.
      const targetProvided = args.target !== undefined && args.target !== null;
      const explicitTarget = targetProvided ? String(args.target).trim() : undefined;
      if (targetProvided && !explicitTarget) {
        return errorResult(
          '"target" was provided but is empty. Pass a transport target — a system (C11), ' +
            'system.client (C11.021), or target group (/GROUP/) — or omit target to let SAP resolve it from the package.',
        );
      }

      // Shared guidance when this release's ADT stack can't set an explicit target.
      const targetUnsupportedMsg =
        "This system's ADT stack does not support setting an explicit transport target — the tm:root/newrequest " +
        'action is not implemented (an ADT-framework limitation on SAP_BASIS 7.50, verified on SP02 and SP32, ' +
        'independent of STMS/CTC config). It works on newer ABAP Platform / S/4HANA releases. Workaround here: ' +
        'create the request without "target", then set the Transportziel manually in SE09/SE10 (SAP GUI), which ' +
        'works when CTC and the target group are configured.';

      let id: string;
      if (explicitTarget) {
        // Discovery-gate first — the same capability SAP's own Eclipse client checks: the TM
        // resource that sets an explicit target is advertised in ADT discovery only on releases
        // that implement it (the transportorganizer Accept type on cts/transportrequests). When
        // discovery is loaded and the capability is absent (NW 7.50/7.51), fail fast with guidance
        // rather than POST a request the backend rejects with "user action is not supported".
        if (supportsExplicitTransportTarget(client.http) === false) {
          return errorResult(targetUnsupportedMsg);
        }
        // Explicit transport target (Transportziel / TR_TARGET): a system (C11),
        // system.client (C11.021), or target group (/TRG/). Routed via the tm:root/
        // newrequest endpoint — the only ADT path that sets the target directly. The
        // group and system.client forms require extended transport control (CTC).
        try {
          id = await createTransportWithTarget(
            client.http,
            client.safety,
            description,
            explicitTarget,
            client.username,
          );
        } catch (err) {
          if (err instanceof AdtApiError && (err.statusCode === 400 || err.statusCode === 404)) {
            // SAP validates the target server-side: a4h (7.58) returns 400 "Target 'X'
            // does not exist"; other releases may use 404.
            if (/does not exist/i.test(err.message)) {
              return errorResult(
                `Transport target "${explicitTarget}" does not exist on this system. Valid targets are a ` +
                  'system (e.g. C11), system.client (C11.021), or a target group (/GROUP/) — the group and ' +
                  'system.client forms require extended transport control (CTC) to be active. Use ' +
                  'SAPTransport(action="targets") to list the targets this system actually offers.',
              );
            }
            // Fallback for when discovery was not loaded: NW 7.50/7.51 reject tm:root/newrequest
            // with "user action is not supported" (the gate above pre-empts this when discovery is known).
            if (/user action/i.test(err.message) && /not supported/i.test(err.message)) {
              return errorResult(targetUnsupportedMsg);
            }
          }
          throw err;
        }
      } else {
        const targetPackage = args.package ? String(args.package) : undefined;
        const transportLayer = args.transportLayer ? String(args.transportLayer) : undefined;
        id = await createTransport(client.http, client.safety, description, targetPackage, undefined, transportLayer);
      }

      if (!id)
        return errorResult(
          'Transport creation succeeded but no transport ID was returned. Check the SAP system manually.',
        );

      // Read the new request back (best-effort) to report its actual transport target.
      // An empty target means the request is local ("Local Change Requests") — the #1
      // source of "why does it always create a local transport?" confusion — so we
      // surface it explicitly instead of just echoing the ID.
      const created = await getTransport(client.http, client.safety, id).catch(() => null);
      const target = created?.target?.trim() ?? '';
      const targetDesc = created?.targetDesc?.trim() ?? '';

      if (!created) return textResult(`Created transport request: ${id}`);
      if (target) {
        return textResult(
          `Created transport request: ${id}\nTransport target: ${target}${targetDesc ? ` (${targetDesc})` : ''}`,
        );
      }
      return textResult(
        `Created transport request: ${id}\n` +
          `Transport target: <none>${targetDesc ? ` — "${targetDesc}"` : ''}. This is a LOCAL request — it cannot be transported onward.\n\n` +
          'To create a request that targets another system, either:\n' +
          '  • set an explicit target — pass target=<system | system.client | /group/> (e.g. target="/TRG/" or "C11"); ' +
          'the group and system.client forms require extended transport control (CTC) to be active; or\n' +
          '  • let SAP resolve it from the package transport layer + STMS consolidation route (pass transportLayer=<layer> to override the layer).\n' +
          'Both require the SAP system to actually have transport routes/targets configured (a Basis task). ' +
          'On a standalone system with no routes, every request is local — expected, and no ADT/Eclipse/SE10 client can change it.',
      );
    }
    case 'layers': {
      // Discovery: list valid values for create's `transportLayer`. Lets a client pick a
      // real layer instead of guessing. Read-only (no allowTransportWrites required).
      let layers: Awaited<ReturnType<typeof listTransportLayers>>;
      try {
        layers = await listTransportLayers(client.http, client.safety);
      } catch (err) {
        // The package transport-layer value help is 7.52+; NW 7.50/7.51 return 404
        // "No suitable resource found" (verified live on npl 7.50). Surface that clearly
        // instead of a raw 404, so the caller knows discovery is unavailable on this release.
        if (err instanceof AdtApiError && err.isNotFound) {
          return errorResult(
            'Transport-layer discovery is not available on this SAP release — the value help ' +
              '(/sap/bc/adt/packages/valuehelps/transportlayers) returned 404 (typically NW < 7.52). ' +
              'Create requests without transportLayer; the route/target is governed by the package + STMS on these releases.',
          );
        }
        throw err;
      }
      const routed = layers.filter((l) => l.target);
      const summary = layers.length
        ? routed.length
          ? `${layers.length} transport layer(s); ${routed.length} carry a target. Pass one as transportLayer= on create.`
          : `${layers.length} transport layer(s), but none expose a consolidation target — created requests will be local on this system.`
        : 'No transport layers are defined on this system — every request will be local.';
      return textResult(toolJson({ transportLayers: layers, summary }));
    }
    case 'targets': {
      // Discovery: list valid values for create's `target` (Transportziel / TR_TARGET) via the
      // official ADT target value help. Read-only (no allowTransportWrites required).
      // Gate on the same capability as create's target path: NW 7.50 returns an empty list
      // (HTTP 200) from the value help rather than 404, so the discovery accept type — not the
      // HTTP status — is the reliable "is target discovery meaningful here?" signal.
      if (supportsExplicitTransportTarget(client.http) === false) {
        return errorResult(
          "Transport-target discovery is not available on this SAP release — its ADT stack doesn't support " +
            'explicit transport targets (verified on NW 7.50). Set the target in SE09/SE10 instead.',
        );
      }
      let targets: Awaited<ReturnType<typeof listTransportTargets>>;
      try {
        targets = await listTransportTargets(client.http, client.safety);
      } catch (err) {
        // Fallback when discovery wasn't loaded: some releases 404 the value help.
        if (err instanceof AdtApiError && err.isNotFound) {
          return errorResult(
            'Transport-target discovery is not available on this SAP release — the value help ' +
              '(/sap/bc/adt/cts/transportrequests/valuehelp/target) returned 404. Set the target in SE09/SE10 instead.',
          );
        }
        throw err;
      }
      const summary = targets.length
        ? `${targets.length} valid transport target(s). Pass one as target= on create.`
        : 'No transport targets are configured on this system (so created requests are local).';
      return textResult(toolJson({ transportTargets: targets, summary }));
    }
    case 'release': {
      const id = String(args.id ?? '');
      if (!id) return errorResult('Transport ID is required for "release" action.');
      // Enforce the transport-write safety ceiling BEFORE the diagnostic read so an unauthorized
      // caller gets the real "writes blocked" reason (not a misleading "activate inactive objects
      // first") and we don't spend an ADT round-trip for a release we'll refuse. releaseTransport
      // re-checks defensively.
      checkTransport(client.safety, id, 'ReleaseTransport', true);
      const blocking = await precheckInactiveForRelease(client, id);
      if (blocking.length > 0) return inactiveReleaseError(id, blocking);
      const reports = await releaseTransport(client.http, client.safety, id);
      return summarizeRelease(id, reports);
    }
    case 'delete': {
      const id = String(args.id ?? '');
      if (!id) return errorResult('Transport ID is required for "delete" action.');
      const recursive = Boolean(args.recursive ?? false);
      const removeLockedObjects = Boolean(args.removeLockedObjects ?? false);
      try {
        await deleteTransport(client.http, client.safety, id, recursive, removeLockedObjects);
      } catch (e) {
        // ADT refuses to delete a request/task that still holds locked objects (e.g. a deleted
        // object's lingering record). Point the caller at removeLockedObjects instead of a raw [?/009].
        if (!removeLockedObjects && e instanceof Error && /locked objects/i.test(e.message)) {
          return errorResult(
            `${e.message}\n\nThe request still holds locked object(s). ` +
              `Retry with removeLockedObjects=true to strip them first:\n` +
              `  SAPTransport(action="delete", id="${id}", removeLockedObjects=true)`,
          );
        }
        throw e;
      }
      const extras = [recursive ? 'recursive' : '', removeLockedObjects ? 'removed locked objects' : '']
        .filter(Boolean)
        .join(', ');
      return textResult(`Deleted transport request: ${id}${extras ? ` (${extras})` : ''}`);
    }
    case 'remove_object': {
      const id = String(args.id ?? '').trim();
      const pgmid = String(args.pgmid ?? '').trim();
      const objType = String(args.type ?? '').trim();
      const objName = String(args.name ?? '').trim();
      if (!id) return errorResult('"id" (transport request) is required for remove_object action.');
      if (!pgmid || !objType || !objName) {
        return errorResult(
          '"pgmid", "type", and "name" are all required for remove_object — the full CTS object key ' +
            '(e.g. pgmid="R3TR", type="DEVC", name="ZFOO"). The object type alone does not determine pgmid ' +
            '(e.g. COMM is valid under both R3OB and LIMU), so all three are needed.',
        );
      }
      const { taskId, object } = await removeObjectFromTransport(
        client.http,
        client.safety,
        id,
        pgmid,
        objType,
        objName,
      );
      return textResult(
        `Removed ${object.pgmid} ${object.type} ${object.name} from task ${taskId} (transport ${id} kept).`,
      );
    }
    case 'reassign': {
      const id = String(args.id ?? '');
      if (!id) return errorResult('Transport ID is required for "reassign" action.');
      const owner = String(args.owner ?? '');
      if (!owner) return errorResult('Owner is required for "reassign" action.');
      const recursive = Boolean(args.recursive ?? false);
      await reassignTransport(client.http, client.safety, id, owner, recursive);
      return textResult(`Reassigned transport ${id} to ${owner}${recursive ? ' (recursive)' : ''}`);
    }
    case 'release_recursive': {
      const id = String(args.id ?? '');
      if (!id) return errorResult('Transport ID is required for "release_recursive" action.');
      // Safety ceiling before the diagnostic read (see 'release' above). releaseTransportRecursive
      // re-checks the request and each task defensively.
      checkTransport(client.safety, id, 'ReleaseTransportRecursive', true);
      // One probe on the parent request id catches child-task objects too (their parentTransport
      // ends in /<request>), so no per-task fetch is needed.
      const blocking = await precheckInactiveForRelease(client, id);
      if (blocking.length > 0) return inactiveReleaseError(id, blocking);
      const { released, reports } = await releaseTransportRecursive(client.http, client.safety, id);
      return summarizeRelease(id, reports, released);
    }
    case 'check': {
      // Check transport requirements for an object/package combination.
      // Does NOT require allowTransportWrites — this is a read-only check.
      const objectType = String(args.type ?? '');
      const objectName = String(args.name ?? '');
      const pkg = String(args.package ?? '');
      if (!objectType || !objectName) return errorResult('"type" and "name" are required for "check" action.');
      if (!pkg) return errorResult('"package" is required for "check" action.');

      const objectUrl = objectUrlForType(objectType, objectName);
      const info = await getTransportInfo(client.http, client.safety, objectUrl, pkg, 'I');

      const summary = info.isLocal
        ? `Package "${pkg}" is local — no transport required.`
        : info.recording
          ? `Package "${pkg}" requires a transport for object creation.`
          : `Package "${pkg}" does not require transport recording.`;

      return textResult(
        toolJson({
          package: pkg,
          transportRequired: !info.isLocal && info.recording,
          isLocal: info.isLocal,
          deliveryUnit: info.deliveryUnit,
          existingTransports: info.existingTransports,
          ...(info.lockedTransport ? { lockedTransport: info.lockedTransport } : {}),
          summary,
        }),
      );
    }
    case 'history': {
      const objectType = String(args.type ?? '');
      const objectName = String(args.name ?? '');
      if (!objectType || !objectName) {
        return errorResult('"type" and "name" are required for "history" action.');
      }

      const objectUrl = objectUrlForType(objectType, objectName);
      const primary = await getObjectTransports(client.http, client.safety, objectUrl);
      let candidateTransports = primary.candidateTransports;

      // Fallback: if per-object transport lookup is empty, derive the package via
      // the object metadata endpoint and ask transportchecks for candidate transports.
      if (primary.relatedTransports.length === 0 && candidateTransports.length === 0) {
        try {
          const pkg = await client.resolveObjectPackage(objectUrl);
          if (pkg && pkg !== '$TMP') {
            const info = await getTransportInfo(client.http, client.safety, objectUrl, pkg, '');
            candidateTransports = info.existingTransports;
          }
        } catch {
          // best-effort-fallback
        }
      }

      const lockOwner = primary.relatedTransports[0]?.owner;
      const summary = primary.lockedTransport
        ? `Object ${objectName} is locked in transport ${primary.lockedTransport}${lockOwner ? ` by ${lockOwner}` : ''}.`
        : candidateTransports.length > 0
          ? `Object ${objectName} has no active lock; ${candidateTransports.length} transport(s) available for assignment.`
          : `Object ${objectName} has no related or candidate transports (likely $TMP / local object).`;

      const history: ObjectTransportHistory = {
        object: { type: objectType, name: objectName, uri: objectUrl },
        ...(primary.lockedTransport ? { lockedTransport: primary.lockedTransport } : {}),
        relatedTransports: primary.relatedTransports,
        candidateTransports,
        summary,
      };

      return textResult(toolJson(history));
    }
    default:
      return errorResult(
        `Unknown SAPTransport action: ${action}. Supported: list, get, create, release, delete, remove_object, reassign, release_recursive, check, history`,
      );
  }
}
