import type { AdtClient } from '../adt/client.js';
import { syntaxCheck } from '../adt/devtools.js';
import { AdtApiError } from '../adt/errors.js';
import { syntaxCheckBatch } from '../adt/syntax-batch.js';
import type { SyntaxCheckResult } from '../adt/types.js';
import { isTablesEndpointAvailable } from './feature-cache.js';
import { functionModuleObjectUrl, normalizeObjectType, objectUrlForType } from './object-types.js';
import { type ToolResult, textResult, toolJson } from './shared.js';

/** Shared wire and result contract for both syntax-check entry points. */
export async function handleSyntaxCheck(client: AdtClient, args: Record<string, unknown>): Promise<ToolResult> {
  if (Array.isArray(args.objects)) {
    const objects = args.objects.map((object: { type: string; name: string }) => ({
      ...object,
      uri: objectUrlForType(object.type, object.name),
    }));
    return textResult(
      toolJson(
        await syntaxCheckBatch(
          client.http,
          client.safety,
          objects,
          args.version === 'inactive' ? 'inactive' : 'active',
        ),
      ),
    );
  }
  const type = normalizeObjectType(String(args.type ?? ''));
  const name = String(args.name ?? '');
  const version = args.version === 'inactive' ? 'inactive' : args.version === 'active' ? 'active' : undefined;
  const content = typeof args.source === 'string' ? (args.source as string) : undefined;
  let objectUrl: string;
  if (type === 'FUNC') {
    // SAP 758 silently checks stored code instead of a supplied artifact containing these lines.
    if (content !== undefined && /^\s*\*"/m.test(content)) {
      return notChecked(
        { hasErrors: false, messages: [], checked: false },
        'SAP GUI-style *" comment lines can make SAP ignore supplied FUNC source',
        'Read FUNC source through SAPRead and edit its ADT-style FUNCTION header; remove SAP GUI-style *" lines before checking.',
      );
    }
    const group = await client.resolveFunctionGroup(name);
    if (!group) {
      return notChecked(
        { hasErrors: false, messages: [], checked: false },
        `The parent function group for FUNC ${name} could not be resolved by the bounded search`,
        'Use SAPSearch to identify the parent, or check the stored function group with type="FUGR".',
      );
    }
    objectUrl = functionModuleObjectUrl(group, name);
  } else {
    objectUrl = objectUrlForType(type, name);
  }
  let absent = (type === 'TABL' || content !== undefined) && (await isConfirmedAbsent(client, objectUrl));
  // TABL aliases include structures. Resolve their actual root for stored and unsaved checks;
  // only a 404 permits the fallback, and fresh metadata avoids retaining an obsolete type route.
  if (type === 'TABL' && absent) {
    objectUrl = objectUrlForType('TABL/DS', name);
    absent = await isConfirmedAbsent(client, objectUrl);
    // 7.50/7.51 have no /ddic/tables/ and serve transparent tables there as TABL/DS; a check reports false errors.
    const tablesEndpoint = isTablesEndpointAvailable();
    if (!absent && tablesEndpoint !== true && !(await isConfirmedStructure(client, name, objectUrl))) {
      return notChecked(
        { hasErrors: false, messages: [], checked: false },
        tablesEndpoint === false
          ? `TABL ${name} is not confirmed as a structure, and a transparent table has no ADT source check without /sap/bc/adt/ddic/tables/ (SAP_BASIS 7.50/7.51)`
          : `TABL ${name} is not confirmed as a structure, and ADT discovery is not loaded, so a system without /sap/bc/adt/ddic/tables/ (7.50/7.51) cannot be ruled out`,
        tablesEndpoint === false
          ? 'Check transparent tables in SE11 on this release.'
          : 'Retry the check; if it persists, verify repository search access for this user.',
      );
    }
  }
  // SAP does not refuse unsaved text for every absent object: for a PROG it checks the text as a
  // standalone include (`/programs/includes/<name>?context=/programs/programs/<name>`) with default
  // program attributes — fixed-point arithmetic off — and reports `processed`. Every `@` host
  // variable then fails, and the result reads like a real verdict. Confirm the object exists first
  // (version-less metadata = SAP's developer view, so an inactive-only object still counts).
  if (content !== undefined && absent) {
    return notChecked(
      { hasErrors: false, messages: [], checked: false },
      `${type} ${name} was not found at ${objectUrl}`,
    );
  }
  const opts: { version?: 'active' | 'inactive'; content?: string } = {};
  if (version) opts.version = version;
  if (content !== undefined) opts.content = content;
  const result = await syntaxCheck(
    client.http,
    client.safety,
    objectUrl,
    Object.keys(opts).length > 0 ? opts : undefined,
  );
  // Fail closed: SAP checked nothing (object does not exist yet) → never report "clean", or
  // callers read hasErrors:false as "SAP will accept this source".
  if (!result.checked) {
    // A never-activated object has no active version to check.
    const advice =
      !version && content === undefined && !absent
        ? `${DEFAULT_ADVICE} If it was never activated, re-run with version="inactive".`
        : undefined;
    return notChecked(result, result.statusText, advice);
  }
  return textResult(toolJson(result));
}

/** Search-first resolver: only its /ddic/structures/ answer confirms a structure; any error fails closed. */
async function isConfirmedStructure(client: AdtClient, name: string, structUrl: string): Promise<boolean> {
  try {
    return (await client.resolveTablObjectUrlForWrite(name, { tablesEndpointAvailable: false })) === structUrl;
  } catch {
    return false;
  }
}

/** Only a 404 establishes absence; any other probe failure leaves the verdict to SAP's own check report. */
async function isConfirmedAbsent(client: AdtClient, objectUrl: string): Promise<boolean> {
  try {
    await client.getObjectMetadata(objectUrl);
    return false;
  } catch (err) {
    return err instanceof AdtApiError && err.isNotFound;
  }
}

const DEFAULT_ADVICE =
  'Verify the object type and name; create the object only if it does not exist (SAPWrite action="create"), then re-run the syntax check.';

function notChecked(result: SyntaxCheckResult, statusText: string | undefined, advice = DEFAULT_ADVICE): ToolResult {
  return textResult(
    toolJson({
      ...result,
      ...(statusText ? { statusText } : {}),
      hasErrors: true,
      messages: [
        {
          severity: 'error',
          text: `Not checked — ${(statusText || 'SAP did not process this check').replace(/\.$/, '')}. The source was NOT validated. ${advice}`,
          line: 0,
          column: 0,
        },
      ],
    }),
  );
}
